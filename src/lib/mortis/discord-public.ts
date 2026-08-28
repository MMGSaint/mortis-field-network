/**
 * Tokenless Discord probes. Application RPC and the gateway URL are public.
 * Never send a bot token on these paths. Never persist verify_key to git.
 */
import { auditHeldPermissions, botPermissionInteger } from "./permissions.ts";
import { hashBlueprint } from "./blueprint.ts";
import type { Blueprint } from "./types.ts";

const API = "https://discord.com/api/v10";
const UA = "MortisFieldNetwork-Envoy/phase1 (scratch-validation)";

export const SCRATCH_GUILD_ID = "1540022458126700674";
export const SCRATCH_APP_ID = "1540058003888410806";

/** Live-captured Developer Portal default (2026-08-27 public RPC). Not the guild-held integer. */
export const CAPTURED_INSTALL_PARAMS = "7347005485008037";

export type DiscordHttpKind =
  | "ok"
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "rate_limit"
  | "blocked"
  | "server"
  | "other";

export function classifyDiscordHttp(status: number, body = ""): DiscordHttpKind {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 400) return "bad_request";
  if (status === 429) return /being blocked/i.test(body) ? "blocked" : "rate_limit";
  if (status >= 500) return "server";
  return "other";
}

export type PublicAppFinding = {
  severity: "ok" | "warn" | "hold";
  code: string;
  detail: string;
};

export type PublicAppProbe = {
  ok: boolean;
  reachable: boolean;
  appId: string;
  name?: string;
  botPublic?: boolean;
  installPermissions?: string;
  requiredPermissions: string;
  installMatchesRequired: boolean;
  administrator: boolean;
  missing: string[];
  excess: string[];
  publicKey?: string;
  findings: PublicAppFinding[];
  status?: number;
  kind?: DiscordHttpKind;
  error?: string;
};

type PublicAppRaw = {
  id?: unknown;
  name?: unknown;
  bot_public?: unknown;
  install_params?: { permissions?: unknown; scopes?: unknown };
  verify_key?: unknown;
};

export function assessPublicApplication(raw: PublicAppRaw, appId: string): PublicAppProbe {
  const required = botPermissionInteger();
  const findings: PublicAppFinding[] = [];
  const installRaw = raw.install_params?.permissions;
  let installPermissions: string | undefined;
  let held = 0n;
  try {
    if (installRaw !== undefined && installRaw !== null && String(installRaw) !== "") {
      installPermissions = String(installRaw);
      held = BigInt(installPermissions);
    }
  } catch {
    findings.push({
      severity: "hold",
      code: "app.install_params.parse",
      detail: "install_params.permissions is not an integer",
    });
  }

  const audit = auditHeldPermissions(held);
  const name = typeof raw.name === "string" ? raw.name : undefined;
  const botPublic = typeof raw.bot_public === "boolean" ? raw.bot_public : undefined;
  const verify = typeof raw.verify_key === "string" && /^[0-9a-fA-F]{64}$/.test(raw.verify_key) ? raw.verify_key : undefined;

  if (installPermissions === undefined) {
    findings.push({
      severity: "hold",
      code: "app.install_params.missing",
      detail: "Public application RPC did not include install_params.permissions",
    });
  } else if (held !== required) {
    findings.push({
      severity: "hold",
      code: "app.install_params",
      detail:
        `Developer Portal default install integer ${installPermissions} does not match canonical ${required.toString()}. ` +
        "This is independent of a guild re-authorize. Use the workstation invite URL. Do not add Administrator.",
    });
  }

  if (audit.administrator) {
    findings.push({
      severity: "hold",
      code: "app.administrator",
      detail: `Default install includes Administrator. Re-invite with ${required.toString()} and turn Administrator off.`,
    });
  }
  if (audit.missing.length) {
    findings.push({
      severity: "hold",
      code: "app.install_params.missing_bits",
      detail: `Default install is missing ${audit.missing.join(", ")}.`,
    });
  }
  const extras = audit.excess.filter((x) => x !== "ADMINISTRATOR");
  if (extras.length) {
    findings.push({
      severity: "warn",
      code: "app.install_params.excess",
      detail: `Default install extra bits ${extras.join(", ")}.`,
    });
  }
  if (botPublic === true) {
    findings.push({
      severity: "warn",
      code: "app.bot_public",
      detail: "Public Bot is on. Turn it off for the scratch application (Developer Portal → Bot → Public Bot).",
    });
  }

  const holds = findings.some((f) => f.severity === "hold");
  return {
    ok: !holds,
    reachable: true,
    appId,
    name,
    botPublic,
    installPermissions,
    requiredPermissions: required.toString(),
    installMatchesRequired: installPermissions === required.toString(),
    administrator: audit.administrator,
    missing: audit.missing,
    excess: extras,
    publicKey: verify,
    findings,
    status: 200,
    kind: "ok",
  };
}

export async function probePublicApplication(
  appId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicAppProbe> {
  const required = botPermissionInteger().toString();
  if (!/^\d{17,20}$/.test(appId)) {
    return {
      ok: false,
      reachable: false,
      appId,
      requiredPermissions: required,
      installMatchesRequired: false,
      administrator: false,
      missing: [],
      excess: [],
      findings: [{ severity: "hold", code: "app.id", detail: "application id malformed" }],
      error: "application id malformed",
    };
  }
  try {
    const res = await fetchImpl(`${API}/applications/${appId}/rpc`, {
      method: "GET",
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    const kind = classifyDiscordHttp(res.status, text);
    if (kind !== "ok") {
      return {
        ok: false,
        reachable: kind !== "blocked" && res.status !== 0,
        appId,
        requiredPermissions: required,
        installMatchesRequired: false,
        administrator: false,
        missing: [],
        excess: [],
        findings: [
          {
            severity: "hold",
            code: kind === "blocked" ? "discord.blocked" : "app.rpc",
            detail: `${kind} ${res.status} ${text.slice(0, 240)}`.trim(),
          },
        ],
        status: res.status,
        kind,
        error: text.slice(0, 240),
      };
    }
    const raw = JSON.parse(text) as PublicAppRaw;
    return assessPublicApplication(raw, appId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reachable: false,
      appId,
      requiredPermissions: required,
      installMatchesRequired: false,
      administrator: false,
      missing: [],
      excess: [],
      findings: [{ severity: "hold", code: "app.rpc.network", detail: msg.slice(0, 240) }],
      kind: "other",
      error: msg.slice(0, 240),
    };
  }
}

export async function probeDiscordGateway(fetchImpl: typeof fetch = fetch): Promise<{
  ok: boolean;
  status?: number;
  kind?: DiscordHttpKind;
  url?: string;
  error?: string;
}> {
  try {
    const res = await fetchImpl(`${API}/gateway`, {
      method: "GET",
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    const kind = classifyDiscordHttp(res.status, text);
    if (kind !== "ok") {
      return { ok: false, status: res.status, kind, error: text.slice(0, 240) };
    }
    const body = JSON.parse(text) as { url?: string };
    return { ok: Boolean(body.url), status: res.status, kind, url: body.url };
  } catch (err) {
    return { ok: false, kind: "other", error: err instanceof Error ? err.message : String(err) };
  }
}

export type LiveReadiness = {
  tokenInMemory: boolean;
  liveConnected: boolean;
  scratchConfirmed: boolean;
  discordGateway: { ok: boolean; status?: number; kind?: DiscordHttpKind; url?: string; error?: string; skipped?: boolean };
  publicApp: PublicAppProbe;
  scratchState: {
    present: boolean;
    guildId?: string;
    bindings: number;
    lastAppliedHash: string | null;
    currentHash: string;
    hashMatch: boolean;
  };
  blocker: string | null;
};

export async function assessLiveReadiness(opts: {
  bp: Blueprint;
  appId: string;
  guildId: string;
  tokenInMemory: boolean;
  liveConnected: boolean;
  scratchConfirmed: boolean;
  saved?: { guildId: string; bindings: Array<[string, string]>; lastAppliedHash: string | null } | null;
  network?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<LiveReadiness> {
  const currentHash = await hashBlueprint(opts.bp);
  const saved = opts.saved ?? null;
  const scratchState = {
    present: Boolean(saved),
    guildId: saved?.guildId ?? opts.guildId,
    bindings: saved?.bindings.length ?? 0,
    lastAppliedHash: saved?.lastAppliedHash ?? null,
    currentHash,
    hashMatch: Boolean(saved?.lastAppliedHash && saved.lastAppliedHash === currentHash),
  };

  let publicApp: PublicAppProbe;
  let discordGateway: LiveReadiness["discordGateway"];
  if (opts.network === false) {
    publicApp = {
      ok: false,
      reachable: false,
      appId: opts.appId,
      requiredPermissions: botPermissionInteger().toString(),
      installMatchesRequired: false,
      administrator: false,
      missing: [],
      excess: [],
      findings: [{ severity: "warn", code: "app.rpc.skipped", detail: "network probe skipped" }],
    };
    discordGateway = { ok: false, skipped: true };
  } else {
    const fetchImpl = opts.fetchImpl ?? fetch;
    publicApp = await probePublicApplication(opts.appId, fetchImpl);
    discordGateway = await probeDiscordGateway(fetchImpl);
  }

  let blocker: string | null = null;
  if (!opts.tokenInMemory) {
    blocker =
      "Bot token is not in process memory. Connect on Provision (password field). Re-authorizing the bot in Discord does not send the token here. Never paste the token in chat.";
  } else if (!opts.liveConnected) {
    blocker = "Token is in memory but live guild is not attached — Connect again.";
  } else if (discordGateway.kind === "blocked" || publicApp.kind === "blocked") {
    blocker = "Discord is IP-blocking this environment (429 being blocked). Retry later; do not add Administrator.";
  }

  return {
    tokenInMemory: opts.tokenInMemory,
    liveConnected: opts.liveConnected,
    scratchConfirmed: opts.scratchConfirmed,
    discordGateway,
    publicApp,
    scratchState,
    blocker,
  };
}
