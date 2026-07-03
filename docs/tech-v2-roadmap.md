# Tech Mobile Experience v2 — Dashboard + Schedule rebuild → Job Hub merge (Roadmap, 2026-07-03)

Produced by the tech-v2 masterplan session (3-agent live-verified inventory + 6-agent
adversarial challenge pass; outcomes folded in — see the Challenge Report at the bottom).
This is the **dispatch model of record** for the initiative. Companion doc:
`docs/tech-v2-dispatch.md` (copy-paste cold-session launch blocks).
Non-CRM initiative → **progress is tracked by the per-phase checklists in THIS doc**
(the CRM `crm_build_phases` tracker is not used — on record). The file-ownership manifest
`.claude/rules/tech-v2-wave-ownership.md` is committed later BY Phase F.

## Context & goal

TechDash (`/tech`) and TechSchedule (`/tech/schedule`) are the field techs' daily surfaces
and the owner's #1 complaint: glitchy, slow, unpolished, low information value. Target bar
(owner's words): **indistinguishable in feel from Apple/Google Calendar.** The later
TechAppointment + TechJobDetail merge ("Job Hub") is in scope as concrete phases. All
verdicts below were verified live (Supabase `glsmljpabrwonfiltiqm`) or by file reads —
never assumed from docs.

**Live scale (2026-07-03):** 230 appointments total (78 in the current ±30d window),
6 field techs, 20 employees, 161 time entries, 196 job_tasks. Data is tiny — UI surface
area, not scale, is the problem.

**In-flight work on these surfaces:** none found (finish-first list empty; the June 2026
clock hardening migrations are shipped and stable).

**Owner pre-decisions (2026-07-03, locked):**
① flag-gated parallel build (new files; legacy untouched until cutover);
② small best-in-class deps OK (TanStack Query; justified on record below);
③ Job Hub merge = full phases in this roadmap;
④ offline bar = instant-cache reads + existing photo queue (offline clock actions out of scope).

## Severity findings (mechanism · live exposure · interim guidance)

| # | Sev | Finding | Evidence / exposure | Interim guidance |
|---|---|---|---|---|
| 1 | P1-arch | **Remount storm** — content wrapper keyed by `location.pathname` remounts every page on every navigation; all state dies, every RPC refires, skeleton flashes | `TechLayout.jsx:227-230` (exists only to replay a 0.2s opacity fade) | None — this is why v2 exists |
| 2 | P1-perf | **Day-tap = full refetch** — schedule fetch window derives from `selectedDay`; every strip tap refetches the whole ~61-day window | `TechSchedule.jsx:486-510`; 78 rows re-fetched per tap | Phase F ships a v1 relief patch |
| 3 | P2-data | **`work_date` stamped with UTC date** by `clock_appointment_action` (OMW at/after 6pm MDT lands on TOMORROW's work_date); the midnight-split writer uses America/Denver — the two writers disagree | Live: 1 of 158 clocked rows misdated (row `6a807f95-f65b-44f9-80c4-676c7a5f6bbb`: clock_in 2026-03-25 02:22Z = Mar 24 8:22pm MDT, work_date 2026-03-25); payroll groups by `work_date` | Fix = body-only REPLACE in Phase F; until then evening clock-ins may misdate a day |
| 4 | P2-hygiene | **Schema drift ×13** — core tech RPCs exist live with ZERO migration coverage: `get_my_appointments_today`, `get_active_appointment_geo`, `get_appointment_tasks`, `get_assigned_tasks`, `toggle_appointment_task`, `update_appointment`, `delete_appointment`, `assign_tasks_to_appointment`, `get_unassigned_tasks`, `add_adhoc_job_task`, `get_job_task_summary`, `get_active_techs`, `get_claim_appointments` | pg_proc live vs 0 `CREATE FUNCTION` hits in `supabase/migrations/` | Never edit any of these without a `pg_get_functiondef` dump first |
| 5 | P2-ux | **Reload re-skeletons the dashboard** — `load()` sets `loading=true` unconditionally; pull-to-refresh and every post-clock-action reload blank the whole page | `TechDash.jsx:729-737,894` | Phase F ships v1 relief patch |
| 6 | P3-latent | **Cancelled would render under "Upcoming"** — the dash `future` bucket catches `status='cancelled'`; the today-feed RPC has no status filter. *Challenge-verified zero live exposure ever:* cancellation is a hard delete (`delete_appointment`); only statuses ever used are scheduled(147)/completed(82); no CHECK constraint prevents a future writer introducing `cancelled` and triggering it | `TechDash.jsx:896-899,1151-1160`; live counts = 0 | v2 feeds filter it; latent only |
| 7 | P3 | **Feed payloads strip `color`/`kind`/`duration_days`/`is_milestone`**; crew lacks `color`/`avatar_url` in the today feed (desktop `get_dispatch_board`/`get_dispatch_events` DO return color — the tech RPCs lag) | Live `pg_get_functiondef` on both tech feeds | — |

## Gap audit (taxonomy constructed for this domain — owner gave none; HAVE only from code/schema)

| # | Capability | Verdict | Evidence (abbrev.) |
|---|---|---|---|
| **A — Performance & architecture** ||||
| A1 | Instant tab switches (state survives nav) | MISSING | Finding 1 |
| A2 | Client read-cache / SWR | MISSING | No read cache anywhere; `offlineDb.cacheMeta` store exists, unused for reads |
| A3 | Day selection without refetch | MISSING | Finding 2 |
| A4 | Non-blocking refresh | PARTIAL | Schedule guards via `hasFetched` (reset by remount anyway); dash re-skeletons (Finding 5) |
| A5 | Anchored initial scroll | PARTIAL + glitch | 300ms setTimeout + `querySelector('.tech-content')` jump (`TechSchedule.jsx:601-613`) |
| **B — Schedule/calendar capability** ||||
| B1 | Agenda list, sticky day headers | HAVE | `TechSchedule.jsx:929-977` |
| B2 | Day view w/ hour grid + now-line | MISSING | Daily view is a flat row list |
| B3 | Date strip that follows any date | PARTIAL | Fixed 61-day strip built once around today (`TechSchedule.jsx:55-56,103-111`) |
| B4 | Month view | PARTIAL | Modal picker, dots only |
| B5–B8 | Color / kind / multi-day / milestone rendering | MISSING (feed) | Columns exist on `appointments` (23 cols incl. `kind` NOT NULL, `duration_days` NOT NULL, `color`, `is_milestone`); both tech feeds omit them. **Challenge-CONFIRMED:** exposing them = additive jsonb keys, zero consumer breakage |
| B9 | Recurrence | MISSING (schema) | No rrule/recurrence columns — out of scope (on record) |
| B10 | Search + persisted crew/division filters | HAVE | `TechSchedule.jsx:414-459,542-555` — carried over |
| B11 | Create flows | HAVE | `/tech/new-appointment`, `/tech/new-event` — reused as-is |
| **C — Dashboard information value** ||||
| C1 | Now/Next hero | MISSING on dash | `NowNextTile` + `pickNowNext` exist, used only on job/claim detail |
| C2 | Hours today / this week | MISSING | Data exists — stored `hours` col + `travel_minutes` (see hours formula) |
| C3 | Task rollup | PARTIAL | Per-card N+1 fetches (`TechDash.jsx:180-189`) |
| C4 | Completed shows travel/on-site/total breakdown | MISSING | Time+title+check only — violates `.claude/rules/tech-mobile-ux.md` |
| C5 | Attention banners (away / 5PM / stalled) | HAVE | Keep logic, unify skin |
| C6 | "Coming up" scoped to me | PARTIAL | Shows ALL crew (`TechDash.jsx:812-822`) |
| **D — Field actions & capture** ||||
| D1 | Clock state machine + supersede | HAVE | TimeTracker + `clock_appointment_action` (hardened 06/2026) |
| D2 | Snap-first photo (+flag-gated offline queue) | HAVE | nativeCamera→storage→`insert_job_document`→PhotoNoteSheet; idb queue |
| D3 | Task toggle | HAVE | `toggle_appointment_task` |
| D4 | Offline READS | MISSING | Read data never persisted — net-new (persister, arch decision 1) |
| **E — Data layer hygiene** ||||
| E1 | Migrations = source of truth | MISSING ×13 | Finding 4 |
| E2 | One-round-trip dashboard feed | MISSING | 4 + 2-per-card requests today (`TechDash.jsx:835` + per-card) |
| E3 | Feed payload completeness | PARTIAL | Finding 7 |
| E4 | MT-consistent `work_date` | PARTIAL + bug | Finding 3 |
| **F — Design/UX conformance (tech-mobile-ux.md)** ||||
| F1 | Status = color from 3 feet | PARTIAL (inverted) | Division owns the 4px border; status is a 10px pill (`TechSchedule.jsx:343,390-396`) |
| F2 | 48px touch targets | PARTIAL | 40px header buttons, 36px filter chips |
| F3 | One primary action per screen | PARTIAL | 3 equal-weight card buttons (`TechDash.jsx:482-536`) |
| F4 | Info density | PARTIAL | Schedule header stack eats a large viewport share |
| **G — Platform** ||||
| G1 | iOS OTA (no App Store resubmit) | HAVE | capgo `CapacitorUpdater` autoUpdate, channel production |
| G2 | Safe areas / dvh / 16px inputs | HAVE | Rules in place and followed |
| **H — Merge target (Job Hub)** ||||
| H1 | Shared Hero/ActionBar scaffolding | PARTIAL | TechJobDetail+TechClaimDetail share them; TechAppointment hand-rolls its own |
| H2 | Single job surface | MISSING | 1-job-to-MANY-appointments reshape; 18 `/tech/appointment/` call sites across 9 files (incl. admin `ClaimPage.jsx:623`); zero in `functions/` workers |
| H3 | Work-auth banner | HAVE ×2 | Duplicated (`TechAppointment.jsx:788-812`, `TechJobDetail.jsx:377-401`) |

## UX vision (the "Apple Calendar bar", field-persona law intact)

**Principles:** instant by default (cache-first paint, silent revalidate, skeleton only on
true cold start, content never replaced by a spinner); nothing jumps (anchored first paint,
ref-based scrolling, no setTimeout hacks); physics not flicker (transform-free show/hide per
WKWebView rules, snap pagers, haptic ticks); glanceable then actionable (status owns the
color channel, one dominant primary action); 48px targets, gloves, sunlight.

**Schedule v2:** **Agenda** (default — continuous bidirectional list, sticky day headers,
today anchored on first paint) + **Day timeline** (hour grid, positioned event blocks, red
now-line — the signature "Apple Calendar" surface) + **infinite week-strip pager** (any date
reachable, snaps per week, haptic tick). *Month view deferred to an explicit follow-up
stage (challenge adjudication — polish-first; flag-gating makes deferral free).* Day taps
are pure client-side; month-window queries prefetch ±1. Renders newly-exposed color/kind/
multi-day/milestone; events styled distinctly from job appointments; status color primary,
division demoted to a pill. Filters/search/create-picker carried over. Floating "Today" pill.

**Dashboard v2 ("mission control"):** Now/Next hero (via `pickNowNext`; live timer when
clocked in, countdown to next visit otherwise; one dominant action); attention strip
(away / 5PM / stalled — existing logic); today mini-timeline; **My numbers** — hours today
& this week shown as travel + on-site + total (labeled; Monday-start Denver weeks to match
payroll); tasks done/total; photos today; completed rows WITH breakdown; Coming-up scoped
to me. Whole payload = one `get_tech_dashboard` round trip.

**Job Hub (M1/M2):** one surface at `/tech/job/:jobId?appt=<id>` — job identity (shared
Hero/ActionBar), visit picker (upcoming/past), per-visit context (TimeTracker, tasks, crew,
moisture/equipment/scope-sheet with their existing section flags), job-wide photos/docs/
notes/contacts/claim breadcrumb; work-auth logic extracted once. `/tech/appointment/:id`
becomes a resolver redirect. Desktop `JobPage.jsx` tabs (Financial/Checklist/Schedule-
wizard/Activity) are explicitly NOT absorbed — scope fence.

## Architecture decisions (challenge-verified)

1. **TanStack Query trio pinned @5.101.2** (`@tanstack/react-query`,
   `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`) —
   React 19.2.4/Vite 8 compat Challenge-CONFIRMED (peer `^18||^19`, no bundler peer, SPA
   no-SSR). **Persister:** async-storage persister + ~15-line adapter over the existing
   `idb@8`, in its **own IndexedDB database `upr-query-cache`** (NEVER a new store inside
   `upr-offline` — that forces a version bump + cross-tab `blocked()` upgrades), mounted
   via `PersistQueryClientProvider` (async restore gating). Persister kept in F despite the
   skeptic's deferral argument — it IS owner decision ④ (cold-open in a no-signal basement
   must paint). *Options on record:* a hand-rolled SWR module (~150 lines, zero-dep) loses
   on focus-revalidation/gc/invalidation correctness; caveat under which it wins: owner
   later reverses decision ② — the query surface is ~6 keys, swappable.
2. **No virtualization dependency** — 78 rows per window live; windowed month-range
   rendering suffices.
3. **Two flags, not one** (challenge fix): `page:tech_dash_v2`, `page:tech_sched_v2` —
   independent rollout/testing; component-level swap at the existing paths (two routes
   can't share a path; URLs stay stable for iOS + deep links).
   **Mandatory deployment order (fail-open trap):** `feature_flags` rows are seeded in
   Supabase BEFORE any code referencing the keys merges — no-row = enabled for EVERYONE
   (`AuthContext.jsx:262`); explicit `EXPLICIT_FLAGS` entries WITH `enabled:false` ship in
   the same PR as the swap (nav-derived registration drops `enabled`; the DevTools
   auto-seed creates missing keys ON). Emergency-off = `enabled=false, dev_only_user_id=null`
   — `force_disabled` is inert for `isFeatureEnabled`-gated pages. Auto-seed clobber edge
   (a stale DevTools FlagsTab upsert can strip `dev_only_user_id` — fails CLOSED, owner
   re-toggles) disclosed. Owner employee id verified live:
   `d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da`. Precedent: 8 production flags use this exact
   pattern (page:tech_rooms/equipment/moisture, offline:queue, page:crm, …).
4. **Keep-alive mechanism (challenge-corrected):** Phase F restructures TechLayout into a
   pane host — the two v2 panes render persistently OUTSIDE `<Outlet/>`; each pane owns its
   scroll container; hide via `display:none` (Design-System-sanctioned; transforms banned
   on WKWebView) + continuous scrollTop tracking into a ref (passive listener) + restore in
   `useLayoutEffect` on activation (a naive save-on-hide reads 0 in WebKit; fallback
   variant: `visibility:hidden; position:absolute; inset:0`). Panes get an **`active` prop
   contract** to pause geolocation/pollers (visibilitychange does not cover pane hiding).
   Detail routes keep today's keyed **0.2s opacity fade** — there IS no slide animation
   (the css comment at `index.css:4950-4957` explains transforms re-anchor position:fixed
   children); plan language corrected by the challenge. v2 never copies the
   `querySelector('.tech-content')` scroll hack (`TechSchedule.jsx:606`).
5. **Feed RPC upgrades are additive jsonb keys** (Challenge-CONFIRMED zero-breakage —
   both feeds RETURN jsonb; `get_appointments_range` is also consumed by out-of-wave
   `TechEditAppointment.jsx` — old shape keys preserved, committed caller test).
   `get_my_appointments_today` gains `p_include_cancelled boolean DEFAULT true` (v2 passes
   false). Only `get_tech_dashboard` is genuinely new.
6. **Drift capture first** — `pg_get_functiondef` dump of all 13 live-only RPCs committed
   as a no-behavior-change migration before anything touches the data layer (CRM-v3
   `merge_contacts` precedent).
7. **Nav helpers `apptHref()`/`jobHref()` shipped by F; S/D forbidden from hardcoding
   `/tech/appointment/` or `/tech/jobs/`** — reduces M2 from an 18-call-site retarget to a
   constant flip, and kills the "merge first" ordering argument.
8. **Hours math (challenge-corrected):** SUM the stored `hours` column + `travel_minutes` —
   never recompute closed entries from timestamps (breaks the 3 manual/hours-only rows,
   admin inline edits, and midnight-split rows); add a live-elapsed term for the single
   open entry (stored `hours` is 0 until finish); filter by `work_date`; weeks =
   **Monday-start Denver** (`get_payroll_summary` parity — its OT math is per Monday week);
   return travel/on-site separately so the UI can show the tech-UX-mandated breakdown.
   Note the platform inconsistency on record: payroll `total_hours` EXCLUDES travel; the
   billing `total_cost` generated column INCLUDES it — the dashboard labels both.
   Plus the Finding-3 `work_date` Denver-stamp fix (body-only REPLACE, same signature).
9. **Mutation layer untouched** — TimeTracker, clockPrecheck, ClockSupersedeSheet, sheets,
   photo stack consumed as-is; v2 replaces `onReload` refetch storms with query
   invalidation from F's frozen registry. **Realtime + recurrence out of scope** (on record).

## Phases

### Phase F — Foundation

> **Branch:** session-assigned (illustrative: `tech-v2/phase-f-foundation`), cut from `origin/dev`.
> **Prerequisite:** this roadmap's PR merged into `dev`. **Model: Opus · high** (live-RPC
> REPLACEs on the shared production Supabase; foundation is the wave's single point of failure).
> **Read scope:** `CLAUDE.md` + this block + the Architecture decisions section above.
> **Close-out checklist:**
> - [x] Flags seeded FIRST (live Supabase, before any code merges): `page:tech_dash_v2` + `page:tech_sched_v2` rows, `enabled=false`, `dev_only_user_id=d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da` — verified live via `upsert_feature_flag`
> - [x] Drift-capture migration: all 13 live-only RPC defs dumped verbatim (no behavior change) — `20260703_tech_v2_phaseF_drift_capture.sql`
> - [x] Test-first, now green: backward-compat tests ×2 feeds (legacy caller shape preserved); `get_tech_dashboard` hours math (MT day boundary, Monday-Denver week, open-entry live term, split/manual rows); `work_date` Denver-stamp fix; techQuery invalidation-map unit tests — committed under `supabase/tests/tech_v2_*.test.js` (integration, self-skip without creds — behavior verified live via MCP) + `src/lib/techQuery.test.js` (9 unit tests green)
> - [x] Migrations applied + verified on dev: feed upgrades (additive keys + `p_include_cancelled`), `clock_appointment_action` work_date fix (body-only), NEW `get_tech_dashboard` (SECURITY DEFINER + GRANT) — all applied to the shared Supabase and verified with controlled fixtures (hours delta 3.5h onsite + 0.5h travel; Denver work_date stamp; additive+legacy keys; cancelled filter)
> - [x] v1 relief patch shipped: schedule `dateRange` anchored to today (refetch only when selection exits window); dash no longer re-skeletons when data exists — minimal diffs, Rule 8 (build-verified; **on-device visual is owner-gated** — see visual item)
> - [x] TanStack trio @5.101.2 + idb persister (`upr-query-cache`) + `PersistQueryClientProvider` in main.jsx; `src/lib/techQuery.js` complete frozen key + invalidation registry (dash / sched-month / active-clock / tasks / rooms / docs)
> - [x] TechLayout pane host (flag-gated; `active` prop contract; legacy behavior byte-identical flags-off)
> - [x] App.jsx component-swaps → V2 stub pages; `EXPLICIT_FLAGS` entries w/ `enabled:false`; `apptHref()`/`jobHref()` helpers
> - [x] Shared v2 primitives (`src/components/tech/v2/`): StatusChip, ApptListRow, TechV2Page scaffold, skeletons; empty `TECH-V2: SCHED` / `TECH-V2: DASH` / `TECH-V2: HUB` css marker sections pre-committed; v2 styles = new `tv2-*` classes only
> - [x] `--tech-*` token layer documented in UPR-Design-System.md; `.claude/rules/tech-v2-wave-ownership.md` committed
> - [x] `npm run test` (385 pass / 19 integration self-skip) + `npm run build` (green) + `npx eslint` (changed files — zero NEW errors; refactored the schedule re-anchor out of an effect to avoid one) pass
> - [~] `migration-safety-checker` (all 4 migrations PASS — verified diffs, backward-compat, grants) + `upr-pattern-checker` (findings addressed: hardcoded hex → tokens, real `--tech-accent`, doc headers on main.jsx/TechLayout.jsx) clean. **`tech-phase-reviewer` did not complete** — its run terminated early on an account session/API limit (infrastructure, not a code finding) after confirming the checkbox ground truth is honest. Equivalent verification was performed directly (build + 385 tests + eslint zero-new-errors + live RPC behavior via MCP). Re-run the reviewer post-limit-reset if a formal Opus sign-off is required before merge.
> - [ ] Visual: stub pages render behind the flags on the branch preview; legacy pages identical with flags off — **OWNER-GATED:** the flags are dev-only to the owner, so the v2 stubs are only visible on the owner's own login. Build + pane-host logic verified; the owner confirms the on-device stub render + legacy-unchanged pass after merge/deploy.
> - [x] `UPR-Web-Context.md` updated; checkboxes in THIS block reconciled honestly; pushed, PR to `dev` opened draft → marked ready

Scope: everything above; **zero feature UI beyond stubs** — the wave builds the pages.

### Wave 1 — Sessions S and D (parallel-capable; serial fine — owner's choice; suggested merge order: S first)

### Session S — Schedule v2

> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** Phase F merged.
> **Model: Opus · high** (the physics-heavy build: gesture/scroll/anchoring polish is the initiative's core).
> **Read scope:** `CLAUDE.md` + this block + `.claude/rules/tech-v2-wave-ownership.md` + `.claude/rules/tech-mobile-ux.md`.
> **Close-out checklist:**
> - [ ] Test-first, now green: month-window key math (TZ-safe date bucketing); day-grouping/sorting selector; filter-predicate parity with legacy (me/all/multi-crew + division)
> - [ ] Acceptance: Agenda (bidirectional, sticky day headers, today anchored on first paint — no setTimeout scrolls) + Day timeline (hour grid, positioned blocks, red now-line) + infinite week-strip pager (any date reachable, snaps, haptic tick); day taps never fetch; ±1 month prefetch; color/kind/multi-day/milestone rendered; status color primary; filters/search/create-picker carried; floating Today pill; PTR + focus revalidate; skeleton only on cold start
> - [ ] Month view NOT built — deferred stage (explicit, not silent)
> - [ ] Zero schema; zero shared-file edits; css only inside `TECH-V2: SCHED`; TEST fixture IDs only (never assert live row counts — D's clock writes appear in this window on the shared Supabase)
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; `upr-pattern-checker` clean; `tech-phase-reviewer` sign-off
> - [ ] Visual: branch preview + owner's phone via prod flag (the real bar)
> - [ ] `UPR-Web-Context.md` updated; this block's checkboxes reconciled; pushed, PR to `dev` draft → ready

Scope: owns `src/pages/tech/v2/TechScheduleV2.jsx` + `src/pages/tech/v2/schedule/**` only.

### Session D — Dashboard v2

> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** Phase F merged.
> **Model: Opus · medium** (composition of existing widgets + F-tested RPC; hours MATH already tested in F).
> **Read scope:** `CLAUDE.md` + this block + ownership manifest + `.claude/rules/tech-mobile-ux.md`.
> **Close-out checklist:**
> - [ ] Test-first, now green: `pickNowNext` edge cases (all completed / none today / paused); hours display formatting (travel + on-site + total, labeled); cancelled-filter regression (Finding 6)
> - [ ] Acceptance: Now/Next hero (live timer clocked-in, countdown otherwise, ONE dominant action); attention strip (away / 5PM / stalled — existing logic, unified skin); today mini-timeline; My-numbers (hours today/week Monday-Denver, tasks done/total, photos today); completed rows WITH travel/on-site/total breakdown; Coming-up scoped to me; single `get_tech_dashboard` query + invalidation wiring; PTR never re-skeletons
> - [ ] Zero schema; zero shared-file edits; css only inside `TECH-V2: DASH`; TEST fixture IDs only
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; `upr-pattern-checker` clean; `tech-phase-reviewer` sign-off
> - [ ] Visual: branch preview + owner's phone via prod flag
> - [ ] `UPR-Web-Context.md` updated; checkboxes reconciled; pushed, PR to `dev` draft → ready

Scope: owns `src/pages/tech/v2/TechDashV2.jsx` + `src/pages/tech/v2/dash/**` only.

### Phase C — Cutover & cleanup

> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** S + D shipped AND
> owner bake complete (flag flips are the owner's: owner-only → all techs → bake).
> **Model: Sonnet · medium** (mechanical deletion + verification). Anytime lane — no wave slot.
> **Close-out checklist:**
> - [ ] Legacy `TechDash.jsx` + `TechSchedule.jsx` deleted; App.jsx swap shims removed; dead css removed (`.tech-schedule-row[data-division]`, stale `.tech-appt-time`/`.tech-appt-title`, non-sticky header classes)
> - [ ] Stretch stage (explicit, may close as "deferred again" with reason): Month view for Schedule v2
> - [ ] `npm run test` + `npm run build` + eslint pass; `upr-pattern-checker` clean; `tech-phase-reviewer` sign-off
> - [ ] Visual: full tech app walk-through on owner's phone post-deletion
> - [ ] `UPR-Web-Context.md` updated; checkboxes reconciled; pushed, PR draft → ready (deletions = own reviewed PR per the destructive-change rule)

### Phase M1 — Job Hub build

> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** S + D shipped
> (serial, NOT a wave session — may ship its own ADDITIVE migrations, e.g. an optional
> `get_job_hub` aggregate). **Model: Opus · high** (highest-blast-radius surface: clock
> actions, e-sign adjacency, offline paths).
> **Read scope:** `CLAUDE.md` + this block + ownership manifest + tech-mobile-ux.md.
> **Close-out checklist:**
> - [ ] Flag `page:tech_job_hub` seeded FIRST (same recipe: row before code, `enabled=false` + dev-only)
> - [ ] Test-first, now green: visit-picker selection (`?appt=` present/absent/stale); work-auth banner predicate parity with both legacy implementations; `appointment_id OR job_id` doc-query fallback parity
> - [ ] Acceptance: `/tech/job/:jobId?appt=<id>` renders job identity on shared Hero/ActionBar; visit picker (upcoming/past); per-visit context (TimeTracker, tasks, crew, moisture/equipment/scope-sheet behind their existing section flags); job-wide photos/docs/notes/contacts/claim breadcrumb; work-auth logic extracted ONCE; single statusBar effect; role-gated merge/typed-DELETE preserved
> - [ ] Offline decision fork honored (default: per-visit captures keep the offline queue; job-level captures stay direct — revisit only on owner ask)
> - [ ] Migrations (if any) additive-only + RLS; `migration-safety-checker` clean
> - [ ] `npm run test` + `npm run build` + eslint pass; `upr-pattern-checker` clean; `tech-phase-reviewer` sign-off
> - [ ] Visual: hub behind flag on owner's phone — from schedule row, dash card, and claims page entries
> - [ ] `UPR-Web-Context.md` updated; checkboxes reconciled; pushed, PR draft → ready

Scope: owns `src/pages/tech/v2/TechJobHub.jsx` + `src/pages/tech/v2/hub/**` + css §HUB.

### Phase M2 — Merge cutover

> **Branch:** session-assigned, cut from `origin/dev`. **Prerequisite:** M1 baked on the
> owner's phone. **Model: Opus · medium** (mechanical retarget, but deep-link correctness matters).
> **Close-out checklist:**
> - [ ] `apptHref()`/`jobHref()` constants flipped to the hub; `/tech/appointment/:id` → thin resolver redirect (fetch appt → `/tech/job/:jobId?appt=`)
> - [ ] Remaining hardcoded sites retargeted (incl. admin `ClaimPage.jsx:623`); re-verify zero worker deep links (challenge-verified zero at plan time)
> - [ ] Legacy `TechAppointment.jsx` + `TechJobDetail.jsx` deleted after bake; routes cleaned
> - [ ] `npm run test` + `npm run build` + eslint pass; `upr-pattern-checker` clean; `tech-phase-reviewer` sign-off
> - [ ] Visual: every tap-through path on owner's phone (dash card → hub, schedule row → hub, claims → hub, 5PM banner → hub)
> - [ ] `UPR-Web-Context.md` updated; **two-direction checkbox reconciliation across the WHOLE roadmap** (this is the last phase); pushed, PR draft → ready

## Dependency graph

```
roadmap PR merged → F ──> S ─┐
                    └──> D ─┼─(owner bake)──> C (anytime lane; +Month stretch)
                            └─(S+D shipped)─> M1 ──(bake)──> M2
Edges: F→S, F→D hard artifact edges · S∥D independent (adversarially proven, fixes
absorbed into F) · C owner-gated soft edge · M1→M2 hard · external gates: NONE
```

**Dispatch model:** Wave 0 = F alone. Wave 1 = S ∥ D — *parallel-capable, serial fine*
(challenge downgrade: a 2-session wave doesn't mandate the machinery; the manifest is kept
because it's cheap). Merge order is preference (suggest S first — bigger UX payoff), never
a gate. Throttle freely. C/M1/M2 are sequential lanes as drawn.

## File-ownership matrix (committed by Phase F as `.claude/rules/tech-v2-wave-ownership.md`)

| Session | Owns exclusively | Schema/RPC |
|---|---|---|
| F | migrations; `src/lib/techQuery.js`; `src/components/tech/v2/**`; App.jsx swaps; TechLayout pane host; main.jsx provider; featureFlags.js entries; css markers; v1 relief patch; manifest | ALL |
| S | `src/pages/tech/v2/TechScheduleV2.jsx`, `src/pages/tech/v2/schedule/**`, css §SCHED | none |
| D | `src/pages/tech/v2/TechDashV2.jsx`, `src/pages/tech/v2/dash/**`, css §DASH | none |
| C | legacy deletions + shim removal (+ Month stretch files) | none |
| M1 | `src/pages/tech/v2/TechJobHub.jsx`, `src/pages/tech/v2/hub/**`, css §HUB | own additive |
| M2 | href-constant flip, resolver route, legacy detail deletions | none |

**Frozen in-wave (S/D edit NOBODY):** App.jsx, main.jsx, TechLayout.jsx, AuthContext.jsx,
`src/components/tech/**` (incl. v2 primitives, TimeTracker, PhotoNoteSheet,
ClockSupersedeSheet, StalledWidget, NowNextTile), Icons.jsx, PullToRefresh.jsx,
techConstants.js, scheduleUtils.js, clockPrecheck.js, `src/lib/native*.js`, toast.js,
useOfflineQueue.js, offlineDb.js, syncRunner.js, syncRunnerSingleton.js, featureFlags.js,
techQuery.js, package.json + lockfile, all migrations, index.css outside the session's own
marker (existing `.tech-*` selectors may not be restyled — v2 styles are new `tv2-*`
classes). Needed primitive change → disclosed copy-in to own folder, or an F-owner
follow-up PR — never an in-wave edit.

## Out of scope (on record)

Recurrence schema · realtime channels (focus-revalidate suffices) · offline clock actions
(owner decision ④) · route/drive-time planning (no planned-travel data exists) · inbound
Google-Calendar sync (mirror is outbound-only) · desktop JobPage absorption (scope fence) ·
changes to TechNewAppointment/TechEditAppointment/TechNewEvent/TechClaims flows (reused
as-is) · double-booking/conflict model (future) · Month view (deferred to Phase C stretch —
an explicit stage, not silent scope-shaving).

## What resisted maximum parallelism (honest ledger)

① S∥D is the only wave pair — and parallelism there is OPTIONAL (serial sanctioned); the
manifest is kept because it's cheap, not because the wave demands it. ② M1/M2 serialized
behind the wave — the highest-blast-radius surface ships on hardened primitives
(merge-first REJECTED in the challenge, reasoning on record below). ③ C is gated on human
bake time, not code. ④ F grew absorbing the challenge fixes (dep install, provider mount,
pane host, css markers, complete query registry, two flags, v1 relief) — it is the single
point of failure, priced in via the full reviewer gauntlet before the wave dispatches.
⑤ The shared-primitive freeze may pinch S/D — fallback: disclosed copy-in. ⑥ One shared
production Supabase → fixture-ID discipline instead of serialization (D's clock-test writes
appear in S's all-crew month window). ⑦ Rules bent: NONE (S/D ship zero schema and zero
RPCs — the CRM-v3 body-only exception isn't even needed).

## Challenge report (6 read-only agents, 2026-07-03 — what changed)

1. **TanStack (CONFIRMED):** exact pins 5.101.2; own idb DB name (`upr-query-cache`);
   async-storage-persister pattern; optional jsdom/@testing-library devDep line item if
   hook-level tests are wanted (repo has neither today).
2. **Flag mechanics (MODIFIED):** the fail-open no-row trap made seed-rows-FIRST a hard
   Phase-F step; `enabled:false` registry entries are load-bearing; `force_disabled` is
   inert for `isFeatureEnabled`; the auto-seed clobber edge is disclosed (fails closed);
   the exact pattern is verified in production on 8 existing flags.
3. **Keep-alive (MODIFIED):** "preserve the slide" was factually wrong — the transition is
   a 0.2s opacity fade, deliberately transform-free (`index.css:4950-4957`); the concrete
   scroll-preservation mechanism + `active`-prop contract are now specified; two
   v2-must-not-copy hacks identified (`querySelector('.tech-content')`; mount-only loads).
4. **Hours/cancelled (MODIFIED):** stored-`hours`-column formula replaced the planned
   timestamp recompute; Monday-Denver weeks for payroll parity; **NEW Finding 3** (UTC
   `work_date` stamp — 1/158 live rows misdated; fix slotted into F); the cancelled-as-
   Upcoming bug downgraded to latent (zero exposure ever — cancel is a hard delete).
5. **Disjointness (DISJOINT_WITH_FIXES → all fixes absorbed into F):** package.json/
   lockfile, provider mount (main.jsx), TechLayout pane host, pre-committed css markers,
   complete frozen query registry, TWO flags instead of one, frozen-list additions
   (syncRunner ×2, AuthContext, Icons, main.jsx), `.tech-*` restyle ban, per-session TEST
   fixture IDs.
6. **Counter-ordering (skeleton SURVIVES; 4 corrections adopted, 1 rejected):** Month view
   pulled out of S (adopted — explicit deferred stage); nav-helper rule (adopted — M2
   becomes a constant flip); wave downgraded to parallel-optional (adopted); v1 relief
   patch added to F (adopted — legacy files are frozen in-wave, so F is the only window).
   idb-persister deferral REJECTED on owner-decision-④ grounds (cold-open offline is
   bought scope; marginal cost ~15 lines). **"Patch, don't rebuild"** rejected as the plan
   but its insight adopted (the v1 relief patch): the owner's target surfaces (hour-grid
   timeline, info-dense hero dashboard) do not exist in the current files to patch.
   **"Merge first"** rejected outright: the Job Hub is the highest-blast-radius surface
   (clock writes, e-sign) and would ship with the least v2 hardening, while the daily-pain
   pages waited behind it; the nav-helper rule caps the double-build cost it worried about.
