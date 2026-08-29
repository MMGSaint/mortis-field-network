# Changelog

Engineering log for https://github.com/MMGSaint/mortis-field-network. Simulator-proven unless marked live.

## 2026-08-29 — LIVE VERIFIED: 22/22 acceptance on scratch; 3 live defects fixed

First pass with a working bot credential in the environment. Discord REST **and**
the gateway WebSocket are reachable through the agent proxy, so this is genuine
live verification, not simulation. Full detail in
[CLAUDE_AUTONOMOUS_COMPLETION_REPORT.md](CLAUDE_AUTONOMOUS_COMPLETION_REPORT.md).

Live-proven on guild `1540022458126700674`: bot `Mortis Field Network — Dev#7959`,
managed-role permissions exactly `295011699728`, **Administrator false**,
`missingBits []`, gateway READY with heartbeat ACK, 6 slash commands registered
(`post, orient, ticket, lockdown, faq, notifications`), Plan 0 creates / 0 updates,
Apply idempotent, 22/22 acceptance checks PASS, guild left clean with 0 health HOLDs.

- **S89 — live attach decoupled from the Provision UI.** `attachLive()` was reachable
  only from the web route, making the UI a hidden dependency of the engine. New
  `live-session.ts` reads `DISCORD_BOT_TOKEN` from the environment; the CLI gains
  `--live` plus `connect`/`health`/`commands`/`gateway`/`notice`/`verify`. The token is
  never an argv parameter, never written, never logged, never audited; `redactToken()`
  scrubs it from Discord error bodies. The S70 allowlist still gates the attach.
- **S90 — live acceptance harness** (`live-acceptance.ts`), 22 checks, full teardown in a
  `finally` block, lockdown always lifted, never deletes a channel it did not create.
  A simulator run is labelled SIMULATED and can never report itself LIVE.
- **DEFECT 1 fixed (HIGH) — live staff table was empty.** `server.ts` seeded the literal
  placeholders `owner_1`/`ops_1`, which are not snowflakes, so a real staff member over
  the gateway was always `unauthorized` — live ticket claim/close was broken for every
  real human. `seedLiveStaff()` now seeds from the Discord guild `owner_id` (new
  `LiveIdentity.ownerId`) plus an optional `DISCORD_OPERATOR_IDS` allowlist. Discord role
  membership is deliberately not a seed source. Regression S94.
- **DEFECT 2 fixed (MEDIUM) — ticket post guard was bypassable.** `claimTicket`/`closeTicket`
  took `bp` as optional and, when omitted, called `guild.postMessage` directly, skipping
  `isBlueprintPlayerChannel`. The guard now fails closed without a blueprint. Regression S93.
- **DEFECT 3 fixed (MEDIUM) — 429 `retry_after` capped at 8s.** Channel name/topic PATCH is
  2 per 10 minutes; the old cap could never satisfy that bucket, burned quota, then failed.
  `retryAfterMs()` parses the JSON body with a header fallback and fails fast beyond
  `MAX_RETRY_SLEEP_MS`, carrying the real wait. Regression S95.
- **Secret scanner hardened.** S87 only caught tokens preceded by `Bot `; a bare leaked
  credential would slip through. Added a bare-token pattern and **positive controls** so a
  "0 hits" result is only trusted once each pattern is proven to fire.
- **Zero-canon inspector hardened.** Audit found three evasions: a guard word inside a
  *string literal* skipped the whole line; prose extensions (`.md`/`.txt`/`.yaml`/`.csv`)
  were unscanned though canon most often arrives as prose; and `ALLOW_FILES` matched by bare
  basename anywhere in the tree. All three closed, with regression S96 planting a canon
  identifier in each evaded form.
- `saveScratchState` writes a trailing newline so live runs stop dirtying the state file.

Full suite: **T1–T9 + S1–S96 = 105/105 PASS**, plus **A01–A22 = 22/22 LIVE**. typecheck PASS,
build PASS. Production Discord never contacted. No canon introduced. Administrator never added.

## 2026-08-29 — S79–S88: /faq, /notifications, operational tick, chaos, security sweep

Continuation of the same pass. Simulator only; no live scratch attach this pass.

- **S79 — /faq slash command.** Player-facing FAQ ephemeral. Optional `topic` picks a single entry (`start` / `communication` / `conduct` / `tickets` / `accessibility` / `world` / `notifications` / `help`); with no topic it prints the full list. Copy lives in `src/lib/mortis/faq.ts` so REFERENCE and the slash command stay in step. Walkthrough exercises both full and topic paths.
- **S79 also — /notifications slash command.** Toggles a member's per-category preference from Discord itself. Routes through the S73 `setNotificationPreference`, so intake gating and audit behaviour are shared. Player-safe copy on pre-intake / unknown-member.
- **S80 — FAQ text carries no restricted terms or dev vocabulary.**
- **S81 — safe operational tick** (`src/lib/mortis/operations.ts`). One entry point runs due scheduled notices + assesses health + audits *new* HOLDs (debounced by `{code, target}` signature). Cleared HOLDs are forgotten so a recurrence alerts again. Never touches player-facing channels except via `dispatch.send`. Never auto-repairs drift. Never restarts the gateway (S71/S72's job). Never posts NARRATIVE.
- **S82 — tick refuses NARRATIVE at fire time**, catching a template-class flip between enqueue and fire (defense in depth on top of S74).
- **S83 — operations.ts never calls `guild.postMessage` or `discordDeliver` directly**.
- **S84 — gateway fatal close codes** (4004/4010/4011/4012/4013/4014) **stop the loop** and do not schedule reconnects.
- **S85 — scheduler.enqueue does not silently dedupe** repeated requests — operator sees N rows and can cancel.
- **S86 — notification prefs are member-scoped and independent of lockdown** (nothing gates prefs behind lockdown; intake gating still applies).
- **S87 — SECURITY: no bot tokens, webhook URL+token pairs, or private keys in the git-tracked source tree** (scans src/, blueprint/, docs/, workers/).
- **S88 — SECURITY: new modules carry no restricted terms or dev vocabulary**.

Full suite: **T1–T9 + S1–S88 = 97/97 PASS** (`npm run test:engine`, `npm run typecheck`, `npm run build`). Invariants preserved: dispatch is the sole player-facing choke point; NARRATIVE requires ENACTED; zero canon introduced; never Administrator; production Discord never touched; no secrets in git.

## 2026-08-29 — S70–S78: allowlist, gateway hardening, prefs, scheduler (simulator only)

Baseline was `d963914` (T1–T9 + S1–S69). The purported Fable pass-2 bundle (`84a4824`, S70–S74) is not present in this environment — no bundle, no patch, no branch, no local commit — so it was re-implemented from the roadmap rather than "recovered". The new work is SIMULATOR-verified only; no live scratch attach happened this pass (token would have to reach the operator's Provision password field, which cannot be done autonomously).

- **S70 — live-attach guild allowlist.** `src/lib/mortis/allowlist.ts`. `attachLive` refuses any guild id not on the scratch allowlist **before** hydrate or any use of the bot token. Scratch `1540022458126700674` is the only pre-approved id. Runtime additions are per-process only and reversible. Refusal is audited (`discord.connect.refused`).
- **S71 — gateway zombie detection.** `discord-gateway.ts` now tracks heartbeat ACKs and, when the last heartbeat is unacknowledged before the next tick, closes with 4000 and reconnects. `zombieResets` visible on `GatewayStatus`.
- **S72 — OP7 reconnect + duplicate-timer dedup.** OP7 triggers a graceful close-and-RESUME. OP9 honors `resumable`. All reconnect scheduling now flows through one guarded scheduler that suppresses stacked timers when close+op7+op9+error races overlap (`duplicateReconnectSuppressed` counter). Discord fatal close codes (4004/4010–4014) stop the loop instead of respawning.
- **S73 — notification preferences.** `notifications.ts`. Per-member reversible opt-in/opt-out for `notice`, `dispatches`, `tickets_own`. Only settable after intake complete. Every change audited (`notifications.preference.set`, reversible flag).
- **S74 — operational-only scheduler.** `scheduler.ts`. Enqueues `{at, kind, fields}` and runs due rows through `postOperationalNotice` → `dispatch.send`. Refuses any non-operational kind, any narrative-shaped kind, and (defense in depth) any template with `class === "NARRATIVE"` — smuggling a NARRATIVE body through an operational label is refused with reason `narrative template refused`.
- **S75 — scheduler skips cancelled and future rows.**
- **S76 — allowlist runtime additions do not persist across clear; scratch always allowed.**
- **S77 — notification preferences refuse unknown members and pre-intake members.**
- **S78 — scheduler operational-kind allowlist matches `notices.ts` map** (guards drift between the two).

Full suite: **T1–T9 + S1–S78 = 87/87 PASS** (`npm run test:engine`, `npm run typecheck`, `npm run build`). Zero live Discord traffic. Zero canon introduced. Dispatch remains the sole player-facing send choke point. Never Administrator. Never production.

## 2026-08-29 — live continuation: template dedupe + pin.unpinnable

Live scratch still Connected (gateway READY, Administrator false, missingBits []). Apply is a no-op. Tickets (all four categories), dispatch, retract, intake, overwrite sweep, slash `/orient` `/ticket` `/post` `/lockdown` re-verified.

- Historical duplicate HOW TO BEGIN / TERMS / INTAKE / SUPPORT DESK / REFERENCE / WORLD ACCESS posts retracted on scratch. Keepers are the buttoned (or latest) copies. Pin refresh returned `already_unpinned` (403/50013 Missing Permissions) and did not repost.
- `findExistingTemplatePost` matches template title, not only bot-user authorship, so webhook-looking or foreign-author copies do not trigger another dispatch (S69).
- Health `pin.unpinnable` on empty live hydrate when PIN_MESSAGES is not held (S68). No longer silent just because hydrate skipped message history.
- Excess-permission copy no longer tells the operator to re-invite. Excess bits are a warn. Do not add Administrator.

## 2026-08-28 — live scratch integration (token in memory)

Scratch guild `1540022458126700674` Connected. Gateway READY. Administrator false. Guild-held bits include canonical `295011699728` (excess CREATE_INSTANT_INVITE, ATTACH_FILES, SPEAK — warn only).

Live findings and engine fixes:

- **403/50001 overwrite warnings** were Missing Access on initiate+ channels, not PIN_MESSAGES in the member overwrite. Cause: the bot member held only the Discord-managed integration role (`1540061175230763022`). Overwrites targeted presentation `role.bot` (`1540075592135868447`), which the bot did not have. Category member overwrites do not apply to unsynced children. Apply now PUTs presentation `role.bot` onto the bot member (Manage Roles, role below bot). Overwrite sweep then 0 failures.
- **Plan 5 creates / 1 update** was internally correct (HOW TO BEGIN, REFERENCE, WORLD ACCESS webhook, slowmode). Applied. REFERENCE first POST with overwrites 403'd; create-without-overwrites retry then adopt. S62.
- **Sticky pins 403/50013** on every PUT pin. Bot holds neither PIN_MESSAGES (`1<<51`) nor MANAGE_MESSAGES. Channel overwrites cannot grant unheld bits. Buttons and template posts still work unpinned. `refreshPins` / apply no longer duplicate when the template is already in the channel (`already_unpinned`). S63, S66.
- **`/ticket` 400 50035** — Discord forbids a required option after an optional one. Category and body are both required. S45.
- **guild.system_channel PATCH 403 50013** — needs Manage Server, not in the integer. Documented; do not add.
- **HOW TO BEGIN / REFERENCE** landed at the bottom of their categories (late create, no sibling-order plan). Plan now detects sibling order (not absolute Discord position integers). Apply PATCHes order. Live ARRIVAL is NOTICE → HOW TO BEGIN → CONDUCT AND TERMS → ENTRY. NETWORK is NOTICES → REFERENCE → NETWORK STATUS → OPEN CHANNEL → QUESTIONS. S65.
- Health `pin.unpinnable` when a template exists but PIN_MESSAGES is not held (not `pin.missing`). S64. Overwrite sweep skips roles/webhooks (those 404'd as Unknown Channel). S67.
- Bot member overwrite bits are masked to held permissions (no PIN/MANAGE_MESSAGES unless held). S59–S61.
- Tests T1–T9 + S1–S67 PASS (simulator). Live Accept/Intake/tickets/dispatch/lockdown/retract/drift-repair/gateway READY exercised on scratch.

Owner-only Discord config (do not reinvite, do not add Administrator):

- Sticky pins require adding PIN_MESSAGES or MANAGE_MESSAGES to the invite integer, or pinning by a human. Not done this pass.
- Public Bot is on; Developer Portal `install_params` still `7347005485008037`. Independent of this guild's held bits.
- Excess CREATE_INSTANT_INVITE / ATTACH_FILES / SPEAK on the combined @everyone+bot integer.

## 2026-08-27 — live scratch integration (tokenless path)

- Token is still not in this environment (never env/git/Drive/chat). Re-authorizing the bot in Discord does not put the token in process memory. Connect remains the Provision password field.
- Tokenless live probe of Discord public application RPC (`1540058003888410806`):
  - Default `install_params.permissions` is `7347005485008037`, **not** canonical `295011699728`.
  - Missing from that default: Send Messages, Manage Channels, Manage Roles, Read Message History, Manage Webhooks, Use Application Commands, Manage Threads, Send Messages in Threads.
  - Excess includes Manage Server and Ban Members. Administrator is **not** in the default.
  - Public Bot is **on**.
  - Guild re-authorize with `295011699728` is independent of Developer Portal default install. Do not reinvite unless Connect proves guild-held bits are still wrong.
- Discord REST from this environment: `/gateway` 200, `/applications/{id}/rpc` 200, `/users/@me` without token 401 (not an IP block). Widget previously 429 “being blocked”.
- Blueprint hash `4823dcdb…` differs from last live apply `ca21f0cd…`. Plan before Apply after Connect.
- Added `probe-app` / Provision **Probe public application**. Never sends a bot token.
- Live REST 429 with “being blocked” fails closed and surfaces the Discord body instead of spinning 1s retries (S55, S58).
- Tests S54–S58.

## 2026-08-26 — pre-Fable hardening

- Canonical least-privilege invite integer locked at `295011699728` (S41). Health HOLDs on Administrator and on the transcribed-wrong integer (S42).
- Lockdown lift posts all-clear through dispatch (S43). Kill switch is liftable (S44).
- `/ticket` uses Discord category choices (S45).
- Live retract DELETEs even if hydrate cache is empty. Intake grants Initiate before marking complete.
- Pin list accepts Discord `{ items }` envelope. `refreshPins` uses `listPins` (not a raw array parse).
- Transcript HTML actually escapes (S35).
- Webhook rotation deletes the previous channel webhook.
- Ticket control-post failures no longer report clean success. Exhausted 400 retries surface the Discord body (S52).
- Invite-pause 403 no longer claims invites are paused (S47). Arrival close remains the real control.
- Health: missing parent (S46), missing `@everyone` overwrite (S49), empty topic (S50); no pin.missing false-positive on empty hydrate cache (S48).
- Gateway: intents `0`; invalid session (op 9) reconnects; modal openers isolated (S51).
- Tests walkthrough uses an isolated runtime.
- CI: `.github/workflows/engine.yml`.
- Lockdown iterates every ARRIVAL channel so HOW TO BEGIN stays readable and ENTRY hides (S53).
- Dispatch UI splits staff probe from operational notice.
- Fable takeover prompts now point at GitHub and `295011699728`.

## 2026-08-26 — GitHub persistence

- Repository established as canonical source. Baseline `00b9b7f`.
