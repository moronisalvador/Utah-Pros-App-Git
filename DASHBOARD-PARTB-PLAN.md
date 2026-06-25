# Dashboard Part B — Light up the empty Overview widgets

**Status: PLANNED / not started.** This is a ready-to-execute roadmap, intentionally deferred.
It is the "Part B" from the Overview-dashboard build (Phases 1–3 + Part A shipped; see
`UPR-Web-Context.md` → *Overview Dashboard*). Nothing here is active until you trigger it. Part B is
**unrelated to Phase 4** (palette + "Remodeling" division, see `DASHBOARD-PHASE4-PLAN.md`) — they can ship
in any order.

### How to activate (a future session)
- Start a session and say: **"Execute DASHBOARD-PARTB-PLAN.md"** (or just "do B1" / "do the Hydro session").
  The agent reads this file top-to-bottom, confirms scope, then builds the chosen item.
- Each item (B1 / B3 / B4) is **independent** and ships on its own via a reviewed `dev → main` PR. You do
  not need to do them together.
- (Optional) rename to `DASHBOARD-PARTB-TASK.md` to activate the CLAUDE.md *Task File Protocol*.

---

## Context / why
The Overview dashboard renders 10 widgets. Seven show live data today. **Three render correctly but sit in
their graceful empty state** because the upstream data isn't being produced yet — not a bug, just no source
data. Part B is the upstream work that makes them light up. None of it touches the shipped dashboard shell;
all of it is additive.

| Widget | Hook / RPC | Why it's empty today | Part B item |
|---|---|---|---|
| Jobs completed | `useJobsCompleted` → `get_jobs_completed` | No jobs reach a terminal phase with `actual_completion` set | **B1** |
| Open estimates | `useOpenEstimates` → `get_open_estimates_summary` | `estimates` table not populated by any workflow | **B2** (external) |
| Active drying | `useActiveDrying` → `get_active_drying_jobs` | No `equipment_placements` / `moisture_readings` data | **B3** |

Plus **B4** — cross-widget polish that doesn't belong to any single widget.

## Confirmed sequence (owner, Jun 25 2026)
**B1 + B4 first** (fast, low-risk, immediate payoff) → **B3 Hydro** as its own dedicated session (large).
**B2 Open estimates is owned by a separate effort (another bot)** — this roadmap does not build it; it only
documents the integration contract so the widget lights up automatically when that work lands.

---

## B1 — Jobs completed: verify/wire the completion lifecycle  ·  effort: **S**

The widget + RPC are already shipped (Part A, migration `20260624_dashboard_interactivity.sql`).
`get_jobs_completed(p_start, p_end)` counts:
```sql
jobs WHERE phase IN ('completed','closed') AND actual_completion BETWEEN p_start AND p_end
```
It reads ~0 only because no live jobs have both a terminal `phase` **and** an `actual_completion` timestamp.
This is a **verify-first** task, not a guaranteed build:

1. **Audit the job-phase transition.** Find where a job's `phase` is set to a terminal value (likely
   `src/pages/Production.jsx` and/or a phase-update RPC). Confirm the terminal values actually used match the
   RPC's `('completed','closed')` predicate — if Production uses different phase labels, reconcile (update the
   RPC predicate or the labels).
2. **Confirm `actual_completion` gets stamped.** When a job moves to the terminal phase, is `jobs.actual_completion`
   set? If **not**, wire it — either in the phase-update path (UI/RPC) or via a small DB trigger
   (`BEFORE UPDATE ... WHEN phase becomes terminal → set actual_completion = now()`). This is the only real
   code, and it's small.
3. Once jobs flow to completion with a timestamp, the widget auto-populates (period-aware MTD/QTD/YTD + a
   delta pill vs last calendar month). **No dashboard change needed.**

**Verify:** on `dev`, move a test job to completed → confirm it appears in the period count and the delta pill
behaves. `npm run build` + `npx eslint` clean.

---

## B4 — Cross-widget polish (quick wins)  ·  effort: **S–M**

1. **Period control coverage.** Already period-aware: Revenue, Avg ticket, New claims, Jobs completed.
   Intentionally period-**independent** (live/snapshot, leave as-is): Employee status, Action required,
   Collections (current A/R), Open estimates (current open), Active drying, Pipeline. Action: confirm the
   above is the desired behavior and document it; only wire period into a card if the owner wants it. Likely
   mostly confirm-and-document — keep it small.
2. **"View all →" drill-downs land on matching data.** The footer links route to `/collections`, `/claims`,
   `/production`, `/jobs` but the destination pages don't yet pre-filter to the dashboard's period/segment.
   Pass the active period (and division where relevant) through so the drill-down opens on the matching
   filtered view rather than the unfiltered page.
3. **Pipeline "future lanes."** The Contents / Reconstruction / Remodeling lanes in `ProductionPipeline` are
   static greyed placeholders. **Coupled to the Phase 4 division rollout** — keep deferred there, do not build
   in Part B. (Note the dependency so it isn't double-owned.)

**Verify:** build + lint clean; on `dev`, click each "View all →" and confirm the destination is filtered to
match; switch periods and confirm only the period-relevant cards re-query.

---

## B3 — Active drying / Hydro workflow (its own dedicated session)  ·  effort: **L**

The widget + RPC are shipped; the gap is a **field workflow that produces the data**. Tables already exist
(`supabase/migrations/20260418_phase2_hydro.sql`: `equipment_placements`, `moisture_readings`) — **re-read
their exact columns before building.** `get_active_drying_jobs()` (Part A added `job_id` for deep-links)
reads:
- `equipment_placements WHERE status = 'active'` → start date (`MIN(placed_at)`), days-on-job.
- latest `moisture_readings` per job/material → progress % toward `drying_goal_pct`, stale-reading detection.

**Build (own session — large, mobile-first, mirrors the tech app patterns in `TechDash.jsx` /
`TechAppointment.jsx`):**
1. **Equipment placement UX** — a field-tech screen to place equipment on a job (write `equipment_placements`:
   `job_id`, `status='active'`, `placed_at`) and mark it pulled (`status`/`removed_at`). Snap-first, 48px
   targets, no modals — per the CLAUDE.md tech-UX principles.
2. **Moisture-reading UX** — daily readings per material (`moisture_readings`: `job_id`, `material`, `mc_pct`,
   `drying_goal_pct`, `taken_at`). Keep entry one-tap-fast.
3. **Supervisor/admin monitoring** — the dashboard widget already surfaces it: progress bars, "days on job",
   a **✓ PULL EQUIP** badge at ≥100%, a **⚠ LOG MISSING** badge when the latest reading is >24h stale, and a
   summary line. Once data flows, it lights up with **no dashboard change.**
4. Use `db.rpc()` for all writes (new-ish tables / PostgREST cache); add `SECURITY DEFINER` RPCs + grants if
   not already present.

**Verify:** on `dev`, place equipment + log readings on a test job → confirm the Active drying widget shows
progress, day count, and the PULL/LOG badges. Build + lint clean. Recommend **its own session + owner review**
given the size (comparable to Phase 4).

---

## B2 — Open estimates (owned by a separate effort — coordinate, do NOT build here)

The **dashboard side is already complete**: `useOpenEstimates` → `get_open_estimates_summary()` (migration
`20260624_overview_dashboard_rpcs.sql`) + the `OpenEstimates` widget. It simply needs `estimates` rows.

**Integration contract for the estimates effort** — the RPC sums `estimates.amount` joined to `jobs.division`
for rows whose `status` is **NOT** in:
```
('approved','denied','rejected','cancelled','void','converted','paid')
```
So to light up the widget, the estimates workflow must write `estimates` rows with `job_id`, `amount`, and a
`status` in that "open" set. **No dashboard change is required** when that lands. The only coordination point
is the **status vocabulary** — keep the estimate statuses aligned with the exclusion list above (or update the
RPC predicate if the other effort uses different terms).

---

## Verification summary
- Each item: `npm run build` + `npx eslint` clean; validate on `dev` (dev.utahpros.app) with a test job;
  then a reviewed `dev → main` PR (never push `main` directly).
- All Part B work is **additive** — it adds upstream data/wiring; it does not modify the shipped dashboard
  widgets, hooks, or `usePolledRpc`.

## Rollback / risk
- **B1:** if the `actual_completion` wiring misbehaves, revert that commit; the widget returns to reading ~0
  (its current safe state). A DB trigger, if used, is dropped independently.
- **B4:** pure front-end (links/period plumbing) — revert the commit.
- **B3:** the Hydro tables already exist and are unused elsewhere; revert the workflow UI commit to stop
  collecting data. The widget falls back to its empty state.
- **B2:** not owned here — nothing to roll back on the dashboard side.
