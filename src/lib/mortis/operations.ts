/**
 * S81 — safe operational tick.
 *
 * A single entry point an operator (or a cron) can call to run every routine
 * operational job in one pass:
 *
 *   1. Fire any due scheduled notices via {@link runDueScheduledNotices}.
 *      Delivery still goes through `dispatch.send`.
 *   2. Assess health via {@link assessHealth}. New HOLD findings (findings
 *      that were not present in the previous tick) are appended to the
 *      envoy audit log with action `operations.health.hold`. Existing HOLDs
 *      are not re-appended — debounced by finding-code + target signature.
 *
 * What this function DOES NOT do (by design):
 *   - Auto-repair drift. Drift is report-only; the operator repairs on Apply.
 *   - Restart the gateway. Reconnect is the gateway's own S71/S72 job.
 *   - Post any NARRATIVE material. This tick can only fire what was already
 *     enqueued via {@link scheduleOperationalNotice}, which rejects narrative.
 *   - Escalate permissions. Never Administrator, never widened bits.
 *
 * The tick is idempotent — repeat calls with the same state do nothing new.
 */

import type { MortisRuntime } from "./runtime.ts";
import type { OperationalNoticeKind } from "./notices.ts";
import type { DispatchResult } from "./types.ts";

export type OperationalTickReport = {
  ranAt: string;
  scheduled: Array<{ id: string; kind: OperationalNoticeKind; result: DispatchResult }>;
  health: {
    ok: boolean;
    holds: number;
    warns: number;
    newHolds: Array<{ code: string; target: string; severity: string; detail?: string }>;
  };
  gateway: { connected: boolean; lastEvent?: string; lastError?: string };
};

/** Signature used to debounce repeat health alerts. */
function signHold(f: { code: string; target?: string }): string {
  return `${f.code}::${f.target ?? ""}`;
}

/** Persist a moving set of already-audited holds across ticks. */
const heldFingerprints = new WeakMap<MortisRuntime, Set<string>>();

export async function runOperationalTick(
  runtime: MortisRuntime,
  now: Date = new Date(),
): Promise<OperationalTickReport> {
  const scheduled = await runtime.runDueScheduledNotices(now);
  const health = runtime.health();

  const seen = heldFingerprints.get(runtime) ?? new Set<string>();
  const newHolds: OperationalTickReport["health"]["newHolds"] = [];
  for (const f of health.findings) {
    if (f.severity !== "hold") continue;
    const sig = signHold(f);
    if (seen.has(sig)) continue;
    seen.add(sig);
    newHolds.push({
      code: f.code,
      target: f.target ?? "",
      severity: f.severity,
      detail: (f as { detail?: string }).detail,
    });
    runtime.store.appendAudit({
      actor: "operations-tick",
      action: "operations.health.hold",
      target: f.target ?? "guild",
      details: { code: f.code, severity: f.severity, detail: (f as { detail?: string }).detail ?? null },
      outcome: "fail",
    });
  }
  // If a fingerprint stopped appearing this tick, forget it so a recurrence
  // will alert again.
  const stillSeen = new Set(health.findings.filter((f) => f.severity === "hold").map((f) => signHold(f)));
  for (const sig of seen) if (!stillSeen.has(sig)) seen.delete(sig);
  heldFingerprints.set(runtime, seen);

  const gateway = runtime.snapshot().live.gateway ?? { connected: false };

  runtime.store.appendAudit({
    actor: "operations-tick",
    action: "operations.tick",
    target: "guild",
    details: {
      ranAt: now.toISOString(),
      firedNotices: scheduled.length,
      holds: health.findings.filter((f) => f.severity === "hold").length,
      warns: health.findings.filter((f) => f.severity === "warn").length,
      gatewayConnected: Boolean(gateway.connected),
    },
    outcome: "ok",
  });

  return {
    ranAt: now.toISOString(),
    scheduled,
    health: {
      ok: health.ok,
      holds: health.findings.filter((f) => f.severity === "hold").length,
      warns: health.findings.filter((f) => f.severity === "warn").length,
      newHolds,
    },
    gateway: {
      connected: Boolean(gateway.connected),
      lastEvent: gateway.lastEvent,
      lastError: gateway.lastError,
    },
  };
}

/**
 * Reset the debounce state for a runtime. Test-only — callers in production
 * never need this because holds naturally forget once they clear.
 */
export function resetHoldFingerprintsForTest(runtime: MortisRuntime): void {
  heldFingerprints.delete(runtime);
}
