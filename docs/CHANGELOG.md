# Changelog

Engineering log for https://github.com/MMGSaint/mortis-field-network. Simulator-proven unless marked live.

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
