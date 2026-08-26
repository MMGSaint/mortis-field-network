"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SignedGate } from "@/components/signed-gate";
import { getSnapshot, runDispatch, runNotice, runRetract } from "@/lib/mortis/server";
import type { OperationalNoticeKind } from "@/lib/mortis/notices";

export const Route = createFileRoute("/dispatch")({ component: Page });

const STEPS = [
  "Authorization",
  "Visibility validation",
  "Release / signature",
  "Restricted-term scan",
  "Developer-vocabulary scan",
  "Destination validation",
  "Dispatch",
  "Audit logging",
];

const KINDS: OperationalNoticeKind[] = [
  "deployment",
  "maintenance",
  "outage",
  "lockdown",
  "lockdown_lift",
  "intake",
  "application_update",
  "restored",
];

function Page() {
  return (
    <SignedGate>
      <Dispatch />
    </SignedGate>
  );
}

function Dispatch() {
  const qc = useQueryClient();
  const snap = useQuery({ queryKey: ["snapshot"], queryFn: () => getSnapshot() });
  const [status, setStatus] = useState("complete");
  const [asStaff, setAsStaff] = useState(true);
  const [kind, setKind] = useState<OperationalNoticeKind>("deployment");
  const [channelKey, setChannelKey] = useState("network.status");
  const [messageId, setMessageId] = useState("");
  const [reason, setReason] = useState("operator retract");
  const mut = useMutation({
    mutationFn: () =>
      runDispatch({
        data: {
          channel_key: "network.status",
          template_key: "tpl.ops.deployment",
          fields: { status },
          asStaff,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const notice = useMutation({
    mutationFn: () =>
      runNotice({
        data: {
          kind,
          fields:
            kind === "maintenance"
              ? { window: status }
              : kind === "application_update"
                ? { presentation_name: status, published_at: new Date().toISOString() }
                : { status },
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const retract = useMutation({
    mutationFn: () =>
      runRetract({
        data: { channel_key: channelKey, message_id: messageId, reason },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const last = mut.data ?? notice.data;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] tracking-[0.28em] text-brass uppercase">Choke point</p>
        <h1 className="font-display text-3xl tracking-[0.1em]">Dispatch</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          Every player-facing outbound message passes eight steps. There is no other send path. Staff posts skip 2–6. Failures block; they never redact. Application updates require a signed release excerpt.
        </p>
      </header>

      <ol className="grid gap-2 sm:grid-cols-2">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const failed = last && last.ok === false && last.step === n;
          const ok = last?.ok && n <= 8;
          return (
            <li key={s} className="flex items-start gap-3 border border-line bg-surface p-3">
              <span className="font-display text-xl tabular-nums text-brass">{String(n).padStart(2, "0")}</span>
              <div>
                <p>{s}</p>
                <p className="text-[11px] text-muted">{failed ? last.reason : ok ? "passed" : "idle"}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <form
        className="space-y-3 border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <h2 className="font-display text-lg tracking-kicker">Staff-auth probe</h2>
        <p className="text-sm text-muted">Always posts DEPLOYMENT STATUS to NETWORK STATUS. Use this to prove the staff table, not to send player notices.</p>
        <label className="block text-[11px] tracking-[0.16em] uppercase text-muted">
          Status field
          <input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={asStaff} onChange={(e) => setAsStaff(e.target.checked)} />
          Caller is on the staff table (uncheck to probe a Discord-role imposter)
        </label>
        <button type="submit" disabled={mut.isPending || !snap.data?.lastAppliedHash} className="min-h-11 border border-brass px-4 text-kicker tracking-kicker uppercase text-brass disabled:opacity-40">
          {mut.isPending ? "Sending…" : "Send staff probe"}
        </button>
      </form>

      <form
        className="space-y-3 border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          notice.mutate();
        }}
      >
        <h2 className="font-display text-lg tracking-kicker">Operational notice</h2>
        <p className="text-sm text-muted">Goes through dispatch.send only. Kind selects channel and template.</p>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as OperationalNoticeKind)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] tracking-[0.16em] uppercase text-muted">
          Status / window / presentation name
          <input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          />
        </label>
        <button
          type="submit"
          disabled={notice.isPending || !snap.data?.lastAppliedHash}
          className="min-h-11 border border-line px-4 text-kicker tracking-kicker uppercase text-bone disabled:opacity-40"
        >
          {notice.isPending ? "Sending…" : "Send operational notice"}
        </button>
        {!snap.data?.lastAppliedHash && <p className="text-muted">Apply the blueprint before dispatching.</p>}
        {kind === "application_update" && (
          <p className="text-sm text-muted">Unsigned application updates are held at step 3. Attach a signed excerpt from the Registry before this kind can post.</p>
        )}
        {last && (
          <p className="text-[12px]">
            {last.ok ? `Sent. Audit ${last.audit_id}` : `Held at step ${last.step}: ${last.reason}`}
          </p>
        )}
      </form>

      <form
        className="space-y-3 border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          retract.mutate();
        }}
      >
        <h2 className="font-display text-lg tracking-kicker">Retract</h2>
        <p className="text-sm text-muted">Operator-only. Audited. Never silent. Does not rewrite history — the message is removed and the retract is logged.</p>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Channel key
          <input
            value={channelKey}
            onChange={(e) => setChannelKey(e.target.value)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          />
        </label>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Message id
          <input
            value={messageId}
            onChange={(e) => setMessageId(e.target.value)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          />
        </label>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          />
        </label>
        <button type="submit" disabled={retract.isPending || !messageId} className="min-h-11 border border-line px-4 text-kicker tracking-kicker uppercase text-bone disabled:opacity-40">
          {retract.isPending ? "Retracting…" : "Retract message"}
        </button>
        {retract.data && (
          <p className="text-sm">{retract.data.ok ? `Retracted. Audit ${retract.data.audit_id}` : `Held: ${"reason" in retract.data ? retract.data.reason : "failed"}`}</p>
        )}
        {retract.error && <p className="text-sm text-brass">{retract.error.message}</p>}
      </form>
    </div>
  );
}
