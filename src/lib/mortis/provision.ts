import { generateOverwrites, permissionExcess, permissionMissing, botPermissionInteger, PERM } from "./permissions.ts";
import { hashBlueprint, validateBlueprint } from "./blueprint.ts";
import { dispatchSend, interactionRows } from "./dispatch.ts";
import { withBackoff } from "./discord-sim.ts";
import type { SimulatedGuild } from "./discord-sim.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint, Plan, PlanOp } from "./types.ts";
import { discordTransportName, saveScratchState, attachCurrentRestMethods, restApi, ensureBotChannelAccess, heldPermissionsOf, botMemberAllowFor, discordManagedBotRole, ensureBotHasPresentationRole } from "./discord-rest.ts";
import { registerGuildCommands } from "./commands.ts";

export type ApplyOptions = {
  /** Per-item explicit confirmation. Never a blanket delete. */
  confirmDelete?: string[];
  actor?: string;
  appId?: string;
};

function expectedName(guild: SimulatedGuild, display: string, kind: "role" | "category" | "channel", channelKind?: "text" | "voice"): string {
  if (!guild.live || kind === "role") return display;
  const type = kind === "category" ? 4 : channelKind === "voice" ? 2 : 0;
  return discordTransportName(display, type);
}

export function validate(bp: Blueprint, cwd?: string) {
  return validateBlueprint(bp, cwd);
}

export async function plan(bp: Blueprint, store: EnvoyStore, guild: SimulatedGuild): Promise<Plan> {
  const ops: PlanOp[] = [];
  const hash = await hashBlueprint(bp);

  for (const role of bp.roles) {
    const id = store.blueprintState.get(role.key);
    if (!id) ops.push({ op: "create", kind: "role", key: role.key, display: role.display });
    else {
      const live = guild.roleById(id);
      if (!live) ops.push({ op: "create", kind: "role", key: role.key, display: role.display });
      else {
        const changes: string[] = [];
        if (live.name !== role.display) changes.push(`name:${live.name}->${role.display}`);
        if (live.hoist !== role.hoist) changes.push("hoist");
        ops.push(changes.length ? { op: "update", kind: "role", key: role.key, snowflake: id, changes } : { op: "noop", key: role.key });
      }
    }
  }

  for (const cat of bp.categories) {
    const id = store.blueprintState.get(cat.key);
    const want = expectedName(guild, cat.display, "category");
    if (!id) ops.push({ op: "create", kind: "category", key: cat.key, display: cat.display });
    else {
      const live = guild.channelById(id);
      if (!live) ops.push({ op: "create", kind: "category", key: cat.key, display: cat.display });
      else {
        const changes: string[] = [];
        if (live.name !== want) changes.push(`name:${live.name}->${want}`);
        ops.push(changes.length ? { op: "update", kind: "category", key: cat.key, snowflake: id, changes } : { op: "noop", key: cat.key });
      }
    }
  }

  const orderDrift = categoryOrderDriftKeys(bp, store, guild);

  for (const ch of bp.channels) {
    const id = store.blueprintState.get(ch.key);
    const want = expectedName(guild, ch.display, "channel", ch.kind);
    if (!id) ops.push({ op: "create", kind: "channel", key: ch.key, display: ch.display });
    else {
      const live = guild.channelById(id);
      if (!live) ops.push({ op: "create", kind: "channel", key: ch.key, display: ch.display });
      else {
        const changes: string[] = [];
        if (live.name !== want) changes.push(`name:${live.name}->${want}`);
        if ((live.topic ?? "") !== (ch.topic ?? "") && ch.kind === "text") changes.push("topic");
        if (live.rate_limit_per_user !== ch.slowmode && ch.kind === "text") changes.push("slowmode");
        if (orderDrift.has(ch.key)) changes.push("order");
        ops.push(changes.length ? { op: "update", kind: "channel", key: ch.key, snowflake: id, changes } : { op: "noop", key: ch.key });
      }
    }
    if (ch.webhook && id && !guild.channelById(id)?.webhook && !store.webhookUrls.get(ch.key)) {
      ops.push({ op: "create", kind: "webhook", key: `${ch.key}.webhook`, display: "webhook" });
    } else if (ch.webhook && !id) {
      ops.push({ op: "create", kind: "webhook", key: `${ch.key}.webhook`, display: "webhook" });
    }
  }

  for (const ch of guild.channels) {
    if (!store.reverseState.has(ch.id)) {
      const has_history = await guild.hasHistory(ch.id);
      ops.push({
        op: "orphan",
        kind: ch.type === 4 ? "category" : "channel",
        snowflake: ch.id,
        name: ch.name,
        has_history,
      });
    }
  }
  for (const role of guild.roles) {
    if (role.id === guild.id) continue;
    if (!store.reverseState.has(role.id)) {
      ops.push({ op: "orphan", kind: "role", snowflake: role.id, name: role.name, has_history: false });
    }
  }

  return {
    hash,
    ops,
    creates: ops.filter((o) => o.op === "create").length,
    updates: ops.filter((o) => o.op === "update").length,
    orphans: ops.filter((o) => o.op === "orphan").length,
    noops: ops.filter((o) => o.op === "noop").length,
  };
}

export function siblingChannelKeys(bp: Blueprint, categoryKey: string): string[] {
  return bp.channels.filter((c) => c.category === categoryKey).map((c) => c.key);
}

export function channelSiblingIndex(bp: Blueprint, key: string): number {
  const ch = bp.channels.find((c) => c.key === key);
  if (!ch) return 0;
  const idx = siblingChannelKeys(bp, ch.category).indexOf(key);
  return idx < 0 ? 0 : idx;
}

/** Blueprint-array order vs live position among siblings. Absolute Discord position integers are not compared. */
export function categoryOrderDriftKeys(bp: Blueprint, store: EnvoyStore, guild: SimulatedGuild): Set<string> {
  const drifted = new Set<string>();
  for (const cat of bp.categories) {
    const keys = siblingChannelKeys(bp, cat.key);
    const bound = keys
      .map((key) => {
        const id = store.blueprintState.get(key);
        const live = id ? guild.channelById(id) : undefined;
        return live ? { key, id: live.id, position: live.position } : null;
      })
      .filter((row): row is { key: string; id: string; position: number } => Boolean(row));
    if (bound.length < 2) continue;
    const liveOrder = [...bound].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((r) => r.key);
    const wantOrder = bound.map((r) => r.key);
    if (liveOrder.join("|") !== wantOrder.join("|")) {
      for (const row of bound) drifted.add(row.key);
    }
  }
  return drifted;
}

/** Channels and categories only — never roles or webhook bindings. */
export function overwriteSweepTargets(bp: Blueprint, store: EnvoyStore): Array<{ id: string; key: string }> {
  const out: Array<{ id: string; key: string }> = [];
  for (const cat of bp.categories) {
    const id = store.blueprintState.get(cat.key);
    if (id) out.push({ id, key: cat.key });
  }
  for (const ch of bp.channels) {
    const id = store.blueprintState.get(ch.key);
    if (id) out.push({ id, key: ch.key });
  }
  return out;
}

export async function findExistingTemplatePost(
  guild: SimulatedGuild,
  liveId: string,
  title?: string,
): Promise<{ id: string; pinned?: boolean } | undefined> {
  const needle = title?.trim().toUpperCase() ?? "";
  const match = (m: { id: string; author_id?: string; pinned?: boolean; content?: string }) => {
    if (m.pinned) return true;
    if (needle && (m.content ?? "").toUpperCase().startsWith(needle)) return true;
    if (m.author_id === guild.botUserId || m.author_id === "webhook") return true;
    return false;
  };
  const live = guild.channelById(liveId);
  const cached = (live?.messages ?? []).find((m) => match(m));
  if (cached) return cached;
  if (!guild.live) return undefined;
  try {
    const recent = await restApi<unknown>(guild, "GET", `/channels/${liveId}/messages?limit=25`);
    const rows: Array<Record<string, unknown>> = Array.isArray(recent) ? (recent as Array<Record<string, unknown>>) : [];
    const mapped = rows.map((m) => {
      const author = (m.author as Record<string, unknown> | undefined) ?? {};
      return {
        id: String(m.id),
        author_id: String(author.id ?? ""),
        pinned: Boolean(m.pinned),
        content: String(m.content ?? ""),
      };
    });
    return mapped.find((m) => match(m));
  } catch {
    return undefined;
  }
}

function staffRoleIds(store: EnvoyStore, bp: Blueprint): string[] {
  return bp.roles.filter((r) => r.tier === "staff").map((r) => store.blueprintState.get(r.key)).filter(Boolean) as string[];
}

function discordStatus(err: unknown): number | undefined {
  const s = (err as { status?: number | string })?.status;
  if (s === undefined || s === null) return undefined;
  return typeof s === "number" ? s : Number(s);
}

function isDiscord403(err: unknown): boolean {
  if (discordStatus(err) === 403) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b403\b/.test(msg);
}

function isDiscord400or403(err: unknown): boolean {
  const st = discordStatus(err);
  if (st === 400 || st === 403) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b40[03]\b/.test(msg);
}

/** Discord 403/400 must not abort the rest of apply (lockout, bad guild settings body). */
async function tolerate403<T>(
  label: string,
  warnings: string[],
  store: EnvoyStore,
  actor: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await withBackoff(fn);
  } catch (err) {
    if (isDiscord400or403(err) || isDiscord403(err)) {
      const e = err as Error & { body?: string };
      const msg = `${e.message ?? String(err)}${e.body ? ` ${e.body}` : ""}`.slice(0, 400);
      warnings.push(`${label}: ${msg} (continuing)`);
      store.appendAudit({
        actor,
        action: "provision.forbidden",
        target: label,
        details: { message: msg },
        outcome: "fail",
      });
      return undefined;
    }
    throw err;
  }
}

export function overwritesFor(
  bp: Blueprint,
  store: EnvoyStore,
  guild: SimulatedGuild,
  audience: "public" | "initiate+" | "granted" | "staff",
  kind: "text" | "voice" | "category",
  readonly: boolean,
  attachmentsRestricted: boolean | undefined,
  showLocked?: boolean,
) {
  const held = heldPermissionsOf(guild);
  const ows = generateOverwrites({
    guildId: guild.id,
    audience,
    kind,
    readonly,
    attachmentsRestricted,
    showLockedCategory: showLocked,
    heldPermissions: held,
    roleSnowflakes: {
      everyone: guild.id,
      initiate: store.blueprintState.get("role.initiate") ?? "missing",
      shadow: store.blueprintState.get("role.shadow") ?? "missing",
      staff: staffRoleIds(store, bp),
      bot: store.blueprintState.get("role.bot") ?? guild.botUserId,
    },
  });
  // Presentation role.bot is not the Discord-managed bot role. Always grant the live bot member
  // so later PATCH/webhook calls do not 403 Missing Access. Only bits the bot actually holds.
  if (guild.botUserId && !ows.some((o) => o.id === guild.botUserId)) {
    ows.push({ id: guild.botUserId, type: 1, allow: botMemberAllowFor(guild), deny: "0" });
  }
  const managed = discordManagedBotRole(guild);
  if (managed && !ows.some((o) => o.id === managed.id)) {
    ows.push({ id: managed.id, type: 0, allow: botMemberAllowFor(guild), deny: "0" });
  }
  return ows;
}

export async function closeArrival(bp: Blueprint, store: EnvoyStore, guild: SimulatedGuild): Promise<void> {
  const cat = store.blueprintState.get("arrival");
  const closed = overwritesFor(bp, store, guild, "public", "text", true, false);
  const hidden = overwritesFor(bp, store, guild, "staff", "text", true, false);
  for (const ch of bp.channels.filter((c) => c.category === "arrival")) {
    const id = store.blueprintState.get(ch.key);
    if (!id) continue;
    // Keep NOTICE / TERMS / HOW TO BEGIN readable. Hide ENTRY so intake cannot start.
    const ow = ch.key === "arrival.intake" ? hidden : closed;
    await withBackoff(() => guild.patchChannel(id, { permission_overwrites: ow }));
  }
  if (cat) await withBackoff(() => guild.patchChannel(cat, { permission_overwrites: overwritesFor(bp, store, guild, "public", "category", true, false, false) }));
}

export async function openArrival(bp: Blueprint, store: EnvoyStore, guild: SimulatedGuild): Promise<void> {
  const cat = bp.categories.find((c) => c.key === "arrival");
  if (cat) {
    const id = store.blueprintState.get(cat.key);
    if (id) {
      const ow = overwritesFor(bp, store, guild, cat.audience, "category", true, false, cat.show_locked);
      await withBackoff(() => guild.patchChannel(id, { permission_overwrites: ow }));
    }
  }
  for (const ch of bp.channels.filter((c) => c.category === "arrival")) {
    const id = store.blueprintState.get(ch.key);
    if (!id) continue;
    const ow = overwritesFor(bp, store, guild, ch.audience, ch.kind, ch.readonly, ch.attachments_restricted);
    await withBackoff(() => guild.patchChannel(id, { permission_overwrites: ow }));
  }
}

function persistIfLive(store: EnvoyStore, guild: SimulatedGuild): void {
  if (!guild.live) return;
  saveScratchState({
    guildId: guild.id,
    bindings: [...store.blueprintState.entries()],
    lastAppliedHash: store.lastAppliedHash,
  });
}

async function registerCommandsSafe(
  bp: Blueprint,
  guild: SimulatedGuild,
  warnings: string[],
  _actor: string,
  appId?: string,
): Promise<void> {
  if (!appId) return;
  const r = await registerGuildCommands(bp, guild, appId);
  if (!r.ok && r.warning) warnings.push(r.warning);
}

export async function apply(
  bp: Blueprint,
  store: EnvoyStore,
  guild: SimulatedGuild,
  opts: ApplyOptions = {},
): Promise<{ plan: Plan; applied: number; no_op: boolean; warnings: string[]; manual: string[] }> {
  const v = validateBlueprint(bp);
  if (!v.ok) {
    throw new Error(`validate failed: ${v.issues.map((i) => i.message).join("; ")}`);
  }

  const before = await plan(bp, store, guild);
  const actor = opts.actor ?? "owner-cli";
  const warnings: string[] = [];
  const noopKeys = new Set(before.ops.filter((o) => o.op === "noop").map((o) => o.key).filter((k): k is string => Boolean(k)));

  store.snapshotState(store.lastAppliedHash ?? "none");
  store.appendAudit({
    actor,
    action: "provision.plan",
    details: { hash: before.hash, creates: before.creates, updates: before.updates, orphans: before.orphans },
  });

  if (store.lastAppliedHash === before.hash && before.creates === 0 && before.updates === 0 && !(opts.confirmDelete && opts.confirmDelete.length)) {
    store.appendAudit({
      actor,
      action: "provision.apply",
      details: { hash: before.hash, no_op: true },
      outcome: "ok",
    });
    await registerCommandsSafe(bp, guild, warnings, actor, opts.appId);
    persistIfLive(store, guild);
    return { plan: before, applied: 0, no_op: true, warnings, manual: bp.onboarding.manual_toggles };
  }

  if (guild.name !== bp.guild.name) {
    await tolerate403("guild.settings", warnings, store, actor, () =>
      guild.live
        ? guild.patchGuild({ name: bp.guild.name })
        : guild.patchGuild({
            name: bp.guild.name,
            verification_level: bp.guild.verification_level,
            default_message_notifications: bp.guild.default_message_notifications,
            explicit_content_filter: bp.guild.explicit_content_filter,
            preferred_locale: bp.guild.preferred_locale,
          }),
    );
  }

  // Roles first (presentation only — backend auth ignores them).
  const staffOrder = ["role.owner", "role.operations", "role.moderator", "role.dm", "role.developer", "role.tester"];
  const roleOrder = [...staffOrder, "role.bot", "role.shadow", "role.initiate"];
  const sortedRoles = [...bp.roles].sort((a, b) => roleOrder.indexOf(a.key) - roleOrder.indexOf(b.key));

  let applied = 0;
  for (const role of sortedRoles) {
    const existing = store.blueprintState.get(role.key);
    if (!existing) {
      const created = await tolerate403(`role.create:${role.key}`, warnings, store, actor, () =>
        guild.createRole({
          name: role.display,
          hoist: role.hoist,
          mentionable: role.mentionable,
          color: role.color,
        }),
      );
      if (!created) continue;
      store.bind(role.key, created.id);
      applied += 1;
      store.appendAudit({ actor, action: "provision.create", target: role.key, details: { snowflake: created.id, kind: "role" } });
      persistIfLive(store, guild);
    } else if (!noopKeys.has(role.key)) {
      const live = guild.roleById(existing);
      if (live && (live.name !== role.display || live.hoist !== role.hoist)) {
        await tolerate403(`role.patch:${role.key}`, warnings, store, actor, () =>
          guild.patchRole(existing, { name: role.display, hoist: role.hoist }),
        );
        applied += 1;
        store.appendAudit({ actor, action: "provision.update", target: role.key, details: { rename: true } });
      }
    }
  }

  const botRoleGrant = await ensureBotHasPresentationRole(guild, store.blueprintState.get("role.bot"));
  if (!botRoleGrant.ok && botRoleGrant.warning) warnings.push(botRoleGrant.warning);

  // Categories
  for (const cat of [...bp.categories].sort((a, b) => a.position - b.position)) {
    const ow = overwritesFor(bp, store, guild, cat.audience, "category", true, false, cat.show_locked);
    const existing = store.blueprintState.get(cat.key);
    if (!existing) {
      const created = await tolerate403(`category.create:${cat.key}`, warnings, store, actor, () =>
        guild.createChannel({
          name: cat.display,
          type: 4,
          position: cat.position,
          permission_overwrites: ow,
        }),
      );
      if (!created) continue;
      store.bind(cat.key, created.id);
      applied += 1;
      store.appendAudit({ actor, action: "provision.create", target: cat.key, details: { snowflake: created.id, kind: "category" } });
      persistIfLive(store, guild);
    } else if (!noopKeys.has(cat.key)) {
      // Re-apply: skip overwrite rewrite (403 Missing Access / extra bits). Name/position only.
      await tolerate403(`category.patch:${cat.key}`, warnings, store, actor, () =>
        guild.patchChannel(existing, { name: cat.display, position: cat.position }),
      );
    }
  }

  // Channels
  for (const ch of bp.channels) {
    const parent = store.blueprintState.get(ch.category) ?? null;
    const ow = overwritesFor(bp, store, guild, ch.audience, ch.kind, ch.readonly, ch.attachments_restricted);
    const existing = store.blueprintState.get(ch.key);
    const type = ch.kind === "voice" ? 2 : 0;
    if (!existing) {
      const created = await tolerate403(`channel.create:${ch.key}`, warnings, store, actor, () =>
        guild.createChannel({
          name: ch.display,
          type,
          parent_id: parent,
          topic: ch.topic,
          position: channelSiblingIndex(bp, ch.key),
          rate_limit_per_user: ch.slowmode,
          permission_overwrites: ow,
        }),
      );
      if (!created) continue;
      store.bind(ch.key, created.id);
      applied += 1;
      store.appendAudit({ actor, action: "provision.create", target: ch.key, details: { snowflake: created.id, kind: "channel" } });
      persistIfLive(store, guild);
    } else if (!noopKeys.has(ch.key)) {
      await tolerate403(`channel.patch:${ch.key}`, warnings, store, actor, () =>
        guild.patchChannel(existing, {
          name: ch.display,
          topic: ch.topic,
          parent_id: parent,
          position: channelSiblingIndex(bp, ch.key),
          rate_limit_per_user: ch.slowmode,
        }),
      );
    }
  }

  // Webhooks for bot-managed read-only channels
  for (const ch of bp.channels.filter((c) => c.webhook)) {
    const id = store.blueprintState.get(ch.key);
    if (!id) continue;
    const live = guild.channelById(id);
    if (live && !live.webhook) {
      const wh = await tolerate403(`webhook.create:${ch.key}`, warnings, store, actor, () =>
        guild.createWebhook(id, "MORTIS FIELD NETWORK"),
      );
      if (!wh) continue;
      store.webhookUrls.set(ch.key, wh.url);
      store.bind(`${ch.key}.webhook`, wh.id);
      applied += 1;
      persistIfLive(store, guild);
    }
  }

  const sys = store.blueprintState.get(bp.guild.system_channel_key);
  if (sys) {
    await tolerate403("guild.system_channel", warnings, store, actor, () => guild.patchGuild({ system_channel_id: sys }));
  }

  // Pinned template posts go through the choke point. Never duplicate when the
  // template is already in the channel — sticky pin may 403 without PIN_MESSAGES.
  for (const ch of bp.channels) {
    if (!ch.pin_template) continue;
    const liveId = store.blueprintState.get(ch.key);
    if (!liveId) continue;
    const existing = await findExistingTemplatePost(
      guild,
      liveId,
      bp.templates.find((t) => t.key === ch.pin_template)?.title,
    );
    if (existing) {
      if (!existing.pinned) {
        await tolerate403(`pin:${ch.key}`, warnings, store, actor, () => guild.pinMessage(liveId, existing.id));
      }
      continue;
    }
    const result = await dispatchSend(
      { channel_key: ch.key, template_key: ch.pin_template, fields: {}, caller: { type: "owner-cli" } },
      { bp, store, guild },
    );
    if (result.ok && result.message_id && liveId) {
      await tolerate403(`pin:${ch.key}`, warnings, store, actor, () => guild.pinMessage(liveId, result.message_id!));
    }
  }

  // Orphans: report only. History-bearing channels archive-lock only with per-item confirm. Never delete.
  const confirm = new Set(opts.confirmDelete ?? []);
  for (const op of before.ops) {
    if (op.op !== "orphan") continue;
    if (!confirm.has(op.snowflake) && !confirm.has(op.name)) {
      store.appendAudit({
        actor,
        action: "provision.orphan_reported",
        target: op.snowflake,
        details: { name: op.name, has_history: op.has_history },
      });
      continue;
    }
    if (op.kind === "channel" || op.kind === "category") {
      const live = guild.channelById(op.snowflake);
      if (live && (op.has_history || (await guild.hasHistory(op.snowflake)))) {
        live.archived = true;
        const denyAll = overwritesFor(bp, store, guild, "staff", "text", true, false);
        await tolerate403(`orphan.archive:${op.snowflake}`, warnings, store, actor, () =>
          guild.patchChannel(op.snowflake, { permission_overwrites: denyAll, archived: true }),
        );
        store.appendAudit({
          actor,
          action: "provision.archive_lock",
          target: op.snowflake,
          details: { name: op.name },
        });
        continue;
      }
    }
    store.appendAudit({
      actor,
      action: "provision.orphan_reported",
      target: op.snowflake,
      details: { name: op.name, kind: op.kind, has_history: op.has_history, note: "report-only; never deleted" },
    });
  }

  const liveHeld =
    guild.live && "botPermissions" in guild && typeof (guild as { botPermissions?: string }).botPermissions === "string"
      ? BigInt((guild as { botPermissions: string }).botPermissions || "0")
      : null;
  if (liveHeld !== null) {
    if ((liveHeld & PERM.ADMINISTRATOR) !== 0n) {
      warnings.push(`bot holds ADMINISTRATOR — re-invite with ${botPermissionInteger()}; do not keep Admin`);
    }
    const missing = permissionMissing(liveHeld);
    if (missing.length) warnings.push(`bot missing required bits: ${missing.join(", ")} — re-invite with ${botPermissionInteger()}`);
    const extras = permissionExcess(liveHeld);
    if (extras.length) warnings.push(`bot holds extra permissions: ${extras.join(", ")}`);
  }

  store.lastAppliedHash = before.hash;
  store.appendAudit({
    actor,
    action: "provision.apply",
    details: { hash: before.hash, applied, no_op: false, warnings },
    outcome: "ok",
  });
  await registerCommandsSafe(bp, guild, warnings, actor, opts.appId);
  persistIfLive(store, guild);

  return { plan: before, applied, no_op: false, warnings, manual: bp.onboarding.manual_toggles };
}

/** Re-post or edit pinned templates so live messages carry interaction buttons. */
export async function refreshPins(
  bp: Blueprint,
  store: EnvoyStore,
  guild: SimulatedGuild,
  actor = "owner-cli",
): Promise<Array<{ key: string; action: string; ok: boolean; message_id?: string; reason?: string }>> {
  const out: Array<{ key: string; action: string; ok: boolean; message_id?: string; reason?: string }> = [];
  attachCurrentRestMethods(guild);
  const targets = bp.channels.filter((ch) => ch.pin_template && (ch.components?.length || ch.key === "arrival.terms" || ch.key === "arrival.intake"));
  if (!targets.length) {
    out.push({ key: "arrival.terms", action: "skip", ok: false, reason: "blueprint missing pin targets" });
    return out;
  }
  for (const ch of targets) {
    const ids = ch.components?.length
      ? ch.components
      : ch.key === "arrival.terms"
        ? ["terms_accept"]
        : ch.key === "arrival.intake"
          ? ["intake_start"]
          : [];
    const liveId = store.blueprintState.get(ch.key);
    if (!liveId) {
      out.push({ key: ch.key, action: "skip", ok: false, reason: "unbound — connect + apply first" });
      continue;
    }
    if (guild.live) {
      const access = await ensureBotChannelAccess(guild, liveId);
      if (!access.ok && access.warning) {
        store.appendAudit({
          actor,
          action: "discord.overwrite",
          target: ch.key,
          outcome: "fail",
          details: { warning: access.warning },
        });
      }
    }
    const rows = interactionRows(ids);
    if (!rows?.length) {
      out.push({ key: ch.key, action: "skip", ok: false, reason: "no button rows" });
      continue;
    }

    let pins: Array<{ id: string; author_id: string; components?: unknown }> = [];
    try {
      pins = (await guild.listPins(liveId)).map((m) => ({
        id: m.id,
        author_id: m.author_id,
        components: m.components,
      }));
    } catch (err) {
      const e = err as Error & { body?: string };
      store.appendAudit({
        actor,
        action: "provision.pin_refresh",
        target: ch.key,
        details: { action: "listPins_failed", error: `${e.message}${e.body ? ` ${e.body}` : ""}` },
      });
    }

    const hasButtons = (m: { components?: unknown }) => JSON.stringify(m.components ?? "").includes(ids[0] ?? "___");
    let ours: { id: string; author_id: string; components?: unknown } | undefined =
      pins.find((m) => m.author_id === guild.botUserId || m.author_id === "webhook" || m.author_id === "") ?? pins[0];

    if (!ours) {
      try {
        const recent = guild.live
          ? await restApi<unknown>(guild, "GET", `/channels/${liveId}/messages?limit=25`)
          : (guild.channelById(liveId)?.messages ?? []);
        const rowsMsg: Array<Record<string, unknown>> = Array.isArray(recent) ? (recent as Array<Record<string, unknown>>) : [];
        const mapped = guild.live
          ? rowsMsg.map((m) => {
              const author = (m.author as Record<string, unknown> | undefined) ?? {};
              return {
                id: String(m.id),
                author_id: String(author.id ?? ""),
                components: m.components,
              };
            })
          : (recent as Array<{ id: string; author_id: string; components?: unknown }>);
        ours =
          mapped.find((m) => hasButtons(m) && (m.author_id === guild.botUserId || !guild.live)) ??
          mapped.find((m) => hasButtons(m)) ??
          mapped.find((m) => m.author_id === guild.botUserId);
      } catch (err) {
        const e = err as Error & { body?: string };
        store.appendAudit({
          actor,
          action: "provision.pin_refresh",
          target: ch.key,
          details: { action: "listMessages_failed", error: `${e.message}${e.body ? ` ${e.body}` : ""}` },
        });
      }
    }

    const stampComponents = async (messageId: string): Promise<{ ok: boolean; n: number; reason?: string }> => {
      if (!guild.live) {
        await guild.editMessage(liveId, messageId, { components: rows });
        return { ok: true, n: rows.length };
      }
      try {
        const patched = await restApi<Record<string, unknown>>(guild, "PATCH", `/channels/${liveId}/messages/${messageId}`, {
          components: rows,
        });
        const n = Array.isArray(patched.components) ? patched.components.length : 0;
        return { ok: n > 0, n, reason: n ? undefined : `discord returned ${JSON.stringify(patched.components ?? null)}` };
      } catch (err) {
        const e = err as Error & { body?: string };
        return { ok: false, n: 0, reason: `${e.message}${e.body ? ` ${e.body}` : ""}` };
      }
    };

    if (ours && hasButtons(ours)) {
      try {
        if (guild.live) await restApi(guild, "PUT", `/channels/${liveId}/pins/${ours.id}`);
        else await guild.pinMessage(liveId, ours.id);
        out.push({ key: ch.key, action: "already", ok: true, message_id: ours.id });
      } catch (err) {
        const e = err as Error & { body?: string };
        out.push({
          key: ch.key,
          action: "already_unpinned",
          ok: true,
          message_id: ours.id,
          reason: `pin 403/denied — message left in channel, not duplicated. ${e.message}${e.body ? ` ${e.body}` : ""}`.slice(0, 240),
        });
      }
      continue;
    }

    if (ours) {
      const stamped = await stampComponents(ours.id);
      if (stamped.ok) {
        store.appendAudit({
          actor,
          action: "provision.pin_refresh",
          target: ch.key,
          details: { action: "edit", message_id: ours.id, components: stamped.n },
        });
        out.push({ key: ch.key, action: "edit", ok: true, message_id: ours.id, reason: `components=${stamped.n}` });
        continue;
      }
      store.appendAudit({
        actor,
        action: "provision.pin_refresh",
        target: ch.key,
        details: { action: "edit_failed", error: stamped.reason },
      });
    }

    const result = await dispatchSend(
      { channel_key: ch.key, template_key: ch.pin_template!, fields: {}, caller: { type: "owner-cli" } },
      { bp, store, guild },
    );
    if (result.ok && result.message_id) {
      try {
        if (guild.live) await restApi(guild, "PUT", `/channels/${liveId}/pins/${result.message_id}`);
        else await guild.pinMessage(liveId, result.message_id);
      } catch (err) {
        const e = err as Error & { body?: string };
        out.push({ key: ch.key, action: "repost", ok: false, reason: `pin: ${e.message}${e.body ? ` ${e.body}` : ""}`, message_id: result.message_id });
        continue;
      }
      const stamped = await stampComponents(result.message_id);
      for (const p of pins) {
        if (p.id !== result.message_id && guild.live) {
          try {
            await restApi(guild, "DELETE", `/channels/${liveId}/pins/${p.id}`);
          } catch {
            /* leave */
          }
        }
      }
      out.push({
        key: ch.key,
        action: "repost",
        ok: stamped.ok,
        message_id: result.message_id,
        reason: stamped.ok ? `components=${stamped.n}` : stamped.reason,
      });
    } else {
      out.push({ key: ch.key, action: "repost", ok: false, reason: result.reason ?? "dispatch failed" });
    }
  }
  persistIfLive(store, guild);
  return out;
}

export async function adopt(
  store: EnvoyStore,
  guild: SimulatedGuild,
  blueprintKey: string,
  snowflake: string,
  actor = "owner-cli",
): Promise<void> {
  const liveRole = guild.roleById(snowflake);
  const liveCh = guild.channelById(snowflake);
  if (!liveRole && !liveCh) throw new Error("live object not found");
  store.bind(blueprintKey, snowflake);
  store.appendAudit({ actor, action: "provision.adopt", target: blueprintKey, details: { snowflake } });
  persistIfLive(store, guild);
}

/** Re-apply previous blueprint hash mapping. Archive-locks reverse by restoring overwrites. */
export function rollbackNote(store: EnvoyStore): { previous: string | null } {
  const prev = store.priorStateSnapshots[store.priorStateSnapshots.length - 1];
  return { previous: prev?.hash ?? null };
}

export function archiveLockReversible(guild: SimulatedGuild, snowflake: string): boolean {
  const ch = guild.channelById(snowflake);
  return Boolean(ch?.archived);
}
