---
name: new-feature
description: Implement a non-trivial UPR feature with understand-first, test-first, project-law review, and documentation. This is the ordinary feature dispatcher; planning-only work stays read-only, and branch, commit, push, PR, or deploy occur only when explicitly requested.
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

## 2. Confirm authority and repository workflow
- Implementation authorizes only the scoped repository edits. Live SQL, external writes, money,
  outbound messages, credentials/permissions, commit, push, PR, and deploy are separate actions.
- Do not create or switch branches unless requested or required by the current initiative manifest.
  When delivery is requested, follow `CLAUDE.md`'s routine-versus-wave workflow. Never work on or
  push `main` directly.

## 3. Write acceptance criteria + a failing test FIRST
- Write concrete, checkable "done" conditions (they go in the PR template).
- For the risky logic (money math, data writes, idempotency, auth, date/timezone),
  **write a failing test before the implementation**. A commit is required only when publication
  was requested. Do not weaken a valid failing test to make it pass—fix the code. SQL integration
  tests require an authorized isolated harness; do not experiment against shared production.

## 4. Build to the rules
- `const { db } = useAuth()`; writes via the narrow approved contract; no `alert()`/`confirm()`
  (use `src/lib/toast.js` + inline two-click confirm); CSS tokens not hardcoded hex; mobile CSS
  scoped to `@media (max-width: 768px)`.
- **Migrations:** write to `supabase/migrations/` first when implementation is requested,
  additive-only, and RLS-enabled at creation. Do not apply or run mutation-capable direct SQL
  without a separate explicit owner instruction for the exact reviewed migration. Follow
  **`.claude/rules/database-standard.md`**: least-privilege grants
  (prefer `SECURITY INVOKER`; necessary definers validate callers, revoke `PUBLIC`/`anon`, and grant
  only intended roles; policies enforce owner/role/assignment/org scope), a rollback note, no
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

## 6. Document; ship only when requested
- Update `UPR-Web-Context.md` (Rule 9) for any new table / RPC / component / page / worker.
- Stop with a diff and verification report unless the user requested publication. If requested,
  choose the exact routine or wave delivery path from `CLAUDE.md`, fill handoff material honestly,
  and never push `main` directly.

For a large multi-session feature, start a roadmap-of-record doc (`docs/<feature>-roadmap.md`)
with per-phase branch / prerequisite / close-out blocks, and build it phase by phase.
