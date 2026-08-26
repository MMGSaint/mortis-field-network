import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

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
const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".sql", ".json", ".toml"]);

const ALLOW_FILES = new Set([
  "zero-canon.ts",
  "terms.ts",
  "test-suite.ts",
  "restricted.json",
  "developer.json",
  "blueprint.ts",
]);

function isGuardLine(line: string): boolean {
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
      if (SKIP_DIR.has(name) || skip.has(name) || ALLOW_FILES.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
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
