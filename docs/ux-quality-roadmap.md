# UX Quality & Uniformity — Roadmap (2026-07-13)

This document is the **plan of record** for the UX Quality initiative: making every UPR surface —
desktop office app and field-tech mobile PWA — behave and look uniformly, and installing the standards
+ enforcement so everything built from now on ships that way **without manual UX/UI cleanup**.

It was produced by a masterplan-standard planning session: an 11-auditor read-only multi-agent sweep
(behavior/lifecycle, design tokens, components, mobile UX, desktop UX, data loading, code quality,
performance, workers, standards-infrastructure, a11y/i18n) → synthesis → an adversarial verification
pass (7 of 8 critical claims re-verified against live file reads; 5 CONFIRMED, 2 confirmed-with-nuance).
**All findings below are grounded in `file:line` evidence from real file reads, not memory or docs.**

Companion docs: launch blocks in [`docs/ux-quality-dispatch.md`](ux-quality-dispatch.md); the binding
file ownership split in
[`.claude/rules/ux-alignment-wave-ownership.md`](../.claude/rules/ux-alignment-wave-ownership.md); the
standing rules this initiative installs in `.claude/rules/{page-lifecycle,loading-error-states,`
`perf-budget,close-out-standard,workers-standard}.md`.

**Owner decisions (2026-07-13):** design target = **prep-for-redesign** (consolidate every page onto
shared primitives + tokens keeping today's look, so a future redesign is a one-place swap, never a
second pass over 63 pages). Sequencing = **foundation-first** (standards + primitives ship before next
week's feature push; existing-page alignment runs as a parallel wave alongside the feature work).

---

## Executive summary

UPR is a **two-speed codebase.** Its newest surfaces — tech-v2 (dash/schedule/messages), the CRM
family, the settings hub, the Overview widgets — already embody every pattern the rest of the app
needs: react-query caching, silent refetch, cold-start-only skeletons, tokenized colors, per-card
error+retry. The older half — 9 legacy tech pages, the big desktop pages, older workers — hand-rolls
the same concerns with divergent semantics. **The consequence is the drift the owner reported: every
page a slightly different behavior, refresh, and look.**

The most important implication for cost and risk: **every fix already exists in-repo as a gold
standard.** Remediation is *copying a proven sibling pattern*, not inventing — which makes this
initiative low-risk and lets the standards docs cite live exemplars instead of theory.

**Root causes:**
1. **No written law for page behavior.** CLAUDE.md and the rules corpus say nothing about loading,
   error, resume, or scroll semantics — so 8 files hand-roll visibility refetch, 6 loading primitives
   coexist, and a failed load can render the success empty-state.
2. **The design doc contradicts itself.** `UPR-Design-System.md` prescribes copy-paste inline hex
   recipes two sections after banning hardcoded colors — so duplication is by construction (the blessed
   status triplets alone account for ~727 of 1,644 hex literals).
3. **Enforcement asymmetry.** The database lane is guarded by hooks + agents + (partial) CI; the UI lane
   and the direct-to-`dev` default workflow have **zero** automated gates.
4. **Primitives built, adoption abandoned.** Shared modules exist whose purpose is defeated by
   near-zero adoption (`format.js`: 0 importers vs ≥44 local copies) — every extraction historically
   shipped without migrating call sites, so drift compounded.

---

## Hardening findings — fix regardless of any redesign (Phase 0)

These are correctness/robustness items independent of design. Each was verified against live file reads.
Interim guidance holds until the fix lands.

| # | Finding | Evidence | Verify | Interim guidance |
|---|---|---|---|---|
| H1 | Shared REST client re-sends a timed-out request once, including non-idempotent writes (insert/update/rpc), risking duplicate rows | `src/lib/supabase.js:35-48` (retry on `timed out` / `Failed to fetch`) | CONFIRMED | Restrict retry to `select()`; writers already tolerate a thrown error |
| H2 | Three Encircle proxy workers accept requests with no inbound auth (one is a mutating POST); they expose claim data and an upload path | `functions/api/encircle-{search,rooms,upload}.js` (env-key check only, no `requireAuth`) | CONFIRMED | Add `requireAuth` (copy `sync-encircle.js`) + Bearer headers on the browser callers |
| H3 | `purge-feedback-media` is an unauthenticated GET that deletes storage objects with a caller-supplied retention window | `functions/api/purge-feedback-media.js:298-311` (no auth, `dryRun` default false) | CONFIRMED (nuance) | Add cron-secret gate (copy `process-scheduled.js`); clamp `days ≥ 30`; default `dryRun` true |
| H4 | Money/campaign workers enforce role only in the UI; the server accepts any authenticated employee token | `stripe-payout.js`, `qbo-payment/charge/invoice/estimate.js`, `send-email-campaign.js` | code fact CONFIRMED | Add a server-side `requireRole` gate before any money/campaign side effect |
| H5 | Instant-payout idempotency key is `Date.now()`, so a retry/double-click can create a second payout | `stripe-payout.js:41` → `functions/lib/stripe.js:58` | CONFIRMED (nuance) | Require a client-supplied UUID (or content-derived) idempotency key |
| H6 | The destructive-SQL safety hook never fires in cloud sessions (matcher keyed to a server name the cloud harness doesn't use) | `.claude/settings.json:26` vs live tool id `mcp__<uuid>__apply_migration` | CONFIRMED | Broaden matcher to `mcp__.*__apply_migration\|mcp__.*__execute_sql` |
| H7 | Appointment crew sync is a non-atomic delete-all-then-per-row-insert loop, duplicated in 3 files | `TechEditAppointment.jsx:247-254`, `EditAppointmentModal.jsx:223-230`, +1 component | CONFIRMED (corrected paths) | Interim: array-insert all rows before the delete; full `sync_appointment_crew` RPC in F-B |
| H8 | Failed loads render the success empty-state or a blank page on the highest-traffic screens | `Schedule.jsx:529→769`, `JobPage.jsx:84→130`, `CustomerPage.jsx` | CONFIRMED | Add an error branch (banner + Retry, keep stale rows) — pattern exists at `TechJobDetail.jsx:330` |
| H9 | Job photos upload uncompressed and render full-resolution originals into thumbnail grids (~300MB over cellular for a 100-photo job) | 0 uses of storage render transforms; `mediaCompress.js` unused on that path; upload block copied ×8 | CONFIRMED | Route uploads through `mediaCompress.js`; thumbnails via storage render URLs (lands in W1) |

H1, H2, H4, H5, H8 are the review-weighted items (money, PII, duplicate writes). H6–H9 are hardening.

---

## Baseline metrics (the re-measure contract for every wave close-out)

- **Design:** 1,644 hardcoded hex in `src/**/*.jsx` (836 distinct vs a ~12-color intended palette; 107
  of 280 files); 297 hex on the dark-capable tech surface; status color defined in 5+ sources, division
  in 3.
- **Behavior:** 11 surfaces blank a rendered page on PTR/mutation-refetch; 8 hand-rolled
  visibility/focus handlers with 4 divergent semantics, 0 shared hook; 4 of 7 polls lack a
  `document.hidden` guard; 0 scroll-restoration primitives (3 shell behaviors); 1 full-reload in-app nav.
- **Components:** 6 loading primitives concurrent; 125 raw `upr:toast` dispatches (84 files) + 22 local
  `errToast` copies vs 36 `lib/toast` importers; 158 inline status pills vs 7 using the shared class;
  ~45 modal implementations (0 with `role=dialog`, 0 focus traps); 26 two-click-delete reimplementations
  (5 wordings); `format.js` importers: 0 vs ≥44 local formatters.
- **Perf:** boot 232KB gzip JS + 56KB gzip CSS (`index.css` 384KB / 11,446 lines); i18n chunk 34KB gz
  (all locales eager); 2 render-blocking Google Fonts stylesheets; 0 image-transform uses; 7 unbounded
  primary-list fetches; employees roster fetched at 14 independent call sites.
- **Workers:** 75 workers; 4 unauthenticated not-by-design; ~8 money/campaign role-gated UI-only;
  `requireAuth` copy-pasted ×14 + ~20 inline; 0 outbound fetches with a timeout; `worker_runs`
  hand-rolled in 31; webhook idempotency 7/7 (good).
- **Quality/gates:** 153 real eslint problems (doc says 175); 1 custom rule; CI on push→`dev`: none;
  reviewer agents auto-invoked: 0; 108/197 icon-only buttons unlabeled; 8 tech pages + 5 field sheets
  English-only; header coverage src 81% / functions 59%; 24 src files >800 lines (DevTools 2,516);
  3 dead files.

---

## Phases

Sized for one focused session each. Foundation-first: **F-S1** (this session — laws + enforcement) and
**Phase 0** (this session — hardening) land first; **F-S2** (primitives/tokens) and **F-B** (backend
foundation) are the wave gate; **W1–W5** align existing pages in parallel once their foundation merges;
**W6** is a fold-in ledger, not a session.

### Phase 0 — Hardening patches · this session
> **Branch** session-assigned · **Prereq** none · **Model·effort** Opus·high (money/PII seams) ·
> **Read scope** CLAUDE.md + `.claude/rules/database-standard.md` + `workers-standard.md` (from F-S1)
Close every item in the Hardening table (H1–H8; H9 lands in W1). Smallest possible diffs, test-first
(401-without-Bearer / 200-with; idempotency-key stability; retry-select-only). Verify each worker-auth
change against its real browser caller before merge (e.g. `TechDemoSheet.jsx:119` needs the Bearer
header added when `encircle-search` starts requiring auth). Gauntlet: `upr-pattern-checker` +
`anon-grant-auditor` posture on the worker gates.

**Shipped 2026-07-13 (honest scope reconciliation):** H1 (retry select-only), H2 (encircle ×3
`requireAuth` + Bearer on all 3 `TechDemoSheet` callers), H3 (purge cron-secret gate + `days ≥ 30`
floor), H5 (payout idempotency key: client-UUID per action), H6 (hook matcher `mcp__.*__`), and the
**stripe-payout** role gate (`['admin','manager']`, mirrors `claimUtils.BILLING_EDIT_ROLES`; its sole
caller is already `canEditBilling`-gated). Tests in `functions/api/phase0-security-gates.test.js`
(unauthenticated → 401 on all 5 endpoints, 503-unchanged for dormant Stripe).
**Deferred to F-B (severity-based, to avoid a blind production break):** the *broad* money-worker
role gate on `qbo-payment/invoice/estimate/charge` + `send-email-campaign` — their callers span roles
(gating `qbo-estimate` to billing-roles-only would break estimators), so F-B maps each endpoint's
legitimate roles with per-endpoint tests. These already require a valid employee token (insider risk,
not internet-facing). H7 (crew-sync atomicity) also folds into F-B's `sync_appointment_crew` RPC
rather than churning 3 files with an interim non-atomic tweak.

### F-S1 — Standards & enforcement · this session
> **Branch** session-assigned · **Prereq** Phase 0 merged (shares eslint/CI/settings files) ·
> **Model·effort** Opus·high · **Read scope** CLAUDE.md + the full audit
Create the five rule docs + two checker agents; amend `upr-pattern-checker`, `eslint.config.js`
(changed-files ratchet), `.github/workflows/ci.yml` (dev gate + bundle guard), `CLAUDE.md`,
`tech-mobile-ux.md`, `documentation-standard.md`, and the `masterplan` skill (5 changes). Zero runtime
code except eslint/CI config. Contents are enumerated in the Deliverables section of the plan of record
and in `ux-quality-dispatch.md`.

### F-S2 — Primitives & tokens foundation · dispatched (XL)
> **Prereq** F-S1 merged · **Model·effort** Opus·high · **Owns** `src/components/ui/**`, `src/hooks/**`
> new primitives, `src/index.css` `:root` token block, `UPR-Design-System.md`
Mint the `:root` semantic token family (`--success/--danger/--warning/--info/--neutral` + `-bg`/`-border`
from the dominant in-code values); build `Modal` (role=dialog, focus trap, mobile bottom-sheet),
`StatusPill`, `EmptyState`, `ErrorState`, `PageHeader`, `SearchInput`, `IconButton`, `useResumeRefetch`,
`useTwoClickConfirm`, `useLookup`, `usePhotoUpload`+`thumbUrl`. Rewrite `UPR-Design-System.md` from
inline-hex recipes to component imports (Kit Registry, dark-theme contract, color tables regenerated
from code). Ships primitives **with** the doc sections — the enforcement demands it.

### F-B — Backend foundation · dispatched (L, parallel with F-S2, disjoint files)
> **Prereq** Phase 0 merged · **Owns** `functions/lib/{auth,http,worker-runs}.js`, the new RPCs, worker tests
`functions/lib/auth.js` full sweep (delete the 14 `requireAuth` copies + ~20 inline verifies);
`lib/http.js` `fetchWithTimeout` adopted inside twilio/quickbooks/email/callrail libs; `worker-runs.js`
helper (migrate 31 hand-rolled inserts); transactional RPCs `sync_appointment_crew`, `save_estimate_lines`,
`get_jobs_list` (db-migration skill discipline); money-worker tests (qbo-payment, stripe-webhook); offline
queue extended with `note.insert` + `task.toggle`.

### W1 — Tech legacy behavior + dark mode · dispatched (L)
> **Prereq** F-S2 merged · **Owns** the 9 legacy tech pages + `TechLayout` toast
Delete `setLoading(true)` from `load()` on the 9 PTR-blanking pages (TechAppointment's non-blanking
load is the template); TechAppointment tap-targets (48px)/status-pill/lazy-images; dark-mode sweep
(TechLayout toast first — fixes all 22 tech pages in one file; then the ~297 tech-surface hex →
`var(--status-*)`); `usePhotoUpload`+compression on the 8 copy sites (H9).

### W2 — Desktop behavior alignment · dispatched (L)
> **Prereq** F-S2 merged · **Owns** Schedule/ClaimPage/JobPage/CustomerPage/list pages
Schedule's 6 modal/panel callbacks → the existing `silentReloadBoard`; ClaimPage `{silent}` loads;
JobPage/CustomerPage `ErrorState`; failure→empty-state fixes (Estimates path, Customers, Leads,
Marketing); `ClaimsList` job pills → `navigate()`; Collections tabs stay mounted; `useResumeRefetch`
migration of the 8 hand-rolled handlers; `document.hidden` guards on the 4 unguarded polls; git-rm the
3 dead files.

### W3 — Component & toast adoption codemods · dispatched (L, mechanical, zero restyle)
> **Prereq** F-S2 merged · **Owns** the codemod sweeps (cross-cutting, coordinate via manifest)
Toast (125 dispatches + 22 `errToast` → `lib/toast`, then flip the eslint rule to error); `StatusPill`
(158 inline pills + 7 local triplet maps); `Modal` (33 inline overlays + `conv-modal`); icon
consolidation; `SearchInput` (6 impls); formatter adoption (`format.js` absorbs 44 locals, phone first);
`useTwoClickConfirm` (26 sites).

### W4 — A11y & i18n · dispatched (M, rides W3 primitives)
> **Prereq** W3 primitives in use · **Owns** labels, Field adoption, tech i18n namespaces
`IconButton` labels on 108 unnamed icon buttons; `Field`/`htmlFor` on top forms; tech i18n for 8 pages
+ 5 field sheets (~310 strings, sheets first, parity-tested); `html lang` sync; keyboard-inset hook on
3 fixed bottom sheets. Record decisions: desktop = English-only by design; admin-mobile English-only
until a non-English admin exists.

### W5 — Boot & data performance · dispatched (L; SW item owner-gated)
> **Prereq** F-S2 merged (budget doc governs) · **Owns** fonts, lazy-loads, lookup rollout
Self-host subsetted Inter (500/600/700 woff2); Public Sans scoped to the CRM chunk; lazy pt/es locales;
`useMemo` the AuthContext value; `useLookup` rollout (14 roster sites + 3 job_phases); Jobs/Production
onto `get_jobs_list`. **OWNER-GATED (RED):** precache-only service worker (assets-only, content-type
verified, network-only navigations, flag + `/reset` escape hatch preserved) — restores offline shell;
needs explicit owner OK given the prior SW kill-switch incident.

### W6 — Coordinated fold-ins (ledger, not a session)
Findings routed to the initiatives that own those files, recorded in their roadmap docs during F-S1 so
no work is duplicated and no manifest is violated:
- **→ sms-experience Phase C:** Conversations list RPC + incremental INSERT merge; focus-refetch debounce; MessageBubble `React.memo`.
- **→ Job Hub v2 H3:** TechAppointment/TechJobDetail retirement absorbs their remaining restyle debt.
- **→ db-foundation P8:** consumes W1's `usePhotoUpload`/`thumbUrl` as its signed-URL seam.
- **→ Schedule Desktop initiative:** ScheduleTemplates rebuild; Schedule inline-modal/palette conversion.
- **→ next scope-sheet touch:** `DemoSheetRenderer` palette `C` → `var()` strings (19-line swap).
- **→ next DevTools touch:** split the 2,516-line file into `src/pages/devtools/*`.

---

## Dependency graph

```
Phase 0 ──► F-S1 ──►┬─► F-S2 ─►┬─► W1 (tech)      ─┐
(hardening)(laws)   │          ├─► W2 (desktop)    ├─► W4 (a11y/i18n, after W3)
                    └─► F-B ───┘  ├─► W3 (codemods) ┘
                    (backend, ∥ F-S2)   └─► W5 (perf; SW item owner-gated)
W6 = fold-ins into other initiatives' schedules (no session)
```
Edge types: **F-S1 → everything** (laws + primitives spec). **F-S2 ∥ F-B** (disjoint files). **W1/W2/W3/W5
∥** once F-S2 merges (disjoint page/file sets per the ownership manifest). **W4 after W3** (consumes its
primitives). Merge order within a wave is a preference, never a gate — throttle to review bandwidth.

---

## Dispatch model & ownership

Wave 0 = **Phase 0 + F-S1** (this session). Wave 1 = **F-S2 ∥ F-B** once F-S1 merges. Wave 2 = **W1–W5**
once their foundation merges. The binding file split is
[`.claude/rules/ux-alignment-wave-ownership.md`](../.claude/rules/ux-alignment-wave-ownership.md);
copy-paste launch blocks are in [`docs/ux-quality-dispatch.md`](ux-quality-dispatch.md). Every wave
session's close-out re-measures its slice of the baseline metrics table above and follows
`.claude/rules/close-out-standard.md` (build+test+eslint → 3-agent gauntlet → minimize/resume test →
390px mobile check → perf delta → docs → PR-into-`dev`-and-stop).

## What resisted maximum parallelism

- **F-S2 is a single point of failure** for the whole alignment wave (every W-session imports its
  primitives) — priced in via the reviewer gauntlet on F-S2 and by shipping primitives *with* their doc
  sections.
- **W3 codemods are cross-cutting** (toast/pill/modal touch many files) — the manifest reserves the
  codemod sweeps to W3 so W1/W2 don't co-edit the same lines; W1/W2 use the primitives, W3 migrates the
  long tail.
- **The service worker (W5)** is RED/owner-gated — a prior SW change caused a production incident; it
  ships only on explicit owner OK, behind a flag with the `/reset` escape hatch preserved.
- **Desktop restyle debt** (ScheduleTemplates, TechAppointment) is deliberately *not* fixed here — it
  folds into the owner's planned redesign / owning initiatives (W6), so no surface is restyled twice.
