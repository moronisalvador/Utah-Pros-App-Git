# Direction B "Apple Field Pro" — Core Component Specs

Extracted verbatim from the screens of record: `direction-b.html` (dashboard), `refine-b-jobhub.html`
(job hub / appointment detail), `hydro-b.html` (drying module), plus the sanctioned "ripened" Finish
variant from the flow challenger (`hub-challenge-flow.html`). Every value below is measured from the
shipped CSS, not invented. Token names refer to the Direction B token set (`--ground/--surface/
--surface2/--ink/--ink2/--ink3/--hair/--pill-bg/--pill-ink/--amber(-bg)/--green(-bg)/--red(-bg)/
--blue(-bg)/--gray(-bg)/--focus/--frost/--sh-card/--sh-hero/--seg-thumb/--sh-seg-track/--sh-seg-thumb`).

Conventions used throughout this file:

- "Type role" notation is `size/weight` (px / CSS font-weight), face is always Source Sans 3.
- Every timer/number readout carries `font-variant-numeric: tabular-nums`.
- **Press state law (global):** buttons acknowledge with `transform: scale(...)` over
  `120ms ease-out`; rows and row-like tap surfaces acknowledge with a `background: var(--surface2)`
  swap (no scale). Exact scale per component is listed in its States block.
- **Focus-visible law (global):** `outline: 2px solid var(--focus); outline-offset: 2px;
  border-radius: 12px` on every focusable element. `--focus` equals the status blue
  (light `#1F56C4`, dark `#8AB0F7`).
- **Hover law (global):** hover styles exist only inside `@media (hover:hover) and (pointer:fine)`;
  they are always the same `--surface2` background swap (FAB additionally `translateY(-1px)`).
- **Reduced motion (global):** `prefers-reduced-motion: reduce` collapses ALL animation and
  transition to instant.
- **Dark theme (global):** never a component change — every component re-reads the same token names
  from the `[data-theme="dark"]` block. Component-specific dark deltas are listed per component; if
  none are listed, the token swap is the entire dark behavior.
- **Disabled / loading (EXTRAPOLATED — no screen of record ships these states; normative for the
  style guide):** disabled = `opacity: .4` on the whole control + no press/hover response, colors
  untouched (ink stays ink — never a gray recolor that could collide with the gray status). Loading
  on a button = label swap to a present-progressive verb ("Saving…", "Uploading…") with the leading
  icon replaced by a spinner glyph of the same box size; the control keeps its exact geometry (no
  layout shift) and refuses further taps while busy. A loading list never blanks rendered rows.

---

## 1. Primary black pill button (`.pill-primary`)

The identity control. ONE per screen — it is the screen's single primary action
(dashboard: Pause while working; hub stage: Finish; drying dock: Add reading).

**Anatomy**
- Container: `width: 100%`, `height: 54px`, `border: 0`, `border-radius: 999px`,
  `background: var(--pill-bg)`, `color: var(--pill-ink)`.
- Content: flex row, centered, `gap: 9px` (documented optical exception to the 4/8 grid);
  leading duotone icon 19x19; label 17/600, `letter-spacing: -0.005em`.
- Placement inside the hero/stage card: `margin-top: 14px`, full card width.
- Optional microcopy line below (`.pill-note`): centered, 12/500, `color: var(--ink3)`,
  `margin: 8px 0 0`. Used only to state the two-tap affordance.

**Token usage:** `--pill-bg` (light `#17181A`, dark `#F3F4F6`), `--pill-ink` (light `#FFFFFF`,
dark `#141416`).

**States**
- Default: as above.
- Pressed: `transform: scale(.97)` over 120ms ease-out; nothing else changes (no background shift —
  the pill is already maximal ink).
- Focus-visible: global 2px `--focus` outline, offset 2.
- **Arming (two-tap confirm) state:** for destructive/terminal actions (Finish), the first tap ARMS:
  the label text swaps in place to the confirm phrasing — "Tap again to finish" — same geometry, same
  colors, same icon. The confirm state is the swapped label itself, never a printed hint alongside a
  live label. (When a hint IS printed, it is the `.pill-note` microcopy: "First tap arms — 'Tap again
  to finish' confirms".) Auto-disarm timing follows the app's two-tap convention (approximately 3s,
  blur cancels — mechanism per `useTwoClickConfirm`).
- Disabled / loading: per the global extrapolated convention above.

**"Ripened" outlined variant (`.pill-quiet` — from the flow challenger, sanctioned)**
State-aware Finish: while open checklist tasks remain, Finish renders as the QUIET outlined pill;
when the checklist completes it "ripens" into the black `.pill-primary` with the two-tap arming
microcopy. One primary action stays true at every moment.
- Same geometry as the primary pill: `width: 100%`, `height: 54px`, `border-radius: 999px`,
  content row `gap: 9px`, label 17/600, `letter-spacing: -0.005em`.
- Differences: `border: 1.5px solid var(--ink)`, `background: var(--surface)`, `color: var(--ink)`.
- Trailing counter fragment (`.left`, e.g. "· 3 left"): 17px at weight 500, `color: var(--ink3)`.
- Pressed: `scale(.97)` PLUS `background: var(--surface2)`.
- Both themes: outline and text ride `--ink`, so the variant self-inverts.

**Dock pill variant (`.dock-pill` — drying module dock):** the primary pill living inside the docked
action bar: `flex: 1.6`, `min-height: 56px` (not 54), `border-radius: 999px`, same `--pill-bg/--pill-ink`,
label 16/600 (one step down from 17 — dock context), icon 20x20, `gap: 8px`, pressed `scale(.97)`.

**Usage rules**
- Use for the ONE primary action of a screen, and nothing else. Never two black pills visible at once.
- While a visit is WORKING on the dashboard, the pill is Pause (the safe big control) — Finish stays
  the next rail station. On the hub stage, where the visit is finished, the pill is Finish (two-tap).
- Never use the black pill for navigation, secondary capture, or inside rows.
- Terminal/destructive actions on the pill are ALWAYS two-tap armed; never a modal confirm.

---

## 2. Quiet button (`.qbtn`)

The secondary action button (Photo / Notes under the hero; Pause demoted on the hub stage).

**Anatomy**
- `height: 48px` (primary-field-action floor), `border: 0`, `border-radius: 14px`,
  `background: var(--surface2)`, `color: var(--ink)`.
- Content: flex row centered, `gap: 7px` (documented optical exception); leading duotone icon
  18x18 (19x19 when full-width) colored `var(--ink2)`; label 15/600.
- Grid placement (dashboard hero): two-up `grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px`.
- `.qbtn--wide` modifier: `width: 100%; margin-top: 10px` (hub stage Pause).

**Token usage:** `--surface2` fill, `--ink` label, `--ink2` icon.

**States**
- Pressed: `transform: scale(.97)`; background transition also declared (background stays
  `--surface2` — the declaration exists so the hover swap animates).
- Hover (fine pointers): `background: var(--surface2)` (visible lift on white cards).
- Focus-visible: global ring. Disabled/loading: global extrapolated convention.

**Both themes:** fill rides `--surface2` (light `#F4F5F7`, dark `#27282B`); no component deltas.

**Usage rules**
- Use for secondary actions adjacent to a primary pill, always in pairs or as a single wide bar.
- Never for the screen's primary action; never as a row substitute. Icon is optional but shipped
  everywhere — keep it.

---

## 3. Icon button (`.iconbtn`) and back button (`.backbtn`)

**Icon button — 44px documented-secondary.** Header utilities only (bell / help / more) — never a
field action.
- `width: 44px; height: 44px` (44 is the documented-secondary floor; the CSS carries the comment),
  `border: 0`, `border-radius: 14px`, `background: transparent`, `color: var(--ink2)`,
  `display: grid; place-items: center`.
- Glyph: duotone icon 23x23.
- May host a numeric badge (`.badge-num`, section 7) anchored `top: 5px; right: 5px`.
- Pressed: `transform: scale(.94)` + `background: var(--surface2)`.
- Hover (fine pointers): `background: var(--surface2)`. Focus-visible: global ring.
- Accessibility: always an `aria-label` (e.g. "Notifications, 1 unread").

**Back button — 48px primary nav target.** Back on a detail/module screen is glove-critical, so it
gets the full 48:
- `width: 48px; height: 48px`, otherwise identical idiom (`border-radius: 14px`, transparent,
  grid-centered) but `color: var(--ink)` (full ink — it is a primary action).
- Glyph: `#i-chev-l` 24x24. Pressed: `scale(.94)` + `--surface2`. `aria-label` "Back" / "Back to job".

**Usage rules:** `.iconbtn` only in the greeting-header actions cluster; `.backbtn` only as the
leading element of a compact hub/module header. Anything a gloved tech must hit mid-job is 48px —
if in doubt, use the 48 variant.

---

## 4. Docked action bar (`.dock` + `.dock-photo` + `.dock-btn` + `.dock-pill`)

The Z3 fixed capture/action bar on hub and module screens. SOLID surface — the one-glass budget is
spent on the tab bar. Pinned to the DEVICE frame (never inside the scroller); in the app it hides
itself while any text input has focus (keyboard law).

**Container (`.dock`)**
- `position: absolute; left: 12px; right: 12px; bottom: calc(94px + env(safe-area-inset-bottom, 0px));
  z-index: 25` (above content z-20 top bar, below tab bar z-30).
- `background: var(--surface)`, `border-radius: 18px` (between control 12 and card 20 — a floating
  bar is its own tier), `box-shadow: var(--sh-hero)`, `padding: 8px`,
  `display: flex; align-items: stretch; gap: 4px`.

**Emphasized capture button (`.dock-photo` — hub):** snap-first law makes Photo the oversized member.
- `flex: 1.5` (visibly wider than siblings), `min-height: 56px`, `border-radius: 12px`,
  `background: var(--surface2)`, `color: var(--ink)`; horizontal flex row `gap: 8px`;
  icon 22x22 `var(--ink2)`; label 15/600.
- Pressed: `scale(.97)`. Hover: `--surface2`.

**Primary pill member (`.dock-pill` — drying module):** see section 1 (dock pill variant). When the
dock's emphasized action IS the screen's primary action (Add reading), it is the black pill, not a
filled gray button; `flex: 1.6`.

**Quiet dock button (`.dock-btn`):**
- `flex: 1; min-width: 54px; min-height: 56px`, `border-radius: 12px`, `background: transparent`,
  `color: var(--ink2)`; VERTICAL stack (icon over label), `gap: 3px`; icon 20x20; label 12/500
  `color: var(--ink3)` (12px floor is legal here — the icon carries the action; label is a caption).
- Pressed: `scale(.94)` + `background: var(--surface2)`. Hover: `--surface2`.
- Always an `aria-label` naming the full action ("Call Gary Sorensen").

**States (all members):** focus-visible global ring; disabled/loading per global convention
(the Photo member's loading label is "Uploading…").

**Usage rules**
- One dock per screen, max. Exactly one emphasized member (either `.dock-photo` gray-filled or
  `.dock-pill` black); everything else quiet.
- Hub dock = capture + contact (Photo · Note · Call · Text). Module dock = the module's primary verb
  + one quiet secondary (Add reading · Place equipment).
- Never frost the dock. Never place it inside the scroll body. Bottom padding of `.main` must clear
  it (hub 264px, module 240px total clearance).

---

## 5. FAB (`.fab`)

Create action, dashboard only. Deliberately subordinate to the clock hero (one-primary-action rule):
it is a SURFACE-colored circle, not a black pill.

**Anatomy**
- `position: absolute; right: 16px; bottom: 100px; z-index: 25` (clears the tab bar).
- `width: 56px; height: 56px`, `border: 0`, `border-radius: 999px`,
  `background: var(--surface)`, `color: var(--ink)`, `box-shadow: var(--sh-hero)`,
  grid-centered plus icon 24x24 (`#i-plus`, 2.2 stroke).

**Motion:** the ONE springy one-shot in the system — enter animation
`fab-in 380ms cubic-bezier(.3,1.14,.42,1) both` (from `scale(.5)` + fade, ~4% overshoot). Everything
else in the app is fast ease-out; do not reuse this curve elsewhere. Reduced-motion collapses it.

**States**
- Pressed: `transform: scale(.93)` (deepest press in the system — biggest free-floating target).
- Hover (fine pointers): `translateY(-1px)`.
- Focus-visible: global ring.

**Both themes:** surface + ink + `--sh-hero` all re-read; dark shadow becomes the black-halo recipe.

**Usage rules:** dashboard only; opens create actions ("Create new job or customer"). Never carries
a badge. Never becomes the primary action of the screen — if a screen needs a primary verb, that is
the pill or the dock.

---

## 6. Tab bar + tabs (`.tabbar`, `.tab`)

The ONE frosted surface in the entire system.

**Bar anatomy**
- `position: absolute; left: 0; right: 0; bottom: 0; z-index: 30`.
- `background: var(--frost)` (light `rgba(255,255,255,.74)`, dark `rgba(30,31,33,.72)`);
  `backdrop-filter: blur(14px) saturate(160%)` (+ `-webkit-` twin) — blur is capped at 14px;
  `border-top: 1px solid var(--hair)`;
  `padding: 7px 6px calc(14px + env(safe-area-inset-bottom, 0px))`.
- Tabs row: `display: grid; grid-template-columns: repeat(5, 1fr)` — Dash · Claims · Schedule ·
  Messages · More.
- Home indicator below the tabs (section 24).

**Tab anatomy (`.tab`)**
- `min-height: 48px`, `padding: 5px 0 3px`, `border-radius: 12px`, transparent, vertical stack
  `gap: 2px`: duotone icon 25x25 over label.
- Label (`.tab-label`): 12/500, `letter-spacing: .01em` (12px floor for actionable text — never 11).
- Inactive color: `var(--ink3)` with duotone fill dialed DOWN: `--duo: .14`.

**States**
- Active (`.tab.active`): `color: var(--ink)`; `--duo: .9` — the duotone silhouette fill RAISES to
  near-solid (this is Direction B's active treatment; the legacy shell's 44x30 pill-behind-the-icon
  is retired — the duo-raise + ink + label weight replace it); label weight becomes 650;
  `aria-current="page"`.
- Pressed: `transform: scale(.94)`.
- Focus-visible: global ring.

**Badge slots on a tab**
- Numeric badge: `.badge-num` positioned `top: 0; right: calc(50% - 22px)` (rides the icon's top-right
  corner). See section 7.
- Attention dot (`.tab-dot`): `8px` circle, `background: var(--red)`,
  `top: 3px; right: calc(50% - 15px)`; carries an `aria-label` ("Tasks waiting"). Dot = "something
  is waiting" without a count (More tab); number = a real unread count (Messages tab).

**Both themes:** frost + hair + ink tokens swap; `badge-num` text flips to `#1E1F21` in dark
(red tint backgrounds brighten via the dark `--red`).

**Usage rules:** exactly five tabs; the bar never scrolls away (pinned to the device frame); nothing
else in the app may use `backdrop-filter`. Safe-area padding is built in — content scrollers must
budget clearance for it.

---

## 7. Numeric badge (`.badge-num`) and attention dot (`.tab-dot`)

**Numeric badge**
- `min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px`.
- `background: var(--red)`, `color: #fff` (dark theme: `color: #1E1F21` — the bright dark-red needs
  dark text), 11/700, `line-height: 16px`, centered, tabular numerals.
- 11px is legal ONLY here: badge numerals are the single sanctioned use of the 11px floor
  (never actionable text).
- Anchors: icon button `top: 5px; right: 5px`; tab `top: 0; right: calc(50% - 22px)`.

**Attention dot:** 8x8 `--red` circle (see section 6). Use the dot when presence matters but the
count does not; use the number when the count itself is the information. Never both on one target.

---

## 8. Chips (`.chip` + tone variants)

The status/semantic voice of the system. Color is state; every status chip also carries a SHAPE
glyph so state survives grayscale.

**Anatomy**
- `display: inline-flex; align-items: center; gap: 5px` (optical exception),
  `padding: 4px 10px 4px 8px` (tighter left pads the glyph optically), `border-radius: 999px`.
- Label: 12/600, `line-height: 1.2`, `white-space: nowrap`.
- Leading glyph: 13x13 (14x14 in the hero-top and hub-header positions), `flex: none`.

**The 5 field-status chips (tone + REQUIRED shape glyph)**
| Class | State | Glyph (shape redundancy) | Light fg on bg | Dark fg on tint |
|---|---|---|---|---|
| `.chip-amber` | OMW / en route | arrow (direction) | `#9E4E00` on `#FAEDDD` | `#F2A65A` on 15% tint |
| `.chip-green` | Working | `#i-dotring` (dot-in-ring) | `#0A7A42` on `#E0F3E7` | `#54C98B` on 15% tint |
| `.chip-red` | Paused | `#i-pause` (pause bars) | `#BB2727` on `#FBE5E5` | `#F17878` on 15% tint |
| `.chip-blue` | Scheduled | `#i-clock` (clock) | `#1F56C4` on `#E5EDFB` | `#8AB0F7` on 16% tint |
| `.chip-gray` | Done / terminal | `#i-check` (check) | `#5B5F66` on `#ECEDEF` | `#A6ABB2` on 15% tint |

**Semantic reuse (same five tones, field vocabulary — shipped instances)**
- `chip-green` + check: "In range", "Dry", "Signed" — good/verified.
- `chip-amber` + clock: "Due", "Pull today" — NEEDS ACTION ON THIS VISIT. One tone means
  "needs action this visit" everywhere; never introduce a second due-encoding.
- `chip-amber` + drop: "Wet" — material not at goal.
- `chip-amber` + warn: "Offline" (section 22).
- `chip-gray` + dotring: "Control" (reference reading — informational terminal).
- `chip-gray` + cal: "Day 4" (module-header day counter).
- Terminal receipt: amber "Pull today" flips to gray "Pulled 11:05 AM" (chip-gray + `#i-check` +
  timestamp) once done — action tones always resolve to gray terminals.

**States:** chips are passive (never independently tappable — the row is the target). No pressed
state of their own; they ride their row's background swap. Not focusable.

**Both themes:** fg/bg pairs swap wholesale via tokens; dark backgrounds are alpha tints of the fg.

**Usage rules**
- One chip per row, trailing edge, `flex: none` (never shrinks; text truncates instead).
- Never a chip without its glyph. Never color-only state. Never repurpose a status tone for
  decoration. Chips are 12/600 — never smaller.

---

## 9. Mini badge (`.mini` — "Viewing")

Inline self-reference marker on the selected visit row in the hub's visit switcher.

- `display: inline-block; margin-left: 7px; padding: 2px 8px; border-radius: 999px`.
- `background: var(--gray-bg); color: var(--gray)`; 12/600, `line-height: 1.3`,
  `vertical-align: 2px` (optically centers against the 15px row title).
- 12px floor honored (actionable-adjacent text — the CSS carries the comment).
- Passive; both themes via tokens.
- Use ONLY for "you are here" self-reference inside a list ("Viewing"); never for status
  (that is the chip) and never for counts (that is `.badge-num`).

---

## 10. Status lamp / dot conventions

"Ink is the brand, color is state" — where chromatic color is allowed to appear, and in what shape:

1. **The 48px timer as state lamp:** while WORKING, the hero/stage timer numeral runs
   `color: var(--green)` — large-area color carries state at 3 feet. (Paused would run `--red`;
   the mapping follows the status table.)
2. **Chips** (section 8) — tone + glyph.
3. **Rail nodes** (section 14) — filled `--green` circles for completed stations.
4. **Timeline now-cursor** (`.tl-now`): 2px `--green` vertical line, `top/bottom: -4px` overhang,
   with a 6px `--green` dot cap (`::before`, `top: -4px; left: -2px`).
5. **Tab red dot / numeric badge** (sections 6–7) — `--red` = "waiting on you".
6. **Icon tiles** (`.attn-ic`) — amber-tinted 36px tile for attention rows.
7. **Trend glyph** (`.dtrend`): inline `#i-trend` 14x14, `color: var(--green)`,
   `display: inline-block; vertical-align: -2px; margin-left: 2px` (declared to beat the global
   `.ic { display: block }`) — a falling-toward-goal reading.
8. **Stall marker** (`.mp-stall`): inline-flex `gap: 4px`, 13/600 `color: var(--amber)`, 12x12 clock
   glyph — the decision-critical fact reads from 3 feet, never buried in ink3.
9. **Focus ring** — the blue.

Everything else on screen is ink. Banned: side-stripe status borders, gradient accents, colored
headings, tinted cards as status.

---

## 11. Cards (`.card` + `.rowcard`, hero/stage variant, numbers variant)

**Base card (`.card`)**
- `background: var(--surface)`, `border-radius: 20px` (the outer radius; nested elements are always
  smaller — 14 controls, 12 insets/rows), `box-shadow: var(--sh-card)`
  (light: `0 1px 2px rgba(16,17,20,.05), 0 10px 28px rgba(16,17,20,.08)`; dark: black-halo recipe
  `0 1px 2px rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.40)`).
- No border. Padding is the variant's job.

**Row card (`.rowcard`):** `padding: 2px 0` — a bare card that hosts `.row`s edge-to-edge with
hairline separators. Rows supply their own 16px side padding.

**Hero / stage card (`.hero`)**
- The elevated moment: `margin-top: 14px; padding: 20px 20px 16px`,
  `box-shadow: var(--sh-hero)` (light: `0 2px 4px rgba(16,17,20,.05), 0 18px 44px rgba(16,17,20,.12)`;
  dark: `0 2px 4px rgba(0,0,0,.35), 0 18px 48px rgba(0,0,0,.52)`).
- Dashboard hero anatomy (top to bottom): `.hero-top` flex row (status chip left, `.hero-when`
  scheduled time right — 13/600 `--ink3` tabular) · `.hero-name` 23/700 `-0.015em`
  `margin: 12px 0 0` · `.hero-sub` 15/500 `--ink2` `margin: 3px 0 0` · address row (section 20) ·
  timer block (section 14) · station rail (section 14) · primary pill · quiet-button pair ·
  `.hero-next` quiet footer (section 23).
- Hub stage variant: timer block first (`padding: 6px 0 4px`), rail, `.stage-meta`, pill (+ note),
  wide quiet button, address row, office-note footer.
- Exactly ONE hero-shadow card per screen (plus the dock and FAB, which share `--sh-hero` as
  floating elements).

**Numbers variant (`.numbers`):** see section 15.

**States:** cards are not interactive; their child rows are. Both themes via tokens only.

**Usage rules:** cards sit on `--ground` with 16px page gutters. Section titles live OUTSIDE the
card (section 27). Never nest a 20-radius card inside another card.

---

## 12. Rows (`.row` family)

The universal tappable list unit (visits, links, documents, equipment, contacts).

**Anatomy (`.row`)**
- `display: flex; align-items: center; gap: 12px; padding: 12px 16px`.
- Separators: `.row + .row { border-top: 1px solid var(--hair) }` — hairlines between, never around.
- Optional leading tile, body, then exactly one trailing element (chip OR chevron — never both).

**Body (`.row-body`):** `flex: 1; min-width: 0` (enables truncation).
- Title (`.row-t`): 15/600, `letter-spacing: -0.005em`, ink.
- Meta (`.row-m`): 13/500, `color: var(--ink3)`, `margin-top: 1px`, tabular numerals. Middot-joined
  facts ("1:00 PM · Emily Checketts · Sandy · 0/4 tasks"). Two-line metas are two `.row-m`-class
  lines (attention rows use `<br>`); meta emphasis conventions:
  - `.em` — `color: var(--ink); font-weight: 700` for the fact that matters ("Total 1h 5m");
    paired with `.nb` so the value never breaks mid-string.
  - `.dnum` — 650-weight tabular ink numerals inside meta prose (drying counts: "2 of 3 materials dry").
  - `.nb` — `white-space: nowrap` wrapper for any value+unit pair.
  - `.dtrend` — the inline green trend glyph (section 10).
  - `strong` inside `.attn-m` — ink 700 (the reading value).

**Leading tiles**
- `.lnk-ic` (neutral link/icon tile): `36x36; border-radius: 12px; background: var(--surface2);
  color: var(--ink2)`, grid-centered 19x19 duotone icon. For module links, readings, documents,
  contacts.
- `.done-ic` (completed visit): `36x36; border-radius: 999px` (circle, not squircle — terminal),
  `background: var(--green-bg); color: var(--green)`, 17x17 check.
- `.attn-ic` (attention row): `36x36; border-radius: 12px; background: var(--amber-bg);
  color: var(--amber)`, 19x19 glyph.

**Trailing**
- Chevron (`.chev`): `#i-chev` 16x16, `color: var(--ink3)`, `flex: none` — "this navigates".
- Chip: `flex: none` — "this has state". A chip'd row may still navigate (whole row is the target).

**States**
- Default: transparent on the card.
- Pressed: `background: var(--surface2)` over 120ms ease-out (rows never scale).
- Focus-visible: global ring (rows are `role="button" tabindex="0"` or `role="checkbox"`).
- Static variant (`.row--static`): `cursor: default`, no active swap — display-only rows
  (signed Work Authorization).
- Due variant (`.row--due`): title drops to `--ink2`, tile icon to `--ink3` — the row stays QUIET
  (no reading yet = nothing to read); the trailing AMBER chip carries the "needs action" signal.
- Selected/current: `aria-current="true"` + the `.mini` "Viewing" badge — no background change.

**Reading row (psychrometric, drying module):** a `.row` with a value-forward middle line:
- `.row-vals` between title and meta: 17/500, `color: var(--ink3)`, `-0.005em`, `margin-top: 2px`,
  tabular — the numbers a tech compares visit-to-visit read at glance size (17px), never at the
  timestamp's 13px meta scale. Values as `.nb`-wrapped `.dnum` + unit fragments
  ("72.4°F · 38% RH · 45 gpp" + optional `.dtrend`); read-time meta below ("Read 9:46 AM").

**Usage rules:** min row height lands ~64px via padding (checklist rows pin 56px explicitly); meta
never wraps mid-value (use `.nb`); truncation over wrapping for titles in headers, wrapping allowed
in body rows. Never stack two chips; never put actions inside a row (the row IS the action).

---

## 13. Checklist (`.cklist`, `.task`, `.ck`, `.prog`, `.ck-acts`)

The task list inside the hub's work card.

**Header (`.ck-head`):** flex baseline row `padding: 14px 16px 0` — title (`.ck-title`) 16/600
`-0.005em`; count (`.ck-count`) 13/500 `--ink3` tabular ("2 of 5").

**Progress bar (`.prog`):** `height: 4px; border-radius: 2px; background: var(--hair);
overflow: hidden; margin: 10px 16px 4px`; fill (`.prog-fill`) full-height, `border-radius: 2px`,
`background: var(--green)`, width = completion %. `aria-hidden` (the count text is the accessible
value).

**Task row (`.task`)**
- `display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 16px`;
  hairline `border-top` between rows; pressed = `--surface2` swap; `role="checkbox"
  aria-checked` + `tabindex="0"`.
- Big check circle (`.ck`): `28x28; border-radius: 999px`, grid-centered.
  - Open (`.ck--open`): `border: 2px solid var(--ink3)`, empty (`color: transparent`).
  - Done (`.ck--done`): `background: var(--green); color: #fff` (dark: icon color `#141416`),
    16x16 check.
- Title (`.task-t`): `flex: 1; min-width: 0`, 15/600 `-0.005em`.
  - Done row (`.task--done .task-t`): `color: var(--ink3); font-weight: 500` (recedes, no
    strikethrough in B).

**Fold row (`.task--fold`)** — completed tasks collapse into one receipt row: done-circle +
"Done (2)" title in `--ink3` at weight 600 + trailing chevron; `role="button"
aria-expanded="false"` with an `aria-label` ("Show 2 completed tasks").

**Inline capture pair (`.ck-acts`)** — contextual capture inside the work card (quieter twins of
the dock): `display: flex; gap: 10px; padding: 12px 16px 12px`; each `.ck-act` = `flex: 1;
min-height: 48px; border-radius: 14px; background: var(--surface2); color: var(--ink)`, centered
flex row `gap: 8px`, icon 18x18, label 14/600, pressed `scale(.97)`. ("Add photo" / "Add note".)

**Stage meta line (`.stage-meta`)** — the glanceable work+evidence summary inside the stage card:
centered, 13/500 `--ink3`, `margin: 2px 0 12px`, tabular, values as `.dnum`
("2 of 5 tasks · 9 photos today").

**States:** toggling is optimistic (tap flips the circle instantly); focus ring global;
card-level `aria-label` carries the summary ("Checklist, 2 of 5 done").

**Usage rules:** check circles are the tap affordance but the WHOLE row toggles; done rows fold when
2+ are complete; the capture pair appears only inside the work card (the dock remains the global
capture). Never shrink the circle below 28px; never use the 14/600 `.ck-act` label size on a
standalone button (it is legal only inside this paired context).

---

## 14. Station rail (`.rail`, `.st`) + stage clock (`.timer-num`) + stage meta

The visit state machine made visible: On my way, Started, Finish.

**Rail**
- `.rail`: `position: relative; display: grid; grid-template-columns: 1fr 1fr 1fr;
  margin: 16px 0 4px`.
- Connector: `.rail::before` — 2px hairline (`background: var(--hair)`, `border-radius: 1px`) at
  `top: 15px`, spanning `left/right: calc(16.66% + 18px)` (runs between node centers, stops short
  of the outer nodes).
- Station (`.st`): vertical flex, centered, `gap: 6px`.
- Node (`.st-node`): `32x32; border-radius: 999px`, grid-centered, `z-index: 1` (sits over the
  connector).
  - Done node: `background: var(--green); color: #fff` (dark: `#141416`) + 16x16 check.
  - Next node (`.st-node--next`): `background: var(--surface); border: 2px solid var(--ink);
    color: var(--ink)` + 15x15 goal glyph (flag) — INK outline, not blue: the next station is an
    intention, not a state.
- Name (`.st-name`): 13/600, `line-height: 1.25`.
- Stamp (`.st-stamp`): 12/500 `--ink3`, `line-height: 1.35`, tabular; may be two lines
  ("9:12 AM" / "Travel 18m") or "Up next" / "Next".

**Stage clock**
- Block (`.hero-timer`): centered; dashboard `padding: 16px 0 4px`, hub `padding: 6px 0 4px`.
- Numeral (`.timer-num`): 48/700, `line-height: 1`, `letter-spacing: -0.02em`,
  `font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum"`; COLOR = the current
  status hue while live (`var(--green)` working) — the 3-foot state lamp (section 10). Ticks live
  every second.
- Label (`.timer-label`): 13/500 `--ink3`, `margin-top: 6px`, tabular
  ("On the clock since 9:12 AM").

**States:** the rail is display-only (stations are not tap targets — the pill and quiet buttons
drive the state machine). Both themes: node icon color flips to `#141416` on dark (bright green
needs dark ink).

**Usage rules:** always exactly the visit's three stations; completed stations fill green
left-to-right; only one `--next` node at a time. The rail never replaces the primary pill — it
shows where you are, the pill moves you.

---

## 15. Numbers grid (`.numbers`, `.num-*`)

Quiet instrument readouts (My numbers on dash; drying summary on hydro). ONE card with cells —
deliberately NOT stat-card tiles.

**Anatomy**
- Card: `.card.numbers` — dash `padding: 4px 16px` with internal blocks; hydro
  `margin-top: 14px; padding: 14px 16px` single block.
- Scope block (`.num-block`): `padding: 12px 0`, hairline `border-top` between blocks;
  scope label (`.num-scope`) 13/600 `--ink3` `margin-bottom: 8px` ("Today", "This week").
- Cells (`.num-cells`): `grid-template-columns: 1fr 1fr 1fr; gap: 8px`.
- Cell value (`.num-cell .v`): 22/650, `-0.015em`, tabular, `color: var(--ink2)`,
  `line-height: 1.1`.
- Cell label (`.num-cell .l`): 12/500 `--ink3`, `margin-top: 2px`.
- Emphasized cell (`.num-cell--em .v`): `color: var(--ink); font-weight: 700` — the total/lead
  number (exactly one per grid row).
- Fraction suffix (`.v .of`): 15/600 `--ink3`, `letter-spacing: 0` — "2 of 3" renders the "of 3"
  quieter.
- Footer pills (`.num-foot`): 2-col grid `gap: 8px; padding: 12px 0`, hairline top; each
  `.num-pill` = flex `gap: 9px`, icon 19x19 `--ink3`, value 20/700 tabular `-0.01em`, label
  12/500 `--ink3` ("5/14 tasks done", "9 photos today").

**States:** display-only. Both themes via tokens.

**Usage rules:** hours ALWAYS as the labeled Travel / On-site / Total triplet (never a bare total —
payroll honesty); the emphasized cell is the rightmost Total. Never restyle as tiles, never add
icons to cells (icons belong to footer pills only), never color the values (quiet ink; state lives
elsewhere).

---

## 16. Segmented control (`.seg`, `.seg-btn`)

The canonical segment (Chambers | Rooms). HIGH-FREQUENCY control per the motion frequency tiers:
switching is INSTANT by design.

**Anatomy**
- Track (`.seg`): `display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px;
  border-radius: 15px; background: var(--surface2); box-shadow: var(--sh-seg-track)`
  (light `inset 0 1px 2px rgba(16,17,20,.05)`; dark `inset 0 1px 2px rgba(0,0,0,.45)`).
  `role="group"` + `aria-label`.
- Segment (`.seg-btn`): `min-height: 44px` (documented-secondary floor — a full-width half-track is
  a huge target in practice; the CSS carries the comment), `border-radius: 12px` (inner < outer 15),
  transparent, 15/600 `-0.005em`, `color: var(--ink3)`; `aria-pressed`.

**States**
- Selected (`[aria-pressed="true"]`): `background: var(--seg-thumb); color: var(--ink);
  box-shadow: var(--sh-seg-thumb)` — a RAISED thumb.
  - Light thumb: `#FFFFFF` + `0 1px 2px rgba(16,17,20,.10), 0 3px 8px rgba(16,17,20,.08)`.
  - Dark thumb: `#313337` — one elevated step ABOVE the track (`#27282B`), NOT `var(--surface)`
    (which sits below it) — plus a hairline ring baked into the shadow:
    `inset 0 0 0 1px rgba(243,244,246,.10), 0 1px 2px rgba(0,0,0,.50), 0 3px 8px rgba(0,0,0,.38)`.
- Pressed: `transform: scale(.97)` — press acknowledgment is separate from selection and still ships.
- **Selection change: INSTANT. No sliding indicator, no thumb transition.** (Verbatim CSS comment:
  a tech flips Chambers/Rooms many times per visit; deleting the animation IS the correct craft
  call — the raised thumb + ink weight carry the state, not motion. This satisfies the
  motion-standard frequency-tier reversal.)
- Hover (fine pointers, unselected only): `color: var(--ink2)`.
- Focus-visible: global ring.

**Usage rules:** for high-frequency in-place view switches only (2–3 options). Not for navigation
(tabs), not for one-time choices (rows/sheets). Never animate the selection; never put counts or
icons in segments.

---

## 17. Greeting header (dashboard, `.hdr`)

The calm anchor. Lives in the sticky `.app-top` (with the status bar), `background: var(--ground)`,
`z-index: 20` — does not move on scroll or pull-to-refresh.

**Anatomy**
- Container: `padding: 4px 16px 12px; display: flex; align-items: flex-start;
  justify-content: space-between; gap: 8px`.
- Identity stack: date line (`.hdr-date`) 13/600 `--ink3` `margin: 0 0 1px` ("Tuesday, July 14");
  greeting (`.hdr-hi`) 26/700 `-0.015em` `line-height: 1.15` `text-wrap: balance` ("Hey Marcus" —
  no emoji in Direction B); summary (`.hdr-sum`) 13/500 `--ink2` `margin: 2px 0 0`
  ("4 appointments today").
- Actions cluster (`.hdr-actions`): flex `gap: 2px; margin-top: 2px` — offline-pill slot
  (section 22), then up to three 44px icon buttons (bell + badge, help, more).

**States:** header itself static; children own their states. Both themes: ground/ink tokens.

**Usage rules:** dashboard only. The greeting is the only 26px text in the system. Actions are
44px documented-secondary utilities — a field action never lives here.

---

## 18. Compact hub / module header (`.hubhdr`)

The pinned Z1 identity bar on detail and module screens (~80px with status bar clearance).

**Anatomy**
- Container: `display: flex; align-items: center; gap: 6px; padding: 2px 16px 10px 8px`
  (8px left — the back button supplies its own optical inset); `border-bottom: 1px solid var(--hair)`;
  sticky inside `.app-top`.
- Leading: `.backbtn` 48x48 (section 3).
- Identity (`.hub-id`, `flex: 1; min-width: 0`): name (`.hub-name`) 20/700 `-0.015em`
  `line-height: 1.2`, single-line ellipsis; sub (`.hub-sub`) 13/500 `--ink2` `margin: 1px 0 0`,
  single-line ellipsis, tabular ("#26-1173 · Equipment pull + final readings").
- Trailing: one chip, `flex: none` — hub: the visit's STATUS chip (chip-green Working);
  module: the context chip (chip-gray + `#i-cal` "Day 4").

**States:** children own their states; header never scrolls away.

**Usage rules:** hub headers carry the live status; module headers carry the module's day/context
counter in gray (a module has no clock state of its own). Title truncates — never wraps. Exactly
one trailing chip.

---

## 19. Attention strip (`.attn`)

Present-only-when-needed alerts card (stalled materials). First content element when present.

**Anatomy**
- Card: `.card.attn` — `padding: 16px 16px 8px; margin-top: 8px`.
- Head (`.attn-head`): flex `gap: 9px`, 15/600, `padding-bottom: 12px`; leading 20x20 warn triangle
  colored `var(--amber)` ("2 materials stalled across 2 jobs").
- Row (`.attn-row`): flex `gap: 12px; padding: 12px 0` (flush — the card supplies side padding),
  `border-top: 1px solid var(--hair)`, `border-radius: 12px`, `role="button" tabindex="0"`.
- Row tile (`.attn-ic`): 36x36, radius 12, `--amber-bg` fill, `--amber` icon 19x19 (the material
  glyph).
- Row body: title (`.attn-t`) 15/600 ("Drywall · Master Bathroom"); meta (`.attn-m`) 13/500 `--ink3`
  tabular with `strong` = ink/700 on the reading value ("#26-1187 · **19%** · goal 12% ·
  3d stalled").
- Trailing chevron `--ink3`.

**States:** row pressed = `--surface2` swap; focus ring global. Renders NOTHING when nothing needs
attention — the strip has no empty state.

**Both themes:** amber pair swaps via tokens.

**Usage rules:** amber = "needs action this visit/now" (the one encoding). Rows navigate to the
place the problem is fixed. Never more than one attention card; collapse long lists behind a
"Show all (N)" row (per the shell survey behavior).

---

## 20. Hero address row (`.hero-addr`)

The navigate-to-site action inside hero/stage cards — a 48px primary field action.

**Anatomy**
- `display: flex; align-items: center; gap: 7px; min-height: 48px` — glove-critical, full-bleed hit
  area via negative margins: `margin: 12px -6px 0` (hub: `8px -6px 0`; flow sitecard: `0 -6px`),
  `padding: 12px 6px`, `border-radius: 12px`.
- Leading pin icon 18x18 `--ink3`; address text 15/500 `--ink2`
  ("452 E Mill Pond Rd, Draper"); trailing chevron 15x15 `--ink3` pushed by `margin-left: auto`.
- `role="button" tabindex="0"` (opens Maps).

**States:** pressed = `--surface2` swap; focus ring global.

**Usage rules:** one per hero/stage card. The muted styling is intentional (the address supports the
primary action, it is not the headline) but the target is full 48px. Never truncate an address
mid-number; the row may wrap to a second line if needed.

---

## 21. Photo grid + placeholder thumbs + See-all (`.ph-*`, `.seeall`)

**Head (`.ph-head`):** flex space-between, `padding: 14px 16px 10px`; count (`.ph-count`) 15/600
("9 photos"); trailing See-all.

**See-all button (`.seeall`):** inline-flex `gap: 3px`, transparent, 13/600 `color: var(--ink2)`,
`padding: 6px 4px; margin: -6px -4px` (padding-with-negative-margin extends the hit area without
moving layout), `border-radius: 10px`; trailing 14x14 chevron `--ink3`. Pressed/hover =
`--surface2` swap. Focus ring global.

**Grid (`.ph-grid`):** `grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 0 16px 16px`;
shows the 6 most recent (2 rows).

**Thumb (`.ph`):** `aspect-ratio: 1; border-radius: 12px; background: var(--surface2);
color: var(--ink3)`, grid-centered. Placeholder state = 26x26 duotone photo glyph on the neutral
rect — deliberately reads as a thumb, never a broken image. In the app the real thumbnail image
fills the same box (`object-fit: cover`, same radius); thumbs open the lightbox.

**Usage rules:** grid is capped + "See all" routes to the album (truncation always pairs with a way
to reach the rest). Loading state = the placeholder thumbs themselves (no shimmer needed at this
size). Never full-res sources in the grid.

---

## 22. Offline pill (offline / sync indicator, in B's language)

Direction B relocates the legacy fixed top-right overlay INTO the greeting header's actions cluster
(the `.offline-pill` slot, dashboard) so it never floats over content: `margin-right: 4px`, hidden
while online via the `hidden` attribute (`.offline-pill[hidden] { display: none !important }` —
the chip's `display: inline-flex` would otherwise beat the UA `[hidden]` rule). The greeting layout
absorbs its appearance without reflow. On non-dash screens the pill may render as the same chip in
the hub header's trailing area or the shell's safe-area slot — same anatomy either way.

**Anatomy:** it IS a chip (section 8) — same geometry (`padding: 4px 10px 4px 8px`, radius 999,
12/600, 13x13 glyph, `gap: 5px`).

**States (mapped from the shell survey's three queue states to B's chip tones)**
- Offline / syncing: `chip-amber` + warn triangle glyph, label "Offline" (shipped) or "Syncing N"
  while queued uploads are pending — amber = needs attention, work is held.
- Failed: `chip-red` + warn glyph, "N failed" — TAPPABLE (the one interactive chip exception):
  gains `role="button"`, 48px hit area via padding extension, tap retries all queued uploads.
- Synced flash: `chip-green` + check, "Synced" — 2s appearance on the pending-to-zero transition,
  then hidden.
- Idle/online: `hidden` — renders nothing.

**Both themes:** tone pairs via tokens.

**Usage rules:** presence IS the message — never show a green pill at rest. Never move the greeting
when it appears. Only the red state is tappable.

---

## 23. Office-note / quiet footer row (`.hero-next`)

The one-line quiet footer idiom: NEXT visit preview (dashboard), office note (hub stage), pull
justification (drying equipment card).

**Anatomy**
- `display: flex; gap: 7px; align-items: center` (`flex-start` + `margin-top: 1px` on the icon when
  the text can wrap to 2 lines — hub/module note variants); `margin-top: 8–12px;
  padding-top: 12px; border-top: 1px solid var(--hair)`.
- Leading 15x15 duotone icon `--ink3` (clock for next-visit, note glyph for office notes).
- Text 13/500 `--ink2`, tabular; `strong` fragments = ink/600 (the time, or the source label:
  "**Office note** · Lockbox on side gate, code 3311.").
- Positional override inside a `.rowcard` (disclosed in hydro): `margin: 0 16px;
  padding-bottom: 14px; align-items: flex-start` (the hub's lives inside the padded hero card).

**States:** display-only (not a button). Both themes via tokens.

**Usage rules:** exactly one quiet footer per card, always LAST inside the card, always
hairline-separated. This is where context lives that must not compete with the primary action
(the next stop, the office's justification). Never promote it to a row with a chevron — if it must
navigate, it is a `.row`.

---

## 24. Status bar + home indicator chrome conventions

Mock chrome that the design system commits to (the app renders under the real iOS chrome, but
spacing contracts derive from these).

**Status bar (`.statusbar`)**
- `height: 46px; padding: 12px 26px 0`, flex space-between; type 15/600 tabular; color = `--ink`
  (inherits — theme-correct in both modes via `color-scheme`).
- Left: clock. Screens of record read "11:20" — a DISCLOSED deviation from the 9:41 default: 11:20
  is the sample-day moment that keeps the hero timer math true (2:08:07 since 9:12 AM). New mocks
  either keep the sample moment consistent or revert to 9:41.
- Right cluster (`gap: 6px`): signal bars (18x12, 4 bars, last at .35 opacity), wifi arcs (17x12,
  1.6 stroke), battery (25x12, .4-opacity outline + solid fill + nub) — all drawn SVG,
  `currentColor`.

**Home indicator (`.home-ind`)**
- `width: 134px; height: 5px; border-radius: 3px; margin: 10px auto 0;
  background: var(--ink); opacity: .28` — lives INSIDE the tab bar's safe-area padding.

**Layering contract:** `.app-top` (status bar + header) sticky `z-20` on `--ground`; dock `z-25`;
tab bar `z-30`. Main scroller bottom padding clears everything below
(dash 190px / hub 264px / module 240px).

---

## 25. Day timeline (`.tl` — dashboard glance graphic)

Status-colored blocks on an 8 AM–5 PM hours axis. GLANCE-ONLY: proportional blocks cannot honor
44px minimums, so the blocks take NO taps — the rows below remain the tap surface.

**Anatomy**
- Wrapper: `margin: 16px 2px 0`; `role="img"` with a full sentence `aria-label` describing the day.
- Track (`.tl-track`): `position: relative; height: 36px`.
- Block (`.tl-block`): absolute, `height: 36px; border-radius: 12px`, grid-centered 14x14 status
  SHAPE glyph; positioned/sized by start+duration (`left`/`width` percentages of the 9h axis).
  Tints: `.tl-green` (`--green-bg`/`--green`), `.tl-blue`, `.tl-gray` — the status-bg families,
  glyph in the status fg.
- Now-cursor (`.tl-now`): section 10, item 4.
- Axis (`.tl-axis`): `height: 16px; margin-top: 6px`; ticks (`.tl-tick`) 12/500 `--ink3` tabular
  ("8 AM", "11 AM", "2 PM", "5 PM"), mid ticks `translateX(-50%)`, end tick `translateX(-100%)`.

**Usage rules:** never make blocks tappable; blocks always carry their shape glyph (state survives
grayscale); axis range may widen but ticks stay 12/500 ink3.

---

## 26. Moisture-point micro-table (`.mp-*` — drying module)

The one table in the system: fixed right-aligned numeric columns so MC and Goal align vertically.

**Anatomy**
- Title row (`.mp-title`): flex baseline space-between, `padding: 14px 16px 0`; name (`.mp-name`)
  16/600 `-0.005em`.
- Column grid (`.mp-cols`): `grid-template-columns: 1fr 46px 46px 76px; gap: 10px;
  align-items: center` (Material | MC | Goal | Status).
- Header microrow (`.mp-head`): `padding: 10px 16px 6px`, 11/600 `--ink3`; numeric headers
  right-aligned (`.c`). 11px is legal here: column headers are labels, never actionable.
- Data row (`.mp-row`): `padding: 11px 16px; border-top: 1px solid var(--hair); min-height: 52px`;
  tappable (opens point history — same affordance as reading rows): pressed = `--surface2` swap,
  `tabindex="0"`. Real table semantics via `role="table"/"row"/"columnheader"/"cell"` on the divs.
- Cells: material (`.mp-mat`) 15/600 `-0.005em`; MC (`.mp-mc`) right-aligned 15/650 ink tabular;
  goal (`.mp-goal`) right-aligned 15/500 `--ink3` tabular; trailing chip `justify-self: end`
  (chip-green "Dry" + check, or chip-amber "Wet" + drop).
- Stall marker under the material name (`.mp-stall`): section 10, item 8 ("2d stalled").

**Usage rules:** the micro-table is for dense comparable numerics ONLY (moisture points). Everywhere
else, use rows. Never add a fifth column; never drop the shape glyphs from the status chips.

---

## 27. Section furniture: `.sect-title`, `.day-h`, chamber header

- **Section title (`.sect-title`):** 16/600, `-0.005em`, `margin: 24px 4px 8px`,
  `text-wrap: balance`. Sentence case, OUTSIDE the card ("Rest of today", "Drying · Day 4").
  No eyebrows, no numbering, no color.
- **Day heading (`.day-h`):** 13/600 `--ink2`, `margin: 16px 4px 8px` (first child `margin-top: 2px`)
  — date group headers inside "Coming up" ("Wednesday, Jul 15").
- **Chamber header (`.chm-head`):** in-card section head — `padding: 14px 16px 12px;
  border-bottom: 1px solid var(--hair)`; title (`.chm-title`) 16/600 `-0.005em`
  ("Chamber 1 · Kitchen"); meta (`.chm-meta`) 13/500 `--ink3` tabular `margin-top: 1px`
  ("Target 70–80°F · Rooms: Kitchen"). A collapsed chamber renders as a `.row` reusing
  `.chm-title/.chm-meta` in the row body + a trailing expand chevron
  (20x20, `--ink3`, `transform: scaleX(-1)` on `#i-chev-l`, `aria-expanded`).

---

## 28. Notification bell + badge

An `.iconbtn` (section 3) hosting `#i-bell` 23x23 + `.badge-num` (section 7) at
`top: 5px; right: 5px`. `aria-label` includes the count ("Notifications, 1 unread"). Badge hidden at
zero. Behavior (dropdown list, mark-read) is the shell's NotificationBell contract; visually the
bell is never colored — the red badge alone signals.

---

## 29. Duotone icon conventions (consumption contract for every component above)

- 24px grid (`viewBox="0 0 24 24"`), drawn strokes `1.8px` (`2px` for pure-line glyphs: check,
  chevron, trend; `2.2px` for the FAB plus), round caps + joins.
- Duotone = silhouette fill layer at `opacity: var(--duo, .16)` + stroke layer, both `currentColor`.
  Components tune presence via the `--duo` custom property (tab inactive `.14`, active `.9`).
- `.ic { display: block }` globally; in-text glyphs (`.dtrend`) explicitly re-set
  `display: inline-block`.
- Sizing is per-use (width/height attributes): 25 tab, 24 back/FAB, 23 header utility, 19–20 tiles
  and dock, 18 button-inline, 15–16 rail/footer/chev, 13–14 chip, 12 stall marker.
- Decorative icons are always `aria-hidden="true"`.
- Status shape vocabulary (fixed): arrow = OMW · dot-in-ring = working · pause bars = paused ·
  clock = scheduled/due · check = done/dry/signed · drop = wet/moisture · flag = finish goal.

---

## 30. Global state summary table

| Component | Pressed | Focus-visible | Hover (fine pointer) | Disabled/loading |
|---|---|---|---|---|
| Primary pill | scale(.97) | ring | none | global convention |
| Quiet pill (ripened counterpart) | scale(.97) + surface2 | ring | surface2 | global |
| qbtn / ck-act / dock-photo | scale(.97) | ring | surface2 | global |
| iconbtn / backbtn / dock-btn / tab | scale(.94) + surface2 (tab: scale only) | ring | surface2 | global |
| FAB | scale(.93) | ring | translateY(-1px) | global |
| seg-btn | scale(.97); selection instant | ring | ink2 text (unselected) | global |
| row / attn-row / task / mp-row / hero-addr / seeall | background surface2 (no scale) | ring | surface2 (seeall only) | n/a |
| chips / badges / rail / timers / footers | none (passive) | n/a | n/a | n/a |

---

**Component count: 30 specified components/conventions** (sections 1–29 plus the global state
table), covering every interactive and display idiom shipped on the four screens of record, with
the flow challenger's ripened-Finish variant folded into the primary pill spec.
