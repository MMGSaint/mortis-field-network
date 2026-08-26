> **ERRATA (2026-08-26):** Canonical repo is https://github.com/MMGSaint/mortis-field-network. Least-privilege integer is `295011699728`, not `294851834304` (transcription error). Leave Interactions Endpoint URL blank while using the workstation gateway.

# SESSION STATUS — packed 2026-08-25

Handoff agent: Grok Build in App Builder `/workspace`. No git history. Last mortis source writes 2026-08-20 23:14–23:19 UTC plus docs/player-experience plan 2026-08-25.

## Tree

`/workspace` is the live tree. This zip's `SOURCE/` is a snapshot of it (minus `node_modules`, minus tokens, minus nested previous zips).

Modules that were **missing from an earlier 2026-08-25 pack** and are included now:

- `src/lib/mortis/commands.ts`
- `src/lib/mortis/health.ts`
- `src/lib/mortis/notices.ts`
- `src/lib/mortis/walkthrough.ts`
- `docs/FIELD_NETWORK_PLAYER_EXPERIENCE_PLAN_2026-08-25.md`

`src/lib/mortis/index.ts` re-exports those four modules. A pack without them will typecheck-fail.

## Transports

| Mode | When |
|---|---|
| `SimulatedGuild` | Default. Tests. Fresh process after restart. |
| `DiscordRestGuild` | After `attachLive` on Provision. Token in WeakMap only. |

`data/scratch-guild-state.json` proves a live Apply already ran on scratch guild `1540022458126700674` (51 bindings, hash `ca21f0cdbbde846ea2f556c44101a0bc269886abb24c626a43117bdbca10452f`). Reconnect loads bindings. That is not a reason to Apply again.

## Tests last recorded

`npm test` / `node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/phase1/mandatory.test.ts`

T1–T9 PASS · S1–S7 PASS · S8 channel PATCH 403 non-fatal PASS

Re-run on takeover. Do not trust this table if the files drifted.

## Live scratch (operator-confirmed 2026-08-20)

Community on. Structure applied. ARRIVAL buttons appeared after pin refresh + gateway READY. Intake completed. Web tickets worked. Discord Open ticket was the remaining flake (POST `/guilds/{id}/channels` 400 then 403). Operator sometimes left Admin on because of 403s. Code must still work without Admin.

Orphans (report-only, `#general` has history — never auto-delete):

| kind | snowflake | name |
|---|---|---|
| category | 1540022459032674405 | Text Channels |
| category | 1540022459032674406 | Voice Channels |
| channel | 1540022459032674407 | general (history) |
| channel | 1540022459032674408 | General (voice) |
| role | 1540061175230763022 | Mortis Field Network — Dev |

## Binding next step

Connect → Validate → Plan. **Do not Apply** until Plan is reviewed. Production guild untouched.

## Documented deviation

Handoff wanted HTTP Interactions only. Implementation uses a gateway (no privileged intents) because App Builder URLs are not a stable Discord Interactions endpoint. Leave Interactions Endpoint URL blank. `docs/DISCORD_SETUP.md` §1 still says “Phase 1 is gateway-less” and §6 still tells the owner to set an Interactions URL on envoy — treat those lines as stale.

## Preview contract (App Builder only)

`/workspace/startup.sh` starts `npm run dev` on `0.0.0.0:8080` if it is down. Do not kill the preview. Do not bind another port.
