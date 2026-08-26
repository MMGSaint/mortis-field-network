"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SignedGate } from "@/components/signed-gate";
import { getSnapshot, runIntake, runLockdown, runLiftLockdown, runKillSwitch, runLiftKillSwitch, runHealth } from "@/lib/mortis/server";

export const Route = createFileRoute("/security")({ component: Page });

function Page() {
  return (
    <SignedGate>
      <Security />
    </SignedGate>
  );
}

function Security() {
  const qc = useQueryClient();
  const snap = useQuery({ queryKey: ["snapshot"], queryFn: () => getSnapshot() });
  const lock = useMutation({
    mutationFn: () => runLockdown(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const lift = useMutation({
    mutationFn: () => runLiftLockdown(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const intake = useMutation({
    mutationFn: () => {
      if (snap.data?.live.connected) {
        throw new Error("demo handles are simulator-only — live Discord needs a real member snowflake");
      }
      return runIntake({ data: { snowflake: "demo_player", handle: "Initiate", callsign: "Hearth" } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const kill = useMutation({
    mutationFn: () => runKillSwitch(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const liftKill = useMutation({
    mutationFn: () => runLiftKillSwitch(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const health = useMutation({
    mutationFn: () => runHealth(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] tracking-[0.28em] text-brass uppercase">Invariants</p>
        <h1 className="font-display text-3xl tracking-[0.1em]">Security</h1>
      </header>
      <ul className="space-y-3">
        <Inv title="Discord is not canon authority" body="Players hear traffic here. They witness the world elsewhere. They verify on the terminal." />
        <Inv title="Zero canon in envoy" body="Operational tables only. No facts, fragments, dossiers, reveal schedules, or signing keys." />
        <Inv title="No Auto-Reveal" body="NARRATIVE events stop at ELIGIBLE — AWAITING ENACTMENT until authorized enactment." />
        <Inv title="One choke point" body="dispatch.send, eight steps, block never redact. No player-facing bypass." />
      </ul>
      <section className="border border-line bg-surface p-4">
        <h2 className="text-[11px] tracking-[0.18em] uppercase text-brass">Secrets (names only)</h2>
        <ul className="mt-2 space-y-1 text-[12px] text-muted">
          <li>DISCORD_BOT_TOKEN</li>
          <li>DISCORD_PUBLIC_KEY</li>
          <li>DISCORD_APP_ID</li>
          <li>CLI_SECRET</li>
        </ul>
        <p className="mt-3 text-[12px] text-muted">Least-privilege permission integer: {snap.data?.perms ?? "—"}</p>
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => intake.mutate()} className="min-h-11 border border-line px-4 text-[12px] uppercase">
          Simulate intake
        </button>
        <button type="button" onClick={() => lock.mutate()} className="min-h-11 border border-brass px-4 text-[12px] uppercase text-brass">
          LOCKDOWN
        </button>
        <button type="button" onClick={() => lift.mutate()} className="min-h-11 border border-line px-4 text-kicker uppercase">
          Lift lockdown
        </button>
        <button type="button" onClick={() => kill.mutate()} className="min-h-11 border border-brass px-4 text-kicker uppercase text-brass">
          Kill interactions
        </button>
        <button type="button" onClick={() => liftKill.mutate()} className="min-h-11 border border-line px-4 text-kicker uppercase">
          Lift kill switch
        </button>
        <button type="button" onClick={() => health.mutate()} className="min-h-11 border border-line px-4 text-[12px] uppercase">
          Health
        </button>
      </div>
      {health.data && (
        <section className="border border-line bg-surface p-4">
          <h2 className="text-[11px] tracking-[0.18em] uppercase text-brass">Health (report only)</h2>
          <p className="mt-2 text-sm">
            {health.data.ok ? "HOLD-free" : "HOLD"} · missing {health.data.missing_channels.length} · drift {health.data.drift.length} · orphans {health.data.orphans_reported}
          </p>
          <ul className="mt-2 space-y-1 text-[12px] text-muted">
            {health.data.findings.map((f) => (
              <li key={`${f.code}:${f.target ?? ""}`}>
                {f.severity.toUpperCase()} {f.code}
                {f.target ? ` · ${f.target}` : ""} — {f.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
      {health.error && <p className="text-sm text-brass">{health.error.message}</p>}
      {kill.data && <p className="text-sm text-brass">Kill switch {kill.data.killed ? "engaged" : "not engaged"} (status {kill.data.status}).</p>}
      {liftKill.data && <p className="text-sm text-muted">Kill switch lifted. Interactions answer again.</p>}
      {kill.error && <p className="text-sm text-brass">{kill.error.message}</p>}
      {liftKill.error && <p className="text-sm text-brass">{liftKill.error.message}</p>}
      {intake.error && <p className="text-sm text-brass">{intake.error.message}</p>}
      <p className="text-muted">Members: {snap.data?.members.length ?? 0} · lockdown {snap.data?.lockdown ? "on" : "off"} · killed {snap.data?.killed ? "yes" : "no"}</p>
    </div>
  );
}

function Inv({ title, body }: { title: string; body: string }) {
  return (
    <li className="border border-line bg-surface p-4">
      <p className="font-display text-lg tracking-[0.08em]">{title}</p>
      <p className="mt-1 text-pretty text-muted">{body}</p>
    </li>
  );
}
