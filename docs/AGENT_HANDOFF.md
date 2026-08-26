# AGENT HANDOFF

Clone this repo. Read this file. Run the engine tests. Continue. You do not need the original Grok conversation or ZIP packs.

Repository: https://github.com/MMGSaint/mortis-field-network  
Branch: `main`

## Current state (2026-08-26)

Phase 1 Field Network engine + Phase 2 player-safe UX are implemented in this tree.

- Transport default: simulator. Live REST (`DiscordRestGuild`) + gateway exist; attach only after operator Connect.
- Scratch guild `1540022458126700674` was applied 2026-08-20. Bindings in `data/scratch-guild-state.json` (snowflakes only; no tokens).
- Last recorded engine tests: T1–T9 + S1–S40 PASS (simulator).
- Production Discord: **untouched**.
- Phase 3 Operations Room: **not opened**.

## Commands

```
npm install
npm run typecheck
node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/phase1/mandatory.test.ts
npm run build
```

`npm test` also runs App Builder PWA injector tests. Those may fail because `src/lib/og/site.json` title is `MORTIS FIELD NETWORK` (correct product identity). Do not weaken engine tests to make PWA tests pass.

## How to resume autonomous execution

1. Recon: `src/lib/mortis/`, `blueprint/`, `tests/phase1/`, `docs/`.
2. Do not rebuild. Do not invent canon.
3. Loop: implement → test → hotfix → regression → commit → push.
4. Live Discord only after Connect with scratch confirmation. Token on Provision, never in git or chat.
5. Stop only at owner/security/production/canon boundaries.

## Invariants (never reopen)

1. Discord is not canon authority.
2. Envoy is canon-free (no facts, dossiers, reveal schedules).
3. No Auto-Reveal. NARRATIVE requires ENACTED.
4. Player-facing outbound goes through `dispatch.send`. Block, never redact.
5. Never require Administrator. Least privilege `294851834304`.
6. Orphans are report-only. History is never auto-deleted.
7. Do not couple envoy to `mortis-relay`.
8. Leave Interactions Endpoint URL blank until a real envoy Worker is deployed.

## Scratch Discord (safe to publish)

| Item | Value |
|---|---|
| Guild id | `1540022458126700674` |
| Application id | `1540058003888410806` |
| Least-privilege integer | `294851834304` |

Token: **not in this repo**. Rotate if it was ever pasted in chat.

## Owner decisions still required

- Connect + Plan review + Apply after blueprint changes (WORLD ACCESS pin/readonly/webhook; intake notice template).
- Re-test Accept / Begin Intake / Open ticket after gateway READY.
- Community Safety Setup (API-gated) remains manual.
- Production Apply: never from this console.
- Phase 3 / Phase 4 / narrative engine: explicit go only.

## Known limitations

- Live Connect cannot happen without the operator pasting the token.
- Ticket create on live Discord was historically 400/403; code retries overwrite + minimal payload. Re-test on next Connect.
- Operator sometimes left Admin on live bot. Code must still work without it.
- Worker `mortis-envoy` is a schema/stub, not deployed.

## Deferred player-experience

Anything that needs canon wording, Season 3 branding, streamer roles, restricted ranks, or Auto-Reveal. Functional FAQ and WORLD ACCESS pins already ship with **neutral** copy.

## File map

Start: `src/lib/mortis/runtime.ts` via `src/lib/mortis/server.ts` (`globalThis.__mortisRuntime`).

Player templates: `blueprint/templates.json`. Structure: `blueprint/guild.json`.
