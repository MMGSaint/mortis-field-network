/**
 * S89 — programmatic live attach, decoupled from the Provision UI.
 *
 * Before this module the ONLY caller of `MortisRuntime.attachLive` was the
 * Provision route (`server.ts`), which meant every live engineering task
 * required a human to open a browser, paste a token into a password field,
 * and click Connect. That made the UI a hidden dependency of the engine.
 *
 * This module gives the same capability to any code path — CLI, test
 * harness, cron — by reading the bot token from the process environment.
 *
 * SECRET HANDLING RULES (enforced by S91/S92 regression tests):
 *   - The token is read from `process.env.DISCORD_BOT_TOKEN` (optionally
 *     seeded from a gitignored `.env` via `process.loadEnvFile`).
 *   - It is passed straight into `attachLive`, which stores it in a
 *     module-private WeakMap. It is never written to disk by this module.
 *   - It is never returned, never logged, never included in a thrown error
 *     message, and never placed in an audit row.
 *   - {@link redactToken} exists so callers can scrub any string (a Discord
 *     error body, a stack trace) before printing it.
 *
 * The guild allowlist (S70) still gates the attach. Passing a production
 * guild id here fails closed exactly as it does from the UI.
 */

import { MortisRuntime } from "./runtime.ts";
import { SCRATCH_APP_ID, SCRATCH_GUILD_ID } from "./discord-public.ts";
import { STAFF_CAPS_ALL } from "./types.ts";
import type { LiveIdentity } from "./discord-rest.ts";

export type LiveSessionOptions = {
  /** Defaults to `DISCORD_SCRATCH_GUILD_ID` / `DISCORD_GUILD_ID`, then the scratch id. */
  guildId?: string;
  /** Defaults to `DISCORD_APP_ID` / `DISCORD_APPLICATION_ID`, then the scratch app id. */
  appId?: string;
  /** Defaults to `DISCORD_PUBLIC_KEY`. Optional — only needed for HTTP interactions. */
  publicKey?: string;
  /** Override the environment lookup. Used by tests. Never logged. */
  token?: string;
  /** Working directory for blueprint load. Defaults to process.cwd(). */
  cwd?: string;
  /** Attach to an existing runtime instead of loading a new one. */
  runtime?: MortisRuntime;
};

export class MissingLiveTokenError extends Error {
  constructor() {
    super(
      "DISCORD_BOT_TOKEN is not set. Put it in a gitignored .env file or export it " +
        "in the shell. It is never read from source, docs, or command arguments.",
    );
    this.name = "MissingLiveTokenError";
  }
}

/**
 * Replace every occurrence of the live token with a placeholder.
 * Use before printing ANY string that could have transited a Discord error
 * body, a stack trace, or a request echo.
 */
export function redactToken(text: string, token?: string): string {
  const secret = token ?? process.env.DISCORD_BOT_TOKEN;
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}

/**
 * Load a gitignored `.env` into `process.env` if present. Missing file is
 * not an error — the token may already be exported in the shell.
 */
export function loadDotEnv(cwd = process.cwd()): void {
  const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loader !== "function") return;
  try {
    loader.call(process, `${cwd}/.env`);
  } catch {
    /* no .env — the token may be exported directly. Not an error. */
  }
}

function resolveToken(explicit?: string): string {
  const token = explicit ?? process.env.DISCORD_BOT_TOKEN ?? "";
  if (!token.trim()) throw new MissingLiveTokenError();
  return token.trim();
}

/**
 * Attach a runtime to the live scratch guild using the environment token.
 *
 * Returns the runtime plus the live identity. The caller never receives the
 * token — `runtime.hasLiveToken()` is the only observable, and it is a boolean.
 */
export async function attachLiveFromEnv(
  opts: LiveSessionOptions = {},
): Promise<{ runtime: MortisRuntime; identity: LiveIdentity }> {
  const cwd = opts.cwd ?? process.cwd();
  loadDotEnv(cwd);
  const token = resolveToken(opts.token);
  const guildId =
    opts.guildId ?? process.env.DISCORD_SCRATCH_GUILD_ID ?? process.env.DISCORD_GUILD_ID ?? SCRATCH_GUILD_ID;
  const appId = opts.appId ?? process.env.DISCORD_APP_ID ?? process.env.DISCORD_APPLICATION_ID ?? SCRATCH_APP_ID;
  const publicKey = opts.publicKey ?? process.env.DISCORD_PUBLIC_KEY;

  const runtime = opts.runtime ?? MortisRuntime.load(cwd);
  if (!runtime.discordKeys) await runtime.bootstrapKeys();

  try {
    // confirmScratch is asserted here because the S70 allowlist is the real
    // gate. A non-allowlisted guild id still fails closed before hydrate.
    const identity = await runtime.attachLive({
      token,
      guildId,
      appId,
      publicKey,
      confirmScratch: true,
    });
    seedLiveStaff(runtime, identity);
    return { runtime, identity };
  } catch (e) {
    // Never let a token fragment escape through an error body.
    const msg = redactToken(e instanceof Error ? e.message : String(e), token);
    const err = new Error(msg);
    err.name = e instanceof Error ? e.name : "LiveAttachError";
    throw err;
  }
}

/**
 * S94 — seed the envoy staff table with REAL Discord snowflakes on live attach.
 *
 * Before this, `server.ts` seeded the literal placeholders `owner_1` / `ops_1`,
 * which are not Discord snowflakes. A real staff member interacting over the
 * gateway arrives with their actual snowflake, so `staffAllowedToSee` looked
 * them up, found nothing, and refused — live ticket claim/close was broken for
 * every real human, not just for automated harnesses.
 *
 * Authorization still lives in the envoy staff table, NOT in Discord role
 * names — that invariant is unchanged. This only seeds that table from two
 * explicit, verifiable sources:
 *   1. The Discord guild owner (`guild.owner_id`, read from the API).
 *   2. `DISCORD_OPERATOR_IDS` — an explicit operator allowlist, comma or
 *      space separated snowflakes.
 *
 * Discord role membership is deliberately NOT a seed source: a role can be
 * granted inside Discord by anyone holding Manage Roles, which would quietly
 * make Discord an authorization authority. It is not one.
 */
export function seedLiveStaff(
  runtime: MortisRuntime,
  identity: Pick<LiveIdentity, "ownerId">,
): { seeded: Array<{ snowflake: string; source: "guild_owner" | "operator_env" }> } {
  const seeded: Array<{ snowflake: string; source: "guild_owner" | "operator_env" }> = [];
  const isSnowflake = (v: string) => /^\d{17,20}$/.test(v);

  if (identity.ownerId && isSnowflake(identity.ownerId)) {
    runtime.store.staff.set(identity.ownerId, {
      snowflake: identity.ownerId,
      handle: "guild-owner",
      capabilities: ["*", ...STAFF_CAPS_ALL],
    });
    seeded.push({ snowflake: identity.ownerId, source: "guild_owner" });
  }

  const raw = process.env.DISCORD_OPERATOR_IDS ?? "";
  for (const id of raw.split(/[\s,]+/).filter(Boolean)) {
    if (!isSnowflake(id)) continue;
    if (runtime.store.staff.has(id)) continue;
    runtime.store.staff.set(id, {
      snowflake: id,
      handle: "operator",
      capabilities: [...STAFF_CAPS_ALL],
    });
    seeded.push({ snowflake: id, source: "operator_env" });
  }

  if (seeded.length) {
    runtime.store.appendAudit({
      actor: "owner-cli",
      action: "staff.seed",
      target: "guild",
      details: { count: seeded.length, sources: seeded.map((s) => s.source) },
      outcome: "ok",
    });
  }
  return { seeded };
}

/** True when a token is resolvable without throwing. Does not reveal it. */
export function liveTokenAvailable(cwd = process.cwd()): boolean {
  loadDotEnv(cwd);
  return Boolean((process.env.DISCORD_BOT_TOKEN ?? "").trim());
}
