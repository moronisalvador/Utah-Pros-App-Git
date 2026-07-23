<!--
FILE: docs/audit/2026-07/exec-read-sql-containment.md

WHAT THIS DOES (plain language):
  Records the evidence, migration plan, tests, rollback, and owner apply steps for removing browser
  access to exec_read_sql without breaking the private owner tool.

DEPENDS ON:
  Internal: supabase/migrations/20260723205127_exec_read_sql_containment.sql,
            supabase/tests/exec_read_sql_containment*
  Data:     reads → sanitized live PostgreSQL catalog and migration metadata
            writes → function ACL/comment and migration-ledger entry during the authorized apply

NOTES / GOTCHAS:
  - The original pre-apply evidence remains below; the dated apply evidence records the live result.
  - No business rows, Auth identities, credentials, tokens, or raw logs were inspected.
-->

# `exec_read_sql` Containment Record

**Status:** **applied and verified** on 2026-07-23

**Repository baseline:** `origin/dev` `0a06a21245633cb00ec6b3ad119ceefeede3f3ac`

**Reviewed source commit:** `5cf546b` (reachable from `origin/dev` and `origin/main` at apply time)

**Live capture:** 2026-07-23 20:52 UTC; read-only Supabase catalog queries

**Project:** `glsmljpabrwonfiltiqm`

**Live apply:** 2026-07-23 22:17:07 UTC; ledger entry
`20260723221707 exec_read_sql_containment`

**Apply evidence:**
`docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`

## Decision

Keep `public.exec_read_sql(text)` unchanged and executable by `service_role`, because the private
`upr-mcp` worker's `upr_sql` tool is a verified runtime caller and sends
`SUPABASE_SERVICE_ROLE_KEY`. Revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`.

This is the least-disruptive containment:

- no `DROP`, signature change, body replacement, return-shape change, deployment, or data mutation;
- no browser/admin caller needs replacement;
- the supported owner automation path keeps its current endpoint and response contract;
- any future browser feature needing aggregate data must receive an operation-specific RPC with a
  fixed query, server-side employee/role checks, fixed return shape, and explicit least-privilege
  grants. It must not receive another caller-supplied SQL tunnel.

The revoke is a deliberate non-additive emergency exception. It removes the Critical DB-003
exposure, not a supported browser behavior. Rollback is the exact prior live grant:

```sql
GRANT EXECUTE ON FUNCTION public.exec_read_sql(text) TO authenticated;
```

`PUBLIC` and `anon` were already denied during preflight and are not part of rollback.

## Exact live object and provenance

The catalog contained exactly one overload:

| Attribute | Live value |
|---|---|
| Signature | `public.exec_read_sql(p_query text) → jsonb` |
| Owner | `postgres` |
| Owner attributes | not superuser; `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, replication |
| Execution mode | `SECURITY DEFINER`, volatile |
| Function config | `search_path=public` |
| Definition MD5 | `3ba5b4885b4147206e4791124f23bddc` |
| Comment | owner-locked `upr_sql`; SELECT/WITH; read-only transaction; 15s; service-role-only |
| Explicit ACL | `postgres`, `authenticated`, `service_role` have EXECUTE |
| Effective roles | `anon=false`; `authenticated=true`; `service_role=true`; `postgres=true`; `supabase_admin=true`; `authenticator=false` |

The body trims one trailing semicolon, requires text to begin with `SELECT` or `WITH`, rejects any
remaining semicolon, sets `transaction_read_only=on` and a 15-second statement timeout, then embeds
the caller text as a subquery and aggregates its rows to JSON.

Live migration history found the original ledger entry:

| Version | Name | Statement MD5 |
|---|---|---|
| `20260627030923` | `exec_read_sql` | `2bec60de919d07b24b64de2821dda059` |

Repository provenance:

- `supabase/migrations/20260627_exec_read_sql.sql` creates the current signature/body and documents
  the intended service-role-only grant.
- The checked-in `supabase/migrations/20260708_dbf_p3_anon_rpc_revoke.sql:160-161` grants
  `authenticated, service_role`, contradicting the original contract. However, the live ledger entry
  `20260708221105 dbf_p3_anon_rpc_revoke` has statement MD5
  `54fa8972749c33ce431dc288fc5efcf3` and does **not** mention `exec_read_sql`. The checked-in file is
  therefore evidence of repository intent/history, not proof that this exact statement created the
  live ACL.
- The same generated closure file contains a rollback grant to `anon` at line 744, but live `anon`
  execution is currently false. That rollback block is historical SQL, not current live ACL.

The exact provenance of the live `authenticated` grant is unresolved: it may have been a manual
grant, a differently applied/generated closure statement, or migration drift not retained in the
ledger body. Raw database/API audit logs were not accessed, so this package does not attribute an
operator or event. Containment does not depend on that attribution because the live ACL is confirmed
directly and the revoke is explicit.

## Reach and impact

Because the function runs as `postgres` with `BYPASSRLS`, a caller can select every non-system
relation sampled that the owner can select: **185 relations / 2,186 columns** across `auth`, `cron`,
`extensions`, `net`, `public`, `realtime`, `storage`, `supabase_migrations`, and `vault`.

Verified sensitive examples include `auth.users`, `auth.sessions`, public customer/employee/billing
tables, `integration_credentials`, `storage.objects`, `vault.secrets`, and
`vault.decrypted_secrets`. No row contents were read.

The grammar guard plus `transaction_read_only=on` blocks ordinary DML, DDL, and writable CTEs.
That does not make the function an authorization boundary: it still bypasses RLS for reads, exposes
catalog/secret-bearing relations, and can invoke functions from a `SELECT`. PostgreSQL read-only
transactions block ordinary database writes, but SQL parsing is not a complete defense against
privileged or external-side-effect functions. Removing browser execution is therefore required.

## Caller inventory

| Surface | Result |
|---|---|
| Browser (`src/`) | no runtime caller |
| Cloudflare Pages Workers (`functions/`) | no runtime caller |
| Owner MCP worker | one runtime caller: `upr-mcp/src/tools.js` `upr_sql` |
| MCP database client | `upr-mcp/src/supabase.js` sends the service-role key |
| Owner gate | OAuth single-email allowlist in `upr-mcp/src/auth.js` and per-call check in `upr-mcp/src/mcp.js`/`audit.js` |
| Tests before this package | no direct containment test |
| Automations | no repository-scheduled or hard-coded invocation; external Codex/connector automation state was not inspected; the owner MCP tool is available for manual/orchestrated reads |
| Documentation | `RECONCILIATION-HANDOFF.md`, `UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md`, `upr-mcp/README.md`, canonical/audit records |
| Generated inventories | `upr-mcp/src/codeIndex.js`, `db/baseline/live-schema-snapshot.json`, `docs/generated/rpc-inventory.md`; names only, not callers |

The repository search covered the function name, `/rpc/exec_read_sql`, `.rpc(...)`, and the tool name
`upr_sql`. The committed test repeats the runtime-caller scan over `src/` and `functions/`.

## Tests and verification

- `supabase/tests/exec_read_sql_containment.test.js`
  - exact revoke/grant contract;
  - no function drop/replace/signature change;
  - exact rollback;
  - no browser or Pages Worker runtime caller;
  - mocked owner-tool call proves the unchanged endpoint, request body, response, and service-role
    headers.
- `supabase/tests/exec_read_sql_containment_preflight.sql`
  - exact overload, signature, owner, mode, search path, ACL, comment, definition fingerprint, role
    privileges, and ledger provenance.
- `supabase/tests/exec_read_sql_containment_post_apply.sql`
  - catalog denial for `anon`/`authenticated`, preservation for `service_role`, and harmless constant
    REST/MCP role checks.

Local verification on 2026-07-23:

- targeted containment suite: 1 file / 6 tests passed;
- full Vitest suite: 106 files passed, 62 skipped; 1,315 tests passed, 245 skipped;
- production Vite build: passed (656 modules);
- changed-file ESLint (`exec_read_sql_containment.test.js`): passed;
- `git diff --check`: passed;
- independent `migration-safety-checker`: passed after exact/null-safe fingerprint and rollback fixes;
- independent `anon-grant-auditor`: passed across PUBLIC/anon grants, secret reach, writer gates,
  owner-tool compatibility, default grants/comments, and post-apply verification;
- independent adversarial owner-tool/bypass review: passed after rollback-trigger, provenance,
  fingerprint, overload, and automation-scope corrections.

## Apply-window instructions

These instructions were completed successfully on 2026-07-23. The exact preflight, apply result,
role checks, advisor result, and live ledger version are preserved in the dated apply evidence
linked above.

1. Confirm the reviewed commit is reachable from the designated release branch and the Encircle
   migration remains unapplied/dark-gated.
2. During a low-traffic window, run the read-only preflight. Stop if overload count, signature,
   owner, `SECURITY DEFINER`, `search_path`, ACL, or definition MD5 differs from this record.
3. Apply only `20260723205127_exec_read_sql_containment.sql`. No application deploy is required.
4. Run the post-apply catalog query.
5. With short-lived tokens, call the RPC using the harmless `select 1 as ok` query as `anon` and
   `authenticated`; both must return permission denied before the body runs.
6. Call owner MCP `upr_sql` with `select 1 as ok`; it must return `[{"ok":1}]`.
7. Re-run the Supabase security advisor and confirm the `exec_read_sql` authenticated-executable
   warning is gone. Do not treat unrelated existing advisor warnings as introduced regressions.
8. Record the applied migration version, UTC time, operator, results, and live ACL fingerprint in a
   dated addendum. If the owner MCP check fails, **do not** restore browser access: stop and inspect the
   deployed worker's role/binding without retrieving or exposing its credential. The rollback above
   exists only as the exact reversal of the security change and requires a separate, explicit owner
   emergency decision with immediate acknowledgement that it reopens Critical DB-003.

## Adversarial challenge and residual risk

**Accidental owner-tool breakage:** contained. The caller uses `service_role`, which the migration
explicitly preserves; the signature/body/return shape are untouched; the mocked compatibility test
proves its endpoint and headers. Remaining external gate: only the deployed owner MCP smoke test can
prove its current Cloudflare binding and OAuth deployment.

**Alternate `SECURITY DEFINER` bypasses:** the live pattern scan found two other authenticated
privileged functions containing dynamic `EXECUTE`:

- `get_table_stats(p_table text)` is called by browser Dev Tools. It quotes the supplied value as one
  identifier and exposes only `COUNT(*)` and `MAX(created_at)`, so it is not another free-form row
  tunnel, but it can disclose metadata for arbitrary public tables. It needs a separate
  operation-specific allowlist/role review.
- `set_automation_setting(...)` dynamically selects one of five whitelisted columns but lacks an
  employee/role assertion in its live body. It is a privileged write-authorization finding, not an
  alternate SQL-injection tunnel. It belongs to the CRM automation owner and is out of this narrow
  containment scope.

No changes to either object are included here. Their presence means this package closes DB-003 but
does not certify all 345 live `SECURITY DEFINER` functions.

## Post-apply canonical reconciliation

The apply reconciliation updates the current canonical and control documents while preserving the
original dated findings and the 2026-07-22 live snapshot as historical evidence:

- `docs/auth-and-authorization.md:80-92` — change the live authenticated exposure to remediated and
  retain the standing prohibition.
- `docs/database-schema.md:60-65` — move `exec_read_sql` from live exception to contained history.
- `docs/audit/2026-07/security-findings.md:61-74` — mark DB-003 contained with applied migration/live
  verification; preserve the original finding.
- `docs/audit/2026-07/remediation-backlog.md:10` — record completion only after apply verification.
- `docs/audit/2026-07/evidence/live-supabase.md:100-114` — do not rewrite the dated snapshot; add a
  dated addendum.
- `docs/generated/rpc-inventory.md` and baseline artifacts — still require a full post-apply
  live-catalog regeneration; they were not hand-edited.
- `CLAUDE.md`/`AGENTS.md` — retain “never expose free-form SQL”; update only wording that says the
  authenticated grant is still live.

Encircle-owned migration/test/roadmap files are untouched. Its migration remains unapplied and its
feature remains dark-gated.
