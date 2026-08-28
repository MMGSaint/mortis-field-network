# AGENT HANDOFF

Clone this repo. Read this file. Run the engine tests. Continue. You do not need the original Grok conversation or ZIP packs.

Repository: https://github.com/MMGSaint/mortis-field-network  
Branch: `main`

Also read [FABLE.md](FABLE.md), [CHANGELOG.md](CHANGELOG.md), [OPERATIONS.md](OPERATIONS.md), [SECURITY.md](SECURITY.md).

## Current state (2026-08-27, live integration)

Phase 1 Field Network engine + Phase 2 player-safe UX are implemented. GitHub is the **canonical engineering source**.

- Transport default: simulator. Live REST + gateway exist; attach only after operator Connect (token in Provision password field → WeakMap).
- Scratch guild `1540022458126700674`. Bindings in `data/scratch-guild-state.json` (snowflakes only).
- Engine tests: T1–T9 + S1–S58 PASS (simulator).
- Tokenless live probe of the public application RPC is implemented (`probe-app` / Provision).
- Production Discord: **untouched**.
- Phase 3 Operations Room: **not opened**.

**Permission integer:** canonical `295011699728`, locked by S41. Published `294851834304` was a transcription error. Developer Portal default install was live-observed as `7347005485008037` (S54) — that is **not** the guild re-authorize integer. Health HOLDs on Admin (S42).

**Live Connect blocker:** bot token is not in this process. Re-authorizing the bot in Discord does not transmit the token. Do not paste it in chat.

Phase 1 Field Network engine + Phase 2 player-safe UX are implemented. GitHub is the **canonical engineering source**.

- Transport default: simulator. Live REST + gateway exist; attach only after operator Connect.
- Scratch guild `1540022458126700674`. Bindings in `data/scratch-guild-state.json` (snowflakes only).
- Engine tests: T1–T9 + S1–S53 PASS (simulator).
- Production Discord: **untouched**.
- Phase 3 Operations Room: **not opened**.

**Permission integer:** canonical `295011699728`, locked by S41. Published `294851834304` was a transcription error. Re-invite if the scratch bot still uses it or holds Administrator. Health HOLDs on Admin (S42).

## What exists / what is proven / what is simulated / what is live-unverified

| Surface | Status |
|---|---|
| Provision, dispatch, tickets, intake, health, lockdown, retract, webhooks, pins | Implemented. Simulator-proven. |
| Gateway ACK / type-9 modal routing / op-9 reconnect | Implemented. Simulator-proven (S33, S51). Live READY unverified. |
| Player FAQ / HOW TO BEGIN / WORLD ACCESS / /orient / /ticket choices | Shipped, neutral copy. |
| Live scratch Apply / Accept / Intake / Open ticket | Previously applied 2026-08-20. **Not re-verified this process — token not in memory.** Public app RPC probed 2026-08-27. |
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
3. If live Discord is still disconnected, continue only work that does not need the token.
4. Remaining engineering that still needs a token: Connect scratch → Validate → Plan → review WORLD ACCESS / channel order / new templates → Apply if intended → retest Accept / Begin Intake / Open ticket after gateway READY.
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
