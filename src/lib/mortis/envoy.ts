import { digestEquals, verifyDiscordInteraction, verifyReleaseExcerpt } from "./crypto.ts";
import { templateByKey } from "./blueprint.ts";
import { dispatchSend } from "./dispatch.ts";
import { acceptTerms, completeIntake } from "./intake.ts";
import { claimTicket, closeTicket, createTicket, parseTicketCategory, reopenTicket } from "./tickets.ts";
import { closeArrival, openArrival } from "./provision.ts";
import type { SimulatedGuild } from "./discord-sim.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint, TicketCategory } from "./types.ts";

export const UNIFORM_404 = JSON.stringify({ error: "not found" });
export const UNIFORM_404_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export type EnvoyEnv = {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
  CLI_SECRET: string;
  RELEASE_PUBLIC_KEY?: string;
};

const CLOCK_PAD_MS = 8;
const CATEGORY_HINT = "category must be general|report|appeal|accessibility";

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function ephemeral(content: string): Response {
  return json(200, { type: 4, data: { content: content.slice(0, 180), flags: 64 } });
}

function failReason(e: unknown, fallback: string): string {
  const err = e as Error & { status?: number; body?: string };
  const msg = err?.message ? String(err.message) : fallback;
  const extra = err?.body && !msg.includes(err.body) ? ` ${err.body}` : "";
  return `${msg}${extra}`.slice(0, 180);
}

async function uniform404(): Promise<Response> {
  await new Promise((r) => setTimeout(r, CLOCK_PAD_MS));
  return new Response(UNIFORM_404, { status: 404, headers: UNIFORM_404_HEADERS });
}

export type EnvoyContext = {
  bp: Blueprint;
  store: EnvoyStore;
  guild: SimulatedGuild;
  env: EnvoyEnv;
  cwd?: string;
  isKilled?: () => boolean;
  kill?: () => void;
};

/**
 * Gateway-less Worker fetch handler.
 * Discord interactions verified before parse.
 * No calls to mortis-relay. No third-party APIs. No canon.
 */
export async function envoyFetch(request: Request, ctx: EnvoyContext): Promise<Response> {
  if (ctx.isKilled?.()) {
    return new Response(UNIFORM_404, { status: 404, headers: UNIFORM_404_HEADERS });
  }
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-signature-ed25519, x-signature-timestamp, authorization",
      },
    });
  }

  if (path === "/v1/health" && request.method === "GET") {
    return json(200, { ok: true, service: "mortis-envoy", lockdown: ctx.store.lockdown });
  }

  if (path === "/interactions" && request.method === "POST") {
    const raw = await request.text();
    const sig = request.headers.get("x-signature-ed25519");
    const ts = request.headers.get("x-signature-timestamp");
    const ok = await verifyDiscordInteraction({
      publicKeyHex: ctx.env.DISCORD_PUBLIC_KEY,
      timestamp: ts,
      signatureHex: sig,
      rawBody: raw,
    });
    if (!ok) return new Response("invalid request signature", { status: 401 });
    let payload: DiscordInteraction;
    try {
      payload = JSON.parse(raw) as DiscordInteraction;
    } catch {
      return new Response("invalid request signature", { status: 401 });
    }
    return handleInteraction(payload, ctx);
  }

  if (path.startsWith("/cli/")) {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const good = await digestEquals(token, ctx.env.CLI_SECRET);
    if (!good || !token) return uniform404();
    return handleCli(path, request, ctx);
  }

  return uniform404();
}

type DiscordInteraction = {
  type: number;
  id?: string;
  token?: string;
  member?: { user?: { id: string; username: string } };
  user?: { id: string; username: string };
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{ name: string; value: string }>;
    components?: Array<{ components?: Array<{ custom_id: string; value: string }> }>;
  };
};

function actorOf(i: DiscordInteraction): { id: string; username: string } {
  const u = i.member?.user ?? i.user;
  return { id: u?.id ?? "unknown", username: u?.username ?? "unknown" };
}

export async function handleVerifiedInteraction(payload: unknown, ctx: EnvoyContext): Promise<Response> {
  try {
    return await handleInteraction(payload as DiscordInteraction, ctx);
  } catch (e) {
    return ephemeral(failReason(e, "interaction failed"));
  }
}

async function handleInteraction(i: DiscordInteraction, ctx: EnvoyContext): Promise<Response> {
  if (i.type === 1) return json(200, { type: 1 });

  const actor = actorOf(i);
  if (i.type === 2) {
    const name = i.data?.name;
    if (name === "post") return slashPost(i, actor, ctx);
    if (name === "orient") return slashOrient(ctx);
    if (name === "ticket") return slashTicket(i, actor, ctx);
    if (name === "lockdown") return slashLockdown(i, actor, ctx);
    return json(200, { type: 4, data: { content: "Unknown command.", flags: 64 } });
  }
  if (i.type === 3) {
    const cid = i.data?.custom_id ?? "";
    if (cid === "terms_accept") {
      try {
        await acceptTerms(ctx.store, actor.id, actor.username, ctx.guild);
        return ephemeral("Conduct and terms recorded. Continue at ENTRY.");
      } catch (e) {
        return ephemeral(failReason(e, "terms accept failed"));
      }
    }
    if (cid === "intake_start") {
      return json(200, {
        type: 9,
        data: {
          custom_id: "intake_modal",
          title: "Intake",
          components: [
            {
              type: 1,
              components: [{ type: 4, custom_id: "callsign", label: "Callsign", style: 1, min_length: 1, max_length: 32 }],
            },
          ],
        },
      });
    }
    if (cid === "ticket_create") {
      return json(200, {
        type: 9,
        data: {
          custom_id: "ticket_modal",
          title: "Support ticket",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "category", label: "general | report | appeal | accessibility", style: 1 }] },
            { type: 1, components: [{ type: 4, custom_id: "body", label: "What do you need?", style: 2 }] },
          ],
        },
      });
    }
    if (cid.startsWith("ticket_claim:")) {
      const id = cid.slice("ticket_claim:".length);
      try {
        await claimTicket(ctx.store, id, actor.id, ctx.guild, ctx.bp);
        return ephemeral("Ticket claimed.");
      } catch (e) {
        return ephemeral(failReason(e, "ticket claim failed"));
      }
    }
    if (cid.startsWith("ticket_close:")) {
      const id = cid.slice("ticket_close:".length);
      try {
        await closeTicket(ctx.store, ctx.guild, id, actor.id, ctx.bp);
        return ephemeral("Ticket closed.");
      } catch (e) {
        return ephemeral(failReason(e, "ticket close failed"));
      }
    }
    if (cid.startsWith("ticket_reopen:")) {
      const id = cid.slice("ticket_reopen:".length);
      try {
        await reopenTicket(ctx.store, ctx.guild, id, actor.id, ctx.bp);
        return ephemeral("Ticket reopened.");
      } catch (e) {
        return ephemeral(failReason(e, "ticket reopen failed"));
      }
    }
    return json(200, { type: 4, data: { content: "Unknown control.", flags: 64 } });
  }
  if (i.type === 5) {
    const cid = i.data?.custom_id;
    const fields: Record<string, string> = {};
    for (const row of i.data?.components ?? []) {
      for (const c of row.components ?? []) fields[c.custom_id] = c.value;
    }
    if (cid === "intake_modal") {
      try {
        const { already } = await completeIntake(
          { snowflake: actor.id, handle: actor.username, callsign: fields.callsign },
          ctx,
        );
        return ephemeral(already ? "Intake already complete." : "Intake complete. Welcome.");
      } catch (e) {
        const msg = e instanceof Error && e.message === "lockdown" ? "Arrival is closed." : failReason(e, "intake failed");
        return ephemeral(msg);
      }
    }
    if (cid === "ticket_modal") {
      const parsed = parseTicketCategory(fields.category);
      if (fields.category?.trim() && !parsed) {
        return ephemeral(CATEGORY_HINT);
      }
      const category = (parsed ?? "general") as TicketCategory;
      try {
        const row = await createTicket(
          { opener: actor.id, handle: actor.username, category, body: fields.body ?? "" },
          ctx,
        );
        return ephemeral(`Ticket ${row.id} opened.`);
      } catch (e) {
        if (e instanceof Error && e.message === "invalid_category") return ephemeral(CATEGORY_HINT);
        const msg = e instanceof Error && e.message === "rate_limited" ? "You already have open tickets. Close or wait." : `Ticket create failed: ${failReason(e, "unknown")}`;
        return ephemeral(msg);
      }
    }
  }
  return json(200, { type: 4, data: { content: "Acknowledged.", flags: 64 } });
}

async function slashOrient(ctx: EnvoyContext): Promise<Response> {
  const tpl = templateByKey(ctx.bp, "tpl.arrival.guide");
  const body = tpl ? `${tpl.title}\n\n${tpl.body}` : "Read CONDUCT AND TERMS, then ENTRY.";
  return json(200, { type: 4, data: { content: body.slice(0, 1800), flags: 64 } });
}

async function slashPost(
  i: DiscordInteraction,
  actor: { id: string; username: string },
  ctx: EnvoyContext,
): Promise<Response> {
  const opts = Object.fromEntries((i.data?.options ?? []).map((o) => [o.name, o.value]));
  const result = await dispatchSend(
    {
      channel_key: opts.channel ?? "network.dispatches",
      template_key: opts.template ?? "tpl.ops.deployment",
      fields: { status: opts.status ?? "complete", window: opts.window ?? "", presentation_name: opts.name ?? "", published_at: opts.when ?? "" },
      caller: { type: "staff", snowflake: actor.id },
    },
    { ...ctx, releasePublicKeyHex: ctx.env.RELEASE_PUBLIC_KEY },
  );
  if (!result.ok) {
    return ephemeral(result.reason === "unauthorized" ? "not authorized to post" : `dispatch failed: ${result.reason}`.slice(0, 180));
  }
  return ephemeral("Notice sent.");
}

async function slashTicket(
  i: DiscordInteraction,
  actor: { id: string; username: string },
  ctx: EnvoyContext,
): Promise<Response> {
  const opts = Object.fromEntries((i.data?.options ?? []).map((o) => [o.name, o.value]));
  const parsed = parseTicketCategory(opts.category ?? "general");
  if (!parsed) return ephemeral(CATEGORY_HINT);
  try {
    const row = await createTicket(
      { opener: actor.id, handle: actor.username, category: parsed, body: opts.body ?? "ticket" },
      ctx,
    );
    return ephemeral(`Ticket ${row.id} opened.`);
  } catch (e) {
    if (e instanceof Error && e.message === "invalid_category") return ephemeral(CATEGORY_HINT);
    const msg = e instanceof Error && e.message === "rate_limited" ? "You already have open tickets. Close or wait." : `Ticket create failed: ${failReason(e, "unknown")}`;
    return ephemeral(msg);
  }
}

async function slashLockdown(
  _i: DiscordInteraction,
  actor: { id: string; username: string },
  ctx: EnvoyContext,
): Promise<Response> {
  const staff = ctx.store.staff.get(actor.id);
  if (!staff || !(staff.capabilities.includes("lockdown") || staff.capabilities.includes("*"))) {
    return ephemeral("not authorized for lockdown");
  }
  await enactLockdown(ctx, actor.id);
  return ephemeral("Lockdown in effect.");
}

export async function enactLockdown(ctx: EnvoyContext, actor: string): Promise<void> {
  ctx.store.lockdown = true;
  ctx.store.invitesPaused = true;
  const pause = await ctx.guild.pauseInvites(new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  ctx.guild.invitesPaused = true;
  ctx.store.appendAudit({
    actor,
    action: "lockdown",
    details: { arrival: "closed", invites: "paused", invite_api: pause.detail },
  });
  await closeArrival(ctx.bp, ctx.store, ctx.guild);
  await dispatchSend(
    { channel_key: "arrival.notice", template_key: "tpl.ops.lockdown", fields: {}, caller: { type: "owner-cli" } },
    ctx,
  );
}

export async function liftLockdown(ctx: EnvoyContext, actor: string): Promise<void> {
  ctx.store.lockdown = false;
  ctx.store.invitesPaused = false;
  const pause = await ctx.guild.pauseInvites(null);
  ctx.guild.invitesPaused = false;
  await openArrival(ctx.bp, ctx.store, ctx.guild);
  ctx.store.appendAudit({
    actor,
    action: "lockdown.lift",
    details: { arrival: "open", invites: "resumed", invite_api: pause.detail },
  });
}

async function handleCli(path: string, request: Request, ctx: EnvoyContext): Promise<Response> {
  if (path === "/cli/post" && request.method === "POST") {
    const body = (await request.json()) as { channel_key: string; template_key: string; fields?: Record<string, string> };
    const result = await dispatchSend(
      { channel_key: body.channel_key, template_key: body.template_key, fields: body.fields ?? {}, caller: { type: "owner-cli" } },
      { ...ctx, releasePublicKeyHex: ctx.env.RELEASE_PUBLIC_KEY },
    );
    return json(result.ok ? 200 : 400, result);
  }
  if (path === "/cli/verify-excerpt" && request.method === "POST") {
    const body = (await request.json()) as { payload: unknown; signatureHex: string };
    if (!ctx.env.RELEASE_PUBLIC_KEY) return json(400, { ok: false, reason: "no public key" });
    const ok = await verifyReleaseExcerpt({
      publicKeyHex: ctx.env.RELEASE_PUBLIC_KEY,
      payload: body.payload,
      signatureHex: body.signatureHex,
    });
    if (!ok) return json(400, { ok: false, reason: "invalid signature" });
    return json(200, { ok: true });
  }
  if (path === "/cli/lockdown" && request.method === "POST") {
    await enactLockdown(ctx, "owner-cli");
    return json(200, { ok: true });
  }
  if (path === "/cli/kill" && request.method === "POST") {
    ctx.store.appendAudit({ actor: "owner-cli", action: "kill_switch", details: { interactions: "disabled" } });
    ctx.kill?.();
    return json(200, { ok: true, killed: true });
  }
  return uniform404();
}
