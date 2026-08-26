import { generateOverwrites, PERM } from "./permissions.ts";
import { ensureBotChannelAccess } from "./discord-rest.ts";
import { dispatchSend, mirrorAudit } from "./dispatch.ts";
import { scanRestricted } from "./terms.ts";
import { channelByKey } from "./blueprint.ts";
import type { SimulatedGuild } from "./discord-sim.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint, TicketCategory, TicketRow } from "./types.ts";
import type { Overwrite } from "./permissions.ts";

const REPORT_APPEAL: TicketCategory[] = ["report", "appeal"];
const MAX_OPEN_PER_OPENER = 2;
export const TICKET_CATEGORIES: TicketCategory[] = ["general", "report", "appeal", "accessibility"];

export function parseTicketCategory(raw: string | undefined | null): TicketCategory | null {
  const c = (raw ?? "").trim().toLowerCase();
  return (TICKET_CATEGORIES as string[]).includes(c) ? (c as TicketCategory) : null;
}

function isSnowflake(id: string | undefined | null): id is string {
  return Boolean(id && /^\d{17,20}$/.test(id));
}

function staffAllowedToSee(store: EnvoyStore, staffSnowflake: string, category: TicketCategory): boolean {
  const staff = store.staff.get(staffSnowflake);
  if (!staff) return false;
  if (REPORT_APPEAL.includes(category)) {
    return staff.capabilities.includes("ticket.report.read") || staff.capabilities.includes("*");
  }
  return staff.capabilities.includes("ticket.claim") || staff.capabilities.includes("*");
}

function errDetail(err: unknown): { message: string; status?: number; body?: string } {
  const e = err as Error & { status?: number; body?: string };
  const message = e.message ?? String(err);
  return { message, status: e.status, body: e.body };
}

function isBlueprintPlayerChannel(bp: Blueprint, store: EnvoyStore, channelId: string): boolean {
  const key = store.reverseState.get(channelId);
  if (!key) return false;
  const ch = channelByKey(bp, key);
  if (!ch) return false;
  return ch.audience !== "staff" && ch.register !== "staff";
}

function openCountFor(store: EnvoyStore, opener: string): number {
  return [...store.tickets.values()].filter((t) => t.opener === opener && t.status !== "closed").length;
}

async function putBotOverwrite(guild: SimulatedGuild, channelId: string): Promise<void> {
  const r = await ensureBotChannelAccess(guild, channelId);
  if (!r.ok && r.warning) throw Object.assign(new Error(r.warning), { status: 403 });
}

async function staffTicketNotice(
  ctx: { bp: Blueprint; store: EnvoyStore; guild: SimulatedGuild },
  fields: Record<string, string>,
): Promise<void> {
  try {
    await dispatchSend(
      {
        channel_key: "staff.inbox",
        template_key: "tpl.ticket.system",
        fields,
        caller: { type: "owner-cli" },
      },
      ctx,
    );
  } catch {
    /* staff inbox optional */
  }
}

async function logTicketFail(
  ctx: { bp: Blueprint; store: EnvoyStore; guild: SimulatedGuild },
  detail: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const failAud = ctx.store.appendAudit({
    actor: "owner-cli",
    action: "ticket.create",
    target: "ticket_modal",
    outcome: "fail",
    details: { error: detail.slice(0, 400), ...extra },
  });
  await mirrorAudit(ctx.store, ctx.guild, failAud.id);
  await staffTicketNotice(ctx, {
    ticket_id: "none",
    status: "CREATE FAILED",
    category: String(extra.category ?? "unknown"),
    opener: String(extra.opener ?? "unknown"),
  });
}

function ticketName(category: string, opener: string): string {
  const suffix = (opener.replace(/[^a-zA-Z0-9]/g, "").slice(-4) || "ops").toLowerCase();
  const slug = `ticket-${category}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 100) || "ticket";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "\x26amp;")
    .replace(/</g, "\x26lt;")
    .replace(/>/g, "\x26gt;")
    .replace(/"/g, "\x26quot;");
}

async function postTicketChannel(
  bp: Blueprint,
  store: EnvoyStore,
  guild: SimulatedGuild,
  channelId: string,
  content: string,
  author?: string,
  components?: unknown[],
): Promise<void> {
  if (isBlueprintPlayerChannel(bp, store, channelId)) {
    throw new Error("ticket path refused: would post to a player-facing blueprint channel");
  }
  try {
    await guild.postMessage(channelId, content, author, components);
  } catch {
    await guild.postMessage(channelId, content);
  }
}

export async function createTicket(
  opts: {
    opener: string;
    handle: string;
    category: TicketCategory;
    body: string;
  },
  ctx: { bp: Blueprint; store: EnvoyStore; guild: SimulatedGuild; cwd?: string },
): Promise<TicketRow> {
  const { store, guild, bp } = ctx;
  if (!TICKET_CATEGORIES.includes(opts.category)) {
    throw new Error("invalid_category");
  }
  if (openCountFor(store, opts.opener) >= MAX_OPEN_PER_OPENER) {
    throw new Error("rate_limited");
  }

  const parentRaw = store.blueprintState.get("support") ?? null;
  const parent = !guild.live || isSnowflake(parentRaw) ? parentRaw : null;
  const initiate = store.blueprintState.get("role.initiate") ?? "missing";
  const shadow = store.blueprintState.get("role.shadow") ?? "missing";
  const owner = store.blueprintState.get("role.owner");
  const operations = store.blueprintState.get("role.operations");
  const staffIds = REPORT_APPEAL.includes(opts.category)
    ? ([owner, operations].filter(Boolean) as string[])
    : (bp.roles.filter((r) => r.tier === "staff").map((r) => store.blueprintState.get(r.key)).filter(Boolean) as string[]);

  const botRole = store.blueprintState.get("role.bot") ?? guild.botUserId;
  let overwrites = generateOverwrites({
    guildId: guild.id,
    audience: "granted",
    kind: "text",
    readonly: false,
    roleSnowflakes: {
      everyone: guild.id,
      initiate,
      shadow,
      staff: staffIds.filter((id) => !guild.live || isSnowflake(id)),
      bot: botRole,
    },
  });

  if (guild.live) {
    overwrites = overwrites.filter((o) => isSnowflake(o.id));
  }

  if (!guild.live || isSnowflake(opts.opener)) {
    overwrites.push({
      id: opts.opener,
      type: 1,
      allow: (PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY).toString(),
      deny: "0",
    });
  }

  if (guild.live && isSnowflake(guild.botUserId) && !overwrites.some((o) => o.id === guild.botUserId)) {
    overwrites.push({
      id: guild.botUserId,
      type: 1,
      allow: (PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY | PERM.MANAGE_CHANNELS | PERM.MANAGE_WEBHOOKS).toString(),
      deny: "0",
    });
  }

  const name = ticketName(opts.category, opts.opener);
  const body = (opts.body ?? "").trim() || "(no details)";
  const restricted = scanRestricted(body, {}, ctx.cwd);
  let posted = body;
  if (restricted.blocked) {
    posted = "[held for staff review — restricted terms in opener text]";
  }

  const minimal: Overwrite[] = [
    {
      id: guild.id,
      type: 0,
      allow: "0",
      deny: (PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY).toString(),
    },
  ];
  if (guild.live && isSnowflake(guild.botUserId)) {
    minimal.push({
      id: guild.botUserId,
      type: 1,
      allow: (PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY | PERM.MANAGE_MESSAGES).toString(),
      deny: "0",
    });
  }
  if (!guild.live || isSnowflake(opts.opener)) {
    minimal.push({
      id: opts.opener,
      type: 1,
      allow: (PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY).toString(),
      deny: "0",
    });
  }

  const attempt = async (over: Overwrite[], parentId: string | null) =>
    guild.createChannel({
      name,
      type: 0,
      parent_id: parentId,
      topic: `${opts.category} ticket`,
      permission_overwrites: over,
    });

  const id = store.nextId("tkt");
  const row: TicketRow = {
    id,
    opener: opts.opener,
    category: opts.category,
    status: "open",
    assignee: null,
    channel_snowflake: "",
    transcript_key: null,
    created_at: new Date().toISOString(),
    closed_at: null,
  };
  store.tickets.set(id, row);

  let ch;
  try {
    ch = await attempt(overwrites, parent);
  } catch (err) {
    const first = errDetail(err);
    if (first.status === 403 || first.status === 400) {
      if (parent) {
        try {
          await putBotOverwrite(guild, parent);
        } catch {
          /* continue */
        }
      }
      try {
        ch = await attempt(overwrites, parent);
      } catch (err2) {
        const second = errDetail(err2);
        try {
          ch = await attempt(minimal, parent);
        } catch {
          try {
            ch = await attempt(minimal, null);
          } catch (err4) {
            store.tickets.delete(id);
            const last = errDetail(err4);
            const detail = `${last.message}${last.body && !last.message.includes(last.body) ? ` ${last.body}` : ""}`;
            await logTicketFail(ctx, detail, {
              first: first.body ?? first.message,
              second: second.body ?? second.message,
              parent,
              name,
              category: opts.category,
              opener: opts.opener,
            });
            throw Object.assign(new Error(detail), { status: last.status, body: last.body });
          }
        }
      }
    } else {
      store.tickets.delete(id);
      const detail = `${first.message}${first.body && !first.message.includes(first.body) ? ` ${first.body}` : ""}`;
      await logTicketFail(ctx, detail, { parent, name, category: opts.category, opener: opts.opener });
      throw Object.assign(new Error(detail), { status: first.status, body: first.body });
    }
  }

  if (!ch) {
    store.tickets.delete(id);
    throw new Error("ticket channel unresolved");
  }

  if (isBlueprintPlayerChannel(bp, store, ch.id)) {
    store.tickets.delete(id);
    throw new Error("ticket path refused: channel resolved to player-facing blueprint object");
  }

  row.channel_snowflake = ch.id;
  const created = store.appendAudit({
    actor: opts.opener,
    action: "ticket.create",
    target: id,
    details: { category: opts.category, channel: ch.id, restricted: restricted.blocked },
  });
  await mirrorAudit(store, guild, created.id);
  try {
    await postTicketChannel(bp, store, guild, ch.id, posted, opts.opener);
    await postTicketChannel(bp, store, guild, ch.id, `Ticket ${id} · ${opts.category}`, guild.botUserId, [
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: `ticket_claim:${id}`, label: "Claim" },
          { type: 2, style: 2, custom_id: `ticket_close:${id}`, label: "Close" },
          { type: 2, style: 2, custom_id: `ticket_reopen:${id}`, label: "Reopen" },
        ],
      },
    ]);
  } catch (err) {
    const e = errDetail(err);
    store.appendAudit({
      actor: opts.opener,
      action: "ticket.create",
      target: id,
      outcome: "fail",
      details: { channel: ch.id, post_warn: e.message, body: e.body },
    });
    throw Object.assign(
      new Error(`ticket opened; controls failed: ${e.message}${e.body && !e.message.includes(e.body) ? ` ${e.body}` : ""}`.slice(0, 400)),
      { status: e.status, body: e.body },
    );
  }
  if (restricted.blocked) {
    await staffTicketNotice(ctx, {
      ticket_id: id,
      status: "RESTRICTED HOLD",
      category: opts.category,
      opener: opts.opener,
    });
  }
  await staffTicketNotice(ctx, {
    ticket_id: id,
    status: "OPEN",
    category: opts.category,
    opener: opts.opener,
  });
  return row;
}

export async function claimTicket(
  store: EnvoyStore,
  ticketId: string,
  staffSnowflake: string,
  guild?: SimulatedGuild,
  bp?: Blueprint,
): Promise<TicketRow> {
  const row = store.tickets.get(ticketId);
  if (!row) throw new Error("unknown ticket");
  if (row.status === "closed") throw new Error("closed");
  if (!staffAllowedToSee(store, staffSnowflake, row.category)) throw new Error("unauthorized");
  if (guild && row.channel_snowflake) {
    try {
      if (bp) await postTicketChannel(bp, store, guild, row.channel_snowflake, "Ticket claimed.");
      else await guild.postMessage(row.channel_snowflake, "Ticket claimed.");
    } catch (err) {
      const e = err as Error & { body?: string };
      throw Object.assign(new Error(`claim discord: ${e.message}${e.body ? ` ${e.body}` : ""}`), { body: e.body });
    }
  }
  row.status = "claimed";
  row.assignee = staffSnowflake;
  const claimed = store.appendAudit({ actor: staffSnowflake, action: "ticket.claim", target: ticketId, details: {} });
  if (guild) await mirrorAudit(store, guild, claimed.id);
  return row;
}

export async function closeTicket(
  store: EnvoyStore,
  guild: SimulatedGuild,
  ticketId: string,
  staffSnowflake: string,
  bp?: Blueprint,
): Promise<TicketRow> {
  const row = store.tickets.get(ticketId);
  if (!row) throw new Error("unknown ticket");
  if (!staffAllowedToSee(store, staffSnowflake, row.category)) throw new Error("unauthorized");
  const ch = guild.channelById(row.channel_snowflake);
  if (row.channel_snowflake) {
    try {
      if (bp) await postTicketChannel(bp, store, guild, row.channel_snowflake, "Ticket closed. Transcript stored.");
      else await guild.postMessage(row.channel_snowflake, "Ticket closed. Transcript stored.");
    } catch (err) {
      const e = err as Error & { body?: string };
      throw Object.assign(new Error(`close discord: ${e.message}${e.body ? ` ${e.body}` : ""}`), { body: e.body });
    }
  }
  const transcript = (ch?.messages ?? []).map((m) => `${m.timestamp} ${m.author_id}: ${m.content}`).join("\n");
  const key = `transcripts/${ticketId}.txt`;
  store.r2.set(key, transcript);
  store.r2.set(
    `transcripts/${ticketId}.html`,
    `<!doctype html><meta charset="utf-8"><title>Ticket ${escapeHtml(ticketId)}</title><pre>${escapeHtml(transcript)}</pre>`,
  );
  row.transcript_key = key;
  row.status = "closed";
  row.closed_at = new Date().toISOString();
  if (ch) ch.archived = true;
  if (guild.live && row.channel_snowflake) {
    const closedName = `closed-${ticketId.replace(/_/g, "-")}`.slice(0, 100);
    try {
      await guild.patchChannel(row.channel_snowflake, {
        name: closedName,
        topic: `${row.category} ticket · closed`,
      });
    } catch (err) {
      const e = err as Error & { body?: string };
      throw Object.assign(new Error(`close discord: ${e.message}${e.body ? ` ${e.body}` : ""}`), { body: e.body });
    }
  }
  const closed = store.appendAudit({
    actor: staffSnowflake,
    action: "ticket.close",
    target: ticketId,
    details: { transcript_key: key, bytes: transcript.length, html: `transcripts/${ticketId}.html` },
  });
  await mirrorAudit(store, guild, closed.id);
  return row;
}

export async function reopenTicket(
  store: EnvoyStore,
  guild: SimulatedGuild,
  ticketId: string,
  staffSnowflake: string,
  bp: Blueprint,
): Promise<TicketRow> {
  const row = store.tickets.get(ticketId);
  if (!row) throw new Error("unknown ticket");
  if (row.status !== "closed") throw new Error("not closed");
  if (!staffAllowedToSee(store, staffSnowflake, row.category)) throw new Error("unauthorized");
  if (openCountFor(store, row.opener) >= MAX_OPEN_PER_OPENER) {
    throw new Error("rate_limited");
  }
  const ch = guild.channelById(row.channel_snowflake);
  if (guild.live && row.channel_snowflake) {
    try {
      await guild.patchChannel(row.channel_snowflake, {
        name: ticketName(row.category, row.opener),
        topic: `${row.category} ticket · reopened`,
      });
    } catch (err) {
      const e = err as Error & { body?: string };
      throw Object.assign(new Error(`reopen discord: ${e.message}${e.body ? ` ${e.body}` : ""}`), { body: e.body });
    }
  }
  if (ch) ch.archived = false;
  if (row.channel_snowflake) {
    await postTicketChannel(bp, store, guild, row.channel_snowflake, "Ticket reopened.");
  }
  row.status = "open";
  row.closed_at = null;
  row.assignee = null;
  const aud = store.appendAudit({ actor: staffSnowflake, action: "ticket.reopen", target: ticketId, details: {} });
  await mirrorAudit(store, guild, aud.id);
  return row;
}

export function staffCanViewTicket(store: EnvoyStore, staffSnowflake: string, ticket: TicketRow): boolean {
  return staffAllowedToSee(store, staffSnowflake, ticket.category);
}
