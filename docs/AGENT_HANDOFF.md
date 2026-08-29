# AGENT HANDOFF

Clone this repo. Read this file. Run the engine tests. Continue. You do not need the original Grok conversation or ZIP packs.

Repository: https://github.com/MMGSaint/mortis-field-network  
Branch: `main`

Also read [FABLE.md](FABLE.md), [CHANGELOG.md](CHANGELOG.md), [OPERATIONS.md](OPERATIONS.md), [SECURITY.md](SECURITY.md).

## Current state (2026-08-29, live scratch verified)

Phase 1 Field Network engine + Phase 2 player-safe UX are implemented. GitHub is the **canonical engineering source**.

- Transport default: simulator. Live REST + gateway exist; attach only after operator Connect (token in Provision password field → WeakMap).
- Scratch guild `1540022458126700674` **live-applied**. Bindings in `data/scratch-guild-state.json` (snowflakes only). lastAppliedHash `4823dcdb…`.
- Engine tests: T1–T9 + S1–S69 PASS (simulator).
- Live this process: Connect, Validate, Plan (0 creates / 0 updates), Apply no-op, Accept/Intake/Initiate, HOW TO BEGIN / REFERENCE / WORLD ACCESS, tickets (general/report/appeal/accessibility), dispatch+retract, notices, lockdown+lift, overwrite sweep 0 failures, gateway READY, slash commands registered, duplicate templates cleaned, pin refresh `already_unpinned` (403/50013).
- Production Discord: **untouched**.
- Phase 3 Operations Room: **not opened**.

**Permission integer:** canonical `295011699728`, locked by S41. Published `294851834304` was a transcription error. Developer Portal default install was live-observed as `7347005485008037` (S54) — that is **not** the guild re-authorize integer. Health HOLDs on Admin (S42). Guild-held: Administrator false, missingBits [].

**Live Discord constraints (do not "fix" with Administrator):**

1. Presentation `role.bot` is not the Discord-managed integration role. Apply grants `role.bot` to the bot member.
2. Sticky pins need PIN_MESSAGES or MANAGE_MESSAGES at guild level. Not in the integer. Templates stay in-channel unpinned. Do not duplicate.
3. `PATCH guild.system_channel` needs Manage Server. Not in the integer.
4. Channel overwrites cannot ALLOW bits the bot does not hold.
5. Invite-pause API needs Manage Server. Lockdown still closes arrival.

## What exists / what is proven / what is simulated / what is live-unverified

| Surface | Status |
|---|---|
| Provision, dispatch, tickets, intake, health, lockdown, retract, webhooks | Implemented. Simulator-proven. **Live-verified 2026-08-28 on scratch.** |
| Pins | Messages posted. Sticky pin 403/50013 without PIN_MESSAGES. Deduped. Health `pin.unpinnable` on empty hydrate (S68). Duplicate scratch copies cleaned 2026-08-29. |
| Gateway ACK / type-9 modal routing / op-9 reconnect | Implemented. Simulator-proven (S33, S51). **Live READY 2026-08-28.** |
| Player FAQ / HOW TO BEGIN / WORLD ACCESS / /orient / /ticket | Shipped, neutral copy. Live sibling order repaired. |
| Live scratch Apply / Accept / Intake / Open ticket | **Verified 2026-08-28.** |
| Envoy Worker HTTP Interactions | Stub only. Leave Interactions URL blank. |

## Commands

```
npm install
npm run typecheck
npm run test:engine
npm run build
```

CI: `.github/workflows/engine.yml`. Do not weaken engine tests to make PWA platform tests pass.

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

## What the next autonomous agent should do

1. Clone GitHub. Run `npm run test:engine`.
2. Do not rebuild. Do not invent canon. Do not open Phase 3. Do not Apply production.
3. If live Discord is disconnected, continue only work that does not need the token. Connect is Provision password field → WeakMap.
4. Remaining owner-only Discord config: PIN_MESSAGES if sticky pins are required; Public Bot off; Developer Portal install_params; Community Safety Setup. Do not add Administrator. Do not reinvite unless Connect proves missing required bits.
5. If you find a defect, reproduce in the simulator first, add a test, then fix.

## Owner-only (cannot be done by an agent)

- Paste bot token on Provision (never in chat/git).
- Re-invite with `295011699728` if Admin or the old integer is still on the bot.
- Confirm scratch checkbox. Read Plan before Apply.
- Community Safety Setup (API-gated).
- Production Apply: never from this console.
- Phase 3 / Phase 4 / narrative engine: explicit go only.

## File map

Start: `src/lib/mortis/runtime.ts` via `src/lib/mortis/server.ts` (`globalThis.__mortisRuntime`).

Player templates: `blueprint/templates.json`. Structure: `blueprint/guild.json`.

Loopback operator (`src/lib/mortis/local-operator.ts`, `/api/local-op`) is Host 127.0.0.1 only. It never returns the token. Not a public API.
