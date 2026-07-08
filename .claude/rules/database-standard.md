# Database Standard

Linked from `CLAUDE.md` (Rule 7 + the DB Client API section). These are the standing rules for
schema, RLS, grants, secrets, apply-window discipline, rollback, and time — on the **one shared
Supabase project (`glsmljpabrwonfiltiqm`) that sits behind BOTH `dev` and production**. A migration
is live in production the instant it applies; write every one as if it is.

**Supersedes** the pre-2026-07-08 blanket-`anon` + `USING (true)` template quoted in older wave
manifests and in `CLAUDE.md`'s DB Client API paragraph. Where an older manifest still shows the old
template, it is describing what already shipped — new work follows this file.

**Why the flip is safe (verified, not assumed):** logged-in users already carry a real Supabase Auth
JWT with `role=authenticated` (`AuthContext.jsx` builds the db client from `session.access_token`;
the anon key is only used for pre-login bootstrap and DEV `devLogin`). `AuthContext.jsx` even
comments *"anon client breaks if RLS tightens"* — the app runs as `authenticated`, so scoping
policies and grants to `authenticated` does not regress it. The old blanket-`anon` template is what
exposed every `USING (true)` table to unauthenticated reads via the anon key shipped in the browser
bundle.

---

## 1. Least-privilege grants & policies (the default)

- **RPCs:** `SECURITY DEFINER` + `GRANT EXECUTE ... TO authenticated, service_role`. **Never `anon`**
  unless the function is in the public allowlist (§2).
- **Tables:** `ENABLE ROW LEVEL SECURITY` + an explicit policy scoped `TO authenticated`. The floor
  is `FOR ALL TO authenticated USING (true) WITH CHECK (true)`; tighten to an ownership/org predicate
  (`auth.uid()` → `employees` → assignment) wherever the data is per-user or per-org. `USING (true)`
  is the floor, not the goal.
- A policy or grant naming `anon` or `public` outside §2 is a review failure.

## 2. Public allowlist — the ONLY place `anon` is granted

Adding `anon` to any GRANT or policy requires (a) an entry in this list and (b) a
`-- public: <reason>` comment in the migration naming the exact RPC/table and why it must be
reachable before login. Current allowlist:

- **login / session bootstrap** reads (employee lookup, feature flags, page access)
- **`/status`** public roadmap mirror → `get_crm_build_progress`
- **public form submit** `functions/f/[public_id].js` → `upsert_lead_from_form` *(worker path; revoke
  client anon once confirmed no browser caller)*
- **public e-sign pages** → `get_sign_request_by_token` (token-gated) + the SignPage template read
- **public job-file READ** (photos/PDFs) until the P3 signed-URL migration lands

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

- One Supabase backs `dev` AND `main` — a migration hits production the moment it applies. Apply
  during a low-traffic window and **sequence so consuming code deploys first** for any additive column
  the frontend will read. Removals are forbidden on live tables (§3); if ever truly needed, they are a
  separate reviewed change, schema-last. Announce the apply in the PR.
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
