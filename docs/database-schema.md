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
| Integrations/operations | integration configuration/credentials, provider events, `worker_runs` | Service-only secrets, webhook deduplication and observable scheduled work |

Object names evolve; verify them against the current catalog rather than copying this table into
code.

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

### Signed UPR Work Authorization evidence (repository only; not applied)

Migration `20260727005212_upr_work_authorization_sms_consent.sql` proposes
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
read-only-captured pre-change status body before removing the wrapper/table. None of this is live
until separately applied and verified.

### Direct-service implied SMS decision (repository only; not applied)

Migration `20260728000000_sms_consent_opt_out_only.sql` keeps the frozen
`get_service_sms_consent_status(uuid,text) -> jsonb` signature and adds the distinct
`IMPLIED_CONSENT` response code after every existing DND, explicit opt-out, pending STOP,
duplicate-phone, phone-mismatch/change, global-opt-in, service-attestation, and signed-work-
authorization branch. It changes no table, column, policy, grant, or business row and reasserts
service-role-only execution.

An `allowed=true` response is not sufficient authorization to send: every service-role caller must
allowlist the returned code for its exact purpose. Only the staff-written direct 1:1 service-message
path accepts `IMPLIED_CONSENT`. Automated, scheduled, group, broadcast, bulk, campaign, and
marketing paths accept `GLOBAL_OPT_IN` only; `SERVICE_CONSENT` also remains direct-staff-only.
The concrete rollback restores `NO_CONSENT`. Until the exact migration is separately reviewed,
authorized, applied, and verified, the live database does not return `IMPLIED_CONSENT`.

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

## Pending mobile notification dispatcher boundary (S1d, 2026-07-26)

`20260726110000_notify_emit_service_boundary.sql` is authored and locally tested but **not
applied**. It changes no table, trigger, schedule, policy, configuration row, URL, secret, header,
or response shape. It preserves
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

Because the migration is unapplied, it is intentionally absent from the live provenance manifest.
Add a ledger mapping and fresh function fingerprint only after an owner-authorized apply from the
reviewed release commit. Sanitized live metadata and the rollout/rollback record are in
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

## Mobile S1e inbound recording-source boundary (authored 2026-07-26)

Migration `20260726183409_inbound_lead_recording_source_boundary.sql` is reviewed source only and
has not been applied. It adds forced-RLS, service-role-only
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

**S1e/S1g apply-order prerequisite:** before either target’s own entry gate, separately apply and
verify `20260726180000_mobile_employee_identity_authority.sql`, deploy compatible
browser/PWA/native clients and retire old clients or record the owner’s explicit risk decision,
then separately apply and verify `20260726182000_mobile_employee_identity_containment.sql`. Current
S1e and S1g preflights fail closed unless exactly one live `mobile_employee_identity_containment`
ledger row exists and its browser-read-only employee contract still matches. Recapture that
catalog/ledger state before the target preflight. This prerequisite neither authorizes nor combines
S1e or S1g; each remains its own owner-approved window.

## Pending mobile identity and personal ownership sequence (S1h, 2026-07-27)

S1h now consists of four reviewed source migrations, all absent from the shared live ledger:

- `20260726180000_mobile_employee_identity_authority.sql` creates three additive,
  selector-safe employee read RPCs and changes no existing table, policy, grant, row, or function.
- `20260726182000_mobile_employee_identity_containment.sql` is a later schema-last boundary. It
  removes browser employee writes, narrows direct identity reads, and gates existing roster and
  commission RPCs only after compatible clients are deployed.
- `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql` re-emits the
  already-live permission writer with its reviewed body fingerprint; behavior and grants do not
  change.
- `20260727022920_mobile_personal_ownership_boundary.sql` replaces nine existing personal RPC
  bodies, adds one private owner-only helper, forces RLS on `employee_page_access`,
  `notification_prefs`, `push_subscriptions`, and `device_tokens`, and removes every browser policy
  and table privilege from those four tables. Their columns, constraints, indexes, triggers,
  publications, views, and business rows remain unchanged.

The live permission dependency exists as assigned version
`20260727012825 permission_write_gates`; repository provenance maps it to reviewed source
`20260726220000_permission_write_gates.sql`. S1h accepts only that exact dependency and the separate
provenance reconciliation. Browser token conflicts are same-owner refresh only; cross-owner Web
Push/native token registration and deletion fail closed, while reviewed owner/service maintenance
remains.

The earlier `20260726223610_mobile_personal_ownership_boundary.sql` artifact is rejected evidence,
not an apply candidate. Its employee self-promotion and raw-token takeover paths are addressed by
the new containment and browser-RPC-only design. Credential-free static and exploit-negative tests
pass, but the exact checked-in forward/preflight/post-apply/isolated/rollback chain has not run in a
retained governed local database. Generated schema/RPC reports must continue describing deployed
state; none of these source migrations is live or `ready_for_apply`.

Rollback is not routine compatibility work. It deliberately restores anonymous page-access
enumeration, broad browser table grants, foreign selectors, raw token visibility, and arbitrary
token mutation. It requires its explicit unsafe session flag plus a separate owner decision;
forward repair is preferred. See `docs/mobile/s1h-database-apply-runbook.md`.
