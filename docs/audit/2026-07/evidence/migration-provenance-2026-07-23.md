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

## Post-F2 live-ledger addendum — 2026-07-24 UTC

A separately authorized messaging phase applied one later reviewed migration after the original F2
capture. The 2026-07-24 00:57:59 UTC read-only refresh therefore records an eighth mapped row:

| Live version | Name | Release source | Reviewed origin |
|---|---|---|---|
| `20260724003818` | `message_notification_outbox_scheduler` | `20260724001500_message_notification_outbox_scheduler.sql` | `625ccfd` |

The Supabase apply tool assigned the later live version; it did not rename or rewrite the checked-in
source. The live ledger statement is the reviewed file byte-for-byte after removing only its final
newline: both are 4,548 bytes with MD5 `c6193971d4a27418f5f08c10cbf655a9`. `HEAD` still equals the
reviewed `625ccfd` migration blob.

The refresh also rechecked all 11 selected function fingerprints and the selected
`messages_authenticated_select` policy; every value remains unchanged from the original F2 table.
The scheduler cron is active at `*/5 * * * *`, its statement trigger exists, and the scheduler
functions remain outside browser execution. This addendum records a later external live mutation;
it does not revise the historical fact that F2 itself performed no live write.

`npm run validate:provenance` passed at `3818b22` with eight ledger mappings, 11 functions, one
policy and the expected comment-only warning. `npm run test:provenance` remained green at 8/8.

## Prior-consent live-ledger addendum — 2026-07-24 UTC

The 2026-07-24 04:27:21 UTC read-only refresh records the ninth mapped row:

| Live version | Name | Release source | Reviewed origin |
|---|---|---|---|
| `20260724035913` | `attest_prior_sms_consent` | `20260724014423_attest_prior_sms_consent.sql` | `e71e759` |

The refresh adds both consent RPCs to the function gate with their actual service-only invoker
contract: empty `search_path`, no `PUBLIC`/`anon`/`authenticated` execution, and only
`service_role` execution. It also fingerprints all three service-role policies on
`service_sms_consents` and `service_sms_consent_attestations`. No live mutation occurred during
this refresh. `npm run validate:provenance -- --worktree` passed with nine ledger mappings,
13 functions, four policies and the existing comment-only warning.

## Production-release reconciliation addendum — 2026-07-24 UTC

PR #512 merged to production as merge commit `bd420154837159b26290d17d8b89c26b606e176b`.
A concurrent, already-reviewed consent-migration parse correction then landed on `dev` as
`9dc5681577a7af0d94655e5d0f202aaed1806174`. A fresh read-only catalog capture at
2026-07-24 13:03:12 UTC found two additional applied ledger rows:

| Live version | Name | Release source | Reviewed origin |
|---|---|---|---|
| `20260724002500` | `callrail_event_recovery_scheduler` | `20260724002500_callrail_event_recovery_scheduler.sql` | `ec2520e` |
| `20260724043000` | `harden_service_sms_consent` | `20260724043000_harden_service_sms_consent.sql` | `9dc5681` |

The consent hardening migration constructs exact replacement bodies dynamically after validating
the prior definitions, so its checked-in file does not contain literal function bodies that the
normal source extractor can fingerprint. The gate now handles this narrow case by requiring both:

- the release migration blob must exactly equal the reviewed-origin blob; and
- each dynamically replaced function must match an explicit reviewed raw and semantic live
  fingerprint.

The refreshed evidence pins both hardened consent RPCs to their service-only invoker contract and
records that the other 11 selected function fingerprints and four selected policy fingerprints
remain unchanged. No Supabase mutation occurred during this reconciliation or recapture.

Verification after reconciliation:

- `npm run validate:provenance -- --worktree` — PASS; 11 ledger mappings, 13 functions and four
  policies, with only the existing documented comment-only warning;
- `npm run test:provenance` — PASS, 12/12;
- migration contract tests — PASS, 8/8;
- `npm run build` — PASS;
- `npm test` — PASS, 1,741/1,741 across unit, Worker and isolated-QA lanes;
- targeted changed-file ESLint and `git diff --check` — PASS;
- full-tree `npm run lint` — exceeded the 120-second close-out window without producing a result.
