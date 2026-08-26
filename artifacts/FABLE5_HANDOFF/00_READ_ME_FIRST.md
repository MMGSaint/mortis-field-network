# MORTIS → FABLE 5 TAKEOVER
**Packed:** 2026-08-25 · **From:** Grok Build `/workspace` (tree present)

This zip **is** the Phase 1 source plus the operating brain. Unpack it. Open `PASTE_THIS_INTO_FABLE5.txt` and paste that as the **first and only** prompt into Fable 5 on max. That prompt contains recon, invariants, defect catalog, self-healing passes, and stop conditions so you do not spend later prompts on diagnosis.

## Layout

| Path | What |
|---|---|
| `PASTE_THIS_INTO_FABLE5.txt` | **The one prompt.** Paste this. |
| `02_SESSION_STATUS.md` | Last-known live + sim state |
| `03_KNOWN_DEFECTS.md` | Bugs already hit + how the next ones get fixed |
| `04_INVARIANTS.md` | Hard stops. Do not reopen. |
| `05_ROOM_TO_IMPROVE.md` | Allowed upgrades, hotfixes, later phases |
| `06_ARCHITECTURE_MAP.md` | Files, functions, custom_ids, data flow |
| `07_ERROR_PLAYBOOK.md` | If you see X, change Y — Discord API catalog |
| `08_FILE_MANIFEST.txt` | Every packed path |
| `SOURCE/` | Full App Builder + mortis-envoy tree (`node_modules` omitted, **no token**) |

## Secrets (never in this zip)

- Bot token: Provision page only, memory only (WeakMap)
- No `.env` with secrets is included because none exists
- Historical chat pastes of the token are **out of band**. Rotate if this zip leaves the trusted circle.

Safe IDs:

- Scratch guild: `1540022458126700674`
- Application: `1540058003888410806`
- Least-privilege integer: `294851834304`
- Last apply hash: `ca21f0cdbbde846ea2f556c44101a0bc269886abb24c626a43117bdbca10452f`

## First commands after unpack (other workstation)

```
cd SOURCE
npm install
node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/phase1/mandatory.test.ts
```

If you are **inside Grok App Builder**, the tree already lives at `/workspace`. Do not create a second project. Use this zip as backup + Fable 5 brain dump. Keep `startup.sh` serving the preview.

Production Mortis Discord stays untouched. Scratch guild only.
