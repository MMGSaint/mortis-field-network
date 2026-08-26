"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SignedGate } from "@/components/signed-gate";
import { getSnapshot, runTicket, runTicketAct } from "@/lib/mortis/server";
import type { TicketCategory } from "@/lib/mortis/types";

export const Route = createFileRoute("/tickets")({ component: Page });

function Page() {
  return (
    <SignedGate>
      <Tickets />
    </SignedGate>
  );
}

function Tickets() {
  const qc = useQueryClient();
  const snap = useQuery({ queryKey: ["snapshot"], queryFn: () => getSnapshot() });
  const live = snap.data?.live.connected === true;
  const [body, setBody] = useState("Need help with access.");
  const [category, setCategory] = useState<TicketCategory>("general");
  const [opener, setOpener] = useState(live ? "" : "init_demo");
  const create = useMutation({
    mutationFn: () =>
      runTicket({
        data: { opener: opener.trim() || (live ? "" : "init_demo"), handle: "initiate", category, body },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const act = useMutation({
    mutationFn: (d: { id: string; act: "claim" | "close" | "reopen" }) => runTicketAct({ data: d }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-micro tracking-kicker text-brass uppercase">Support</p>
        <h1 className="font-display text-3xl tracking-kicker">Tickets</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          Create, claim, close, reopen. State lives in envoy, not only in Discord. Report and appeal tickets are OWNER / OPERATIONS only. Transcripts go to object storage. Live Discord requires a real member snowflake as opener.
        </p>
      </header>
      <form
        className="space-y-3 border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Opener
          <input
            value={opener}
            onChange={(e) => setOpener(e.target.value)}
            placeholder={live ? "Discord member snowflake" : "init_demo"}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
            autoComplete="off"
          />
        </label>
        {live && <p className="text-sm text-brass">Scratch is live — demo handles are refused.</p>}
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory)}
            className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone"
          >
            <option value="general">general</option>
            <option value="report">report</option>
            <option value="appeal">appeal</option>
            <option value="accessibility">accessibility</option>
          </select>
        </label>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Body
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 block min-h-24 w-full border border-line bg-ink px-3 py-2 text-bone" />
        </label>
        <button type="submit" className="min-h-11 border border-brass px-4 text-kicker tracking-kicker uppercase text-brass">
          Open ticket
        </button>
        {create.error && <p className="text-sm text-brass">Open failed: {create.error.message}</p>}
      </form>
      {act.error && <p className="text-sm text-brass">Action failed: {act.error.message}</p>}
      <ul className="space-y-2">
        {(snap.data?.tickets ?? []).length === 0 && (
          <li className="border border-line bg-surface p-4 text-muted">No tickets yet. Open one above — state lives in envoy, not only in Discord.</li>
        )}
        {(snap.data?.tickets ?? []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border border-line bg-surface p-3">
            <div>
              <p className="tabular-nums">{t.id}</p>
              <p className="text-kicker text-muted">
                {t.category} · {t.status} · {t.opener}
                {t.assignee ? ` · assignee ${t.assignee}` : ""}
                {t.created_at ? ` · ${t.created_at}` : ""}
                {t.transcript_key ? ` · ${t.transcript_key}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {t.status !== "closed" && (
                <>
                  <button type="button" className="min-h-11 border border-line px-3 text-kicker uppercase" onClick={() => act.mutate({ id: t.id, act: "claim" })}>
                    Claim
                  </button>
                  <button type="button" className="min-h-11 border border-line px-3 text-kicker uppercase" onClick={() => act.mutate({ id: t.id, act: "close" })}>
                    Close
                  </button>
                </>
              )}
              {t.status === "closed" && (
                <button type="button" className="min-h-11 border border-brass px-3 text-kicker uppercase text-brass" onClick={() => act.mutate({ id: t.id, act: "reopen" })}>
                  Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
