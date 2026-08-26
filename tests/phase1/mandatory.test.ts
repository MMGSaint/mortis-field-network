import { test } from "node:test";
import assert from "node:assert/strict";
import { runMandatoryTests, runSupplementaryTests } from "../../src/lib/mortis/test-suite.ts";

const cwd = process.cwd();

test("mandatory suite", async () => {
  const results = await runMandatoryTests(cwd);
  for (const r of results) {
    assert.equal(r.pass, true, `${r.id} ${r.name}: ${r.detail}`);
  }
});

test("supplementary suite", async () => {
  const results = await runSupplementaryTests(cwd);
  for (const r of results) {
    assert.equal(r.pass, true, `${r.id} ${r.name}: ${r.detail}`);
  }
});
