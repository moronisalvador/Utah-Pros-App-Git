<!--
FILE: docs/audit/2026-07/evidence/migration-provenance-2026-07-23.md

WHAT THIS DOES (plain language):
  Records the exact live, catalog, Git, test, and independent-review evidence used to close
  Foundation F2 migration provenance reconciliation.

DEPENDS ON:
  Internal: scripts/check-migration-provenance.mjs,
            scripts/migration-provenance-manifest.json,
            migration-provenance-2026-07-23.json
  Data:     reads → Supabase migration ledger, pg_proc, pg_policies, and Git objects
            writes → documentation only

NOTES / GOTCHAS:
  - F2 did not apply SQL or mutate Supabase.
  - The JSON capture is release-scoped and expires after six hours for gate purposes.
-->

# Foundation F2 Migration Provenance Evidence — 2026-07-23

- **Project:** `glsmljpabrwonfiltiqm`
- **Capture:** 2026-07-23 22:58:15 UTC; read-only migration ledger, `pg_proc`, and `pg_policies`
- **Capture base:** `367b4650b5662471bbd627a2c74a343d60009f33`
- **Reconciled release base:** `0723833` from current `origin/dev`
- **F2 commits after rebase:** `6261601`, `047ac50`, `2cef07b`, `8c3fc05`
- **Live mutation:** none

## Ledger and Git reconciliation

The live ledger had exactly seven entries at or above the F2 floor:

| Live version | Name | Release source |
|---|---|---|
| `20260722222426` | `crm_denver_day_bucketing` | `20260722_crm_denver_day_bucketing.sql` |
| `20260722222438` | `crm_sales_summary_total_vs_traced` | `20260722_crm_sales_summary_total_vs_traced.sql` |
| `20260722225158` | `crm_dedup_repeat_caller_leads` | `20260722_crm_dedup_repeat_caller_leads.sql` |
| `20260722232222` | `crm_caller_name_follows_merge` | `20260722_crm_caller_name_follows_merge.sql` |
| `20260723215926` | `messaging_transport_foundation` | `20260723215926_messaging_transport_foundation.sql` |
| `20260723220207` | `messaging_transport_foundation_indexes` | `20260723220207_messaging_transport_foundation_indexes.sql` |
| `20260723221707` | `exec_read_sql_containment` | `20260723205127_exec_read_sql_containment.sql` |

Only the four missing CRM records were restored. No historical commit was merged wholesale. Git blob
comparison proved:

- Denver and sales-summary files equal reviewed origin `c10a8bb`;
- dedup file equals reviewed origin `a5ef0e1`;
- caller-name file equals reviewed origin `a7ee5f8`.

The durable gate now loads every `reviewedOriginCommit:path` and requires byte equality with the
release-ref file. It also rejects an unmapped live ledger row, a non-ancestor capture base, or
evidence older than six hours.

## Catalog fingerprints

Eleven selected functions were compared by exact `prosrc` MD5, comment/whitespace-insensitive MD5,
language, security mode, volatility, `search_path`, and execute ACL:

- ten bodies match the reviewed source byte-for-byte;
- `set_lead_caller_name(uuid,text,boolean)` has raw live MD5
  `6c17dcd7774f2d0d92b06179dad5b727`; the restored source contains additional comments, while the
  normalized executable body matches. This is an explicit warning, not a reason to replace live SQL;
- all 11 deny `PUBLIC`/`anon`, allow `authenticated`/`service_role`, run as `SECURITY DEFINER`, and
  pin `search_path=public`.

The selected live policy `public.messages:messages_authenticated_select` matches command `SELECT`,
role `authenticated`, and predicate `messaging_can_access_conversations()`; it has no `WITH CHECK`.
The gate compares policy identity, command, roles, and normalized `USING`/`WITH CHECK` fingerprints.

The restored authenticated-executable privileged RPCs remain part of the broader authorization
classification backlog. They require forward, signature-preserving hardening with role-denial tests;
F2 does not rewrite historical/live bodies to hide that debt.

## Verification

- `npm run validate:provenance` — PASS after rebase at `8c3fc05`; seven ledger mappings, 11 functions,
  one policy, expected comment-only warning.
- `npm run test:provenance` — PASS, 8/8.
- Targeted ESLint for both provenance scripts — PASS.
- `npm run build` — PASS.
- `npm test` — full command remains red for the known primary-tree caveat: Vitest discovers duplicate
  `.claude/worktrees` and live database suites run through an anonymous harness now denied by current
  grants (`42501`/`PGRST202`). This is not an F2 gate failure; the isolated provenance suite passes.
- `npm run lint` — full-tree command exceeded the 120-second verification window while traversing
  repository/worktree debt; targeted changed-script lint passed.

Independent results:

- migration-safety re-review — PASS after origin, freshness, ancestry, and policy fixes;
- anonymous-perimeter audit — PASS; no new anonymous/public grant, secret exposure, or live apply;
- independent F2 acceptance re-review — PASS after gate fixes, with final release-ref reconciliation
  and canonical close-out completed afterward.

Raw sanitized machine evidence:
`docs/audit/2026-07/evidence/migration-provenance-2026-07-23.json`.
