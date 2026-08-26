"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { SignedGate } from "@/components/signed-gate";
import { runTestsFn, runWalkthrough } from "@/lib/mortis/server";

export const Route = createFileRoute("/tests")({ component: Page });

function Page() {
  return (
    <SignedGate>
      <Tests />
    </SignedGate>
  );
}

function Tests() {
  const mut = useMutation({ mutationFn: () => runTestsFn() });
  const walk = useMutation({ mutationFn: () => runWalkthrough() });
  const groups = mut.data
    ? [
        { title: "Mandatory", rows: mut.data.mandatory },
        { title: "Supplementary", rows: mut.data.supplementary },
      ]
    : [];
  return (
    <div className="space-y-6">
      <header>
        <p className="text-micro tracking-kicker text-brass uppercase">Scratch-guild harness</p>
        <h1 className="font-display text-3xl tracking-kicker">Tests</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          T1–T9 mandatory plus S1–S53 supplementary probes. Walkthrough uses an isolated simulator and does not Apply the operator guild. A failing test is an engineering problem — never a reason to weaken the safety model.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="min-h-11 border border-brass px-4 text-kicker tracking-kicker uppercase text-brass disabled:opacity-50"
        >
          {mut.isPending ? "Running…" : "Run suite"}
        </button>
        <button
          type="button"
          onClick={() => walk.mutate()}
          disabled={walk.isPending}
          className="min-h-11 border border-line px-4 text-kicker tracking-kicker uppercase text-bone disabled:opacity-50"
        >
          {walk.isPending ? "Walking…" : "First-player walkthrough"}
        </button>
      </div>
      {walk.data && (
        <section className="border border-line bg-surface p-4">
          <h2 className="font-display text-xl tracking-kicker">{walk.data.pass ? "Walkthrough pass" : "Walkthrough fail"}</h2>
          <ul className="mt-3 space-y-2">
            {walk.data.steps.map((s) => (
              <li key={s.id} className="border border-line/70 px-3 py-2">
                <span className="text-brass">{s.id}</span> {s.pass ? "pass" : "fail"} — {s.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
      {walk.error && <p className="text-sm text-brass">{walk.error.message}</p>}
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="font-display text-xl tracking-[0.1em]">{g.title}</h2>
          <ul className="mt-3 space-y-2">
            {g.rows.map((r) => (
              <li key={r.id} className="border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p>
                    <span className="text-brass">{r.id}</span> {r.name}
                  </p>
                  <span className="text-[11px] tracking-[0.16em] uppercase">{r.pass ? "pass" : "fail"}</span>
                </div>
                <p className="mt-1 text-[12px] text-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
