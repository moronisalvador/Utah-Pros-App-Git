# Motion & Transitions Standard

Linked from `CLAUDE.md`. **The law for how the app MOVES — page transitions, and the motion of dropdowns,
modals, sheets, toasts, and form affordances.** Born from the owner's directive that navigating between
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

## 3. Component motion (the rest of the catalog)

Each shipped by F-S2's primitives, consuming the motion tokens:
- **Dropdowns / menus / popovers:** fade + slight scale (0.96→1) from the trigger origin, `--motion-duration-fast`.
- **Modals (desktop):** overlay fades, panel fades + scales up slightly. **Sheets (mobile):** slide up from
  the bottom edge, `--motion-duration-base`, `--motion-ease-decelerate`; dismiss reverses. (Modal behavior
  itself — focus trap, ESC, scrim — is the shared `Modal` primitive; this rule governs only its motion.)
- **Toasts:** slide/fade in from the container edge; auto-dismiss fades out. **Form focus:** border/ring
  transitions on `--motion-duration-fast` (already the `.field:focus` pattern — tokenize it).

## 4. Accessibility — reduced motion is mandatory (the API does not auto-skip)

Every transition (page + component) is wrapped so that under
`@media (prefers-reduced-motion: reduce)` it collapses to an **instant or opacity-only** change — no
slide, no scale. This is not optional: the View Transitions API does **not** honor the preference
automatically. A motion that ignores `prefers-reduced-motion` is a review failure.

## 5. Enforcement & rollout

- `design-consistency-checker` flags: raw duration/easing literals or `@keyframes` where a motion token
  exists; a new page-level `entering` transition instead of the shared mechanism; a transition missing its
  `prefers-reduced-motion` fallback; animating layout-triggering properties (width/height/top) instead of
  transform/opacity.
- Rollout is progressive enhancement, so it can ship in F-S2 and improve every page at once without a
  per-page migration; the 4 ad-hoc `entering` pages are cleaned up as their waves (W1/W2) touch them.
