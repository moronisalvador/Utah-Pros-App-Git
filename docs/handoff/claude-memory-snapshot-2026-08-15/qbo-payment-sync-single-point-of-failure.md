---
name: qbo-payment-sync-single-point-of-failure
description: "QBO→UPR payment sync runs entirely on the Intuit webhook; the hourly poller has never worked, and three diagnostic traps that cost real time"
metadata: 
  node_type: memory
  type: project
  originSessionId: 726f5bb0-a35c-4de4-8462-c1567d7aba4a
  modified: 2026-08-08T04:21:10.934Z
---

Every QuickBooks payment that ever reached UPR arrived via the **Intuit webhook**. The hourly
`qbo-payments-sync` poller — documented as the safety net — has **never worked**: 288 runs since
2026-07-24, `records_processed > 0` on exactly **one**, max ever **1**. It reports
`status: completed` with no error while doing nothing, so "green" and "broken" are indistinguishable
in `worker_runs`. It also computes `scanned` and never stores it, so you cannot tell from telemetry
how many payments CDC returned.

**Why:** when the webhook works, the poller finds nothing to do; that masked the fact that it also
finds nothing when the webhook is down.

**Incident 2026-08-06:** two online (`TxnSource: EInvoice`) customer payments never reached UPR. Root
cause was **not code** — the Intuit Developer console had the endpoint
`https://utahpros.app/api/qbo-webhook` saved under the **Development** tab while **Production was
empty**. The QBO company is a production realm, so Intuit had nowhere to deliver. No errors anywhere,
because a call that is never made cannot fail. Last webhook event before the fix: 2026-08-03 20:07 UTC.

## Three traps that cost time

1. **`MetaData.LastModifiedByRef` cannot tell a human QBO edit from a UPR push.** It names the Intuit
   user the OAuth connection is bound to, so a Worker push, an MCP call and a UI edit all stamp the
   same id. Proven: an invoice created by an API call carried the same id as a supposed human edit.
   Use **QBO `MetaData.LastUpdatedTime` vs `invoices.qbo_synced_at`** instead — QBO newer than the
   last push means it changed outside UPR.
2. **Never `left(description, N)` in a reconciliation query.** A line reading "…grouped onto this
   reconstruction job during Q2-2026 reconciliation" was read truncated at 60 chars, so a deliberate
   revenue re-attribution looked like a misfiled line and was "repaired" away. Arithmetic reconciled
   either way, which is why the error looked right.
3. **One QBO invoice legitimately backs several UPR invoices** (combined bill split into mitigation +
   reconstruction jobs). Compare by **SUM per `qbo_invoice_id`**, never row by row — as of 2026-08-05
   seven QBO invoices have two UPR rows each.

`GET /api/qbo-invoice-drift` was built this session to detect UPR↔QBO disagreement; it encodes all
three lessons. See [[upr-billing-verification-facts]].

**Fourth trap (2026-08-07, A2Z incident) — FIXED same day, live in production.** A QBO payment
voided 26s after creation left the already-sent `payment.received` bell/push rows standing, so
admins saw "Payment received" pointing at an invoice with no payment. The mirror itself worked
perfectly (create→record→notify in 8s, void→projection removed, receipt header kept as audit with
status `voided`). Diagnosis recipe worth reusing: notifications row → payload reference "QBO Payment
#N" → `payment_receipts` by qbo_payment_id (survives the void) → QBO `Payment` by Id (PrivateNote
"Voided", TotalAmt 0).

Shipped: `payment.voided` retraction (production ledger `20260807181353`) plus invoice **Activity**
recording `payment_recorded`/`payment_removed` — that half needed NO migration, because
`invoice_activity.event_type` is free text and `get_invoice_activity` already returns
`safe_metadata`. Promoted via PR #597 (merge `8f502397`), verified live by finding the new strings
in the production-served `InvoiceEditor` chunk. Two mutation-tested guards keep the retraction
honest: fire only when a projection was **actually removed** (a re-delivered Void/Delete webhook
removes nothing), and only for `source='qbo'` rows (a UPR-recorded payment was never announced).
Activity, unlike the notification, logs every affected invoice regardless of source. Same review
also caught receipt-mode dropping `contactId`, which had been generic-ing every grouped alert.

**Fifth trap — FIXED and live in production 2026-08-08.** A voided payment (`TotalAmt` 0, empty
`Line[]`) tripped `!totalCents` in `syncQboPaymentToUpr`'s fractional-cent guard, so the hourly
poller errored **12 consecutive runs** (10:17–21:17 MT). A void is NOT a delete — the entity still
exists — so the sweep's `status === 'deleted'` branch never caught it. `isVoidedQboPayment()`
requires BOTH a zero total AND no invoice-linked line, then routes to removal; it lives in the
shared lib so the sweep, `drainReceiptRetries` and a replayed webhook all reach the same outcome.
**The predicate must test that the raw value IS numeric before the zero test** — `Number(null)`,
`Number('')`, `Number([])` and `Number(false)` are all 0, so a naive `exactCents(x) === 0` would
classify every malformed payload as a void and delete its projections. First clean run 22:17 MT,
immediately after the deploy.

**Release lesson worth keeping:** the fix sat on `dev` for hours while the alarm kept firing,
because the hourly cron posts to **production**. A fix that isn't promoted isn't a fix. Also, the
eslint changed-files ratchet compares against `origin/main`, so lint regressions from any session
only surface on a release PR — three unrelated ones blocked this promotion and had to be cleared
first. Budget for that on any multi-session release day.

**Who voided it is NOT knowable from the API — ANSWERED by asking, 2026-08-07: the bookkeeper did
it,** marking the invoice paid and then voiding it, through an API-connected tool they use. That is
why QBO's audit log said "Indirect edit by System": that label means *an app made the change*, never
*no human was involved*. UPR was ruled out by the absence of any `qbo-receive-payment` worker run in
the window, which was sound. **My bank-feed-match inference was wrong** — a backdated `TxnDate` +
real checking deposit account + no `PaymentMethodRef` fits a bookkeeper's reconciliation tool just
as well, and nothing in the API distinguishes them. Treat that signature as "some connected app",
not as a specific mechanism, and *ask the humans early* — it cost a long forensic detour that one
question would have short-circuited.

Consequence to watch: bookkeepers correct entries routinely, so create-then-void churn may make
`payment.voided` (and its `payment.received` twin) noisy for the 4 admins on bell+push+email. Alert
fatigue on a money alert is its own hazard. The built-in escape hatch is the per-admin toggle in
Settings → Notifications; a real fix, only if it proves noisy, would suppress the pair when create
and void fall inside a short window.

## Layer 2 found 2026-08-06 (~03:30 UTC): claim path swallows Payment events on production

Even after the Intuit console fix, Payment events will NOT post. Proven by synthetic signed
deliveries to `utahpros.app/api/qbo-webhook` (verifier token verified matching via signed probe —
`{ok:true}` on both origins): an **Estimate** event was claimed + processed into `qbo_events`; an
identical **Payment** event vanished without a trace. Cause: `QBO_RECEIVE_PAYMENT_ENABLED=true` is
now set in the Cloudflare **Production** env (initiative-status still says "no key in Production" —
stale) and the db flag is enabled, so the webhook claims Payments via `claim_qbo_receipt_event` —
one of the 8 RPCs with the broken `request.jwt.claim.role` check → 42501 → worker logs
"event claim failed", skips, acks 200. **Silent.** Fixes: apply
`20260805010000_qbo_receipt_service_role_check_repair.sql` (activates grouped receive-payment in
production — owner must authorize with that consequence named), or remove the Production env var to
fall back to the legacy claim path. Intuit delivery itself had NOT resumed as of 05:30 UTC
(config-change propagation); test payments 5997 ($1.25) and 5998 ($0.75, invoice 5986) on customer
565 await owner deletion — their delete events double as delivery-resumption probes.

**RESOLVED 2026-08-06 ~05:30Z:** the 8-RPC repair applied to production (ledger `20260806034004`,
proven end-to-end: event → payment → reconciled receipt → 4 admin payment.received notifications),
and the rebuilt poller (PR #587 → main `cc4d225f`) ran its first honest production sweep at 05:17Z:
CDC scanned 15, one visible error (payment 5993 — UPR invoice INV-000052's contact carries
qbo_customer_id 534 while QBO holds invoice 5583/payment 5993 under customer 525 "Wagner, Mark";
duplicate-customer mapping drift the owner must reconcile; the payment itself is correctly
recorded), webhook_missed 0. **The poller is no longer a single point of failure — it works.**
qa-staging still lacks the repair (apply blocked twice by the payload-fidelity hook on retyped
payloads; use the exact file). Concurrent CI runs (open PR + dev push) collide on the shared
qa-staging fixture org — db-lane count assertions race; serialize reruns, and a per-run-isolation
fix is owed.
