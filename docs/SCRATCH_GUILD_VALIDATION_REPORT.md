> **ERRATA (2026-08-26):** Canonical repo is https://github.com/MMGSaint/mortis-field-network. Least-privilege integer is `295011699728`, not `294851834304` (transcription error). Leave Interactions Endpoint URL blank while using the workstation gateway.

# SCRATCH GUILD VALIDATION REPORT
**Date:** 2026-08-20 · **Status:** HOLD — waiting on scratch guild connection  
**Production impact:** NONE

## Invariants (re-verified this session)

| Invariant | Result |
|---|---|
| Dispatch choke point (`dispatch.send`, 8 steps, block-not-redact) | PASS |
| Zero-canon envoy boundary (T8 + schema) | PASS |
| No Auto-Reveal (NARRATIVE stops at ELIGIBLE) | PASS |
| Idempotent provisioning (T2) | PASS |
| Orphan / history protection (T3) | PASS |
| Audit logging (T9) | PASS |
| Security controls (Ed25519-before-parse, digest compare, staff table, never Administrator) | PASS |

Engine suite: **T1–T9 PASS, S1–S7 PASS**. Live relay `GET /v1/health` → `{"ok":true,"service":"mortis-relay"}`. Envoy not deployed. Production Discord not touched.

## Live Discord

| Gate | Result | Notes |
|---|---|---|
| Discord connection | HOLD | No bot token in this environment. Token must be entered on the Provision page, never in chat. |
| Validation | HOLD | Requires connection. |
| Plan | HOLD | Requires connection. |
| Apply | HOLD | Requires connection + scratch confirmation. |
| Structure | HOLD | |
| Permissions | HOLD | Overwrite audit is wired; runs after apply. |
| Idempotency | HOLD | |
| Drift reconciliation | HOLD | Probe buttons on Provision. |
| Orphan protection | HOLD | Probe buttons on Provision. |
| Dispatch | HOLD | Operational test notice after apply. |
| Audit | HOLD | |
| LOCKDOWN | HOLD | Arrival close is implemented. Discord invite-pause API needs Manage Server, which the least-privilege integer **does not include** — reported, not widened. |
| Zero-canon boundary | PASS | Unchanged. |
| Production impact | NONE | |

## Implementation-level addition (not a redesign)

Provision now has a live Discord REST transport (`DiscordRestGuild`) using the same create/patch/webhook/message surface as the simulator. Blueprint, choke point, term lists, and orphan policy are unchanged.

Discord slugifies text/voice channel names. Categories and roles keep the blueprint display strings. Reported as transport constraint C-07.

## Stop condition

Work stops here until:

1. A **blank scratch guild** exists (not the player Mortis guild).
2. The bot is invited with permission integer `294851834304`.
3. Guild snowflake is provided (safe to send here).
4. Bot token is entered on the Provision page password field (not here).
5. The scratch-guild checkbox is ticked.

Then: Validate → show plan → apply only if the plan contains no deletes.
