<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1g-notification-reads-2026-07-26.md

WHAT THIS DOES (plain language):
  Records the source-only S1g notification read/recipient authorization patch, sanitized live
  catalog metadata, compatibility proof, and the separate production gates that remain open.

DEPENDS ON:
  Internal: S1g migration/rollback/tests, R0-S1f evidence, canonical mobile/security docs
  Data:     reads → repository and database catalog metadata only
            writes → documentation only

NOTES / GOTCHAS:
  - No notification/receipt/employee row, message, recipient, customer, configuration, or secret
    value was read.
  - The migration is authored only and is not live.
-->

# Mobile readiness S1g — notification read/recipient boundary

**Captured:** 2026-07-26 21:12–21:20 UTC
**Branch:** `codex/mobile-readiness-s1g-notification-reads`
**Source base:** `a6b139b5d48217a96475b969a63998dce3269573`
**Fetched origin/dev:** `245c0c41437b0b5f780ebab360313e5ecbe971df`
**Drift:** none; `origin/dev` is already an ancestor of the source base
**Migration:** `20260726260000_notification_read_recipient_boundary.sql` — not applied

## Result

S1g authors one coherent database boundary for the shared PWA/Capacitor notification bell:

- the four deployed list/count/mark identities, defaults, return types, and client call shapes stay
  unchanged;
- an authenticated call resolves the unique active, non-external employee from `auth.uid()` and
  rejects a foreign non-null employee selector or foreign targeted notification with SQLSTATE
  `42501`;
- direct `notifications` SELECT, including Realtime Postgres Changes, becomes active-internal
  own-or-broadcast authorization instead of authenticated `USING (true)`;
- broadcasts receive private per-employee read receipts, while targeted rows retain their existing
  row-level `read_at`; and
- a legacy broadcast with non-null shared `read_at` remains read for everyone, preventing a
  historical unread reset.

This is source readiness for `UPRF-MOB-NOTIF-READ-001`, not closure. The live BOLA, broad Realtime
payload, and shared-read residuals remain until the exact migration is integrated, separately
applied, and verified with real authenticated roles/sockets.

## Read-only live metadata and callers

Catalog-only capture found one exact overload for each target:

| Identity | Result | Body MD5 | Definition MD5 |
|---|---|---|---|
| `get_notifications(integer,uuid)` | `SETOF notifications` | `a66659f2c54bc0b7bdc2b60949fdb883` | `7e932efdb51db6b3fc48567e533b4461` |
| `get_unread_notification_count(uuid)` | `integer` | `b15c8a180f65586d6bd3c4f75d1c6f9e` | `9caee22bd136f6a0a48641ab7b5b1777` |
| `mark_all_notifications_read(uuid)` | `void` | `4ba9b450a720c65bb2149d45f6ea53f1` | `a5782492c10f797fb36253cc5ae502a2` |
| `mark_notification_read(uuid)` | `void` | `389254cd40d74bdec30f23c7ebeb498e` | `68897ae73b531556d11805a906210afc` |

All four are owned by `postgres`, SQL, volatile `SECURITY DEFINER`,
`search_path=public`, and have exact non-grantable EXECUTE ACLs for `postgres`,
`authenticated`, and `service_role`; `PUBLIC` and `anon` are denied. A database-body scan found no
direct caller of the four functions.

`notifications` has 13 columns with shape MD5 `0170db1f6199da7f23355b35ba343954`,
owner `postgres`, RLS enabled/not forced, default replica identity, and membership in
`supabase_realtime`. Its table ACL shape MD5 is `f7cafbf463643b5debc08b30a5cba10e`:
`anon`, `authenticated`, and `service_role` currently hold broad table privileges, although RLS
allows only authenticated reads/deletion. The exact two policies are:

- `notifications_select`: authenticated SELECT, `USING (true)`, predicate MD5
  `b326b5062b2f0e69046810717534cb09`; and
- `notifications_delete_testrows`: authenticated sentinel DELETE, predicate MD5
  `b60edd5d780221512206b2510a93c3db`.

The employee catalog has unique nullable UUID `auth_user_id`, non-null Boolean `is_active` and
`is_external`, authenticated SELECT, RLS enabled/not forced, and the permissive authenticated
`allow_authenticated_employees` policy used by the notification predicate. `postgres` has
`BYPASSRLS`, required by the forced-RLS owner-run receipt access. No employee row or identity value
was selected.

Repository runtime inventory found one product caller,
`src/components/NotificationBell.jsx`, shared by office layouts and the persistent tech
dashboard used by web/PWA/Capacitor. It passes `employee.id` for list/count/mark-all and the
notification ID for mark-one. `src/lib/realtime.js` subscribes to notification INSERTs; the bell's
foreign-recipient JavaScript filter remains defense in depth. No Worker or other product source
calls the four read/mark RPCs.

## Migration and compatibility contract

The forward migration fails closed on exact input overloads, arguments/defaults, bodies/definitions,
ACLs, table column/ACL shape, both policies, the employee Auth/RLS/SELECT-policy dependency,
owner/RLS mode, Realtime publication, and the absence of a pre-existing receipt table.

It creates
`notification_reads(notification_id,employee_id,read_at)` with cascading foreign keys, primary key
`(notification_id,employee_id)`, employee index, forced RLS, zero policies, and zero browser or
service-role table grants. Owner-run definer functions are the only access path. The existing
`notifications_select` policy object is altered rather than dropped so the published table remains
stable; authenticated notification-table access becomes SELECT-only and the obsolete sentinel
DELETE policy is removed.

For authenticated callers:

- null/default employee parameters retain broadcast-only list/count/mark-all scope;
- the caller's own non-null employee ID yields broadcasts plus own targeted rows;
- another employee ID is denied;
- missing/null mark-one IDs retain the deployed void no-op;
- a foreign targeted ID is denied;
- broadcast mark-one/mark-all inserts an idempotent caller receipt without changing the base row;
  and
- own targeted mark-one/mark-all updates only that targeted row.

A signed top-level service-role JWT retains the exact deployed base-row list/count, mark-one, and
null/non-null mark-all behavior. This does not give browser users a path because `auth.jwt()` is
verified and the browser cannot mint the service-role signature. No direct service-role
receipt-table grant is needed.

The paired rollback requires the owner to set `upr.allow_unsafe_s1g_rollback=on`, refuses forward
receipt columns/default, constraints, indexes, ACL, publication, notification policy/ACL, and
function definition drift; restores the exact four captured SQL bodies and function ACLs; restores
`notifications_select USING (true)`; recreates the authenticated sentinel DELETE policy; and drops
receipts. The historical `anon` notification-table grant is intentionally **not** restored because
notifications have no public allowlist use case. The rollback still reopens authenticated
cross-recipient/shared-read exposure and loses post-S1g broadcast-read history; forward repair is
preferred.

## Verification

Credential-free CI source coverage proves intent, not applied behavior:

- focused S1g QA contract and runner/baseline coverage: 9/9 passed;
- exact authored body/definition hashes:
  `get_notifications`
  `fefa4b58a7cf9faaae6d235c98faa1d6` /
  `a9d0da79befb2d2cb2a3e5452d3c6269`;
  `get_unread_notification_count`
  `2b8706a1ff85ab821c44e084f66bc998` /
  `8bd9df112ee1a6a7ff9f5c18789142d8`;
  `mark_all_notifications_read`
  `17535104ecaa23b9eb98c9192921cf05` /
  `d954d04ad3e3fe2ead30ec3e9d8bfbf7`; and
  `mark_notification_read`
  `cbe82dd0652029a881944527e99b9091` /
  `868d6fd6e3a5278d152860318753805f`;
- exact forward policy/ACL fingerprints:
  notification SELECT predicate `f6a4b946f6d65eadf3bf4764e734d5b1`,
  notification-table ACL `c821903bc39dd59e6ac6b60d039a731d`, and receipt-table ACL
  `5ae62afd8335deffffb81c9aa98f62be`;
- value-free preflight and post-apply scripts query only catalog metadata and never invoke a target
  RPC or read notification/receipt rows; and
- the isolated behavior script covers two active employees plus inactive, external, and unmapped
  identities, foreign parameters/IDs, direct RLS, legacy broadcast compatibility, independent
  broadcast receipts, targeted isolation, authenticated default mark-all and own-target mark-one,
  direct receipt denial, no-op IDs, idempotency, explicit-null/default calls, and all four
  service-role compatibility branches. It has both the `UPR_ISOLATED_DB` client gate and
  `upr.isolated_test_database=on` server assertion and is transaction-rollback-only.

A temporary in-memory PGlite PostgreSQL harness, containing only synthetic schema/identities, ran
the standalone preflight, full forward transaction and embedded postcondition, standalone
post-apply proof, authenticated/service isolated behavior transaction, and owner-guarded rollback
plus postcondition successfully. The governed `npm run test:db:local` path now invokes the exact
S1g pgTAP wrapper with `supabase test db --local` before its DB Vitest lane; the unsafe legacy
shared/anonymous `notify_foundation.test.js` was retired. The governed current-live-compatible
local Supabase clone is still a P2a external QA gate, so this PGlite result is compilation/catalog
and behavior evidence, not Supabase Auth/PostgREST/Realtime proof. No live socket proof occurred.
The retired test's unrelated preference-resolver integration assertions are not claimed by S1g;
they remain a named follow-up in the next shared identity/device/preferences QA slice.

Source close-out completed with these actual results:

- `npm test`: passed — unit 774/774, Worker 1411/1411, QA 105/105, with zero unexpected skips;
- web `npm run build`: passed — 665 modules;
- native-target `VITE_BUILD_TARGET=native npx vite build`: passed — 665 modules; this is a web
  asset build only and is not a Capacitor sync, Xcode compile/sign, simulator, or device result;
- changed-JavaScript ESLint, runner syntax, tooling tests 12/12, and `git diff --check`: passed;
- full-repository lint reached the unchanged known baseline of 325 findings
  (206 errors, 119 warnings); S1g introduced no changed-file lint violation;
- tooling validation: zero errors and the two already governed Capacitor warnings
  `CAP-GOV-001` and `CAP-SEC-001`, both accepted through 2026-08-06;
- provenance tests: 13/13 passed; provenance validation passed at source ref
  `a6b139b5d48217a96475b969a63998dce3269573` with ledger 27, functions 21, policies 5, and four
  already documented semantic warnings;
- mobile preflight: zero errors and three environmental warnings — the expected uncommitted S1g
  tree, local Node 26 versus CI Node 22, and optional GitHub reachability; and
- two independent source/security reviews returned PASS with no remaining finding after exact
  hash recomputation, fail-closed isolation review, caller/ACL/policy inspection, and positive
  authenticated/service-role compatibility review.

The governed current-live-compatible local Supabase gate, the serialized production apply, real
Supabase Auth/PostgREST/Realtime sessions and sockets, and all deployment/native/device gates
remain open by design.

## Exact separate apply gate

1. Integrate/review the complete foundation→S1g history without rewriting or dropping drift
   parents.
2. Re-fetch `origin/dev`, recapture only the exact catalog metadata above, and run the S1g
   value-free preflight from the reviewed release commit.
3. Stop on any overload, body/definition, ACL, column, policy, Auth uniqueness, owner/RLS,
   publication, caller, or migration-ledger drift.
4. Apply only `20260726260000_notification_read_recipient_boundary.sql` in a serialized low-traffic
   owner window. Never run all pending migrations.
5. Run the value-free post-apply proof, database advisors, and fresh provenance capture.
6. With separately approved non-customer fixtures, use two authenticated synthetic sessions to
   prove own/broadcast allow, foreign/inactive/external/unmapped denial, independent broadcast and
   targeted reads, direct PostgREST scope, and Realtime own/broadcast delivery plus foreign
   non-delivery.
7. Exercise PWA and Capacitor bell open/mark/mark-all, resume/reconnect, token refresh, and account
   switch/logout. Roll forward on failure; use the guarded rollback only with explicit acceptance
   of reopened exposure and receipt loss.

## Separate residuals

S1d, S1e, and S1f applies, notification emission, shared identity/device/preferences, QBO actor
telemetry and attachment RLS, private media, destructive merge, public signing, route-family
RPC/RLS, deployment, providers, push, OTA, native privacy/routes, signing, TestFlight, physical
devices, and final release qualification remain separate. No migration apply, deploy,
notification/read mutation, provider call, secret/configuration change, customer inspection,
message, money movement, signing, or distribution occurred in S1g.
