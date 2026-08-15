# Retired migrations — history, never an apply candidate

**Last verified:** 2026-08-07

Files here are SQL that must **never run again**. They were moved out of
`supabase/migrations/` because that directory is an *apply queue*, not an archive:
`scripts/check-migration-hygiene.mjs` and the Supabase CLI both read it with a
non-recursive `readdirSync(...).filter(f => f.endsWith('.sql'))`, so anything
sitting there is a live candidate for the next runner — or the next agent — that
decides to catch the database up.

Moving them costs nothing (git still has every version) and removes the only way
they could be applied by accident.

**Nothing in this folder is documentation of current schema.** To see what the
database actually looks like, read the live catalog or `docs/database-schema.md`.

---

## `20260727022920_mobile_personal_ownership_boundary.sql` (+ its rollback)

**Status: RETIRED. Never applied to any project, and must not be.**

Authored for the mobile personal-ownership boundary, then overtaken by the
focused native-token and preference lineage that shipped instead. Its own catalog
preflight now **refuses on both `qa-staging` and production** — the objects it
expects to find no longer look the way it was written against, so running it
would either fail loudly or, worse, act on assumptions that stopped being true.

Its rollback moved with it: a rollback for a migration that was never applied is
equally not an apply candidate, and splitting the pair across two folders would
strand it.

If the Page Access / Web Push hardening it was meant to deliver is still wanted,
that is a **new migration written against today's schema** — not this file.

## `tech_feedback.sql`

**Status: GRANDFATHERED HISTORY. Already live; superseded; must not be re-run.**

This is undated legacy — it has **no timestamp prefix at all**, which is its own
hazard: ordering against every other migration is undefined, so which side of a
sort it lands on depends on the tool. Its contents are long since live and were
superseded by `20260702_feedback_media.sql`.

It stays readable here because it is part of how the feedback tables came to
exist, and deleting it outright would lose that.

---

## If you are adding to this folder

State, in one line each: what the file was for, why it can never run again, and
what replaced it. A retired migration with no explanation is indistinguishable
from one somebody forgot to apply — which is exactly the confusion this folder
exists to end.
