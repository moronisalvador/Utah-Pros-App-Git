<!--
FILE: docs/audit/2026-07/evidence/appointment-crew-atomic-save-and-audit-live-apply-2026-08-04.md

WHAT THIS DOES (plain language):
  Records the exact qualification and hosted apply evidence for the appointment crew enum,
  authorization, audit, and atomic-save repair.

DEPENDS ON:
  Internal: migration, rollback, SQL proof, caller contract tests, and provenance manifest
  Data:     reads → value-free QA/Production migration ledger and Postgres catalog metadata
            writes → the exact reviewed migration on QA and Production; documentation only here

NOTES / GOTCHAS:
  - The Production bridge migration is immutable and was not edited or replayed.
  - QA behavior used fixed synthetic UUIDs inside a transaction that rolled back.
  - Production verification was catalog-only; no customer row or synthetic fixture was read/written.
  - Production caller deployment and adoption-gated Phase B are separate release steps.
-->

# Appointment crew atomic save and audit live apply

- **Captured:** 2026-08-04
- **Qualified source head:** `b62eee896c67d4058e7eeb6383fa698996d831c9`
- **Forward source commit:** `24718bdc3ac936371fcff691862397a3de1580a8`
- **Migration:** `20260804000910_appointment_crew_atomic_save_and_audit_repair.sql`
- **QA ledger:** `20260804060640_appointment_crew_atomic_save_and_audit_repair`
- **Production ledger:** `20260804061426_appointment_crew_atomic_save_and_audit_repair`

## Result

The forward successor is live on QA and Production. It fixes the original
`text`-to-`crew_role` failure, implements the owner-approved all-active-internal crew policy, and
keeps appointment fields/privacy/tasks behind their separate object authorization. Every real crew
add, removal, or role change is actor-attributed with old/new assignments and a database timestamp.
The create and update commands keep appointment, crew, task, privacy, notification-preference, and
reschedule history mutations in one transaction.

Phase A intentionally retains RLS- and trigger-guarded authenticated appointment/crew DML for
installed clients. Phase B must revoke those compatibility grants only after supported-native
adoption is evidenced. The lower-timestamp notification producer migration in PR #573 must also
reconcile forward before PR #573 is applied to Production so it cannot overwrite this
function/ACL/audit contract.

## Immutable source identities

| Artifact | Git blob / SHA-256 |
|---|---|
| Production bridge source `20260804000042...sql` | blob `9cf2aa5eb38d6623f8e4cdde7aea35a3964a72be`; SHA-256 `465e2a3136f56ffcbc25d227f40fb9137f1984f716c3bd654ced6414432020da` |
| Forward successor | SHA-256 `9d8f44c578f169dd497e3832da59bf1e198e33c19ef558254ff203e628fa14c6` |
| Recovery rollback | SHA-256 `5529e8f2dc1ea9b6f6f2a3ebd5822ba6910df59c75a6d63a12c682827343eda5` |
| SQL behavior proof | SHA-256 `d3a316557eb75545e0743c26ccada832adc64682db8dcaccb3196cb1b6e94c09` |

The Production bridge remains the exact source introduced by
`915a5eed953c4fec61c22894f67bd554e609ac40`; it was neither edited nor replayed. The successor
apply read the exact 112,234-byte committed source and verified its SHA-256 before each hosted
operation.

## Qualification before hosted apply

- Pinned Supabase CLI `2.111.0` ran two fresh local lineages: the Production bridge predecessor and
  QA's notification M1/M2 predecessor.
- Each lineage passed forward apply, negative authorization/RLS/enum/atomicity/audit behavior,
  fail-closed rollback, clean reapply, and the behavior proof again.
- The commit-bound input manifest was
  `faa5f46c2d77316724939a69734cfe9ba872ea4619561a1cf13274e0e0855be6`.
- Full unit/Worker/QA tests, Production build, migration hygiene, lint ratchet, mobile preflight,
  strict bundle budget, artifact scan, provenance, and diff integrity passed.
- Hosted CI run `30882595156` passed `verify`, `db-lane`, and Cloudflare at the exact qualified head.
- Independent migration, least-privilege/anonymous-grant, caller/mobile-contract, page behavior,
  project-law, design, and blocking mobile-security reviews reported no P0/P1/P2 finding.

## QA apply and behavior verification

QA project `uizgwvkvzyldystqrcsk` matched the reviewed M1/M2 predecessor before apply. The exact
successor applied as ledger `20260804060640`. Postflight confirmed the function comments, owners,
empty search paths, role grants, RLS, policies, triggers, enum/default, audit protections, and
Phase-A ACLs. The complete SQL proof then ran with fixed synthetic UUIDs inside a transaction that
rolled back. It covered allowed/denied callers, valid/default/null/invalid roles, no-op stability,
add/remove/update set diffs, immutable attribution, create/edit/reschedule atomicity, task and
privacy denials, legacy-client compatibility, and admin-only job merge. Residue checks found zero
rows for every synthetic ID. The protected hosted database lane rerun passed 163 assertions with
zero assertion failures; its frozen unrelated baseline skips/setup debt remained unchanged.

## Production apply and read-only verification

Immediately before the Production write, project `glsmljpabrwonfiltiqm` had bridge ledger
`20260804003152`, the five expected predecessor function hashes, `lead`/`tech`/`helper`, four
policies on each appointment table, no successor signature, and zero waiting target locks. The
exact reviewed successor applied once as ledger `20260804061426`.

Read-only postflight confirmed:

- all 19 marked functions are present, `postgres`-owned `SECURITY DEFINER`, and use
  `search_path=""`;
- `PUBLIC` and `anon` execute are absent; browser, service, private-helper, and admin-only job-merge
  execution match the reviewed role matrix;
- both appointment tables retain RLS and exactly four authenticated-only policies each;
- both command/audit triggers are enabled and bound to the reviewed functions;
- authenticated Phase-A DML excludes appointment identity columns; service appointment UPDATE is
  limited to `client_notified_at` and `client_time_sig`; service raw crew writes remain denied;
- `system_events` is not update/delete/truncate-capable by browser or normal service roles; and
- `appointment_crew.role` remains non-null `crew_role`, defaulting to `'tech'::crew_role`.

No Production customer content was read, and no Production fixture, provider call, message, flag,
cron, device, QBO, Storage, Capgo, or App Review action occurred. Supabase advisors reported only
the expected intentional warnings for authenticated, caller-gated definer RPCs plus one pre-existing
`appointments.created_by` covering-index advisory; no repair-specific catalog drift was found.

## Dev/Preview caller publication

PR [#579](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/579) merged the exact qualified
repair to `dev` as `ce30f2242a34f713c5cb9294cc2ce7513d938e15`. Push-triggered CI run
`30884704586` passed `verify` and `db-lane`; iOS dev run `30884704581` passed its
credential-free preflight, with IPA/TestFlight delivery correctly skipped. The Cloudflare Pages
check attached to that exact commit passed with deployment ID
`b586f62f-1521-47f4-a1ba-7332d5b6245c`. The repository smoke runner then verified
`https://dev.utahpros.app`: 30 referenced boot assets were present with browser-correct content
types, and missing assets returned 404 rather than cached HTML. No native distribution occurred.

The first PR #580 Production review then found a caller-only authorization mismatch and correctly
held the merge: the native editor and both desktop edit modals always supplied unchanged
appointment values with a crew diff, so the database intentionally classified the request as
ordinary appointment-edit intent. The bounded correction computes changed appointment fields,
omits preserved defaulted RPC parameters, and retains explicit nullable-field clears. A crew-only
payload therefore reaches the already-qualified all-active-internal crew path, while any real
appointment/task/privacy change retains its separate authorization. No migration source or hosted
database state changed; fresh exact-head gates and security review are required before resuming
Production promotion.

## Remaining release gates

- Promote only the focused repair from the verified dev/Preview commit to main/Production, with
  exact-head reviewed CI and post-deploy boot verification.
- Reconcile PR #573's lower-timestamp crew replacement before PR #573 is applied to Production.
- Keep notification flags, reminder cron, providers, and devices unchanged.
- Revoke Phase-A compatibility DML only after supported-native adoption evidence.
