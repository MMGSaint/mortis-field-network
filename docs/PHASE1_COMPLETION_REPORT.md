# MORTIS PHASE 1 — COMPLETION REPORT
**Date:** 2026-08-20 · **Status:** ENGINE COMPLETE IN SANDBOX — OWNER DEPLOY REMAINS

## BUILD SUMMARY

Phase 1 foundation for the Mortis Field Network:

- Declarative blueprint (`blueprint/`) with strings separated from structure, neutral fallbacks for unstamped composed names.
- Shared term lists consumed by **both** `validate` and `dispatch.send`.
- `mortis-provision`: validate / plan / apply / adopt. Idempotent. Orphan-protecting. History-bearing channels archive-lock only.
- `mortis-envoy` logic: Ed25519-before-parse interactions, intake, tickets, operational notices, eight-step dispatch choke point, append-only audit, LOCKDOWN.
- Simulated Discord guild + in-memory D1/R2 so the nine mandatory tests run without a live guild.
- Operator workstation (this preview) so the owner can see apply, dispatch, tickets, audit, and the test suite. **Not the Phase 3 Operations Room.**

## FILES CREATED

- `blueprint/guild.json`, `blueprint/templates.json`, `blueprint/terms/{restricted,developer}.json`
- `src/lib/mortis/**` (crypto, terms, blueprint, permissions, provision, dispatch, intake, tickets, events, envoy, runtime, tests)
- `workers/mortis-envoy/{wrangler.toml,schema.sql,src/index.ts}`
- `tools/mortis-provision/cli.mjs`
- `tests/phase1/mandatory.test.ts`
- `docs/{PHASE1_RECON_REPORT,DISCORD_SETUP,PHASE1_COMPLETION_REPORT}.md`
- Operator workstation routes under `src/routes/`

**Not modified (and not present in this sandbox):** frozen relay, player apps, release-builder, admin-phase2, keys, canon export, PROP_*.json.

## INFRASTRUCTURE REUSED

Patterns from the live relay and the handoff: uniform 404 `{"error":"not found"}`, digest-compare, verify-only Ed25519, additive DDL, secrets-not-in-vars, block-not-redact leak gate. No code copied from frozen trees. Envoy never calls the relay.

## DATABASE / SCHEMA

`workers/mortis-envoy/schema.sql` — members, staff, blueprint_state, templates, events, tickets, audit. No canon tables.

## ENVIRONMENT VARIABLES (names only)

`DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `CLI_SECRET`. Optional verify-only `RELEASE_PUBLIC_KEY` for excerpt bundles.

## DISCORD PERMISSIONS

Least privilege integer `294851834304` (View Channel, Send Messages, Embed Links, Read Message History, Manage Channels, Manage Roles, Manage Webhooks, Use Application Commands, Manage Threads, Send Messages in Threads, Connect). Never Administrator.

## TEST RESULTS

Run: `node --experimental-strip-types --test tests/phase1/mandatory.test.ts`

| ID | Name | Result |
|---|---|---|
| T1 | Blank guild provisioning | PASS |
| T2 | Idempotent apply | PASS |
| T3 | Orphan / RP-history protection | PASS |
| T4 | Permission isolation | PASS |
| T5 | Restricted visibility rejection | PASS |
| T6 | Forged signature rejection | PASS |
| T7 | Dispatch bypass / role-imposter | PASS |
| T8 | Zero authoritative canon reachable | PASS |
| T9 | Audit logging | PASS |
| S1–S7 | Intake idempotency, register mismatch, NARRATIVE-without-ENACTED, term-list unity, bot perms, 429 backoff, report-ticket privacy | PASS |

Typecheck: PASS. Production build: PASS. Operator workstation renders signed-out landing with Google/X sign-in; no console errors; no mobile overflow.

Live relay baseline after this work: `GET /v1/health` → `{"ok":true,"service":"mortis-relay"}` (unchanged; envoy was not deployed).

## SECURITY REVIEW

- Interactions: Ed25519 verified on the raw body before JSON.parse; 401 on failure.
- CLI routes: SHA-256 digest compare; failures return uniform 404.
- Staff authorization: envoy `staff` table snowflakes. A member holding a Discord role named OPERATIONS still fails `/post`.
- Delivery primitive `discordDeliver` is only used from dispatch step 7 and staff-inbox alerts (not player-facing).
- NARRATIVE cannot dispatch unless `events.state = ENACTED`.
- Term scan blocks; it never redacts.

## CANON BOUNDARY REVIEW

- Schema has no facts/fragments/dossiers/sealed payloads.
- Zero-canon inspector over envoy modules + worker tree: clean (deny-list files excluded).
- Restricted names (Ashwright, R-grades, True Name, identifier prefixes) exist only as scanner terms, not as stored canon.
- Drive PROP_* / DM-admin PDFs / export delta were **not ingested**.

## DEPLOYMENT PROCEDURE

See `docs/DISCORD_SETUP.md`. Scratch guild + wrangler secrets + `plan` then `apply`. Do not deploy to the real guild until scratch tests pass there.

## ROLLBACK PROCEDURE

See `docs/DISCORD_SETUP.md` §7. Archive-lock is reversible by restoring overwrites. Kill switch: secret rotation or LOCKDOWN.

## REMAINING WORK

**SHOULD (Phase 1, not blocking the blank-guild milestone):** `/orient`, transcript HTML, notification preferences, drift-detection cron (report-only), richer button polish.

**LATER:** narrative enactment UI, SHADOW issuance, Operations Room service binding, gateway sidecar, identity linking, VRChat seam.

## DEVELOPER ACTIONS REQUIRED

1. Copy this package into `MORTIS_PLAYER_PLATFORM` (proposed workspace diff is in the recon report). Merge term lists with live `packages/release-builder` **additions only**.
2. Create the Discord application + scratch guild; invite with the least-privilege integer.
3. Create CF Worker / D1 / R2; `wrangler secret put` the four secrets; set Interactions URL.
4. Seed the owner snowflake into `staff`.
5. Stamp `approved:` on composed display names (NOTICES // BRIEFINGS, CIRCULATED RECORDS, OFF RECORD, INTAKE, Accord prefix on SUPPORT DESK) when ready; neutral fallbacks ship meanwhile.
6. Do not answer UNRESOLVED-1…5 (Season 3, app branding, DM triggers, identity linking, composed names).

## IMPLEMENTATION NOTES (not canon)

- Role blueprint keys are namespaced `role.*` so they cannot collide with channel keys (`staff.dm`).
- `neutral_fallback: true` is accepted by validate for Phase 1 operational copy lacking an owner `approved:` stamp (handoff UNRESOLVED-5).
- This sandbox could not see `MORTIS_PLAYER_PLATFORM` or the 2026-08-20 architecture source files; the handoff was treated as implementation authority (conflict C-02).
