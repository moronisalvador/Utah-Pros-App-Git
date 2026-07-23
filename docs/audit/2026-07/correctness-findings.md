# July 2026 Correctness and Reliability Findings

Audit date: 2026-07-22
Evidence commit: `0a7c61c`

These findings describe observable transaction, date and transport behavior at the audited commit.
Provider behavior and production incidence require the external evidence named in each finding.
Current durable rules live in `docs/business-rules.md` and `docs/integrations.md`.

## Finding COR-001 — QBO charge uses UTC for a Denver business date

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `functions/api/qbo-charge.js:77-90`; `functions/api/qbo-charge.js:101-111`; `.claude/rules/database-standard.md:89-94`.
- **Affected workflow:** keyed card payment date, QBO payment transaction date, daily financial reporting and reconciliation.
- **Observed behavior:** the Worker derives `today` with `new Date().toISOString().slice(0, 10)` and writes it to both UPR `payment_date` and QBO `TxnDate`. Repository law requires Denver-day bucketing and forbids UTC/server-local business dates.
- **Realistic failure scenario:** a payment taken between 6 p.m. and midnight Mountain Daylight Time is dated as the following day in UPR/QBO, moving it into the wrong daily/weekly/monthly report or reconciliation period.
- **Business impact:** accounting/reporting discrepancies, close/reconciliation labor and confusing customer payment history.
- **Recommended remediation:** use the shared Mountain-time helper (`functions/lib/date-mt.js`) or a single tested `mtToday()` function for both records.
- **Regression test / verification:** freeze time on both sides of Mountain midnight in winter and summer and assert UPR/QBO dates; include DST boundary tests.
- **Estimated effort:** S (0.5 day).
- **Dependencies:** none; coordinate with COR-002 because both touch the charge path.

## Finding COR-002 — External charge can succeed before the local payment exists

- **Severity:** High
- **Confidence:** confirmed
- **Evidence:** `functions/api/qbo-charge.js:9-14`; `functions/api/qbo-charge.js:68-90`; `functions/api/qbo-charge.js:101-120`; `.claude/rules/workers-standard.md:36-40`.
- **Affected workflow:** Intuit card charge, UPR payment recording, QBO payment creation, webhook deduplication and customer notification.
- **Observed behavior:** `createCharge` moves money first; only afterward does the Worker insert the UPR payment. The inner recovery block begins after the insert and only covers QBO-payment mirroring. If the local insert fails, the outer request fails after money moved and no durable local correlation row exists.
- **Realistic failure scenario:** Intuit captures the card, then Supabase times out/rejects the insert. The caller sees a 500 and retries or manually charges again; UPR shows no first payment and the later QBO reconciliation must infer it from provider state.
- **Business impact:** duplicate charge risk, unrecorded customer payment, incorrect invoice balance, dispute/refund costs and audit trail gaps.
- **Recommended remediation:** introduce a durable charge-attempt record with a stable client-supplied/content-derived idempotency key before provider execution; pass provider idempotency if supported; transition attempt/payment states transactionally; make retries return/reconcile the existing attempt. Add a recovery/reconciliation job for captured-but-unrecorded attempts.
- **Regression test / verification:** sandbox contract tests inject failure after provider success and before/at DB insert, then retry the same idempotency key and prove exactly one provider charge and one payment row. Verify crash recovery and webhook convergence.
- **Estimated effort:** M–L (3–7 days including migration, sandbox and reconciliation tests).
- **Dependencies:** AUTH-001; live Intuit sandbox capability and provider idempotency semantics.
- **External evidence required:** Intuit Payments idempotency/retry behavior, webhook payload guarantees and production reconciliation procedure.

## Finding COR-003 — Stripe “create or return” endpoint always creates a new session

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `functions/api/stripe-pay-link.js:1-8`; `functions/api/stripe-pay-link.js:37-44`; `functions/api/stripe-pay-link.js:54-72`.
- **Affected workflow:** invoice pay-link creation/retrieval and customer checkout.
- **Observed behavior:** despite the file contract saying “create (or return),” the invoice query does not select existing Stripe link/session fields and every successful call invokes `createCheckoutSession`, then overwrites the stored session/link.
- **Realistic failure scenario:** double click, network retry or two office users create multiple valid checkout sessions; different links are sent to the customer and only the newest is visible in UPR.
- **Business impact:** customer confusion, harder support/reconciliation and potential duplicate-payment edge cases depending on webhook/idempotency behavior.
- **Recommended remediation:** define reuse/expiration semantics, read the existing session, return it when valid, expire old sessions when replacing, and serialize creation with a stable request key or database state transition.
- **Regression test / verification:** two concurrent/retried calls for the same unchanged invoice produce one active session; changed balance/expired session produces one controlled replacement; webhook processing remains idempotent.
- **Estimated effort:** M (1–3 days).
- **Dependencies:** AUTH-002; Stripe sandbox and session-expiration behavior.
- **External evidence required:** Stripe session state and production webhook handling.

## Finding REL-001 — Shared Worker Supabase requests have no timeout

- **Severity:** Medium
- **Confidence:** confirmed
- **Evidence:** `functions/lib/supabase.js:15-99`; `functions/lib/http.js:37-56`; `.claude/rules/workers-standard.md:29-34`.
- **Affected workflow:** every Worker database read/write/RPC/storage upload using the service-role helper, including billing, messaging, webhooks and scheduled tasks.
- **Observed behavior:** each helper method calls raw `fetch` with no `AbortSignal`. A 15-second timeout helper exists and the Worker standard requires bounded outbound requests, but the database helper does not use it.
- **Realistic failure scenario:** a slow or half-open Supabase request holds a Worker until the platform limit, delays webhook acknowledgement, causes upstream retries and leaves telemetry incomplete.
- **Business impact:** cascading duplicate work, delayed customer communications/payments, increased provider retries and poor incident diagnosis.
- **Recommended remediation:** use `fetchWithTimeout` in the shared Supabase client, allow per-operation overrides for large uploads, classify timeout errors and preserve idempotent retry semantics.
- **Regression test / verification:** mock never-resolving fetches and assert abort within the configured interval for select/insert/update/RPC/storage; run webhook retry/idempotency tests with injected timeouts.
- **Estimated effort:** S–M (1–2 days including broad tests).
- **Dependencies:** money-path idempotency findings such as COR-002 must be considered before automatic retries.
