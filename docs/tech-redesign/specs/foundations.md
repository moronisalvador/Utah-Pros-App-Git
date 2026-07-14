# FOUNDATIONS — Direction B "Apple Field Pro" (canonical spec)

**Status:** LOCKED. Extracted verbatim from the three screens of record —
`direction-b.html` (dashboard), `refine-b-jobhub.html` (job hub), `hydro-b.html` (drying module).
The `.stage` token blocks are byte-identical across all three files (hydro adds three
segmented-control extension tokens, included below). All contrast ratios computed (WCAG 2.x
relative luminance); dark tint backgrounds composited over `#1E1F21` (card surface) before measuring.

**Thesis:** ink is the brand, color is state. Black/ink identity; chromatic color appears ONLY as
the 5 field statuses (amber=OMW, green=working, red=paused, blue=scheduled, gray=done), the
semantic good/warn/critical family they double as, and the focus ring. Persona law: 64-year-old
gloved tech — 48px primary targets, 11px absolute / 12px actionable type floors, primary text
leans >= 7:1, every status carries a redundant shape glyph (arrow=OMW, dot-in-ring=working,
pause-bars=paused, clock=scheduled, check=done).

---

## 1. COLOR

### 1.1 Complete token table (as shipped in the mockups)

Ground / surfaces (light is the default theme; dark is graphite-elevated, strictly neutral — never blue-tinted; cream/beige banned):

| Mockup token | Light | Dark | Role |
|---|---|---|---|
| `--ground` | `#F2F3F5` | `#141416` | App ground behind cards; sticky header background; the shell color |
| `--surface` | `#FFFFFF` | `#1E1F21` | Cards (every `.card`, the dock, the FAB body) |
| `--surface2` | `#F4F5F7` | `#27282B` | Nested insets: secondary buttons, pressed-row background, photo-tile ground, segmented-control track |
| `--page` | `#E3E5E9` | `#0C0C0D` | Desktop stage behind the device frame (mockup-preview only — not an app surface) |

Ink hierarchy (sunlight-first contrast):

| Mockup token | Light | Dark | Role |
|---|---|---|---|
| `--ink` | `#17181A` | `#F3F4F6` | Primary text, active tab, primary-pill background donor |
| `--ink2` | `#4E5157` | `#B6B9BF` | Secondary text: subtitles, summaries, day headers, button glyph tint |
| `--ink3` | `#6A6E74` | `#94979D` | Muted floor: metas, labels, inactive tabs, axis ticks, timestamps |
| `--hair` | `rgba(20,21,24,.09)` | `rgba(243,244,246,.10)` | Hairline: in-card row separators, tab-bar top border, rail track, progress track |

Identity pill (THE primary action — always ink, never a hue):

| Mockup token | Light | Dark | Role |
|---|---|---|---|
| `--pill-bg` | `#17181A` | `#F3F4F6` | Primary pill button fill (black on light, white on dark) |
| `--pill-ink` | `#FFFFFF` | `#141416` | Primary pill label |

The 5 field-status pairs (fg + bg per theme). Retuned colorblind-plausible: amber pushed orange,
green pushed cool. Dark backgrounds are alpha tints of the fg hue (14–16 percent) so they sit
correctly on any dark surface. These hues double as the semantic family: green=good/success,
amber=warn, red=critical/danger, blue=info, gray=neutral.

| Mockup token | Light fg | Light bg | Dark fg | Dark bg | Status |
|---|---|---|---|---|---|
| `--amber` / `--amber-bg` | `#9E4E00` | `#FAEDDD` | `#F2A65A` | `rgba(242,166,90,.15)` | OMW / en_route (shape: arrow) — also semantic warn |
| `--green` / `--green-bg` | `#0A7A42` | `#E0F3E7` | `#54C98B` | `rgba(84,201,139,.15)` | Working (shape: dot-in-ring) — also semantic good |
| `--red` / `--red-bg` | `#BB2727` | `#FBE5E5` | `#F17878` | `rgba(241,120,120,.15)` | Paused (shape: pause-bars) — also semantic critical; badge fill |
| `--blue` / `--blue-bg` | `#1F56C4` | `#E5EDFB` | `#8AB0F7` | `rgba(138,176,247,.16)` | Scheduled (shape: clock) — also semantic info |
| `--gray` / `--gray-bg` | `#5B5F66` | `#ECEDEF` | `#A6ABB2` | `rgba(166,171,178,.15)` | Done / cancelled (shape: check) — also semantic neutral |

Focus, frost, shadows, bezel:

| Mockup token | Light | Dark | Role |
|---|---|---|---|
| `--focus` | `#1F56C4` | `#8AB0F7` | `:focus-visible` outline: 2px solid, offset 2, radius 12 (= the status blue; the one non-status chromatic use) |
| `--frost` | `rgba(255,255,255,.74)` | `rgba(30,31,33,.72)` | THE one frosted surface — the tab bar only. `backdrop-filter: blur(14px) saturate(160%)` + top hairline. Blur cap 14px is law |
| `--sh-card` | `0 1px 2px rgba(16,17,20,.05), 0 10px 28px rgba(16,17,20,.08)` | `0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.40)` | Card elevation (level 1) |
| `--sh-hero` | `0 2px 4px rgba(16,17,20,.05), 0 18px 44px rgba(16,17,20,.12)` | `0 2px 4px rgba(0,0,0,.35), 0 18px 48px rgba(0,0,0,.52)` | Hero / FAB / dock elevation (level 2) |
| `--bezel` | `#101012` | `#232326` | Device-frame border (mockup-preview only — not an app surface) |

Segmented-control extension tokens (added by `hydro-b.html`; theme-scoped so the dark thumb still reads RAISED):

| Mockup token | Light | Dark | Role |
|---|---|---|---|
| `--seg-thumb` | `#FFFFFF` | `#313337` | Selected-segment fill. Dark is one elevated step ABOVE the track (`#27282B`) — deliberately NOT `--surface`, which sits below it |
| `--sh-seg-track` | `inset 0 1px 2px rgba(16,17,20,.05)` | `inset 0 1px 2px rgba(0,0,0,.45)` | Recessed track (the ONLY inset shadow in the system) |
| `--sh-seg-thumb` | `0 1px 2px rgba(16,17,20,.10), 0 3px 8px rgba(16,17,20,.08)` | `inset 0 0 0 1px rgba(243,244,246,.10), 0 1px 2px rgba(0,0,0,.50), 0 3px 8px rgba(0,0,0,.38)` | Raised thumb; dark adds a hairline ring because shadow alone cannot lift a dark-on-dark surface |

Non-color paint token: `--duo` — the duotone icon fill opacity (silhouette fill of the icon body
at `opacity: var(--duo, .16)`). Rest value `.14` on inactive tabs, `.16` default, `.9` on the
active tab. This is how one icon set serves both inactive (outline-dominant) and active
(filled-dominant) states with zero extra artwork.

Hardcoded exceptions (deliberate, documented — the only non-token paint in the system):
- Badge numeral ink: `#fff` on `--red` in light; `#1E1F21` in dark (dark red is a pastel — white would fail).
- Rail done-node glyph: `#fff` on `--green` in light; `#141416` in dark (same reason).

### 1.2 Contrast matrix (computed; WCAG ratio, text-on-ground pairings)

LIGHT theme:

| Pairing | Ratio | Verdict |
|---|---|---|
| ink `#17181A` on surface `#FFFFFF` | 17.77:1 | AAA — primary text lives here |
| ink on ground `#F2F3F5` | 16.00:1 | AAA |
| ink on surface2 `#F4F5F7` | 16.29:1 | AAA |
| ink2 `#4E5157` on surface | 7.96:1 | AAA |
| ink2 on ground | 7.17:1 | AAA — secondary text holds >= 7:1 even off-card |
| ink3 `#6A6E74` on surface | 5.13:1 | AA |
| ink3 on ground | 4.62:1 | AA — **the tightest pairing in the system** (the muted floor; holds >= 4.5 off-card, e.g. date line + tab labels). Do not lighten ink3 or darken ground without re-measuring |
| ink3 on surface2 | 4.70:1 | AA |
| pill-ink on pill-bg | 17.77:1 | AAA — the identity button |
| amber on amber-bg | 5.14:1 | AA |
| green on green-bg | 4.68:1 | AA — tight; chip text is 12px/600, never below |
| red on red-bg | 5.08:1 | AA |
| blue on blue-bg | 5.60:1 | AA |
| gray on gray-bg | 5.48:1 | AA |
| status fgs on white (timeline/timer use): amber 5.93, green 5.42, red 6.12, blue 6.59, gray 6.42 | >= 5.4:1 | AA+; the 48px green timer is large-text AAA |
| badge: `#fff` on red | 6.12:1 | AA (11px/700 numeral — large effective weight, non-actionable) |
| rail node: `#fff` on green | 5.42:1 | AA (glyph, non-text) |

DARK theme (tints composited over surface `#1E1F21`):

| Pairing | Ratio | Verdict |
|---|---|---|
| ink `#F3F4F6` on surface | 14.99:1 | AAA |
| ink on ground `#141416` | 16.72:1 | AAA |
| ink on surface2 `#27282B` | 13.39:1 | AAA |
| ink2 `#B6B9BF` on surface / ground | 8.39 / 9.36:1 | AAA |
| ink3 `#94979D` on surface / ground / surface2 | 5.63 / 6.28 / 5.03:1 | AA (dark ink3 is roomier than light) |
| pill-ink `#141416` on pill-bg `#F3F4F6` | 16.72:1 | AAA |
| amber on amber-tint | 6.06:1 | AA |
| green on green-tint | 5.90:1 | AA |
| red on red-tint | 4.80:1 | AA — tightest dark pairing; chip floor 12px/600 applies |
| blue on blue-tint | 5.57:1 | AA |
| gray on gray-tint | 5.40:1 | AA |
| status fgs bare on surface: amber 8.15, green 7.94, red 6.05, blue 7.57, gray 7.14 | >= 6:1 | AAA-leaning |
| badge: `#1E1F21` on red `#F17878` | 6.05:1 | AA |
| rail node: `#141416` on green `#54C98B` | 8.85:1 | AAA |

**Nothing in either theme falls below 4.5:1.** Flag list (pass, but at the floor — re-verify on any
value change): light ink3/ground 4.62, light green/green-bg 4.68, dark red/red-tint 4.80. Rule:
any text at these pairings is >= 12px weight >= 500, and the muted floor (`ink3`) is never used
for a primary action label.

### 1.3 Production token names (repo CSS-custom-property architecture)

Mechanism honored (survey:architecture): components paint only via `var()`; tokens are defined in
a shell-scope block on `.tech-layout` and re-declared by `[data-theme="dark"] .tech-layout`;
status is consumed by NAME through the frozen `StatusChip` contract (`--status-<key>-bg/-color/-border`)
and `StatusPill`'s semantic tone triplets. The greenfield namespace is `--t-*` (tech), defined on
`.tech-layout`. Frozen consumers keep their existing names as ALIASES pointing at `--t-*` values —
zero component edits, per the KEEP list.

| Mockup token | Production token (on `.tech-layout`) | Aliases to keep frozen consumers working |
|---|---|---|
| `--ground` | `--t-ground` | `--bg-primary: var(--t-ground)` (tech scope) |
| `--surface` | `--t-surface` | `--bg-elevated: var(--t-surface)` |
| `--surface2` | `--t-surface2` | `--bg-secondary`/`--bg-tertiary: var(--t-surface2)` |
| `--page` | — none (mockup stage only; no in-app equivalent) | |
| `--ink` | `--t-ink` | `--text-primary: var(--t-ink)` |
| `--ink2` | `--t-ink2` | `--text-secondary: var(--t-ink2)` |
| `--ink3` | `--t-ink3` | `--text-tertiary: var(--t-ink3)` |
| `--hair` | `--t-hairline` | `--border-color`/`--border-light: var(--t-hairline)` |
| `--pill-bg` / `--pill-ink` | `--t-action-bg` / `--t-action-ink` | (new primitive; `--accent`-family aliases point here inside tech scope) |
| `--amber` / `--amber-bg` | `--t-status-enroute` / `--t-status-enroute-bg` | `--status-enroute-color/-bg/-border` (StatusChip frozen names) |
| `--green` / `--green-bg` | `--t-status-working` / `--t-status-working-bg` | `--status-working-color/-bg/-border`; semantic `--success/-bg/-border` |
| `--red` / `--red-bg` | `--t-status-paused` / `--t-status-paused-bg` | `--status-paused-color/-bg/-border`; semantic `--danger/-bg/-border` |
| `--blue` / `--blue-bg` | `--t-status-scheduled` / `--t-status-scheduled-bg` | `--status-scheduled-color/-bg/-border`; semantic `--info/-bg/-border` |
| `--gray` / `--gray-bg` | `--t-status-done` / `--t-status-done-bg` | `--status-completed-color/-bg/-border` (repo key is `completed`; also serves `cancelled`); semantic `--neutral/-bg/-border`; `--warning/-*` aliases the enroute amber pair |
| `--focus` | `--t-focus` | |
| `--frost` | `--t-frost` | `--tech-nav-bg: var(--t-frost)` |
| `--sh-card` | `--t-shadow-card` | `--tech-shadow-card: var(--t-shadow-card)` |
| `--sh-hero` | `--t-shadow-hero` | |
| `--bezel` | — none (mockup preview chrome) | |
| `--seg-thumb` | `--t-seg-thumb` | |
| `--sh-seg-track` / `--sh-seg-thumb` | `--t-shadow-seg-track` / `--t-shadow-seg-thumb` | |
| `--duo` | `--t-duo` (element-level, set by icon host: rest .14/.16, active .9) | |

Naming rules going forward: status keys match the repo's frozen vocabulary
(`enroute`, `working`, `paused`, `scheduled`, `done`; the alias layer maps `done` to the frozen
`completed` name). The repo trios include a `-border` slot the mockups do not use (chips are
borderless); ship `--status-<key>-border: var(--t-status-<key>-bg)` so the trio contract is
satisfied without introducing a visible border. The JS hex mirrors (`techConstants.js`
color maps, `DIVISION_CONFIG`) are deleted in the reskin — CSS tokens become the single source
(survey:architecture REPLACE list).

### 1.4 Theme swap mechanization

- **Attribute:** `ThemeContext` (existing, KEEP) sets `data-theme="dark|light"` on `<html>`;
  mode persisted in `upr_theme_pref`, `system` follows `matchMedia('(prefers-color-scheme: dark)')`
  live. Direction B ships **both themes designed with equal care; system-auto default** proposed.
- **Blocks:** light values + `color-scheme: light` defined on `.tech-layout`;
  `[data-theme="dark"] .tech-layout` re-declares the SAME `--t-*` names with dark values +
  `color-scheme: dark` (gets native form controls, scrollbars, and keyboard right for free —
  the mockups already ship `color-scheme` per theme). Only `/tech/*` swaps; desktop untouched.
- **Components never know:** `StatusChip` picks token NAMES, the theme block swaps VALUES. The
  only per-theme component rules in the mockups are the two documented hardcoded-glyph exceptions
  (1.1) — carry them as two scoped `[data-theme="dark"]` lines, or better, tokenize as
  `--t-on-status` (light `#fff` / dark `#141416`).
- **Status bar / Capacitor:** the existing ThemeContext effect coordinates `statusBarLight/Dark`;
  point its `theme-color` values at `--t-ground` per theme (`#F2F3F5` / `#141416`).

---

## 2. TYPE

Face: **Source Sans 3** (humanist workwear — warm, sturdy, glanceable). Stack:
`"Source Sans 3", system-ui, -apple-system, sans-serif`. App base: 15px / 1.4, `-webkit-font-smoothing: antialiased`.

### 2.1 Observed census (all three screens)

| Use | Size/weight | Tracking | Line-height | Numerals |
|---|---|---|---|---|
| Hero timer / stage clock (dashboard hero + hub stage) | 48/700 | -0.02em | 1 | tabular + `font-feature-settings:"tnum"`; runs `--green` while WORKING (the 3-foot state lamp) |
| Greeting (`.hdr-hi`) | 26/700 | -0.015em | 1.15 | |
| Hero job name (`.hero-name`) | 23/700 | -0.015em | 1.15 | |
| Numbers cells (`.num-cell .v`) | 22/650 | -0.015em | 1.1 | tabular; ink2 (emphasized cell: ink/700); the "of" denominator inside is 15/600 ink3, tracking 0 |
| Screen title, hub/module header (`.hub-t`) | 20/700 | -0.015em | 1.2 | |
| Hours pills (`.num-pill .v`) | 20/700 | -0.01em | | tabular |
| Meter readings (`.row-vals`) | 17/500 | -0.005em | | tabular, ink3 with 650-ink `.dnum` emphasis spans |
| Primary pill label (`.pill-primary`) | 17/600 | -0.005em | | |
| Section titles (`.sect-title`, `.ck-title`, `.chm-title`, `.mp-name`) | 16/600 | -0.005em | | `text-wrap:balance` on headings |
| Dock primary label (hydro `.dock-primary`) | 16/600 | -0.005em | | |
| Body / row titles / buttons / statusbar (`.row-t`, `.task-t`, `.qbtn`, `.seg-btn`, `.attn-t`, subtitle) | 15/500–600 | -0.005em (titles) | 1.4 base | statusbar tabular |
| Stage action buttons (hub `.act`) | 14/600 | | | |
| Metas (`.row-m`, `.hdr-date`, `.timer-label`, `.hero-when`, `.st-name` 600, day headers 600) | 13/500 (headers 600) | 0 | | tabular on every time/count meta; `.em` spans ink/700 |
| Labels: chips 12/600 · tab labels 12/500 (+0.01em; active 650) · sub-labels/`.st-stamp`/`.pill-note`/dock spans 12/500 | 12/500–600 | +0.01em tabs only | 1.2–1.35 | tabular on stamps |
| Micro: badge numerals 11/700 · meter column headers (`.mp-th`) 11/600 | 11/600–700 | | 16px badge line | tabular; **NEVER actionable text** |

### 2.2 Normalized named scale (the production ramp)

| Token | px / weight | Tracking | Line-height | Use |
|---|---|---|---|---|
| `--t-type-timer` | 48 / 700 | -0.02em | 1 | The live clock only. Always tabular. Color = state |
| `--t-type-display` | 26 / 700 | -0.015em | 1.15 | Greeting / one-per-screen display line |
| `--t-type-title-xl` | 23 / 700 | -0.015em | 1.15 | Hero object name (job, customer) |
| `--t-type-stat` | 22 / 650 | -0.015em | 1.1 | Instrument numerals (numbers row, drying counts). Tabular |
| `--t-type-title-lg` | 20 / 700 | -0.015em | 1.2 | Screen titles (hub/module headers); hours-pill numerals (-0.01em variant) |
| `--t-type-data` | 17 / 500 | -0.005em | 1.3 | Dense reading rows (meter values). Tabular; 650 emphasis spans |
| `--t-type-action` | 17 / 600 | -0.005em | 1 | Primary pill label |
| `--t-type-title` | 16 / 600 | -0.005em | 1.25 | Section/card titles. `text-wrap:balance` |
| `--t-type-body` | 15 / 500 (titles 600) | -0.005em titles, else 0 | 1.4 | Row titles, buttons, body, statusbar |
| `--t-type-meta` | 13 / 500 | 0 | 1.35 | Metas, timestamps, sublines (600 for mini-headers). Tabular when numeric |
| `--t-type-label` | 12 / 600 (tabs 500, active 650) | +0.01em tabs | 1.2–1.35 | Chips, tab labels, stamps, dock labels. **12px = the actionable floor** |
| `--t-type-micro` | 11 / 600–700 | 0 | tight | Badge numerals, column headers ONLY. Never actionable, never body |

Rules:
- **The micro band is exactly three steps** below body: 13 meta, 12 label, 11 micro. Do not invent 14px or 12.5px variants (14/600 exists once — the hub stage-action compact buttons — treat as the documented compact-action exception).
- **tabular-nums law:** `font-variant-numeric: tabular-nums` on every timer, count, time, currency, and reading — anything that ticks or aligns in a column. The 48px timer adds `font-feature-settings:"tnum"`.
- **Tracking is size-proportional:** -0.02em at 48, -0.015em at 20–26, -0.01em at 20 numerals, -0.005em at 15–17 titles, 0 at metas, +0.01em at 12px tab labels. Never track-expand headings (ALLCAPS eyebrow style is banned).
- Weight vocabulary: 400 (reserved/rare), 500 (quiet text), 600 (titles, labels, actions), 650 (stat numerals, active tab label — a variable-font-only weight), 700 (display, timer, emphasis spans, badges).

### 2.3 Source Sans 3 self-host spec (perf-budget compliant)

- **One variable woff2 file**, weight axis `400 700` (~28 KB — the mockups embed it base64; production self-hosts the file). Declaration verbatim:
  ```css
  @font-face {
    font-family: "Source Sans 3";
    font-style: normal;
    font-weight: 400 700;
    font-display: swap;
    src: url(/fonts/source-sans-3-var.woff2) format("woff2");
  }
  ```
- `font-display: swap`; fallback stack `system-ui, -apple-system, sans-serif` (metrics-compatible enough that swap reflow is minor at these sizes).
- No render-blocking font stylesheet (perf-budget bans new render-blocking third-party requests; W5 self-hosts). Preload the single woff2 on the tech shell entry. No italic face shipped (nothing in the system uses italic). Latin subset only; extend only if i18n locales require.
- The 650 weight requires the variable file — do not substitute static 400/600/700 cuts.

---

## 3. SPACING

Observed values across the three screens: 2, 4, 8, 12, 16, 20, 24, 32 (+ icon-text gaps of 5/7/9 and micro-nudges of 1–3px).

Normalized 4/8 step scale:

| Token | px | Observed use |
|---|---|---|
| `--t-space-1` | 4 | Dock inner gap, chip inner gaps, tiny stacks |
| `--t-space-2` | 8 | Grid gaps (quick actions, number cells), dock padding, title-to-content |
| `--t-space-3` | 12 | Row vertical padding, in-card stacks, hero element rhythm |
| `--t-space-4` | 16 | **Page gutter** (`.main` and card horizontal padding), section spacing |
| `--t-space-5` | 20 | Hero card padding |
| `--t-space-6` | 24 | Section-title top margin (section rhythm) |
| `--t-space-8` | 32 | Reserved large break (rare) |

Documented optical exceptions (not scale violations): icon-to-text gaps of 5/7/9px (icon optical
boxes make the true gap read as 8/12); 1–3px baseline nudges between a title and its meta line;
the tab bar's `7px 6px` chrome padding. Keep them as literals with a comment, or absorb into the
icon components' optical box.

Structural paddings of record: row = `12px 16px`; card header = `14px 16px`; hero = `20px 20px 16px`;
chip = `4px 10px 4px 8px` (tighter on the icon side); tab bar = `7px 6px calc(14px + env(safe-area-inset-bottom, 0px))`;
scroll body bottom padding clears dock + tab bar (190–264px per screen).

---

## 4. RADIUS

The family (large, continuous, iOS-calm):

| Token | px | Use |
|---|---|---|
| `--t-radius-card` | 20 | Outer cards (every `.card`) |
| `--t-radius-dock` | 18 | Floating docks/action bars (one step under card — they are smaller surfaces) |
| `--t-radius-seg` | 15 | Segmented-control track (= 12 thumb + 3 track padding, see nesting rule) |
| `--t-radius-tile` | 14 | Nested tiles: secondary buttons (`.qbtn`), icon buttons, hub back button |
| `--t-radius-control` | 12 | Controls and inner rows: dock buttons, photo tiles, row press-highlight, seg thumb, attention icons, focus-ring radius |
| `--t-radius-full` | 999 | Chips, pills, badges, FAB, rail nodes, checklist rings, primary pill |

**Nesting rule (law):** inner radius < outer radius, always. Concentric surfaces follow
`outer = inner + padding` (proven by the segmented control: 12px thumb + 3px padding = 15px track;
and the dock: 12px buttons + 8px padding vs 18px shell — visually concentric). Never give a nested
element the same radius as its parent.

---

## 5. ELEVATION

Two committed shadow levels — never more, never ad-hoc:

| Level | Token | Recipe (light) | Recipe (dark) | Carries |
|---|---|---|---|---|
| 1 — resting card | `--t-shadow-card` | `0 1px 2px rgba(16,17,20,.05), 0 10px 28px rgba(16,17,20,.08)` | `0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.40)` | All cards |
| 2 — floating | `--t-shadow-hero` | `0 2px 4px rgba(16,17,20,.05), 0 18px 44px rgba(16,17,20,.12)` | `0 2px 4px rgba(0,0,0,.35), 0 18px 48px rgba(0,0,0,.52)` | NOW hero, FAB, docked capture bar |

Recipe anatomy: a tight contact shadow + a wide soft ambient, both ink-tinted (`rgba(16,17,20,…)`)
in light; dark swaps to black halos at much higher alpha (shadow must fight an already-dark ground).
Plus the segmented-control pair (1.1): the ONLY inset shadows in the system (recessed track), and
the dark thumb's hairline ring — the documented pattern for raising a dark surface on a dark surface.

**Hairlines instead of shadows** (`--t-hairline`, 1px) for separation WITHIN an elevated surface:
row separators inside cards, card-header underlines, the rail track, progress tracks, the tab-bar
top edge. Rule: shadow = a surface floats over the ground; hairline = regions divide within one
surface. Never both on the same edge; never a border around a shadowed card.

**Frost budget:** exactly ONE frosted surface per screen — the tab bar
(`--t-frost` + `blur(14px) saturate(160%)` + top hairline). The dock is deliberately SOLID
(`--t-surface` + level 2) because the frost budget is spent. Blur must stay <= 14px (WKWebView
scroll cost, perf-budget).

---

## 6. DENSITY (row heights and target law)

| Surface | Height | Rule |
|---|---|---|
| Primary field action (pill) | 54px fixed | The one black pill per screen |
| Checklist / task rows | min 56px | Glove-checkable; 28px visual ring inside a full-row hit area |
| Dock buttons (capture bar) | min 56px (min-width 54px) | Field capture = primary tier |
| Secondary action buttons (`.qbtn`), hub back, address row, stage actions | 48px / min-height 48px | **48px = the interactive floor for field actions** |
| Tab bar tabs | min-height 48px | full-column hit area |
| Header utility icon buttons (bell/help/more) | 44px | Documented-secondary ONLY (non-field utilities), each carries a comment |
| Segmented control buttons | min 44px | Documented-secondary: the full-width half-track makes the true target huge |
| List rows (`.row`) | ~48–52px via `12px 16px` padding | whole row tappable |
| Meter/data rows | min 52px | data-dense but still tappable |
| Icon tiles (attention/done/photo icons) | 36px | NON-interactive glyph containers (the row is the target) |
| Rail nodes | 32px | non-interactive progress markers |
| Timeline blocks | 36px | glance-only graphic; explicitly NOT a tap surface (proportional widths cannot honor 44px) — the rows below remain the tap surface |
| Badges | 16px | display-only |

Laws: hit areas < 24px are banned outright. 44px requires a "documented-secondary" comment at the
declaration site. Full-bleed hit extension is the sanctioned trick for text-y targets
(negative margin + padding, e.g. the hero address row: `margin: 12px -6px 0; padding: 12px 6px; min-height: 48px`).
One primary action per screen: the pill owns it; FAB (56px, level-2 shadow, the one springy
one-shot enter) and rows are subordinate.

---

*Companion specs build on this file: components (chips, rows, docks, rails), icons (duotone 24px
grid, 1.8 stroke, round caps, `--t-duo` fills), and motion (press `scale(.97)` 120ms ease-out;
one FAB spring; reduced-motion collapses all) are specified separately and must consume these
tokens by name.*
