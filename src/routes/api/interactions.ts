import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleDiscordInteractionPost } = await import("@/lib/mortis/interaction-http.server.ts");
        return handleDiscordInteractionPost(request);
      },
    },
  },
});
