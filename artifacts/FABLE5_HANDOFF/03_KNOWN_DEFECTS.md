# KNOWN DEFECTS AND FIX MAP

Do not widen Admin. Do not start Phase 3. File paths are under `src/lib/mortis/` unless noted.

## Button timeout — “The application didn’t respond in time”

No READY gateway, or Interactions Endpoint URL pointing at a dead placeholder (nice-example.local / App Builder public URL). Discord then waits 3s and shows the timeout. The button existing is not proof the ACK path is alive.

Already: `discord-gateway.ts` ACK ≤3s; defer type 5 + follow-up; type 9 immediately for `ticket_create` / `intake_start`. Provision shows lastEvent / lastError. `reconnectGateway()` if token still in WeakMap.

Operator: leave Interactions URL blank. Connect. Wait gateway READY. If it was Saved to a placeholder, clear it, then Reconnect gateway.

## Generic “Could not complete that action.”

Was catch-all in `envoy.ts`. Now `ephemeral()` + `failReason()` ~180 chars with Discord body.

If it returns, grep those strings and replace with `failReason`. Never ship a catch that swallows `err.body`.

## POST /guilds/{id}/channels 400

Bad name, parent, or overwrite hierarchy. Ticket channels are **not** blueprint objects; they nest under SUPPORT (`store.blueprintState.get("support")`).

`tickets.ts` `createTicket`: slug `ticket-{category}-{suffix}` ≤100; parent SUPPORT; PUT bot overwrite; retry full overwrites; then minimal (everyone deny view + bot + opener VIEW/SEND/HISTORY); then parent=null. Surface Discord body on the ephemeral and in audit.

Live web-open needs a real member snowflake. Demo handles (`owner_1`) are simulator-only.

## POST/pin 403 / 50001 Missing Access (support.desk and other initiate+)

Bot member overwrite missing on the target channel or parent category.

`ensureBotChannelAccess` in `discord-rest.ts`. Sweep on connect, pin refresh, dispatch, ticket parent. Bits: VIEW + SEND + READ_HISTORY + EMBED_LINKS + MANAGE_MESSAGES (type 1, bot user id). `discordDeliver` 403 → application webhook with components if Discord allows it. Non-fatal warnings on Provision / audit.

## PATCH channel 403 or PATCH guild 400 aborting Apply

Partial apply historically left only ARRIVAL channels.

`provision.ts` tolerate 400/403 on guild PATCH and channel PATCH/POST. Continue remaining creates. Skip noop patches. Do not abort the whole Apply.

## guild.listPins is not a function

Live path must use REST GET `/channels/{id}/pins`. Never `guild.listPins`. Refresh pins already falls through to repost+pin if listPins fails — keep that fallback, but listPins itself must be REST.

## Vite “Module node:fs has been externalized”

Keep `fs` in server modules (`discord-rest.ts` persist, `blueprint.ts` load, `server.ts` createServerFn). Client talks via `createServerFn`. Do not import mortis server files from a client component except types.

## Process restart / hibernate

Token gone. SimulatedGuild until Connect. `loadScratchState` restores bindings only. `startup.sh` brings the preview back; it does **not** restore the gateway. Operator must Connect again. Never persist the token to survive this.

## Orphans

Default `#general` (has history), Text Channels, Voice Channels, managed bot role. Report-only. Archive-lock history only with per-item confirm. Never a default delete.

## LOCKDOWN invite-pause

May need Manage Server, which is **not** in 294851834304. Arrival-close still works in envoy. Report Discord invite-pause failure. Do not add Admin or Manage Server to the integer.

## Role hierarchy

Bot cannot position Initiate/Shadow if its integration role sits below them. Operator drags the bot role above presentation roles. Code should report the 403, not demand Admin.

## Stale docs

`docs/DISCORD_SETUP.md` §1 “Phase 1 is gateway-less” and §6 “Set Interactions Endpoint URL to envoy” contradict the scratch gateway. Safe PASS E: rewrite those paragraphs to “leave URL blank while using the workstation gateway; envoy HTTP verify remains available after a real Worker deploy.”
