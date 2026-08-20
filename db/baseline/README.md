# DB baseline — live snapshots for the local stack

This directory (deliberately **not** `docs/generated/`) holds the committed
**baseline snapshots** of the live Supabase project that `npm run db:local` builds
from, and the reference `scripts/db-drift-check.mjs` compares against.

## Files
- **`schema.sql`** — full `pg_dump --schema-only` capture of the live **public** schema.
  Machine-generated; do not hand-edit. Refresh: `npm run db:baseline:refresh` (needs an
  interactive terminal — the CLI may prompt for the database password, which an agent
  must never type).
- **`non-public.sql`** — the live **non-public catalog**: the 4 storage buckets, the 6
  `storage.objects` policies, and the 15 cron jobs (loaded locally **deactivated** — the
  captured commands POST at production workers, and a local stack must never fire them).
  Captured read-only via `scripts/db-nonpublic-capture.sql`; rewrite this file from a fresh
  capture, never from memory. Guarded: it refuses to run unless the loader injects
  `upr.local_stack = on`, and it refuses to leave any cron job active.
- **`captured.json`** — when each of the two files above was captured. Read by
  `npm run db:baseline:age` (warning-only in CI) and printed at every bootstrap, so a stale
  baseline gets noticed instead of silently weakening every local proof.
- **`live-schema-snapshot.json`** — the committed inventory of live `public` tables
  and functions (object names + counts), captured via `scripts/db-drift-check.sql`.
  Machine-generated; do not hand-edit.

## Fake data
The baseline files are **structure and config only — zero customer rows, enforced**
(`db-baseline-refresh.mjs` refuses a dump containing `COPY`/`INSERT` blocks; this repo is
public). Rows come from `npm run db:local:seed`: a deterministic, obviously-fake synthetic
business (see the header of `scripts/db-local-seed.mjs`), scalable with `--scale=N`.
`npm run test:db:data-visibility:local` proves the seed catches data-shaped migration
failures the empty baseline was blind to.

## Drift: measure it, then refresh
1. Run `scripts/db-drift-check.sql` against the live DB (Supabase MCP `execute_sql`
   or psql — read-only). Save the JSON as `db/baseline/current-snapshot.json`.
2. `node scripts/db-drift-check.mjs --current db/baseline/current-snapshot.json`
   - prints tables/functions that exist live but have **no CREATE in any migration**
     (the "untracked" surface), and
   - diffs live vs. the committed snapshot (exit 1 on drift).
3. When the diff is intentional, refresh `schema.sql` (owner terminal), overwrite
   `live-schema-snapshot.json`, re-run `scripts/db-nonpublic-capture.sql` for
   `non-public.sql`, update `captured.json`, and commit together — the four files are
   one snapshot and must not drift from each other.

**Drift status: REFRESHED 2026-08-20** — baseline and production both at **176 tables /
544 distinct functions**; `db-drift-check.mjs` reports zero drift. (The previous
2026-07-28 capture was 35 tables behind.) The refresh now runs **non-interactively** on a
linked machine — `supabase link` stores the DB password in the CLI's own config, so
`npm run db:baseline:refresh` needs no prompt; it falls back to asking for a human
terminal only if the stored credential is missing.

**One consequence of refreshing worth knowing:** qualifier scripts that replay
"predecessor migrations in ledger order" on top of the baseline may find those
predecessors now baked in (a `CREATE POLICY` or `ADD COLUMN` that already exists fails
the replay). That is the qualifier's PREDECESSORS list going stale, not a baseline bug —
re-derive the list against the new baseline, the way `qualify-crm-lead-boundary-local.mjs`
documented when it measured its list empty.

## Known reconciliation backlog (as of 2026-07-08)
The untracked report currently lists ~73 tables and ~101 functions that predate the
project's schema-as-code discipline (created before `supabase/migrations/` was the
source of truth) or are defined inline in a way the name-scan can't see. **DB-Foundation
Phase F drift-captured only the two objects it was scoped to** — `system_events` and
`get_dashboard_stats` — re-derived from the live catalog. The remainder is deliberately
left for follow-up reconciliation phases; it is documented, not silently ignored.
`job_sales` and `billing_overview` are **not** captured — they do not exist live
(verified 2026-07-08).
