import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./crypto.ts";
import { scanAll, type ScanContext } from "./terms.ts";
import type { Blueprint, TemplateBlueprint } from "./types.ts";
import { BUNDLED_GUILD, BUNDLED_TEMPLATES } from "./bundled.ts";

export type ValidationIssue = {
  level: "error" | "warn";
  code: string;
  path: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

function loadJson<T>(cwd: string, ...parts: string[]): T {
  const rel = parts.join("/");
  try {
    return JSON.parse(readFileSync(join(cwd, ...parts), "utf8")) as T;
  } catch {
    if (rel === "blueprint/guild.json") return BUNDLED_GUILD as T;
    if (rel === "blueprint/templates.json") return BUNDLED_TEMPLATES as T;
    throw new Error(`missing blueprint file ${rel}`);
  }
}

export function loadBlueprint(cwd = process.cwd()): Blueprint {
  const guild = loadJson<Omit<Blueprint, "templates">>(cwd, "blueprint", "guild.json");
  const templatesFile = loadJson<{ templates: TemplateBlueprint[] }>(cwd, "blueprint", "templates.json");
  return { ...guild, templates: templatesFile.templates };
}

function displayMeta(obj: {
  display?: string;
  topic?: string;
  title?: string;
  body?: string;
  canon_ref?: string;
  approved?: string;
  neutral_fallback?: boolean;
  audience?: string;
  register?: string;
}): { playerVisible: boolean; tagged: boolean } {
  const playerVisible = obj.audience !== "staff" && obj.register !== "staff";
  const tagged = Boolean(obj.canon_ref || obj.approved || obj.neutral_fallback);
  return { playerVisible, tagged };
}

const IDENT_RE = /^[a-z0-9]+([.][a-z0-9]+)*$/;

export function validateBlueprint(bp: Blueprint, cwd = process.cwd()): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ level: "error", code, path, message });
  const warn = (code: string, path: string, message: string) => issues.push({ level: "warn", code, path, message });

  if (bp.identity.player_facing_name !== "MORTIS FIELD NETWORK") {
    err("identity", "identity.player_facing_name", "Player-facing identity must be MORTIS FIELD NETWORK");
  }
  if (bp.bot_permissions.never_administrator !== true) {
    err("perms", "bot_permissions", "Administrator is forbidden");
  }
  if (bp.bot_permissions.bits.includes("ADMINISTRATOR")) {
    err("perms", "bot_permissions.bits", "ADMINISTRATOR bit present");
  }

  const allKeys = new Set<string>();
  const claim = (key: string, path: string) => {
    if (allKeys.has(key)) err("ref", path, `blueprint key '${key}' already used`);
    allKeys.add(key);
  };

  const roleKeys = new Set<string>();
  for (const role of bp.roles) {
    claim(role.key, `roles.${role.key}`);
    if (roleKeys.has(role.key)) err("ref", `roles.${role.key}`, "duplicate role key");
    roleKeys.add(role.key);
    if (/\bR-[1-8]\b|Ashwright/i.test(role.display)) {
      err("restricted-role", `roles.${role.key}`, "Restricted identity/rank must never become a Discord role");
    }
  }
  if (![...roleKeys].includes("role.initiate")) err("ref", "roles", "missing role.initiate");

  const catKeys = new Set<string>();
  for (const cat of bp.categories) {
    claim(cat.key, `categories.${cat.key}`);
    catKeys.add(cat.key);
    checkString(cat.display, `categories.${cat.key}.display`, cat, cwd, err);
  }

  const chKeys = new Set<string>();
  for (const ch of bp.channels) {
    claim(ch.key, `channels.${ch.key}`);
    chKeys.add(ch.key);
    if (!catKeys.has(ch.category)) err("ref", `channels.${ch.key}`, `unknown category ${ch.category}`);
    checkString(ch.display, `channels.${ch.key}.display`, ch, cwd, err);
    if (ch.topic) checkString(ch.topic, `channels.${ch.key}.topic`, ch, cwd, err);
  }

  const tplKeys = new Set<string>();
  for (const tpl of bp.templates) {
    if (tplKeys.has(tpl.key)) err("ref", `templates.${tpl.key}`, "duplicate template key");
    tplKeys.add(tpl.key);
    if (tpl.channel_key && !chKeys.has(tpl.channel_key)) {
      err("ref", `templates.${tpl.key}`, `unknown channel ${tpl.channel_key}`);
    }
    checkString(tpl.title, `templates.${tpl.key}.title`, tpl, cwd, err);
    checkString(tpl.body, `templates.${tpl.key}.body`, tpl, cwd, err);
  }

  for (const ch of bp.channels) {
    if (ch.pin_template && !tplKeys.has(ch.pin_template)) {
      err("ref", `channels.${ch.key}.pin_template`, `unknown template ${ch.pin_template}`);
    }
  }

  if (bp.roles.filter((r) => r.tier === "player" && r.hoist).length > 2) {
    err("roles", "roles", "max ~2 hoisted player tiers");
  }

  return { ok: issues.every((i) => i.level !== "error"), issues };
}

function checkString(
  value: string,
  path: string,
  meta: { canon_ref?: string; approved?: string; neutral_fallback?: boolean; audience?: string; register?: string },
  cwd: string,
  err: (code: string, path: string, message: string) => void,
): void {
  const playerVisible = meta.audience !== "staff" && meta.register !== "staff";
  const ctx: ScanContext = {
    published_verbatim: Boolean(meta.canon_ref),
    approved_program_template: Boolean(meta.approved) && /forge/i.test(value),
  };
  const scan = scanAll(value, ctx, cwd);
  if (scan.blocked) {
    err("restricted-term", path, `blocked terms: ${scan.hits.map((h) => h.id).join(", ")}`);
  }
  if (scan.warnHold) {
    err("dev-vocab-hold", path, `developer vocabulary held: ${scan.hits.filter((h) => h.mode === "warn_hold").map((x) => x.id).join(", ")}`);
  }
  if (playerVisible) {
    const tagged = Boolean(meta.canon_ref || meta.approved || meta.neutral_fallback);
    if (!tagged) {
      err("approval", path, "player-visible string lacks canon_ref, approved:<date>, or neutral_fallback");
    }
  }
}

export async function hashBlueprint(bp: Blueprint): Promise<string> {
  return sha256Hex(JSON.stringify({
    id: bp.blueprint_id,
    version: bp.version,
    guild: bp.guild,
    roles: bp.roles,
    categories: bp.categories,
    channels: bp.channels,
    templates: bp.templates.map((t) => t.key),
  }));
}

export function channelByKey(bp: Blueprint, key: string) {
  return bp.channels.find((c) => c.key === key);
}

export function templateByKey(bp: Blueprint, key: string) {
  return bp.templates.find((t) => t.key === key);
}
