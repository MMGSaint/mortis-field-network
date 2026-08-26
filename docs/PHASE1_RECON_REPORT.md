# MORTIS PHASE 1 — RECONNAISSANCE REPORT
**Date:** 2026-08-20 · **Agent:** Grok Build · **Status:** RECON COMPLETE — PROCEEDING

## Invariants (restated — binding on this implementation)

1. **Discord is not canon authority.** VRChat is what players witness. The Registry/application is what they can verify. Discord is what they hear, and it is deliberately the least authoritative surface. Nothing in this build adjudicates world-truth in player channels.
2. **mortis-envoy stores zero authoritative canon.** Members, staff, tickets, events (operational metadata + enactment state), templates, blueprint_state, and audit only. No facts, fragments, dossiers, reveal schedules, [BIND] names, unpublished material, or signing keys.
3. **No Auto-Reveal.** NARRATIVE events stop at `ELIGIBLE — AWAITING ENACTMENT` until an authorized enactment. Phase 1 builds the class field and the refusal path; it does not publish story.
4. **One outbound choke point.** Every player-facing message passes `dispatch.send` through eight ordered steps. Staff-category posts skip steps 2–6 but still do 1, 7, and 8. A bypass is a critical defect.

## Environment this session actually occupies

This agent is running inside the **Grok App Builder sandbox**, not a checkout of `MORTIS_PLAYER_PLATFORM`. The live Mortis monorepo is **not mounted** and is **not reachable** through the connected GitHub account.

| Check | Result |
|---|---|
| Workspace | App Builder template (TanStack Start / Vite / PGLite). No `workers/mortis-relay`, no `packages/release-builder`, no `apps/player`. |
| Connected GitHub | `MMGSaint` — public repo `mortis-player-releases` (README only). GitHub App install covers that repo only. Code search for `mortis-relay user:MMGSaint` returned 0. |
| Live relay | `GET https://mortis-relay.mmg-wolfpoolyt.workers.dev/v1/health` → **200** `{"ok":true,"service":"mortis-relay"}` at 2026-08-20T16:31:01Z (baseline). |
| Uniform 404 | Missing routes, `/v1/nope`, and `GET /admin/publish` all return **identical** `404 {"error":"not found"}` + `cache-control: no-store`. |
| Release gate | `GET /v1/release` with no token → **403** `{"error":"forbidden"}` (does not 404 — token surface is distinct). |
| CORS | `access-control-allow-headers: x-mortis-release-token, x-mortis-intake-key, authorization, content-type`. |
| Drive | Player-safe PDFs 12/13 present. Inbox contract present. Scaffold zip + frozen Admin Console v1 present. **Architecture source docs named in handoff §19 items 1–4 were not found on Drive or GitHub.** |
| Canon export / PROP_* / DM-admin PDFs | Present on Drive. **Not ingested. Envoy will not store or import them.** |

## Conflicts (reported, not silently resolved)

1. **C-01 — Live monorepo unreachable.** Handoff §11/§19 assume a checkout of `MORTIS_PLAYER_PLATFORM` with workspaces `apps/player`, `workers/mortis-relay`, `packages/release-builder`. This sandbox does not contain that tree. Implementation proceeds as a **self-contained Phase 1 package** the owner can copy into the real monorepo. Frozen files are therefore not at risk of modification — they are simply absent.
2. **C-02 — Governing architecture files absent.** `MORTIS_DISCORD_MASTER_ARCHITECTURE_2026-08-20.md`, `MORTIS_PHASE1_RESOLUTION_2026-08-20.md`, `MORTIS_ADMIN_TERMINAL_PREP_2026-08-15.md`, `MORTIS_STAGING_FREEZE_2026-08-15.md` were not found. The **handoff is the implementation authority** (handoff §2 item 6 / closing paragraph). Detail that only exists in those missing files cannot be verified; if a later copy diverges, the source documents win and this package must be reconciled.
3. **C-03 — `packages/release-builder` RESTRICTED_TERMS list not readable.** Term lists are seeded from handoff §4 never-list + published Initiate-edition constraints + inbox-contract identifier prefixes. Owner should merge with the live leak-gate list before production use. Additions are safe; removals require owner approval.
4. **C-04 — Scaffold zip download did not land in the workspace.** Drive file `MORTIS_PLAYER_PLATFORM_SCAFFOLD.zip` exists (42 396 bytes, 2026-08-14). Worker conventions are inferred from the **live relay** (health/404/forbidden shapes, header names) and the handoff, not from a local `wrangler.toml`.
5. **C-05 — Cannot create Discord application / scratch guild / Cloudflare Worker from this sandbox.** Provisioning, interaction verify, and envoy deploy against live Discord/CF are **owner actions** documented in `docs/DISCORD_SETUP.md`. This session implements the engine, the simulated-guild test harness (mandatory tests 1–9), and an operator workstation so the blank-guild → Field Network apply can be demonstrated and the code exported.
6. **C-06 — Admin Console v1 is frozen** (`MORTIS_ADMIN_CONSOLE_v1.zip`, hash recorded in its build report). Not opened into the envoy tree. Patterns referenced from the handoff (uniform 404, digest compare, append-only audit, additive DDL) are re-implemented, not imported.

## What already exists (and stays untouched)

- Live `mortis-relay` Worker and its D1/R2 — frozen. Envoy never calls it.
- Player platform / Registry seed PD-20260814-01 — frozen.
- Admin Console v1 — frozen.
- Drive inbox (`MORTIS_ADMIN_INBOX`) — the only intake path for world-content proposals. Discord tickets that carry world-content proposals route humans there; no alternative intake is built.
- Signing private key — not present, not requested, not referenced at rest.

## What is reused (patterns, not copies)

| Pattern | Source | How reused |
|---|---|---|
| Uniform 404 identical body | Live relay `/no-such-route` | Envoy obscurity surfaces return `{"error":"not found"}` with `cache-control: no-store` |
| Token surface ≠ 404 | Live relay `/v1/release` → 403 | Discord signature failure is 401; CLI secret failure is generic 404 (obscurity); release-excerpt verify fails closed |
| Digest compare | Handoff §10 / finding S-05 | SHA-256 digest compare; no length-leaking `tokenEquals` |
| Verify-only Ed25519 | Handoff §11 signing | Envoy verifies Discord interactions and release-excerpt signatures; never signs |
| Leak gate, block-not-redact | Handoff §9 steps 4–5 | Shared term-list files consumed by validator and dispatch |
| Additive-only schema | Handoff §11 | `workers/mortis-envoy/schema.sql` + `migrations/0002_envoy.sql` |
| Secrets not in `[vars]` | Handoff §16 | wrangler.toml has no secret values; names documented only |
| Inbox contract | Drive `_INBOX_CONTRACT.md` | Tickets never become a canon inbox |

## What is being added

- `packages/mortis-core` logic (blueprint, provision, dispatch, terms, crypto, audit, intake, tickets, sim)
- `workers/mortis-envoy` (new Worker source, own D1 schema, own R2 transcripts)
- `tools/mortis-provision` CLI (`validate` / `plan` / `apply` / `adopt` / `rollback`)
- `blueprint/` file set + `strings` layer + term lists
- Mandatory + supplementary tests against a simulated Discord guild
- `docs/DISCORD_SETUP.md` + this recon + completion report
- Operator workstation (preview) — staff-only dry-run of provision/dispatch/audit. **This is not the Phase 3 Operations Room.**

## Files this session will modify / create

**Create freely (handoff §20):** `workers/mortis-envoy/**`, `tools/mortis-provision/**`, `blueprint/**`, `docs/DISCORD_SETUP.md`, `docs/PHASE1_*.md`, `tests/phase1/**`, workstation UI under `src/` (sandbox preview contract).

**Sandbox `package.json`:** test script + description. The **proposed real-monorepo diff** (not applied, because that repo is absent):

```diff
--- package.json (MORTIS_PLAYER_PLATFORM)
+++ package.json
@@
   "workspaces": [
     "apps/player",
     "apps/player-android",
     "admin-phase2",
     "packages/*",
     "workers/mortis-relay"
+    ,"workers/mortis-envoy"
+    ,"tools/mortis-provision"
   ],
   "scripts": {
+    "provision": "node tools/mortis-provision/cli.mjs",
+    "envoy:test": "node --test tests/phase1/*.test.mjs"
   }
```

**Deliberately untouched:** anything that would be `workers/mortis-relay/**`, `apps/player/**`, `packages/release-builder/**`, `admin-phase2/**`, `keys/`, `release_artifacts/**`, PROP_*.json, canon export files.

## Blocking technical questions

None that stop engine implementation. Owner-owned items that remain owner-owned (handoff §18): Season 3 interpretive question; app branding reconciliation; DM trigger entry point; identity linking; composed-name `approved:` stamps. Neutral fallbacks ship for ⚠ names.

## Term-list draft (for owner review)

See `blueprint/terms/restricted.json` and `blueprint/terms/developer.json`. Seeded from §4 never-list. **Do not remove terms without owner approval.** Additions from the live `release-builder` list should be merged before real-guild apply.

## Live relay baseline (re-check after any envoy work)

```
GET /v1/health  2026-08-20T16:31:01Z  200  {"ok":true,"service":"mortis-relay"}
```

Envoy work must not correlate with any relay change. This session cannot deploy envoy to Cloudflare; the baseline is recorded so the owner can re-check after their deploy.
