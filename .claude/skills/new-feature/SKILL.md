---
name: new-feature
description: Run a new UPR feature build the disciplined way — understand-first (right doc + live schema, not memory), plan, branch, test-first, build to CLAUDE.md rules, self-review, update docs, PR to dev via the template. Use when starting any non-trivial feature or change.
---

# new-feature

The standard UPR build loop. Follow it in order; it's the difference between a
change that ships clean and one that breaks a live business app. Everything here
is enforced by `CLAUDE.md` — this skill just makes the sequence automatic.

## 1. Understand before acting (Rule 1)
- Read the **actual files** you'll touch — never edit from memory.
- Consult the **right doc**: `UPR-Web-Context.md` (schema / RPCs / iOS), `BILLING-CONTEXT.md`
  (QBO / invoicing), `UPR-Design-System.md` (CSS / components), `EMAIL-DELIVERABILITY.md`, etc.
- **Verify live, not from memory or a doc list**: confirm real column/table names via the
  Supabase MCP or `information_schema.columns` (tables have 20–60+ columns; docs go stale —
  this is exactly how CLAUDE.md itself once drifted).
- For anything non-trivial, **plan first** (prefer plan mode) and reuse existing patterns
  over inventing. Delegate broad searches to Explore subagents to keep context lean.

## 2. Branch
- Feature branch off `dev`, descriptively named. Never work on `main`.

## 3. Commit acceptance criteria + a failing test FIRST
- Write concrete, checkable "done" conditions (they go in the PR template).
- For the risky logic (money math, data writes, idempotency, auth, date/timezone),
  **commit a failing test before the implementation**. Do not edit a committed test to
  make it pass — fix the code. (`vitest` is set up; pure logic → unit test, SQL RPC →
  integration test vs the Supabase dev branch.)

## 4. Build to the rules
- `const { db } = useAuth()`; writes via `db.rpc()` on new tables; no `alert()`/`confirm()`
  (use `upr:toast` + inline two-click confirm); CSS tokens not hardcoded hex; mobile CSS
  scoped to `@media (max-width: 768px)`.
- **Migrations:** write to `supabase/migrations/` first, additive-only, RLS-enabled at
  creation, applied + verified on `dev`. One shared Supabase — a migration hits prod
  instantly, so sequence consuming code to deploy first. Follow
  **`.claude/rules/database-standard.md`**: least-privilege grants
  (`GRANT EXECUTE TO authenticated, service_role`, policies `TO authenticated` — `anon`
  only via its §2 allowlist), a rollback note on every live-table/RPC change, no
  anon/authenticated-readable secret columns, and `timestamptz` + `America/Denver` dates.
- New/edited files get the Documentation Standard header.

## 5. Verify + self-review (never claim "done" unverified)
- `npm run build` + `npm test` green; `npm run lint` adds no new errors.
- Run the **`upr-pattern-checker`** agent (rules lint), then — for anything with real
  acceptance criteria or money/consent/auth logic — an independent reviewer agent
  (e.g. `crm-phase-reviewer`) to grade against the criteria.
- **If the change ships a migration:** run **`migration-safety-checker`** (additive-only,
  RLS, least-privilege grants) **and `anon-grant-auditor`** (no stray `anon` grant/policy,
  no secret reachable by anon/authenticated). For a DB Foundation phase, also run
  **`db-foundation-phase-reviewer`**.

## 6. Document + ship
- Update `UPR-Web-Context.md` (Rule 9) for any new table / RPC / component / page / worker.
- Open a PR into `dev`, filling **every** section of the PR template honestly (blank = not
  done). Push to `dev` to verify on staging; release to production only via a reviewed
  `dev → main` PR. Never a direct `main` push.

For a large multi-session feature, start a roadmap-of-record doc (`docs/<feature>-roadmap.md`)
with per-phase branch / prerequisite / close-out blocks, and build it phase by phase.
