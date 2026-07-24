<!--
FILE: docs/audit/2026-07/evidence/money-worker-hardening-2026-07-23.md

WHAT THIS DOES (plain language):
  Records the bounded authorization, amount, request-id and Mountain-date hardening for the QBO
  keyed-card and Stripe pay-link Workers, plus the money risks that remain open.

DEPENDS ON:
  Internal: functions/api/qbo-charge.js, functions/api/stripe-pay-link.js,
            functions/api/money-worker-authorization.test.js, functions/lib/date-mt.js
  Data:     reads → source and mocked Worker contracts
            writes → documentation only

NOTES / GOTCHAS:
  - No provider call, card charge, Checkout session, payment row or live configuration changed.
  - This phase does not claim durable captured-charge recovery.
-->

# Money Worker hardening evidence — 2026-07-23

## Scope

This bounded repository phase closes AUTH-001 and AUTH-002 and the safe internal parts of COR-001:

- QBO card charge and Stripe pay-link both resolve an active employee and require
  `['admin', 'manager']` with `functions/lib/auth.js`;
- authorization occurs before provider calls; Stripe also authorizes before revealing whether its
  configuration exists;
- the undocumented QBO webhook-secret alternative is removed from the card-charge route because no
  repository caller uses it and it cannot identify an accountable human actor;
- QBO requires a stable client `Idempotency-Key`, validates its bounded safe format, and passes it to
  `createCharge` as Intuit's request ID;
- QBO rejects non-positive/fractional-cent amounts and charges above the current outstanding balance;
- QBO records `auth.employee.id` in `payments.recorded_by`;
- QBO uses the Mountain-Time business date for both UPR and QBO payment records.

The response shapes remain `{error}` on failure and the existing QBO/Stripe success contracts.
No frontend caller for `/api/qbo-charge` exists in the current repository, so requiring the stable
key does not break a checked-in browser contract. Any future caller must generate one key per human
charge intent and reuse it across retries.

## Negative and money tests

`functions/api/money-worker-authorization.test.js` proves for both Workers:

- missing session returns 401 with zero database/provider calls;
- active field technician returns 403 after only auth-user and employee lookup;
- inactive billing-role employee returns 403;
- authenticated user without an employee row returns 403;
- `admin` and `manager` pass the server role gate; and
- no denied request invokes QuickBooks charge/payment or Stripe Checkout.

The QBO allowed-path contract additionally proves:

- amount normalization is integer cents and fractional cents are rejected;
- missing, short, or unsafe idempotency keys are rejected before provider access;
- charges above the current outstanding balance are rejected before provider access;
- `stable_request_1234` reaches `createCharge` as the request ID;
- the payment insert records the authorized employee;
- 2026-07-24 05:30 UTC is stored as 2026-07-23 Mountain Time; and
- that same Mountain date reaches QuickBooks as `TxnDate`.

Verification:

- focused dependency graph: six Vitest files, 63 tests passed;
- safe primary-tree unit/Worker lane (excluding mutation-capable Supabase integration suites and
  stale `.claude`/agent worktrees): 128 files, 1,586 tests passed after rebasing onto current dev;
- production build: passed;
- changed-file ESLint and `git diff --check`: passed.

A raw local `npm test` was also attempted and failed for the documented harness reason: local
Supabase credentials caused mutation-capable integration suites—plus copies below stale
`.claude/worktrees`—to run with anonymous credentials against the tightened live project. The
failures were 401/RLS denials in unrelated notification/timezone/feedback/Omni suites, not this
money phase. CI runs without those local credentials and the prior closure commit was green.
The first independent Worker review found two documentation/test omissions. Both were corrected:
canonical COR-001/002/003 numbering is restored, and the handler suite now proves `TxnDate` plus
provider denial for invalid keys, fractional cents, and over-balance charges. Final independent
re-review passed with no blocking security or correctness findings; the reviewer independently
re-ran the six-file/63-test lane, changed-file ESLint, and `git diff --check`.

## Residual risk and exact next phase

COR-002 remains open. The stable provider request ID reduces retry risk but is not durable UPR
state. If Intuit captures a charge and the first local payment insert fails, UPR still lacks a
pre-provider attempt row and automated reconciliation. Closing it requires:

1. verified Intuit sandbox behavior for repeated request IDs and charge lookup/webhook guarantees;
2. a reviewed additive service-only charge-attempt ledger and narrow transition/reconciliation
   contract;
3. an attempt row committed before provider execution;
4. injected provider-success/local-failure tests proving one charge and one payment across retry;
5. a recovery job/runbook, actor/audit fields, cent math, rollback, and serialized shared-database
   apply evidence.

COR-003 also remains open. Stripe already receives a content-derived provider idempotency key, but
UPR does not define stored Checkout-session reuse/expiration/replacement or prove concurrent calls
in a sandbox. That is a separate Stripe phase; this authorization slice does not guess provider
session semantics or expire a live session.

No live database migration, provider sandbox/production call, card charge, pay-link creation,
payment insert, outbound notification, or money movement occurred.
