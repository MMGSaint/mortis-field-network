# OPERATIONS

One-person operator runbook. Discord is not canon authority.

## Local startup

```
npm install
npm run typecheck
npm run test:engine
```

In Grok Build the preview starts via `startup.sh`.

## Tests

Engine: `npm run test:engine` (T1–T9, S1–S53).  
Workstation Tests page also runs the suite and the first-player walkthrough (isolated runtime — it does not Apply the operator guild).

## Provisioning

Validate → Plan → Apply. Identity is blueprint key. Running Apply twice is a no-op when hashes match.

## Connect (scratch guild)

1. Sign in.
2. Provision: token in the password field (memory only).
3. Guild `1540022458126700674`, app `1540058003888410806`.
4. Check scratch confirmation.
5. Connect. Wait gateway READY.
6. Validate → Plan. Read the plan. Apply only if intended.
7. Leave Discord Interactions Endpoint URL **blank**.
8. Least privilege `295011699728`. Never Administrator. If the bot currently holds Admin, re-invite.

If buttons time out, gateway is not READY or Discord still has a placeholder Interactions URL.

## Health

Provision → Health. Report-only. Missing, topic/placement/overwrite drift, orphans, lockdown, gateway.

## Recovery

- Notice mistake: Dispatch → Retract (channel key + message id + reason).
- Leaked webhook URL: Provision → Rotate webhooks.
- Interactions misbehaving: Security → kill switch, then Lift kill switch.
- Process restart: token is gone. Connect again. Bindings reload from `data/scratch-guild-state.json`.

## Rollback

Blueprint Apply is idempotent and does not delete history. Kill switch stops interactions without tearing down Discord. Worker: do not point Discord at a URL until envoy is actually deployed.

## Production

Do not Connect or Apply the production Mortis guild from this workstation.
