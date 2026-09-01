/**
 * S73 — notification preferences.
 *
 * Reversible per-member opt-in / opt-out for the three player-safe categories
 * a Field Network member sees:
 *   - notice        : ARRIVAL notices and lockdown lifts
 *   - dispatches    : NETWORK / dispatches / operational status
 *   - tickets_own   : replies on the member's own tickets
 *
 * A preference is stored on the store's notificationPreferences map,
 * separately from MemberRow so this module can ship without a schema change
 * to the shared type. Every change is audited (reversible). Preferences can
 * only be set for a member whose intake_state === "complete" — before intake
 * there is nothing to opt in or out of.
 *
 * Player-safety invariants preserved:
 *   - No preference expands what a member can see. Suppression only.
 *   - Staff channels and restricted material are never gated on preferences.
 *   - Discord-side surfaces (role toggles, /orient controls) may CALL these
 *     helpers, but the store is the source of truth. Discord is not canon.
 */

import type { EnvoyStore } from "./store.ts";

export type NotificationChannel = "notice" | "dispatches" | "tickets_own";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "notice",
  "dispatches",
  "tickets_own",
] as const;

export type NotificationPreferences = Record<NotificationChannel, boolean>;

/** Default is opt-in for everything — a new initiate hears the whole network. */
export const DEFAULT_PREFERENCES: NotificationPreferences = Object.freeze({
  notice: true,
  dispatches: true,
  tickets_own: true,
}) as NotificationPreferences;

function isKnown(channel: string): channel is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(channel);
}

export function getNotificationPreferences(
  store: EnvoyStore,
  snowflake: string,
): NotificationPreferences {
  const stored = store.notificationPreferences.get(snowflake);
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}

export type PreferenceChange =
  | { ok: true; snowflake: string; channel: NotificationChannel; enabled: boolean; audit_id: string }
  | { ok: false; reason: string };

export function setNotificationPreference(
  store: EnvoyStore,
  input: { snowflake: string; channel: string; enabled: boolean; actor?: string },
): PreferenceChange {
  const member = store.members.get(input.snowflake);
  if (!member) return { ok: false, reason: "member unknown" };
  if (member.intake_state !== "complete") {
    return { ok: false, reason: "intake incomplete — preferences are only settable after intake" };
  }
  if (!isKnown(input.channel)) return { ok: false, reason: `unknown notification channel: ${input.channel}` };

  const prefs = { ...DEFAULT_PREFERENCES, ...(store.notificationPreferences.get(input.snowflake) ?? {}) };
  const previous = prefs[input.channel];
  prefs[input.channel] = Boolean(input.enabled);
  store.notificationPreferences.set(input.snowflake, prefs);

  const aud = store.appendAudit({
    actor: input.actor ?? input.snowflake,
    action: "notifications.preference.set",
    target: input.snowflake,
    details: {
      channel: input.channel,
      enabled: Boolean(input.enabled),
      previous,
      reversible: true,
    },
  });
  return { ok: true, snowflake: input.snowflake, channel: input.channel, enabled: Boolean(input.enabled), audit_id: aud.id };
}

/** True when the member has NOT opted out of the given channel. */
export function memberOptedIn(
  store: EnvoyStore,
  snowflake: string,
  channel: NotificationChannel,
): boolean {
  const prefs = getNotificationPreferences(store, snowflake);
  return prefs[channel] !== false;
}
