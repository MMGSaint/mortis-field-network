# MORTIS AUTONOMOUS COMPLETION REPORT

**Date:** 2026-08-26  
**Repository:** https://github.com/MMGSaint/mortis-field-network  
**Branch:** `main`  
**Latest commit:** `8d14b9f` (`fix: rotate webhooks by replacing the previous hook; fail ticket control posts`)

GitHub is the canonical engineering source. This sandbox is a working copy.

---

## Current project state

Phase 1 Field Network engine + Phase 2 player-safe UX are implemented, tested in the **simulator**, and persisted.

| Item | Status |
|---|---|
| Transport | Simulator default. Live REST + gateway exist; attach only after Connect. |
| Scratch guild | `1540022458126700674` applied 2026-08-20. Bindings in `data/scratch-guild-state.json` (snowflakes only). |
| Engine tests | T1–T9 + S1–S46 PASS (simulator) |
| Production Discord | Untouched |
| Phase 3 Operations Room | Not opened |
| Envoy Worker | Schema/stub only. Not deployed. |

## Work completed this run

1. **Persisted the full tree** to https://github.com/MMGSaint/mortis-field-network (was README-only, 22 bytes). Force-with-lease over the placeholder. 141 files in baseline `00b9b7f`.
2. **Clone-verified:** clone → `npm install` → typecheck → engine tests → production build. No Discord tokens or webhook URL+token pairs in git.
3. **Corrected the least-privilege invite integer** (see bugs).
4. Live-path hardening: retract, intake grant-before-complete, pin list envelope, PIN_MESSAGES overwrite, HTML escape, webhook rotate-and-delete, ticket control-post failures.
5. Operator UX: Plan-before-Apply, scratch ids prefilled, gateway/Admin next-action, liftable kill switch, isolated walkthrough, mobile nav labels.
6. Player-safe copy: `/orient` + `/ticket` on HOW TO BEGIN / REFERENCE; accessibility FAQ line; lockdown all-clear + restored notices; HOW TO BEGIN / REFERENCE channel order.
7. CI: `.github/workflows/engine.yml` (typecheck + `npm run test:engine`). Package name `mortis-field-network`. Script `test:engine`.

## Bugs discovered

1. Published invite integer `294851834304` did **not** encode the published bit set. It omitted VIEW_CHANNEL, SEND_MESSAGES, MANAGE_CHANNELS, MANAGE_ROLES, CONNECT, and included unrelated bits (TTS, VAD, Deafen, …). This is the most likely root of historical live 403s and the Admin workaround.
2. `apply()` audited `permissionExcess(botPermissionInteger())` — a self-compare that could never warn.
3. Tests → First-player walkthrough Applied the **operator** runtime.
4. Kill switch could not be lifted without process restart (docs disagreed with UI).
5. Lockdown lift posted no all-clear; players were told to wait forever.
6. Live retract fail-closed on an empty hydrate message cache (every real Discord retract = `message not found`).
7. Intake marked complete **before** Discord role grant; retry took the already-complete path and never granted Initiate.
8. `GET /channels/{id}/pins` assumed an array; current Discord returns `{ items: [...] }`. Refresh would throw and duplicate pins.
9. Transcript `escapeHtml` was a no-op (`&` → `&`).
10. Health ignored `parent_id === null` placement drift.
11. Ticket control-post failures audited `ok` and told the opener the ticket opened cleanly.
12. Webhook rotation left the old hook in Discord; hydrate could bind it again.

## Bugs fixed

All of the above, with tests S41–S46 covering integer lock, Admin HOLD, lockdown all-clear, kill lift, `/ticket` choices, and missing-parent drift. S35 now asserts real HTML escaping.

Canonical invite integer: **`295011699728`**. Never Administrator. Channel overwrites (including `PIN_MESSAGES`) cover pin access without widening the invite integer.

## Tests

```
npm run typecheck     PASS
npm run test:engine   PASS (T1–T9 + S1–S46)
```

Clone-test of `00b9b7f` also: typecheck PASS, engine tests PASS, `npm run build` PASS.

`npm test` still includes App Builder PWA injector tests that fail on product title `MORTIS FIELD NETWORK`. Do not weaken engine tests to make those pass.

## Live Discord verification

**UNVERIFIED this process.** No bot token in memory. Connect was not performed.

Prior owner session (2026-08-20) applied scratch structure. Buttons/intake/web tickets worked when gateway READY. Discord Open ticket was flaky (400/403) — re-test after **re-invite with `295011699728`** (no Admin).

## Security status

- Secret scan of git-tracked tree: no bot tokens, no webhook URL+token pairs, no private keys.
- Token path remains Provision password field → WeakMap only.
- App Builder preview OAuth client constant remains in `src/lib/auth/preview.ts` (platform shared preview client, not a Discord secret).
- Dispatch remains the only player-facing send path. Block, never redact.
- Staff authorization is the envoy staff table, not Discord role names.

## Zero-canon verification

Envoy stores members, tickets, audit, bindings — not dossiers or lore. NARRATIVE still requires ENACTED. New player copy (`/orient`, `/ticket`, lockdown all-clear) is operational, not invented canon. No Season 3, no streamer roles, no restricted ranks.

## Production safety

Production Mortis Discord was not connected, not planned, not applied. `mortis-relay` was not called. Phase 3 was not opened.

## Remaining blockers (owner-only)

1. **Re-invite** the scratch bot with integer `295011699728` if it was invited with `294851834304` or currently holds Administrator.
2. Paste token on Provision (never in chat) → scratch checkbox → Connect → wait gateway READY.
3. Validate → Plan. Review WORLD ACCESS / HOW TO BEGIN / REFERENCE order / new templates. Apply only if intended. Orphans stay report-only.
4. Re-test Accept, Begin Intake, Open ticket (`general|report|appeal|accessibility`).
5. Rotate the bot token if it was ever pasted in chat.
6. Leave Interactions Endpoint URL blank until a real envoy Worker is deployed.
7. Production Apply: never from this console.
8. Phase 3 / Phase 4 / narrative engine: explicit go only.

## Next recommended action

Owner: re-invite scratch bot without Administrator using the integer shown on Provision, then Connect and read the Plan. Do not Apply until the Plan’s creates/updates look right.

A future agent: `git clone https://github.com/MMGSaint/mortis-field-network.git` → read `docs/AGENT_HANDOFF.md` → `npm run test:engine` → continue. Do not rebuild from ZIP packs or this sandbox.
