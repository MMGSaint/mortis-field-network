import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MortisRuntime } from "./runtime.ts";
import { inspectZeroCanon } from "./zero-canon.ts";
import { generateEd25519HexPair, signEd25519Hex, canonicalStringify, verifyReleaseExcerpt } from "./crypto.ts";
import { loadTermList, resetTermCache, injectTermListForTest, scanRestricted, scanDeveloper } from "./terms.ts";
import { createEvent, markEligible, enact } from "./events.ts";
import { createTicket, claimTicket, closeTicket, staffCanViewTicket, reopenTicket } from "./tickets.ts";
import { PERM, botInviteUrl, botPermissionInteger, BOT_PERMISSION_INTEGER, permissionMissing, permissionExcess } from "./permissions.ts";
import { runFirstPlayerWalkthrough } from "./walkthrough.ts";
import { assessHealth } from "./health.ts";
import { commandPayloads } from "./commands.ts";
import { enactLockdown, liftLockdown } from "./envoy.ts";
import { interactionOpensModal } from "./discord-gateway.ts";

export type TestResult = { id: string; name: string; pass: boolean; detail: string };

async function fresh(cwd: string): Promise<MortisRuntime> {
  const rt = MortisRuntime.load(cwd);
  await rt.bootstrapKeys();
  rt.seedOwner("owner_1", "owner");
  rt.seedOperations("ops_1", "ops");
  return rt;
}

export async function runMandatoryTests(cwd = process.cwd()): Promise<TestResult[]> {
  const out: TestResult[] = [];
  const push = (id: string, name: string, pass: boolean, detail: string) => out.push({ id, name, pass, detail });

  // TEST 1 — blank guild provisioning
  try {
    const rt = await fresh(cwd);
    const v = rt.validate();
    if (!v.ok) throw new Error(v.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    const result = await rt.apply();
    const keys = rt.bp.channels.map((c) => c.key);
    const missing = keys.filter((k) => !rt.store.blueprintState.get(k));
    const catMissing = rt.bp.categories.filter((c) => !rt.store.blueprintState.get(c.key));
    const roleMissing = rt.bp.roles.filter((r) => !rt.store.blueprintState.get(r.key));
    const pass = missing.length === 0 && catMissing.length === 0 && roleMissing.length === 0 && rt.guild.name === "MORTIS FIELD NETWORK";
    push("T1", "Blank guild provisioning", pass, pass ? `created ${result.applied} objects, ${rt.guild.channels.length} live channels` : `missing ch=${missing} cat=${catMissing.map((c) => c.key)} roles=${roleMissing.map((r) => r.key)}`);
  } catch (e) {
    push("T1", "Blank guild provisioning", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 2 — idempotency
  try {
    const rt = await fresh(cwd);
    const a = await rt.apply();
    const ch = rt.guild.channels.length;
    const roles = rt.guild.roles.length;
    const b = await rt.apply();
    const pass = b.no_op === true && rt.guild.channels.length === ch && rt.guild.roles.length === roles && a.applied > 0;
    push("T2", "Idempotent apply", pass, `first applied=${a.applied} second no_op=${b.no_op} channels ${ch}->${rt.guild.channels.length}`);
  } catch (e) {
    push("T2", "Idempotent apply", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 3 — orphan / RP history protection
  try {
    const rt = await fresh(cwd);
    const orphan = await rt.guild.createChannel({ name: "old-commons", type: 0 });
    await rt.guild.postMessage(orphan.id, "historical RP post", "player_x");
    await rt.apply();
    const still = rt.guild.channelById(orphan.id);
    const deleted = !still;
    const locked = await rt.apply({ confirmDelete: [orphan.id] });
    const after = rt.guild.channelById(orphan.id);
    const pass = !deleted && Boolean(still) && (still?.messages.length ?? 0) === 1 && Boolean(after) && after!.archived === true && after!.messages.length === 1;
    push("T3", "Orphan / RP-history protection", pass, pass ? "history preserved; confirm path archive-locked, not deleted" : `deleted=${deleted} archived=${after?.archived} msgs=${after?.messages.length} lockedOps=${locked.applied}`);
  } catch (e) {
    push("T3", "Orphan / RP-history protection", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 4 — permission isolation
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const outsider = rt.guild.seedMember("outsider_1", "guest", []);
    const initiateId = rt.store.blueprintState.get("role.initiate")!;
    const player = rt.guild.seedMember("init_1", "initiate", [initiateId]);
    const staffRole = rt.store.blueprintState.get("role.operations")!;
    const staff = rt.guild.seedMember("ops_1", "ops", [staffRole]);
    const staffOps = rt.store.blueprintState.get("staff.ops")!;
    const arrival = rt.store.blueprintState.get("arrival.notice")!;
    const network = rt.store.blueprintState.get("network.traffic")!;
    const incidents = rt.store.blueprintState.get("ops.incidents")!;
    const pass =
      rt.guild.canView(outsider.id, arrival) &&
      !rt.guild.canView(outsider.id, network) &&
      !rt.guild.canView(outsider.id, staffOps) &&
      rt.guild.canView(player.id, network) &&
      !rt.guild.canView(player.id, staffOps) &&
      !rt.guild.canView(player.id, incidents) &&
      rt.guild.canView(staff.id, staffOps) &&
      !rt.guild.canSend(outsider.id, arrival);
    push("T4", "Permission isolation", pass, pass ? "public / initiate+ / granted / staff hold" : "audience matrix failed");
  } catch (e) {
    push("T4", "Permission isolation", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 5 — restricted visibility
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const blocked = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "Ashwright briefing complete" },
    });
    const dev = await rt.dispatch({
      channel_key: "network.status",
      template_key: "tpl.ops.maintenance",
      fields: { window: "during Phase 1 sprint migration" },
    });
    const clone = structuredClone(rt.bp);
    clone.channels[0] = { ...clone.channels[0], display: "ASHWRIGHT LOUNGE", canon_ref: undefined, approved: undefined, neutral_fallback: undefined };
    const { validateBlueprint } = await import("./blueprint.ts");
    const v = validateBlueprint(clone, cwd);
    const pass = blocked.ok === false && blocked.step === 4 && dev.ok === false && (dev.step === 5) && v.ok === false;
    push("T5", "Restricted visibility rejection", pass, `dispatch restricted step=${blocked.step} dev step=${dev.step} validate ok=${v.ok}`);
  } catch (e) {
    push("T5", "Restricted visibility rejection", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 6 — forged signature rejection
  try {
    const rt = await fresh(cwd);
    await rt.bootstrapKeys();
    const body = JSON.stringify({ type: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    const forged = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": ts },
        body,
      }),
    );
    const signed = await rt.signDiscordBody(body, ts);
    const good = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body,
      }),
    );
    const pair = await generateEd25519HexPair();
    const excerpt = { version: "PD-TEST", presentation_name: "x", published_at: "t", body: "hi" };
    const realSig = await signEd25519Hex(pair.privateKey, new TextEncoder().encode(canonicalStringify(excerpt)));
    const bad = await verifyReleaseExcerpt({ publicKeyHex: pair.publicKeyHex, payload: excerpt, signatureHex: "11".repeat(64) });
    const okv = await verifyReleaseExcerpt({ publicKeyHex: pair.publicKeyHex, payload: excerpt, signatureHex: realSig });
    const pass = forged.status === 401 && good.status === 200 && bad === false && okv === true;
    push("T6", "Forged signature rejection", pass, `discord forged=${forged.status} ping=${good.status} excerpt bad=${bad} good=${okv}`);
  } catch (e) {
    push("T6", "Forged signature rejection", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 7 — dispatch bypass + role-imposter
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const src =
      readFileSync(join(cwd, "src/lib/mortis/dispatch.ts"), "utf8") +
      readFileSync(join(cwd, "src/lib/mortis/envoy.ts"), "utf8");
    const ticketsSrc = readFileSync(join(cwd, "src/lib/mortis/tickets.ts"), "utf8");
    const deliveries = (src.match(/discordDeliver\(/g) ?? []).length;
    const fromSend = src.includes("ONLY delivery primitive") || src.includes("Called exclusively from dispatchSend");
    const ticketGuard = ticketsSrc.includes("isBlueprintPlayerChannel") && !ticketsSrc.includes("discordDeliver(");
    rt.guild.seedMember("imposter_1", "imposter", [rt.store.blueprintState.get("role.operations")!]);
    const asImposter = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "complete" },
      caller: { type: "staff", snowflake: "imposter_1" },
    });
    const asOwner = await rt.dispatch({
      channel_key: "network.status",
      template_key: "tpl.ops.deployment",
      fields: { status: "complete" },
      caller: { type: "staff", snowflake: "owner_1" },
    });
    const generic = asImposter.reason === "unauthorized";
    const pass = deliveries >= 1 && fromSend && ticketGuard && asImposter.ok === false && asImposter.step === 1 && generic && asOwner.ok === true;
    push("T7", "Dispatch bypass / role-imposter rejection", pass, `deliveries=${deliveries} guard=${ticketGuard} imposter step=${asImposter.step} owner ok=${asOwner.ok}`);
  } catch (e) {
    push("T7", "Dispatch bypass / role-imposter rejection", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 8 — zero canon reachable
  try {
    const inspected = inspectZeroCanon(join(cwd, "src/lib/mortis"));
    const worker = inspectZeroCanon(join(cwd, "workers/mortis-envoy"));
    const schema = readFileSync(join(cwd, "workers/mortis-envoy/schema.sql"), "utf8");
    const schemaHit = /CREATE TABLE IF NOT EXISTS (canon|facts|dossiers|sealed_payloads)/i.test(schema);
    const pass = inspected.ok && worker.ok && !schemaHit;
    push("T8", "Zero authoritative canon reachable", pass, pass ? "envoy modules + worker + schema clean" : JSON.stringify([...inspected.hits, ...worker.hits].slice(0, 8)));
  } catch (e) {
    push("T8", "Zero authoritative canon reachable", false, e instanceof Error ? e.message : String(e));
  }

  // TEST 9 — audit coverage
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    await rt.intake({ snowflake: "p1", handle: "player", callsign: "Cinder" });
    const t = await createTicket({ opener: "p1", handle: "player", category: "general", body: "help" }, rt);
    await claimTicket(rt.store, t.id, "owner_1");
    await closeTicket(rt.store, rt.guild, t.id, "owner_1");
    await rt.dispatch({
      channel_key: "network.status",
      template_key: "tpl.ops.maintenance",
      fields: { window: "01:00–03:00" },
      caller: { type: "staff", snowflake: "owner_1" },
    });
    const actions = new Set(rt.store.audit.map((a) => a.action));
    const need = ["provision.apply", "intake.complete", "ticket.create", "ticket.claim", "ticket.close", "dispatch.send"];
    const missing = need.filter((n) => !actions.has(n));
    const dispatchRow = rt.store.audit.find((a) => a.action === "dispatch.send" && a.outcome === "ok");
    const pass = missing.length === 0 && Boolean(dispatchRow?.mirrored);
    push("T9", "Audit logging", pass, pass ? `rows=${rt.store.audit.length} mirrored dispatch` : `missing=${missing.join(",")} mirrored=${dispatchRow?.mirrored}`);
  } catch (e) {
    push("T9", "Audit logging", false, e instanceof Error ? e.message : String(e));
  }

  return out;
}

export async function runSupplementaryTests(cwd = process.cwd()): Promise<TestResult[]> {
  const out: TestResult[] = [];
  const push = (id: string, name: string, pass: boolean, detail: string) => out.push({ id, name, pass, detail });

  try {
    const rt = await (async () => {
      const r = MortisRuntime.load(cwd);
      await r.bootstrapKeys();
      r.seedOwner();
      await r.apply();
      return r;
    })();
    const a = await rt.intake({ snowflake: "d1", handle: "dbl", callsign: "Two" });
    const b = await rt.intake({ snowflake: "d1", handle: "dbl", callsign: "Two" });
    push("S1", "Intake idempotency under double complete", a.already === false && b.already === true, `first already=${a.already} second=${b.already}`);
  } catch (e) {
    push("S1", "Intake idempotency under double complete", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    await rt.apply();
    const r = await rt.dispatch({
      channel_key: "network.traffic",
      template_key: "tpl.ops.maintenance",
      fields: { window: "now" },
    });
    push("S2", "Register / channel-class mismatch refusal", r.ok === false && r.step === 2, `step=${r.step} reason=${r.reason}`);
  } catch (e) {
    push("S2", "Register / channel-class mismatch refusal", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    await rt.apply();
    const ev = createEvent(rt.store, { class: "NARRATIVE", template_ref: "tpl.ops.deployment", audience: "initiate+" }, "owner_1");
    markEligible(rt.store, ev.id, "owner_1");
    const refused = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "story" },
      event_id: ev.id,
      caller: { type: "owner-cli" },
    });
    // Force class NARRATIVE onto the template for this probe
    const tpl = rt.bp.templates.find((t) => t.key === "tpl.ops.deployment")!;
    const prev = tpl.class;
    tpl.class = "NARRATIVE";
    const refused2 = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "story" },
      event_id: ev.id,
    });
    enact(rt.store, ev.id, "owner_1");
    const allowed = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "enacted-ok" },
      event_id: ev.id,
    });
    tpl.class = prev;
    push("S3", "NARRATIVE without ENACTED refusal", refused2.ok === false && refused2.step === 2 && allowed.ok === true, `pre=${refused2.reason} post ok=${allowed.ok} (unmarked tpl class probe ${refused.ok})`);
  } catch (e) {
    push("S3", "NARRATIVE without ENACTED refusal", false, e instanceof Error ? e.message : String(e));
  }

  try {
    resetTermCache();
    const list = loadTermList("restricted", cwd);
    const planted = { ...list, terms: [...list.terms, { id: "planted-term-xyzzy", pattern: "xyzzynotreal", flags: "i", mode: "block" as const }] };
    injectTermListForTest("restricted", planted);
    const hit = scanRestricted("please xyzzynotreal now", {}, cwd);
    resetTermCache();
    const both = hit.blocked && hit.hits.some((h) => h.id === "planted-term-xyzzy");
    push("S4", "Term-list unity", both, both ? "added term enforced by scanner immediately" : JSON.stringify(hit));
  } catch (e) {
    push("S4", "Term-list unity", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    const extras = rt.excessWarning();
    const admin = (PERM.ADMINISTRATOR & 8n) === 8n;
    push("S5", "Bot permission set equals blueprint", extras.length === 0 && admin, `extras=${extras.join(",") || "none"}`);
  } catch (e) {
    push("S5", "Bot permission set equals blueprint", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    rt.guild.forced429 = 2;
    await rt.apply();
    push("S6", "Rate-limit backoff under burst", rt.guild.backoffSleeps.length >= 2, `sleeps=${rt.guild.backoffSleeps.length}`);
  } catch (e) {
    push("S6", "Rate-limit backoff under burst", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    rt.seedOperations();
    await rt.apply();
    const t = await createTicket({ opener: "p2", handle: "p", category: "report", body: "mod" }, rt);
    rt.store.staff.set("mod_1", { snowflake: "mod_1", handle: "mod", capabilities: ["ticket.claim"] });
    const canMod = staffCanViewTicket(rt.store, "mod_1", t);
    const canOps = staffCanViewTicket(rt.store, "ops_1", t);
    push("S7", "Report tickets OWNER/OPERATIONS only", canMod === false && canOps === true, `mod=${canMod} ops=${canOps}`);
  } catch (e) {
    push("S7", "Report tickets OWNER/OPERATIONS only", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    await rt.apply();
    const missingKey = "network.dispatches";
    const missingId = rt.store.blueprintState.get(missingKey)!;
    rt.store.blueprintState.delete(missingKey);
    rt.store.reverseState.delete(missingId);
    rt.guild.channels = rt.guild.channels.filter((c) => c.id !== missingId);
    const notice = rt.bp.channels.find((c) => c.key === "arrival.notice")!;
    notice.topic = "forced-update-to-trigger-patch";
    const orig = rt.guild.patchChannel.bind(rt.guild);
    rt.guild.patchChannel = async (id, body) => {
      const err = Object.assign(new Error(`discord PATCH /channels/${id} 403`), { status: 403 });
      throw err;
    };
    const result = await rt.apply();
    rt.guild.patchChannel = orig;
    notice.topic = notice.topic; // keep mutated; apply continued
    const rebound = rt.store.blueprintState.get(missingKey);
    const pass = Boolean(rebound) && result.warnings.some((w) => w.includes("403"));
    push("S8", "Channel PATCH 403 does not abort remaining creates", pass, pass ? `rebound ${missingKey}; warnings=${result.warnings.length}` : `rebound=${rebound} warnings=${result.warnings.join(";")}`);
  } catch (e) {
    push("S8", "Channel PATCH 403 does not abort remaining creates", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    const orig = rt.guild.patchGuild.bind(rt.guild);
    rt.guild.patchGuild = async () => {
      throw Object.assign(new Error("discord PATCH /guilds/g_0001 400"), { status: 400 });
    };
    const result = await rt.apply();
    rt.guild.patchGuild = orig;
    const missing = rt.bp.channels.filter((c) => !rt.store.blueprintState.get(c.key));
    const pass = missing.length === 0 && result.warnings.some((w) => w.includes("400"));
    push("S9", "Guild PATCH 400 does not abort remaining creates", pass, pass ? `channels bound; warnings=${result.warnings.length}` : `missing=${missing.map((c) => c.key).join(",")} warnings=${result.warnings.join(";")}`);
  } catch (e) {
    push("S9", "Guild PATCH 400 does not abort remaining creates", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    const w = await runFirstPlayerWalkthrough(rt);
    push("S10", "First-time player walkthrough", w.pass, w.steps.filter((s) => !s.pass).map((s) => `${s.id}:${s.detail}`).join("; ") || "all steps pass");
  } catch (e) {
    push("S10", "First-time player walkthrough", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    await rt.apply();
    const t = await createTicket({ opener: "p3", handle: "p", category: "general", body: "one" }, rt);
    await closeTicket(rt.store, rt.guild, t.id, "owner_1", rt.bp);
    const re = await reopenTicket(rt.store, rt.guild, t.id, "owner_1", rt.bp);
    const t2 = await createTicket({ opener: "p3", handle: "p", category: "general", body: "two" }, rt);
    let limited = false;
    try {
      await createTicket({ opener: "p3", handle: "p", category: "accessibility", body: "three" }, rt);
    } catch (err) {
      limited = err instanceof Error && err.message === "rate_limited";
    }
    push("S11", "Ticket reopen and rate limit", re.status === "open" && t2.status === "open" && limited, `reopen=${re.status} limited=${limited}`);
  } catch (e) {
    push("S11", "Ticket reopen and rate limit", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    await rt.apply();
    const before = (rt.guild.channelById(rt.store.blueprintState.get("network.dispatches")!)?.messages.length ?? 0);
    await createTicket({ opener: "p4", handle: "p", category: "general", body: "private help request unique-xyz" }, rt);
    const after = rt.guild.channelById(rt.store.blueprintState.get("network.dispatches")!)?.messages ?? [];
    const leaked = after.some((m) => m.content.includes("unique-xyz"));
    push("S12", "Ticket body never reaches player-facing dispatch channels", after.length === before && !leaked, leaked ? "leak" : "private only");
  } catch (e) {
    push("S12", "Ticket body never reaches player-facing dispatch channels", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = MortisRuntime.load(cwd);
    await rt.bootstrapKeys();
    rt.seedOwner();
    await rt.apply();
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    const key = "arrival.guide";
    const id = rt.store.blueprintState.get(key)!;
    rt.store.blueprintState.delete(key);
    rt.store.reverseState.delete(id);
    const h2 = assessHealth(rt.bp, rt.store, rt.guild);
    const { enactLockdown } = await import("./envoy.ts");
    await enactLockdown(rt.ctx(), "owner_1");
    let locked = false;
    try {
      await rt.intake({ snowflake: "late", handle: "late" });
    } catch (err) {
      locked = err instanceof Error && err.message === "lockdown";
    }
    const faq = rt.bp.templates.find((t) => t.key === "tpl.network.reference")!;
    const dirty = /Season 3|Ashwright|sprint/i.test(`${faq.title}\n${faq.body}`);
    push(
      "S13",
      "Health missing-channel + lockdown + FAQ cleanliness",
      h.ok && !h2.ok && h2.missing_channels.includes("arrival.guide") && locked && !dirty,
      `healthy=${h.ok} after=${h2.ok} lockdown=${locked} dirty=${dirty}`,
    );
  } catch (e) {
    push("S13", "Health missing-channel + lockdown + FAQ cleanliness", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    const body = JSON.stringify({ type: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    const signed = await rt.signDiscordBody(body, ts);
    const ping = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body,
      }),
    );
    const kill = await rt.fetch(
      new Request("https://envoy.local/cli/kill", {
        method: "POST",
        headers: { authorization: "Bearer cli-secret-not-for-files" },
      }),
    );
    const after = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body,
      }),
    );
    const health = await rt.fetch(new Request("https://envoy.local/v1/health"));
    push(
      "S14",
      "Kill switch 404s interactions",
      ping.status === 200 && kill.status === 200 && after.status === 404 && health.status === 404 && rt.killed,
      `ping=${ping.status} kill=${kill.status} after=${after.status} health=${health.status}`,
    );
  } catch (e) {
    push("S14", "Kill switch 404s interactions", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const t = await createTicket({ opener: "p5", handle: "p", category: "general", body: "claim-fail" }, rt);
    const orig = rt.guild.postMessage.bind(rt.guild);
    rt.guild.postMessage = async () => {
      throw Object.assign(new Error("discord POST messages 403"), { status: 403, body: '{"code":50001}' });
    };
    let failed = false;
    try {
      await claimTicket(rt.store, t.id, "owner_1", rt.guild, rt.bp);
    } catch {
      failed = true;
    }
    rt.guild.postMessage = orig;
    const still = rt.store.tickets.get(t.id);
    push("S15", "Claim Discord 403 does not mutate ticket", failed && still?.status === "open" && still.assignee === null, `status=${still?.status} failed=${failed}`);
  } catch (e) {
    push("S15", "Claim Discord 403 does not mutate ticket", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    const ts = String(Math.floor(Date.now() / 1000));
    const badJson = "{not-json";
    const signedBad = await rt.signDiscordBody(badJson, ts);
    const invalid = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signedBad.signature, "x-signature-timestamp": ts },
        body: badJson,
      }),
    );
    const odd = JSON.stringify({ type: 99, data: { custom_id: "nope" } });
    const signedOdd = await rt.signDiscordBody(odd, ts);
    const ack = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signedOdd.signature, "x-signature-timestamp": ts },
        body: odd,
      }),
    );
    push("S16", "Malformed interaction fail-closed / unknown type ACK", invalid.status === 401 && ack.status === 200, `invalid=${invalid.status} ack=${ack.status}`);
  } catch (e) {
    push("S16", "Malformed interaction fail-closed / unknown type ACK", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const body = JSON.stringify({ type: 2, data: { name: "orient" }, user: { id: "walk_guest", username: "newcomer" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const signed = await rt.signDiscordBody(body, ts);
    const res = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body,
      }),
    );
    const json = (await res.json()) as { data?: { content?: string; flags?: number } };
    const content = json.data?.content ?? "";
    push(
      "S17",
      "Slash /orient returns player-safe guide",
      res.status === 200 && content.includes("HOW TO BEGIN") && json.data?.flags === 64 && !/Season 3|Ashwright|sprint/i.test(content),
      `status=${res.status} flags=${json.data?.flags}`,
    );
  } catch (e) {
    push("S17", "Slash /orient returns player-safe guide", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const results = await Promise.allSettled([
      createTicket({ opener: "race", handle: "r", category: "general", body: "a" }, rt),
      createTicket({ opener: "race", handle: "r", category: "general", body: "b" }, rt),
      createTicket({ opener: "race", handle: "r", category: "accessibility", body: "c" }, rt),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const limited = results.filter((r) => r.status === "rejected" && r.reason instanceof Error && r.reason.message === "rate_limited").length;
    push("S18", "Concurrent ticket create rate-limits at 2", ok === 2 && limited === 1, `ok=${ok} limited=${limited}`);
  } catch (e) {
    push("S18", "Concurrent ticket create rate-limits at 2", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const bindings = [...rt.store.blueprintState.entries()];
    const hash = rt.store.lastAppliedHash;
    const rt2 = await fresh(cwd);
    rt2.guild.channels = rt.guild.channels;
    rt2.guild.roles = rt.guild.roles;
    rt2.guild.name = rt.guild.name;
    for (const [k, v] of bindings) rt2.store.bind(k, v);
    rt2.store.lastAppliedHash = hash;
    const p = await rt2.plan();
    push(
      "S19",
      "Process restart restores bindings without token",
      rt2.guild.live === false && p.creates === 0 && p.updates === 0 && Boolean(hash),
      `creates=${p.creates} updates=${p.updates} live=${rt2.guild.live}`,
    );
  } catch (e) {
    push("S19", "Process restart restores bindings without token", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    rt.guild.failQueue.push(
      { status: 403, pathIncludes: "/channels" },
      { status: 403, pathIncludes: "/channels" },
    );
    const t = await createTicket({ opener: "p403", handle: "p", category: "general", body: "retry-me" }, rt);
    push("S20", "Ticket create retries 403 then succeeds", t.status === "open" && Boolean(t.channel_snowflake), `status=${t.status} ch=${t.channel_snowflake}`);
  } catch (e) {
    push("S20", "Ticket create retries 403 then succeeds", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const names = (rt.guild.slashCommands as Array<{ name: string }>).map((c) => c.name).sort();
    push(
      "S21",
      "Slash commands registered on apply",
      names.includes("orient") && names.includes("ticket") && names.includes("post") && names.includes("lockdown"),
      `commands=${names.join(",")}`,
    );
  } catch (e) {
    push("S21", "Slash commands registered on apply", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const t = await createTicket({ opener: "p6", handle: "p", category: "general", body: "Ashwright briefing please" }, rt);
    const ticketCh = rt.guild.channelById(t.channel_snowflake);
    const leakedPlayer = ["network.dispatches", "network.status", "arrival.notice"].some((key) => {
      const id = rt.store.blueprintState.get(key);
      const ch = id ? rt.guild.channelById(id) : undefined;
      return (ch?.messages ?? []).some((m) => /Ashwright/i.test(m.content));
    });
    const held = (ticketCh?.messages ?? []).some((m) => m.content.includes("held for staff"));
    const rawOnTicket = (ticketCh?.messages ?? []).some((m) => /Ashwright/i.test(m.content));
    push(
      "S22",
      "Restricted opener text held, never leaked",
      t.status === "open" && held && !rawOnTicket && !leakedPlayer,
      `held=${held} raw=${rawOnTicket} leak=${leakedPlayer}`,
    );
  } catch (e) {
    push("S22", "Restricted opener text held, never leaked", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const n = await rt.notice("maintenance", { window: "01:00–03:00" });
    const statusCh = rt.guild.channelById(rt.store.blueprintState.get("network.status")!)!;
    const posted = statusCh.messages.some((m) => m.content.includes("01:00–03:00"));
    const narrative = createEvent(rt.store, { class: "NARRATIVE", template_ref: "tpl.ops.deployment", audience: "initiate+" }, "owner_1");
    markEligible(rt.store, narrative.id, "owner_1");
    const blocked = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "story" },
      event_id: narrative.id,
    });
    const tpl = rt.bp.templates.find((t) => t.key === "tpl.ops.deployment")!;
    const prev = tpl.class;
    tpl.class = "NARRATIVE";
    const blockedNar = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "story" },
      event_id: narrative.id,
    });
    tpl.class = prev;
    push(
      "S23",
      "Operational notice via dispatch; NARRATIVE still awaits enactment",
      n.ok === true && posted && blockedNar.ok === false && blockedNar.step === 2,
      `notice=${n.ok} posted=${posted} nar=${blockedNar.reason} unmarked=${blocked.ok}`,
    );
  } catch (e) {
    push("S23", "Operational notice via dispatch; NARRATIVE still awaits enactment", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    rt.guild.failQueue.push({ status: 503, body: '{"message":"upstream"}', pathIncludes: "/channels" });
    let down = false;
    let body = "";
    try {
      await createTicket({ opener: "p7", handle: "p", category: "general", body: "during outage" }, rt);
    } catch (err) {
      down = true;
      body = err instanceof Error ? err.message : String(err);
    }
    const leftover = [...rt.store.tickets.values()].filter((t) => t.opener === "p7");
    push(
      "S24",
      "Discord downtime fails closed and drops reservation",
      down && leftover.length === 0 && body.includes("503"),
      `down=${down} leftover=${leftover.length} body=${body.slice(0, 80)}`,
    );
  } catch (e) {
    push("S24", "Discord downtime fails closed and drops reservation", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    rt.store.staff.set("mod_1", { snowflake: "mod_1", handle: "mod", capabilities: ["ticket.claim"] });
    await rt.apply();
    const t = await createTicket({ opener: "p8", handle: "p", category: "report", body: "perm" }, rt);
    let unauth = false;
    try {
      await claimTicket(rt.store, t.id, "mod_1", rt.guild, rt.bp);
    } catch (err) {
      unauth = err instanceof Error && err.message === "unauthorized";
    }
    push("S25", "Report ticket claim unauthorized for ticket.claim-only staff", unauth && rt.store.tickets.get(t.id)?.status === "open", `unauth=${unauth}`);
  } catch (e) {
    push("S25", "Report ticket claim unauthorized for ticket.claim-only staff", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const worker = readFileSync(join(cwd, "workers/mortis-envoy/src/index.ts"), "utf8");
    const pointsAtEnvoy = worker.includes("envoyFetch") || worker.includes("src/lib/mortis/envoy.ts");
    const noCanonStore = !/CREATE TABLE|canon_facts|dossiers/.test(worker);
    push("S26", "Worker entry points at envoyFetch and stores no canon", pointsAtEnvoy && noCanonStore, `points=${pointsAtEnvoy}`);
  } catch (e) {
    push("S26", "Worker entry points at envoyFetch and stores no canon", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const id = rt.store.blueprintState.get("network.traffic")!;
    const live = rt.guild.channelById(id)!;
    live.name = "renamed-by-hand";
    const p = await rt.plan();
    const still = rt.store.blueprintState.get("network.traffic");
    const created = p.ops.filter((o) => o.op === "create" && o.key === "network.traffic");
    push(
      "S27",
      "Rename does not recreate — match by key",
      still === id && created.length === 0 && p.creates === 0,
      `creates=${p.creates} bound=${still} liveId=${id}`,
    );
  } catch (e) {
    push("S27", "Rename does not recreate — match by key", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "network.traffic";
    const id = rt.store.blueprintState.get(key)!;
    const ch = rt.guild.channelById(id)!;
    ch.parent_id = "wrong-parent";
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    push(
      "S28",
      "Health reports placement drift",
      h.drift.includes(key) && h.findings.some((f) => f.code === "drift.placement" && f.target === key),
      `drift=${h.drift.join(",")}`,
    );
  } catch (e) {
    push("S28", "Health reports placement drift", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "network.traffic";
    const id = rt.store.blueprintState.get(key)!;
    const ch = rt.guild.channelById(id)!;
    const everyone = ch.permission_overwrites.find((o) => o.id === rt.guild.id);
    if (everyone) {
      everyone.deny = "0";
      everyone.allow = PERM.VIEW_CHANNEL.toString();
    }
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    push(
      "S29",
      "Health reports overwrite drift on initiate+ channel",
      h.findings.some((f) => f.code === "drift.overwrites" && f.target === key),
      h.findings.filter((f) => f.code === "drift.overwrites").map((f) => f.target).join(",") || "none",
    );
  } catch (e) {
    push("S29", "Health reports overwrite drift on initiate+ channel", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const dest = rt.store.blueprintState.get("network.status")!;
    const ch = rt.guild.channelById(dest)!;
    await rt.guild.createWebhook(dest, "status");
    rt.guild.failQueue.push({ status: 403, pathIncludes: `/channels/${dest}/messages` });
    const n = await rt.dispatch({
      channel_key: "network.status",
      template_key: "tpl.ops.deployment",
      fields: { status: "complete" },
    });
    const posted = ch.messages.some((m) => m.author_id === "webhook" || m.content.includes("complete"));
    push("S30", "Dispatch 403 falls back to webhook author", n.ok === true && posted, `ok=${n.ok} posted=${posted} reason=${n.reason ?? ""}`);
  } catch (e) {
    push("S30", "Dispatch 403 falls back to webhook author", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    let threw = false;
    try {
      rt.reconnectGateway();
    } catch (err) {
      threw = err instanceof Error && /token not in memory/i.test(err.message);
    }
    push("S31", "Gateway reconnect without token fails closed", threw && rt.guild.live === false, `threw=${threw} live=${rt.guild.live}`);
  } catch (e) {
    push("S31", "Gateway reconnect without token fails closed", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const body = JSON.stringify({
      type: 5,
      user: { id: "p_cat", username: "p" },
      data: {
        custom_id: "ticket_modal",
        components: [
          { components: [{ custom_id: "category", value: "lore" }, { custom_id: "body", value: "help" }] },
        ],
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const signed = await rt.signDiscordBody(body, ts);
    const res = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body,
      }),
    );
    const json = (await res.json()) as { data?: { content?: string } };
    const content = json.data?.content ?? "";
    push(
      "S32",
      "Invalid ticket category lists allowed values",
      res.status === 200 && /general\|report\|appeal\|accessibility/.test(content) && [...rt.store.tickets.values()].length === 0,
      content.slice(0, 120),
    );
  } catch (e) {
    push("S32", "Invalid ticket category lists allowed values", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    const openers = [
      { cid: "ticket_create", expect: 9 },
      { cid: "intake_start", expect: 9 },
    ];
    const results: string[] = [];
    let ok = true;
    for (const o of openers) {
      const body = JSON.stringify({ type: 3, data: { custom_id: o.cid }, user: { id: "u1", username: "u" } });
      const ts = String(Math.floor(Date.now() / 1000));
      const signed = await rt.signDiscordBody(body, ts);
      const res = await rt.fetch(
        new Request("https://envoy.local/interactions", {
          method: "POST",
          headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
          body,
        }),
      );
      const json = (await res.json()) as { type?: number };
      results.push(`${o.cid}:${json.type}`);
      if (json.type !== o.expect) ok = false;
    }
    const unknownBody = JSON.stringify({ type: 3, data: { custom_id: "nope" }, user: { id: "u1", username: "u" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const signed = await rt.signDiscordBody(unknownBody, ts);
    const unknown = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body: unknownBody,
      }),
    );
    const ujson = (await unknown.json()) as { type?: number; data?: { content?: string } };
    const unknownOk = ujson.data?.content === "Unknown control.";
    push("S33", "Modal openers ACK type 9; unknown control is explicit", ok && unknownOk, results.join(" ") + ` unknown=${ujson.data?.content}`);
  } catch (e) {
    push("S33", "Modal openers ACK type 9; unknown control is explicit", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const missing = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.release_notice",
      fields: { presentation_name: "terminal", published_at: "now" },
    });
    push(
      "S34",
      "Application update requires signed release excerpt",
      missing.ok === false && missing.step === 3,
      `step=${missing.step} reason=${missing.reason}`,
    );
  } catch (e) {
    push("S34", "Application update requires signed release excerpt", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const t = await createTicket({ opener: "p_html", handle: "p", category: "general", body: "<script>alert(1)</script>" }, rt);
    await closeTicket(rt.store, rt.guild, t.id, "owner_1", rt.bp);
    const html = rt.store.r2.get(`transcripts/${t.id}.html`) ?? "";
    const txt = rt.store.r2.get(`transcripts/${t.id}.txt`) ?? "";
    push(
      "S35",
      "Closed ticket stores txt + html transcript",
      t.transcript_key === `transcripts/${t.id}.txt` &&
        txt.includes("<script>alert(1)</script>") &&
        html.includes("<pre>") &&
        html.includes("\x26lt;script\x26gt;") &&
        !html.includes("<script>alert"),
      `key=${t.transcript_key} html=${html.length}`,
    );
  } catch (e) {
    push("S35", "Closed ticket stores txt + html transcript", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const n = await rt.notice("lockdown", {});
    const arrival = rt.guild.channelById(rt.store.blueprintState.get("arrival.notice")!)!;
    const posted = arrival.messages.some((m) => /Arrival is closed/i.test(m.content));
    push("S36", "Lockdown operational notice via dispatch choke point", n.ok === true && posted, `ok=${n.ok} posted=${posted}`);
  } catch (e) {
    push("S36", "Lockdown operational notice via dispatch choke point", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const sent = await rt.notice("deployment", { status: "complete" });
    if (!sent.ok) throw new Error(sent.reason ?? "dispatch failed");
    const dest = rt.guild.channelById(rt.store.blueprintState.get("network.status")!)!;
    const id = dest.messages.at(-1)!.id;
    const gone = await rt.retract("network.status", id, "test retract");
    const still = dest.messages.some((m) => m.id === id);
    const missing = await rt.retract("network.status", "nope", "ghost");
    const missReason = missing.ok ? "" : missing.reason;
    push(
      "S37",
      "Retract removes message and audits; missing id fails closed",
      gone.ok === true && !still && missing.ok === false && missReason === "message not found",
      `gone=${gone.ok} still=${still} missing=${missReason}`,
    );
  } catch (e) {
    push("S37", "Retract removes message and audits; missing id fails closed", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const blocked = await rt.notice("application_update", { presentation_name: "terminal", published_at: "now" });
    push(
      "S38",
      "Application-update notice blocks without signed excerpt",
      blocked.ok === false && blocked.step === 3,
      `ok=${blocked.ok} step=${blocked.step} reason=${blocked.reason}`,
    );
  } catch (e) {
    push("S38", "Application-update notice blocks without signed excerpt", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const n = await rt.notice("intake", { status: "open" });
    const dest = rt.guild.channelById(rt.store.blueprintState.get("network.status")!)!;
    const posted = dest.messages.some((m) => /Intake processing is open/i.test(m.content));
    push("S39", "Intake availability notice via dispatch", n.ok === true && posted, `ok=${n.ok} posted=${posted}`);
  } catch (e) {
    push("S39", "Intake availability notice via dispatch", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const before = rt.store.webhookUrls.get("network.status");
    const rot = await rt.rotateWebhooks();
    const after = rt.store.webhookUrls.get("network.status");
    const n = await rt.notice("deployment", { status: "complete" });
    push(
      "S40",
      "Webhook rotation updates bound URLs and dispatch still delivers",
      Boolean(before) && Boolean(after) && after !== before && rot.rotated.includes("network.status") && n.ok === true,
      `before=${Boolean(before)} changed=${after !== before} ok=${n.ok} n=${rot.rotated.length}`,
    );
  } catch (e) {
    push("S40", "Webhook rotation updates bound URLs and dispatch still delivers", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const packed = botPermissionInteger();
    const invite = botInviteUrl("1540058003888410806");
    const wrong = 294851834304n;
    const missingFromWrong = permissionMissing(wrong);
    const excessAdmin = permissionExcess(PERM.ADMINISTRATOR | packed);
    const pass =
      packed === BOT_PERMISSION_INTEGER &&
      packed === 295011699728n &&
      (packed & PERM.ADMINISTRATOR) === 0n &&
      (packed & PERM.MANAGE_GUILD) === 0n &&
      (packed & PERM.VIEW_CHANNEL) !== 0n &&
      (packed & PERM.SEND_MESSAGES) !== 0n &&
      (packed & PERM.MANAGE_CHANNELS) !== 0n &&
      (packed & PERM.MANAGE_ROLES) !== 0n &&
      invite.includes("permissions=295011699728") &&
      missingFromWrong.includes("VIEW_CHANNEL") &&
      missingFromWrong.includes("MANAGE_CHANNELS") &&
      excessAdmin.includes("ADMINISTRATOR");
    push(
      "S41",
      "Least-privilege integer is 295011699728 and encodes the published bit set",
      pass,
      `packed=${packed} wrongMissing=${missingFromWrong.join(",")}`,
    );
  } catch (e) {
    push("S41", "Least-privilege integer is 295011699728 and encodes the published bit set", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const hAdmin = assessHealth(rt.bp, rt.store, rt.guild, { administrator: true, botPermissions: "8" });
    const hWrong = assessHealth(rt.bp, rt.store, rt.guild, { administrator: false, botPermissions: "294851834304" });
    const adminHold = hAdmin.findings.some((f) => f.code === "perms.administrator" && f.severity === "hold");
    const missingHold = hWrong.findings.some((f) => f.code === "perms.missing" && f.severity === "hold");
    push("S42", "Health HOLDs on Administrator and on the transcribed-wrong invite integer", adminHold && missingHold, `admin=${adminHold} missing=${missingHold}`);
  } catch (e) {
    push("S42", "Health HOLDs on Administrator and on the transcribed-wrong invite integer", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    await enactLockdown(rt.ctx(), "owner_1");
    await liftLockdown(rt.ctx(), "owner_1");
    const dest = rt.guild.channelById(rt.store.blueprintState.get("arrival.notice")!);
    const posted = (dest?.messages ?? []).some((m) => /Arrival is open again/i.test(m.content));
    push("S43", "Lockdown lift posts all-clear through dispatch", rt.store.lockdown === false && posted, `lockdown=${rt.store.lockdown} posted=${posted}`);
  } catch (e) {
    push("S43", "Lockdown lift posts all-clear through dispatch", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    rt.killed = true;
    const ping = JSON.stringify({ type: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    const signed = await rt.signDiscordBody(ping, ts);
    const dead = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body: ping,
      }),
    );
    const lift = await rt.fetch(
      new Request("https://envoy.local/cli/unkill", {
        method: "POST",
        headers: { authorization: `Bearer ${rt.env.CLI_SECRET}` },
      }),
    );
    const alive = await rt.fetch(
      new Request("https://envoy.local/interactions", {
        method: "POST",
        headers: { "x-signature-ed25519": signed.signature, "x-signature-timestamp": ts },
        body: ping,
      }),
    );
    const liftJson = (await lift.json()) as { killed?: boolean };
    push(
      "S44",
      "Kill switch can be lifted without process restart",
      dead.status === 404 && lift.status === 200 && liftJson.killed === false && alive.status === 200,
      `dead=${dead.status} lift=${lift.status} alive=${alive.status} killed=${rt.killed}`,
    );
  } catch (e) {
    push("S44", "Kill switch can be lifted without process restart", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    const cmds = commandPayloads(rt.bp);
    const ticket = cmds.find((c) => c.name === "ticket");
    const cat = ticket?.options?.find((o) => o.name === "category");
    const values = (cat?.choices ?? []).map((c) => c.value).sort().join("|");
    const pass = values === "accessibility|appeal|general|report";
    push("S45", "Slash /ticket category uses Discord choices", pass, `values=${values}`);
  } catch (e) {
    push("S45", "Slash /ticket category uses Discord choices", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "network.traffic";
    const id = rt.store.blueprintState.get(key)!;
    const ch = rt.guild.channelById(id)!;
    ch.parent_id = null;
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    const hit = h.findings.some((f) => f.code === "drift.placement" && f.target === key);
    push("S46", "Health reports placement drift when parent is missing", hit, `findings=${h.drift.join(",")}`);
  } catch (e) {
    push("S46", "Health reports placement drift when parent is missing", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    rt.guild.failQueue.push({ status: 403, body: '{"message":"Missing Access","code":50013}', pathIncludes: "incident-actions" });
    await enactLockdown(rt.ctx(), "owner_1");
    const pass = rt.store.lockdown === true && rt.guild.invitesPaused === false && rt.store.invitesPaused === false;
    push("S47", "Lockdown does not claim invites paused when incident-actions 403s", pass, `lockdown=${rt.store.lockdown} guildPaused=${rt.guild.invitesPaused} storePaused=${rt.store.invitesPaused}`);
  } catch (e) {
    push("S47", "Lockdown does not claim invites paused when incident-actions 403s", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    rt.guild.live = true;
    const key = "arrival.terms";
    const ch = rt.guild.channelById(rt.store.blueprintState.get(key)!)!;
    ch.messages = [];
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    const pinHit = h.findings.some((f) => f.code === "pin.missing");
    push("S48", "Health does not false-positive pin.missing on empty hydrate cache", !pinHit, `pinHit=${pinHit}`);
  } catch (e) {
    push("S48", "Health does not false-positive pin.missing on empty hydrate cache", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "network.traffic";
    const ch = rt.guild.channelById(rt.store.blueprintState.get(key)!)!;
    ch.permission_overwrites = ch.permission_overwrites.filter((o) => o.id !== rt.guild.id);
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    const hit = h.findings.some((f) => f.code === "drift.overwrites" && f.target === key);
    push("S49", "Health reports overwrite drift when @everyone row is missing", hit, `hit=${hit}`);
  } catch (e) {
    push("S49", "Health reports overwrite drift when @everyone row is missing", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "network.status";
    const ch = rt.guild.channelById(rt.store.blueprintState.get(key)!)!;
    ch.topic = "";
    const h = assessHealth(rt.bp, rt.store, rt.guild);
    const hit = h.findings.some((f) => f.code === "drift.topic" && f.target === key);
    push("S50", "Health reports topic drift when live topic is empty", hit, `hit=${hit}`);
  } catch (e) {
    push("S50", "Health reports topic drift when live topic is empty", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const pass =
      interactionOpensModal(3, "ticket_create") &&
      interactionOpensModal(3, "intake_start") &&
      !interactionOpensModal(3, "terms_accept") &&
      !interactionOpensModal(2, "ticket_create") &&
      !interactionOpensModal(3, "");
    push("S51", "Modal openers are ticket_create and intake_start only (type 3)", pass, `pass=${pass}`);
  } catch (e) {
    push("S51", "Modal openers are ticket_create and intake_start only (type 3)", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const body = '{"message":"Invalid Form Body","code":50035}';
    rt.guild.failQueue.push(
      { status: 400, body, pathIncludes: "/channels" },
      { status: 400, body, pathIncludes: "/channels" },
      { status: 400, body, pathIncludes: "/channels" },
      { status: 400, body, pathIncludes: "/channels" },
    );
    let msg = "";
    try {
      await createTicket({ opener: "p_400", handle: "p", category: "general", body: "help" }, rt);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    push("S52", "Ticket create 400 surfaces Discord body and does not open a ticket", msg.includes("50035") && [...rt.store.tickets.values()].length === 0, `msg=${msg.slice(0, 120)} tickets=${rt.store.tickets.size}`);
  } catch (e) {
    push("S52", "Ticket create 400 surfaces Discord body and does not open a ticket", false, e instanceof Error ? e.message : String(e));
  }

  void writeFileSync;
  void mkdtempSync;
  void rmSync;
  void tmpdir;
  void scanDeveloper;
  return out;
}
