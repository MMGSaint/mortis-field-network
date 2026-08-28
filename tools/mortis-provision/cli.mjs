#!/usr/bin/env node
/**
 * mortis-provision — owner-PC CLI.
 * validate | plan | apply | adopt | rollback
 * Privileged, key-adjacent: treat DISCORD_BOT_TOKEN like the release token.
 * Never writes secrets to files.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const cwd = process.cwd();
const cmd = process.argv[2] ?? "help";

async function load() {
  const { MortisRuntime } = await import(pathToFileURL(join(cwd, "src/lib/mortis/runtime.ts")).href);
  return MortisRuntime.load(cwd);
}

function help() {
  console.log(`mortis-provision — MORTIS FIELD NETWORK
  validate              schema + terms + approval tags
  plan                  diff live vs blueprint (no mutate)
  apply                 create/update in place; orphans reported
  apply --delete <id>   per-item confirm (history → archive-lock)
  adopt <key> <id>      bind a live object to a blueprint key
  rollback              print prior hash / restore note
  invite-url            least-privilege bot invite URL (needs DISCORD_APP_ID)
  probe-app [appId]     public application RPC (no token). Default scratch app id.
`);
}

const rt = cmd === "help" || cmd === "--help" ? null : await load();

if (!rt) {
  help();
  process.exit(0);
}

if (cmd === "validate") {
  const v = rt.validate();
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.ok ? 0 : 1);
}

if (cmd === "plan") {
  const p = await rt.plan();
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}

if (cmd === "apply") {
  const confirm = [];
  const idx = process.argv.indexOf("--delete");
  if (idx >= 0) confirm.push(process.argv[idx + 1]);
  const r = await rt.apply({ confirmDelete: confirm });
  console.log(JSON.stringify({ no_op: r.no_op, applied: r.applied, warnings: r.warnings, manual: r.manual, orphans: r.plan.orphans }, null, 2));
  process.exit(0);
}

if (cmd === "adopt") {
  await rt.adopt(process.argv[3], process.argv[4]);
  console.log(JSON.stringify({ ok: true, key: process.argv[3], snowflake: process.argv[4] }));
  process.exit(0);
}

if (cmd === "rollback") {
  const { rollbackNote } = await import(pathToFileURL(join(cwd, "src/lib/mortis/provision.ts")).href);
  console.log(JSON.stringify(rollbackNote(rt.store), null, 2));
  process.exit(0);
}

if (cmd === "invite-url") {
  const appId = process.env.DISCORD_APP_ID ?? "APP_ID";
  console.log(rt.inviteUrl().replace("app_phase1", appId));
  process.exit(0);
}

if (cmd === "probe-app") {
  const { assessLiveReadiness } = await import(pathToFileURL(join(cwd, "src/lib/mortis/discord-public.ts")).href);
  const { loadScratchState } = await import(pathToFileURL(join(cwd, "src/lib/mortis/discord-rest.ts")).href);
  const appId = process.argv[3] ?? process.env.DISCORD_APP_ID ?? "1540058003888410806";
  const guildId = process.env.DISCORD_GUILD_ID ?? "1540022458126700674";
  const report = await assessLiveReadiness({
    bp: rt.bp,
    appId,
    guildId,
    tokenInMemory: rt.hasLiveToken(),
    liveConnected: rt.guild.live === true,
    scratchConfirmed: rt.scratchConfirmed,
    saved: loadScratchState(guildId),
    network: true,
  });
  const publicKeyPresent = Boolean(report.publicApp.publicKey);
  const { publicKey: _omit, ...publicApp } = report.publicApp;
  console.log(JSON.stringify({ ...report, publicApp: { ...publicApp, publicKeyPresent } }, null, 2));
  process.exit(report.blocker || !report.publicApp.reachable ? 2 : report.publicApp.installMatchesRequired && report.publicApp.botPublic === false ? 0 : 1);
}

help();
process.exit(1);
