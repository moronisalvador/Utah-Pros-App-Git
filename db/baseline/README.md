# DB baseline — live-schema snapshot

This directory (deliberately **not** `docs/generated/`) holds the committed
**baseline snapshot** of the live Supabase public schema for drift reconciliation.
It is the reference `scripts/db-drift-check.mjs` compares against.

## Files
- **`live-schema-snapshot.json`** — the committed inventory of live `public` tables
  and functions (object names + counts), captured via `scripts/db-drift-check.sql`.
  Machine-generated; do not hand-edit.

## Regenerate
1. Run `scripts/db-drift-check.sql` against the live DB (Supabase MCP `execute_sql`
   or `psql`). It returns one JSON value.
2. Save that value as `db/baseline/current-snapshot.json`.
3. `node scripts/db-drift-check.mjs --current db/baseline/current-snapshot.json`
   - prints tables/functions that exist live but have **no CREATE in any migration**
     (the "untracked" surface — how Phase F found `system_events` /
     `get_dashboard_stats`), and
   - diffs live vs. this baseline (exit 1 on drift).
4. When the diff is intentional, overwrite `live-schema-snapshot.json` with the new
   snapshot and commit.

## Known reconciliation backlog (as of 2026-07-08)
The untracked report currently lists ~73 tables and ~101 functions that predate the
project's schema-as-code discipline (created before `supabase/migrations/` was the
source of truth) or are defined inline in a way the name-scan can't see. **DB-Foundation
Phase F drift-captured only the two objects it was scoped to** — `system_events` and
`get_dashboard_stats` — re-derived from the live catalog. The remainder is deliberately
left for follow-up reconciliation phases; it is documented, not silently ignored.
`job_sales` and `billing_overview` are **not** captured — they do not exist live
(verified 2026-07-08).
