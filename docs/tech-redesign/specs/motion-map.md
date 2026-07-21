# Motion Map — Direction B "Apple Field Pro" (/tech/* greenfield)

**Status:** CONFIRMED against `.claude/rules/motion-standard.md` v2 (the law). This document maps the
law onto the locked Direction B component set — it tunes, it never re-authors. Where a mockup literal
and the law disagree, the law wins and the retarget is flagged in section 6.

**Consumed by:** the style-guide builder (token values) and the doc author (design-system Motion
section). Token NAMES below are the F-S2 catalog names already live in `src/index.css :root`
(`--motion-duration-fast|base|slow`, `--motion-ease-standard|decelerate|accelerate`,
`--motion-spring-in`). The style guide sets VALUES; this map only assigns tokens to components.

---

## 1. Ground rules confirmed for Direction B (from the law, restated as applied)

1. **Frequency tier first.** Every row below carries a tier. High-frequency controls (clock actions,
   task checks, tab/segment/day/filter switches) are **instant tier**: no animated selection
   indicator, opted OUT of `@view-transition`, press feedback only. Deleting the animation is the
   correct craft call on these rows; the checker must not fail them (law section 3 tier reversal).
2. **Every enter has an exit** at approximately **75% of the enter duration on
   `--motion-ease-accelerate`**, unmounting on `animationend` via the shared `--closing` lifecycle.
   `if (!open) return null` with no exit is a defect. Applies to sheets, menus, toasts, modals,
   FAB menu, pills.
3. **`--motion-spring-in` (enters only)** is limited in this system to: **FAB enter, bottom-sheet
   enter (conditionally — see the drag caveat in section 4), toast enter.** It is OFF every money /
   pricing / billing surface (TechOOPPricing, invoice-adjacent rows: crisp `--motion-ease-decelerate`
   there), OFF all exits, and OFF any surface the moment it becomes drag-interruptible (law section 1;
   a real gesture wants the section-9 spring util, not a fixed curve).
4. **Route pushes use the native View Transitions API**, directional (forward enters from the leading
   edge; Back reverses), driven by the nav-direction signal (`html[data-nav]` per the shipped
   architecture), duration at most `--motion-duration-base`, transform/opacity only. **Shell chrome is
   persistent** — `.tech-nav` keeps `view-transition-name: vt-technav`; the sticky greeting/screen
   header gets its own persistent `vt-*` name. Bottom-tab switches between the keep-alive panes are
   NOT pushes: panes hide via `hidden`/`display:none` (WKWebView law — transforms banned for hiding),
   so tab switching is **instant by construction** and stays that way.
5. **Reduced motion is a hard gate.** Every row states its collapse. Under
   `prefers-reduced-motion: reduce`: movement collapses to instant or opacity-only, the end-state
   still lands, focus/aria intact, haptics suppressed. Every `:hover` transform is gated behind
   `@media (hover: hover) and (pointer: fine)`.
6. **Haptics are additive, never load-bearing** (`src/lib/nativeHaptics.js`; no-op on web/PWA —
   the visual motion carries the entire feel there). Vocabulary: `impact('light')` = press of a
   primary field action, photo save, message send, swipe threshold; `selection()` = tab / segment /
   chip / toggle / week-strip snap; `notify('success'|'error')` = clock action outcome, multi-step
   submit outcome. Never on scroll, keystroke, or background events.
7. **GPU-only, time-based.** transform/opacity only (progress bars and the completion ring are the
   two sanctioned exceptions noted in their rows). No width/height/top/left tweens — expanding
   inline affordances reveal instantly and fade their content in; they do not tween height.

Press feedback house idiom (universal): buttons and round controls use `transform: scale(0.97)` on
`:active`, `transition: transform var(--motion-duration-fast) var(--motion-ease-standard)`, spring
back on release, plus `touch-action: manipulation` and transparent tap highlight. **List rows and
row-shaped links use the background/opacity swap instead of scale** (that IS the row standard) on
the same fast token.

---

## 2. Motion table A — Navigation and shell

| Component | Tier | Enter | Exit | Press | Selection | Reduced motion | Haptic |
|---|---|---|---|---|---|---|---|
| Route push (list to detail, detail to hub, drill-ins) | Occasional | View Transition, directional from leading edge, at most `--motion-duration-base`, `--motion-ease-decelerate` | Back reverses direction, ~75% on `--motion-ease-accelerate` | n/a | n/a | Instant navigation (VT skipped); end state lands | none |
| Bottom tab bar (5 tabs, keep-alive panes) | **High-frequency: instant** | Pane swap is `display:none` toggle — **no animation, by law and by WKWebView constraint** | none | Icon/label press = scale(0.97) fast/standard | Active tab swap instant; **no sliding indicator** (opted out) | Already instant | `selection()` |
| Sticky greeting / page headers | n/a | Persistent `vt-*` name — **never animates** during transitions | never | n/a | n/a | n/a | none |
| Segmented controls (Agenda/Day, Tasks Today/All, Claims Mine/All, msgs filter pills, RoomDetail tabs, OOP PillToggle) | **High-frequency: instant** | n/a | n/a | scale(0.97) fast/standard on the pressed segment only | **Instant swap — NO animated pill/underline/clip-path fill.** The hydro-b annotation ("selection itself stays INSTANT") is the confirmed system-wide call | Already instant | `selection()` |
| WeekStrip date selector | **High-frequency: instant** | n/a | n/a | row-standard background swap fast | Day selection instant; strip movement = native scroll-snap only (free momentum, section 9 rule 1) | Native scroll unaffected | `selection()` on snap |
| Today pill / jump-to-latest pill | Occasional | fade + small translateY, `--motion-duration-fast`, `--motion-ease-decelerate` | ~75% fast on accelerate, then unmount | scale(0.97) fast/standard | n/a | Opacity-only fade | none |
| Transient search reveal (schedule icon-toggled) | High-frequency-adjacent | **Instant reveal** (no width tween — layout property), input content fades in fast | Instant collapse | n/a | n/a | Already instant | none |

## 3. Motion table B — Field actions and controls

| Component | Tier | Enter | Exit | Press | Selection | Reduced motion | Haptic |
|---|---|---|---|---|---|---|---|
| Clock station buttons (On my way / Start / Pause / Resume / Finish; TimeTracker + NowNextHero) | **High-frequency: instant** | State swap (label, color, ring) is **instant** — a tech waits on nothing | n/a | scale(0.97) fast/standard (the one animated thing here) | Status color/shape swap instant | Already instant | `notify('success'/'error')` on the action OUTCOME (not the press) |
| Task check (SwipeTaskRow circle) | **High-frequency: instant tier** | n/a | n/a | row background swap fast | Check confirm may keep the reference "pop" at **at most `--motion-duration-fast`** (inside the instant-tier budget); strikethrough applies instantly | Pop removed; checked end-state instant | `impact('light')` |
| Toggles (settings, affected toggle, private) | Occasional | n/a | n/a | none beyond the knob | Knob slide + track color, `--motion-duration-fast`, `--motion-ease-standard` (tokenize the raw 200ms ease) | Instant knob reposition | `selection()` |
| Two-tap inline confirm (Sign Out, Remove, delete; ~3s auto-cancel) | Occasional | Label/color CROSSFADE to armed state, fast/standard — **no layout movement** | Auto-cancel crossfades back, fast | scale(0.97) fast/standard | n/a | Instant text swap | `notify()` on the destructive commit only |
| Steppers (StepperRow, NumField) | High-frequency: instant | n/a | n/a | scale(0.97) fast/standard on +/- | Value change instant (tabular-nums, no tween) | Already instant | none |
| Form fields / focus rings | Occasional | Border/ring transition `--motion-duration-fast` `--motion-ease-standard` (the existing `.field:focus` pattern, tokenized) | reverse fast | n/a | n/a | Instant ring | none |
| Crew initials multi-select chips, filter Chip, RoomChip | High-frequency: instant | n/a | n/a | background swap fast | Selected state (check, fill) instant | Already instant | `selection()` |
| Money/pricing surfaces (TechOOPPricing rows, price fields) | Occasional | **Crisp register: fade/translate on `--motion-ease-decelerate` only. `--motion-spring-in` BANNED here** | 75% accelerate | scale(0.97) fast/standard | instant | opacity-only | none |

## 4. Motion table C — Overlays (sheets, menus, modals, FAB)

| Component | Tier | Enter | Exit | Press | Selection | Reduced motion | Haptic |
|---|---|---|---|---|---|---|---|
| Bottom sheets (CreatePicker, PhotoNoteSheet, ReadingEntrySheet, EquipmentPlacementSheet, AddRoomSheet, TechHelpSheet, EsignRequestSheet, AdminJobMenu, composer tools, job-picker sheets) | Occasional | Slide up from bottom edge, `--motion-duration-base`. Easing: `--motion-spring-in` is **permitted while the sheet has no drag-to-dismiss** (a non-interruptible one-shot; keep the settle subtle). **The moment section-9 drag-to-dismiss wires in, the fixed spring comes OFF** and enter runs `--motion-ease-decelerate`; release/fling is then handed to a CSS transition by the scoped util. Backdrop fades in parallel | Slide down ~75% of enter on `--motion-ease-accelerate`; backdrop fades; unmount on `animationend` (`--closing`) | Sheet-internal buttons: scale(0.97) fast/standard | Wizard step change (ReadingEntrySheet 4-step): horizontal transform crossfade at `--motion-duration-base`, decelerate — transform/opacity only, no height tween | Sheet appears/disappears instantly; backdrop opacity-only; focus trap intact | `impact('light')` on commit actions (e.g. photo save inside PhotoNoteSheet) |
| ClockSupersedeSheet (red warning) | Occasional | Same sheet mechanics but **no spring** — a warning surface keeps the crisp register: `--motion-ease-decelerate` at base | 75% accelerate | scale(0.97) | n/a | instant | `notify('error')` on block; `notify('success')` on confirm-and-continue |
| Dropdown menus / popovers (DashHeader vertical-ellipsis, hub ellipsis, ConvoRow inline action) | Occasional | Origin-aware pop: fade + scale 0.96 to 1 with `transform-origin` set from the trigger rect, `--motion-duration-fast`, `--motion-ease-decelerate` (spring-in NOT used — menus are dismiss-interruptible in practice; keep the law's menu-pop option in reserve, decelerate is the B default) | ~75% fast on accelerate, unmount on end | menu items: background swap fast | n/a | Instant show/hide | `impact('light')` on the opening press only |
| Modals (MergeModal — the one field-legal modal, shared with desktop) | Rare | Overlay fades; panel fades + scales up slightly, `--motion-duration-base`, `--motion-ease-decelerate`, `transform-origin: center` (modals are the center-origin exception) | Fade + scale down at 75% on accelerate | scale(0.97) | n/a | Opacity-only | none |
| Lightbox (photo viewer) | Occasional | Backdrop + image fade in, `--motion-duration-base`, decelerate (a scale-from-thumbnail shared-element is a later View-Transition enhancement, not required) | Fade out 75% accelerate | prev/next: instant image swap or fast crossfade — never a slide the finger did not make | counter text instant | Opacity-only | none |
| CreateFAB (dash) | Rare (enters once per dash mount) | `--motion-spring-in` one-shot: scale + fade in. Duration retargets to `--motion-duration-slow` (the mockup's 380ms tunes down to the slow token; if 380ms is kept, state the reason per the law's over-300ms rule) | n/a (persists) | scale(0.97) fast/standard | n/a | Appears instantly at full scale | `impact('light')` on open press |
| FAB expanded menu (dim backdrop + 2 labeled actions) | Occasional | Children pop from the FAB origin (origin-aware), fade + scale, `--motion-duration-fast`, decelerate, at most ~30ms stagger between the two | ~75% fast accelerate, reverse stagger, unmount on end | scale(0.97) | n/a | Instant show/hide, backdrop opacity-only | `selection()` on child choice |

## 5. Motion table D — Feedback, status, content

| Component | Tier | Enter | Exit | Press | Selection | Reduced motion | Haptic |
|---|---|---|---|---|---|---|---|
| Toasts (shell stack incl. "Photo saved - Add note" action toast) | Occasional | Slide/fade from the container edge via **`@starting-style` on a transition** (retargetable when a second toast arrives — never a restarting keyframe). `--motion-spring-in` permitted on the enter; `--motion-duration-base` | Auto-dismiss fade ~75% on accelerate; swipe-dismiss is a section-9 gesture (fling handed to CSS) | action link: background swap fast | n/a | Opacity-only in/out; 5s timing unchanged; `role=status`/`alert` intact | `impact('light')` rides the triggering action (photo save), not the toast itself |
| StatusChip / status lamp state change | Occasional | Color + shape-glyph crossfade, `--motion-duration-fast`, standard — never layout movement. **No working-state pulse in Direction B** (that is the Direction A lamp idiom) | n/a | n/a | n/a | Instant swap; shape redundancy carries state | none (the clock action already fired `notify`) |
| Attention strip / warning banners (StalledWidget, away-from-site, 5PM, work-auth, DND, clocked-elsewhere) | Occasional | Fade + small translateY on **first mount only**, `--motion-duration-base`, decelerate. Never re-animates on resume/refetch (page-lifecycle law) | Dismiss: fade 75% accelerate, then unmount (no height collapse tween) | inline actions: scale(0.97) fast | n/a | Instant appear | none |
| Unread badges / count pills (tab badge, row badges, NotificationBell) | Occasional | Fade + scale 0.9 to 1, fast, decelerate, first appearance only | Fade out 75% fast | n/a | Count CHANGES are instant (tabular swap, never bounce) | Instant | none |
| Skeletons (SkeletonBlock/Row/List, pane Suspense) | Cold-start only | Optional gentle opacity pulse, `--motion-duration-slow` loop, opacity-only | Content replaces skeleton with a fast opacity crossfade | n/a | n/a | Static (no pulse) | none |
| OfflineStatusPill (syncing) | Occasional | pill: fade fast | fade 75% | n/a | Indeterminate spinner rotation allowed (transform-only, continuous) | Static icon + text label carries the state | none |
| Progress bars / completion ring / task-group bars | Occasional | Value change eases `--motion-duration-base` `--motion-ease-standard` (width / stroke-dashoffset — the sanctioned non-transform exceptions; keep bars short) | n/a | n/a | n/a | Jump to end value | none |
| Chat bubbles (tech messages pane; per law section 3) | Occasional | Sent: translateY up from composer edge + fade, right-aligned; incoming: fade + scale 0.98 to 1; both `--motion-duration-base` `--motion-ease-decelerate` | n/a (bubbles persist) | send button: scale(0.97) fast | Pending-to-sent: smooth opacity/checkmark transition; optimistic reconcile must NOT reflow or re-animate (match and swap in place) | Bubbles appear instantly | `impact('light')` on send success (already at useThread.js:224) |
| Photo grid thumbnails | Occasional | Image-load fade-in, fast, opacity-only, `loading="lazy"` unaffected | n/a | tile press: opacity swap fast | n/a | Instant | `impact('light')` on capture/save (the action, not the render) |
| Timer digits (StageClock, NowNextHero countdown, hours readouts) | n/a | **No motion.** Once-per-second text swap on tabular-nums; no flip/roll/fade | n/a | n/a | n/a | n/a | none |
| Inline expanding affordances (ConvoRow ellipsis action, inline note input, "See all") | High-frequency-adjacent | **Instant reveal** (no height tween); revealed content fades in fast | Instant collapse | revealed 48px action: scale(0.97) | n/a | Already instant | none |
| Empty/Error states (EmptyState, ErrorState, Retry) | Occasional | Fade in fast on settle — never animate on a refetch that keeps stale rows | n/a | Retry button: scale(0.97) fast | n/a | Instant | none |

## 6. Gesture surfaces (law section 9 — separate mechanism, NOT View Transitions or fixed curves)

| Surface | Ruling |
|---|---|
| Bottom-sheet drag-to-dismiss | Sanctioned target of the scoped pointer + rAF spring util (route-lazy, dep-free). 1:1 tracked from grab offset; velocity from short pointer history; flick threshold ~0.11 px/ms; settle/fling handed to a CSS transition. Per-frame writes go to `node.style.transform` on the moving node — never a parent CSS var, never `useState`. When wired, the sheet's enter drops `--motion-spring-in` (section 4). |
| PullToRefresh | Sanctioned util target. Wraps content below the fixed header only; arms at scrollTop <= 5; `onRefresh` silent. Spinner = transform rotation. Reduced motion: indicator opacity-only. Haptic: `impact('light')` at arm threshold (already the shipped vocabulary). |
| Toast swipe-to-dismiss | Sanctioned util target; same recipe. |
| SwipeTaskRow swipe-right reveal | **Live ad-hoc touch-drag — must be reconciled at build time:** fold into the scoped util OR consciously keep as-is with a disclosed note in the PR (law section 9 reconcile rule). Threshold crossing fires `impact('light')`; commit fires `impact('medium')` (shipped vocabulary). |
| Week/agenda/thread scrolling | Native overflow scroll only — momentum and rubber-band for free; no custom gesture code. |
| Every gesture surface | Ships with an owner on-device iPhone gate (Playwright proves behavior, not feel — state the caveat in the PR). |

## 7. Build-time retarget flags (mockup literals to shared tokens)

The three screens of record ship deliberately-inlined motion for the artifact format. At build time
every literal retargets to the F-S2 tokens — none may survive as raw values (the
`design-consistency-checker` fails them):

1. **`transition: transform 120ms ease-out` / `transform 120ms ease-out, background 120ms ease-out`**
   (direction-b.html:161,262,271,356,379; refine-b-jobhub.html:114,184,194,249,313,322,342;
   hydro-b.html:148,210,309,318,338) — retarget to
   `transition: transform var(--motion-duration-fast) var(--motion-ease-standard), background-color var(--motion-duration-fast) var(--motion-ease-standard)`.
   The `ease-out` literal was a stand-in; press feedback runs on **standard**, per the law's press rule.
2. **`transition: background 120ms ease-out`** on rows/links (direction-b.html:187,225,315;
   refine-b-jobhub.html:205,229,257,287; hydro-b.html:227,279) — retarget to
   `background-color var(--motion-duration-fast) var(--motion-ease-standard)` (the row press idiom).
3. **`animation: fab-in 380ms cubic-bezier(.3,1.14,.42,1) both`** (direction-b.html:359) — retarget to
   `animation: fab-in var(--motion-duration-slow) var(--motion-spring-in) both`. The bespoke
   cubic-bezier overshoot is exactly what `--motion-spring-in` (a `linear()` spring) exists to
   centralize; the 380ms tunes to the slow token (320ms) unless the style guide states a reason to
   exceed 300ms for this rare one-shot. The `fab-in` keyframe itself (scale .5 to 1 + fade) is the
   catalogued FAB enter.
4. **hydro-b.html:197,210 instant-segment annotation** — CONFIRMED as written; carry the comment into
   the built component ("selection itself stays INSTANT — press feedback only") so the frequency-tier
   call is legible to the checker.
5. **Blanket reduced-motion kill blocks** (direction-b:414, refine-b-jobhub:388, hydro-b:380 —
   `*, *::before, *::after { animation:none; transition:none }`) — a valid collapse for a static
   mockup; production instead uses the F-S2 universal reduced-motion wrapper so end-states land and
   opacity-only survivors are possible per row. Do not copy the blanket kill into `index.css`.
6. **Legacy `--transition-fast/base` combined tokens** — new tech surfaces never consume them; they
   remain aliases for un-migrated legacy CSS only (architecture survey KEEP/REPLACE ruling).
7. **Hover transforms** — any `:hover` lift/scale added during build must sit inside
   `@media (hover: hover) and (pointer: fine)` (hard failure otherwise). The mockups carry none on
   touch paths; keep it that way.

## 8. Open items for the style-guide builder

- Set the token VALUES (fast ~120ms, base ~200-240ms, slow ~320ms; the three cubic-beziers; the
  `linear()` spring curve with a subtle ~3-4% overshoot matching the mockup's fab-in feel).
- The `--motion-spring-in` catalog entry must name its three consumers (FAB enter, non-draggable
  sheet enter, toast enter) and its bans (money surfaces, exits, drag-interruptible surfaces) verbatim.
- Publish the `--closing` exit lifecycle snippet (add class, run exit at 75% on accelerate, unmount on
  `animationend`) once in the Motion section; every overlay row above references it rather than
  restating it.
- The tier table (section 1, rule 1) and the checker exemption for instant high-frequency controls
  ship together with any checker change, never apart (law section 3 ordering caveat).
