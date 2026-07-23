# Live Supabase Evidence — 2026-07-22

This is a read-only evidence record for the July 2026 repository audit. It contains catalog
metadata, aggregate counts, policy/routine definitions selected for security review, advisor
results and operational summaries. It deliberately excludes business-row contents, object names in
Storage, secrets, tokens, email addresses, phone numbers, request/response bodies and raw logs.

- **Project:** `glsmljpabrwonfiltiqm` (`moronisalvador's Project`)
- **Project state:** `ACTIVE_HEALTHY`
- **Region / database:** `us-east-2`; PostgreSQL 17.6 (Supabase database build 17.6.1.063)
- **Capture window:** 2026-07-23 02:45–02:50 UTC (2026-07-22 MDT)
- **Method:** Supabase Management API plus read-only SQL catalog queries
- **Mutation performed:** none

## Catalog inventory

| Schema | Tables | Views | Materialized views | Routines | Sequences |
|---|---:|---:|---:|---:|---:|
| `public` | 130 | 5 | 0 | 366 | 6 |
| `auth` | 23 | 0 | 0 | 4 | 1 |
| `storage` | 8 | 0 | 0 | 17 | 0 |
| `realtime` | 10 | 0 | 0 | 15 | 1 |
| `cron` | 2 | 0 | 0 | 7 | 2 |
| `net` | 2 | 0 | 0 | 12 | 1 |
| `extensions` | 0 | 2 | 0 | 55 | 0 |
| `supabase_migrations` | 1 | 0 | 0 | 0 | 0 |
| `vault` | 1 | 1 | 0 | 5 | 0 |

The `public` schema has 1,689 columns, 130 primary keys, 247 foreign keys, 52 unique constraints,
70 check constraints and 419 indexes. Every public table has a primary key. All 419 indexes were
valid and ready. There were 47 non-internal triggers across 25 public tables, with none disabled.
The database occupied 49,949,843 bytes at capture time. No ungranted lock or unvalidated public
constraint was present.

Installed extensions were `pg_cron` 1.6.4, `pg_net` 0.19.5, `pg_stat_statements` 1.11,
`pgcrypto` 1.3, `supabase_vault` 0.3.1 and `uuid-ossp` 1.1. `pg_net` is installed in `public`;
the security advisor flags that placement.

## RLS, policies and grants

All 130 public tables had RLS enabled; none used forced RLS. There were 225 public policies on
115 tables. The other 15 RLS-enabled tables had no policy: `billing_2fa_codes`,
`dashboard_layouts`, `google_calendar_links`, `homebuilding_build_projects`,
`homebuilding_chat_messages`, `homebuilding_chats`, `homebuilding_estimates`,
`integration_config`, `integration_credentials`, `push_subscriptions`, `qbo_events`,
`stripe_events`, `system_events`, `upr_mcp_audit` and `user_google_accounts`. For ordinary API
roles, RLS therefore defaults those tables to deny; privileged functions/service-role paths can
still reach them.

The security advisor reported 146 always-true policies. Direct catalog classification found these
fully unrestricted anonymous policies:

| Command | Policy count | Affected tables |
|---|---:|---|
| `ALL` | 7 | `automation_settings`, `crm_automation_runs`, `crm_automations`, `email_campaign_exclusions`, `email_campaign_recipients`, `email_campaigns`, `email_suppressions` |
| `SELECT` | 12 | `appointments`, `claims`, `contacts`, `conversation_participants`, `conversations`, `employee_page_access`, `employees`, `feature_flags`, `job_phase_history`, `jobs`, `messages`, `nav_permissions` |
| `INSERT` | 8 | `appointments`, `claims`, `contacts`, `conversation_participants`, `conversations`, `job_phase_history`, `jobs`, `messages` |
| `UPDATE` | 5 | `appointments`, `claims`, `contacts`, `conversations`, `jobs` |
| `DELETE` | 1 | `appointments` |

Authenticated access was also broad: always-true policies granted `ALL` on 75 tables, unrestricted
`SELECT` on 41, `INSERT` on 23, `UPDATE` on 15 and `DELETE` on 17. These figures overlap because a
table can have an `ALL` policy and command-specific policies.

Table ACLs were broader still. `anon` held `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
`REFERENCES` and `TRIGGER` on 124 public tables; `authenticated` held all seven privileges on all
130 public tables and `SELECT` on the five reporting views as well. RLS remains effective for
ordinary row operations, but the ACLs are not least privilege and increase the impact of an RLS or
privileged-RPC mistake. Current `postgres` default privileges for new public tables/functions do
not grant `anon`; legacy object grants remain.

All five public reporting views (`rv_invoices`, `rv_jobs`, `rv_leads`, `rv_payments`,
`rv_time_entries`) use `security_invoker=true`, deny anonymous SELECT and allow authenticated
SELECT.

## Privileged routines

Of 366 public functions, 345 were `SECURITY DEFINER`. All 345 had an explicit function-level
`search_path`; six were executable by `anon`, and 342 overloads were executable by
`authenticated`. Five functions retained `PUBLIC` EXECUTE:
`get_crm_build_progress`, `get_employee_page_access`, `get_feature_flags`,
`get_sign_request_by_token` and `upsert_lead_from_form`.

The six anonymous `SECURITY DEFINER` functions were:

1. `get_crm_build_progress()`
2. `get_employee_page_access(uuid)`
3. `get_feature_flags()`
4. `get_sign_document_templates(text)`
5. `get_sign_request_by_token(text)`
6. `upsert_lead_from_form(uuid,text,jsonb,jsonb,boolean,text,text,uuid)`

Routine metadata for all 366 functions was enumerated. Definitions were pattern-inspected for
privilege, dynamic SQL, fixed `search_path` and common caller checks; ten high-risk/public
definitions were read fully. Only 16 privileged functions mentioned `auth.uid()` directly and 26
matched common authorization-helper terms. This is a triage signal, not proof that every other
routine is exploitable: many are read-only, trigger-only or may enforce narrower rules by other
means. A routine-by-routine authorization contract review remains outstanding.

### `exec_read_sql` confirmed boundary

`public.exec_read_sql(text)` is owned by `postgres`, runs as `SECURITY DEFINER`, accepts arbitrary
text beginning with `SELECT` or `WITH`, interpolates it into dynamic SQL and returns aggregated
JSON. It rejects multiple statements, sets `transaction_read_only=on` and applies a 15-second
timeout. Those controls prevent writes and bound execution time; they do not restrict which
schemas/tables/columns can be selected. The function contains no caller/employee/role check.

Live grants deny `anon` but allow `authenticated` and `service_role`. Therefore any authenticated
Supabase user can call `/rest/v1/rpc/exec_read_sql` and read as the `postgres` function owner,
bypassing ordinary RLS. The original migration documents and grants service-role-only access at
`supabase/migrations/20260627_exec_read_sql.sql:1-20` and
`supabase/migrations/20260627_exec_read_sql.sql:60-64`; the later closure migration explicitly
grants authenticated execution at
`supabase/migrations/20260708_dbf_p3_anon_rpc_revoke.sql:158-161`.

### Public form RPC bypasses Worker controls

The public `form-submit` Worker performs honeypot/minimum-time checks, a per-IP limit, optional
Turnstile and server-side schema validation before calling `upsert_lead_from_form` at
`functions/api/form-submit.js:384-445`. The live RPC itself is executable by `PUBLIC`/`anon` and
does not repeat those gates. Its checked-in definition accepts caller-supplied form ID, submission
token, data, consent boolean, IP, user agent and organization ID; it can create/update contacts and
leads. When `p_consent=true`, it marks a contact opted in and records the caller-supplied IP as TCPA
evidence at `supabase/migrations/20260702_crm_phase10_form_rpcs.sql:304-315`. The grant is at
`supabase/migrations/20260702_crm_phase10_form_rpcs.sql:327-330`.

An attacker still needs a valid published form UUID; whether that UUID is exposed by a deployed
form or third-party integration was not tested. The finding is a bypassable enforcement-boundary
design, not evidence that forged consent has occurred.

### Public signing reads

`get_sign_request_by_token(text)` returns signer identity plus job address, claim and policy fields
for a matching UUID token. Its database predicate checks token equality but not status or
`expires_at`. The browser and `submit-esign` Worker reject expired requests after retrieval at
`src/pages/SignPage.jsx:191-206` and `functions/api/submit-esign.js:92-96`; a direct RPC call does
not. `get_sign_document_templates(text)` has the same token-only lookup pattern in
`supabase/migrations/20260708_dbf_p3_sign_document_templates_rpc.sql:35-50`. No token values or
request rows were inspected.

## Storage

| Bucket | Public | Object count | Aggregate bytes | File-size limit | MIME allowlist |
|---|---:|---:|---:|---:|---|
| `job-files` | yes | 72 | 57,472,887 | 50 MiB | none |
| `message-attachments` | no | 21 | 52,615,115 | 10 MiB | JPEG, PNG, HEIC, WebP, PDF, MP4, QuickTime |

`job-files` has two broad object SELECT policies (`anon_read_job_files` and `job_files_select`).
The Supabase advisor reports that this permits anonymous listing of all objects; public object URLs
do not require listing access. Authenticated users can insert/delete in that bucket without a
path/assignment predicate. `message-attachments` had no object policies and is reachable only
through privileged paths at capture time. Object paths and contents were not read.

## Migrations and live drift

The live ledger contained 375 migrations from `20260310114132 create_vendor_invoices` through
`20260722232222 crm_caller_name_follows_merge`. The audited `dev` checkout at `0a7c61c` contains
207 migration files, beginning on 2026-04-17, plus one staged migration. The difference partly
reflects missing early history in the checkout and naming/version conventions; counts alone do not
prove unapplied local migrations.

Four latest live migrations are absent from the audited `dev` tree but exist on the unmerged
`claude/upr-crm-dashboard-gap-e0e8ba` branch:

- `crm_denver_day_bucketing`
- `crm_sales_summary_total_vs_traced`
- `crm_dedup_repeat_caller_leads`
- `crm_caller_name_follows_merge`

Git history places the first two in `c10a8bb`, deduplication in `a5ef0e1` and caller-name follow-up
in `a7ee5f8`. This proves the shared live database was ahead of `dev` during the audit. It does not
prove the feature branch was incorrect or abandoned.

## Advisors and performance

The Supabase security advisor returned 513 notices:

| Notice | Level | Count |
|---|---|---:|
| Authenticated can execute `SECURITY DEFINER` function | warning | 342 |
| RLS policy always true | warning | 146 |
| RLS enabled with no policy | info | 15 |
| Anonymous can execute `SECURITY DEFINER` function | warning | 6 |
| Leaked-password protection disabled | warning | 1 |
| Extension installed in `public` | warning | 1 |
| Mutable function search path (`crm_call_is_answered`) | warning | 1 |
| Public bucket allows listing (`job-files`) | warning | 1 |

The performance advisor returned 214 notices:

| Notice | Level | Count |
|---|---|---:|
| Unindexed foreign key | info | 105 |
| Unused index | info | 46 |
| Multiple permissive policies | warning | 34 |
| Per-row Auth/RLS initialization plan | warning | 28 |
| Auth fixed connection count rather than percentage | info | 1 |

There were no invalid indexes, lock waits requiring a grant, or unvalidated constraints. Cache-hit
ratios were 100% for heap blocks and 99.99% for index blocks during the sampled stats lifetime.
Because the database was only about 50 MB and several tables had low row counts, “unused” indexes
must not be dropped solely from this point-in-time advisor result. The 105 missing FK-covering
indexes should be prioritized by delete/update frequency and measured query plans.

Relevant advisor guidance:

- [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Security-definer function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Always-true RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0024_permissive_rls_policy)
- [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## Scheduled work, Realtime and Edge Functions

Ten `pg_cron` jobs were active. Nine had run successfully with zero non-success statuses in the
30-day ledger; the newly added `upr_real_job_evidence_reconciler` had not run yet at capture time.
Retained `pg_net` responses contained 95 HTTP 2xx statuses and no 4xx/5xx or timeout; response
bodies were not read. Realtime published `public.conversations`, `public.messages` and
`public.notifications`.

Two live Edge Functions existed:

- `notify-test-push` version 2 requires JWT and returns HTTP 410; its source says the one-off
  function should be deleted in the dashboard when convenient.
- `sheets-proxy` version 2 has `verify_jwt=false`, wildcard CORS and forwards unauthenticated GET
  query strings and POST bodies to a fixed Google Apps Script URL. No equivalent source file was
  found in the audited checkout. The Google Apps Script behavior, data returned and write effects
  were not invoked, so downstream impact remains external evidence.

## Coverage and exclusions

The review fully enumerated live schemas, public tables, columns, constraints, indexes, public
policies, table/routine grants, public views, routine privilege metadata, extensions, buckets,
Storage object-policy metadata, Realtime publications, cron job metadata, migration ledger entries,
deployed Edge Function metadata and both Supabase advisor result sets.

It partially inspected routine bodies (all pattern-scanned; ten read fully), trigger bodies, table
semantics and operational statistics. It excluded business row contents, Storage paths/contents,
raw logs, provider payloads, secrets, Auth identities, test-account behavior, backups/PITR settings,
network restrictions, project API settings not exposed by the connector and external provider
consoles. The review therefore demonstrates broad live metadata coverage, not a penetration test,
legal-compliance certification or full semantic proof of every one of the 366 routines.
