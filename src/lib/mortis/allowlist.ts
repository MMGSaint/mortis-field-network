/**
 * Live-attach guild allowlist. Refusal happens BEFORE hydrate or any use of
 * the bot token. Scratch is the only pre-approved id. Production ids never
 * appear here — adding one is an owner-only decision. Never widen automatically.
 */

import { SCRATCH_GUILD_ID } from "./discord-public.ts";

/**
 * Scratch guild is the only pre-approved id. The list is a Set so callers
 * cannot mutate it accidentally (see {@link isGuildAllowed}, which returns
 * a boolean rather than exposing the set).
 */
const DEFAULT_ALLOWED = new Set<string>([SCRATCH_GUILD_ID]);

/**
 * Additional ids supplied at runtime (env-driven scratch overlays, tests).
 * Never seeded with production ids. Cleared with {@link clearRuntimeAllowlist}.
 */
const runtimeAllowed = new Set<string>();

/** True if the id has the shape of a Discord snowflake. Cheap guard. */
export function isSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

/**
 * Explicit list of guild ids that are BANNED regardless of allowlist state.
 * If a production guild id is ever hardcoded here, attach refuses before
 * any token use. Empty by default — the allowlist itself is the primary gate.
 */
const HARD_DENY = new Set<string>();

export function isGuildAllowed(guildId: string): boolean {
  if (!isSnowflake(guildId)) return false;
  if (HARD_DENY.has(guildId)) return false;
  if (DEFAULT_ALLOWED.has(guildId)) return true;
  if (runtimeAllowed.has(guildId)) return true;
  return false;
}

export function allowlistReason(guildId: string): string {
  if (!isSnowflake(guildId)) return "guild snowflake malformed";
  if (HARD_DENY.has(guildId)) return `guild ${guildId} is on the hard-deny list`;
  return (
    `guild ${guildId} is not on the scratch allowlist. ` +
    "Attach is refused before any token or hydrate call. " +
    "Add the id via addRuntimeAllowedGuild in a test, or via the owner-side allowlist for a new scratch."
  );
}

/** Add a scratch id at runtime. Rejects malformed ids. */
export function addRuntimeAllowedGuild(guildId: string): void {
  if (!isSnowflake(guildId)) throw new Error("guild snowflake malformed");
  runtimeAllowed.add(guildId);
}

export function clearRuntimeAllowlist(): void {
  runtimeAllowed.clear();
}

export function listAllowedGuilds(): string[] {
  return [...DEFAULT_ALLOWED, ...runtimeAllowed];
}
