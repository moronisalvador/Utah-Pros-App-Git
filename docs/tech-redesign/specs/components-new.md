# Direction B "Apple Field Pro" — Completeness-Bar Components (not yet in the mockups)

**Status:** Direction B is LOCKED. This spec extends the locked language of the three screens of
record (`direction-b.html`, `refine-b-jobhub.html`, `hydro-b.html`) to the twelve components the
mockups did not draw. Every value here is exact and build-ready: a build session implements from
this file alone. Thesis unchanged: **ink is the brand, color is state.** Chromatic color appears
only as field status (amber OMW, green working, red paused, blue scheduled, gray done), semantic
good/warn/critical, and the focus ring. Persona law throughout: 64-year-old gloved tech — 48px
primary targets, 44px documented-secondary, 16px on every focusable text input (iOS anti-zoom),
11px floor (badge numerals only), 12px floor for anything actionable, primary contrast leaning 7:1,
status always shape-redundant.

**Voice and finish (applies to all twelve):** soft layered neutral surfaces, the two committed
shadow levels only (`--sh-card`, `--sh-hero`), radius family outer 20 / nested 14 / controls 12 /
pills-chips 999 (inner always smaller than outer), Source Sans 3 with the exact type band
(15 body, 13/500 meta, 12/600 labels, 11 badge numerals only, tabular-nums on every number),
duotone rounded icons (24px grid, 1.8px stroke, round caps, silhouette fill at `opacity:var(--duo)`
default .16), press feedback `transform: scale(.97)` at 120ms ease-out on large controls and
`scale(.94)` on small icon-only controls. The ONE frosted surface budget is already spent on the
tab bar — nothing in this file uses `backdrop-filter`. No side-stripe status borders anywhere.

**Mechanism (survey:architecture):** everything below is values poured into the existing F-S2
machinery — components read `var(--...)` only; dark theme is the `[data-theme="dark"]` re-declare
block; behavior contracts of the existing `src/components/ui/` primitives (Modal exit lifecycle,
SearchInput string-onChange, ErrorState/EmptyState semantics, `useTwoClickConfirm`), `lib/toast.js`
single entry, tv2 skeleton cold-start law, and `usePhotoUpload`/`thumbUrl` as the single media-URL
seam are all KEPT; only their look changes.

---

## 0. New tokens this file introduces

Add to the Direction B token block (same two-theme re-declare mechanism as the mockups). Everything
else in this file uses the already-locked tokens verbatim.

| Token | Light | Dark | Used by |
|---|---|---|---|
| `--focus-halo` | `rgba(31,86,196,.20)` | `rgba(138,176,247,.28)` | field/search/select focus ring halo |
| `--scrim` | `rgba(12,12,13,.44)` | `rgba(0,0,0,.60)` | bottom sheet, desktop modal, FAB dim |
| `--sheet-handle` | `rgba(20,21,24,.16)` | `rgba(243,244,246,.20)` | sheet drag handle |
| `--skel` | `#E9EAED` | `#27282B` | skeleton block base |
| `--skel-hi` | `rgba(255,255,255,.55)` | `rgba(243,244,246,.05)` | skeleton shimmer sweep |
| `--field-border` | `rgba(20,21,24,.10)` | `rgba(243,244,246,.12)` | resting input border (one step above `--hair` so fields read as fields on white cards) |

Focus rule (locked, restated): keyboard focus everywhere is `outline: 2px solid var(--focus);
outline-offset: 2px`. Text-entry controls (1, 2, 10) get a designed *tap* focus state instead
(border swap + halo, below) because focus on them is the working state, not a traversal state.

---

## 1. Text field (`.fld`) and textarea

The workhorse of the create/edit forms. Sits on a `--surface` card; the field itself is a soft
inset — the seg-track idiom generalized.

**Anatomy:** label row, control, optional helper/error row. Vertical rhythm: label, 6px gap,
control, 6px gap, message row. Fields stack at 16px gaps inside a card.

**Label:** 13px / 600, sentence case, `color: var(--ink2)`, `letter-spacing: 0`. Optional
"(optional)" suffix 13px / 400 `var(--ink3)`. *Disclosed deviation:* the band assigns 12/600 to
labels; form labels are promoted one step to 13/600 because they are primary reading while filling
a form in the field — this is a designed exception, not drift. Never uppercase (the ALLCAPS
micro-label kit is legacy; it does not carry into Direction B).

**Control (single-line):**
- `min-height: 48px`; `padding: 12px 14px`; `border-radius: 12px` (controls radius).
- `font: 400 16px/1.4 "Source Sans 3"` — **16px is law on every focusable text input** (iOS
  anti-zoom); `color: var(--ink)`; `caret-color: var(--focus)`.
- `background: var(--surface2)`; `border: 1px solid var(--field-border)`;
  `box-shadow: var(--sh-seg-track)` (the soft inset — fields read pressed-in, buttons read raised).
- Placeholder: `color: var(--ink3)` (holds the 4.5:1 muted floor in both themes), same 16px, never
  used as the label.
- Numeric fields (readings, quantities): `font-variant-numeric: tabular-nums`,
  `inputmode="decimal|numeric"`.

**States:**
- **Focus (tap or keyboard):** `background: var(--surface)`; `border-color: var(--focus)`;
  `box-shadow: 0 0 0 3px var(--focus-halo)`; transition `border-color 120ms ease-out,
  box-shadow 120ms ease-out, background 120ms ease-out`. No outline (the border+halo IS the ring
  here); `:focus-visible` on non-text controls keeps the global 2px outline.
- **Filled (resting, has value):** identical to rest; value at `var(--ink)` 16px.
- **Error:** `border: 1.5px solid var(--red)`; halo off until refocus (refocused error field shows
  `0 0 0 3px` halo mixed from red: light `rgba(187,39,39,.16)`, dark `rgba(241,120,120,.22)`).
  Message row: 16px duotone alert-triangle glyph in `var(--red)` (silhouette fill
  `opacity:var(--duo)`), 6px gap, text 13px / 500 `var(--red)`, `margin-top: 6px`. Wire
  `aria-invalid="true"` and `aria-describedby` to the message row id. The field background does NOT
  tint red — border + message carry the state (color is state, sparingly).
- **Disabled:** whole group at `opacity: .55` (the locked "Soon"-row dimming), `cursor: default`,
  no background change. Read-only variant (office-locked values): background `transparent`, border
  `1px solid var(--hair)`, value `var(--ink2)`.

**Textarea variant:** same tokens; `min-height: 96px` (three 16px lines + padding); grows with
content to a 5-line cap where auto-grow is wired (composer contract), then scrolls internally;
`resize: none`; `border-radius: 12px`. Character-limit counter (feedback form): 12px / 500
`var(--ink3)` tabular-nums, right-aligned in the helper row, switches to `var(--red)` at limit.

Keyboard law (from the hub mockup, binding): any docked bar (HubDock, module dock) hides itself on
`focusin` of any text input and returns on `focusout`.

---

## 2. Select / picker row

Two forms, one look. The choice rule: a **native select** for short, flat option sets the OS
renders well (the 30-minute `TIME_OPTIONS`, language, type enums up to ~6); a **sheet picker** for
anything with more than ~6 options, option metadata, or search (job select, room select, carrier).

**Native select (styled):**
- Identical box to the text field: 48px min-height, radius 12, `background: var(--surface2)`,
  `border: 1px solid var(--field-border)`, inset `--sh-seg-track`, value `16px/400 var(--ink)`
  (16px also prevents select-focus zoom on iOS), `appearance: none`.
- Trailing chevron-down: drawn duotone glyph (24px grid, 1.8px stroke, round caps), rendered 20px,
  `color: var(--ink3)`, positioned `right: 14px`, centered vertically; `padding-right: 44px` so the
  value never collides. The chevron is part of the component (an SVG background or absolutely
  positioned sibling), never the UA arrow.
- Focus/error/disabled states: identical to the text field (border swap + `--focus-halo`).
- Placeholder state (no value): first option label at `var(--ink3)`.

**Sheet-picker row (the field-side control that opens a bottom sheet):**
- Renders as the same field box but as a `<button>`: value 16px `var(--ink)` (or placeholder
  `var(--ink3)`), trailing chevron; press `scale(.97)` 120ms.
- Opens the §5 bottom sheet titled with the label. Options are 52px rows: 15px / 500 `var(--ink)`
  label, optional 13px / 500 `var(--ink3)` meta line, trailing 20px duotone check glyph in
  `var(--ink)` on the selected row only; row press = `background: var(--surface2)`; rows separated
  by `1px solid var(--hair)`; selection closes the sheet and fires `selection()` haptic. Sets of
  12+ get the §10 search input pinned under the sheet title.
- Selection state on the sheet is check-glyph + weight (600 on selected), never color-only —
  shape redundancy holds even here.

---

## 3. Checkbox and radio

The task check-circle from the hub checklist, generalized into a form control family. Drawn — never
the UA control.

**Checkbox:**
- Visual box 26px, `border-radius: 8px` (small continuous corner, same hand as the icon family);
  hit area is the whole labeled row, `min-height: 48px`, or a padded 48px square when standalone.
- **Unchecked:** `background: var(--surface)`; `border: 1.8px solid var(--ink3)` (the icon-family
  stroke weight — the control reads as one of the icons).
- **Checked (form/option role — the default):** `background: var(--ink)`; border none; check glyph
  13px stroke path in `var(--surface)` at 1.8px round caps. Ink, not green: a chosen setting is
  identity, not status.
- **Checked (task/completion role — opt-in variant `data-role="task"`):** `background: var(--green)`;
  check glyph in `#fff` (light theme); dark theme swaps `--green` to the retuned `#54C98B` and the
  check to `#141416` for contrast. Completion is semantic-good, so chromatic is earned.
  This is the generalization of the 28px task circle; task lists may keep the 28px circle size
  with `border-radius: 999px`.
- **Check pop:** on check, glyph scales .6 to 1 over 200ms `--motion-ease-decelerate` (the
  check-pop idiom); uncheck is instant. Reduced motion: instant both ways.
- **Row label:** 15px / 500 `var(--ink)`, 12px gap from the box; task variant strikes through and
  drops to `var(--ink3)` when done.
- **Error** (required consent unchecked on submit): border swaps to `1.8px solid var(--red)` +
  a §1-style message row under the group. **Disabled:** group at `opacity: .55`.
- Focus: global 2px `var(--focus)` outline, offset 2, radius 12.

**Radio:**
- 26px circle, `border-radius: 999px`; unchecked `1.8px solid var(--ink3)` on `var(--surface)`.
- Selected: `border: 1.8px solid var(--ink)` + centered 12px dot `background: var(--ink)`. Dot
  enters with the same 200ms decelerate pop. Always ink — a radio choice is never a status.
- Group layout: 48px rows, label 15px / 500; radios never lay out horizontally denser than two.
- States (error, disabled, focus) identical to checkbox.

Haptics: `selection()` on every checkbox/radio change (native only, additive).

---

## 4. Toggle switch

The settings/private-visit control. Sliding knob on a soft track; the ON state wears the pill
identity, not a chromatic accent.

- **Track:** 52px by 32px, `border-radius: 999px`.
  - OFF: `background: var(--surface2)`; `box-shadow: var(--sh-seg-track)` (inset — the seg-track
    idiom again).
  - ON: `background: var(--pill-bg)` (ink black in light, near-white in dark) — the toggle ON is
    literally the black-pill identity. No green: on/off is a preference, not a field status.
- **Knob:** 28px circle, 2px inset from track edge; `background: var(--seg-thumb)` when OFF
  (`#FFFFFF` light / `#313337` dark) with `box-shadow: var(--sh-seg-thumb)` so it reads raised in
  both themes; when ON, `background: var(--pill-ink)` (white knob on ink track in light; graphite
  knob on near-white track in dark) with the same thumb shadow.
- **Motion (fast tier):** knob `transform: translateX(20px)` transition 120ms ease-out; track
  background 120ms ease-out. Nothing springs — a toggle is a high-frequency control; press
  acknowledgment is the state change itself. Reduced motion: instant.
- **Hit area:** 48px minimum height and width via padding; in settings rows the entire row
  (min-height 52px, label 15px / 500 left, toggle right) is the target.
- **States:** disabled at `opacity: .55`; focus = global 2px `var(--focus)` outline offset 2,
  radius 999. `role="switch"` + `aria-checked`; label via the row text (`aria-labelledby`).
- Haptic `selection()` on change. Shape redundancy: ON also differs by knob position AND track
  value contrast, so state survives grayscale by geometry alone.

---

## 5. Bottom sheet

THE field-action container (house law: no modals for field work). Implemented as the existing `ui`
Modal primitive's mobile branch reskinned — keep its focus-trap, `--closing` exit lifecycle,
scroll-lock, and overlay-close (mousedown AND click must both land on the scrim) contracts.

**Scrim:** `background: var(--scrim)`; fades in over `--motion-duration-base` (240ms)
`--motion-ease-decelerate`, fades out with the exit.

**Panel:**
- Pinned to the bottom edge, full width; `border-radius: 20px 20px 0 0` (outer card radius);
  `background: var(--surface)`; `box-shadow: var(--sh-hero)`; no border in light; dark adds
  `box-shadow: inset 0 1px 0 rgba(243,244,246,.06)` on top of `--sh-hero` so the lifted edge reads
  against `--ground`.
- `max-height: calc(88dvh - var(--safe-top, 0px))`; body scrolls internally
  (`overscroll-behavior: contain`); `padding: 0 16px calc(16px + max(12px,
  env(safe-area-inset-bottom, 12px)))`.
- **Drag handle:** 36px by 4px, `border-radius: 999px`, `background: var(--sheet-handle)`,
  centered, 8px from the top edge, inside an invisible 48px-tall grab strip. Today it is a visual
  affordance only (see gesture note).
- **Header (non-scrolling):** title 17px / 600 `var(--ink)` `letter-spacing: -0.005em`
  `text-wrap: balance`, top padding 24px (below the handle strip); optional close button top-right:
  44px square (documented-secondary), radius 12, drawn cross glyph 16px at 1.8px stroke
  `var(--ink2)`, press `scale(.94)` + `background: var(--surface2)`. Optional 13px / 500
  `var(--ink2)` subtitle.
- **Footer actions** (when the sheet commits something): one full-width black pill
  (`var(--pill-bg)` / `var(--pill-ink)`, 54px, radius 999, 17px / 600) — the sheet's ONE primary —
  plus at most one quiet secondary (48px, radius 14, `background: var(--surface2)`,
  15px / 600 `var(--ink)`).

**Motion:**
- **Enter:** `transform: translateY(100%)` to `0` over `--motion-duration-base` (240ms) on
  `--motion-ease-decelerate`; `--motion-spring-in` is ALLOWED here (the sheet enter is a
  non-interruptible occasional one-shot) — but stays OFF any sheet that commits money/billing
  (admin-mobile estimates, OOP pricing save) per the spring constraint.
- **Exit (never instant-unmount):** on close the panel gets the `--closing` class, plays
  `translateY(0)` to `translateY(100%)` over 180ms (75% of enter) on `--motion-ease-accelerate`,
  and unmounts on `animationend` with the 240ms safety timeout — the Modal primitive's exact
  lifecycle. Scrim fades out on the same clock. An `if (!open) return null` is a defect.
- Reduced motion: both directions collapse to instant; end state and focus handling still land.

**Behavior:** focus moves to the panel on open; Tab is trapped; ESC closes (hardware keyboard /
desktop); tap on scrim closes; focus restores to the invoking control on close. `role="dialog"`,
`aria-modal="true"`, `aria-labelledby` the title. While a sheet is open the page behind does not
scroll.

**Drag-to-dismiss (note, owner-gated):** real finger-tracked dismissal (1:1 drag, velocity
release, grab-and-reverse) belongs to the scoped dependency-free pointer+spring gesture util of the
motion-standard gesture wave — the sheet is one of its three sanctioned surfaces. Do NOT fake it
with a long CSS transition. Until that wave lands, dismissal is scrim-tap, close button, or the
committing action.

**Desktop-modal note:** mobile `/tech/*` uses sheets, always. The centered modal (overlay fade,
panel fade + scale .96 to 1, `transform-origin: center`, radius 20, `--sh-hero`, same exit-at-75%
lifecycle) exists only for non-field admin/office flows at 768px and up — the existing `ui` Modal
already performs this switch; this spec restyles both branches with the same tokens.

---

## 6. Toast

Feedback stays one channel: only `src/lib/toast.js` (`toast` / `ok` / `err`) may raise a toast —
the component is shell-owned and never imported directly (eslint-enforced law). Containers carry
`role="status" aria-live="polite"`; error toasts render `role="alert"`.

**Placement:** fixed, horizontally centered; `bottom: calc(var(--tech-nav-height) + max(12px,
env(safe-area-inset-bottom, 12px)) + 12px)` — always above the tab bar; screens with a docked
action bar (HubDock, module dock) add that dock's height (72px) to the offset so a toast never
covers a control. Stack is column-reverse (newest at bottom), 8px gaps,
`width: min(420px, calc(100% - 32px))`.

**Surface:** `background: var(--surface)`; `border-radius: 14px` (nested radius);
`box-shadow: var(--sh-hero)` (a toast floats over everything — it earns the big shadow);
`padding: 12px 14px`; dark theme adds `inset 0 1px 0 rgba(243,244,246,.06)`. NO status side-stripe
(banned); the variant is carried by the leading glyph.

**Anatomy:** leading 20px duotone glyph (silhouette fill `opacity:var(--duo)`) in the variant
color; 10px gap; text column: optional title 15px / 600 `var(--ink)`, message 15px / 500
`var(--ink)` clamped to 3 lines; trailing dismiss: 44px square hit (glyph 14px cross at 1.8px,
`var(--ink3)`), documented-secondary.

**Variants:** success = check-circle glyph `var(--green)`; error = alert-triangle `var(--red)`;
info = info-circle `var(--blue)`. Glyph + wording carry the state (shape redundancy); text never
recolors.

**Action toast** (the "Photo saved, Add note" pattern): message + one trailing text action, 14px /
600 `var(--blue)`, min 44px hit, 4s timer; tapping runs the action and dismisses.

**Motion:**
- **Enter via `@starting-style`** on a *transition* (never a keyframe — a second toast must
  retarget, not restart from zero): from `opacity: 0; transform: translateY(12px)` to resting, over
  `--motion-duration-base` on `--motion-spring-in` (the toast enter is the catalogued spring
  one-shot).
- **Exit:** auto-dismiss at 5s (action toast 4s); `--leaving` class plays `opacity` to 0 +
  `translateY(8px)` down over 180ms (75%) on `--motion-ease-accelerate`; DOM removal on
  `animationend` (mirrors the Modal lifecycle). Manual dismiss uses the same exit.
- Reduced motion: instant in/out.

**Swipe-dismiss (note, owner-gated):** the swipe-to-dismiss toast is the second sanctioned surface
of the scoped gesture util (flick-velocity threshold, settle handed to a CSS transition). Until
that wave lands, the per-toast dismiss button is the manual path.

---

## 7. Skeletons

Cold-start only — LAW: a skeleton may render only when there is no cached content; cached content
is never replaced by a skeleton (resume, pull-to-refresh, and refetch are always silent). These
reskin the tv2 `SkeletonBlock / SkeletonRow / SkeletonList` primitives.

**Block:** `background: var(--skel)`; radius mirrors the element it stands in for — text lines 6px,
chips 999, controls 12, nested cards 14, outer cards 20, avatars 999. Text-line blocks are the
real line-height tall (15px body line = 15px block).

**Shimmer (optional, reduced-motion-safe):** an overlay `linear-gradient(100deg, transparent 30%,
var(--skel-hi) 50%, transparent 70%)` sweeping `background-position` 200% to -200% over 1.6s linear
infinite, opacity delta kept subtle. Under `prefers-reduced-motion: reduce` the sweep is removed
entirely and blocks render static — never an opacity pulse substitute.

**Dash pattern (cold start of `/tech`):** greeting header renders REAL (it needs no data beyond the
user already in context) — never skeleton chrome; below it: one hero-shaped card (`--surface`,
radius 20, `--sh-card`, height 168px) containing a 40% 13px line, a 70% 23px line, and a 54px
pill-shaped block; then three list-row skeletons; then a numbers-row card with three 22px tabular
blocks at 30% width.

**List pattern (schedule/claims/messages/tasks):** 5 rows (the `SkeletonList` default), each 64px:
leading 26px circle block (999), title line 60% by 15px, meta line 40% by 13px, trailing chip block
60px by 24px (999). Rows separated by `1px solid var(--hair)` exactly like real rows so the swap is
seamless.

**Detail pattern (hub/claim/job):** compact header bar block (radius 12, 44px), one stage-shaped
card (radius 20, 200px), then two section cards (radius 20, 120px each) with internal 15px/13px
line pairs. Never skeleton the docked bars or tab chrome — chrome is real from first paint.

---

## 8. Empty state

Renders ONLY after a successful load with zero rows — never on failure (that is §9), never during
loading (that is §7). Reskins the `ui` EmptyState contract (`icon, title, sub, action`).

- Centered column, `padding: 48px 24px`, `text-align: center`.
- **Icon:** 64px circle `background: var(--surface2)`, containing a 28px duotone glyph
  `color: var(--ink3)` (silhouette fill at `--duo` .16) — the family hand, quiet, never chromatic.
- **Title:** 16px / 600 `var(--ink)`, `text-wrap: balance`, margin-top 14px.
- **Sub:** 13px / 500 `var(--ink2)`, max-width 34ch, margin-top 4px.
- **Action (optional):** margin-top 16px. If the action is the screen's one primary (e.g. "New
  appointment" on an empty schedule), it is the black pill (54px, radius 999, 17px / 600). If the
  screen's primary lives elsewhere, the action is the quiet secondary (48px, radius 14,
  `var(--surface2)` bg, 15px / 600 `var(--ink)`), preserving the one-primary-action law.
- **Tech law (binding):** a tech empty state shows upcoming work, never a dead end. When "today" is
  empty, the panel is followed by the real "Coming up" next-7-days rows (the dashboard idiom);
  Tasks' empty "Today" links to All; Claims' empty search offers clear-search. The EmptyState
  component renders the panel; the page supplies the upcoming-work content below it.

---

## 9. Error state

The failed-load panel — LAW: a failed load NEVER renders the success empty-state or a blank page.
Every load catch sets `loadError` and renders this (or keeps stale rows + the banner variant).
Reskins the `ui` ErrorState contract (`role="alert"`, fixed title, `onRetry`); the legacy warning
emoji default is replaced by a drawn glyph.

**Panel variant (no stale data):**
- Same geometry as §8: 64px circle, here `background: var(--red-bg)`, with a 28px duotone
  alert-triangle in `var(--red)`.
- Title: fixed copy "Couldn't load", 16px / 600 `var(--ink)`.
- Message: 13px / 500 `var(--ink2)` (specific, human: "Check your connection and try again").
- **Retry:** 48px quiet secondary (radius 14, `var(--surface2)`, 15px / 600 `var(--ink)`, label
  "Try again") — deliberately NOT the black pill: the pill is reserved for the screen's primary
  action, and an outage is not it. Optional secondary text link (e.g. "Back") 14px / 600
  `var(--blue)`, 44px hit.

**Banner variant (stale rows exist — prefer it):** keep the already-loaded rows visible; above
them a full-width banner card: radius 14, `background: var(--red-bg)`, `min-height: 44px`,
`padding: 10px 14px`; 18px alert glyph `var(--red)`, message 13px / 600 `var(--red)`, trailing
"Retry" text button 13px / 600 `var(--red)` underlined, 44px hit. No side-stripe; the tinted
surface + glyph carry it.

Retry re-runs the SILENT load path (no skeleton flash, no page blank). The panel never renders
inside a toast and never auto-dismisses.

---

## 10. Search input

The claims-list pattern, canonized. Implementation = the existing `ui` SearchInput (controlled
string `onChange`, `onClear`, placeholder-as-aria-label) restyled.

- **Box:** `height: 48px`; `border-radius: 12px`; `background: var(--surface2)`;
  `border: 1px solid var(--field-border)`; inset `box-shadow: var(--sh-seg-track)` — the same
  pressed-in field read as §1.
- **Leading glyph:** 20px duotone magnifier, `color: var(--ink3)`, at `left: 14px`; input padding
  `0 44px 0 44px`.
- **Input:** `type="search"`, `enterKeyHint="search"`, `font: 400 16px "Source Sans 3"` (anti-zoom
  law), `color: var(--ink)`; placeholder `var(--ink3)` ("Search claims", never instructions).
  UA cancel button suppressed (`::-webkit-search-cancel-button { display:none }`) — the drawn clear
  replaces it.
- **Clear:** appears only when non-empty; 44px square hit at `right: 2px` (documented-secondary),
  glyph = 16px circled-cross duotone in `var(--ink3)`; press `scale(.94)`; clears and refocuses the
  input.
- **Focus:** the §1 tap-focus state (background `var(--surface)`, border `var(--focus)`,
  `0 0 0 3px var(--focus-halo)`).
- **Behavior notes:** debounce 200-250ms; in-memory filter on claims/tasks, server-side on
  messages; a hard result cap always pairs with a way to reach the rest (truncation law). While a
  query is active the icon-toggle variant (schedule header) shows its 8px active dot in
  `var(--blue)`.
- **Transient variant** (schedule header): icon-toggled row that autofocuses on open; identical
  box; closing clears or preserves per the screen's existing contract.

---

## 11. Lightbox (note)

The ONLY surface that loads a full-resolution original — grids and rows always use `thumbUrl()`
(width + quality params, `loading="lazy"`, `decoding="async"`); the lightbox uses `publicUrl()`
via the single `usePhotoUpload` media-URL seam (this is also the db-foundation P8 signed-URL swap
point — never construct a media URL elsewhere).

- **Theme-invariant dark:** backdrop `rgba(0,0,0,.92)` in BOTH themes (photos judge color; the
  viewer gets a darkroom, not a themed surface). Image `object-fit: contain`, full viewport minus
  safe areas.
- **Chrome:** close button 48px top-right (offset by `--safe-top`), drawn cross 18px at 1.8px in
  `rgba(255,255,255,.92)` on a `rgba(255,255,255,.10)` 12px-radius plate; prev/next 48px chevron
  buttons mid-edge (hidden when single); counter "3 / 12" 13px / 600 `rgba(255,255,255,.72)`
  tabular-nums top-center; caption 15px / 500 `rgba(255,255,255,.92)` bottom, 3-line clamp, above
  the safe-area inset. The hub's sibling "Add note / room" overlay button keeps its slot bottom-right.
- **Motion:** enter/exit is a 120ms opacity fade only (fast tier — a tech flips through photos
  constantly; no zoom theatrics, no spring). Full-res loads in over the already-rendered thumbnail
  (blur-up from the cached thumb; never a spinner over black). Reduced motion: instant.
- Swipe between photos and pinch-zoom are native-gesture territory; do not fake them with CSS —
  they queue behind the gesture-wave decision. Tap image toggles chrome visibility.
- Focus/ESC: behaves as a dialog (trap, ESC closes, focus restore).

---

## 12. Two-click destructive confirm (component rule)

The law for every destructive control (delete, remove, archive, sign out, finish): NEVER a modal,
NEVER `confirm()`. Mechanism = the existing `useTwoClickConfirm` hook; this spec fixes its look.

- **Rest:** the control wears its normal quiet style (never red at rest — red at rest cries wolf;
  color is state, and the state is not yet dangerous).
- **Armed (first tap):** the control itself transforms in place —
  - label swaps to "Tap again to <verb>" ("Tap again to delete") — the confirm IS the label, never
    a printed hint elsewhere (the locked hero-pill pattern);
  - quiet/secondary controls: `background: var(--red-bg)`, text and glyph `var(--red)`,
    13-15px / 600 (whatever the control's size class was);
  - pill-class controls: `background: var(--red)`, text `#fff` (light theme) / text `#141416` on
    `#F17878` (dark theme — the retuned red is light enough to demand dark text);
  - recolor transitions 120ms ease-out; NO layout shift — the control reserves the width of its
    widest label (fixed min-width or a hidden sizing twin).
- **Confirm (second tap within the window):** executes; haptic `notify('success')` on completion
  of the destructive act, `notify('error')` on failure with an `err()` toast and state rollback.
- **Auto-disarm:** 3s (pass `timeoutMs: 3000`); reverts to rest with the same 120ms transition.
  Blur/tap-elsewhere disarms immediately (caller wires `cancel` on blur). Arming a different key
  disarms the previous one (hook contract).
- **A11y:** armed state announces via an `aria-live="polite"` region ("Tap again to delete");
  the control keeps its accessible name plus the armed suffix. Hit target unchanged (48px, or the
  documented 44px secondary).
- **Escalation:** irreversible bulk destruction (claim/job archive) keeps the typed-"DELETE"
  inline confirm inside its sheet — typed confirm is the ceiling, two-click is the floor; both are
  inline, neither is a dialog.
- Haptic on arm: `impact('light')`.

---

## Reduced-motion and hover gates (blanket, binding on all twelve)

Every transition and keyframe above ships inside the standard gates: under
`prefers-reduced-motion: reduce` all motion collapses to instant while end states, focus moves, and
`aria-live` announcements still land (reduced is never broken); every `:hover` effect is gated
behind `@media (hover: hover) and (pointer: fine)` (hover on these components is limited to
`background: var(--surface2)` washes and `--ink3` to `--ink2` text lifts — no hover transforms).
All motion is transform/opacity only. All haptics are additive (web/PWA gets none and loses
nothing) and respect reduced motion.

## Component count

12 spec'd component families: text field (+ textarea), select (+ sheet picker), checkbox + radio,
toggle switch, bottom sheet (+ desktop-modal note), toast, skeletons (dash/list/detail), empty
state, error state, search input, lightbox, two-click destructive confirm.
