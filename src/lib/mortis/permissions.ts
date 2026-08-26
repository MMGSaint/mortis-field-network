/** Least-privilege Discord permission bits. Never Administrator. */

export const PERM = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  MANAGE_THREADS: 1n << 34n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  PIN_MESSAGES: 1n << 51n,
} as const;

export type PermName = keyof typeof PERM;

export const BOT_PERM_NAMES: PermName[] = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "EMBED_LINKS",
  "READ_MESSAGE_HISTORY",
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_WEBHOOKS",
  "USE_APPLICATION_COMMANDS",
  "MANAGE_THREADS",
  "SEND_MESSAGES_IN_THREADS",
  "CONNECT",
];

/**
 * Canonical least-privilege invite integer. Never Administrator, never Manage Server.
 * Derived from BOT_PERM_NAMES.
 *
 * An earlier published figure `294851834304` was a transcription error: it omitted
 * VIEW_CHANNEL, SEND_MESSAGES, MANAGE_CHANNELS, MANAGE_ROLES, and CONNECT, and
 * included unrelated bits. If a scratch invite used that URL, re-invite with this
 * integer. Do not "fix" 403s by adding Administrator.
 */
export const BOT_PERMISSION_INTEGER = 295011699728n;

export function packPerms(names: PermName[]): bigint {
  return names.reduce((acc, n) => acc | PERM[n], 0n);
}

export function botPermissionInteger(): bigint {
  return packPerms(BOT_PERM_NAMES);
}

export function botInviteUrl(appId: string): string {
  const perms = botPermissionInteger().toString();
  const scope = encodeURIComponent("bot applications.commands");
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&permissions=${perms}&scope=${scope}`;
}

export function permissionExcess(held: bigint, required: bigint = botPermissionInteger()): string[] {
  const extras: string[] = [];
  if (held & PERM.ADMINISTRATOR) extras.push("ADMINISTRATOR");
  for (const [name, bit] of Object.entries(PERM) as [PermName, bigint][]) {
    if (name === "ADMINISTRATOR") continue;
    if ((held & bit) !== 0n && (required & bit) === 0n) extras.push(name);
  }
  return extras;
}

export function permissionMissing(held: bigint, required: bigint = botPermissionInteger()): string[] {
  if ((held & PERM.ADMINISTRATOR) !== 0n) return [];
  const missing: string[] = [];
  for (const name of BOT_PERM_NAMES) {
    if ((required & PERM[name]) !== 0n && (held & PERM[name]) === 0n) missing.push(name);
  }
  return missing;
}

export type PermAudit = {
  held: string;
  required: string;
  administrator: boolean;
  missing: string[];
  excess: string[];
};

export function auditHeldPermissions(held: bigint): PermAudit {
  return {
    held: held.toString(),
    required: botPermissionInteger().toString(),
    administrator: (held & PERM.ADMINISTRATOR) !== 0n,
    missing: permissionMissing(held),
    excess: permissionExcess(held),
  };
}

export type Audience = "public" | "initiate+" | "granted" | "staff";

export type Overwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

const VIEW = PERM.VIEW_CHANNEL;
const SEND = PERM.SEND_MESSAGES;
const CONNECT = PERM.CONNECT;
const SPEAK = PERM.SPEAK;
const ATTACH = PERM.ATTACH_FILES;
const READ = PERM.READ_MESSAGE_HISTORY;

export function generateOverwrites(opts: {
  guildId: string;
  audience: Audience;
  kind: "text" | "voice" | "category";
  readonly: boolean;
  attachmentsRestricted?: boolean;
  showLockedCategory?: boolean;
  roleSnowflakes: {
    everyone: string;
    initiate: string;
    shadow: string;
    staff: string[];
    bot: string;
  };
}): Overwrite[] {
  const { roleSnowflakes: r, audience, kind, readonly } = opts;
  const isVoice = kind === "voice";
  const viewAllow = isVoice ? VIEW | CONNECT : VIEW | READ;
  const writeAllow = isVoice ? SPEAK : SEND;
  const writeDeny = isVoice ? SPEAK : SEND | (opts.attachmentsRestricted ? ATTACH : 0n);

  const out: Overwrite[] = [];

  const push = (id: string, allow: bigint, deny: bigint) => {
    out.push({ id, type: 0, allow: allow.toString(), deny: deny.toString() });
  };

  if (kind === "category" && opts.showLockedCategory && audience !== "public" && audience !== "staff") {
    // Category name visible; children still deny @everyone.
    push(r.everyone, VIEW, SEND | SPEAK);
  } else if (audience === "public") {
    push(r.everyone, viewAllow | (readonly ? 0n : writeAllow), readonly ? writeDeny : 0n);
  } else {
    push(r.everyone, 0n, VIEW | SEND | CONNECT | SPEAK | READ);
  }

  if (audience === "initiate+" || audience === "public") {
    push(r.initiate, viewAllow | (readonly ? 0n : writeAllow), readonly ? writeDeny : 0n);
    push(r.shadow, viewAllow | (readonly ? 0n : writeAllow), readonly ? writeDeny : 0n);
  }

  if (audience === "granted") {
    // Phase 1: provision the channel; only staff (and bot) see it until grants exist.
    push(r.initiate, 0n, VIEW | SEND);
    push(r.shadow, 0n, VIEW | SEND);
  }

  for (const staffId of r.staff) {
    push(staffId, viewAllow | writeAllow | PERM.MANAGE_MESSAGES, 0n);
  }
  push(r.bot, viewAllow | writeAllow | PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS, 0n);
  return out;
}
