# ROOM TO IMPROVE — Fable 5 may evolve this

The one prompt allows a **better version** of the same Phase 1 system. That is intentional. Do not freeze bugs. Do freeze invariants.

## You may change freely (Phase 1)

- Reliability of ticket create, pin refresh, gateway ACK, overwrite sweep
- Operator UX on Provision / Tickets / Audit (clarity, not a new product)
- Tests, especially Discord error-path mocks (400/403 retry without hitting Discord)
- Docs that match reality (`docs/DISCORD_SETUP.md` still says gateway-less / set Interactions URL)
- Additive helpers if used twice or more; no speculative frameworks
- Hotfixes after live 400/403/429/500 without waiting for a new architecture
- `/orient`, notification preferences, transcript HTML, report-only drift cron
- More OPERATIONAL templates through `dispatch.send`
- Webhook rotation, retract flow polish, better plan visualization

## You must get an explicit owner “go” before

- Phase 3 Operations Room
- Phase 4 Shadow / incidents
- Narrative engine / Auto-Reveal machinery
- Privileged intents
- Production guild Apply
- Canon ingest
- Changing the least-privilege integer to include Administrator or Manage Server

## How to ship a hotfix in one pass

1. Reproduce in tests or with a mocked 403/400.
2. Fix the payload / overwrite / ACK.
3. Surface the real Discord body.
4. Harden the sibling failure on the same function (PASS D).
5. Run the mandatory suite.
6. Tell the operator the exact Discord click to retest.

If two approaches work, pick the one that does not need Admin and does not delete history.

## Highest-value first pass (if tests are already green)

Prove Discord Open ticket 400/403 retry in a mock, prove type-9 modal ACK cannot be pre-empted by type 5, prove `failReason` never collapses to the generic line, then stop for Connect → Validate → Plan. Do not Apply.
