-- mortis-envoy D1 schema (additive-only). Operational tables. ZERO canon.
-- Never add facts, fragments, dossiers, reveal schedules, or signing keys.

CREATE TABLE IF NOT EXISTS members (
  snowflake TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  callsign TEXT,
  intake_state TEXT NOT NULL DEFAULT 'none',
  grants TEXT NOT NULL DEFAULT '[]',
  flags TEXT NOT NULL DEFAULT '[]',
  staff_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  snowflake TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  capabilities TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blueprint_state (
  blueprint_key TEXT PRIMARY KEY,
  snowflake TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  key TEXT PRIMARY KEY,
  register TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  approval_meta TEXT NOT NULL,
  class TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  class TEXT NOT NULL CHECK (class IN ('OPERATIONAL', 'NARRATIVE')),
  template_ref TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  audience TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('SCHEDULED', 'ELIGIBLE', 'ENACTED', 'DISPATCHED', 'ARCHIVED')),
  enacted_by TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  opener TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT,
  channel_snowflake TEXT NOT NULL,
  transcript_key TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT NOT NULL,
  outcome TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at);
CREATE INDEX IF NOT EXISTS tickets_opener_idx ON tickets (opener);
CREATE INDEX IF NOT EXISTS members_intake_idx ON members (intake_state);
