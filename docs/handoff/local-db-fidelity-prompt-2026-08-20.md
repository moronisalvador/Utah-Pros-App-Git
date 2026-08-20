# Cold-session prompt — make the local database worth trusting

**Authored:** 2026-08-20 · Copy everything below the line into a fresh session. It is
self-contained and depends on no prior conversation.

**Why this exists.** On 2026-08-20 the owner moved migrations to an apply-tier model: a migration
that declares `-- apply-tier: auto` applies to production on its own once its local proof and the
reviewers pass. Three classes are excluded, and **all three are excluded because of gaps in the
local stack, not because of anything about the migrations themselves.** Close those gaps and the
excluded list shrinks — which is the whole point of this work. The owner's framing was "the local
database is a perfect copy of the production database"; the job is to make that closer to true.

---

## Objective

Make `npm run db:local` produce a stack that can answer the questions it currently cannot:

1. **Carry every schema production has**, not just `public`.
2. **Contain realistic fake data at realistic volume**, so a backfill, a constraint or a lock has
   something to act on.
3. **Stay honest about the gap that remains**, and shrink `CAN_NOT_BE_AUTO` by exactly as much as
   it has earned — no more.

## Read first

- `.claude/rules/database-standard.md` §0 — the apply-tier rule and the measured reasons for the
  three blind spots. This is the document your work is trying to change.
- `scripts/migration-apply-tier.mjs` — `CAN_NOT_BE_AUTO` is the list to shrink. Every entry names
  why it is there.
- `scripts/db-local-bootstrap.mjs`, `scripts/db-baseline-refresh.mjs`, `db/baseline/README.md`.
- `CLAUDE.md` → "Environment tiers"; `AGENTS.md` §13.
- `scripts/qa/qualify-job-files-private-local.mjs` — a qualifier that had to hand-seed
  `storage.buckets` and six policies because the baseline has none. That hand-seeding is the
  problem you are solving, and its `seedLiveState()` is a worked example of what is missing.

## Measure before you build — these are today's numbers, re-take them

```bash
grep -c '^INSERT INTO\|^COPY ' db/baseline/schema.sql   # 0  — schema only, enforced
grep -c 'storage\.'            db/baseline/schema.sql   # 0  — no storage schema at all
grep -c '^CREATE TABLE'        db/baseline/schema.sql   # 141
```

`db-baseline-refresh.mjs` **refuses** a dump containing `COPY`/`INSERT` blocks, because
`db/baseline/schema.sql` is committed to a public repository. That refusal is correct and must
stay. It means fake data can never live in the baseline file — it has to be **generated**, which is
better anyway: generated data can be regenerated, scaled, and seeded with edge cases on purpose.

## The work, in the order that de-risks fastest

### 1. Non-`public` schemas (unblocks blind spot 2, the cheapest win)

`storage.buckets`, `storage.objects`, `auth.users`, and the `cron` objects exist on the local stack
because the Supabase CLI creates them — but the repo has no committed record of **UPR's own rows and
policies** in them. Today a Storage migration is proven against whatever the qualifier author typed
from memory.

- Add a committed, **row-free-but-catalog-complete** companion to the baseline, e.g.
  `db/baseline/non-public.sql`: UPR's buckets (id/name/public/limit), every `storage.objects`
  policy, and any `cron.job` definitions — captured the same read-only way the baseline is, with the
  same no-customer-rows guard.
- Load it in `db-local-bootstrap.mjs` right after the baseline.
- **Then delete the `storage.*` / `auth.*` / `cron.*` entries from `CAN_NOT_BE_AUTO`** and say so in
  `database-standard.md` §0.
- Prove it: `qualify-job-files-private-local.mjs` should pass with its `seedLiveState()` **deleted**.
  That is the acceptance test — it currently reconstructs by hand exactly what you are committing.

### 2. Generated fake data (unblocks blind spot 1, the valuable one)

Write `scripts/db-local-seed.mjs` (or extend the bootstrap) that generates a coherent business:
contacts → claims → jobs → appointments → invoices → payments → documents → readings → messages,
with real FK integrity and enum values pulled from the live schema rather than typed.

Requirements that matter more than volume:

- **Coherent, not random.** An invoice belongs to a job that belongs to a claim with a contact.
  Half the value of seed data is that joins return rows.
- **Deliberate edge cases**, because these are what break migrations: NULLs in every nullable
  column, a job with no appointments, a claim with 8 jobs, duplicate-looking contacts, a soft-empty
  string, a very long string, unicode, a row at each enum value, timestamps either side of a
  DST boundary in `America/Denver`.
- **Scalable:** `npm run db:local:seed -- --scale=1` for a fast default and `--scale=100` for a
  lock-and-duration test. Roughly 100k rows on the biggest tables at high scale.
- **Deterministic:** a fixed seed so a failure reproduces. Do not use `Math.random()` unseeded.
- **Obviously fake.** Names, addresses, emails and phone numbers must be unmistakably synthetic
  (`@example.invalid`, `555-01xx`) so a screenshot from a local stack can never be mistaken for
  customer data, and so nobody is tempted to paste it anywhere real.
- Keep the three existing fixture logins (`qa-admin@` / `qa-office@` / `qa-tech@upr-qa.test`) working
  and attach them to seeded employees, so existing qualifiers keep passing.

Then, and only then, consider relaxing the data-touching entries — and **relax them one at a time,
each with a qualifier that proves the new capability**. A reasonable order: `ADD CONSTRAINT` and
`CREATE UNIQUE INDEX` first (a violating row now exists to catch them), `INSERT … SELECT` backfills
next (values can be asserted), `SET NOT NULL` after that. `UPDATE`/`DELETE` over live data is the
hardest and may reasonably stay owner-gated forever — say so explicitly rather than leaving it
looking unfinished.

### 3. Drift detection (stops all of this rotting)

The baseline is a snapshot and production moves. Today nothing notices.

- Add a read-only check that compares the committed baseline against the live catalog — table,
  column, function, policy and enum counts at minimum — and reports drift. Wire it into CI as a
  **warning**, and into `npm run db:local` as a notice.
- Record when the baseline was captured, in the file, and surface its age. A baseline nobody has
  refreshed in three months is a false sense of security, which is worse than a known gap.

## Constraints — do not violate these

- **Never write to the shared production project** (`glsmljpabrwonfiltiqm`). Read-only catalog
  inspection to build the committed non-public schema file is fine and expected; a write is not.
- **No customer data anywhere.** Not in the baseline, not in the seed, not in a fixture, not in a
  test snapshot. The existing refusal in `db-baseline-refresh.mjs` is the model; add the same guard
  to anything new that writes a `.sql` file.
- **Do not relax `CAN_NOT_BE_AUTO` ahead of the capability.** Each entry comes out only when a
  qualifier demonstrates the local stack can now see that class of failure. The list existing but
  being wrong is far more dangerous than the list being long — an `auto` migration applies to
  production with nobody watching.
- Shrinking that list is an amendment to `database-standard.md` §0 and `AGENTS.md`. Per `CLAUDE.md`,
  a mid-session edit to a rules file is not re-read until `/clear` or restart — so never report an
  edited rules file as "updated and followed" in the same session.

## Definition of done

- `npm run db:local` gives a stack with the non-public catalog and a seeded, coherent business.
- `qualify-job-files-private-local.mjs` passes with `seedLiveState()` removed.
- At least one qualifier demonstrates a **data-shaped** failure being caught locally that would
  previously have passed — e.g. an `ADD CONSTRAINT` that fails because a seeded row violates it.
  **That single test is the real deliverable**; everything else is scaffolding for it.
- `CAN_NOT_BE_AUTO` is shorter, and every removal names the qualifier that earned it.
- Drift check exists and runs.
- Docs updated: `db/baseline/README.md`, `CLAUDE.md` → Environment tiers, `database-standard.md` §0.

## One thing to decide early, and ask the owner about

Fake data at scale makes the local stack slow to build. If a full seed takes minutes, agents will
skip it and the whole investment evaporates. Decide up front between a cached container image, a
`pg_dump` of the seeded state loaded in one shot, or a small default scale with an opt-in large one
— and make the fast path the default. **A correct tool nobody runs is worth nothing.**
