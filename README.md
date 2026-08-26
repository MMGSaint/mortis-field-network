# MORTIS FIELD NETWORK

Operator workstation and Discord envoy for the Mortis Field Network.

This repository is the **canonical engineering source**. Discord is what players *hear*. VRChat is what they *witness*. The Registry/terminal is what they *verify*. Discord is **not** canon authority.

## What this is

A one-person operator console that can turn a **blank scratch Discord guild** into the approved Field Network:

- idempotent provisioning (roles, categories, channels, overwrites, pins, webhooks)
- gateway interactions (Accept, Begin Intake, tickets, slash commands)
- dispatch choke point for every player-facing outbound message
- intake, tickets, health/drift (report-only), lockdown, audit
- simulator for tests; live REST + gateway after Connect

It stores **no canon**. It does **not** Auto-Reveal narrative. It does **not** require Administrator.

## Architecture (as implemented)

| Area | Location |
|---|---|
| Runtime singleton | `src/lib/mortis/runtime.ts` |
| Discord REST + live attach | `src/lib/mortis/discord-rest.ts` |
| Simulator | `src/lib/mortis/discord-sim.ts` |
| Gateway | `src/lib/mortis/discord-gateway.ts` |
| Provision / plan / apply | `src/lib/mortis/provision.ts` |
| Dispatch choke point | `src/lib/mortis/dispatch.ts` |
| Tickets / intake | `src/lib/mortis/tickets.ts`, `intake.ts` |
| Health | `src/lib/mortis/health.ts` |
| Blueprint | `blueprint/guild.json`, `blueprint/templates.json` |
| Tests T1–T9 + S1–S40 | `src/lib/mortis/test-suite.ts` |
| Operator UI | `src/routes/*` |
| Optional Worker | `workers/mortis-envoy/` |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md).

## Local development

This app is a TanStack Start / Vite workstation. In Grok Build it serves the live preview automatically.

```
npm install
npm run typecheck
npm run test
npm run build
```

Mortis engine only (skip platform PWA tests):

```
npm run test:engine
```

Clone URL: https://github.com/MMGSaint/mortis-field-network

Read [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md) next. Then [docs/OPERATIONS.md](docs/OPERATIONS.md) and [docs/DISCORD_SETUP.md](docs/DISCORD_SETUP.md).

## Simulator vs live Discord

- Default transport: `SimulatedGuild`.
- Live: Provision → paste token (password field, memory only) → scratch checkbox → Connect → wait gateway READY → Validate → Plan → Apply.
- Leave Discord **Interactions Endpoint URL blank** while using the workstation gateway.
- Scratch guild (public id): `1540022458126700674`
- Application id (public): `1540058003888410806`
- Least-privilege permission integer: `295011699728`

**Production Mortis Discord must not be Connected or Applied from this console.**

## Security model (short)

- `dispatch.send` is the only player-facing send path. Failures **block**, they never redact.
- NARRATIVE events stop at `ELIGIBLE — AWAITING ENACTMENT`.
- Envoy stores members, tickets, audit, blueprint bindings — **not** dossiers or lore.
- Bot token is never written to disk. See [docs/SECURITY.md](docs/SECURITY.md).

## Phase 3

Operations Room is **deferred**. Do not open it without an explicit owner go.
