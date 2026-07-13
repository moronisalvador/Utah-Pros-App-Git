# UPR Motion Rollout — Skill-Authored Work-List

*Assembled 2026-07-13 from the `improve-animations` per-fix plans across 6 code slices (legacy tech pages · desktop list/board · desktop detail/editor · modals & overlays · shared components · global `index.css` layer). Every item cites `file:line`, the sanctioned idiom, and the skill that authored it. This is the work-list the build waves execute.*

---

## 1. Executive summary

**71 authored fixes** across the six slices, deduped to **~66 actionable work items** (the `index.css` `transition: all` sweep and the triple-`fadeIn` bug are each authored in two slices — see the dedup notes in §2). By disposition:

- **13 P0 / ~24 P1 / ~34 P2.**
- **16 items are frozen** (owned by in-flight initiatives — Job Hub H3, sms-experience, CRM, tech-v2, admin-mobile, Schedule Desktop, and — conditionally — Settings-Overhaul P3) and route to the **fold-in ledger** (§2, last block) — no in-wave edit.
- **4 items need the scoped gesture/spring foundation util** (none exists yet in `src/hooks/`) and land last, owner-feel-gated.
- The rest are small tokenization / reduced-motion / press-feedback / view-transition-opt-in edits that ride idioms F-S2 **already shipped** (`--motion-*` tokens at `index.css:88-112`, the global `@view-transition` gate at `index.css:11546-11581`, the shared `Modal` primitive, `.btn`/`.ui-icon-btn` press at `:11586`/`:11745`, `.create-menu-popup` origin-aware menu spring).

**The fastest felt change comes from two flag-independent edits — the base `.btn` press and the toast rebuild — not from the View-Transitions push, which stays dark until the owner graduates a flag.** Both land in Wave 1:

1. **Base `.btn` press feedback (`index.css:244-252`, P0, `emil`)** — the base button used on every desktop money/claims/detail page currently has `transition: all` and *no `:active`*, so every button feels dead on press. Adding the shipped `scale(0.97)` idiom lights up the whole desktop surface in one edit. **Animates immediately, no flag.**
2. **Toast enter/exit rebuild (`Layout.jsx:302-327`, P0, `motion-standard-v2` — pulled forward from the old toasts wave)** — the app's most-seen feedback channel today has a bare enter and *no exit animation at all*. **Animates immediately, no flag** — this is why it moves up next to the `.btn` press.

The **higher-*ceiling*** lever — the View-Transitions push (six `{ viewTransition: true }` list→detail opt-ins in `Jobs/ClaimsList/Customers/Leads/Estimates/Production` + the `ClaimsList:269` full-reload replacement, P0, `motion-standard-v2`) — is correct to ship in Wave 1 (one argument per call, using the shipped `@view-transition` mechanism), **but it only *animates* once the owner graduates `feature:page_transitions`** (`App.jsx:604`, currently owner-gated — §4). Until that flag graduates an owner who "sees nothing yet" will still see nothing from these opt-ins, so `Collections.jsx`'s `usePageTransition` (FL-3) remains the correct always-on page motion. **Graduating `feature:page_transitions` is an explicit Wave-1 owner rollout step** (§4).

Running mate to those levers: the **behavior wave's loading-gate fix** removes the *most-felt regression* — seven tech pages call `setLoading(true)` inside a `load()` that is also `onRefresh`, so every pull-to-refresh blanks the rendered screen to a route spinner mid-gesture (`page-lifecycle §1`).

**CSS budget note (binding):** `index.css` is **~396.6 KB / 400 KB** (`perf-budget.md §1`) — only ~3.4 KB headroom. **Wave 0 runs first and is pure net-negative CSS** (keyframe dedup: `fadeIn`×3, `sheetSlideUp`×2, `slideInRight`, `ptrSpin`), reclaiming headroom *before* any CSS-adding wave (1/2/3/5) spends it — this is the ordering fix. **Wave 2 commits to full `<Modal>` migration** (retiring `.conv-modal*`/`.appt-modal`/`.admin-modal`/`.tt-modal` selectors → net-negative), not the additive CSS-only fallback, so it does not eat the reclaimed space. **Every wave PR records the running `index.css` KB** (not just the perf wave), and any wave whose net delta is positive owes a dedup elsewhere.

---

## 2. Wave plan

Ordered: **CSS reclaim → press-nav + toast → modals → pills-focus → behavior → a11y-i18n → perf → gesture**, then the **fold-in ledger**. Each fix is a one-line self-contained instruction. Frozen items appear only in the ledger.

> **`index.css` coordination (all waves):** every wave writes CSS only inside its reserved marker; Wave 0's dedup lands first and the Wave 6 sweeps are sequenced against the other index.css writers (see §4). Existing high-frequency-instant controls are called out per wave as **do-not-animate**. Every wave PR records the running `index.css` KB.

---

### Wave 0 — CSS reclaim & keyframe correctness  *(effort: Small · net-negative CSS · runs FIRST)*

**Owned files:** `src/index.css` only (keyframe registry).
**Why first:** reclaims the ~3.4 KB headroom before any CSS-adding wave spends it (fixes the budget-sequencing gap), and lands the P0 `fadeIn` correctness fix *before* Wave 4 consumes `fadeIn`.

**P0**
- `index.css:973/3046/4382` — **correctness bug + dedup:** keep one `@keyframes fadeIn { from{opacity:0} to{opacity:1} }` (`:973`), delete the identical `:4382`, rename the fade+rise `:3046` body → `fadeInUp` and repoint `.create-job-details-section` (`:3043`) at it (restores its lost slide) + add reduced-motion. *(motion-standard-v2)* — **dedup note:** same fix authored twice (slice 3 `S3-8` ≡ slice 6 `S6-1`); execute once. Lands before Wave 4 (`InvoiceEditor:888/891` reference `fadeIn`) and before any other consumer.

**P1**
- `index.css:1251/4392 + 974/3209` — delete the duplicate `@keyframes sheetSlideUp` (`:4392`) and `slideInRight` (`:3209`), repoint `.customer-detail-panel` (`:3206`) at `slideIn`; identical bodies, net-negative. *(motion-standard-v2)*

**P2**
- `index.css:716/845/1231` — delete `@keyframes ptrSpin` (`:1234`), point `.ptr-spinner` at the shared `spin`; standardize spinner tempo (~0.7s); leave frozen `fbm-spin`/`tv2-msgs-spin` to fold-in. *(review-animations)*

---

### Wave 1 — press-nav + toast  *(effort: Medium · ~12 items, 8S/4M)*

**Owned files:** `src/index.css` (base `.btn`, `.coll-primary/.coll-ghost`, `.create-menu-fab`, reserved marker), `src/components/Layout.jsx` (toast container + keyframes → reserved marker), `src/pages/Jobs.jsx`, `ClaimsList.jsx`, `Customers.jsx`, `Leads.jsx`, `Estimates.jsx`, `Production.jsx`, `JobPage.jsx`, `ClaimPage.jsx`, `CustomerPage.jsx`, `src/pages/tech/TechClaimDetail.jsx`, `TechDemoSheet.jsx`, `TechClaims.jsx`, `TechTasks.jsx`, `TechNewJob/TechNewCustomer/TechNewAppointment/TechNewEvent/TechEditAppointment.jsx`.

> **Layout.jsx authorization (cite in the PR):** the toast rebuild edits `Layout.jsx` JSX, which the ux-align manifest §1 lists as frozen shell. This edit is the sanctioned **toast-codemod** work — the manifest names the toast sweep as an owned codemod, and the H8 `TechLayout` toast-token exception is the precedent for toast edits to a layout shell. The PR must cite this authorization explicitly so the edit does not read as a frozen-file breach.

**P0**
- `index.css:244-252` — add `.btn:active:not(:disabled){ transform: scale(0.97) }`, narrow `transition: all` → named props on `var(--motion-duration-fast) var(--motion-ease-standard)`, add `touch-action: manipulation` + reduced-motion `transform:none`; mirror the shipped `.tech-layout .btn:active` (`:4974`). *(emil)*
- `Layout.jsx:302-327` — move the inline `slideUp` keyframe into the reserved marker as `uprToastIn` on `var(--motion-spring-in)`; **add an exit**: a `leaving` flag drives `uprToastOut` (opacity→0 + `translateY(-8px)` on `--motion-ease-accelerate`) removed on `animationend` (mirror `ui/Modal.jsx`'s exit lifecycle + ~220 ms safety timeout); wrap both in reduced-motion. **Flag-independent — ships visible immediately.** *(motion-standard-v2)*
- `Jobs.jsx:218, ClaimsList.jsx:189, Customers.jsx:80, Leads.jsx:54, Estimates.jsx:146, Production.jsx:326` — add `{ viewTransition: true }` as the 2nd arg to each list→detail `navigate()` so the directional root push (`html.ui-vt::view-transition(root)`, `index.css:11564-11567`) fires; exemplar `Sidebar.jsx:64`. **Correct to ship, but only animates once `feature:page_transitions` graduates (§4).** *(motion-standard-v2)*
- `ClaimsList.jsx:269` — replace the `window.location.href = '/jobs/'+id` full reload with `navigate('/jobs/'+j.id, { viewTransition: true })` (keep `e.stopPropagation()`); the named `page-lifecycle §5` offender. *(motion-standard-v2)*

**P1**
- `index.css:8015-8018` — add `.coll-primary:active,.coll-ghost:active{ transform: scale(0.97) }`, swap `transition: background .12s` → tokened `background,transform`, add `touch-action` + reduced-motion guard; **keep crisp — no bounce on a money button**. *(emil)*
- `JobPage.jsx:142,177,207,964 · ClaimPage.jsx:221,308,434,645,649,704 · CustomerPage.jsx:102,117,141-142` — add `{ viewTransition: true }` to each content `navigate()`/`navigate(-1)`; leave `{ replace:true }` guard-redirect bounces (`JobPage:75/116`, `ClaimPage:193`, `CustomerPage:78`) instant. *(motion-standard-v2)*
- `Estimates.jsx:146-164` — give estimate rows an `.est-row` class + (in reserved marker) `background`-swap `:hover`/`:active` on tokens (row idiom, **not** scale). *(emil)*
- `TechClaimDetail.jsx:239,242,545` — delete the `entering`/`requestAnimationFrame(setEntering)` state + the conditional `' tech-page-enter'` class; render plain `tech-page` and rely on the global `@view-transition` (retires the double-animation, `motion-standard §2`). *(motion-standard-v2)*
- `TechDemoSheet.jsx:1307` — rewrite `.demo-sheet button:active` to scale-only `:not(:disabled)` + add a `transition: transform var(--motion-duration-fast)…` base + reduced-motion `transform:none` (drop the `opacity:0.7`). *(motion-standard-v2)*
- `TechClaims.jsx:139 scope pills + TechTasks.jsx:242 tabs` — add a shared `.tech-pill` class + scoped `:active{ transform:scale(0.97) }` **press only** with reduced-motion guard (or `className="btn"`). No transition on the selection change here — see the frequency-tier note. *(motion-standard-v2)*

**P2**
- `TechNewJob/TechNewCustomer/TechNewAppointment/TechNewEvent/TechEditAppointment.jsx` (primary Save/submit buttons, e.g. `TechNewJob:393,579,600,614`) — add `className="btn"` (or the scoped `:active` scale) so Save/submit inherit press feedback; don't restyle colors/spacing. *(motion-standard-v2)*
- `index.css:1166-1168` — add `.create-menu-fab:active:not(.active){ transform:scale(0.97) }`, gate the hover-scale behind `@media (hover:hover) and (pointer:fine)`, add reduced-motion guard. *(apple-design)*

**Frequency-tier — DO NOT animate:** task checkbox and the `TechTasks`/`TechClaims` tabs & scope pills are touched here for **press scale only**. **Add no transition on the selection-change itself** in this wave — the selection treatment is adjudicated once, in Wave 3 (scope pill = occasional → fast cross-fade OK; task-list tabs = borderline → stay instant). This note and Wave 3's are reconciled (see §7-critique fix / Wave 3).

---

### Wave 2 — modals  *(effort: Large · ~10 items, 2L/3M/5S · net CSS delta ≤ 0)*

**Owned files:** `src/components/{AddContactModal,AddRelatedJobModal,CreateJobModal,EditContactModal,NewEstimateModal,NewInvoiceModal,SendEsignModal,CreateAppointmentModal,EditAppointmentModal}.jsx`, `src/pages/settings/Team.jsx` *(conditional — see precondition)*, `src/pages/TimeTracking.jsx`, `src/pages/{JobPage,ClaimPage,EstimateEditor,InvoiceEditor}.jsx` (inline-overlay containers only), `src/components/{UserMenu,NewMenu,TopNav,AddressAutocomplete}.jsx`, `src/components/collections/collKit.jsx`, `src/index.css` (backdrops, reserved marker — **references `var(--motion-ease-drawer)`, does not define it**).

> **Precondition A — token freeze (`--motion-ease-drawer`):** the ux-align manifest §1 freezes the `:root` motion-token block (`index.css:88-112`) to **F-S2**. Wave 2 must NOT add the token. **An F-S2 follow-up adds `--motion-ease-drawer: cubic-bezier(.32,.72,0,1)` to `:root` and lands before Wave 2**; Wave 2 only *references* `var(--motion-ease-drawer)`. If the follow-up hasn't landed, Wave 2's drawer-ease items block on it.
> **Precondition B — Settings-Overhaul ownership:** `settings/Team.jsx` is Settings-Overhaul **Session C (P3 Team & Access)** territory (manifest has a 2026-07-07 Wave-2 addendum — may still be in flight). **Confirm P3 has merged before Wave 2 touches `Team.jsx`.** If P3 is still in flight, `Team.jsx`'s modal migration is a **fold-in to Session C (FL-13)**, not a Wave 2 edit. `TimeTracking.jsx` is `src/pages/TimeTracking.jsx` (not a `settings/` page) and is not held by that wave — confirm and proceed.
> **Net-CSS commitment:** Wave 2 **commits to full `<Modal>` migration** as the default; the CSS-only fallback is permitted only where migration is genuinely blocked AND it reuses existing keyframes (**zero new keyframes**). The selector retirements (`.conv-modal*`, `.appt-modal`, `.admin-modal`, `.tt-modal`) make the wave's net `index.css` delta **≤ 0** — verified in the DoD.

**P0**
- `AddContactModal.jsx:155, AddRelatedJobModal.jsx:97, CreateJobModal.jsx:286, EditContactModal.jsx:102, NewEstimateModal.jsx:160, NewInvoiceModal.jsx:124, SendEsignModal.jsx:171` (+ `.conv-modal` CSS `:598-611,1481-1487`) — migrate all 7 to the shared `<Modal>` from `@/components/ui` (inherits `uiModalIn` desktop scale + `uiSheetUp` mobile + exit lifecycle + focus-trap + `role=dialog`); keep mounted via `open`; **retire dead `.conv-modal*` selectors after all 7 migrate (net-negative — the wave's headroom source).** *(motion-standard-v2)*

**P1**
- `JobPage.jsx:219, ClaimPage.jsx:494` (delete-confirms) · `EstimateEditor.jsx:495, InvoiceEditor.jsx:818` (previews) · `InvoiceEditor.jsx:904` (payment sheet) — convert the five hand-rolled `position:fixed` overlays to shared `<Modal>` (default) or, only if blocked, minimally apply `modal-overlay`/`modal-panel` classes reusing existing keyframes; keep the two-click-confirm content; **no spring bounce on the payment sheet**. *(impeccable)*
- `CreateAppointmentModal.jsx:194, EditAppointmentModal.jsx:313` (+ `.appt-modal` `:1826-1846`) — migrate to `<Modal size='lg'>` (default; retires `.appt-modal` → net-negative); fallback only if blocked: reuse `uiModalIn`/`uiSheetUp`/`uiFadeIn` (`:11673-11678`, define no new keyframes) + reduced-motion guard. *(motion-standard-v2)*
- `Team.jsx` `.admin-modal`/`.admin-modal-overlay` (`:2265,1753-1767`) — **conditional on Precondition B.** Migrate to `<Modal>` (retires `.admin-modal` → net-negative); fallback only if blocked: `uiModalIn`+`uiSheetUp`+`uiFadeIn`+reduced-motion in the reserved marker. *(motion-standard-v2)*
- `TimeTracking.jsx` `.tt-modal`/`.tt-modal-backdrop` (`:3681-3695,1810-1823`) — migrate to `<Modal size='lg'>` (retires `.tt-modal` → net-negative); fallback only if blocked, same reuse rule. *(motion-standard-v2)*
- `UserMenu.jsx:68 / NewMenu.jsx / TopNav.jsx` `.topnav-menu` (`:7800-7818`) — add `transform-origin: top right; animation: createMenuIn 150ms var(--motion-spring-in)` (reuse the `:1174` keyframe) + include in the reduced-motion group; mirrors the `.create-menu-popup` gold standard. *(apple-design)*
- `collKit.jsx` `.coll-popover` (`:8095`) — add `transform-origin: top right; animation: createMenuIn 150ms var(--motion-spring-in)` + reduced-motion group. *(emil)*
- `.phase-picker-sheet:1250` / `.ar-sheet:4389` — swap both raw beziers → `var(--motion-ease-drawer)` (defined by the F-S2 follow-up, Precondition A) and `250ms` → `var(--motion-duration-base)`. *(apple-design)*

**P2**
- `AddressAutocomplete.jsx / AddContactModal.jsx` `.lookup-select-dropdown` (`:3446-3454`) — add `transform-origin: top; animation: createMenuIn 150ms var(--motion-spring-in)` + reduced-motion; **DROP this fix if the dropdown re-renders per keystroke** (frequency-tier — it would flash while typing). *(emil)*
- `Layout.jsx` `.sidebar-backdrop` (`:1321`) + `Schedule.jsx` `.schedule-panel-backdrop` (`:1279`) — CSS-only: add `animation: uiFadeIn calc(var(--motion-duration-base)*0.6) var(--motion-ease-standard)` + reduced-motion (no JSX change, so the frozen shell/Schedule files are untouched). *(motion-standard-v2)*

**Frequency-tier — DO NOT animate:** the GlobalSearch live-results dropdown stays instant (not targeted).
**A11y payoff:** migrating (vs CSS-only fallback) delivers `role=dialog` + focus-trap + ESC + scroll-lock for free — reviewed in the a11y-i18n wave (S4-15). The net-CSS commitment above makes migration the default precisely so this payoff is realized wave-wide.

---

### Wave 3 — pills-focus-toggles  *(effort: Small-Medium · ~5 items, 2M/3S)*

**Owned files:** `src/index.css` (`.ovw-seg-btn`, `.coll-seg-btn`, `.tech-settings-seg-btn`, `.input` focus, `.admin-toggle`, reserved marker), `src/pages/tech/{TechClaims,TechDemoSheet}.jsx` selection classes.

**P0**
- `index.css:7596-7599` (`.ovw-seg-btn`) + `:8022-8025` (`.coll-seg-btn`) — convert each segmented group to a positioned sliding-pill indicator (`::after` translated via `transform` on `--motion-duration-fast`); minimum acceptable is tokenizing the existing cross-fade; reduced-motion `transition:none`. These are occasional-use switches, so a sliding pill is appropriate. **The pill's `translateX` travel math is verified at 390px (minor-critique fix — see §4/§3).** *(motion-standard-v2)*

**P1**
- `index.css:4573-4584` (`.tech-settings-seg-btn`) — the clearest true SNAP: add a tokened `background,color,border-color,box-shadow` transition + reduced-motion; on native also fire `nativeHaptics.selection()` in the section onClick. *(motion-standard-v2)*
- `index.css:267-269` (`.input`) — add `box-shadow` to the focus transition so the ring eases in with the border (opacity/shadow only, GPU-cheap); apply to `topnav-search-input:7766` too. *(emil)*

**P2**
- **Selection cross-fade — occasional-use ONLY (reconciled with Wave 1):** `TechClaims.jsx:143 scope pills` (mine/all — occasional) + `TechDemoSheet.jsx:1393 tech-select` — add a class + a **fast** cross-fade of `background/color/border-color` on `--motion-duration-fast` + reduced-motion, **with no lingering/sliding indicator**. **`TechTasks.jsx` tabs are EXCLUDED** — a task-list tab swap is borderline-high-frequency, so its selection change **stays instant** (Wave 1 gave it press scale only). This resolves the Wave 1 ↔ Wave 3 conflict: only genuinely occasional selection surfaces get the fast cross-fade. *(motion-standard-v2)*
- `index.css:2438-2478` (`.admin-toggle`) — retune the three transitions to `var(--motion-duration-fast) var(--motion-ease-standard)` (behavior-identical); optional `nativeHaptics.selection()` on flip. *(motion-standard-v2)*

**Frequency-tier — DO NOT animate:** the Estimates mode-tabs (`Estimates.jsx:124-127`), the `TechTasks` task-list tabs, and any high-frequency filter tabs stay instant — animating their selection fill is a regression. `StatusPill` correctly has no motion — not touched.

---

### Wave 4 — behavior  *(effort: Small-Medium · ~7 items, 5S/2M)*

**Owned files:** `src/pages/tech/{TechTasks,TechClaims,TechClaimDetail,TechRoomDetail,TechJobAlbum,TechClaimAlbum,TechJobDocuments}.jsx`, `src/pages/{Estimates,TimeTracking,ClaimPage,InvoiceEditor}.jsx`.

> **Prerequisite:** the `fadeIn`→`fadeInUp` split (Wave 0 P0) must have landed — `InvoiceEditor:888/891` below reference `fadeIn`. Wave 0 running first guarantees this.

**P0**
- `TechTasks.jsx:173/229/313` — guard `setLoading(true)` to cold-start only (an `initialLoad` ref, or drop it and let `useState(true)` cover it) so PTR (`onRefresh`) refetches silently in place; `page-lifecycle §1`, gold `TechAppointment.jsx`. *(motion-standard-v2)*
- `TechClaims.jsx:77/122/174` — same cold-start guard so **both** PTR and the `scope` mine/all pill switch (`:139`, in the effect dep) refetch silently; keep rows visible. *(motion-standard-v2)*

**P1**
- `TechClaimDetail.jsx:249/562` — guard `setLoading(true)` to cold-start so PTR refetches the claim in place (pairs with the entering-retire in press-nav on this file). *(motion-standard-v2)*

**P2**
- `TechRoomDetail.jsx:87 / TechJobAlbum.jsx:62 / TechClaimAlbum.jsx:75 / TechJobDocuments.jsx:101` — same cold-start guard so photo grids don't blank mid-scroll on refresh. *(motion-standard-v2)*
- `Estimates.jsx:133` + `TimeTracking.jsx:554,799` — replace bare "Loading…" text with a shipped primitive: Estimates route cold-load → `.loading-page` spinner; TimeTracking panels → `.coll-skel` shimmer (`:813`) or `<TabLoading/>`; verify the shimmer keeps its reduced-motion guard. *(motion-standard-v2)*
- `ClaimPage.jsx:582,616-618` — make `.claim-ops-job-expand` always-mounted with a `grid-template-rows: 0fr→1fr` transition (`.is-open` modifier, inner `overflow:hidden;min-height:0`) instead of conditional render; tokenize the chevron `transform` transition; reduced-motion collapses to instant. *(apple-design)*
- `InvoiceEditor.jsx:888,891` — swap the two inline `animation:'fadeIn .2s ease'` for `'fadeIn var(--motion-duration-fast) var(--motion-ease-standard)'` (consumes the Wave 0 canonical `fadeIn`); leave the `spin` spinner and the `key={xactStage}` re-fire. *(motion-standard-v2)*

**Frequency-tier — DO NOT animate:** tab-content swaps in `JobPage/CustomerPage/Collections/DevTools` stay instant — animating them is a frequency-tier regression, none planned.

---

### Wave 5 — a11y-i18n  *(effort: Small · ~6 items, all S)*

**Owned files:** `src/index.css` (reduced-motion guard blocks), reviewer verification only on the migrated modals.

**P1**
- `index.css:4925-4931` — append `@media (prefers-reduced-motion: reduce){ .tech-page-enter{ animation:none } }` (unblocks `§6` for the still-frozen `TechAppointment`/`TechJobDetail` until H3 deletes them). *(motion-standard-v2)*
- `index.css:4941` — append `@media (prefers-reduced-motion: reduce){ .tech-check-pop{ animation:none } }`; **keep the pop keyframe — it's the reference selection-confirm idiom.** *(motion-standard-v2)*
- **Migrated modals (Wave 2 output)** — verification item: confirm each migrated dialog is `role=dialog`, Tab-trapped, ESC-closable, body-scroll-locked; file a separate a11y gap for any modal left on the CSS-only fallback. *(impeccable)*
- `index.css` (consolidated block) — add one `@media (prefers-reduced-motion: reduce){ … animation:none !important }` block covering `.job-detail-panel(-header)`, `.customer-detail-panel`, `.create-job-details-section`, `.ar-sheet(-overlay)`, `.phase-picker-overlay/-sheet`, `.coll-chat-panel`; exclude frozen namespaces. *(motion-standard-v2)*

**P2**
- `index.css:896-897` (`.macro-card`) — wrap the hover `translateY(-2px)` in `@media (hover:hover) and (pointer:fine)` (keeps sticky-hover off touch) + add reduced-motion `transform:none`. *(motion-standard-v2)*
- `index.css:7660-7661` (`.ovw-live-dot`) — add `@media (prefers-reduced-motion: reduce){ animation:none; opacity:1 }` (drop the perpetual `scale` pulse; opacity-only at most). *(motion-standard-v2)*

---

### Wave 6 — perf  *(effort: Medium · ~6 items · net CSS delta ≤ 0)*

**Owned files:** `src/index.css` only (token sweeps, reserved marker), `src/pages/tech/TechTasks.jsx` (progress var).

> Wave 0 already landed the P0 `fadeIn` correctness fix and the `sheetSlideUp`/`slideInRight`/`ptrSpin` keyframe dedups. Wave 6 now holds the property-list / transform / raw-literal sweeps.

**P1**
- `index.css:1029` (`.job-list-card`) + `:892` (`.macro-card`) — replace `transition: all` with the named property set on tokens; **no scale press on the cards** (`:active` background-swap is the correct row idiom). *(motion-standard-v2)*
- `index.css:1005,1075,3533,3553,1166` (`.division-tab/.job-page-tab/.tt-view-tab/.tt-period-tab/.create-menu-fab`) — replace `transition: all` with explicit tokened property lists. *(impeccable)*

**P2**
- `index.css` — **global `transition: all` sweep (×35):** replace each with the explicit property list the rule changes (usually `background,color,border-color` + `transform` where a press/hover scale exists), mirroring `.btn` at `:11586`; **exclude `.react-grid-layout`/`.react-grid-item` (`:7677/:7678`) and frozen-namespace lines.** *(emil)* — **dedup note:** subsumes the `.job-list-card/.macro-card` (P1 above), `job-page-*` (`:1010-1126`) and `.division-tab` P1 items — execute those specific selectors as part of this one sweep, not twice.
- `index.css` — **raw duration literal sweep (~24):** `200ms ease`→`var(--transition-base)`, `120ms ease`→`var(--transition-fast)`, `100/160ms`→`var(--motion-duration-fast)`, `250ms` slides→`var(--motion-duration-base)`; exclude react-grid-layout + frozen namespaces. *(motion-standard-v2)*
- `index.css` `job-page-*` interactive controls (`:1010,1028,1052,1080,1126`) — replace `transition: all var(--transition-fast)` with the intended named set (scope to this slice's interactive selectors only). *(motion-standard-v2)*
- `index.css:9952/10445` (toggle knobs) — animate `transform: translateX()` not `left` (off-GPU); tokenize the `:10445` `0.15s`; verify knob lands flush at both ends on desktop + 390px. *(emil)*
- `index.css:4690` (`.tech-task-progress-fill`) + `:4305,4694` (`.ar-claim-progress-fill`) — drive progress with `transform: scaleX(var(--pct))` + `transform-origin:left` (JS sets the var); reduced-motion fallback. **Only where the fill is a plain bar** (scaleX distorts radius/labels). *(review-animations · motion-standard-v2)*

---

### Wave 7 — gesture  *(effort: Large · owner-feel-gated · 3 items)*

**Owned files:** new `src/hooks/useSpring` (+ optional `useDragToDismiss`), `src/components/PullToRefresh.jsx`, `src/components/ui/Modal.jsx` (mobile-sheet drag), `src/pages/tech/TechTasks.jsx` (`SwipeTaskRow`).

**P2 — all `needsSpringOrGesture: true`; the util is a prerequisite (referenced as "task #14"):**
- `PullToRefresh.jsx:129,154-155` — **build the scoped spring/pointer util here** (critically-damped integrator, damping ~1.0 / response ~0.35): capture release velocity from a short pointermove history, spring `translateY` back to 0, add rubber-band friction past threshold, reduced-motion = instant reset. **This unblocks the other two.** *(apple-design)*
- `TechTasks.jsx:118-145` (`SwipeTaskRow`) — on release, animate `swipeX` via the util (Apple `{ duration:0.5, bounce:0.2 }`) instead of the instant style flip; rising friction near the threshold; velocity-keyed commit; reduced-motion instant. *(apple-design)*
- `ui/Modal.jsx` mobile sheet + legacy `.phase-picker-sheet`/`.ar-sheet` — add an optional `useDragToDismiss` (Pointer Events + `setPointerCapture`, projection `decel ~0.998`, dismiss if projected past ~40% or velocity/distance > ~0.11, else spring back; reuse `uiSheetDown` for programmatic close; reduced-motion tap-only). **Do not hand-roll per sheet.** *(apple-design)* — **dedup note:** slice 4 `S4-14` and slice 5 `S5-9` are the same sheet-drag work item; build once on the shared Modal, legacy sheets adopt opportunistically.

---

### Fold-in ledger — frozen surfaces (no in-wave edit; route to owning initiative)

| # | Surface | Route to | The idiom to apply when touched | Skill |
|---|---|---|---|---|
| FL-1 | `TechAppointment.jsx:109,128,573` (entering slide + double-animate) | **Job Hub H3** (file deletion retires it) | none — deletion resolves; `.tech-page-enter` reduced-motion guard (Wave 5) covers the interim | motion-standard-v2 |
| FL-2 | `TechJobDetail.jsx:162,174,360` (entering + `setLoading(true):181`) | **Job Hub H3** (deletion) | deletion retires both the slide and the loading-gate flash | motion-standard-v2 |
| FL-3 | `Collections.jsx:64,103` `usePageTransition` → `.page-slide-fwd/back` (also `InvoiceEditor:141`, `ClaimCollectionPage:23`) | **F-S2 / VT-flag owner** (not frozen, but sequenced) | retire the ad-hoc slide only once `feature:page_transitions` graduates to all users; then delete `usePageTransition` + `convSlide` keyframes app-wide | motion-standard-v2 |
| FL-4 | `Schedule.jsx` (list/board row-opens, any entering) | **Schedule Desktop (W2)** | row→detail `navigate()` gets `{ viewTransition:true }`; reuse `.btn`/row background-swap idioms | motion-standard-v2 |
| FL-5 | `Marketing.jsx` (future campaign rows / +New) | **CRM 4b/5-Ops** | inherit list→detail push + row background-swap when the real list is built | motion-standard-v2 |
| FL-6 | `Conversations.jsx` `.conv-actions-sheet:448`, `.conv-context-menu:583`, `.conv-dnd-toggle:557-569` | **sms-experience Phase C** | sheet/menu enter (`createMenuIn`/`uiSheetUp` on tokens, origin-aware) + toggle token retune + reduced-motion | motion-standard-v2 / apple-design |
| FL-7 | `MessageBubble.jsx` (+ chat bubble CSS) — sent/received enter | **sms-experience Phase C** | sent bubble up-from-composer, incoming fade+scale 0.98→1 on `--motion-ease-decelerate` (ref `collChatIn`); in-place optimistic reconcile; `impact('light')` on send | motion-standard-v2 |
| FL-8 | `RichEmailEditor.jsx` `.crm-editor-menu:8723/.crm-editor-popover:8718/.crm-editor-ai-popover:8734` | **CRM initiative** | `transform-origin: top left; createMenuIn 150ms var(--motion-spring-in)` + reduced-motion (reuse shared keyframe) | emil |
| FL-9 | `CrmTasks/CrmLeads` `.crm-panel-overlay:8542` | **CRM wave** | fade overlay (`uiFadeIn`) + slide panel from right edge on tokens + reduced-motion | motion-standard-v2 |
| FL-10 | `tech/v2` `.tv2-dash-menu:5703`, `.tv2-segmented button.is-active:5134` | **tech-v2 wave** | dash-menu origin-aware spring; `.tv2-segmented` cross-fade/sliding-pill + reduced-motion (inside TECH-V2 marker) | apple-design / motion-standard-v2 |
| FL-11 | `.am-awaiting-pulse:7304 / .crm-awaiting-pulse:8430` (infinite pulses, no reduced-motion) | **admin-mobile / CRM** | add reduced-motion `animation:none;opacity:1` inside the owning reserved marker | motion-standard-v2 |
| FL-12 | Frozen-namespace duplicate keyframes: `fbm-spin:9525`, `tv2-msgs-spin:11422`, `tv2-shimmer:5074`, `am-dash-shimmer:6652`, `ovwShimmer:7649`, plus the pulses in FL-11 | **each owning wave** | replace clone with shared `spin`/shared shimmer/pulse + confirm reduced-motion guard as each file is next touched | motion-standard-v2 |
| FL-13 | `settings/Team.jsx` `.admin-modal`/`.admin-modal-overlay` (`:2265,1753-1767`) — **conditional** | **Settings-Overhaul Session C (P3)** — ONLY IF P3 has not merged when Wave 2 runs | migrate to `<Modal>` (or `uiModalIn`+`uiSheetUp`+`uiFadeIn`+reduced-motion) inside P3's owned scope | motion-standard-v2 |

**Dedup within the ledger:** FL-6's non-frozen sibling sheets (`.ar-sheet`, `.phase-picker-sheet`) token/keyframe consolidation is **not** frozen — it is executed in Wave 0 (`sheetSlideUp` dedup) and Wave 2 (`var(--motion-ease-drawer)` swap). Only the `Conversations.jsx`-owned `.conv-*` selectors are frozen here. FL-13 is live only while Settings-Overhaul P3 is in flight; if P3 has merged, `Team.jsx` reverts to a normal Wave 2 item (Precondition B).

---

## 3. Per-wave "definition of done" + gate

Every wave runs the standard close-out (`.claude/rules/close-out-standard.md`): `npm run test` + `npm run build` + `npx eslint` (changed files) → the reviewer gauntlet (**`upr-pattern-checker`** always; **`design-consistency-checker`** + **`page-behavior-checker`** on any `src/pages`|`src/components` change) → the **minimize/resume test** (30 s+ background, nothing moves) → **390 px mobile check** → **perf delta vs `perf-budget.md`** (record top-5 chunk deltas **+ the running `index.css` KB — every wave, not just perf**) → docs + roadmap reconcile → PR to `dev`, stop. **Additionally, `review-animations` gates each wave** with a wave-specific checklist:

| Wave | DoD (wave-specific) | What `review-animations` checks |
|---|---|---|
| **CSS reclaim** | One `@keyframes` per name; `fadeIn`→`fadeInUp` split done + `.create-job-details-section` slide restored; `sheetSlideUp`/`slideInRight`/`ptrSpin` duplicates deleted; **net `index.css` delta < 0** (records the new KB as the headroom baseline for later waves). | No keyframe defined twice; `fadeInUp` carries reduced-motion; no consumer left pointing at a deleted clone; KB dropped. |
| **press-nav + toast** | Every touched button presses with `scale(0.97)`; toast has tokened enter **and** exit + reduced-motion; all six list `navigate()`s + the three detail files opt into `viewTransition`; `ClaimsList:269` no longer full-reloads; no selection transition added to checkbox/tabs/pills; **Layout.jsx toast-ownership authorization cited in the PR**; owner reminded to graduate `feature:page_transitions` (§4). | No `transition: all` on a control that got a press; toast exit lifecycle matches `ui/Modal.jsx`; press scale rides the transform token (not `all`); no new page-level `entering` pattern; forward/back direction honored; reduced-motion present on every new `:active`/toast keyframe. |
| **modals** | All non-frozen dialogs are shared `<Modal>` (CSS-only fallback only where migration is blocked, zero new keyframes); dropdowns scale from trigger origin; `var(--motion-ease-drawer)` referenced (never defined here); `.conv-modal*`/`.appt-modal`/`.admin-modal`/`.tt-modal` retired on migration; **net `index.css` delta ≤ 0**; Preconditions A (F-S2 token) + B (Settings-Overhaul P3) confirmed. | No new/duplicate modal keyframe (reuse `uiModalIn`/`uiSheetUp`/`uiFadeIn`/`createMenuIn`); no `:root` token added in this wave; transform-origin correct per surface; money modals crisp, no bounce; reduced-motion on every enter/exit. |
| **pills-focus-toggles** | Segmented switches animate their indicator (sliding pill or fast cross-fade), **pill `translateX` travel verified at 390px**; focus ring eases with border; occasional selection surfaces cross-fade at `--motion-duration-fast` with no lingering indicator; **`TechTasks` task-list tabs left instant** (Wave 1↔3 reconciled). | No raw `.12s`/`200ms` literal where a token exists; no snap left on an occasional-use selection; no cross-fade added to a high-frequency tab; frequency-tier instant controls untouched. |
| **behavior** | No `load()` sets `loading` true on a refetch path; no bare "Loading…" text; disclosure animates via grid-rows not conditional render; consumes Wave 0's canonical `fadeIn`. | Minimize/resume shows no blank/spinner-flash on the seven fixed pages; a refetch never blanks a rendered list; reduced-motion on the new grid-rows/chevron transition. |
| **a11y-i18n** | Every movement keyframe named in the slices has a `prefers-reduced-motion` fallback; hover-lift is pointer-gated; migrated modals are `role=dialog`+trapped. | Under DevTools reduced-motion: panels/sheets/dot/pop appear with no movement, still functional; no ungated `:hover` transform; no infinite scale pulse left running. |
| **perf** | `transition: all`/raw-literal sweeps done (excl. react-grid + frozen); width→scaleX where safe; toggle knobs on `transform`; `index.css` **under 400 KB** (measured against the Wave-0 baseline). | No `transition: all` in swept scope; layout-triggering props (`width`/`left`) replaced with `transform` where done; verified net CSS delta ≤ 0. |
| **gesture** | Scoped spring util exists in `src/hooks/`; PTR/swipe/sheet-dismiss hand off velocity and settle with a spring; reduced-motion = instant. | Release has no seam between drag and settle; dismiss keys on velocity/projection not distance alone; rubber-band past bounds; reduced-motion path verified; **flagged for owner on-device feel check** (see §4). |

---

## 4. Sequencing

**Serial dependencies (hard):**
- **Wave 0 (CSS reclaim + keyframe correctness) runs FIRST** — before every CSS-adding wave (press-nav/modals/pills/a11y each add rules), so the ~3.4 KB headroom is reclaimed before it is spent, and before Wave 4 consumes the canonical `fadeIn`. This is the budget-sequencing fix and the P0-correctness-ordering fix in one.
- **An F-S2 follow-up defines `--motion-ease-drawer` in `:root` before Wave 2** — Wave 2 may only *reference* `var(--motion-ease-drawer)` (the token block is F-S2-frozen). If the follow-up is not merged, Wave 2's two drawer-ease items block on it.
- **`.btn` base press (press-nav P0) lands before** the tech-pill / Save-button / `.create-menu-fab` press items that inherit or scope onto it.
- **Modal migrations (Wave 2) land before** the a11y-i18n modal-a11y verification item (S4-15) — the `role=dialog`/focus-trap is *acquired by* migration.
- **Wave 2 confirms Settings-Overhaul P3 (Team, Session C) has merged before touching `Team.jsx`** — if P3 is still in flight, that migration is fold-in FL-13, not a Wave 2 edit. (`TimeTracking.jsx` is confirmed not held by that wave — it is not a `settings/` page.)
- **The perf CSS sweeps (Wave 6) must be sequenced against every other `index.css`-writing wave** (Wave 0, press-nav, modals, pills, a11y all write CSS) — treat `index.css` as a single serialized resource; each wave writes only inside its reserved marker, and perf's global sweeps run in their own apply window to avoid clobbering.
- **Gesture (Wave 7) is strictly last:** `PullToRefresh` builds the shared spring util that `SwipeTaskRow` and the sheet drag-to-dismiss depend on.

**Parallelizable:** behavior (Wave 4) is almost entirely `src/pages/tech/*` + a few desktop pages with **no `index.css` collision** except the small backdrop edits — it can run alongside press-nav/modals once Wave 0 has landed. a11y-i18n is pure additive reduced-motion blocks and can trail any CSS-writing wave once that wave's selectors exist.

**Owner rollout step — graduate `feature:page_transitions`:** the View-Transitions push (`html.ui-vt`, toggled by `UiFlagClasses` on `feature:page_transitions`, `App.jsx:604`) is currently owner-gated. The press-nav `{ viewTransition:true }` opt-ins are correct to ship but **only animate once the owner graduates the flag** — so **graduating `feature:page_transitions` is an explicit Wave-1 owner rollout step**, called out in the press-nav PR. Until it graduates, `Collections.jsx`'s `usePageTransition` (FL-3) is the correct always-on fallback — do not rip it out before the flag graduates. No motion fix here introduces a new feature flag; the fold-in items open with their owning initiative's flag (`page:tech_msgs_v2`, `page:crm`, `page:tech_*_v2`, `page:admin_mobile`).

**Needs the owner's on-device feel check (real installed iPhone):**
- **Gesture (Wave 7) — all four items:** swipe-to-complete settle, sheet drag-to-dismiss projection/velocity, PTR spring rubber-band. These are the "fine vs fluid" surfaces and can't be signed off from desktop.
- **Page-transition feel / blur:** the directional push + View-Transitions "blur/settle" (press-nav opt-ins, once the flag is on) and the sheet slide (`var(--motion-ease-drawer)`) — the slices call for a "feel-check at 10% playback"; the owner confirms on device that forward enters from the leading edge and Back reverses, with no double-animation.
- **CSS-spring feel (minor):** the `--motion-spring-in` easings on the toast (Wave 1) and the menus + segmented sliding-pill (Waves 2/3) overshoot slightly — not gesture, so no hard on-device gate, but the sliding-pill `translateX` travel gets the mandatory 390px check (Wave 3 DoD) and the spring toast/menu feel warrants one owner glance alongside the page-transition check.
- The close-out **minimize/resume test** notes any step that is owner-device-gated (behavior wave especially, on the installed PWA).

---

## 5. Skills-in-the-loop

Every fix in §2 carries a `skillSource` — the rollout is skill-authored, not hand-authored. The **builder consults these reference skills per wave**, and **`review-animations` gates every wave** (it is the same senior-motion-advisor skill that produced this audit, now run in review mode against the wave's diff). `motion-standard-v2` is the repo's own standard (`.claude/rules/motion-standard.md`) and is the baseline for all waves.

| Wave | Builder consults (references) | Gated by |
|---|---|---|
| **CSS reclaim** | `motion-standard-v2` (`§1/§7` one-keyframe-per-name, `fadeIn`/`fadeInUp` correctness), **`review-animations`** (it authored the dedup items directly) | `review-animations` + `design-consistency-checker` + CSS-budget guard |
| **press-nav + toast** | `motion-standard-v2` (press/nav idioms + toast enter/exit lifecycle), **`emil-design-eng`** (base `.btn` + money-button + dead-row press feel), **`apple-design`** (respond-on-pointer-down, hover-gating for `.create-menu-fab`) | `review-animations` + gauntlet |
| **modals** | `motion-standard-v2` (shared Modal + `createMenuIn` reuse), **`impeccable`** (money-modal restraint — no bounce on payment/preview; the a11y contract), **`apple-design`** (origin-aware menu scale, drawer ease), **`emil-design-eng`** (popover/dropdown responsiveness) | `review-animations` + gauntlet |
| **pills-focus-toggles** | `motion-standard-v2` (segmented-indicator + toggle idioms), **`emil-design-eng`** (focus-ring polish) | `review-animations` + gauntlet |
| **behavior** | `motion-standard-v2` (`page-lifecycle §1` loading-gate law), **`apple-design`** (interruptible/reversible disclosure for the `ClaimPage` expand) | `review-animations` + `page-behavior-checker` (weighted) + gauntlet |
| **a11y-i18n** | `motion-standard-v2` (`§6` reduced-motion is mandatory), **`impeccable`** (dialog a11y contract acceptance) | `review-animations` + `design-consistency-checker` + gauntlet |
| **perf** | `motion-standard-v2` (`§1/§5/§7` tokens, transform-only), **`emil-design-eng`** (`transition: all` cleanup, knob transform), **`impeccable`** (tab transition cleanup), **`review-animations`** (progress/spinner cohesion — it authored those items directly) | `review-animations` + `design-consistency-checker` + CSS-budget guard |
| **gesture** | **`apple-design`** (spring config, velocity handoff, `project()`/rubber-band formulas, sheet grab-and-throw) — the sole reference for this wave | `review-animations` + **owner on-device feel check** + gauntlet |
| **fold-in** | authored per-item by `motion-standard-v2` / `apple-design` / `emil-design-eng`; **executed by the owning initiative's session**, consulting the same reference skill named in the ledger row | the owning initiative's reviewer + `review-animations` when it folds in |

This makes the loop explicit: `apple-design`, `emil-design-eng`, and `impeccable` are the **reference authorities** the builder reads before touching a surface; `motion-standard-v2` is the **enforceable repo standard**; and `review-animations` is the **gate** that verifies each wave's diff against the standard before the PR opens — so no wave ships on hand-authored judgment alone.
