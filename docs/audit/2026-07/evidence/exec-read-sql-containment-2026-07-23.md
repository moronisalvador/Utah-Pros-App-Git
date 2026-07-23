<!--
FILE: docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md

WHAT THIS DOES (plain language):
  Records the sanitized live apply and verification evidence for the exec_read_sql containment.

DEPENDS ON:
  Internal: supabase/migrations/20260723205127_exec_read_sql_containment.sql,
            supabase/tests/exec_read_sql_containment*
  Data:     reads → PostgreSQL catalog, migration ledger, harmless constant-query role checks
            writes → function ACL/comment and migration-ledger entry only

NOTES / GOTCHAS:
  - This is a dated snapshot of live state, not permanent project law.
  - No business rows, Auth identities, credentials, tokens, or raw logs were inspected.
-->

# `exec_read_sql` Containment — Live Apply Evidence

**Project:** `glsmljpabrwonfiltiqm`  
**Apply time:** 2026-07-23 22:17:07 UTC  
**Operator path:** owner-authorized Codex apply through the Supabase migration tool  
**Repository migration:** `supabase/migrations/20260723205127_exec_read_sql_containment.sql`  
**Reviewed source commit:** `5cf546b` (reachable from `origin/dev` and `origin/main` at apply time)  
**Live ledger entry:** `20260723221707 exec_read_sql_containment`

The Supabase tool assigned the live ledger timestamp when it applied the reviewed SQL. The different
timestamp in the repository filename does not indicate different SQL.

## Scope and preflight

Only the grant-only containment migration was applied. No application deploy, provider change,
business-data mutation, Encircle migration, or messaging migration was performed in this apply
window.

Immediately before apply, read-only catalog checks confirmed:

| Contract | Pre-apply result |
|---|---|
| Overload count | exactly one |
| Signature | `public.exec_read_sql(p_query text) → jsonb` |
| Owner / mode | `postgres`; `SECURITY DEFINER` |
| Function configuration | `search_path=public` |
| Definition MD5 | `3ba5b4885b4147206e4791124f23bddc` |
| Effective execution | `anon=false`; `authenticated=true`; `service_role=true` |
| Original live ledger entry | `20260627030923 exec_read_sql` |

These values matched the reviewed stop conditions in
`docs/audit/2026-07/exec-read-sql-containment.md`.

## Apply result

The migration completed successfully. It:

- revoked `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`;
- preserved explicit `service_role` execution;
- preserved the function signature, owner, execution mode, search path, body, and result type; and
- updated the function comment to document the service-only contract.

## Post-apply verification

The committed post-apply catalog verification passed every assertion:

- one exact overload remains;
- owner, `SECURITY DEFINER`, `search_path`, result type, and body fingerprint are unchanged;
- `anon` and `authenticated` cannot execute;
- `service_role` can execute; and
- the service-only comment is present.

Role checks used only the harmless constant query `select 1 as ok`:

| Role | Result |
|---|---|
| `anon` | denied with PostgreSQL `42501 permission denied for function exec_read_sql` |
| `authenticated` | denied with PostgreSQL `42501 permission denied for function exec_read_sql` |
| `service_role` | succeeded and returned `[{"ok":1}]` |

The Supabase security advisor was re-run after apply. It returned 514 pre-existing/current notices
(18 INFO, 496 WARN), but **no notice referenced `exec_read_sql`**. This confirms the targeted
authenticated-executable warning cleared; it does not clear or reclassify unrelated database
security findings.

## Residual boundaries

- The free-form function remains intentionally retained for the private `upr-mcp` service-role
  consumer. Browser roles must never regain execution.
- Raw database/API audit logs were not inspected, so prior non-service invocation remains unknown.
- The generated RPC inventory remains a stale historical snapshot until the full live-catalog
  documentation generator is rerun; it must not be hand-edited.
- The broader anonymous-policy and authenticated privileged-function findings remain open.

No rollback was performed. Restoring the prior authenticated grant would reopen Critical finding
DB-003 and requires a new, explicit owner emergency decision.
