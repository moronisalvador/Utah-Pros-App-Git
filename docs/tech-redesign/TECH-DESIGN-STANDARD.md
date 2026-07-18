<!--
════════════════════════════════════════════════
FILE: TECH-DESIGN-STANDARD.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  The written design standard for the /tech/* field-technician app redesign
  ("Apple Field Pro", Direction B — locked). It defines every color, type size,
  spacing step, icon, component, motion rule, and screen layout the rebuilt tech
  screens must follow, and the rules a build session is graded against. For
  /tech/* it replaces the old design-system document.

DEPENDS ON:
  Internal:  .claude/rules/motion-standard.md (motion law) ·
             .claude/rules/tech-mobile-ux.md (persona law) ·
             .claude/rules/page-lifecycle.md · .claude/rules/loading-error-states.md ·
             .claude/rules/perf-budget.md · .claude/rules/close-out-standard.md ·
             CLAUDE.md non-negotiables · src/index.css token architecture (F-S2) ·
             src/components/ui/, src/components/tech/v2/, src/hooks/ (kept mechanisms)
  Visual reference of record: docs/tech-redesign/mockups/ — the four files named in
  section 1.5 ONLY (direction-b, refine-b-jobhub, hydro-b, hub-challenge-flow).
  Detail specs of record: docs/tech-redesign/specs/ (six files, see sections 5 and 6).

NOTES / GOTCHAS:
  - Scope is /tech/* ONLY. The desktop app keeps UPR-Design-System.md unchanged.
  - This doc is the ACCEPTANCE SPEC for the build wave: a reviewer checks the
    built screen against these values, not against memory or taste.
  - Where this doc and a mockup literal disagree on a motion value, the
    motion-standard law and the retarget table in section 7 win.
════════════════════════════════════════════════
-->

# Tech Design Standard — "Apple Field Pro" (/tech/* greenfield)

**Last-verified: 2026-07-14** · Status: **LOCKED** (Direction B, owner decision 2026-07-14,
proven on four screens of record). Thesis: **ink is the brand; color is state.**

---

## 1. Scope and precedence

1. **Applies to `/tech/*` only** — every screen, sheet, and component rendered inside
   `TechLayout`. The desktop/office app keeps `UPR-Design-System.md` and its existing tokens
   untouched. The two systems never mix on one screen (icon sets included).
2. **For `/tech/*`, this document supersedes `UPR-Design-System.md`.** Where the old doc and
   this one disagree inside the tech shell, this one wins.
3. **This document is subordinate to law:** CLAUDE.md non-negotiables and the `.claude/rules/*`
   standards (`motion-standard.md` v2, `page-lifecycle.md`, `loading-error-states.md`,
   `perf-budget.md`, `tech-mobile-ux.md`, `workers-standard.md`, `close-out-standard.md`,
   `database-standard.md`). Where this doc and a rule file conflict, the rule file wins and the
   conflict is a defect in this doc — flag it, do not improvise.
4. **Mechanism vs values:** the redesign KEEPS the repo's architecture (CSS custom properties,
   shell-scoped theme blocks, `src/components/ui/` behavior contracts, tech-v2 primitives and
   hooks, reserved CSS markers, `nav.js` href indirection) and REPLACES every visual value
   (colors, shadows, radii, type numbers, icon artwork, motion literals). The KEEP/REPLACE
   ruling of the architecture survey is binding; section 10 restates the must-not-break list.
5. **Visual reference of record — exactly four files, named:**
   `docs/tech-redesign/mockups/direction-b.html` (dashboard),
   `docs/tech-redesign/mockups/refine-b-jobhub.html` (job hub),
   `docs/tech-redesign/mockups/hydro-b.html` (drying module), and
   `docs/tech-redesign/mockups/hub-challenge-flow.html` (the sanctioned flow-challenger
   Finish variant only). Where prose is ambiguous, the mockup pixel in THESE files is the
   tiebreaker — except motion literals (section 7 retargets them to tokens).
   **Non-normative files in the same directory (never build from these):**
   `direction-a.html` is the REJECTED direction; `hub-challenge-deck.html` and
   `hub-challenge-story.html` are unsanctioned challenger variants (the story variant's
   approved fold-ins are already absorbed into section 8.2 — the file itself is not a
   reference). A screen built from a non-normative file fails review regardless of craft.

## 2. Principles

**Grading note:** this section is thesis/context. Its prose ("$50k tool", "equal care") is
not separately gradeable — a reviewer grades the verifiable form of each principle, which
lives in sections 3–9 (each item below names its check where one exists). Where a §2
sentence and a numbered check appear to conflict, grade the check.

1. **Ink is the brand; color is state.** Identity is carried by near-black ink, typography,
   and spacing craft — never a brand hue. Chromatic color appears ONLY as: the 5 field
   statuses (amber = OMW, green = working, red = paused, blue = scheduled, gray = done), the
   semantic family they double as (green good, amber warn/needs-action, red critical, blue
   info, gray neutral), and the focus ring. Primary actions are ink: black pill on light,
   white pill on dark.
2. **Refined, field-proofed persona dial.** Premium finish on non-negotiable field bones:
   the 64-year-old gloved tech in a flooded basement in sunlight. 48px primary targets,
   11px/12px type floors, primary text leaning 7:1 contrast, one-tap comprehension. It should
   read as a $50k tool that happens to be effortless in gloves.
3. **Glance-and-gate IA.** The dashboard glances across jobs; the hub glances within a job;
   the module goes deep. A module's full instrument never renders inside the hub — the hub
   shows a gateway row plus at most one escalation row (section 6.F, section 8).
4. **One primary action per screen.** Exactly one black pill (or one black dock pill) per
   screen; the FAB, rows, and quiet buttons are subordinate. Never two black pills visible
   at once.
5. **Both themes equal.** Light is the design baseline (true white / soft neutral gray;
   cream and beige banned); dark is graphite-elevated neutral (never blue-tinted, never
   pure-black surfaces). **The check:** "equal care" = the section 3 dark token column
   shipped verbatim + the section 3.4 contrast watch-list re-measured — nothing else counts
   as passing this rule. The shipped default theme MODE (system-auto vs light) is an open
   owner decision — see section 11 item 11; a build session seeds nothing until it is made.
6. **Status is shape-redundant, always.** Every status carries a glyph and a word beside its
   color: arrow = OMW, dot-in-ring = working, pause-bars = paused, clock = scheduled/due,
   check = done/dry/signed, drop = wet, flag = finish goal. State must survive grayscale and
   read from 3 feet.
7. **Banned outright:** side-stripe status borders, gradient text, gradient/stat-card tiles,
   decorative glassmorphism (exactly ONE frosted surface — the tab bar), ALLCAPS tracked
   eyebrow labels, numbered section decoration, cream/beige grounds, blue-tinted "midnight"
   dark, emoji anywhere (including as icons), lorem, text arrows.

## 3. Tokens

Namespace: **`--t-*`**, defined on `.tech-layout`; dark values re-declared by
`[data-theme="dark"] .tech-layout`. Components paint via `var()` only — a raw hex or px where
a token exists is a `design-consistency-checker` failure.

### 3.1 Color — surfaces and ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `--t-ground` | `#F2F3F5` | `#141416` | App ground behind cards; sticky header background; shell color |
| `--t-surface` | `#FFFFFF` | `#1E1F21` | Cards, dock, FAB body, sheets |
| `--t-surface2` | `#F4F5F7` | `#27282B` | Nested insets: secondary buttons, pressed-row background, photo-tile ground, seg track, field fill |
| `--t-ink` | `#17181A` | `#F3F4F6` | Primary text, active tab |
| `--t-ink2` | `#4E5157` | `#B6B9BF` | Secondary text: subtitles, summaries, button glyph tint |
| `--t-ink3` | `#6A6E74` | `#94979D` | Muted floor: metas, labels, inactive tabs, timestamps |
| `--t-hairline` | `rgba(20,21,24,.09)` | `rgba(243,244,246,.10)` | In-card row separators, tab-bar top border, rail/progress tracks |
| `--t-action-bg` | `#17181A` | `#F3F4F6` | THE primary pill fill (black on light, white on dark) |
| `--t-action-ink` | `#FFFFFF` | `#141416` | Primary pill label |

### 3.2 Color — the 5 field statuses (fg + bg pairs; dark bg = alpha tint of the fg)

| Token pair | Light fg / bg | Dark fg / bg | Status (shape glyph) · semantic double |
|---|---|---|---|
| `--t-status-enroute(-bg)` | `#9E4E00` / `#FAEDDD` | `#F2A65A` / `rgba(242,166,90,.15)` | OMW (arrow) · warn / "needs action this visit" |
| `--t-status-working(-bg)` | `#0A7A42` / `#E0F3E7` | `#54C98B` / `rgba(84,201,139,.15)` | Working (dot-in-ring) · good/success |
| `--t-status-paused(-bg)` | `#BB2727` / `#FBE5E5` | `#F17878` / `rgba(241,120,120,.15)` | Paused (pause bars) · critical/danger |
| `--t-status-scheduled(-bg)` | `#1F56C4` / `#E5EDFB` | `#8AB0F7` / `rgba(138,176,247,.16)` | Scheduled (clock) · info |
| `--t-status-done(-bg)` | `#5B5F66` / `#ECEDEF` | `#A6ABB2` / `rgba(166,171,178,.15)` | Done / cancelled (check) · neutral |

`--t-on-status`: light `#fff`, dark `#141416` — glyph/numeral ink on solid status fills
(badge numeral on red, rail node check on green). This tokenizes the mockups' two documented
hardcoded exceptions.

### 3.3 Color — focus, frost, shadows, overlays, fields

| Token | Light | Dark | Role |
|---|---|---|---|
| `--t-focus` | `#1F56C4` | `#8AB0F7` | `:focus-visible` outline: 2px solid, offset 2, radius 12 (equals status blue — the one non-status chromatic use) |
| `--t-focus-halo` | `rgba(31,86,196,.20)` | `rgba(138,176,247,.28)` | Field/search focus halo (`0 0 0 3px`) |
| `--t-frost` | `rgba(255,255,255,.74)` | `rgba(30,31,33,.72)` | THE one frosted surface — tab bar only; `backdrop-filter: blur(14px) saturate(160%)`; blur cap 14px is law |
| `--t-shadow-card` | `0 1px 2px rgba(16,17,20,.05), 0 10px 28px rgba(16,17,20,.08)` | `0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.40)` | Elevation level 1 — every resting card |
| `--t-shadow-hero` | `0 2px 4px rgba(16,17,20,.05), 0 18px 44px rgba(16,17,20,.12)` | `0 2px 4px rgba(0,0,0,.35), 0 18px 48px rgba(0,0,0,.52)` | Elevation level 2 — hero card, FAB, dock, sheets, toasts |
| `--t-seg-thumb` | `#FFFFFF` | `#313337` | Selected-segment fill; dark is one step ABOVE the track, deliberately not `--t-surface` |
| `--t-shadow-seg-track` | `inset 0 1px 2px rgba(16,17,20,.05)` | `inset 0 1px 2px rgba(0,0,0,.45)` | Recessed track / field inset (the ONLY inset shadow) |
| `--t-shadow-seg-thumb` | `0 1px 2px rgba(16,17,20,.10), 0 3px 8px rgba(16,17,20,.08)` | `inset 0 0 0 1px rgba(243,244,246,.10), 0 1px 2px rgba(0,0,0,.50), 0 3px 8px rgba(0,0,0,.38)` | Raised thumb; dark adds a hairline ring (the documented dark-on-dark lift) |
| `--t-scrim` | `rgba(12,12,13,.44)` | `rgba(0,0,0,.60)` | Sheet/modal scrim, FAB dim |
| `--t-sheet-handle` | `rgba(20,21,24,.16)` | `rgba(243,244,246,.20)` | Sheet drag handle |
| `--t-skel` | `#E9EAED` | `#27282B` | Skeleton block base |
| `--t-skel-hi` | `rgba(255,255,255,.55)` | `rgba(243,244,246,.05)` | Skeleton shimmer sweep |
| `--t-field-border` | `rgba(20,21,24,.10)` | `rgba(243,244,246,.12)` | Resting input border (one step above hairline) |
| `--duo` | element-level | element-level | Duotone icon fill opacity: rest `.14`/`.16`, active tab `.9`. Set by the icon HOST, never baked into artwork. **The ONE deliberate exception to the `--t-*` namespace** — every fill layer in the shipped path source reads `var(--duo, .16)` (sections 3.9, 5.1); it is an element-level knob scoped under `.tech-layout`, not a theme value. Writing `--t-duo` on a host is a defect (the fill layers cannot see it) |

Layout constant (theme-invariant, defined once on `.tech-layout`, deliberately outside the
theme swap): `--safe-top: env(safe-area-inset-top, 0px)` — consumed by sheet max-height
(section 6.E item 30). Consumers still carry the `, 0px)` fallback inline.

### 3.4 Contrast floors (computed; re-measure on ANY value change)

Nothing in either theme falls below 4.5:1. Watch list at the floor: light `ink3`/`ground`
4.62, light `working` chip 4.68, dark `paused` chip 4.80. Rules: text at these pairings is
at least 12px weight 500; the muted floor (`--t-ink3`) is never a primary action label; chip
text is 12px/600, never smaller. Primary text pairings hold AAA (ink on surface 17.77:1
light, 14.99:1 dark; pill 17.77:1 / 16.72:1).

### 3.5 Spacing (4/8 step scale)

| Token | px | Use |
|---|---|---|
| `--t-space-1` | 4 | Chip inner gaps, dock inner gap, tiny stacks |
| `--t-space-2` | 8 | Grid gaps, dock padding, title-to-content |
| `--t-space-3` | 12 | Row vertical padding, in-card stacks |
| `--t-space-4` | 16 | **Page gutter** (main and card horizontal padding), section spacing |
| `--t-space-5` | 20 | Hero card padding |
| `--t-space-6` | 24 | Section-title top margin |
| `--t-space-8` | 32 | Reserved large break (rare) |

Documented optical exceptions (literals with a comment, never scale drift): icon-to-text gaps
of 5/7/9px; 1 to 3px baseline nudges; tab-bar chrome padding `7px 6px`. Structural paddings
of record: row `12px 16px`; card header `14px 16px`; hero `20px 20px 16px`; chip
`4px 10px 4px 8px`; tab bar top/side `7px 6px`.

**Tab-bar BOTTOM padding is CLAUDE.md Rule 11, verbatim and non-negotiable:**
`padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))` (live at the `.tech-nav`
rule). **Conflict flag (per section 1.3):** the mockups paint
`calc(14px + env(safe-area-inset-bottom, 0px))` — a different value both with and without
an inset. Rule 11 wins; the mockup literal is a defect in the mockup and retargets at build
time (section 7.4 item 7). Do not copy the mockup value, and do not "split the difference."

### 3.6 Radius family (large, continuous; nesting law)

| Token | px | Use |
|---|---|---|
| `--t-radius-card` | 20 | Outer cards; sheet top corners |
| `--t-radius-dock` | 18 | Floating docks/action bars |
| `--t-radius-seg` | 15 | Segmented-control track |
| `--t-radius-tile` | 14 | Nested tiles: secondary buttons, icon buttons, toasts, banners |
| `--t-radius-control` | 12 | Controls, inner rows, fields, photo tiles, seg thumb, focus-ring radius |
| `--t-radius-full` | 999 | Chips, pills, badges, FAB, rail nodes, check circles |

**Nesting law:** inner radius is always smaller than outer; concentric surfaces follow
`outer = inner + padding` (seg: 12 thumb + 3 padding = 15 track). Never give a nested element
its parent's radius. Never nest a 20-radius card inside a card.

### 3.7 Elevation law

Two committed shadow levels, never more, never ad-hoc: `--t-shadow-card` (resting cards) and
`--t-shadow-hero` (hero, FAB, dock, sheets, toasts). Hairlines (`--t-hairline`, 1px) divide
regions WITHIN a surface; shadows float a surface OVER the ground. Never both on one edge;
never a border around a shadowed card. Frost budget: exactly one frosted surface per screen —
the tab bar; the dock is solid by design. `backdrop-filter` anywhere else is a defect.

### 3.8 Motion tokens

Tech surfaces consume the F-S2 catalog names already live in `src/index.css :root` —
`--motion-duration-fast` (~120ms), `--motion-duration-base` (~200-240ms),
`--motion-duration-slow` (~320ms), `--motion-ease-standard`, `--motion-ease-decelerate`
(enters), `--motion-ease-accelerate` (exits), `--motion-spring-in` (`linear()` spring, enters
only). The legacy combined `--transition-fast/base` tokens are never consumed by new tech CSS.
Section 7 maps components to tokens.

### 3.9 Swap mechanism and theme mechanics (the F-S2 architecture, honored)

- Tokens are defined in a shell-scope block on `.tech-layout` (with `color-scheme: light`);
  `[data-theme="dark"] .tech-layout` re-declares the SAME names with dark values (with
  `color-scheme: dark`). Only `/tech/*` swaps; desktop is untouched by the same `<html>`
  attribute.
- **`ThemeContext` is kept as-is:** `data-theme` on `<html>`, `upr_theme_pref` persistence,
  live `matchMedia` follow for `system`, Capacitor status-bar coordination. Point the
  `theme-color` values at `--t-ground` per theme (`#F2F3F5` / `#141416`).
- **Components never know the theme.** `StatusChip` keeps selecting token NAMES
  (`--status-<key>-bg/-color`); the theme block swaps VALUES. Frozen consumers keep their
  existing names as ALIASES pointing at `--t-*` (tech scope): `--bg-primary` at `--t-ground`,
  `--bg-elevated` at `--t-surface`, `--bg-secondary`/`--bg-tertiary` at `--t-surface2`,
  `--text-primary/-secondary/-tertiary` at `--t-ink/-2/-3`, `--border-color`/`--border-light`
  at `--t-hairline`, `--tech-nav-bg` at `--t-frost`, `--tech-shadow-card` at
  `--t-shadow-card`, the `--status-<key>-color/-bg/-border` trios at the `--t-status-*` pairs
  (ship `-border: var(--t-status-<key>-bg)` — chips are borderless, the alias satisfies the
  trio contract with no visible border), and the semantic `--success/--danger/--warning/
  --info/--neutral` triplets at the matching status pairs (`--warning-*` aliases the enroute
  amber pair; the repo key `completed` aliases `done` and also serves `cancelled`).
- **JS hex mirrors are deleted:** `techConstants.js` color maps (`APPT_STATUS_COLORS`,
  `CLAIM_STATUS_COLORS`, `DIV_*`, `TYPE_CONFIG` hex/emoji) and `DivisionIcons.jsx`
  `DIVISION_CONFIG`/`LOSS_CONFIG` hexes. CSS tokens become the single paint source; anything
  that bypasses `var()` is invisible to the theme swap and therefore a defect in the reskin.

## 4. Typography

Face: **Source Sans 3** (humanist workwear). Stack:
`"Source Sans 3", system-ui, -apple-system, sans-serif`. App base 15px / 1.4,
`-webkit-font-smoothing: antialiased`.

### 4.1 The production ramp

| Token | px / weight | Tracking | Line-height | Use |
|---|---|---|---|---|
| `--t-type-timer` | 48 / 700 | -0.02em | 1 | The live clock only. Always tabular (`tnum`). Color = current state |
| `--t-type-display` | 26 / 700 | -0.015em | 1.15 | Greeting — the only 26px text in the system |
| `--t-type-title-xl` | 23 / 700 | -0.015em | 1.15 | Hero object name (job, customer) |
| `--t-type-stat` | 22 / 650 | -0.015em | 1.1 | Instrument numerals (numbers row, drying counts). Tabular |
| `--t-type-title-lg` | 20 / 700 | -0.015em | 1.2 | Screen titles (hub/module headers); hours-pill numerals take a -0.01em variant |
| `--t-type-data` | 17 / 500 | -0.005em | 1.3 | Dense reading rows (meter values). Tabular; 650-weight ink emphasis spans |
| `--t-type-action` | 17 / 600 | -0.005em | 1 | Primary pill label |
| `--t-type-title` | 16 / 600 | -0.005em | 1.25 | Section/card titles. `text-wrap: balance` |
| `--t-type-body` | 15 / 500 (titles 600) | -0.005em titles, else 0 | 1.4 | Row titles, buttons, body |
| `--t-type-meta` | 13 / 500 | 0 | 1.35 | Metas, timestamps, sublines (600 for mini-headers). Tabular when numeric |
| `--t-type-label` | 12 / 600 (tabs 500, active 650) | +0.01em tabs only | 1.2-1.35 | Chips, tab labels, stamps, dock labels. **12px = the actionable floor** |
| `--t-type-micro` | 11 / 600-700 | 0 | tight | Badge numerals and table column headers ONLY. Never actionable, never body |

Rules:
- The micro band is exactly three steps below body: 13 meta, 12 label, 11 micro. Do not
  invent 14px or 12.5px variants. **The complete 14/600 census — exactly three sanctioned
  compact-action uses, nowhere else:** (a) hub stage-action buttons, (b) the inline capture
  pair (section 6.D item 16), (c) the action toast's trailing text action (section 6.E
  item 31). The source spec's optional error-state 14/600 secondary text link is **NOT
  adopted** — section 6.E item 34 is the error-state shape of record (quiet 48px button /
  13/600 banner Retry). A fourth 14/600 use is a review failure until added to this list.
- **tabular-nums law:** `font-variant-numeric: tabular-nums` on every timer, count, time,
  currency, and reading — anything that ticks or aligns in a column. The 48px timer adds
  `font-feature-settings: "tnum"`.
- Tracking is size-proportional (values above); never track-expand headings.
- Weight vocabulary: 400 rare, 500 quiet text, 600 titles/labels/actions, 650 stat numerals
  and active tab label (variable-font-only weight), 700 display/timer/emphasis/badges.
- **16px is law on every focusable text input and select** (iOS anti-zoom).

### 4.2 Self-host spec (perf-budget compliant)

One variable woff2, weight axis `400 700` (~28 KB), self-hosted at
`/fonts/source-sans-3-var.woff2`:

```css
@font-face {
  font-family: "Source Sans 3";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url(/fonts/source-sans-3-var.woff2) format("woff2");
}
```

Preload the single file on the tech shell entry. No render-blocking font stylesheet. No
italic face. Latin subset only unless i18n requires more. The 650 weight requires the
variable file — never substitute static cuts.

## 5. Iconography

Full spec — exact SVG path data for all 29 shipped glyphs and the drawing briefs for every
gap icon — is committed at **`docs/tech-redesign/specs/icons.md`** (the spec of record; a
builder draws gap glyphs from its briefs, never from the name list below). This section is
the binding contract; where the two disagree, this standard wins.

### 5.1 System rules

1. **Grid:** `viewBox="0 0 24 24"` always; live area roughly x/y 3.8 to 20.5; optical
   centering beats mathematical.
2. **Stroke:** 1.8 for every icon with a silhouette; round caps and joins. Micro-glyphs
   (pure line marks: check, chevrons, trend, plus, minus, x) use stroke 2. The FAB plus is
   the one heavier outlier at 2.2.
3. **Duotone construction:** body layer `fill="currentColor"` at `opacity: var(--duo, .16)`
   plus an outline stroke layer on the same path; detail strokes on top; tiny solid accents
   at full opacity kept under ~2px radius. `--duo` is the single tuning knob (inactive tab
   `.14`, default `.16`, active tab `.9`) — never bake an opacity literal into the fill.
4. **Solid exceptions** (no duo layer): pause bars, dot triads, punctuation dots, the diamond
   milestone. **Pure-line exceptions** (no fill layer): check, chevrons, trend, plus, air.
5. **Corners:** friendly — rounded rects `rx` 2.8 to 3.6; bars full-round; organic forms
   soft continuous curves. Nothing square.
6. **Optical size tiers** (render sizes of ONE master drawing — never per-size art):
   13px chip/meta glyphs (only the simplest glyphs may render this small); 16 to 19px row
   icons (canonical 19); 22 to 26px tab bar / header / dock. If a glyph muddies at its
   floor, simplify the drawing — never thicken the stroke per instance.
7. **State duality without second drawings:** the active tab raises the fill
   (`.tab { --duo:.14 } .tab.active { --duo:.9; color:var(--t-ink) }`). The legacy
   filled/outline icon pairs are retired.
8. **Color:** everything is `currentColor`. An icon never carries its own hex; chromatic
   color reaches a glyph only through its container's status/semantic color.
9. **A11y:** decorative icons `aria-hidden="true"`; icon-only buttons rely on the
   IconButton required-label contract. Icons never shrink a hit target.
10. **No emoji, ever.** Every pictograph in the product (legacy `TYPE_CONFIG` emoji,
    ErrorState defaults, x characters) is replaced by an icon from this system.

### 5.2 Set inventory

**Shipped core (29 canonical glyphs / 30 symbol ids):** `i-house, i-folder, i-cal, i-chat,
i-dots-h, i-dots-v, i-bell, i-help, i-warn, i-check, i-chev, i-chev-l, i-plus, i-clock,
i-dotring, i-pause, i-flag, i-pin, i-camera, i-photo, i-note, i-doc, i-person, i-phone,
i-drop, i-air, i-dehu, i-therm, i-gauge, i-trend`.

Merge/naming rulings (binding): `i-drop` canonical is the v2 narrow drop (dashboard's v1
re-points, no highlight arc); `i-camera` (capture action) and `i-photo` (gallery content)
both stay and never swap; `i-note` (text-lines card) vs `i-doc` (folded-corner file) never
swap; `i-dots-h` (More tab, overflow) vs `i-dots-v` (kebab) never rotate into each other;
the shipped `i-trend` drawing ships as `i-trend-down` with a mirrored `i-trend-up` added
(`i-trend` remains an alias of `i-trend-down` until screens re-point).

**Gap list (50 new symbol ids, drawn in the same hand; 47 original + 3 cloud compositions):**
- Navigation/chrome: `i-search, i-filter, i-gear, i-x, i-x-circle, i-info, i-diamond`
- Actions: `i-pencil, i-trash, i-share, i-download, i-copy, i-external, i-send, i-attach,
  i-navigate, i-refresh, i-logout, i-play, i-plus-circle, i-minus, i-check-circle`
- Communication/sync: `i-bell-off, i-people, i-cloud, i-cloud-sync, i-cloud-off,
  i-cloud-check, i-mail, i-device`
- Security/signing/media: `i-lock, i-signature, i-video, i-key, i-briefcase`
- Domain/tools: `i-checklist, i-clipboard, i-dollar, i-calc, i-hammer, i-eye, i-pulse,
  i-fan, i-door, i-bug, i-bulb, i-globe, i-sun, i-moon, i-trend-up`

Projected full set: 79 canonical glyphs. Chevron-down/up = `i-chev` rotated via CSS on the
consumer (sanctioned; no new drawing). Deliberately NOT drawn (no census consumer): star,
microphone, printer, wifi, grid/list toggles — add only when a real surface lands, through
this spec.

### 5.3 Consumption contract

- One module (working name `src/components/tech/icons.jsx`) with **named per-icon exports**,
  built from a shared factory: `size` prop (number, default 24) sets width/height; caller
  passes the optical tier (`size={13}` chips, `19` rows, `25` tabs); explicit
  `width`/`height` attributes and CSS-rule sizing still win (props spread onto the root svg).
  `strokeWidth` prop exists only for the documented exceptions; micro-glyphs default 2.
  No `color` prop; no `filled` prop (the `--duo` raise replaces the duality). Default
  `aria-hidden="true"`, suppressed when the caller passes `aria-label`.
- **Sprite parity:** the same artwork is emitted as a `<symbol>` sprite (`i-*` ids) for
  non-React surfaces; React components and sprite generate from ONE path-data source.
- **Keyed domain API kept, artwork redrawn:** `TypeIcon type=… size=…` registry (mitigation
  = drop, reconstruction = hammer, inspection = eye, monitoring = pulse, estimate =
  clipboard, other = folder). Colors do NOT live in the registry — containers carry the
  token class; glyphs inherit `currentColor`.
- **Tab bar:** the nav registry keeps its `{ key, label, path, Icon, exact }` shape; icons
  render at `size={25}`; active state is pure CSS (`--duo:.9` + ink + label 650). The six
  module-local TechLayout icons and their `filled` prop are deleted.
- **Rollout:** ship module + sprite + render-contract test; shell first (tab bar, header,
  toast glyphs, OfflineStatusPill cloud family, ErrorState/EmptyState defaults); then each
  screen's wave replaces its own inline SVGs (176 across 43 files) as it restyles — never a
  big-bang codemod. Legacy `src/components/Icons.jsx` stays untouched for desktop; tech
  surfaces stop importing it. **Close-out gate per wave: zero emoji codepoints and zero raw
  `<svg>` in redesigned files.**

## 6. Components

Anatomy/state/value detail below is normative; the style guide renders the visuals.
**Detail specs of record (committed at `docs/tech-redesign/specs/`):** this section
condenses six spec files that carry the full CSS-level detail (exact paddings, the
read-only field variant, toast geometry and stacking, skeleton block dimensions, the fixed
material vocabulary, and the like). Per-section map: 6.A–6.D →
`specs/components-core.md`; 6.E → `specs/components-new.md`; 6.F →
`specs/field-science.md`; sections 3–4 → `specs/foundations.md`; section 5 →
`specs/icons.md`; section 7 → `specs/motion-map.md`. The spec file is the detail of record
where this standard is silent; where the two disagree, this standard wins. Global laws
first:

- **Press law:** buttons acknowledge with `transform: scale(.97)` (icon-only/small controls
  `.94`; FAB `.93`) over `var(--motion-duration-fast) var(--motion-ease-standard)`; rows and
  row-shaped surfaces acknowledge with a `background: var(--t-surface2)` swap, never scale.
- **Focus law:** `outline: 2px solid var(--t-focus); outline-offset: 2px; border-radius:
  12px` on every focusable element. Text-entry controls use the designed tap-focus state
  instead (border swap + `--t-focus-halo`).
- **Hover law:** hover styles only inside `@media (hover:hover) and (pointer:fine)`; always
  the `--t-surface2` wash (FAB additionally `translateY(-1px)`). No hover transforms
  otherwise.
- **Disabled/loading (normative, extrapolated):** disabled = `opacity: .4` (form groups
  `.55`), no press/hover, colors untouched (never a gray recolor that collides with the gray
  status). Loading button = present-progressive label ("Saving…") with the icon swapped for
  a same-box spinner; geometry unchanged; further taps refused. A loading list never blanks
  rendered rows.
- **Dark theme is never a component change** — the token swap is the entire dark behavior
  except the deltas each component documents.

### 6.A Actions

1. **Primary black pill** (`.pill-primary`): 100% width, 54px, radius 999,
   `--t-action-bg`/`--t-action-ink`; leading 19px duotone icon, label 17/600. ONE per screen.
   Destructive/terminal actions (Finish) are two-tap armed: first tap swaps the label in
   place to "Tap again to finish" (same geometry, colors, icon; ~3s auto-disarm via
   `useTwoClickConfirm`, blur cancels). Optional `.pill-note` microcopy below (12/500 ink3).
   Never for navigation, secondary capture, or rows. Never a modal confirm.
   ~~**Ripened variant** (`.pill-quiet`, sanctioned): while checklist tasks remain open,
   Finish renders as the outlined quiet pill (border 1.5px ink, `--t-surface` fill, ink
   label, trailing "· N left" 17/500 ink3); it ripens into the black pill when the list
   completes — one primary action stays true at every moment.~~ **superseded-by: §12.0
   owner decision 4d (2026-07-15) — Finish is ALWAYS the solid black two-tap pill; it never
   renders as the quiet outlined variant. While tasks remain it shows the black pill with a
   trailing "· N left"; the last-task-completes moment is the checklist Done-collapse +
   check-pop + `notify()` haptic + toast, NOT a pill state change. See §12.4.**
   **Dock pill variant:** flex 1.6, min-height 56, label 16/600, icon 20 — when the dock's
   emphasized member IS the screen primary (Add reading).
2. **Quiet button** (`.qbtn`): 48px, radius 14, `--t-surface2` fill, ink label 15/600,
   leading 18px icon in ink2. Pairs or single wide bar beside a primary pill. Never the
   screen primary; never a row substitute.
3. **Icon button** (44px, documented-secondary — header utilities ONLY: bell/help/kebab;
   radius 14, transparent, ink2, 23px glyph, always `aria-label`) and **back button**
   (48px — back is glove-critical; full ink; 24px chevron). Anything a gloved tech hits
   mid-job is 48px.
4. **Docked action bar** (`.dock`): fixed above the tab bar (z-25), SOLID `--t-surface`,
   radius 18, `--t-shadow-hero`, padding 8, gap 4. Exactly one emphasized member (gray
   `.dock-photo` flex 1.5 min-56, or the black dock pill); quiet members are vertical
   icon-over-label stacks (min 56x54, icon 20, label 12/500 ink3 — legal: the icon carries
   the action). One dock per screen max. Never frosted, never inside the scroller; it hides
   on `focusin` of any text input and returns on `focusout` (keyboard law). Main scroller
   bottom padding clears it.
5. **FAB**: dashboard only; 56px `--t-surface` circle, ink plus (2.2 stroke),
   `--t-shadow-hero`; deliberately subordinate to the clock hero. Its enter is the ONE
   springy one-shot in the system (`--motion-spring-in`). Never carries a badge; never
   becomes the screen primary.

### 6.B Navigation chrome

6. **Tab bar**: THE one frosted surface. `--t-frost` + `blur(14px) saturate(160%)` + top
   hairline; 5 tabs (Dash · Claims · Schedule · Messages · More), each min-48px, 25px duotone
   icon over 12/500 label (+0.01em); inactive ink3 with `--duo:.14`; active = ink,
   `--duo:.9`, label 650, `aria-current="page"` — the legacy pill-behind-icon is retired.
   Badge slots: numeric badge (Messages) or 8px red attention dot (More) — dot = something
   waiting, number = a real count; never both on one target. Safe-area padding built in.
7. **Numeric badge** (16px, radius 999, `--t-status-paused` fill, 11/700 tabular numeral in
   `--t-on-status`) — the single sanctioned 11px-actionable-adjacent use, never actionable
   text itself. **Attention dot**: 8px red circle with `aria-label`.
8. **Greeting header** (dash): sticky on `--t-ground`, never moves on scroll/PTR. Date line
   13/600 ink3; greeting 26/700 (no emoji); summary 13/500 ink2; actions cluster = offline
   pill slot + up to three 44px icon buttons. Dashboard only.
9. **Compact hub/module header**: pinned bar — 48px back button, name 20/700 single-line
   ellipsis, sub 13/500 ink2 tabular (`#job · description`), exactly one trailing chip (hub:
   live status chip; module: gray context chip e.g. "Day 4"). Title truncates, never wraps.

### 6.C Status voice

10. **Chips** (`.chip` + tones): inline pill, padding `4px 10px 4px 8px`, radius 999, label
    12/600, leading 13px SHAPE glyph (14px in hero/hub-header positions). The five status
    chips carry their fixed glyphs (section 2.6). Semantic reuse keeps one-tone-one-meaning:
    amber + clock "Due" / "Pull today" = needs action this visit (the ONLY due-encoding);
    amber + drop "Wet"; green + check "In range"/"Dry"/"Signed"; gray + dotring "Control";
    gray + cal "Day 4"; action tones always resolve to gray terminals with a timestamp
    ("Pulled 11:05 AM"). Chips are passive (the row is the target — one exception: the red
    offline pill), one per row, trailing, `flex: none`, never glyphless, never decorative.
11. **Mini badge** ("Viewing"): gray-bg 12/600 inline marker for you-are-here self-reference
    only — never status, never counts.
12. **Status lamp conventions** — the complete list of where chromatic color may appear:
    the 48px timer numeral (runs the current status hue while live — the 3-foot lamp);
    chips; green rail nodes; the timeline now-cursor (2px green line + 6px dot); tab red
    dot/badge; amber attention tiles; the green trend glyph; the amber stall marker
    (13/600 + 12px clock glyph); the focus ring. Everything else is ink. Banned: side
    stripes, colored headings, tinted cards as status.
13. **Offline pill**: a chip, relocated into the greeting-header actions slot (never a
    floating overlay; the layout absorbs it without reflow). States: amber + warn
    "Offline"/"Syncing N"; red + warn "N failed" — the one TAPPABLE chip (role=button, 48px
    hit via padding, tap retries); green + check "Synced" 2s flash; hidden when idle
    (presence IS the message — never a green pill at rest). **Hiding gotcha (correctness):**
    idle-hiding uses the `hidden` attribute, and the chip's own `display: inline-flex`
    BEATS the UA `[hidden]` rule — ship `.offline-pill[hidden] { display: none !important }`
    or the pill renders forever.

### 6.D Containers and content

14. **Card**: `--t-surface`, radius 20, `--t-shadow-card`, no border; sits on `--t-ground`
    with 16px gutters. **Row card**: `padding: 2px 0`, hosts edge-to-edge rows with hairline
    separators. **Hero/stage card**: the elevated moment — `--t-shadow-hero`, padding
    `20px 20px 16px`; exactly one per screen. Section titles live OUTSIDE the card.
15. **Rows** (the universal tappable unit): flex, gap 12, padding `12px 16px`, hairlines
    between never around; optional leading 36px tile (`.lnk-ic` neutral surface2/ink2;
    `.done-ic` green circle; `.attn-ic` amber tile), body (`.row-t` 15/600 title; `.row-m`
    13/500 ink3 tabular middot-joined meta with `.em` ink/700 emphasis, `.dnum` 650 numerals,
    `.nb` no-break value+unit wrappers), then exactly ONE trailing element — chip (has
    state) or 16px chevron (navigates), never both. Pressed = surface2 swap. Variants:
    `.row--static` (display-only), `.row--due` (title drops to ink2, icon to ink3, no values
    line — the amber chip alone is loud), selected = `aria-current` + "Viewing" badge.
    Reading rows add `.row-vals` (17/500 ink3 tabular value line) between title and meta.
    Never stack two chips; never put actions inside a row — the row IS the action.
16. **Checklist**: header (title 16/600 + count 13/500 ink3 tabular) + 4px green progress
    bar on a hairline track (`aria-hidden`; the count is the accessible value) + 56px task
    rows (`role="checkbox"`, whole row toggles, optimistic) with 28px check circles (open:
    2px ink3 ring; done: green fill + check in `--t-on-status`); done titles recede to
    ink3/500, no strikethrough. **Done-collapse row** (`.task--fold`): 2+ completed tasks
    fold into one receipt row — done circle + "Done (N)" + chevron, `aria-expanded`.
    **Inline capture pair** (`.ck-acts`): two 48px surface2 buttons ("Add photo"/"Add note",
    14/600 — the documented compact exception, legal only in this paired context) inside the
    work card; the dock remains the global capture. **Stage meta line** (`.stage-meta`):
    centered 13/500 ink3 tabular summary "2 of 5 tasks · 9 photos today" with `.dnum` values.
17. **Station rail + stage clock**: 3-column rail (On my way / Started / Finish) — 32px
    nodes over a 2px hairline connector; done = green fill + check (`--t-on-status` ink);
    next = surface fill + 2px INK border + flag (an intention, not a state; never blue);
    names 13/600, stamps 12/500 ink3 tabular. Display-only — the pill moves the machine.
    Stage clock: 48/700 tabular numeral, color = live status hue; label 13/500 ink3.
18. **Numbers grid**: ONE quiet card with cells — never stat tiles. Scope blocks with 13/600
    ink3 labels; 3-col cells; values 22/650 ink2 tabular, labels 12/500 ink3; exactly one
    emphasized cell per row (ink/700 — the number the visit is judged by); fraction suffix
    `.of` 15/600 ink3. Hours ALWAYS the labeled Travel / On-site / Total triplet (payroll
    honesty — never a bare total). Never icons in cells, never colored values.
19. **Segmented control**: recessed track (surface2, radius 15, inset shadow) + raised thumb
    (radius 12, `--t-seg-thumb`, `--t-shadow-seg-thumb`); segments min 44px
    (documented-secondary — full-width half-track), 15/600, `aria-pressed`. HIGH-FREQUENCY:
    **selection change is INSTANT — no sliding indicator, no thumb transition** (the
    motion-standard frequency-tier reversal, confirmed); press scale(.97) still ships. For
    2-3 in-place view switches only; never navigation, counts, or icons.
20. **Attention strip**: present-only-when-needed card, first content element; head = 20px
    amber warn glyph + count sentence 15/600; rows = 36px amber tile (the one chromatic
    leading tile — it replaces a chip; attention rows carry chevrons) + title 15/600 + meta
    13/500 ink3 tabular with the reading value in ink/700 `strong`. Renders nothing when
    empty; long lists collapse behind "Show all (N)". One attention card max.
21. **Hero address row**: 48px full-bleed hit (negative-margin extension), pin icon + 15/500
    ink2 address + trailing chevron; opens Maps. Muted on purpose; target full-size. One per
    hero/stage card.
22. **Photo grid**: head (count 15/600 + See-all 13/600 ink2 with extended hit), 3-col grid
    gap 8, square thumbs radius 12 on surface2; placeholder = 26px duotone photo glyph
    (reads as a thumb, never a broken image); real thumbnails via `thumbUrl()` +
    `loading="lazy"` + `decoding="async"`, `object-fit: cover`; capped + "See all" routes to
    the album (truncation law). Never full-res in a grid.
23. **Quiet footer row** (`.hero-next`): the one-line context idiom — 15px icon ink3 + text
    13/500 ink2 tabular with `strong` ink/600 source label ("Office note · Lockbox…",
    next-visit preview, pull justification). Always LAST in its card, hairline-separated,
    display-only, exactly one per card. If it must navigate, it is a row.
24. **Day timeline** (dash): status-tinted blocks (36px, radius 12, each carrying its 14px
    shape glyph) on an hours axis with 12/500 ink3 ticks + the green now-cursor. GLANCE-ONLY
    `role="img"` with a sentence `aria-label` — blocks take NO taps (proportional widths
    cannot honor 44px); the rows below are the tap surface.
25. **Section furniture**: section title 16/600 outside the card, sentence case, no
    eyebrows/numbering/color, `text-wrap: balance`; day heading 13/600 ink2; in-card chamber
    header 16/600 + 13/500 ink3 meta over a hairline.

### 6.E Forms, overlays, feedback (the completeness set)

26. **Text field / textarea**: label 13/600 ink2 (a disclosed one-step promotion from the
    12 label band — primary reading while filling a form; never uppercase); control min-48px,
    radius 12, surface2 fill, `--t-field-border`, inset `--t-shadow-seg-track` (fields read
    pressed-in; buttons read raised), **16px/400 value** (anti-zoom law), placeholder ink3
    never-a-label. Focus: surface bg + `--t-focus` border + `0 0 0 3px var(--t-focus-halo)`
    (the designed tap-focus — no outline here). Error: 1.5px red border + 13/500 red message
    row with 16px warn glyph, `aria-invalid` + `aria-describedby`; the field never tints
    red. Numeric fields tabular + `inputmode`. Textarea min 96px, grows to 5 lines then
    scrolls, `resize: none`; counter 12/500 ink3 tabular, red at limit. Docked bars hide on
    `focusin`.
27. **Select / picker row**: native select (styled identically to the field, drawn 20px
    chevron-down, `appearance:none`, 16px value) for short flat sets (~6 or fewer, e.g.
    TIME_OPTIONS); a sheet picker (field-shaped button opening a bottom sheet of 52px rows,
    selected = check glyph + weight 600, never color-only; 12+ options get a pinned search)
    for everything else.
28. **Checkbox and radio** (drawn, never UA): 26px box radius 8 / circle 999; unchecked
    1.8px ink3 border on surface; checked default = INK fill + surface check (a chosen
    setting is identity, not status); the task/completion variant is green + `--t-on-status`
    check (completion earns chromatic; task lists may keep the 28px circle). Check pop:
    glyph scales .6 to 1 over 200ms decelerate; uncheck instant. Radio selected = ink border
    + 12px ink dot. Whole labeled row is the 48px target. Error = red border + message row.
    `selection()` haptic on change.
29. **Toggle switch**: 52x32 track — OFF surface2 + inset shadow; ON `--t-action-bg` (the
    pill identity — never green: on/off is preference, not status). 28px knob rides
    `--t-seg-thumb`/`--t-action-ink` with the thumb shadow. Knob translate 120ms
    ease-out-equivalent (fast/standard tokens); nothing springs. `role="switch"`; 48px hit;
    state survives grayscale by geometry.
30. **Bottom sheet**: THE field-action container (no modals for field work — house law).
    Reskins the ui Modal mobile branch, KEEPING its focus-trap, `--closing` exit lifecycle,
    scroll-lock, and drag-safe overlay-close contracts. Scrim `--t-scrim`; panel bottom-
    pinned, radius `20px 20px 0 0`, surface, `--t-shadow-hero` (dark adds a top inset
    hairline), max-height `calc(88dvh - var(--safe-top, 0px))` (`--safe-top` defined in section 3.3), internal scroll,
    safe-area bottom padding; 36x4 drag handle inside an invisible 48px grab strip (visual
    affordance only until the gesture util lands); title 17/600; optional 44px close; footer
    = one black pill + at most one quiet secondary. Enter: translateY 100% to 0 at base
    duration (spring-in permitted while non-draggable; OFF money/billing sheets). Exit:
    NEVER instant-unmount — `--closing` plays the reverse at 75% on accelerate, unmounts on
    `animationend`. Desktop 768px+ keeps the centered modal branch (fade + scale .96 to 1,
    origin center) for non-field flows only.
31. **Toast**: raised ONLY via `src/lib/toast.js` (eslint law); container `role="status"
    aria-live="polite"`, errors `role="alert"`. Fixed above the tab bar (+ dock height when
    one is present so a toast never covers a control); surface, radius 14,
    `--t-shadow-hero`, NO side-stripe — the 20px duotone variant glyph carries state (green
    check-circle / red warn / blue info); text 15px ink, 3-line clamp; 44px dismiss. Action
    toast ("Photo saved · Add note"): one trailing 14/600 blue text action, 4s. Enter via
    `@starting-style` transition (retargetable) on spring-in; exit 75% accelerate with
    `--leaving` + `animationend`; 5s auto-dismiss.
32. **Skeletons**: cold-start ONLY — cached content is never replaced by a skeleton
    (resume/PTR/refetch are silent). `--t-skel` blocks whose radius mirrors the stand-in;
    optional `--t-skel-hi` shimmer removed entirely under reduced motion. Dash pattern:
    greeting header renders REAL, then hero-shaped card + 3 row skeletons + numbers card.
    List pattern: 5 rows with hairlines exactly like real rows. Chrome (docks, tab bar) is
    never skeletonned.
33. **Empty state**: renders ONLY after a successful zero-row load. 64px surface2 circle +
    28px ink3 duotone glyph, title 16/600, sub 13/500 ink2; action = the black pill only if
    it is the screen's primary, else a quiet secondary. Tech law: empty states show upcoming
    work, never a dead end (empty today is followed by the real next-7-days rows).
34. **Error state**: a failed load NEVER renders the empty state or a blank page. Panel: red-
    bg circle + red warn glyph, fixed "Couldn't load" title, human message, 48px quiet "Try
    again" (deliberately NOT the black pill). Banner variant (preferred when stale rows
    exist): keep rows visible; red-bg banner radius 14 with glyph + 13/600 red message +
    underlined Retry (44px hit). Retry re-runs the SILENT load path.
35. **Search input**: 48px, radius 12, the pressed-in field read; leading 20px magnifier
    ink3; `type="search"`, 16px font, `enterKeyHint`; drawn 44px clear replacing the UA
    cancel; §26 focus state. Debounce 200-250ms; a hard result cap always pairs with a way
    to reach the rest.
36. **Lightbox**: the ONLY full-resolution surface (grids always `thumbUrl()`); media URLs
    only via the `usePhotoUpload`/`thumbUrl` seam (the db-foundation P8 signed-URL swap
    point). Theme-invariant darkroom backdrop `rgba(0,0,0,.92)` in BOTH themes; 48px chrome
    buttons; "3 / 12" counter 13/600 tabular; enter/exit = 120ms opacity fade only (no zoom
    theatrics); full-res blur-up over the cached thumb, never a spinner over black. Swipe/
    pinch are native-gesture territory — never faked with CSS.
37. **Two-click destructive confirm**: mechanism = `useTwoClickConfirm`; NEVER a modal or
    `confirm()`. Rest = normal quiet style (never red at rest). Armed = the control itself
    transforms in place — label becomes "Tap again to <verb>"; quiet controls take red-bg +
    red text; pill-class controls take red fill + `--t-on-status` text; 120ms recolor, ZERO
    layout shift (reserve the widest label's width). 3s auto-disarm; blur disarms; armed
    state announced via `aria-live="polite"`. Typed-"DELETE" inline confirm remains the
    ceiling for irreversible bulk archive — both inline, neither a dialog. Haptics:
    `impact('light')` on arm, `notify()` on outcome.

### 6.F Field science (the drying/moisture/equipment instrument family)

Family thesis: readings are quiet ink; one tone one meaning — **amber = needs action this
visit** (Due, Pull today, Wet, stalled), **green = confirmed good**, **gray =
neutral/terminal**, **red = drying is failing** (never a merely out-of-band comfort value).

38. **Numeral grammar**: `.dnum` (650 tabular ink) wraps the NUMBER only, never its unit;
    `.nb` wraps one complete measurement (number + unit + optional trend glyph) — wrapping
    only at the ` · ` separators. Comparable numbers are 17px+; locators/timestamps 13px.
39. **Reading row**: `.row` + `.row-vals` value line in fixed order
    `72.4°F · 38% RH · 45 gpp` (units: `°F` tight, `% RH`, ` gpp`), timestamp meta
    `Read h:mm AM`. States: in-range (green check "In range"); control (gray dotring
    "Control" — NO trend glyph ever, a control has no goal); due (`.row--due`, quiet, no
    values line, amber clock "Due"); out-of-tolerance amber tier (amber warn "Out of range";
    only the offending `.dnum` recolors via `.dnum--warn`; meta may append the target); red
    tier (red + mirrored adverse trend "Not drying" — reserved for failed drying dynamics;
    offending `.dnum--crit` + adverse glyph). Color never appears without the chip's glyph
    + word.
40. **Trend glyph**: rides inside the `.nb` of the value it qualifies, after the unit; green
    falling = desired direction (the only self-colored element on an in-range line); the
    adverse variant is the same symbol mirrored (`scaleY(-1)`) in red, ONLY inside the red
    tier. Never on controls, timestamps, or counts; a trend the system cannot assert is
    omitted, not grayed.
41. **Moisture-point micro-table**: the ONE table in the system (dense comparable numerics
    only — everywhere else, rows). Grid `1fr 46px 46px 76px`; 11/600 ink3 column headers
    (the absolute floor — non-actionable); MC 15/650 ink right-aligned tabular, Goal 15/500
    ink3 — the alignment channel IS the instrument; rows min 52px, tappable, real table
    semantics via roles. Status chips: green check "Dry" / amber drop "Wet" (amber, not red
    — mid-job normal). Stalled sub-meta under the material name: amber 13/600 + 12px clock,
    grammar `{N}d stalled`. Never a fifth column.
42. **Chamber card**: header `Chamber {N} · {rooms}` 16/600 + tolerance meta
    `Target {lo}–{hi}°F · Rooms: {list}` (the band the amber tier is judged against — must
    be visible wherever those chips appear). Collapsed chamber = one tappable row whose meta
    doubles as the pending-work line (`… · Final readings due — Master Bathroom`) — a
    collapsed chamber may hide its rows but never its obligations. Chambers/Rooms switching
    is the segmented control (instant). Rooms grouping is the UPR-native guaranteed
    fallback; Chambers renders when chamber data exists.
43. **Equipment rows**: title `{Unit type} ×{count}`; meta `{Chamber/Room} · day {N}` (the
    billing number, always visible on a running unit). **Day N derivation (correctness — a
    wrong N is a wrong invoice):** displayed `N = days_onsite + 1` (placement day is day 1;
    `days_onsite` lives on `equipment_placements` — verify the column live per section 10.2). Running units carry NO chip (the
    quiet row is the steady state); amber clock "Pull today"; terminal gray
    "Pulled h:mm AM". Removal is two-tap confirm. When instruments contradict instructions,
    the card carries the office's justification as the quiet footer
    (`Office note · …`) — the contradiction is resolved on-screen, never implicit.
44. **Gateway rows (glance-and-gate law)**: the hub shows one gateway row per module —
    module icon, name, aggregate meta in `.dnum` grammar
    (`2 of 3 materials dry · 4 units on site · read 9:46 AM`), trailing chevron ONLY (never
    a chip on a gate); at most one escalation row (the worst offender) beneath it, chip-
    bearing, deep-linking to the exact instrument. The gate destination owns all module
    actions. **Mirror integrity:** gateway aggregates equal the module summary numbers
    verbatim — a disagreement is a defect.
45. **Dashboard attention rows** (stalled widget): section 6.D item 20's anatomy with meta
    `#{job} · {MC%} · goal {G%} · {N}d stalled` (reading value bold ink). Flag-gated
    (`page:tech_moisture`); silently absent on failure.
46. **Thermal thumbnail variant**: 22px surface rounded-square tag (radius 8) top-left of
    the photo tile with a 14px therm glyph in ink2 — neutral ink, not amber (thermal is a
    KIND, not a state). No fake FLIR washes. Tag is `aria-hidden`; the caption leads with
    `Thermal ·`. Mixed grids sort by capture time — no segregated section.

## 7. Motion mapping

**Law: `.claude/rules/motion-standard.md` v2.** This section tunes; it never re-authors.
Where a mockup literal and the law disagree, the law wins. All motion is transform/opacity
only (progress-bar width / ring dashoffset are the two sanctioned exceptions), time-based,
GPU-composited, and consumes the F-S2 tokens by name.

### 7.1 Ground rules as applied

1. **Frequency tier first.** High-frequency controls (clock actions, task checks,
   tab/segment/day/filter switches, steppers) are **instant tier**: no animated selection
   indicator, opted out of `@view-transition`, press feedback only. Deleting the animation
   is the correct craft call; the checker must not fail these.
2. **Every enter has an exit** at ~75% of the enter on `--motion-ease-accelerate`,
   unmounting on `animationend` via the shared `--closing`/`--leaving` lifecycle.
   `if (!open) return null` with no exit is a defect.
3. **`--motion-spring-in` (enters only)** is limited to exactly three consumers: FAB enter,
   non-draggable bottom-sheet enter, toast enter. Banned on money/pricing/billing surfaces
   (crisp decelerate there), on all exits, and on any surface the moment it becomes
   drag-interruptible.
4. **Route pushes** use the native View Transitions API, directional (forward from the
   leading edge; Back reverses) via `html[data-nav]`, at most base duration. Shell chrome is
   persistent (`vt-technav` etc. — headers and tab bar never animate). Bottom-tab switches
   between keep-alive panes are `display:none` toggles — instant by construction (WKWebView
   law: transforms banned for hiding).
5. **Reduced motion is a hard gate**: every transition/keyframe collapses to instant or
   opacity-only with the end-state, focus, and `aria-live` intact; haptics suppressed. Every
   hover transform sits behind `@media (hover:hover) and (pointer:fine)`. Production uses
   the F-S2 per-rule reduced-motion wrappers — never the mockups' blanket kill block.
6. **Haptics are additive, never load-bearing** (`nativeHaptics`): `impact('light')` press
   of a primary field action / photo save / send / swipe threshold; `selection()` tab,
   segment, chip, toggle, week-strip snap; `notify('success'|'error')` clock-action and
   multi-step outcomes. Never on scroll, keystroke, or background events.

### 7.2 Assignment table (condensed; tiers binding)

| Surface | Tier | Motion |
|---|---|---|
| Route push (list to detail, drill-ins) | Occasional | Directional View Transition, base/decelerate; Back reversed at 75% accelerate; reduced = instant |
| Tab bar, segmented controls, WeekStrip day, filter pills/chips, clock station buttons, task check, steppers | **High-frequency: INSTANT** | Selection/state swap instant; press scale only; task-check pop capped at fast; `selection()` haptic (clock outcomes use `notify()`) |
| Toggles | Occasional | Knob slide + track color at fast/standard; reduced = instant |
| Two-tap confirm | Occasional | In-place label/color crossfade at fast/standard; no layout movement |
| Bottom sheets | Occasional | Enter translateY at base (spring-in while non-draggable; decelerate on warning + money sheets); exit 75% accelerate via `--closing`; wizard steps = horizontal transform crossfade at base |
| Menus / popovers | Occasional | Origin-aware fade + scale .96 to 1, fast/decelerate; exit 75% |
| Modal (MergeModal — the ONE field-legal modal: a shared-with-desktop admin/data flow, not a field action, so `tech-mobile-ux.md`'s no-modals law is not violated; every field action stays a sheet per section 6.E item 30) | Rare | Overlay fade; panel fade + scale, base/decelerate, origin center; exit 75% |
| Lightbox | Occasional | 120ms opacity fade both ways; prev/next instant or fast crossfade — never an unearned slide |
| FAB | Rare | Spring-in one-shot at the slow token (the mockup's 380ms retunes to 320ms unless a reason is stated per the over-300ms rule); expanded menu children pop origin-aware, ~30ms stagger |
| Toasts | Occasional | `@starting-style` transition enter on spring-in at base; exit 75% accelerate via `--leaving` |
| Status chips / lamps | Occasional | Color + glyph crossfade at fast; **no working-state pulse in Direction B** |
| Banners / attention strip | Occasional | Fade + small translateY on FIRST mount only; never re-animates on resume/refetch |
| Badges / counts | Occasional | First appearance fade + scale .9 to 1 fast; count changes instant (tabular swap, never bounce) |
| Skeletons | Cold-start | Optional gentle shimmer, removed under reduced motion; content swaps in with a fast opacity crossfade |
| Progress bars / completion ring | Occasional | Value eases at base/standard (sanctioned non-transform exceptions) |
| Chat bubbles | Occasional | Sent rises from composer edge; incoming fade + scale .98 to 1; base/decelerate; optimistic reconcile never reflows or re-animates |
| Timer digits | n/a | **No motion** — once-per-second tabular text swap; no flip/roll/fade |
| Inline expanding affordances, transient search | High-frequency-adjacent | Instant reveal (no height tween); content fades in fast |
| Photo thumbs | Occasional | Image-load opacity fade fast |

### 7.3 Gesture surfaces (motion-standard section 9 — separate mechanism)

Sanctioned targets of the scoped dependency-free pointer + rAF spring util (route-lazy,
owner-gated): bottom-sheet drag-to-dismiss, PullToRefresh, toast swipe-dismiss — and nothing
else. Per-frame writes go to `node.style.transform` on the moving node — never a parent CSS
var, never `useState`. `SwipeTaskRow`'s live ad-hoc drag must be reconciled at build time
(fold into the util OR keep as-is with a disclosed PR note). Week/agenda/thread scrolling is
native overflow scroll only. Never fake momentum with a long CSS transition. Every gesture
surface ships with an owner on-device iPhone gate.

### 7.4 Build-time retarget flags (mockup literals; none may survive)

1. `transform 120ms ease-out` (and `+ background`) press rules retarget to
   `var(--motion-duration-fast) var(--motion-ease-standard)`.
2. Row `background 120ms ease-out` retargets to `background-color` on the same fast/standard
   tokens.
3. `fab-in 380ms cubic-bezier(.3,1.14,.42,1)` retargets to
   `var(--motion-duration-slow) var(--motion-spring-in)`.
4. The instant-segment comment carries into the built component so the tier call is legible
   to the checker; the tier rule and any checker change land together, never apart.
5. The mockups' blanket reduced-motion kill is NOT copied into `index.css`.
6. Legacy `--transition-*` tokens are never consumed by new tech CSS.
7. The mockups' tab-bar bottom padding `calc(14px + env(safe-area-inset-bottom, 0px))`
   retargets to CLAUDE.md Rule 11: `max(12px, env(safe-area-inset-bottom, 12px))`
   (the section 3.5 conflict flag; not motion, but the same none-may-survive discipline).

## 8. Screen anatomies (zone contracts)

Shell mechanics beneath all three (binding, from the shell survey): keep-alive panes with the
`active` prop contract; PTR wraps content BELOW the sticky header only, always silent;
`.tech-nav` safe-area math and bottom-clearance economy; every appointment/job link through
`apptHref()`/`jobHref()`; one scroller per surface with continuous-ref scroll restoration;
`upr:toast` the single toast channel. Layering: sticky top chrome z-20 on `--t-ground`; dock
z-25; tab bar z-30; scroller bottom padding clears everything (dash ~190px / hub ~264px /
module ~240px of record).

### 8.1 Dashboard (`/tech`)

Top to bottom — all ten zones, in this order:

1. **Greeting header** (sticky, never moves): date line, "Hey {first name}", visit summary;
   offline-pill slot + bell/help/kebab (44px utilities).
2. **Attention strip** — present only when needed (stalled materials, away-from-site, 5PM
   nudge); amber voice; collapses long lists.
3. **NOW/NEXT hero** — THE primary action. Status chip + scheduled time; job name 23/700;
   sub; 48px address row; 48px live timer (color = state); station rail; the black pill
   (Pause while working — Finish stays the next rail station); Photo/Notes quiet pair;
   quiet next-visit footer. `--t-shadow-hero`.
4. **Day timeline** — glance-only status blocks on an hours axis; no taps.
5. **Rest of today** — rows: time, customer, kind, address meta; one trailing status chip.
6. **Numbers grid** — Today/This week blocks; hours always Travel / On-site / Total; tasks
   and photos footer pills. Quiet instruments, never stat cards.
7. **Completed visits** — gray-circle rows with the time breakdown (travel · on-site ·
   total — never a bare total).
8. **Coming up** — next 7 days under 13/600 day headings.
9. **FAB** — create; subordinate; the one spring.
10. **Tab bar** — the one frosted surface; safe-area padded.

### 8.2 Job hub (`/tech/job/:jobId`) — the LOCKED structure

- **Z1 — compact hub header** (pinned): 48px back, job name 20/700, sub
  `#{job} · {purpose}`, ONE trailing chip = the selected visit's live status.
- **Z2 — stage card** (the hero): 48px stage clock first (color = state), station rail,
  **stage meta line** (Story fold-in: centered 13/500 ink3 "2 of 5 tasks · 9 photos today"),
  the primary pill — ~~**state-aware Finish**: quiet outlined pill with "· N left" while
  checklist tasks remain, ripening to the black two-tap-armed pill when complete (the
  sanctioned flow-challenger variant)~~ **superseded-by: §12.0 decision 4d — Finish is
  ALWAYS the solid black two-tap pill (with trailing "· N left" while tasks remain); see
  §12.4**; wide quiet Pause beneath; 48px address row; office-
  note quiet footer. **On the Paused state the primary black pill is Resume work and Finish
  drops to the quiet secondary (§12.4) — one black pill still holds.**
- **Z2 continued — work card**: checklist (progress bar, 56px optimistic task rows, the
  **Done-collapse row** folding 2+ completed tasks into "Done (N)" — Story fold-in), and the
  **inline capture pair** ("Add photo" / "Add note" — Story fold-in; the quieter twins of
  the dock, legal only inside this card).
- **Z2 continued — module gateways**: one gateway row per module (drying, equipment,
  documents…) in `.dnum` aggregate grammar + chevron; at most one escalation row beneath
  (section 6.F.44). The hub never hosts module actions.
- **Z3 — hub dock** (fixed, solid, above the tab bar): emphasized Photo (snap-first law) +
  Note · Call · Text; hides on text-input focus.
- **Z4 — below the fold**: visit switcher rows (selected = "Viewing" mini badge), claim/
  contacts section (contacts above photos — the adjuster-call flow never scrolls past a
  gallery), photo grid (capped + See all), notes, report generation, admin kebab (sheet;
  typed-DELETE ceiling).

### 8.3 Field module (drying — the template for module screens)

- **Header**: 48px back, module title 20/700, sub `#{job} · {customer}` (the way back is
  always labeled), ONE gray context chip (`Day 4` + cal glyph — a module has no clock state
  of its own).
- **Summary**: one quiet numbers card — exactly one emphasized cell (Materials dry as
  `2 of 3`); mirrors the hub gateway verbatim (mirror-integrity law).
- **View switch**: Chambers | Rooms segmented control — instant selection; Rooms is the
  guaranteed fallback grouping.
- **Chamber cards**: header + tolerance meta; reading rows; moisture-point micro-table;
  collapsed chambers keep their obligations visible in the meta.
- **Equipment card**: equipment rows + justification footer when instructions contradict
  instruments.
- **Module dock**: the module's primary verb as the black dock pill (Add reading) + one
  quiet secondary (Place equipment). The frost budget stays spent on the tab bar — the dock
  is solid.

### 8.4 Screens WITHOUT a mockup of record (coverage rule — binding)

Sections 8.1–8.3 cover the three mocked screens. Every other `/tech/*` surface (Claims,
Schedule, Messages, Tasks, More, tech settings, and every sheet-based flow) has **no pixel
tiebreaker** — for those screens the rules are:

1. **Compose from section 6, never invent.** The canonical **list-screen template** is:
   compact header (6.B item 9; dashboard alone uses the greeting header) → search input
   (6.E item 35) where the list warrants it → optional segmented view switch (6.D item 19)
   → row cards of rows (6.D items 14–15) under section titles (6.D item 25) → skeleton-list
   / empty / error states (6.E items 32–34) → at most one dock and one primary pill (6.A).
   Detail/form screens compose the same way from 6.E. Field-science surfaces use 6.F.
2. **The tiebreaker hierarchy for an unmocked screen** is: this doc's numbered rules → the
   committed specs (`docs/tech-redesign/specs/`) → the nearest mocked screen's precedent
   (section 1.5's four files). "The mockup pixel is the tiebreaker" (1.5) applies only
   where a mockup of record exists — it is never license to consult a non-normative file.
3. **Ambiguity escalates, never improvises.** A layout/IA question the composition rule
   cannot answer goes to the owner via the screen's dispatch phase block — builder taste is
   not a tiebreaker, and a reviewer grades an unmocked screen against items 1–2 here, not
   against taste.
4. Each unmocked screen's dispatch block states its zone order (the 8.1–8.3 pattern) before
   the build session starts; a session dispatched without one stops and flags it.

## 9. Accessibility and floors (all hard gates)

1. **Targets:** 48px is the interactive floor for field actions (pills, dock members, back,
   task rows, tab columns, address rows, retry). 44px only for documented-secondary
   (header utilities, segments, dismiss/clear buttons) — each carries a comment at the
   declaration site. Hit areas under 24px are banned regardless of visual size. Full-bleed
   hit extension (negative margin + padding) is the sanctioned trick for text-y targets.
2. **Type floors:** 11px absolute (badge numerals and table column headers ONLY — never
   actionable, never body); 12px for anything actionable (chips, tab labels, dock labels at
   12/500-600 minimum).
3. **Contrast:** body 4.5:1 or better always; primary text leans 7:1 or better (sunlight);
   the section 3.4 watch-list pairings are re-measured on any token change; the muted floor
   is never a primary action label.
4. **Shape redundancy:** no color-only state, ever — every status ships glyph + word;
   grayscale must lose nothing; the fixed shape vocabulary of section 2.6 is law.
5. **Reduced motion:** every transition/keyframe has a `prefers-reduced-motion: reduce`
   collapse (instant or opacity-only) with the end state, focus moves, and announcements
   intact; skeleton shimmer removed, not replaced with a pulse.
6. **Hover gating:** every hover style behind `@media (hover:hover) and (pointer:fine)`; no
   ungated hover transforms (a tap must never jump under the finger).
7. **Semantics:** rows are `role="button"`/`"checkbox"` with `tabindex="0"`; sheets are
   `role="dialog" aria-modal` with focus trap + restore; toasts `role="status"`/`"alert"`;
   the timeline is `role="img"` with a sentence label; icon-only buttons always labeled;
   armed confirms announce via `aria-live`; `aria-current` on active tab and selected visit;
   `color-scheme` set per theme.
8. **Input:** 16px font on every focusable text input/select (iOS anti-zoom);
   `touch-action: manipulation` and transparent tap highlight on controls; docked bars yield
   to the keyboard.
9. **i18n:** every tech string is i18n'd (en/es/pt); layouts budget for longer translated
   strings — truncation with a way to the rest, never clipped labels.

## 10. Build-session contract

1. **Feature-flag parallel build.** The reskin ships behind feature flags exactly like the
   tech-v2 precedent (`page:tech_dash_v2`): new screens are built greenfield, flag-gated
   owner-only (`enabled:false` + `dev_only_user_id`), and opened by the owner in DevTools —
   never by a build session. Flag flips are the owner's.
2. **One screen per agent.** Each build session owns exactly one screen (or one module
   family) and its reserved `index.css` marker; shared tokens/primitives/icons ship first in
   a foundation phase; wave sessions import, never edit, the shared layer (the wave-
   ownership-manifest model). Zero schema migrations in a reskin session — this is a visual
   initiative; verify live column names before wiring data (CLAUDE.md Rule 7 posture; the
   field-science table names in section 6.F come from a survey, not a schema dump).
3. **Acceptance test = THIS DOCUMENT.** The reviewer gauntlet on every screen PR:
   `upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker`, plus
   **`review-animations` (mandatory — every reskin PR touches motion)**, graded against the
   numbered rules here. The full `close-out-standard.md` checklist applies: build/test/lint,
   the minimize/resume test, the 390px viewport check, loading/empty/error forcing, perf
   delta vs `perf-budget.md`, doc updates, checkbox reconciliation both directions, PR into
   `dev` as a handoff then STOP.
4. **Visual reference of record:** the four files named in section 1.5
   (`direction-b.html`, `refine-b-jobhub.html`, `hydro-b.html`, `hub-challenge-flow.html`)
   — never `direction-a.html` or the deck/story challengers. A built screen is checked
   against those mockup pixels AND this doc's values; unmocked screens are checked against
   section 8.4; motion literals are checked against section 7's retarget table, not the
   mockup CSS.
5. **Shell mechanics a build must not break** (verified contracts): pane keep-alive +
   `active` gating + `hidden`-only hiding (WKWebView) + continuous-ref scroll restoration;
   the `.tech-nav` safe-area rule and the bottom-clearance economy; PTR-below-header, always
   silent; `apptHref()`/`jobHref()` for every appointment/job link (hardcoded paths
   forbidden); the `?c=` thread URL contract; `upr:toast` as the single toast channel; the
   More-tab badge poll and Messages badge as shell-owned; the nav-hide `:has()` rules scoped
   to visible panes; `viewport-fit=cover`.
6. **Kept behavior contracts, reskinned looks:** ui Modal (focus trap + `--closing`
   lifecycle), IconButton (required label + haptic), StatusPill/`toneForStatus`, StatusChip
   token-name selection, EmptyState/ErrorState semantics, SearchInput string-onChange,
   TabLoading's vocabulary slot, skeleton cold-start law, `useResumeRefetch`,
   `useTwoClickConfirm`, `useLookup`, `usePhotoUpload`/`thumbUrl` (single media seam),
   `useOfflineQueue`, `techQuery` keys, `ThemeContext`.
7. **Per-wave close-out gates specific to the reskin:** zero emoji codepoints and zero raw
   inline `<svg>` in redesigned files; no raw hex/duration/easing literal where a token
   exists; the JS hex mirrors touched by the screen deleted; both themes visually verified;
   the section 3.4 contrast watch-list re-checked if any token moved.
8. **Every `<button>` sets an explicit `color` in its CSS chain** (buttons do not inherit text
   color). Chromium's UA default is near-ink and MASKS the omission; Safari/WebKit's is
   systemBlue — the hub header name rendered blue on the first real-WebKit open (found
   2026-07-17, local loop; `.hub-name.hub-link`, `.ck-head`, `.pk-opt` fixed). Any new button
   whose bare text or `currentColor` icon relies on inheritance is a defect; verify under
   WebKit, not just Chromium.

## 11. Open items (honest)

1. **Gesture util is owner-gated and unbuilt:** sheet drag-to-dismiss, toast swipe-dismiss,
   and the PullToRefresh fold-in wait for the motion-standard section 9 wave; until then the
   sheet handle is visual-only and dismissal is scrim/close/commit. `SwipeTaskRow`'s ad-hoc
   drag must be reconciled (fold in or disclose) by whichever session touches it.
2. **On-device iPhone gates:** gesture feel, the frosted tab bar's scroll cost, and haptic
   pairing are owner-device checks — Playwright proves behavior, not feel (state the caveat
   in every motion PR).
3. **Disabled/loading states are normative extrapolations** — no screen of record ships
   them; the style guide renders them; first implementation feedback may tune the opacity
   values.
4. **One inherited mirror-integrity conflict** between the shipped hub gateway numbers and
   the module summary is disclosed in `docs/tech-redesign/specs/` on purpose; resolve when
   the hub revision lands — do not silently "fix" one side.
5. **Chambers have no UPR table today** — the Chambers grouping renders only when Encircle
   chamber data exists; Rooms is the guaranteed fallback. A native chambers model is a
   separate reviewed change, not a reskin task.
6. **Flag names for the reskin waves are unassigned** — the owner names them at dispatch
   (precedent: `page:tech_dash_v2`); existing gates (`page:tech_moisture`,
   `page:tech_equipment`, `page:tech_rooms`, `page:tech_job_hub`, `tool:oop_pricing`,
   `page:admin_mobile`) keep governing their sections' visibility.
7. **`i-trend` alias retirement** (rename to `i-trend-down` at the call sites) rides
   whichever wave touches those screens.
8. **FAB duration:** retargeted to the 320ms slow token; if the mockup's 380ms is kept, the
   style guide must state the reason per the motion law's over-300ms rule — owner taste
   call.
9. **Accent alternates:** the owner reserved the right to revisit color options; any hue
   change re-runs the section 3.4 contrast matrix before shipping.
10. **Admin Mobile (`/tech/admin/*`) and the shared legacy `Conversations.jsx`** are other
    initiatives' surfaces inside the tech shell; the reskin reaches them through their own
    owners/waves, not by editing them in a screen session.
11. **Default theme MODE is an owner decision, pending.** System-auto is the recommended
    default (section 2.5), but the shipped default (`system` vs `light`) is not decided;
    the owner rules at dispatch of the foundation phase. Until then no session seeds a
    default-mode value; `ThemeContext`/`upr_theme_pref` mechanics (section 3.9) are
    unaffected either way.

---

## 12. Flow specifications (Session 2 — flows & remaining screens)

**Last-verified: 2026-07-15** · Status: flows designed as steppable prototypes; each subsection
LOCKS after the owner's reaction. Prototypes of record live in `docs/tech-redesign/prototypes/`
(`schedule.html`, `new-job-flow.html`, `job-hub.html`) and share `kit.html` — the token/sprite/
component foundation cloned verbatim from the three mockups of record. **Kit tokens are UNPREFIXED**
(`--ground --surface --surface2 --ink --ink2 --ink3 --hair --pill-bg --pill-ink --amber/-bg
--green/-bg --red/-bg --blue/-bg --gray/-bg --focus --frost --sh-card --sh-hero`) scoped to `.stage`
(light) / `.stage[data-theme="dark"]` (dark) — the prototypes' operative names. Older sections above
cite the F-S2 `--t-*` architecture (section 3.9); the two naming schemes are the **same tokens** —
`--t-*` is the production/app-code binding, the unprefixed set is the prototype clone. The §8.4
unmocked-screen composition rule still governs; these subsections add the flow-level choreography the
static anatomies (§8) do not carry. Live-state anchor: `docs/tech-redesign/SESSION-STATE.md`.

### 12.0 Owner flow decisions (2026-07-14/15 — binding, do not relitigate)

| # | Decision | Ruling |
|---|---|---|
| 4a | Job save → destination | **Land on the new job hub** (not a forced schedule chain). The hub carries a quiet, non-forced "Schedule a visit" row. |
| 4a | Quick-add customer scope | **Job-flow-only, minimal** (name + phone). Duplicate phone auto-selects the existing customer. Full role/company/billing lives in the standalone New Customer flow (§12.2). |
| 4c | Tech scheduling | **Full tech self-service** — the "Add visit" create affordance is first-class (a FAB on Schedule, peer to the dashboard create). |
| 4c | Appointment title | **Editable with auto-suggestion** — pre-filled from the job's type/phases, tech may override (a `#i-pencil` affordance signals editability). |
| 4d | Finish pill | **Finish is always the solid black two-tap pill** — NOT gated/quieted while tasks remain. *(Supersedes §6.A.1 "ripened quiet-pill" and §8.2 "state-aware Finish" — struck in place 2026-07-15.)* |
| 4f | Last open task completes | **Both** the Done-collapse (completed tasks fold to "Done (N)") **and** a coordinated emphasis moment fire together. Finish stays black (per 4d); the "you're clear to finish" acknowledgement is the collapse + a check-pop + `notify()` haptic + a "All tasks done" toast — NOT a pill state change. |
| 4b | Customer save → destination | **Land back with a success toast** (stay in `/tech/*`; no desktop dead-end). |
| 4g | Chamber setup | **Full tech chamber control** — techs may create chambers, assign rooms, set tolerances in the field. *(Chambers have no native UPR table — §11.5; native model is a separate reviewed change; Rooms remains the fallback grouping.)* |
| 4e | Burst photo capture | **Not adopted** — the single snap-first loop (capture → instant upload → dismissable "Add note" toast) stays the law. |
| — | Create-new-job from Add-visit | **Launch the full New Job flow, return the selected job** (§12.1) — not an inline mini-form. Scope the return-handoff so the UX makes sense. |
| — | Activity-log content | **System-automated events only** (not tech-sent messages), PLUS invoices created & sent and estimates created & sent, on top of the base lifecycle events. See §12.5.1. |

### 12.3 New / Edit Appointment — "Add visit" (LOCKED 2026-07-14)

Prototype of record: `schedule.html` → `s-addvisit`. The owner's verdict: *"we nailed the schedule
and appointment creation part."*

- **Full-screen PAGE, never a bottom sheet.** Long creation forms are full-screen pages; only
  pickers and quick actions are bottom sheets. Structure: a **pinned header with a reachable 48px X
  (top-left, inside the safe area — never clipped under the notch)** + title "Add visit" · a normal
  `.main` page scroller (so every field reaches on any iPhone) · a **pinned footer** carrying the one
  black primary pill. *(This resolved repeated iPhone reports of a sheet that wouldn't scroll, a
  clipped title, and an unreachable close.)*
- **Fields, top to bottom:**
  - **Job** — a field-picker row opening the `sheet-job` picker (see §12.6.1: it MATCHES the polished
    search-result layout AND carries a "Create new job" entry that launches §12.1 and returns the
    selected job).
  - **Date** — opens the **native iOS date picker** (`<input type="date">`), never the Chromium/
    desktop dropdown. The calendar glyph sits **on the same line as the date value** (a mismatched
    line was flagged "funky").
  - **Start** and **End** — **two blocks side-by-side**, each opening its own native time list sheet
    (`sheet-time-start` / `sheet-time-end`, capped `max-height:min(440px,58svh)`). Both are required —
    the UI makes the end-time obligation explicit.
  - **Type of visit** — choice chips; **no checkmark** (the check clipped longer words like
    "Reconstruction"); selection is shown by the chip's fill/border alone. Removed at kit level
    (`.choice-check{display:none}`, symmetric `.choice` padding).
  - **Title** — editable text, **auto-refreshes from the chosen type** until the tech overrides it
    (decision 4c; pencil affordance).
  - **Crew** — multi-select tech list; ships supporting **4–5 technicians** so the list scrolls.
  - **Notes** — the §12.4.2 note component (add / edit / ownership-transfer).
- Native pickers are an on-device iPhone gate (the owner tests them via the live artifact; Chromium
  cannot render the iOS wheel).

### 12.4 Clock state-walk & Finish resolution (LOCKED 2026-07-15)

Prototype of record: `job-hub.html`. Five clock states, each a full hub render; the stage clock color
IS the state (the 5-status law), status shown glyph **and** word (survives grayscale):

| State | Timer color | Header chip (glyph+word) | Primary black pill | Secondary |
|---|---|---|---|---|
| Scheduled | blue `2:00` countdown | blue clock · Scheduled | **On my way** (arrow) | — |
| On my way | amber `H:MM:SS` up | amber arrow · On my way | **Start work** (dot-in-ring) | — |
| Working | green `H:MM:SS` up | green dot-in-ring · Working | **Finish · N left** (flag, two-tap) | quiet Pause (pause-bars) |
| Paused | red `H:MM:SS` frozen | red pause-bars · Paused | **Resume work** (dot-in-ring) | quiet **Finish visit** (flag) |
| Done | gray `H:MM:SS` total | gray check · Done | **Back to schedule** | — |

- **Finish (decision 4d):** always the solid black two-tap pill. While checklist tasks remain it reads
  **"Finish · N left"** with the microcopy "First tap arms · Tap again to finish"; it is NEVER the
  quiet outlined pill. First tap arms (label → "Tap again to finish", ~3s auto-disarm, blur cancels);
  second tap finishes.
- **Last-task-completes moment (decision 4f):** checking the final open task **decrements the "· N
  left" count to zero, collapses the completed rows to "Done (N)", drives the progress bar to 100%,
  fires a check-pop + `notify('success')` haptic, and raises an "All tasks done · Ready to finish this
  visit" toast.** Finish stays black throughout (no ripen).
- **Paused precedence:** on Paused the primary black pill is **Resume work** (the tech paused to step
  away; resuming is the intent); **Finish visit** drops to the quiet secondary — one black pill still
  holds. *(Owner may still promote Finish to primary on Paused on reaction — open.)*
- **Done breakdown (per §8):** the Done state shows **Travel · On-site · Total** (e.g. "Travel 18m ·
  On-site 3h 24m · Total 3h 42m"), never a bare total; completed tasks collapsed to "Done (5)".

### 12.5 Job hub composition (LOCKED 2026-07-15 — owner: "amazing")

Prototype of record: `docs/tech-redesign/prototypes/job-hub.html` (artifact
`claude.ai/code/artifact/96992ae5-afe9-4ed7-9d5d-b44f3ee35c86`). The hub is **job-centric — "the job hub
IS the job"** (there is no separate mobile job page). It fills the §8.2 structure with an adaptive hero
and a top action model.

**Adaptive hero — deterministic, data-driven (never a guess):**
1. Any visit on this job **IN PROGRESS** (timer running — OMW/Working/Paused) → that visit's **live clock
   card**. Always wins (you can't be "reviewing" while clocked in).
2. Else arrived from a **specific appointment** (schedule route carries the appt id) → that appointment's
   **clock card** (Scheduled → On my way).
3. Else (from **Jobs/Claims nav**, nothing running) → the **job-status hero** (no clock).
Decided by "is a timer running?" + "did an appointment send me here?" — both facts. A Finish button never
appears with nothing to finish.

**Clock card (appointment mode) — the LOCKED hero (owner: "perfect, don't touch"):** a top strip with the
appointment date + time window ("Today · 9:00–11:30 AM") on the left and an **Edit** chip on the right
(Edit is appointment-scoped — reschedule/change *this* visit; in job-mode there is no global Edit, you
edit a visit from the Visits list); the stage clock (color = state); the station rail (stamps = TIMES; on
Done the Travel/On-site/Total breakdown carries the DURATIONS — never both, §fixed 2026-07-15); the primary
pill (Finish always solid black per §12.4; Resume on Paused; Back-to-schedule on Done) + Pause; the
**address row = the navigate affordance** (tap → maps — present in BOTH hero modes, which is why there is
no Navigate button); the office-note glance = the appointment note (§12.5.2).

**Job-status hero (job mode):** phase title + a Drying-day chip, stat tiles (Materials dry / Open tasks /
Photos), a **"Next visit" row** (tap → focuses/starts that visit = appointment mode), the address row
(navigate). No clock.

**Top action model (both modes):** the header **customer name is tappable → Customer page** (chevron
affordance) and the **claim # is tappable → Claim page** (underline) — **NO pills** (removed; the hub is
the job). Action bar: **Call · Text · Docs · Notes** (icon + label; Notes carries a count badge). Docs and
Notes open dedicated pages (§12.5.3). **No Photo in the bar** — capture is room-first (§12.5.2).

**Do-now zone (active work, in order):** **Drying widget** (Day N · materials dry · readings-due; taps
into the **"Dry Logs"** module — *name picked by the owner 2026-07-17*) →
**Tasks** (collapsible, DEFAULT-COLLAPSED per owner) → **Scope-sheet entry** (fill-on-site) → **Rooms
grid**.

**Look-up tail (in order):** **Visits on this job** → **Activity** (§12.5.1). The old "Job & Claim" and
"Documents & signatures" sections and the inline Job-notes section are REMOVED (now the clickable header,
the Docs page, and the Notes page). **No floating dock** on the hub (capture is room-first); the room
detail keeps its Add Photo/Note dock.

#### 12.5.1 Activity log (spec locked by decision — owner-authored content rule)

An in-hub reverse-chronological log. Each entry: a leading 24-grid glyph, an event line, and an
**actor** (`Marcus` for the tech, `System` for automated events, `Dana (office)` for office staff).
**Included:** the job lifecycle (job created, visit scheduled, on-my-way, equipment placed/pulled,
water-loss report generated, moisture readings logged), **system-automated messages sent** (never the
tech's own sent SMS/notes), **invoices created & sent**, and **estimates created & sent**. Money and
document events (`#INV-…`, `#EST-…`) carry their number. This is a read surface — no send affordance
lives here (consent/send stays on the frozen worker path).

#### 12.5.2 Room-first capture + three note scopes (LOCKED)

Photo capture is **ROOM-FIRST** — there is no Photo action on the hub. A tech opens a room → Add Photo →
it files to that room, so there is never a "which room?" pick and never a misfile (owner integrity call —
beats raw snap-speed; matches Encircle). Room detail = header + **Photos | Notes** tabs + an Add Photo/Note
dock. The **Rooms grid** is the documentation spine: 2-col cover-photo tiles (a **house icon** when there
is no cover) + name overlay + photo-count badge, plus an "Add room" tile and an **"Unsorted"** bucket for
any unfiled photo.

**Three note scopes, kept visibly distinct:**
- **Appointment note** — written at appointment creation, editable from the hub → the pinned "Office note"
  glance in the clock card.
- **Job notes** — job-wide → the dedicated Notes page (§12.5.3). A job note may carry a **bold title + an
  attached photo grid** (the Encircle documentation model — techs document preexisting damage for carriers).
- **Room notes** — per-room → inside each room's Notes tab.
A Note action writes a *job* note from the hub, a *room* note from inside a room.

#### 12.5.3 Dedicated pages — Notes & Docs (twins, LOCKED)

Both open from the action bar; both are full pages with the app shell + a back button.
- **Job Notes page:** a count + Add-note; notes **grouped by date** (Pinned / Today / date labels), each
  note an **individual card**; the pinned note is tinted + distinct; notes support title + photo grid
  (§12.5.2).
- **Documents page:** a **Signatures** section (Work Auth *Signed*; other docs carry an *Unsigned* /
  request status — long titles stay one line), a prominent **Generate Water Loss Report** CTA (built from
  rooms/readings/equipment), a **Documents** list (PDFs), and a **black + FAB** → a **"Request a
  signature"** bottom sheet listing the e-sign document types (Work Authorization, Certificate of
  Completion, Certificate of Satisfaction, Authorization to Pay Direct, Mold Remediation Consent,
  Non-Restorable Contents Release) → generate & send.

**Hub foundations (BUILT 2026-07-17, local session — WebKit-verified light+dark, pending owner
on-device reaction):**
- **Work Authorization compliance ALERT** (`.wa-alert`): a prominent red-tinted banner (icon tile +
  title + sub + chevron), the FIRST element in `.main` — above the action bar. **Data rule: renders on
  EVERY hub screen (any clock state, either hero mode) while the job's `work_auth_signed === false`;
  disappears once signed** — the calm Signed row lives on the Docs page. Tap → the Docs page, starting
  the Work Authorization e-sign (live app precedent: `startEsign:'work_auth'`). Copy carried verbatim
  from the live app: "No signed Work Authorization" / "Tap to collect the customer's signature".
  Demoed on `s-scheduled` (the natural sign-before-you-start moment).
- **Crew strip** (`.crew-strip`): a quiet one-line card directly AFTER the hero in all 5 clock states —
  overlapping initial avatars (lead = solid `--pill-bg`, others `--surface2`) + "**You** (Lead) ·
  Diego R. · Priya N.". Visit-scoped (`appointment_crew`), so job mode carries no strip; read-only —
  crew changes go through the stage Edit chip. (Alternative if the owner prefers: fold it into the
  hero card under the office-note glance — 2-minute move.)

The drying module is named **"Dry Logs"** (owner pick, 2026-07-17). "Dry Logs" labels the MODULE
(widget title, module page header, module toasts); the word "Drying" stays wherever it names the job
**phase** ("Drying · Day 4" chips, phase status) — the phase is a state, the module is a tool.

### 12.6 Schedule — month & day (LOCKED 2026-07-14)

Prototype of record: `schedule.html`. States: `s-month`, `s-day`, `s-day-empty`, `s-loading`
(skeleton), `s-error` (banner over stale rows), `s-search`, `s-addvisit` (§12.3).

- **Month view — tapping a day updates IN PLACE.** A day-cell tap re-renders that day's appointments
  in the **preview panel below the grid** (busy / mid / light / empty variants); it does **NOT** switch
  to the daily view. The daily view is a separate, optional destination. *(This corrected the original
  behavior where a day-tap force-switched the whole screen to Day.)*
- **Day view** carries a week strip (tap a weekday to switch days), prev/next day arrows, a glance
  timeline, and the day's panels.
- **First-class create:** an "Add visit" FAB (peer to the dashboard create) opens §12.3 (decision 4c).
- **State law (honored):** cold load → skeleton (`s-loading`); a failed load → **error banner over the
  last-good rows, never the empty state** (loading-error-states §1); a genuine empty day → upcoming
  work, not a dead end (tech-mobile-ux empty-state rule).

#### 12.6.1 Polished search-result layout (SHARED — reuse anywhere a job/claim is searched)

Locked in `s-search` and reused verbatim by the Add-visit `sheet-job` picker. Three lines:

1. **Water-loss type + abbreviated date of loss** on one line (people have >1 flood in the same
   month — the DOL disambiguates).
2. **Full street address + city** on the second line.
3. **Claim number + job number** on the last line — standardized **smaller (12px, `white-space:nowrap`)
   so they ALWAYS fit one line**, regardless of the row's right-side chip width.

The `sheet-job` picker prepends a **"Create new job"** entry (launches §12.1, returns the selection).

### 12.1 + New Job sequence — (built; owner wants rework, deferred after the hub)

Prototype `new-job-flow.html` exists (7-step: FAB create menu → customer quick-add → job type
[division + referral] → claim fork [new/existing + carrier + claim# + loss address] → review →
non-blocking "Job created · sync pending" → land on the hub). The owner has asked to **improve the job
creation workflow**; specifics held. Do NOT lock this subsection until the rework lands. Division
precedes Claim (OOP gating). Job-numbering scheme is a pending open item (is `#26-1173` the claim or
the job number?).

### 12.2 Standalone New Customer — (not yet built)
Land-back-with-toast (decision 4b). Fold after built.

### 12.7 Hydro entry (add reading / place-pull equipment / chamber setup) — (not yet built)
Full tech chamber control (decision 4g). Fold after built.
