# Initiative Status — Live Coordination State

**Last verified:** 2026-08-03 · This is the ONE always-loaded file recording what is currently in
flight, leased, or unapplied. Full initiative manifests live in `docs/archive/rules/` — they are
history, not law. When an initiative completes, delete its row here; when one starts, add a row
and a roadmap. Do not let this file grow past ~1 page — that is how the last rulebook died.

## Active leases (check before touching a shared hotspot)

*(Released 2026-08-01: the standalone appointment-reminder containment repair landed in `dev`
through PR #571 at merge `9e723f4a` from reviewed head `72cb52e1`. Its exact files and inert
activation gates remain recorded in
[`.claude/rules/appointment-reminder-wave-ownership.md`](appointment-reminder-wave-ownership.md).
The separate five-producer candidate has since merged that exact `dev` baseline without rewriting
history and does not duplicate the reminder migration.)*

*(Released 2026-07-29: the mobile current-origin reconciliation lease over `.claude/**`,
`AGENTS.md`, `CLAUDE.md`, `tooling/**` and the mobile integration seams — owner accepted the
handback. Its work landed in `dev` via PR #525, merged 2026-07-27; the holder branch
`codex/mobile-readiness-current-origin-review` had zero commits not already in `dev` at
acceptance.)*

The 2026-07-31 `dev → main` promotion hold was superseded by the owner's explicit 2026-08-03
instruction to review and promote PR
[#565](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/565) only after the exact reconciled
candidate passes local, database, native/web compatibility, reviewer, and hosted-CI gates. This is
not blanket authorization for hosted SQL, provider traffic, feature/cron activation, or native
distribution. Re-check the exact remote tips and PR head before publication and again before merge.

## Conversation participant scoping — compatibility live on QA + production; enforcement authored

- `20260731040337_conversation_participant_scoping.sql` and
  `20260731040338_conversation_unread_state_compatibility.sql` are applied to isolated
  `qa-staging` as ledgers `20260731143710` and `20260731181046`, and to production as ledgers
  `20260801145727` and `20260801145753`. Their immutable source hashes and catalog checks remain
  recorded evidence. The exact committed
  `20260731213000_conversation_assignment_authority_containment.sql` source (SHA-256
  `0c7b8769f53bbb45fd7d6127b86b88d53c4fc3101d3b7b72e2b6f51bb5c87f51`) is also applied
  to `qa-staging` as ledger `20260801144448` and production as ledger `20260801145825`.
  Post-apply checks on both targets matched all four reviewed function hashes/owners/search
  paths/volatility settings and ACLs and found no appointment/job/claim/crew authority source.
  Fresh read-only evidence on 2026-08-01 found zero pending scheduled rows on both QA and
  production; the sole legacy production row was previously guard-cancelled without reading its
  body or other PII.
- Appointment, job, claim, and crew rows are browser-writable and are **not conversation
  authorization**. The QA/production-applied correction replaces the four independent
  membership/contact paths with privileged role → explicit per-chat override → default technician
  → deny, after exact employee-identity and QA/production lineage preflights.
  `20260731213100_conversation_participant_policy_enforcement.sql` is also authored and unapplied.
  It must follow `31213000`, narrows the three protected table policies in place, and removes every
  authenticated direct write. Both carry recovery-pause rollbacks that seal browser tables/RPCs;
  they never restore the historical broad policies or derived appointment trust.
- Candidate UI/Worker source uses actor-derived unread changes, canonical notification recipients,
  scoped contact/opening paths, per-ID cache revocation, admin per-chat/default controls,
  technician self-leave, sender labels, and 18px mobile message text. Historical disposable proof
  for the superseded `40339` source remains historical; it is not evidence for `31213000/31213100`.
  Earlier corrected participant and scheduled-delivery sources passed on a disposable local
  Supabase clone with fixture transactions rolled back. The exact current source adds the
  authorized-media RPC, explicit-deny queue policies, legacy-claim no-op, and their assertions;
  the governed full database runner, physical-iPhone proof, and supported-native-release evidence
  remain open gates.
- Scheduled-message hardening is authored and unapplied as
  `20260731220000_scheduled_message_delivery_compatibility.sql` then
  `20260731220100_scheduled_message_delivery_enforcement.sql`. Compatibility requires the exact
  `31213100` policy/ACL ledger before it can run, takes the queue lock, and aborts with SQLSTATE
  `55000` if even one legacy pending row remains; it never quarantines or edits those rows.
  Actor-derived creation stores immutable creator, conversation, body/send time, recipient contact,
  and recipient phone provenance. Token-fenced service RPCs recheck the snapshot/current recipient
  plus creator access. The final reservation transaction share-locks the live automated-SMS switch,
  invokes the canonical phone-locked consent authority, accepts only `GLOBAL_OPT_IN`, and leaves no
  provider-attempt link for a disabled switch, DND, explicit opt-out, pending STOP, or any other
  non-global result. Compatibility changes the three legacy scheduled policies to explicit
  deny predicates and closes browser table ACLs; enforcement reasserts both layers. The frozen
  legacy claim remains callable to historical roles only as a side-effect-free `false` no-op.
  Unknown provider outcomes are never automatically resubmitted. Auth, PostgREST, RPC, credential,
  and provider transports are bounded; a reserved scheduled send requires a fresh managed
  credential lookup and cannot use cached/environment fallback after that lookup times out.
- Fresh read-only catalog evidence on 2026-08-01 found zero legacy `pending` scheduled rows on
  production and QA. The sole legacy production row recorded on 2026-07-31 was previously
  guard-cancelled; this verification read only the aggregate and did not inspect body or other
  PII. The zero-row preflight remains mandatory and must fail closed if the aggregate changes.
  The seeded `qa-staging` catalog remains healthy and usable, but
  its `MIGRATIONS_FAILED` badge reflects the real historical ledger/replay gap documented in the
  runbook; it is not evidence that the current catalog is broken and must not be cleared through
  rebase or ad-hoc ledger writes. `40337/40338/31213000` are ledgered for this train; target the
  exact branch ref and keep every later QA apply serialized.
- Exact release order is foundation/correction → compatible web plus supported native adoption →
  `31213100` participant enforcement → aggregate zero-pending gate → `31220000` →
  `31220100`. Hardened callers deploy immediately before the serialized enforcement/scheduled
  window and intentionally fail closed until the RPCs exist. Reverse recovery is
  `31220100 → 31220000 → 31213100 → 31213000 → 40338 → 40337`; every step preserves evidence and
  browser denial. Focused source/Worker tests and migration hygiene pass; the scheduled behavioral
  proof now includes final kill-switch/DND/consent race cases with zero attempt residue. The
  governed full database runner, supported-native adoption, remaining enforcement applies,
  pending-row decision, and signed-device proof remain explicit release gates. Compatible web
  callers are live on `dev` at merge `745de63c` through successful Cloudflare Preview deployment
  `7249c5de-a24d-4ffe-ba86-6a57168aa776`. The compatibility train is live on QA and production.
  No provider call, production-row mutation, production/main deployment, or device claim followed.
  PR #565's subsequent compatibility hardening is authored locally only: neither scheduled-delivery
  migration was applied in its work, and no flag, cron/scheduler, or provider was enabled or
  exercised. Its missing-schema path defers provider-free, and its unapplied reservation source is
  the authoritative final `America/Denver` quiet-hours boundary.

## QBO invoice/conversion recovery hardening — database applied; deployment gates remain

The owner-authorized production apply used the exact reviewed source at commit `3f61e7fa`:

- `20260731180000_qbo_estimate_conversion_concurrency.sql` → production ledger
  `20260731205928_qbo_estimate_conversion_concurrency`;
- `20260731210000_qbo_invoice_command_ledger.sql` → production ledger
  `20260731205942_qbo_invoice_command_ledger`.

The paired rollbacks remain available. GitHub CI's schema `verify` job passed; the governed
`db-lane` job passed. The later raw hosted receipt at `a513af37` is 163 / 375 assertions passed,
0 failed, 212 skipped, and 46 setup errors across 44 files. Assertions are gated at zero; setup
debt is shrink-only at 44 failed files / 90 recursively failed suite nodes. The compatible
Worker/client source is on `dev` but not yet `main`; it preserves one operation id across ambiguous provider and
post-provider-finalization failures, and
`/api/qbo-invoice` requires an active, non-external admin Bearer session rather than the shared QBO
server secret. Cloudflare deployment, authenticated-browser and Intuit provider/webhook evidence
remain owner/external release gates and must not be inferred from repository state.

## Deliberately deferred database sources — not current apply candidates

- `20260727022920_mobile_personal_ownership_boundary.sql` is **RETIRED / DO NOT APPLY**, not a
  deferred apply candidate. Its exact catalog preflight refused on both `qa-staging` and production
  after the focused native-token and preference lineage superseded its assumptions. Any remaining
  Page Access/Web Push hardening must ship as a new later migration that preserves the live
  notification/native-token contracts.
- Undated `tech_feedback.sql` is grandfathered live history superseded by
  `20260702_feedback_media.sql`; it is not pending and must not be reapplied.

A third QBO money-boundary migration is committed on `dev` and now present in the shared production
ledger. Its database rollout flag changed after the initial disabled apply proof:

- `20260731045407_qbo_multi_invoice_payment_receipts.sql`, merged to `dev` as `c41839b1` from
  `codex/qbo-multi-invoice-payments`, adds the disabled, service-only receipt/attempt/event
  foundation for one QBO Payment allocated across several invoices. The foundation is live in the
  shared ledger as `20260731225654_qbo_multi_invoice_payment_receipts`. Managed-default
  `service_role` grant drift found by the post-apply readback is closed by containment revision
  `52a07d9e`, live as `20260731230907_qbo_receipt_service_grant_containment`.
  `payment_receipts` and `payment_receipt_attempts` are service-role SELECT-only;
  `payment_receipt_events` has no direct service-role table privilege; all writes remain behind
  seven service-only RPCs. Staging repeated the full transaction-rolled-back behavior suite after
  containment with zero residue. A fresh production readback at `2026-07-31 23:43:23Z` shows
  `feature:qbo_receive_payment` enabled and not force-disabled, updated through an active internal
  admin employee identity; this supersedes the earlier disabled readback. Cloudflare Pages readback
  at `2026-08-01 00:14:45Z` shows `QBO_RECEIVE_PAYMENT_ENABLED=true` in **Preview** and no key in
  **Production**. The server gates are open on dev while the production Worker fails closed. PR #565
  additionally authors a local-only exact client gate, `VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED=true`;
  it defaults dark and has no hosted value/deployment proof, so it must not be read as grouped UI
  exposure. Receipt/attempt/event and receipt-linked payment counts remain zero, with no
  `qbo-receive-payment` Worker run or QBO event since the database-flag change. This reconciliation
  did not flip either QBO gate, exercise the provider path, create a QBO Payment, or call the
  sandbox. Authenticated end-to-end proof and `main` promotion remain absent.
  Roadmap: `docs/qbo-multi-invoice-payment-receipts-roadmap.md`.

## Applied and reconciled 2026-07-31

The reversible notification producer containment also applied from exact reviewed source:

- `20260731223000_notification_unsafe_producer_containment.sql` → production ledger
  `20260731225855_notification_unsafe_producer_containment`. All three `appointment.*` and both
  `timesheet.change_*` target catalog rows are disabled. The rollback was rehearsed on
  `qa-staging`, then the forward source was reapplied so QA also ends contained. No CallRail,
  provider, consent, message, appointment, or timesheet row/configuration changed. Re-enable only
  after caller-derived producer authorization and negative tests pass.
- Reviewed repair `20260801215912_notification_producer_authorization.sql` is applied to
  `qa-staging` only as hosted ledger
  `20260803182131_notification_producer_authorization`; it remains unapplied to the shared
  Production project. It binds browser actor IDs to `auth.uid()`, closes anonymous appointment access,
  applies locked crew diffs, makes crew identity immutable and active-internal-only, and
  serializes/idempotently retries timesheet decisions. Timesheet audiences and copy are rebuilt
  from locked database rows, time-request reads are requester-or-management scoped, and durable
  occurrence IDs plus atomic service-only bell/Web Push/email/APNs target claims bind every
  delivery to the exact current recipient, endpoint/email or raw iOS token and APNs environment.
  Exact policy/trigger/signature drift checks fail closed. Its recovery rollback is intentionally
  fail-closed, and both files keep the same five flags disabled. The later
  `20260802040935_preserve_notify_emit_event_id.sql` reminder-containment source is now in `dev`
  through PR #571 and composes with this boundary: it preserves producer-supplied IDs for
  non-guarded types, retains UUID plus occurrence-ledger validation for the five guarded types,
  records the exact validated predecessor, and rolls back to that predecessor rather than
  inferring it from retained evidence tables. QA applied that reviewed compatibility source next
  as hosted ledger `20260803182303_preserve_notify_emit_event_id`; neither migration is applied
  to the shared Production project. QA postflight confirms all five producer flags remain false,
  `appointment.reminder` is absent/fail-closed, the named reminder cron is absent, and both new
  private tables are empty with forced RLS and service-only access. The candidate includes the
  reviewed private-crew compatibility correction: non-manager field users cannot edit private
  crew, and unchanged crew skips the locked diff RPC. Prior reconciliation through `origin/dev`
  `8e51aa92`, build, full unit `1582/1582`, Worker `1945/1945`, QA `1037/1037`, focused
  producer/APNs `195/195`, producer/reminder QA `20/20`, private-crew `4/4`, changed-file lint,
  migration hygiene, and diff integrity pass. On 2026-08-02 the new project-scoped, pinned
  Supabase CLI `2.111.0` harness passed the exact train on two fresh loopback-only disposable
  stacks: baseline + synthetic seed; forward `20260801215912` → `20260802040935`; full negative
  authorization/RLS/deduplication/compatibility and lifecycle proofs; atomic current-target tests
  for APNs/Web Push/email; stale/deleted/reassigned target, inactive/external/removed-assignee,
  duplicate, and release/reclaim tests; reverse rollback; rollback lifecycle proof; and clean
  forward reapply. Runtime qualification exposed and fixed an
  information-schema reserved alias, a cross-table trigger field reference, an RLS proof that
  mistook filtered zero-row updates for SQL errors, and a default-privilege leak that had left
  excess `service_role` table rights. Exact ACL postflights now require no PUBLIC/anon/
  authenticated access, forward least-privilege service rights, and rollback SELECT-only evidence
  access. Every config/seed/proof source is now hash-manifested; the selected Docker engine must be
  a verified local socket/pipe; every Docker/Supabase command receives that exact context; and the
  database container label/network identity is checked before schema replacement. Both stacks,
  networks, and workdirs were removed after success. The final runner now refuses dirty runtime
  inputs and emits commit-bound evidence. The clean two-stack rerun passed on the non-rewriting
  reconciliation merge `1cec9b3beddb755d6c8e7a2fd58818c1f5880f10` with 13 pinned inputs and
  manifest SHA-256 `67a764fc77cfd5db77bc7aebe2ec4b8bc257ce21c1784801a4edd221fd73d149`;
  the full Node 22 gates and independent migration/security/release reviews also pass. Separately
  authorized QA qualification then completed with the exact source-to-ledger mapping above:
  catalog/postflight and governed hosted checks retained zero assertion failures, all five flags
  off, and no reminder cron. The hosted suite's 212 skipped assertions plus 46 setup errors across
  44 files / 90 suite nodes remain tracked baseline debt rather than substitutes for the clean
  two-stack behavior proof. Three
  unindexed foreign keys and pre-existing browser-role grants on three RLS/no-policy secret tables
  remain separate P2 cleanup work; neither was introduced by this candidate. Exact-head PR checks,
  merge, shared Production apply/deploy, activation, and device proof remain later gates. No
  deploy, delivery, flag, provider, Production SQL, or device action is implied.
- Separate live incident, read-only diagnosis on 2026-08-01: the reminder migration is recorded as
  production ledger `20260801232759_technician_quiet_time_and_appointment_reminders`, while
  Cloudflare Production remains main `478330d9`. That older Worker does not classify
  `appointment.reminder` as appointment-scoped, so two legitimate crew-specific reminder events
  for one appointment fell through to the four-admin default audience: eight bell rows total,
  four for non-current crew, between 20:59:00 and 21:00:02 America/Denver. Native delivery claims
  corroborate the two events; generic native copy came from the older Worker's missing reminder
  presentation. The five contained producer flags remain disabled and the repository-only producer
  repair was not involved. `appointment.reminder` is currently observed disabled, and fresh
  read-only evidence confirms the `upr_appointment_reminders` cron has zero rows. Production
  ledgers include the participant foundation/correction/authority containment plus reminder ledger
  `20260801232759`; QA contains only the three participant ledgers and does not contain the
  quiet-time/reminder migration. Keep reminders off and unscheduled until the repaired
  audience/presentation Worker is regression-tested with privacy-safe generic APNs copy, the
  caller-bound appointment-crew authorization migration is applied and negative-tested, and the
  exact Production revision is verified. Durable bell/Web Push/email replay claims are also an
  activation prerequisite. Any re-enable or reschedule remains a separate owner action.
- The production org's separate automated-SMS master switch is now
  `automation_settings.sms_sending_enabled=false`; the test org remains false.
  `missed_call_textback_enabled=true` remains configured for the production org but is inert behind
  that master switch. Staff P2P CallRail SMS/MMS does not read this switch and was untouched.

The owner-authorized release applied the exact reviewed committed sources to the shared
project (verbatim file content, per-file drift-guard preflights). Production ledger names
use their apply timestamps:

- `20260730170000_device_token_apns_topic.sql` → `20260731154315_device_token_apns_topic`;
- `20260730214500_pg_net_worker_url_allowlists.sql` →
  `20260731165215_pg_net_worker_url_allowlists`;
- `20260731100000_transcribe_call_cron_allowlist.sql` →
  `20260731174734_transcribe_call_cron_allowlist`; and
- `20260730150000_oop_pricing_builder.sql` → `20260731175328_oop_pricing_builder`;
- `20260726183409_inbound_lead_recording_source_boundary.sql` →
  `20260731225511_inbound_lead_recording_source_boundary`;
- `20260731045407_qbo_multi_invoice_payment_receipts.sql` →
  `20260731225654_qbo_multi_invoice_payment_receipts`; and
- `20260731231000_qbo_receipt_service_grant_containment.sql` →
  `20260731230907_qbo_receipt_service_grant_containment`.

Live postconditions passed: the four OOP private tables are forced-RLS with no browser table
grants, the exact role/flag boundary is enforced server-side, and published revision 1 plus draft
revision 2 each retain the 13-item legacy configuration. `device_tokens.apns_topic` is live with
one default-preserving enrollment RPC and zero raw-token policies/browser grants. Both pg_net
notifiers are allowlisted, fail closed on a blank secret and are service-role-only — the applied
bodies match the reviewed file md5s exactly (07ee1574… / c72e0f7f…). The two transcribe cron jobs
retain their names/schedules/payloads and now call postgres-owned, zero-grant allowlisted wake
functions. The OOP flag itself remains disabled, not force-disabled, and scoped to the existing
preview user; no global activation occurred. **The dev→main promotion gate carried by the
per-token topic migration is CLEARED** — the worker/client code may now reach production, and
all four ledger rows are mapped in the provenance manifest with fresh evidence.

Both formerly-pending migrations applied 2026-07-30 under explicit owner authorization:

- `20260729220000_tech_onboarding_state.sql` → live ledger `20260730115220`. Postconditions and an
  independent check passed (RLS enabled+forced, no browser-role table grant, `anon` EXECUTE false on
  both definer RPCs). The first-run tour is live; verified rendering all three screens.
- `20260728000000_sms_consent_opt_out_only.sql` → live ledger `20260730121811`. Its drift guard
  passed before replacement; live body still carries the DND, explicit-opt-out and pending-STOP
  refusals, and the function stays `service_role`-only. Opt-out-only is live for staff 1:1 only.
  Detail + rollback posture: `.claude/rules/sms-consent-model.md` §13.

The owner-only notification diagnostic ledger is also live:
`20260729181049_notification_delivery_diagnostic_claims.sql` → production ledger
`20260729183731`. During the separately authorized typed sweep, the owner reported receiving all
15 event types in the tested PWA/native presentation surfaces. This closes the synthetic
transport/presentation proof for that installed state, not the timing or activation of every real
producer.

## CRM lead value (2026-07-30, owner-directed standalone) — APPLIED

`20260730133000_crm_lead_value_from_claim.sql` → live ledger **`20260730155213`**. Proven on the
`qa-staging` branch first (all 7 behavioural scenarios PASS, including the multi-job sum), then
applied to production with 13 postconditions verified: 6 functions, `anon` EXECUTE false on every
one, both constraints validated, 3 triggers, the invoice trigger watching all 7 decision columns,
Won auto-advance preserved, and `crm_sync_lead_value` still present but unwired.

**The staging run earned its keep:** it caught `crm_backfill_lead_values` granted to `anon` (a
transcription slip in the apply payload, not in the reviewed file) plus two defects in the
behavioural test's fixtures. Apply the reviewed FILE, not a retyped copy.

Staff can type a lead's value by hand, and it
otherwise fills itself from billing: **the SUM of every committed invoice across ALL jobs under the
lead's claim** (88 of 157 claims have more than one job, so multi-job is the normal case).

- **This replaced a feature that was live but dead.** `20260721_crm_lead_value_sync.sql` had been
  applied for nine days and never ran once — 0 `crm_lead_value_synced` events, 0 of 156 leads valued
  — because its trigger was `AFTER INSERT ON invoices` gated on `total > 0`, while every invoice is
  inserted with no total and gets one later by UPDATE. The new trigger's `UPDATE OF` list names every
  column the calculation reads, and a CI test fails if that list and the calculation drift apart.
- **Owner rules:** a draft never counts; sent / QBO-emailed / converted-from-estimate / has-a-payment
  all do. The payment arm carries the rule (71 invoices have a payment vs 9 emailed, 4 from an
  estimate). A human-set value is never overwritten (`inbound_leads.value_source`).
- **Multi-tenant seam:** `claims`/`jobs`/`invoices`/`contacts` carry no `org_id` (only the CRM tables
  do), so the lead is the org anchor and the whole claim→jobs→invoices join lives in ONE function,
  `crm_lead_claim_value()`. Add the tenant predicate there when billing gains `org_id`.
- **Backfill RUN 2026-07-30 under explicit owner authorization**, 30-day window. Result: 12 leads
  attached to a single unambiguous claim (a 13th was already attached by the live trigger), **2 leads
  valued — $15,626.22 and $10,538.19 = $26,164.41** — matching the read-only dry run to the cent.
  0 failures, 0 manual values touched. Both figures independently reconciled against their claims'
  invoices; the $15,626.22 one sums **2 invoices across 2 jobs**, which is the multi-job case this
  feature exists for. Only 2 of 61 board leads valued because 41 have no claim yet — billing lags the
  call, and the triggers pick those up automatically as invoices are sent or paid.
  - Run as service role, because `crm_backfill_lead_values` gates on an active admin **session** and
    `auth.uid()` is NULL outside one (gate verified to fail closed). Scope was identical to that
    function. Attachments are audited as `crm_lead_claim_attached_backfill` — a distinct event type,
    so a backfill attachment is never mistaken for the claim-created trigger's own.
  - **To undo:** `UPDATE inbound_leads SET value = NULL WHERE value_source = 'auto';` and clear
    `claim_id` for the ids in the `crm_lead_claim_attached_backfill` events.
- Superseded `crm_sync_lead_value` is left in place, unreferenced — it is granted to `authenticated`,
  and dropping a live function is the contract removal `database-standard.md` §3 forbids.
- History for the completed CRM wave stays in `docs/archive/rules/crm-wave-ownership.md`; this entry
  is the live record. Delete it once the feature has baked.

## Standing operational state

- **Consent model:** opt-out-only for staff 1:1 service SMS + named typed transactional notices;
  everything automated/bulk/marketing is global-opt-in-only. Authority:
  `.claude/rules/sms-consent-model.md` §13 (a CI contract test reads it; §§12–13 were extracted
  verbatim 2026-07-31 when the completed sms-experience manifest was archived).
- **UPR Dev internal-TestFlight automation:** the repository source adds an isolated `.upr.dev`
  distribution configuration and a dev-only workflow. Every `dev` push runs credential-free tests
  only; each signed archive and each optional internal-TestFlight upload requires a fresh manual
  dispatch. The artifact embeds and verifies its dev origin, source SHA, Push/retirement mode, and
  production APNs contract. A Push-disabled replacement can retire only the OS-verified `.upr.dev`
  app's remembered owner-scoped token. Authorized dry archive run `30732945226` succeeded from exact
  `dev` source `e0a1ec6f` with `publish_to_testflight:false`, proving the `.upr.dev` distribution
  signature/profile and embedded dev-only native contract without an Apple upload or device
  delivery. The internal TestFlight group upload, install, and signed-device matrix remain owner
  gates. Official UPR remains manual/main-only; no Production or Cloudflare variable change is part
  of this slice.
- **Staging database:** Supabase branch `qa-staging` (ref `uizgwvkvzyldystqrcsk`) — **SEEDED
  2026-07-29; schema-usable and CI db lane LIVE, with initial catalog parity but a historical
  migration ledger that is not replay-compatible** (details:
  `docs/database/staging-branch-runbook.md`). It is the only hosted DB agents may write-test
  against. The fixture-password secret is configured, all three signed-in fixture identities were
  rotated, and the raw hosted receipt at `a513af37` is 163 / 375 assertions passed, 0 failed,
  212 skipped, and 46 setup errors across 44 files. Failed assertions are gated at zero; setup debt
  is shrink-only at 44 failed files / 90 suite nodes. Rebase currently fails at historical
  migration `20260312194505_001_phase_conversion_and_costing.sql` because the seeded schema already
  has dependent objects; do not call this migration-ledger parity or repair it with ad-hoc ledger
  writes. Open tail: convert failed setups/skips with minimal non-production reference rows and run
  the local SQL/pgTAP proofs through the still-missing governed local runtime.
- **A2P / live sends / provider webhooks / feature-flag flips:** owner-gated, always.

## Open initiatives (verdicts pending — see `docs/wip-inventory-2026-07.md`)

| Initiative | State | Archived manifest |
|---|---|---|
| **QBO multi-invoice payment receipts** | Source is on `dev`; exact prior deployment proof belongs to `52a07d9e`, while each newer reconciled head needs its own smoke; QA + shared schema/ACL applies verified; the database flag and Preview Worker gate are open, the Production Worker gate is absent/fail-closed, and sandbox/named-admin/provider proof is still missing, so `main` promotion remains gated | `docs/qbo-multi-invoice-payment-receipts-roadmap.md` |
| **Phase-scoped conversations** | **DECISION PENDING — owner has not chosen. See below.** | — |
| Messaging transport | Built, activation owner-gated | `docs/archive/rules/messaging-transport-wave-ownership.md` |
| Tech v2 Job Hub H3 cutover | Open, owner-bake-gated | `docs/archive/rules/tech-v2-wave-ownership.md` |
| Omni-inbox I/O/U | Unbuilt (O/U absorbed by sms-experience) | `docs/archive/rules/omni-inbox-wave-ownership.md` |
| Schedule Desktop A/B/C | Unstarted | — |
| UX alignment W1–W5 | Stalled since 2026-07-18; owner may restart from scratch | `docs/archive/rules/ux-alignment-wave-ownership.md` |
| DB foundation P2–P8 | Partially done (P3 tranches shipped) | `docs/archive/rules/db-foundation-wave-ownership.md` |
| App-store readiness F1/A/B/D | Source phases and historical TestFlight/Push matrix complete; current per-token-source second-account proof open; submission deferred behind the field-documentation plan | `docs/archive/rules/app-store-readiness-wave-ownership.md` |
| Agent QA access P2+ | Hosted branch/rotated fixtures live; zero assertion failures, but setup-suite/skip conversions and P2a local runtime remain | `docs/archive/rules/upr-agent-qa-access-ownership.md` |

## Phase-scoped conversations — OPEN QUESTION, no owner decision yet (raised 2026-07-30)

**Do not build any of this until the owner chooses a direction.**

**The problem (owner-stated, real):** one customer thread mixes three phases of the
relationship, and the wrong people see the wrong things. Sales negotiates pricing with a
lead; technicians then text the same customer about mitigation work and can read the sales
history. A customer asking for another quote pings the technician's phone. Months later
Marcelo/owner/Ben handle reconstruction — and mitigation technicians, long since finished,
still get notified about a project that is no longer theirs.

**Owner's proposal:** three phone numbers and three inboxes (sales / mitigation /
reconstruction), with per-inbox access so technicians only reach mitigation. A variant
considered and set aside: group texting, which needs RCS and cannot express the access
rules anyway.

**Counter-argument recorded (so this is not re-derived from zero):**
- Three numbers move the misrouting onto the customer, who cannot know the org chart. They
  save one number and text it forever.
- **STOP becomes legally ambiguous.** Consent keys on the contact's phone
  (`get_service_sms_consent_status`), not on which UPR number was texted. A STOP to the
  sales number either stops everything (so why three?) or is scoped per number, which is
  real TCPA risk at per-message penalties.
- Triples the A2P registration surface, which is already owner-gated and pending.
- Group chat is strictly worse: it puts access control inside the customer's phone, where
  a technician can never be removed from a thread.
- **The `conversations` table already carries `job_phase_context`, `job_id`, `assigned_to`
  and a per-conversation `twilio_number`** — phase-scoped threads with phase-derived access
  and notification audience are mostly a finishing job, not a rewrite. Notification audience
  by phase mirrors what `appointment_crew` already does for appointment Push.
- Inbound routing is the genuinely hard part either way (which thread does a reply join?),
  and needs a staff "move to…" control regardless of how many numbers exist — which is the
  argument that the extra numbers buy little.
- A second number **is** defensible for marketing-vs-service (different compliance class,
  different carrier treatment), but not for mitigation-vs-reconstruction, which is the same
  compliance class and the same project.

**Status:** the owner has heard the counter-argument and has NOT decided. When they do, this
is `/masterplan` work — it touches consent, notification audience, RLS and the inbox UI.
Fuller narrative: `docs/handoff/session-state-2026-07-30.md`.
