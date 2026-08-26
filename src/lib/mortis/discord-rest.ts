/**
 * Live Discord REST transport for mortis-provision.
 * Same GuildSurface as SimulatedGuild. Token is held in a WeakMap — never
 * written to disk, never returned to the client, never logged.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SimulatedGuild, type SimChannel, type SimRole } from "./discord-sim.ts";
import { PERM } from "./permissions.ts";
import type { Overwrite } from "./permissions.ts";

const API = "https://discord.com/api/v10";
const UA = "MortisFieldNetwork-Envoy/phase1 (scratch-validation)";
const STATE_FILE = join(process.cwd(), "data", "scratch-guild-state.json");

const tokens = new WeakMap<DiscordRestGuild, string>();

export type LiveIdentity = {
  guildId: string;
  guildName: string;
  memberCount: number | null;
  channelCount: number;
  roleCount: number;
  botId: string;
  botTag: string;
  permissions: string;
  administrator: boolean;
  missingBits: string[];
};

export type ScratchStateFile = {
  guildId: string;
  bindings: Array<[string, string]>;
  lastAppliedHash: string | null;
};

/** Discord slugifies text/voice names. Categories and roles keep display text. */
export function discordTransportName(display: string, type: number): string {
  if (type === 4) return display.slice(0, 100);
  const slug = display
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return slug || "channel";
}

export function loadScratchState(guildId: string): ScratchStateFile | null {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as ScratchStateFile;
    if (raw.guildId !== guildId) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveScratchState(state: ScratchStateFile): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapRole(raw: Record<string, unknown>): SimRole {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    hoist: Boolean(raw.hoist),
    mentionable: Boolean(raw.mentionable),
    color: Number(raw.color ?? 0),
    position: Number(raw.position ?? 0),
    permissions: String(raw.permissions ?? "0"),
  };
}

function mapChannel(raw: Record<string, unknown>, webhook?: SimChannel["webhook"]): SimChannel {
  const ows = Array.isArray(raw.permission_overwrites)
    ? (raw.permission_overwrites as Array<Record<string, unknown>>).map((o) => ({
        id: String(o.id),
        type: (Number(o.type) === 1 ? 1 : 0) as 0 | 1,
        allow: String(o.allow ?? "0"),
        deny: String(o.deny ?? "0"),
      }))
    : [];
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    type: Number(raw.type ?? 0),
    parent_id: raw.parent_id ? String(raw.parent_id) : null,
    topic: String(raw.topic ?? ""),
    position: Number(raw.position ?? 0),
    rate_limit_per_user: Number(raw.rate_limit_per_user ?? 0),
    permission_overwrites: ows,
    nsfw: Boolean(raw.nsfw),
    messages: [],
    archived: false,
    webhook,
  };
}

/** HMR leaves a live DiscordRestGuild on an old prototype. Rebind current methods in place. */
export function attachCurrentRestMethods(guild: SimulatedGuild): void {
  if (!guild.live) return;
  const proto = DiscordRestGuild.prototype as unknown as Record<string, unknown>;
  for (const name of ["listPins", "editMessage", "unpinMessage", "postMessage", "pinMessage", "deleteMessage", "api", "putGuildCommands"]) {
    const fn = proto[name];
    if (typeof fn === "function") {
      (guild as unknown as Record<string, unknown>)[name] = (fn as (...args: never[]) => unknown).bind(guild);
    }
  }
}

export async function restApi<T = unknown>(guild: SimulatedGuild, method: string, path: string, body?: unknown): Promise<T> {
  attachCurrentRestMethods(guild);
  const g = guild as DiscordRestGuild;
  if (typeof g.api !== "function") throw new Error("live discord api missing");
  return g.api<T>(method, path, body);
}

/** Channel-level bot member overwrite. Prefer this over Administrator. */
export const BOT_MEMBER_ALLOW = (
  PERM.VIEW_CHANNEL |
  PERM.SEND_MESSAGES |
  PERM.READ_MESSAGE_HISTORY |
  PERM.EMBED_LINKS |
  PERM.MANAGE_MESSAGES |
  PERM.MANAGE_CHANNELS |
  PERM.MANAGE_WEBHOOKS
).toString();

export async function ensureBotChannelAccess(
  guild: SimulatedGuild,
  channelId: string,
): Promise<{ ok: boolean; warning?: string }> {
  if (!guild.live) return { ok: true };
  if (!channelId || !/^\d{17,20}$/.test(channelId)) return { ok: true };
  if (!guild.botUserId || !/^\d{17,20}$/.test(guild.botUserId)) {
    return { ok: false, warning: "bot user id missing" };
  }
  try {
    await restApi(guild, "PUT", `/channels/${channelId}/permissions/${guild.botUserId}`, {
      type: 1,
      allow: BOT_MEMBER_ALLOW,
      deny: "0",
    });
    const ch = guild.channelById(channelId);
    const parent = ch?.parent_id;
    if (parent && /^\d{17,20}$/.test(parent) && parent !== channelId) {
      try {
        await restApi(guild, "PUT", `/channels/${parent}/permissions/${guild.botUserId}`, {
          type: 1,
          allow: BOT_MEMBER_ALLOW,
          deny: "0",
        });
      } catch {
        /* parent overwrite optional */
      }
    }
    return { ok: true };
  } catch (err) {
    const e = err as Error & { status?: number; body?: string };
    return {
      ok: false,
      warning: `overwrite ${channelId} ${e.status ?? ""} ${e.message}${e.body ? ` ${e.body}` : ""}`.trim().slice(0, 240),
    };
  }
}

export class DiscordRestGuild extends SimulatedGuild {
  live = true;
  botTag = "";
  botPermissions = "0";
  memberCount: number | null = null;

  constructor(token: string, guildId: string) {
    super();
    this.roles = [];
    this.channels = [];
    this.id = guildId;
    tokens.set(this, token);
  }

  private token(): string {
    const t = tokens.get(this);
    if (!t) throw new Error("discord token missing");
    return t;
  }

  async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bot ${this.token()}`,
          "user-agent": UA,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after") ?? "1");
        await sleep(Math.min(Math.max(retry, 0.25) * 1000, 8000));
        continue;
      }
      if (res.status === 204) return {} as T;
      const text = await res.text();
      if (!res.ok) {
        lastErr = Object.assign(new Error(`discord ${method} ${path} ${res.status}`), {
          status: Number(res.status),
          body: text.slice(0, 400),
        });
        if (res.status >= 500) {
          await sleep(300 * 2 ** attempt);
          continue;
        }
        throw lastErr;
      }
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    }
    throw lastErr ?? new Error("discord rate-limited");
  }

  async putGuildCommands(appId: string, commands: unknown[]): Promise<unknown[]> {
    const result = await this.api<unknown[]>("PUT", `/applications/${appId}/guilds/${this.id}/commands`, commands);
    this.slashCommands = Array.isArray(result) ? result : commands;
    return this.slashCommands as unknown[];
  }

  async hydrate(): Promise<LiveIdentity> {
    const me = await this.api<Record<string, unknown>>("GET", "/users/@me");
    this.botUserId = String(me.id);
    this.botTag = `${String(me.username)}${me.discriminator && me.discriminator !== "0" ? `#${me.discriminator}` : ""}`;

    const guilds = await this.api<Array<Record<string, unknown>>>("GET", "/users/@me/guilds?with_counts=true");
    const g = guilds.find((x) => String(x.id) === this.id);
    if (!g) throw new Error("bot is not in the target guild");
    this.botPermissions = String(g.permissions ?? "0");
    this.memberCount = typeof g.approximate_member_count === "number" ? g.approximate_member_count : null;

    const guild = await this.api<Record<string, unknown>>("GET", `/guilds/${this.id}`);
    this.name = String(guild.name ?? "");
    this.verification_level = Number(guild.verification_level ?? 0);
    this.default_message_notifications = Number(guild.default_message_notifications ?? 0);
    this.explicit_content_filter = Number(guild.explicit_content_filter ?? 0);
    this.preferred_locale = String(guild.preferred_locale ?? "en-US");
    this.system_channel_id = guild.system_channel_id ? String(guild.system_channel_id) : null;

    const roles = await this.api<Array<Record<string, unknown>>>("GET", `/guilds/${this.id}/roles`);
    this.roles = roles.map(mapRole);

    const channels = await this.api<Array<Record<string, unknown>>>("GET", `/guilds/${this.id}/channels`);
    this.channels = [];
    for (const raw of channels) {
      const ch = mapChannel(raw);
      if (raw.type === 0 || raw.type === 5) {
        try {
          const hooks = await this.api<Array<Record<string, unknown>>>("GET", `/channels/${ch.id}/webhooks`);
          const mine = hooks.find((h) => String(h.application_id ?? "") === String(me.id)) ?? hooks[0];
          if (mine?.id && mine.token) {
            ch.webhook = {
              id: String(mine.id),
              token: String(mine.token),
              url: `https://discord.com/api/webhooks/${mine.id}/${mine.token}`,
            };
          }
        } catch {
          /* listing webhooks can 403 on channels the bot cannot manage; ignore */
        }
      }
      this.channels.push(ch);
    }

    const held = BigInt(this.botPermissions);
    const administrator = (held & PERM.ADMINISTRATOR) !== 0n;
    const required: Array<[string, bigint]> = [
      ["VIEW_CHANNEL", PERM.VIEW_CHANNEL],
      ["SEND_MESSAGES", PERM.SEND_MESSAGES],
      ["EMBED_LINKS", PERM.EMBED_LINKS],
      ["READ_MESSAGE_HISTORY", PERM.READ_MESSAGE_HISTORY],
      ["MANAGE_CHANNELS", PERM.MANAGE_CHANNELS],
      ["MANAGE_ROLES", PERM.MANAGE_ROLES],
      ["MANAGE_WEBHOOKS", PERM.MANAGE_WEBHOOKS],
      ["USE_APPLICATION_COMMANDS", PERM.USE_APPLICATION_COMMANDS],
      ["MANAGE_THREADS", PERM.MANAGE_THREADS],
      ["SEND_MESSAGES_IN_THREADS", PERM.SEND_MESSAGES_IN_THREADS],
      ["CONNECT", PERM.CONNECT],
    ];
    const missingBits = required.filter(([, bit]) => (held & bit) === 0n).map(([n]) => n);

    return {
      guildId: this.id,
      guildName: this.name,
      memberCount: this.memberCount,
      channelCount: this.channels.length,
      roleCount: this.roles.filter((r) => r.id !== this.id).length,
      botId: this.botUserId,
      botTag: this.botTag,
      permissions: this.botPermissions,
      administrator,
      missingBits,
    };
  }

  async createRole(body: Partial<SimRole>): Promise<SimRole> {
    const raw = await this.api<Record<string, unknown>>("POST", `/guilds/${this.id}/roles`, {
      name: body.name,
      hoist: Boolean(body.hoist),
      mentionable: Boolean(body.mentionable),
      color: body.color ?? 0,
      permissions: "0",
    });
    const role = mapRole(raw);
    this.roles.push(role);
    return role;
  }

  async patchRole(id: string, body: Partial<SimRole>): Promise<SimRole> {
    const raw = await this.api<Record<string, unknown>>("PATCH", `/guilds/${this.id}/roles/${id}`, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.hoist !== undefined ? { hoist: body.hoist } : {}),
      ...(body.mentionable !== undefined ? { mentionable: body.mentionable } : {}),
    });
    const role = mapRole(raw);
    const idx = this.roles.findIndex((r) => r.id === id);
    if (idx >= 0) this.roles[idx] = role;
    return role;
  }

  async createChannel(body: {
    name: string;
    type: number;
    parent_id?: string | null;
    topic?: string;
    position?: number;
    rate_limit_per_user?: number;
    permission_overwrites?: Overwrite[];
  }): Promise<SimChannel> {
    const name = discordTransportName(body.name, body.type);
    const raw = await this.api<Record<string, unknown>>("POST", `/guilds/${this.id}/channels`, {
      name,
      type: body.type,
      parent_id: body.parent_id ?? undefined,
      topic: body.type === 0 ? body.topic ?? "" : undefined,
      position: body.position,
      rate_limit_per_user: body.type === 0 ? body.rate_limit_per_user ?? 0 : undefined,
      permission_overwrites: body.permission_overwrites,
    });
    const ch = mapChannel(raw);
    this.channels.push(ch);
    return ch;
  }

  async patchChannel(id: string, body: Partial<SimChannel> & { permission_overwrites?: Overwrite[] }): Promise<SimChannel> {
    const live = this.channelById(id);
    const type = live?.type ?? 0;
    const payload: Record<string, unknown> = {};
    if (body.name !== undefined) payload.name = discordTransportName(body.name, type);
    if (body.topic !== undefined) payload.topic = body.topic;
    if (body.position !== undefined) payload.position = body.position;
    if (body.parent_id !== undefined) payload.parent_id = body.parent_id;
    if (body.rate_limit_per_user !== undefined) payload.rate_limit_per_user = body.rate_limit_per_user;
    if (body.permission_overwrites) payload.permission_overwrites = body.permission_overwrites;
    const raw = await this.api<Record<string, unknown>>("PATCH", `/channels/${id}`, payload);
    const prev = this.channelById(id);
    const ch = mapChannel(raw, prev?.webhook);
    ch.archived = Boolean(body.archived ?? prev?.archived);
    ch.messages = prev?.messages ?? [];
    const idx = this.channels.findIndex((c) => c.id === id);
    if (idx >= 0) this.channels[idx] = ch;
    return ch;
  }

  async createWebhook(channelId: string, name: string): Promise<{ id: string; url: string; token: string }> {
    const raw = await this.api<Record<string, unknown>>("POST", `/channels/${channelId}/webhooks`, { name });
    const id = String(raw.id);
    const token = String(raw.token ?? "");
    const url = `https://discord.com/api/webhooks/${id}/${token}`;
    const ch = this.channelById(channelId);
    if (ch) ch.webhook = { id, url, token };
    return { id, url, token };
  }

  async postMessage(channelId: string, content: string, authorId = this.botUserId, components?: unknown[]): Promise<SimChannel["messages"][number]> {
    const payload: Record<string, unknown> = { content };
    if (components?.length) payload.components = components;
    const raw = await this.api<Record<string, unknown>>("POST", `/channels/${channelId}/messages`, payload);
    const msg = {
      id: String(raw.id),
      channel_id: channelId,
      content,
      author_id: authorId === "webhook" ? this.botUserId : authorId,
      timestamp: String(raw.timestamp ?? new Date().toISOString()),
      components,
    };
    const ch = this.channelById(channelId);
    if (ch) ch.messages.push(msg);
    return msg;
  }

  async listPins(channelId: string): Promise<SimChannel["messages"][number][]> {
    const raw = await this.api<Array<Record<string, unknown>>>("GET", `/channels/${channelId}/pins`);
    return (raw ?? []).map((m) => {
      const author = (m.author as Record<string, unknown> | undefined) ?? {};
      return {
        id: String(m.id),
        channel_id: channelId,
        content: String(m.content ?? ""),
        author_id: String(author.id ?? ""),
        timestamp: String(m.timestamp ?? ""),
        pinned: true,
        components: (m.components as unknown[]) ?? [],
      };
    });
  }

  async unpinMessage(channelId: string, messageId: string): Promise<void> {
    await this.api("DELETE", `/channels/${channelId}/pins/${messageId}`);
    const ch = this.channelById(channelId);
    const msg = ch?.messages.find((m) => m.id === messageId);
    if (msg) msg.pinned = false;
  }

  async editMessage(
    channelId: string,
    messageId: string,
    body: { content?: string; components?: unknown[] },
  ): Promise<SimChannel["messages"][number]> {
    const raw = await this.api<Record<string, unknown>>("PATCH", `/channels/${channelId}/messages/${messageId}`, body);
    const ch = this.channelById(channelId);
    let msg = ch?.messages.find((m) => m.id === messageId);
    if (!msg) {
      msg = {
        id: messageId,
        channel_id: channelId,
        content: String(raw.content ?? body.content ?? ""),
        author_id: this.botUserId,
        timestamp: String(raw.timestamp ?? new Date().toISOString()),
        pinned: true,
        components: body.components,
      };
      ch?.messages.push(msg);
    } else {
      if (body.content !== undefined) msg.content = body.content;
      if (body.components !== undefined) msg.components = body.components;
    }
    return msg;
  }

  async pinMessage(channelId: string, messageId: string): Promise<void> {
    await this.api("PUT", `/channels/${channelId}/pins/${messageId}`);
    const ch = this.channelById(channelId);
    const msg = ch?.messages.find((m) => m.id === messageId);
    if (msg) msg.pinned = true;
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.api("DELETE", `/channels/${channelId}/messages/${messageId}`);
    const ch = this.channelById(channelId);
    if (ch) ch.messages = ch.messages.filter((m) => m.id !== messageId);
  }

  async addRole(memberId: string, roleId: string): Promise<void> {
    await this.api("PUT", `/guilds/${this.id}/members/${memberId}/roles/${roleId}`);
  }

  async patchGuild(body: {
    name?: string;
    verification_level?: number;
    default_message_notifications?: number;
    explicit_content_filter?: number;
    preferred_locale?: string;
    system_channel_id?: string | null;
  }): Promise<void> {
    await this.api("PATCH", `/guilds/${this.id}`, body);
    if (body.name !== undefined) this.name = body.name;
    if (body.verification_level !== undefined) this.verification_level = body.verification_level;
    if (body.default_message_notifications !== undefined) this.default_message_notifications = body.default_message_notifications;
    if (body.explicit_content_filter !== undefined) this.explicit_content_filter = body.explicit_content_filter;
    if (body.preferred_locale !== undefined) this.preferred_locale = body.preferred_locale;
    if (body.system_channel_id !== undefined) this.system_channel_id = body.system_channel_id;
  }

  async pauseInvites(untilIso: string | null): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.api("PUT", `/guilds/${this.id}/incident-actions`, {
        invites_disabled_until: untilIso,
      });
      this.invitesPaused = Boolean(untilIso);
      return { ok: true, detail: untilIso ? "invites paused via incident-actions" : "invites resumed" };
    } catch (e) {
      const err = e as { status?: number };
      this.invitesPaused = Boolean(untilIso);
      return {
        ok: false,
        detail: `invite pause via incident-actions returned ${err.status ?? "error"} (Manage Server is intentionally not in the least-privilege set). Arrival close still applies.`,
      };
    }
  }

  async hasHistory(channelId: string): Promise<boolean> {
    const ch = this.channelById(channelId);
    if (ch && ch.messages.length > 0) return true;
    if (ch && (ch.type === 2 || ch.type === 4)) return false;
    try {
      const msgs = await this.api<unknown[]>("GET", `/channels/${channelId}/messages?limit=1`);
      return Array.isArray(msgs) && msgs.length > 0;
    } catch {
      return false;
    }
  }
}

export async function probeBotToken(token: string, guildId: string): Promise<LiveIdentity> {
  const g = new DiscordRestGuild(token, guildId);
  return g.hydrate();
}
