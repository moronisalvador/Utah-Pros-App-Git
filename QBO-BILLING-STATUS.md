# UPR Billing · Invoicing · A/R · QuickBooks · Stripe — Handoff & Status
**Last updated:** 2026-06-20 · **Branches:** `dev` and `main` are **in sync** — both carry A (+New-invoice picker) + Stripe S3 + S4 (refunds/disputes), all dormant, + payout-destination email-2FA + the refreshed Help/guide (owner asked to push all of this to both; billing is admin/manager + feature-flagged, so techs are unaffected). Both auto-deploy via Cloudflare Pages · **Supabase project:** `glsmljpabrwonfiltiqm`

> **READ THIS FIRST if you're a new chat picking up this work.** This is the complete brief
> for the billing/invoicing/A/R + QuickBooks + Stripe initiative. **Do not change the locked
> strategy/design in §1** — it was decided deliberately with the owner (Moroni). Read order:
> **(1) this file → (2) `CLAUDE.md` (project rules) → (3) `UPR-Web-Context.md` (full technical
> reference).** `QBO-PHASE-2-PLAN.md` is an older inbound-sync plan that is **superseded** (we
> went one-way) — ignore except for history. Work on `dev`; keep `main` in sync when asked.

---

## 1. LOCKED strategy & design (do not re-litigate)

**Integration direction — ONE-WAY, UPR → QuickBooks.** UPR is the system of record; QBO is a
downstream mirror. Everything (invoices *and* payments) is entered in UPR and pushed to QBO.
**Nobody enters/edits invoices or payments directly in QuickBooks.** No inbound/QBO-webhook
sync (that earlier plan was dropped). This is how Housecall Pro / Albiware work.

**Invoicing**
- **One invoice per job (= per division).** A claim with Mitigation + Reconstruction = 2 jobs = 2 invoices. Driven by `create_invoice_for_job(p_job_id)` (returns the existing invoice if one exists — never duplicates).
- **Builder-only, line-item invoices.** No lump-sum amount field. Each line carries a **QBO Item + Class** (per-line class), description, qty × rate. Invoice total rolls up from lines via the `recompute_invoice_from_lines()` trigger.
- **Itemized push:** each line → a QBO `SalesItemLine` with `ItemRef` + `ClassRef`. The Item/Class dropdowns are pulled **live from QBO** via `qbo-query` (UPR mirrors the QBO catalog — they keep ~5–6 items in both).
- **Invoice building happens on a dedicated page** `/invoices/:invoiceId` (`InvoiceEditor`) — intentional/guarded, like QBO/HCP. NOT inline.

**Payments**
- Entered in UPR → pushed to QBO via `qbo-payment` worker as a **Payment applied to the invoice**. Recording is a **quick inline action** on the A/R panel (amount, date, payer, method, reference).
- The `update_invoice_paid` trigger rolls payments up into `invoices.amount_paid`/`status`/`paid_at` AND `jobs.collected_value`/`ar_status`.

**A/R surfaces (all invoice-centric, all share the same components)**
- **Claim page → "Invoices & Payments"** (`ClaimBilling`): per-invoice sent/aging/collected/balance + read-only line summary + payment history + record-payment; "Create/Edit invoice" opens the editor.
- **Customer profile → Financial tab**: same `ClaimBilling` panel fed all the client's jobs (client-level Invoiced/Collected/Balance).
- **Collections hub** (`/collections`): two tabs — **A/R · Outstanding** (`ARDashboard`: KPIs, aging buckets Current/1-30/31-60/61-90/90+, overdue worklist) and **Payments** (`PaymentsLedger`: cash-in history). Rows drill to the per-claim workspace.
- **Per-claim A/R workspace** (`/collections/:claimId`, `ClaimCollectionPage`): client/carrier header, contact quick-actions, A/R KPIs, and the `ClaimBilling` panel for the whole claim.

**Safeguards** (UI-level today; deeper RLS/RPC enforcement is a TODO)
- Master switch: feature flag **`feature:billing`** (enabled). Off = Billing hidden for all; `dev_only_user_id` limits to one person.
- Edit gate: **`canEditBilling(role)` = admin + manager only** (in `src/lib/claimUtils.js`). Used for Billing edits AND Collections A/R edits.
- Two-click confirms on destructive actions (Remove from QuickBooks, Delete draft, delete payment).

**Card processing = Stripe** (decided). Pattern (matches HCP):
- Customer pays via UPR pay-link → UPR records the payment → UPR pushes to QBO. The only "inbound" is Stripe's payment-confirmation webhook (not QBO).
- **Fee automation via a "Stripe clearing" QBO account:** record the **gross** Payment deposited to the clearing account, book the **exact fee** (from Stripe's `balance_transaction.fee`) as a Merchant-Fees expense from the clearing account, and on payout record a **Transfer** of the net to the real bank. Clearing account self-zeroes; bank reconciles exactly.
- **Same-day deposit = Stripe Instant Payouts**, exposed as an in-app button (~1.5% fee).
- **Payout destinations are selectable in Payment Settings** — the **checking account** for standard deposits and the **debit card** for instant payouts — chosen from the Stripe account's existing external accounts. *Adding* a new bank/card happens via Stripe's hosted flow / Dashboard (Financial Connections), never raw bank/card entry in UPR (PCI/compliance). UPR only **lists + selects**.
- **UPR is the ONLY writer to QBO** — do NOT also run Stripe's QBO connector/Synder (would double-post).

**Design conventions to match** (so new work looks native): React 19 + Vite, JSX only; styling = inline styles using CSS custom properties from `index.css` (no Tailwind); `const { db } = useAuth()` for data; `db.rpc()` for new tables; toasts via `window.dispatchEvent(new CustomEvent('upr:toast', …))` (never alert/confirm); inline two-click confirms for destructive actions; dedicated pages for heavy/guarded flows (invoice building), inline for quick actions (payments).

---

## 2. DONE — live on `dev` & `main`

**QBO connection & customers** (pre-existing): OAuth (`quickbooks-connect`/`-callback`, tokens in `integration_credentials`); customer create/link on new contact (`qbo-sync-customer`, AFTER INSERT trigger; one-way create-only).

**Invoicing → QBO**
- Create draft per job (`create_invoice_for_job`), itemized push/update/delete (`qbo-invoice` worker + `lib/quickbooks.js`: `createInvoice`/`updateInvoice`/`deleteInvoice`). Division→Item/Class map in `divisionToQbo`.
- **Auto-stamp** `sent_at` + Net-30 `due_date` on first push (drives aging).
- **Full line-item builder** on the dedicated **`/invoices/:id`** editor (`InvoiceEditor`): Item+Class per line, qty×rate, auto-save, Send/Update to QBO, Remove (confirm), Delete-draft (confirm). `invoice_line_items.qbo_item_id/qbo_item_name/qbo_class_id/qbo_class_name` + `recompute_invoice_from_lines()` trigger.

**Payments → QBO** (one-way): `qbo-payment` worker + `createPayment`/`deletePayment`; `payments.qbo_payment_id/qbo_synced_at/qbo_sync_error`; recorded inline on `ClaimBilling`, applied to the QBO invoice; `update_invoice_paid` rollup.

**A/R surfaces:** claim "Invoices & Payments" panel, customer Financial tab, Collections hub (A/R + Payments tabs), per-claim workspace — all invoice-centric (see §1). Dashboard reads `get_job_financials` / `get_ar_invoices`; ledger reads `get_payments_ledger`.

**Safeguards:** `feature:billing` flag, `canEditBilling` (admin+manager), two-click confirms.

**Payment Settings** (`/payments/settings`, from Collections ⚙): accept card/ACH, default terms, card surcharge %, **QBO fee-account mapping** (Stripe clearing + Merchant Fees, via "Load accounts from QuickBooks"); Stripe connect status + Instant-Payout button present but **inert until Stripe keys exist**. Persisted via `get_billing_settings`/`set_billing_setting` (whitelisted).

**Employee docs:** in-app **Help** page (`/help`), `UPR-Invoicing-Financials-Employee-Guide.md`, downloadable `public/UPR-Invoicing-Financials-Guide.pdf` (regen via `scripts/build-invoicing-guide-pdf.py`). ⚠️ These describe the *pre-builder* flow ("Save amount / Push") — **update them** to the line-item builder + dedicated editor when convenient.

**"+ New invoice" job picker** (Jun 20 2026): shared `NewInvoiceModal` → idempotent `create_invoice_for_job` → `/invoices/:id`. Customer page header button (customer-scoped, reuses loaded claims) + global **+ New invoice** on the Collections header (customer typeahead → claims→jobs). Rows badge "Has invoice"/"New". Gated `feature:billing` + `canEditBilling`. (Jun 20: the `ClaimBilling` rows on the **Customer → Financial** tab also show each job's **date of loss + address**, since that tab spans all the client's claims — disambiguates which job you're invoicing. Claim-page panels are unchanged since every row is the same claim.)

**Stripe S3 — card collection + fee automation (Jun 20 2026, BUILT but DORMANT):** full code shipped, inert until `STRIPE_*` keys exist (workers 503; UI shows "not set up yet"). Migration `20260620_stripe_s3.sql` **applied** (invoice pay-link cols; payments `source`/`stripe_*`/fee cols + charge-unique index; `stripe_events` RLS-locked idempotency ledger + `claim_stripe_event`; `qbo_bank_account` + Stripe payout-destination keys in billing settings). `functions/lib/stripe.js` (signature verify, balance_transaction, Checkout, external accounts, instant payout). `quickbooks.js` extended (`createPayment` `depositAccountId`; new `createPurchase`/`createTransfer`/`deleteEntity`). Workers: `stripe-webhook` (payment_intent.succeeded → gross payment deposited to clearing + fee Purchase; payout.paid → net Transfer; **charge.refunded → net refund + reverse QBO payment/fee; charge.dispute.created → reopen A/R + reverse**), `stripe-pay-link`, `stripe-payout`, `stripe-accounts`. UI: pay-link on `InvoiceEditor`; payout-destination panel + live Instant Payout + QBO deposit-bank selector on `PaymentSettings`; Refunded/Disputed chip on `ClaimBilling`. **Needs owner setup + live test — see §4.**

**Payout-destination email-2FA (Jun 20 2026):** changing the Stripe deposit bank / instant-payout debit card requires a one-time code emailed to the owner — NOT a plain edit field. Worker `billing-2fa.js` (request → Resend email via functions/lib/email.js; commit → verify code → service-role write). The 4 payout keys were removed from the open `set_billing_setting` whitelist (worker-only writes); codes in RLS-locked `billing_2fa_codes` (migration `20260620_payout_2fa.sql`, applied). Owner email = `integration_config.billing_2fa_email` (default `moroni.s@utah-pros.com`). ✅ **Email moved off the dead SendGrid path onto Resend (Jun 24 2026)** — requires `RESEND_API_KEY` + a verified utahpros.app sending domain in Resend before these fields can be changed.

**Employee guide updated (Jun 20 2026):** Help page (`/help`), `UPR-Invoicing-Financials-Employee-Guide.md`, and the downloadable PDF all rewritten to the real flow (line-item builder on `/invoices/:id`, "+ New invoice" picker, Send/Update to QuickBooks, payment recording that auto-syncs, card pay-link). PDF regenerated via `scripts/build-invoicing-guide-pdf.py`.

**Cleanup done:** removed the old job-centric `ARPage` cluster + stale `COLLECTIONS_*.md`. Legacy `billing_overview` view + `get_ar_jobs` RPC remain in the DB (harmless, unused) — drop later if desired.

---

## 3. NEXT

**A) "+ New invoice" with job picker — ✅ DONE (Jun 20 2026).** Shipped on `dev` (see §2). Customer-page + Collections entry points; idempotent `create_invoice_for_job` → `/invoices/:id`.

**B) Stripe S3 — ✅ CODE DONE / DORMANT (Jun 20 2026).** Built and applied (see §2). **Remaining = owner activation, not code:** do the §4 setup checklist (Stripe keys + QBO accounts + webhook), then run the live test. Until then it's inert.

**C) Stripe S4 — refunds/disputes — ✅ CODE DONE / DORMANT (Jun 20 2026).** `stripe-webhook` handles `charge.refunded` (net the refund; full refund → reverse QBO Payment + fee Purchase via `deletePayment`/`deleteEntity`; partial → net in UPR + flag QBO for manual reduction) and `charge.dispute.created` (reopen A/R + reverse QBO Payment + stamp dispute status). Migration `20260620_stripe_s4.sql`: `payments.refunded_amount/refunded_at/dispute_status` + `update_invoice_paid` rewritten to net refunds and reopen status. `ClaimBilling` shows a Refunded/Disputed chip. *Follow-ups (S5): dispute fee + won/lost resolution; auto-reduce QBO payment on partial refund.* Activates with the rest of Stripe — **subscribe these two events on the webhook endpoint** (see §4) and live-test.

**D) Remaining / polish**
- Flip `integration_config.auto_draft_invoices` → `'true'` after a real prod test (auto-creates a draft per job).
- **Deeper security:** RLS / RPC role checks on financial tables (safeguards are UI-level today).
- Customer-edit → QBO push (e.g. email change; today contact edits don't sync to QBO — create-only).
- `invoice_adjustments` UI (supplements/denials — table exists, unused).
- ~~Update the employee guide/PDF/Help to the builder flow.~~ ✅ Done Jun 20 2026 (Help page + markdown guide + regenerated PDF, all on the line-item builder + payment + pay-link flow).
- Drop deprecated `billing_overview` / `get_ar_jobs` once confident.

---

## 4. Stripe S3 — ACTIVATION click-path (code is built & dormant)

The code (workers, lib, migration, UI) is shipped and inert. To turn it on, do the
setup below. Test on **dev** first (`dev.utahpros.app`, Cloudflare **Preview** env,
Stripe **test mode**); repeat for **main**/Production with live keys.

**1 — Stripe keys.** Stripe Dashboard (Test mode) → **Developers → API keys** → copy the
**Publishable** (`pk_test_…`) and **Secret** (`sk_test_…`) keys.

**2 — Register the webhook + get its signing secret.** Stripe Dashboard → **Developers →
Webhooks → Add endpoint**:
- Endpoint URL: `https://dev.utahpros.app/api/stripe-webhook` (Production: `https://utahpros.app/api/stripe-webhook`).
- Events to send: **`payment_intent.succeeded`**, **`payout.paid`**, **`charge.refunded`**, **`charge.dispute.created`** (S4 is built — subscribe all four now).
- Save → reveal the **Signing secret** (`whsec_…`).

**3 — Cloudflare Pages env vars** (Settings → Environment variables; **Preview** for dev,
**Production** for main — then redeploy that branch):
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`. (Optional
`APP_BASE_URL` for Checkout return URLs — defaults to the request origin.)

**4 — QBO accounts** (QuickBooks → Chart of Accounts → New):
- a **Bank**-type account "**Stripe Clearing**",
- an **Expense**-type account "**Merchant Fees**",
- confirm your real **checking/bank** account exists (payout destination).

**5 — Map them in UPR** → `/payments/settings` (admin/manager): click **Load accounts
from QuickBooks** and pick **Stripe clearing account**, **Merchant fees expense account**,
and **Deposit bank account**. Then click **Load from Stripe** and pick the **standard
payout checking account** + **instant-payout debit card**. (Connection flips to
"Connected" automatically.)

**6 — Live test on dev** (Stripe test mode): open an invoice in `/invoices/:id` → **Send
to QuickBooks** → **Create pay link** → pay it with a Stripe **test card**
(`4242 4242 4242 4242`). Verify: a `payments` row (source `stripe`) appears with the
gross + a synced QBO Payment **deposited to Stripe Clearing**; a QBO **Purchase** booked
the fee to Merchant Fees; the invoice balance drops. Then trigger/await a **payout** in
test mode and confirm a QBO **Transfer** (clearing → bank) for the net. Try the **⚡ Pay
out now** button. Re-deliver the same webhook event from the Stripe Dashboard and confirm
it **no-ops** (idempotency). **S4:** refund that test charge in the Stripe Dashboard →
confirm the QBO Payment + fee Purchase are removed, the invoice balance reopens, and a
**Refunded** chip shows on the payment; (optionally) simulate a dispute and confirm A/R
reopens with a **Disputed** chip. Confirm whether your account returns the processing fee
on refund — if it does NOT, keep the fee Purchase (adjust the full-refund path).

**Built artifacts (reference):** `functions/lib/stripe.js`; `quickbooks.js`
(`createPayment` `depositAccountId`, `createPurchase`, `createTransfer`, `deleteEntity`);
workers `stripe-webhook` / `stripe-pay-link` / `stripe-payout` / `stripe-accounts`;
migration `20260620_stripe_s3.sql` (applied). **Idempotency:** event id via
`claim_stripe_event` + unique `payments.stripe_charge_id`. **S4 (refunds/disputes):**
on `charge.refunded` / `charge.dispute.created`, reverse the payment + fee Purchase via
`deleteEntity` (not yet built).

---

## 5. Reference map

**Routes:** `/collections` (hub) · `/collections/:claimId` (claim A/R workspace) · `/invoices/:invoiceId` (editor) · `/payments/settings` · `/help` · claim page Billing section · customer Financial tab.
**Frontend:** `src/components/ClaimBilling.jsx` (A/R panel + payments; opens editor) · `src/components/NewInvoiceModal.jsx` (+ New invoice job picker) · `src/pages/InvoiceEditor.jsx` (+ pay-by-link) · `src/pages/Collections.jsx` (hub shell + global + New invoice) · `src/components/collections/ARDashboard.jsx` · `src/components/collections/PaymentsLedger.jsx` · `src/pages/ClaimCollectionPage.jsx` (workspace) · `src/pages/PaymentSettings.jsx` (+ Stripe payout dest + Instant Payout) · `src/pages/CustomerPage.jsx` (header + New invoice) · `src/pages/Help.jsx` · gate helper `src/lib/claimUtils.js` (`canEditBilling`, `BILLING_EDIT_ROLES`, `getBalances`, `withJobFinancials`).
**Workers (`functions/api/`):** `qbo-invoice` (create/update/delete invoice, itemized) · `qbo-payment` (create/delete payment) · `qbo-query` (read-only SELECT passthrough) · `qbo-sync-customer` · `quickbooks-connect`/`-callback` · **`stripe-webhook`** (payment_intent.succeeded → payment+fee; payout.paid → transfer) · **`stripe-pay-link`** · **`stripe-payout`** · **`stripe-accounts`** · **`billing-2fa`** (email-code gate for payout destinations). Libs: `functions/lib/quickbooks.js`, **`functions/lib/stripe.js`**.
**RPCs:** `create_invoice_for_job` · `get_job_financials` · `get_ar_invoices` · `get_payments_ledger` · `get_billing_settings` / `set_billing_setting` · **`claim_stripe_event`** (webhook idempotency) · `get_claim_detail` · `get_customer_detail` · `search_contacts_for_job` (picker). **Triggers:** `recompute_invoice_from_lines` (lines→invoice total) · `update_invoice_paid` (payments→invoice/job) · invoices→jobs A/R sync.
**Key tables/cols:** `invoices` (qbo_invoice_id/qbo_doc_number/synced_at/sync_error, total/adjusted_total/amount_paid/balance_due, sent_at/due_date/paid_at, status, insurance/homeowner/deductible/depreciation split cols, **stripe_payment_link_url/checkout_session_id/created_at**) · `invoice_line_items` (+ qbo_item_id/name, qbo_class_id/name) · `invoice_adjustments` (unused UI) · `payments` (invoice_id/job_id/contact_id, amount, payment_date, payer_type, payment_method, reference_number, is_deductible, qbo_payment_id/synced_at/sync_error, **source, stripe_payment_intent_id, stripe_charge_id [uniq], stripe_fee, stripe_fee_qbo_purchase_id, **refunded_amount, refunded_at, dispute_status**) · **`stripe_events`** (RLS-locked idempotency ledger) · **`billing_2fa_codes`** (RLS-locked payout-2FA codes) · `integration_config` (key/value — billing-settings keys [+ `qbo_bank_account_*`, `stripe_payout_bank_*`, `stripe_instant_card_*`, `stripe_connected`] + `auto_draft_invoices`) · `contacts.qbo_customer_id` · `jobs.invoiced_value/collected_value` (legacy mirror).
**Migrations (this initiative):** `supabase/migrations/2026061{8,9}_*` + **`20260620_stripe_s3.sql`** (Stripe cols, stripe_events + claim_stripe_event, billing-settings payout keys) + **`20260620_payout_2fa.sql`** (billing_2fa_codes + payout keys removed from open setter) + **`20260620_stripe_s4.sql`** (payments refund/dispute cols + `update_invoice_paid` nets refunds & reopens status) + **`20260620_invoice_qbo_docnumber.sql`** (`invoices.qbo_doc_number` + `get_ar_invoices`/`get_payments_ledger` return it). All applied.
**Feature flag:** `feature:billing`. **Env (set):** `QBO_CLIENT_ID/SECRET/ENVIRONMENT/REDIRECT_URI`, `QBO_WEBHOOK_SECRET` (internal trigger secret — NOT a QBO webhook), `SUPABASE_*`. **Env (to add for Stripe — §4):** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (+ optional `APP_BASE_URL`).
**Division→QBO map** (`divisionToQbo`): recon→Item 1010000201/Class Reconstruction · mit|water|dry→1010000071/Mitigation · mold→1010000131 · contents→38.

---

## 6. Notes / caveats
- **0 invoices exist** in the DB — all A/R views are empty until one is built. A couple of legacy **job-level payments (~$11.3k)** show in the ledger (no invoice link, not synced).
- The **Item/Class dropdowns + QBO account picker need QuickBooks connected** (they read the live catalog via `qbo-query`).
- I **could not exercise live QBO** from the build environment — the invoice/payment push code follows the proven delete-path pattern and builds clean, but do a **real test on `dev`** (create invoice → add lines → Send → record payment → confirm itemized + applied in QBO).
- **Stripe S3 is built but never run live** (no keys existed at build time). The webhook/payout/fee code follows Stripe's documented API + the proven QBO patterns and builds/lints clean, the migration is applied & verified, but it **must be live-tested per §4** before relying on it (real money: instant payouts + QBO transfers). The external-account list + instant-payout destination behavior especially should be eyeballed on first real connect.
- Stripe `accept_card`/`accept_ach`/`surcharge` toggles already persisted (pre-S3); they gate intent only — nothing charges until keys + a pay-link exist.
- This session (Jun 20): shipped **A (+ New invoice picker)**, **B (Stripe S3, dormant)**, **payout-destination email-2FA**, the **refreshed Help page / guide / PDF**, and **S4 (refunds/disputes, dormant)** — all pushed to **both `dev` and `main`** at the owner's request (billing is admin/manager + `feature:billing`, so field techs see no change). Production build passes; changed files lint clean (one pre-existing `loadData` exhaustive-deps warning in `CustomerPage.jsx`, unrelated).
- **S4 modified the live `update_invoice_paid` trigger** to net `refunded_amount` (defaults 0 → existing rows unchanged) and to reopen a paid invoice's status when collected hits 0 (also fixes a pre-existing staleness when the last payment is deleted). Backward-compatible, but it's a core rollup — worth a glance during the live test. Also fixed an S3 bug: the webhook mapped ACH to `'eft'` (violates `payments_payment_method_check`) → now `'ach'`.
- **Fixed: "+ Add line" did nothing (latent bug, builder was never exercised live).** `invoice_line_items.line_total` is a GENERATED column (`quantity * unit_price`), but `InvoiceEditor` was writing `line_total` on both insert and update → Postgres rejected every write ("cannot insert a non-DEFAULT value into a generated column"); the error toast was easy to miss. Removed `line_total` from both writes (DB computes it) and fixed `saveLine` sending `description: …||null` into a NOT NULL column (→ `''`). Verified end-to-end (insert + recompute trigger) on the live DB.
- **Invoice numbers (owner-requested):** QBO invoices were coming through with a **blank number** — the QBO company has *Custom transaction numbers* ON, so QBO expects us to supply the number and we were sending none. Fix: the worker now sends the **job number as the QBO `DocNumber`** (create + update; unique per job, ≤21 chars). So the QBO invoice number == the job number (e.g. `W-2606-010`). UPR captures it back into `invoices.qbo_doc_number` and displays it, so UPR == QBO. Safe if that QBO setting is ever OFF (QBO ignores it and auto-numbers). Existing blank-numbered invoices get the job number on their next send/update. **Verified live (Jun 22):** the QBO company has Custom transaction numbers ON, and a UPR-pushed invoice (`R-2604-009`) carries the job number — fix confirmed in production. **QBO memo standardized** to `Date of loss · Job · Claim · Service Address` (full address), written to `CustomerMemo` (prints on the invoice) + `PrivateNote` (internal). The job's **service address** (job.address/city/state/zip → claim loss-address fallback) also goes to the invoice's structured **Ship To (`ShipAddr`)** — full length, no 31-char cap, prints when QBO *Sales → Shipping* is on. **Dropped the legacy 31-char custom field:** on Advanced the enhanced/named custom fields aren't writable via the v3 API (only the 3 legacy string fields; Intuit's GraphQL Custom Fields API is Gold/Platinum-partner-gated), so Ship To + CustomerMemo are the writable homes. Owner action: flip on QBO *Sales → Shipping* to show Ship To (memo prints regardless); the "Ship To" label can't be renamed in QBO.
- The **payout-destination 2FA emails a code via Resend** (functions/lib/email.js, Jun 24 2026 — replaced the dead SendGrid path that hadn't delivered since mid-April). The bank/card fields can't be changed until `RESEND_API_KEY` is set and the utahpros.app sending domain is verified in Resend. Owner email lives in `integration_config.billing_2fa_email` (default `moroni.s@utah-pros.com`).

*When the whole initiative is steady-state, fold the essentials into `UPR-Web-Context.md` and delete this file + `QBO-PHASE-2-PLAN.md` (per the Task File Protocol in CLAUDE.md).*
