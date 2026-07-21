# Motion & Transitions Standard

**Last-verified: 2026-07-13** (v2 — frequency-tier reversal, exit-animation rule, `--motion-spring-in`
token, named high-craft idioms, hard reduced-motion + hover gates, the React-restart footgun, and the
gesture-surfaces §9. Sourced from the owner-approved plan review `docs/ux-plan-review-vs-skills.md` and
the craft skills it cites — `apple-design`, `emil-design-eng`, `review-animations`, `improve-animations`;
those skills are the *taste* layer, this doc + `perf-budget.md` are the *law*, §8.)

Linked from `CLAUDE.md`. **The law for how the app MOVES — page transitions, and the motion + haptics of
buttons, selections/toggles, dropdowns, modals, sheets, toasts, form affordances, and chat messages
(sent/received).** Born from the owner's directive that navigating between
screens should feel like *the system taking you there and bringing you back*, never a flashing refresh —
and that the motion "standards catalog" must be **changeable from one place later**. Owned/implemented by
the F-S2 foundation; enforced two ways — `design-consistency-checker` is the **uniformity** gate (the
token is *right*) and `review-animations` is the **feel** gate at close-out (the motion *should exist and
feels right*, `close-out-standard.md`). Companion: `perf-budget.md` (motion is cheap or it doesn't ship),
`UPR-Design-System.md` (the catalog itself).

## 1. One tunable catalog — motion lives in tokens + the design system, never per-page

All motion is defined in **two central places** and nowhere else:
- **`:root` motion tokens** in `src/index.css` — durations + easings (extends the existing
  `--transition-fast: 120ms` / `--transition-base: 200ms`):
  `--motion-duration-fast` (~120ms, hovers/toggles), `--motion-duration-base` (~200–240ms, page + modal
  transitions), `--motion-duration-slow` (~320ms, large surfaces); `--motion-ease-standard`
  (`cubic-bezier(.2,0,0,1)` — the default), `--motion-ease-decelerate` (enter), `--motion-ease-accelerate`
  (exit). Change a token → the whole app retunes. **No bespoke `120ms`/`ease-in-out`/`@keyframes` in a
  page or component where a token/standard exists** (the `design-consistency-checker` fails these).
  - **`--motion-spring-in: linear(…)` — the dep-free spring curve for non-interruptible one-shots.** A
    `linear()` easing captures ~90% of "springy" (a subtle settle / gentle overshoot) with **no JS at
    all** — for **enters only** of a *non-interruptible* one-shot: the modal pop, the toast in, the menu
    Pop-in. `src/index.css` has zero `linear()` usage today; this token is the catalogued home for it.
    Constraints (binding): it stays **OFF** money / claims / billing surfaces (the crisp-and-fast register
    — a bouncing invoice erodes trust; §5 cohesion / `review-animations` #10), and **OFF** any surface
    that becomes drag-interruptible (a real gesture wants a velocity-aware spring, not a fixed curve —
    §9). *The CSS token itself is defined once in `:root` by the sibling motion-polish PR; this catalog
    entry is its contract — point `uiModalIn` / menu-enter / toast-enter at it, nothing else.* (Source:
    apple-design `linear()`-spring takeaway + emil-design-eng "spring where it's free.")
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
- **Frequency opt-out (see §3's tier rule).** The directional push is for **genuine forward/back
  navigation**. A **high-frequency in-place control** that does not change the route — a tab / segment /
  day switch flipped tens of times a shift — is **opted OUT of `@view-transition`** and must not animate
  through the page mechanism (mark its region so it does not inherit `navigation: auto`, or drive the
  switch without a router navigation). Reserve the push for real route changes; a tech flipping the day
  view constantly waits on nothing.
- **Gesture-driven surfaces are a separate mechanism (§9).** View Transitions animate a *route change*;
  they cannot express 1:1 finger-tracked drag, velocity handoff, or grab-and-reverse. Those go through
  the scoped pointer+spring path in §9 — never a faked long CSS transition (which reads *dead*).

## 3. Component & interaction motion (the rest of the catalog)

Each shipped by F-S2's primitives, consuming the motion tokens. The app already has the right *idioms*
in places — the job is to make them uniform and token-driven, not to invent.

**Frequency tier — the first question, before "which token" (this REVERSES the old "animate every
indicator" mandate).** Match motion to how often a control is touched (`review-animations` standard #2 /
`improve-animations` frequency map). Over-motioning the high-frequency loop is the regression, not the
fix:

| Tier | Examples | Motion |
|---|---|---|
| **High-frequency** (tens of times/shift) | Clock In/Out, task-check, tab/segment/day switch, filter pill | **Instant or ≤120ms.** **Opted OUT of `@view-transition`** (§2) and **NOT required** to animate a selection indicator. *Delete-the-animation is the correct call* — a tech waiting on a slide 40×/shift is the regression. |
| **Occasional** | modal / drawer / sheet open, toast, dropdown | Standard tokenized motion (§1 durations + `--motion-spring-in` where the enter is a free one-shot). |
| **Rare / first-run** | onboarding, a completion moment | May carry a little delight. |

**⚠️ Ordering caveat (binding — do not ship the rule without the checker).** The matching
`design-consistency-checker` §9 change lands in the **same change** as this tier rule. Until it does, the
checker still *fails* an instant high-frequency segment (it flagged "a segment that snaps") — so a session
that ships the correct instant control would be **punished by CI**. Rule + checker land **together**,
never apart.

- **Buttons — press feedback (every interactive control).** The house idiom is
  `transform: scale(0.97)` on `:active` + `touch-action: manipulation` + `-webkit-tap-highlight-color:
  transparent` (already informally standard at `.tech-layout .btn:active` — index.css:4892-4895; also
  `.tech-tracker-btn`, `.coll-chat-send`). Promote it into the shared button so it is universal:
  transition `transform var(--motion-duration-fast) var(--motion-ease-standard)`, spring back on release.
  List rows may instead use the background/opacity swap they use today (that IS the standard for rows).
  **Offenders to fix:** the base `.btn` has no press feedback; `TechDemoSheet`'s inline-styled buttons
  (`:1392`) have none. On **native**, a primary/field-action press also fires a light haptic (§4).
- **Selection / toggles — animate the change on *low-frequency* surfaces; instant on high-frequency
  ones (per the tier table).** Toggle switches keep their sliding-knob + track-color transition
  (`.admin-toggle`/`.conv-dnd-toggle` — tokenize the raw `200ms ease` at index.css:513). For a
  **low-frequency** segmented control / tab / chip that changes a meaningful view, the standard is an
  **animated selection indicator** — a sliding pill or underline that moves to the chosen option, built
  with **clip-path `inset()`** on a duplicated active copy (a seamless GPU-cheap fill, §3 named idioms)
  or a cross-fade — on `--motion-duration-fast`. **But a high-frequency in-place switch** (the field-tech
  day/segment/filter flip — `.tv2-segmented`, `.ovw-seg-btn`, the `TechDemoSheet` tech-select) is
  **instant, NOT required to animate**, and the checker must **not** fail it (the frequency reversal
  above). The checkbox "pop" (`tech-check-pop`) is the reference for a selection confirming itself. On
  **native**, a selection change fires `nativeHaptics.selection()` (§4).
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
- **Every enter has an exit (`emil-design-eng`: exit ≈ 75% of the enter duration, on
  `--motion-ease-accelerate`).** A component that unmounts on close must **play its exit, not vanish** —
  an `if (!open) return null` that removes the node instantly is a **defect** (the panel pops out of
  existence; the sheet that slid up disappears). Add a `--closing` state, run the exit (the reverse of the
  enter, ~75% of its duration, on the **accelerate** easing), and unmount on `animationend`. Modals
  fade + scale down; sheets slide back to the bottom edge; dropdowns/toasts reverse their enter. This is
  also what finally **consumes `--motion-ease-accelerate`** — the token exists for exits and is unused
  today.
- **Named high-craft idioms (REQUIRED — not a vague "animate the indicator").** Use the specific,
  high-feel-per-line technique, not an approximation (sources: `apple-design`, `emil-design-eng`,
  `review-animations`, `impeccable`; the catalog itself lives in `UPR-Design-System.md`):
  - **Origin-aware menus / dropdowns / popovers** — set `transform-origin` from the trigger's rect so the
    menu grows *out of* its button, not from center. **Modals are the exception** — they appear centered,
    keep `transform-origin: center`.
  - **`@starting-style` toasts** — enter from the container edge via `@starting-style` on a *transition*
    (retargets / interruptible when a second toast arrives), never a `@keyframes` that restarts from zero.
  - **clip-path `inset()` segmented-control fill** — the seamless active-fill move (above) on a duplicated
    clipped copy, instead of a hard background swap.
  - **Materialize** — a surface that reads as *glass forming*: co-animate `backdrop-filter` blur **and**
    `transform: scale()` / opacity together on enter (never blur alone). Keep blur ≤ ~14–20px — a heavier
    backdrop-filter is a WKWebView scroll-jank + Safari cost (`perf-budget.md`; the `.tech-nav` `blur(20px)`
    is an owner on-device measurement item).
  - **Typography tracking tokens** — `--track-display` (~`-0.02em`) tightens large display text, body stays
    ~`0`, and `font-optical-sizing: auto` lets the face adapt across sizes. Tracking earns its place in the
    catalog because it is a per-line craft win, tokenized like the rest.
- **Toasts:** slide/fade in from the container edge (via `@starting-style`, above); auto-dismiss fades
  out (its exit, per the exit rule). **Form focus:** border/ring transitions on `--motion-duration-fast`
  (already the `.field:focus` pattern — tokenize it).

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

## 6. Accessibility — reduced motion + hover gating are HARD requirements (nothing auto-skips)

These are **hard failures** in the checker (blocker/major), not advisories — the same components ship to
desktop **and** the touch PWA, so getting them wrong misbehaves on real devices, not just aesthetically.

- **`prefers-reduced-motion` fallback is mandatory on every transition / keyframe.** Under
  `@media (prefers-reduced-motion: reduce)` motion collapses to an **instant or opacity-only** change — no
  slide, no scale, no bounce — while the **end-state still lands** (reduced ≠ broken; keep transitions that
  aid comprehension, drop movement) and haptics are suppressed. Neither the View Transitions API nor CSS
  honors the preference automatically. Today's coverage is **partial** (7 blocks; the `scale(0.97)` presses,
  toggles, checkbox pop, toasts, and `collChatIn` have none) — F-S2 makes it universal by wrapping the
  tokenized motion once. A motion with no reduced-motion fallback is a **review failure**.
- **Every shared-component `:hover` transform is gated behind `@media (hover: hover) and (pointer:
  fine)`.** An ungated `:hover` transform fires a **false hover on a tap** (the control jumps under the
  finger on the touch PWA). Ungated hover motion is a **review failure**.

## 7. Enforcement & rollout

- **`design-consistency-checker` §9 flags (v2 — the checker change ships WITH the §3 tier rule, never
  after):** raw duration/easing literals or `@keyframes` where a motion token exists (the two
  `--transition-*` + the `--motion-*` + `--motion-spring-in`); a duplicated keyframe
  (`fadeIn`/`sheetSlideUp` are each defined 2–3×); a **low-frequency** selection/tab/segment/chip that
  **snaps** instead of animating its indicator — **but an instant high-frequency control (clock in/out,
  task-check, day/segment/filter flip) is CORRECT and must NOT be failed** (the frequency reversal, §3);
  an interactive control with no press feedback; a new page-level `entering`/`requestAnimationFrame(
  setEntering)` transition instead of the shared View Transitions mechanism; **a component that unmounts on
  close with no exit animation (`if (!open) return null`)** (§3 exit rule); **`ease-in` on a UI
  interaction, a UI duration > 300ms with no stated reason, or symmetric enter/exit timing on a
  press/hold** (`review-animations` #3/#4/#9); animating layout-triggering properties (width/height/top/
  left) instead of transform/opacity.
- **HARD failures (blocker/major, not advisory — §6):** a transition/keyframe **missing its
  `@media (prefers-reduced-motion: reduce)` fallback**; a shared-component **`:hover` transform not gated
  behind `@media (hover: hover) and (pointer: fine)`**.
- **React animation-restart footgun (the #1 silent motion bug).** A component **defined inline inside
  another** component's body, or rendered under an **unstable list `key`**, remounts on every parent render
  — which **restarts its animation from zero and drops focus / scroll** mid-interaction. Two rules the
  checker flags: (a) an animated component defined inline in another component — **hoist it to module
  scope**; (b) a **high-frequency motion value held in `useState`** (a drag offset, a per-frame transform)
  — a state write re-renders every frame, so the value lives in a **`ref` written straight to
  `node.style.transform`** (the vercel React rule + the STANDARDS "CSS-var-on-parent per-frame" trap, §9).
  `useState` is for discrete UI state, never for a value that changes every animation frame.
- Rollout is progressive enhancement — F-S2 ships the tokens + the shared idioms and improves every page at
  once; the ad-hoc `entering` pages and inline transition-less controls (`TechDemoSheet`) are cleaned up as
  their waves (W1/W2) touch them.

## 8. Two surfaces, one motion system — where each layer actually works (verified 2026-07-13)

UPR ships to **three iOS surfaces that all run the same system WebKit**: Safari tab, home-screen PWA
(standalone), and the Capacitor app (WKWebView). Because the engine is shared, web capabilities are
version-gated *identically* across all three — the split is not "web vs native", it is **which layer of
the feel each surface can render**:

| Layer | iOS Safari | Home-screen PWA | Capacitor app |
|---|---|---|---|
| **Visual motion** — View Transitions (`startViewTransition`, same-document) + CSS motion tokens | ✅ iOS 18.0+ | ✅ iOS 18.0+ | ✅ iOS 18.0+ |
| **Haptics** — Taptic via `@capacitor/haptics` | ❌ no-op | ❌ no-op | ✅ works |

- **View Transitions are cross-surface, not native-only.** The React-Router route change is *same-document*,
  so the floor is **iOS 18.0** (the `@view-transition { navigation: auto }` at-rule is the cross-document/MPA
  form and needs 18.2); everywhere below 18.0 it degrades to instant navigation (§2). `navigator.vibrate()`
  has **never** been implemented in WebKit, so the `nativeHaptics.js` web fallback is a genuine no-op on
  Safari **and** the PWA — not just "desktop web" as §4 puts it.
- **Design implication (the load-bearing rule):** on the web/PWA surface the **visual motion carries the
  entire feel**, because there is no haptic reinforcement to lean on. So easing quality, duration, origin,
  and interruptibility matter *more* there, not less. Haptics stay **strictly additive** (§4) — a native-app
  bonus, never a crutch the visual design depends on. Never gate comprehension or feedback on a haptic tick.
- **Taste / review layer (advisory skills, not a rule change):** the Emil Kowalski pack
  (`.claude/skills/{emil-design-eng,apple-design,improve-animations,review-animations,animation-vocabulary}`)
  is the sanctioned *how-should-this-feel* reference — use `improve-animations` for a motion audit and
  `review-animations` before merging motion work; `apple-design` for gesture/sheet fluidity. It is
  **subordinate to this doc and `perf-budget.md`**: its CSS/WAAPI-first guidance fits UPR's dependency-free
  stance, but its spring/`Motion`-library suggestions are **not** licence to add `framer-motion`/`gsap` —
  a JS motion dependency needs an explicit `perf-budget.md` justification (entry-JS ≤ 232 KB gz) and, if
  ever adopted, must be route-lazy and scoped to a genuinely gesture-driven surface. View Transitions +
  CSS tokens remain the mechanism.

## 9. Gesture surfaces — the honest CSS ceiling and the one sanctioned path

View Transitions + CSS tokens carry ~90% of the feel (§2/§3). This section is the other 10%: **physical,
finger-driven drag**, and the deliberate boundary around it.

**The honest ceiling — what CSS genuinely cannot do.** A CSS `transition`/`@keyframes` always restarts
from zero velocity over a fixed duration. It **cannot** express: 1:1 finger-tracked drag from the grab
offset, **velocity handoff** on release, **grab-and-reverse** interruptibility, **momentum projection** on
a flick, or custom rubber-banding. Faking momentum with a long transition reads *dead* — worse than
shipping nothing (`apple-design` "direct manipulation" / `review-animations` "interruptibility"). On pure
CSS this caps the bottom sheets (`PhotoNoteSheet`, `ClockSupersedeSheet`, the mobile `.ui-modal` @768px),
`PullToRefresh.jsx`, and swipe-to-dismiss at "good, not alive."

**The sanctioned path (owner decision 2026-07-13 — option C, the middle path; the library ban stays).**
1. **Native scroll first.** Native overflow scroll gives momentum + rubber-banding **for free** — use it
   before any custom gesture, and **cut** a non-native swipe affordance rather than ship a canned one.
2. **A scoped, dependency-free pointer + rAF spring util** for a **small** set of genuinely drag-driven
   surfaces **only**: the mobile **bottom-sheet drag-to-dismiss**, **`PullToRefresh`**, and
   **swipe-to-dismiss toast** — **and nothing else**. ~1–2 KB, **route-lazy**, well inside the
   `perf-budget.md` 232 KB entry budget. Pattern: `setPointerCapture` once dragging starts; velocity from a
   short pointer history; dismiss on `|dist| / elapsed > ~0.11` (a flick suffices — do not require a
   distance threshold); ignore extra touch points after the drag begins; on release **hand the settle /
   fling-out to a CSS transition**.
3. **`element.animate()` (WAAPI) is the dep-free escape hatch** for a *dynamic, JS-computed one-shot* — a
   value known only at runtime (hardware-accelerated, interruptible, no library). The framer-motion ban is
   **not** "no JS motion at all."
4. **The per-frame trap (binding).** Write `node.style.transform` **on the moving node** each frame. Never
   set a CSS variable on a *parent* to drive a child transform (it recalcs styles for every child — a
   recalc storm), and never drive a per-frame value through `useState` (§7).

**The library ban stays (do not touch it).** No Framer Motion / GSAP / react-spring in the entry graph
(`perf-budget.md`; ~40 KB gz ≈ 17% of the JS budget on an LTE field tool). If scope ever genuinely widens
beyond the ≤3 surfaces, the **only** sanctioned escalation is **Motion One (~5 KB)** — route-lazy, scoped,
and only with an explicit `perf-budget.md` justification first; never a default.

**Reconcile the drag that already ships — this is NOT greenfield.** Two live surfaces already carry drag,
and the scoped-util work must account for both, not pretend the ≤3 targets are the only gesture code:
- **Dashboard widgets** already use **`react-grid-layout`** (a gesture-capable dep the app *already*
  bundles, which gives free momentum/rubber-band for its draggables) — **prefer its built-in drag
  behavior** for anything grid-like; do not reinvent it with the util.
- **CrmLeads kanban** carries **ad-hoc touch-drag** — a session touching it either **folds it into the
  scoped util** or **consciously leaves it as-is with a disclosed note**.

Each gesture surface ships with its own **owner on-device iPhone gate.** Playwright can *simulate* the
pointer sequence to prove a drag-to-dismiss lands past threshold, but it runs Chromium and **cannot tell
you the fling feels native** (`close-out-standard.md` motion-verification caveat).
