# Initiative Status — Live Coordination State

**Last verified:** 2026-07-31 · This is the ONE always-loaded file recording what is currently in
flight, leased, or unapplied. Full initiative manifests live in `docs/archive/rules/` — they are
history, not law. When an initiative completes, delete its row here; when one starts, add a row
and a roadmap. Do not let this file grow past ~1 page — that is how the last rulebook died.

## Active leases (check before touching a shared hotspot)

**None.** No file or seam in this repository is currently under a sole-writer lease.

*(Released 2026-07-29: the mobile current-origin reconciliation lease over `.claude/**`,
`AGENTS.md`, `CLAUDE.md`, `tooling/**` and the mobile integration seams — owner accepted the
handback. Its work landed in `dev` via PR #525, merged 2026-07-27; the holder branch
`codex/mobile-readiness-current-origin-review` had zero commits not already in `dev` at
acceptance.)*

The `dev → main` promotion hold is **ACTIVE** by owner direction on 2026-07-31. Draft PR
[#565](https://github.com/moronisalvador/Utah-Pros-App-Git/pull/565) stays open for dev testing and
cross-session reconciliation; do not mark it ready, merge it, or otherwise promote `main` until the
owner gives a new explicit instruction. Re-check the exact remote tips and PR head before any later
promotion.

## Conversation participant scoping — QA foundation only

- Compatible foundation `20260731040337_conversation_participant_scoping.sql` is applied **only**
  to isolated `qa-staging` as ledger `20260731143710` from reviewed commit `0d5b7fab` (source
  SHA-256 `f9bb379dc794be199cbe6f9e057d5582b61eee71f12e913c9b7a18ad4c6cb1cb`). Catalog
  verification passed: both new membership tables use forced RLS, browser roles cannot read them,
  their rows remain empty, the intended RPC signatures/grants are present, and the legacy browser
  INSERT compatibility window remains open. Nothing was applied to the shared production project.
- `20260731040338_conversation_unread_state_compatibility.sql` is also applied only to
  `qa-staging`, as ledger `20260731181046`, from immutable reconciled candidate `487ec641`
  (source SHA-256 `727669d58ed55ccac46673c4db3f8ac354406f00b791097ef44d98b1a9e88e3d`).
  Catalog checks confirmed its two actor-derived RPCs, pinned `search_path`, intended
  `authenticated, service_role` grants, and `anon=false` execution; an authorized empty-input,
  nonexistent-conversation denial, and unmapped-actor denial proof completed inside a rolled-back
  transaction. `20260731040339_conversation_participant_policy_enforcement.sql` remains unapplied
  everywhere.
- The release candidate now routes unread changes through the compatibility RPC,
  checks membership before sends/notes, resolves inbound notification recipients canonically,
  uses scoped contact search/creation, purges expired inbox/thread/draft caches, and revokes direct
  browser writes in `40339`. The enforcement migration alters the existing policies in place with
  fail-closed write checks rather than dropping them, and `40338` completes the required
  service-role grants without changing the exact `40337` source staged on QA.
- Required order: `40337` + `40338` are one indivisible compatibility apply unit. Apply `40338`
  immediately after `40337` in the same separately authorized window, without exposing an app
  between them. If `40338` fails, immediately run the paired `40337` rollback so the shared catalog
  is never intentionally left in the intermediate grant posture. Only after both apply and catalog
  verification may compatible web and supported native code deploy/promote; then apply `40339` in
  its own reviewed window after older native callers no longer depend on direct writes.
- The guarded behavior suite passed locally on 2026-07-31 against a disposable Colima/Supabase
  baseline clone with `40337`–`40339` applied; all fixtures rolled back. Capacitor sync, unsigned
  Xcode simulator compilation, and an iPhone 17 Pro Simulator smoke passed: sender labels/readable
  bubbles, title-expanded info, and the native participant sheet rendered. The sheet's RPC
  correctly failed against production because `40337` is not live there. Physical-device and
  supported native-release evidence remain gates. No shared-database apply, push, deploy, or
  enforcement is authorized by this status entry.

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
  **Production**. The two gates therefore expose the admin workflow on `dev`, while the production
  Worker fails closed. Receipt/attempt/event and receipt-linked payment counts remain zero, with no
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
  the six SQL/pgTAP proofs through the still-missing governed local runtime.
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
