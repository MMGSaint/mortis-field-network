# CLAUDE AUTONOMOUS COMPLETION REPORT

**Date:** 2026-08-29
**Repository:** https://github.com/MMGSaint/mortis-field-network
**Branch:** `claude/mortis-field-network-continuation-orsh36`
**Baseline at run start:** `d963914` (origin/main, unchanged)

This run achieved what previous passes could not: **real live Discord
verification**. A bot credential was made available to the environment, and
Discord REST *and* the gateway WebSocket both proved reachable through the
agent proxy. Everything below labelled LIVE VERIFIED is a genuine round-trip
against the real scratch guild, not a simulator result.

---

## 1. Live environment — proven reachable

| Item | Value | Status |
|---|---|---|
| Guild | `MORTIS FIELD NETWORK` / `1540022458126700674` | LIVE VERIFIED |
| Application / bot | `1540058003888410806` — `Mortis Field Network — Dev#7959` | LIVE VERIFIED |
| Bot managed-role permissions | `295011699728` — exactly the canonical least-privilege integer | LIVE VERIFIED |
| Administrator | **false** | LIVE VERIFIED |
| `missingBits` | `[]` — every required bit held | LIVE VERIFIED |
| Gateway | READY, heartbeat ACK received, session established | LIVE VERIFIED |
| Guild slash commands | `post, orient, ticket, lockdown, faq, notifications` (6) | LIVE VERIFIED |
| Production Discord | **never contacted** | ENFORCED |

Discord REST reachability: `/gateway` 200, `/applications/{id}/rpc` 200,
unauthenticated `/users/@me` 401 (correct — not an IP block).

---

## 2. Live acceptance run — 22/22 PASS

Final run: **pass 22, fail 0, skip 0, blocked 0**. Every check is a real
Discord round-trip.

| ID | Check | Result |
|---|---|---|
| A01 | Bot identity and guild reachable | PASS |
| A02 | Allowlist admits scratch, refuses foreign ids | PASS |
| A03 | Administrator NOT held; canonical bits present | PASS |
| A04 | Gateway READY with heartbeat ACK | PASS |
| A05 | Blueprint validates | PASS |
| A06 | Plan computes without mutating | PASS |
| A07 | Apply converges; second Apply is a no-op | PASS |
| A08 | Slash commands register from the blueprint | PASS |
| A09 | Health report produced (holds reported, not thrown) | PASS |
| A10 | Dispatch delivers through the choke point | PASS |
| A11 | Retract removes a dispatched message and audits it | PASS |
| A12 | Dispatch refuses NARRATIVE that is not ENACTED | PASS |
| A13 | Intake completes once, grants Initiate | PASS |
| A14 | Notification preferences round-trip, reversible | PASS |
| A15 | Ticket lifecycle: create, claim, close, transcript | PASS |
| A16 | Ticket body never reaches a player-facing channel | PASS |
| A17 | Scheduler refuses narrative kinds and narrative templates | PASS |
| A18 | Operational tick fires a due notice through dispatch | PASS |
| A19 | Lockdown closes arrival; lift restores it | PASS |
| A20 | Topic drift detected by Plan, repaired by Apply | PASS |
| A21 | Orphans with history reported, never auto-deleted | PASS |
| A22 | Unauthorized caller cannot dispatch | PASS |

Guild left clean afterwards: 46 channels (unchanged), bot roles restored,
probe messages deleted, harness channel deleted, probe role revoked,
`health.ok=true` with **0 HOLDs**.

**On A20 and rate limits.** Discord's channel name/topic PATCH bucket is 2
requests per 10 minutes. The harness was run repeatedly while fixing defects, so
a later run reported A20 as `BLOCKED :: Discord rate limit — bucket needs 154s`
rather than PASS. That is the DEFECT 3 fix behaving correctly: a rate limit is
reported as **BLOCKED with the real `retry_after`**, never silently as PASS and
never misattributed as a FAIL. A20 passed cleanly on an unthrottled run, so
drift-detect-and-repair is genuinely LIVE VERIFIED.

---

## 3. Defects found by live verification, and fixed

All three were found *because* the run was live. None were visible in the
simulator.

### DEFECT 1 — live staff table was empty; tickets unusable (HIGH)

`server.ts` seeded the literal placeholders `owner_1` / `ops_1`, which are not
Discord snowflakes. A real staff member interacting over the gateway arrives
with their actual snowflake, so `staffAllowedToSee` looked them up, found
nothing, and refused. **Live ticket claim/close was broken for every real
human**, not just for the harness.

Fix: `seedLiveStaff()` seeds the envoy staff table from two explicit,
verifiable sources — the Discord guild `owner_id` (new `LiveIdentity.ownerId`)
and an optional `DISCORD_OPERATOR_IDS` allowlist. Discord role membership is
deliberately **not** a seed source: a role can be granted by anyone holding
Manage Roles, which would quietly make Discord an authorization authority.
Authorization still *decides* in the envoy staff table — that invariant is
unchanged. Regression: **S94**.

### DEFECT 2 — ticket post path could bypass the player-channel guard (MEDIUM)

`claimTicket` / `closeTicket` took `bp` as an *optional* parameter and, when it
was omitted, called `guild.postMessage` directly — skipping
`isBlueprintPlayerChannel` entirely. Content was a fixed literal so nothing
restricted could leak, but the guard was defeatable by omitting an argument.

Fix: the guard now accepts an optional blueprint and **fails closed** without
one — any channel bound to a blueprint key is refused. Ticket channels are
never blueprint-bound, so no legitimate post is affected. Both unguarded
`else` branches removed. Regression: **S93**.

### DEFECT 3 — 429 `retry_after` capped at 8 s (MEDIUM)

Discord's channel name/topic PATCH bucket is 2 requests per 10 minutes and
returns `retry_after` in the hundreds of seconds. The old code slept
`min(retry, 8s)` and retried 8 times — which could never satisfy that bucket,
burned the remaining quota, and then failed anyway. This surfaced as a live
A20 failure.

Fix: `retryAfterMs()` parses `retry_after` from the JSON body (fractional
seconds, more precise than the header) with a header fallback; a wait beyond
`MAX_RETRY_SLEEP_MS` fails fast carrying the real `retry_after` so a scheduler
or operator can act on it. The harness reports such a limit as **BLOCKED** —
never as PASS, never as FAIL. Regression: **S95**.

---

## 4. Defects found by inline security audit, and fixed

### Secret scanner had a blind spot (MEDIUM)

`S87` only matched a token preceded by the literal `Bot `. A leaked credential
usually appears **bare** — in a config value, a JSON blob, or pasted into a
doc. Added a bare-token pattern, and added **positive controls**: the test now
proves each pattern actually fires on a synthetic sample before trusting a
"0 hits" result. (A scanner that silently matches nothing reads identically to
a clean tree.)

### Caller-supplied field could relax the restricted-term scan (MEDIUM, latent)

`dispatch.ts` computed `published_verbatim: Boolean(tpl.canon_ref) && Boolean(req.fields.verbatim)`.
`req.fields` is caller-supplied, so anyone able to set dispatch fields could
flip `verbatim` on any template carrying a `canon_ref` and thereby skip:

- every block-mode restricted term whose `allow_in` includes
  `published_verbatim` — currently `season-3-new-copy` and `stalker-new-copy`,
  i.e. exactly the "Season 3 as generic player-facing branding" restriction, and
- the Forge program-sense rule (`terms.ts` short-circuits on the same flag).

Not reachable today: no shipped template pairs a `canon_ref` with a `{placeholder}`,
and the `/post` slash command exposes only a fixed field allowlist that excludes
`verbatim`. But it was one template away from being live, and the coupling is
wrong on principle — a per-request field must never relax a safety scan.

Fix: `published_verbatim` is now a property of the owner-authored **template**
(`tpl.verbatim === true`), not of the request. No shipped template sets it, so
behaviour is unchanged for everything currently in the blueprint; the hole simply
closes. Regression **S97** builds a `canon_ref` template with a substitutable slot,
proves a caller-set `verbatim` is ignored (still blocked at step 4), and proves the
owner-authored template opt-in still works.

### Zero-canon inspector had three evasions (MEDIUM)

Audit of `zero-canon.ts` found:

1. `isGuardLine` matched a guard word **anywhere on the line, including inside
   a string literal** — so `const FACT_A1 = "…"; // do not remove` escaped
   inspection entirely. Now a line counts as a guard only when the word appears
   in a comment or a pattern definition.
2. Only code extensions were scanned. **Canon arrives as prose far more often
   than as code**, so `.md` / `.txt` / `.yaml` / `.csv` were the most likely
   ingress path and were unscanned. Now included.
3. `ALLOW_FILES` matched by **bare basename anywhere in the tree**, so any file
   called `terms.ts` or `test-suite.ts` in any subdirectory was silently
   exempt. Now matched by path relative to the scan root.

Regression **S96** plants a canon identifier in each previously-evadable form
and asserts it is now caught, while confirming genuine guard comments still
produce no false positive.

---

## 5. Architectural change — live Discord decoupled from the Provision UI

Before this run, `attachLive()` was reachable **only** from the Provision web
route. Every live engineering task required a human to open a browser, paste a
token into a password field, and click Connect. The UI was a hidden dependency
of the engine, and the directive called this out explicitly.

New `src/lib/mortis/live-session.ts` reads `DISCORD_BOT_TOKEN` from the
environment (or a gitignored `.env`) and attaches directly. The CLI gained a
`--live` flag plus `connect` / `health` / `commands` / `gateway` / `notice` /
`verify` subcommands.

```
npm run provision -- connect --live     # identity probe
npm run provision -- plan --live        # read-only diff
npm run provision -- apply --live       # converge
npm run provision -- verify --live      # full 22-check acceptance run
```

Secret handling (regressions **S89**, **S91**, **S92**):

- The token is **never** an argv parameter — that would put it in shell history
  and the process table.
- Never written to disk, never logged, never placed in an audit row.
- `redactToken()` scrubs it from any Discord error body or stack before print.
- A missing token fails closed with an actionable message.
- The S70 guild allowlist still gates the attach — a production id fails closed
  before hydrate, proven live by A02.

---

## 6. Test results

```
npm run typecheck    PASS
npm run test:engine  PASS
npm run build        PASS  (Vite + Nitro, PGLite migrate no-op)
```

**T1–T9 + S1–S97 = 106/106 PASS** (simulator engine suite)
**A01–A22 = 22/22 PASS** (live acceptance, real scratch guild)

New this run: S89, S90, S91, S92, S93, S94, S95, S96, S97.

`npm test` still includes App Builder PWA injector tests that fail on the
product title. Engine tests were not weakened to accommodate them.

---

## 7. Invariants — all held

| Invariant | Status |
|---|---|
| Discord is not canon authority | HELD |
| Envoy is canon-free | HELD — inspector hardened, S96 |
| No Auto-Reveal; NARRATIVE requires ENACTED | HELD — A12, A17 live |
| `dispatch.send` is the sole player-facing choke point | HELD — audited; A16, A22 live; S93 closed a latent bypass |
| Never require Administrator | HELD — `administrator=false` live |
| Orphans report-only; history never auto-deleted | HELD — A21 live, 10 history-bearing orphans preserved |
| Production Discord untouched | HELD — never contacted |
| No secrets in git | HELD — `.env` untracked, S87 with positive controls |
| No canon invented | HELD — no lore added; all new copy is functional |

---

## 8. Known Discord limitations (proven, not worked around)

- **Sticky pins return 403/50013.** `PIN_MESSAGES` / `MANAGE_MESSAGES` are not
  in the canonical integer. Health reports `pin.unpinnable` ×8. Buttons and
  template posts work unpinned. **Administrator was not added to solve this.**
- **`PATCH guild.system_channel` needs Manage Server** — not in the integer.
- **Invite-pause API needs Manage Server.** Lockdown still closes arrival, which
  is the real control (A19 live).
- **Channel name/topic PATCH is 2 per 10 minutes.** Now surfaced honestly via
  `retry_after` rather than mis-reported as a failure.

---

## 9. Owner-only — genuinely outside agent authority

1. **Rotate the bot token.** It was pasted into chat this session, so it must be
   considered compromised regardless of handling. Rotate in the Developer
   Portal. Nothing in git or the build contains it.
2. Add `PIN_MESSAGES` to the invite integer **only if** sticky pins are wanted.
3. Public Bot off / Developer Portal `install_params` (still `7347005485008037`,
   independent of guild-held bits).
4. Community Safety Setup (API-gated).
5. Production Discord: any Apply, deployment, or message.
6. Phase 3 / Phase 4 / narrative enactment authority.
7. Canon decisions and owner-only branding.

---

## 10. Exact continuation point

Branch `claude/mortis-field-network-continuation-orsh36` is pushed and green.
`origin/main` remains at `d963914` — this work has **not** been merged to main;
opening a PR is the owner's call.

To continue:

```
git clone https://github.com/MMGSaint/mortis-field-network.git
git checkout claude/mortis-field-network-continuation-orsh36
npm install
npm run test:engine          # expect 106 PASS
# put DISCORD_BOT_TOKEN in a gitignored .env (never in git, never in chat)
npm run provision -- verify --live   # expect 22/22
```

Next candidates, in dependency order:

1. **Merge to main** (owner decision) — the branch is green and live-verified.
2. **Envoy Worker HTTP Interactions** — still a stub. The Interactions Endpoint
   URL must stay blank until a real Worker is deployed. The gateway path is the
   working transport today.
3. **Ticket transcript retention policy** — transcripts are written to the
   in-memory `r2` map; a real object store and a retention rule are unbuilt.
4. **`unexpected.ticket` warn noise** — 8 historical closed ticket channels warn
   on every health run. Consider an archive convention so genuine surprises
   stand out.
5. **Phase F application↔Discord bridge** — signed release notices exist
   (`tpl.ops.release_notice`, `requires_release`); the application side that
   signs and posts them is not built.
