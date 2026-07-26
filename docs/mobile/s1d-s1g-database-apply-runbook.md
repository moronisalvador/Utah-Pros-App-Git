<!--
FILE: docs/mobile/s1d-s1g-database-apply-runbook.md

WHAT THIS DOES (plain language):
  Gives the database owner four independent, checksum-pinned apply and verification runbooks for
  the authored Mobile Production Readiness S1d, S1e, S1f, and S1g migrations.

DEPENDS ON:
  Internal: S1d-S1g migrations, rollbacks, catalog checks, evidence, release workflow
  External: reviewed release commit, shared Supabase owner window, approved synthetic identities

NOTES / GOTCHAS:
  - This document does not authorize an apply, deploy, provider call, notification, or data read.
  - Never use `supabase db push` for these waves. It can sweep unrelated pending migrations.
  - Complete and close one window before authorizing another.
-->

# Mobile S1d-S1g database apply runbook

**Prepared from source tip:** `41a8c0a982ca0ac682ca397b0fc016927ee4a738`

This is the operator index for four already authored source changes. It does not combine them.
Each row requires its own owner approval, fresh drift capture, apply record, verification record,
and stop/go decision.

| Window | Boundary | Migration | Required compatibility before apply |
|---|---|---|---|
| S1d | `notify_emit(text,jsonb)` capability/body | `20260726110000_notify_emit_service_boundary.sql` | owner-run trigger/cron and service-role caller graph unchanged |
| S1e | inbound-lead recording source/RLS | `20260726183409_inbound_lead_recording_source_boundary.sql` | compatible S1c CallRail recording proxy deployed and verified first |
| S1f | direct `create_notification` emission | `20260726194300_create_notification_service_boundary.sql` | service-role Worker and owner-run caller graph unchanged |
| S1g | notification recipient/read/Realtime boundary | `20260726260000_notification_read_recipient_boundary.sql` | reviewed PWA/Capacitor bell caller shape unchanged |

S1d, S1e, S1f, and S1g may share a reviewed release history. They must not share an apply window.
Do not begin the next window while the current window has an unresolved postcondition, advisor,
provenance, caller, Realtime, or compatibility result.

## Common entry gate for every window

The release and database owners record all of the following before go:

1. The exact reviewed release commit and proof that it is reachable from the designated release
   branch. The release commit must contain the complete foundation-through-target-wave history.
2. A clean release worktree, a fresh `origin/dev` fetch, and a normal merge of any drift. Never
   rebase or rewrite the reviewed security chain.
3. The exact artifact SHA-256 values from the table below, recomputed from that release commit.
   Any mismatch means stop and re-review; do not copy an older file into the release branch.
4. A fresh, value-free live catalog and migration-ledger capture for only the target window.
   Compare it with the target evidence and run the named preflight. Any overload, definition,
   ACL, policy, column, owner, RLS, publication, trigger, caller, schedule, or ledger drift means
   stop.
5. A serialized low-traffic owner window, a named operator and observer, a forward-fix owner,
   database recovery readiness, and an incident record location.
6. Confirmation that no other migration, deploy, provider test, secret rotation, notification
   test, or native/device test is running in the same window.
7. Separately approved synthetic/non-customer fixtures and identities for any behavioral proof.
   Catalog checks never authorize reading customer rows or invoking a side effect.

Do not use `supabase db push`, a migration-directory sweep, or a command that implicitly applies
all pending files. Submit only the exact reviewed migration body through the owner-controlled
single-migration mechanism, using the repository filename as the migration identity.

## Artifact fingerprints

| Window/artifact | SHA-256 |
|---|---|
| S1d migration | `a689549f4c536714f55251ef8f2f84a4e67c06bb75c8da8a478ee3f38dcebeef` |
| S1d preflight | `440a01bfc7b059a6aa14829538d689655adab85589d032fe4887338396bfd687` |
| S1d post-apply | `0dd62c716b884cfe03f1b258cf4f92271729ad51b8c893366bc2caeef85ed3e6` |
| S1d rollback | `6c453bdf300ef5ad7cd83d62b9030adecf3346705dc4acc52bfdb57e179e242c` |
| S1e migration | `6c1bb9989733fdaabe7961393f7dcbfa9373941cc2f4bb47bc8276df7d77f94a` |
| S1e preflight | `6bc902163eb678d380a8912c227003b23400f96afa9d7ae743d8e3b494f31adc` |
| S1e post-apply | `131df482f9a3ee958bb7d00cd9fc6a098e36bbe63f469c0d583051c9525d51e6` |
| S1e rollback | `c19af8861628c71bc0db3816f01892a7463e5d4f2ed13b6d3ac7f329b4b9f012` |
| S1f migration | `7e4d700374a51348c2b2c9c524cd9c3154dc3056cecc7cc1bb5a39547c219618` |
| S1f preflight | `9dc4b4cb4db922fd67f3f6d069994f27912d0735e04b287fb15e926f9b27588a` |
| S1f post-apply | `629c61be5614e9a7103198b8ebf9c4e36d69340fa0687f925d8c5395d50276d9` |
| S1f rollback | `a90e7c21e29db5ea9c1e1663045ff651e6feb8336ddd14a986e1e20c290f515d` |
| S1g migration | `7da14a9c7a13fc14497caf0cf39b56e990891224cfab6768519b9b8e1dcac2b9` |
| S1g preflight | `9372d17ffa62c36553b0c2b5d9a40339cc821c0aacc2d4065058bbf7baa9c597` |
| S1g post-apply | `02ea5dc3b31b4a0b92c351efe2ed1ea45cf525916009af3adaed1df5ad878050` |
| S1g rollback | `b15fe5b39088a50abea4fb43084cf305bf411704d0a4735c88cab04a1ebd56e7` |

## S1d — `notify_emit` service boundary

Artifacts:

- preflight: `supabase/tests/notify_emit_service_boundary_preflight.sql`
- migration: `supabase/migrations/20260726110000_notify_emit_service_boundary.sql`
- post-apply: `supabase/tests/notify_emit_service_boundary_post_apply.sql`
- rollback: `supabase/rollbacks/20260726110000_notify_emit_service_boundary.rollback.sql`
- evidence: `docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`

Apply sequence:

1. Recapture the one exact function overload, body/definition, ACL, six direct owner-run caller
   functions, three triggers, cron job, migration ledger, and absence of browser/Pages callers.
2. Run the value-free S1d preflight. Stop on any difference.
3. Apply only the S1d migration.
4. Run the S1d post-apply catalog proof.
5. Prove `PUBLIC`, `anon`, and `authenticated` cannot execute; prove `service_role` and the
   unchanged owner-run caller chain retain the required capability. A real notification or
   network request requires its own explicit side-effect approval and synthetic event.
6. Refresh database advisors and migration provenance, record the live ledger identity and exact
   release/deployment state, then close the window.

Prefer a forward repair. The rollback restores authenticated browser execution and the unsafe JSON
merge order. Use it only after explicit owner acceptance of those regressions, after constraining
the notification path, and only if its embedded forward-state guard passes.

## S1e — recording-source/RLS boundary

Artifacts:

- preflight: `supabase/tests/inbound_lead_recording_source_preflight.sql`
- migration: `supabase/migrations/20260726183409_inbound_lead_recording_source_boundary.sql`
- post-apply: `supabase/tests/inbound_lead_recording_source_post_apply.sql`
- rollback: `supabase/rollbacks/20260726183409_inbound_lead_recording_source_boundary.rollback.sql`
- evidence:
  `docs/audit/2026-07/evidence/mobile-readiness-s1e-recording-source-rls-2026-07-26.md`

Apply sequence:

1. Before opening the database window, deploy and smoke the compatible S1c CallRail recording
   proxy. Confirm its immutable deployment identity and required binding presence without reading
   secret values or recordings.
2. Recapture the exact `get_inbound_leads`, inbound-lead table/policies/ACLs, recording writers,
   proxy/transcription consumers, triggers, columns, payload key aggregates, and migration ledger.
3. Run the value-free S1e preflight. Stop on any difference.
4. Apply only the S1e migration. Its source move and privacy scrub are part of one transaction.
5. Run the S1e post-apply catalog proof and database advisors/provenance.
6. With approved synthetic rows only, prove active internal allowed reads, inactive/external/
   unmapped/direct-browser denial, opaque marker compatibility, service source access, and proxy
   delivery. Never select or log a recording URL value during catalog verification.
7. Record the compatible Worker version, migration ledger identity, role results, and source-table
   aggregates, then close the window.

The rollback copies source URLs back to the browser-visible table, restores broad authenticated
access, and cannot reconstruct privacy-safe raw-payload keys removed by the forward migration.
Prefer a forward repair. Roll back only with explicit privacy-regression and irreversible-scrub
acceptance and only when the embedded forward-state guard passes.

## S1f — `create_notification` service boundary

Artifacts:

- preflight: `supabase/tests/create_notification_service_boundary_preflight.sql`
- migration: `supabase/migrations/20260726194300_create_notification_service_boundary.sql`
- post-apply: `supabase/tests/create_notification_service_boundary_post_apply.sql`
- rollback: `supabase/rollbacks/20260726194300_create_notification_service_boundary.rollback.sql`
- evidence:
  `docs/audit/2026-07/evidence/mobile-readiness-s1f-create-notification-2026-07-26.md`

Apply sequence:

1. Recapture the exact single overload, body/definition, owner/language/settings, ACL, database-body
   callers, repository callers, and migration ledger.
2. Run the value-free S1f preflight. Stop on any difference.
3. Apply only the S1f attribute-only migration.
4. Run the S1f post-apply proof.
5. Prove direct `PUBLIC`, `anon`, and `authenticated` execution is denied, `service_role` remains
   allowed, and the owner-run midnight-clock caller contract is unchanged. A bell emission test
   requires separate side-effect approval and a synthetic recipient.
6. Refresh advisors/provenance, record the release commit and live ledger identity, then close the
   window.

The rollback intentionally restores arbitrary bell emission by authenticated browser clients.
Prefer a forward repair. Use the rollback only with explicit security-regression acceptance and
only when its exact function/ACL guard passes.

## S1g — notification recipient/read/Realtime boundary

Artifacts:

- preflight: `supabase/tests/notification_read_recipient_boundary_preflight.sql`
- migration: `supabase/migrations/20260726260000_notification_read_recipient_boundary.sql`
- post-apply: `supabase/tests/notification_read_recipient_boundary_post_apply.sql`
- isolated behavior suite: `supabase/tests/notification_read_recipient_boundary_isolated.sql`
- rollback: `supabase/rollbacks/20260726260000_notification_read_recipient_boundary.rollback.sql`
- evidence:
  `docs/audit/2026-07/evidence/mobile-readiness-s1g-notification-reads-2026-07-26.md`

Apply sequence:

1. Recapture all four exact RPC overloads/definitions/ACLs, notification columns/policies/ACL/
   publication state, employee identity dependencies, caller inventory, and migration ledger.
2. Run the value-free S1g preflight. Stop on any difference.
3. Apply only the S1g migration.
4. Run the S1g post-apply catalog proof, advisors, and provenance.
5. With two approved active-internal synthetic employees plus inactive, external, and unmapped
   identities, prove own/broadcast list/count/mark behavior, foreign selector/ID denial, independent
   broadcast receipts, targeted isolation, legacy-read compatibility, direct receipt denial, and
   exact service-role compatibility.
6. Through real Supabase Auth/PostgREST and two Realtime sockets, prove own/broadcast delivery,
   foreign non-delivery, reconnect/dedup, token refresh, logout, and account switch.
7. Exercise the PWA and Capacitor bell against those fixtures, record exact deployed clients and
   socket results, then close the window.

The rollback reopens cross-recipient reads and mutations, broad Realtime payloads, sentinel
deletion, and shared broadcast-read state, and it destroys post-S1g receipt history. Prefer a
forward repair. It requires explicit owner acceptance plus
`SET upr.allow_unsafe_s1g_rollback = 'on'` in the same dedicated session, and it still refuses any
forward-state drift.

## Window close-out record

For each window, create a new dated evidence file. Do not rewrite the source-readiness snapshot.
Record:

- owner approval, operator/observer, UTC start/end, exact release commit, and deployed compatibility
  versions;
- recomputed artifact hashes, fresh catalog/ledger capture, preflight result, single migration
  identity, post-apply result, advisor/provenance output, and all role/socket/client results;
- confirmation that no other migration or deploy overlapped the window;
- any fixture IDs only in an access-controlled operator record, never in repository evidence;
- forward fix or rollback decision, including the exact regression explicitly accepted if rollback
  occurred; and
- final residual state in the unfinished-work registry and canonical authorization/database/
  testing documentation.

An applied migration without all required behavioral proof remains `PARTIAL`; it is not a
production-readiness closure.
