# UPR-Owned Invoicing on Stripe — Roadmap

**Status:** planned, deliberately deferred · **Owner decision:** 2026-08-07 · **Not in flight**
**Last verified:** 2026-08-07

Owner-directed on 2026-08-07: UPR should send its own invoices and collect its own payments
through Stripe, instead of depending on QuickBooks to email invoices and on Intuit's webhook to
tell us we got paid. The owner explicitly deferred the build — *"we're not gonna build that right
now"* — and wants a focused three-day block for it. This file exists so that block starts at hour
zero of building instead of hour zero of rediscovery.

**Nothing here authorizes a live action.** Creating the Stripe account, completing underwriting,
setting a Cloudflare secret, enabling the feature, or sending a customer-facing invoice are all
separate owner actions.

---

## 1. Why (the case, with the real numbers)

Measured 2026-08-07 over the trailing 12 months: **~$539K across 104 payments, average $5,182.**

| Method | Dollars | Share | Count |
|---|---|---|---|
| Unlabeled (QBO-recorded, no method captured) | $225,320 | 41.8% | 38 |
| Check | $220,342 | 40.9% | 31 |
| Credit card | $63,703 | 11.8% | 27 |
| Other | $29,532 | 5.5% | 8 |

Three things follow, and they should shape the design:

1. **This is not a credit-card play.** Cards are 11.8% of dollars but 26% of payments — customers
   reach for a card on small balances. At 2.9% + 30¢, pushing large balances onto cards *costs*
   money: the $11,007 payment in this dataset would have burned ~$320 in fees. **The financial
   argument is ACH — 0.8%, capped at $5.** That same payment costs five dollars and settles in
   days rather than arriving as a check weeks later.
2. **Checks are ~41% of dollars and will never move to Stripe.** Manual payment entry in UPR stays
   a permanent first-class flow. Any design that assumes electronic capture is the norm is wrong.
3. **42% of dollars have no payment method recorded at all.** UPR cannot currently answer "how do
   our customers pay us" from its own data. Owning the rail fixes that as a side effect.

### The operational case (what today actually costs)

- **Invoice emails leave from QuickBooks and UPR is blind to them.** `qbo_emailed_at` is written
  only on a UPR-triggered send; QuickBooks' own `EmailStatus` is never mirrored in. On 2026-08-07
  invoice `INV-000065` had been emailed by QBO to `invoices@presidiopm.com` while the UPR contact
  was `leuri@a2zrepm.com` — two different answers to "who receives our invoices," with no way to
  see the discrepancy from inside UPR.
- **We learn about our own money second-hand.** Every QBO payment reaches UPR through Intuit's
  webhook, which silently stopped delivering 2026-08-03 → 2026-08-06 and needed a Developer-console
  fix to resume.
- **No control** over the customer's payment page, reminder cadence, or branding.

### What this does NOT fix (state it plainly)

QuickBooks remains the book of record for accounting, taxes and the bookkeeper. This project
**inverts the direction** — UPR owns invoice → send → remind → collect, and pushes to QBO as a
one-way accounting mirror — which is simpler than today's bidirectional sync. It does not remove
QuickBooks, and it does not stop a human from recording or voiding a payment directly in QBO
(the 2026-08-07 ghost-notification incident was exactly that, and no payment rail prevents it).

---

## 2. What already exists (verified 2026-08-07 by reading the source, not assumed)

**Most of the payment rail is built and has never been switched on.** Across all 104 payments in
the database: 88 `source='qbo'`, 16 `source='manual'`, **0 `source='stripe'`.**

| Piece | File | State |
|---|---|---|
| Stripe API client, signature verification (`constructEvent`, 300s tolerance), idempotency keys | `functions/lib/stripe.js` | built |
| Checkout session for an invoice balance | `functions/api/stripe-pay-link.js` | built, dormant (503 without `STRIPE_SECRET_KEY`) |
| Webhook: `payment_intent.succeeded`, `payout.paid`, `charge.refunded`, `charge.dispute.created`, with `claim_stripe_event` dedup | `functions/api/stripe-webhook.js` | built |
| Payout side (Instant Payout, external accounts) | `functions/api/stripe-payout.js`, `stripe-accounts.js` | built, admin-only via `PAYOUT_MANAGE_ROLES` |
| Payment columns `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_fee`, `stripe_fee_qbo_purchase_id` | `payments` table | **already live — no migration needed for the payment path** |

**The reconciliation model is already designed, and the design is correct.** On
`payment_intent.succeeded`, `handlePaymentIntent` reads the exact gross/fee/net from the charge's
`balance_transaction`, records the UPR payment at **gross**, pushes a QBO Payment deposited to a
**clearing account** (`qbo_stripe_clearing_account_id`), then books a QBO Purchase from clearing to
a **fee expense account** (`qbo_fee_expense_account_id`). That is the shape that lets a bookkeeper
reconcile a net Stripe payout against the bank statement. Idempotency is charge-level (re-seen
`stripe_charge_id` reuses the existing payment).

**Validate this design before building on it** — if it holds up, the weekend is much shorter.

---

## 3. Known gaps (found while writing this — none are fixed)

1. **ACH is the whole financial argument and is not explicitly requested.**
   `createCheckoutSession` sets no `payment_method_types`, so available methods fall back to the
   Stripe Dashboard's configuration; `us_bank_account` in Checkout has its own enablement and
   mandate-collection requirements. Meanwhile `handlePaymentIntent` **already detects** ACH
   (`payment_method_details.type === 'us_bank_account'` → `'ach'`). The reading side is ready; the
   collecting side is not. Resolve this deliberately, not by accident.
2. **ACH is not final on success, and the webhook treats it as if it were.** A card authorization
   is effectively final; an ACH debit can succeed and then fail days later. There is no handler for
   `payment_intent.payment_failed` / `charge.failed`, so an ACH-first rollout can book revenue that
   never arrives. **This is the single most important correctness gap for an ACH strategy.**
3. **Role-gate drift.** `stripe-pay-link.js` gates on `['admin','manager']`. `manager` is not a role
   in the current model, and the real billing roles since 2026-08-04 are
   `['admin','office','project_manager']` (`src/lib/claimUtils.js` → `BILLING_EDIT_ROLES`). Office
   and project managers can do invoicing but could not create a pay link. Dormant only because the
   feature is off. Payout authority stays separate and admin-only — never re-point
   `stripe-payout.js` at the billing list.
4. **Sending a UPR invoice by email is genuinely unbuilt.** Nothing renders a UPR invoice document
   or sends it. This is the real new construction.
5. **Never processed a live payment.** Whatever is switched on needs a Stripe **test-mode**
   end-to-end proof — pay link → webhook → UPR payment → QBO payment → fee purchase — before it
   touches a customer.

---

## 4. Sequence

External latency is the schedule risk, not code. Phase 0 has no code in it and should start
**weeks before** any build block.

### Phase 0 — external prerequisites (owner, start early, runs in parallel)

- [ ] Create the Stripe account; complete business verification / underwriting. **Not instant** —
      this can take days, and ACH may carry additional review. Starting this early is the highest-
      leverage thing available, because it is the one dependency with latency nobody controls.
- [ ] Explicitly enable **ACH (`us_bank_account`)** on the account, not just cards.
- [ ] Obtain API keys; set `STRIPE_SECRET_KEY` + webhook signing secret in Cloudflare — **both the
      Production and Preview variable sets**, plus a redeploy (`AGENTS.md` → Env).
- [ ] In QuickBooks, create the **Stripe clearing account** and the **merchant fee expense
      account**; record their ids in the config keys the webhook already reads
      (`qbo_stripe_clearing_account_id`, `qbo_fee_expense_account_id`). Bookkeeper work, not dev
      work — it can happen entirely ahead of the build.
- [ ] Confirm the Resend sending domain is healthy for invoice email (`EMAIL-DELIVERABILITY.md`).
      An invoice in a spam folder is an unpaid invoice, and the recipients are insurance carriers
      and property managers.

### Phase 1 — turn on the existing rail (test mode first)

- [ ] Fix the role gate (gap 3) and decide ACH enablement in Checkout (gap 1).
- [ ] Add ACH failure handling (gap 2) — this is a prerequisite for ACH, not a follow-up.
- [ ] Full test-mode proof: pay link → webhook → UPR payment at gross → QBO payment to clearing →
      fee purchase → `payout.paid`. Verify a bookkeeper can reconcile the net payout to the bank.
- [ ] One real low-value live payment, end to end, before any customer sees a link.

### Phase 2 — UPR sends its own invoices

- [ ] **Scope boundary, and this is what keeps the project finite:** the minimum viable version is
      UPR renders the invoice document and sends it via Resend with a Stripe pay link. It does
      **not** require rebuilding the invoice editor, a template system, or a customer portal. Every
      project of this kind balloons here; name the boundary before starting.
- [ ] Prerequisite data hygiene: a trustworthy "who do we bill" field. Today the QBO billing email
      and the UPR contact email can silently disagree (§1). You cannot send your own invoices until
      you trust that address.
- [ ] Mirror QuickBooks' `EmailStatus` into UPR so send state is truthful during the transition
      period, when either system might have sent an invoice. (Already recorded as open work in
      `UPR-Web-Context.md`.)

### Phase 3 — full reconciliation

- [ ] Card fees, ACH fees, refunds, disputes, and payout-to-bank matching, all reconciled between
      Stripe and QuickBooks.
- [ ] Decide the ACH-failure reversal path in the books (gap 2), not just in the app.

---

## 5. Honest scoping note

The owner's stated hope is a focused three-day weekend. Realistically: **Phase 1 fits that block**
because the plumbing is written. Phases 2 and 3 are separate chunks of comparable size — building
invoice rendering and sending, then full fee/payout reconciliation, is not three days of work on
top. Planning for "Phase 1 in the weekend, Phases 2–3 sequenced after" is likelier to succeed than
one three-day push at all of it.

---

## 6. When this starts

This is `/masterplan` work — it touches money, an external provider, schema, workers, and the
consent rules that govern reminder messages. Re-derive every count and file reference in §2 before
relying on it; this document is dated, and the repository moves.
