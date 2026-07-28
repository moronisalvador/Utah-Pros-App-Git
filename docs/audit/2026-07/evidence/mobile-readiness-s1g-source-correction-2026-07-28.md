<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1g-source-correction-2026-07-28.md

WHAT THIS DOES (plain language):
  Records why the first S1g database change was stopped before production, what was corrected,
  and which checks the corrected files actually passed.

DEPENDS ON:
  Internal: corrected S1g migration, rollback, preflight, post-apply, isolated test, and QA contract
  Data:     reads → repository files and value-free production catalog metadata
            writes → documentation only

NOTES / GOTCHAS:
  - No employee, notification, receipt, customer, message, configuration, or secret value was read.
  - The corrected migration was not applied while producing this evidence.
  - Isolated SQL execution is not proof of live Supabase Auth, PostgREST, or Realtime behavior.
-->

# Mobile readiness S1g source correction

**Captured:** 2026-07-28
**Branch:** `codex/mobile-readiness-native-usability`
**Source head before correction:** `d898091fa74cfff26caa9c6e132e595a916e6053`
**Fetched origin/dev:** `c9060b299a5a0430ad4814267322de51a2d9e07f`
**Migration:** `20260726260000_notification_read_recipient_boundary.sql` — not applied

## Result

Final qualification stopped the first S1g source before any shared-production write. Four
consequential defects were found:

- the employee dependency expected four authenticated columns while the live containment contract
  grants five, including `is_external`;
- the new forced-RLS receipt table had no explicit policy;
- the forward migration dropped the live sentinel-delete policy object instead of retaining it
  fail closed; and
- the rollback expected a pre-containment ledger/policy state and would have reopened the
  cross-recipient notification BOLA.

The corrected forward migration now pins the exact five-column containment contract, adds an
explicit deny-all receipt policy, and alters the sentinel policy to `USING (false)`. The corrected
rollback requires a separate receipt-loss guard, verifies the exact forward receipt shape, preserves
identity containment and recipient-scoped policies, disables authenticated RPC/table access, and
retains only signed service-role RPC compatibility. It does not restore anonymous access or the
cross-recipient BOLA.

## Value-free live qualification

Read-only catalog and migration-ledger capture confirmed:

- `mobile_employee_identity_containment` is recorded as `20260728002105`;
- S1g is absent from the migration ledger and `notification_reads` is absent;
- the self-only employee policy is `auth_user_id = auth.uid()`;
- authenticated employee column grants are exactly
  `auth_user_id,id,is_active,is_external,role`, with no table-level employee SELECT;
- the notification column shape is `0170db1f6199da7f23355b35ba343954`;
- the notification ACL shape is `f7cafbf463643b5debc08b30a5cba10e`;
- `notifications_select` and `notifications_delete_testrows` retain predicates
  `b326b5062b2f0e69046810717534cb09` and `b60edd5d780221512206b2510a93c3db`;
- the table remains in `supabase_realtime`; and
- all four deployed RPC body/definition/ACL fingerprints match the corrected preflight.

Only catalog metadata was queried. No employee or notification row was read.

## Exact corrected artifacts

| Artifact | SHA-256 |
|---|---|
| Migration | `fe6ac1da1e53aa998acf5580786f279f145e606c64d2a3e33a177cfed5b0ffce` |
| Preflight | `6bf8850f46d0583daabe6a800dde24910db349f040e84961c5fb60c1c6da208a` |
| Post-apply | `5cd23e7e12d86239357231d7f45182e29dd1ca210e37ce4dde140a6b417cb684` |
| Isolated behavior | `12f221d0dd8d6f50b1b4cf70ccb0153f7468716fb2ee8d1acee40aa9abbcaada` |
| Rollback | `df746aff7551faf1a2ad0b9e4242511584e18c9a718efff547b3672027d99a24` |

These hashes identify the corrected working-tree files at the time of this evidence. The release
commit must recompute and match them before authorization or apply.

## Verification actually performed

A disposable, synthetic PGlite database ran the exact checked-in files in this order:

1. standalone value-free preflight;
2. forward migration and embedded postcondition;
3. standalone post-apply;
4. isolated authenticated/service-role behavior matrix, rolled back;
5. paired guarded rollback and embedded postcondition; and
6. rollback assertions.

All six stages passed. The rollback proof specifically confirmed receipt removal, preserved employee
containment, authenticated RPC/table denial, and service-role RPC compatibility. The disposable
receipt metadata matched the rollback guards:

- columns `b288c11dbb35d86f1f6c07924b27afd4`;
- constraints `299cbf9155468ef388d57af37dcfd045`;
- indexes `f903c472344be23c98ea6a046dffe1dc`; and
- ACL `5ae62afd8335deffffb81c9aa98f62be`.

The same exact sequence then passed against a disposable official Supabase CLI 2.110.0 local stack
running Postgres 17:

- standalone preflight: passed;
- forward migration and embedded postcondition: passed;
- standalone post-apply: passed;
- isolated multi-identity behavior transaction: passed and rolled back;
- guarded paired rollback and embedded postcondition: passed; and
- final value-free assertions returned `true` for receipt removal, containment preservation,
  authenticated RPC denial, authenticated table denial, and service-role RPC compatibility.

The local Supabase containers were stopped without backup after verification, and a final container
list confirmed none remained running. The focused credential-free QA contract passed 6/6, and
`git diff --check` passed. Independent final migration-safety, least-privilege, and source-contract
reviews all returned PASS with no remaining source finding.

## Remaining gates

The repository still does not contain a persistent current-live-compatible Supabase configuration.
The disposable official local stack proves PostgreSQL catalog, role, function, transaction, and
guarded rollback behavior. It does not prove the shared project's Auth, PostgREST, or Realtime
sessions/sockets.

Before a shared-production apply:

1. commit the exact corrected artifacts and recompute the hashes;
2. obtain fresh owner authorization naming that migration checksum;
3. refetch `origin/dev` and repeat the value-free ledger/catalog preflight;
4. apply only S1g through the single-migration mechanism; and
5. run the post-apply catalog check, advisors, provenance capture, and the authorized multi-identity
   RPC/PostgREST/Realtime matrix.

The earlier authorization named a different migration checksum and is not reusable. No migration,
deploy, provider call, message, money movement, signing, or distribution occurred during this
correction.
