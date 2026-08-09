<!--
FILE: docs/database-schema.md

WHAT THIS DOES (plain language):
  Explains where database truth lives, how the main data areas relate, and how to change or verify
  the schema safely. It does not pretend that migration files alone prove the live database state.

DEPENDS ON:
  Internal: .claude/rules/database-standard.md, supabase/migrations/, supabase/tests/,
            docs/generated/, db/baseline/, UPR-Web-Context.md
  Data:     reads → documentation and schema metadata
            writes → documentation only

NOTES / GOTCHAS:
  - One Supabase project backs staging and production.
  - Generated reports and snapshots are secondary evidence and can become stale.
-->

# Database and Schema

## Sources of truth

Use this order when determining database behavior:

1. Live Supabase catalog, policies, grants, functions, triggers, Storage policies and migration
   history, inspected read-only when available.
2. Applied migration SQL in `supabase/migrations/` and the actual function/trigger bodies.
3. Current callers and contract tests in `src/`, `functions/` and `supabase/tests/`.
4. `UPR-Web-Context.md`, this document and focused domain references.
5. Generated files in `docs/generated/` and `db/baseline/`, which are drift evidence rather than
   authority.
6. Historical plans, handoffs and dated audits.

Do not infer production database behavior solely from TypeScript/generated types, client models or
short documentation lists. Inspect migrations, SQL functions, triggers, policies, grants and the
live catalog.

## Environment constraint

The same Supabase project currently serves `dev` and production. A migration, RLS change, data
repair, cron change or test write against that project affects production immediately. Follow
`.claude/rules/database-standard.md` for additive sequencing, apply windows, rollback and public
allowlisting.

## Reviewed but unapplied: signed job-document privacy Phase 1

Migration `20260809010000_job_documents_private_bucket.sql` is authored but not present in the
shared live catalog. When separately approved and applied, it adds nullable, default-free
`job_documents.storage_bucket` (NULL means the existing `job-files` bucket), a private 50 MiB
`job-documents-private` bucket, and authenticated-only bucket-scoped SELECT/DELETE policies.
It performs no data backfill or object move. Do not treat this section as evidence that the column,
bucket, or policies exist live; follow `docs/job-files-privacy-roadmap.md` for release order.

## Last verified live baseline

Fresh read-only catalog inspection on 2026-07-24 00:20–00:21 UTC found:

- 133 public tables, all with RLS enabled;
- 373 public function overloads across 372 distinct names, of which 346 overloads are
  `SECURITY DEFINER`;
- six overloads executable by `anon` and 363 executable by `authenticated`;
- live migration-ledger entries on July 23 are `20260723215926 messaging_transport_foundation`,
  `20260723220207 messaging_transport_foundation_indexes`, and
  `20260723221707 exec_read_sql_containment`;
- `exec_read_sql(text)` is executable only by `postgres` and `service_role`;
- `upsert_lead_from_form(uuid,text,jsonb,jsonb,boolean,text,text,uuid)` still permits
  `PUBLIC`, `anon`, and `authenticated`; its reviewed ACL-only migration remains unapplied.

The generator-produced reports are in `docs/generated/`; the dated closure interpretation is in
`docs/audit/2026-07/evidence/engineering-foundation-documentation-closure-2026-07-23.md`.

The prior broad audit on 2026-07-22 found:

- 130 public tables, all with RLS enabled; 225 policies across 115 tables;
- 1,689 public columns, 247 foreign keys, 419 valid/ready indexes and 47 application triggers;
- 366 public functions, of which 345 are `SECURITY DEFINER`;
- 375 applied migrations, ten active cron jobs, two Storage buckets and three public Realtime
  publications.

That broader baseline is dated evidence, not a permanent constant. The sanitized query results, advisor
counts and exclusions are in `docs/audit/2026-07/evidence/live-supabase.md`.

Important verified exceptions and contained history:

- anonymous always-true policies remain on operational/customer/CRM tables deferred by the July
  closure wave;
- authenticated access remains broad, including 342 executable privileged-function overloads;
- the 2026-07-22 snapshot found `exec_read_sql(text)` callable by `authenticated`; the reviewed
  containment migration applied on 2026-07-23 and live role checks now deny `PUBLIC`, `anon`, and
  `authenticated` while preserving `service_role`;
- four live CRM migrations were applied from a then-unmerged feature branch; Foundation F2 restored
  only their byte-verified reviewed source to `dev` and added a read-only provenance gate. Ten of 11
  selected function bodies match byte-for-byte; `set_lead_caller_name` differs only in comments and
  was deliberately not replaced live. The restored set includes
  `get_crm_sales_summary(date,date) → json`, a stable read-only comparison of company-wide and
  CRM-traced won/revenue values. Live verification on 2026-07-23 confirmed its four-key numeric
  return contract, denial to `anon`, and execution for `authenticated`/`service_role`.

Treat the remaining exceptions as remediation targets, and the contained `exec_read_sql` exposure
as a standing regression prohibition, not a convention to copy. Apply evidence:
`docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`.

## Domain groups

| Domain | Representative objects | Primary invariants |
|---|---|---|
| Identity/access | `employees`, `nav_permissions`, `employee_page_access`, `feature_flags` | Auth user resolves to an active employee; roles/overrides and rollout remain distinct |
| Customers/operations | contacts, addresses, claims, jobs, rooms, notes, documents | UUID relationships, assignment and job/claim lifecycle integrity |
| Scheduling/field work | appointments, schedules, tasks, crews, time entries, equipment, readings | Timezone, assignment, status and mobile/offline convergence |
| Billing | estimates, invoices, line items, adjustments, payments, job costs, vendors | Generated totals and trigger-owned payment/invoice/job rollups |
| CRM | leads, stages, history, attribution, tasks, campaigns, sequences, automations | Canonical lead/sale rules, merge identity and auditable automated moves |
| Communications | conversations, messages, templates, consent, notifications, device tokens | Consent/DND, provider idempotency, delivery and recipient visibility |
| Contractor compliance | `contractor_compliance_profiles`, versioned documents, requests/deliveries/activity/attempts, audit snapshots, W-9 provider handoffs | Historical coverage, current vs audit readiness, private W-9s, scoped requests, durable reminder identity, sourced audit rosters, and annual QBO/Gusto handoff state |
| Integrations/operations | integration configuration/credentials, provider events, `worker_runs` | Service-only secrets, webhook deduplication and observable scheduled work |

Object names evolve; verify them against the current catalog rather than copying this table into
code.

## Contractor Compliance production contract

The additive Contractor Compliance foundation is live in the shared project under production
ledgers `20260803220653`, `20260803220656`, `20260803220659`, `20260803220704`, and
`20260803220711`. It references
`contacts.role = 'subcontractor'` as identity and does not write the legacy
`contacts.w9_on_file` or `contacts.coi_expiration` summaries. Its normalized profile, immutable
document-version, request, delivery, activity, and public-attempt objects preserve W-9 tax years
and insurance/waiver coverage intervals explicitly.

All new tables are forced-RLS and browser-inaccessible. Authenticated execution is limited to
role-redacted dashboard/detail RPCs that reconstruct an active internal employee: admin/office
manage; project managers receive readiness without W-9 metadata. Service-only Worker functions
own file ingestion, review/request transitions, public-token resolution/rate claims, and durable
reminder claims/results. The private `contractor-compliance-private` bucket has no browser object
policy. See `docs/contractor-compliance-roadmap.md` for the frozen status/date contracts and the
verified rollout evidence.

Two later migrations add annual workflows without changing the base truth model:

- named insurance audit periods materialize roster rows, accepted WC/waiver and GL coverage/gap
  intervals, document version references, and request/delivery snapshots. A locked period is
  immutable; `active_in_period` and `paid_in_period` remain nullable unless a manual or external
  source explicitly supplies them;
- `contractor_w9_provider_handoffs` stores only tax-year QuickBooks/Gusto external IDs, provider
  target, handoff/reconciliation status/date/reference, and actor/time.
  The admin/office-only checklist derives W-9 status from private document versions. There are no
  amounts, 1099 documents, recipient-access grants, delivery records, or provider-send functions.

Production postflight on 2026-08-03 proved 12/12 new tables have enabled and forced RLS, only
service-role table policies, no `anon`/`authenticated` table grants, no anonymous execution on
the target RPCs, a private 6 MiB PDF/JPEG/PNG bucket, the active daily
`upr_contractor_compliance_reminders_daily` cron, and no uncovered foreign keys. The feature and
reminder Workers are active in Production and remain disabled in Preview. One synthetic manual
request was delivered and then its canary profile was paused and made inactive; no real contractor
document has been imported.

## OOP pricing builder live contract

`supabase/migrations/20260730150000_oop_pricing_builder.sql` is the reviewed source contract for
versioned calculator pricing. It is live under reconciled production ledger row
`20260731175328_oop_pricing_builder`; staging qualification and separate live catalog checks
verified these objects and boundaries:

- `oop_pricing_revisions` stores one editable draft plus immutable published/superseded revisions;
- `oop_pricing_audit` records idempotent admin save/publish actions and their actor/payload hash;
- `oop_quote_save_requests` makes versioned quote saves replay-safe;
- `oop_quote_pricing_snapshots` privately pins the revision, submitted inputs, full config,
  evaluated lines, engine version and project-minimum adjustment for each configured quote;
- existing `oop_quotes` columns and table grants remain unchanged; replacement policies use the
  same calculator-access predicate as the RPCs;
- admin configuration RPCs require an active internal `admin`, while calculator read/save behavior
  requires an active internal `admin`, `office`, `supervisor`, `estimator` (sales rep), or
  `project_manager`. Those roles may access all OOP quotes company-wide; `field_tech`,
  `crm_partner`/external, inactive, unsupported, and unauthenticated actors are denied. A missing
  or force-disabled `tool:oop_pricing` flag also denies, and no direct browser access to the new
  tables is granted;
- `get_oop_quote_v2` merges an uncleared private snapshot into JSON without changing the legacy
  `get_oop_quote` composite-row contract; and
- `upsert_oop_quote_v2` validates input shape/bounds and pricing revision, calculates all persisted
  customer/internal amounts in SQL, enforces optimistic concurrency, and retains the legacy RPC
  signature for the code-first compatibility window; the replacement legacy body also validates
  and recomputes its persisted v1 total/margin while preserving the deployed signature and row shape.

The paired owner-gated operational rollback is
`supabase/rollbacks/20260730150000_oop_pricing_builder.rollback.sql`. The forward migration is
applied; the rollback remains a separate owner-authorized emergency action and retains private data
inert instead of dropping it.

### OOP quote to estimate contract (applied — ledger `20260803224628`)

`supabase/migrations/20260803192344_oop_quote_to_estimate.sql` adds nullable
`oop_quotes.converted_estimate_id` with a restrictive estimate foreign key and partial unique index.
`convert_oop_quote_to_estimate(uuid)` is an authenticated-only, billing-role-gated definer that
row-locks the quote, requires a job/contact and active canonical snapshot, inserts one draft
estimate plus customer-visible line items, verifies the generated estimate total against
`oop_quotes.quote_total`, and links the result atomically. Replays return the linked estimate.
Its gate is corrected by the **unapplied**
`20260807220000_oop_convert_estimate_billing_boundary.sql`: the applied body still reads
`role NOT IN ('admin','manager')`, and because `manager` is not an `employee_role` value that is
admin-only in practice — while the calculator's Create-estimate button gates on `canEditBilling`
(`admin`/`office`/`project_manager`), so office and project_manager saw an enabled button and got
42501. The successor calls `public.billing_edit_access()` instead of inlining a second role list
(owner decision 2026-08-07). It replaces the body **only**; every lock, idempotent re-entry,
snapshot requirement and total reconciliation above is byte-identical, and the grants stay
`authenticated`-only (no `service_role`, so the guard deliberately has no service-role
short-circuit). ⚠️ It is BUILT ON `20260807210000_oop_estimate_grouped_lines.sql`
(renumbered from `…190000` after a duplicate-version collision on dev — nothing in the tooling
detected that, which `tests/qa/unit/migration-version-uniqueness.test.js` now does). Apply order is
…210000 then …220000; a body-md5 drift guard aborts (SQLSTATE `55000`) on any other state, and the
rollback restores the grouped-lines body so grouped lines survive the undo.
Converted quotes are immutable so the pricing source cannot diverge from the official estimate.
`correct_oop_estimate(uuid,timestamptz,jsonb,jsonb)` row-locks the linked estimate, requires the
literal active internal admin plus OOP provenance, rejects an invoice-converted or stale estimate,
validates that the payload is the exact existing line-id set with bounded values, and applies the
address/line correction in one transaction. A response-loss retry with the old version succeeds
only when current content already equals the requested content. The same migration replaces the
broad internal Estimate/line `ALL` policies with broad internal `SELECT` plus
`billing_edit_access()`-gated writes.

The paired rollback refuses once any conversion exists. Isolated behavior coverage lives in
`supabase/tests/oop_quote_to_estimate_isolated.sql` and is included by the governed local OOP SQL
runner; the CI-visible source contract lives in
`tests/qa/unit/oop-pricing-estimate-conversion.test.js`. Neither test is evidence that the authored
migration is present on a hosted database.

## QBO command recovery production contract

Two sequenced, additive migrations now define the QBO invoice/conversion concurrency boundary:

- `20260731180000_qbo_estimate_conversion_concurrency.sql` preserves deployed signatures while
  locking same-estimate conversion and QBO decision application, making retry-event reclamation
  service-only, deriving invoice QBO lifecycle status in a trigger, and exposing a service-only
  compare-and-swap for `invoices.qbo_invoice_id` plus send metadata.
- `20260731210000_qbo_invoice_command_ledger.sql` adds `qbo_invoice_commands`, a forced-RLS table
  with no browser grants and a single service-role policy. One partial unique index serializes
  nonterminal commands per UPR invoice. Five service-only RPCs freeze command identity, realm,
  source intent, provider stage/request id/payload, result and terminal response. Browser commands
  require an immutable Auth user UUID; server-capability commands are explicitly system-attributed
  with both actor UUIDs null. The same-signature CAS replacement treats an already-applied target
  as idempotent success without changing the combined-billing rule that QBO invoice ids are
  intentionally non-unique.

Both migrations have paired, candid high-risk rollbacks. The owner-authorized production apply used
the exact reviewed source commit `3f61e7fa`; its ledger rows are
`20260731205928_qbo_estimate_conversion_concurrency` and
`20260731205942_qbo_invoice_command_ledger`. Catalog verification confirmed forced RLS,
service-role-only table/RPC ACLs, the actor constraint, pinned definer search paths and the enabled
lifecycle trigger; GitHub CI's schema `verify` and governed `db-lane` jobs are green. Compatible
Worker/client consumers ship in the same `dev` release as this documentation, but database and
repository state do not prove deployed Cloudflare, authenticated-browser, or provider/webhook
behavior.

## Change rules

- Create a reviewed migration first; do not hand-edit live schema as the lasting change record.
- Preserve deployed columns, RPC signatures and return shapes. Add new contract-compatible behavior
  before removing old behavior.
- Enable RLS on exposed tables and grant only intended roles. `TO authenticated` proves identity,
  not row ownership or role authorization.
- Do not use `USING (true)`/`WITH CHECK (true)` as a default template. Company-wide access requires
  an explicit data-classification decision; otherwise use role, assignment, ownership or
  organization predicates.
- New/replaced privileged functions explicitly revoke `PUBLIC`/`anon`, pin `search_path`, validate
  the caller and receive only the grants they need.
- `SECURITY DEFINER` is a privileged boundary, not a permission-error workaround.
- Free-form SQL RPCs must never be executable by browser roles or live in an exposed schema.
- Every update policy needs appropriate SELECT visibility plus `USING` and `WITH CHECK` semantics.
- Never expose service-role keys or client-readable credential values.
- Use `timestamptz`; business-day bucketing is `America/Denver`.
- Include concrete rollback instructions and schema-cache handling where applicable.
- Never write database-trigger/generated billing columns from app code.

## Verification workflow

1. Inspect current columns, constraints, indexes, policies, grants, functions, triggers and callers.
2. Decide which layer owns the invariant and write positive/negative contracts.
3. Review migration safety, public grants, lock scope, rollback and deployment ordering.
4. Apply only through the authorized shared-database workflow and record the exact migration state.
5. Verify every applied migration maps to a committed file reachable from the designated release
   branch; an emergency apply needs a recorded exception and immediate reconciliation.
   The current gate is `npm run validate:provenance`: its evidence must be recaptured read-only within
   six hours and it checks origin blobs, ledger coverage, capture ancestry, and selected function/policy
   fingerprints without executing SQL.
6. Query the intended behavior with the real role(s), not only a service-role client.
7. Run database security/performance advisors when access permits.
8. Regenerate `docs/generated/`/baseline evidence; never hand-edit generated reports.

## Messaging transport foundation (applied 2026-07-23)

The 2026-07-23 preflight confirmed that `messages` had legacy `twilio_sid`, broad
anonymous/authenticated table access, and no generic provider identity. Migration
`20260723215926_messaging_transport_foundation.sql` applied to the shared Supabase project after
the reviewed application code was deployed to `dev` and `main`. It adds:

- additive provider/message/conversation identity, actual sender/recipient, and
  `client_request_id` columns on `messages`;
- a service-only `message_send_attempts` idempotency/reconciliation ledger with canonical recovery
  snapshots and parent/recipient-child identity for multi-recipient provider effects;
- a service-only deduplicated `message_provider_events` inbox containing the minimum normalized
  text facts and UPR-owned private-media metadata needed for later domain recovery, but never raw
  payloads or provider MMS URLs;
- a service-only `message_notification_outbox` atomically enqueued by inbound projection, awakened
  after commit through an exact-URL scheduler-secret pg_net trigger, protected by a five-minute
  pg_cron due/stale-work safety net, and claimed through a fenced lease RPC. The lease prevents
  concurrent dispatch but does not make bell/push side effects exactly-once; stale recovery is
  explicitly at-least-once; and
- removal of anonymous and authenticated browser writes to `messages`, retaining only
  conversations-capability-gated reads for active non-external employees while service-role
  workers remain the only writers.

Post-apply verification confirmed all three service-only ledgers and the atomic claim/access RPCs
exist; `authenticated` retains `SELECT` only on `messages`, while `anon` has no message-table grant
and browser roles have no ledger grants. The migration ledger records the foundation at
`20260723215926` and its two advisor-driven outbox FK indexes at `20260723220207`.
Outbound provider selection remains a separate Cloudflare owner gate and is disabled by default.

Outbound MMS needs no new table. Its logical `messages.media_urls` value is an array of opaque
`upr-storage://message-attachments/outbound/...` references. The frozen message writer serializes
that array once before inserting it into the JSONB column, so historical canonical rows have JSONB
type `string`; the newer send-attempt ledger stores the equivalent value as a JSONB array.
Confirmation normalizes either representation before applying the same non-empty private-reference
checks. MIME type and byte size are retained by the private Supabase Storage object metadata and
revalidated from the object response and bytes before each provider submission. Provider-fetch
signed URLs are ephemeral transport artifacts and are never persisted. Sent, failed, and ambiguous
message objects remain durable for inbox history and retry. This repository slice intentionally
retains abandoned private uploads: safe cleanup needs a durable draft/claim model so deletion cannot
race a send or erase message history.

Retained CallRail provider events use the existing service-only `message_provider_events` table.
Migration source `20260724002500_callrail_event_recovery_scheduler.sql` adds no table, column,
policy, or browser grant: it only seeds a non-secret exact Worker URL, defines a locked-down
due-work wake helper, and schedules it every five minutes. It was owner-applied and verified on
2026-07-24 under ledger version `20260724002500`; the helper remains outside browser execution.
Live recovery then exposed that the prior PostgREST PATCH claim could mutate an event but return no
representation, causing the worker to skip a row it had already claimed. Migration
`20260724051500_claim_callrail_provider_event.sql` is live under ledger version `20260724051500`
and replaces that boundary with a service-role-only, invoker-mode RPC that atomically fences and
returns exactly one due event. It adds no table, column, provider send, or browser grant.
Read-only catalog verification confirmed the exact source fingerprint, empty `search_path`,
`SECURITY INVOKER` mode and service-role-only execution.

Twilio inbound parity is deployed inactive on `dev`, behavior-verified on isolated `qa-staging`,
and catalog-verified on the shared production project. Migration
`20260729211728_twilio_inbound_notification_parity.sql` adds no table, column, trigger, policy, or
provider configuration. It defines one `SECURITY INVOKER`,
service-role-only `project_twilio_inbound_event(uuid, boolean DEFAULT false)` projection over the
existing provider-event/message/outbox schema. The transaction shares CallRail's
`messaging-phone:<last10>` advisory-lock namespace, applies replay-safe STOP/START/HELP consent,
persists at most one MessageSid-addressed canonical SMS/MMS, increments unread only on insertion,
and inserts at most one outbox row keyed by `provider_event_id`. MMS is refused unless every
reference is under private `upr-storage://message-attachments/twilio/` ownership. The paired
rollback drops only this new function after compatible Worker code is rolled back; retained
event/message/outbox history is not deleted. The isolated behavioral source is
`supabase/tests/twilio_inbound_notification_parity_isolated.sql`. On 2026-07-29 the exact reviewed
migration (source SHA-256
`4f3859baba80d2f9d4d9801f7eaaba9e5cbfec564ed092eac575d1592cd6cf3f`) was applied only to
`qa-staging` under ledger version `20260729220202`. Catalog verification proved invoker mode,
`search_path=pg_catalog, public`, service-role-only execution, no `anon`/`authenticated` execution,
the internal service-role guard, shared phone lock, and outbox projection. The rollback-only SQL
proof completed without exception and a post-proof query found zero fixture residue across
employees, contacts, conversations, provider events, messages, outbox, and consent rows. The same
reviewed source was applied to the shared project under ledger version `20260729221116`. Its
deployed definition hash (`58b9d8db71347fb317145e683b8919db`), ACL, invoker mode, pinned search
path, caller guard, phone lock, and outbox markers exactly match `qa-staging`. Production received
read-only catalog verification only—no live write fixture or provider traffic. Local database
behavior remains unverified because the repository cannot reconstruct the legacy baseline.

Sanitized live evidence and apply-window recapture queries:
`docs/audit/2026-07/evidence/messaging-transport-2026-07-23.md`.

## Prior SMS consent attestation (applied and verified 2026-07-23)

Migration `20260724014423_attest_prior_sms_consent.sql` adds the current-state
`service_sms_consents` table, append-only `service_sms_consent_attestations` evidence history, and
the service-role-only `attest_prior_sms_consent` / `get_service_sms_consent_status` RPCs. Both
tables enable and force RLS, have only explicit `service_role` policies, revoke all privileges from
`PUBLIC`, `anon` and `authenticated`, and grant only the operations their server workflows use.
Contact foreign keys use `ON DELETE RESTRICT`, so a browser-permitted parent delete cannot silently
erase legally relevant consent evidence.

The attestation operation records the fixed
`service_related_customer_project_messages` scope, `prior_sms_consent_v1` version, Utah Pros
Restoration sender identity, consent method/date, evidence note, authenticated employee actor,
trusted server request IP and server timestamp. It upserts current service state and always inserts
a new row into the browser-inaccessible attestation history. The broadly readable legacy
`sms_consent_log` receives only a redacted event and opaque attestation ID—never the evidence note,
consent date or request IP. The operation never updates `contacts.opt_in_status`, so service
permission cannot become automated or marketing consent.

Both RPCs are `SECURITY INVOKER`, executable only by `service_role`, and pin an empty `search_path`.
Attestation revalidates an active internal admin/office actor, serializes on the same normalized
phone advisory lock as CallRail inbound projection, locks every duplicate contact and refuses DND,
`opt_out_at` or a durable pending STOP. The status RPC returns only a safe allow/deny decision and
requires the current contact phone, destination, suppression state, scope and version to agree.
Additive hardening migration `20260724043000_harden_service_sms_consent.sql` is live under
migration-ledger version `20260724043000`. It makes both RPCs lock and re-read the target contact
after entering the phone advisory-lock boundary and fail
closed if its normalized phone changed. It also permits only a processed START with a strictly
later `occurred_at` to supersede an unresolved STOP; equal timestamps leave STOP authoritative.
The attestation RPC holds a share lock on the employee row so role removal, deactivation or
externalization cannot race a consent record. Full live-definition hashes and exact-once patch
needles make the migration abort on any unreviewed source drift. Read-only catalog recapture
confirmed the signatures, empty `search_path`, `SECURITY INVOKER` mode and service-role-only
execution remain intact. The migration sent nothing and changed no existing consent row.

The exact migration blob from commit `e71e759b27b1da1fad713413c257b7059bd5905d` was applied to the
shared project under live migration-ledger version
`20260724035913_attest_prior_sms_consent`. Read-only catalog verification confirmed both tables,
forced RLS, the explicit service-role-only policies and grants, and browser-inaccessible invoker
RPCs. Rollback-only synthetic verification confirmed direct-service authorization, append-only
re-attestation history, legacy-log redaction, unchanged general opt-in, duplicate-contact DND
suppression and durable pending-STOP suppression. See
`docs/audit/2026-07/evidence/prior-sms-consent-live-apply-2026-07-23.md`.

### Signed UPR Work Authorization evidence (applied)

Migration `20260727005212_upr_work_authorization_sms_consent.sql` adds
`work_authorization_sms_consents`, keyed one-to-one by `sign_request_id` with restrictive foreign
keys to the contact and job. Each row snapshots the phone, trusted Cloudflare signer IP, signed
file path/time, fixed
`service_related_customer_project_messages` scope, `upr_signed_work_authorization` source, and
`upr_work_auth_sms_v1` disclosure SHA-256. The table enables/forces RLS and grants only
`SELECT, INSERT` to `service_role`; browser roles have no policy or privilege. Automatic evidence
is refused when the signing request has no server-observed signer IP. The broadly readable legacy
`sms_consent_log` receives only a redacted evidence reference and a null IP, never the signer IP.

The service-role-only `complete_sign_request_with_work_authorization_sms_consent(...)` invoker RPC
calls the existing deployed completion function and inserts qualifying evidence in the same
transaction. In that earlier migration, `get_service_sms_consent_status(uuid,text)` keeps its
signature and then-existing response vocabulary, checks DND/opt-out/pending STOP/global state first,
and accepts either the existing staff-attested service row or matching signed-authorization
evidence. The migration never updates `contacts.opt_in_status`. A concrete rollback restores the
read-only-captured pre-change status body before removing the wrapper/table. A read-only production
ledger check on 2026-07-31 verified it live as
`20260727041645_upr_work_authorization_sms_consent`.

### Direct-service implied SMS decision (applied)

Migration `20260728000000_sms_consent_opt_out_only.sql` keeps the frozen
`get_service_sms_consent_status(uuid,text) -> jsonb` signature and adds the distinct
`IMPLIED_CONSENT` response code after every existing DND, explicit opt-out, pending STOP,
duplicate-phone, phone-mismatch/change, global-opt-in, service-attestation, and signed-work-
authorization branch. It changes no table, column, policy, grant, or business row and reasserts
service-role-only execution.

An `allowed=true` response is not sufficient authorization to send: every service-role caller must
allowlist the returned code for its exact purpose. The staff-written direct 1:1 service-message path
accepts `IMPLIED_CONSENT`. A separate typed transactional-service registry initially allows
`appointment_scheduled`, `appointment_canceled`, and `signature_request` producers to accept
`SERVICE_CONSENT` or `IMPLIED_CONSENT`; these are reviewed registry entries, not a caller-controlled
label bypass. Each producer must derive its purpose, destination and approved copy from the
server-owned appointment or signature record, use a stable source-record/event delivery identity,
and durably audit `transactional_service_send_allowed` before provider selection. No automated
producer is live yet. Generic automation, scheduled free-form, group, broadcast, bulk, campaign,
and marketing paths accept `GLOBAL_OPT_IN` only. The concrete rollback restores `NO_CONSENT`.
A read-only production ledger check on 2026-07-31 verified the exact committed source live as
`20260730121811_sms_consent_opt_out_only`.

## Known limits

The repository does not by itself prove current live state after the dated capture. The July 2026
audit records the last verified catalog plus its exclusions in
`docs/audit/2026-07/evidence/live-supabase.md`, `docs/audit/2026-07/security-findings.md` and
`docs/audit/2026-07/coverage-ledger.md`. Backups/PITR, network restrictions, raw logs, external
provider state and representative-role behavior still require separate evidence.

Update this file in the same commit whenever schema ownership, database conventions, environment
topology or a cross-domain data relationship changes.

## Pending Encircle managed-credential extension

`20260723_encircle_managed_credentials.sql` is authored but not applied. It adds nullable
`managed_status`, `last_verified_at`, and `last_verification_status` columns to
`integration_credentials`, seeds an Encircle placeholder in `fallback` state, and seeds the
default-OFF `feature:encircle_managed_credentials` flag. The secret table retains zero RLS policies;
the migration also revokes unnecessary `anon`/`authenticated` table privileges. The status RPC keeps
its signature, becomes active-admin gated, and returns no secret fields.

## Conversation participant controls (release candidate; authority correction on qa-staging)

Migration `20260731040337_conversation_participant_scoping.sql` is recorded only on the isolated
`qa-staging` branch as ledger `20260731143710`; the shared production database is unchanged. It
adds forced-RLS, service-table-only `conversation_member_overrides` and
`conversation_default_members`, plus guarded RPCs for effective membership, administrator
management, technician self-leave, scoped contact/conversation creation, notification recipients,
message authors, and the existing inbox signature.

The QA-applied foundation's original appointment-derived rule is not the release authority.
Appointment, job, claim, and crew rows are browser-writable scheduling context and must never
authorize conversation access. Exact committed
`20260731213000_conversation_assignment_authority_containment.sql` is applied only to
`qa-staging` as ledger `20260801144448` (source SHA-256
`0c7b8769f53bbb45fd7d6127b86b88d53c4fc3101d3b7b72e2b6f51bb5c87f51`) and replaces
`messaging_employee_can_access_conversation`, `get_conversation_members`,
`find_or_create_scoped_conversation`, and `search_scoped_conversation_contacts` with the trusted
rule: privileged internal role → explicit per-chat override → default technician → deny. Its
preflight requires the exact contained `employees` identity posture plus an allowed QA or
production foundation lineage. Post-apply verification matched all four reviewed function
hashes/properties and ACLs, found no derived assignment authority, and retained zero pending
scheduled rows. Its paired rollback is a privileged-only recovery pause; it never restores
appointment-derived trust.

The additive compatibility migration
`20260731040338_conversation_unread_state_compatibility.sql` is also recorded only on
`qa-staging`, as ledger `20260731181046`; its two actor-derived RPCs, ACLs, pinned search paths,
and authorized/denied no-write behavior passed post-apply checks. Authored, unapplied
`20260731213100_conversation_participant_policy_enforcement.sql` must follow `31213000`. It
requires the exact policy/ACL allowlist across `conversations`,
`conversation_participants`, and `messages`, rejects extra policies or grants, narrows the
existing policies in place to participant-scoped reads with fail-closed writes, revokes every
authenticated direct write, and preserves service-role access. It also adds the service-only
`messaging_get_authorized_message_media(employee_id,message_id)` RPC, which returns canonical
media metadata only after the strict employee/conversation predicate succeeds; its rollback
revokes all execution.

Production release order is `40337 → 40338 → 31213000`, then verified compatible web and
supported-native adoption, then `31213100` only after older direct-unread writers are unsupported.
QA already contains immutable `40337/40338/31213000`; its next database step is `31213100` only
after compatible-caller verification. Historical
disposable proof for the superseded `40339` source is not proof of `31213000/31213100`. An earlier
corrected participant source passed on a disposable local clone; the exact current
authorized-media source has CI-visible contract coverage but still requires the full governed
runner. Reverse recovery is
`31213100 → 31213000 → 40338 → 40337`, and every step seals browser tables/RPCs rather than
restoring the historical broad posture.

## Scheduled-message delivery hardening (authored; not applied)

The reviewed, repository-only sequence `20260731220000_scheduled_message_delivery_compatibility.sql`
then `20260731220100_scheduled_message_delivery_enforcement.sql` hardens
`scheduled_messages` without representing either migration as live. The two stages must not be
collapsed or exposed to a mixed send path. First apply the participant correction, deploy
compatible web and supported-native callers, and apply participant enforcement. Deploy the
hardened web/Worker callers immediately before the serialized scheduled window; they fail closed
while the v2 RPCs are absent. Then apply compatibility and enforcement in order. No provider send,
database apply, or deployment is implied by the authored source.

Compatibility requires the exact `31213100` enforcement ledger/catalog posture. After taking the
queue lock it computes the aggregate `status = 'pending'` count and aborts the entire transaction
with SQLSTATE `55000` if the count is nonzero; it never quarantines, fails, or edits those rows.
Read-only production evidence on 2026-07-31 found exactly one such legacy pending row, so the live
apply is intentionally blocked until a separately authorized owner decision resolves it.
It adds nullable `claim_token` (the random fencing token for the current worker) and nullable
`delivery_attempt_id` (a restricted foreign key to `message_send_attempts`), plus a partial unique
index on non-null `delivery_attempt_id`. That
durable one-to-one link is the irreversible scheduled submission boundary: a linked row is
reconciled rather than claimed or submitted again, preventing a crash/retry from authorizing a
second provider invocation. It also creates a FORCE-RLS actor-derived creation-provenance ledger
that snapshots creator, conversation, canonical body/send time, recipient contact, and recipient
phone. Only a row matching that immutable snapshot may be claimed or reserved. Legacy
`claim_scheduled_message(uuid)` remains present and callable to its historical
authenticated/service roles as a `false` no-op. A stale caller therefore pauses normally before
provider submission instead of claiming an unreserved row. The same transaction changes every
historical `scheduled_messages` policy predicate to `false` and revokes browser table ACLs, so the
random `claim_token` is protected at both RLS and grant layers.

The final reservation transaction is also the last compliance authority before an attempt exists.
It resolves and share-locks the same earliest non-test-org
`automation_settings.sms_sending_enabled` row used by `sendGatedSms()`, then invokes the
service-role-only, phone-advisory-locked `get_service_sms_consent_status(contact_id, phone)`.
Scheduled free-form delivery accepts only `allowed=true, code=GLOBAL_OPT_IN`; `sms_disabled`,
DND, explicit opt-out, pending STOP, phone drift, service-only consent, implied consent, or an
unreadable status returns without inserting `message_send_attempts` or linking
`delivery_attempt_id`.

The browser path becomes actor-derived RPC-only. `create_scheduled_message` resolves the active,
internal actor from `auth.uid()`, requires the Conversations capability and current access to the
target conversation, stores that resolved employee as `created_by`, and accepts only exactly one
active customer participant with a non-empty phone. It stores that contact and the trimmed exact
phone address in provenance. Its caller-supplied UUID is an idempotency key: the same actor and identical
conversation/body/send time return the existing row, while a changed payload conflicts. Queue
reads and cancellation remain explicitly DevTools-owner-only contracts;
cancel may affect only an unreserved pending row and never clears an irreversible delivery link.

The worker lifecycle is a separate service-role-only, `SECURITY INVOKER` RPC set:
`claim_scheduled_message_v2`, release/fail by matching `claim_token`, reservation, and
reconciliation. Each has an in-function `current_user = 'service_role'` fence and no browser-role
execution. Reservation repeats the creator capability and conversation-access checks, exact
one-recipient check, immutable recipient contact/phone snapshot against the current participant,
and canonical-body check inside the transaction immediately before it creates and links the one
send attempt. That same transaction share-locks the current SMS kill-switch row and accepts only
the canonical consent RPC's exact `GLOBAL_OPT_IN` result; every denial returns without an attempt.
The Worker repeats
the creator and recipient checks at dequeue as defense in depth; removal, deactivation, capability
loss, or a recipient change therefore fails closed both before and at the final reservation
boundary. Every Auth/PostgREST/RPC/provider call on this path uses the bounded worker transport.
After reservation, Twilio credential resolution uses a fresh fail-closed managed-store read:
a timeout neither consumes a cache entry nor falls back to the Cloudflare environment credential,
and no provider request occurs.

Compatibility closes raw browser queue writes and changes the three historical queue policies to
explicit deny predicates in its own transaction. Enforcement reasserts that fail-closed
policy/ACL posture, retains the provenance boundary, and verifies that only `service_role` retains
ordinary table lifecycle privileges on `scheduled_messages`.
Browser callers retain only the actor-derived create, owner queue, and owner cancel RPCs. The
legacy claim signature remains a callable `false` no-op for compatibility, while the token-fenced
v2 lifecycle is the sole service path that can claim a row. An earlier source revision's paired
isolated database test passed `1/1` on a disposable local clone on 2026-07-31 with its transaction
rolled back. The exact current source adds explicit-deny policy and no-op assertions and still
requires the governed runner; CI-visible source tests guard the grant/policy sequence.

Both migrations carry rollbacks, but neither is a normal reversal. The full recovery-only reverse
chain is `31220100 → 31220000 → 31213100 → 31213000 → 40338 → 40337`. Every step preserves
provenance, delivery links, and the unique index; seals browser tables/RPCs; and refuses unresolved
linked pending work. Unknown provider outcomes require owner reconciliation and are never
automatically resubmitted. Run those rollback bodies only in a separately authorized recovery
window after caller reconciliation.

## Pending mobile messaging and CallRail reconciliation hardening

`20260724173000_harden_find_or_create_conversation.sql` changes no table shape. It preserves
`find_or_create_conversation(uuid) -> jsonb`, reuses only an active non-archived direct thread with
no different contact participant, keeps the advisory transaction lock, and changes the RPC to
`SECURITY INVOKER` with an in-function service-role assertion plus service-role-only execution.

`20260724174000_fix_callrail_outbound_phone_identity.sql` also changes no table shape or RPC
signature. It preserves the service-role-only, invoker-mode
`project_callrail_outbound_event(uuid,uuid)` contract while treating validated NANP ten-digit and
`+1` E.164 recipients as the same identity. Non-NANP addresses still require exact equality, and
body, provider-message, provider-conversation, state, and canonical-message checks remain binding.
Neither migration deletes or rewrites retained provider events.

`20260724193628_bind_callrail_outbound_mms_identity.sql` preserves that signature and adds a
defense-in-depth confirmation boundary: the provider event channel must equal the attempt channel,
and an MMS attempt must contain only non-empty private
`upr-storage://message-attachments/outbound/` references. A mismatch returns a non-success outcome
using the already-deployed `outbound_unmatched` contract before attempt, message, or provider-event
state changes. The worker enforces the same boundary before invoking the RPC. It is live under
ledger version `20260724195329`.

`20260724195802_accept_frozen_callrail_mms_media_shape.sql` keeps that contract and ACL while
normalizing the historical canonical JSON-string representation before validation. Invalid JSON,
non-arrays, empty arrays, non-string items, public/non-UPR paths, empty suffixes, traversal and
backslashes all remain fail-closed. It is live under ledger version `20260724200321`; rollback-only
live tests proved valid frozen rows confirm through the attempt-less fallback and malformed rows
remain unchanged with `outbound_unmatched`.

## Live mobile notification dispatcher boundary (S1d, applied 2026-07-27)

`20260726110000_notify_emit_service_boundary.sql` is live as ledger entry
`20260727233704 notify_emit_service_boundary`. It changed no table, trigger, schedule, policy,
configuration row, URL, secret, header, or response shape. It preserves
`public.notify_emit(p_type_key text,p_body jsonb) RETURNS void`, owner `postgres`,
`SECURITY DEFINER`, `search_path=public`, the catalog/URL no-op gates, and the existing
`net.http_post` transport. Its only body change reverses the top-level object merge so the trusted
`p_type_key` wins over a same-named key in `p_body`.

The ACL transition removes `authenticated` and leaves only the owner plus explicit
`service_role` execution; `PUBLIC` and `anon` remain denied. Three trigger functions, two timesheet
RPCs, and `scan_abandoned_clocks` account for the exact six live caller functions/seven call sites.
They are owner-run `SECURITY DEFINER` functions, and the abandoned-clock cron runs as `postgres`, so
the migration deliberately adds no in-body `current_user`/`auth.role()` check and rewrites no
caller. The forward and rollback scripts fail closed on the captured target/caller/trigger/cron
metadata. The rollback restores the exact prior body and `authenticated` grant and therefore
re-opens the browser capability.

A 2026-07-28 read-only recapture confirmed owner `postgres`, body hash
`27d638e9e2681bf74f17fa255c7eaf04`, `search_path=public`, and EXECUTE only for owner plus
`service_role`. Sanitized live metadata and the rollout/rollback record are in
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`.

## Live notification read receipts and recipient RLS (S1g, applied 2026-07-28)

`20260726260000_notification_read_recipient_boundary.sql` is live as ledger entry
`20260728192024_notification_read_recipient_boundary`. It adds
`notification_reads(notification_id, employee_id, read_at)` with cascading
foreign keys and primary key `(notification_id, employee_id)`. The table is forced-RLS, carries an
explicit authenticated deny-all policy, and grants no direct browser or service-role table access;
the owner-run guarded `SECURITY DEFINER` bell RPCs are its only access path.

The four existing bell RPC identities and result shapes remain unchanged. For broadcasts they
project an employee-specific receipt through the existing `notifications.read_at` field; targeted
rows continue using the base row. A non-null legacy broadcast `read_at` wins over any receipt so
historical globally-read rows do not reappear. Mark-one and mark-all insert broadcast receipts
idempotently and update only the authenticated employee's targeted rows.

The existing Realtime table stays published. Its `notifications_select` policy object is altered,
not dropped, from authenticated `USING (true)` to an active, non-external
`employees.auth_user_id = auth.uid()` own-or-broadcast predicate. Direct authenticated table access
becomes SELECT-only; `anon` loses table privileges and the obsolete authenticated
`notifications_delete_testrows` policy object is retained but altered to `USING (false)`. The apply
preflight pins the current employee
UUID/active/external columns plus authenticated employee SELECT/RLS policy because that table is an
explicit dependency of the notification predicate.

The exact checksum-pinned migration passed its value-free preflight, embedded and standalone
postconditions, disposable local Supabase forward/behavior/rollback sequence, and shared-project
catalog/role verification. Generated live schema/RPC reports and migration provenance were
refreshed after apply.
Rollback is owner-guarded because it drops receipt history. It fails browser/native bell RPCs and
Realtime table reads closed, preserves identity containment and recipient-scoped policies, and
retains only explicitly gated service-role compatibility. It never restores the cross-recipient
BOLA or the historical `anon` notification-table grant.

## QuickBooks Online attachments tracking (2026-07-24)

`20260724180000_qbo_attachments.sql` (**live under ledger version `20260724190829`**) adds one additive table,
`qbo_attachments`, that records files pushed to QuickBooks as Attachables for an invoice or estimate.
It stores metadata only — `entity_type`, `invoice_id`/`estimate_id` (exactly one, CHECK-enforced,
`ON DELETE CASCADE`), the opaque `qbo_attachable_id` (UNIQUE), `file_name`, `content_type`,
`file_size`, `include_on_send`, a UNIQUE `idempotency_key`, `created_by`, `created_at` — never the
file bytes (those live only in QuickBooks). RLS is enabled with a single SELECT policy scoped to
active `admin`/`manager` employees (`NOT is_crm_partner(auth.uid())` + an `employees` role check);
there is deliberately no INSERT/UPDATE/DELETE policy — the `qbo-attach` worker writes via the
service role. Rollback: `DROP TABLE IF EXISTS public.qbo_attachments;`.

`20260724180100_qbo_payments_sync_cron.sql` (**live under ledger version `20260724190848`**) changes
no table shape. It
seeds a non-secret worker-URL config row, defines the locked-down `qbo_payments_sync_poll()`
SECURITY DEFINER helper (REVOKEd from every role; exact URL allowlist; reads the existing
`integration_config.qbo_webhook_secret`), and schedules it hourly via pg_cron to activate the
QBO→UPR payment-sync safety-net poller (`/api/qbo-payments-sync`). Rollback: `cron.unschedule` +
`DROP FUNCTION` + delete the config row.

Its `upr_qbo_payments_sync_hourly` job is **running in production now** (`17 * * * *`), reaching the
already-deployed `https://utahpros.app/api/qbo-payments-sync` worker and returning HTTP 200. Both
migrations applied ahead of their own source reaching `dev`; that provenance gap is what the
2026-07-24 reconciliation closed. See `scripts/migration-provenance-manifest.json`.

`20260724200000_payments_qbo_dedup_index.sql` is **live under ledger version `20260724230933`**
(applied 2026-07-24 under owner authorization). It adds the partial UNIQUE index
`payments_qbo_payment_invoice_uniq` on `(qbo_payment_id, invoice_id) WHERE qbo_payment_id IS NOT
NULL`, so one QuickBooks payment cannot be recorded twice against the same invoice while still
permitting the sanctioned rule-11 multi-invoice split. It mirrors the pre-existing
`payments_stripe_charge_uniq` precedent on the same table.

Precondition verified before applying: **0** duplicate `(qbo_payment_id, invoice_id)` groups across
86 payment rows, so the index built cleanly. Verified after: present, `indisvalid AND indisunique`,
row count unchanged at 86 (no data change). It is written without `CONCURRENTLY` and takes an
exclusive lock — on an 86-row table that is a sub-millisecond window, but the same DDL against a
large table would not be safe to apply casually. Rollback:
`DROP INDEX IF EXISTS public.payments_qbo_payment_invoice_uniq;`.

Why it mattered: the QBO payment dedup was a non-atomic SELECT-then-INSERT with no constraint
behind it, and as of 2026-07-24 two feeds write payments (the hourly `upr_qbo_payments_sync_hourly`
poller and the real-time webhook), so overlapping runs could each read "absent" and both insert.

## QBO multi-invoice payment receipts (shared schema live; feature disabled)

Migration `20260731045407_qbo_multi_invoice_payment_receipts.sql` and its containment rollback are
live on `qa-staging` as `20260731223150` and the shared project as `20260731225654`. No receipt
feature gate or provider path was activated.

- `payment_receipts` is the grouped accounting header, uniquely identifying a QBO Payment by
  `(qbo_realm_id, qbo_payment_id)` and retaining totals, provider metadata, source, actor, status,
  and normalized snapshot.
- `payment_receipt_attempts` reserves realm-scoped unique client and Intuit request IDs plus the
  canonical request fingerprint before the provider mutation. A partial unique
  `(qbo_realm_id, qbo_payment_id)` fence prevents one provider Payment from binding to two durable
  attempts. Its status records submitting, provider-created, local-finalization, reconciliation,
  ambiguous, rejected, conflict, and terminal outcomes.
- `payment_receipt_events` is the append-only lifecycle/audit stream. Realm-scoped event keys,
  per-payment transaction advisory locks, provider version checks, and terminal tombstones make
  duplicate/out-of-order webhook and CDC work converge safely.
- `payments.receipt_id` links each active invoice allocation projection to its header. Only a
  service-role receipt worker can set or change that link: a `SECURITY INVOKER` trigger rejects
  every non-service JWT role. This migration also revokes all `anon` table privileges and drops the
  four inherited `allow_anon_{select,insert,update,delete}_payments` policies plus the broad
  `allow_authenticated_payments FOR ALL` policy. It replaces them with operation-specific policies:
  active internal employees may read payment history; only active, non-external admin employees
  (the effective `canEditBilling` role boundary) may insert/update/delete manual, ungrouped payments; and a
  browser insert must attribute `recorded_by` to the caller's employee row. Provider/grouped rows
  remain worker-owned. The existing
  partial UNIQUE `(qbo_payment_id, invoice_id)` contract is retained, with an additional unique
  `(receipt_id, invoice_id)` projection contract. Insert/delete still drives the established
  payment trigger; the receipt RPCs never write trigger-owned invoice/job totals.
- `qbo_events` gains QBO realm/entity/provider-update identity and bounded retry scheduling fields.
  `claim_qbo_receipt_event` atomically persists that retry identity with the event claim, and the
  recovery worker also reclaims metadata-bearing `processing` rows stranded for over ten minutes.

All three new tables have RLS enabled and forced with no browser grants. Managed defaults initially
left direct service-role writes; correction
`20260731231000_qbo_receipt_service_grant_containment.sql` is live on staging as `20260731230543`
and production as `20260731230907`. `payment_receipts` and `payment_receipt_attempts` are now
service-role SELECT-only; `payment_receipt_events` has no direct service-role privilege.
Seven worker-only `SECURITY DEFINER` functions—`claim_qbo_receipt_event`,
`reserve_qbo_payment_receipt`,
`mark_qbo_payment_receipt_created`, `finalize_qbo_payment_receipt`,
`reconcile_qbo_payment_receipt`, `remove_qbo_payment_receipt`, and
`fail_qbo_payment_receipt_attempt`—pin `search_path`, verify the service JWT role, revoke
`PUBLIC`/`anon`/`authenticated`, and grant only `service_role`. The first is the atomic retry-claim
boundary; the other six mutate receipt lifecycle state. Finalization/reconciliation reject empty or
over-100 allocation arrays, cross-contact/customer mappings, duplicate invoices,
fractional/imbalanced cents, and invalid payer/method values.

The operational rollback first requires the UI/Worker gates disabled, then removes only the new
RPC execution surface and force-disables `feature:qbo_receive_payment`. It deliberately retains
receipt, attempt, event, `payments.receipt_id`, its service-only link guard, the payments anonymous
access closure, and provider-event metadata as financial/audit evidence; destructive cleanup or
authorization reopening would require a separate owner-reviewed migration.

## Mobile S1e inbound recording-source boundary (live 2026-07-31)

Migration `20260726183409_inbound_lead_recording_source_boundary.sql` is live on `qa-staging` as
`20260731224513` and the shared project as `20260731225511`. It adds forced-RLS, service-role-only
`inbound_lead_recording_sources`, keyed one-to-one to `inbound_leads`. Provider URLs move there;
`inbound_leads.recording_url` remains in its deployed position but contains only the opaque truthy
marker `upr-recording://available`. An AFTER trigger captures new URLs once the lead ID exists and
immediately replaces the public value; a BEFORE payload trigger recursively removes
`recording`/`recording_url` keys from `raw_payload`. The ingestion adapter performs the same scrub
before RPC submission.

The migration removes anonymous privileges and authenticated direct DML, then replaces the broad
authenticated `ALL` policy with company-wide SELECT for active, non-external employees. That scope
is explicit because no employee-to-CRM-org or lead assignment relation exists.
`get_inbound_leads(integer) -> jsonb` keeps its signature/order/limit and adds the existing
admin-or-`crm_call_log` capability decision. Rollback restores raw URLs, the exact prior RPC,
grants/policy, and removes the companion table; it deliberately reopens scalar URL exposure.
Privacy-safe removal of recording keys from historical `raw_payload` is not reversible.

**Historical S1e/S1g apply-order prerequisite:** each target required the separately governed
`20260726180000_mobile_employee_identity_authority.sql` and
`20260726182000_mobile_employee_identity_containment.sql` sequence plus the compatible-client/
old-client decision. Their successful preflights proved there was no duplicate
`mobile_employee_identity_containment` ledger row and that the browser-read-only employee catalog
contract matched. Both targets remained separate owner-approved windows and are now live; do not
replay them. A future dependent migration must recapture the same catalog/ledger state.

## Retired mobile personal-ownership boundary (S1h, 2026-07-31)

The first three historical dependencies are live and mapped in
`scripts/migration-provenance-manifest.json`. The former final personal-ownership source is absent
from the shared ledger because it is retired, not pending:

- Live `20260726180000_mobile_employee_identity_authority.sql` creates three additive,
  selector-safe employee read RPCs and changes no existing table, policy, grant, row, or function.
- Live `20260726182000_mobile_employee_identity_containment.sql` is a later schema-last boundary. It
  removes browser employee writes, narrows direct identity reads, and gates existing roster and
  commission RPCs only after compatible clients are deployed.
- Live `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql` re-emits the
  already-live permission writer with its reviewed body fingerprint; behavior and grants do not
  change.
- Retired `20260727022920_mobile_personal_ownership_boundary.sql` would replace nine existing
  personal RPC bodies and combine page access, preferences, Web Push, and native tokens. Its exact
  preflight now refuses on both hosted databases because newer focused migrations changed those
  contracts.

The live permission dependency exists as assigned version
`20260727012825 permission_write_gates`; repository provenance maps it to reviewed source
`20260726220000_permission_write_gates.sql`. S1h accepts only that exact dependency and the separate
provenance reconciliation. Browser token conflicts are same-owner refresh only; cross-owner Web
Push/native token registration and deletion fail closed, while reviewed owner/service maintenance
remains.

The App Store activation path uses a smaller focused boundary:
`20260728223000_native_apns_token_boundary.sql` adds nullable
`device_tokens.apns_environment`, leaves existing rows inert, and introduces
selector-free `upsert_my_native_device_token(text,text) -> jsonb` plus
`delete_my_native_device_token(text) -> void`. The functions derive the active
internal employee from `auth.uid()`, never return a raw token, reject foreign
ownership, and are the only native-token RPCs granted to `authenticated`; direct
table access and legacy selector RPCs are revoked from browser roles. This
focused source is live under reconciled ledger row
`20260729021021 | native_apns_token_boundary`; 2026-07-30 readback confirmed
forced RLS and no direct `anon`/`authenticated` table privileges. The formerly
inert authenticated SELECT policy was removed by the live per-token-topic
migration below.

The ordered focused companion
`20260728224000_native_push_delivery_guardrails.sql` preserves the deployed
notification preference RPC signatures and return shapes while deriving browser
ownership from `auth.uid()`, removes the authenticated `notification_prefs_all`
policy's access additively by altering its predicates to false, removes direct
browser grants, and keeps service-role recipient resolution compatible.
It also adds private `native_push_delivery_claims` plus service-role-only
claim/release/compare-and-prune RPCs. Claims are keyed by the real source-event
occurrence and a non-reversible stable token/environment fingerprint; the
claim table has no token-row foreign key, so logout, cap pruning, stale-token
cleanup, and re-registration cannot erase replay history. Provider cleanup
still matches the observed token row/environment/`updated_at`, and a 410
deletion additionally requires Apple invalidation time not older than the
registration. A claimed-at index supports bounded cleanup
of at most 1,000 claims older than 90 days during each new claim, retaining a
long retry window without unbounded table growth. The claim table has an
explicit service-role-only RLS policy. Both focused migrations fail closed on
complete live function/ACL/overload contracts and new-object collisions; the
APNs environment check uses `NOT VALID` followed by `VALIDATE CONSTRAINT`.
The companion rollback requires an explicit unsafe session flag before restoring
the four exact prior RPC bodies/ACLs, because that compatibility rollback
deliberately re-opens the selector defect. This focused boundary means the deferred broad
S1h preflight intentionally refuses; the old file must not be reconciled into an apply candidate.

`20260730170000_device_token_apns_topic.sql` is live under reconciled ledger row
`20260731154315_device_token_apns_topic`. It adds nullable
`device_tokens.apns_topic` and atomically replaces the two-parameter enrollment
RPC with a single three-parameter definition whose trailing topic defaults to
NULL, preserving the shipped two-argument call. It removes the lingering
authenticated SELECT policy from the raw-token table, retains revoked browser
table privileges, returns only redacted registration metadata, and keeps NULL
legacy rows on the environment-level topic fallback.

The earlier `20260726223610_mobile_personal_ownership_boundary.sql` artifact is rejected evidence,
not an apply candidate. Its employee self-promotion and raw-token takeover paths are addressed by
the new containment and browser-RPC-only design. Credential-free static and exploit-negative tests
pass, but the exact checked-in forward/preflight/post-apply/isolated/rollback chain has not run in a
retained governed local database. Generated schema/RPC reports must continue describing deployed
state. The broad S1h file is retired; any residual Page Access/Web Push work must be a new later
migration that preserves the focused native/preference contracts. The two focused native migrations
are live under reconciled ledger rows `20260729021021` and `20260729021050`.

## Notification presentation settings (2026-07-29)

Migration `20260729163127_notification_presentation_settings.sql` adds two service-only tables:

- `notification_presentation_overrides`, keyed by `(type_key, surface)`, stores only validated
  title/body templates, an allowlisted route identifier, contract version, revision, and actor/time;
- `notification_presentation_audit` stores append-only before/after configuration, action, actor,
  request UUID, revision, and time. It stores no rendered customer/provider payload.

Both tables use forced RLS, explicit `service_role` SELECT policies, and revoke
`PUBLIC`/`anon`/`authenticated`. The sole writer,
`mutate_notification_presentation(uuid,text,text,text,jsonb,bigint,uuid) -> jsonb`, is a
service-role-only `SECURITY DEFINER` that pins `search_path`, revalidates an active internal admin,
serializes each event/surface, enforces optimistic revision/idempotency, and writes current state
plus audit atomically. Browser roles have no direct table or RPC path. The paired rollback is
`supabase/rollbacks/20260729163127_notification_presentation_settings.rollback.sql`.

The exact migration is applied and behavior-verified on isolated project `qa-staging`
(`uizgwvkvzyldystqrcsk`): browser-role table/RPC denial, replay, stale revision rejection, atomic
audit, and simultaneous first-write serialization passed. Synthetic rows were removed afterward.
The same committed migration is applied to shared production under ledger version
`20260729171946`. Post-apply inspection confirmed forced RLS on both tables, SELECT and RPC
execution denied to `anon`/`authenticated`, service-role-only access, the pinned definer
`search_path`, and zero override/audit rows. Application deployment status is recorded separately
in `UPR-Web-Context.md`.

Rollback is not routine compatibility work. It deliberately restores anonymous page-access
enumeration, broad browser table grants, foreign selectors, raw token visibility, and arbitrary
token mutation. It requires its explicit unsafe session flag plus a separate owner decision;
forward repair is preferred. See `docs/mobile/s1h-database-apply-runbook.md`.

## Notification delivery diagnostic claims (applied)

Migration `20260729181049_notification_delivery_diagnostic_claims.sql` adds one additive
service-only ledger keyed by `(employee_id, channel, request_id)`. The four channels are fixed to
bell, Web Push, native APNs, and transactional email. A pending row is inserted before the Worker
causes any delivery side effect; the bounded channel result is then stored as complete. A retry
returns the stored result, while a request left pending by an uncertain Worker failure remains a
no-op instead of risking a duplicate notification.

The table enables and forces RLS, grants no browser access, and stores no address, notification
copy, customer/provider payload, or credential. Its two `SECURITY INVOKER` RPCs pin an empty
`search_path`, assert `service_role`, revalidate an active internal admin for the claim, accept only
the fixed channels/result vocabulary, and are executable only by `service_role`. Claim cleanup is
bounded to 1,000 rows older than 90 days per new claim. The paired rollback removes both RPCs and
the additive history after compatible code stops calling them. A read-only production ledger check
on 2026-07-31 verified the exact committed source as
`20260729183731_notification_delivery_diagnostic_claims`; the compatible Worker/UI was deployed
before the owner-authorized live sweep.

## Five-producer occurrence and delivery claims (QA applied; Production pending)

Reviewed source `20260801215912_notification_producer_authorization.sql`, applied to QA only as
hosted ledger `20260803182131_notification_producer_authorization`, adds two private tables there:

- `notification_producer_occurrences` gives only the three appointment and two timesheet producer
  types one unique occurrence key/UUID; and
- `notification_delivery_claims` gives bell, Web Push, and transactional email a deterministic
  per-occurrence/employee/target claim.

Both tables force RLS and grant no browser access. Occurrences are insertable only inside the
private database producer helper; direct `service_role` access is SELECT-only. Claims are
inserted/deleted only by `SECURITY INVOKER`, `service_role`-asserting RPCs in the application path;
the underlying claims table grants `service_role` only SELECT/INSERT/DELETE so the invoker RPCs can
operate without UPDATE/TRUNCATE/REFERENCES/TRIGGER rights. The recovery rollback revokes the
forward RPCs and leaves both private evidence tables SELECT-only to `service_role`, with no
PUBLIC/anon/authenticated ACL. Claims contain UUID
fingerprints, not addresses, notification copy, provider payload, or credentials, and cleanup is
bounded to 1,000 rows older than 90 days.

The migration alters the existing `appointments`/`appointment_crew` policies in place, removes
anonymous ACLs, and scopes private rows to admins/project managers/assigned crew. A separate write
predicate reserves private crew-membership changes and privacy elevation to active internal
admins/project managers, so an assigned crew member cannot delegate private-row access. Public
appointment mutations require a scheduling role (admin/office/project manager/supervisor) or an
existing crew assignment. The additive nullable `appointments.created_by_employee_id` is
server-bound from `auth.uid()` on new browser rows and immutable thereafter, allowing the creator
to finish the existing create-then-assign flow without granting access to somebody else's
appointment. Update/delete RPCs enforce the same object predicate. The migration preserves the
deployed appointment/timesheet/notify RPC signatures and return shapes and replaces destructive
crew rebuilding with a locked set diff. Browser updates can change a crew row's role but a trigger
makes its `id`, `appointment_id`, and `employee_id` immutable, preserving the assignment identity
bound into `appointment.assigned` occurrences; direct insert/update targets must also be active
internal employees. It also replaces the broad authenticated
`time_entry_change_requests` SELECT policy with an active-internal requester-own-row or
admin/office/project-manager/supervisor predicate. Delivery validation joins every recipient back
to the exact appointment crew row, appointment crew set, timesheet admin audience, or request
owner represented by the occurrence. The guarded native claim combines that predicate with exact
device-token ownership inside the same insert statement before APNs. Guarded Web Push/email claims
combine it with the exact current subscription ID/employee/endpoint or normalized employee email
before provider use; bell uses the parallel occurrence validator. Preflight/postflight require exactly the expected policy
sets and enabled trigger bindings, including no `WHEN`, `UPDATE OF`, or trigger-argument narrowing.
Its recovery rollback contains all five flags first and retains authorization/occurrence evidence
rather than recreating the unsafe boundary.
On 2026-08-02, the exact pinned train passed forward behavior/lifecycle, reverse rollback, rollback
lifecycle, and clean forward reapply on two fresh disposable local stacks. The behavior proof
executes the current APNs token/environment, Web Push subscription/endpoint, normalized email,
active-internal recipient, current appointment assignment, duplicate, and release/reclaim
predicates. That local qualification found and fixed PostgreSQL compilation/trigger defects plus
an excess default `service_role` table grant before hosted qualification. All proof/config/seed
sources are manifest-pinned and the runner verifies its local Docker engine/container identity;
the clean commit-bound two-stack rerun passed at merge `1cec9b3b` with manifest
`67a764fc77cfd5db77bc7aebe2ec4b8bc257ce21c1784801a4edd221fd73d149`.
QA then applied the dispatcher compatibility source `20260802040935` next as hosted ledger
`20260803182303_preserve_notify_emit_event_id`. Final QA readback found both private tables empty,
forced RLS, no browser-role access, and the expected least-privilege service access. The five producer
flags remain false; `appointment.reminder` and its cron are absent. Three new foreign keys lack
leading indexes and require a separate additive P2 migration before Production apply/activation.
The shared Production project has neither migration.

## Appointment crew atomic save and audit successor (live)

Production has the immutable bridge ledger
`20260804003152_sync_appointment_crew_enum_authorization_hotfix`. The
forward-only migration
`20260804000910_appointment_crew_atomic_save_and_audit_repair.sql` pins and
accepts both exact function lineages and is live on QA as
`20260804060640_appointment_crew_atomic_save_and_audit_repair` and on
Production as
`20260804061426_appointment_crew_atomic_save_and_audit_repair`. QA's accepted
predecessor remains `20260803182131_notification_producer_authorization`
followed by `20260803182303_preserve_notify_emit_event_id`. The successor
leaves applied sources unchanged and adds no table, column, or enum label.

The successor replaces the same-signature
`sync_appointment_crew(uuid,jsonb)` body with a locked, validated, explicit
`public.crew_role` set diff. It adds the trigger-only
`audit_appointment_crew_change()` function and
`trg_appointment_crew_actor_audit` so each inserted, removed, or role-changed
assignment writes actor/before/after/timestamp evidence to `system_events`.
One additional command event stores the complete old and new crew only when
the desired set actually differs. Existing assignment UUIDs and timestamps are
preserved for unchanged people.

Two additive RPC names provide transactional application commands:

- `create_appointment_with_crew(...) -> jsonb` creates the appointment, crew,
  existing task assignments, and cloned task templates in one transaction.
- `update_appointment_with_crew(...) -> jsonb` combines core/reschedule status
  history, privacy, client-notify preference, crew, and task replacement in one
  transaction; `p_crew = NULL` and `p_task_ids = NULL` preserve those sets,
  while an explicit empty array clears the corresponding mutable set.
  `p_set_time_start`, `p_set_time_end`, and `p_set_notes` distinguish an
  explicit nullable-field clear from an omitted partial-update field.

The two browser crew/atomic commands, the service-only
`sync_appointment_crew(uuid,jsonb,uuid)` attribution overload, plus the
same-signature legacy
`update_appointment`, `assign_tasks_to_appointment`, and
`delete_appointment` functions are `SECURITY DEFINER`, owned by `postgres`,
pin an empty `search_path`, revoke default/public/anonymous execution, and
grant only the intended browser or service role for each signature. Browser
actors are derived from `auth.uid()` and must be active, internal,
non-external, and not `crm_partner`. Trusted service create/update/delete calls
and the service-only crew overload require an explicit employee actor that
meets the same predicate. Crew-only changes use the owner-approved
all-active-internal policy; appointment fields, privacy, and task changes
retain the narrower existing object and manager checks. Update authorization
uses supplied parameter intent rather than stored-value equality, preventing
private-row equality probes.

Both `appointments` and `appointment_crew` explicitly have RLS enabled.
Current application source uses the atomic RPC boundary. Phase A temporarily
retains authenticated SELECT/INSERT/DELETE plus non-identity column UPDATE on
`appointments`, and SELECT/INSERT/UPDATE/DELETE on `appointment_crew`, for
already-installed native builds. Appointment policies plus the command guard
enforce actor/object/privacy rules; `id`, `job_id`, `kind`, `created_by`, and
the QA-lineage `created_by_employee_id`, and `created_at` have no authenticated
UPDATE grant. Crew policies plus the audit trigger
enforce the all-active-internal policy, immutable assignment identity, valid
targets, and old/new/time evidence. Anonymous table access and TRUNCATE remain
denied. `service_role` retains appointment SELECT plus column-scoped UPDATE
solely for the deployed calendar/client-notification compare-and-set on
`client_notified_at` and `client_time_sig`, plus crew SELECT; it has no
appointment insert/delete or raw
crew mutation. Other controlled server writes use the explicitly attributed
RPCs. Phase B removes
the authenticated compatibility DML
only after supported-native adoption is evidenced. Destructive privileges on
`system_events` are revoked from browser and normal service roles, preserving
its actor/old/new/time evidence. The paired recovery rollback deliberately
keeps the safer bodies, RLS policies, audit trigger, and evidence but revokes
all eight command-entry grants and all direct appointment/crew table writes. That
is an operational appointment/crew-write outage until forward reapply, not a
restoration of either unsafe predecessor.

The eighth entry point is the existing `merge_jobs(uuid,uuid) -> jsonb`
signature. The successor preserves its atomic 28-table merge contract but
replaces the unguarded definer with an empty-search-path, active-internal-admin
implementation. It alone may reparent `appointments.job_id`, records the
employee actor and appointments moved in `job.merged`, denies service and
non-admin execution, and leaves crew rows attached to their unchanged
appointment IDs.

The exact committed source passed two-lineage forward/rollback/reapply
qualification before either hosted apply. QA subsequently passed the complete
transaction-rolled-back behavior proof. Production read-only catalog
postflight confirmed all 19 marked functions, role-specific grants, RLS and
the exact eight authenticated policies, both enabled triggers, Phase-A
table/column ACLs, the `lead`/`tech`/`helper` enum, and the non-null
`'tech'::crew_role` default. No Production behavior fixture or customer row was
used.
