# MORTIS AUTONOMOUS CONTINUATION REPORT — 2026-08-29

**Repository:** https://github.com/MMGSaint/mortis-field-network
**Branch worked on:** `claude/mortis-field-network-continuation-orsh36`
**Baseline HEAD:** `d963914` (T1–T9 + S1–S69, live scratch verified through 2026-08-28)

## Honest recon

The prior directive asserted a Fable pass-2 commit `84a4824` (S70–S74) and a
`mortis-fable-pass2.bundle` artifact. Neither exists in this environment:

- `git cat-file -e 84a4824` → `fatal: Not a valid object name` (local + reflog + all remotes).
- No `.bundle`, `.patch`, or Fable-authored ZIP anywhere on disk (checked
  the repo, `/tmp`, `/home`, the scratchpad).
- `origin/main` and both local branches sit at `d963914`.

Per the directive ("Do not fabricate a commit"), the honest baseline continues
at `d963914` and the S70–S74 features were **re-implemented from the roadmap**
rather than recovered. What ships this pass is genuinely new engineering
verified in the simulator, not a resurrection of an artifact that is not present.

## Work landed this pass

All simulator-verified; no live scratch attach happened this pass.

| ID | Feature | Files |
|---|---|---|
| S70 | Live-attach guild allowlist; refuses non-scratch ids **before** hydrate or token use; refusal is audited | `allowlist.ts`, `runtime.ts` |
| S71 | Gateway heartbeat-ACK tracking + zombie reconnect (close 4000) | `discord-gateway.ts` |
| S72 | OP7 graceful close-and-RESUME; OP9 honors `resumable`; one guarded reconnect scheduler suppresses duplicate timers under close+op7+op9+error races | `discord-gateway.ts` |
| S73 | Per-member notification preferences (`notice` / `dispatches` / `tickets_own`), reversible, intake-gated, audited | `notifications.ts`, `store.ts`, `runtime.ts` |
| S74 | Operational-only scheduler; refuses non-operational kinds, narrative-shaped kind labels, and (defense in depth) templates flagged `class === "NARRATIVE"` even under an operational label; delivery goes through `dispatch.send` | `scheduler.ts`, `runtime.ts` |
| S75 | Scheduler skips cancelled and future rows | test only |
| S76 | Allowlist runtime additions are reversible; scratch never dropped | test only |
| S77 | Notification preferences refuse unknown/pre-intake members | test only |
| S78 | Scheduler operational-kind allowlist stays in step with `notices.ts` map (drift guard) | test only |
| S79 | /faq slash command + /notifications slash command; walkthrough exercises both | `faq.ts`, `commands.ts`, `envoy.ts`, `walkthrough.ts`, `blueprint/guild.json` |
| S80 | FAQ text carries no restricted terms or dev vocabulary | test only |
| S81 | Safe operational tick — fires due notices, alerts new HOLDs, debounces repeats | `operations.ts`, `runtime.ts` |
| S82 | Tick refuses NARRATIVE at fire time (template class flip caught) | test only |
| S83 | Operations module never calls `guild.postMessage` or `discordDeliver` directly | test only |
| S84 | Gateway fatal close codes (4004/4010–4014) stop the loop, no reconnect | `discord-gateway.ts` |
| S85 | Scheduler enqueue does not silently dedupe repeated requests | test only |
| S86 | Notification prefs are member-scoped and independent of lockdown | test only |
| S87 | SECURITY: no bot tokens, webhook URL+token pairs, or private keys in git | test only |
| S88 | SECURITY: new modules carry no restricted terms or dev vocabulary | test only |

## Test results

```
npm run typecheck   PASS
npm run test:engine PASS
npm run build       PASS  (Vite + Nitro output regenerated, PGLite migration no-op)
```

Individual results: **T1–T9 + S1–S88 = 97/97 PASS**.

## Invariants preserved

- Dispatch remains the sole player-facing send choke point. Scheduler delegates to `postOperationalNotice` → `dispatch.send`.
- NARRATIVE still requires ENACTED. Scheduler will not fire NARRATIVE.
- Zero canon introduced. Zero-canon inspection (T8) still PASS.
- Never Administrator. Least-privilege integer `295011699728` unchanged.
- Production Discord never touched.
- No secrets in git.

## Live verification status (owner-side)

**SIMULATED, NOT LIVE.** No bot token in memory this pass; no live scratch
attach performed. When the operator next Connects on scratch:

1. Confirm attempt to Connect a non-scratch id refuses before hydrate (audit `discord.connect.refused`).
2. Confirm gateway survives a forced disconnect and a simulated OP7 without stacked reconnect timers.
3. Round-trip a member notification preference change and confirm the audit row.
4. Schedule a `maintenance` notice `past` and call the scheduler run — should send once.
5. Try to schedule with a NARRATIVE-classed template — should refuse `narrative template refused`.

Labels stay SIMULATED until owner-side live re-verification.

## Owner-only remaining

Unchanged from prior handoff:

- Paste bot token on Provision → Connect (never in chat/git).
- PIN_MESSAGES + Community Safety Setup are still API-gated for the owner.
- Phase 3 / Phase 4 / narrative engine: explicit go only.

## Next agent

1. `git pull origin claude/mortis-field-network-continuation-orsh36`
2. `npm install && npm run test:engine` (expect 87 PASS).
3. Read `docs/AGENT_HANDOFF.md`, `docs/CHANGELOG.md` (top block), and this report.
4. Do not re-add `mortis-fable-pass2.bundle` — it does not exist.
5. Live re-verify S70–S78 when the owner can Connect scratch.
