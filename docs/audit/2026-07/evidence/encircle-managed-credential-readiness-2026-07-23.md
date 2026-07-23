<!--
FILE: docs/audit/2026-07/evidence/encircle-managed-credential-readiness-2026-07-23.md

WHAT THIS DOES (plain language):
  Captures the current Git and live-database evidence that the Encircle managed-credential rollout
  is repository-ready while its production migration and credential changes remain owner-gated.

DEPENDS ON:
  Internal: docs/encircle-managed-credentials-roadmap.md,
            supabase/migrations/20260723_encircle_managed_credentials.sql
  External: read-only Supabase catalog and migration-ledger queries

NOTES / GOTCHAS:
  - This is a dated evidence snapshot, not proof of later live state.
  - No token values were selected, changed, rotated, or revoked.
-->

# Encircle Managed-Credential Rollout Readiness — 2026-07-23

Captured at `2026-07-23T17:13:34-06:00`.

## Verdict

The repository portion of the Encircle managed-credential rollout is ready at reviewed commit
`4799feb` (the SQL hardening commit intended for `origin/dev`). The shared migration remains
unapplied, the rollout flag remains absent/OFF, and no credential or provider state changed during
this review.

Production rollout is still an owner/external verification tail. It requires the serialized
apply-window, short-lived admin/non-admin tokens, deployment checks, owner-only flag selection,
candidate activation, multi-runtime smoke, and separately approved legacy-key retirement described
in `docs/encircle-managed-credentials-roadmap.md`.

## Git provenance

- `git fetch origin dev` completed immediately before capture.
- Local `dev` and `origin/dev` were identical at the live-catalog capture base:
  `2f26c1dd42366a5bd70ceebfd4d44f5042993b3a`.
- Independent review then produced the least-privilege SQL hardening commit `4799feb`.
- Forward migration Git blob:
  `8b35d5c7f3f288eeddd33faa34a0961d328b9ed0`.
- The rollback was hardened during this review after the independent security audit found that its
  historical-ACL restoration would re-grant browser roles on the secret table. It now preserves
  both the admin assertion and the forward migration's least-privilege table ACL.
- Hardened rollback Git blob:
  `9e2e74d68799eb5f23b28cfb8c720a26e8b04cea`.
- The credential Worker, Pages resolver, MCP resolver, and runtime contract remain unchanged from
  landed implementation commit `0a06a21`. The migration change only corrects its rollback
  description. The later Connections-page change only adds the dark-gated messaging setup panel;
  it does not alter the Encircle card or flag seam.

## Read-only live evidence

Project: `glsmljpabrwonfiltiqm`.

### Migration ledger

The latest live entries are:

- `20260723215926 messaging_transport_foundation`
- `20260723220207 messaging_transport_foundation_indexes`
- `20260723221707 exec_read_sql_containment`

No `encircle_managed_credentials` ledger entry exists.

### `public.integration_credentials`

- RLS: enabled.
- Policies: zero.
- Primary key: `integration_credentials_pkey (provider)`.
- Columns: the 11-column pre-Encircle shape; `managed_status`, `last_verified_at`, and
  `last_verification_status` are absent.
- Browser table ACL: `anon` and `authenticated` still hold the historical broad table privileges.
  Zero-policy RLS blocks ordinary row access, and the pending migration removes those unnecessary
  grants as defense in depth.
- Safe row inventory (provider/environment and token-presence booleans only) contains `callrail`,
  `deepgram`, `github`, `quickbooks`, `resend`, `stripe`, `twilio`, and `web_push`. There is no
  `encircle` row.
- No credential value was selected.

The live data is compatible with the pending additive columns and constraints. The provider primary
key makes the inert `ON CONFLICT (provider) DO NOTHING` Encircle seed deterministic.

### Feature flag and status RPC

- `feature_flags` uses the expected `key`, `enabled`, `dev_only_user_id`, and `force_disabled`
  columns.
- `feature:encircle_managed_credentials` is absent, so the UI and Worker gate fail closed.
- Live `public.get_managed_credentials_status()` still has the pre-Encircle zero-argument
  `SETOF json` signature and returns only Stripe/Twilio/Resend status.
- Its ACL is `postgres`, `authenticated`, and `service_role`; `PUBLIC`/`anon` execution is absent.
- `public.p9_assert_admin()` is present, `SECURITY DEFINER`, and checks the authenticated employee is
  active and has the `admin` role. The pending replacement status RPC invokes this gate before
  reading the locked table.

## Verification

Targeted resolver, validation, authorization, MCP parity, UI helper, and apply-window suites:

```text
Test Files  7 passed | 1 skipped (8)
Tests       41 passed | 2 skipped (43)
```

The skips are the expected live authenticated RPC contract tests because no apply window or
short-lived admin/non-admin tokens were supplied. No provider request, database write, message,
money movement, deployment, or credential change occurred.

Independent review:

- Migration safety: PASS after the rollback hardening; additive constraints/seeds, locks, guards,
  signature, PL/pgSQL syntax, grants, and rollback ordering were accepted.
- Least-privilege/security: the forward migration and worker/resolver boundary passed. The reviewer
  found one rollback-only blocker—the old script restored full `anon`/`authenticated` table
  privileges. The rollback now keeps those privileges revoked and retains `p9_assert_admin()` on
  the legacy-shaped status RPC; the re-review passed and the blocker is closed.

## Authorized rollout boundary

The next production action is not implicit in this snapshot. At an owner-approved boundary:

1. Reconfirm `origin/dev`, this migration blob, the live ledger, and the catalog facts above.
2. Confirm compatible Pages resolver code is deployed while the Encircle row is still absent.
3. Apply only `20260723_encircle_managed_credentials.sql` in a serialized low-traffic window.
4. Run `supabase/tests/encircle_managed_credentials.test.js` with short-lived admin and non-admin
   access tokens and capture the resulting ledger/catalog evidence.
5. Continue the owner-only flag, browser/device, candidate, Preview/Production/`upr-mcp`, and
   separately approved key-retirement sequence from the roadmap.
