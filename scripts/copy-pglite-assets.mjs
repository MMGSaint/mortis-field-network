import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@electric-sql/pglite/dist");
const dest = join(root, ".vercel/output/functions/__server.func/_libs");
if (!existsSync(dest)) process.exit(0);
mkdirSync(dest, { recursive: true });
for (const file of ["pglite.data", "pglite.wasm", "initdb.wasm", "initdb.js"]) {
  const from = join(src, file);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(dest, file));
}
