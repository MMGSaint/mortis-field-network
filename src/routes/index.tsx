"use client";

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getSnapshot } from "@/lib/mortis/server";
import { SignInPanel } from "@/components/sign-in-panel";
import { Mark } from "@/components/mark";

export const Route = createFileRoute("/")({ component: Home });

const INVARIANTS = [
  {
    title: "Discord is not canon authority",
    body: "Players hear traffic here. They witness the world in VRChat. They verify on the terminal.",
  },
  {
    title: "Zero canon in envoy",
    body: "Operational tables only. No facts, fragments, dossiers, or signing keys.",
  },
  {
    title: "No Auto-Reveal",
    body: "NARRATIVE events stop at ELIGIBLE — AWAITING ENACTMENT until authorized enactment.",
  },
  {
    title: "One choke point",
    body: "dispatch.send, eight steps, block never redact. No player-facing bypass.",
  },
];

const STRUCTURE = [
  { name: "ARRIVAL", note: "Public threshold" },
  { name: "NETWORK", note: "Notices and traffic" },
  { name: "OPERATIONS", note: "Mission orders" },
  { name: "RECORDS", note: "Circulated, player-safe" },
  { name: "FIELD", note: "Published spaces" },
  { name: "COMMUNITY", note: "Off-record lounge" },
  { name: "SUPPORT", note: "Desk and tickets" },
  { name: "STAFF", note: "Staff only" },
];

function Home() {
  const { user } = useCurrentUserState();
  if (!user) return <Landing />;
  return <NetworkMap />;
}

function LandingSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      <div className="h-10 w-72 animate-pulse bg-raised" />
      <div className="h-24 max-w-2xl animate-pulse bg-raised" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 animate-pulse bg-raised" />
        <div className="h-28 animate-pulse bg-raised" />
      </div>
    </div>
  );
}

function Landing() {
  return (
    <div className="space-y-10">
      <header className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
        <div className="space-y-4">
          <p className="text-micro tracking-mark text-brass uppercase">Staff workstation</p>
          <h1 className="font-display text-4xl tracking-kicker sm:text-5xl">MORTIS FIELD NETWORK</h1>
          <p className="max-w-2xl text-pretty text-muted">
            Discord is what players hear — the least authoritative surface. This console provisions a blank guild into the approved Field Network. It stores no canon. It invents no lore.
          </p>
        </div>
        <div className="border border-line bg-surface p-6">
          <div className="mb-4 flex items-center gap-3 text-brass">
            <Mark className="size-8" />
            <p className="text-micro tracking-mark uppercase">Sign in to operate</p>
          </div>
          <SignInPanel />
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {INVARIANTS.map((item) => (
          <article key={item.title} className="border border-line bg-surface p-4">
            <h2 className="font-display text-lg tracking-kicker">{item.title}</h2>
            <p className="mt-1 text-pretty text-muted">{item.body}</p>
          </article>
        ))}
      </section>

      <section>
        <h2 className="font-display text-xl tracking-kicker">Provisioned structure</h2>
        <p className="mt-1 text-muted">Neutral fallbacks ship until the owner stamps composed names.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STRUCTURE.map((row) => (
            <li key={row.name} className="border border-line bg-surface px-3 py-3">
              <p className="font-display tracking-kicker">{row.name}</p>
              <p className="text-micro tracking-kicker uppercase text-muted">{row.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NetworkMap() {
  const q = useQuery({ queryKey: ["snapshot"], queryFn: () => getSnapshot(), refetchInterval: 3000 });
  const data = q.data;
  const applied = Boolean(data?.lastAppliedHash);

  if (q.isPending) return <LandingSkeleton />;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-micro tracking-mark text-brass uppercase">Guild identity</p>
        <h1 className="font-display text-4xl tracking-kicker">MORTIS FIELD NETWORK</h1>
        <p className="max-w-2xl text-pretty text-muted">
          Discord is what players hear — the least authoritative surface. VRChat is what they witness. The terminal is what they can verify. This workstation turns a blank guild into the approved structure without inventing lore.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="State" value={applied ? "Applied" : "Blank guild"} />
        <Stat label="Transport" value={data?.live.connected ? (data.live.gateway?.connected ? "Live · gateway ready" : "Live · gateway not ready") : "Simulator"} />
        <Stat label="Lockdown" value={data?.lockdown ? "Active" : "Open"} />
        <Stat label="Open tickets" value={String(data?.tickets.filter((t) => t.status !== "closed").length ?? 0)} />
      </div>
      <NextAction data={data} applied={applied} />
      {data?.health && (
        <p className="text-sm text-muted">
          Health {data.health.ok ? "clear" : `${data.health.holds} hold(s), ${data.health.warns} warn(s)`}
          {data.health.missing.length ? ` · missing ${data.health.missing.join(", ")}` : ""}
          {data.live.connected && data.live.gateway && !data.live.gateway.connected ? " · gateway not READY — buttons will time out" : ""}
          {data.live.administrator ? " · bot holds Administrator — re-invite" : ""}
          {data.killed ? " · interactions killed" : ""}
        </p>
      )}

      <section className="space-y-4">
        <h2 className="font-display text-xl tracking-kicker">Structure</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(data?.categories ?? []).map((cat) => {
            const channels = (data?.channels ?? []).filter((c) => c.category === cat.key);
            return (
              <article key={cat.key} className="border border-line bg-surface p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-lg tracking-kicker">{cat.display}</h3>
                  <span className="text-micro tracking-kicker uppercase text-muted">{cat.audience}</span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {channels.map((ch) => (
                    <li key={ch.key} className="flex items-center justify-between gap-2 border-t border-line/70 pt-1.5 text-xs">
                      <span className="text-bone">{ch.display}</span>
                      <span className="font-mono text-micro text-muted">{ch.key}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl tracking-kicker">Roles</h2>
        <p className="mt-1 text-muted">Presentation only. Backend authorization uses the envoy staff table, never these names.</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(data?.roles ?? []).map((r) => (
            <li key={r.key} className="border border-line px-2 py-1 text-micro tracking-kicker uppercase">
              {r.display}
              <span className="ml-2 text-muted">{r.tier}{r.key === "role.shadow" ? " · not issued" : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NextAction({
  data,
  applied,
}: {
  data:
    | {
        live: {
          connected: boolean;
          administrator?: boolean;
          gateway?: { connected: boolean; lastEvent?: string; lastError?: string };
        };
        health: { ok: boolean; holds: number; warns: number };
        tickets: Array<{ status: string }>;
        killed: boolean;
        lockdown: boolean;
      }
    | undefined;
  applied: boolean;
}) {
  let title = "Operate";
  let body = "The Field Network is applied. Dispatch notices, review tickets, and run health when you change Discord by hand.";
  let href = "/dispatch";
  let cta = "Open dispatch";
  if (!applied) {
    title = "Apply the blueprint";
    body = "A blank guild becomes the Field Network in one apply. History is never destroyed.";
    href = "/provision";
    cta = "Open provisioner";
  } else if (data?.killed) {
    title = "Interactions are killed";
    body = "Buttons and slash commands will not answer until you lift the kill switch on Security.";
    href = "/security";
    cta = "Open security";
  } else if (data?.lockdown) {
    title = "Lockdown is active";
    body = "Arrival is closed. Lift from Security when the safety action is complete.";
    href = "/security";
    cta = "Open security";
  } else if (data?.live.connected && data.live.gateway && !data.live.gateway.connected) {
    title = "Gateway not ready";
    body = "Buttons will time out until READY. Wait, or Reconnect gateway on Provision. Leave the Interactions Endpoint URL blank.";
    href = "/provision";
    cta = "Open provisioner";
  } else if (data?.live.administrator) {
    title = "Bot holds Administrator";
    body = "Re-invite with the least-privilege integer shown on Provision. Do not keep Admin — channel overwrites cover access.";
    href = "/provision";
    cta = "Open provisioner";
  } else if (data && !data.health.ok) {
    title = "Health holds";
    body = `${data.health.holds} hold(s), ${data.health.warns} warn(s). Report-only — nothing is auto-deleted.`;
    href = "/provision";
    cta = "Review provision";
  } else if (data && data.tickets.some((t) => t.status !== "closed")) {
    title = "Open tickets";
    body = "Claim, close, or reopen from Tickets. Player-facing replies still go through dispatch.";
    href = "/tickets";
    cta = "Open tickets";
  } else if (data && !data.live.connected) {
    title = "Simulator";
    body = "Live Discord is not attached in this process. Connect on Provision with the scratch checkbox. Token stays in memory only.";
    href = "/provision";
    cta = "Connect scratch";
  }

  return (
    <div className="border border-brass/40 bg-surface p-5">
      <p className="text-micro tracking-mark uppercase text-brass">Next action</p>
      <h2 className="mt-1 font-display text-xl tracking-kicker">{title}</h2>
      <p className="mt-2 max-w-2xl text-pretty text-muted">{body}</p>
      <Link
        to={href}
        className="mt-4 inline-flex min-h-11 items-center border border-brass px-4 text-xs tracking-kicker uppercase text-brass no-underline"
      >
        {cta}
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-surface p-4">
      <p className="text-micro tracking-mark uppercase text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl tracking-kicker tabular-nums">{value}</p>
    </div>
  );
}
