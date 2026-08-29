"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SignedGate } from "@/components/signed-gate";
import {
  connectDiscord,
  reconnectGateway,
  getSnapshot,
  runApply,
  runDriftProbe,
  runOrphanProbe,
  runPermissionAudit,
  runPlan,
  runRefreshPins,
  runValidate,
  runHealth,
  runRotateWebhooks,
  runLiveReadiness,
} from "@/lib/mortis/server";
import type { PlanOp } from "@/lib/mortis/types";

export const Route = createFileRoute("/provision")({ component: Page });

function Page() {
  return (
    <SignedGate>
      <Provision />
    </SignedGate>
  );
}

function Provision() {
  const qc = useQueryClient();
  const snap = useQuery({
    queryKey: ["snapshot"],
    queryFn: () => getSnapshot(),
    refetchInterval: 3000,
  });
  const [guildId, setGuildId] = useState("1540022458126700674");
  const [appId, setAppId] = useState("1540058003888410806");
  const [token, setToken] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [scratch, setScratch] = useState(false);

  const connect = useMutation({
    mutationFn: () =>
      connectDiscord({
        data: { token, guildId, appId, publicKey: publicKey || undefined, confirmScratch: scratch },
      }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["snapshot"] });
    },
  });
  const validate = useMutation({ mutationFn: () => runValidate() });
  const plan = useMutation({ mutationFn: () => runPlan() });
  const apply = useMutation({
    mutationFn: () => runApply({ data: { confirmScratch: snap.data?.live.connected === true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const drift = useMutation({
    mutationFn: (phase: "drift" | "restore") => runDriftProbe({ data: { phase } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const orphan = useMutation({
    mutationFn: (phase: "create" | "reconcile") => runOrphanProbe({ data: { phase } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const perms = useMutation({ mutationFn: () => runPermissionAudit() });
  const reconnectGw = useMutation({
    mutationFn: () => reconnectGateway(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const pins = useMutation({
    mutationFn: () => runRefreshPins(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const health = useMutation({
    mutationFn: () => runHealth(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const rotate = useMutation({
    mutationFn: () => runRotateWebhooks(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshot"] }),
  });
  const readiness = useMutation({
    mutationFn: () => runLiveReadiness({ data: { guildId, appId } }),
    onSuccess: (data) => {
      if (data.publicApp.publicKey && /^[0-9a-fA-F]{64}$/.test(data.publicApp.publicKey)) {
        setPublicKey((k) => k || data.publicApp.publicKey || "");
      }
      qc.invalidateQueries({ queryKey: ["snapshot"] });
    },
  });

  const live = snap.data?.live;
  const invite = snap.data?.inviteUrl ?? "";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-micro tracking-kicker text-brass uppercase">mortis-provision</p>
        <h1 className="font-display text-3xl tracking-[0.1em]">Provision</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          Scratch guild only. Validate → plan → apply. Matching is by blueprint key, never by name. Re-apply with no drift is a no-op. Orphans with history are archive-locked, never deleted.
        </p>
      </header>

      <section className="border border-brass/40 bg-surface p-5 space-y-4">
        <p className="text-micro tracking-kicker uppercase text-brass">Scratch guild connection</p>
        <p className="text-pretty text-muted">
          Paste the bot token here — never in chat. It is held in memory, never written to disk, never sent back to the browser after connect. Guild snowflake and application id are configuration, not secrets.
        </p>
        <p className="text-pretty text-muted">
          Current target: {live?.connected ? `${live.guildName} (${live.guildId}) as ${live.botTag}` : "simulator (not Discord)"}
          {live?.connected ? ` · gateway ${live.gateway?.connected ? "ready" : "connecting…"}` : ""}
          {live?.connected && live.gateway?.lastEvent ? ` · ${live.gateway.lastEvent}` : ""}
        </p>
        {live?.connected && live.administrator && (
          <p className="text-sm text-brass">
            Bot currently holds Administrator. Re-invite with integer {snap.data?.perms}. Channel overwrites cover access — do not keep Admin.
          </p>
        )}
        {live?.connected && (live.missingBits?.length ?? 0) > 0 && !live.administrator && (
          <p className="text-sm text-brass">
            Missing required bits: {live.missingBits?.join(", ")}. Re-invite with integer {snap.data?.perms}.
          </p>
        )}
        {live?.connected && live.gateway && (
          <p className="text-sm text-muted">
            Gateway {live.gateway.connected ? "ready" : "not ready"}
            {live.gateway.lastEvent ? ` · last event ${live.gateway.lastEvent}` : ""}
            {live.gateway.lastError ? ` · ${live.gateway.lastError}` : ""}
            {!live.gateway.connected && !live.gateway.lastError ? " — waiting for READY" : ""}
          </p>
        )}
        {live?.connected && live.overwriteWarnings && live.overwriteWarnings.length > 0 && (
          <p className="text-sm text-brass">
            Channel overwrite warnings (non-fatal, {live.overwriteWarnings.length}): {live.overwriteWarnings.join(" · ")}
          </p>
        )}
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Guild snowflake
          <input value={guildId} onChange={(e) => setGuildId(e.target.value)} className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone" autoComplete="off" />
        </label>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Application id
          <input value={appId} onChange={(e) => setAppId(e.target.value)} className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone" autoComplete="off" />
        </label>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Bot token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone" autoComplete="off" />
        </label>
        <label className="block text-kicker tracking-kicker uppercase text-muted">
          Public key (for intake buttons)
          <input value={publicKey} onChange={(e) => setPublicKey(e.target.value)} className="mt-1 block w-full min-h-11 border border-line bg-ink px-3 text-bone" autoComplete="off" />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={scratch} onChange={(e) => setScratch(e.target.checked)} className="mt-1 size-4" />
          This is a blank scratch guild, not the production player Mortis guild.
        </label>
        <button
          type="button"
          disabled={!scratch || !guildId || !appId || !token || connect.isPending}
          onClick={() => connect.mutate()}
          className="min-h-11 border border-brass px-4 text-kicker tracking-kicker uppercase text-brass disabled:opacity-40"
        >
          {connect.isPending ? "Connecting…" : "Connect scratch guild"}
        </button>
        <button
          type="button"
          disabled={!appId || readiness.isPending}
          onClick={() => readiness.mutate()}
          className="ml-2 min-h-11 border border-line px-4 text-kicker tracking-kicker uppercase text-bone disabled:opacity-40"
        >
          {readiness.isPending ? "Probing…" : "Probe public application"}
        </button>
        {live?.connected && (
          <button
            type="button"
            disabled={reconnectGw.isPending}
            onClick={() => reconnectGw.mutate()}
            className="ml-2 min-h-11 border border-line px-4 text-kicker tracking-kicker uppercase text-bone disabled:opacity-40"
          >
            {reconnectGw.isPending ? "Reconnecting…" : "Reconnect gateway"}
          </button>
        )}
        {reconnectGw.error && <p className="text-sm text-brass">{reconnectGw.error.message}</p>}
        <p className="text-sm text-brass">
          Interactions Endpoint URL: leave it blank. If Discord still shows the placeholder https://nice-example.local/api/interactions, do not Save it — that URL is not live and will steal button clicks from the gateway.
        </p>
        {connect.error && <p className="text-sm text-brass">{connect.error.message}</p>}
        {readiness.error && <p className="text-sm text-brass">{readiness.error.message}</p>}
        {readiness.data && (
          <div className="space-y-2 text-sm">
            <p className="text-kicker tracking-kicker uppercase text-brass">Live readiness (no token)</p>
            <p>
              Discord transport {readiness.data.discordGateway.ok ? "reachable" : "not reachable"}
              {readiness.data.discordGateway.kind ? ` · ${readiness.data.discordGateway.kind}` : ""}
              {" · "}
              token in memory {readiness.data.tokenInMemory ? "yes" : "no"}
              {" · "}
              live {readiness.data.liveConnected ? "connected" : "simulator"}
            </p>
            <p>
              App {readiness.data.publicApp.name ?? readiness.data.publicApp.appId}
              {readiness.data.publicApp.botPublic === true ? " · Public Bot ON" : ""}
              {readiness.data.publicApp.installPermissions
                ? ` · default install ${readiness.data.publicApp.installPermissions}`
                : ""}
              {readiness.data.publicApp.installMatchesRequired ? " · matches canonical" : " · does not match canonical"}
            </p>
            <p>
              Scratch state {readiness.data.scratchState.present ? `${readiness.data.scratchState.bindings} bindings` : "missing"}
              {" · "}
              hash {readiness.data.scratchState.hashMatch ? "matches last apply" : "differs from last apply — Plan before Apply"}
            </p>
            {readiness.data.blocker && <p className="text-brass">{readiness.data.blocker}</p>}
            <ul className="space-y-1 text-muted">
              {readiness.data.publicApp.findings.map((f) => (
                <li key={f.code}>
                  {f.severity.toUpperCase()} {f.code} — {f.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
        {appId && (
          <p className="break-all text-kicker text-muted">
            Invite (least privilege {snap.data?.perms}): {invite.replace("app_phase1", appId)}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Action label="Validate" onClick={() => validate.mutate()} busy={validate.isPending} />
        <Action label="Plan" onClick={() => plan.mutate()} busy={plan.isPending} />
        <Action label="Apply" onClick={() => apply.mutate()} busy={apply.isPending} primary disabled={!plan.data} />
        <Action label="Health" onClick={() => health.mutate()} busy={health.isPending} />
      </div>
      {!plan.data && <p className="text-sm text-muted">Read Plan before Apply. Apply stays disabled until a plan exists in this session.</p>}
      {apply.error && <p className="text-sm text-brass">Apply failed: {apply.error.message}</p>}

      {validate.data && (
        <Panel title="Validate">
          {(validate.data.checks ?? []).map((c) => (
            <p key={c.name}>
              {c.ok ? "PASS" : "HOLD"} {c.name} — {c.detail}
            </p>
          ))}
        </Panel>
      )}
      {health.data && (
        <Panel title="Health (report only)">
          {health.data.ok ? "HOLD-free" : "HOLD"} · missing {health.data.missing_channels.length} · drift {health.data.drift.length}
          <ul className="mt-2 space-y-1 text-muted">
            {health.data.findings.map((f) => (
              <li key={`${f.code}:${f.target ?? ""}`}>
                {f.severity.toUpperCase()} {f.code}
                {f.target ? ` · ${f.target}` : ""} — {f.detail}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {connect.data && (
        <Panel title="Connected plan (pre-apply)">
          creates {connect.data.plan.creates} · updates {connect.data.plan.updates} · orphans {connect.data.plan.orphans} · noops {connect.data.plan.noops}
          <pre className="mt-3 max-h-64 overflow-auto text-kicker text-muted">{JSON.stringify(connect.data.plan.ops.slice(0, 60), null, 2)}</pre>
        </Panel>
      )}
      {plan.data && (
        <Panel title="Plan">
          creates {plan.data.creates} · updates {plan.data.updates} · orphans {plan.data.orphans} · noops {plan.data.noops}
          <p className="mt-2 text-muted">NO DESTRUCTIVE OPERATIONS. Orphans are reported only — never auto-deleted. History archive-lock only with per-item confirm.</p>
          <PlanViz ops={plan.data.ops} />
        </Panel>
      )}
      {apply.data && (
        <Panel title="Apply">
          {apply.data.no_op ? "No-op. Live state already matches." : `Applied ${apply.data.applied} mutations.`}
          {apply.data.warnings.length > 0 && <p className="mt-2">Warnings: {apply.data.warnings.join("; ")}</p>}
          <p className="mt-3 text-kicker tracking-kicker uppercase text-muted">Manual toggles</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {apply.data.manual.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="border border-line bg-surface p-4 space-y-3">
        <h2 className="text-kicker tracking-kicker uppercase text-brass">Scratch probes</h2>
        <div className="flex flex-wrap gap-2">
          <Action label="Drift topic" onClick={() => drift.mutate("drift")} busy={drift.isPending} />
          <Action label="Restore drift" onClick={() => drift.mutate("restore")} busy={drift.isPending} />
          <Action label="Create orphan" onClick={() => orphan.mutate("create")} busy={orphan.isPending} />
          <Action label="Reconcile orphans" onClick={() => orphan.mutate("reconcile")} busy={orphan.isPending} />
          <Action label="Permission audit" onClick={() => perms.mutate()} busy={perms.isPending} />
          <Action label="Refresh ARRIVAL pins" onClick={() => pins.mutate()} busy={pins.isPending} />
          <Action label="Rotate webhooks" onClick={() => rotate.mutate()} busy={rotate.isPending} />
        </div>
        {rotate.error && <p className="text-sm text-brass">Rotate failed: {rotate.error.message}</p>}
        {rotate.data && <p className="text-sm">Rotated {rotate.data.rotated.length} webhooks. Old URLs are no longer used.</p>}
        {pins.error && <p className="text-sm text-brass">Refresh pins failed: {pins.error.message}</p>}
        {pins.data && (
          <pre className="max-h-64 overflow-auto text-kicker text-muted">{JSON.stringify(pins.data, null, 2)}</pre>
        )}
        {drift.data && <pre className="max-h-48 overflow-auto text-kicker text-muted">{JSON.stringify(drift.data, null, 2)}</pre>}
        {orphan.data && <pre className="max-h-48 overflow-auto text-kicker text-muted">{JSON.stringify(orphan.data, null, 2)}</pre>}
        {perms.data && <pre className="max-h-48 overflow-auto text-kicker text-muted">{JSON.stringify(perms.data, null, 2)}</pre>}
      </section>

      <Panel title="Live hash">{snap.data?.lastAppliedHash ?? "none"}</Panel>
    </div>
  );
}

function PlanViz({ ops }: { ops: PlanOp[] }) {
  const creates = ops.filter((o) => o.op === "create");
  const updates = ops.filter((o) => o.op === "update");
  const orphans = ops.filter((o) => o.op === "orphan");
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <div>
        <p className="text-kicker tracking-kicker uppercase text-muted">Creates</p>
        <ul className="mt-1 space-y-1 text-sm">
          {creates.length === 0 && <li className="text-muted">none</li>}
          {creates.slice(0, 24).map((o) => (
            <li key={o.key}>
              {o.kind} · {o.display}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-kicker tracking-kicker uppercase text-muted">Updates</p>
        <ul className="mt-1 space-y-1 text-sm">
          {updates.length === 0 && <li className="text-muted">none</li>}
          {updates.slice(0, 24).map((o) => (
            <li key={o.key}>
              {o.key} · {o.changes.join(", ")}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-kicker tracking-kicker uppercase text-muted">Orphans (report only)</p>
        <ul className="mt-1 space-y-1 text-sm">
          {orphans.length === 0 && <li className="text-muted">none</li>}
          {orphans.slice(0, 24).map((o) => (
            <li key={o.snowflake}>
              {o.name}
              {o.has_history ? " · has history" : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Action({ label, onClick, busy, primary, disabled }: { label: string; onClick: () => void; busy?: boolean; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={
        primary
          ? "min-h-11 border border-brass bg-brass px-4 text-kicker tracking-kicker uppercase text-ink disabled:opacity-50"
          : "min-h-11 border border-line px-4 text-kicker tracking-kicker uppercase text-bone disabled:opacity-50"
      }
    >
      {busy ? "Working…" : label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-line bg-surface p-4">
      <h2 className="text-kicker tracking-kicker uppercase text-brass">{title}</h2>
      <div className="mt-2 whitespace-pre-wrap text-pretty">{children}</div>
    </section>
  );
}
