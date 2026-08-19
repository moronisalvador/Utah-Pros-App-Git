# UPR Hydro — cold-session dispatch

**Created:** 2026-08-17 · Companion to [`hydro-roadmap.md`](hydro-roadmap.md).

Each block below is self-contained. A session picking one up needs the block, the files it names,
and project law — **not** this conversation, a particular model, or any orchestration tool.

**Standing authority for every block:** authoring repository source is in scope. Applying a
migration, flipping a feature flag, deploying, calling a provider, promoting to `main` and running
the `dev → main` PR are **each separate owner actions**, every time. A prerequisite being satisfied
is never authorization.

---

## Required reading for any block

`AGENTS.md` · `CLAUDE.md` · `.claude/rules/database-standard.md` (§0, §1, §3, §5, §5b, §6, §7) ·
`.claude/rules/hydro-wave-ownership.md` · `docs/hydro-roadmap.md` ·
`.claude/rules/close-out-standard.md`. UI blocks add `.claude/rules/tech-mobile-ux.md`,
`UPR-Design-System.md`, `.claude/rules/loading-error-states.md`, `.claude/rules/page-lifecycle.md`.

**Read `docs/hydro-roadmap.md` §1 first.** It carries a standing instruction about two feature
flags that must not be widened, and it is the cheapest mistake to make.

---

## Block A — behavioural proof for F1/F2 · **the next real work**

**Objective.** Produce the `database-standard.md` §5b role-perspective behavioural proof that both
authored migrations require before they may be applied.

**State.** `20260817010000_hydro_drying_spine.sql` and
`20260817020000_hydro_legacy_access_hardening.sql` are authored, committed and unapplied. Static
gates already pass: hygiene 0 failures, `tests/qa/unit/hydro-drying-spine.test.js` 28/28.

**Scope — owns.**
`scripts/qa/qualify-hydro-boundary-local.mjs`, `supabase/tests/hydro_drying_spine.test.sql`, a
`test:db:hydro-boundary:local` script in `package.json`, and the `db-lane-coverage.test.js` entry.

**Template.** `scripts/qa/qualify-estimate-create-boundary-local.mjs`. Follow its cycle exactly:
baseline → real predecessors in ledger order → migration → proof → rollback → fail-closed check →
re-apply → proof again → teardown, emitting a commit-bound receipt with a SHA-256 per input.

**Must prove, both passes.**

- **ALLOW:** admin, office, project_manager and field_tech each create a chamber, create a point,
  and insert one reading of **each of the four kinds**; and `get_hydro_log` returns them.
- **DENY, all `42501`:** `crm_partner`, inactive employee, external employee, unmapped auth user,
  and a **claimless session** (the `IS DISTINCT FROM` NULL case). Each denial must leave **zero
  rows** — proving the gate precedes the INSERT, not just the response.
- **No browser write path:** a field technician's direct PostgREST `INSERT`, `UPDATE` and `DELETE`
  against each of the four `hydro_*` tables affects **zero rows**, while their `SELECT` still works.
- **The per-kind CHECK is real:** a `material` reading with no `point_id`, a `control_air` reading
  with no `control_source`, and a `dehumidifier` reading with no `equipment_id` are each rejected.
- **Idempotency:** replaying the same `client_id` updates rather than duplicating, for all three
  upsert RPCs.
- **F2 specifically:** before it, a `field_tech` can `DELETE` from `moisture_readings`; after it,
  that same delete affects **zero rows** and `crm_partner`'s `SELECT` is refused — while
  `insert_reading` still succeeds for a legitimate technician **and still carries the dry standard
  forward and backfills**. The rollback proof must show the delete working again; a rollback that
  silently fails to re-open is as wrong as one that fails to close.

**Known harness traps — all three have bitten this repository before.**

1. **Isolation guard must key on the `upr.isolated_test_database` GUC, never `current_database()`.**
   Every Supabase database is named `postgres`, production included.
2. **Never a bare `UPDATE` to seed a feature flag** — the baseline is schema-only, so it matches
   nothing on a clean clone. Use `INSERT ... ON CONFLICT`.
3. **Set both claim forms and assert `auth.role() = 'service_role'` before any seed write.** A
   harness that sets only `request.jwt.claim.role` manufactures a signal production never sends —
   that is what made the 2026-08-05 proof hollow.

**Also check** `employees` column names against live before writing fixtures: it is `full_name`
(NOT NULL) and `display_name`, **not** `name`. A previous proof shipped with a column that does not
exist.

**Reviewers.** `migration-safety-checker`, `anon-grant-auditor`.

**Stop conditions.** Any DENY case that leaves a row. Any ALLOW case that fails. Any need to widen
`hydro_access()` to make a case pass — that is a design question for the owner, not a fix.

---

## Block B — Phase C, capture

**Objective.** The field capture experience: the competitive core.

**Depends on** F1 applied (Block A green, then a separate owner apply).

**Scope — owns.** New `src/pages/tech/` and `src/components/tech/` hydro surfaces, a **route-lazy
stylesheet** (`src/index.css` is near its blocking ceiling — contractor-compliance precedent), the
`readingDispatcher` extension, and the `get_job_readings` re-point or replacement.

**Design brief.** Route through `upr-interface-craft` + `impeccable`. The persona is
`.claude/rules/tech-mobile-ux.md`: a 64-year-old technician in a flooded basement, gloves, one
hand, direct sunlight. Targets ≥48px. No modals for field actions.

**The shape to beat.** Today is a 4-step wizard per reading (Room → Material → MC/RH/Temp →
Details). Day 2+ should be *walk the route and confirm N numbers*, not *create N readings* — the
`hydro_monitoring_points` table exists to make that possible.

**Must do.**

- Show the answer **at the point of capture** — "68 GPP, 12 grains drier than outside, on track"
  as the tech types — judged against the chamber's target envelope, not in a later report.
- Compute psychrometrics with **`calcGPP` extended for elevation**, and pass
  `p_atmospheric_pressure_inhg` on every `hydro_insert_reading` call. See roadmap §3; the column is
  `NOT NULL` precisely so this cannot be forgotten.
- **Extend the offline dispatcher's temp-UUID resolution to equipment placements.** A dehumidifier
  reading references a placement that may itself still be queued; today only rooms resolve.

**Reviewers.** `upr-pattern-checker`, `design-consistency-checker`,
`interface-accessibility-reviewer`, `page-behavior-checker`; `review-animations` **only if** motion
is touched.

**Stop conditions.** Any dependency on OCR (Block E is a spike and may fail). Any global
`src/index.css` addition. Any capture flow that blocks on network.

---

## Block C — Phase E, equipment

Dehumidifier output readings (`kind = 'dehumidifier'`, already modelled) and an S500 sizing
calculator. `rooms.area_sqft` × `ceiling_height_ft` gives chamber volume; class and category come
from the chamber. Feeds equipment-days, which the water-loss report already reports.

---

## Block D — Phase L and R

**L — daily log.** Fold in `docs/job-hub-h2e-daily-logs-plan-2026-08-16.md` H2-e2, already
owner-decided as **authored by a technician**. It is the narrative layer over the chamber; do not
re-litigate authored-vs-assembled.

**R — reports.** Extend `functions/api/generate-water-loss-report.js` (1,254 lines — read it before
proposing a rewrite) into Encircle's two tiers, Full and Summary, plus per-point psychrometric
trend charts. Extend, do not replace.

---

## Block E — OCR spike (independent, gated, never load-bearing)

**Objective.** Decide whether photographing the meter can replace typing, with a hard bias toward
on-device iOS Vision over any cloud OCR: free, works offline in a basement, and no customer data
leaves the phone.

**Deliverable is a decision, not a feature** — a measured accuracy figure on real 7-segment meter
photos and a recommendation. 7-segment LCDs are genuinely hard for general OCR. **If it does not
prove out, that is a successful outcome**; Block B must already be fast without it.

Cloud OCR would be a new provider: separate owner authorization, and Encircle-class "no sandbox"
rules apply.

---

## What no block may do without fresh owner authorization

Apply a migration to any hosted database · flip a feature flag · deploy · promote to `main` · call
an external provider · write to Encircle (impossible anyway — the Hydro API is GET-only) · widen
`page:tech_moisture` or `page:tech_equipment` (roadmap §1).
