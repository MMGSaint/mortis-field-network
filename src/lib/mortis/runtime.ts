import { loadBlueprint, validateBlueprint, hashBlueprint } from "./blueprint.ts";
import { apply, plan, adopt, validate, refreshPins } from "./provision.ts";
import { dispatchSend, retractMessage } from "./dispatch.ts";
import { acceptTerms, completeIntake } from "./intake.ts";
import { createTicket, claimTicket, closeTicket, staffCanViewTicket, reopenTicket } from "./tickets.ts";
import { createEvent, markEligible, enact } from "./events.ts";
import { envoyFetch, handleVerifiedInteraction, type EnvoyEnv } from "./envoy.ts";
import { EnvoyStore } from "./store.ts";
import { SimulatedGuild } from "./discord-sim.ts";
import { DiscordRestGuild, loadScratchState, ensureBotChannelAccess, type LiveIdentity } from "./discord-rest.ts";
import { startInteractionGateway, type GatewayStatus } from "./discord-gateway.ts";
import { botInviteUrl, botPermissionInteger, permissionExcess } from "./permissions.ts";
import { generateEd25519HexPair, signEd25519Hex } from "./crypto.ts";
import { STAFF_CAPS_ALL, type Blueprint, type DispatchCaller } from "./types.ts";
import { assessHealth, type HealthReport } from "./health.ts";
import { runFirstPlayerWalkthrough } from "./walkthrough.ts";
import { registerGuildCommands } from "./commands.ts";
import { postOperationalNotice, type OperationalNoticeKind } from "./notices.ts";

export type RuntimeSnapshot = {
  guildName: string;
  channels: Array<{ key: string; display: string; audience: string; snowflake?: string; kind: string; category: string }>;
  categories: Array<{ key: string; display: string; audience: string }>;
  roles: Array<{ key: string; display: string; tier: string }>;
  members: Array<{ snowflake: string; handle: string; intake_state: string; callsign: string | null }>;
  tickets: Array<{ id: string; category: string; status: string; opener: string }>;
  audit: Array<{ id: string; at: string; actor: string; action: string; target?: string; outcome?: string; mirrored?: boolean }>;
  lockdown: boolean;
  lastAppliedHash: string | null;
  staffCount: number;
  live: {
    connected: boolean;
    guildId?: string;
    guildName?: string;
    botTag?: string;
    administrator?: boolean;
    channelCount?: number;
    scratchConfirmed?: boolean;
    gateway?: { connected: boolean; lastEvent?: string; lastError?: string };
    overwriteWarnings?: string[];
    missingBits?: string[];
    permissions?: string;
  };
  health: { ok: boolean; holds: number; warns: number; missing: string[] };
  killed: boolean;
};

const liveTokens = new WeakMap<MortisRuntime, string>();

export class MortisRuntime {
  bp: Blueprint;
  store: EnvoyStore;
  guild: SimulatedGuild;
  env: EnvoyEnv;
  cwd: string;
  discordKeys: { publicKeyHex: string; privateKey: CryptoKey } | null = null;
  releaseKeys: { publicKeyHex: string; privateKey: CryptoKey } | null = null;
  killed = false;
  scratchConfirmed = false;
  liveIdentity: LiveIdentity | null = null;
  gateway: { stop: () => void; status: () => GatewayStatus } | null = null;
  overwriteWarnings: string[] = [];

  constructor(bp: Blueprint, cwd = process.cwd()) {
    this.bp = bp;
    this.cwd = cwd;
    this.store = new EnvoyStore();
    this.guild = new SimulatedGuild();
    this.env = {
      DISCORD_PUBLIC_KEY: "00",
      DISCORD_APP_ID: "app_phase1",
      CLI_SECRET: "cli-secret-not-for-files",
    };
  }

  static load(cwd = process.cwd()): MortisRuntime {
    const bp = loadBlueprint(cwd);
    return new MortisRuntime(bp, cwd);
  }

  async attachLive(opts: { token: string; guildId: string; appId: string; publicKey?: string; confirmScratch: boolean }): Promise<LiveIdentity> {
    if (!opts.confirmScratch) throw new Error("scratch confirmation required");
    if (!/^\d{17,20}$/.test(opts.guildId)) throw new Error("guild snowflake malformed");
    if (!/^\d{17,20}$/.test(opts.appId)) throw new Error("application id malformed");
    const live = new DiscordRestGuild(opts.token, opts.guildId);
    const identity = await live.hydrate();
    // Scratch may already hold Administrator from earlier work. Do not require it;
    // do not refuse the session either — 403s without it were blocking provision.
    this.guild = live;
    this.liveIdentity = identity;
    this.scratchConfirmed = true;
    this.env.DISCORD_APP_ID = opts.appId;
    if (opts.publicKey) this.env.DISCORD_PUBLIC_KEY = opts.publicKey;
    const saved = loadScratchState(opts.guildId);
    if (saved) {
      for (const [key, id] of saved.bindings) this.store.bind(key, id);
      this.store.lastAppliedHash = saved.lastAppliedHash;
    }
    this.store.appendAudit({
      actor: "owner-cli",
      action: "discord.connect",
      target: identity.guildId,
      details: { guildName: identity.guildName, botTag: identity.botTag, administrator: identity.administrator },
    });
    this.gateway?.stop();
    liveTokens.set(this, opts.token);
    this.gateway = startInteractionGateway({
      token: opts.token,
      ctx: () => this.ctx(),
      handle: (payload, ctx) => handleVerifiedInteraction(payload, ctx),
    });
    this.overwriteWarnings = await this.ensureLiveChannelAccess();
    return identity;
  }

  async ensureLiveChannelAccess(): Promise<string[]> {
    const warnings: string[] = [];
    if (!this.guild.live) return warnings;
    const ids = new Set<string>();
    for (const ch of this.bp.channels) {
      const id = this.store.blueprintState.get(ch.key);
      if (id) ids.add(id);
    }
    for (const cat of this.bp.categories) {
      const id = this.store.blueprintState.get(cat.key);
      if (id) ids.add(id);
    }
    for (const id of ids) {
      const r = await ensureBotChannelAccess(this.guild, id);
      if (!r.ok && r.warning) {
        warnings.push(r.warning);
        this.store.appendAudit({
          actor: "owner-cli",
          action: "discord.overwrite",
          target: id,
          outcome: "fail",
          details: { warning: r.warning },
        });
      }
    }
    return warnings;
  }

  reconnectGateway(): GatewayStatus {
    const token = liveTokens.get(this);
    if (!token || !this.guild.live) throw new Error("token not in memory — connect with token first");
    this.gateway?.stop();
    this.gateway = startInteractionGateway({
      token,
      ctx: () => this.ctx(),
      handle: (payload, ctx) => handleVerifiedInteraction(payload, ctx),
    });
    return this.gateway.status();
  }

  detachLive(): void {
    this.gateway?.stop();
    this.gateway = null;
    liveTokens.delete(this);
    this.guild = new SimulatedGuild();
    this.liveIdentity = null;
    this.scratchConfirmed = false;
    this.store.appendAudit({ actor: "owner-cli", action: "discord.disconnect", details: {} });
  }

  async bootstrapKeys(): Promise<void> {
    this.discordKeys = await generateEd25519HexPair();
    this.releaseKeys = await generateEd25519HexPair();
    this.env.DISCORD_PUBLIC_KEY = this.discordKeys.publicKeyHex;
    this.env.RELEASE_PUBLIC_KEY = this.releaseKeys.publicKeyHex;
  }

  seedOwner(snowflake = "owner_1", handle = "owner"): void {
    this.store.staff.set(snowflake, {
      snowflake,
      handle,
      capabilities: ["*", ...STAFF_CAPS_ALL],
    });
    this.guild.seedMember(snowflake, handle, []);
  }

  seedOperations(snowflake = "ops_1", handle = "ops"): void {
    this.store.staff.set(snowflake, {
      snowflake,
      handle,
      capabilities: [...STAFF_CAPS_ALL],
    });
    this.guild.seedMember(snowflake, handle, []);
  }

  validate() {
    return validate(this.bp, this.cwd);
  }

  async plan() {
    if (this.guild.live) await (this.guild as DiscordRestGuild).hydrate();
    return plan(this.bp, this.store, this.guild);
  }

  async apply(opts?: { confirmDelete?: string[] }) {
    if (this.guild.live) await (this.guild as DiscordRestGuild).hydrate();
    return apply(this.bp, this.store, this.guild, {
      ...opts,
      actor: "owner-cli",
      appId: this.env.DISCORD_APP_ID,
    });
  }

  async adopt(key: string, snowflake: string) {
    return adopt(this.store, this.guild, key, snowflake);
  }

  async refreshPins() {
    if (this.guild.live) {
      await (this.guild as DiscordRestGuild).hydrate();
      this.overwriteWarnings = await this.ensureLiveChannelAccess();
    }
    return refreshPins(this.bp, this.store, this.guild, "owner-cli");
  }

  async dispatch(input: {
    channel_key: string;
    template_key: string;
    fields?: Record<string, string>;
    event_id?: string;
    caller?: DispatchCaller;
  }) {
    return dispatchSend(
      {
        channel_key: input.channel_key,
        template_key: input.template_key,
        fields: input.fields ?? {},
        event_id: input.event_id,
        caller: input.caller ?? { type: "owner-cli" },
      },
      { bp: this.bp, store: this.store, guild: this.guild, releasePublicKeyHex: this.env.RELEASE_PUBLIC_KEY, cwd: this.cwd },
    );
  }

  async retract(channel_key: string, message_id: string, reason: string) {
    return retractMessage(this.store, this.guild, channel_key, message_id, "owner-cli", reason);
  }

  async rotateWebhooks(): Promise<{ rotated: string[] }> {
    const rotated: string[] = [];
    for (const ch of this.bp.channels) {
      if (!ch.webhook) continue;
      const id = this.store.blueprintState.get(ch.key);
      if (!id) continue;
      const live = this.guild.channelById(id);
      const previous = live?.webhook;
      const wh = await this.guild.createWebhook(id, "MORTIS FIELD NETWORK");
      this.store.webhookUrls.set(ch.key, wh.url);
      if (previous?.id && previous.id !== wh.id && typeof this.guild.deleteWebhook === "function") {
        try {
          await this.guild.deleteWebhook(previous.id);
        } catch {
          /* old webhook delete is best-effort; new URL is bound */
        }
      }
      rotated.push(ch.key);
    }
    this.store.appendAudit({
      actor: "owner-cli",
      action: "webhooks.rotate",
      target: "guild",
      details: { count: rotated.length },
      outcome: "ok",
    });
    return { rotated };
  }

  async intake(input: { snowflake: string; handle: string; callsign?: string }) {
    await acceptTerms(this.store, input.snowflake, input.handle);
    return completeIntake(input, this);
  }

  ctx() {
    return {
      bp: this.bp,
      store: this.store,
      guild: this.guild,
      env: this.env,
      cwd: this.cwd,
      isKilled: () => this.killed,
      kill: () => {
        this.killed = true;
      },
      liftKill: () => {
        this.killed = false;
      },
    };
  }

  async fetch(request: Request): Promise<Response> {
    return envoyFetch(request, this.ctx());
  }

  async signDiscordBody(body: string, timestamp: string): Promise<{ signature: string; timestamp: string }> {
    if (!this.discordKeys) await this.bootstrapKeys();
    const sig = await signEd25519Hex(this.discordKeys!.privateKey, new TextEncoder().encode(timestamp + body));
    return { signature: sig, timestamp };
  }

  snapshot(): RuntimeSnapshot {
    return {
      guildName: this.guild.name,
      channels: this.bp.channels.map((c) => ({
        key: c.key,
        display: c.display,
        audience: c.audience,
        kind: c.kind,
        category: c.category,
        snowflake: this.store.blueprintState.get(c.key),
      })),
      categories: this.bp.categories.map((c) => ({ key: c.key, display: c.display, audience: c.audience })),
      roles: this.bp.roles.map((r) => ({ key: r.key, display: r.display, tier: r.tier })),
      members: [...this.store.members.values()].map((m) => ({
        snowflake: m.snowflake,
        handle: m.handle,
        intake_state: m.intake_state,
        callsign: m.callsign,
      })),
      tickets: [...this.store.tickets.values()].map((t) => ({
        id: t.id,
        category: t.category,
        status: t.status,
        opener: t.opener,
      })),
      audit: this.store.audit.map((a) => ({
        id: a.id,
        at: a.at,
        actor: a.actor,
        action: a.action,
        target: a.target,
        outcome: a.outcome,
        mirrored: a.mirrored,
      })),
      lockdown: this.store.lockdown,
      lastAppliedHash: this.store.lastAppliedHash,
      staffCount: this.store.staff.size,
      killed: this.killed,
      health: (() => {
        const h = this.health();
        return {
          ok: h.ok,
          holds: h.findings.filter((f) => f.severity === "hold").length,
          warns: h.findings.filter((f) => f.severity === "warn").length,
          missing: h.missing_channels,
        };
      })(),
      live: this.guild.live
        ? {
            connected: true,
            guildId: this.liveIdentity?.guildId,
            guildName: this.liveIdentity?.guildName,
            botTag: this.liveIdentity?.botTag,
            administrator: this.liveIdentity?.administrator ?? false,
            missingBits: this.liveIdentity?.missingBits,
            permissions: this.liveIdentity?.permissions,
            channelCount: this.liveIdentity?.channelCount,
            scratchConfirmed: this.scratchConfirmed,
            gateway: this.gateway?.status() ?? { connected: false },
            overwriteWarnings: this.overwriteWarnings,
          }
        : { connected: false },
    };
  }

  inviteUrl(): string {
    return botInviteUrl(this.env.DISCORD_APP_ID);
  }

  permissionInteger(): string {
    return botPermissionInteger().toString();
  }

  excessWarning(held?: bigint): string[] {
    return permissionExcess(held ?? botPermissionInteger());
  }

  health(): HealthReport {
    return assessHealth(this.bp, this.store, this.guild, {
      gateway: this.gateway?.status(),
      botPermissions: this.liveIdentity?.permissions,
      administrator: this.liveIdentity?.administrator,
    });
  }

  async walkthrough() {
    return runFirstPlayerWalkthrough(this);
  }

  async registerCommands() {
    return registerGuildCommands(this.bp, this.guild, this.env.DISCORD_APP_ID);
  }

  async notice(kind: OperationalNoticeKind, fields: Record<string, string>) {
    return postOperationalNotice(this, kind, fields);
  }
}

export { loadBlueprint, validateBlueprint, hashBlueprint };
export { createTicket, claimTicket, closeTicket, staffCanViewTicket, reopenTicket };
export { createEvent, markEligible, enact };
