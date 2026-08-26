# DEPLOYMENT

This workstation is the operator console. It is not production Mortis.

## Environments

| Environment | What it is |
|---|---|
| Live preview / this app | Simulator by default. Live REST+gateway only after Connect. |
| Scratch Discord | Guild `1540022458126700674`. The only guild this process may Apply. |
| Envoy Worker | Optional HTTP Interactions. Leave Discord Interactions URL blank until a real Worker is deployed. |
| Production Discord | Untouched. Never Connect here. |

## Environment variables (server only — never `VITE_`)

| Name | Required | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | live only | Entered on Provision; not stored in files |
| `DISCORD_APP_ID` | live only | Application id |
| `DISCORD_PUBLIC_KEY` | optional HTTP | 64 hex chars; gateway path does not need it |
| `CLI_SECRET` | kill switch | Process memory |
| `DATABASE_URL` | deploy | Neon; preview uses PGLite |
| `RELEASE_PUBLIC_KEY` | application updates | Verifies signed excerpts |

Do not create a `.env` in this sandbox. Tokens never go in git, Drive, or chat.

## Health

`POST` health from Provision. Report-only. Missing objects, topic/placement/overwrite drift, orphans, lockdown, gateway.

## Rollback

- Notice: Retract (audited).
- Blueprint: Plan then Apply is idempotent. It will not delete history.
- Kill switch: stops interactions without tearing down Discord structure.
- Worker: revert wrangler deploy; Discord Interactions URL stays blank if you are not ready.

## Build gates

```
npm run typecheck
npm run test
npm run build
```

PWA injector tests may fail on custom `MORTIS FIELD NETWORK` title. That is product identity, not an engine failure.

## Phase 3

Operations Room is documented and deferred. Do not open it without an explicit owner go.
