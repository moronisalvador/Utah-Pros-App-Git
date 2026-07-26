<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1f-create-notification-2026-07-26.md

WHAT THIS DOES (plain language):
  Records the source-only S1f bell-emission authorization patch, sanitized live metadata,
  compatibility proof, and the separate production gates that remain open.

DEPENDS ON:
  Internal: S1f migration/rollback/tests, R0-S1e evidence, canonical mobile/security docs
  Data:     reads → repository and database catalog metadata only
            writes → documentation only

NOTES / GOTCHAS:
  - No notification row, message, recipient, customer, configuration, or secret value was read.
  - The migration is authored only and is not live.
-->

# Mobile readiness S1f — `create_notification` service boundary

**Captured:** 2026-07-26 19:43 UTC
**Branch:** `codex/mobile-readiness-s1f-create-notification-auth`
**Requested base:** `637ac7097014f707c42777b58e5008ca01d95d16`
**Fetched origin/dev:** `65fddb5c58ba8e7f896fda7a837c01f9e614b520`
**Drift merge:** `b7bd45ab2630b37a090c8e806ecdaac07a765f32`
**Migration:** `20260726194300_create_notification_service_boundary.sql` — not applied

## Result

S1f authors an attribute-only grant change for direct bell emission. It revokes
`create_notification` execution from `PUBLIC`, `anon`, and `authenticated`, retains
`service_role`, and does not replace the function. Its signature, return shape, defaults, body,
owner, security mode, search path, notification writes, and recipient/broadcast behavior remain
unchanged.

This closes source authoring for `UPRF-MOB-BELL-RPC-001`; it does not close the live finding until
the exact migration is reviewed, integrated, applied, and verified in its own owner-authorized
shared-database window.

## Read-only live metadata and callers

Catalog-only capture found one overload:

- identity:
  `create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text) -> notifications`;
- owner `postgres`, SQL, `SECURITY DEFINER`, `search_path=public`;
- body MD5 `939e2f34e6397672fa5a974c4a67d3cd`;
- definition MD5 `29ccd83a067aefbcb27a89e9a9a71bea`;
- exact non-grantable EXECUTE ACL: `postgres`, `authenticated`, `service_role`;
- `PUBLIC` and `anon` denied; and
- one direct database-body caller: `apply_midnight_clock_split()`, owner `postgres`,
  `SECURITY DEFINER`, one call, body MD5 `53b9c36e5deeeb3ded60136a97b079a1`.

Repository source has one non-test runtime RPC caller: `functions/api/notify.js`, where
`dispatchToRecipient` uses the worker-side service client. Historical direct SQL emitters were
rewired to `notify_emit`; the midnight-clock migration is the sole live database caller. No
browser/mobile/desktop product source calls `create_notification` directly.

The final `origin/dev` merge added notification-catalog and permission hardening migrations. They
do not revoke authenticated execution of this function and do not conflict with the attribute-only
S1f patch.

## Migration, rollback, and verification contract

The forward migration fails closed unless the exact target metadata/body/ACL and sole owner-run
database caller still match. It then changes only EXECUTE ACLs and asserts the service-only result.
The paired rollback refuses drift and restores authenticated plus service-role execution without
replacing the body; it deliberately reopens arbitrary signed-in bell emission.

Catalog-only pre/post scripts inspect grants, hashes, and caller ownership without invoking the
function or selecting notifications. The credential-free QA contract proves browser denial,
service-worker compatibility, attribute-only scope, exact hashes, rollback presence, and
non-invoking apply checks. A disposable Postgres clone was not available, so the SQL transaction
itself and role behavior were not executed.

Observed local verification:

- focused S1f QA contract: 4/4 passed;
- full credential-free suite: unit 774/774, Worker 1,401/1,401, QA 74/74;
- web and `VITE_BUILD_TARGET=native` builds: passed, 665 modules each; no Capacitor sync, signing,
  simulator, or device action;
- changed-file ESLint: passed;
- full lint: known baseline 206 errors/119 warnings; no changed-file violation;
- tooling tests 12/12 and provenance tests 13/13: passed;
- tooling validation: zero errors/two temporary CAP warnings;
- worktree provenance: passed for 27 ledger rows/21 functions/5 policies with four declared
  semantic warnings; and
- `git diff --check`: passed.

## Rollout

1. Integrate and review the complete foundation→S1f history without dropping either drift parent.
2. Recapture only the exact function/ACL/caller/ledger metadata and run the S1f preflight.
3. Stop on any signature, owner, security/search-path, body/definition hash, ACL, or caller drift.
4. Apply only the exact S1f migration in a serialized owner-authorized window. Do not run all
   pending migrations: the independent S1d and S1e applies remain separate.
5. Run the post-apply catalog proof and verify direct `authenticated` denial plus
   `service_role`/owner-caller compatibility using approved synthetic fixtures only if separately
   authorized.
6. Capture ledger/provenance and advisors without selecting notification/customer contents.

## Separate residuals

S1d and S1e apply windows, QBO actor telemetry, `qbo_attachments` RLS, private media, notification
read/mark recipient binding, shared identity/device/preferences, destructive merge, public signing,
route-family RPC/RLS, deployment, providers, push, native/device, signing, and release gates remain
separate. No migration apply, deploy, notification, provider call, secret/configuration change,
customer inspection, message, money movement, signing, or distribution occurred in S1f.
