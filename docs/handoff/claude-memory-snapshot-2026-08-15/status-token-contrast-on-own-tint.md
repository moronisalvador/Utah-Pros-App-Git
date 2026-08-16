---
name: status-token-contrast-on-own-tint
description: All four UPR status foreground tokens fail WCAG AA on their own matching tint in at least one theme — never pair var(--danger) with var(--danger-bg) as text
metadata: 
  node_type: memory
  type: project
  originSessionId: b2d4aac8-9e30-4df6-ba9b-eeddcd3d772a
  modified: 2026-08-08T18:48:44.129Z
---

Putting a status foreground token on its **own** matching tint background fails AA (4.5:1) in at
least one theme, for **every** family. Measured 2026-08-08 against the live `src/index.css` values
(light `:root` and the `[data-theme="dark"] .tech-layout` overrides):

| pairing | light | dark |
|---|---|---|
| `--danger` on `--danger-bg` | 4.41 FAIL | 3.52 FAIL |
| `--info` on `--info-bg` | 4.75 pass | 3.04 FAIL |
| `--success` on `--success-bg` | 3.15 FAIL | 4.59 pass |
| `--warning` on `--warning-bg` | 3.07 FAIL | 4.79 pass |

Danger fails **both**. Success/warning fail in **light** — the opposite direction from the
danger/info dark failure, which is the counter-intuitive part and why a "just use the token"
sweep silently degrades light mode.

Cause: dark theme re-tones only the `-bg`/`-border` tokens; the foreground keeps its hue in both
themes (deliberate, per the comment in `src/index.css`). One mid-tone foreground cannot serve a
near-white tint and a near-black tint. The original code avoided this with darker shades
(`#991b1b`, `#92400e`, `#b45309`) that pass on the LIGHT tint but freeze in dark.

**Working rule:** on a tinted background use `var(--text-primary)` (13.6–17.9:1 across all four
tints, both themes) or `var(--text-secondary)` (5.3–7.7:1), and let the **border and icon** carry
the hue — non-text only needs 3:1, which every family clears. Established precedent:
`TimeTracker.jsx` save-error banner. Status hue as *text* is fine on a NON-tinted surface
(`--bg-primary`/`--bg-secondary`).

Also: `#fff` on `var(--warning)` is only 3.19:1 — a filled amber button needs `#b45309` (5.02:1),
so those raw hexes are deliberate, not missed migrations.

**Unresolved token-design question for the owner:** the real fix is a foreground-on-tint token pair
that flips with the theme (e.g. `--danger-on-tint`), instead of working around it per file. Raised
2026-08-08; no decision yet. Related: [[tech-dark-theme-token-migration]].
