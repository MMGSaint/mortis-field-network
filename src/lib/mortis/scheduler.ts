/**
 * S74 — operational-only scheduler.
 *
 * A tiny in-memory queue of operational notices to send at some future ISO time.
 * Delivery goes through {@link postOperationalNotice}, which itself is a thin
 * wrapper over `dispatch.send` — the sole player-facing choke point.
 *
 * Rules this module enforces on entry:
 *   1. Only operational notice kinds are accepted. Anything else — including
 *      strings that happen to look like an operational kind because of case
 *      or whitespace — is refused with reason "kind rejected".
 *   2. The blueprint template resolved by the notice map must be class
 *      OPERATIONAL. A future template accidentally marked NARRATIVE is
 *      refused with reason "narrative template refused" — this catches the
 *      "smuggle a narrative body through an operational kind" case.
 *   3. Field values are typechecked as string only — no nested objects or
 *      arrays that could inject Discord component payloads.
 *
 * The scheduler never enacts NARRATIVE events. NARRATIVE material continues
 * to stop at ELIGIBLE and requires ENACTED via the events module, exactly as
 * before. See invariant 3.
 */

import type { MortisRuntime } from "./runtime.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint, DispatchResult } from "./types.ts";
import { channelByKey, templateByKey } from "./blueprint.ts";
import { postOperationalNotice, type OperationalNoticeKind } from "./notices.ts";

/** Allowlist of operational kinds. Anything else is refused. */
export const OPERATIONAL_KINDS = [
  "maintenance",
  "outage",
  "deployment",
  "lockdown",
  "lockdown_lift",
  "application_update",
  "intake",
  "restored",
] as const satisfies readonly OperationalNoticeKind[];

const OPERATIONAL_KIND_SET = new Set<string>(OPERATIONAL_KINDS);

/** Reject any string that looks like NARRATIVE / event / story / reveal, regardless of case. */
const NARRATIVE_KIND_SHAPE = /^(narrative|event|story|reveal|lore|canon|dispatch_.*narrative)/i;

/** The record type stored in the queue. */
export type ScheduledNotice = {
  id: string;
  at: string;
  kind: OperationalNoticeKind;
  fields: Record<string, string>;
  created_by: string;
  created_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  last_error?: string;
  audit_id: string;
};

export type ScheduleInput = {
  at: string;
  kind: string;
  fields?: Record<string, unknown>;
  actor?: string;
};

export type ScheduleResult =
  | { ok: true; id: string; kind: OperationalNoticeKind; at: string; audit_id: string }
  | { ok: false; reason: string; audit_id?: string };

function validateFields(input: Record<string, unknown> | undefined): { ok: true; fields: Record<string, string> } | { ok: false; reason: string } {
  const out: Record<string, string> = {};
  if (!input) return { ok: true, fields: out };
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== "string") {
      return { ok: false, reason: `field ${k} must be a string (got ${typeof v}) — no component smuggling` };
    }
    out[k] = v;
  }
  return { ok: true, fields: out };
}

function validAtIso(at: string): boolean {
  if (typeof at !== "string" || at.length < 10) return false;
  const t = Date.parse(at);
  return Number.isFinite(t);
}

function templateIsOperational(bp: Blueprint, templateKey: string): boolean {
  const tpl = templateByKey(bp, templateKey);
  if (!tpl) return false;
  // A template with no explicit class defaults to OPERATIONAL in dispatch.ts
  // (see dispatchSend visibility check). NARRATIVE must be explicit.
  if (tpl.class === "NARRATIVE") return false;
  return true;
}

/**
 * Schedule an operational notice. Refuses anything that is not on the
 * OPERATIONAL_KINDS allowlist, and refuses templates flagged NARRATIVE.
 */
export function scheduleOperationalNotice(
  ctx: { bp: Blueprint; store: EnvoyStore },
  input: ScheduleInput,
): ScheduleResult {
  const audit = ctx.store.appendAudit({
    actor: input.actor ?? "owner-cli",
    action: "scheduler.enqueue",
    target: String(input.kind),
    details: { at: input.at, kind: input.kind, fieldKeys: Object.keys(input.fields ?? {}) },
    outcome: "pending",
  });

  if (typeof input.kind !== "string") {
    ctx.store.completeAudit(audit.id, "fail", { reason: "kind must be string" });
    return { ok: false, reason: "kind must be string", audit_id: audit.id };
  }
  if (NARRATIVE_KIND_SHAPE.test(input.kind)) {
    ctx.store.completeAudit(audit.id, "fail", { reason: "narrative kind refused" });
    return { ok: false, reason: `narrative kind refused: ${input.kind}`, audit_id: audit.id };
  }
  if (!OPERATIONAL_KIND_SET.has(input.kind)) {
    ctx.store.completeAudit(audit.id, "fail", { reason: "kind rejected" });
    return { ok: false, reason: `kind rejected: ${input.kind} is not an operational notice kind`, audit_id: audit.id };
  }
  if (!validAtIso(input.at)) {
    ctx.store.completeAudit(audit.id, "fail", { reason: "at is not an ISO timestamp" });
    return { ok: false, reason: "at is not an ISO timestamp", audit_id: audit.id };
  }
  const kind = input.kind as OperationalNoticeKind;

  // Templates the notice map points at must resolve, and must not be NARRATIVE.
  const noticeDest = NOTICE_MAP[kind];
  if (!noticeDest) {
    ctx.store.completeAudit(audit.id, "fail", { reason: "notice map lookup missing" });
    return { ok: false, reason: "notice map lookup missing", audit_id: audit.id };
  }
  if (!templateIsOperational(ctx.bp, noticeDest.template_key)) {
    ctx.store.completeAudit(audit.id, "fail", { reason: "narrative template refused" });
    return { ok: false, reason: `narrative template refused: ${noticeDest.template_key}`, audit_id: audit.id };
  }
  const channel = channelByKey(ctx.bp, noticeDest.channel_key);
  if (!channel) {
    ctx.store.completeAudit(audit.id, "fail", { reason: "notice channel missing from blueprint" });
    return { ok: false, reason: "notice channel missing from blueprint", audit_id: audit.id };
  }

  const validated = validateFields(input.fields);
  if (!validated.ok) {
    ctx.store.completeAudit(audit.id, "fail", { reason: validated.reason });
    return { ok: false, reason: validated.reason, audit_id: audit.id };
  }

  const id = ctx.store.nextId("sched");
  const row: ScheduledNotice = {
    id,
    at: input.at,
    kind,
    fields: validated.fields,
    created_by: input.actor ?? "owner-cli",
    created_at: new Date().toISOString(),
    status: "pending",
    audit_id: audit.id,
  };
  ctx.store.scheduledNotices.push(row as unknown as (typeof ctx.store.scheduledNotices)[number]);
  ctx.store.completeAudit(audit.id, "ok", { scheduled_id: id });
  return { ok: true, id, kind, at: input.at, audit_id: audit.id };
}

export function cancelScheduledNotice(store: EnvoyStore, id: string, actor = "owner-cli"): boolean {
  const row = store.scheduledNotices.find((r) => r.id === id);
  if (!row || row.status !== "pending") return false;
  row.status = "cancelled";
  store.appendAudit({
    actor,
    action: "scheduler.cancel",
    target: id,
    details: { kind: row.kind, at: row.at },
    outcome: "ok",
  });
  return true;
}

export function listScheduledNotices(store: EnvoyStore): ScheduledNotice[] {
  return store.scheduledNotices.slice() as unknown as ScheduledNotice[];
}

/**
 * Run every pending notice whose `at` is at or before `now`. Delivery goes
 * through `postOperationalNotice`, i.e. through `dispatch.send`. NARRATIVE
 * still requires ENACTED via the events module — this path only touches
 * OPERATIONAL kinds.
 */
export async function runDueScheduledNotices(
  runtime: MortisRuntime,
  now: Date = new Date(),
): Promise<Array<{ id: string; kind: OperationalNoticeKind; result: DispatchResult }>> {
  const results: Array<{ id: string; kind: OperationalNoticeKind; result: DispatchResult }> = [];
  const store = runtime.store;
  const cutoff = now.getTime();
  for (const row of store.scheduledNotices as unknown as ScheduledNotice[]) {
    if (row.status !== "pending") continue;
    if (Date.parse(row.at) > cutoff) continue;
    try {
      const r = await postOperationalNotice(runtime, row.kind, row.fields);
      row.status = r.ok ? "sent" : "failed";
      row.last_error = r.ok ? undefined : `${r.step ?? "?"}:${r.reason ?? "?"}`;
      store.appendAudit({
        actor: row.created_by,
        action: r.ok ? "scheduler.fire" : "scheduler.fire.failed",
        target: row.id,
        details: { kind: row.kind, at: row.at, reason: r.reason ?? null },
        outcome: r.ok ? "ok" : "fail",
      });
      results.push({ id: row.id, kind: row.kind, result: r });
    } catch (e) {
      row.status = "failed";
      row.last_error = e instanceof Error ? e.message : String(e);
      store.appendAudit({
        actor: row.created_by,
        action: "scheduler.fire.failed",
        target: row.id,
        details: { kind: row.kind, at: row.at, error: row.last_error },
        outcome: "fail",
      });
      results.push({
        id: row.id,
        kind: row.kind,
        result: { ok: false, step: 7, reason: row.last_error, audit_id: row.audit_id },
      });
    }
  }
  return results;
}

/** Local copy of the operational notice map, kept in step with notices.ts. */
const NOTICE_MAP: Record<OperationalNoticeKind, { channel_key: string; template_key: string }> = {
  maintenance: { channel_key: "network.status", template_key: "tpl.ops.maintenance" },
  outage: { channel_key: "network.status", template_key: "tpl.ops.outage" },
  deployment: { channel_key: "network.status", template_key: "tpl.ops.deployment" },
  lockdown: { channel_key: "arrival.notice", template_key: "tpl.ops.lockdown" },
  lockdown_lift: { channel_key: "arrival.notice", template_key: "tpl.ops.lockdown_lift" },
  application_update: { channel_key: "network.dispatches", template_key: "tpl.ops.release_notice" },
  intake: { channel_key: "network.status", template_key: "tpl.ops.intake" },
  restored: { channel_key: "network.status", template_key: "tpl.ops.restored" },
};
