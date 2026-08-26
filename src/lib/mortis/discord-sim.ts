import { PERM } from "./permissions.ts";
import type { Overwrite } from "./permissions.ts";

export type SimRole = {
  id: string;
  name: string;
  hoist: boolean;
  mentionable: boolean;
  color: number;
  position: number;
  permissions: string;
};
export type SimChannel = {
  id: string;
  name: string;
  type: number; // 0 text, 2 voice, 4 category
  parent_id: string | null;
  topic: string;
  position: number;
  rate_limit_per_user: number;
  permission_overwrites: Overwrite[];
  nsfw: boolean;
  messages: SimMessage[];
  archived: boolean;
  webhook?: { id: string; url: string; token: string };
};
export type SimMessage = {
  id: string;
  channel_id: string;
  content: string;
  author_id: string;
  timestamp: string;
  pinned?: boolean;
  components?: unknown[];
};
export type SimMember = {
  id: string;
  username: string;
  roles: string[];
};

export type RestCall = { method: string; path: string; at: number };

/**
 * In-memory Discord REST. Rate-limit injection supported for backoff tests.
 * Matching live objects by id, never by name, is the provisioner's job — this
 * sim just stores what REST would store.
 */
export class SimulatedGuild {
  id = "g_0001";
  name = "Blank";
  verification_level = 0;
  default_message_notifications = 0;
  explicit_content_filter = 0;
  preferred_locale = "en-US";
  system_channel_id: string | null = null;
  roles: SimRole[] = [];
  channels: SimChannel[] = [];
  members = new Map<string, SimMember>();
  invitesPaused = false;
  seq = 1000;
  restLog: RestCall[] = [];
  remainingBurst = Infinity;
  forced429 = 0;
  backoffSleeps: number[] = [];
  botUserId = "bot_1";
  /** False for the in-memory harness. DiscordRestGuild sets true. */
  live = false;
  slashCommands: unknown[] = [];
  failQueue: Array<{ status: number; body?: string; pathIncludes?: string }> = [];

  constructor() {
    this.roles.push({
      id: this.id,
      name: "@everyone",
      hoist: false,
      mentionable: false,
      color: 0,
      position: 0,
      permissions: "0",
    });
  }

  snowflake(): string {
    this.seq += 1;
    return `s_${this.seq}`;
  }

  private log(method: string, path: string): void {
    this.restLog.push({ method, path, at: Date.now() });
  }

  async gated<T>(method: string, path: string, fn: () => T): Promise<T> {
    this.log(method, path);
    const failIdx = this.failQueue.findIndex((f) => !f.pathIncludes || path.includes(f.pathIncludes));
    if (failIdx >= 0) {
      const f = this.failQueue.splice(failIdx, 1)[0];
      throw Object.assign(new Error(`discord ${method} ${path} ${f.status}`), {
        status: f.status,
        body: f.body ?? `{"message":"Missing Access","code":50001}`,
      });
    }
    if (this.forced429 > 0) {
      this.forced429 -= 1;
      const retry = 0.05;
      this.backoffSleeps.push(retry);
      const err = new Error("429") as Error & { status: number; retryAfter: number };
      err.status = 429;
      err.retryAfter = retry;
      throw err;
    }
    if (this.remainingBurst <= 0) {
      const err = new Error("429") as Error & { status: number; retryAfter: number };
      err.status = 429;
      err.retryAfter = 0.05;
      throw err;
    }
    if (Number.isFinite(this.remainingBurst)) this.remainingBurst -= 1;
    return fn();
  }

  roleById(id: string): SimRole | undefined {
    return this.roles.find((r) => r.id === id);
  }
  channelById(id: string): SimChannel | undefined {
    return this.channels.find((c) => c.id === id);
  }

  async createRole(body: Partial<SimRole>): Promise<SimRole> {
    return this.gated("POST", "/guilds/{id}/roles", () => {
      const role: SimRole = {
        id: this.snowflake(),
        name: body.name ?? "new-role",
        hoist: Boolean(body.hoist),
        mentionable: Boolean(body.mentionable),
        color: body.color ?? 0,
        position: body.position ?? this.roles.length,
        permissions: body.permissions ?? "0",
      };
      this.roles.push(role);
      return role;
    });
  }

  async patchRole(id: string, body: Partial<SimRole>): Promise<SimRole> {
    return this.gated("PATCH", `/guilds/{id}/roles/${id}`, () => {
      const role = this.roleById(id);
      if (!role) throw new Error("unknown role");
      Object.assign(role, body);
      return role;
    });
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
    return this.gated("POST", "/guilds/{id}/channels", () => {
      const ch: SimChannel = {
        id: this.snowflake(),
        name: body.name,
        type: body.type,
        parent_id: body.parent_id ?? null,
        topic: body.topic ?? "",
        position: body.position ?? this.channels.length,
        rate_limit_per_user: body.rate_limit_per_user ?? 0,
        permission_overwrites: body.permission_overwrites ?? [],
        nsfw: false,
        messages: [],
        archived: false,
      };
      this.channels.push(ch);
      return ch;
    });
  }

  async patchChannel(id: string, body: Partial<SimChannel> & { permission_overwrites?: Overwrite[] }): Promise<SimChannel> {
    return this.gated("PATCH", `/channels/${id}`, () => {
      const ch = this.channelById(id);
      if (!ch) throw new Error("unknown channel");
      if (body.name !== undefined) ch.name = body.name;
      if (body.topic !== undefined) ch.topic = body.topic;
      if (body.position !== undefined) ch.position = body.position;
      if (body.parent_id !== undefined) ch.parent_id = body.parent_id;
      if (body.rate_limit_per_user !== undefined) ch.rate_limit_per_user = body.rate_limit_per_user;
      if (body.permission_overwrites) ch.permission_overwrites = body.permission_overwrites;
      if (body.archived !== undefined) ch.archived = body.archived;
      return ch;
    });
  }

  async createWebhook(channelId: string, name: string): Promise<{ id: string; url: string; token: string }> {
    return this.gated("POST", `/channels/${channelId}/webhooks`, () => {
      const ch = this.channelById(channelId);
      if (!ch) throw new Error("unknown channel");
      const id = this.snowflake();
      const token = `wh_${id}`;
      const url = `https://sim.local/webhooks/${id}/${token}`;
      ch.webhook = { id, url, token };
      return ch.webhook;
    });
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    return this.gated("DELETE", `/webhooks/${webhookId}`, () => {
      for (const ch of this.channels) {
        if (ch.webhook?.id === webhookId) ch.webhook = undefined;
      }
    });
  }

  async postMessage(channelId: string, content: string, authorId = this.botUserId, components?: unknown[]): Promise<SimMessage> {
    return this.gated("POST", `/channels/${channelId}/messages`, () => {
      const ch = this.channelById(channelId);
      if (!ch) throw new Error("unknown channel");
      if (ch.archived) throw new Error("archived");
      const msg: SimMessage = {
        id: this.snowflake(),
        channel_id: channelId,
        content,
        author_id: authorId,
        timestamp: new Date().toISOString(),
        components,
      };
      ch.messages.push(msg);
      return msg;
    });
  }

  async listPins(channelId: string): Promise<SimMessage[]> {
    return this.channelById(channelId)?.messages.filter((m) => m.pinned) ?? [];
  }

  async unpinMessage(channelId: string, messageId: string): Promise<void> {
    return this.gated("DELETE", `/channels/${channelId}/pins/${messageId}`, () => {
      const msg = this.channelById(channelId)?.messages.find((m) => m.id === messageId);
      if (msg) msg.pinned = false;
    });
  }

  async editMessage(
    channelId: string,
    messageId: string,
    body: { content?: string; components?: unknown[] },
  ): Promise<SimMessage> {
    return this.gated("PATCH", `/channels/${channelId}/messages/${messageId}`, () => {
      const msg = this.channelById(channelId)?.messages.find((m) => m.id === messageId);
      if (!msg) throw new Error("unknown message");
      if (body.content !== undefined) msg.content = body.content;
      if (body.components !== undefined) msg.components = body.components;
      return msg;
    });
  }

  async pinMessage(channelId: string, messageId: string): Promise<void> {
    return this.gated("PUT", `/channels/${channelId}/pins/${messageId}`, () => {
      const ch = this.channelById(channelId);
      const msg = ch?.messages.find((m) => m.id === messageId);
      if (msg) msg.pinned = true;
    });
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    return this.gated("DELETE", `/channels/${channelId}/messages/${messageId}`, () => {
      const ch = this.channelById(channelId);
      if (!ch) return;
      ch.messages = ch.messages.filter((m) => m.id !== messageId);
    });
  }

  async addRole(memberId: string, roleId: string): Promise<void> {
    return this.gated("PUT", `/guilds/{id}/members/${memberId}/roles/${roleId}`, () => {
      const m = this.members.get(memberId);
      if (!m) throw new Error("unknown member");
      if (!m.roles.includes(roleId)) m.roles.push(roleId);
    });
  }

  async patchGuild(body: {
    name?: string;
    verification_level?: number;
    default_message_notifications?: number;
    explicit_content_filter?: number;
    preferred_locale?: string;
    system_channel_id?: string | null;
  }): Promise<void> {
    return this.gated("PATCH", "/guilds/{id}", () => {
      if (body.name !== undefined) this.name = body.name;
      if (body.verification_level !== undefined) this.verification_level = body.verification_level;
      if (body.default_message_notifications !== undefined) this.default_message_notifications = body.default_message_notifications;
      if (body.explicit_content_filter !== undefined) this.explicit_content_filter = body.explicit_content_filter;
      if (body.preferred_locale !== undefined) this.preferred_locale = body.preferred_locale;
      if (body.system_channel_id !== undefined) this.system_channel_id = body.system_channel_id;
    });
  }

  async pauseInvites(untilIso: string | null): Promise<{ ok: boolean; detail: string }> {
    this.invitesPaused = Boolean(untilIso);
    return { ok: true, detail: untilIso ? "sim invites paused" : "sim invites open" };
  }

  async putGuildCommands(appId: string, commands: unknown[]): Promise<unknown[]> {
    return this.gated("PUT", `/applications/${appId}/guilds/${this.id}/commands`, () => {
      this.slashCommands = commands;
      return commands;
    });
  }

  async hasHistory(channelId: string): Promise<boolean> {
    return (this.channelById(channelId)?.messages.length ?? 0) > 0;
  }

  seedMember(id: string, username: string, roles: string[] = []): SimMember {
    const m = { id, username, roles };
    this.members.set(id, m);
    return m;
  }

  private permissionBits(memberId: string, channelId: string): bigint {
    const ch = this.channelById(channelId);
    const member = this.members.get(memberId);
    if (!ch || !member) return 0n;
    const everyone = ch.permission_overwrites.find((o) => o.id === this.id);
    let allow = everyone ? BigInt(everyone.allow) : 0n;
    let deny = everyone ? BigInt(everyone.deny) : 0n;
    let perms = allow & ~deny;
    let rAllow = 0n;
    let rDeny = 0n;
    for (const roleId of member.roles) {
      const ow = ch.permission_overwrites.find((o) => o.id === roleId);
      if (!ow) continue;
      rAllow |= BigInt(ow.allow);
      rDeny |= BigInt(ow.deny);
    }
    perms = (perms & ~rDeny) | rAllow;
    return perms;
  }

  canView(memberId: string, channelId: string): boolean {
    const ch = this.channelById(channelId);
    if (!ch || ch.archived) return false;
    return (this.permissionBits(memberId, channelId) & PERM.VIEW_CHANNEL) !== 0n;
  }

  canSend(memberId: string, channelId: string): boolean {
    if (!this.canView(memberId, channelId)) return false;
    return (this.permissionBits(memberId, channelId) & PERM.SEND_MESSAGES) !== 0n;
  }
}

export async function withBackoff<T>(fn: () => Promise<T>, sleeps: number[] = []): Promise<T> {
  let delay = 50;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { status?: number; retryAfter?: number };
      if (e.status !== 429) throw err;
      const ms = Math.min((e.retryAfter ?? delay / 1000) * 1000 * 2 ** attempt, 2000);
      sleeps.push(ms);
      await new Promise((r) => setTimeout(r, Math.min(ms, 60)));
      delay *= 2;
    }
  }
  throw new Error("rate-limited");
}
