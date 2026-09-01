import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

/** Structured canon identifiers and dataset names that must not appear as data. */
const DATASET = [
  /02_ATOMIC_CANON_FACTS/,
  /sealed_payloads/,
  /reveal_schedules?/,
  /canon_facts/,
  /dossiers_json/,
];

const IDENT = [/\bFACT-[A-Z0-9-]+/, /\bCON-[A-Z0-9-]+/, /\bTRG-[A-Z0-9-]+/, /\bMINE-[A-Z0-9-]+/];

const SKIP_DIR = new Set(["node_modules", ".git", "dist", "artifacts", "attachments", "screenshots"]);
/**
 * Prose extensions are included deliberately: canon arrives as prose far more
 * often than as code, so a .md or .txt dropped into the envoy tree is exactly
 * the case this inspection exists to catch. Scanning only code extensions left
 * the most likely ingress path unscanned.
 */
const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".sql",
  ".json",
  ".toml",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".csv",
]);

/**
 * Files that legitimately contain canon identifiers because they are the
 * guards themselves (term lists, this inspector, the test suite).
 *
 * These are matched against the path RELATIVE TO THE SCAN ROOT, not against
 * a bare basename. Basename matching meant any file anywhere in the tree
 * called `terms.ts` or `test-suite.ts` was silently exempt — including one an
 * author could add inside a subdirectory purely to dodge inspection.
 */
const ALLOW_RELPATHS = new Set([
  "zero-canon.ts",
  "terms.ts",
  "test-suite.ts",
  "restricted.json",
  "developer.json",
  "blueprint.ts",
]);

/**
 * A line is treated as a guard (a rule ABOUT canon rather than canon itself)
 * only when the guard word appears in a comment or in a regex/term-list
 * definition.
 *
 * Previously any line containing "never", "block", "do not" etc. ANYWHERE —
 * including inside a string literal — was skipped outright, so
 * `const FACT_A1 = "…"; // do not remove` escaped inspection entirely.
 */
function isGuardLine(line: string): boolean {
  const trimmed = line.trim();
  const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("#");
  const isPatternDef = /\/\^?.*\\b.*\//.test(trimmed) || /^["']?[A-Za-z_-]+["']?\s*:\s*\[/.test(trimmed);
  if (!isComment && !isPatternDef) return false;
  return /restricted|never|block|deny|must not|must be absent|forbidden|do not/i.test(line);
}

export function inspectZeroCanon(root: string, extraSkip: string[] = []): {
  ok: boolean;
  hits: Array<{ file: string; line: number; match: string }>;
} {
  const hits: Array<{ file: string; line: number; match: string }> = [];
  const skip = new Set(extraSkip);

  function walk(dir: string): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIR.has(name) || skip.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      // Exemption is by path relative to the scan root, so a file cannot dodge
      // inspection merely by reusing an allowed basename in a subdirectory.
      const rel = relative(root, p);
      if (ALLOW_RELPATHS.has(rel)) continue;
      if (!CODE_EXT.has(extname(name)) && name !== "schema.sql") continue;
      const text = readFileSync(p, "utf8");
      const lines = text.split(/\n/);
      lines.forEach((line, i) => {
        if (isGuardLine(line)) return;
        for (const re of [...DATASET, ...IDENT]) {
          const m = re.exec(line);
          if (m) hits.push({ file: p, line: i + 1, match: m[0] });
        }
      });
    }
  }
  walk(root);
  return { ok: hits.length === 0, hits };
}
