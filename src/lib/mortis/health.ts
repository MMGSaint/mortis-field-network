import { channelByKey } from "./blueprint.ts";
import { auditHeldPermissions, botPermissionInteger, PERM } from "./permissions.ts";
import type { SimulatedGuild } from "./discord-sim.ts";
import type { EnvoyStore } from "./store.ts";
import type { Blueprint } from "./types.ts";

export type HealthFinding = {
  severity: "ok" | "warn" | "hold";
  code: string;
  target?: string;
  detail: string;
};

export type HealthReport = {
  ok: boolean;
  live: boolean;
  findings: HealthFinding[];
  missing_channels: string[];
  missing_roles: string[];
  drift: string[];
  orphans_reported: number;
  lockdown: boolean;
  gateway?: { connected: boolean; lastError?: string };
};

const VIEW = PERM.VIEW_CHANNEL;

/** Report-only server health. Never deletes. */
export function assessHealth(
  bp: Blueprint,
  store: EnvoyStore,
  guild: SimulatedGuild,
  extra?: {
    gateway?: { connected: boolean; lastError?: string };
    liveOrphans?: number;
    botPermissions?: string;
    administrator?: boolean;
  },
): HealthReport {
  const findings: HealthFinding[] = [];
  const missing_channels: string[] = [];
  const missing_roles: string[] = [];
  const drift: string[] = [];

  for (const ch of bp.channels) {
    const id = store.blueprintState.get(ch.key);
    if (!id) {
      missing_channels.push(ch.key);
      findings.push({ severity: "hold", code: "missing.channel", target: ch.key, detail: `${ch.display} is not bound` });
      continue;
    }
    const live = guild.channelById(id);
    if (!live) {
      missing_channels.push(ch.key);
      findings.push({ severity: "hold", code: "missing.channel.live", target: ch.key, detail: `bound ${id} not present on guild` });
      continue;
    }
    if (ch.kind === "text" && live.topic !== undefined && ch.topic && live.topic && live.topic !== ch.topic) {
      drift.push(ch.key);
      findings.push({ severity: "warn", code: "drift.topic", target: ch.key, detail: "topic differs from blueprint" });
    }
    const catId = store.blueprintState.get(ch.category);
    if (catId && live.parent_id !== catId) {
      drift.push(ch.key);
      findings.push({
        severity: "warn",
        code: "drift.placement",
        target: ch.key,
        detail: live.parent_id ? "channel parent differs from blueprint category" : "channel has no parent; blueprint expects a category",
      });
    }
    const everyone = live.permission_overwrites.find((o) => o.id === guild.id);
    if (everyone && ch.audience !== "public") {
      const denyView = (BigInt(everyone.deny || "0") & VIEW) !== 0n;
      if (!denyView) {
        drift.push(ch.key);
        findings.push({
          severity: "warn",
          code: "drift.overwrites",
          target: ch.key,
          detail: "@everyone can view a non-public channel",
        });
      }
    }
    if (ch.webhook && !store.webhookUrls.get(ch.key) && !live.webhook && guild.live) {
      findings.push({ severity: "warn", code: "webhook.missing", target: ch.key, detail: "webhook URL not stored" });
    }
    if (ch.pin_template && live.type === 0) {
      const pinned = live.messages.some((m) => m.pinned);
      if (!pinned && guild.live) {
        findings.push({ severity: "warn", code: "pin.missing", target: ch.key, detail: "pin template not present on live channel" });
      }
    }
  }

  for (const role of bp.roles) {
    if (role.managed_by_discord) continue;
    if (!store.blueprintState.get(role.key)) {
      missing_roles.push(role.key);
      findings.push({ severity: "hold", code: "missing.role", target: role.key, detail: `${role.display} is not bound` });
    }
  }

  for (const key of bp.onboarding?.default_channel_keys ?? []) {
    if (!store.blueprintState.get(key)) {
      findings.push({ severity: "hold", code: "onboarding.channel", target: key, detail: "onboarding default channel unbound" });
    }
  }

  if (!store.blueprintState.get("support") || !store.blueprintState.get("support.desk")) {
    findings.push({ severity: "hold", code: "tickets.parent", detail: "SUPPORT / SUPPORT DESK unbound — tickets cannot nest" });
  }

  if (store.lockdown) {
    findings.push({ severity: "warn", code: "lockdown", detail: "Arrival is closed; invites paused" });
  }

  const pinKeys = bp.channels.filter((c) => c.pin_template).map((c) => c.key);
  for (const key of pinKeys) {
    const tpl = bp.templates.find((t) => t.key === channelByKey(bp, key)?.pin_template);
    if (!tpl) findings.push({ severity: "hold", code: "pin.template", target: key, detail: "pin template missing" });
  }

  if (extra?.gateway && guild.live && !extra.gateway.connected) {
    findings.push({
      severity: "hold",
      code: "gateway",
      detail: extra.gateway.lastError ?? "gateway not ready — buttons will time out",
    });
  }

  let orphans = extra?.liveOrphans ?? 0;
  if (extra?.liveOrphans === undefined) {
    for (const live of guild.channels) {
      if (store.reverseState.has(live.id)) continue;
      const ticketish = /^(ticket-|closed-)/i.test(live.name);
      if (ticketish) {
        findings.push({ severity: "warn", code: "unexpected.ticket", target: live.id, detail: `${live.name} is a ticket channel (report-only)` });
        continue;
      }
      orphans += 1;
      findings.push({
        severity: "warn",
        code: "unexpected.channel",
        target: live.id,
        detail: `${live.name} is not bound — report-only, never auto-deleted`,
      });
    }
    for (const role of guild.roles) {
      if (role.id === guild.id) continue;
      if (store.reverseState.has(role.id)) continue;
      orphans += 1;
      findings.push({
        severity: "warn",
        code: "unexpected.role",
        target: role.id,
        detail: `${role.name} is not bound — report-only`,
      });
    }
  }

  if (extra?.administrator || extra?.botPermissions !== undefined) {
    let held = 0n;
    try {
      held = extra.botPermissions ? BigInt(extra.botPermissions) : 0n;
    } catch {
      held = 0n;
    }
    const audit = auditHeldPermissions(held);
    if (audit.administrator || extra.administrator) {
      findings.push({
        severity: "hold",
        code: "perms.administrator",
        detail: `Bot holds Administrator. Re-invite with least-privilege integer ${botPermissionInteger()}. Channel overwrites cover access — do not keep Admin.`,
      });
    }
    if (audit.missing.length) {
      findings.push({
        severity: "hold",
        code: "perms.missing",
        detail: `Missing ${audit.missing.join(", ")}. Re-invite with ${botPermissionInteger()}.`,
      });
    }
    const extras = audit.excess.filter((x) => x !== "ADMINISTRATOR");
    if (extras.length) {
      findings.push({
        severity: "warn",
        code: "perms.excess",
        detail: `Extra bits ${extras.join(", ")}. Re-invite to drop them.`,
      });
    }
  }

  const holds = findings.filter((f) => f.severity === "hold");
  return {
    ok: holds.length === 0,
    live: Boolean(guild.live),
    findings,
    missing_channels,
    missing_roles,
    drift: [...new Set(drift)],
    orphans_reported: orphans,
    lockdown: store.lockdown,
    gateway: extra?.gateway,
  };
}
