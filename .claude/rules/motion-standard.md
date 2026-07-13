# Motion & Transitions Standard

Linked from `CLAUDE.md`. **The law for how the app MOVES — page transitions, and the motion + haptics of
buttons, selections/toggles, dropdowns, modals, sheets, toasts, form affordances, and chat messages
(sent/received).** Born from the owner's directive that navigating between
screens should feel like *the system taking you there and bringing you back*, never a flashing refresh —
and that the motion "standards catalog" must be **changeable from one place later**. Owned/implemented by
the F-S2 foundation; enforced by `design-consistency-checker`. Companion: `perf-budget.md` (motion is
cheap or it doesn't ship), `UPR-Design-System.md` (the catalog itself).

## 1. One tunable catalog — motion lives in tokens + the design system, never per-page

All motion is defined in **two central places** and nowhere else:
- **`:root` motion tokens** in `src/index.css` — durations + easings (extends the existing
  `--transition-fast: 120ms` / `--transition-base: 200ms`):
  `--motion-duration-fast` (~120ms, hovers/toggles), `--motion-duration-base` (~200–240ms, page + modal
  transitions), `--motion-duration-slow` (~320ms, large surfaces); `--motion-ease-standard`
  (`cubic-bezier(.2,0,0,1)` — the default), `--motion-ease-decelerate` (enter), `--motion-ease-accelerate`
  (exit). Change a token → the whole app retunes. **No bespoke `120ms`/`ease-in-out`/`@keyframes` in a
  page or component where a token/standard exists** (the `design-consistency-checker` fails these).
- **The Motion section of `UPR-Design-System.md`** — the catalog: the standard page transition, and the
  standard motion for each primitive (dropdown, modal/sheet, toast, form focus). Each entry says which
  tokens it uses and shows the one import/class. Retuning a category = editing that one entry.

## 2. Page transitions — "the system takes you there"

- Use the **native View Transitions API** (dependency-free; Safari 18+/iOS, Chrome/Edge 111+, Firefox
  144+; **degrades gracefully** — unsupported browsers just navigate instantly, nothing breaks). Do NOT
  add framer-motion / react-spring / gsap.
- SPA wiring (React Router v7): opt in globally with `@view-transition { navigation: auto; }` in
  `index.css` and route links via the router's `viewTransition` support (`<Link viewTransition>` /
  `useViewTransitionState`) so a click that changes the route animates through one shared, central
  transition. **Retire the per-page ad-hoc `entering`/`requestAnimationFrame(setEntering)` patterns**
  (`TechAppointment.jsx`, `TechJobDetail.jsx`, `TechClaimDetail.jsx`, `tech/v2/schedule/DayTimeline.jsx`)
  — they become the one shared mechanism.
- **Directional semantics:** forward navigation enters from the leading edge (new screen comes in over the
  old); **Back** reverses it (feels like returning). Drive direction from a nav-direction signal (history
  index / router state), not per-page guesses. The sticky app shell (nav bars, headers) is marked as a
  persistent view-transition name so it does NOT animate — only the content region transitions
  (reinforces `page-lifecycle.md`: the shell stays put).
- **Cheap or it doesn't ship** (`perf-budget.md`): transitions animate **transform/opacity only** (GPU),
  are short (page ≤ `--motion-duration-base`), never block input, and never gate a spinner. A transition
  must never re-run a page's `load()` — it animates the route change, it does not refetch.

## 3. Component & interaction motion (the rest of the catalog)

Each shipped by F-S2's primitives, consuming the motion tokens. The app already has the right *idioms*
in places — the job is to make them uniform and token-driven, not to invent.

- **Buttons — press feedback (every interactive control).** The house idiom is
  `transform: scale(0.97)` on `:active` + `touch-action: manipulation` + `-webkit-tap-highlight-color:
  transparent` (already informally standard at `.tech-layout .btn:active` — index.css:4892-4895; also
  `.tech-tracker-btn`, `.coll-chat-send`). Promote it into the shared button so it is universal:
  transition `transform var(--motion-duration-fast) var(--motion-ease-standard)`, spring back on release.
  List rows may instead use the background/opacity swap they use today (that IS the standard for rows).
  **Offenders to fix:** the base `.btn` has no press feedback; `TechDemoSheet`'s inline-styled buttons
  (`:1392`) have none. On **native**, a primary/field-action press also fires a light haptic (§4).
- **Selection / toggles — animate the change, never snap.** Toggle switches keep their sliding-knob +
  track-color transition (`.admin-toggle`/`.conv-dnd-toggle` — tokenize the raw `200ms ease` at
  index.css:513). **Segmented controls, tabs, chips, and filter pills currently SNAP** (no transition on
  the active fill — `.tv2-segmented`, `.ovw-seg-btn`, the `TechDemoSheet` tech-select inline swap): the
  standard is an **animated selection indicator** — a sliding pill/underline that moves to the chosen
  option, or a cross-fade of the active state — on `--motion-duration-fast`. The checkbox "pop"
  (`tech-check-pop`) is the reference for a selection confirming itself. On **native**, a selection change
  fires `nativeHaptics.selection()` (§4).
- **Chat — message sent / received.** Today bubbles have **zero enter motion** (only the tv2 thread
  *panel* slides in — `tv2-msgs-slide-in`, index.css:11436). The standard: a **sent** bubble animates up
  from the composer edge (translateY + fade, right-aligned) and an **incoming** bubble fades + scales in
  gently (0.98→1, left-aligned), on `--motion-duration-base`/`--motion-ease-decelerate` — reference the
  existing `collChatIn` keyframe (index.css:8104). The optimistic **pending → sent** change is a smooth
  opacity/checkmark transition (not the current 0.72→1 jump / instant status-text swap), and reconciling
  the optimistic bubble for the real row must **not reflow or re-animate** (match + swap in place). On
  **native**, send-success fires `impact('light')` (already at `useThread.js:224`). *(The shared
  `Conversations`/`MessageBubble` are owned by the sms-experience initiative — this standard is authored
  now and implemented when that surface is next touched, per the W6 fold-in ledger.)*
- **Dropdowns / menus / popovers:** fade + slight scale (0.96→1) from the trigger origin, `--motion-duration-fast`.
- **Modals (desktop):** overlay fades, panel fades + scales up slightly. **Sheets (mobile):** slide up from
  the bottom edge, `--motion-duration-base`, `--motion-ease-decelerate`; dismiss reverses. (Modal behavior
  itself — focus trap, ESC, scrim — is the shared `Modal` primitive; this rule governs only its motion.)
- **Toasts:** slide/fade in from the container edge; auto-dismiss fades out. **Form focus:** border/ring
  transitions on `--motion-duration-fast` (already the `.field:focus` pattern — tokenize it).

## 4. Haptics — the native-feel multiplier (pairs with motion, never replaces it)

On the installed app, a subtle haptic tick paired with a visual micro-interaction is the single biggest
"feels native" upgrade. Use the existing helper **`src/lib/nativeHaptics.js`** (do not hand-roll or add a
dep) — it is Taptic on native, `navigator.vibrate` on web, fire-and-forget. Standard vocabulary:
- `impact('light')` — a button/field-action press, a message send, a swipe threshold crossing.
- `selection()` — a selection change (tab/segment/chip/toggle/day-picker) — lighter than an impact.
- `notify('success'|'error')` — a completed multi-step action (clock in/out, submit) or a failure.

Haptics are a **tech/native concern** (no-op on desktop web); they respect `prefers-reduced-motion` and a
future user setting, and are **additive** — a control must still be fully usable and visually animated
with haptics off. Do not fire on scroll, on every keystroke, or on background events.

## 5. Refresh rate & performance — design once, smooth at 60 AND 120

- **Refresh-rate-agnostic by construction.** Every animation is **time-based** (CSS `transition`/`@keyframes`
  with a token duration) and **GPU-composited** (`transform`/`opacity` only — never width/height/top/left,
  never JS `requestAnimationFrame` frame-counting). Such motion runs at whatever the display refreshes at:
  smooth at 60fps today, automatically smoother at 120Hz if the compositor is ever unlocked — with **zero
  rework**. A well-tuned 60fps micro-interaction already feels native and high-end; do not chase 120Hz to
  make motion feel premium — chase short durations, the right easing, and GPU-only properties.
- **120Hz reality (verified 2026):** the iOS `CADisableMinimumFrameDurationOnPhone` Info.plist key only
  unlocks 120Hz for *native* Core Animation — it has **no effect on WKWebView's web content**, which stays
  capped at 60fps even in the Capacitor build. Pushing the *web* layer to 120Hz requires a plugin using
  **private WebKit APIs** (`_setEnabled:forFeature:`), which carries **App Store review risk**. So: the PWA
  is 60fps, the native app's web content is 60fps by default, and 120Hz web is an **optional future
  exploration behind that risk — never a dependency**. Nothing in the catalog may assume >60fps.
- **Cheap or it doesn't ship** (`perf-budget.md`): durations stay short (press/selection ≤ `--motion-duration-fast`,
  page/modal ≤ `--motion-duration-base`), motion never blocks input, and never gates a spinner or refetch.

## 6. Accessibility — reduced motion is mandatory (nothing auto-skips)

Every transition (page + component + interaction) is wrapped so that under
`@media (prefers-reduced-motion: reduce)` it collapses to an **instant or opacity-only** change — no
slide, no scale, no bounce — and haptics are suppressed. This is not optional: neither the View
Transitions API nor CSS honors the preference automatically. Today's coverage is **partial** (7 blocks;
the `scale(0.97)` presses, toggles, checkbox pop, toasts, and `collChatIn` have none) — F-S2 makes it
universal by wrapping the tokenized motion once. A motion that ignores `prefers-reduced-motion` is a
review failure.

## 7. Enforcement & rollout

- `design-consistency-checker` flags: raw duration/easing literals or `@keyframes` where a motion token
  exists (the two `--transition-*` + the new `--motion-*`); a duplicated keyframe (`fadeIn`/`sheetSlideUp`
  are each defined 2–3×); a selection/tab/segment/chip that **snaps** instead of animating its indicator;
  an interactive control with no press feedback; a new page-level `entering` transition instead of the
  shared mechanism; any transition/keyframe missing its `prefers-reduced-motion` fallback; animating
  layout-triggering properties instead of transform/opacity.
- Rollout is progressive enhancement — F-S2 ships the tokens + the shared idioms and improves every page at
  once; the ad-hoc `entering` pages and inline transition-less controls (`TechDemoSheet`) are cleaned up as
  their waves (W1/W2) touch them.
