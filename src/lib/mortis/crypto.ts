/**
 * Verify-only crypto. Envoy never holds a signing key.
 * Digest-compare is fixed-work (S-05: do not early-exit on secret length).
 */

const ED25519_SPKI_PREFIX = hexToBytes("302a300506032b6570032100");

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, "");
  if (clean.length % 2 !== 0) throw new Error("hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function webBytes(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) out[key] = sortValue(rec[key]);
    return out;
  }
  return value;
}

/** SHA-256 both sides, then XOR-fold. Always 32-byte work. */
export async function digestEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const da = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(a)));
  const db = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(b)));
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= da[i]! ^ db[i]!;
  return diff === 0;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", webBytes(bytes))));
}

export async function importEd25519PublicRaw(raw32: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("raw", webBytes(raw32), { name: "Ed25519" }, false, ["verify"]);
  } catch {
    const spki = concatBytes(ED25519_SPKI_PREFIX, raw32);
    return crypto.subtle.importKey("spki", webBytes(spki), { name: "Ed25519" }, false, ["verify"]);
  }
}

export async function verifyEd25519(opts: {
  publicKeyHex: string;
  message: Uint8Array;
  signatureHex: string;
}): Promise<boolean> {
  try {
    const key = await importEd25519PublicRaw(hexToBytes(opts.publicKeyHex));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, webBytes(hexToBytes(opts.signatureHex)), webBytes(opts.message));
  } catch {
    return false;
  }
}

/** Discord: signature over timestamp + raw body. Fail closed. Do not parse body first. */
export async function verifyDiscordInteraction(opts: {
  publicKeyHex: string;
  timestamp: string | null;
  signatureHex: string | null;
  rawBody: string;
}): Promise<boolean> {
  if (!opts.timestamp || !opts.signatureHex) return false;
  if (!/^[0-9a-fA-F]+$/.test(opts.signatureHex)) return false;
  const message = new TextEncoder().encode(opts.timestamp + opts.rawBody);
  return verifyEd25519({
    publicKeyHex: opts.publicKeyHex,
    message,
    signatureHex: opts.signatureHex,
  });
}

export async function generateEd25519HexPair(): Promise<{ publicKeyHex: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKeyHex: bytesToHex(raw), privateKey: pair.privateKey };
}

export async function signEd25519Hex(privateKey: CryptoKey, message: Uint8Array): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, webBytes(message)));
  return bytesToHex(sig);
}

/** Release excerpt: canonical JSON bytes, Ed25519 over those bytes, public-key verify only. */
export async function verifyReleaseExcerpt(opts: {
  publicKeyHex: string;
  payload: unknown;
  signatureHex: string;
}): Promise<boolean> {
  const bytes = new TextEncoder().encode(canonicalStringify(opts.payload));
  return verifyEd25519({
    publicKeyHex: opts.publicKeyHex,
    message: bytes,
    signatureHex: opts.signatureHex,
  });
}
