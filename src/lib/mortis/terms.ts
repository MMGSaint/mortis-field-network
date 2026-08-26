import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_DEVELOPER, BUNDLED_RESTRICTED } from "./bundled.ts";

export type ScanMode = "block" | "warn_hold";
export type ScanContext = {
  /** Faithful re-presentation of a published Initiate document. */
  published_verbatim?: boolean;
  /** Owner-approved program-sense template (Project Forge / Forge as the training program). */
  approved_program_template?: boolean;
  /** OPERATIONAL system-notice copy (Forge → warn-and-hold). */
  operational_notice?: boolean;
};

export type TermEntry = {
  id: string;
  pattern: string;
  flags?: string;
  mode: ScanMode;
  allow_in?: Array<"published_verbatim" | "approved_program_template">;
  note?: string;
};

export type TermList = { version: number; id: string; terms: TermEntry[]; forge_rule?: unknown };

export type ScanHit = { id: string; mode: ScanMode; snippet: string };
export type ScanResult = {
  blocked: boolean;
  warnHold: boolean;
  hits: ScanHit[];
};

let restrictedCache: TermList | null = null;
let developerCache: TermList | null = null;

export function blueprintRoot(cwd = process.cwd()): string {
  return join(cwd, "blueprint");
}

export function loadTermList(kind: "restricted" | "developer", cwd = process.cwd()): TermList {
  if (kind === "restricted" && restrictedCache) return restrictedCache;
  if (kind === "developer" && developerCache) return developerCache;
  const file = join(blueprintRoot(cwd), "terms", `${kind}.json`);
  let list: TermList;
  try {
    list = JSON.parse(readFileSync(file, "utf8")) as TermList;
  } catch {
    list = kind === "restricted" ? BUNDLED_RESTRICTED : BUNDLED_DEVELOPER;
  }
  if (kind === "restricted") restrictedCache = list;
  else developerCache = list;
  return list;
}

/** Test helper: a term added to the list is seen by both gates immediately. */
export function resetTermCache(): void {
  restrictedCache = null;
  developerCache = null;
}

export function injectTermListForTest(kind: "restricted" | "developer", list: TermList): void {
  if (kind === "restricted") restrictedCache = list;
  else developerCache = list;
}

function matchAllowed(entry: TermEntry, ctx: ScanContext): boolean {
  if (!entry.allow_in || entry.allow_in.length === 0) return false;
  return entry.allow_in.some((flag) => Boolean(ctx[flag]));
}

function scanList(text: string, list: TermList, ctx: ScanContext): ScanResult {
  const hits: ScanHit[] = [];
  let blocked = false;
  let warnHold = false;
  for (const entry of list.terms) {
    const re = new RegExp(entry.pattern, entry.flags ?? "");
    const m = re.exec(text);
    if (!m) continue;
    if (matchAllowed(entry, ctx)) continue;
    const snippet = (m[0] ?? "").slice(0, 80);
    hits.push({ id: entry.id, mode: entry.mode, snippet });
    if (entry.mode === "block") blocked = true;
    if (entry.mode === "warn_hold") warnHold = true;
  }
  return { blocked, warnHold, hits };
}

const FORGE_PROGRAM = /\bproject\s+forge\b|\bforge\b/i;
const FORGE_DEV = /\bforge\s+(pipeline|build|sprint|ticket|deploy|worker|schema|branch|pr)\b/i;

function applyForgeRule(text: string, ctx: ScanContext, result: ScanResult): ScanResult {
  if (FORGE_DEV.test(text)) {
    result.hits.push({ id: "forge-dev-sense", mode: "block", snippet: "Forge (dev-sense)" });
    result.blocked = true;
    return result;
  }
  if (!FORGE_PROGRAM.test(text)) return result;
  if (ctx.published_verbatim || ctx.approved_program_template) return result;
  if (ctx.operational_notice) {
    result.hits.push({ id: "forge-operational-hold", mode: "warn_hold", snippet: "Forge (operational notice)" });
    result.warnHold = true;
    return result;
  }
  // Unknown sense on a player-facing string: warn-and-hold, never silent pass.
  result.hits.push({ id: "forge-unknown-sense", mode: "warn_hold", snippet: "Forge (unclassified sense)" });
  result.warnHold = true;
  return result;
}

export function scanRestricted(text: string, ctx: ScanContext = {}, cwd?: string): ScanResult {
  return scanList(text, loadTermList("restricted", cwd), ctx);
}

export function scanDeveloper(text: string, ctx: ScanContext = {}, cwd?: string): ScanResult {
  const base = scanList(text, loadTermList("developer", cwd), ctx);
  return applyForgeRule(text, ctx, base);
}

export function scanAll(text: string, ctx: ScanContext = {}, cwd?: string): ScanResult {
  const a = scanRestricted(text, ctx, cwd);
  const b = scanDeveloper(text, ctx, cwd);
  return {
    blocked: a.blocked || b.blocked,
    warnHold: a.warnHold || b.warnHold,
    hits: [...a.hits, ...b.hits],
  };
}

export function scanFields(fields: Record<string, string>, ctx: ScanContext = {}, cwd?: string): ScanResult {
  const merged: ScanResult = { blocked: false, warnHold: false, hits: [] };
  for (const [key, value] of Object.entries(fields)) {
    const r = scanAll(value, ctx, cwd);
    for (const hit of r.hits) merged.hits.push({ ...hit, snippet: `${key}:${hit.snippet}` });
    if (r.blocked) merged.blocked = true;
    if (r.warnHold) merged.warnHold = true;
  }
  return merged;
}
