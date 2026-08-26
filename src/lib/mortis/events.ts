import type { EnvoyStore } from "./store.ts";
import type { EventClass, EventRow, EventState } from "./types.ts";

const ORDER: EventState[] = ["SCHEDULED", "ELIGIBLE", "ENACTED", "DISPATCHED", "ARCHIVED"];

export function createEvent(
  store: EnvoyStore,
  input: { class: EventClass; template_ref: string; payload?: Record<string, string>; audience: string },
  actor: string,
): EventRow {
  const row: EventRow = {
    id: store.nextId("evt"),
    class: input.class,
    template_ref: input.template_ref,
    payload: input.payload ?? {},
    audience: input.audience,
    state: "SCHEDULED",
    enacted_by: null,
  };
  store.events.set(row.id, row);
  store.appendAudit({ actor, action: "event.create", target: row.id, details: { class: row.class } });
  return row;
}

export function advanceEvent(store: EnvoyStore, id: string, to: EventState, actor: string): EventRow {
  const row = store.events.get(id);
  if (!row) throw new Error("unknown event");
  const fromIdx = ORDER.indexOf(row.state);
  const toIdx = ORDER.indexOf(to);
  if (toIdx !== fromIdx + 1) throw new Error(`illegal transition ${row.state} -> ${to}`);
  if (to === "ENACTED") {
    // NARRATIVE cannot skip to dispatched; enactment is explicit and authorized.
    const staff = store.staff.get(actor);
    const allowed = actor === "owner-cli" || staff?.capabilities.includes("enact") || staff?.capabilities.includes("*");
    if (!allowed) throw new Error("unauthorized");
    row.enacted_by = actor;
  }
  row.state = to;
  store.appendAudit({ actor, action: "event.advance", target: id, details: { to } });
  return row;
}

/** NARRATIVE stops here until enactment. There is no auto path. */
export function markEligible(store: EnvoyStore, id: string, actor: string): EventRow {
  return advanceEvent(store, id, "ELIGIBLE", actor);
}

export function enact(store: EnvoyStore, id: string, actor: string): EventRow {
  const row = store.events.get(id);
  if (!row) throw new Error("unknown event");
  if (row.state !== "ELIGIBLE") throw new Error("enactment requires ELIGIBLE");
  return advanceEvent(store, id, "ENACTED", actor);
}
