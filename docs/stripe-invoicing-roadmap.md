# UPR-Owned Invoicing on Stripe — Roadmap

**Status:** planned, deliberately deferred · **Owner decision:** 2026-08-07 · **Not in flight**
**Last verified:** 2026-08-19

> ## ⚠ READ THIS FIRST — the premise below changed on 2026-08-11
>
> This document was written on 2026-08-07 and its central claim was *"most of the payment rail is
> built and has never been switched on, so Phase 1 fits a weekend."* **That is no longer true.**
>
> On 2026-08-11, commit `4292afde` (*fix(stripe): contain projection writes without durable
> commands*) **removed the working bodies of both Stripe workers** as part of the D1 containment.
> Today:
>
> - `functions/api/stripe-webhook.js` verifies the signature and then returns a hard **503
>   `stripe_projection_durable_boundary_required`** — before claiming the event, recording a
>   payment, notifying anyone, or calling QuickBooks. The 315 lines that did all of that
>   (`handlePaymentIntent`, `handlePayout`, `handleRefund`, `handleDispute`) are **gone from the
>   working tree**; they are recoverable from `4292afde^`, not runnable.
> - `functions/api/stripe-pay-link.js` authorizes the caller and validates `invoice_id`, then
>   returns the same 503. It never creates a Checkout session.
> - `src/pages/InvoiceEditor.jsx` no longer offers Create/Copy pay-link; a stored URL renders as
>   non-clickable legacy evidence.
>
> **What survived intact:** `functions/lib/stripe.js` (the whole API client — `stripeFetch`,
> `constructEvent`, `createCheckoutSession`, `retrieveCharge`, `createPayout`), the `payments` and
> `invoices` Stripe columns, the `stripe_events` ledger and `claim_stripe_event`, and
> `stripe-payout.js` / `stripe-accounts.js` (never contained).
>
> **So Phase 1 is now bigger than this document says.** Restoring the webhook is not a revert — the
> containment exists because the projection wrote to UPR *and* QuickBooks with no durable command
> boundary, so a mid-flight failure could leave the two disagreeing with no recovery record. It has
> to come back **behind a durable command/projection boundary**, the way QuickBooks documents did
> in D2. That precedent is `functions/lib/qbo-invoice-commands.js` (286 lines) +
> `functions/api/qbo-document-command-gate.js` + migrations `20260731210000_qbo_invoice_command_ledger`,
> `20260810020000_qbo_invoice_command_reservation`, `20260810182855_estimate_qbo_command_boundary`,
> gated on the exact-on `feature:qbo_document_command_v2` flag. Budget Stripe's equivalent at
> comparable size, and it is a migration + money-path change, so it carries the full §5b behavioural
> proof and an owner-authorized apply.

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

- **Invoice emails leave from QuickBooks and UPR was blind to them.** `qbo_emailed_at` is written
  only on a UPR-triggered send; QuickBooks' own `EmailStatus` was never mirrored in. On 2026-08-07
  invoice `INV-000065` had been emailed by QBO to `invoices@presidiopm.com` while the UPR contact
  was `leuri@a2zrepm.com` — two different answers to "who receives our invoices," with no way to
  see the discrepancy from inside UPR.
  **Addressed 2026-08-07 (code committed; migration `20260807190000_invoice_qbo_email_mirror`
  authored and NOT applied — see `UPR-Web-Context.md`).** UPR now records QuickBooks' `EmailStatus`
  and `BillEmail` wherever it already reads a QBO invoice, the three invoice surfaces distinguish a
  UPR send from a QuickBooks-side send, and a QBO billing email that disagrees with the UPR contact
  is flagged on screen. That closes the visibility half; it does not change who does the sending.
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

## 2. What already exists (verified 2026-08-07; **corrected 2026-08-19** — see the banner above)

**Historical claim, now half-wrong: most of the payment rail *was* built and never switched on;
the two workers that carried it were contained on 2026-08-11 and are stubs today.** The table
below is annotated with current state. Across all 104 payments in
the database: 88 `source='qbo'`, 16 `source='manual'`, **0 `source='stripe'`.**

| Piece | File | State |
|---|---|---|
| Stripe API client, signature verification (`constructEvent`, 300s tolerance), idempotency keys | `functions/lib/stripe.js` | built |
| Checkout session for an invoice balance | `functions/api/stripe-pay-link.js` | **CONTAINED 2026-08-11** — authorizes + validates, then hard 503. Creates nothing. |
| Webhook: `payment_intent.succeeded`, `payout.paid`, `charge.refunded`, `charge.dispute.created`, with `claim_stripe_event` dedup | `functions/api/stripe-webhook.js` | **CONTAINED 2026-08-11** — verifies signature, then hard 503. Handler bodies deleted; recoverable from `4292afde^`. |
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

1. **ACH is the whole financial argument and is not explicitly requested.** *(2026-08-19: the
   account-side half is now evidenced — `us_bank_account_ach_payments = active` in the sandbox.
   The code-side half below is unchanged and still open.)*
   `createCheckoutSession` sets no `payment_method_types`, so available methods fall back to the
   Stripe Dashboard's configuration; `us_bank_account` in Checkout has its own enablement and
   mandate-collection requirements. Meanwhile `handlePaymentIntent` **already detects** ACH
   (`payment_method_details.type === 'us_bank_account'` → `'ach'`). The reading side is ready; the
   collecting side is not. Resolve this deliberately, not by accident.
2. **ACH is not final on success, and the webhook treats it as if it were.** A card authorization
   is effectively final; an ACH debit can succeed and then fail days later. There is no handler for
   `payment_intent.payment_failed` / `charge.failed`, so an ACH-first rollout can book revenue that
   never arrives. **This is the single most important correctness gap for an ACH strategy.**
3. **Role-gate drift. FIXED 2026-08-19** — `stripe-pay-link.js` now names
   `['admin','office','project_manager']`, pinned by `billing-role-surface-parity.test.js`. The
   three sibling workers `workers-standard.md` §1 names (`qbo-invoice-drift.js`, `qbo-charge.js`,
   `qbo-attach.js`) still carry the stale pair and are a separate reviewed change. Original text:
   `stripe-pay-link.js` gates on `['admin','manager']`. `manager` is not a role
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

**Live state verified read-only 2026-08-19** against the shared project's `integration_config`
(which is where `get_billing_settings` reads every one of these keys from), `integration_credentials`,
the local `.dev.vars`, and a read-only `GET /v1/account` against Stripe test mode. Everything below
marked `[ ]` was confirmed **absent or unproven**, not assumed.

> **Correction, same day.** An earlier revision of this section said flatly that UPR had no Stripe
> key. That was true of the three *deployed* stores and false of the local one — the owner had set
> a working test-mode key in `.dev.vars` on 2026-08-15, and checking only the database missed it.
> The corrected table below is the point: "is the key configured" has four different answers.

- [x] Create the Stripe account; complete business verification / underwriting. **Owner reported
      done 2026-08-19.** Not independently verifiable from here — see the next item for why.
- [x] **Sandbox/test key — DONE 2026-08-15.** `.dev.vars` carries `STRIPE_SECRET_KEY` (`sk_test_`),
      `STRIPE_PUBLISHABLE_KEY` (`pk_test_`) and a real `whsec_` `STRIPE_WEBHOOK_SECRET`.
      `npm run dev:credentials` reports **Stripe 2/2 READY, vendor test mode**. Verified working by
      a read-only `GET /v1/account` on 2026-08-19.
- [ ] **THE KEY IS IN ONLY ONE OF FOUR STORES — this is the trap.** `.dev.vars` is read *only* by
      `wrangler pages dev`; `CLAUDE.md` is explicit that **Cloudflare never sets or reads it**. So
      the Aug-15 key does nothing for `dev.utahpros.app` or `utahpros.app`. Still empty:
      | Store | Read by | Stripe key |
      |---|---|---|
      | `.dev.vars` | `wrangler pages dev` (tier 1 only) | ✅ test mode |
      | Cloudflare Pages env — **Preview AND Production** | deployed workers | ❌ |
      | `integration_credentials.stripe` | `resolveCredential` DB-first path | ❌ still the `2026-07-07` P9 placeholder |
      | upr-mcp worker secret | the `stripe_*` MCP tools | ❌ (`wrangler secret put STRIPE_SECRET_KEY`) |
      Note `stripeConfigured(env)` — the pre-flight in all four Stripe workers — reads **env only**,
      so the DB row alone will not wake a deployed worker.
      Enter the DB one at `/settings/integrations` (`set_integration_secret`); never paste a key
      into a chat or a repository file.
- [x] **ACH is `active` in the sandbox — verified 2026-08-19.** `GET /v1/account` returns
      `us_bank_account_ach_payments = active`, alongside `charges_enabled`, `payouts_enabled` and
      `details_submitted` all true.
- [ ] **Confirm ACH on the LIVE account.** The probe above read an account named
      *"Utah Pros Water Damage Rescue LLC **sandbox**"*. A Stripe sandbox simulates an activated
      account and auto-enables capabilities, so its list is **encouraging evidence, not proof** of
      what the live account can do. Confirm `us_bank_account` in the live Dashboard before anyone
      builds a plan on 0.8%-capped-at-$5 pricing.
- [ ] Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in Cloudflare — **both the Production and
      Preview variable sets**, plus a redeploy (`AGENTS.md` → Env). Note the DB credential store is
      the primary path now and env is the fallback, but `stripeConfigured(env)` — the pre-flight
      gate in all four Stripe workers — **still reads env only**, so the env values are still
      required for any Stripe worker to get past its first line.
- [ ] In QuickBooks, create the **Stripe clearing account** and the **merchant fee expense
      account**; record their ids in `qbo_stripe_clearing_account_id` and
      `qbo_fee_expense_account_id`. **Both keys are absent from `integration_config` today.**
      Bookkeeper work, not dev work — it can happen entirely ahead of the build.
- [ ] `qbo_bank_account_id` (the real QBO bank that `payout.paid` transfers the net into) is also
      **absent**. Without it the clearing account never self-zeroes, which is the whole point of
      the clearing pattern.
- [ ] `stripe_connected` is **absent** — the workers set it on first successful key use, so it is a
      useful one-glance proof that the key actually works once entered.
- [ ] Payout destinations `stripe_payout_bank_id` / `stripe_instant_card_id` are **absent**. These
      are money-OUT settings behind the email-2FA gate on `/settings/payments`; they are not needed
      to collect a payment, only to pay yourself out.
- [ ] Confirm the Resend sending domain is healthy for invoice email (`EMAIL-DELIVERABILITY.md`).
      An invoice in a spam folder is an unpaid invoice, and the recipients are insurance carriers
      and property managers.

**Already true and worth knowing:** `accept_card`, `accept_ach` and `surcharge_enabled` are all
`true` in `integration_config`. Those are UPR-side billing preferences only — they do **not**
configure Stripe, and `accept_ach = true` is not evidence ACH is enabled on the Stripe account.

### Phase 1 — rebuild the rail behind a durable boundary, then turn it on (test mode first)

*(Retitled 2026-08-19. It read "turn on the existing rail" when the rail still existed.)*

- [ ] **Build the Stripe durable command/projection boundary** — the new long pole, and the
      prerequisite for everything else in this phase. Mirror the QuickBooks D2 shape: a command
      ledger with reservation, a gate function keyed on an exact-on feature flag, and restored
      handlers that write only through it. Precedent files are named in the banner at the top.
      Carries a migration, so it also carries a `database-standard.md` §5b behavioural proof, a
      paired rollback, a CI-visible static contract test, and an owner-authorized apply.
- [x] Fix the role gate (gap 3). **Done 2026-08-19** — `stripe-pay-link.js` gated on the dead
      `['admin','manager']` pair; it now names `['admin','office','project_manager']`, pinned by
      `tests/qa/unit/billing-role-surface-parity.test.js`. Safe to do ahead of everything else
      precisely because the endpoint 503s regardless of role, so it opened nothing.
- [ ] Decide ACH enablement in Checkout (gap 1).
- [ ] Add ACH failure handling (gap 2) — this is a prerequisite for ACH, not a follow-up. It lands
      inside the restored webhook, so it is blocked on the boundary above.
- [ ] Full test-mode proof: pay link → webhook → UPR payment at gross → QBO payment to clearing →
      fee purchase → `payout.paid`. Verify a bookkeeper can reconcile the net payout to the bank.
- [ ] One real low-value live payment, end to end, before any customer sees a link.

### Phase 2 — UPR sends its own invoices

- [ ] **Scope boundary, and this is what keeps the project finite:** the minimum viable version is
      UPR renders the invoice document and sends it via Resend with a Stripe pay link. It does
      **not** require rebuilding the invoice editor, a template system, or a customer portal. Every
      project of this kind balloons here; name the boundary before starting.
- [ ] Prerequisite data hygiene: a trustworthy "who do we bill" field. The QBO billing email and the
      UPR contact email can still disagree — but as of 2026-08-07 the disagreement is **visible**
      (`qboBillEmailMismatch`, flagged on all three invoice surfaces) instead of silent. What
      remains is reconciling the addresses it surfaces, which is data work, not code.
- [x] Mirror QuickBooks' `EmailStatus` into UPR so send state is truthful during the transition
      period, when either system might have sent an invoice. **Done 2026-08-07** —
      `functions/lib/qbo-invoice-email-mirror.js` + `src/lib/invoiceEmailStatus.js`. **Its migration
      (`20260807190000`) is authored and NOT applied**, so the columns do not exist yet on the
      shared project; until an owner-authorized apply, the surfaces fall back to
      "Not emailed from UPR", exactly as before.

### Phase 3 — full reconciliation

- [ ] Card fees, ACH fees, refunds, disputes, and payout-to-bank matching, all reconciled between
      Stripe and QuickBooks.
- [ ] Decide the ACH-failure reversal path in the books (gap 2), not just in the app.

---

## 5. Honest scoping note

**Revised 2026-08-19.** The three-day estimate assumed the plumbing was written. Since the
2026-08-11 containment it is not: Phase 1 now begins with building Stripe's durable
command/projection boundary from scratch, plus a migration, its rollback, a §5b behavioural proof
and an owner-authorized apply — before a single test-mode payment can be attempted. Treat the
boundary as its own chunk and the test-mode proof as the chunk after it. Original estimate below,
kept because the reasoning about Phases 2–3 still holds.

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
