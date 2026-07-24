<!--
FILE: docs/business-rules.md

WHAT THIS DOES (plain language):
  Records the business definitions that code must preserve across screens, Workers and database
  logic. It also names which layer should enforce each kind of rule.

DEPENDS ON:
  Internal: BILLING-CONTEXT.md, UPR-QBO-SYNC-PROTOCOL.md, docs/crm-lead-lifecycle.md,
            functions/lib/sms-consent.js, functions/lib/automated-send.js
  Data:     reads → documentation and implementation contracts
            writes → documentation only

NOTES / GOTCHAS:
  - Detailed domain guides remain authoritative for worked examples and exceptions.
  - Do not copy a rule into multiple layers without naming the enforcement boundary here.
-->

# Business Rules

## Enforcement boundary

Do not duplicate business rules across UI, API, Edge Functions and SQL without documenting the
enforcement boundary.

| Rule type | Primary enforcement | Mirrors allowed for |
|---|---|---|
| Cross-client data invariant | Constraint, trigger or RPC | UI explanation and pre-validation |
| Provider/secret side effect | Worker/server | UI eligibility and status display |
| Authorization | Worker/RPC/RLS | Route/navigation UX |
| Presentation-only choice | Client | Native/web variants when equivalent |
| Provider webhook normalization | Ingest adapter + durable canonical fields | Reporting helpers using the canonical fields |

If the same predicate must exist in SQL and JavaScript, identify them as twins, test the same cases
against both and change both in one commit.

## Billing and money

- Money remains human-in-the-loop: AI/extraction/builders prepare drafts; a person explicitly posts
  or saves financial transactions to QBO.
- `invoice_line_items.line_total` and payment-derived invoice/job totals are database-owned. App code
  writes inputs and payment rows, not generated/trigger-owned totals.
- The billable amount is `adjusted_total ?? total` where the established billing contract requires it.
- QBO customer identity exists before invoice push.
- A job can have multiple invoices; supplements do not silently rewrite a completed/paid invoice.
- Imported provider payments carry stable external identity and source so they do not re-push.
- Retries of money movement use a stable idempotency key and durable attempt/reconciliation state.
- Financial dates use the Denver business day, not UTC string slicing.
- Invoice/estimate attachments are admin/manager-gated and human-selected: a person chooses which
  file(s) to push to which QBO invoice/estimate (via `/api/qbo-attach`), never an automatic batch.
  They are pushed with `IncludeOnSend` so they ride along on the QBO-sent email; attach before send.

Detailed authority: `BILLING-CONTEXT.md`, `UPR-QBO-SYNC-PROTOCOL.md` and the current billing code/tests.

## CRM and leads

- A sale is `jobs.is_real_job = true`; phase, stage or invoice presence is not a substitute.
- Sale date is the documented claim/job creation fallback, with the deliberate commissions exception.
- A countable marketing lead is non-spam, non-merged, and a form or answered call.
- Speed-to-lead begins with the first human stage move; system moves do not count as response.
- Operational boards and marketing metrics intentionally have different inclusion scopes.
- CRM sales headlines are CRM-traced; when company-wide context is shown, both traced and total
  won/revenue values come from `get_crm_sales_summary` for the same Denver-day window and are
  explicitly labeled. Do not calculate the comparison independently in the UI.
- Merged leads resolve to one canonical root and do not own independent stage state.
- Human Won/Lost decisions are sticky except for explicitly recoverable stages.
- Automated identity linking is auditable/reversible and follows one normalized phone rule.
- Public form acceptance flows through the Worker enforcement boundary: abuse controls, published
  schema validation, organization identity, request IP/user agent and consent evidence are
  server-derived. The underlying transaction RPC must not be a second public entry point.
  `20260723235900_public_form_rpc_boundary.sql` implements that ACL contract in source but is
  unapplied as of 2026-07-23; until its serialized apply, direct browser execution remains a known
  live exception rather than an enforced rule.
- The Webflow form adapter requires its configured shared secret and fails closed if the expected
  database/environment value is missing; there is no unauthenticated bootstrap mode.

Detailed authority and open rulings: `docs/crm-lead-lifecycle.md`.

## Messaging and consent

- Automated SMS requires a valid number, positive opt-in and no DND.
- A global kill switch precedes consent evaluation.
- Recipient-local quiet hours defer messages rather than silently dropping them.
- STOP/START/HELP, suppression, delivery status and consent changes are durable/auditable.
- Automated sending uses the shared compliant send path; no alternate provider call bypasses gates.
- Provider retries distinguish transient from permanent failures and remain idempotent.
- Email and SMS have different consent models; do not reuse one predicate for the other.
- A caller-supplied boolean or IP address is not consent evidence by itself. Consent records must
  originate from the approved server path and bind the rendered disclosure/version, submitted
  choice, server-observed request context and resulting contact.
- Valid service-message permission may also have been obtained verbally on a customer call or in
  writing, including an SMS clause in a signed work authorization. Authorized admin/office staff
  may attest that verified prior permission only by recording its method, date and evidence note;
  UPR records their server-derived identity, audit timestamp, attestation version, Utah Pros sender
  identity and the fixed `service_related_customer_project_messages` scope. Contact existence, an
  assumed business relationship, or merely lacking a STOP record is never permission. This
  attestation does not authorize promotional, campaign or unrelated message subjects.
- Prior-consent attestation is not re-subscription. It never clears manual DND, STOP, provider
  opt-out or `opt_out_at`; customer re-consent after revocation follows the established inbound
  START/affirmative written path.
- Verified service-message permission is stored separately from `contacts.opt_in_status`. It is
  consumed only by the direct staff person-to-person send boundary and never authorizes a group,
  broadcast, automated, campaign, bulk or promotional send. Recording it cannot itself trigger a
  send or retry. Each attestation preserves raw evidence in service-only append history; the legacy
  consent log receives only redacted reference metadata.
- Staff messages still send only through `POST /api/send-message`. Every message identifies Utah
  Pros Restoration, and the first outbound message in a conversation includes “Reply STOP to
  unsubscribe.” A separate outbound SMS asking an unconsented number to opt in is prohibited; staff
  instead records consent already obtained through the approved evidence flow.
- CallRail's text API is restricted to a staff-triggered, person-to-person send. UPR scheduled,
  automated, group, broadcast, bulk and campaign sends must never use it.
- CallRail inbound STOP/START/HELP changes the same canonical consent/DND state as Twilio, but UPR
  must not auto-send the keyword reply through CallRail. HELP requires a staff response until an
  owner-approved provider-native compliant mechanism is evidenced.
- Outbound message images are canonical private objects, never public customer-photo URLs. The
  current cross-provider envelope is one verified JPEG, PNG, or GIF up to 5,000,000 bytes. Clients
  keep only an opaque private reference; provider-specific byte upload or signed fetch exposure
  happens after consent inside the selected adapter.
- A messaging-provider failure does not fall back to another provider or channel. Ambiguous
  provider timeouts are reconciled before any retry that could duplicate a customer message.
- RCS is a channel inside the existing messaging domain, not a new consent or conversation domain.
  Canonical records distinguish the requested channel from the provider-confirmed actual channel.
- Twilio provider-managed RCS-to-SMS/MMS fallback is prohibited. It may be enabled only by a
  separate owner-approved policy/schema/consent rollout that records the fallback and proves both
  channels are permitted for that purpose.
- An RCS Sender identity is not a phone number. Preserve typed sender/recipient addresses and never
  use a provider sender, Messaging Service, template, or provider thread as UPR conversation
  identity.
- RCS STOP/START/HELP, rich quick replies, delivery/read receipts, and action payloads enter through
  authenticated provider webhooks and update the same canonical consent/audit domain idempotently.

Detailed transport authority: `docs/messaging-transport-roadmap.md` and
`docs/messaging-rcs-readiness.md`.

For a direct staff send, `client_request_id` identifies one user action. A transport retry must
reuse it; reusing it with changed recipient/content/media/provider is a conflict. An accepted or
ambiguous attempt is returned/reconciled rather than automatically submitted again. Internal notes
remain provider-free, and group/broadcast sends cannot enter the CallRail adapter.

## Capability links and public documents

- Public signing links are capabilities: unguessable token, explicit status, expiration and
  revocation are enforced in the database retrieval/mutation boundary.
- Expired, completed or revoked tokens disclose no signer/job/claim payload through direct RPCs.
- Public document access returns a minimal purpose-built DTO or signed object URL, not a full
  internal row or listable bucket.

## Identity, rollout and access

- Authentication, employee membership, authorization and feature rollout are separate decisions.
- UI gates are not sufficient for money, PII, company messaging or administrative operations.
- Force-disable, employee overrides, admin/role permissions and rollout flags retain their documented
  precedence.

## Time

- Store timestamps as `timestamptz`.
- Business-day/week bucketing uses `America/Denver` unless a documented external contract explicitly
  requires another zone.
- Tests cover Mountain midnight and daylight-saving boundaries.

## Account deletion and retention

- Users request account deletion; an authorized administrator verifies and fulfills the request.
- Login/session access is revoked as part of fulfillment.
- Shared job, claim, time, photo and financial records may be retained only under the approved
  business/legal retention policy; personal data is deleted or anonymized where required.
- Request status, actor, decision, retained-data treatment and requester communication are auditable.

## Change duty

When a change introduces, removes or reinterprets a business rule, update this file and the detailed
domain guide in the same commit. Add regression tests at the primary enforcement boundary and at any
documented twin. Dated unresolved findings live in `docs/audit/2026-07/`.

## Credential rotation

- A candidate provider credential is validated with a read-only provider request before it becomes
  active; failure leaves the current credential and technician workflows untouched.
- A migration fallback is allowed only while explicitly marked `fallback`. An explicit `disabled`
  state suppresses the legacy environment credential.
- Provider keys are write-only to the browser. Status may disclose connection state, safe account
  labels, and verification time, never the credential or raw provider error body.
- Old credentials are revoked only after every surviving runtime is inventoried, deployed against
  the managed source, and smoke-tested.

## Mobile person-to-person messaging

- Starting a conversation is not consent and never sends a message.
- A contact's presence in UPR is not consent evidence. Direct SMS/MMS stays blocked until the
  authoritative consent decision allows it; loading, read failure, DND, STOP, phone mismatch, and
  missing evidence fail closed.
- Active internal admin/office employees may attest documented prior service consent. Technicians
  may view the blocked state but cannot create the evidence record.
- Recording consent never automatically sends or retries a draft. Staff must explicitly press Send,
  and the server rechecks the complete consent/DND boundary.
- Internal notes remain available when customer messaging is blocked because they do not leave UPR.
- CallRail is person-to-person only. Scheduled, automated, group, bulk, campaign, and broadcast
  sends never use it.
