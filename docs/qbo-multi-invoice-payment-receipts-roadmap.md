# QBO Multi-Invoice Payment Receipts

**Status:** Source is on `dev`, with exact prior deployment proof at `52a07d9e`; every newer
reconciled head requires its own deployment/smoke readback. `qa-staging` and shared-database
migrations are verified. The shared database flag is currently enabled/not force-disabled; the
separate Cloudflare Worker gate has not been independently read back, so provider activation is
not qualified. Provider sandbox, authenticated browser/named-admin proof, and `dev → main`
promotion remain pending.
**Last verified:** 2026-07-31
**Owner:** Utah Pros Restoration
**Risk:** Money / QuickBooks / shared-database

## Purpose

UPR must be able to receive one customer payment and allocate it across multiple open invoices while
creating exactly one matching QuickBooks Online Payment. The workflow must retain the check/reference,
payment method, transaction date, deposit account, human actor, provider identity, and every allocation
without allowing retries, webhooks, or row-level edits to duplicate or corrupt the receipt.

## Current delivery boundary

- The owner authorized the sequenced release path on 2026-07-31; every external step still stops
  on a failed prerequisite or provider/database mismatch.
- The `52a07d9e` grant-containment revision is included in current `dev`; draft promotion PR #565
  remains open and must not be merged yet.
- The receipt foundation is applied on `qa-staging` as `20260731223150` and on the shared project
  as `20260731225654`.
- Managed Supabase defaults initially left direct `service_role` writes on the three new tables.
  Staging/live readback caught that drift, and committed correction
  `20260731231000_qbo_receipt_service_grant_containment.sql` is live on staging as `20260731230543`
  and production as `20260731230907`.
- No QuickBooks sandbox or production Payment is created by repository tests.
- The database flag `feature:qbo_receive_payment` was seeded disabled. Fresh production readback at
  `2026-07-31 23:43:23Z` shows it enabled/not force-disabled through an active internal admin
  employee update; this supersedes the initial disabled readback.
- The money endpoint requires that exact row enabled and not force-disabled plus
  `QBO_RECEIVE_PAYMENT_ENABLED=true`; either closed/missing/malformed gate fails closed.
- Code reached `dev`, and the exact `52a07d9e` deployment passed its own Cloudflare check; newer
  heads require independent deployment/smoke verification. No provider Payment mutation, Intuit
  sandbox run, feature activation, authenticated browser proof, `main` merge, or production web
  deployment occurred.

## Local verification evidence

The original feature source was verified on 2026-07-31 after semantic reconciliation with
`origin/dev` `20436bec`; the `52a07d9e` containment revision then passed GitHub `verify` and
`db-lane` checks plus Cloudflare Pages deployment and remains included in current `dev`. The
numeric results below belong to those exact historical runs; current promotion-head status is
tracked separately by draft PR #565 checks:

- `npm test` passed with zero unexpected skips: 1,507 unit tests, 1,877 Worker tests, and 784 QA
  tests (4,168 total).
- `npm run build` passed with 718 transformed modules. The lazy Receive Payment route built to
  10.71 kB raw / 3.57 kB gzip.
- `node scripts/bundle-size-report.mjs --strict` passed. `src/index.css` is 598,125 bytes against
  the 600,000-byte hard ceiling. Entry-graph JS remains an existing advisory breach at 240,030
  bytes gzip versus the 237,568-byte target, but is 21,295 bytes below the blocking threshold.
- Changed-file ESLint completed with zero findings.
- Migration hygiene passed: 269 migrations, 257 grandfathered, 12 checked, zero failures;
  `git diff --check` passed.
- Exact-source specialist reviews passed: Worker security, migration safety, anonymous-grant and
  secret exposure, UPR project law, page lifecycle, and design consistency. The reviews specifically
  closed combined-invoice receipt ambiguity, blocked Estimate adoption, broad payment-table browser
  access, mutation refetch blanking, and cold-load failure rendering before release.

The receipt foundation is recorded on `qa-staging` as
`20260731223150_qbo_multi_invoice_payment_receipts`; the three staging-discovered supporting
foreign-key indexes are recorded there as
`20260731223813_qbo_multi_invoice_payment_receipt_fk_indexes`. Authoritative readback confirmed
the database feature flag was disabled at that earlier qualification point, all three receipt
tables have forced RLS, browser roles cannot execute the receipt RPCs, and all receipt RPCs remain
service-role-only. The full
transactional SQL behavior suite passed with two synthetic same-contact/QBO-linked invoices and
then rolled back; readback confirmed zero fixture, receipt, attempt, or event residue. Supabase
security/performance advisors reported no receipt-surface security warning; the supporting indexes
close all six new foreign-key paths. After the production apply, live grant readback found the
managed-default service-role write drift described above. The corrective migration was reviewed,
CI-tested, applied on staging, and followed by the full transactional receipt suite plus direct-role
denial proof: receipts/attempts are SELECT-only, events have no direct grant, all writes remain RPC
only, and zero fixture/receipt residue remained. Production now matches that exact privilege shape,
contains zero receipt/attempt/event/linked-payment rows. The later database-flag change is recorded
above; the Worker environment value remains unverified.

These checks still do **not** prove a provider-connected or user-qualified system. No authenticated
rendered-browser session, Intuit Development sandbox call, provider Payment/webhook proof, qualified
two-gate activation, named-admin production proof, or `main` promotion occurred. A post-flag-change
readback found zero `qbo-receive-payment` Worker runs and zero new QBO events; do not use that
absence as Worker-gate proof.

## Frozen v1 product contract

1. Only an active internal administrator may use the browser receive-payment endpoint.
2. One request selects one QBO-linked customer and 1–100 of that customer's open invoices.
3. Every allocation is a positive integer-cent value and cannot exceed the fresh QBO invoice balance.
4. All selected invoices must carry the exact same QBO `CustomerRef` and supported currency.
5. Check payments require a check/reference number; every payment requires an explicit deposit account.
6. UPR reserves a durable attempt and stable Intuit `requestid` before the provider call.
7. One QBO Payment is created with one `Line[].LinkedTxn` allocation per selected invoice.
8. The provider response and fresh invoice readbacks are authoritative before local finalization.
9. Existing `payments` rows remain the invoice-level allocation projection and continue driving the
   database-owned invoice/job rollups.
10. Grouped and QBO-originated receipts are read-only in UPR v1. Corrections happen in QBO and are
    reconciled back into UPR as an audited group operation.
11. Missing, duplicated, reordered, updated, voided, or deleted provider events converge through the
    signed webhook plus CDC/retry recovery.
12. Unsupported multi-currency or unapplied-credit cases fail closed in v1.

## Architecture

### Private receipt state

- `payment_receipts` owns the grouped accounting header and provider identity.
- `payment_receipt_attempts` owns pre-provider idempotency, lost-response recovery, and the unique
  realm/provider-Payment claim.
- `payment_receipt_events` is the append-only reconciliation/audit history.
- `payments.receipt_id` connects each active invoice allocation to its grouped receipt.

The new tables and mutation RPCs are service-only. Browser clients receive only purpose-built Worker
responses and cannot write receipt, attempt, finalization, or reconciliation state.

### Cross-system state machine

The Supabase transaction and QBO request cannot be one atomic transaction. The durable lifecycle is:

`submitting → qbo_created → locally_finalized → reconciled`

Recovery/terminal states include:

`unknown_outcome`, `rejected`, `conflict`, `voided`, and `deleted`.

A retry reuses the exact durable request fingerprint and Intuit `requestid`. It never creates a new
provider request merely because the local finalization response was lost.

### Reconciliation

- Webhook signature and realm are verified before processing.
- Event identity and all retry metadata are claimed atomically; duplicate deliveries are no-ops.
- Create/Update reads the current QBO Payment and replaces the complete active UPR allocation
  projection transactionally; a provider timestamp/SyncToken older than the stored receipt is
  retained as audit evidence but cannot roll balances backward.
- Void/Delete removes active `payments` projections through the existing trigger-safe path while
  retaining the receipt and audit history.
- CDC is the missed-event/backdated-payment recovery path; transaction date alone is not a valid
  change cursor. Retryable webhook/CDC failures remain in the durable `qbo_events` queue with bounded
  backoff, and the drain reclaims metadata-bearing `processing` rows stranded over ten minutes.

### Provider contract evidence

- Intuit's linked-transaction model permits a Payment to contain multiple Invoice `LinkedTxn`
  allocations: <https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-linked-transactions>
- Intuit `requestid` is realm-scoped and an unchanged retry returns the original response:
  <https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions>
- Payment exposes `DepositToAccountRef`, `PaymentMethodRef`, `PaymentRefNum`, `TotalAmt`, and
  read-only `UnappliedAmt`:
  <https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/Payment.html>
- Intuit webhooks must be acknowledged quickly and can arrive out of order:
  <https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices>
- CDC supports Payment changes with a bounded lookback and is the recovery feed:
  <https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture>

## Delivery sequence

1. Author and review the additive schema, rollback containment, static contract test, and isolated SQL
   behavior test.
2. Land the disabled Worker contract and QBO payload/idempotency unit tests.
3. Land full-state webhook/retry/CDC reconciliation behind the Worker kill switch.
4. Land the admin Collections receive-payment page behind the disabled database feature flag.
5. Run the complete local unit, Worker, QA, lint, build, migration-hygiene, and specialist-review
   matrix.
6. Separately authorize and run the Intuit Development sandbox matrix.
7. Review a committed source revision, then deploy the backward-compatible Worker/UI with the
   database feature flag and `QBO_RECEIVE_PAYMENT_ENABLED` both disabled.
8. In a separate owner-authorized window, apply the reviewed additive migration, verify its catalog,
   RLS, grants, RPC signatures, rollback posture, and both still-disabled gates.
9. After the sandbox matrix passes, separately configure/enable the Worker gate, then the database
   flag, and run one named-admin production proof. Each external action remains its own owner gate.

## Required sandbox matrix

- One invoice and two invoices for the same customer
- Full and partial allocation
- Duplicate submit and concurrent same-request submit
- Lost response after QBO accepts the Payment
- Provider success followed by local finalization failure
- Stale invoice balance and cross-customer rejection
- Check method/reference and explicit deposit-account round trip
- Unsupported currency and unapplied-credit rejection
- Duplicate and out-of-order webhooks
- Two-session webhook-first reconciliation racing the outbound mark/finalize path; the attempt must
  stay monotonic and neither session may deadlock
- Two distinct Payment IDs concurrently changing the same invoice; realm/customer serialization
  must prevent an invoice/job rollup-trigger lock upgrade deadlock
- QBO allocation Update, Void, and Delete
- Missed webhook recovered through CDC
- Backdated check created today

## Acceptance criteria

The feature is releasable only when one human-confirmed UPR request produces exactly one QBO Payment,
all intended QBO invoice balances, one UPR receipt, and the correct invoice-level `payments`
allocations; retry and recovery paths cannot duplicate the provider Payment; QBO correction events
reopen or update the correct UPR balances without destroying audit evidence; and no unauthorized
browser role can reach a database or provider side effect. A webhook-first race must leave its
attempt `reconciled` even if the delayed outbound handler subsequently marks, finalizes, or reports
a generic failure. Retained release evidence must identify
the exact committed revision and named-admin proof and show the client/Intuit request identity, QBO
Payment, every allocation, fresh invoice balances, webhook/CDC convergence, and both gates' initial
disabled state without exposing credentials.

## Rollback

The operational rollback first disables `feature:qbo_receive_payment`, sets
`QBO_RECEIVE_PAYMENT_ENABLED` away from literal `true`, and redeploys the inert Worker. The paired
containment rollback can then revoke/remove the new mutation RPCs while leaving financial
receipt/attempt/event evidence intact. Dropping receipt tables, columns, or audit rows is not part of
ordinary rollback and would require a separately reviewed destructive change.
