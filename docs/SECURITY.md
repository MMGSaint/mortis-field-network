# SECURITY

## Secrets

| Secret | Where it lives |
|---|---|
| Discord bot token | Provision password field → WeakMap in process memory. Never files, git, chat, or `[vars]`. |
| Discord public key | Optional; 64 hex. Gateway path does not need it. |
| CLI_SECRET | Kill switch bearer. Process env / wrangler secret. |
| Release signing keys | Generated in-process for tests; live Registry keys are not in this repo. |

`.env` is gitignored. Use `.env.example` as the placeholder list.

## Authentication / authorization

- Workstation: Better Auth (Google / X via Grok broker). Server functions use `authMiddleware`.
- Discord staff: envoy **staff table** (capabilities), not Discord role names. Discord roles are presentation.
- Imposter with a Discord staff-looking role but not on the staff table cannot `/post`.

## Discord permissions

Blueprint `never_administrator: true`. Invite integer `294851834304`. Missing access is fixed with **channel overwrites** (VIEW, SEND, READ_HISTORY, EMBED_LINKS, MANAGE_MESSAGES as needed), not Administrator.

## Dispatch boundary

No player-facing `postMessage` outside `dispatch.send` / `discordDeliver` called from it. Restricted and developer term lists **block**. They do not rewrite copy.

## Zero-canon

`src/lib/mortis/zero-canon.ts` inspects envoy stores and templates. Envoy may hold members, tickets, audit, bindings, release *metadata* — not dossiers, fragments, or reveal schedules.

## Narrative

Events: created → ELIGIBLE → ENACTED. Dispatch of `class: NARRATIVE` without ENACTED fails at step 2.

## Production isolation

Scratch confirmation is required for live attach. Production guild must not be targeted. `mortis-relay` is a different Worker; envoy must not call it.

## Audit / lockdown

Audit rows append in store and mirror to `staff.audit`. Lockdown closes arrival and pauses invites; notice goes through dispatch. Kill switch returns 404 on interactions until lifted.
