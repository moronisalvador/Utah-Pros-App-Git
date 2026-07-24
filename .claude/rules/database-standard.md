# Database Standard

**Last verified:** 2026-07-23

Linked from `CLAUDE.md` (Rule 7 + the DB Client API section). These are the standing rules for
schema, RLS, grants, secrets, apply-window discipline, rollback, and time — on the **one shared
Supabase project (`glsmljpabrwonfiltiqm`) that sits behind BOTH `dev` and production**. A migration
is live in production the instant it applies; write every one as if it is.

**Supersedes** the pre-2026-07-08 blanket-`anon` + `USING (true)` template quoted in older wave
manifests and in `CLAUDE.md`'s DB Client API paragraph. Where an older manifest still shows the old
template, it is describing what already shipped — new work follows this file.

**Live audit correction (2026-07-22):** scoping a policy to `authenticated` closes logged-out
access, but it does not create employee-, role-, assignment- or organization-level authorization.
The live project still has broad anonymous exceptions, 146 advisor-flagged always-true policies and
342 authenticated-executable `SECURITY DEFINER` overloads. Do not copy live broad grants/policies as
templates. Evidence: `docs/audit/2026-07/evidence/live-supabase.md`.

## 0. Authority boundary — authoring is not applying

- Read-only live catalog inspection is allowed when it is relevant and authorized by the task.
- Writing a repository migration is allowed only when the user requested implementation.
- Applying a migration or running SQL that can mutate the shared project requires a fresh,
  task-specific owner instruction to perform that live action. A skill, roadmap, persistent tool
  permission, provider approval, or prior apply instruction is not reusable authorization.
- Never use `execute_sql`, `supabase db query`, or another direct-SQL path to iterate on the shared
  project. Iterate only against a verified isolated local/test database; otherwise author and review
  the migration without applying it.
- Commit, push, PR, deploy, provider writes, and live cleanup/status changes are separate delivery
  actions and require their own user authorization.

**Why the flip is safe (verified, not assumed):** logged-in users already carry a real Supabase Auth
JWT with `role=authenticated` (`AuthContext.jsx` builds the db client from `session.access_token`;
the anon key is only used for pre-login bootstrap and DEV `devLogin`). `AuthContext.jsx` even
comments *"anon client breaks if RLS tightens"* — the app runs as `authenticated`, so scoping
policies and grants to `authenticated` does not regress it. The old blanket-`anon` template is what
exposed every `USING (true)` table to unauthenticated reads via the anon key shipped in the browser
bundle.

---

## 1. Least-privilege grants & policies (the default)

- **RPCs:** use `SECURITY INVOKER` unless owner privileges are required. For `SECURITY DEFINER`,
  validate the caller/employee/role or capability inside the function, pin `search_path`, and grant
  only the roles that need the exact operation. `authenticated` is not an automatic grant;
  service-only helpers receive service-role-only execution. **Never `anon`** unless the function is
  in the public allowlist (§2).
  - **Managed-Supabase function trap (verified in Phase F):** this project re-applies Postgres's
    built-in `EXECUTE TO PUBLIC` to every new function at `ddl_command_end`, so the `ALTER DEFAULT
    PRIVILEGES` revoke does **not** cover functions. Every new/replaced function migration must add an
    explicit `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;` immediately before its `GRANT` — the
    `ALTER DEFAULT PRIVILEGES` backstop only reliably covers tables/sequences.
- **Tables:** `ENABLE ROW LEVEL SECURITY` + only the operation-specific policies required by the
  workflow. Use ownership, active employee, role, assignment or organization predicates. An
  always-true authenticated policy is allowed only for data explicitly classified company-wide,
  documented in `docs/auth-and-authorization.md`, and covered by role tests; it is not the default
  floor. Updates require the intended SELECT visibility plus both `USING` and `WITH CHECK`.
- **Free-form SQL:** never expose dynamic arbitrary-query RPCs to `PUBLIC`, `anon` or
  `authenticated`. `exec_read_sql` was contained to `service_role` on 2026-07-23 and must remain
  service-only if retained.
- A policy or grant naming `anon` or `public` outside §2 is a review failure.

## 2. Public allowlist — the ONLY place `anon` is granted

Adding `anon` to any GRANT or policy requires (a) an entry in this list and (b) a
`-- public: <reason>` comment in the migration naming the exact RPC/table and why it must be
reachable before login. Current temporary allowlist/legacy exceptions (all must be minimized; none
is a template):

- **login / session bootstrap** reads (replace broad table rows with purpose-built minimal bootstrap
  results)
- **`/status`** public roadmap mirror → `get_crm_build_progress`
- **public form submit** Workers → `upsert_lead_from_form` *(service-only target state;
  `20260723235900_public_form_rpc_boundary.sql` is authored but unapplied; direct client execution
  remains live until its owner-authorized window)*
- **public e-sign pages** → purpose-built retrieval constrained by token, status and expiration
- **public job-file READ** *(temporary; remove list access and move sensitive files to private/signed
  URLs)*

Extend this list deliberately, one line per entry naming the exact object and the pre-auth reason.

## 3. Additive-only + frontend-contract freeze

- **Additive-only on live tables:** no `DROP`, no `RENAME`, no `ALTER COLUMN` that tightens a type or
  adds `SET NOT NULL` to an existing column. Adding tables/columns/indexes/constraints-on-new-columns
  is fine (mirrors `migration-safety-checker` rule 1).
- **FE-contract freeze:** never rename or drop a column, or change an RPC's return shape, that a
  deployed frontend reads. One shared Supabase means a migration is live in prod the instant it
  applies, while the frontend deploys on its own cadence — a removed column breaks prod immediately.
  A `CREATE OR REPLACE` of a live RPC keeps the old signature callable (new params take `DEFAULT`)
  and ships a committed test that the shipped caller still succeeds.

## 4. Secrets are never plaintext-readable

- No credential / token / API key stored in a column readable by `authenticated` (or `anon`). Secrets
  live in Cloudflare env (both Production **and** Preview sets), or in a service-role-only table with
  **no** `authenticated`/`anon` policy and **no** RPC that returns the secret value (status/boolean
  only). Precedent: the P9 `integration_credentials` deny-all + admin-gated-status pattern.
- No migration `INSERT` seeds a real secret. (A `.claude/hooks/block-secrets.sh` guard exists for
  committed files; this rule is its database equivalent.)

## 5. Apply-window discipline (shared prod)

- Do not enter an apply window until §0's live-apply authorization is present for the exact reviewed
  migration. If it is absent, stop after authoring, tests, rollback review and an apply plan.
- One Supabase backs `dev` AND `main` — a migration hits production the moment it applies. Apply
  during a low-traffic window and **sequence so consuming code deploys first** for any additive column
  the frontend will read. Removals are forbidden on live tables (§3); if ever truly needed, they are a
  separate reviewed change, schema-last. Announce the apply in the PR.
- Apply only migrations committed to a reviewed commit reachable from the designated release
  branch. An emergency feature-branch apply requires owner authorization, a recorded commit/reason
  and immediate merge/reconciliation; run a read-only live-ledger-versus-release-ref check.
- Two migrations that issue strong-lock DDL (`CREATE/DROP POLICY`, `ADD CONSTRAINT`, `ADD/DROP INDEX`)
  against the **same** hot tables must not have overlapping apply windows — serialize the apply even
  though merge order is free. Use `ADD CONSTRAINT ... NOT VALID` → `VALIDATE CONSTRAINT` to keep the
  exclusive-lock window to milliseconds. Precedent: `.claude/rules/scope-sheet-rollback.md`.

## 6. Rollback script required

- Every migration touching a live table/RPC ships (or links) its undo: the prior `CREATE OR REPLACE`
  body for a function, the `DROP`/deactivation for an additive object, or the re-`GRANT` for a revoke.
  A migration with no stated undo is a review failure. Pattern: `scope-sheet-rollback.md`.

## 7. One timezone convention

- All timestamp columns are `timestamptz`. All day/week bucketing uses **`America/Denver`** (matches
  the tech-v2 + CRM RPCs already stamping Denver days, and `functions/lib/date-mt.js` on the JS side).
  Never bucket in UTC or server-local time. New date logic states its zone; prefer the shared SQL
  helpers (`mt_today()` / `mt_date(timestamptz)`) once Foundation ships them.
