# MORTIS AUTONOMOUS ROADMAP COMPLETION REPORT
**Date:** 2026-08-25 · **Agent:** Grok Build · **Mode:** execute remaining roadmap from existing `/workspace` tree

This report distinguishes **SIMULATED**, **LIVE DISCORD VERIFIED**, and **UNVERIFIED**. Nothing here is live-verified unless labelled as such.

---

## CURRENT STATE

Phase 1 Field Network engine is **complete in this workspace** and **hardened in the simulator**.

- Transport default: `SimulatedGuild`. Live REST (`DiscordRestGuild`) exists but is **not attached in this process** (bot token is not in memory; tokens are never persisted).
- Scratch guild `1540022458126700674` was previously applied (51 bindings, hash `ca21f0cdbbde846ea2f556c44101a0bc269886abb24c626a43117bdbca10452f`). Bindings remain in `data/scratch-guild-state.json`.
- Blueprint was **changed this run**: `community.vrchat` (WORLD ACCESS) is now readonly + webhook + `tpl.community.vrchat` pin. Next live Plan will show updates for that key. Do not Apply until the operator reviews.
- Operator workstation (Network, Provision, Dispatch, Tickets, Audit, Tests, Security) is running in the live preview.
- Production Mortis Discord: **untouched**.

---

## ROADMAP COMPLETED

| Phase | Status | Evidence |
|---|---|---|
| A Recon | DONE | Existing T1–T9 + S1–S26 already implemented. Gaps: health drift depth, ticket category validation, webhook 403 await bug, WORLD ACCESS pin, chaos S27–S36, stale Discord setup doc. |
| B Core hardening | DONE (SIMULATED) | Non-fatal 400/403 apply, overwrite sweep, gateway ACK, pin REST `listPins`, restart without token. |
| C Dispatch / security | DONE (SIMULATED) | T5–T8, S2–S4, S22, S34 release excerpt, imposter `/post`. |
| D Live scratch | **BLOCKED** | No token in this process. See EXTERNAL BLOCKERS. Prior owner session (2026-08-20) applied structure and confirmed buttons/intake/web tickets. |
| E Tickets | DONE (SIMULATED) | Create/claim/close/reopen, rate limit 2, restricted hold, invalid category list, html+txt transcript, 403 retry, fail-closed 503. |
| F Health / ops | DONE (SIMULATED) | Report-only health: missing, topic/placement/overwrite drift, onboarding, ticket parent, unexpected objects, lockdown, gateway. Provision + Security UI. |
| G Player experience | DONE (SIMULATED) | HOW TO BEGIN, REFERENCE FAQ, WORLD ACCESS pin (neutral), `/orient`, first-player walkthrough S10. No streamer roles. No restricted rank ladder. |
| H Application hooks | DONE (SIMULATED) | `tpl.ops.release_notice` requires signed excerpt (S34). CLI `/cli/verify-excerpt`. Operational notices via dispatch only. |
| I First-player walkthrough | DONE (SIMULATED) | S10 expanded: ARRIVAL-only guest, guide, WORLD ACCESS hidden then visible, intake, REFERENCE, private ticket, no `/post`, FAQ clean, `/orient`. |
| J Chaos / recovery | DONE (SIMULATED) | S8–S9, S14–S16, S18–S20, S24, S27–S33, S35–S36. |
| K Final sweep | DONE except live Discord | Typecheck PASS. Production build PASS. Preview smoke PASS (auth-timing divergence only on built output). |

Not opened (invariants): Phase 3 Operations Room, production Apply, canon ingest, Auto-Reveal, Administrator as a required permission.

---

## LIVE DISCORD VERIFICATION

**This session: UNVERIFIED.** No bot token in memory. Connect was not performed.

**Prior owner session (2026-08-20), not re-verified now:**

- Scratch guild structure applied (roles, categories, channels). Community enabled.
- ARRIVAL Accept / Begin Intake buttons present when gateway READY.
- Intake completed at least once.
- Web Tickets open/claim/close worked.
- Discord Open ticket modal was flaky (400/403); code retries overwrite + minimal overwrites. **Re-test on next Connect.**
- Operator sometimes left Administrator on the live bot because Discord 403'd without it. Code still must work without Admin.

Orphans last reported (report-only, `#general` has history):

| kind | snowflake | name |
|---|---|---|
| category | 1540022459032674405 | Text Channels |
| category | 1540022459032674406 | Voice Channels |
| channel | 1540022459032674407 | general (history) |
| channel | 1540022459032674408 | General (voice) |
| role | 1540061175230763022 | Mortis Field Network — Dev |

---

## TEST RESULTS

Command: `node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/phase1/mandatory.test.ts`

**SIMULATED: 9/9 mandatory + 36/36 supplementary PASS.**

T1–T9: provisioning, idempotency, orphan/history, permission isolation, restricted visibility, forged signatures, dispatch bypass/imposter, zero-canon, audit.

S1–S36: intake, register mismatch, NARRATIVE-without-ENACTED, term-list unity, bot perms, 429, report privacy, PATCH 403/400 non-fatal, walkthrough, ticket reopen/rate, no player-channel leak, health+lockdown+FAQ, kill switch, claim fail-closed, malformed ACK, `/orient`, concurrent rate limit, restart bindings, ticket 403 retry, slash register, restricted hold, operational notice, 503 drop reservation, report claim auth, worker pointer, rename-by-key, placement drift, overwrite drift, webhook 403 fallback, gateway reconnect without token, invalid category, type-9 modals, release excerpt, transcript html, lockdown notice.

Typecheck: PASS. Production build: PASS.

`npm test` also runs App Builder PWA injector unit tests; 9 of those fail because `src/lib/og/site.json` title is `MORTIS FIELD NETWORK` (correct product identity). Those are platform-brand tests, not Mortis engine tests. Not weakened.

---

## DEFECTS FOUND

1. `discordDeliver` sim path returned `guild.postMessage(...)` **without await**, so 403 never entered the webhook fallback catch.
2. Ticket modal / `/ticket` accepted or silently coerced invalid categories.
3. Health did not report placement or `@everyone` VIEW drift.
4. First-player walkthrough omitted WORLD ACCESS and `/orient`.
5. `docs/DISCORD_SETUP.md` still said Phase 1 was gateway-less and told the owner to Save an Interactions URL.
6. WORLD ACCESS (`community.vrchat`) had no pin and was writable — weaker than the player-experience plan.

---

## DEFECTS FIXED

1. Await postMessage; on 403 retry as webhook author when a webhook exists (S30).
2. `parseTicketCategory`; invalid → ephemeral `category must be general|report|appeal|accessibility` (S32).
3. Health: `drift.placement`, `drift.overwrites`, onboarding holds, ticket parent, unexpected objects as **warn** (never delete) (S28, S29).
4. Walkthrough + `/orient` (S10).
5. Discord setup: leave Interactions URL blank while using the workstation gateway; no privileged intents.
6. WORLD ACCESS pin template `tpl.community.vrchat` (neutral, no invented join facts). Channel readonly + webhook.
7. Closed tickets store `transcripts/{id}.txt` and `.html` (escaped) (S35).
8. Lockdown operational notice kind through dispatch (S36). Unknown button → `Unknown control.` (S33).

---

## REGRESSION COVERAGE

Added **S27–S36**. Existing T1–T9 and S1–S26 kept green. A failing test is not a reason to strip term lists, add Administrator, or delete history.

---

## CONNECTORS / AGENTS USED

None beyond this workspace. GitHub/Drive/Discord live REST were not called. No sub-agents were required after recon; implementation stayed on shared files (`dispatch.ts`, `envoy.ts`, `tickets.ts`, `health.ts`, `test-suite.ts`).

---

## REMAINING WORK

### OWNER DECISIONS

1. Paste bot token on Provision (never in chat) → Connect → wait gateway READY → Validate → Plan.
2. Review Plan after this blueprint change (WORLD ACCESS pin/readonly/webhook). Apply only if creates/updates look right. Orphans remain report-only.
3. Re-test Discord: Accept → Begin Intake → Open ticket (`general\|report\|appeal\|accessibility`).
4. Leave Interactions Endpoint URL **blank** until a real envoy Worker is deployed.
5. Rotate the bot token if it was ever pasted in chat.
6. Owner-owned unresolved items remain owner-owned: Season 3, app branding, DM trigger, identity linking, composed-name `approved:` stamps.

### EXTERNAL BLOCKERS

- **No Discord token in this process.** Live REST/Gateway/Apply/pin refresh/Open ticket on scratch cannot be executed here.
- Cloudflare envoy Worker not deployed. HTTP Interactions remain optional.
- Production guild must not be targeted.

### FUTURE OPTIONAL WORK

- Phase 3 Operations Room (explicit owner go).
- Phase 4 Shadow issuance / incident lifecycle.
- Narrative enactment UI (still no Auto-Reveal).
- Notification preferences, drift cron (report-only) as a scheduled job.
- Privileged intents: never unless owner names them.

---

## SCRATCH GUILD STATE

Last persisted: guild `1540022458126700674`, 51 bindings, hash `ca21f0cd…`. That hash will **not** match the current blueprint until a new Apply. Simulator apply is green (T1/T2). Live Apply: **UNVERIFIED this session**.

---

## PRODUCTION SAFETY

Production Mortis Discord was not connected, not planned, not applied. `mortis-relay` was not called. Envoy stores no canon. NARRATIVE still requires ENACTED. Dispatch remains the only player-facing send path.

---

## HANDOFF

Tree: `/workspace` (App Builder). Do not scaffold a replacement.

Start: `src/lib/mortis/runtime.ts` singleton via `server.ts` `globalThis.__mortisRuntime`.

Next live action: operator Connect (scratch checkbox) → Plan → read WORLD ACCESS update → Apply if intended → Refresh ARRIVAL pins if buttons missing → retest Open ticket.

Invariants: Discord is not canon authority; zero canon in envoy; no Auto-Reveal; `dispatch.send` choke point; orphans report-only; least privilege `294851834304`; no Administrator in code.

Paste-ready continuation prompt still lives at `artifacts/FABLE5_HANDOFF/PASTE_THIS_INTO_FABLE5.txt` (update S27–S36 mentally; the tree now contains them).
