import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink px-6 text-center text-bone">
      <span className="text-brass" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="font-display text-lg tracking-[0.1em]">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-muted text-pretty">
        {error.message || "An unexpected error occurred. Try reloading the page."}
      </p>
    </main>
  );
}
