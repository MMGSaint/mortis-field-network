import { scanRestricted, scanDeveloper, type ScanContext } from "./terms.ts";
import { verifyReleaseExcerpt } from "./crypto.ts";
import type { SimulatedGuild } from "./discord-sim.ts";
import { withBackoff } from "./discord-sim.ts";
import { attachCurrentRestMethods, ensureBotChannelAccess } from "./discord-rest.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint, DispatchCaller, DispatchRequest, DispatchResult, EventRow, StaffCap } from "./types.ts";
import { channelByKey, templateByKey } from "./blueprint.ts";

const STAFF_SKIP_STEPS = new Set([2, 3, 4, 5, 6]);

function isStaffDestination(bp: Blueprint, channelKey: string): boolean {
  const ch = channelByKey(bp, channelKey);
  return ch?.audience === "staff" || ch?.register === "staff";
}

function callerAuthorized(
  store: EnvoyStore,
  caller: DispatchCaller,
  cap: StaffCap,
): { ok: boolean; actor: string } {
  if (caller.type === "owner-cli") return { ok: true, actor: "owner-cli" };
  if (caller.type === "operations-room") return { ok: true, actor: `ops:${caller.session}` };
  if (caller.type === "cron") {
    const ev = store.events.get(caller.event_id);
    return { ok: Boolean(ev), actor: `cron:${caller.event_id}` };
  }
  const staff = store.staff.get(caller.snowflake);
  if (!staff) return { ok: false, actor: caller.snowflake };
  if (!staff.capabilities.includes(cap) && !staff.capabilities.includes("*")) {
    return { ok: false, actor: caller.snowflake };
  }
  return { ok: true, actor: caller.snowflake };
}

export function interactionRows(ids?: string[]): unknown[] | undefined {
  if (!ids?.length) return undefined;
  const labels: Record<string, string> = {
    terms_accept: "Accept",
    intake_start: "Begin Intake",
    ticket_create: "Open ticket",
  };
  return [
    {
      type: 1,
      components: ids.map((id) => ({
        type: 2,
        style: 1,
        custom_id: id,
        label: labels[id] ?? id,
      })),
    },
  ];
}

function fill(body: string, fields: Record<string, string>): string {
  return body.replace(/\{([a-z_]+)\}/gi, (_, k: string) => fields[k] ?? "");
}

/**
 * THE choke point. No other function may post to a player-facing channel.
 * Staff destinations skip steps 2–6; still do 1, 7, 8.
 *
 * Delivery to Discord goes through `discordDeliver` only, and only from step 7.
 */
export async function dispatchSend(
  req: DispatchRequest,
  ctx: {
    bp: Blueprint;
    store: EnvoyStore;
    guild: SimulatedGuild;
    releasePublicKeyHex?: string;
    cwd?: string;
  },
): Promise<DispatchResult> {
  const { bp, store, guild } = ctx;
  const staffDest = isStaffDestination(bp, req.channel_key);
  const skip = (step: number) => staffDest && STAFF_SKIP_STEPS.has(step);

  const audit = store.appendAudit({
    actor: req.caller.type === "staff" ? req.caller.snowflake : req.caller.type,
    action: "dispatch.send",
    target: req.channel_key,
    details: { template_key: req.template_key, event_id: req.event_id ?? null, fields: req.fields },
    outcome: "pending",
  });

  const fail = async (step: number, reason: string): Promise<DispatchResult> => {
    store.completeAudit(audit.id, "fail", { step, reason });
    if (!staffDest || step === 1) {
      // Alert staff.inbox — but NEVER recurse through player path. Direct staff deliver.
      await staffAlert(store, guild, bp, `DISPATCH HELD step ${step}: ${reason} (audit ${audit.id})`);
    }
    return { ok: false, step, reason, audit_id: audit.id };
  };

  // 1 Authorization
  const auth = callerAuthorized(store, req.caller, "post");
  if (!auth.ok) {
    return fail(1, "unauthorized");
  }

  const tpl = templateByKey(bp, req.template_key);
  const ch = channelByKey(bp, req.channel_key);
  if (!tpl || !ch) return fail(skip(6) ? 1 : 6, "unknown template or channel");

  const body = fill(`${tpl.title}\n\n${tpl.body}`, req.fields);
  let event: EventRow | undefined;
  if (req.event_id) event = store.events.get(req.event_id);

  // 2 Visibility validation
  if (!skip(2)) {
    const contentClass = (tpl.class as "OPERATIONAL" | "NARRATIVE" | undefined) ?? "OPERATIONAL";
    if (contentClass === "NARRATIVE") {
      if (!event || event.state !== "ENACTED") {
        return fail(2, "NARRATIVE requires events.state = ENACTED");
      }
    }
    if (ch.audience === "staff" && tpl.audience !== "staff") {
      return fail(2, "player template refused at staff destination mismatch");
    }
    if (ch.audience === "granted") {
      // Phase 1: granted channels are staff-visible only unless a grant exists.
    }
    const registerOk = registerMatches(ch.register, tpl.register);
    if (!registerOk && ch.register !== "dual" && tpl.register !== "dual") {
      return fail(2, "register/channel-class mismatch");
    }
  }

  // 3 Release/signature validation
  if (!skip(3) && tpl.requires_release) {
    const sig = req.fields.signature;
    const version = req.fields.release_version;
    if (!sig || !version || !ctx.releasePublicKeyHex) {
      return fail(3, "release excerpt missing signature or version");
    }
    const excerpt = {
      version,
      presentation_name: req.fields.presentation_name,
      published_at: req.fields.published_at,
      body: req.fields.excerpt_body ?? "",
    };
    const ok = await verifyReleaseExcerpt({
      publicKeyHex: ctx.releasePublicKeyHex,
      payload: excerpt,
      signatureHex: sig,
    });
    if (!ok) return fail(3, "release signature invalid");
  }

  const scanCtx: ScanContext = {
    published_verbatim: Boolean(tpl.canon_ref) && Boolean(req.fields.verbatim),
    approved_program_template: Boolean(tpl.approved) || tpl.register === "PLAYER_SAFE",
    operational_notice: tpl.class === "OPERATIONAL" || tpl.register === "OPERATIONAL",
  };

  // 4 Restricted-term scan — block, never redact
  if (!skip(4)) {
    const rr = scanRestricted(body, scanCtx, ctx.cwd);
    if (rr.blocked) return fail(4, `restricted-term: ${rr.hits.map((h) => h.id).join(",")}`);
  }

  // 5 Developer-vocabulary scan
  if (!skip(5)) {
    const d = scanDeveloper(body, scanCtx, ctx.cwd);
    if (d.blocked) return fail(5, `dev-vocab: ${d.hits.map((h) => h.id).join(",")}`);
    if (d.warnHold) return fail(5, `dev-vocab-hold: ${d.hits.map((h) => h.id).join(",")}`);
  }

  // 6 Destination/channel validation
  if (!skip(6)) {
    const liveId = store.blueprintState.get(req.channel_key);
    if (!liveId) return fail(6, "channel_key not in blueprint_state");
    const live = guild.channelById(liveId);
    if (!live) return fail(6, "live channel missing");
    const expectedType = ch.kind === "voice" ? 2 : 0;
    if (live.type !== expectedType) return fail(6, "channel kind mismatch");
  }

  // 7 Dispatch
  let messageId: string | undefined;
  try {
    const liveId = store.blueprintState.get(req.channel_key);
    if (!liveId) return fail(7, "channel unresolved at send");
    const msg = await discordDeliver(guild, store, liveId, body, ch.webhook, interactionRows(ch.components));
    messageId = msg.id;
  } catch (e) {
    return fail(7, e instanceof Error ? e.message : "send failed");
  }

  // 8 Audit complete
  store.completeAudit(audit.id, "ok", { message_id: messageId });
  await mirrorAudit(store, guild, audit.id);
  if (event && event.state === "ENACTED") {
    event.state = "DISPATCHED";
  }
  return { ok: true, audit_id: audit.id, message_id: messageId };
}

function registerMatches(channelReg: string, templateReg: string): boolean {
  if (channelReg === templateReg) return true;
  if (channelReg === "dual" || templateReg === "dual") return true;
  if (channelReg === "clear" && (templateReg === "OPERATIONAL" || templateReg === "PLAYER_SAFE")) return true;
  if (channelReg === "ic" && templateReg === "NARRATIVE") return true;
  return false;
}

/**
 * ONLY delivery primitive. Called exclusively from dispatchSend step 7
 * (and staffAlert, which posts only to staff.inbox — never player-facing).
 */
export async function discordDeliver(
  guild: SimulatedGuild,
  store: EnvoyStore,
  channelSnowflake: string,
  content: string,
  preferWebhook: boolean,
  components?: unknown[],
): Promise<{ id: string }> {
  return withBackoff(async () => {
    attachCurrentRestMethods(guild);
    const ch = guild.channelById(channelSnowflake);
    const hook = ch?.webhook?.url ?? store.webhookUrls.get(store.reverseState.get(channelSnowflake) ?? "");

    const viaWebhook = async () => {
      if (!hook) throw new Error("no webhook for 403 fallback");
      const url = hook.includes("?") ? `${hook}&wait=true` : `${hook}?wait=true`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(components?.length ? { content, components } : { content }),
      });
      const text = await res.text();
      if (!res.ok) throw Object.assign(new Error(`discord webhook ${res.status} ${text.slice(0, 180)}`), { status: res.status, body: text.slice(0, 400) });
      const raw = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      return { id: String(raw.id ?? "") };
    };

    if (guild.live) {
      const access = await ensureBotChannelAccess(guild, channelSnowflake);
      if (!access.ok && access.warning) {
        store.appendAudit({
          actor: "owner-cli",
          action: "discord.overwrite",
          target: channelSnowflake,
          outcome: "fail",
          details: { warning: access.warning },
        });
      }
      try {
        const msg = await guild.postMessage(channelSnowflake, content, guild.botUserId, components);
        return { id: msg.id };
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 403 && hook) return viaWebhook();
        throw err;
      }
    }
    try {
      if (preferWebhook && ch?.webhook && !components?.length) {
        return await guild.postMessage(channelSnowflake, content, "webhook");
      }
      return await guild.postMessage(channelSnowflake, content, guild.botUserId, components);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403 && ch?.webhook) {
        return await guild.postMessage(channelSnowflake, content, "webhook", components);
      }
      throw err;
    }
  });
}

async function staffAlert(store: EnvoyStore, guild: SimulatedGuild, bp: Blueprint, text: string): Promise<void> {
  const id = store.blueprintState.get("staff.inbox");
  if (!id) return;
  const ch = channelByKey(bp, "staff.inbox");
  try {
    await discordDeliver(guild, store, id, text, Boolean(ch?.webhook));
  } catch {
    /* inbox alert failure is itself audited by the parent fail path */
  }
}

export async function mirrorAudit(store: EnvoyStore, guild: SimulatedGuild, auditId: string): Promise<void> {
  const row = store.audit.find((a) => a.id === auditId);
  const id = store.blueprintState.get("staff.audit");
  if (!row || !id) return;
  const line = `[${row.at}] ${row.actor} ${row.action} ${row.target ?? ""} → ${row.outcome}`;
  try {
    await discordDeliver(guild, store, id, line, true);
    row.mirrored = true;
  } catch {
    row.mirrored = false;
  }
}

/** Retract is an operator act, also audited, never silent. */
export async function retractMessage(
  store: EnvoyStore,
  guild: SimulatedGuild,
  channelKey: string,
  messageId: string,
  actor: string,
  reason: string,
): Promise<{ ok: true; audit_id: string } | { ok: false; reason: string; audit_id: string }> {
  const chId = store.blueprintState.get(channelKey);
  if (!chId) {
    const audit = store.appendAudit({
      actor,
      action: "dispatch.retract",
      target: channelKey,
      details: { messageId, reason },
      outcome: "fail",
    });
    return { ok: false, reason: "unknown channel", audit_id: audit.id };
  }
  const live = guild.channelById(chId);
  const exists = live?.messages.some((m) => m.id === messageId);
  const audit = store.appendAudit({
    actor,
    action: "dispatch.retract",
    target: channelKey,
    details: { messageId, reason },
    outcome: "pending",
  });
  if (!exists) {
    store.completeAudit(audit.id, "fail", { reason: "message not found" });
    return { ok: false, reason: "message not found", audit_id: audit.id };
  }
  await guild.deleteMessage(chId, messageId);
  store.completeAudit(audit.id, "ok");
  return { ok: true, audit_id: audit.id };
}
