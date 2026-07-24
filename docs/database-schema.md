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

Outbound MMS needs no new table or migration. Its canonical `messages.media_urls` value is an array
of opaque `upr-storage://message-attachments/outbound/...` references. MIME type and byte size are
retained by the private Supabase Storage object metadata and revalidated from the object response
and bytes before each provider submission. Provider-fetch signed URLs are ephemeral transport
artifacts and are never persisted. Sent, failed, and ambiguous message objects remain durable for
inbox history and retry. This repository slice intentionally retains abandoned private uploads:
safe cleanup needs a durable draft/claim model so deletion cannot race a send or erase message
history.

Retained CallRail provider events use the existing service-only `message_provider_events` table.
Migration source `20260724002500_callrail_event_recovery_scheduler.sql` adds no table, column,
policy, or browser grant: it only seeds a non-secret exact Worker URL, defines a locked-down
due-work wake helper, and schedules it every five minutes. The migration is repository-authored
but unapplied; activating it affects the shared production database immediately and therefore
requires a fresh owner-approved apply window.

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
Pending additive hardening migration `20260724043000_harden_service_sms_consent.sql` makes both
RPCs lock and re-read the target contact after entering the phone advisory-lock boundary and fail
closed if its normalized phone changed. It also permits only a processed START with a strictly
later `occurred_at` to supersede an unresolved STOP; equal timestamps leave STOP authoritative.
Applying the follow-up alone sends nothing and changes no existing consent row.

Pending additive hardening migration `20260724043000_harden_service_sms_consent.sql` makes both
RPCs lock and re-read the target contact after entering the phone advisory-lock boundary and fail
closed if its normalized phone changed. It also permits only a processed START with a strictly
later `occurred_at` to supersede an unresolved STOP; equal timestamps leave STOP authoritative.
The attestation RPC holds a share lock on the employee row so role removal, deactivation or
externalization cannot race a consent record. Full live-definition hashes and exact-once patch
needles make the migration abort on any unreviewed source drift.
Applying the follow-up alone sends nothing and changes no existing consent row.

The exact migration blob from commit `e71e759b27b1da1fad713413c257b7059bd5905d` was applied to the
shared project under live migration-ledger version
`20260724035913_attest_prior_sms_consent`. Read-only catalog verification confirmed both tables,
forced RLS, the explicit service-role-only policies and grants, and browser-inaccessible invoker
RPCs. Rollback-only synthetic verification confirmed direct-service authorization, append-only
re-attestation history, legacy-log redaction, unchanged general opt-in, duplicate-contact DND
suppression and durable pending-STOP suppression. See
`docs/audit/2026-07/evidence/prior-sms-consent-live-apply-2026-07-23.md`.

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
