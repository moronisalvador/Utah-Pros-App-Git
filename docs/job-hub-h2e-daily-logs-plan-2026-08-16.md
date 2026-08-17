# H2-e — Daily logs: plan

**Created:** 2026-08-16 · **Status:** PLAN ONLY. No SQL authored, no migration file, nothing applied.
**Routed through:** `/db-migration` · **Predecessor:** [`job-hub-wave2-roadmap.md`](job-hub-wave2-roadmap.md) (ledger #9)
**Authorization state:** authoring, applying, committing and deploying are each separate owner actions.
None is requested by this document.

---

## The headline: most of what you asked for needs no database change

The wave-2 roadmap treats H2-e as one thing — "daily logs, needs schema, the only item touching the
database." Inspecting the real catalog says that is two different things wearing one name, and only
the second needs a migration.

The artifact's Dry Logs card shows **drying day** and **wet/dry counts**. Every input for that
already exists in `moisture_readings`, live since `20260418_phase2_hydro.sql`:

| The card needs | The column that already answers it |
|---|---|
| Drying day N | **`taken_at TIMESTAMPTZ`** — day 1 is the earliest company day for the job |
| Wet vs dry count | `mc_pct` against `dry_standard_pct` / `drying_goal_pct`, both per-reading |
| Which readings count | `is_affected BOOLEAN NOT NULL DEFAULT true` |
| Per-room grouping | `room_id` |

> **CORRECTED 2026-08-16.** This table originally named `reading_date` as the source of the drying
> day. **That would have shipped a timezone bug.** `reading_date` is `DATE NOT NULL DEFAULT
> CURRENT_DATE` — the *database session's* timezone — and `insert_reading` never sets it explicitly
> (it is absent from the INSERT column list), so every row takes that default. `database-standard.md`
> §7 requires all day bucketing in `America/Denver`. `taken_at` is a `timestamptz` the client sets,
> so it is the only correct input. The shipped `dryingSummary` helper buckets on `taken_at` and a
> test pins that a disagreeing `reading_date` is ignored.

`HubTools` already fetches this through `get_job_readings`. So the summary card is a **derivation over
data the Hub has already loaded** — no table, no RLS, no grant, no rollback, no apply window.

That reframes the work into two independent slices. The first is the one you can actually see.

---

## H2-e1 — The Dry Logs summary card · **NO MIGRATION**

Ships the artifact's compact card: `Day 4 · 3 of 7 dry`, sitting in the collapsed Dry Logs row so the
row says something useful before it is opened. This is the piece whose absence made the row default
open in the first place, and whose absence the D1 reversal is still working around.

**Shape.** A pure helper — `dryingSummary(readings, { today })` — beside `hubHelpers.js`, consumed by
`HubSections`. It re-uses the existing `get_job_readings` query key, so it costs zero extra requests,
the same technique H2-c used for the photos-today count.

**The three judgment calls it must get right**, none of which are database questions:

1. **Day bucketing goes through `companyDateOf`, never the device clock.** A tech in the field at
   11pm is on a different calendar day than the company. H2-c already set this precedent.
2. **"Dry" needs a defined rule.** `dry_standard_pct` and `drying_goal_pct` are both nullable, and a
   reading with neither cannot be classified. Proposed: a reading is dry when `mc_pct <=` the goal,
   falling back to the standard; readings with neither are **excluded from the denominator** and the
   card says `3 of 7 dry` over classifiable readings only. Silently treating unclassifiable as wet
   would overstate the remaining work; treating them as dry would understate it. Both are worse than
   leaving them out.
3. **Latest reading per location, not every reading.** A location measured four times is one location,
   not four. Group by `room_id` + `location_description` + `material` and take the most recent.

**Cost:** small — one helper, one card, tests for the three rules above, including the
all-nulls case. **Risk:** low; it is additive and read-only. **Blast radius:** the Dry Logs row only.

---

## H2-e2 — A real daily log · **NEEDS SCHEMA** (the part to think hard about)

A daily log in the IICRC sense is a dated narrative record per job: conditions on arrival, work
performed, equipment verified, who was on site. It is what an adjuster reads and what a
water-loss report is assembled from. **Nothing in this repository stores it** — confirmed by grep
across `src/`, `functions/` and `supabase/migrations/`; the only hits are the roadmap describing its
absence.

**DECIDED 2026-08-16 — the daily log is AUTHORED by a technician.** The owner was asked directly
whether it is authored or assembled by the system, and chose authored. So it is a table with a body
a tech types, and the design sketch below applies. The assembled alternative — a view over readings,
equipment, photos, notes and time entries — was cheaper and was rejected as the weaker document.

### The design sketch, for review not for applying

**Table `job_daily_logs`** (name to confirm; `daily_logs` alone is ambiguous repo-wide):

- `id uuid pk`, `job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE`
- `log_date date NOT NULL` — the company day, not `now()::date`
- `body text`, plus structured fields only where they are genuinely queried
- `created_by uuid REFERENCES employees(id)`, `created_at timestamptz NOT NULL DEFAULT now()`
- `edited_by`, `edited_at` — mirroring `moisture_readings`, which already carries this pair
- `client_id uuid UNIQUE` — **offline idempotency, copied deliberately from `moisture_readings:57`.**
  A field surface writes from a phone with bad signal; without this a retry writes a second log.
- One log per job per day, or many? A `UNIQUE (job_id, log_date)` is tempting and probably wrong —
  two techs on one job on one day is normal. Prefer no uniqueness and group in the UI.

**Authorization**, and this is the part that decides the migration's real risk:

- RLS enabled at creation. `authenticated` proves identity, not authorization — the standard is
  explicit that an always-true policy is not the default floor.
- The honest question is what scopes a job to a tech. `database-standard.md` §5b requires a
  **role-perspective behavioural proof with per-role ALLOW *and* DENY cases, including roles the
  change is not about** — that rule exists because the 2026-08-01 conversation scoping locked every
  field technician out of every conversation for four days, and nobody noticed.
- So: a disposable local stack qualifier (`qualify-*-local.mjs` pattern), proving admin/office/PM,
  field_tech on-crew, field_tech off-crew, estimator, supervisor, `crm_partner`, inactive and
  external identities, plus the claimless-session NULL case.

**Rollback:** `DROP TABLE job_daily_logs` is clean *only while no log exists*. The moment a real one
is written, rollback is data loss and must be stated as containment, not undo — per §6, a migration
whose undo is destructive says so rather than inventing a one-liner.

**Ordering:** schema first, code second. The frontend only reads a new table, so the usual
"consuming code first" applies — but if a Worker ever filters on it, that inverts, exactly as the
`payments_qbo_realm_scoping` note in `initiative-status.md` records.

---

## Recommended sequence

1. ~~**Ship H2-e1.**~~ **DONE 2026-08-16.** `dryingSummary` in `hubHelpers.js`, a `summary` slot on
   `HubSection`, and the readings query lifted to `HubSections` so a *collapsed* row can show it.
   No migration. Twelve helper cases plus six wiring assertions, including that the key stays
   byte-identical to `HubTools`'s so react-query serves one request rather than two.
2. ~~**Answer the authored-vs-assembled question.**~~ **ANSWERED: authored.**
3. **Only then** author H2-e2 with its rollback, its §5b behavioural proof, and its reviewers
   (`migration-safety-checker`, `anon-grant-auditor`). Applying it stays a separate authorization.
   This is the only step left in this document.

## What this plan deliberately does not do

No migration file, no rollback file, no test file, and no catalog mutation. The Activity event feed
remains a separate unbuilt slice with its own data question (`system_events` is the candidate spine)
and is not folded in here.
