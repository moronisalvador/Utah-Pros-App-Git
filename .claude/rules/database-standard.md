# Database Standard

**Last verified:** 2026-08-20

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
- **Applying a migration depends on its declared APPLY TIER (owner-directed 2026-08-20, superseding
  the blanket per-apply gate that stood here before).** Every migration written on or after
  2026-08-20 declares one, and CI refuses it otherwise
  (`scripts/check-migration-hygiene.mjs` rule 5, classifier in `scripts/migration-apply-tier.mjs`):

  - **`-- apply-tier: auto`** — applies to the shared project without another conversation, once
    **all** of: the §5b behavioural proof passes on a disposable local stack; the applicable
    reviewer agents pass; `check-migration-hygiene` passes; and the paired rollback exists. The
    owner's words: *"if it's applied to the local database, and it works fine on the local database
    and passes the reviewers too, go ahead and apply to production."*
  - **`-- apply-tier: owner-gated: <reason>`** — still needs a fresh, task-specific owner
    instruction. A skill, roadmap, persistent tool permission, provider approval, or prior apply
    instruction is not reusable authorization.
  - **An UNDECLARED tier is owner-gated.** Silence is never permission. Migrations whose version
    prefix predates `APPLY_TIER_REQUIRED_FROM` (20260820) are exempt from declaring one and are
    therefore owner-gated by default. That exemption is a DATE, not a filename list: the list
    version broke within the hour when a parallel session merged a migration authored before the
    rule but captured after the snapshot, turning CI red on `dev` for blameless work.

  **What can never be `auto`, and why.** Not conservatism — each entry names what a green local
  run cannot vouch for. Re-measured 2026-08-20, when the local stack gained the committed
  non-public catalog capture (`db/baseline/non-public.sql`) and the deterministic synthetic seed
  (`npm run db:local:seed`):

  1. **data-touching** — `UPDATE`/`DELETE`, `INSERT … SELECT` backfills, `SET NOT NULL`,
     `ADD CONSTRAINT`, `CREATE UNIQUE INDEX`. The seed makes this failure class **visible**
     locally — `npm run test:db:data-visibility:local` demonstrates all three DDL shapes passing
     on an empty table and being refused over seeded rows — but **detection is not clearance**: a
     synthetic row can prove a violation exists, never that production's real rows hold none. So a
     local pass still authorizes nothing here. (A bounded `INSERT … VALUES` of literal rows is
     deliberately **not** on this list — it is verifiable by reading it.)
     **Owner decision 2026-08-20 ("Auto for NOT VALID only"):** `ADD CONSTRAINT … NOT VALID` is
     auto-eligible — it skips scanning existing rows, so the apply cannot fail on real data and
     holds only a millisecond lock; new rows are enforced immediately. The row-scanning steps stay
     owner-gated: plain `ADD CONSTRAINT`, **`VALIDATE CONSTRAINT`** (which gained its own blocker
     the same day — it previously matched no entry at all, which would have made the relaxation
     meaningless), `CREATE UNIQUE INDEX`, and everything else in this class.
  2. **`auth.*` and `cron.*`** — for restated reasons, since the old "not in the baseline" one is
     dead: the live `auth` schema carries **zero UPR objects** (no triggers, policies or functions
     — measured 2026-08-20), so the gap is the ROWS — auth rows are real credentials, and no local
     proof de-risks creating or altering a login. `cron` scheduling is a **live activation**, the
     same class as a flag flip, and this section already names it separately authorized every
     time. The captured cron rows (loaded locally deactivated) make such migrations testable; they
     do not make the activation automatic.
     **`storage.*` came OFF this list 2026-08-20** — earned, not relaxed:
     `db/baseline/non-public.sql` carries the live buckets and every `storage.objects` policy
     (captured read-only; regenerate via `scripts/db-nonpublic-capture.sql`), and
     `qualify-job-files-private-local.mjs` passes its full disposable cycle with its hand-typed
     reconstruction deleted. A bucket `public`-flag flip stays caught by class 1 in **both** its
     forms — literal `UPDATE … SET` and `INSERT … ON CONFLICT DO UPDATE SET` (the upsert entry was
     added the same day, after review found the idiom slipped the literal regex).
  3. **destructive DDL** — `DROP TABLE`/`COLUMN`, `RENAME`, `ALTER COLUMN … TYPE`. A
     `-- destructive-approved:` marker records an owner review of the DROP; it does not make a local
     run able to see the rows being dropped, so it never doubles as an auto-apply pass.

  **This list shrinks only by making the local stack able to SEE the thing** — the storage removal
  is the worked example: committed capture + a qualifier that passes without hand-seeding. Deleting
  an entry without that is the move to refuse. Baseline staleness is surfaced by
  `npm run db:baseline:age` (warning-only in CI) — a proof against a stale baseline is quietly
  weaker, so refresh before trusting a close call.

  `auto` still does not authorize anything else: **deploy, `dev → main` promotion, provider calls,
  flag flips, cron scheduling and money actions remain separately authorized, every time.** And
  deploy-order coupling is still a human judgement — a migration whose consuming code must ship
  first is `owner-gated` for that reason alone, whatever else it contains.
- Never use `execute_sql`, `supabase db query`, or another direct-SQL path to iterate on the shared
  project. Iterate only against a verified isolated local/test database; otherwise author and review
  the migration without applying it.
- Commit, push, PR, deploy, provider writes, and live cleanup/status changes are separate delivery
  actions and require their own user authorization.

**Why the flip is safe (verified, not assumed):** logged-in users already carry a real Supabase Auth
JWT with `role=authenticated` (`AuthContext.jsx` builds the db client from `session.access_token`;
the anon key is only used for deliberately public/pre-login boundaries). The anonymous employee
picker and `devLogin` bypass are removed; local real-data verification also uses a genuine Supabase
Auth session, and employee identity resolves selector-free from `auth.uid()`. The application data
path therefore runs as `authenticated`, so scoping policies and grants to `authenticated` does not
regress it. The old blanket-`anon` template is what exposed every `USING (true)` table to
unauthenticated reads via the anon key shipped in the browser bundle.

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
- ~~**public form submit** Workers → `upsert_lead_from_form`~~ **CLOSED 2026-07-24.**
  `20260723235900_public_form_rpc_boundary.sql` applied under owner authorization (ledger
  `20260725003433`). `upsert_lead_from_form` is now service-role-only — verified live:
  `anon=false, authenticated=false, public=false, service_role=true`. Safe because both callers
  (`functions/api/form-submit.js`, `functions/api/webflow-form-webhook.js`) were already deployed in
  `main` and both build their client through `functions/lib/supabase.js` (the privileged
  worker-side client); a repo-wide grep found **no browser caller**. This is no longer a public
  exception — do not re-grant `anon`.
- **public e-sign — custom text** → `get_sign_request_custom_text(text)`
  (token + `doc_type = 'other'` + `status = 'pending'` + `expires_at > now()`; returns only the two
  per-request snapshot text columns). The signing page at `/sign/:token` is opened by an
  unauthenticated client, so the wording it must display has to be readable before login. Added
  2026-08-07, production ledger `20260807225846`.
- **public e-sign — signing-page bootstrap** → `get_sign_request_by_token(text)`
  (token only in the `WHERE`, but the PII inside the payload is gated on
  `status = 'pending' AND expires_at > now()`). **NARROWED 2026-08-08**, production ledger
  `20260808045002_sign_request_token_pii_redaction`.
  - It still matches on the token alone and still returns a row for a spent link — deliberately.
    Both callers pick which screen to show (*Already Signed* / *Link Expired* / *not found*) from
    that row, so a `WHERE` predicate would collapse all three into "this link was not found".
  - What changed is the contents. While the link is actionable the payload is unchanged. Once it
    is signed, cancelled or expired, `job`, `signer_name`, `signer_email` and `signed_file_path`
    come back NULL — so `insured_name`, street address, `date_of_loss`, `insurance_company`,
    **`claim_number`** and **`policy_number`** are no longer readable by a spent token.
    Before this, a token from a job signed in April still answered with all of them.
  - Postflight on all 57 live rows: 0 claim numbers and 0 policy numbers returned for any
    non-actionable request, 0 payloads NULL, `status`/`expires_at` intact on every one.
  - **Still open by design:** a PENDING link yields full PII to whoever holds the token. That is
    inherent to an emailed signing link. The remaining exposure is the public-read `job-files`
    bucket, tracked separately.
- **public job-file READ** *(temporary; remove list access and move sensitive files to private/signed
  URLs)* — **STILL OPEN, but its closure is authored and proven as of 2026-08-19.**
  Phase 1 took the 32 signed customer documents out of this bucket entirely (production ledger
  `20260816171231`, objects moved 2026-08-19), so what this entry still exposes is 91 objects of
  job photos, scope sheets, reports and Xactimate files — not claim and policy numbers.
  Phase 2 closes the entry outright: `supabase/migrations/20260820010000_job_files_bucket_private.sql`
  drops both `anon_read_job_files` and `job_files_select` and sets `public = false`, with a §5b
  behavioural proof already executed (`npm run test:db:job-files-private:local`).
  **It is UNAPPLIED.** Delete this bullet when it applies, not before — the entry describes what is
  live, and today `storage.buckets.public` is still `true` for `job-files`.
  Gates and deploy order: `docs/job-files-privacy-roadmap.md` §5.0.

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
- **The applied payload must BE the file — read it from disk and pass its entire contents,
  unedited.** A retyped, abbreviated or summarized copy is not reviewed source, however faithful it
  looks: on 2026-08-04 an agent shortened a migration's header comment "to save context" and
  silently dropped the required ROLLBACK section, and the CRM lead-value apply reached production
  with a backfill function granted to `anon` from "a transcription slip in the apply payload, not in
  the reviewed file" (`initiative-status.md`). **Mechanically enforced since 2026-08-04:**
  `.claude/hooks/block-destructive-sql.sh` refuses any `apply_migration` payload that does not match
  a tracked, HEAD-clean file in `supabase/migrations/` or `supabase/rollbacks/` (indentation and line
  endings are tolerated; a changed, added or removed token is not). An owner-authorized emergency fix
  with no reviewed commit yet may carry `-- owner-authorized-unreviewed-apply: <reason>`, which
  skips ONLY that fidelity check — it is not §0 authorization, does not relax any other refusal in
  the guard, and the exact applied source is committed afterwards.
- New governed migration files rely on the Supabase migration executor's transaction, which includes
  both the SQL and its `schema_migrations` ledger write. Do not add top-level `BEGIN`/`COMMIT` to
  those forward files or require it in source-contract tests; an operator-run rollback may own an
  explicit transaction when its runbook says so. Never substitute a raw direct-SQL apply path.
- Two migrations that issue strong-lock DDL (`CREATE/DROP POLICY`, `ADD CONSTRAINT`, `ADD/DROP INDEX`)
  against the **same** hot tables must not have overlapping apply windows — serialize the apply even
  though merge order is free. Use `ADD CONSTRAINT ... NOT VALID` → `VALIDATE CONSTRAINT` to keep the
  exclusive-lock window to milliseconds. Precedent: `.claude/rules/scope-sheet-rollback.md`.

## 5b. Access-predicate changes require a role-perspective behavioral proof

- Any migration that changes **who can see or do something** — an RLS policy, a role/membership/
  authorization predicate, an access-resolution function — ships a behavioral proof executed on a
  disposable local stack (the `qualify-*-local.mjs` pattern; template:
  `scripts/qa/qualify-estimate-create-boundary-local.mjs`) with **per-role ALLOW cases and per-role
  DENY cases, including the roles the change is not "about."** Proving only who gets in is how the
  2026-08-01 conversation scoping shipped while silently locking every field technician out of
  every conversation (measured after the fact: 3 active techs × 0 accessible conversations, four
  days of broken notification audiences and dead push taps). The proof must answer, for each
  affected surface: which roles gain, which roles lose, and which roles are untouched — and a
  static contract test alone does not satisfy this rule.

## 6. Rollback script required

- Every migration touching a live table/RPC ships (or links) its undo: the prior `CREATE OR REPLACE`
  body for a function, the `DROP`/deactivation for an additive object, or the re-`GRANT` for a revoke.
  A migration with no stated undo is a review failure. Pattern: `scope-sheet-rollback.md`.

## 7. One timezone convention

- All timestamp columns are `timestamptz`. All day/week bucketing uses **`America/Denver`** (matches
  the tech-v2 + CRM RPCs already stamping Denver days, and `functions/lib/date-mt.js` on the JS side).
  Never bucket in UTC or server-local time. New date logic states its zone; prefer the shared SQL
  helpers (`mt_today()` / `mt_date(timestamptz)`) once Foundation ships them.
