"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SignedGate } from "@/components/signed-gate";
import { getSnapshot } from "@/lib/mortis/server";

export const Route = createFileRoute("/audit")({ component: Page });

function Page() {
  return (
    <SignedGate>
      <Audit />
    </SignedGate>
  );
}

function Audit() {
  const snap = useQuery({ queryKey: ["snapshot"], queryFn: () => getSnapshot() });
  const rows = [...(snap.data?.audit ?? [])].reverse();
  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] tracking-[0.28em] text-brass uppercase">Append-only</p>
        <h1 className="font-display text-3xl tracking-[0.1em]">Audit</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          Provisioning, intake, tickets, grants, and every outbound dispatch write a row. Player-facing dispatches are mirrored to staff.audit.
        </p>
      </header>
      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead className="bg-raised text-[10px] tracking-[0.16em] uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  No audit rows until the first apply, intake, ticket, or dispatch.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums text-muted">{r.at.slice(11, 19)}</td>
                <td className="px-3 py-2">{r.actor}</td>
                <td className="px-3 py-2">{r.action}</td>
                <td className="px-3 py-2 text-muted">{r.target ?? "—"}</td>
                <td className="px-3 py-2">{r.outcome ?? ""}{r.mirrored ? " · mirrored" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
