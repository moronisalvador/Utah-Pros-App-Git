<!--
FILE: docs/mobile/s1h-database-apply-runbook.md

WHAT THIS DOES (plain language):
  Gives database and release owners a checksum-pinned, stop/go procedure for the S1h personal
  authorization boundary without combining it with another database or release action.

DEPENDS ON:
  Internal: additive and containment employee-identity migrations,
            page-access provenance reconciliation, S1h migration/rollback/catalog/isolated tests,
            migration provenance manifest, compatible client release commit
  External: shared Supabase owner window and approved synthetic test identities
  Data:     reads → value-free catalog metadata and approved synthetic rows only
            writes → one explicitly approved migration and approved synthetic rows only

NOTES / GOTCHAS:
  - This document does not authorize an apply, deployment, provider call, signing, or device test.
  - Never use `supabase db push`; it can sweep unrelated pending migrations.
  - Source filenames and assigned live migration versions can differ. Provenance, not filename
    guessing, binds reviewed source to the live ledger.
-->

# Mobile S1h database apply runbook

**Boundary:** authenticated personal page access, notification preferences, Web Push
subscriptions, and native device-token ownership

**Reviewed source sequence:**

1. `20260726180000_mobile_employee_identity_authority.sql`
2. compatible web/PWA/native callers deployed and old cached/native bundles retired or explicitly
   accepted
3. `20260726182000_mobile_employee_identity_containment.sql`
4. `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql`
5. `20260727022920_mobile_personal_ownership_boundary.sql`

**Current state:** the first three database dependencies are live-verified and mapped in
`scripts/migration-provenance-manifest.json`; only the final personal-ownership boundary is absent
from the live ledger. The final boundary remains source-hardened, not exact-source
database-behavior-verified, and not `ready_for_apply`. A temporary non-retained PGlite experiment
modeled the S1h lifecycle and passed a rollback-only behavior matrix, but it did not execute the
exact checked-in migration, preflight, post-apply, isolated behavior, and guarded rollback files;
neither its harness nor a complete log was retained.

Live dependency mappings — do not replay them:

- `20260727154506 mobile_employee_identity_authority`
- `20260727233845 upsert_employee_page_access_provenance_reconciliation`
- `20260728002105 mobile_employee_identity_containment`

The prior permission-write dependency is live as
`20260727012825 permission_write_gates`. Repository governance maps that live ledger entry to
reviewed source `supabase/migrations/20260726220000_permission_write_gates.sql`; do not rename,
replay, or reorder it.

S1d, S1e, S1f, S1g, S1h, QBO telemetry/RLS, private media, deployment, providers, Apple signing,
and device qualification remain separate decisions and windows.

## Reviewed artifact fingerprints

These hashes identify the current source set. A content change requires new hashes and another
review. A matching hash is not apply authorization.

| Artifact | SHA-256 |
|---|---|
| Additive identity migration | `4549d7f236b027ed3679b546e1a51aff76243df54617cfea5d41b070ac1ceb9b` |
| Additive identity rollback | `53bba287800fbdff89bc0e3e2f879a1b89f154732fdf6df18544e736a0b653a4` |
| Identity containment migration | `b0687286c5373a2c085637c76cbab08dc71993e7c37353151068c635e4e6eb46` |
| Identity containment rollback | `9d82a56277ca4f739c358546996c2e19bb22f9251bda97ff2a5c815b6a427c0f` |
| Identity isolated wrapper | `0783a2cd73803c6d865ad243f04881d20f3bc885dbef5bfa0f99dc39294b45a4` |
| Identity isolated behavior | `e633267e77e2de2ad46fee8928439f32076fa367e01392ffe4eba31a991878bd` |
| Page-access provenance migration | `f98a7477d0c42227e6499d181e4d4e88446beb723ef2527563b37af0fa8e5c8b` |
| Page-access provenance rollback | `cbab6b7729e9d99a63d0a6fda4705996af1990c8d5581f339c3d05677576623f` |
| Personal ownership migration | `eee195a3472bb473fe19438b01c761fa035c7dfc59fae7a5b4a7bcb34528e20f` |
| Personal ownership catalog preflight | `28624edafbb7ac4bd1717550fb608a9e3a6f101fdbb34667afe65cc43c07ca6c` |
| Personal ownership catalog post-apply | `6543fb6392349cd582561e84052031d7873c9da574006651270acad793571a8f` |
| Personal ownership isolated wrapper | `c5e0f6ea4d8a08aac3f54ec0d18064bd3b4324231a3bfee9a07b5ef50d1ad3db` |
| Personal ownership isolated behavior | `48cc6fd35961ade710e031169ad2becf544de4f96105445b890b6d449eb8d1aa` |
| Personal ownership unsafe rollback | `860fcf0d74c8bdce5b63cad68537189a8045a113bba0398ffa601f7f2c3b4ba9` |

## Entry gate

Stop unless every item is recorded:

1. The exact reviewed commit is reachable from the designated release branch, the worktree is
   clean, current `origin/dev` has been merged without rewriting history, and active ownership
   leases permit the window.
2. Confirm the live dependency mappings above and the compatible client state. The owner-authorized
   2026-07-28 physical-device rebuild repaired the stale Capacitor client broken by containment;
   re-prove current callers rather than treating that one device as global old-client retirement.
3. The live ledger still contains `20260727012825 permission_write_gates`, and its provenance,
   helper bodies, grants, policies, and apply evidence match the reviewed dependency.
4. The identity authority, identity containment, and page-access provenance reconciliation remain
   verified in their own prior windows. Every assigned live version and current source hash is
   recorded in `scripts/migration-provenance-manifest.json`.
5. A fresh value-free catalog capture matches S1h preflight assumptions for the nine RPCs, four
   target tables, employee authority boundary, ACLs, RLS/policies, owners, overloads, triggers,
   publications, views, and direct callers.
6. `supabase/tests/mobile_personal_ownership_boundary_preflight.sql` succeeds through the
   owner-controlled read-only SQL channel.
7. The exact checked-in identity/S1h forward, post-apply, isolated, and guarded rollback sequences
   have executed successfully on governed isolated Supabase/PostgreSQL targets.
8. Database owner, release owner, observer, rollback/forward-fix owner, low-traffic window,
   incident location, and recovery plan are named.
9. Synthetic Auth/employee fixtures are approved for two active internal employees, inactive,
   external, unmapped, admin, and project-manager cases. No customer row or production provider is
   used.

Any mismatch is a stop. Do not treat a migration-history row alone as catalog proof.

## Isolated qualification

On a disposable local clone only, set the independent server sentinel
`upr.isolated_test_database=on` and run the governed local database runner. The wrapper also sets
`UPR_ISOLATED_DB=1`; both guards must be present.

The combined identity and S1h matrix must prove:

- active employee A and B can use only their own personal selectors and mutations;
- inactive, external, unmapped, and anonymous actors are denied;
- admin receives only the existing foreign page-access exception;
- project managers and admins cannot read raw native device tokens;
- browser callers cannot insert, bind, promote, reactivate, internalize, or delete employee
  authority rows;
- a browser caller cannot claim or delete another employee's Web Push endpoint or native token;
- same-owner endpoint/token refresh succeeds atomically;
- service-role RPC/direct-read/prune compatibility remains intact without sending a notification;
- all four personal tables reject direct browser reads/writes; and
- the transaction ends in `ROLLBACK`.

If exact SQL execution is unavailable, the boundary remains unverified and cannot advance to an
apply decision.

## Apply

After a separate owner authorization, submit only the exact reviewed S1h source through the
Supabase MCP `apply_migration` operation. Do not run a directory sweep, `supabase db push`,
`--linked` test command, implicit deployment migration, or any other pending migration in the
same window.

The apply system assigns the live ledger version. Immediately record:

- UTC start/end, operator, observer, project reference, release commit, and source SHA-256;
- the returned live version and migration name;
- complete apply output; and
- the exact source-to-live mapping in `scripts/migration-provenance-manifest.json`.

Do not invent a live version from the source filename. Do not edit provenance before a successful
apply.

## Immediate verification

Before any provider, deployment, signing, device, or customer traffic:

1. Confirm the new live ledger name is `mobile_personal_ownership_boundary` and its assigned
   version matches the recorded apply result.
2. Run `supabase/tests/mobile_personal_ownership_boundary_post_apply.sql`.
3. Confirm the private helper is owner-executable only.
4. Confirm all nine public RPCs are executable only by `authenticated`, `service_role`, and owner.
5. Confirm all four tables are forced-RLS, policy-free, and expose no browser table privilege.
6. Re-prove the employee authority policy, ACL, lack of column ACLs, and absence of a
   browser-executable authority mutator.
7. Run the approved synthetic Auth/PostgREST matrix and deterministic cleanup.
8. Recapture value-free catalog evidence and advisors, then record `verified`, `forward-fix`, or
   `rollback-authorized`.

Only complete applied proof can change S1h from source-only to live-verified.

## Rollback

Prefer a forward repair. The rollback deliberately restores anonymous employee-page enumeration,
broad browser table privileges, foreign personal selectors, inactive/external registration, raw
token visibility, and arbitrary token reassignment/deletion.

Rollback requires a separate owner decision accepting those regressions and:

```sql
SET upr.allow_unsafe_s1h_rollback = 'on';
```

Run only the checksum-matched rollback in a serialized incident window. Its preflight must match
the exact forward state. Capture complete output, postcondition results, ledger/provenance
reconciliation, and the forward-remediation owner.
