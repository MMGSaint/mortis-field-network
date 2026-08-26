# ARCHITECTURE (as implemented)

This describes the code in this repository, not a future design.

## Surfaces

- **Workstation UI** — TanStack Start app (`src/routes`). Sign-in required for operator actions.
- **MortisRuntime** — process singleton. Owns blueprint, store, guild transport, gateway handle, kill flag (liftable).
- **SimulatedGuild** — default transport for tests and preview without a token.
- **DiscordRestGuild** — live REST; created on Connect. Token lives in a WeakMap, not on disk.
- **Gateway** — Discord Gateway v10 for `INTERACTION_CREATE`. Intents `0`. ACK within 3s (type 4 or deferred type 5). Type 9 for modals. Invalid session (op 9) reconnects.

## Provisioning

`validate` → `plan` → `apply`.

Identity is **blueprint key**, not channel name. Apply is idempotent (hash + bindings). Orphans are listed, never deleted. Channels with history may be archive-locked only with per-item confirm.

## Dispatch

`dispatchSend` in `src/lib/mortis/dispatch.ts` is the choke point:

1. Authorization  
2. Visibility (NARRATIVE requires `events.state = ENACTED`)  
3. Release signature if `requires_release`  
4. Restricted-term scan  
5. Developer-term scan  
6. Destination  
7. Deliver (`discordDeliver`; webhook fallback on 403; Discord body surfaces on failure)  
8. Audit (+ staff.audit / staff.inbox mirrors)

Staff destinations skip steps 2–6. Failures **block**. They never redact.

## Tickets

Categories: `general | report | appeal | accessibility`. Invalid categories are rejected with that list.

Lifecycle: open → claimed → closed. Reopen is staff-only and counts against the opener cap of 2. Restricted terms in opener text are held for staff. Transcripts: `txt` + escaped `html` in the in-memory/R2 store.

## Health

`assessHealth` is report-only: missing objects, topic/placement/overwrite drift, onboarding, ticket parent, unexpected objects, lockdown, gateway. Never deletes.

## Envoy Worker

`workers/mortis-envoy` is a separate Worker with its own D1/R2. It must not share storage with `mortis-relay`. Not deployed. HTTP Interactions remain optional; gateway is the live path.

## Data

Operator auth uses Better Auth + PGLite in preview (Neon when `DATABASE_URL` is set). Envoy operational state is `EnvoyStore` (in-process). Scratch bindings persist in `data/scratch-guild-state.json` (snowflakes only).
