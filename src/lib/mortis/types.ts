import type { Audience } from "./permissions.ts";

export type RegisterClass = "ic" | "clear" | "voice" | "dual" | "staff" | "OPERATIONAL" | "NARRATIVE" | "PLAYER_SAFE";
export type EventClass = "OPERATIONAL" | "NARRATIVE";
export type EventState = "SCHEDULED" | "ELIGIBLE" | "ENACTED" | "DISPATCHED" | "ARCHIVED";
export type IntakeState = "none" | "terms_accepted" | "complete";
export type TicketStatus = "open" | "claimed" | "closed";
export type TicketCategory = "general" | "report" | "appeal" | "accessibility";

export type RoleBlueprint = {
  key: string;
  display: string;
  hoist: boolean;
  mentionable: boolean;
  color: number;
  tier: "staff" | "bot" | "player";
  position_group: "staff" | "bot" | "player";
  canon_ref?: string;
  issuance?: string;
  approved?: string;
  neutral_fallback?: boolean;
  managed_by_discord?: boolean;
};

export type CategoryBlueprint = {
  key: string;
  display: string;
  audience: Audience;
  show_locked: boolean;
  position: number;
  canon_ref?: string;
  approved?: string;
  neutral_fallback?: boolean;
};

export type ChannelBlueprint = {
  key: string;
  category: string;
  kind: "text" | "voice";
  display: string;
  topic: string;
  audience: Audience;
  register: RegisterClass;
  readonly: boolean;
  webhook: boolean;
  slowmode: number;
  pin_template?: string;
  components?: string[];
  attachments_restricted?: boolean;
  canon_ref?: string;
  approved?: string;
  neutral_fallback?: boolean;
};

export type TemplateBlueprint = {
  key: string;
  register: string;
  audience: string;
  channel_key: string;
  title: string;
  body: string;
  class?: EventClass;
  requires_release?: boolean;
  canon_ref?: string;
  approved?: string;
  neutral_fallback?: boolean;
  /**
   * Owner-authored opt-in marking this template a faithful re-presentation of
   * an already-published document, which relaxes the restricted-term scan for
   * entries whose `allow_in` includes `published_verbatim`.
   *
   * This is a property of the TEMPLATE, never of a request. It was previously
   * derived from a caller-supplied `fields.verbatim`, which let anyone able to
   * set dispatch fields disable block-mode restricted terms. See S97.
   */
  verbatim?: boolean;
};

export type Blueprint = {
  version: number;
  blueprint_id: string;
  identity: { player_facing_name: string; canon_ref?: string };
  guild: {
    name: string;
    canon_ref?: string;
    verification_level: number;
    default_message_notifications: number;
    explicit_content_filter: number;
    preferred_locale: string;
    system_channel_key: string;
    afk_channel_key: string | null;
  };
  bot_permissions: { never_administrator: true; bits: string[] };
  oauth_scopes: string[];
  roles: RoleBlueprint[];
  categories: CategoryBlueprint[];
  channels: ChannelBlueprint[];
  templates: TemplateBlueprint[];
  onboarding: {
    enabled: boolean;
    mode: string;
    default_channel_keys: string[];
    manual_toggles: string[];
  };
  automod: Record<string, boolean>;
  commands: Array<{ name: string; description: string; staff_only: boolean; capability?: string }>;
};

export type BlueprintObject = {
  snowflake: string;
  kind: "role" | "category" | "channel" | "webhook";
  blueprint_key: string;
  name: string;
  parent?: string;
  type?: number;
  topic?: string;
  position?: number;
  overwrites?: unknown;
  webhook_url?: string;
  archived?: boolean;
  message_count?: number;
};

export type AuditRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target?: string;
  details: Record<string, unknown>;
  outcome?: "pending" | "ok" | "fail";
  mirrored?: boolean;
};

export type MemberRow = {
  snowflake: string;
  handle: string;
  callsign: string | null;
  intake_state: IntakeState;
  grants: string[];
  flags: string[];
  staff_notes: string;
  created_at: string;
  updated_at: string;
};

export type StaffRow = {
  snowflake: string;
  handle: string;
  capabilities: string[];
};

export type TicketRow = {
  id: string;
  opener: string;
  category: TicketCategory;
  status: TicketStatus;
  assignee: string | null;
  channel_snowflake: string;
  transcript_key: string | null;
  created_at: string;
  closed_at: string | null;
};

export type EventRow = {
  id: string;
  class: EventClass;
  template_ref: string;
  payload: Record<string, string>;
  audience: string;
  state: EventState;
  enacted_by: string | null;
};

export type DispatchRequest = {
  channel_key: string;
  template_key: string;
  fields: Record<string, string>;
  event_id?: string;
  caller: DispatchCaller;
};

export type DispatchCaller =
  | { type: "staff"; snowflake: string }
  | { type: "owner-cli" }
  | { type: "cron"; event_id: string }
  | { type: "operations-room"; session: string };

export type DispatchResult = {
  ok: boolean;
  step?: number;
  reason?: string;
  audit_id: string;
  message_id?: string;
};

export type PlanOp =
  | { op: "create"; kind: "role" | "category" | "channel" | "webhook"; key: string; display: string }
  | { op: "update"; kind: "role" | "category" | "channel"; key: string; snowflake: string; changes: string[] }
  | { op: "noop"; key: string }
  | { op: "orphan"; kind: string; snowflake: string; name: string; has_history: boolean };

export type Plan = {
  hash: string;
  ops: PlanOp[];
  creates: number;
  updates: number;
  orphans: number;
  noops: number;
};

export const STAFF_CAPS_ALL = [
  "post",
  "ticket.claim",
  "ticket.close",
  "ticket.report.read",
  "lockdown",
  "grant",
  "enact",
  "provision",
  "audit.read",
] as const;

export type StaffCap = (typeof STAFF_CAPS_ALL)[number];
