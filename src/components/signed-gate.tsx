"use client";

import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function SignedGate({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse bg-raised" />
        <div className="h-40 animate-pulse bg-raised" />
      </div>
    );
  }
  if (!user) return <RedirectToSignIn to="/login" />;
  return <>{children}</>;
}
