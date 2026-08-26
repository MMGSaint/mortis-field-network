# AGENT HANDOFF

Clone this repo. Read this file. Run the engine tests. Continue. You do not need the original Grok conversation or ZIP packs.

Repository: https://github.com/MMGSaint/mortis-field-network  
Branch: `main`

## Current state (2026-08-26)

Phase 1 Field Network engine + Phase 2 player-safe UX are implemented in this tree. GitHub is the **canonical engineering source**. This sandbox is a working copy.

- Transport default: simulator. Live REST (`DiscordRestGuild`) + gateway exist; attach only after operator Connect.
- Scratch guild `1540022458126700674` was applied 2026-08-20. Bindings in `data/scratch-guild-state.json` (snowflakes only; no tokens).
- Last recorded engine tests: T1–T9 + S1–S46 PASS (simulator).
- Latest completion report: `docs/MORTIS_AUTONOMOUS_COMPLETION_REPORT.md`.
- Production Discord: **untouched**.
- Phase 3 Operations Room: **not opened**.

**Permission integer correction:** the published invite integer `294851834304` did **not** encode the published least-privilege set (it omitted VIEW_CHANNEL, SEND_MESSAGES, MANAGE_CHANNELS, MANAGE_ROLES, CONNECT). Canonical integer is now `295011699728`, locked by S41. If the scratch bot was invited with the old URL or still holds Administrator, **re-invite**. Do not keep Admin.

## Commands

```
npm install
npm run typecheck
npm run test:engine
npm run build
```

`npm test` also runs App Builder PWA injector tests. Those may fail because `src/lib/og/site.json` title is `MORTIS FIELD NETWORK` (correct product identity). Do not weaken engine tests to make PWA tests pass.

CI: `.github/workflows/engine.yml` runs typecheck + `test:engine` on push to `main`.

## How to resume autonomous execution

1. `git clone https://github.com/MMGSaint/mortis-field-network.git`
2. Recon: `src/lib/mortis/`, `blueprint/`, `tests/phase1/`, `docs/`.
3. Do not rebuild. Do not invent canon.
4. Loop: implement → test → hotfix → regression → commit → push.
5. Live Discord only after Connect with scratch confirmation. Token on Provision, never in git or chat.
6. Stop only at owner/security/production/canon boundaries.

## Invariants (never reopen)

1. Discord is not canon authority.
2. Envoy is canon-free (no facts, dossiers, reveal schedules).
3. No Auto-Reveal. NARRATIVE requires ENACTED.
4. Player-facing outbound goes through `dispatch.send`. Block, never redact.
5. Never require Administrator. Least privilege `295011699728`.
6. Orphans are report-only. History is never auto-deleted.
7. Do not couple envoy to `mortis-relay`.
8. Leave Interactions Endpoint URL blank until a real envoy Worker is deployed.

## Scratch Discord (safe to publish)

| Item | Value |
|---|---|
| Guild id | `1540022458126700674` |
| Application id | `1540058003888410806` |
| Least-privilege integer | `295011699728` |

Token: **not in this repo**. Rotate if it was ever pasted in chat.

## Owner decisions still required

- **Re-invite** the scratch bot with `295011699728` if it was invited with `294851834304` or currently holds Administrator.
- Connect + Plan review + Apply after blueprint deltas (HOW TO BEGIN / REFERENCE channel order; lockdown-lift / restored templates; WORLD ACCESS pin).
- Re-test Accept / Begin Intake / Open ticket after gateway READY.
- Community Safety Setup (API-gated) remains manual.
- Production Apply: never from this console.
- Phase 3 / Phase 4 / narrative engine: explicit go only.

## Known limitations

- Live Connect cannot happen without the operator pasting the token.
- Ticket create on live Discord was historically 400/403; code retries overwrite + minimal payload. Re-test on next Connect. Likely root cause was the wrong invite integer / Admin workaround.
- Operator sometimes left Admin on live bot. Code must still work without it. Health HOLDs on Administrator (S42).
- Worker `mortis-envoy` is a schema/stub, not deployed.
- Webhook URLs are process-memory; reconnect re-lists Discord webhooks. Rotate, then expect hydrate to pick an application-owned hook.

## This pass (after GitHub persistence)

- Locked invite integer `295011699728` (S41) and health HOLD on Admin / missing bits (S42).
- Live apply now audits **held** bot permissions, not the required integer against itself.
- Lockdown lift posts all-clear through dispatch (S43). `restored` notice kind exists.
- Kill switch can be lifted without process restart (S44).
- `/ticket` category uses Discord choices (S45).
- Walkthrough on Tests uses an isolated runtime (does not Apply the operator guild).
- Retract on live Discord DELETEs even if hydrate cache has no messages; 404 fail-closed.
- Intake grants Initiate **before** marking complete; already-complete retries the grant.
- Pin list accepts Discord `{ items: [...] }` envelope. Channel overwrite includes `PIN_MESSAGES` (not the invite integer).
- Transcript HTML actually escapes (S35). Health reports missing parent as placement drift (S46).
- Webhook rotation deletes the previous channel webhook after binding the new URL.
- Ticket channel-control post failures no longer report a clean success; the opener sees `ticket opened; controls failed` plus the Discord body.
- Operator UX: Plan-before-Apply, scratch ids prefilled, gateway/Admin next-action, mobile nav labels.

## Deferred player-experience

Anything that needs canon wording, Season 3 branding, streamer roles, restricted ranks, or Auto-Reveal. Functional FAQ and WORLD ACCESS pins already ship with **neutral** copy.

## File map

Start: `src/lib/mortis/runtime.ts` via `src/lib/mortis/server.ts` (`globalThis.__mortisRuntime`).

Player templates: `blueprint/templates.json`. Structure: `blueprint/guild.json`.
