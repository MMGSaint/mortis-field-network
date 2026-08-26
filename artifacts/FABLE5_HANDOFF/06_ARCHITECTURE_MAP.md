> **Canonical source:** https://github.com/MMGSaint/mortis-field-network — least-privilege integer `295011699728`. The previously published `294851834304` was a transcription error.

# ARCHITECTURE MAP

Trust the files if this map drifts. Update this file when you change a path.

## Runtime singleton

`src/lib/mortis/server.ts` — `globalThis.__mortisRuntime`

```
MortisRuntime.load(cwd)
  → bootstrapKeys()          Ed25519 verify-only pairs in memory
  → seedOwner / seedOperations
attachLive({ token, guildId, appId, publicKey, confirmScratch })
  → DiscordRestGuild.hydrate()
  → loadScratchState(guildId) → store.bind
  → startInteractionGateway (intents 0)
  → ensureLiveChannelAccess()
```

Token: `WeakMap<MortisRuntime, string>` in `runtime.ts`. Gone on GC / process restart.

## File → job

| File | Job |
|---|---|
| `runtime.ts` | attachLive, snapshot, plan/apply wrappers, reconnectGateway, overwrite sweep |
| `server.ts` | createServerFn surface (connect, plan, apply, pins, tickets, tests) |
| `discord-rest.ts` | live REST, persist `data/scratch-guild-state.json`, `ensureBotChannelAccess` |
| `discord-gateway.ts` | WS identify, HEARTBEAT, INTERACTION_CREATE ACK/defer/follow-up |
| `discord-sim.ts` | in-memory guild for T1–T9 |
| `dispatch.ts` | 8-step choke + `discordDeliver` + `mirrorAudit` + button component helpers |
| `envoy.ts` | HTTP `/interactions` Ed25519-before-parse + `handleVerifiedInteraction` |
| `tickets.ts` | create/claim/close/reopen + 400/403 retry |
| `intake.ts` | terms + complete + Initiate bind |
| `provision.ts` | validate/plan/apply/adopt/refreshPins; 400/403 non-fatal |
| `permissions.ts` | PERM bits, 295011699728, overwrite generators |
| `blueprint.ts` | load `blueprint/guild.json` + templates + hash |
| `store.ts` | members, staff, tickets, audit, blueprintState, lockdown |
| `terms.ts` | restricted + developer lists, block-not-redact |
| `events.ts` | NARRATIVE state machine; enact required before dispatch |
| `notices.ts` | operational notice kinds through dispatch |
| `commands.ts` | slash command registration |
| `health.ts` | workstation health holds/warns |
| `walkthrough.ts` | first-player sim walkthrough |
| `zero-canon.ts` | inspector: envoy tree must not store canon |
| `crypto.ts` | Ed25519 verify, digest compare |
| `test-suite.ts` | T1–T9 + S1–S8 |
| `interaction-http.server.ts` | optional HTTP interactions route helper |
| `src/routes/api/interactions.ts` | mounts HTTP interactions (optional; gateway preferred) |
| `src/routes/provision.tsx` | operator UI |
| `workers/mortis-envoy/` | deployable Worker (not required for scratch REST+gateway) |
| `tools/mortis-provision/cli.mjs` | validate/plan/apply/adopt CLI |

## custom_id

| id | kind | handler |
|---|---|---|
| `terms_accept` | button | `acceptTerms` |
| `intake_start` | button → type 9 modal `intake_modal` | field `callsign` |
| `intake_modal` | modal submit | `completeIntake` |
| `ticket_create` | button → type 9 modal `ticket_modal` | fields `category`, `body` |
| `ticket_modal` | modal submit | `createTicket` |
| `ticket_claim:{id}` | button | `claimTicket` |
| `ticket_close:{id}` | button | `closeTicket` |
| `ticket_reopen:{id}` | button | `reopenTicket` |

## Blueprint identity (keys, not Discord names)

Roles: `role.owner` `role.operations` `role.moderator` `role.dm` `role.developer` `role.tester` `role.bot` `role.initiate` `role.shadow`

Categories: `arrival` `network` `operations` `records` `rp` `community` `support` `staff`

Pinned interaction channels:

- `arrival.terms` → #conduct-and-terms → `terms_accept`
- `arrival.intake` → #entry → `intake_start`
- `support.desk` → #support-desk → `ticket_create`

Ticket parent category key: `support`.

## Data on disk

`data/scratch-guild-state.json` = `{ guildId, bindings[], lastAppliedHash }`  
No token. Safe to pack. Reconnect hydrates bindings; operator still pastes token.

## Auth on the workstation

Google / X via Better Auth (`src/lib/auth`). Provision server fns use `authMiddleware`. Sign in on the preview before Connect. This is **not** Discord OAuth and **not** the envoy staff table.
