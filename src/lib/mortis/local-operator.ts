/**
 * Loopback-only operator. Never returns the bot token.
 * Used by /api/local-op so the agent can drive a live Connect already in WeakMap.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { MortisRuntime } from "./runtime.ts";
import { plan, apply, refreshPins, adopt, overwriteSweepTargets } from "./provision.ts";
import { createTicket, claimTicket, closeTicket, reopenTicket, parseTicketCategory } from "./tickets.ts";
import { enactLockdown, liftLockdown } from "./envoy.ts";
import { ensureBotChannelAccess, restApi, attachCurrentRestMethods, type DiscordRestGuild, ensureBotHasPresentationRole, discordManagedBotRole } from "./discord-rest.ts";
import { PERM, botMemberAllowBits, botPermissionInteger, auditHeldPermissions } from "./permissions.ts";
import { postOperationalNotice, type OperationalNoticeKind } from "./notices.ts";
import type { TicketCategory } from "./types.ts";

const SECRET_PATH = "/tmp/mortis-op-secret";

const g = globalThis as typeof globalThis & {
  __mortisRuntime?: Promise<MortisRuntime>;
  __mortisOpSecret?: string;
};

export function operatorSecret(): string {
  if (!g.__mortisOpSecret) {
    g.__mortisOpSecret = randomBytes(24).toString("hex");
    try {
      writeFileSync(SECRET_PATH, g.__mortisOpSecret, { mode: 0o600 });
    } catch {
      /* best-effort */
    }
  }
  return g.__mortisOpSecret;
}

export function isLoopbackOperator(request: Request): boolean {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return false;
  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp !== "127.0.0.1" && realIp !== "::1") return false;
  const host = request.headers.get("host") ?? "";
  return host.startsWith("127.0.0.1") || host.startsWith("localhost") || host.startsWith("[::1]");
}

export async function getLiveRuntime(): Promise<MortisRuntime | null> {
  if (!g.__mortisRuntime) return null;
  try {
    return await g.__mortisRuntime;
  } catch {
    return null;
  }
}

function stripSecrets<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v === "string") {
      // Bot <token.token.token> — not the English phrase "Bot posted."
      if (/\bBot\s+[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(v)) return "[redacted]";
      if (v.length > 40 && /[MN][A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(v)) return "[redacted]";
      return v;
    }
    if (typeof v !== "object") return v;
    if (seen.has(v as object)) return "[cycle]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/token|secret|authorization|webhook/i.test(k) && k !== "webhookCount") {
        out[k] = val ? "[present]" : "";
        continue;
      }
      out[k] = walk(val);
    }
    return out;
  };
  return walk(value) as T;
}

async function diagnoseOverwrites(rt: MortisRuntime) {
  if (!rt.guild.live) throw new Error("not live");
  attachCurrentRestMethods(rt.guild);
  const held = (() => {
    try {
      return BigInt(rt.liveIdentity?.permissions ?? rt.guild.botPermissions ?? "0");
    } catch {
      return 0n;
    }
  })();
  const audit = auditHeldPermissions(held);
  const sampleId =
    rt.store.blueprintState.get("arrival.notice") ??
    rt.store.blueprintState.get("support.desk") ??
    rt.guild.channels.find((c) => c.type === 0)?.id;
  const probes: Array<Record<string, unknown>> = [];
  if (sampleId && rt.guild.botUserId) {
    const variants: Array<{ name: string; allow: bigint }> = [
      { name: "legacy_pin_and_manage_messages", allow: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY | PERM.EMBED_LINKS | PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS | PERM.MANAGE_WEBHOOKS | PERM.PIN_MESSAGES },
      { name: "held_only", allow: botMemberAllowBits(held) },
      { name: "pin_only_plus_view", allow: PERM.VIEW_CHANNEL | PERM.PIN_MESSAGES },
    ];
    for (const v of variants) {
      try {
        await restApi(rt.guild, "PUT", `/channels/${sampleId}/permissions/${rt.guild.botUserId}`, {
          type: 1,
          allow: v.allow.toString(),
          deny: "0",
        });
        probes.push({ name: v.name, ok: true, allow: v.allow.toString() });
      } catch (err) {
        const e = err as Error & { status?: number; body?: string };
        probes.push({ name: v.name, ok: false, status: e.status, body: e.body, allow: v.allow.toString() });
      }
    }
    // restore held-only
    try {
      await restApi(rt.guild, "PUT", `/channels/${sampleId}/permissions/${rt.guild.botUserId}`, {
        type: 1,
        allow: botMemberAllowBits(held).toString(),
        deny: "0",
      });
    } catch {
      /* restore best-effort */
    }
  }
  const sweep: Array<{ id: string; key?: string; ok: boolean; warning?: string }> = [];
  for (const { id, key } of overwriteSweepTargets(rt.bp, rt.store)) {
    const r = await ensureBotChannelAccess(rt.guild, id);
    sweep.push({ id, key, ok: r.ok, warning: r.warning });
  }
  return {
    sampleId,
    held: held.toString(),
    audit,
    required: botPermissionInteger().toString(),
    probes,
    sweep,
    failCount: sweep.filter((s) => !s.ok).length,
  };
}

export async function executeLocalOp(
  rt: MortisRuntime,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  switch (action) {
    case "snapshot":
      return rt.snapshot();
    case "validate":
      return rt.validate();
    case "plan": {
      if (rt.guild.live) await (rt.guild as DiscordRestGuild).hydrate();
      return plan(rt.bp, rt.store, rt.guild);
    }
    case "apply": {
      if (rt.guild.live && !rt.scratchConfirmed) throw new Error("scratch confirmation required");
      if (rt.guild.live) await (rt.guild as DiscordRestGuild).hydrate();
      return apply(rt.bp, rt.store, rt.guild, {
        actor: "owner-cli",
        appId: rt.env.DISCORD_APP_ID,
        confirmDelete: Array.isArray(payload.confirmDelete) ? (payload.confirmDelete as string[]) : undefined,
      });
    }
    case "health":
      return rt.health();
    case "overwriteDiagnose":
      return diagnoseOverwrites(rt);
    case "overwriteSweep": {
      const grant = await ensureBotHasPresentationRole(rt.guild, rt.store.blueprintState.get("role.bot"));
      const warnings: string[] = [];
      if (!grant.ok && grant.warning) warnings.push(grant.warning);
      for (const cat of rt.bp.categories) {
        const id = rt.store.blueprintState.get(cat.key);
        if (!id) continue;
        const r = await ensureBotChannelAccess(rt.guild, id);
        if (!r.ok && r.warning) warnings.push(`${cat.key}: ${r.warning}`);
      }
      for (const ch of rt.bp.channels) {
        const id = rt.store.blueprintState.get(ch.key);
        if (!id) continue;
        const r = await ensureBotChannelAccess(rt.guild, id);
        if (!r.ok && r.warning) warnings.push(`${ch.key}: ${r.warning}`);
      }
      rt.overwriteWarnings = warnings;
      return { ok: warnings.length === 0, grant, warnings, managedBotRole: discordManagedBotRole(rt.guild)?.id };
    }
    case "pins":
      return refreshPins(rt.bp, rt.store, rt.guild, "owner-cli");
    case "dispatch":
      return rt.dispatch({
        channel_key: String(payload.channel_key ?? "network.status"),
        template_key: String(payload.template_key ?? "tpl.ops.deployment"),
        fields: (payload.fields as Record<string, string> | undefined) ?? { status: "complete" },
        caller: { type: "staff", snowflake: "owner_1" },
      });
    case "notice":
      return postOperationalNotice(rt, String(payload.kind ?? "maintenance") as OperationalNoticeKind, (payload.fields as Record<string, string>) ?? { status: "complete" });
    case "ticket": {
      const cat = parseTicketCategory(String(payload.category ?? "general"));
      if (!cat) throw new Error("invalid_category");
      return createTicket(
        {
          opener: String(payload.opener ?? ""),
          handle: String(payload.handle ?? "live-op"),
          category: cat as TicketCategory,
          body: String(payload.body ?? "live operator test"),
        },
        rt,
      );
    }
    case "ticketAct": {
      const id = String(payload.id ?? "");
      const act = String(payload.act ?? "claim");
      if (act === "claim") return claimTicket(rt.store, id, "owner_1", rt.guild, rt.bp);
      if (act === "reopen") return reopenTicket(rt.store, rt.guild, id, "owner_1", rt.bp);
      return closeTicket(rt.store, rt.guild, id, "owner_1", rt.bp);
    }
    case "lockdown":
      await enactLockdown(rt.ctx(), "owner_1");
      return { ok: true, lockdown: rt.store.lockdown, invitesPaused: rt.store.invitesPaused };
    case "lift":
      await liftLockdown(rt.ctx(), "owner_1");
      return { ok: true, lockdown: rt.store.lockdown };
    case "retract":
      return rt.retract(String(payload.channel_key ?? ""), String(payload.message_id ?? ""), String(payload.reason ?? "operator retract"));
    case "intake":
      return rt.intake({
        snowflake: String(payload.snowflake ?? ""),
        handle: String(payload.handle ?? "live"),
        callsign: payload.callsign ? String(payload.callsign) : undefined,
      });
    case "reconnect":
      return { ok: true, gateway: rt.reconnectGateway() };
    case "adopt": {
      if (rt.guild.live) await (rt.guild as DiscordRestGuild).hydrate();
      await adopt(rt.store, rt.guild, String(payload.key ?? ""), String(payload.snowflake ?? ""));
      return { ok: true, key: payload.key, snowflake: payload.snowflake };
    }
    case "liveReadiness":
      return rt.liveReadiness({
        appId: String(payload.appId ?? rt.env.DISCORD_APP_ID),
        guildId: String(payload.guildId ?? rt.guild.id),
        network: payload.network === true,
      });
    case "restGet": {
      const path = String(payload.path ?? "");
      if (!path.startsWith("/")) throw new Error("path must start with /");
      if (!rt.guild.live) throw new Error("not live");
      attachCurrentRestMethods(rt.guild);
      const data = await restApi(rt.guild, "GET", path);
      return stripSecrets(data);
    }
    case "rest": {
      const path = String(payload.path ?? "");
      const method = String(payload.method ?? "GET").toUpperCase();
      if (!path.startsWith("/")) throw new Error("path must start with /");
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("method");
      if (!rt.guild.live) throw new Error("not live");
      attachCurrentRestMethods(rt.guild);
      const data = await restApi(rt.guild, method, path, payload.body);
      return stripSecrets(data);
    }
    default:
      throw new Error(`unknown action ${action}`);
  }
}

export async function handleLocalOpRequest(request: Request): Promise<Response> {
  operatorSecret();
  if (request.method === "GET") {
    if (!isLoopbackOperator(request)) return new Response("forbidden", { status: 403 });
    const rt = await getLiveRuntime();
    return Response.json({
      ok: true,
      hasRuntime: Boolean(rt),
      live: rt?.guild.live === true,
      connected: rt?.snapshot().live.connected === true,
    });
  }
  if (request.method !== "POST") return new Response("method", { status: 405 });
  if (!isLoopbackOperator(request)) return new Response("forbidden", { status: 403 });
  const rt = await getLiveRuntime();
  if (!rt) return Response.json({ ok: false, error: "runtime not booted — open Provision once so the singleton exists" }, { status: 409 });
  let body: { action?: string; payload?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as { action?: string; payload?: Record<string, unknown> };
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  try {
    const result = await executeLocalOp(rt, action, body.payload ?? {});
    return Response.json(stripSecrets({ ok: true, action, result }));
  } catch (err) {
    const e = err as Error & { status?: number; body?: string };
    return Response.json(
      stripSecrets({ ok: false, action, error: e.message, status: e.status, body: e.body }),
      { status: 200 },
    );
  }
}
