import type {
  AuditRow,
  EventRow,
  MemberRow,
  StaffRow,
  TicketRow,
} from "./types.ts";

/** In-memory stand-in for envoy D1 + R2. Operational tables only — no canon. */
export class EnvoyStore {
  members = new Map<string, MemberRow>();
  staff = new Map<string, StaffRow>();
  blueprintState = new Map<string, string>(); // key -> snowflake
  reverseState = new Map<string, string>(); // snowflake -> key
  templates = new Map<string, { key: string; register: string; body: string; title: string; approval: string }>();
  events = new Map<string, EventRow>();
  tickets = new Map<string, TicketRow>();
  audit: AuditRow[] = [];
  r2 = new Map<string, string>();
  lastAppliedHash: string | null = null;
  priorStateSnapshots: Array<{ at: string; hash: string; state: Array<[string, string]> }> = [];
  lockdown = false;
  invitesPaused = false;
  webhookUrls = new Map<string, string>();
  /** S73 — per-member notification preferences. */
  notificationPreferences = new Map<string, Record<string, boolean>>();
  /** S74 — operational-only scheduled notices (in-memory queue). */
  scheduledNotices: Array<{
    id: string;
    at: string;
    kind: string;
    fields: Record<string, string>;
    created_by: string;
    created_at: string;
    status: "pending" | "sent" | "failed" | "cancelled";
    last_error?: string;
    audit_id: string;
  }> = [];
  seq = 1;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString().padStart(6, "0")}`;
  }

  appendAudit(row: Omit<AuditRow, "id" | "at"> & { at?: string; id?: string }): AuditRow {
    const full: AuditRow = {
      id: row.id ?? this.nextId("aud"),
      at: row.at ?? new Date().toISOString(),
      actor: row.actor,
      action: row.action,
      target: row.target,
      details: row.details,
      outcome: row.outcome ?? "ok",
      mirrored: row.mirrored ?? false,
    };
    this.audit.push(full);
    return full;
  }

  completeAudit(id: string, outcome: "ok" | "fail", extra?: Record<string, unknown>): void {
    const row = this.audit.find((a) => a.id === id);
    if (!row) return;
    row.outcome = outcome;
    if (extra) Object.assign(row.details, extra);
  }

  bind(key: string, snowflake: string): void {
    const prev = this.blueprintState.get(key);
    if (prev) this.reverseState.delete(prev);
    this.blueprintState.set(key, snowflake);
    this.reverseState.set(snowflake, key);
  }

  snapshotState(hash: string): void {
    this.priorStateSnapshots.push({
      at: new Date().toISOString(),
      hash,
      state: [...this.blueprintState.entries()],
    });
    if (this.priorStateSnapshots.length > 20) this.priorStateSnapshots.shift();
  }
}
