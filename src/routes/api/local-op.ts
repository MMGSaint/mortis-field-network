import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/local-op")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleLocalOpRequest } = await import("@/lib/mortis/local-operator.ts");
        return handleLocalOpRequest(request);
      },
      POST: async ({ request }) => {
        const { handleLocalOpRequest } = await import("@/lib/mortis/local-operator.ts");
        return handleLocalOpRequest(request);
      },
    },
  },
});
