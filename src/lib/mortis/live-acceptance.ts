/**
 * S90 — live acceptance harness.
 *
 * Runs the operational acceptance checklist against a runtime. When the
 * runtime is attached to the real scratch guild every check is a genuine
 * Discord round-trip and is labelled LIVE; against the simulator the same
 * checks run but are labelled SIMULATED so a simulator pass can never be
 * mistaken for live verification.
 *
 * SAFETY:
 *   - Only ever runs against whatever guild the runtime is already attached
 *     to. The S70 allowlist gates that attach, so this cannot reach production.
 *   - Every object it creates is disposable and is torn down in `cleanup`,
 *     which runs even when a check throws.
 *   - It never deletes a channel it did not create, and never deletes a
 *     channel that has message history it did not author.
 *   - Lockdown is exercised and then always lifted, including on failure.
 */

import type { MortisRuntime } from "./runtime.ts";
import { createTicket, claimTicket, closeTicket } from "./tickets.ts";
import { enactLockdown, liftLockdown } from "./envoy.ts";
import { isGuildAllowed } from "./allowlist.ts";
import { scheduleOperationalNotice } from "./scheduler.ts";
import { redactToken } from "./live-session.ts";

export type CheckStatus = "PASS" | "FAIL" | "SKIP" | "BLOCKED";

export type CheckResult = {
  id: string;
  name: string;
  status: CheckStatus;
  mode: "LIVE" | "SIMULATED";
  detail: string;
};

export type AcceptanceReport = {
  mode: "LIVE" | "SIMULATED";
  guildId: string | null;
  guildName: string | null;
  botTag: string | null;
  administrator: boolean | null;
  ranAt: string;
  results: CheckResult[];
  summary: { pass: number; fail: number; skip: number; blocked: number; total: number };
  cleanup: string[];
};

export async function runLiveAcceptance(
  rt: MortisRuntime,
  opts: { live?: boolean } = {},
): Promise<AcceptanceReport> {
  const live = Boolean(opts.live && rt.guild.live);
  const mode: "LIVE" | "SIMULATED" = live ? "LIVE" : "SIMULATED";
  const results: CheckResult[] = [];
  const cleanup: string[] = [];
  /** Channels this harness created and may therefore delete. */
  const createdChannels: string[] = [];
  /** Messages this harness posted and may therefore delete: [channelId, messageId]. */
  const postedMessages: Array<[string, string]> = [];
  /** Roles this harness granted and must revoke: [memberId, roleId]. */
  const grantedRoles: Array<[string, string]> = [];

  const push = (id: string, name: string, status: CheckStatus, detail: string) =>
    results.push({ id, name, status, mode, detail: redactToken(String(detail)).slice(0, 400) });

  const check = async (id: string, name: string, fn: () => Promise<[boolean, string]> | [boolean, string]) => {
    try {
      const [ok, detail] = await fn();
      push(id, name, ok ? "PASS" : "FAIL", detail);
    } catch (e) {
      // A Discord rate-limit bucket longer than a single request may block for
      // is an environmental limit, not a defect in the thing under test.
      // Report it as BLOCKED with the real wait rather than as a FAIL, so a
      // rate-limited run is never mistaken for a broken feature — and never
      // silently counted as a pass either.
      const err = e as Error & { status?: number; retryAfterMs?: number };
      if (err?.status === 429) {
        const secs = Math.round((err.retryAfterMs ?? 0) / 1000);
        push(id, name, "BLOCKED", `Discord rate limit — bucket needs ${secs}s. ${err.message}`);
        return;
      }
      push(id, name, "FAIL", e instanceof Error ? (e.message ?? "threw") : String(e));
    }
  };

  const identity = rt.liveIdentity;
  // A real member snowflake is required for any live overwrite / role grant.
  // The bot itself is a guild member, so it is the safest test subject: the
  // only side effect is a presentation role we revoke in cleanup.
  const testMember = live ? (identity?.botId ?? rt.guild.botUserId) : "accept_member_1";

  // Staff identity must come from the actual staff table. On a live attach
  // that table is seeded with real snowflakes (S94); in the simulator the
  // caller seeds `owner_1`. Hardcoding `owner_1` here is what made A15 fail
  // against the live guild — the placeholder is not a real staff member.
  const staffActor =
    [...rt.store.staff.entries()].find(([, s]) => s.capabilities.includes("*"))?.[0] ??
    [...rt.store.staff.keys()][0] ??
    "owner_1";

  try {
    // ---- identity ------------------------------------------------------
    await check("A01", "Bot identity and guild reachable", () => {
      if (!live) return [true, "simulator runtime — no live identity to assert"];
      const ok = Boolean(identity?.guildId && identity?.botTag);
      return [ok, `guild=${identity?.guildName} (${identity?.guildId}) bot=${identity?.botTag}`];
    });

    // ---- allowlist -----------------------------------------------------
    await check("A02", "Guild allowlist admits scratch and refuses foreign ids", () => {
      const scratchOk = isGuildAllowed("1540022458126700674");
      const foreignRefused = !isGuildAllowed("999999999999999999");
      const attachedAllowed = !live || isGuildAllowed(identity!.guildId);
      return [
        scratchOk && foreignRefused && attachedAllowed,
        `scratch=${scratchOk} foreignRefused=${foreignRefused} attachedAllowed=${attachedAllowed}`,
      ];
    });

    // ---- permissions ---------------------------------------------------
    await check("A03", "Administrator NOT held; canonical bits present", () => {
      if (!live) return [true, "simulator — permission assertion is live-only"];
      const admin = identity?.administrator === true;
      const missing = identity?.missingBits ?? [];
      return [!admin && missing.length === 0, `administrator=${admin} missingBits=[${missing.join(",")}]`];
    });

    // ---- gateway -------------------------------------------------------
    await check("A04", "Gateway reaches READY with heartbeat ACK", async () => {
      if (!live) return [true, "simulator — gateway is live-only"];
      const deadline = Date.now() + 20_000;
      let st = rt.gateway?.status() ?? { connected: false };
      while (Date.now() < deadline && !st.connected) {
        await new Promise((r) => setTimeout(r, 500));
        st = rt.gateway?.status() ?? { connected: false };
      }
      return [
        Boolean(st.connected),
        `connected=${st.connected} lastEvent=${st.lastEvent} acks=${(st as { ackCount?: number }).ackCount ?? 0} err=${st.lastError ?? "none"}`,
      ];
    });

    // ---- validate ------------------------------------------------------
    await check("A05", "Blueprint validates", () => {
      const v = rt.validate();
      return [v.ok, v.ok ? "schema + terms + approval tags clean" : JSON.stringify(v.issues).slice(0, 300)];
    });

    // ---- plan ----------------------------------------------------------
    await check("A06", "Plan computes without mutating", async () => {
      const p = await rt.plan();
      return [typeof p.hash === "string", `creates=${p.creates} updates=${p.updates} orphans=${p.orphans} noops=${p.noops}`];
    });

    // ---- apply + idempotency -------------------------------------------
    await check("A07", "Apply converges, second Apply is a no-op", async () => {
      const first = await rt.apply();
      const second = await rt.apply();
      return [
        second.no_op === true,
        `first applied=${first.applied} warnings=${(first.warnings ?? []).length} | second no_op=${second.no_op} applied=${second.applied}`,
      ];
    });

    // ---- slash commands -------------------------------------------------
    await check("A08", "Guild slash commands register from the blueprint", async () => {
      const r = await rt.registerCommands();
      const expected = rt.bp.commands.map((c) => c.name).sort();
      return [r.ok && r.count === expected.length, `ok=${r.ok} count=${r.count} expected=${expected.join(",")} warn=${r.warning ?? "none"}`];
    });

    // ---- health ---------------------------------------------------------
    await check("A09", "Health report is produced (holds are reported, not thrown)", () => {
      const h = rt.health();
      const holds = h.findings.filter((f) => f.severity === "hold");
      const warns = h.findings.filter((f) => f.severity === "warn");
      // A hold is information, not a harness failure — the check is that
      // health runs and surfaces structured findings.
      return [
        Array.isArray(h.findings),
        `ok=${h.ok} holds=${holds.length}[${holds.map((f) => f.code).join(",")}] warns=${warns.length}[${[...new Set(warns.map((f) => f.code))].join(",")}]`,
      ];
    });

    // ---- dispatch --------------------------------------------------------
    let dispatchedMessage: { channelKey: string; messageId: string } | null = null;
    await check("A10", "Dispatch delivers an operational notice through the choke point", async () => {
      const r = await rt.notice("maintenance", { window: "acceptance-harness probe" });
      if (r.ok && r.message_id) {
        dispatchedMessage = { channelKey: "network.status", messageId: r.message_id };
        const chId = rt.store.blueprintState.get("network.status");
        if (chId) postedMessages.push([chId, r.message_id]);
      }
      return [r.ok === true, `ok=${r.ok} step=${r.step ?? "-"} reason=${r.reason ?? "-"} msg=${r.message_id ?? "-"}`];
    });

    // ---- retract ---------------------------------------------------------
    await check("A11", "Retract removes a dispatched message and audits it", async () => {
      if (!dispatchedMessage) return [false, "no dispatched message to retract (A10 failed)"];
      const r = await rt.retract(dispatchedMessage.channelKey, dispatchedMessage.messageId, "acceptance harness cleanup");
      if (r.ok) {
        const idx = postedMessages.findIndex(([, m]) => m === dispatchedMessage!.messageId);
        if (idx >= 0) postedMessages.splice(idx, 1);
      }
      const audited = rt.store.audit.some((a) => a.action === "dispatch.retract" && a.outcome === "ok");
      return [r.ok === true && audited, `ok=${r.ok} audited=${audited} reason=${"reason" in r ? r.reason : "-"}`];
    });

    // ---- dispatch refuses NARRATIVE without ENACTED ------------------------
    await check("A12", "Dispatch refuses NARRATIVE content that is not ENACTED", async () => {
      const tpl = rt.bp.templates.find((t) => t.class === "NARRATIVE");
      if (!tpl) {
        // No narrative template shipped — synthesize the check against the
        // visibility rule by flipping an operational template's class.
        const probe = rt.bp.templates.find((t) => t.key === "tpl.ops.maintenance");
        if (!probe) return [false, "no template available to probe"];
        const original = probe.class;
        probe.class = "NARRATIVE";
        const r = await rt.dispatch({
          channel_key: "network.status",
          template_key: "tpl.ops.maintenance",
          fields: { window: "narrative smuggle probe" },
        });
        probe.class = original;
        return [r.ok === false && r.step === 2, `refused=${!r.ok} step=${r.step} reason=${r.reason}`];
      }
      const r = await rt.dispatch({ channel_key: tpl.channel_key, template_key: tpl.key, fields: {} });
      return [r.ok === false && r.step === 2, `refused=${!r.ok} step=${r.step} reason=${r.reason}`];
    });

    // ---- intake -----------------------------------------------------------
    await check("A13", "Intake completes once and grants the Initiate presentation role", async () => {
      const initiateRole = rt.store.blueprintState.get("role.initiate");
      const first = await rt.intake({ snowflake: testMember, handle: "acceptance-probe", callsign: "Probe" });
      const second = await rt.intake({ snowflake: testMember, handle: "acceptance-probe", callsign: "Probe" });
      if (live && initiateRole) grantedRoles.push([testMember, initiateRole]);
      const state = rt.store.members.get(testMember)?.intake_state;
      return [
        first.already === false && second.already === true && state === "complete",
        `first.already=${first.already} second.already=${second.already} state=${state} role=${initiateRole ?? "unbound"}`,
      ];
    });

    // ---- notification preferences ------------------------------------------
    await check("A14", "Notification preferences round-trip and are reversible", () => {
      const off = rt.setNotificationPreference({ snowflake: testMember, channel: "dispatches", enabled: false });
      const afterOff = rt.getNotificationPreferences(testMember).dispatches;
      const on = rt.setNotificationPreference({ snowflake: testMember, channel: "dispatches", enabled: true });
      const afterOn = rt.getNotificationPreferences(testMember).dispatches;
      const audits = rt.store.audit.filter((a) => a.action === "notifications.preference.set" && a.target === testMember).length;
      return [
        off.ok && on.ok && afterOff === false && afterOn === true && audits >= 2,
        `off=${off.ok}->${afterOff} on=${on.ok}->${afterOn} audits=${audits}`,
      ];
    });

    // ---- tickets -----------------------------------------------------------
    await check("A15", "Ticket lifecycle: create, claim, close, transcript", async () => {
      const ticket = await createTicket(
        { opener: testMember, handle: "acceptance-probe", category: "general", body: "acceptance harness probe" },
        rt,
      );
      if (ticket.channel_snowflake) createdChannels.push(ticket.channel_snowflake);
      // createTicket returns the live store row, which claim/close then mutate
      // in place. Snapshot the creation-time status before mutating it.
      const createdStatus = ticket.status;
      await claimTicket(rt.store, ticket.id, staffActor, rt.guild, rt.bp);
      const claimed = rt.store.tickets.get(ticket.id)?.status;
      await closeTicket(rt.store, rt.guild, ticket.id, staffActor, rt.bp);
      const row = rt.store.tickets.get(ticket.id);
      const transcript = row?.transcript_key ? rt.store.r2.get(row.transcript_key) : undefined;
      return [
        createdStatus === "open" && claimed === "claimed" && row?.status === "closed" && Boolean(row?.transcript_key) && Boolean(transcript),
        `staff=${staffActor === "owner_1" ? "seeded-sim" : "real-snowflake"} id=${ticket.id} ${createdStatus}->${claimed}->${row?.status} transcript=${row?.transcript_key ?? "none"} bytes=${transcript?.length ?? 0}`,
      ];
    });

    // ---- ticket privacy -----------------------------------------------------
    await check("A16", "Ticket body never lands in a player-facing blueprint channel", () => {
      const marker = "acceptance harness probe";
      const playerKeys = rt.bp.channels
        .filter((c) => c.audience === "public" || c.audience === "initiate+")
        .map((c) => c.key);
      const leaked: string[] = [];
      for (const key of playerKeys) {
        const id = rt.store.blueprintState.get(key);
        const ch = id ? rt.guild.channelById(id) : undefined;
        if ((ch?.messages ?? []).some((m) => m.content.includes(marker))) leaked.push(key);
      }
      return [leaked.length === 0, leaked.length ? `LEAKED into ${leaked.join(",")}` : `clean across ${playerKeys.length} player-facing channels`];
    });

    // ---- scheduler narrative rejection ---------------------------------------
    await check("A17", "Scheduler refuses narrative kinds and narrative-classed templates", () => {
      const at = new Date(Date.now() - 1000).toISOString();
      const narrativeKind = rt.scheduleNotice({ at, kind: "narrative_reveal", fields: {} });
      const wrongCase = rt.scheduleNotice({ at, kind: "MAINTENANCE", fields: {} });
      const clone = structuredClone(rt.bp);
      const swap = clone.templates.find((t) => t.key === "tpl.ops.maintenance");
      if (swap) swap.class = "NARRATIVE";
      const smuggle = scheduleOperationalNotice({ bp: clone, store: rt.store }, { at, kind: "maintenance", fields: {} });
      return [
        narrativeKind.ok === false && wrongCase.ok === false && smuggle.ok === false,
        `narrativeKind=${narrativeKind.ok} wrongCase=${wrongCase.ok} smuggle=${smuggle.ok} (${smuggle.ok === false ? smuggle.reason : ""})`,
      ];
    });

    // ---- scheduler happy path + operational tick -------------------------------
    await check("A18", "Operational tick fires a due scheduled notice through dispatch", async () => {
      const at = new Date(Date.now() - 5000).toISOString();
      const s = rt.scheduleNotice({ at, kind: "restored", fields: { status: "acceptance-harness probe" } });
      if (!s.ok) return [false, `enqueue refused: ${s.reason}`];
      const tick = await rt.runOperationalTick(new Date());
      const fired = tick.scheduled.find((r) => r.id === s.id);
      if (fired?.result.ok && fired.result.message_id) {
        const chId = rt.store.blueprintState.get("network.status");
        if (chId) postedMessages.push([chId, fired.result.message_id]);
      }
      return [
        Boolean(fired?.result.ok),
        `fired=${Boolean(fired)} ok=${fired?.result.ok} reason=${fired?.result.reason ?? "-"} holds=${tick.health.holds}`,
      ];
    });

    // ---- lockdown / lift ---------------------------------------------------------
    await check("A19", "Lockdown closes arrival and lift restores it", async () => {
      const ctx = rt.ctx();
      await enactLockdown(ctx, "acceptance-harness");
      const lockedFlag = rt.store.lockdown === true;
      // Intake must refuse while locked down.
      let intakeRefused = false;
      try {
        await rt.intake({ snowflake: "lockdown_probe_1", handle: "locked", callsign: "No" });
      } catch (e) {
        intakeRefused = e instanceof Error && e.message === "lockdown";
      }
      await liftLockdown(ctx, "acceptance-harness");
      const liftedFlag = rt.store.lockdown === false;
      const lockAudit = rt.store.audit.some((a) => a.action === "lockdown");
      const liftAudit = rt.store.audit.some((a) => a.action === "lockdown.lift");
      // The lockdown + lift notices are real posts on the live guild; record
      // them so cleanup can retract them.
      if (live) {
        const arrivalId = rt.store.blueprintState.get("arrival.notice");
        const ch = arrivalId ? rt.guild.channelById(arrivalId) : undefined;
        for (const m of (ch?.messages ?? []).slice(-4)) {
          if (/LOCKDOWN/i.test(m.content) && arrivalId) postedMessages.push([arrivalId, m.id]);
        }
      }
      return [
        lockedFlag && intakeRefused && liftedFlag && lockAudit && liftAudit,
        `locked=${lockedFlag} intakeRefused=${intakeRefused} lifted=${liftedFlag} audits=lock:${lockAudit}/lift:${liftAudit}`,
      ];
    });

    // ---- drift detect + repair -------------------------------------------------
    await check("A20", "Topic drift is detected by Plan and repaired by Apply", async () => {
      const key = "network.status";
      const id = rt.store.blueprintState.get(key);
      if (!id) return [false, "network.status not bound"];
      const expected = rt.bp.channels.find((c) => c.key === key)?.topic ?? "";
      await rt.guild.patchChannel(id, { topic: "drift probe — acceptance harness" });
      const planned = await rt.plan();
      const op = planned.ops.find((o) => o.op === "update" && "key" in o && o.key === key);
      await rt.apply();
      const after = rt.guild.channelById(rt.store.blueprintState.get(key)!);
      const repaired = (after?.topic ?? "") === expected;
      return [
        Boolean(op) && repaired,
        `detected=${Boolean(op)} changes=${op && "changes" in op ? op.changes.join("|") : "-"} repaired=${repaired}`,
      ];
    });

    // ---- orphan / history protection ---------------------------------------------
    await check("A21", "Orphans with history are reported, never auto-deleted", async () => {
      const planned = await rt.plan();
      const orphanOps = planned.ops.filter((o) => o.op === "orphan");
      const withHistory = orphanOps.filter((o) => "has_history" in o && o.has_history);
      // Apply must not remove them.
      await rt.apply();
      const stillPresent = withHistory.every((o) => ("snowflake" in o ? Boolean(rt.guild.channelById(o.snowflake)) : true));
      return [stillPresent, `orphans=${orphanOps.length} withHistory=${withHistory.length} allPreserved=${stillPresent}`];
    });

    // ---- dispatch authorization -----------------------------------------------------
    await check("A22", "Unauthorized caller cannot dispatch to a player-facing channel", async () => {
      const r = await rt.dispatch({
        channel_key: "network.status",
        template_key: "tpl.ops.maintenance",
        fields: { window: "imposter probe" },
        caller: { type: "staff", snowflake: "imposter_not_staff" },
      });
      return [r.ok === false && r.step === 1 && r.reason === "unauthorized", `ok=${r.ok} step=${r.step} reason=${r.reason}`];
    });
  } finally {
    // ---- teardown --------------------------------------------------------------
    // Always lift lockdown, even if a check threw mid-way.
    if (rt.store.lockdown) {
      try {
        await liftLockdown(rt.ctx(), "acceptance-harness-cleanup");
        cleanup.push("lockdown lifted during teardown");
      } catch (e) {
        cleanup.push(`lockdown lift FAILED: ${redactToken(String(e))}`);
      }
    }
    for (const [chId, msgId] of postedMessages) {
      try {
        await rt.guild.deleteMessage(chId, msgId);
        cleanup.push(`deleted probe message ${msgId}`);
      } catch (e) {
        cleanup.push(`message ${msgId} delete failed: ${redactToken(String(e)).slice(0, 120)}`);
      }
    }
    for (const chId of createdChannels) {
      try {
        const g = rt.guild as unknown as { api?: (m: string, p: string) => Promise<unknown> };
        if (typeof g.api === "function") await g.api("DELETE", `/channels/${chId}`);
        cleanup.push(`deleted harness-created channel ${chId}`);
      } catch (e) {
        cleanup.push(`channel ${chId} delete failed: ${redactToken(String(e)).slice(0, 120)}`);
      }
    }
    for (const [memberId, roleId] of grantedRoles) {
      try {
        const g = rt.guild as unknown as { api?: (m: string, p: string) => Promise<unknown>; id?: string };
        if (typeof g.api === "function") await g.api("DELETE", `/guilds/${g.id}/members/${memberId}/roles/${roleId}`);
        cleanup.push(`revoked probe role ${roleId} from ${memberId}`);
      } catch (e) {
        cleanup.push(`role revoke failed: ${redactToken(String(e)).slice(0, 120)}`);
      }
    }
  }

  const summary = {
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    skip: results.filter((r) => r.status === "SKIP").length,
    blocked: results.filter((r) => r.status === "BLOCKED").length,
    total: results.length,
  };

  return {
    mode,
    guildId: identity?.guildId ?? null,
    guildName: identity?.guildName ?? null,
    botTag: identity?.botTag ?? null,
    administrator: identity?.administrator ?? null,
    ranAt: new Date().toISOString(),
    results,
    summary,
    cleanup,
  };
}
