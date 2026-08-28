# Changelog

Engineering log for https://github.com/MMGSaint/mortis-field-network. Simulator-proven unless marked live.

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
