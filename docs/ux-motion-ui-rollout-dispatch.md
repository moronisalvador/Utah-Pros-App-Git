# UX + Motion + UI Standardization — Rollout Dispatch

**Initiative:** Roll the three approved standards — Motion & Transitions (`.claude/rules/motion-standard.md`), Page-Lifecycle + Loading/Error/Empty (`.claude/rules/page-lifecycle.md` + `.claude/rules/loading-error-states.md`), and the token/primitive UI design system (`UPR-Design-System.md`) — to **every** surface of the app.
**Plan of record:** extends `docs/ux-quality-roadmap.md` + `docs/ux-quality-dispatch.md`; ownership binds to `.claude/rules/ux-alignment-wave-ownership.md`.
**Date:** 2026-07-13

> This document does not restate the standards — read the rule files above. It tells the owner **how to launch the rollout**, **what happens automatically vs. by hand**, and **which session owns which surface**, grounded in the live UI-surface inventory.

---

## 1. How to launch

Each wave is **its own Fable 5 session on ultracode, its own branch, its own PR into `dev`**. Do not run two owned-file-overlapping waves in one session.

- **Model / mode:** launch each wave in a fresh Claude Code session with **Fable 5**, and **opt into ultracode** by including the literal keyword `ultracode` in the kickoff prompt. The per-wave blocks in §4 are copy-paste ready — paste the block, keep the `ultracode` keyword.
- **Branch:** cut from `dev`. Use the harness-assigned `claude/…` branch as-is (branch name is cosmetic; isolation is the ownership split, not the branch).
- **Close-out is mandatory and non-negotiable** — every session runs the full `.claude/rules/close-out-standard.md` checklist before opening its PR: `npm run test` + `npm run build` + `npx eslint` (changed files) → reviewer gauntlet (`upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker`; add `migration-safety-checker` + `anon-grant-auditor` only if a migration/worker-gate is touched) → **minimize/resume test** (background 30s+, resume: no blank, no spinner flash, no route/scroll/input loss) → **390px mobile viewport check** on every touched page → **perf delta** vs `perf-budget.md` → update `UPR-Web-Context.md` → reconcile roadmap checkboxes both directions → delete TEST rows.
- **Sessions never self-merge.** Open the PR into `dev` as a ready-to-merge handoff and **STOP**. The owner/orchestrator merges. Do not subscribe to / babysit / click-merge.
- **Respect the frozen list** in `ux-alignment-wave-ownership.md` §1. If a task lands on a frozen/other-initiative file, it is **not your edit** — route it to the §5 W6 fold-in ledger.

---

## 2. Preconditions & sequencing

**Hard precondition — the rollout executes ONLY AFTER F-S2 merges.** Every wave below imports F-S2's deliverables: the `--motion-*` token catalog, the shared `@view-transition` mechanism, `src/components/ui/**` primitives (Modal, StatusPill, Button press, Field, segmented/tab indicator), and the shared hooks (`useResumeRefetch`, `useTwoClickConfirm`, `useLookup`, `usePhotoUpload`). None of these exist on disk today (`src/components/ui/**` is unbuilt; `:root` has only `--transition-fast`/`--transition-base` and **no** `@view-transition` rule). A wave launched before F-S2 merges has nothing to import.

**Second precondition — W5 (perf) also requires F-B merged.** W5's `useLookup`/`get_jobs_list` rollout consumes F-B's three additive RPCs (`sync_appointment_crew`, `save_estimate_lines`, `get_jobs_list`).

### Dependency graph

```
F-S1 (standards) ─┐
                  ├─► F-S2 (tokens + primitives + hooks + view-transitions)  ──► W1, W2, W3, W4  (parallel)
Phase 0 (harden) ─┘                                                          └─► W5  (also needs F-B)
                     F-B (RPCs) ───────────────────────────────────────────────► W5
```

- **W1, W2, W3, W4 may run in parallel** once F-S2 is merged — their owned-file sets are disjoint per the ownership matrix.
- **W5 runs once F-S2 AND F-B are both merged.**
- **W6 fold-ins are not scheduled here** — each is handed to the initiative that owns the frozen surface, executed when that initiative next touches the file (§5).

---

## 3. The automatic layer — what F-S2 delivers app-wide for free

**This rollout is not 63 hand-edits.** A large share of the MOTION standard applies the instant F-S2 merges, with zero per-page work, per `motion-standard.md` §7 (progressive enhancement). Nobody re-does the following per surface. **Crucially, "automatic" reaches only shared primitives + non-frozen selectors — anything living inside another initiative's reserved css marker or a frozen bespoke selector is NOT reached this way and is routed to its §5 fold-in (called out in the Source-gap column).**

| Delivered by F-S2 once | Effect app-wide | Source gap / scope limit |
|---|---|---|
| **`--motion-duration-*` / `--motion-ease-*` `:root` token block** | One tunable catalog; retuning a token retunes the whole app | `index.css` L64-67 has only `--transition-fast/base` + a placeholder comment |
| **Global `@view-transition { navigation: auto }` + persistent `view-transition-name` on the sticky shell + directional forward/back** | Every route change animates through one shared, GPU-only, gracefully-degrading transition; the shell stays put | No `@view-transition` rule exists anywhere; transitions are hand-rolled per page |
| **Press feedback promoted into the base `.btn`** (`scale(0.97)` + `touch-action:manipulation` + transparent tap highlight, on `--motion-duration-fast`, reduced-motion-collapsed) | **Every button that uses `.btn`, on every desktop page/modal/form, gains press feedback** — today the idiom is scoped to `.tech-layout .btn:active` (L4897) only | base `.btn` (L199) has `transition:all` but no `:active` feedback |
| **Toggle / toast / form-focus tokenization** in the SHARED toggle, toast container, and `Field` | The shared DND/admin/pay toggles, both toast containers, and all `.field:focus` rings move onto tokens + reduced-motion, centrally | raw `.15s`/`200ms`/`.12s` literals in the shared toggle/toast/Field (e.g. L616). **NOT reached this way** — bespoke selectors in frozen surfaces: `conv-dnd-toggle` (L512, sms-experience C), `coll-chat-input` (L8142, Collections), `tv2-msgs-input-wrap:focus-within` (L4901, tech-messages-v2) — each moves only via its §5 owning fold-in |
| **Keyframe dedup (canonical + non-marker duplicates only)** | `fadeIn` (×3→1 at L913/2983/4319), `sheetSlideUp` (×2→1 at L1188/4329), base `spin` (L786/9448→1) collapsed to one canonical each | **Out of F-S2 scope** — duplicates that live inside another initiative's reserved marker (manifest §4/§5): `tv2-msgs-spin` (L11345, `TECH-V2: MSGS`), `fbm-spin` (feedback-media), `am-dash-shimmer` (L6575, admin-mobile), `ovwShimmer` (L7572, Overview) → each routed to its §5 owning fold-in. F-S2 does **not** claim a shimmer dedup |
| **Universal `prefers-reduced-motion: reduce` wrapper** around the tokenized motion | ~24 currently-uncovered animations (toasts, presses, `collChatIn`, `createMenuIn`, sheet slides) get their fallback at once | only ~6 reduced-motion blocks exist today |
| **Pairing hooks on the shared Button + selection primitives** (light `impact('light')` on press, `selection()` on selection-change) | Additive, no-op on desktop web | haptics wired on only ~10 tech-v2 surfaces today. ⚠️ The `nativeHaptics.js` **reduced-motion gate (open task #7)** is an edit to a FROZEN import-only helper (`ux-alignment-wave-ownership.md` §1) — it ships as a **disclosed F-S2-owner follow-up/amendment**, NOT an automatic in-wave edit of the frozen helper. Only the pairing hooks (inside the shared Button/selection primitives F-S2 owns) are automatic |
| **Shared `Modal`, `StatusPill`, and segmented/tab-indicator primitives created** (empty seats) | Gives W3 a single target to migrate onto | `src/components/ui/**` does not exist |
| **Dropdown / menu / popover motion catalog** (fade + scale-from-origin on `--motion-duration-fast`) | Menus that render through the shared classes gain uniform motion | `createMenuIn` etc. are one-off with raw literals |

**What is NOT automatic (the per-surface manual work in §4):** removing per-page React `entering`/`requestAnimationFrame` state; the loading-gate/resume behavior fixes; swapping ~33 bespoke overlays onto the shared `Modal`; consolidating status pills onto `StatusPill`; adopting the sliding-tab indicator across main-app tab bars; a11y wiring (role/focus-trap/labels); the `nativeHaptics.js` task-#7 helper edit (F-S2-owner follow-up); and the frozen-surface fold-ins in §5.

> **Inventory correction (carry into F-S2's notes):** `motion-standard.md` §2 lists `tech/v2/schedule/DayTimeline.jsx` as an ad-hoc `entering` page-transition offender. It is **not** — its `requestAnimationFrame` (L114) is a resume-safe now-line **clock tick**, not a page-enter animation. There are **three** real §2 offenders (TechAppointment/TechJobDetail/TechClaimDetail), not four. Do not "retire" DayTimeline's rAF.

---

## 4. Per-wave launch blocks

Each block **extends** the matching block already in `docs/ux-quality-dispatch.md` with the motion/UI specifics below — reference that block, don't replace it.

---

### W1 — Tech behavior + dark + tech-surface motion

```
ultracode

You are the W1 session of the UX + Motion + UI Standardization rollout (docs/ux-standardization-rollout-dispatch.md). F-S2 is merged; import its tokens/primitives/hooks/view-transition. Read: CLAUDE.md; .claude/rules/{page-lifecycle,loading-error-states,motion-standard,tech-mobile-ux,close-out-standard,ux-alignment-wave-ownership}.md; UPR-Design-System.md; and your existing block in docs/ux-quality-dispatch.md (this extends it).

OWNED FILES (edit only these):
  src/pages/tech/TechDemoSheet.jsx, TechJobDetail.jsx, TechClaimDetail.jsx, TechTasks.jsx,
  TechClaims.jsx, TechRoomDetail.jsx, TechJobAlbum.jsx, TechClaimAlbum.jsx, TechJobDocuments.jsx,
  TechMore.jsx, TechSettings.jsx, TechFeedback.jsx, TechOOPPricing.jsx,
  TechNewJob.jsx, TechNewCustomer.jsx, TechNewAppointment.jsx, TechEditAppointment.jsx, TechNewEvent.jsx,
  TechAppointment.jsx  (BEHAVIOR/dark/tap-target ONLY — do NOT restyle; H3-frozen, see below),
  TechLayout toast token-class fix (H8 exception), tech .tech-* dark overrides, techConstants color maps.

UX / LIFECYCLE (the bulk of the debt — page-lifecycle §1):
  - 9 pages flip a page-level loading gate INSIDE load() → pull-to-refresh/resume blanks the screen.
    Fix: loading starts true, only ever set false; a refetch never re-sets it. Named offenders:
    TechJobDetail:181, TechClaimDetail:249, TechTasks:173, TechClaims:77, TechRoomDetail:87,
    TechJobAlbum:62, TechClaimAlbum:75, TechJobDocuments:101, TechDemoSheet:118.
  - TechJobDocuments hand-rolls a visibilitychange listener (:139-140) → replace with useResumeRefetch
    (silent + guarded), page-lifecycle §2.
  - Every touched list: a failed load renders <ErrorState onRetry>, NEVER the success empty-state or a
    blank page (loading-error-states §1-2). Keep TechJobDetail's optimistic in-place mutation (:94-124)
    and TechTasks' toggle (:186-199) — they are gold; do not regress to a spinner-gated reload.
  - Albums: confirm thumbUrl()/thumbnail per perf-budget image law (grid uses thumbnails, full-res only in lightbox).

MOTION (tech surface, additive to the behavior work):
  - Retire the ad-hoc `entering`/requestAnimationFrame page transition in TechJobDetail (:162/:174/:360)
    and TechClaimDetail (:239/:242/:545) in favor of F-S2's shared View Transitions mechanism (motion §2).
    Fixed submit bars must convert to in-flow footers before a directional slide is safe.
    ⚠️ TechAppointment.jsx (:109/:128/:573) is ALSO a §2 offender but is Job-Hub-H3 retirement-bound —
    do the `entering` retirement there ONLY IF it can be done as a behavior change; if it requires a
    restyle, LEAVE IT and route to the §5 W6 fold-in (Job Hub H3). Same for TechJobDetail if H3 claims it.
  - Swap TechDemoSheet's inline-styled, press-less buttons (:149,:159,:512,:643,:722,:733,:1409) to the
    F-S2 shared .btn/press primitive; kill the snap tech-select (:1391-1400) and search-type segmented
    (:159-160) using F-S2's animated selection indicator; fire nativeHaptics.selection() on change and
    impact('light') on field-action press (motion §3-§4). TechDemoSheet is the largest single-file UI lift.
  - TechDemoSheet: replace raw #hex + inline pill/label/input/overlay style objects with tokens +
    Field/Badge/Modal primitives (highest UI-debt tech file).
  - Add selection haptic to TechTasks checkbox toggle (tech-check-pop is the reference), capture/notify
    haptics on album+room capture, submit haptic on the create/edit sheets.

COORDINATION:
  - TechMore's admin nav group is admin-mobile-Foundation-owned — do not touch that block.
  - TechDemoSheet also overlaps the scope-sheet/Settings-Overhaul surface — keep changes to behavior +
    button-press + motion-token adoption; a deeper scope-sheet redesign is that initiative's (see §5).
  - The PhotoNoteSheet family (src/components/tech/** — PhotoNoteSheet/AddRoomSheet/ReadingEntrySheet/
    EquipmentPlacementSheet/EsignRequestSheet/ClockSupersedeSheet) is tech-v2-frozen "consumed as-is"
    and NOT in your owned set — do NOT edit it. Its motion tokenization rides F-S2's canonical
    sheetSlideUp dedup automatically; any per-selector raw-literal/role=dialog cleanup folds into
    tech-v2 (§5). You may pass them props, never edit them.

ACCEPTANCE: minimize/resume shows nothing move on all touched pages; a forced load failure shows
ErrorState (not blank / not empty-state); no page-level loading flag flips on refetch; TechDemoSheet
buttons press + haptic; tech-select/segments animate their indicator; 390px clean; perf delta recorded.
```

---

### W2 — Desktop behavior + desktop-list error states

```
ultracode

You are the W2 session of the UX + Motion + UI Standardization rollout. F-S2 merged; import its tokens/
primitives/hooks/view-transition. Read: CLAUDE.md; .claude/rules/{page-lifecycle,loading-error-states,
motion-standard,close-out-standard,ux-alignment-wave-ownership}.md; UPR-Design-System.md; your block in
docs/ux-quality-dispatch.md (this extends it).

OWNED FILES: Schedule callbacks (BEHAVIOR ONLY — the deep restructure is Schedule-Desktop-owned; you make
only the callback→silentReloadBoard + error-branch fixes), ClaimPage.jsx, JobPage.jsx, CustomerPage.jsx,
ClaimsList.jsx, the failure→empty-state list pages, Collections tab-mount. (calls F-B RPCs where relevant.)
  PLUS the catch-all: any UNINVENTORIED desktop page's loading-gate/resume/error-state BEHAVIOR fix
  (page-lifecycle + loading-error-states only — NO restyle, NO codemod), EXCEPT a page owned by an
  in-flight initiative in ux-alignment-wave-ownership.md §1 (route those to §5). In-scope examples now
  named: Estimates.jsx, Leads.jsx, Production.jsx, TimeTracking.jsx, Customers.jsx. Explicitly OUT
  (frozen/other-owned): Marketing.jsx (CRM 4b/5-Ops), Conversations.jsx (sms-experience C),
  CrmOverview.jsx (CRM-Foundation slot skeleton) — flag any such page to §5, do not edit.

UX / LIFECYCLE:
  - A failed load must never render the success empty-state (audit: get_dispatch_board failure renders
    "No jobs in production"; JobPage failure renders a blank page; 5+ lists show "No X yet. Create one"
    after a failed fetch). Every load() catch sets loadError or toasts, then renders <ErrorState onRetry>
    with stale rows kept where possible (loading-error-states §1).
  - Mutations patch in place; do NOT re-run a spinner-gated load() from a modal-save/add-job/merge
    callback (page-lifecycle §3 — Schedule modal saves + ClaimPage add-job/merge are named offenders).
    Use the silent reload for collection-shape changes (Schedule silentReloadBoard is the reference).
  - ClaimsList:269 full-reloads via window.location.href → use navigate() (page-lifecycle §5).
  - Polls: every setInterval gets cleanup + `if (document.hidden) return`; a background poll never toasts
    (StatusBoard is the named offender).

MOTION: page transitions come free from F-S2's mechanism — do NOT hand-roll `entering` on these desktop
pages. Buttons inherit press feedback from the shared .btn automatically. Your only motion work is
ensuring any desktop page you touch uses navigate()/<Link viewTransition> so the shared transition fires,
and removing any bespoke per-page transition you find.

ACCEPTANCE: force a load failure + an empty result on every touched list → ErrorState vs EmptyState render
correctly, never blank/never success-empty-on-failure; minimize/resume static; no full-page reload on
mutation; 390px clean; perf delta recorded.
```

---

### W3 — Mechanical codemods: Modal / StatusPill / button / selection-tab / toast / icon / SearchInput / formatter / two-click

```
ultracode

You are the W3 session (cross-cutting codemod sweeps — SOLE owner of these) of the UX + Motion + UI
rollout. F-S2 merged; the shared Modal, StatusPill, Button-press, and segmented/tab-indicator primitives
now exist in src/components/ui/**. Read: CLAUDE.md; .claude/rules/{motion-standard,loading-error-states,
close-out-standard,ux-alignment-wave-ownership}.md; UPR-Design-System.md; your block in
docs/ux-quality-dispatch.md (this extends it).

SWEEP 1 — Modal migration (~33 overlays → F-S2 shared Modal, gaining motion + role=dialog seat):
  Converge the SEVEN parallel desktop modal shells and the inline-style twins onto the shared Modal:
  conv-modal consumers (CreateJobModal, AddContactModal, EditContactModal, SendEsignModal, NewInvoiceModal,
  NewEstimateModal, AddRelatedJobModal, MergeModal, EventModal), the appt-modal inline-style twins
  (CreateAppointmentModal :194 M.overlay, EditAppointmentModal :313 S.overlay), and the admin-modal /
  tt-modal / ar-modal families (index.css:2191/3613/4067). These SNAP open today with zero enter motion —
  the shared Modal supplies overlay-fade + panel-scale (desktop) / slide-up sheet (mobile) on
  --motion-duration-base + reduced-motion. Remove inline maxWidth/flexShrink/overlay style objects.
  Already-animating drawers/sheets (JobDetailPanel job-detail-overlay L907, StatusBoard phase-picker
  L1186, collections ar-sheet L4313) animate with RAW literals + no reduced-motion — retune to tokens.
  (Focus-trap + role=dialog wiring is the shared Modal's job; the a11y verification is W4.)

SWEEP 2 — StatusPill consolidation: replace the ~115 inline borderRadius:999px status spans + the THREE
  competing primitives (collKit.Pill/StatusBadge L123/141, SharedClaimUI.StatusBadge L38, and inline sites
  incl. HomebuildingAnalysis.jsx ×7, NewBuildSimulator ×3, settings/ScopeSheets ×5) with the canonical
  F-S2 StatusPill + semantic status tokens.

SWEEP 3 — button codemod: swap inline-styled interactive buttons (representative: ~175 files use style=
  for controls) onto the shared .btn/press primitive so they inherit F-S2's scale(0.97) + haptic instead
  of bespoke inline transitions.

SWEEP 4 — selection-tab indicator: adopt F-S2's sliding-underline/pill indicator across the main-app tab
  bars that today merely cross-fade the fill in place: division-tab (L945), job-page-tab (L1015),
  admin-tab (L1834, in-place border-bottom toggle — high reuse across Admin/Settings/DevTools), ar-tab
  (L3842), tt-view-tab/tt-period-tab (L3470/3490). Pair selection() haptic on native.

SWEEPS 5-8 (from your existing dispatch block, unchanged): toast (single lib/toast.js entry point),
  icon, SearchInput (GlobalSearch + CarrierSelect/ClaimPicker/SearchSelect/DatePicker/LookupTable
  dropdowns), formatter, and useTwoClickConfirm two-click-delete conversions.

DO NOT TOUCH (route to §5 W6 / owning initiative): conv-* (Conversations, sms-experience C),
tv2-*/coll-*/am-*/ovw-* selection controls, crm-editor-ai-popover, and CrmOverview.jsx (CRM-Foundation
slot skeleton — its work folds into the CRM initiative, NOT this sweep). StatusPill/Modal CONSOLIDATION
of collKit/SharedClaimUI shared primitives IS yours; restyling a frozen page's live surface is not.

ACCEPTANCE: no bespoke modal shell remains for a migrated caller; modals animate + carry the Modal
primitive; zero inline status pills on swept pages; main-app tabs show a sliding indicator; toast has one
entry point; minimize/resume static; 390px clean; perf delta recorded.
```

---

### W4 — Accessibility + i18n

```
ultracode

You are the W4 session (a11y/i18n) of the UX + Motion + UI rollout. F-S2 merged. Read: CLAUDE.md;
.claude/rules/{motion-standard,close-out-standard,ux-alignment-wave-ownership}.md; UPR-Design-System.md;
your block in docs/ux-quality-dispatch.md (this extends it).

OWNED: icon-button aria-labels, Field-primitive adoption, tech i18n namespace files.

A11y that pairs with the primitives F-S2 + W3 shipped:
  - Verify role="dialog"/aria-modal + focus trap + Escape on the shared Modal (the ~33 migrated overlays
    had NO role=dialog / focus trap; only PhotoNoteSheet family + coll-popover/coll-chat-panel set
    role=dialog today). Confirm tech sheets keep a focus trap for gloved-hand use (tech-mobile-ux).
  - Dropdowns/menus (CreateMenu, UserMenu, NewMenu, ActionMenu, OverflowDrawer) need role=menu +
    aria-expanded + focus management. GlobalSearch/searchable dropdowns need combobox roles
    (role=listbox / aria-activedescendant).
  - Both toast containers carry role=status aria-live=polite (errors role=alert) — loading-error-states §4.
  - Reduced-motion: confirm F-S2's universal wrapper actually covers every animation you can reach; a
    motion ignoring prefers-reduced-motion is a review failure (motion §6).

MOTION note: no motion authoring here — you verify the reduced-motion + haptic-suppression side of what
F-S2 shipped, and that the haptic helper's task-#7 reduced-motion gate (shipped as the F-S2-owner
follow-up, since nativeHaptics.js is frozen import-only) is live. If that follow-up has not landed, flag
it — do NOT edit nativeHaptics.js yourself.

ACCEPTANCE: keyboard-only pass on migrated modals/menus/comboboxes; screen-reader announces toasts;
reduced-motion collapses all reachable motion; 390px clean.
```

---

### W5 — Performance (requires F-S2 **and** F-B merged)

```
ultracode

You are the W5 session (perf) of the UX + Motion + UI rollout. BOTH F-S2 and F-B must be merged (you
consume F-B's get_jobs_list). Read: CLAUDE.md; .claude/rules/{perf-budget,close-out-standard,
ux-alignment-wave-ownership}.md; your block in docs/ux-quality-dispatch.md (this extends it).

OWNED: self-hosted subsetted fonts, lazy-load config, useLookup / get_jobs_list rollout, (RED, owner-gated)
service worker.

TASKS:
  - Self-host subsetted Inter woff2 (500/600/700), font-display:swap; retire the 2 render-blocking Google
    Fonts stylesheets; scope secondary families (Public Sans → CRM chunk); lazy-load pt/es locales.
  - useLookup for the shared rosters (employees fetched at 14 call sites), job phases, carriers.
  - Replace unbounded ~50-column no-limit list fetches (Jobs/Production) with get_jobs_list; name columns
    (select=* banned in list fetches); pair any top-N truncation with search/load-more.
  - Confirm album/grid images use thumbUrl() thumbnails + loading="lazy" + decoding="async" (image law).
  - Memoize the AuthContext value object (re-render hygiene §5).

MOTION note: F-S2's motion is transform/opacity + short-duration + GPU-only by construction — verify no
new render-blocking asset and that transitions never gate a spinner/refetch. Record top-5 chunk deltas.

ACCEPTANCE: entry-graph JS ≤ 232 KB gz; index.css ≤ 400 KB; no new render-blocking third-party request;
no select=* / unbounded list on touched pages; perf delta recorded in the PR.
```

---

## 5. The W6 fold-in ledger — frozen surfaces

These surfaces are owned by other in-flight initiatives. The motion/UX/UI task is **authored now** (in this doc + the standards) and **implemented by the owning initiative when it next touches the file**. No UX-standardization wave edits them directly.

| Frozen surface | Owning initiative | Hand-off task |
|---|---|---|
| `src/pages/Conversations.jsx`, `src/components/conversations/MessageBubble.jsx` (+ `conv-*`, incl. `conv-dnd-toggle` L512) | **sms-experience** (Phase C) | Chat-bubble motion (motion §3): sent bubble animates up from composer, incoming fades+scales 0.98→1, optimistic pending→sent smooth opacity/checkmark transition, reconcile-in-place with no reflow. Tokenize the `conv-dnd-toggle` raw 200ms (bespoke, not reached by the shared-toggle tokenization). |
| `src/pages/tech/TechAppointment.jsx`, `TechJobDetail.jsx` (retirement) | **Job Hub v2 — H3** (PR #322 line) | Land the `entering`/rAF page-transition retirement (motion §2) as part of deletion/cutover — these files are slated for removal; do not restyle in W1. |
| `src/components/tech/**` shared sheets — `PhotoNoteSheet`/`AddRoomSheet`/`ReadingEntrySheet`/`EquipmentPlacementSheet`/`EsignRequestSheet`/`ClockSupersedeSheet` | **Tech Mobile v2** (shared sheets; F-S2 for the canonical keyframe) | Canonical `sheetSlideUp` + reduced-motion reaches them via F-S2's dedup; any per-selector raw-duration-literal cleanup + role=dialog re-confirm folds into tech-v2. Frozen "consumed as-is" — NOT a W1 edit (W1 may only pass props). |
| `src/pages/tech/TechDemoSheet.jsx` (deep scope-sheet redesign) | **Settings Overhaul P6 / scope-sheet** | W1 does behavior + button-press + motion-token adoption; a full scope-sheet UI redesign (schema-driven surface) folds into the scope-sheet initiative. |
| `src/pages/tech/v2/**` — `TechDashV2`, `dash/*`, `TechScheduleV2`, `schedule/*` (incl. `tv2-segmented` L5057, WeekStrip day-picker) | **Tech Mobile v2** (Sessions D/S) | Animated selection indicator on the snapping `tv2-segmented`/tab/week-strip controls + `selection()` haptic; enter motion via the shared mechanism. (DayTimeline rAF is a clock tick — leave it.) |
| `src/pages/tech/v2/TechJobHub.jsx`, `hub/*` | **Job Hub v2** (H1/H2/H3) | Stage/dock tab selection indicator + press/selection haptic; tokenize `AdminJobMenu` inline styles. |
| `src/pages/tech/v2/TechMessagesV2.jsx`, `messages/*` (incl. `tv2-msgs-spin` L11345, `tv2-msgs-input-wrap:focus-within` L4901) | **tech-messages-v2** (B1/B2) | Chat-bubble enter motion + optimistic pending→sent transition inside the `TECH-V2: MSGS` marker; composer note-toggle/convo-select indicator; dedup `tv2-msgs-spin` + tokenize the `:focus-within` literal inside the marker (F-S2 cannot reach the reserved marker). (Thread panel + reduced-motion already exemplary.) |
| `src/pages/tech/admin/*` — `AdminDash`, `AdminCollections`, `AdminInvoiceDetail`, `AdminEstimateDetail/Editor`, `AdminLeadCenter` (incl. `am-dash-shimmer` L6575) | **admin-mobile wave** (B1–B5) | `am-*` press/selection motion + haptics; dedup `am-dash-shimmer` in the admin-mobile marker; fix the unguarded `setLoading(true)` in load() (AdminEstimateEditor:82, AdminEstimateDetail:80) and swap AdminLeadCenter's hand-rolled visibilitychange/focus (:79-80) for `useResumeRefetch`. |
| `src/components/crm/AiReplySuggestions.jsx` (`crm-editor-ai-popover` L8657) | **CRM Phase 9** | Popover fade+scale-from-trigger motion + reduced-motion; tokenize. |
| `src/pages/crm/CrmOverview.jsx` + other CRM-Foundation-frozen slot skeletons; `src/pages/Marketing.jsx` | **CRM Foundation / CRM 4b-5-Ops** | Loading-gate/resume/error-state behavior + token/StatusPill adoption fold into the CRM initiative — NOT a W2 behavior edit or a W3 codemod (frozen slot skeletons / CRM-owned page). |
| `src/components/overview/Widgets.jsx`, `Card.jsx` (`ovw-seg-btn` L7519, `ovwShimmer` L7572) | **Overview** initiative | Retune raw `.12s` → `--motion-duration-fast`; dedup `ovwShimmer` in the Overview marker; raw hex (#667085/#101828/#f4f5f7) → tokens; adopt StatusPill (coordinate with W3's primitive). |
| `collections` `coll-seg-btn` (L7945) / `coll-chip` (L7987) / `coll-chat-input` (L8142) selection + input controls | **Collections / admin-mobile** | Retune raw `.12s` → token; tokenize the `coll-chat-input` focus literal (bespoke, not reached by the shared Field); raw hex → tokens; chip selection haptic on native. (Note: `collKit.Pill/StatusBadge` **consolidation** onto StatusPill is W3-owned, not a fold-in.) |
| `feedback-media` `fbm-spin` keyframe | **feedback-media** initiative | Dedup `fbm-spin` onto the canonical `spin` inside its own surface (F-S2 cannot edit it). |
| Nav-shell menus/drawers where they touch `Layout`/`Sidebar`/`TopNav` (`UserMenu`, `TopNav`, `OverflowDrawer`) | **F-S2 / shared-shell** | Dropdown/drawer motion comes from F-S2's catalog automatically; any shell-file edit is an F-S2 follow-up, not a wave edit. |

---

## 6. Per-surface-type "definition of done"

Any session self-checks a surface against the matching row. Cite the rule, don't reinvent.

- **Page** — *Behavior:* `loading` gate fires cold-start only (never on refetch/resume/mutation; starts `true`, only set `false`); resume/focus refetch is silent + request-guarded via `useResumeRefetch` (no hand-rolled `visibilitychange`); a failed load renders `<ErrorState onRetry>` (never blank, never the success empty-state); `<EmptyState>` only after a successful zero-row load; route change animates through the shared `@view-transition` (no per-page `entering`/rAF); navigation via `navigate()`; scroll preserved across detail-nav-and-back. *UI:* the page's controls use the shared primitives + tokens (Field/Badge/StatusPill/`.btn`) — no raw `#hex`, no inline overlay/pill/input style objects where a token or primitive exists. *Perf/image:* list & grid `<img>` use `thumbUrl()` thumbnails + `loading="lazy"` + `decoding="async"` (full-res only in a lightbox); no `select=*` or unbounded list fetch on the page; perf delta recorded. *(page-lifecycle, loading-error-states, UPR-Design-System, perf-budget image + query law)*
- **Button** — uses the shared `.btn`/Button primitive; `scale(0.97)` press feedback on `--motion-duration-fast` + `touch-action:manipulation` + transparent tap highlight; reduced-motion collapses it; field/primary press fires `impact('light')` on native; no bespoke inline transition. *(motion §3-§4)*
- **Selection control (tab / segment / chip / toggle)** — the active state does NOT snap: an animated sliding indicator or cross-fade on `--motion-duration-fast`; `selection()` haptic on change (native); toggles slide the knob on motion tokens (not raw literals); reduced-motion fallback. *(motion §3)*
- **Modal** — the shared `Modal` primitive: overlay fade + panel scale (desktop) / slide-up sheet (mobile) on `--motion-duration-base`/`--motion-ease-decelerate`, reverse on dismiss; `role="dialog"` + `aria-modal` + focus trap + Escape + scrim; reduced-motion → opacity-only; no inline overlay style objects. *(motion §3, close-out a11y)*
- **Dropdown / popover / menu** — fade + scale (0.96→1) from the trigger origin on `--motion-duration-fast`; `role="menu"`/`role="listbox"` + `aria-expanded`/focus management; Escape dismiss; reduced-motion fallback. *(motion §3)*
- **Toast** — raised only via `src/lib/toast.js`; slide/fade in from the container edge, auto-dismiss fades out, on motion tokens, in the ONE shared container (`Layout`/`TechLayout`, not per-page); container carries `role="status" aria-live="polite"` (`role="alert"` for errors); reduced-motion fallback. *(motion §3, loading-error-states §4)*
- **Form** — `Field` primitive; focus border/ring transitions on `--motion-duration-fast` (unified across `:focus`/`:focus-within`); 16px input floor; every async submit handler is `try/catch → err()`; success via toast; submit fires `notify('success')` on native. *(motion §3, page-lifecycle §6)*
- **Chat bubble** — sent bubble animates up from the composer edge (translateY + fade, right-aligned); incoming fades + scales in (0.98→1, left-aligned) on `--motion-duration-base`/`--motion-ease-decelerate`; optimistic pending→sent is a smooth opacity/checkmark transition (not a 0.72→1 jump); reconciling the optimistic bubble does not reflow/re-animate; `impact('light')` on send-success (native); reduced-motion fallback. *(motion §3)*

---

## 7. Coverage table

This inventory is a **slice**, not the full route table (`src/pages/` has 41 files, `tech/` 22). Every surface *listed here* carries an owner; live pages **not** listed are handled by the catch-all below (never silently skipped).

| Surface (file / family) | Category | Assigned | Status |
|---|---|---|---|
| `TechDemoSheet.jsx` | tech page (highest UI debt) | **W1** (deep redesign → scope-sheet W6) | loading-gate + inline→primitive + snap-select + press/haptic |
| `TechJobDetail.jsx`, `TechClaimDetail.jsx` | tech detail | **W1** | loading-gate fix + retire `entering` (JobDetail may defer to H3) |
| `TechAppointment.jsx` | tech detail | **W1 behavior only → W6 (Job Hub H3)** | H3-frozen for restyle; retirement-bound |
| `TechTasks/TechClaims/TechRoomDetail/TechJobAlbum/TechClaimAlbum/TechJobDocuments` | tech page/list | **W1** | loading-gate fix (+ Documents resume-listener → hook); haptics; image-law |
| `TechMore/TechSettings/TechFeedback/TechOOPPricing` + 5 New/Edit sheets | tech page/form | **W1** | inline→tokens/Field; submit haptic |
| `TechHelp.jsx`, `techHelpContent.jsx` | static | **W3** | token sweep |
| `tech/v2/**` (Dash/Schedule/JobHub + modules) | tech-v2 | **W6** (tech-v2 / Job Hub) | frozen; snap-segment + haptic + marker keyframe dedup fold-in |
| `tech/v2/messages/**`, `TechMessagesV2` | chat | **W6** (tech-messages-v2) | frozen; bubble motion + `tv2-msgs-spin` dedup fold-in |
| `tech/admin/**` (AdminDash/Collections/Invoice/Estimate/LeadCenter) | admin-mobile | **W6** (admin-mobile) | frozen; loading-gate + resume-hook + am-* motion + `am-dash-shimmer` dedup fold-in |
| `src/components/tech/**` sheets (`PhotoNoteSheet` family) | tech sheet | **W6** (tech-v2 / F-S2 keyframe) | frozen "consumed as-is"; NOT W1-editable — tokenization rides F-S2 sheetSlideUp dedup, per-selector cleanup folds into tech-v2 |
| `Schedule.jsx` callbacks | desktop | **W2** (behavior only; restructure = Schedule Desktop) | callback→silentReload + error-branch |
| `ClaimPage/JobPage/CustomerPage/ClaimsList/Collections` + failure→empty lists | desktop | **W2** | ErrorState-not-blank; in-place mutation; navigate() |
| Uninventoried desktop pages (`Estimates/Leads/Production/TimeTracking/Customers`, …) | desktop | **W2** (catch-all, behavior only) | loading-gate/resume/error-state fix — no restyle/codemod |
| `CrmOverview.jsx` + CRM slot skeletons; `Marketing.jsx` | page (CRM-frozen) | **W6** (CRM Foundation / CRM 4b) | frozen — lifecycle/behavior + codemod fold into the CRM initiative, NOT W2/W3 |
| conv-modal / admin-modal / appt-modal / ar-modal / tt-modal families (~33 overlays) | modal | **W3** | migrate onto shared Modal + motion |
| Animated drawers/sheets (`JobDetailPanel`, `StatusBoard` phase-picker, `ar-sheet`) | modal/sheet | **W3** | tokenize raw literals + reduced-motion |
| `collKit.Pill/StatusBadge`, `SharedClaimUI.StatusBadge`, ~115 inline pills (`HomebuildingAnalysis`, `ScopeSheets`, …) | status pill | **W3** | consolidate onto F-S2 StatusPill |
| Base `.btn` + press idiom; SHARED toggles/toasts/form-focus; canonical/non-marker keyframe dedup; reduced-motion; `@view-transition`; `--motion-*` tokens; Button/selection haptic hooks | motion foundation | **F-S2 (automatic)** | app-wide, no per-page work; frozen-marker keyframes + bespoke frozen selectors + the `nativeHaptics.js` task-#7 gate are NOT here (§3 / F-S2 follow-up / §5) |
| Inline-styled buttons (~175 files) | button | **W3** | swap to shared `.btn` |
| Main-app tabs (`division/job-page/admin/ar/tt`) | selection | **W3** | sliding-indicator adoption |
| `ovw-seg-btn` / Overview widgets (`ovwShimmer`) | selection/pill | **W6** (Overview) | token+motion retune + shimmer dedup fold-in |
| `coll-seg-btn` / `coll-chip` / `coll-chat-input` / `ActionMenu` | selection/dropdown/input | **W6** (Collections) | token+motion + input-focus tokenize fold-in |
| `fbm-spin` keyframe | keyframe (frozen) | **W6** (feedback-media) | dedup inside its own surface |
| `CreateMenu/UserMenu/NewMenu/OverflowDrawer` | dropdown | **F-S2 (automatic)** motion; **W4** a11y | menu motion + role=menu/focus |
| `GlobalSearch` + searchable dropdowns | popover/combobox | **W3** (SearchInput) + **W4** (combobox roles) | dropdown motion + a11y |
| `AiReplySuggestions` (`crm-editor-ai-popover`) | popover | **W6** (CRM Phase 9) | popover motion fold-in |
| `Conversations.jsx` / `MessageBubble.jsx` / `conv-*` (incl. `conv-dnd-toggle`) | chat/modal | **W6** (sms-experience C) | bubble motion + toggle tokenize fold-in |
| Fonts / lazy-load / `useLookup` / `get_jobs_list` / image-law | perf | **W5** (needs F-B) | perf-budget rollout |
| Icon-button labels / `Field` adoption / tech i18n | a11y/i18n | **W4** | labels + Field + namespaces |

**Catch-all owner (inventory-is-a-slice).** This table does not enumerate every live route — `Glob src/pages/**/*.jsx` before assuming coverage. Any live page found outside this table is assigned by rule, not skipped:
- A **tech-shell** page not owned by an in-flight initiative → **W1** (behavior + tech motion).
- A **desktop** page not owned by an in-flight initiative → **W2**, whose remit explicitly extends to any uninventoried desktop page's **loading-gate/resume/error-state behavior** (page-lifecycle + loading-error-states). This is behavior work, **not** a W3 codemod and **not** a restyle.
- A page **owned by an in-flight initiative** in `ux-alignment-wave-ownership.md` §1 (e.g. `Marketing` → CRM 4b, `CrmOverview` + CRM slot skeletons → CRM Foundation, `Conversations` → sms-experience) → route its lifecycle/UI/motion work to that initiative's **§5 W6 fold-in**; do not edit it in-wave.

Whichever rule applies, add the page to the owning wave and note it in that wave's PR — no page is left with unowned loading-gate/resume/error-state debt.
