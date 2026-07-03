# Tech Mobile v2 — File & RPC Ownership Manifest

**Committed by Phase F (Foundation). Binding for every tech-v2 wave/lane session.**
Linked from `CLAUDE.md` and `docs/tech-v2-roadmap.md` (the dispatch model of record).
Each session's read scope = `CLAUDE.md` + its phase block in `docs/tech-v2-roadmap.md`
+ `.claude/rules/tech-mobile-ux.md` + **this file**. Where the roadmap prose and this
manifest disagree on a name or path, **this manifest is authoritative** (it reflects what
Foundation actually shipped).

Isolation in the wave is **not** the branch — it is (a) the two `page:tech_dash_v2` /
`page:tech_sched_v2` feature flags keeping every v2 screen owner-only until the owner opens
them, and (b) this ownership split. Stay inside your files and no two sessions collide.

---

## 1. Frozen in-wave — NOBODY edits these (Foundation owns them; they are the seams)

- `src/App.jsx` — v2 route swaps (`TechDashSwap`/`TechScheduleSwap`) already wired.
- `src/main.jsx` — `PersistQueryClientProvider` already mounted.
- `src/components/TechLayout.jsx` — the pane host (persistent flag-gated panes + `active`
  prop contract) is wired. Do not edit.
- `src/contexts/AuthContext.jsx`.
- `src/lib/techQuery.js` — the FROZEN query-key + invalidation registry. Import
  `techKeys` / `invalidateTech` / `techQueryClient`; **never add a key** (add-a-key is an
  F-owner change).
- `src/lib/techQueryPersister.js`.
- `src/components/tech/v2/**` — the shared primitives (`StatusChip`, `ApptListRow`,
  `TechV2Page`, `TechPane`, `skeletons`, `nav` with `apptHref`/`jobHref`). Import only.
  Need a change to a primitive → disclosed copy-in to your own folder, or an F-owner
  follow-up PR — never an in-wave edit.
- The rest of the tech shared surface (unchanged from legacy, consumed as-is):
  `src/components/tech/**` (incl. TimeTracker, PhotoNoteSheet, ClockSupersedeSheet,
  StalledWidget, NowNextTile, OfflineStatusPill), `src/components/Icons.jsx`,
  `src/components/tech/PullToRefresh.jsx`, `src/pages/tech/techConstants.js`,
  `src/lib/scheduleUtils.js`, `src/lib/clockPrecheck.js`, `src/lib/native*.js`,
  `src/lib/toast.js`, `src/lib/useOfflineQueue.js`, `src/lib/offlineDb.js`,
  `src/lib/syncRunner.js`, `src/lib/syncRunnerSingleton.js`, `src/lib/featureFlags.js`.
- `package.json` + lockfile, **all `supabase/migrations/`** (S/D ship ZERO schema/RPCs),
  and `src/index.css` OUTSIDE your own reserved marker (existing `.tech-*` selectors may
  NOT be restyled — v2 styles are new `tv2-*` classes only).
- The legacy pages `src/pages/tech/TechDash.jsx` + `src/pages/tech/TechSchedule.jsx` are
  frozen in-wave (Phase F already shipped the only sanctioned relief patch). Phase C
  deletes them.

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema/RPC |
|---|---|---|---|
| F | Foundation | migrations; `src/lib/techQuery.js` + `techQueryPersister.js`; `src/components/tech/v2/**`; App.jsx swaps; TechLayout pane host; main.jsx provider; featureFlags.js entries; css marker sections; v1 relief patch; this manifest | **ALL** (feed upgrades, `clock_appointment_action` fix, `get_tech_dashboard`, drift capture) |
| S | Schedule v2 | `src/pages/tech/v2/TechScheduleV2.jsx`, `src/pages/tech/v2/schedule/**`, css §`TECH-V2: SCHED` | none |
| D | Dashboard v2 | `src/pages/tech/v2/TechDashV2.jsx`, `src/pages/tech/v2/dash/**`, css §`TECH-V2: DASH` | none |
| C | Cutover & cleanup | legacy `TechDash.jsx` + `TechSchedule.jsx` deletions + App.jsx swap-shim removal + dead-css removal (+ optional Month-view stretch files) | none |
| M1 | Job Hub build | `src/pages/tech/v2/TechJobHub.jsx`, `src/pages/tech/v2/hub/**`, css §`TECH-V2: HUB` | own **additive** only (e.g. optional `get_job_hub`) |
| M2 | Merge cutover | `src/components/tech/v2/nav.js` (flip `HUB_ENABLED` + the two builders), the `/tech/appointment/:id` resolver route, legacy detail deletions | none |

`page:tech_dash_v2` / `page:tech_sched_v2` are seeded **enabled:false + dev_only_user_id**
(owner `d1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da`). Flag flips (owner-only → all techs) are the
owner's, in DevTools → Flags.

---

## 3. Frozen data-layer contracts (Foundation shipped these — consume, don't change)

**Query keys** (`src/lib/techQuery.js`) — the six kinds, frozen. Build keys via `techKeys`:
`dash(employeeId)`, `schedMonth('YYYY-MM')`, `activeClock(employeeId)`, `tasks(employeeId)`,
`rooms(jobId)`, `docs(scopeId)`. Refresh caches after a mutation via
`invalidateTech(queryClient, mutation)` where `mutation ∈ { clock, task, photo, doc, room,
appointment }`. **Do not hand-list keys or add a seventh kind.**

**RPCs** (already live + migration-tracked):
- `get_appointments_range(date, date) → jsonb` — additive v2 keys (`color`, `kind`,
  `duration_days`, `is_milestone`, `task_total`, `task_completed`; crew `employees` gain
  `color` + `avatar_url`). Legacy keys unchanged (backward-compat test committed).
- `get_my_appointments_today(uuid, p_include_cancelled boolean DEFAULT true) → jsonb` —
  same additive keys; v2 passes `false`. The 1-arg legacy call still resolves (default).
- `get_tech_dashboard(uuid) → jsonb` — one round trip: `{ server_now, today, week_start,
  appointments (Denver day, cancelled excluded), upcoming (next 7 days), open_entry,
  hours_today, hours_week (each { travel, on_site, total }), photos_today }`. Hours math is
  test-covered in F (stored-hours + travel sum, live term for the open entry, Monday-Denver
  week). D consumes this — do NOT recompute hours client-side.
- `clock_appointment_action(...)` — unchanged signature; the OMW `work_date` now stamps in
  `America/Denver`. Consume as-is.

**Navigation:** every appointment/job link goes through `apptHref(apptId, jobId)` /
`jobHref(jobId)` from `src/components/tech/v2/nav.js`. **Hardcoding `/tech/appointment/` or
`/tech/jobs/` is forbidden** — M2 flips one constant (`HUB_ENABLED`) to retarget all links.

---

## 4. Migration rule

Foundation owns 100% of the tech-v2 schema/RPC surface. **S and D ship ZERO migrations.**
M1 may ship its OWN **additive** migration (new aggregate RPC + any new table, RLS +
explicit policy at creation per CLAUDE.md Rule 7, `SECURITY DEFINER` + `GRANT EXECUTE TO
anon, authenticated`, drift-dump any live function it touches via `pg_get_functiondef`
first). No `ALTER`/`DROP`/rename of a live table inside any wave phase.

## 5. index.css rule

Write CSS ONLY inside your phase's reserved marker (`/* ─── TECH-V2: SCHED … ─── */`,
`… DASH …`, or `… HUB …`) near the end of the tech block in `src/index.css`. Never edit
Foundation's `TECH-V2: SHARED` block or another phase's section, and never restyle an
existing `.tech-*` selector. v2 styles are new `tv2-*` classes. Mobile-only rules use
`@media (max-width: 768px)`.

## 6. Test discipline (one shared production Supabase)

Integration tests self-skip without creds (like the CRM suites) and use dedicated fixture
IDs — **never assert on live row counts**. D's clock-test writes appear in S's month window
on the shared DB, so both sessions key assertions to their own fixture ids.
