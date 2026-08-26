"use client";

import { createFileRoute, Link } from "@tanstack/react-router";
import { SignInPanel } from "@/components/sign-in-panel";
import { Mark } from "@/components/mark";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <section className="mx-auto grid min-h-[70dvh] max-w-md place-items-center">
      <div className="w-full border border-line bg-surface p-8">
        <div className="text-brass">
          <Mark className="size-10" />
        </div>
        <p className="mt-5 text-micro tracking-mark text-brass uppercase">Staff only</p>
        <h1 className="mt-3 font-display text-3xl tracking-kicker">Sign in</h1>
        <p className="mt-3 text-pretty text-muted">
          This workstation provisions the Mortis Field Network. It is not a player surface and it is not a canon store.
        </p>
        <div className="mt-8">
          <SignInPanel />
        </div>
        <p className="mt-6 text-micro text-muted">
          <Link to="/" className="text-brass no-underline hover:underline">
            Return to the threshold
          </Link>
        </p>
      </div>
    </section>
  );
}
