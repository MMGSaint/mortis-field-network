#!/usr/bin/env node
/**
 * mortis-provision — owner-PC and autonomous-agent CLI.
 *
 * Privileged, key-adjacent: treat DISCORD_BOT_TOKEN like the release token.
 * Never writes secrets to files. Never prints the token — every Discord
 * error body is passed through `redactToken` before it reaches stdout.
 *
 * S89: `--live` attaches to the real scratch guild using the environment
 * token, so provisioning no longer requires the Provision web UI. The S70
 * guild allowlist still gates the attach: a non-allowlisted guild id fails
 * closed before hydrate.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const cwd = process.cwd();
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";
const LIVE = argv.includes("--live");

const mod = (p) => import(pathToFileURL(join(cwd, p)).href);

async function load() {
  const { MortisRuntime } = await mod("src/lib/mortis/runtime.ts");
  return MortisRuntime.load(cwd);
}

/** Attach live when --live is present; otherwise return a simulator runtime. */
async function runtimeFor(command) {
  if (!LIVE) return { rt: await load(), identity: null };
  const { attachLiveFromEnv } = await mod("src/lib/mortis/live-session.ts");
  const { runtime, identity } = await attachLiveFromEnv({ cwd });
  if (command !== "connect") {
    // Keep stderr, not stdout, so `--live plan | jq` still works.
    process.stderr.write(
      `[live] ${identity.guildName} (${identity.guildId}) as ${identity.botTag} — administrator=${identity.administrator}\n`,
    );
  }
  return { rt: runtime, identity };
}

function help() {
  console.log(`mortis-provision — MORTIS FIELD NETWORK

  Add --live to run against the real scratch guild using DISCORD_BOT_TOKEN
  from the environment (or a gitignored .env). Without --live everything
  runs against the in-process simulator.

  validate [--live]      schema + terms + approval tags
  plan [--live]          diff live vs blueprint (no mutate)
  apply [--live]         create/update in place; orphans reported
  apply --delete <id>    per-item confirm (history -> archive-lock)
  adopt <key> <id>       bind a live object to a blueprint key
  rollback               print prior hash / restore note
  invite-url             least-privilege bot invite URL (needs DISCORD_APP_ID)
  probe-app [appId]      public application RPC (no token). Default scratch app id.

  connect --live         attach and print bot/guild identity, then detach
  health [--live]        health report (holds / warns / missing)
  commands --live        register guild slash commands from the blueprint
  gateway --live [secs]  open the interaction gateway and report READY status
  notice --live <kind>   post an operational notice through dispatch.send
  verify --live          run the full live acceptance harness
`);
}

if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  help();
  process.exit(0);
}

let ctx;
try {
  ctx = await runtimeFor(cmd);
} catch (e) {
  const { redactToken } = await mod("src/lib/mortis/live-session.ts").catch(() => ({ redactToken: (s) => s }));
  console.error(redactToken(e instanceof Error ? e.message : String(e)));
  process.exit(2);
}
const rt = ctx.rt;
const { redactToken } = await mod("src/lib/mortis/live-session.ts");

/** Print JSON with any token occurrence scrubbed. */
const emit = (obj, code = 0) => {
  console.log(redactToken(JSON.stringify(obj, null, 2)));
  process.exit(code);
};

const shutdown = () => {
  try {
    rt.gateway?.stop();
  } catch {
    /* nothing attached */
  }
};

try {
  if (cmd === "validate") {
    const v = rt.validate();
    shutdown();
    emit(v, v.ok ? 0 : 1);
  }

  if (cmd === "connect") {
    const id = ctx.identity;
    shutdown();
    emit(
      id
        ? {
            connected: true,
            guildId: id.guildId,
            guildName: id.guildName,
            botTag: id.botTag,
            botId: id.botId,
            administrator: id.administrator,
            permissions: id.permissions,
            missingBits: id.missingBits,
            channelCount: id.channelCount,
            roleCount: id.roleCount,
          }
        : { connected: false, reason: "connect requires --live" },
      id ? 0 : 1,
    );
  }

  if (cmd === "plan") {
    const p = await rt.plan();
    shutdown();
    emit(p);
  }

  if (cmd === "apply") {
    const confirm = [];
    const idx = argv.indexOf("--delete");
    if (idx >= 0 && argv[idx + 1]) confirm.push(argv[idx + 1]);
    const r = await rt.apply({ confirmDelete: confirm });
    shutdown();
    emit({
      no_op: r.no_op,
      applied: r.applied,
      warnings: r.warnings,
      manual: r.manual,
      orphans: r.plan.orphans,
    });
  }

  if (cmd === "health") {
    const h = rt.health();
    shutdown();
    emit({
      ok: h.ok,
      holds: h.findings.filter((f) => f.severity === "hold"),
      warns: h.findings.filter((f) => f.severity === "warn"),
      missing_channels: h.missing_channels,
    });
  }

  if (cmd === "commands") {
    const r = await rt.registerCommands();
    shutdown();
    emit(r, r.ok ? 0 : 1);
  }

  if (cmd === "gateway") {
    const secs = Number(argv.find((a) => /^\d+$/.test(a)) ?? 12);
    const deadline = Date.now() + secs * 1000;
    let status = rt.gateway?.status() ?? { connected: false };
    while (Date.now() < deadline && !status.connected) {
      await new Promise((r) => setTimeout(r, 500));
      status = rt.gateway?.status() ?? { connected: false };
    }
    shutdown();
    emit(status, status.connected ? 0 : 1);
  }

  if (cmd === "notice") {
    const kind = argv[1] && !argv[1].startsWith("--") ? argv[1] : "maintenance";
    const fields = {};
    for (let i = 0; i < argv.length; i += 1) {
      const m = /^--field:([a-z_]+)$/.exec(argv[i]);
      if (m && argv[i + 1]) fields[m[1]] = argv[i + 1];
    }
    const r = await rt.notice(kind, fields);
    shutdown();
    emit(r, r.ok ? 0 : 1);
  }

  if (cmd === "adopt") {
    await rt.adopt(argv[1], argv[2]);
    shutdown();
    emit({ ok: true, key: argv[1], snowflake: argv[2] });
  }

  if (cmd === "rollback") {
    const { rollbackNote } = await mod("src/lib/mortis/provision.ts");
    shutdown();
    emit(rollbackNote(rt.store));
  }

  if (cmd === "invite-url") {
    const appId = process.env.DISCORD_APP_ID ?? "APP_ID";
    shutdown();
    console.log(rt.inviteUrl().replace("app_phase1", appId));
    process.exit(0);
  }

  if (cmd === "verify") {
    const { runLiveAcceptance } = await mod("src/lib/mortis/live-acceptance.ts");
    const report = await runLiveAcceptance(rt, { live: LIVE });
    shutdown();
    const failed = report.results.filter((r) => r.status === "FAIL");
    emit(report, failed.length ? 1 : 0);
  }

  if (cmd === "probe-app") {
    const { assessLiveReadiness } = await mod("src/lib/mortis/discord-public.ts");
    const { loadScratchState } = await mod("src/lib/mortis/discord-rest.ts");
    const appId = (argv[1] && !argv[1].startsWith("--") ? argv[1] : null) ?? process.env.DISCORD_APP_ID ?? "1540058003888410806";
    const guildId = process.env.DISCORD_SCRATCH_GUILD_ID ?? process.env.DISCORD_GUILD_ID ?? "1540022458126700674";
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
    shutdown();
    emit(
      { ...report, publicApp: { ...publicApp, publicKeyPresent } },
      report.blocker || !report.publicApp.reachable
        ? 2
        : report.publicApp.installMatchesRequired && report.publicApp.botPublic === false
          ? 0
          : 1,
    );
  }
} catch (e) {
  shutdown();
  console.error(redactToken(e instanceof Error ? (e.stack ?? e.message) : String(e)));
  process.exit(2);
}

shutdown();
help();
process.exit(1);
