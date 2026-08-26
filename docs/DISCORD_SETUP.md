# MORTIS FIELD NETWORK — Discord setup (owner)

Scratch guild first. Do not point this bot at the real/player guild until every mandatory test in `tests/phase1` has passed **on the scratch guild**.

Envoy work must not redeploy or reconfigure `mortis-relay`. Re-check `GET https://mortis-relay.mmg-wolfpoolyt.workers.dev/v1/health` before and after any Cloudflare deploy. Expected: `{"ok":true,"service":"mortis-relay"}`.

## 1. Discord application (Developer Portal)

Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.

| Setting | Value |
|---|---|
| Application name | Internal only. Not player-facing. (The **guild** is named `MORTIS FIELD NETWORK` by apply.) |
| Bot → Add Bot | Yes |
| Public Bot | **Off** |
| Privileged Gateway Intents (Presence, Server Members, Message Content) | **All off.** Scratch workstation uses a gateway with intents 0 so buttons ACK without an Interactions Endpoint URL. |
| Bot → Reset Token | Copy once. Store as `DISCORD_BOT_TOKEN`. Never put it in a repo, chat, or `[vars]`. |
| General Information → Application ID | `DISCORD_APPLICATION_ID` / `DISCORD_APP_ID` — configuration, not a secret. |
| General Information → Public Key | `DISCORD_PUBLIC_KEY` — configuration (verify-only). Needed for Interactions, not for REST provision. |

## 2. OAuth scopes and permissions

OAuth2 → URL Generator.

**Scopes (required):**
- `bot`
- `applications.commands`

**Guild permissions — least privilege, integer `294851834304`:**

| Required | Not required (do not tick) |
|---|---|
| View Channel | Administrator |
| Send Messages | Manage Server / Manage Guild |
| Embed Links | Ban Members, Kick Members |
| Read Message History | Moderate Members |
| Manage Channels | Manage Nicknames, Manage Expressions |
| Manage Roles | Mention Everyone |
| Manage Webhooks | Manage Events |
| Use Application Commands | Create Instant Invite (optional; not in the integer) |
| Manage Threads | View Audit Log |
| Send Messages in Threads | Attach Files (not in the integer) |
| Connect (voice visibility) | Speak |

Never Administrator. If the bot later shows Administrator, **stop** — re-invite with this integer.

Invite URL (replace APPLICATION_ID):

```
https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&permissions=294851834304&scope=bot%20applications.commands
```

Invite **only** to the scratch guild.

After invite: in the scratch guild, drag the bot's integration role **above** the presentation roles it must position (staff above bot above Initiate). The bot cannot move roles at or above itself.

## 3. Scratch guild

Create a **new, empty Discord server**. Do not use the production Mortis/player guild.

Copy the **guild snowflake** (Server Settings → Widget, or Developer Mode → Copy Server ID). This is configuration, not a secret. It is the target guild id.

Default `#general` / Voice will be reported as **orphans** and left untouched.

## 4. Where values go

| Name | Kind | Where |
|---|---|---|
| `DISCORD_BOT_TOKEN` | **secret** | Wrangler secret on envoy **or** the Provision page password field (memory only). Never chat, never files, never `[vars]`. |
| `DISCORD_APP_ID` / Application ID | config | Wrangler secret (name-stable) or Provision field. Safe to mention. |
| `DISCORD_PUBLIC_KEY` | config | Wrangler secret / Interactions verify. Safe to mention. |
| `CLI_SECRET` | **secret** | Wrangler secret only. Owner-PC CLI auth to envoy. Not required for REST provision. |
| Target guild snowflake | config | Provision field / this conversation. **Not** a secret. |
| Webhook URLs | secret | Envoy/memory only. Never in `blueprint/`. |

## 5. Connect + validate → plan → apply (this workstation)

Sign in on the operator workstation → **Provision**.

1. Paste guild snowflake + application id.
2. Paste bot token in the password field (not in chat).
3. Tick **This is a blank scratch guild, not the production player Mortis guild.**
4. Connect. Validate. Read the plan. Apply only after the plan shows creates with **no deletes**.

Text channel names are slugified by Discord (`CONDUCT AND TERMS` → `conduct-and-terms`). Categories and roles keep mixed-case display. That is a Discord transport constraint, not a blueprint change.

## 6. Cloudflare envoy (later — not required for REST provision)

Do not touch `mortis-relay`.

Scratch workstation: **leave Interactions Endpoint URL blank.** Buttons ACK over the in-process gateway (no privileged intents). Saving a placeholder such as `https://nice-example.local/api/interactions` will steal clicks and time out.

When you later deploy the Worker:

```
cd workers/mortis-envoy
npx wrangler d1 create mortis-envoy
npx wrangler r2 bucket create mortis-envoy-transcripts
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID
npx wrangler secret put CLI_SECRET
npx wrangler deploy
```

Only then set Interactions Endpoint URL to `https://<envoy-host>/interactions` **and** you may stop relying on the workstation gateway. Until that Worker is actually reachable, keep the URL blank.

## 7. Rollback / kill

- Provision: re-apply previous blueprint (renames revert in place; created objects archive-lock).
- LOCKDOWN: arrival closes; Discord invite-pause API needs Manage Server, which Phase 1 **does not grant**. Owner can pause invites in Server Settings if needed.
- Kill: rotate bot token / CLI secret, or disable the interactions route.
