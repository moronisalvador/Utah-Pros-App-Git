---
paths: ["src/**"]
---
# Motion & Transitions Standard

**Last-verified: 2026-07-29** (compressed from the 2026-07-13 v2 — every binding constraint kept,
narrative history removed; prior text in git history. Taste layer: the `apple-design` /
`emil-design-eng` / `review-animations` skills — advisory, subordinate to this doc and
`perf-budget.md`. Catalog: `UPR-Design-System.md`. Uniformity gate: `design-consistency-checker`;
feel gate at close-out: `review-animations`.)

## 1. One tunable catalog — tokens, never per-page values

- `:root` tokens in `src/index.css`: `--motion-duration-fast` (~120ms, hovers/toggles),
  `--motion-duration-base` (~200–240ms, page/modal), `--motion-duration-slow` (~320ms, large
  surfaces); `--motion-ease-standard` (`cubic-bezier(.2,0,0,1)`, default), `--motion-ease-decelerate`
  (enter), `--motion-ease-accelerate` (exit); plus legacy `--transition-fast: 120ms` /
  `--transition-base: 200ms`. No bespoke duration/easing/`@keyframes` where a token exists.
- `--motion-spring-in: linear(…)` — dep-free spring for **enters of non-interruptible one-shots
  only** (modal pop, toast in, menu pop-in). **Never** on money/claims/billing surfaces (crisp
  register — a bouncing invoice erodes trust) and **never** on a drag-interruptible surface (§6).
- Retuning a category = editing its one entry in `UPR-Design-System.md`'s Motion section.

## 2. Page transitions

- **Native View Transitions API only** (no framer-motion/react-spring/gsap). Same-document floor is
  iOS 18.0; unsupported browsers degrade to instant navigation. Wire globally:
  `@view-transition { navigation: auto; }` + React Router `<Link viewTransition>` /
  `useViewTransitionState`. Ad-hoc per-page `entering`/`requestAnimationFrame(setEntering)`
  patterns are retired — new ones are a review failure.
- **Directional:** forward enters from the leading edge; Back reverses. Direction comes from a
  nav-direction signal (history index / router state), never per-page guesses. The app shell
  (nav/headers) carries a persistent view-transition name so only the content region animates.
- Transitions animate **transform/opacity only**, ≤ `--motion-duration-base`, never block input,
  never gate a spinner, and **never re-run a page's `load()`**.
- **High-frequency in-place controls (tab/segment/day/filter switches) are opted OUT of
  `@view-transition`** — reserve the push for real route changes.
- Finger-driven drag is a separate mechanism (§6) — never a faked long CSS transition.

## 3. Component motion

**Frequency tier is the first question** (this reversed the old "animate every indicator" mandate):

| Tier | Examples | Motion |
|---|---|---|
| High-frequency (tens/shift) | Clock In/Out, task-check, tab/segment/day/filter | **Instant or ≤120ms; deleting the animation is correct.** Checker must NOT fail an instant high-frequency control. |
| Occasional | modal/drawer/sheet, toast, dropdown | Standard tokens (+ `--motion-spring-in` where the enter is a free one-shot) |
| Rare / first-run | onboarding, completion moments | May carry delight |

- **Press feedback (every interactive control):** `transform: scale(0.97)` on `:active` +
  `touch-action: manipulation` + transparent tap highlight; transition on
  `--motion-duration-fast`/`--motion-ease-standard` (house idiom: `.tech-layout .btn:active`,
  index.css:4892-4895). List rows may keep their background/opacity swap.
- **Toggles:** sliding knob + track-color transition, tokenized. **Low-frequency**
  segments/tabs/chips animate their selection indicator (sliding pill/underline via clip-path
  `inset()` on a duplicated active copy, or cross-fade) on `--motion-duration-fast`;
  **high-frequency ones stay instant** per the tier table. Checkbox reference: `tech-check-pop`.
- **Chat:** sent bubble rises from the composer edge (translateY+fade); incoming fades+scales
  0.98→1; both on `--motion-duration-base`/`--motion-ease-decelerate` (reference `collChatIn`,
  index.css:8104). Optimistic pending→sent is a smooth opacity/check transition; reconciling the
  optimistic bubble must not reflow or re-animate.
- **Dropdowns/menus/popovers:** fade + scale 0.96→1 from the trigger origin,
  `--motion-duration-fast`. **Modals (desktop):** overlay fade, panel fade+slight scale, centered
  origin. **Sheets (mobile):** slide from bottom on `--motion-duration-base`/decelerate.
- **Every enter has an exit** — ~75% of the enter duration on `--motion-ease-accelerate`; a
  component that unmounts instantly on close (`if (!open) return null`) is a defect: add a
  `--closing` state and unmount on `animationend`.
- **Named idioms (use the specific technique):** origin-aware menus (`transform-origin` from the
  trigger rect; modals stay centered); `@starting-style` toasts on a *transition* (interruptible,
  never a restarting keyframe); clip-path `inset()` segmented fill; **materialize** = co-animate
  `backdrop-filter` blur + scale/opacity, blur ≤ ~14–20px (WKWebView jank above); typography
  tokens `--track-display` (~`-0.02em`) + `font-optical-sizing: auto`.
- **Form focus:** border/ring on `--motion-duration-fast`.

## 4. Haptics (native-only bonus, never a crutch)

Use `src/lib/nativeHaptics.js` only — `impact('light')` for press/send/threshold, `selection()`
for selection changes, `notify('success'|'error')` for completed multi-step actions or failures.
No-op on Safari/PWA (`navigator.vibrate` was never implemented in WebKit), so **visual motion must
carry the entire feel on web** — haptics are strictly additive. Respect reduced-motion. Never fire
on scroll, keystrokes, or background events.

## 5. Performance & accessibility (HARD gates)

- **Time-based + GPU-composited only** (`transform`/`opacity`; never width/height/top/left, never
  rAF frame-counting). WKWebView web content is capped at 60fps (the 120Hz Info.plist key affects
  native CA only; private-API unlocks are App Store risk) — nothing may assume >60fps.
- **`prefers-reduced-motion` fallback is mandatory on every transition/keyframe** — collapse to
  instant/opacity-only, end-state still lands, haptics suppressed. Neither View Transitions nor
  CSS honors it automatically. Missing fallback = review failure (blocker/major).
- **Every shared-component `:hover` transform is gated** behind
  `@media (hover: hover) and (pointer: fine)` — ungated hover fires false hovers on tap. Review
  failure.
- **React restart footgun:** an animated component defined inline in another component's body, or
  under an unstable list `key`, remounts and restarts its animation — hoist to module scope. A
  per-frame motion value never lives in `useState` — use a ref written straight to
  `node.style.transform` (a state write re-renders every frame).

## 6. Gesture surfaces — the CSS ceiling and the one sanctioned path

CSS cannot express 1:1 finger-tracked drag, velocity handoff, grab-and-reverse, momentum, or
rubber-banding — faking momentum with a long transition reads dead. The sanctioned path (owner
decision 2026-07-13):

1. **Native scroll first** — it gives momentum + rubber-band free; cut a non-native swipe rather
   than ship a canned one.
2. **One scoped dep-free pointer+rAF spring util** for exactly: bottom-sheet drag-to-dismiss,
   `PullToRefresh`, swipe-to-dismiss toast — nothing else. Route-lazy, ~1–2 KB.
   `setPointerCapture` on drag start; velocity from a short pointer history; dismiss on
   `|dist|/elapsed > ~0.11`; ignore extra touch points; hand the settle/fling-out to a CSS
   transition on release.
3. **`element.animate()` (WAAPI)** is the dep-free escape hatch for a JS-computed one-shot.
4. **Per-frame trap:** write `node.style.transform` on the moving node — never a CSS var on a
   parent (recalc storm), never `useState` per frame.

**Library ban stays:** no Framer Motion/GSAP/react-spring. If scope genuinely widens beyond the
three surfaces, the only sanctioned escalation is Motion One (~5 KB), route-lazy, with an explicit
`perf-budget.md` justification first. Existing drag to reconcile, not reinvent: Dashboard widgets
already use `react-grid-layout` (prefer its built-in drag); CrmLeads kanban's ad-hoc touch-drag is
either folded into the util or consciously left with a disclosed note. Every gesture surface ships
with an owner on-device iPhone gate (Playwright proves behavior, not feel).

## 7. Checker flags (design-consistency-checker §9)

Raw duration/easing/`@keyframes` where a token exists; duplicated keyframes; a **low-frequency**
selection control that snaps (an instant **high-frequency** control is CORRECT — never fail it);
an interactive control with no press feedback; a new page-level `entering` transition instead of
View Transitions; unmount-on-close with no exit; `ease-in` on a UI interaction; a UI duration
> 300ms with no stated reason; symmetric enter/exit on press/hold; animating layout properties.
HARD failures: missing reduced-motion fallback; ungated hover transform (§5).
