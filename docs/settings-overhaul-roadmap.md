# Settings Overhaul — Roadmap (plan of record)

**v1 · 2026-07-04 · adversarially challenged before commit · verified against dev @ `8716fdc`**
Companion dispatch blocks: `docs/settings-overhaul-dispatch.md`. Ownership manifest
`.claude/rules/settings-overhaul-wave-ownership.md` is committed **by Phase F** (this doc's
matrix is its spec). Where roadmap prose and that manifest later disagree, the manifest wins.

**Initiative:** reorganize and polish the entire Settings/System area — IA, page placement,
navigation, and visual design — so every setting is findable in one guess, every sub-page
matches `UPR-Design-System.md`, and the area feels like one product. Owner pre-decisions
(2026-07-03/04): restructure freely but every retired route redirects; permission-preserving
by default with gate changes as explicit approved line items; mobile decided deliberately;
CRM (`src/pages/crm/**`) out of scope; monolith splits in scope under behavior-identical
rules; near-zero schema. Owner approvals on record (2026-07-04): plan GO · Phase 0 ship-now ·
Personal group visible to techs (yes) · Schedule-B handled by F re-pointing its anchors ·
stale PRs #102/#110/#224 left open (**owner-accepted bit-rot risk** — the wave rewrites files
they touch; whoever revives them later rebases).

---

## Severity finding S1 — payroll exposure (FIXED — Phase 0 shipped 2026-07-04)

`/settings` was mounted with **no route guard** (`App.jsx`) and the TopNav gear rendered
**ungated for every user** (`TopNav.jsx:91`), while the Commissions tab inside calls
`get_employee_commissions` / `upsert_employee_commission` (SECURITY DEFINER, granted to
`authenticated`). **Live exposure quantified 2026-07-03:** all 6 field_tech + 3 supervisor
accounts could read AND write every employee's commission rate via URL, despite
`nav_permissions` saying `settings can_view=false` for both roles. Zero per-employee
overrides existed for `settings`, so nobody legitimate relied on the hole; the one
override-holding supervisor (`demo_sheet_builder`) enters via `/admin/demo-sheet-builder`,
untouched. **Fix shipped:** commit `82ca87d` — `AccessRoute('settings')` on the route +
`canAccess('settings')` on the gear. Residual (out of this initiative's scope, noted for the
security workstream): the RPC itself still has no server-side actor check — the route gate is
the barrier; see PR #224's C-findings for the deeper RLS/authz program.

## Status reconciliation (2026-07-04, all verified live/git — not from docs)

| Thing | Doc/memory said | Verified actual |
|---|---|---|
| Settings hub breakpoint | "≥1280px" (SettingsLayout.jsx header, index.css comment, TopNav header) | **≥1024px** (`@media (min-width:1024px)`, index.css) — comments stale, F fixes them |
| Notify initiative | pending F1 "will add SETTINGS_NAV entry" | **fully merged** (F1/F2/B/C/D + #300); Settings.jsx has a Notifications tab, Admin.jsx a Notification Defaults tab; zero open claims |
| Tech settings screen | "missing" (pre-2026-07-04 audit) | **exists**: `/tech/settings` (Appearance/Language/Notifications) — out of scope, shared `NotificationPrefsMatrix` becomes a frozen import |
| Theme / language | "unbuilt platform capabilities" | ThemeProvider (tech-scoped dark) + full tech EN/PT/ES i18n **shipped**, localStorage-persisted; office side untranslated/unthemed — future edges |
| tech-v2 | S/D in flight, C/M1/M2 pending | **F/S/D/C merged** (legacy TechDash/TechSchedule deleted, App.jsx shims removed); M1+M2 pending |
| Schedule initiative | A/B/C pending | still **all pending/unstarted**; B's anchors (`navItems.jsx:77/:117`, `Admin.jsx:979`) drifted again with notify/roadmap merges |
| `crm_build_phases` | — | CRM tracker is CRM-only; this initiative tracks via THIS doc's checklists (no tracker clone — owner not asked to fund one) |
| PaymentSettings route | `/payment-settings` (hint) | `/payments/settings` (`App.jsx`), **zero nav entries anywhere**, sole in-app link `Collections.jsx:114` |
| `'manager'` role (canEditBilling) | a real second role | **not even an enum value** (`pg_enum employee_role`) — billing surface is structurally admin-only; 9 files flip if the enum ever grows (flag in BILLING-CONTEXT then) |

## Gap-audit appendix (evidence-based; HAVE only from code/schema)

Capability taxonomy (constructed for this domain — owner gave none): A hub/IA · B gates ·
C page placement · D design compliance · E mobile. Full per-page evidence lives in the
2026-07-03 audit (11-agent inventory + 7-agent challenge, ~1.75M tokens of reads); rows below
carry the verdict + anchor evidence. **[CC] = Challenge-CONFIRMED** (survived a refute-first
re-verification with fresh reads).

| # | Capability | Verdict | Evidence anchor |
|---|---|---|---|
| A1 | One settings nav | MISSING — hub rail + Settings.jsx's own 210px left nav render side-by-side ≥1024px (~450px of nav chrome) [CC] | SettingsLayout.jsx:47-60 vs Settings.jsx SETTINGS_NAV; index.css 5620-26 vs 2478-82 |
| A2 | Deep-linkable settings | MISSING — Settings/Admin/DevTools tabs are all `useState`-only; refresh resets | Settings.jsx:381, Admin.jsx:57, DevTools.jsx:2779 |
| A3 | Mobile settings experience | MISSING — hub is `display:contents` <1024px; API Keys nav-unreachable <1024px even for admins [CC — 1024 not 1280] | index.css 5591-93/5607; navItems.jsx:138 SYSTEM-only |
| B1 | Route gates match nav gates | PARTIAL — `admin_panel`/`tech_feedback` nav=canAccess vs route=AdminRoute (both directions broken); `/settings` fixed by Phase 0 [CC] | App.jsx:415/418 vs navItems.jsx:90/92; live: zero overrides for those keys → adminOnly alignment is zero-effective-change |
| B2 | Override machinery | HAVE — 4-layer canAccess (force_disabled → per-employee → admin → role); live usage: supervisor `demo_sheet_builder` grant | AuthContext.jsx:230-249; live employee_page_access (2 rows) |
| C1 | PaymentSettings placement | MISSING — orphaned from all nav | App.jsx `/payments/settings`; Collections.jsx:114 |
| C2 | Integrations surface | PARTIAL — three surfaces: "API Keys" (GitHub), DevTools→Integrations (QBO connect/sync duplicate), Settings→Google (per-user) | AdminIntegrations.jsx; DevTools.jsx:2561-2760; Settings.jsx GoogleDriveIntegrationPanel |
| C3 | DevTools misfiled tabs | PARTIAL — QBO connect + employee-invite are admin/settings capabilities behind a personal email gate; Flags stays (owner-only release control, manifests reference "DevTools → Flags") | DevTools.jsx tabs 3/5; DevRoute App.jsx |
| C4 | Help placement | MISPLACED — inside hub shell but not in the rail (renders with no active item) | App.jsx:414; SYSTEM_ITEMS has no help entry |
| C5 | Notifications settings | HAVE (new) — per-user tab in Settings, defaults tab in Admin, tech section at /tech/settings; components already separate files | Settings.jsx:47-49,393+; Admin.jsx:5,101-111; components/settings/* |
| D1 | Design-system compliance | PARTIAL→FAIL by page — Settings PASS-ish (it's the doc's reference, with hex drift); Admin MIXED (PageAccess inline soup; hard-delete uses a **modal**, Rule-2 violation); DevTools FAIL (2831 lines inline, 6 hex palettes, zero mobile); DemoSheetBuilder `window.confirm` ×3 (Rule 2); PaymentSettings inline + **one-click real-money payout**; AdminFeedback good (inline `<style>` wart); AdminIntegrations good (wears crm-* classes) | per-page audits 2026-07-03 |
| D2 | Loading/empty/dirty patterns | PARTIAL — TabLoading is DevTools-local (not exported, contra CLAUDE.md); four spinner variants in Settings alone; template dirty-state lost on outer tab switch | DevTools.jsx:1857; Settings.jsx:435/271/535/658, :449 |
| E1 | Schema needs | near-zero — one additive F migration: drift-capture `demo_sheet_schemas` RPC family (absent from `supabase/migrations/` — live drift) + safe `delete_demo_schema` | UPR-Web-Context 937-957; AdminDemoSheetBuilder.jsx:313-315 raw delete |

## Gate matrix — approved line items (everything not listed is preserved verbatim)

| # | Change | Status | Effective impact (live-verified) |
|---|---|---|---|
| GC1 | `AccessRoute('settings')` on `/settings` | **SHIPPED (Phase 0)** | removes URL access nav already denied |
| GC2 | gear gated `canAccess('settings')` | **SHIPPED (Phase 0)** | consistency with GC1 |
| GC3 | `/settings` index (SettingsHome) gate = **any-visible-child** | F | keeps the override-only supervisor's nav path alive [challenge-forced] |
| GC4 | `admin_panel`+`tech_feedback` nav → `adminOnly` | F | zero effective change (live: no overrides, routes already AdminRoute); kills dead links for office/PM/crm_partner |
| GC5 | new sidebar Settings entry `hideForRoles:['crm_partner']` | F | removes dead-end links 5 partner accounts see today |
| GC6 | Payments nav entry visible to canEditBilling roles | F | new visibility for a page admins already had |
| GC7 | Sidebar migrates to `isItemVisible()` | F | behavior-identical; retires the NAV_ITEMS-must-stay-identical comment consciously |
| GC8 | `/settings/my-account` + `/settings/notifications` visible to every employee (Personal group) | F | **owner-approved expansion 2026-07-04** — techs/all staff see a Settings entry containing only their own Google + notification prefs |

## Target IA and route map

`/settings` = SettingsHome (index; tappable groups; client-side search; the mobile experience).
Groups → routes (gates per matrix above; all pages inside the SettingsLayout v2 shell):

- **Workspace:** `/settings/carriers` · `/settings/referrals` · `/settings/templates`
  (+`/settings/templates/:docType` editor — needs own `get_document_templates` fetch + a
  router-level unsaved guard, not a verbatim move) · `/settings/commissions` ·
  `/settings/payments` · `/settings/scope-sheets`
- **Team:** `/settings/team` · `/settings/roles` · `/settings/page-access` ·
  `/settings/notification-defaults` · `/settings/feedback` (label "Feedback Inbox")
- **Connections:** `/settings/integrations` (GitHub card + QBO connect/sync consolidated from
  DevTools; label retires "API Keys")
- **Personal:** `/settings/my-account` (Google Drive/Calendar) · `/settings/notifications`
  (NotificationsPanel, verbatim)
- **Owner:** `/dev-tools` (unchanged)
- `/help` unwrapped from the hub shell (knowledge surface; route/gates unchanged);
  `/feedback` unchanged.

**Permanent redirects** (permanent — `notifications.link` rows already store `/tech-feedback`):
`/admin→/settings/team` · `/admin/integrations→/settings/integrations` ·
`/admin/demo-sheet-builder→/settings/scope-sheets` · `/tech-feedback→/settings/feedback` ·
`/payments/settings→/settings/payments`. Plus F ships a `?gdrive=` forwarder on SettingsHome
(→ `/settings/my-account`) because `google-drive-callback.js:40` keeps 302-ing to
`/settings?gdrive=` until P4 retargets the worker [challenge-forced into F].

**Double-nav resolution: flatten** — rationale: the rail already exists and duplicates the
internal nav; `useState` tabs aren't deep-linkable; routed sub-pages give dirty-state guards,
URLs, and one nav. Rejected alternatives: keep-nested (preserves the smell), merge-into-tabs
(loses deep links).

## Phases

### Phase 0 — gate hotfix ✅ shipped 2026-07-04 (`82ca87d`, direct to dev per Rule 4)

### Phase F — Foundation (all structure, behavior-identical)
> **Branch:** session-assigned (illustrative: `settings/phase-f-foundation`), cut from `origin/dev`
> **Prerequisite:** none hard. Rebase-awareness: tech-v2 M2 (App.jsx tech region) and
> omni-inbox F (index.css marker) may land concurrently — different regions/markers.
> **Model · effort:** Opus (or better) · high — the wave's single point of failure; priced in
> via per-step commit checkpoints + reviewer gauntlet + sanctioned thin-wrapper fallback.
> **Read scope:** CLAUDE.md · this block + gate matrix + IA + ownership matrix ·
> UPR-Design-System.md (Two-Column settings pattern + hub css) · tech-v2 + omni-inbox
> manifests (rebase awareness only).

Build order (riskiest first; **commit after every numbered step** — each independently
revertable):
1. Migration (additive): drift-capture the live `demo_sheet_schemas` RPC family via
   `pg_get_functiondef` into `supabase/migrations/`; new `delete_demo_schema(p_id)` that
   **RAISEs on any version that is active, was ever published, or is referenced by a saved
   sheet's `schema_id`** (protects `.claude/rules/scope-sheet-rollback.md`'s 60-second
   recovery); GRANT EXECUTE; apply via MCP after the consuming code commits.
2. Shared modules (extracted, behavior-identical, with render tests):
   `src/components/settings/{SettingsSection,SettingsPageHeader,LookupTable}.jsx`,
   `src/components/TabLoading.jsx` (exported; CLAUDE.md pointer updated; DevTools keeps its
   local copy until P7-lite/anytime), templates module (DOC_TYPES/DEFAULT_TEMPLATES/
   renderMarkdown/substituteVarsPreview + editor subcomponents) under
   `src/pages/settings/templates/`, `src/lib/navKeys.js` (NAV_KEYS + PAGE_ACCESS_KEYS +
   ROLES/roleLabel — ends the Admin.jsx duplicate-registry drift), `src/lib/owner.js`
   (`isMoroni(employee)` — `moroni@utah-pros.com`; replaces 6 hardcoded copies).
3. Settings.jsx dissolution → `src/pages/settings/{Carriers,Referrals,Templates,Commissions,
   MyAccount,Notifications}.jsx` (Notifications = verbatim NotificationsPanel move; MyAccount
   carries the `?gdrive=` toast logic). Budget honestly: heavy module-scope sharing — this is
   the careful half of F, not the cheap half.
4. Admin.jsx split → `src/pages/settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx`
   (tabs are independent; EmployeeModal travels with Team; NotificationDefaultsTab import
   moves verbatim; drop the redundant in-component admin guard — AdminRoute stays).
5. git-mvs (content-identical): `PaymentSettings.jsx→settings/Payments.jsx`,
   `admin/AdminIntegrations.jsx→settings/Integrations.jsx`,
   `AdminFeedback.jsx→settings/FeedbackInbox.jsx`,
   `AdminDemoSheetBuilder.jsx→settings/ScopeSheets.jsx`.
6. SettingsHome (`src/pages/settings/SettingsHome.jsx`): grouped tappable index + search +
   `?gdrive=` forwarder; SettingsLayout v2 (grouped rail ≥1024px, home/back pattern <1024px);
   fix the stale "1280" comments (real breakpoint 1024).
7. App.jsx: full `/settings/*` tree + the 5 permanent redirects + `/help` unwrap; navItems.jsx
   restructure (grouped SETTINGS_NAV slice; NAV_ITEMS System section → single Settings entry
   with any-visible-child + `hideForRoles:['crm_partner']`; carry the `roadmap` OVERFLOW
   entry; F pre-adds ALL new icons here); Sidebar/TopNav/OverflowDrawer consume
   `isItemVisible`; GC3-GC8.
8. Pre-commit ALL cross-phase merge magnets: 7 empty reserved css markers
   (`/* ─── SETTINGS OVERHAUL RESERVED — P<n> (Session <X>) ─── */`, appended BELOW every
   existing initiative marker), pre-labeled per-phase sub-headers in `UPR-Web-Context.md`,
   pre-labeled checklist blocks in THIS doc.
9. Ownership manifest `.claude/rules/settings-overhaul-wave-ownership.md` (from the matrix
   below) + re-point Schedule Session B's anchors in `docs/schedule-dispatch.md`/roadmap
   (owner-approved): B's `navItems.jsx:77/:117` deletions → the grouped slice; its
   `Admin.jsx:979` row → `src/lib/navKeys.js`; doc-sweep of retired URLs in
   QBO-BILLING-STATUS.md / UPR-Web-Context.md. Optional: add this initiative to
   `src/lib/roadmapData.js` (public /roadmap page).

Close-out: named test-first targets (delete_demo_schema refusal test · redirect test for all
5 retired routes · SettingsHome any-visible-child visibility test incl. the override-only
supervisor fixture · templates-editor mount fetch) → `npm run test` + `build` + eslint
(changed files) → `migration-safety-checker` + `upr-pattern-checker` +
`settings-phase-reviewer` (Opus) → visual check (desktop rail · 1024-1279 tablet · <768
mobile home) → UPR-Web-Context.md → reconcile THIS doc's Phase F checklist both directions →
push, PR into `dev` ready-to-merge, **stop** (owner merges; no babysitting).

- [ ] F1 migration applied + refusal test green
- [ ] F2 shared modules extracted with tests
- [ ] F3 Settings.jsx dissolved (6 sub-pages live)
- [ ] F4 Admin.jsx split (4 sub-pages live)
- [ ] F5 git-mvs done
- [ ] F6 SettingsHome + hub v2 + breakpoint comments fixed
- [ ] F7 routes/redirects/nav + GC3-GC8
- [ ] F8 markers + doc pre-seeding
- [ ] F9 manifest + Schedule-B re-point + doc sweep
- [ ] Reviewer gauntlet + visual + honest checklist reconciliation

**Scope:** owns every file named in steps 1-9; wave sessions own everything else. Fallback
(disclosed, non-failing): sub-routes may ship as thin tab-prop wrappers around the untouched
monoliths with physical splits transferring to P3/P4.

### Wave 1 (parallel after F merges; merge preference P2 → P1 → P3 → P4/P5/P6 — preference, never a gate)

**P1 — Payments** (Opus · high — real money)
> Owns `src/pages/settings/Payments.jsx`, new `src/lib/useBillingSettings.js`,
> `src/pages/Collections.jsx` (gear link retarget), css §P1.
- [ ] useBillingSettings hook: revert-on-error (kills the optimistic-write drift)
- [ ] **two-click confirm on Instant Payout** (one-click Stripe payout today — Rule-2 spirit)
- [ ] canEditBilling in-component block preserved verbatim (it is the page's only barrier)
- [ ] classes/tokens replace inline soup; mobile pass; header/section-card patterns

**P2 — Integrations** (Opus · medium)
> Owns `src/pages/settings/Integrations.jsx`, `functions/api/quickbooks-callback.js` (+
> `quickbooks-connect.js` if the redirect lives there), css §P2.
- [ ] QBO connect/sync card rebuilt beside GitHub card (from DevTools tab, behavior-identical)
- [ ] worker 302 retargeted `/dev-tools?qbo=` → `/settings/integrations?qbo=` — **worker +
      page land in the SAME PR** (atomic round-trip)
- [ ] de-CRM the classes (or bless them — one decision, applied consistently); "API Keys" label retired

**P3 — Team & Access** (Opus · medium)
> Owns `src/pages/settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx`, css §P3.
> Consumes `src/lib/navKeys.js` (its pages ONLY — rewiring other consumers is an F-owner follow-up).
- [ ] employee hard-delete modal → inline two-click (Rule 2)
- [ ] EmployeeModal unsaved-changes guard (overlay-click silently discards today)
- [ ] PageAccess inline-grid soup → classes + mobile (fixed 340px grid crushes phones)
- [ ] absorb the DevTools employee auth-link/invite capability into Team

**P4 — Workspace + Personal polish** (Sonnet · medium)
> Owns `src/pages/settings/{Carriers,Referrals,Templates,Commissions,MyAccount}.jsx` (+
> templates module pages), `functions/api/google-drive-callback.js` (retarget to
> `/settings/my-account` — F's forwarder becomes a permanent shim), css §P4.
- [ ] templates editor route: own fetch + router-level dirty guard; Reset gets a confirm
- [ ] hex→token sweep; Commissions grid mobile reflow; consistent empty states

**P5 — Feedback Inbox** (Sonnet · medium)
> Owns `src/pages/settings/FeedbackInbox.jsx`, `functions/api/feedback-notify.js` (+ its
> test), css §P5.
- [ ] worker stops minting `/tech-feedback` into push payloads + durable `notifications.link`
      rows (writes `/settings/feedback`); test updated to the new route (route change, not a
      test-green edit)
- [ ] inline `<style>` block → index.css §P5; label "Feedback Inbox"; badge-hex → tokens

**P6 — Scope Sheets** (Opus · medium — publish blast radius is production-wide)
> Owns `src/pages/settings/ScopeSheets.jsx`, new `src/lib/demoSchemaUtils.js`, css §P6.
- [ ] `window.confirm` ×3 → inline two-click; field-removal gets an arm state
- [ ] raw `db.delete` → `delete_demo_schema` RPC (F's safe version); "published versions
      can't be deleted" surfaced in UI
- [ ] unsaved-changes guard on version-switch/back; "best on desktop" notice <768px
- [ ] demoSchemaUtils extracted from page internals ONLY (TechDemoSheet/DemoSheetRenderer
      needs → stop and flag, tech surface out of scope)

**P7-lite — DevTools dedup** (Sonnet · medium; **serial: launch after BOTH P2 and P3 merge**)
> Owns `src/pages/DevTools.jsx` (delete the Integrations tab + Employees tab and their
> now-dead `?qbo=` handling — nothing else).

### Anytime lane (no wave slot, no initiative dependency)
DevTools full split/polish (2831 lines → `src/pages/devtools/**`, URL-synced tabs via
searchParams, shared TabLoading adoption) · Help.jsx per-guide split (hash contract
`#guide/section` preserved verbatim — HelpLink consumers) · owner data fix: 5/20 employees
have NULL email (notify-roadmap finding, affects email channel).

## Dependency graph (edge types named)

```
Phase 0 ✅ ──(independent, shipped)
        F ══hard══▶ P1 ─┐
        F ══hard══▶ P2 ─┼─ parallel wave ─▶ P2+P3 ──soft-serial──▶ P7-lite
        F ══hard══▶ P3 ─┤
        F ══hard══▶ P4 ─┤   (P4/P5/P6 order-free)
        F ══hard══▶ P5 ─┤
        F ══hard══▶ P6 ─┘
coordination edges: Schedule-B (anchors re-pointed BY F) · tech-v2 M2 (App.jsx tech region,
  rebase-aware) · omni-inbox F/U + schedule A/B/C + tech-v2 M1 (index.css EOF markers —
  append below existing, never touch another initiative's marker, second-lander rebases)
future/unscheduled edges: CRM settings absorption into this IA (post-CRM-wave) · office dark
  theme (unblocked by the wave's token pass; ThemeContext already shipped) · office i18n ·
  office "My Preferences" page (theme/language) once either lands
```

## Dispatch model
Wave 0 = F alone (Phase 0 already shipped). Wave 1 = P1-P6 simultaneously once F merges —
**merge order within the wave is a preference, never a gate; throttle to your review
bandwidth**. P7-lite after P2+P3. Every session: harness-assigned branch cut from
`origin/dev`, PR into `dev` as a ready-to-merge handoff, then stop — no babysitting,
owner merges. No feature flag for the reorg (options on record below).

## Ownership matrix (spec for the F-committed manifest)

| Session | Phase | Owns exclusively | Frozen for everyone in-wave |
|---|---|---|---|
| F | Foundation | everything in steps 1-9 above | after F: `App.jsx`, `navItems.jsx` (+icons), `SettingsLayout.jsx`, `SettingsHome.jsx`, `components/settings/*` primitives (incl. `NotificationPrefsMatrix`, `PushDevicesList` — shared with /tech/settings), `components/TabLoading.jsx`, `src/lib/{navKeys,owner,toast,featureFlags,realtime}.js`, `components/{Layout,Sidebar,TopNav,OverflowDrawer,Icons}.jsx`, `functions/lib/*` (also omni-inbox/CRM-frozen), `package.json`+lock, all `supabase/migrations/`, `index.css` outside own marker |
| A | P1 | `settings/Payments.jsx`, `src/lib/useBillingSettings.js`, `Collections.jsx`, css §P1 | — |
| B | P2 | `settings/Integrations.jsx`, `functions/api/quickbooks-callback.js` (+connect if needed), css §P2 | — |
| C | P3 | `settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx`, css §P3 | — |
| D | P4 | `settings/{Carriers,Referrals,Templates,Commissions,MyAccount}.jsx` + templates pages, `functions/api/google-drive-callback.js`, css §P4 | — |
| E | P5 | `settings/FeedbackInbox.jsx`, `functions/api/feedback-notify.js`(+test), css §P5 | — |
| G | P6 | `settings/ScopeSheets.jsx`, `src/lib/demoSchemaUtils.js`, css §P6 | — |
| H | P7-lite | `src/pages/DevTools.jsx` (two tab deletions only) | — |

**Migration rule:** F owns 100% of schema (one additive migration). Wave sessions ship
**zero migrations** — no exceptions surfaced; if a phase discovers it needs one, stop and
flag. Escape hatch for frozen files (tech-v2 precedent): disclosed copy-in or an F-owner
follow-up PR — never an in-wave edit. New worker registrations in DevTools' WORKER_NAMES
during the wave go through P7-lite's owner.

## Options on record
1. **Mobile** — A: SettingsHome index + back-headers (CHOSEN); B: status quo flat pages;
   C: flat sidebar entries. A wins: additive CSS, fixes API-Keys unreachability, gives the
   one-guess property everywhere. Caveat under which B wins: none found — B leaves a nav
   dead-zone <1024px.
2. **No feature flag** (CHOSEN) vs `page:settings_v2` — flagging route moves means dual route
   trees + keeping both monoliths alive as the flag-off path for the whole wave. This is a
   verbatim-move reorg, not a rewrite; permanent redirects + git-revert (scope-sheet-rollback
   layer-2 pattern) are the insurance. Caveat under which the flag wins: if F's fallback
   wrappers ship broken in a way redirects can't mask — then revert, don't flag.
3. **/admin under /settings** (CHOSEN) vs keep top-level — the shipped hub already renders
   Admin inside a Settings-titled rail; Team+Roles+PageAccess is one workflow; redirect
   preserves muscle memory. 4. **F as one session** (CHOSEN, with checkpoints + fallback) vs
   F1/F2 split — both halves would edit the same three seam files; repo precedent (CRM F,
   tech-v2 F) is one fat foundation. 5. **Tracker** — this doc's checklists (CHOSEN); no
   crm_build_phases clone without owner-funded scope.

## What resisted maximum parallelism
- **F is a single point of failure** — priced: per-step commits, thin-wrapper fallback,
  reviewer gauntlet, no-flag decision revisited above.
- **P7-lite is inherently serial** (dedup can't precede the surfaces it dedups).
- **index.css EOF** is a four-initiative append zone (us, omni-inbox, schedule, tech-v2 M1) —
  rule: append below all existing markers, never resolve a conflict by deleting another
  initiative's marker.
- **Schedule-B / tech-v2-M2 coordination** — dissolved by F re-pointing B's anchors
  (owner-approved) and region-disjoint App.jsx edits for M2; the manifests' freezes bind only
  their own initiatives' sessions (precedent: tech-v2 F edited App.jsx under the CRM freeze).
- **Stale PRs #102/#110/#224** — owner-accepted bit-rot (2026-07-04): the wave rewrites
  PaymentSettings/DevTools/Settings/Admin; those branches will need rebasing if ever revived.
- **Rule bent (transparency):** UPR-Design-System's "modals OK for admin confirms" yields to
  CLAUDE.md Rule 2 (two-click inline) everywhere in this initiative — Rule 2 is the stricter,
  newer standard and the design doc's own delete pattern agrees.

## Challenge report (run before this doc was committed; 7 agents)
- **REFUTED:** "route gating is behavior-identical" → Phase 0 extracted + GC3 any-visible-child
  + GC8 owner decision. "Redirect map complete" → feedback-notify.js added to P5; `?gdrive=`
  moved into F; redirects made permanent.
- **MODIFIED:** F scope (+LookupTable/templates/navKeys extractions; templates editor is a
  light rework not a verbatim move); preconditions (Schedule-B + tech-v2 C/M2 — since
  resolved: C merged, B re-point approved); mobile entry rule (any-visible-child; Sidebar
  lacks hideForRoles support → GC7); breakpoint is 1024 not 1280.
- **SUSTAINED (counter-ordering):** Phase-0 extraction · P8 Help → anytime lane · P7 →
  P7-lite · merge preference P2→P1→P3 · `delete_demo_schema` must refuse published/referenced
  versions. **OVERRULED:** splitting F · keeping /admin top-level · feature-flagging the reorg.
- **Post-challenge re-verification (2026-07-04, dev @ 8716fdc):** notify initiative fully
  merged (two new tabs absorbed as verbatim moves — no polish phase needed, they're fresh
  design-system-native code); tech-v2 S/D/C merged (launch gate dissolved); omni-inbox plan
  landed (index.css coordination only); tech settings screen exists (out of scope); Phase 0
  exposure was still live → shipped same day.

---

## Wave checklist blocks (pre-seeded by Phase F — edit ONLY your own block)

Each Wave-1 session ticks its own block below and reconciles it honestly (both directions)
before opening its PR. Do not edit another session's block.

### Phase F — Foundation (Session F) ✅ complete
- [x] F1 migration applied + refusal test green (`delete_demo_schema`; published_at column)
- [x] F2 shared modules extracted with tests (navKeys, owner, TabLoading, settings primitives, templates module)
- [x] F3 Settings.jsx dissolved (6 sub-pages live)
- [x] F4 Admin.jsx split (4 sub-pages live)
- [x] F5 git-mvs done (Payments/Integrations/FeedbackInbox/ScopeSheets)
- [x] F6 SettingsHome + hub v2 + breakpoint comments fixed (1024, not 1280)
- [x] F7 routes/redirects/nav + GC3-GC8 (5 permanent redirects, /help unwrapped)
- [x] F8 markers + doc pre-seeding (7 CSS markers, UPR-Web-Context sub-headers, these blocks)
- [x] F9 manifest + Schedule-B re-point + doc sweep
- [x] Reviewer gauntlet + visual + honest checklist reconciliation

### P1 — Payments (Session A)
- [ ] useBillingSettings hook: revert-on-error (kills the optimistic-write drift)
- [ ] two-click confirm on Instant Payout
- [ ] canEditBilling in-component block preserved verbatim
- [ ] classes/tokens replace inline soup; mobile pass; header/section-card patterns

### P2 — Integrations (Session B)
- [ ] QBO connect/sync card rebuilt beside GitHub card (behavior-identical)
- [ ] worker 302 retargeted `/dev-tools?qbo=` → `/settings/integrations?qbo=` (atomic round-trip)
- [ ] de-CRM the classes (or bless them — one decision); "API Keys" label retired

### P3 — Team & Access (Session C)
- [ ] employee hard-delete modal → inline two-click (Rule 2)
- [ ] EmployeeModal unsaved-changes guard
- [ ] PageAccess inline-grid soup → classes + mobile
- [ ] absorb the DevTools employee auth-link/invite capability into Team

### P4 — Workspace + Personal polish (Session D)
- [ ] templates editor route: own fetch + router-level dirty guard verified; Reset gets a confirm
- [ ] hex→token sweep; Commissions grid mobile reflow; consistent empty states
- [ ] google-drive-callback.js retargeted to `/settings/my-account?gdrive=` (F's forwarder becomes a shim)

### P5 — Feedback Inbox (Session E)
- [ ] feedback-notify.js writes `/settings/feedback` (route change, not a test-green edit); test updated
- [ ] inline `<style>` block → index.css §P5; label "Feedback Inbox"; badge-hex → tokens

### P6 — Scope Sheets (Session G)
- [ ] `window.confirm` ×3 → inline two-click; field-removal arm state
- [ ] raw `db.delete` → `delete_demo_schema` RPC (F's safe version); refusal surfaced in UI
- [ ] unsaved-changes guard on version-switch/back; "best on desktop" notice <768px
- [ ] demoSchemaUtils extracted (page internals only)

### P7-lite — DevTools dedup (Session H, after P2+P3 merge)
- [ ] delete the Integrations tab (+ its `?qbo=` handling) — verify /settings/integrations covers it first
- [ ] delete the Employees tab — verify /settings/team covers it first
