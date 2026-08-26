"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { SignedIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { LayoutGrid, GitBranch, Radio, Ticket, ScrollText, FlaskConical, Shield } from "lucide-react";
import { cn } from "@/lib/cn";
import { Mark } from "@/components/mark";

const NAV = [
  { to: "/", label: "Network", icon: LayoutGrid },
  { to: "/provision", label: "Provision", icon: GitBranch },
  { to: "/dispatch", label: "Dispatch", icon: Radio },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/audit", label: "Audit", icon: ScrollText },
  { to: "/tests", label: "Tests", icon: FlaskConical },
  { to: "/security", label: "Security", icon: Shield },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isPending } = useCurrentUserState();
  const locked = !isPending && !user;

  return (
    <div className="min-h-dvh bg-ink text-bone">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex min-h-11 items-center gap-3 no-underline">
            <span className="inline-flex size-7 items-center justify-center text-brass">
              <Mark className="size-7" />
            </span>
            <span className="font-display text-base tracking-kicker text-bone">MORTIS FIELD NETWORK</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-micro tracking-mark text-muted uppercase sm:inline">Operator workstation</span>
            {isPending ? (
              <div className="size-8 animate-pulse rounded-full bg-raised" />
            ) : user ? (
              <UserButton />
            ) : (
              <Link
                to="/login"
                className="inline-flex min-h-11 items-center border border-brass px-3 text-micro tracking-kicker uppercase text-brass no-underline"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
        <SignedIn>
          <nav className="hidden border-t border-line md:block" aria-label="Workstation">
            <div className="mx-auto flex max-w-6xl gap-1 px-2">
              {NAV.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex min-h-11 items-center gap-2 px-3 text-micro tracking-kicker uppercase no-underline transition-colors duration-200",
                      active ? "text-brass border-b-2 border-brass" : "text-muted hover:text-bone border-b-2 border-transparent",
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </SignedIn>
      </header>

      <main className={cn("mx-auto max-w-6xl px-4 py-6", locked ? "pb-10" : "pb-24 md:pb-10")}>{children}</main>

      <SignedIn>
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 backdrop-blur md:hidden" aria-label="Workstation">
          <div className="grid grid-cols-7">
            {NAV.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center no-underline",
                    active ? "text-brass" : "text-muted",
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                  <span className="mt-0.5 max-w-[4.5rem] truncate text-[9px] tracking-kicker uppercase">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </SignedIn>
    </div>
  );
}
