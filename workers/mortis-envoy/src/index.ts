/**
 * Cloudflare Worker entry for mortis-envoy.
 *
 * Canonical fetch handler: src/lib/mortis/envoy.ts `envoyFetch`.
 * This file must not reimplement slash commands, tickets, or dispatch —
 * a second copy would drift and become a player-facing bypass.
 *
 * Bindings (owner-PC deploy): DB (D1), TRANSCRIPTS (R2)
 * Secrets: DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_APP_ID, CLI_SECRET
 *
 * In this sandbox the executable path is MortisRuntime (simulated guild +
 * in-memory store) calling envoyFetch. This Worker stays fail-closed until
 * a D1/R2 store adapter exists. Do not copy canon, relay credentials, or
 * signing keys into this file.
 */

const UNIFORM_404 = JSON.stringify({ error: "not found" });
const UNIFORM_404_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v1/health") {
      return new Response(JSON.stringify({ ok: true, service: "mortis-envoy", handler: "envoyFetch" }), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response(UNIFORM_404, { status: 404, headers: UNIFORM_404_HEADERS });
  },
};
