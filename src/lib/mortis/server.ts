import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { MortisRuntime, type RuntimeSnapshot } from "./runtime";
import { runMandatoryTests, runSupplementaryTests, type TestResult } from "./test-suite";
import { createTicket, claimTicket, closeTicket, reopenTicket } from "./tickets.ts";
import { enactLockdown, liftLockdown } from "./envoy.ts";
import { overwritesFor } from "./provision.ts";
import { discordTransportName } from "./discord-rest.ts";
import { createEvent, markEligible } from "./events.ts";
import type { TicketCategory } from "./types.ts";
import { postOperationalNotice, type OperationalNoticeKind } from "./notices.ts";
import type { HealthReport } from "./health.ts";

const g = globalThis as typeof globalThis & { __mortisRuntime?: Promise<MortisRuntime> };

async function runtime(): Promise<MortisRuntime> {
  if (!g.__mortisRuntime) {
    g.__mortisRuntime = (async () => {
      const rt = MortisRuntime.load(process.cwd());
      await rt.bootstrapKeys();
      rt.seedOwner("owner_1", "owner");
      rt.seedOperations("ops_1", "ops");
      return rt;
    })();
  }
  return g.__mortisRuntime;
}

export const getSnapshot = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<RuntimeSnapshot & { inviteUrl: string; perms: string; validated: boolean; issues: string[] }> => {
    const rt = await runtime();
    const v = rt.validate();
    return {
      ...rt.snapshot(),
      inviteUrl: rt.inviteUrl(),
      perms: rt.permissionInteger(),
      validated: v.ok,
      issues: v.issues.map((i) => `${i.level}:${i.path}:${i.message}`),
    };
  });

export const connectDiscord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { token: string; guildId: string; appId: string; publicKey?: string; confirmScratch: boolean }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    const identity = await rt.attachLive({
      token: data.token,
      guildId: data.guildId.trim(),
      appId: data.appId.trim(),
      publicKey: data.publicKey?.trim() || undefined,
      confirmScratch: data.confirmScratch,
    });
    const p = await rt.plan();
    return { identity, plan: p };
  });

export const reconnectGateway = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    if (!rt.guild.live) throw new Error("not connected to scratch guild — connect first");
    const status = rt.reconnectGateway();
    return { ok: true, gateway: status };
  });

export const runValidate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    const v = rt.validate();
    return {
      ok: v.ok,
      checks: v.issues.length
        ? v.issues.map((i) => ({ ok: i.level !== "error", name: i.path, detail: i.message }))
        : [{ ok: true, name: "blueprint", detail: "valid" }],
    };
  });

export const runPlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    return rt.plan();
  });

export const runApply = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { confirmScratch?: boolean; confirmDelete?: string[] }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    if (rt.guild.live && !data.confirmScratch) throw new Error("scratch confirmation required");
    return rt.apply({ confirmDelete: data.confirmDelete });
  });

export const runDispatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { channel_key: string; template_key: string; fields?: Record<string, string>; asStaff?: boolean }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    return rt.dispatch({
      channel_key: data.channel_key,
      template_key: data.template_key,
      fields: data.fields ?? {},
      caller: data.asStaff === false ? { type: "staff", snowflake: "imposter_1" } : { type: "staff", snowflake: "owner_1" },
    });
  });

export const runIntake = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { snowflake: string; handle: string; callsign?: string }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    return rt.intake(data);
  });

export const runTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { opener: string; handle: string; category: TicketCategory; body: string }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    if (rt.guild.live && !/^\d{17,20}$/.test(data.opener)) {
      throw new Error("live tickets require a Discord member snowflake as opener — not a demo handle");
    }
    try {
      return await createTicket(data, rt);
    } catch (err) {
      const e = err as Error & { body?: string };
      throw new Error(e.body ? `${e.message}` : e instanceof Error ? e.message : String(err));
    }
  });

export const runTicketAct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; act: "claim" | "close" | "reopen" }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    if (data.act === "claim") return claimTicket(rt.store, data.id, "owner_1", rt.guild, rt.bp);
    if (data.act === "reopen") return reopenTicket(rt.store, rt.guild, data.id, "owner_1", rt.bp);
    return closeTicket(rt.store, rt.guild, data.id, "owner_1", rt.bp);
  });

export const runLockdown = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    await enactLockdown(rt.ctx(), "owner_1");
    return { ok: true, lockdown: true };
  });

export const runLiftLockdown = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    await liftLockdown(rt.ctx(), "owner_1");
    return { ok: true, lockdown: false };
  });

export const runRefreshPins = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    if (!rt.guild.live) {
      throw new Error("not connected to scratch guild — connect first");
    }
    const { refreshPins } = await import("./provision.ts");
    try {
      const results = await refreshPins(rt.bp, rt.store, rt.guild, "owner-cli");
      return { live: true, guildId: rt.guild.id, results };
    } catch (e) {
      const err = e as Error & { body?: string };
      throw new Error(err.body ? `${err.message} ${err.body}` : err instanceof Error ? err.message : String(e));
    }
  });

export const runSetPublicKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { publicKey: string }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    const key = data.publicKey.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("public key must be 64 hex chars");
    rt.env.DISCORD_PUBLIC_KEY = key;
    return { ok: true };
  });

export const runDriftProbe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { phase: "drift" | "restore" }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    const id = rt.store.blueprintState.get("network.status");
    if (!id) throw new Error("network.status not bound — apply first");
    if (data.phase === "drift") {
      const live = rt.guild.channelById(id);
      await rt.guild.patchChannel(id, { topic: "scratch-drift-probe" });
      const p = await rt.plan();
      return { phase: "drift", previousTopic: live?.topic ?? "", plan: p };
    }
    const r = await rt.apply();
    return { phase: "restore", applied: r.applied, no_op: r.no_op, plan: r.plan };
  });

export const runOrphanProbe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { phase: "create" | "reconcile" }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    if (data.phase === "create") {
      const ch = await rt.guild.createChannel({ name: "historical-rp-scratch", type: 0 });
      await rt.guild.postMessage(ch.id, "harmless historical RP placeholder — not world content", "player_x");
      const p = await rt.plan();
      const orphan = p.ops.find((o) => o.op === "orphan" && o.snowflake === ch.id);
      return { phase: "create", snowflake: ch.id, orphan, plan: { orphans: p.orphans } };
    }
    const before = await rt.plan();
    const r = await rt.apply();
    const still = before.ops
      .filter((o) => o.op === "orphan")
      .map((o) => ({
        snowflake: o.snowflake,
        name: o.name,
        has_history: o.has_history,
        live: Boolean(rt.guild.channelById(o.snowflake)),
        archived: rt.guild.channelById(o.snowflake)?.archived ?? false,
      }));
    return { phase: "reconcile", no_op: r.no_op, remaining: still };
  });

export const runPermissionAudit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    const initiate = rt.store.blueprintState.get("role.initiate");
    const staff = rt.store.blueprintState.get("role.operations");
    const rows = rt.bp.channels.map((ch) => {
      const id = rt.store.blueprintState.get(ch.key);
      const live = id ? rt.guild.channelById(id) : undefined;
      const expected = id
        ? overwritesFor(rt.bp, rt.store, rt.guild, ch.audience, ch.kind, ch.readonly, ch.attachments_restricted)
        : [];
      const everyone = live?.permission_overwrites.find((o) => o.id === rt.guild.id);
      const initOw = initiate ? live?.permission_overwrites.find((o) => o.id === initiate) : undefined;
      const staffOw = staff ? live?.permission_overwrites.find((o) => o.id === staff) : undefined;
      return {
        key: ch.key,
        audience: ch.audience,
        bound: Boolean(id),
        everyoneDenyView: everyone ? (BigInt(everyone.deny) & (1n << 10n) ? true : BigInt(everyone.allow) & (1n << 10n) ? false : null) : null,
        initiateView: initOw ? (BigInt(initOw.allow) & (1n << 10n)) !== 0n : null,
        staffView: staffOw ? (BigInt(staffOw.allow) & (1n << 10n)) !== 0n : null,
        expectedEveryone: expected.find((o) => o.id === rt.guild.id) ?? null,
      };
    });
    return { live: rt.guild.live, transportExample: discordTransportName("CONDUCT AND TERMS", 0), rows };
  });

export const runNarrativeProbe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    const ev = createEvent(rt.store, { class: "NARRATIVE", template_ref: "tpl.ops.deployment", audience: "initiate+" }, "owner_1");
    markEligible(rt.store, ev.id, "owner_1");
    const blocked = await rt.dispatch({
      channel_key: "network.dispatches",
      template_key: "tpl.ops.deployment",
      fields: { status: "complete" },
      event_id: ev.id,
      caller: { type: "staff", snowflake: "owner_1" },
    });
    return { event: ev.id, state: rt.store.events.get(ev.id)?.state, blocked: blocked.ok === false, step: blocked.step, reason: blocked.reason };
  });

export const runTestsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ mandatory: TestResult[]; supplementary: TestResult[] }> => {
    const cwd = process.cwd();
    const mandatory = await runMandatoryTests(cwd);
    const supplementary = await runSupplementaryTests(cwd);
    return { mandatory, supplementary };
  });

export const runHealth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async (): Promise<HealthReport> => {
    const rt = await runtime();
    return rt.health();
  });

export const runWalkthrough = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    return rt.walkthrough();
  });

export const runNotice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: OperationalNoticeKind; fields?: Record<string, string> }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    return postOperationalNotice(rt, data.kind, data.fields ?? {});
  });

export const runRetract = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { channel_key: string; message_id: string; reason: string }) => d)
  .handler(async ({ data }) => {
    const rt = await runtime();
    return rt.retract(data.channel_key.trim(), data.message_id.trim(), data.reason.trim() || "operator retract");
  });

export const runRotateWebhooks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    if (!rt.store.lastAppliedHash && !rt.guild.live) {
      throw new Error("apply the blueprint before rotating webhooks");
    }
    return rt.rotateWebhooks();
  });

export const runKillSwitch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const rt = await runtime();
    const res = await rt.fetch(
      new Request("https://envoy.local/cli/kill", {
        method: "POST",
        headers: { authorization: `Bearer ${rt.env.CLI_SECRET}` },
      }),
    );
    return { ok: res.ok, killed: rt.killed, status: res.status };
  });
