# ERROR PLAYBOOK — if you see X, change Y

Do not widen Admin. Surface Discord `status + body` every time. Then harden the sibling failure on the same function.

## Discord REST

| You see | Meaning | Change |
|---|---|---|
| `POST /guilds/{id}/channels 400` | name / parent / overwrites invalid | `tickets.ts` slug ≤100 `[a-z0-9-]`; only snowflake overwrite ids; retry minimal; retry `parent_id: null` |
| `POST /guilds/{id}/channels 403` | missing access on parent or Manage Channels | `ensureBotChannelAccess(parent)` then retry; category overwrite type 1 bot |
| `POST /channels/{id}/messages 403` / `50001` | cannot post/pin | overwrite on **that** channel; webhook fallback in `discordDeliver` |
| `PUT /channels/{id}/pins/{mid} 403` | missing MANAGE_MESSAGES | include MANAGE_MESSAGES on bot member overwrite |
| `PATCH /channels/{id} 403` | cannot edit topic/overwrites/parent | non-fatal in apply; skip if already matched |
| `PATCH /guilds/{id} 400` | community/verification fields Discord rejects | non-fatal; Community is a manual Safety Setup toggle |
| `PATCH /guilds/{id} 403` | missing Manage Server / Admin | non-fatal; do not add those perms |
| `401` on REST | bad/rotated token | tell operator to Connect again; do not log the token |
| `429` | rate limit | `withBackoff`; honor retry-after |
| `500 / 502` | Discord blip | retry once with backoff; then fail with body |

## Gateway / interactions

| You see | Meaning | Change |
|---|---|---|
| “The application didn’t respond in time” | no ACK in 3s | gateway not READY, or HTTP endpoint stealing the interaction, or type-9 missed |
| gateway stuck `connecting…` | identify/heartbeat | heartbeat before identify; surface close code in `lastError`; reconnect |
| close `4004` | auth failed | token wrong; Connect again |
| close `4014` | disallowed intent | you turned on a privileged intent — turn it OFF |
| modal never opens | pre-ACK type 4/5 on `ticket_create`/`intake_start` | those custom_ids must return type 9 as the **first** callback |
| ephemeral generic line | swallowed error | `failReason(e)` in `envoy.ts` |
| Interactions URL set | Discord POSTs the URL instead of (or in addition to) gateway | operator clears URL; you warn in Provision if it looks like a placeholder |

## Provision / Apply

| You see | Meaning | Change |
|---|---|---|
| Applied 0 mutations + 403 continuing | creates 403 without overwrite/Admin | overwrite sweep first; do not require Admin; report warnings |
| Apply aborted mid-plan | a PATCH/POST threw fatal | make that class non-fatal like channel PATCH 403 already is |
| Plan creates>0 after a successful apply | bindings not persisted or key mismatch | `persistScratchState`; match by key not name |
| `node:fs.readFileSync` in client | server module imported into a route component | keep I/O behind `createServerFn` |

## Product

| You see | Meaning | Change |
|---|---|---|
| Web tickets work, Discord button doesn’t | gateway/ACK/create payload, not the ticket store | fix Discord path; do not break `src/routes/tickets.tsx` |
| Accept works, Begin Intake doesn’t | `intake_start` not type 9, or LOCKDOWN | check lockdown; check modal ACK |
| Ticket category rejected | not in `general\|report\|appeal\|accessibility` | ephemeral lists the four; do not invent categories |
| Restricted terms in ticket body | leak gate | hold for staff; original does not post |
| `/post` as OPERATIONS role holder | staff table miss | “not authorized to post”; do not leak the table |

## Process

| You see | Meaning | Change |
|---|---|---|
| After sandbox revive, “connected” is false | token WeakMap empty | operator Connects; bindings still load from `scratch-guild-state.json` |
| Preview blank | `startup.sh` / `:8080` | restore startup; do not debug Discord until preview is up |
