> **ERRATA (2026-08-26):** Implementation lives at https://github.com/MMGSaint/mortis-field-network. Least-privilege integer is `295011699728`. Leave Interactions Endpoint URL blank. Do not rebuild from this document.

# MORTIS — GROK BUILD HANDOFF · PHASE 1
**Date:** 2026-08-20 · **Status:** ARCHITECTURE FROZEN — APPROVED FOR IMPLEMENTATION
**Audience:** Grok Build (implementation agent). This package is authoritative for Phase 1. It contains no code by design; it tells you exactly what to build, what to read, what to preserve, and what to never do.

---

## 1. EXECUTIVE SUMMARY

You are implementing the Phase 1 foundation of the Mortis Discord environment: a system that transforms a completely blank Discord guild into the **MORTIS FIELD NETWORK** player environment through an idempotent provisioning operation, plus a gateway-less interaction Worker (`mortis-envoy`) providing intake, tickets, staff announcements through a single audited dispatch choke point, and audit logging.

The architecture is already designed and frozen. Canon questions are already resolved or explicitly parked. Your job is engineering: read the governing documents, inspect the existing repository, reuse the existing infrastructure patterns (Cloudflare Workers + D1 + R2, Ed25519 verify-before-accept, leak scanning, uniform-404 obscurity, append-only audit), implement the ten steps in §14, pass the nine mandatory tests in §15, and produce an implementation report.

Three sentences to hold onto for the entire build:

1. **The bot cannot leak what it cannot reach** — `mortis-envoy` stores zero canon, and no route or credential in your implementation may make canon reachable.
2. **Nothing reaches players except through the dispatch choke point** — one code path, eight enforced steps, no exceptions, no side channels.
3. **You implement; you do not design Mortis** — any situation that seems to require inventing a name, a rule, lore, or a canon decision means the task is mis-scoped: stop and report.

## 2. GOVERNING DOCUMENTS

Authority order (higher wins; conflicts are reported, never silently resolved):

1. **Existing Mortis canon and visibility locks** — the canon export (`02_ATOMIC_CANON_FACTS.jsonl` and ledgers) and owner locks. You will not need to read canon data to build Phase 1; if a task seems to require it, the task is mis-scoped.
2. **Published player-safe Initiate material** — notably MCA-OPS-PL-012 (`12_Mortis_Field_Network_Initiate_Operational_Reference.pdf`) and MIN-IAT-013 (`13_Mortis_Initiate_Access_Terminal.pdf`). Source of all established player-facing terminology.
3. **`MORTIS_DISCORD_MASTER_ARCHITECTURE_2026-08-20.md`** — the architecture you are implementing (§B structure, §E bot architecture, §H automation, §I security).
4. **`MORTIS_PHASE1_RESOLUTION_2026-08-20.md`** — §K resolutions, terminology authority table (§3), implementation contract (§7), Phase 1 scope (§8), decision register (§9).
5. **Existing Mortis Operations/Admin architecture and signing/release infrastructure** — `MORTIS_ADMIN_TERMINAL_PREP_2026-08-15.md` (security patterns), `MORTIS_PHASE2_final_push_items1-4_delivery.md` (relay, release builder, leak gate, signing), `MORTIS_STAGING_FREEZE_2026-08-15.md` (what is frozen).
6. **This handoff.** Where this document summarizes the above, the source documents control detail; where this document adds Phase 1 operational specifics (tests, rollback, checklists), it controls.

Conflict rule: if you find a contradiction between documents, or between a document and the live repository, do not choose silently. Preserve the higher-authority source, report the conflict in your implementation report, and if it blocks work, stop that work item.

## 3. LOCKED ARCHITECTURAL DECISIONS

These are settled. Do not reopen them; do not "improve" them.

**Identity and experience**
- L1. The player-facing Discord identity anchor is **MORTIS FIELD NETWORK** (established published terminology, MCA-OPS-PL-012). "FIELD RELAY" is retired. Do not invent a replacement or variant.
- L2. Authority triangle: VRChat = what the player witnesses; Registry/app = what the player can verify; **Discord = what the player hears — deliberately the least authoritative surface.** Nothing you build may adjudicate truth in player channels or make Discord a canon authority.
- L3. Players enter as Initiates through intake processing; no lore dump; locked categories may be visible by name (per-item blueprint flag); no completion/progress mechanics of any kind.
- L4. Dual-register rule: anything carrying obligations or safety (rules, consent, moderation, support) is plain language or flavored-framing-plus-plain-body. Never flavor-only.

**Information control**
- L5. Visibility architecture is inherited unmodified: canonical truth / system knowledge / player knowledge / permitted access / published / hidden / restricted / unresolved / DM-only remain distinct concepts. Discord adds only **audiences** (surface visibility) and **grants** (per-member capabilities), both operational, neither implying canon truth.
- L6. **No Auto-Reveal:** NARRATIVE events stop at `ELIGIBLE — AWAITING ENACTMENT` until explicit enactment through the authorized Operations workflow. OPERATIONAL events (maintenance, releases, outages, technical status) are automatable. NARRATIVE = anything that changes the fictional world or reveals world-content. (Phase 1 builds no NARRATIVE machinery — the class field and the refusal path exist from day one so nothing can sneak through.)
- L7. Content pipeline (long-term, one-way): CANON/APPROVED SOURCE → PLAYER-SAFE RELEASE → LEAK SCAN → SIGN → PUBLISH → APPLICATION/REGISTRY → mortis-envoy → Discord. Discord is never an alternative publishing authority; nothing flows upstream.
- L8. `mortis-envoy` is not a canon database (see §8).

**Engineering**
- L9. Gateway-less Phase 1: Discord HTTP Interactions + Cloudflare Workers + provisioning CLI. No always-on bot server. If a feature appears to need a gateway connection, explain why and stop — do not add one.
- L10. One outbound dispatch choke point (§9). No side-channel message paths to player-facing channels.
- L11. Provisioning is idempotent, reconciling, orphan-protected, and never destroys RP history (§7).
- L12. Discord roles are presentation only. Backend authorization keys on member records / the envoy staff table — never on Discord role names or IDs.
- L13. The frozen infrastructure (§20) is not modified. `mortis-envoy` is a NEW Worker with its OWN D1 database and R2 bucket.

**Visibility decisions (resolved this cycle — carry them exactly)**
- L14. Pillar names (Crucible, Reaper, Accord, Echo, Veil, Riftguard, Hallow) are player-safe on Discord at the Initiate-edition "visible work" level. **Ashwright remains restricted — never on player-facing surfaces.** Restricted identities never become Discord roles.
- L15. The R-grade rank ladder (R1–R8) remains restricted: **no rank roles, no rank copy, no invented replacement ranks.** Player-facing identity vocabulary is limited to established Initiate-edition terms: Initiate, Shadow, and billet titles.
- L16. "Archive" is player-safe; do not artificially hide the word. The application remains the stronger record/verification surface by architecture.
- L17. "Project Forge" is established in-world terminology (the training program) and may appear in that sense in approved/re-presented content. Internal production/development usage of "Forge" never reaches players; handling is context-aware, not a blanket token ban (§9 step 5). If an internal era label is needed, use one implementation-only codename from: DRYDOCK, MERIDIAN, SCAFFOLD, TOPSAIL, BALLAST. It is a label, never canon, never player-facing.
- L18. **"Season 3" never appears in new player-facing Discord copy** — no branding, onboarding mention, announcement, role, or channel. The phrase exists inside published Initiate documents ("PROGRAM YEAR: SEASON 3"); a faithfully re-presented published document is preserved verbatim, never silently edited. The interpretive question is UNRESOLVED-1 (§18) and is not yours to decide.

## 4. PLAYER-FACING TERMINOLOGY AUTHORITY

The complete authority table is `MORTIS_PHASE1_RESOLUTION_2026-08-20.md` §3 — treat it as the single reference when validating any player-visible string. Operating summary:

**Use verbatim (established, player-safe):** Mortis Field Network · Mortis Internal Network · Mortis Academy Network · Mortis Archive Authority · Initiate Access (clearance) · Initiate · Shadow · billet and billet titles (Mission Commander, Route/Veil Lead, Hallow/Medical Lead, Accord/Civilian Lead, Evidence Custodian/Echo, Crucible/Technical Lead, Riftguard/Containment Lead, Reaper/Threat Lead, Routekeeper, Field Controller, Registrar, Safety and Moderation Lead, Accord support desk) · the seven Pillar names + visible-work descriptions · Project Forge / Project Crucible (program sense) · Archive · Post-Severance · Abyssus Pocket / Abyssus Court / Crucible Academy (name level; never geography/routes) · Marks, Pulse, Cycle, Veil, Return, Fragment, Standard Black Sigil (Initiate-summary level) · comms vocabulary: channel, check-in, callsign, authentication phrase, distress signal, silent signal, civilian channel, public channel, notice, briefing, mission order, report, debrief, field report · the sentence "Restricted does not mean false. It means you do not currently need it."

**Never on player surfaces:** Ashwright · R-grades/rank ladder · True Name · Stalker beyond its published one-liner (and only inside re-presented docs) · Saint's Circle and all DM-layer entities · precise calendar conversions · Pocket geography / Threshold routes · "Season 3" in new copy · all dev vocabulary (seasons-as-era, phases, migration, canon cleanup, AI involvement, sprint/build terms, internal tool/table/route names, FACT-/CON-/TRG-/MINE- identifiers).

**Terminology capability note:** the freeze brief's capability list ("transmissions, dispatches, reports, operational notices…") describes *system capabilities*, not player-facing labels. Player-facing labels come only from the authority table: "dispatch" and "transmission" are retired as display vocabulary (dispatch survives as the internal function name `dispatch.send`); the player-visible equivalents are "notices," "briefings," "mission orders," "reports."

**Composed display names** (established words in new pairings — INTAKE, NOTICES // BRIEFINGS, CIRCULATED RECORDS, OFF RECORD, etc.) ship only with an `approved:` tag from the owner; otherwise use the neutral fallbacks in the blueprint. The validator enforces this (§7): you never make this judgment call yourself.

## 5. DISCORD ARCHITECTURE SUMMARY

Full specification: master architecture §B. Every category/channel has a **stable blueprint key** (never player-visible) and a swappable **display name**. Structure below is what Phase 1 provisions; display names show established/approved values with neutral fallbacks in parentheses.

| Category (key) | Channels (key → display) | Visibility |
|---|---|---|
| arrival | `arrival.notice` (threshold text, read-only) · `arrival.terms` → CONDUCT AND TERMS (read-only + accept button) · `arrival.intake` (interaction-only intake) | public (pre-intake) |
| network | `network.dispatches` → NOTICES // BRIEFINGS⚠ (bot/staff) · `network.status` → NETWORK STATUS (bot) · `network.traffic` → OPEN CHANNEL (all, IC) · `network.queries` → QUERIES⚠ (all, OOC-clear) | initiate+ |
| operations | `ops.board` → MISSION ORDERS (bot/staff + signup) · `ops.reports` → FIELD REPORTS (all, IC) · `ops.incidents` (granted; Phase 4 lifecycle — provision the category, not the machinery) | initiate+ / granted |
| records | `records.circulated` → CIRCULATED RECORDS⚠ (bot, published-PLAYER_SAFE re-presentation only) · `records.discussion` → ANALYSIS⚠ (all, IC; system never referees truth) | initiate+ |
| rp | `rp.commons.*` (2–3 location channels max at launch; locations must mirror approved/published places) · `rp.private.*` (on request) · `voice.*` | initiate+ / granted |
| community | `community.lounge` → OFF RECORD⚠ (OOC) · `community.media` (screenshots/clips) · `community.vrchat` (world access info) | initiate+ |
| support | `support.desk` → SUPPORT DESK (ticket buttons) · `support.tickets.*` (per-ticket, private) | initiate+ (entry point also in arrival) |
| staff | `staff.ops` · `staff.dm` (pinned: not a canon store) · `staff.audit` (bot audit mirror) · `staff.inbox` (bot notifications) · `staff.sandbox` | staff only |

⚠ = composed name requiring `approved:` tag; neutral fallback otherwise.

**Roles.** Staff (functional, never dressed): OWNER, OPERATIONS, MODERATOR, DM, DEVELOPER, TESTER, BOT — manually assigned by OWNER/OPERATIONS only; the bot never auto-grants staff. Player-facing: ⟪INITIATE⟫ (granted on intake completion; presentation only). ⟪SHADOW⟫ exists in the blueprint but its issuance flow is Phase 4 (needs DM confirmation workflow). **No rank roles, no faction roles, no veteran labels, max ~2 hoisted player tiers.** Roles never encode reveal state or grant backend capability.

**Deliberately absent:** veteran/returning areas, lore-index or world-guide channels, channels named for DM-layer entities, public lore suggestion box, Season anything, per-player progress surfaces.

## 6. PERMISSION MODEL

- Deny-by-default: `@everyone` sees only the arrival category. All other visibility comes from generated channel overwrites derived from the blueprint's audience declarations (public / initiate+ / granted / staff).
- The permission matrix is *generated from the blueprint*, never hand-edited in the Discord UI. Manual drift is detected (report-only), not auto-repaired.
- Bot permissions: least privilege. OAuth scopes `bot`, `applications.commands`; guild permissions limited to Manage Channels, Manage Roles, Manage Webhooks, Send Messages, Manage Threads (plus read). **Never Administrator.** The provisioner warns when the bot holds more than the blueprint requires.
- Bot role sits above player roles, below staff roles.
- Backend authorization is layered (§10): Discord Ed25519 request verification → envoy staff-table snowflake check → Operations-Room/owner-CLI-only paths for sensitive execution. Discord roles decide nothing backend-side.
- Slowmode defaults on public-writable channels; attachments/embeds restricted in arrival and records; webhooks only in bot-managed read-only channels; Discord native onboarding, safety setup, and AutoMod baseline configured from the blueprint.
- Report/appeal tickets restrict visibility to OWNER/OPERATIONS, not all staff.

## 7. PROVISIONING SPECIFICATION

`mortis-provision` — CLI on the owner PC (matches the existing trust pattern: privileged, key-adjacent operations run locally, like release signing).

**Blueprint:** versioned file set in the repo (no secrets ever): guild settings; categories/channels (key, kind, display, topic, visibility, register class, `show_locked`, webhook flag, per-display-string `canon_ref` or `approved:` tag); roles; permission matrix; templates (key, register, body, approval metadata); onboarding config. Display strings live in a separate `strings` layer so flavor swaps never touch structure.

**Operations, in order:**
1. `validate` — schema check → referential check → restricted-terms scan over every display string/topic/template → dev-vocabulary scan → approval-tag check (any player-visible string lacking `canon_ref` must carry `approved:<date>` or validation fails).
2. `plan` — fetch live guild state via REST; match objects through the local `blueprint_state` map (blueprint_key → snowflake), **never by name**; emit a human-readable diff (creates / in-place updates / orphans). Mutates nothing.
3. `apply` — only after plan; creates and in-place updates (rename ≠ recreate — history preserved); orphans (live objects with no blueprint key) are **reported only** by default; deletion requires per-item explicit confirmation; player-writable channels with message history can only be **archive-locked** (hidden + read-only), never deleted. Every mutation writes an audit row.
4. `adopt` — bind an existing live object to a blueprint key (recovery from manual creation).

**Invariants:** re-running `apply` with no drift is a no-op (hash comparison); bootstrap from a blank guild with only the bot invited produces the complete structure (roles → categories → channels → overwrites → webhooks → onboarding → pinned template posts → slash-command registration) plus a printed checklist of the few API-gated manual toggles; the provisioner never touches messages; rate limits respected via queued REST with backoff.

**Orphan protection is absolute:** the reconciler must never delete historical RP content merely because it is absent from current configuration. This is mandatory test 3.

## 8. `MORTIS-ENVOY` RESPONSIBILITIES

New Cloudflare Worker + own D1 + own R2 (transcripts). **Not a canon database — zero authoritative Mortis canon, ever.**

**Stores (operational only):** `members` (snowflake, intake_state, grants, flags, staff notes, timestamps) · `staff` (snowflake, capability set) · `blueprint_state` · `templates` (key, register, body, approval metadata) · `events` (class OPERATIONAL|NARRATIVE, template_ref, payload fields, audience spec, state SCHEDULED→ELIGIBLE→ENACTED→DISPATCHED→ARCHIVED, enacted_by) · `tickets` (+ transcript refs in R2) · `audit` (append-only) · notification preferences if built.

**Never stores:** canon facts, fragments, dossiers, reveal schedules, trigger definitions, [BIND] names, staging/proposal content, unpublished release material, DM lore notes, signing keys, the relay's ADMIN_SECRET or RELEASE_TOKEN, PII beyond Discord snowflake + handle.

**May receive:** Discord-signed interactions; Operations-Room/owner-CLI calls (template approvals, event creation/enactment, grants, provisioning triggers); published-release *metadata* (version identifier, presentation name, published-at); owner-selected published PLAYER_SAFE excerpts for re-presentation, each carrying release version + owner approval stamp, with the Ed25519 signature re-verified (public key only) before acceptance.

**May send:** Discord messages through the dispatch choke point only; staff notifications to `staff.inbox`/`staff.audit`; read responses to the Operations Room. No other outbound traffic — no calls to relay player routes, no third-party APIs.

**Authenticates via:** Discord Ed25519 request verification inbound; Cloudflare service binding from the admin terminal Worker (preferred, no second public admin origin) or owner-PC CLI with its own secret. Envoy holds no relay credentials and no signing key of any kind — it can verify signatures, never produce them.

## 9. DISPATCH SPECIFICATION

One choke point: `dispatch.send(channel_key, template_key, fields, event_id?)`. Every player-facing outbound message passes all eight steps, in this order, short-circuiting on failure:

1. **Authorization** — caller is a staff-table member, the Operations Room, or a cron job bound to an existing event; capability covers the target channel class.
2. **Visibility validation** — template register and content class are legal for the audience: NARRATIVE requires `events.state = ENACTED`; locked-category and staff-only destinations refuse player templates; audience spec resolves.
3. **Release/signature validation** (where applicable) — payloads derived from release content carry a release version whose signature verified at intake and an excerpt within its approval stamp.
4. **Restricted-term scan** — versioned shared term list (restricted names, FACT-/CON-/TRG-/MINE- identifiers, internal route/table names, Ashwright, R-grades, True Name, and the rest per §4). **Block, never redact** — redaction invites in-band guessing. Failure alerts `staff.inbox`.
5. **Developer-vocabulary scan** — same mechanics, dev list (season-as-era, phases, migration, sprint, canon tooling, internal codename). Context-aware Forge rule: "Project Forge"/"Forge" passes in re-presented published content and owner-approved program-sense templates; **warn-and-hold** in OPERATIONAL/system-notice copy; dev-sense usage has no pass path.
6. **Destination/channel validation** — channel_key resolves through `blueprint_state` to a live channel of the expected kind; register class matches channel class (network voice / IC / clear).
7. **Dispatch** — via webhook or bot token per blueprint declaration; queued, rate-limited, backoff on 429.
8. **Audit logging** — audit row written *before* the send attempt, completed with outcome after; failures at any step produce an audit row plus a `staff.inbox` alert.

Staff-category posts skip steps 2–6 but still perform 1, 7, 8. The two scanners (validator-static and dispatch-dynamic) consume the **same versioned term-list files** — one source of truth (mandatory test: a term added to the list is enforced by both immediately). No feature, cron, or convenience path may post to a player-facing channel except through this function. Building a bypass is a critical defect, not a shortcut.

## 10. SECURITY MODEL

Inherited posture (reuse, do not re-derive — see the terminal prep pack): no secrets in repos or client code (wrangler secrets only); obscurity surfaces return uniform 404 with identical body/timing; fixed-work comparisons (SHA-256 digest compare — do not copy the legacy `tokenEquals` length-leak, noted as finding S-05); memory-only sessions if any session surface ever exists; step-up confirm for privileged operations; append-only audit.

- **Secrets inventory:** `DISCORD_BOT_TOKEN` (envoy secret; usable by provision CLI locally — treated like the release token, never in files), `DISCORD_PUBLIC_KEY` (public, config-safe), `DISCORD_APP_ID`, webhook URLs (envoy D1 only, never in blueprint files), CLI auth secret if the CLI calls envoy admin routes. **The release signing key remains on the owner PC, untouched and unrelated. Envoy gets no publication power over the Archive by construction.**
- **Authorization layers:** (1) Discord Ed25519 interaction verification at the door — forged requests rejected before parsing; (2) staff snowflake check against envoy D1 `staff` table — never Discord roles; (3) sensitive execution (grants, events, provisioning) only via Operations Room session or owner-PC CLI; (4) least-privilege bot permissions with provisioner warning on excess.
- **Abuse/safety:** intake terms acceptance + optional minimum-account-age; Discord AutoMod baseline from blueprint; slowmode defaults; LOCKDOWN verb (arrival closes, invites pause — pre-authored OPERATIONAL templates); moderation actions audited with actor and reason; appeals guaranteed; report/appeal tickets OWNER/OPERATIONS-only.
- **Data protection:** minimum data (snowflakes, handles, grants, tickets); no emails or real names requested anywhere; transcripts in R2, staff-only, retention 180 days routine (reports/appeals at owner discretion); member deletion purges member row + grants and retains anonymized audit.
- **Testing philosophy (binding):** a failing test is an engineering problem, never a reason to weaken the safety model. Do not fix a leak scanner by removing terms, permissions by widening them, provisioning by allowing destructive resets, or signature validation by bypassing verification.

## 11. EXISTING INFRASTRUCTURE DEPENDENCIES

Repository: **MORTIS_PLAYER_PLATFORM** (workspaces: `apps/player`, `apps/player-android`, `admin-phase2`, `packages/*`, `workers/mortis-relay`). Inspect, reuse patterns, do not duplicate:

| Component | State | Your relationship to it |
|---|---|---|
| `workers/mortis-relay` | LIVE at `https://mortis-relay.mmg-wolfpoolyt.workers.dev` — `GET /v1/health`, `GET /v1/release` (header `x-mortis-release-token`, constant-time compare), legacy `POST /admin/publish\|trigger\|clear` (Bearer ADMIN_SECRET), D1 `mortis-reveal` (releases, sealed_payloads, trigger_log), R2 `mortis-releases`; holds NO signing key | **Frozen. Read for conventions only. Envoy never calls it, shares nothing with it, and is a separate Worker with separate D1/R2.** |
| `packages/release-builder` | Leak gate (RESTRICTED_TERMS + internal-id regex over every player-visible string), `canonicalStringify` deterministic signing bytes, WITHHELD/SEALED semantics | **Reuse the leak-gate pattern and term-list approach.** Extend by *sharing* term-list files, not by forking the scanner logic divergently. |
| Signing infrastructure | Dev Ed25519 keypair via `scripts/generate_signing_keys.mjs`; private key `keys/release_signing.pem` on owner PC only, excluded from repo; public key embedded verify-only (`apps/player/src/releaseKey.ts`); node-sign ↔ WebCrypto-verify interop proven | **Verify-only pattern is yours to copy** (envoy re-verifies excerpt bundles with the public key). Never request, move, or reference the private key. |
| Admin terminal prep pack | `workers/mortis-relay/stubs/` — `admin_worker.stub.ts`, `admin_ui.stub.html`, `admin_app.stub.js`, `schema_admin.stub.sql`; opaque-segment routing, memory-only sessions, step-up nonce, uniform-404, security-header set, additive-only DDL | **Pattern library for any envoy admin surface.** Stubs are inert and belong to the relay's future terminal — do not wire them, move them, or import them; copy the *patterns*. |
| Admin Console v1 (1.1.0) | FROZEN (tree hash `d27e27e6…5878c`) | Never touched, never referenced at runtime. |
| Player platform (Registry shell, seed, update-channel) | Delivered; seed release PD-20260814-01; verification-before-apply everywhere | Never touched. Envoy does not read player D1/R2/seeds. |
| Drive inbox contract | `MORTIS_ADMIN_INBOX`, PROP_*.json, owner-initiated import | The only intake path for new material. Discord tickets that carry world-content proposals route humans here; you build no alternative intake. |
| Deployment conventions | wrangler; secrets via `wrangler secret put` (never `[vars]`); D1 via `wrangler d1 execute`; additive-only schema files; docs pattern (`docs/CLOUDFLARE_SETUP.md` etc.) | Follow them: `workers/mortis-envoy/` with its own `wrangler.toml`, `schema.sql`, `docs/DISCORD_SETUP.md`. |

## 12. PHASE 1 SCOPE

**MUST HAVE:** Discord application + bot registration (least-privilege, §6) · secure HTTP interaction handling (Ed25519 verification) · blank-guild provisioning + idempotent reconciliation (roles, categories, channels, permission architecture per §5–§7) · onboarding foundation (terms acceptance + intake flow → member record → ⟪INITIATE⟫ role → staff.inbox receipt; idempotent) · ticket foundation (create/claim/close, private channels, D1 rows, transcripts to R2) · announcement infrastructure (templates table with approval metadata + staff `/post`) · operational notifications (manual trigger acceptable in Phase 1) · the full eight-step dispatch choke point live from day one · audit logging (D1 + staff.audit mirror) · secure configuration (wrangler secrets) · signature verification (Discord requests; release-excerpt verify path) · leak scanning (both gates, shared term lists) · the complete §15 test suite.

**SHOULD HAVE (only if MUST is complete and clean):** buttons/components polish · modal ticket creation with categorization + assignment · notification preferences · structured announcement templates (OPERATIONAL set) · maintenance notification template · application release notification template (owner-triggered; the automatic release→announce coupling stays rejected) · drift detection cron (report-only) · `/orient` command · transcript HTML rendering.

**LATER (design-compatible, not built):** narrative event engine + enactment UI · automated lore discovery · player knowledge engine · faction simulation · autonomous narrative generation · automatic canon publishing · complex DM tooling · large-scale live event orchestration · audience targeting beyond roles · temporary channel lifecycle · identity linking · VRChat seam · gateway sidecar · ⟪SHADOW⟫ issuance flow · Operations Room Network surface (service binding) — Phase 3.

## 13. EXPLICIT NON-GOALS

Phase 1 does not build: any lore content pipeline, reveal tooling, per-player content, economy/XP/levels, public lore wiki, AI-driven in-character bots, analytics beyond operational counts, moderation AI, always-on processes, a second admin origin, or any Registry/app/relay change. Initial provisioning content is deliberately minimal: orientation, communications, rules, support, basic RP channels, established terminology — **no fake lore, no generated history, no invented NPCs/factions/events, no manufactured mystery.** Emptiness is correct: world content arrives later through approved releases, not from you.

## 14. IMPLEMENTATION SEQUENCE

Build in this order; each step ends with its own tests passing before the next begins.

1. **Repository reconnaissance** — document existing architecture, relevant files, services, integration points, dependencies (deliverable: recon report; verify §11's claims against the live repo and report discrepancies rather than resolving them silently).
2. **Discord application foundation** — application, bot identity, scopes, least-privilege permission set, interactions endpoint URL wiring.
3. **Configuration model** — the blueprint format + `strings` layer + state map; desired state as data, not scattered logic.
4. **Provisioning engine** — create / detect / reconcile / protect / audit (`validate`/`plan`/`apply`/`adopt`).
5. **Permission architecture** — generated overwrites, audience tiers, bot-permission warning.
6. **Interaction layer** — intake flow, ticket creation/controls, staff administrative interactions.
7. **Dispatch system** — the eight-step choke point + templates + shared term lists.
8. **Operational notifications** — release/maintenance/outage/deployment-status templates through the choke point.
9. **Audit** — complete coverage of provisioning, permission changes, tickets, grants, and every outbound dispatch; staff.audit mirror.
10. **Full test suite** — §15; no deployment to the real guild until all mandatory tests pass.

## 15. TEST REQUIREMENTS

Mandatory (all must pass on a scratch guild before real deployment):

1. **Blank guild provisioning** — a completely blank test guild becomes the intended Phase 1 structure in one `apply`.
2. **Idempotency** — repeated `apply` produces the same state, zero duplicates (hash no-op verified).
3. **Orphan protection** — pre-created channels with message history survive reconciliation; deletion path requires per-item confirm; history-bearing channels can only be archive-locked.
4. **Permission test** — player accounts cannot see or write staff/DM-only areas; audience tiers hold across all categories.
5. **Restricted visibility test** — planted restricted-term and dev-term payloads cannot be dispatched to player-facing surfaces (blocked, audited, alerted); unapproved player-visible strings fail `validate`.
6. **Forged signature rejection** — invalid/forged signed release excerpts are rejected by the verify path; forged Discord interaction signatures get 401 before parsing.
7. **Dispatch bypass test** — code audit + runtime probe: no path posts to player-facing channels except `dispatch.send`; staff `/post` from a non-staff snowflake fails generically and audits; a staff-*role*-renamed imposter still fails (roles unused for auth).
8. **Zero-canon-reachable test** — static inspection/grep of the deployed envoy bundle and D1 schema for FACT-/CON-/TRG-/MINE- identifiers, restricted names, and canon dataset structures: must be absent; confirm no route or credential can reach unpublished material.
9. **Audit test** — provisioning, permission changes, tickets, grants, and player-facing dispatches each generate the expected audit records (and staff.audit mirrors).

Supplementary (from the implementation contract; run them, report them): intake idempotency under double-click; register/channel-class mismatch refusal; NARRATIVE-without-ENACTED refusal; term-list unity (a term added once is enforced by both gates); bot-permission set equals blueprint declaration; rate-limit backoff behavior under burst.

## 16. DEPLOYMENT REQUIREMENTS

- Deploy `mortis-envoy` as a new Worker via wrangler; secrets via `wrangler secret put` only; `[vars]` stays empty of secrets; D1 created and migrated from `workers/mortis-envoy/schema.sql` (additive-only file discipline for future changes).
- Scratch-guild full test pass (§15) precedes any real-guild operation. The real guild's first `apply` runs `plan` first with the owner reviewing the diff.
- Produce `docs/DISCORD_SETUP.md` in the repo: exact owner steps (application creation, bot invite URL with the least-privilege permission integer, secret setup, D1 commands, first apply, the manual-toggle checklist).
- Post-deploy smoke test, scripted: interactions endpoint answers Discord's verification ping; forged signature 401s; `/v1/*` of mortis-relay untouched (curl health before/after — envoy work must not correlate with any relay change); intake completes for a test account; ticket opens and closes; one staff `/post` lands through the choke point and appears in audit + staff.audit.
- Deployment of envoy must not modify, redeploy, or reconfigure mortis-relay, the player platform, or any frozen artifact. If a deploy step seems to require it, stop and report.
- Implementation report at the end: what was built, test results, deviations (if any, with the conflict they resolved), and every item deferred.

## 17. ROLLBACK REQUIREMENTS

Every Phase 1 operation needs a documented, tested way back:

- **Provisioning:** every `apply` archives its `plan` diff and prior `blueprint_state` map; a `rollback` procedure (documented, may be manual) can re-apply the previous blueprint version — renames revert in place; created-this-apply objects are archive-locked or (if empty and unused) deleted with per-item confirm; archive-locks are reversible by construction (hidden+read-only → restore overwrites).
- **Worker:** envoy deploys are rollback-able via wrangler versioned deployments; keep the previous version deployable; config/schema changes are additive so old code runs against new schema.
- **Database:** D1 export/snapshot before schema migrations and before the first real-guild apply; documented restore procedure.
- **Dispatch:** a mistaken player-visible message is handled by a documented retract procedure (delete via bot + audit row recording the retraction and reason) — retraction is an operator act, also audited, never silent.
- **Kill switch:** one documented action (secret rotation or route disable) stops all interactions handling; one action pauses invites + closes arrival (LOCKDOWN). Both tested on the scratch guild.
- **Secrets:** rotation procedures documented for bot token and CLI secret (mirroring the relay's rotation notes); webhook rotation via provisioner.
- **Absolute floor:** no rollback procedure may delete player message history or member records without explicit owner instruction; when in doubt, archive-lock and report.

## 18. KNOWN UNRESOLVED DECISIONS (owner-owned; not yours)

1. **"PROGRAM YEAR: SEASON 3" in published Initiate documents** — in-world archival designation vs production residue. Interim rule (already binding on you): never in new copy; verbatim in faithful re-presentations.
2. **App branding reconciliation** — "MORTIS · CONTINUITY REGISTRY" (shipped shell) vs "Initiate Access Terminal / Mortis Internal Network" (published canon). Out of your scope entirely; Discord copy references "the Internal Network / your terminal" generically.
3. **DM trigger-condition entry point** — Operations-Room-only (recommended) vs Discord staff command. Blocks Phase 4 only; build no trigger-related commands.
4. **Per-player identity linking** — ecosystem-level in/out. Blocks Phase 4/5 targeting only; build the seam design nowhere in Phase 1.
5. **⚠ composed display names + optional "Accord" prefix on SUPPORT DESK** — awaiting owner `approved:` stamps; neutral fallbacks ship meanwhile.

If your implementation surfaces a *new* genuinely blocking question, add it to this list in your report — do not answer it yourself.

## 19. EXACT FILES GROK SHOULD INSPECT FIRST

In order, before writing anything:

1. `MORTIS_DISCORD_MASTER_ARCHITECTURE_2026-08-20.md` (project docs) — full read; §B/§E/§H/§I are your build spec.
2. `MORTIS_PHASE1_RESOLUTION_2026-08-20.md` — full read; §3 terminology table and §7 contract are load-bearing.
3. `MORTIS_ADMIN_TERMINAL_PREP_2026-08-15.md` — security patterns + findings S-01…S-12 (avoid repeating S-02 uniform-404 and S-05 timing-leak mistakes in envoy).
4. `MORTIS_STAGING_FREEZE_2026-08-15.md` — the frozen-state inventory.
5. Repo: root `package.json` (workspaces, scripts) → `workers/mortis-relay/wrangler.toml`, `src/index.ts`, `src/logic.mjs`, `schema.sql` (conventions; frozen — read-only) → `workers/mortis-relay/stubs/*` (pattern library; inert) → `packages/release-builder/*` (leak-gate pattern, RESTRICTED_TERMS list location, canonicalStringify) → `apps/player/src/releaseKey.ts` (verify-only key embedding pattern) → `docs/CLOUDFLARE_SETUP.md`, `docs/DRIVE_FALLBACK.md` (docs conventions) → existing tests under `tests/` (test style: pure-logic modules with node tests).
6. Live checks (read-only): `GET /v1/health` on the deployed relay (baseline before you start, re-checked after every envoy deploy).

## 20. EXACT FILES PROHIBITED FROM MODIFYING WITHOUT APPROVAL

- **Frozen, never modify:** Admin Console v1 (entire tree; hash-verified `d27e27e6…5878c`) · `workers/mortis-relay/src/index.ts`, `src/logic.mjs`, `schema.sql`, `wrangler.toml` and every relay route (`/v1/*`, legacy `/admin/*`) · `workers/mortis-relay/stubs/*` (inert prep pack — belongs to the terminal work, not yours) · all `release_artifacts/*` (published releases) · `apps/player/*` and `apps/player-android/*` (player platform) · `admin-phase2/*` · `packages/release-builder/*` core logic and `@mortis-player/*` packages · `keys/` (and you never possess the private key) · all PROPOSAL JSONs, staging metadata, canon export files, and continuity documents.
- **Modify only with explicit owner approval:** root `package.json` (adding an envoy workspace entry + scripts is expected — propose the exact diff first) · shared term-list files once created (additions are expected and safe; removals ALWAYS require owner approval) · any `docs/*` file you did not create.
- **Yours to create freely:** `workers/mortis-envoy/**` (new) · `tools/mortis-provision/**` (new, or the repo-conventional location surfaced by recon) · blueprint file set · `docs/DISCORD_SETUP.md` · your test files.

## 21. GROK'S FIRST-SESSION CHECKLIST

1. Read §19 items 1–4 completely. Do not skim the terminology table.
2. Repo recon (§14 step 1): verify §11 against reality; produce the recon report; list any discrepancy as a conflict, not a fix.
3. Confirm the four load-bearing invariants back in your own words in the recon report: zero-canon envoy · single dispatch choke point (8 steps) · No Auto-Reveal (NARRATIVE stops at ELIGIBLE) · provisioning never destroys history.
4. Baseline the live relay (`/v1/health`) and record it.
5. Propose the exact root-`package.json` diff for the envoy/provision workspaces (do not apply yet).
6. Draft the blueprint schema + the two term-list files (seed the restricted list from `packages/release-builder`'s RESTRICTED_TERMS plus §4's never-list; dev list per §4/§9 step 5) and present them for owner review.
7. Set up the scratch guild + Discord application (least-privilege permission set of §6) — nothing points at any real guild.
8. Begin §14 step 3 only after 1–7 are done and the recon report is delivered.
9. Throughout: no canon invention, no player-facing copy without `canon_ref`/`approved:`/neutral-fallback, no unresolved-question answering, no frozen-file edits, and when uncertain — withhold and report. Uncertain → withhold is the ecosystem's tie-break rule and it now binds you too.

---

**ARCHITECTURE STATUS: FROZEN.** The Mortis Discord Master Architecture (2026-08-20) and the Phase 1 Resolution (2026-08-20) are accepted and locked. This handoff is the implementation authority for Phase 1. Claude's job was architecture; Grok's job is implementation; the developer's job is world direction and approval of consequential decisions. Blank Discord → Mortis Field Network.
