"use client";

import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export function SignInPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "space-y-3" : "space-y-3"}>
      {authEnabled ? (
        GROK_PROVIDERS.map((p) => (
          <button
            key={p.providerId}
            type="button"
            onClick={() => signIn(p.providerId, { callbackURL: "/" })}
            className="w-full min-h-11 border border-brass bg-ink px-4 py-2.5 text-xs tracking-kicker uppercase text-brass transition-colors duration-200 hover:bg-raised"
          >
            Continue with {p.label}
          </button>
        ))
      ) : (
        <p className="text-sm text-muted">Sign-in is disabled.</p>
      )}
    </div>
  );
}
