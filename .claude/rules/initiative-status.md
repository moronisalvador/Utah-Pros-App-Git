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

The 2026-07-27 `dev → main` promotion hold is **RELEASED** (owner-authorized). Promote from a
quiet `dev` and re-check `git rev-list --left-right --count origin/main...origin/dev` immediately
before promoting.

## QBO invoice/conversion recovery hardening — database applied; deployment gates remain

The owner-authorized production apply used the exact reviewed source at commit `3f61e7fa`:

- `20260731180000_qbo_estimate_conversion_concurrency.sql` → production ledger
  `20260731205928_qbo_estimate_conversion_concurrency`;
- `20260731210000_qbo_invoice_command_ledger.sql` → production ledger
  `20260731205942_qbo_invoice_command_ledger`.

The paired rollbacks remain available. GitHub CI's schema `verify` and governed `db-lane` jobs are
green. The compatible Worker/client source in this `dev` release preserves one operation id across
ambiguous provider and post-provider-finalization failures, and `/api/qbo-invoice` requires an
active, non-external admin Bearer session rather than the shared QBO server secret. Cloudflare
deployment, authenticated-browser and Intuit provider/webhook evidence remain owner/external
release gates and must not be inferred from repository state.

## Deliberately deferred database sources — not current apply candidates

- `20260726183409_inbound_lead_recording_source_boundary.sql` remains reviewed source only. It
  requires its compatible Worker deployment plus a fresh ledger/catalog recapture and serialized
  owner-authorized apply window.
- `20260727022920_mobile_personal_ownership_boundary.sql` remains source-hardened and unapplied.
  Focused preference/token boundary work changed its expected input state, so its preflight should
  refuse until the source and evidence are reconciled and re-qualified.
- Undated `tech_feedback.sql` is grandfathered live history superseded by
  `20260702_feedback_media.sql`; it is not pending and must not be reapplied.

A third isolated QBO money-boundary migration is authored and remains unapplied to production:

- `20260731045407_qbo_multi_invoice_payment_receipts.sql` on
  `codex/qbo-multi-invoice-payments` adds the disabled, service-only receipt/attempt/event
  foundation for one QBO Payment allocated across several invoices. It has a containment rollback
  and locally green source/static tests. On current `origin/dev` base `4bdb815a`, `npm test` passes
  4,162 tests with zero unexpected skips; build, changed-file lint, bundle strict, and migration
  hygiene pass; independent Worker-security, migration, grant/secret, project-law, design, and
  lifecycle reviews pass. The migration and three supporting foreign-key indexes are applied to
  `qa-staging`; forced-RLS/grant/flag readbacks and the complete transaction-rolled-back SQL behavior
  suite pass with zero fixture or receipt residue. It has **not** been applied to the shared project;
  no deploy, QBO Payment, or feature/env activation occurred. The Intuit Development sandbox matrix,
  authenticated browser QA, disabled code-first deployment, shared-DB apply, and named-admin proof
  remain release gates.
  Roadmap: `docs/qbo-multi-invoice-payment-receipts-roadmap.md`.

## Applied and reconciled 2026-07-31

The owner-authorized release applied the exact reviewed committed sources to the shared
project (verbatim file content, per-file drift-guard preflights). Production ledger names
use their apply timestamps:

- `20260730170000_device_token_apns_topic.sql` → `20260731154315_device_token_apns_topic`;
- `20260730214500_pg_net_worker_url_allowlists.sql` →
  `20260731165215_pg_net_worker_url_allowlists`;
- `20260731100000_transcribe_call_cron_allowlist.sql` →
  `20260731174734_transcribe_call_cron_allowlist`; and
- `20260730150000_oop_pricing_builder.sql` → `20260731175328_oop_pricing_builder`.

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
  Detail + rollback posture: `.claude/rules/sms-experience-wave-ownership.md` §13.

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
  `.claude/rules/sms-experience-wave-ownership.md` §13 (kept in place — a CI contract test reads
  it).
- **Staging database:** Supabase branch `qa-staging` (ref `uizgwvkvzyldystqrcsk`) — **SEEDED
  2026-07-29, parity-verified, CI db lane LIVE** (details: `docs/database/staging-branch-runbook.md`).
  The only hosted DB agents may iterate against. Open tail: test-fixture seed to retire the
  shrink-only failure baseline (`scripts/qa/db-lane-baseline.json`).
- **A2P / live sends / provider webhooks / feature-flag flips:** owner-gated, always.

## Open initiatives (verdicts pending — see `docs/wip-inventory-2026-07.md`)

| Initiative | State | Archived manifest |
|---|---|---|
| **QBO multi-invoice payment receipts** | Source implemented in isolated branch; review/sandbox/apply/release owner-gated | `docs/qbo-multi-invoice-payment-receipts-roadmap.md` |
| **Phase-scoped conversations** | **DECISION PENDING — owner has not chosen. See below.** | — |
| Messaging transport | Built, activation owner-gated | `docs/archive/rules/messaging-transport-wave-ownership.md` |
| Tech v2 Job Hub H3 cutover | Open, owner-bake-gated | `docs/archive/rules/tech-v2-wave-ownership.md` |
| Omni-inbox I/O/U | Unbuilt (O/U absorbed by sms-experience) | `docs/archive/rules/omni-inbox-wave-ownership.md` |
| Schedule Desktop A/B/C | Unstarted | — |
| UX alignment W1–W5 | Stalled since 2026-07-18; owner may restart from scratch | `docs/archive/rules/ux-alignment-wave-ownership.md` |
| DB foundation P2–P8 | Partially done (P3 tranches shipped) | `docs/archive/rules/db-foundation-wave-ownership.md` |
| App-store readiness F1/A/B/D | Source phases, signed archive/IPA, internal TestFlight, and production Push matrix complete; second-account proof + App Store submission tail open | `docs/archive/rules/app-store-readiness-wave-ownership.md` |
| Agent QA access P2+ | P1 done; P2a gated on local runtime | `docs/archive/rules/upr-agent-qa-access-ownership.md` |

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
