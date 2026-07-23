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

Detailed authority: `BILLING-CONTEXT.md`, `UPR-QBO-SYNC-PROTOCOL.md` and the current billing code/tests.

## CRM and leads

- A sale is `jobs.is_real_job = true`; phase, stage or invoice presence is not a substitute.
- Sale date is the documented claim/job creation fallback, with the deliberate commissions exception.
- A countable marketing lead is non-spam, non-merged, and a form or answered call.
- Speed-to-lead begins with the first human stage move; system moves do not count as response.
- Operational boards and marketing metrics intentionally have different inclusion scopes.
- Merged leads resolve to one canonical root and do not own independent stage state.
- Human Won/Lost decisions are sticky except for explicitly recoverable stages.
- Automated identity linking is auditable/reversible and follows one normalized phone rule.
- Public form acceptance flows through the Worker enforcement boundary: abuse controls, published
  schema validation, organization identity, request IP/user agent and consent evidence are
  server-derived. The underlying transaction RPC is not a second public entry point.

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
