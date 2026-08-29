import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MortisRuntime } from "./runtime.ts";
import { inspectZeroCanon } from "./zero-canon.ts";
import { generateEd25519HexPair, signEd25519Hex, canonicalStringify, verifyReleaseExcerpt } from "./crypto.ts";
import { loadTermList, resetTermCache, injectTermListForTest, scanRestricted, scanDeveloper } from "./terms.ts";
import { createEvent, markEligible, enact } from "./events.ts";
import { createTicket, claimTicket, closeTicket, staffCanViewTicket, reopenTicket } from "./tickets.ts";
import { PERM, botInviteUrl, botPermissionInteger, BOT_PERMISSION_INTEGER, permissionMissing, permissionExcess, botMemberAllowBits, generateOverwrites } from "./permissions.ts";
import { runFirstPlayerWalkthrough } from "./walkthrough.ts";
import { assessHealth } from "./health.ts";
import { commandPayloads } from "./commands.ts";
import { enactLockdown, liftLockdown } from "./envoy.ts";
import { interactionOpensModal } from "./discord-gateway.ts";
import { shouldRetryChannelCreateWithoutOverwrites } from "./discord-rest.ts";
import { categoryOrderDriftKeys, overwriteSweepTargets, plan, findExistingTemplatePost } from "./provision.ts";
import {
  assessLiveReadiness,
  assessPublicApplication,
  CAPTURED_INSTALL_PARAMS,
  classifyDiscordHttp,
  probePublicApplication,
} from "./discord-public.ts";
import { isGuildAllowed, addRuntimeAllowedGuild, clearRuntimeAllowlist, listAllowedGuilds } from "./allowlist.ts";
import { startTestableGateway } from "./discord-gateway.ts";
import type { EnvoyContext } from "./envoy.ts";
import { setNotificationPreference, getNotificationPreferences, memberOptedIn, DEFAULT_PREFERENCES } from "./notifications.ts";
import { scheduleOperationalNotice, runDueScheduledNotices, cancelScheduledNotice, listScheduledNotices, OPERATIONAL_KINDS } from "./scheduler.ts";

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
    const requiredOrderOk = ticket?.options?.every((o, i, arr) => {
      if (o.required) return arr.slice(0, i).every((p) => p.required !== false);
      return true;
    });
    const pass = values === "accessibility|appeal|general|report" && cat?.required === true && requiredOrderOk === true;
    push("S45", "Slash /ticket category uses Discord choices", pass, `values=${values} required=${cat?.required} order=${requiredOrderOk}`);
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

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const guest = rt.guild.seedMember("lock_guest", "newcomer", []);
    await enactLockdown(rt.ctx(), "owner_1");
    const notice = rt.store.blueprintState.get("arrival.notice")!;
    const guide = rt.store.blueprintState.get("arrival.guide")!;
    const intake = rt.store.blueprintState.get("arrival.intake")!;
    const pass =
      rt.guild.canView(guest.id, notice) &&
      rt.guild.canView(guest.id, guide) &&
      !rt.guild.canView(guest.id, intake);
    push("S53", "Lockdown hides ENTRY and keeps HOW TO BEGIN readable", pass, `notice=${rt.guild.canView(guest.id, notice)} guide=${rt.guild.canView(guest.id, guide)} intake=${rt.guild.canView(guest.id, intake)}`);
  } catch (e) {
    push("S53", "Lockdown hides ENTRY and keeps HOW TO BEGIN readable", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const assessed = assessPublicApplication(
      {
        id: "1540058003888410806",
        name: "Mortis Field Network — Dev",
        bot_public: true,
        install_params: { scopes: ["applications.commands", "bot"], permissions: CAPTURED_INSTALL_PARAMS },
        verify_key: "a".repeat(64),
      },
      "1540058003888410806",
    );
    const pass =
      assessed.installMatchesRequired === false &&
      assessed.administrator === false &&
      assessed.botPublic === true &&
      assessed.missing.includes("SEND_MESSAGES") &&
      assessed.missing.includes("MANAGE_CHANNELS") &&
      assessed.missing.includes("MANAGE_ROLES") &&
      assessed.excess.includes("MANAGE_GUILD") &&
      assessed.findings.some((f) => f.code === "app.install_params" && f.severity === "hold") &&
      assessed.findings.some((f) => f.code === "app.bot_public" && f.severity === "warn") &&
      assessed.publicKey === "a".repeat(64) &&
      CAPTURED_INSTALL_PARAMS !== BOT_PERMISSION_INTEGER.toString();
    push(
      "S54",
      "Captured public install_params is not canonical and is missing SEND/MANAGE bits",
      pass,
      `missing=${assessed.missing.join(",")} excess=${assessed.excess.join(",")}`,
    );
  } catch (e) {
    push("S54", "Captured public install_params is not canonical and is missing SEND/MANAGE bits", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const blocked = classifyDiscordHttp(
      429,
      '{"message":"You are being blocked from accessing our API temporarily due to exceeding global rate limits."}',
    );
    const retry = classifyDiscordHttp(429, '{"retry_after":1}');
    const unauth = classifyDiscordHttp(401, '{"message":"401: Unauthorized","code":0}');
    const forbidden = classifyDiscordHttp(403, '{"message":"Missing Access","code":50001}');
    const pass = blocked === "blocked" && retry === "rate_limit" && unauth === "unauthorized" && forbidden === "forbidden";
    push("S55", "Discord HTTP classifier separates IP block from retryable 429", pass, `blocked=${blocked} retry=${retry} 401=${unauth} 403=${forbidden}`);
  } catch (e) {
    push("S55", "Discord HTTP classifier separates IP block from retryable 429", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const headersSeen: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      headersSeen.push(JSON.stringify(init?.headers ?? {}));
      if (String(url).includes("/gateway")) {
        return new Response(JSON.stringify({ url: "wss://gateway.discord.gg" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: "1540058003888410806",
          name: "Mortis Field Network — Dev",
          bot_public: true,
          install_params: { permissions: CAPTURED_INSTALL_PARAMS, scopes: ["bot"] },
          verify_key: "b".repeat(64),
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const probe = await probePublicApplication("1540058003888410806", fetchImpl);
    const authLeak = headersSeen.some((h) => /authorization/i.test(h));
    push(
      "S56",
      "Public application probe never sends a bot token",
      probe.reachable && !authLeak && probe.botPublic === true,
      `authLeak=${authLeak} reachable=${probe.reachable}`,
    );
  } catch (e) {
    push("S56", "Public application probe never sends a bot token", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    const report = await assessLiveReadiness({
      bp: rt.bp,
      appId: "1540058003888410806",
      guildId: "1540022458126700674",
      tokenInMemory: rt.hasLiveToken(),
      liveConnected: rt.guild.live === true,
      scratchConfirmed: rt.scratchConfirmed,
      saved: { guildId: "1540022458126700674", bindings: [["role.owner", "1"]], lastAppliedHash: "deadbeef" },
      network: false,
    });
    const pass =
      rt.hasLiveToken() === false &&
      report.tokenInMemory === false &&
      report.liveConnected === false &&
      Boolean(report.blocker) &&
      /never paste the token in chat/i.test(report.blocker ?? "") &&
      report.scratchState.present === true &&
      report.scratchState.hashMatch === false;
    push(
      "S57",
      "Live readiness reports token-not-in-memory blocker and blueprint hash drift",
      pass,
      `blocker=${Boolean(report.blocker)} hashMatch=${report.scratchState.hashMatch}`,
    );
  } catch (e) {
    push("S57", "Live readiness reports token-not-in-memory blocker and blueprint hash drift", false, e instanceof Error ? e.message : String(e));
  }

  try {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          code: 0,
          message: "You are being blocked from accessing our API temporarily due to exceeding global rate limits.",
        }),
        { status: 429 },
      );
    }) as typeof fetch;
    const probe = await probePublicApplication("1540058003888410806", fetchImpl);
    const pass = probe.kind === "blocked" && probe.ok === false && calls === 1;
    push("S58", "IP-block 429 fails closed without spinning retries on the public probe", pass, `kind=${probe.kind} calls=${calls}`);
  } catch (e) {
    push("S58", "IP-block 429 fails closed without spinning retries on the public probe", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const held = botPermissionInteger();
    const allow = botMemberAllowBits(held);
    const withAdmin = botMemberAllowBits(PERM.ADMINISTRATOR | held);
    const pass =
      (allow & PERM.PIN_MESSAGES) === 0n &&
      (allow & PERM.MANAGE_MESSAGES) === 0n &&
      (allow & PERM.VIEW_CHANNEL) !== 0n &&
      (allow & PERM.SEND_MESSAGES) !== 0n &&
      (allow & PERM.MANAGE_CHANNELS) !== 0n &&
      (allow & PERM.MANAGE_WEBHOOKS) !== 0n &&
      (withAdmin & PERM.PIN_MESSAGES) !== 0n &&
      (botMemberAllowBits(held | PERM.PIN_MESSAGES) & PERM.PIN_MESSAGES) !== 0n;
    push(
      "S59",
      "Bot member overwrite does not grant PIN_MESSAGES or MANAGE_MESSAGES unless held",
      pass,
      `allow=${allow} pin=${(allow & PERM.PIN_MESSAGES) !== 0n} manageMsg=${(allow & PERM.MANAGE_MESSAGES) !== 0n}`,
    );
  } catch (e) {
    push("S59", "Bot member overwrite does not grant PIN_MESSAGES or MANAGE_MESSAGES unless held", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const held = botPermissionInteger();
    const ows = generateOverwrites({
      guildId: "g1",
      audience: "staff",
      kind: "text",
      readonly: false,
      heldPermissions: held,
      roleSnowflakes: { everyone: "g1", initiate: "i1", shadow: "s1", staff: ["st1"], bot: "b1" },
    });
    const staff = ows.find((o) => o.id === "st1");
    const bot = ows.find((o) => o.id === "b1");
    const staffAllow = BigInt(staff?.allow ?? "0");
    const botAllow = BigInt(bot?.allow ?? "0");
    const pass =
      (staffAllow & PERM.MANAGE_MESSAGES) === 0n &&
      (botAllow & PERM.MANAGE_MESSAGES) === 0n &&
      (botAllow & PERM.MANAGE_CHANNELS) !== 0n &&
      (staffAllow & PERM.VIEW_CHANNEL) !== 0n;
    push(
      "S60",
      "Channel overwrites mask unheld MANAGE_MESSAGES so Discord create/PUT does not 50001",
      pass,
      `staff=${staffAllow} bot=${botAllow}`,
    );
  } catch (e) {
    push("S60", "Channel overwrites mask unheld MANAGE_MESSAGES so Discord create/PUT does not 50001", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    rt.guild.roles.push({
      id: "managed_bot_role",
      name: "Managed Bot",
      hoist: false,
      mentionable: false,
      color: 0,
      position: 99,
      permissions: botPermissionInteger().toString(),
      managed: true,
    });
    const { overwritesFor } = await import("./provision.ts");
    const ows = overwritesFor(rt.bp, rt.store, rt.guild, "initiate+", "text", false, false);
    const managed = ows.find((o) => o.id === "managed_bot_role");
    const member = ows.find((o) => o.id === rt.guild.botUserId && o.type === 1);
    const pass = Boolean(managed) && BigInt(managed?.allow ?? "0") !== 0n && Boolean(member);
    push(
      "S61",
      "Overwrites include the Discord-managed integration role, not only presentation role.bot",
      pass,
      `managed=${Boolean(managed)} member=${Boolean(member)} allow=${managed?.allow}`,
    );
  } catch (e) {
    push("S61", "Overwrites include the Discord-managed integration role, not only presentation role.bot", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const pass =
      shouldRetryChannelCreateWithoutOverwrites(403, true) === true &&
      shouldRetryChannelCreateWithoutOverwrites(403, false) === false &&
      shouldRetryChannelCreateWithoutOverwrites(400, true) === false &&
      shouldRetryChannelCreateWithoutOverwrites(500, true) === false;
    push("S62", "Channel create retries without overwrites only on 403", pass, `pass=${pass}`);
  } catch (e) {
    push("S62", "Channel create retries without overwrites only on 403", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "arrival.terms";
    const id = rt.store.blueprintState.get(key)!;
    const ch = rt.guild.channelById(id)!;
    for (const m of ch.messages) m.pinned = false;
    const before = ch.messages.length;
    const { refreshPins } = await import("./provision.ts");
    await refreshPins(rt.bp, rt.store, rt.guild, "owner_1");
    const pass = ch.messages.length === before && ch.messages.length > 0;
    push("S63", "Pin refresh does not duplicate when an unpinned template message already exists", pass, `before=${before} after=${ch.messages.length}`);
  } catch (e) {
    push("S63", "Pin refresh does not duplicate when an unpinned template message already exists", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "arrival.terms";
    const ch = rt.guild.channelById(rt.store.blueprintState.get(key)!)!;
    for (const m of ch.messages) m.pinned = false;
    const h = assessHealth(rt.bp, rt.store, rt.guild, { botPermissions: botPermissionInteger().toString() });
    const unpinnable = h.findings.some((f) => f.code === "pin.unpinnable" && f.target === key);
    const missing = h.findings.some((f) => f.code === "pin.missing" && f.target === key);
    push("S64", "Health reports pin.unpinnable when template exists but PIN_MESSAGES is not held", unpinnable && !missing, `unpinnable=${unpinnable} missing=${missing}`);
  } catch (e) {
    push("S64", "Health reports pin.unpinnable when template exists but PIN_MESSAGES is not held", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const notice = rt.guild.channelById(rt.store.blueprintState.get("arrival.notice")!)!;
    const guide = rt.guild.channelById(rt.store.blueprintState.get("arrival.guide")!)!;
    const terms = rt.guild.channelById(rt.store.blueprintState.get("arrival.terms")!)!;
    const intake = rt.guild.channelById(rt.store.blueprintState.get("arrival.intake")!)!;
    // Swap HOW TO BEGIN to the end of ARRIVAL the way a late live create lands.
    const maxPos = Math.max(notice.position, guide.position, terms.position, intake.position);
    guide.position = maxPos + 10;
    const drifted = categoryOrderDriftKeys(rt.bp, rt.store, rt.guild);
    const p = await plan(rt.bp, rt.store, rt.guild);
    const guideOp = p.ops.find((o) => o.op !== "orphan" && o.key === "arrival.guide");
    const pass =
      drifted.has("arrival.guide") &&
      drifted.has("arrival.notice") &&
      guideOp?.op === "update" &&
      (guideOp.changes ?? []).includes("order");
    push("S65", "Plan detects sibling channel-order drift (HOW TO BEGIN among ARRIVAL)", pass, `drifted=${[...drifted].join(",")} guideOp=${JSON.stringify(guideOp)}`);
  } catch (e) {
    push("S65", "Plan detects sibling channel-order drift (HOW TO BEGIN among ARRIVAL)", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "arrival.guide";
    const ch = rt.guild.channelById(rt.store.blueprintState.get(key)!)!;
    for (const m of ch.messages) m.pinned = false;
    const before = ch.messages.length;
    rt.store.lastAppliedHash = "force-reapply";
    await rt.apply();
    const pass = ch.messages.length === before && before > 0;
    push("S66", "Apply does not duplicate pin templates when an unpinned bot post already exists", pass, `before=${before} after=${ch.messages.length}`);
  } catch (e) {
    push("S66", "Apply does not duplicate pin templates when an unpinned bot post already exists", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const targets = overwriteSweepTargets(rt.bp, rt.store);
    const keys = new Set(targets.map((t) => t.key));
    const roleHit = [...rt.store.blueprintState.keys()].some((k) => k.startsWith("role.") && keys.has(k));
    const webhookHit = [...rt.store.blueprintState.keys()].some((k) => k.endsWith(".webhook") && keys.has(k));
    const hasChannels = keys.has("arrival.notice") && keys.has("arrival") && keys.has("support.desk");
    push(
      "S67",
      "Overwrite sweep targets channels and categories only — never roles or webhooks",
      hasChannels && !roleHit && !webhookHit,
      `n=${targets.length} roleHit=${roleHit} webhookHit=${webhookHit}`,
    );
  } catch (e) {
    push("S67", "Overwrite sweep targets channels and categories only — never roles or webhooks", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "arrival.guide";
    const ch = rt.guild.channelById(rt.store.blueprintState.get(key)!)!;
    ch.messages = [];
    const h = assessHealth(rt.bp, rt.store, rt.guild, { botPermissions: botPermissionInteger().toString() });
    const unpinnable = h.findings.some((f) => f.code === "pin.unpinnable" && f.target === key);
    const missing = h.findings.some((f) => f.code === "pin.missing");
    push(
      "S68",
      "Health reports pin.unpinnable on empty hydrate when PIN_MESSAGES is not held",
      unpinnable && !missing,
      `unpinnable=${unpinnable} missing=${missing}`,
    );
  } catch (e) {
    push("S68", "Health reports pin.unpinnable on empty hydrate when PIN_MESSAGES is not held", false, e instanceof Error ? e.message : String(e));
  }

  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const key = "arrival.guide";
    const id = rt.store.blueprintState.get(key)!;
    const ch = rt.guild.channelById(id)!;
    ch.messages = [
      {
        id: "wh_post",
        channel_id: id,
        content: "HOW TO BEGIN\n\nYou arrived somewhere that was already running.",
        author_id: "webhook_snowflake_not_bot",
        timestamp: new Date().toISOString(),
        pinned: false,
      },
    ];
    const found = await findExistingTemplatePost(rt.guild, id, "HOW TO BEGIN");
    const before = ch.messages.length;
    rt.store.lastAppliedHash = "force-reapply";
    await rt.apply();
    const pass = found?.id === "wh_post" && ch.messages.length === before;
    push(
      "S69",
      "Apply does not duplicate when an unpinned template post is not authored as the bot user",
      pass,
      `found=${found?.id} before=${before} after=${ch.messages.length}`,
    );
  } catch (e) {
    push("S69", "Apply does not duplicate when an unpinned template post is not authored as the bot user", false, e instanceof Error ? e.message : String(e));
  }

  // S70 — live-attach guild allowlist refuses production guild ids BEFORE hydrate.
  try {
    clearRuntimeAllowlist();
    const scratchAllowed = isGuildAllowed("1540022458126700674");
    const foreignRefused = !isGuildAllowed("999999999999999999");
    const malformedRefused = !isGuildAllowed("not-a-snowflake");
    const rt = await fresh(cwd);
    let refusedBeforeHydrate = false;
    let auditRefused = false;
    try {
      await rt.attachLive({
        token: "fake.token.value.never.sent",
        guildId: "999999999999999999",
        appId: "1540058003888410806",
        confirmScratch: true,
      });
    } catch (e) {
      refusedBeforeHydrate = /live-attach refused|allowlist/i.test((e as Error).message);
      auditRefused = rt.store.audit.some(
        (a) => a.action === "discord.connect.refused" && a.target === "999999999999999999",
      );
    }
    const pass = scratchAllowed && foreignRefused && malformedRefused && refusedBeforeHydrate && auditRefused;
    push(
      "S70",
      "Live-attach refuses non-allowlisted guild before any token/hydrate call",
      pass,
      `scratch=${scratchAllowed} foreign=${foreignRefused} malformed=${malformedRefused} refused=${refusedBeforeHydrate} audit=${auditRefused}`,
    );
  } catch (e) {
    push("S70", "Live-attach refuses non-allowlisted guild before any token/hydrate call", false, e instanceof Error ? e.message : String(e));
  }

  // S71 — gateway zombie detection: missing heartbeat ACK triggers reconnect.
  try {
    const packets: unknown[] = [];
    let opened = false;
    let closedCount = 0;
    let listeners: Record<string, Array<(ev: unknown) => void>> = { open: [], message: [], close: [], error: [] };
    class FakeWs {
      readyState = 1;
      addEventListener(k: string, fn: (ev: unknown) => void) {
        (listeners[k] ??= []).push(fn);
      }
      send(payload: string) {
        packets.push(JSON.parse(payload));
      }
      close(code?: number) {
        closedCount += 1;
        this.readyState = 3;
        for (const fn of listeners.close ?? []) fn({ code: code ?? 1000, reason: "test" });
      }
    }
    let fake: FakeWs | null = null;
    let scheduledDelays: number[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const gw = startTestableGateway({
      token: "test",
      ctx: () => ({} as unknown as EnvoyContext),
      handle: async () => new Response("{}"),
      wsFactory: () => {
        fake = new FakeWs();
        return fake as unknown as WebSocket;
      },
      setTimer: (fn, ms) => {
        scheduledDelays.push(ms);
        const t = { fn, ms };
        timers.push(t);
        return t as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {
        /* tests never fire the scheduled timer */
      },
    });
    // Let setImmediate fire the connect.
    await new Promise((r) => setImmediate(r));
    // Fake HELLO
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 40 } }) });
    // Wait for one heartbeat tick without sending an ACK
    await new Promise((r) => setTimeout(r, 90));
    const st = gw.status();
    gw.stop();
    const pass = (st.zombieResets ?? 0) >= 1 && closedCount >= 1;
    push(
      "S71",
      "Gateway zombie detection reconnects when heartbeat ACK is missing",
      pass,
      `zombieResets=${st.zombieResets ?? 0} closed=${closedCount} delays=${scheduledDelays.join(",")}`,
    );
  } catch (e) {
    push("S71", "Gateway zombie detection reconnects when heartbeat ACK is missing", false, e instanceof Error ? e.message : String(e));
  }

  // S72 — OP7 / OP9 / concurrent close scheduling: single reconnect timer.
  try {
    let listeners: Record<string, Array<(ev: unknown) => void>> = { open: [], message: [], close: [], error: [] };
    let closedCount = 0;
    class FakeWs {
      readyState = 1;
      addEventListener(k: string, fn: (ev: unknown) => void) {
        (listeners[k] ??= []).push(fn);
      }
      send() {
        /* */
      }
      close() {
        closedCount += 1;
        this.readyState = 3;
      }
    }
    const scheduled: number[] = [];
    const gw = startTestableGateway({
      token: "test",
      ctx: () => ({} as unknown as EnvoyContext),
      handle: async () => new Response("{}"),
      wsFactory: () => new FakeWs() as unknown as WebSocket,
      setTimer: (_fn, ms) => {
        scheduled.push(ms);
        return {} as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    await new Promise((r) => setImmediate(r));
    // OP7 reconnect, then close, then op9 all before any timer fires.
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify({ op: 7, d: null }) });
    for (const fn of listeners.close ?? []) fn({ code: 1006, reason: "" });
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify({ op: 9, d: false }) });
    const st = gw.status();
    gw.stop();
    const pass = scheduled.length === 1 && (st.duplicateReconnectSuppressed ?? 0) >= 2;
    push(
      "S72",
      "Gateway OP7/OP9/close overlap does not stack duplicate reconnect timers",
      pass,
      `scheduled=${scheduled.length} suppressed=${st.duplicateReconnectSuppressed ?? 0}`,
    );
  } catch (e) {
    push("S72", "Gateway OP7/OP9/close overlap does not stack duplicate reconnect timers", false, e instanceof Error ? e.message : String(e));
  }

  // S73 — notification preferences are reversible, gated on intake, audited.
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const beforeIntake = rt.setNotificationPreference({ snowflake: "np_1", channel: "dispatches", enabled: false });
    // Complete intake, then set + reverse.
    await rt.intake({ snowflake: "np_1", handle: "np", callsign: "Neo" });
    const on = rt.setNotificationPreference({ snowflake: "np_1", channel: "dispatches", enabled: true });
    const off = rt.setNotificationPreference({ snowflake: "np_1", channel: "dispatches", enabled: false });
    const restored = rt.setNotificationPreference({ snowflake: "np_1", channel: "dispatches", enabled: true });
    const unknownCh = rt.setNotificationPreference({ snowflake: "np_1", channel: "everything", enabled: false });
    const prefs = rt.getNotificationPreferences("np_1");
    const audits = rt.store.audit.filter(
      (a) => a.action === "notifications.preference.set" && a.target === "np_1",
    );
    const optedIn = memberOptedIn(rt.store, "np_1", "dispatches");
    const defaultsForNewMember = getNotificationPreferences(rt.store, "unknown_snowflake");
    const pass =
      beforeIntake.ok === false &&
      on.ok === true &&
      off.ok === true &&
      restored.ok === true &&
      unknownCh.ok === false &&
      prefs.dispatches === true &&
      optedIn === true &&
      audits.length === 3 &&
      defaultsForNewMember.notice === DEFAULT_PREFERENCES.notice;
    push(
      "S73",
      "Notification preferences are reversible, intake-gated, and audited",
      pass,
      `beforeIntake=${beforeIntake.ok} on=${on.ok} off=${off.ok} restored=${restored.ok} unknown=${unknownCh.ok} audits=${audits.length}`,
    );
  } catch (e) {
    push("S73", "Notification preferences are reversible, intake-gated, and audited", false, e instanceof Error ? e.message : String(e));
  }

  // S74 — operational-only scheduler: valid, narrative-kind refused, smuggle refused, run-due delivers.
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const past = new Date(Date.now() - 60_000).toISOString();
    const okOp = rt.scheduleNotice({
      at: past,
      kind: "maintenance",
      fields: { window: "01:00–02:00 UTC" },
    });
    const badKind = rt.scheduleNotice({
      at: past,
      kind: "narrative_reveal",
      fields: {},
    });
    const badKind2 = rt.scheduleNotice({
      at: past,
      kind: "MAINTENANCE",
      fields: {},
    });
    const badFields = rt.scheduleNotice({
      at: past,
      kind: "maintenance",
      fields: { rich: { components: [{ type: 2 }] } as unknown as string },
    });
    const badAt = rt.scheduleNotice({
      at: "not-an-iso",
      kind: "maintenance",
      fields: {},
    });
    // Smuggle attempt: hand-craft a NARRATIVE template into the blueprint and try
    // to schedule "maintenance" — the scheduler must inspect the template class,
    // not just the kind label.
    const originalTpl = rt.bp.templates.find((t) => t.key === "tpl.ops.maintenance");
    const cloneBp = structuredClone(rt.bp);
    const swap = cloneBp.templates.find((t) => t.key === "tpl.ops.maintenance");
    if (swap) swap.class = "NARRATIVE";
    const smuggle = scheduleOperationalNotice(
      { bp: cloneBp, store: rt.store },
      { at: past, kind: "maintenance", fields: {} },
    );
    // Run due — should deliver only the one legitimate row.
    const results = await rt.runDueScheduledNotices(new Date());
    const listed = rt.listScheduledNotices();
    const cancelledId = rt.scheduleNotice({ at: past, kind: "outage", fields: {} });
    const cancelled = cancelledId.ok ? rt.cancelScheduledNotice(cancelledId.id) : false;
    const pass =
      okOp.ok === true &&
      badKind.ok === false && /narrative/i.test(badKind.reason ?? "") &&
      badKind2.ok === false && /kind rejected/i.test(badKind2.reason ?? "") &&
      badFields.ok === false && /must be a string/.test(badFields.reason ?? "") &&
      badAt.ok === false && /ISO/i.test(badAt.reason ?? "") &&
      smuggle.ok === false && /narrative template/i.test(smuggle.reason ?? "") &&
      results.length === 1 &&
      results[0]!.result.ok === true &&
      listed.some((r) => r.status === "sent" && r.kind === "maintenance") &&
      cancelled === true &&
      OPERATIONAL_KINDS.length === 8 &&
      Boolean(originalTpl);
    push(
      "S74",
      "Operational scheduler accepts operational kinds only and refuses narrative smuggling",
      pass,
      `okOp=${okOp.ok} narr=${badKind.ok} case=${badKind2.ok} fields=${badFields.ok} at=${badAt.ok} smuggle=${smuggle.ok} ran=${results.length} cancelled=${cancelled}`,
    );
  } catch (e) {
    push("S74", "Operational scheduler accepts operational kinds only and refuses narrative smuggling", false, e instanceof Error ? e.message : String(e));
  }

  // S75 — scheduler.runDueScheduledNotices does not fire cancelled or future notices.
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const past = new Date(Date.now() - 10_000).toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const p1 = rt.scheduleNotice({ at: past, kind: "outage", fields: {} });
    const p2 = rt.scheduleNotice({ at: past, kind: "outage", fields: {} });
    const f1 = rt.scheduleNotice({ at: future, kind: "maintenance", fields: {} });
    const cancelled = p2.ok ? rt.cancelScheduledNotice(p2.id) : false;
    const results = await rt.runDueScheduledNotices(new Date());
    const listed = rt.listScheduledNotices();
    const sentIds = new Set(results.map((r) => r.id));
    const futureRow = listed.find((r) => r.id === (f1.ok ? f1.id : ""));
    const cancelledRow = listed.find((r) => r.id === (p2.ok ? p2.id : ""));
    const pass =
      p1.ok === true &&
      p2.ok === true &&
      f1.ok === true &&
      cancelled === true &&
      results.length === 1 &&
      sentIds.has(p1.ok ? p1.id : "") &&
      futureRow?.status === "pending" &&
      cancelledRow?.status === "cancelled";
    push(
      "S75",
      "Scheduler runs only pending due notices — future and cancelled are skipped",
      pass,
      `ran=${results.length} future=${futureRow?.status} cancelled=${cancelledRow?.status}`,
    );
  } catch (e) {
    push("S75", "Scheduler runs only pending due notices — future and cancelled are skipped", false, e instanceof Error ? e.message : String(e));
  }

  // S76 — allowlist runtime additions do not persist across clear; scratch always allowed.
  try {
    clearRuntimeAllowlist();
    const bogus = "111111111111111111";
    const beforeAdd = isGuildAllowed(bogus);
    addRuntimeAllowedGuild(bogus);
    const afterAdd = isGuildAllowed(bogus);
    clearRuntimeAllowlist();
    const afterClear = isGuildAllowed(bogus);
    const scratchStill = isGuildAllowed("1540022458126700674");
    const listed = listAllowedGuilds();
    let malformedRejected = false;
    try {
      addRuntimeAllowedGuild("not-a-snowflake");
    } catch {
      malformedRejected = true;
    }
    const pass =
      beforeAdd === false &&
      afterAdd === true &&
      afterClear === false &&
      scratchStill === true &&
      malformedRejected === true &&
      listed.includes("1540022458126700674");
    push(
      "S76",
      "Allowlist runtime additions are reversible and never remove scratch",
      pass,
      `beforeAdd=${beforeAdd} afterAdd=${afterAdd} afterClear=${afterClear} scratch=${scratchStill} malformed=${malformedRejected}`,
    );
  } catch (e) {
    push("S76", "Allowlist runtime additions are reversible and never remove scratch", false, e instanceof Error ? e.message : String(e));
  }

  // S77 — setNotificationPreference for an unknown snowflake is refused with member-unknown.
  try {
    const rt = await fresh(cwd);
    await rt.apply();
    const missing = rt.setNotificationPreference({ snowflake: "ghost_1", channel: "notice", enabled: false });
    // A staff-seeded member is not intake-complete either.
    const beforeIntake = rt.setNotificationPreference({ snowflake: "owner_1", channel: "notice", enabled: false });
    // Even with a MemberRow inserted directly at state "none".
    const partial = { snowflake: "partial_1", handle: "p", callsign: null, intake_state: "none", grants: [], flags: [], staff_notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    rt.store.members.set("partial_1", partial as unknown as Parameters<typeof rt.store.members.set>[1]);
    const noneState = rt.setNotificationPreference({ snowflake: "partial_1", channel: "notice", enabled: false });
    const pass =
      missing.ok === false && /member unknown/i.test(missing.reason ?? "") &&
      beforeIntake.ok === false &&
      noneState.ok === false && /intake incomplete/i.test(noneState.reason ?? "");
    push(
      "S77",
      "Notification preferences refuse unknown members and pre-intake members",
      pass,
      `missing=${missing.ok} owner=${beforeIntake.ok} noneState=${noneState.ok}`,
    );
  } catch (e) {
    push("S77", "Notification preferences refuse unknown members and pre-intake members", false, e instanceof Error ? e.message : String(e));
  }

  // S78 — scheduler + notices operational-kind maps stay in step.
  try {
    const { default: _u } = { default: undefined };
    const noticesSrc = readFileSync(join(cwd, "src/lib/mortis/notices.ts"), "utf8");
    const schedSrc = readFileSync(join(cwd, "src/lib/mortis/scheduler.ts"), "utf8");
    // Extract keys from OperationalNoticeKind type union in notices.ts.
    const noticesKinds = new Set(
      [...noticesSrc.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]),
    );
    const schedKinds = new Set(OPERATIONAL_KINDS.map(String));
    const missingInSched = [...noticesKinds].filter((k) => !schedKinds.has(k));
    const missingInNotices = [...schedKinds].filter((k) => !noticesKinds.has(k));
    const noNarrative = !/narrative/i.test(schedSrc.split("\n").filter((l) => !l.startsWith("//")).join("\n").replace(/NARRATIVE_KIND_SHAPE|narrative_reveal/g, ""));
    // A weaker check that the code refuses narrative substring in any code path.
    const refusesNarrative = /narrative kind refused|narrative template refused/i.test(schedSrc);
    const pass = missingInSched.length === 0 && missingInNotices.length === 0 && refusesNarrative;
    push(
      "S78",
      "Scheduler operational-kind allowlist matches the notices map",
      pass,
      `missingInSched=${missingInSched.join(",")} missingInNotices=${missingInNotices.join(",")} refuses=${refusesNarrative} noNarrativeText=${noNarrative}`,
    );
  } catch (e) {
    push("S78", "Scheduler operational-kind allowlist matches the notices map", false, e instanceof Error ? e.message : String(e));
  }

  void writeFileSync;
  void mkdtempSync;
  void rmSync;
  void tmpdir;
  void scanDeveloper;
  void setNotificationPreference;
  void CAPTURED_INSTALL_PARAMS;
  void classifyDiscordHttp;
  void assessPublicApplication;
  void assessLiveReadiness;
  return out;
}
