# UPR Platform — Design System Reference
**Last updated:** August 14, 2026 (Motion Catalog gains the field-tech hand-rolled sheet row — the `useSheetClosing` + `useDialogLifecycle` hook pair and `.tech-sheet-*` classes). **Prior:** July 24, 2026 (reconciled touch-target, motion-frequency, toast, and cross-runtime guidance with the specialized project standards). **Prior material update:** July 13, 2026 UX-Quality F-S2 minted the semantic token family and motion catalog, added `@/components/ui`, the Kit Registry and dark-theme contract, and deleted the contradictory inline-hex Status Color Palette recipe.
**For:** Claude Code and Codex — read this before building any new page, component, or modal.

This document reflects the actual UI patterns extracted from the live codebase. Follow these patterns exactly. Do not invent new layouts, colors, or component structures — match what already exists.

> **Reach for a shared primitive before a style object.** Every visual pattern below that has a
> component in `@/components/ui` (Modal, StatusPill, EmptyState, ErrorState, PageHeader, SearchInput,
> IconButton, SkeletonBlock) shows the **import**, not the inline styles — inline recipes are how 1,644 hardcoded hex
> and 158 duplicate status pills happened. Colors come from **tokens** (`var(--…)`) only, so light/dark
> and any future re-tone are a one-place change (the **Dark-theme contract** section is the law).

**Three design systems currently coexist.** Most of the app (Customers, Jobs, Claims, Admin, Settings, JobPage/CustomerPage tabs) uses the tokens/classes below. Two newer, deliberately page-scoped systems have since grown up alongside it — **not drift, but not merged in either**:
- **Collections Kit** (§ below) — Collections/AR, Time Tracking, Invoice Editor, Estimate Editor
- **Overview Kit** (§ below) — Dashboard/home only
- **Tech Mobile token layer** (§ "Tech Mobile token layer" below) — the field-tech app
  (`.tech-layout`-scoped `--tech-*` / `--status-*` tokens; v2 adds `tv2-*` classes)

Building in one of those areas? Use that section, not the tokens below. Building anywhere else? Use the tokens below, as always.

---

## Core Principles

- **Dense and functional.** This is an internal tool for field techs and admins. No decorative elements.
- **Mobile-first.** Every page must work on iPhone. Field techs use this on-site.
- **Consistent.** Every page follows the same header → filters → content → empty state pattern.
- **CSS variables only.** Never hardcode colors or spacing. Always use `var(--token)`.
- **Touch-friendly.** Interactive hit areas are at least 44px on touch/mobile surfaces. Technician
  primary actions are at least 48px; the documented technician-secondary exception is 44px. Compact
  desktop controls may render smaller only when they are not the touch target.

---

## Design Tokens

### Colors
```css
/* Backgrounds */
--bg-primary: #ffffff
--bg-secondary: #f8f9fb      /* page background, section backgrounds */
--bg-tertiary: #f1f3f5       /* hover states, tags, secondary fills */
--bg-elevated: #ffffff

/* Borders */
--border-color: #e2e5e9      /* standard border */
--border-light: #f0f1f3      /* subtle dividers inside cards */

/* Text */
--text-primary: #111318      /* headings, primary content */
--text-secondary: #5f6672    /* labels, secondary content */
--text-tertiary: #8b929e     /* placeholders, timestamps, metadata */
--text-inverse: #f1f5f9      /* text on dark backgrounds */

/* Accent (primary blue) */
--accent: #2563eb
--accent-hover: #1d4ed8
--accent-light: #eff6ff      /* accent tint backgrounds */
--accent-text: #ffffff

/* Status colors */
--status-needs-response: #ef4444
--status-needs-response-bg: #fef2f2
--status-waiting: #f59e0b
--status-waiting-bg: #fffbeb
--status-resolved: #10b981
--status-resolved-bg: #ecfdf5
--status-active: #3b82f6
--status-active-bg: #eff6ff
```

### Semantic status tokens — the ONLY way to color a status *(Last-verified: 2026-08-08 · original 2026-07-13, F-S2)*
The old inline-hex "Status Color Palette" recipe was **deleted** — it prescribed copy-pasting
`bg/color/border` triplets, which contradicted the "no hardcoded colors" rule and produced ~727 of the
1,644 hex literals in the app. The values were minted into `:root` tokens (grep-verified as the dominant
in-code triplets) and are the single source now. Each is a full triplet — foreground + `-bg` + `-border`:

```css
--success  #16a34a   --success-bg  #f0fdf4   --success-border  #bbf7d0   /* paid, active, approved, linked */
--danger   #dc2626   --danger-bg   #fef2f2   --danger-border   #fecaca   /* error, urgent, overdue, failed */
--warning  #d97706   --warning-bg  #fffbeb   --warning-border  #fde68a   /* pending, waiting, draft, dev-only */
--info     #2563eb   --info-bg     #eff6ff   --info-border     #bfdbfe   /* info, in-progress, scheduled */
--neutral  #6b7280   --neutral-bg  #f1f3f5   --neutral-border  #e5e7eb   /* inactive, closed, default, paused */
```

**For TEXT sitting on the matching tint, use `--danger-on-bg` / `--info-on-bg` / `--neutral-on-bg`**
(added 2026-08-08). They equal the base token in light, and lighten in the tech dark theme because
`#dc2626` / `#2563eb` / `#6b7280` cannot reach AA on *any* dark background. Keep the **base** token for
a saturated FILL carrying white text — it needs the darker value. `--success` / `--warning` need no
variant. `StatusPill` already does this for you; the distinction only matters if you are hand-rolling.
Full measurements and the rationale: **Dark-theme contract** below.

**Never hand-build a status badge.** Use the primitive, which reads these tokens (so dark mode + a
re-tone are a one-place change):

```jsx
import { StatusPill } from '@/components/ui';

<StatusPill status="paid" />              {/* classifies "paid" → success tone automatically */}
<StatusPill status="overdue" dot />       {/* leading status dot */}
<StatusPill tone="warning" label="Draft" /> {/* pass an explicit tone when the word is ambiguous */}
```

`StatusPill` classifies the status string into one of the five tones via `toneForStatus()`
(`@/components/ui/statusTone`); pass an explicit `tone` to override. Legacy `.status-badge` /
`.status-needs-response` classes still exist for the shell, but new code uses `StatusPill`.

> Purple (`#7c3aed`, feature flags / schedule mode) is a **one-off accent**, not a status tone — it has
> no semantic token because it isn't a status. Keep it inline where it's genuinely a brand accent, or add
> a named `--accent-*` token if it starts repeating.

### Division Colors *(Last-verified: 2026-07-13 — regenerated from `DivisionIcons.jsx` `DIVISION_CONFIG`)*
**`src/components/DivisionIcons.jsx` is the source of truth.** Import, never hardcode:
`import { DIVISION_COLORS, DIVISION_CONFIG, DivisionIcon } from '@/components/DivisionIcons'`.

| Division | `color` | `bg` | Label |
|---|---|---|---|
| water | `#1d4ed8` | `#dbeafe` | Water |
| mold | `#7e22ce` | `#f3e8ff` | Mold |
| reconstruction | `#b45309` | `#fef3c7` | Reconstruction |
| remodeling | `#c0432a` | `#fdece8` | Remodeling |
| fire | `#b91c1c` | `#fee2e2` | Fire |
| contents | `#047857` | `#d1fae5` | Contents |
| general | `#475569` | `#f1f5f9` | General |

`DIVISION_COLORS` is the flat `{ division: color }` convenience map; `DIVISION_CONFIG` carries
`{ color, bg, label }`. `LOSS_CONFIG` (same file) maps loss types (water/fire/mold/storm/sewer/
vandalism/other). The `.division-badge[data-division="…"]` CSS classes exist for markup that can't reach
JS, but they drift from `DIVISION_CONFIG` (e.g. mold badge CSS `#9d174d` vs config `#7e22ce`) — prefer
the JS config + `DivisionIcon`. **Collections Kit uses a DIFFERENT division palette** (`collTokens.DIV_COLOR`)
— see Known Inconsistencies.

### Phase/Status Colors
Used consistently across Jobs, Production, CustomerPage, JobPage:
```js
// Red — urgent
lead, emergency_response, job_received: bg #fef2f2 / #fff7ed, color #ef4444 / #ea580c

// Yellow — pending / waiting
estimate_submitted, supplement_*, waiting_*: bg #fffbeb, color #d97706

// Blue — active work
mitigation_*, drying, monitoring, reconstruction_in_progress: bg #eff6ff, color #2563eb

// Green — complete
completed, estimate_approved, work_authorized, paid: bg #ecfdf5, color #10b981 / #059669

// Gray — neutral / closed
closed, on_hold, cancelled: bg #f1f3f5, color #6b7280
```

### Typography
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--font-mono: 'JetBrains Mono', 'Fira Code', monospace

--text-xs:   11px   /* labels, badges, metadata, uppercase section headers */
--text-sm:   13px   /* body text, table rows, card content */
--text-base: 14px   /* default, card titles */
--text-lg:   16px   /* modal titles, section headers */
--text-xl:   18px   /* page subheadings */
--text-2xl:  22px   /* page titles */
```

**Typography floor (hard rule):** **11px is the absolute minimum** anywhere; **12px minimum for any
actionable text** on the tech surface (a tappable label/chip/button) — a gloved hand in sunlight can't
read smaller (`tech-mobile-ux.md`). Mobile inputs stay **16px** (the `.input` class enforces it — iOS
auto-zooms below 16px). Never set a font-size below these.

### Spacing
```css
--space-1: 4px   --space-2: 8px   --space-3: 12px
--space-4: 16px  --space-5: 20px  --space-6: 24px  --space-8: 32px
```

### Radius
```css
--radius-sm: 4px   --radius-md: 6px   --radius-lg: 8px
--radius-xl: 12px  --radius-full: 9999px
```

### Shadows
```css
--shadow-xs: 0 1px 2px rgba(0,0,0,0.04)
--shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04)
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.04)
```

> **Motion** is its own standard — see `.claude/rules/motion-standard.md` (the law) and the Motion
> catalog the UX-Quality **F-S2** foundation adds to this doc (`--motion-duration-*` /
> `--motion-ease-*` tokens + per-primitive recipes, enforced by `design-consistency-checker`).

---

## Kit Registry — which system a surface uses *(Last-verified: 2026-07-23)*

Four visual systems coexist **by design**. Pick the one that owns the surface you're building; never mix
their tokens/components. Full details are in each system's section below.

| Kit | Scope | Tokens source | Components | Notes |
|---|---|---|---|---|
| **Main / Shared** | Customers, Jobs, Claims, Admin, Settings, JobPage/CustomerPage tabs, everything not below; includes the Admin Mobile `.am-*` composition under `/tech/admin/*` | `:root` tokens in `index.css` (`--bg-*`, `--text-*`, `--accent`, `--success/--danger/…`, `--space-*`, `--radius-*`, `--motion-*`) | `@/components/ui` (Modal, StatusPill, EmptyState, ErrorState, PageHeader, SearchInput, IconButton, SkeletonBlock) + the `.btn`/`.card`/`.input` utility classes + `src/components/admin-mobile/**` | The default. Admin Mobile is a responsive Main composition, not a fifth kit. New pages use this unless they live in a kit below. |
| **Collections Kit** | Collections/AR, Time Tracking, Invoice/Estimate editors | `collTokens.js` (page-scoped hex — a DIFFERENT green/red than `--success`/`--danger`) | `collKit.jsx` (`CollCard`, `SegControl`, `Kpi`, `PopoverButton`, `StatusBadge`, `Pill`, …), `.coll-*` CSS | Page-scoped; do NOT import into unrelated pages. |
| **Overview Kit** | Dashboard/home only | `overview/tokens.js` (dashboard-scoped) | `Card.jsx`/`Widgets.jsx` + `react-grid-layout`, `.ovw-*` CSS | Dashboard only. |
| **Tech Mobile** | `src/pages/tech/**`, `src/components/tech/**`, except `/tech/admin/*` pages consuming `src/components/admin-mobile/**` | `--tech-*` + `--status-*` tokens scoped on `.tech-layout`; v2 adds `tv2-*` classes | tech + tech-v2 primitives (`StatusChip`, `ApptListRow`, `TechPane`, skeletons) | Dark-mode capable (see Dark-theme contract). Status owns the color channel. |

The `@/components/ui` primitives + `:root` tokens are the **shared** layer the Main kit uses and the
others may consume where it fits (e.g. `useResumeRefetch`, `Modal`). The three page-scoped kits keep
their own palettes deliberately (each `tokens.js` says so in a comment) until an app-wide rollout decision.

### Admin Mobile financial documents *(D2 source — repository-only / unpublished)*

`/tech/admin/*` financial-document pages use the light Main/Shared `.am-*` composition and the shared
document building blocks in `src/components/admin-mobile/document/**`. This is not a Collections surface
and does not introduce a hero or a separate visual kit.

- Keep document sections open: customer/status context, totals, details, lines, and available actions
  remain visible in their page order rather than moving document work behind accordions.
- Use `DocumentLineList` for the document rows. Editable lines are descriptive route links to the focused
  line editor; read-only lines remain plain rows, and an empty document uses the shared `EmptyState`.
  `DocumentLineEditor` keeps line fields in a form, but its explicit save button is the only save action.
- Preserve the feedback distinction: compact document controls use the standard pressed scale treatment
  (and supported haptic feedback); full-width line rows acknowledge press with their row-background state
  instead of shrinking like a button.
- `AdminMobilePage` places keyboard focus on the route heading once for each route entry without scrolling,
  so a line-editor transition has a clear destination while refreshes do not steal focus.

These statements describe checked-in D2 source only. They are not evidence of a deployed web release,
installed iOS build, or signed-device validation.

## Dark-theme contract *(Last-verified: 2026-08-14 · prior 2026-08-08 · prior 2026-07-30 · original 2026-07-13, F-S2)*

- **Every scope that re-points `--text-primary` MUST also declare `color: var(--text-primary)` in
  the same block.** Re-pointing the token alone is not enough. `body` declares
  `color: var(--text-primary)` but sits OUTSIDE every themed scope, so that `var()` resolves against
  the `:root` LIGHT value and the resulting **computed** colour — not the variable — inherits down.
  A descendant with its own `color: var(--token)` rule is fine (it resolves inside the scope); one
  that declares no colour renders in the palette from outside it. Measured before this was closed
  on 2026-08-14: `.conv-compose-input` **1.04:1**, `.tv2-msgs-thread .message-bubble` 1.02:1,
  `.tech-settings-row` 1.04:1, and `.crm-roadmap-page.dark` body text 1.10:1 on the PUBLIC `/status`
  page — near-black on near-black. 2,077 element probes improved when the four scopes were aligned.
  The four scopes today: `:root` (resolved by `body`, the base case),
  `[data-theme="dark"] .tech-layout`, `.am-page, .am-send-sheet`, and `.crm-roadmap-page.dark`.
  **`tests/qa/unit/theme-scope-color-resolution.test.js` parses the stylesheet and fails on any new
  scope that breaks this**, so the rule holds itself rather than depending on memory.
- **Dark mode is live only on the tech shell.** `ThemeContext` stamps `data-theme="dark"` on `<html>`;
  the CSS block `[data-theme="dark"] .tech-layout { … }` re-points the core tokens (`--bg-*`, `--text-*`,
  `--accent-light`, the `--status-*` tints, and the F-S2 semantic `--*-bg`/`--*-border` tints). The desktop
  office app is light-only today.
- **Admin Mobile exception:** `/tech/admin/*` is a Main/Shared `.am-*` composition inside the tech
  route shell. It is captured and accepted light-only until its `.am-*` tokens receive a separately
  reviewed dark-theme contract; the surrounding tech shell may be dark without making the admin
  content a Tech Mobile surface.
- **The contract: components consume color ONLY through `var(--token)`.** A component that reads a token
  goes dark for free when the token is re-pointed; a component with an inline hex does not (and becomes a
  dark-mode bug). This is *why* `StatusPill` reads `--success`/`--danger`/… instead of the old inline
  triplet — dark is a token swap, never a per-badge edit. Any new hex on the tech surface is a defect
  (the audit found ~297 tech-surface hex literals W1 migrates to `var(--status-*)`).
- **Foreground + border keep their hue in dark; only the tinted background darkens** — that's how the
  `-bg`/`-border` overrides in the tech dark block are toned. Don't invert a status color for dark.
  **Amended 2026-08-08 — hue is kept, but LIGHTNESS moves for three tokens.** Measured: `--danger`
  `#dc2626`, `--info` `#2563eb` and `--neutral` `#6b7280` land at **3.52 / 3.04 / 3.41 : 1** on their own
  dark tints, and they **cannot** reach 4.5:1 on *any* dark background — their ceiling against pure black
  is 4.35 / 4.06 / 4.34. No amount of darkening the tint fixes it; the foreground itself has to lighten.
- **`--danger-on-bg` / `--info-on-bg` / `--neutral-on-bg` — use these for TEXT on the matching tint.**
  They equal the base token in light and lighten along the same hue in dark (`#e35151` / `#5787f0` /
  `#818793`), bringing all five dark tones to **4.50–4.79 : 1**. **Keep the base `--danger`/`--info`/
  `--neutral` for a saturated FILL**, which carries white text and needs the darker value — re-pointing
  the base token instead would have fixed the pill and broken every filled Delete button (white-on-danger
  drops 4.83 → 3.78). One token cannot serve both roles; that is why this is a separate token, not an
  override. `--success`/`--warning` already pass in dark and are unchanged. `.ui-status-pill` consumes
  these automatically; an inline `color: var(--danger)` on `var(--danger-bg)` should move to
  `var(--danger-on-bg)` as those sites are touched.
- **LIGHT mode is still unfixed and is deliberately out of scope here** — `success` 3.15, `warning` 3.07,
  `neutral` 4.35 and `danger` 4.41 all fail AA against their own light tints. Fixing that means re-toning
  `:root` foregrounds, which changes every `StatusPill` on the desktop app too, so it is an owner
  decision rather than a token tweak.
- **STATUS color is tokenized; CATEGORICAL color is not** *(2026-07-30 migration decision)*. A color that
  means "this thing is failing / working / waiting" is status → it reads the semantic
  `--success|--danger|--warning|--info|--neutral` triplet. A color that IS the identity of a thing
  (division water=blue / fire=red / mold=pink, appointment type, an event accent) is categorical → the
  hue carries the meaning, so it stays raw hex and is NOT a defect. `techConstants.js` holds both kinds
  and says which is which. **Known remaining gap:** the light tints in `DIV_PILL_COLORS` and
  `TYPE_CONFIG.bg` are still frozen-light in dark; closing that needs its own reviewed division token
  family in `index.css`, not a swap.
- **Use the semantic family, not `--status-*`, for anything with a border.** The tech dark block
  re-points only `--status-*-bg`, so a pill built on that family keeps a LIGHT border on a dark fill;
  the semantic family re-tones `-bg` AND `-border`. (`--status-*` remains correct for the clock-state
  surfaces that already consume it and set no bordered tint.)
- **Three sanctioned non-token exceptions,** each of which must carry a one-line comment saying so:
  a saturated fill carrying white text (theme-invariant already, and the lighter token can drop it
  below AA — e.g. an armed two-click destructive confirm); a hex inside generated **email** HTML
  (email clients do not resolve CSS variables); and a hex that is **data**, not style (e.g. the
  `p_phase_color` RPC argument).

## Motion Catalog — the one tunable place motion lives *(law: `.claude/rules/motion-standard.md` · Last-verified: 2026-07-30, tech-shell press + list-row press rows added)*

All motion is defined in **two central places only**: the `:root` motion tokens (below) and this catalog.
Change a token → the whole app retunes. **No bespoke `120ms`/`ease-in-out`/`@keyframes` in a page or
component where a token/entry exists** (`design-consistency-checker` fails those). Everything is
transform/opacity-only (GPU, refresh-rate-agnostic — no >60fps dependency), and **every entry is wrapped
in a `@media (prefers-reduced-motion: reduce)` fallback** (nothing auto-skips; a motion without one is a
review failure).

### Tokens (`:root` in `index.css`)
```css
--motion-duration-fast: 120ms;   /* hovers, toggles, press, selection */
--motion-duration-base: 220ms;   /* page + modal/sheet transitions, chat bubbles */
--motion-duration-slow: 320ms;   /* large surfaces */
--motion-ease-standard:   cubic-bezier(.2, 0, 0, 1);   /* the default */
--motion-ease-decelerate: cubic-bezier(0, 0, 0, 1);    /* enter */
--motion-ease-accelerate: cubic-bezier(.3, 0, 1, 1);   /* exit */
--motion-spring-in:       linear(0, .038, … , 1);      /* gentle ~12% spring — ENTERS only
                                                          (modal/menu/toast pop); a linear()
                                                          spring, not a bezier; OFF exits, the
                                                          mobile sheet slide & money surfaces */
/* plus the two legacy --transition-fast/--transition-base still in use */
```

### The catalog (each entry names its tokens)

| Motion | What moves | Tokens | How to get it |
|---|---|---|---|
| **Page transition** | content region slides; sticky shell stays put | `--motion-duration-base` · `--motion-ease-standard` | Native View Transitions API — `@view-transition { navigation: auto }` is shipped in `index.css`; a routed link opts in with the router's `viewTransition` prop (shell-owner wiring). Degrades gracefully (unsupported browsers navigate instantly). Never re-runs `load()`. |
| **Button press** | `scale(0.97)` on `:active`, springs back | `--motion-duration-fast` · `--motion-ease-standard` | Built into `.btn` (+ `touch-action:manipulation`). Native also fires `impact('light')`. |
| **Button press — field-tech shell** | same `0.97`, applied to **every** `<button>` inside `.tech-layout` | `--motion-duration-fast` · `--motion-ease-standard` | One shared rule in `index.css` (search `TECH-SHELL PRESS FEEDBACK`) — a new tech control needs **no** press rule of its own. Uses the independent **`scale` property**, not `transform`, so it composes with controls already carrying `translateX(-50%)`/`rotate()`. A control that declares its own `transition` must name `scale` in it (the shared affordance rule is `:where()`, zero-specificity, so a class wins). Opt-outs, both pinned by `tests/qa/unit/tech-press-feedback.test.js`: controls that already own a transform-scale press (else it compounds), and full-width list rows, which take the row idiom below. |
| **List-row press** | background swap (opaque rows) or opacity dip (transparent rows) — never a scale | instant | `.tv2-msgs-row` / `.tv2-sched-row` / `.tv2-appt-row` and the tech-shell row opt-out list. Scaling a viewport-wide row reads as the whole screen flexing (`motion-standard.md` §3). |
| **Selection / tabs / segments / chips** | Low-frequency selections use an indicator; high-frequency field controls may change instantly or within the fast token | `--motion-duration-fast` when animated | `.ui-seg` + `.ui-seg-indicator` for low-frequency selection. Follow `motion-standard.md` §3’s frequency tiers; native may fire `nativeHaptics.selection()`. |
| **Modal (desktop)** | enter: overlay fades, panel fades + **springs** up. exit: panel fades + scales down, overlay fades | enter `--motion-duration-base` · `--motion-spring-in` · exit `calc(base × .75)` · `--motion-ease-accelerate` | `<Modal>` — enter `uiModalIn`, exit `uiModalOut` + overlay `uiFadeOut`; `Modal.jsx` adds `--closing` then unmounts on `animationend` (safety-timeout fallback). |
| **Sheet (mobile)** | enter: slides up from the bottom edge. dismiss: slides **down** off-screen | enter `--motion-duration-base` · `--motion-ease-decelerate` · exit `calc(base × .75)` · `--motion-ease-accelerate` | `<Modal>` at ≤768px — enter `uiSheetUp`, exit `uiSheetDown`. Spring is kept **OFF** the sheet (it would fight the slide). |
| **Sheet (field-tech, hand-rolled)** | same enter/dismiss as the mobile sheet; overlay fades on `--motion-duration-fast` | same tokens as the mobile sheet row | The inline-styled tech sheets (AddRoomSheet, ClockSupersedeSheet, ReadingEntrySheet, PhotoNoteSheet, EquipmentPlacementSheet, EsignRequestSheet, TechHelpSheet, and the inline job-picker sheets on TechClaimAlbum/TechClaimDetail/TechRoomDetail — MODAL-01 predates `<Modal>` adoption on this frozen surface; AddPhotoSourceSheet was deleted 2026-08-14 by the camera-first photo doctrine) take the **hook pair** instead of `<Modal>`: `useSheetClosing(open)` owns the exit lifecycle — `.tech-sheet-overlay`/`.tech-sheet-panel` classes swap to `--closing` variants (`tech-fade-out`/`tech-slide-down` in `index.css`), unmount on name-filtered `animationend` with a 240ms safety timer, reduced motion = `animation: none` + a 0ms task — and `useDialogLifecycle` owns focus trap/Escape/aria. **Adopt BOTH**; render `null` only on `!present`, never on bare `open`. New surfaces still default to `<Modal>`. Contracts: `tests/qa/unit/sheet-exit-animation.test.js`, `dialog-lifecycle.test.js`. |
| **Chat — sent** | bubble rises from the composer edge + fades | `--motion-duration-base` · `--motion-ease-decelerate` | `.ui-chat-bubble-sent` (wired at the sms-experience W6 fold-in). |
| **Chat — received** | bubble fades + scales in (0.98→1) | `--motion-duration-base` · `--motion-ease-decelerate` | `.ui-chat-bubble-received`. |
| **Dropdown / popover / menu** | fade + slight scale (0.96→1) from trigger, **springs** into place | `--motion-duration-fast` · `--motion-spring-in` | consume the tokens on the popover; e.g. `.create-menu-popup` (CSS `createMenuIn`). |
| **Toast** | slide/fade from the container edge; enter **springs** | `--motion-duration-base` · `--motion-spring-in` (enter) | shell toast container; in-CSS `.conv-toast` uses `toastIn` on the spring (the shell's live toast is inline-styled in `Layout.jsx`). |
| **Form focus** | border/ring transition | `--motion-duration-fast` | `.field:focus` / `.input:focus`. |
| **First-run / rare delight** (onboarding, completion moments — `motion-standard.md` §3's rare tier) | full-screen cover fades in; content staggers up (50–60ms steps); icon **springs** in; one-shot accents (e.g. a single bell wiggle) | enter `--motion-duration-slow` · `--motion-ease-decelerate` · content `--motion-duration-base` · icon pop ~480ms `--motion-spring-in` · one-shot accents ≤700ms, always once, never looping · exit ≈75% of enter on `--motion-ease-accelerate` | Reference: `TechOnboarding.css` (tech first-run tour). Durations >300ms are sanctioned ONLY on this tier and state their reason in a comment; reduced-motion collapses everything with end states landing (JS timers own unmounts). |

### Haptics (native-feel multiplier — pairs with motion, never replaces it)
`import { impact, selection, notify } from '@/lib/nativeHaptics'` (import-only; Taptic on native,
`navigator.vibrate` on web, no-op on desktop, fire-and-forget). Vocabulary: `impact('light')` = a
button/field press or a message send; `selection()` = a tab/segment/chip/toggle change; `notify('success'|'error')`
= a completed multi-step action or a failure. Haptics respect `prefers-reduced-motion` and are additive —
a control must be fully usable and visually animated with haptics off.

## Utility Classes (already in index.css — use these, don't recreate)

### Buttons
```jsx
<button className="btn btn-primary">Primary</button>
<button className="btn btn-secondary">Secondary</button>
<button className="btn btn-ghost">Ghost</button>
<button className="btn btn-sm">Small (30px)</button>
<button className="btn btn-lg">Large (44px)</button>
```
- Default height: 36px. Small: 30px. Large: 44px. These are visual desktop sizes, not permission
  to create an undersized mobile hit area; touch/mobile controls still meet the applicable 44px or
  technician 48px/44px standard.
- Always include `disabled` attribute when loading — never just `opacity`.

### Inputs
```jsx
<input className="input" />
<textarea className="input textarea" />
<label className="label">Label text</label>
```
- Height: 40px for inputs.
- On mobile inputs must have `font-size: 16px` (already enforced via CSS for `.input` class, but watch for inline overrides).
- Do not add browser-native `<select>` or `<input type="date">` controls to pages/components. Their
  opened menus and calendars are owned by the browser and cannot match UPR. Use `SearchSelect` on
  Collections Kit surfaces, `LookupSelect` outside Collections (or the surface's documented
  domain picker), `DatePicker` for shared dates, and `CrmDatePicker` inside CRM. Existing native
  controls are frozen lint debt: the changed-files ratchet allows their current count to shrink,
  never grow.
- When different primitives share one form row, define one surface-level trigger style and pass it
  through each component's `triggerStyle` API plus direct input styles. Preserve the shared
  `DatePicker` 48px technician-primary default; Collections/touch-capable office forms may use the
  documented 44px floor. A render test must enumerate every control in the mixed row so a component
  default cannot silently make one field taller than its neighbors.

### Status Badges (with dot indicator)
```jsx
<span className="status-badge status-needs-response">Urgent</span>
<span className="status-badge status-waiting">Waiting</span>
<span className="status-badge status-resolved">Resolved</span>
<span className="status-badge status-active">Active</span>
```

### Division Badges
```jsx
<span className="division-badge" data-division={job.division}>{job.division}</span>
```

### Priority Tags
```jsx
<span className="priority-tag priority-urgent">URGENT</span>
<span className="priority-tag priority-high">HIGH</span>
```

### Empty / Error / Loading states — use the primitives *(law: `loading-error-states.md`)*
Three DISTINCT states; never conflate them. A failed load must NOT render the empty-state or a blank page.
```jsx
import { EmptyState, ErrorState } from '@/components/ui';
import TabLoading from '@/components/TabLoading';

if (loading)   return <TabLoading />;                                    // cold load only (never on refetch)
if (loadError) return <ErrorState message="Couldn’t load jobs" onRetry={load} />;  // a load threw
if (!rows.length) return <EmptyState icon="📋" title="No jobs yet" sub="Create one to start"
                                     action={<button className="btn btn-primary">New job</button>} />;  // success + 0 rows
```
`<EmptyState>` renders **only after a successful load**. Legacy `.empty-state*` classes still exist for
the shell; new code uses the primitives. Loading vocabulary: `<TabLoading/>` (tabs/panels), skeletons
(tech/Overview), `.loading-page` spinner (route cold-load only) — no bare "Loading…" text.

### Loading Spinner
```jsx
<div className="loading-page"><div className="spinner" /></div>
```

### Card
```jsx
<div className="card">
  <div className="card-header">
    <span className="card-title">Title</span>
    <button className="btn btn-secondary btn-sm">Action</button>
  </div>
  <div className="card-body">content</div>
</div>
```

---

## Page Layout Patterns

### Standard List Page (Customers, ClaimsList pattern)
```jsx
<div className="customers-page">          {/* page wrapper — padding: var(--space-5), max-width: 1200px */}
  <div className="customers-header">       {/* flex, space-between, margin-bottom: space-4 */}
    <div>
      <h1 className="page-title">Title</h1>
      <p className="page-subtitle">N items</p>
    </div>
    {/* optional action buttons */}
  </div>

  <div className="customers-filters">     {/* flex, gap: space-2, margin-bottom: space-4 */}
    <div className="customers-search-wrap">
      <IconSearch style={{ position: 'absolute', left: 10, top: 9 }} />
      <input className="input" style={{ paddingLeft: 32 }} placeholder="Search..." />
    </div>
    {/* optional dropdowns */}
    {activeFilter && <button className="btn btn-ghost btn-sm">Clear</button>}
  </div>

  <PullToRefresh onRefresh={load} className="customers-list">  {/* flex column, gap: space-2 */}
    {items.length === 0 ? <EmptyState /> : items.map(item => <Card key={item.id} />)}
  </PullToRefresh>
</div>
```

### Full-Viewport Page with Sticky Header (Jobs, Production pattern)
Use when the page needs to fill height exactly and scroll only the content area, not the whole page.
```jsx
<div className="jobs-page">              {/* flex column, height: 100dvh, overflow: hidden */}
  <div className="jobs-header">           {/* flex, space-between, margin-bottom: space-4, flex-shrink: 0 */}
    <div>
      <h1 className="page-title">Jobs</h1>
      <p className="page-subtitle">{count} of {total} jobs</p>
    </div>
    {/* sort/view controls */}
  </div>

  {/* optional division tabs */}
  <div className="division-tabs">
    {TABS.map(tab => (
      <button className={`division-tab${active === tab.key ? ' active' : ''}`}>
        {tab.label} <span className="division-tab-count">{count}</span>
      </button>
    ))}
  </div>

  <div className="jobs-filters">           {/* flex, gap: space-3, flex-shrink: 0 */}
    <div className="jobs-search-wrap">
      <IconSearch />
      <input className="input jobs-search" />
    </div>
    <select className="input jobs-filter-select" />
    {active && <button className="btn btn-ghost btn-sm">Clear</button>}
  </div>

  <PullToRefresh onRefresh={load} className="job-card-list">  {/* flex col, flex: 1, overflow-y: auto */}
    {items.map(item => <JobListCard key={item.id} />)}
  </PullToRefresh>
</div>
```

### Tabbed Detail Page (JobPage, CustomerPage, Admin pattern)
```jsx
<div className="job-page">               {/* flex column, height: 100dvh, overflow: hidden */}
  <div className="job-page-topbar">       {/* sticky top bar — back button + actions */}
    <button className="btn btn-ghost btn-sm">← Back</button>
    <div className="job-page-topbar-actions">{/* action buttons */}</div>
  </div>

  <div className="job-page-header">       {/* title area with division icon + client info */}
    <div className="job-page-header-left">
      <div className="job-page-division-icon">{/* emoji or DivisionIcon */}</div>
      <div>
        <div className="job-page-jobnumber">JOB-001</div>
        <div className="job-page-client">Client Name</div>
        <div className="job-page-address">123 Main St</div>
      </div>
    </div>
    <div className="job-page-header-right">{/* phase badge + action buttons */}</div>
  </div>

  <div className="job-page-tabs">         {/* horizontal tab strip, overflow-x: auto */}
    {TABS.map(tab => (
      <button className={`job-page-tab${active === tab.key ? ' active' : ''}`}>
        {tab.label}
        {tab.count > 0 && <span className="job-page-tab-count">{tab.count}</span>}
      </button>
    ))}
  </div>

  <PullToRefresh className="job-page-content">  {/* flex: 1, overflow-y: auto, padding: space-5 space-6 */}
    {activeTab === 'overview' && <OverviewTab />}
    {activeTab === 'other' && <OtherTab />}
  </PullToRefresh>
</div>
```

### Two-Column Settings/Admin Page
```jsx
<div className="settings-page">          {/* flex column, height: 100%, overflow: hidden */}
  <div className="settings-header">       {/* padding: space-5 space-6 */}
    <h1 className="page-title">Settings</h1>
  </div>
  <div className="settings-body">         {/* flex, flex: 1, overflow: hidden */}
    <nav className="settings-nav">        {/* 210px wide sidebar — horizontal scroll strip on mobile */}
      <div className="settings-nav-label">Section</div>
      <button className={`settings-nav-item${active === 'key' ? ' active' : ''}`}>Item</button>
    </nav>
    <div className="settings-content">    {/* flex: 1, overflow-y: auto, padding: space-5 space-6 */}
      {/* content */}
    </div>
  </div>
</div>
```

### Simple Page (Dashboard pattern)
For pages that don't need full-viewport control:
```jsx
<div className="page">                   {/* padding: space-6, max-width: 1400px */}
  <div className="page-header">          {/* margin-bottom: space-6 */}
    <h1 className="page-title">Dashboard</h1>
    <p className="page-subtitle">Subtitle text</p>
  </div>
  {/* content */}
</div>
```

---

## Card Patterns

### Job List Card (Jobs page)
Left colored border = division color. Quick-view button on right.
```jsx
<div className="job-list-card" onClick={onClick}
  style={{ borderLeft: `3px solid ${divColor}`, borderRadius: 'var(--radius-md)' }}>
  <div className="job-list-card-body">
    {/* Row 1: name + priority + phase badge */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span className="job-list-card-name">{job.insured_name}</span>
      {priority && <span style={flagStyle}>{priority.label}</span>}
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: phase.bg, color: phase.color }}>{phase.label}</span>
    </div>
    {/* Row 2: job number + flags */}
    {/* Row 3: address */}
    {/* Row 4: meta line (insurer · loss date · value) */}
  </div>
  <button className="job-card-open-btn" onClick={e => { e.stopPropagation(); onQuickView(); }}>
    <IconSearch style={{ width: 14, height: 14 }} />
  </button>
</div>
```

### Customer/Contact Card (Customers page)
Avatar circle + body + right-side badge.
```jsx
<div className="customer-card" onClick={onClick}>
  <div className="customer-card-avatar">{initials}</div>
  <div className="customer-card-body">
    <div className="customer-card-name">{name}</div>
    <div className="customer-card-meta">
      <span>{phone}</span>
      <span>{email}</span>
    </div>
    <div className="customer-card-jobs">
      {jobs.slice(0, 3).map(j => (
        <span className="customer-card-job-pill"
          style={{ borderLeftColor: DIVISION_COLORS[j.division], borderLeftWidth: 2 }}>
          {j.job_number}
        </span>
      ))}
    </div>
  </div>
  <div className="customer-card-right">
    <span className="customer-card-role-badge">{role}</span>
    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{count} jobs</span>
  </div>
</div>
```

### Pipeline Card (Production kanban)
```jsx
<div className="pipeline-card">
  <div className="pipeline-card-title">{job.job_number || job.insured_name}</div>
  <div className="pipeline-card-meta">{job.insured_name}</div>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
    <span className="division-badge" data-division={job.division}>{job.division}</span>
    <button className="job-card-open-btn"><IconOpenPage /></button>
  </div>
</div>
```

### Stat Card (Dashboard)
```jsx
<div className="stat-card">
  <div className="stat-label">Active Jobs</div>
  <div className="stat-value" style={alert ? { color: 'var(--status-needs-response)' } : {}}>
    {value}
  </div>
</div>
```

### Info Row (inside JobPage sections)
```jsx
<div className="job-page-info-row">
  <span className="job-page-info-label">Insurance</span>
  <span className="job-page-info-value">{value || '—'}</span>
</div>
```

---

## Modal/Panel Patterns

### Modal — use the primitive *(new modals; F-S2)*

**A dialog the PARENT keeps mounted** (the parent owns `open`):
```jsx
import { Modal } from '@/components/ui';

<Modal open={open} onClose={close} title="Edit job" size="sm"
  footer={<>
    <button className="btn btn-secondary" onClick={close}>Cancel</button>
    <button className="btn btn-primary" onClick={save}>Save</button>
  </>}>
  {/* body */}
</Modal>
```

**A dialog its caller MOUNTS CONDITIONALLY** (`{show && <MyDialog onClose={…}/>}`) — the common
case for the standalone `*Modal.jsx` components. Hold `open` LOCALLY and hand the unmount to
`onExited`, or the panel disappears instantly and the exit animation never plays (motion-standard
§3, "every enter has an exit"). Pinned by `tests/qa/unit/shared-modal-adoption.test.js`:
```jsx
const [open, setOpen] = useState(true);
const dismiss = useCallback(() => setOpen(false), []);   // ✕ / ESC / overlay
const searchRef = useRef(null);

<Modal open={open} onClose={dismiss} onExited={onClose} title="New Job"
  initialFocusRef={searchRef}          // optional — see below
  closeDisabled={saving}>
  <input ref={searchRef} aria-label="Search clients" />
</Modal>
```
`Modal` is the shared dialog: `role="dialog"` + focus trap + ESC/overlay close + **centered on desktop,
bottom-sheet on mobile** (motion + layout are CSS, tokened + reduced-motion-safe). It replaces the ~45
hand-rolled overlays (0 of which had `role=dialog` or a focus trap). W3 migrates the inline overlays.

**`initialFocusRef` (2026-08-14)** — names which control gets the caret on open. Without it the
first focusable wins, which is the **✕**, so a search-led dialog opens focused on Close; a plain
`autoFocus` does NOT save it (React applies `autoFocus` during commit, Modal's focus effect runs
after and overrides). Falls back to the default when the ref is empty or points outside the panel.

**Nesting is supported** — a dialog may open another on top of itself (New Job → New Contact).
Modal keeps a stack so ESC closes only the innermost one.

**One scroller per dialog.** `.ui-modal-body` already scrolls. If your content region also
scrolls you get a scroller inside a scroller, which strands the inner list mid-gesture on touch.
Either drop your wrapper and let `.ui-modal-body` scroll, or hand its scrolling over under a
per-dialog class: `.my-dialog .ui-modal-body { padding: 0; overflow: hidden; min-height: 0;
display: flex; flex-direction: column; }` (see `.add-contact-modal`, `.conversation-members`).
Destructive confirmation is **two-click inline** (`useTwoClickConfirm`), **never a modal** (Rule 2). The
legacy `.admin-modal*` classes below remain for the shell; new modals use `<Modal>`.

### Centered Modal (Admin) — legacy shell pattern
```jsx
<div className="admin-modal-overlay" onClick={onClose}>
  <div className="admin-modal" onClick={e => e.stopPropagation()}>
    <div className="admin-modal-header">
      <h3>Modal Title</h3>
      <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
    </div>
    <div className="admin-modal-body">{/* content */}</div>
    <div className="admin-modal-footer">
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={onSave}>Save</button>
    </div>
  </div>
</div>
```
- On mobile (`@media max-width: 768px`): becomes a **bottom sheet** via CSS (`admin-modal-overlay` aligns to flex-end, `admin-modal` gets `border-radius: 16px 16px 0 0`).
- For smaller confirms: add `admin-modal-sm` class (max-width: 420px).

### Bottom Sheet Modal — legacy recipe (new modals use `<Modal>`)
> **Superseded by `<Modal>` (F-S2)** — it already ships centered-desktop / bottom-sheet-mobile +
> `role=dialog` + focus trap + tokened `dvh` motion. Only hand-roll the classes below if you genuinely
> can't use the primitive; if you do, use `dvh` not `vh` and reduced-motion-wrap the animation.
The historical admin-modal recipe — centered on desktop, bottom sheet on mobile:
```css
/* In your component's inline styles or via new CSS classes */
.my-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: var(--space-4); }
.my-modal { background: var(--bg-primary); border-radius: var(--radius-xl); width: 100%; max-width: 560px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--shadow-lg); }
@media (max-width: 768px) {
  .my-modal-overlay { align-items: flex-end; padding: 0; }
  .my-modal { border-radius: 16px 16px 0 0; max-height: 90dvh; max-width: 100%; padding-bottom: env(safe-area-inset-bottom, 0px); }
}
```

### Slide-Out Panel (JobDetailPanel, CustomerPage side panel)
```jsx
<div className="job-detail-overlay" onClick={onClose}>
  <div className="job-detail-panel" onClick={e => e.stopPropagation()}>
    <div className="job-detail-header">
      <div>
        <div className="job-detail-jobnumber">Title</div>
        <div className="job-detail-client">Subtitle</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
    </div>
    {/* sections with dividers */}
    <div className="job-detail-section">
      <div className="job-detail-section-title">Section Name</div>
      {/* rows */}
    </div>
    <div className="job-detail-divider" />
  </div>
</div>
```

---

### Photo capture — camera-first, never a chooser *(owner ruling 2026-08-14)*
Every photo button opens the CAMERA instantly. No "camera or album?" prompt of any kind — not the
OS sheet (`CameraSource.Prompt`), not a custom sheet (`AddPhotoSourceSheet`, deleted). Album access
is an affordance **inside or beside** the camera, never a question before it.

- **Native:** `openNativeCameraExperience({ allowMultiple: true, onCapturedFile })` from
  `@/lib/nativeCamera` — the WhatsApp-style full-screen Swift camera
  (`ios/App/App/NativeCameraExperience.swift`): shutter / flash / flip, a recent-photos strip
  (multi-select with numbered badges + "Add N photos" confirm), and an album icon opening the OS
  multi-select picker. **Shoot & save instantly (owner choice 2026-08-14):** every shutter tap
  streams its photo through `onCapturedFile` and uploads IMMEDIATELY while the camera stays open
  (a "N saved" counter shows on the camera) — one photo is one tap, many photos are more taps;
  ✕ after shooting means "done", not cancel. Feature-detected; older binaries fall back to
  `captureNativePhoto()` (camera-direct, still no prompt). The promise resolves with the
  strip/album selection as `File[]`; empty on cancel (`isUserCancelled` keeps cancels silent —
  never toast on empty). *(A possible future WhatsApp-style review tray — captures accumulate and
  confirm before upload — would reuse the existing confirm-bar path in the Swift camera.)*
- **Album surfaces** additionally carry an **adjacent album icon-button** (image-frame icon,
  ≥48px, `--accent` on `--bg-primary`, sized to match its row's primary button) that jumps
  straight to the OS multi-select picker: `pickNativePhotos()` on native, a hidden `multiple`
  file input on web.
- **Web/PWA:** the primary input is camera-first (`<input type="file" accept="image/*"
  capture="environment">`); only album surfaces add the second `multiple` input.
- **Every button gets the IDENTICAL camera** (owner unification, 2026-08-14): all 8 surfaces pass
  `allowMultiple: true` + `onCapturedFile`. The only remaining split is page chrome — album
  surfaces carry the adjacent album icon and the `multiple` web input; quick-capture surfaces
  (Dash, Hub dock, appointment) keep a lean camera-first single web input. Every upload routes
  through `usePhotoUpload` (compression before Storage — perf-budget.md §2); a page never
  hand-rolls the Storage POST.
- **Attach flows** (the tech Messages composer) open the same unified camera with
  `allowMultiple: true` **and `onCapturedFile`** — under the unified contract a shutter shot exists
  ONLY as a streamed `photoCaptured` event (✕-after-shooting resolves an empty batch), so an attach
  flow without the callback would silently lose snapped photos. Streamed shots and the resolved
  strip/album batch both STAGE into the attachment tray (previews, removable; the send stays an
  explicit tap — nothing auto-sends). They gate on `nativeCameraExperienceAvailable()` — **their
  no-plugin fallback is the plain file input, never `captureNativePhoto()`** (the single shot has
  no album, and an attach flow losing album access is a regression). Web/PWA keeps the plain
  `multiple` input with **no `capture` attribute**. Attach is picking UX only; the send path is
  untouched.
- A "which JOB?" picker on multi-job claim surfaces is attribution, not a source chooser — it may
  precede the camera, and it carries the tapped flow (camera vs album) through the pick.
- **Composer [+] menu — the one owner-amended exception (2026-08-14, same-day amendment):** the
  Messages composer's native [+] presents Apple's own action sheet (`NativeActionMenu` app-local
  plugin) with explicit **Take Photo / Photo Library / Templates / Internal note** rows — the
  owner wants the source split visible there, in the native look WebKit's (non-extensible)
  file-input chooser has. Take Photo opens OUR camera experience (never the stock Capacitor
  camera); Photo Library goes straight to the OS multi-select picker. The menu appears only when
  BOTH plugins answer; otherwise the web-drawn sheet with the camera-first attach flow above.
  **Scoped to the composer** — no other photo surface may grow a pre-camera menu without its own
  recorded amendment (`presentNativeActionMenu` is test-banned on every other photo surface).
- Contract: `tests/qa/unit/album-multi-photo-select.test.js` (doctrine + the unified camera +
  the chrome split + the composer menu amendment), `native-plugin-wiring.test.js` (plugin wiring).

## Tab Bar Patterns

> **Motion note (F-S2):** the tab/segment/pill recipes below are the existing shell markup and their
> active state **snaps** (no transition). New tab/segment/chip controls should use the **animated
> selection indicator** — the `.ui-seg` / `.ui-seg-indicator` primitive (a sliding pill on
> `--motion-duration-fast`) per the Motion Catalog's "Selection / tabs / segments / chips" row — rather
> than a hard active-fill swap. W1–W3 migrate these as they touch each surface.

### Underline Tabs (JobPage, Admin, DevTools) — legacy shell pattern
```jsx
<div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-color)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
  {TABS.map(tab => (
    <button key={tab.key} onClick={() => setActive(tab.key)} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '9px 14px', border: 'none', background: 'none',
      borderBottom: `2px solid ${active === tab.key ? 'var(--accent)' : 'transparent'}`,
      color: active === tab.key ? 'var(--accent)' : 'var(--text-secondary)',
      fontFamily: 'var(--font-sans)', fontSize: 13,
      fontWeight: active === tab.key ? 600 : 400,
      cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
    }}>
      <TabIcon style={{ width: 14, height: 14 }} />
      {tab.label}
    </button>
  ))}
</div>
```

### Pill Tabs (IntegrityTab, MessagingTab sub-tabs, filter bars)
```jsx
{TABS.map(tab => (
  <button key={tab.key} onClick={() => setActive(tab.key)} style={{
    padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid',
    fontSize: 12, fontWeight: active === tab.key ? 600 : 400, cursor: 'pointer',
    background: active === tab.key ? 'var(--accent)' : 'var(--bg-tertiary)',
    color: active === tab.key ? '#fff' : 'var(--text-secondary)',
    borderColor: active === tab.key ? 'var(--accent)' : 'var(--border-color)',
  }}>{tab.label}</button>
))}
```

### Segmented Control (toggle between 2–3 options)
```jsx
<div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
  {OPTIONS.map((opt, i, arr) => (
    <button key={opt.key} onClick={() => setActive(opt.key)} style={{
      fontSize: 12, fontWeight: 500, padding: '5px 14px',
      border: 'none', background: active === opt.key ? 'var(--accent-light)' : 'var(--bg-primary)',
      cursor: 'pointer', color: active === opt.key ? 'var(--accent)' : 'var(--text-tertiary)',
      fontFamily: 'var(--font-sans)', fontWeight: active === opt.key ? 600 : 400,
      borderRight: i < arr.length - 1 ? '1px solid var(--border-color)' : 'none',
    }}>{opt.label}</button>
  ))}
</div>
```

---

## Table Patterns

### Admin Table (desktop, with mobile card fallback)
```jsx
{/* Desktop */}
<div className="admin-table-wrap">        {/* border, border-radius, overflow-x: auto */}
  <table className="admin-table">
    <thead>
      <tr>
        <th>Name</th>
        <th className="admin-th-num">Amount</th>
        <th className="admin-th-actions">Actions</th>
      </tr>
    </thead>
    <tbody>
      {rows.map(row => (
        <tr key={row.id}>
          <td>{row.name}</td>
          <td className="admin-td-num">${row.amount}</td>
          <td className="admin-td-actions">
            <button className="admin-action-btn">Edit</button>
            <button className="admin-action-btn admin-action-btn-danger">Delete</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
{/* Mobile cards hidden on desktop via .admin-cards-mobile { display: none } */}
```

### DevTools-style table (data tables inside panels)
```jsx
<div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
  {/* Header row */}
  <div style={{
    display: 'grid', gridTemplateColumns: '1fr 1fr 120px',
    padding: '8px 16px', background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
    letterSpacing: '0.06em', textTransform: 'uppercase',
  }}>
    <span>Column A</span><span>Column B</span><span>Column C</span>
  </div>
  {/* Data rows */}
  {rows.map((row, i) => (
    <div key={row.id} style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 120px',
      alignItems: 'center', padding: '10px 16px',
      borderBottom: i < rows.length - 1 ? '1px solid var(--border-light)' : 'none',
      background: 'var(--bg-primary)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{row.a}</span>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.b}</span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{row.c}</span>
    </div>
  ))}
</div>
```

---

## Badge/Pill Patterns

### Status pill — use the primitive (never inline)
```jsx
import { StatusPill } from '@/components/ui';
<StatusPill status="active" />   {/* tokened; classifies to a tone; dark-safe */}
```
The old inline `<span style={{ background:'#f0fdf4', … }}>` recipe is **retired** — see Semantic status
tokens. W3 migrates the 158 inline pills onto `StatusPill`.

### Monospace code badge (keys, IDs, job numbers)
```jsx
<code style={{
  fontSize: 11, fontFamily: 'var(--font-mono)',
  color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)',
  padding: '1px 5px', borderRadius: 3,
}}>page:marketing</code>
```

### Section header label (above grouped content)
```jsx
<div style={{
  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-tertiary)',
  marginBottom: 10,
}}>Section Name</div>
```

### Role badge (Admin page pattern)
```jsx
<span className={`admin-role-badge role-${emp.role}`}>{roleLabel}</span>
```
Available: `role-admin`, `role-project_manager`, `role-office`, `role-supervisor`, `role-field_tech`

---

## Form Patterns

### Standard form field
```jsx
<div style={{ marginBottom: 'var(--space-3)' }}>
  <label style={{
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--text-tertiary)', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 5,
  }}>
    Field Label
  </label>
  <input className="input" value={val} onChange={e => setVal(e.target.value)} />
</div>
```

### Two-column form grid
```jsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
  <div>{/* field */}</div>
  <div>{/* field */}</div>
</div>
```
On mobile, use `flex-direction: column` inside a `@media (max-width: 768px)` rule, or use the `admin-form-grid` class.

### Toggle switch (existing CSS classes)
```jsx
<button
  className={`admin-toggle${enabled ? ' on' : ''}`}
  onClick={toggle}
  disabled={saving}
>
  <span className="admin-toggle-dot" />
</button>
```

### Two-click confirm (REQUIRED for destructive actions — never use alert/confirm/modal)
Use the shared hook — it owns the arm/timeout/cancel logic (colors come from the `--danger-*` tokens):
```jsx
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';

const { isArmed, arm, cancel } = useTwoClickConfirm();

<button
  onClick={() => (isArmed(item.id) ? runDelete(item) : arm(item.id))}
  onBlur={cancel}   // mobile has no hover — cancel on blur (Rule #5)
  style={{
    background: isArmed(item.id) ? 'var(--danger-bg)' : 'var(--bg-tertiary)',
    color:      isArmed(item.id) ? 'var(--danger)'    : 'var(--text-tertiary)',
    border: `1px solid ${isArmed(item.id) ? 'var(--danger-border)' : 'var(--border-light)'}`,
    padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 11,
    fontWeight: isArmed(item.id) ? 600 : 400, cursor: 'pointer',
    transition: 'all var(--motion-duration-fast) var(--motion-ease-standard)',
  }}
>
  {isArmed(item.id) ? 'Confirm Delete' : 'Delete'}
</button>
```
W3 migrates the 26 hand-rolled two-click reimplementations onto this hook.

---

## Navigation Patterns

### Sidebar
- Background: `--sidebar-bg: #111318` (dark)
- Width: 240px desktop, 280px mobile (slide-over)
- Active link: `sidebar-active` class (blue tint + blue text)
- Section labels: uppercase, 11px, 0.6 opacity
- Desktop row height may be 40px. On touch/mobile navigation, the interactive hit area is at least
  44px.

### Bottom Bar (mobile only)
4 tabs + "More" opens sidebar. Shown only on `@media (max-width: 768px)`.
Height: `--bottom-bar-h: 72px` + safe area.

### Page content with bottom bar
Always use `PullToRefresh` as the scrollable wrapper. The bottom bar padding is automatically added via `.app-content { padding-bottom: calc(var(--bottom-bar-h) + var(--safe-bottom)); }`.

---

## Toast Notifications (NEVER use alert/confirm; ONE entry point)
`src/lib/toast.js` is the **only** way to raise a toast — raw `window.dispatchEvent(new CustomEvent('upr:toast'…))`
and local `errToast` copies are **banned** (eslint-enforced; the audit found 125 raw dispatches + 22 copies).
```js
import { toast } from '@/lib/toast';

toast('Saved!');              // success (default type)
toast('Failed to save', 'error');
```
The `ok()` / `err()` thin wrappers are the planned additions W3 makes to `toast.js` (it currently exports
only `toast`); once they land, prefer `ok('Saved!')` / `err('Failed to save')`. W3 migrates the raw
dispatches, then flips the eslint rule to error.

---

## Mobile-Specific Rules

1. **All inputs must have `font-size: 16px` on mobile** — iOS auto-zooms on anything smaller. The `.input` class handles this via `@media (max-width: 768px) { input { font-size: 16px !important; } }`. Never override with smaller size.

2. **Safe areas** — use `env(safe-area-inset-bottom, 0px)` for anything near the bottom. Already baked into `.bottom-bar`, modal footers, etc.

3. **Modals become bottom sheets** on mobile. Add the CSS pattern from the Modal section above.

4. **Tap targets:** all touch/mobile interactive hit areas are at least 44px. Technician primary
   actions are at least 48px; only the documented technician-secondary exception may be 44px.

5. **No hover-only interactions** — mobile has no hover. Show important actions visibly. Use `onBlur` to cancel two-click confirm states.

6. **`PullToRefresh` wrapper** — wrap scrollable content in `<PullToRefresh onRefresh={loadFn}>`. This enables pull-to-refresh on iOS.

7. **CSS transforms cause clipping on real iPhone** — use `display` toggling instead for show/hide.

8. **`100dvh` not `100vh`** for full-screen pages — handles iOS Safari's dynamic viewport.

---

## Collections Kit — Second Design System

**Scope:** `Collections.jsx` (AR dashboard, invoices/estimates/payments lists), `TimeTracking.jsx`, `InvoiceEditor.jsx`, `EstimateEditor.jsx`. Also touches `NewEstimateModal.jsx` (partially — see Known Inconsistencies).

**Status:** deliberate, not accidental. `collTokens.js` states directly: *"Page-scoped palette (same approach as the Overview dashboard's tokens.js). Don't import these into unrelated pages until the app-wide rollout decision."* Treat it as sanctioned for the four areas above and nowhere else, until that rollout decision is made.

**Source:** `src/components/collections/collTokens.js` (palette), `src/components/collections/collKit.jsx` (components), CSS at `src/index.css:5538+` (`.coll-*` classes).

### Token palette
```js
// collTokens.js — hex values, NOT var(--token). Do not mix with the main token set above.
C.ink: '#101828'      C.body: '#475467'     C.faint: '#98a2b3'
C.pageBg: '#f4f5f7'    C.inputBorder: ...
STATUS.success  { solid:'#1f9d55', tint:'#e9f7ef', text:'#1f9d55' }
STATUS.warning  { ... }   STATUS.danger { solid:'#c0322c', ... }
STATUS.info     { ... }   STATUS.neutral { ... }
```
Note: this is a **different green/red** than the main Status Color Palette above (`#16a34a`/`#dc2626`) — don't assume they're interchangeable.

### Page shell
`.coll-page` (max-width 1320px, centered, `padding: 24px 28px 60px`) → `.coll-header` (title/subtitle/actions) → `.coll-tabrow` (SegControl tabs, optional period SegControl) → view content. Used by both `Collections.jsx` and `TimeTracking.jsx`.

### SegControl (black-pill segmented control)
`.coll-seg` container (white bg, `#e7e9ee` border, `border-radius: 10px`, `padding: 3px`) with `.coll-seg-btn` children; active = `background: #101828; color: #fff`. Three sizes (`lg`/`md`/`sm`). This is a **third** tab/toggle visual (distinct from the Pill Tabs and Segmented Control patterns above) — use it only within Collections Kit pages.

### KPI tile grid
`Kpi`/`KpiGrid` (`collKit.jsx`) — `.coll-kpi-grid` (`.coll-kpi-4`/`.coll-kpi-3` column-count modifiers) of `.coll-card.coll-kpi` tiles: uppercase label → big value → context line. Optionally clickable (`onClick`) with an active-ring state, acting as a quick-filter — unlike the static Stat Card pattern above.

### CSS-grid "table" (not `<table>`)
`.coll-thead` header row + `.coll-row` data rows, both `display: grid` with a shared `gridTemplateColumns` built from a `COL` config (`{ label, fr, num }`) and a `COL_ORDER`/`LOCKED` column-visibility scheme. Used identically across the AR dashboard, invoices/estimates/payments lists, and Time Tracking's timesheet/job/payroll views. Supports clickable sortable headers (`.coll-th-sort`, `data-active`, ▲/▼). No semantic `<table>` markup — don't expect the Admin Table's mobile-card fallback here; it doesn't apply.

### Toolbar with Filters/Columns popovers
`.coll-toolbar`: `SearchBox` + status `SegControl` + result count + `PopoverButton` ("Filters": chips/range inputs) + `PopoverButton` ("Columns": checkbox list with locked/required columns). `PopoverButton` (`collKit.jsx`) is a generic anchored popover (closes on outside-click/Escape, render-prop body) — reuse it instead of hand-rolling another dropdown.

### Buttons / cards / badges
`GhostButton`/`PrimaryButton` → `.coll-ghost`/`.coll-primary` (not `.btn`). `CollCard` → `.coll-card` (not `.card`). `StatusBadge`/`Pill`/`StatusText` (`collKit.jsx`) — a 5-status vocabulary (`success`/`warning`/`danger`/`info`/`neutral`), pill or plain-text treatment depending on context; not the main Status Badge classes.

### Editable line-item grid (Invoice/Estimate editors)
The core pattern behind `InvoiceEditor.jsx`/`EstimateEditor.jsx`: a CSS-grid line-item table with drag handle (⠿) + reorder (persists `sort_order` via sequential `db.update`), `SearchSelect` for QBO Item/Class, `AutoGrowTextarea` for description, computed read-only totals, delete button, and a footer combining "+ Add line" with a right-aligned Subtotal/Tax/Total stack. Both editors also render a full customer-facing print/PDF preview overlay (`@media print` CSS-in-JS) and a payments sub-ledger with a **view-then-deliberate-Edit** flow (distinct from two-click-delete — guards against accidental edits, not deletions).

### Time Tracking-specific patterns
Built on the same kit, plus: inline click-to-edit table cells (click → `<input>`, commit on blur/Enter, revert on Escape/error); bulk-select + bulk-action toolbar (Approve/Unapprove/Clock-out/Delete-N, swaps to a reason-input + confirm state for bulk delete); an approve/lock workflow (approved rows go read-only, require "Unapprove & edit" to reopen); a field-tech change-request diff-review UI (old-value strikethrough → new-value grid); CSV export; a semi-monthly payroll period selector.

### AI chat FAB
`ARChatBubble.jsx` — a floating circular button (`.coll-chat-fab`, portaled to `document.body` to escape a transformed ancestor) opening a non-blocking slide-in panel (`.coll-chat-panel`, no backdrop — the page stays usable underneath), with message bubbles, typing-dots indicator, and an auto-growing composer. First AI-chat UI pattern in the app — reuse this shell for any future in-app assistant.

---

## Overview Kit — Third Design System (Dashboard/Home)

**Scope:** `Dashboard.jsx` and `src/components/overview/*` only.

**Status:** also deliberate — `tokens.js` in this folder explicitly states its palette is dashboard-scoped and not for reuse elsewhere.

**Source:** `src/components/overview/tokens.js` (palette), `Card.jsx`/`Widgets.jsx`/`WidgetBoundary.jsx` (components), CSS at `src/index.css:5181+` (`.ovw-*` classes).

### Widget grid
The dashboard is **not** a static page of stat cards — it's a `react-grid-layout` `ResponsiveGridLayout` of 11 draggable/resizable widget cards (Revenue Recognized, Payments Received, Avg Ticket, Open Estimates, New Claims Booked, Jobs Completed, Active Drying, Collections, Action Required, Employee Status, Production Pipeline), each independently wrapped in a `WidgetBoundary` error boundary. Layout is per-user, persisted, with an Edit-layout/Reset control in the header (`dashboard_layouts` table, `save_dashboard_layout`/`get_dashboard_layout` RPCs).

### Widget card shell
`Card.jsx` provides the shared chrome every widget uses: a loading skeleton (`CardSkeleton`), an inline retry error state (`CardError`), a drag handle (⠿, edit-mode only), a `DeltaPill` (up/down % indicator), and a footer link/summary row. A `RestrictedCard` variant renders a lock icon + "Restricted" for permission-gated widgets. Chart bodies are home-grown: CSS bars, a conic-gradient donut, or an inline SVG sparkline — there's no shared charting library.

### When to use this vs. Collections Kit vs. the main system
Dashboard only. Don't reuse `.ovw-*` classes or `tokens.js` values anywhere else, same rule as the Collections Kit.

---

## Conversations Messaging Pattern

**Scope:** `Conversations.jsx` only (used from both the office app and `/tech/conversations`).

A bespoke two-pane messaging shell, not built from either kit above: `.conversations-layout` → `.conv-list-panel` (search, filters, `.conv-list-items` rows with avatar/name/preview/unread badge) + `.conv-thread-panel` (header, `.conv-messages` with `.message-bubble` + `.conv-date-sep` date separators, a compose bar with an inline **action sheet** — `.conv-actions-sheet`/`.conv-action-item` — for Note/Templates/Schedule/Attach) + a slide-out `.conv-detail-panel` (contact info, linked job card, conversation meta). On mobile, a `mobile-thread` class flips which panel is visible with a back button, instead of a true two-pane layout. ~35 `conv-*` classes total, all real (`index.css`), none shared with anything else in the app. Reuse this shell for any future threaded/chat UI rather than inventing another one.

---

## Known Inconsistencies (flagged, not auto-fixed — confirm before changing)

Found during the July 1 2026 audit. These are real behavioral/visual gaps, not just doc gaps — listed here rather than silently fixed since some require a product call:

- **Division color mismatch.** Collections Kit's `DIV_COLOR` map (`collTokens.js`) disagrees with the app-wide `DIVISION_COLORS` (`DivisionIcons.jsx`) — e.g. "water" renders `#0e9384` in Collections/Time Tracking but `#2563eb` everywhere else. Same division, two different colors depending which screen you're on.
- **`Leads.jsx` / `Marketing.jsx`** render a bare, unclassed `<table>` — not `.admin-table`, not the Collections Kit grid pattern. No responsive/mobile-card fallback exists for a raw `<table>`, so these likely render poorly on phone widths.
- **`InvoiceEditor.jsx`'s Payment modal and Xactimate-import modal** are hand-rolled `position:fixed` overlays that skip the app-wide mobile bottom-sheet behavior every other modal gets (Mobile-Specific Rule #3 above).
- **Two searchable-dropdown implementations** coexist by design: use `SearchSelect`
  (`src/components/collections/SearchSelect.jsx`) on Collections Kit surfaces and `LookupSelect`
  (`@/components/AddContactModal`) outside Collections unless that domain documents a more specific
  picker. Do not fall back to a native `<select>` just because the options are short.
- **Two destructive-confirm idioms** coexist: the standard two-click confirm (above) and a heavier type-"DELETE"-to-confirm modal (`CustomerPage.jsx` `ClaimsTab`). No documented rule for when the heavier one is warranted.
- **`CustomerPage.jsx`'s header** doesn't match the Tabbed Detail Page pattern's documented header shape (division icon + job number + client + address) — it's customer-shaped instead (avatar + client name + role/DND badges + job/claim count), with an undocumented `.customer-action-btn` row (Call/Text/Email/New Job/New Invoice) in place of the documented phase-badge/action-button area. This is correct for what a customer header should look like — the doc's example was just job-specific and never got a customer variant.
- **`empty-state-title`** is used (Leads/Marketing/Conversations) as a simpler two-line empty state without an icon — real CSS, but not listed under Empty State above alongside `.empty-state-icon`/`.empty-state-text`/`.empty-state-sub`.

---

## Existing CSS Classes by Category

### Page shells
`.page` `.page-header` `.page-title` `.page-subtitle`
`.jobs-page` `.job-page` `.customers-page` `.admin-page` `.settings-page` `.create-job-page`

Collections Kit / Overview Kit / Conversations pages use their own shell classes (`.coll-page`, `.ovw-page`, `.conversations-layout`) — see their sections above, not enumerated here.

### Navigation
`.sidebar` `.sidebar-link` `.sidebar-link.active` `.sidebar-nav` `.sidebar-footer` `.sidebar-badge`
`.bottom-bar` `.bottom-tab` `.bottom-tab.active` `.bottom-tab-badge`

### Cards
`.card` `.card-header` `.card-title` `.card-body`
`.stat-card` `.stat-label` `.stat-value`
`.job-list-card` `.job-list-card-body` `.job-list-card-name` `.job-list-card-address`
`.customer-card` `.customer-card-avatar` `.customer-card-body` `.customer-card-name`
`.customer-card-job-pill` `.customer-card-role-badge`
`.pipeline-card` `.pipeline-card-title` `.pipeline-card-meta`
`.macro-card` `.macro-card-emoji` `.macro-card-count` `.macro-card-label`

### Buttons
`.btn` `.btn-primary` `.btn-secondary` `.btn-ghost` `.btn-sm` `.btn-lg`
`.admin-action-btn` `.admin-action-btn-warning` `.admin-action-btn-danger` `.admin-action-btn-success`
`.job-card-open-btn` `.customer-action-btn` (CustomerPage header icon+label row)

### Forms
`.input` `.textarea` `.label` `.form-group`
`.admin-toggle` `.admin-toggle.on` `.admin-toggle-dot`
`.admin-form-grid` `.admin-field` `.admin-field-hint`

### Badges/Pills
`.status-badge` `.status-needs-response` `.status-waiting` `.status-resolved` `.status-active`
`.division-badge` (with `data-division` attribute)
`.priority-tag` `.priority-urgent` `.priority-high`
`.admin-role-badge` `.role-admin` `.role-field_tech` `.role-supervisor` `.role-project_manager` `.role-office`
`.admin-status-pill` `.admin-status-pill.active` `.admin-status-pill.inactive`

### Tables
`.admin-table-wrap` `.admin-table` `.admin-th-num` `.admin-td-num` `.admin-th-actions` `.admin-td-actions`

### Modals
`.admin-modal-overlay` `.admin-modal` `.admin-modal-sm` `.admin-modal-header` `.admin-modal-body` `.admin-modal-footer`

### Job/Detail pages
`.job-page-tabs` `.job-page-tab` `.job-page-tab.active` `.job-page-tab-count`
`.job-page-content` `.job-page-grid` `.job-page-section` `.job-page-section-title`
`.job-page-info-row` `.job-page-info-label` `.job-page-info-value`

### Lookup tables (Settings)
`.lookup-table` `.lookup-header` `.lookup-row` `.lookup-cell` `.lookup-action-btn`

### Pipeline
`.pipeline` `.pipeline-column` `.pipeline-column-header` `.pipeline-cards`
`.division-tabs` `.division-tab` `.division-tab.active`
`.job-card-list`

### Misc
`.loading-page` `.spinner`
`.empty-state` `.empty-state-icon` `.empty-state-text` `.empty-state-sub` `.empty-state-title` (simpler 2-line, no-icon variant)
`.create-menu-container` `.create-menu-fab` `.create-menu-popup`

---

## Component Imports

```jsx
// ── Shared UI primitives (F-S2) — reach for these before a style object ──
import { Modal, StatusPill, EmptyState, ErrorState, PageHeader, SearchInput, IconButton, SkeletonBlock } from '@/components/ui';
//   Modal        role=dialog + focus trap + ESC/overlay close + mobile bottom-sheet
//   StatusPill   status→tone badge, reads --success/--danger/--warning/--info/--neutral tokens
//   EmptyState   success + zero-rows panel (icon/title/sub/action)  — NEVER on a failed load
//   ErrorState   failed-load panel (message + onRetry) — shape from TechJobDetail:330
//   PageHeader   title + subtitle + actions row
//   SearchInput  icon + controlled input + clear button (onChange gets the string)
//   IconButton   icon-only button — `label` is REQUIRED (a11y); light haptic on press
//   SkeletonBlock compact, static loading placeholder; parent owns the accessible status

// ── Shared hooks (F-S2) ──
import { useResumeRefetch } from '@/hooks/useResumeRefetch';   // silent resume/focus/poll refetch (no spinner)
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm'; // destructive-action arm/confirm
import { useLookup } from '@/hooks/useLookup';                 // cached react-query rosters: 'employees'|'job_phases'|'carriers'
import { usePhotoUpload, thumbUrl, publicUrl } from '@/hooks/usePhotoUpload'; // compress+upload; thumbnail vs full-res URLs

// Always available
import { useAuth } from '@/contexts/AuthContext';       // { db, employee, canAccess, isFeatureEnabled, featureFlags }
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import PullToRefresh from '@/components/PullToRefresh';
import ErrorBoundary from '@/components/ErrorBoundary';
import { IconSearch, IconOpenPage } from '@/components/Icons';
import { LookupSelect } from '@/components/AddContactModal';  // searchable dropdown — use outside Collections Kit pages
import DatePicker from '@/components/DatePicker';              // shared branded date picker (CRM uses CrmDatePicker)
import JobDetailPanel from '@/components/JobDetailPanel';

// Collections Kit pages only (Collections, Time Tracking, Invoice/Estimate editors) — see § Collections Kit
import { CollCard, GhostButton, PrimaryButton, SegControl, Kpi, KpiGrid, PopoverButton, StatusBadge, Pill } from '@/components/collections/collKit';
import { C, STATUS, DIV_COLOR, fmt$2, fmtDate } from '@/components/collections/collTokens';
import SearchSelect from '@/components/collections/SearchSelect';  // searchable dropdown — Collections Kit pages only
```

### `SkeletonBlock` — shared compact loading placeholder

Use `SkeletonBlock` only for a small supplemental value loading inside content that remains
rendered, such as metadata enrichment in an open picker. Route cold loads still use the loading
vocabulary above; do not replace a whole page, list, or stale result set with this primitive.

- **Props:** `width`, `height`, and `radius` accept CSS values; `style` permits a narrow
  composition override. Defaults use the shared spacing/radius tokens.
- **Visual contract:** static `--bg-tertiary` fill with `--border-light`; no kit-specific class,
  raw color, shimmer, or motion. It is therefore reduced-motion-safe in every shared surface.
- **Accessibility contract:** the block is always `aria-hidden`. Its parent owns `role="status"`
  plus a concise accessible label; never rely on the placeholder itself to announce loading.

```jsx
<div role="status" aria-label="Loading full claim details">
  <SkeletonBlock width="58%" height="var(--space-2)" />
</div>
```

---

## Tech Mobile token layer (`--tech-*`, scoped to `.tech-layout`)

The field-tech app (`src/pages/tech/**`, `src/components/tech/**`) is a third page-scoped
system. It scopes its own design tokens on the `.tech-layout` root in `index.css` — building
a tech screen, use these, not the global tokens. The **Tech Mobile v2** wave adds `tv2-*`
classes on top of the same tokens (see `.claude/rules/tech-v2-wave-ownership.md`).

### Sizing / type / shape tokens (defined on `.tech-layout`)

| Token | Value | Use |
|---|---|---|
| `--tech-text-body` | `15px` | Row/body copy |
| `--tech-text-label` | `12px` | Meta, chips, secondary lines |
| `--tech-text-heading` | `22px` | Page/section headings |
| `--tech-text-hero` | `28px` | Now/Next hero title |
| `--tech-text-timer` | `40px` | Live clock timer |
| `--tech-radius-card` | `16px` | Cards, list rows |
| `--tech-radius-button` | `14px` | Buttons, skeletons |
| `--tech-shadow-card` | (soft 2-layer) | Resting card elevation |
| `--tech-shadow-card-active` | (tight) | Pressed card |
| `--tech-min-tap` | `48px` | **Minimum touch target — no exceptions** (gloves/sun) |
| `--tech-row-height` | `56px` | Standard list row |
| `--tech-nav-height` | `64px` | Bottom tab bar height (safe-area math keys off this) |

### Status color palette — **status owns the color channel** (read from 3 feet)

Per `.claude/rules/tech-mobile-ux.md`. Each status has a `bg`/`color`/`border` trio as CSS
custom properties on `.tech-layout` — reference the token, never a hex literal:

| Status | Token prefix | Reads as |
|---|---|---|
| scheduled / confirmed | `--status-scheduled-*` | Blue |
| en_route (On My Way) | `--status-enroute-*` | Amber |
| in_progress (Working) | `--status-working-*` | Green |
| paused | `--status-paused-*` | Red |
| completed / cancelled | `--status-completed-*` | Gray |

Example (the v2 `StatusChip` pattern): `style={{ background: 'var(--status-working-bg)',
color: 'var(--status-working-color)' }}`. Division color is demoted to a small pill in v2 —
it must never out-shout status.

> Note: `src/pages/tech/techConstants.js` also exports `APPT_STATUS_COLORS` /
> `CLAIM_STATUS_COLORS` for JS-side lookups (dynamic inline styles). **As of 2026-07-30 those
> maps hold `var(--…)` strings, not hex** — and they read the **semantic**
> `--success|--danger|--warning|--info|--neutral` family, NOT the `--status-*` family above,
> because the dark block re-points only `--status-*-bg` and these render with a border (see the
> Dark-theme contract). Nothing to "keep in sync" any more: change the token, both follow. The
> `--status-*` tokens above remain canonical for the CSS-side v2 `StatusChip` surfaces that
> already consume them, and are `.tech-layout`-scoped — a module shared with a desktop page
> (e.g. `src/lib/oopPricing.js`) must use the `:root` semantic family instead.

---

## Anti-Patterns (do not do these)

- ❌ `alert()` or `confirm()` — use `src/lib/toast.js` + two-click confirm
- ❌ Import `db` directly — always `const { db } = useAuth()`
- ❌ Hardcoded colors (`#2563eb`) in new code — use `var(--accent)`
- ❌ Hardcoded spacing (`16px`) in new code — use `var(--space-4)`
- ❌ `localStorage` for state — use React state
- ❌ CSS transforms for show/hide on mobile — use display toggling
- ❌ `window.confirm` for destructive actions — use two-click confirm pattern
- ❌ Font size < 16px on mobile inputs — triggers iOS auto-zoom
- ❌ Redefining constants that are imported (e.g. DIVISION_COLORS, LOSS_CONFIG) — causes build errors
- ❌ Creating new CSS files — all styles go in `index.css` or inline styles. **Narrow exception
  (budget-driven, used by `claim-page.css`, `NotificationPresentation.css`, `TechOnboarding.css`):**
  a ROUTE-LAZY component may carry its own component-scoped stylesheet when `index.css` is at or
  near its CI-enforced size ceiling (`perf-budget.md` §1) — the styles then ride the lazy chunk
  instead of the boot path. The file states this justification in its header; eagerly-loaded
  surfaces still belong in `index.css`.
- ❌ New utility classes without checking if they already exist in index.css
- ❌ `100vh` for full-screen pages — use `100dvh` (handles iOS Safari toolbar)
