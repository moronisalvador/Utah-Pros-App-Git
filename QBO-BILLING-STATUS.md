# UPR Billing · Invoicing · A/R · QuickBooks · Stripe — Handoff & Status
**Last updated:** 2026-06-19 · **Branches:** `dev` and `main` are **in sync** (both auto-deploy via Cloudflare Pages) · **Supabase project:** `glsmljpabrwonfiltiqm`

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

**Cleanup done:** removed the old job-centric `ARPage` cluster + stale `COLLECTIONS_*.md`. Legacy `billing_overview` view + `get_ar_jobs` RPC remain in the DB (harmless, unused) — drop later if desired.

---

## 3. NEXT — build in this order (in the new chat)

**A) "+ New invoice" with job picker** *(small, do first; owner-requested)*
- A "**+ New invoice**" button on the **Customer page** (header) and optionally a global one on **Collections**.
- Opens a **job picker** (customer page → that customer's jobs; global → search customer/claim/job). On choose → `create_invoice_for_job(job_id)` → navigate to `/invoices/:id`. If the job already has an invoice, it opens that one (RPC handles it). Respects one-invoice-per-job. Reuse `CreateJobModal`/`LookupSelect` patterns for the picker.

**B) Stripe S3 — live card collection + fee automation** *(needs owner setup — see §4)*

**C) Stripe S4 — refunds/disputes** → reverse the payment (+ fee) in QBO on `charge.refunded` / `charge.dispute.created`.

**D) Remaining / polish**
- Flip `integration_config.auto_draft_invoices` → `'true'` after a real prod test (auto-creates a draft per job).
- **Deeper security:** RLS / RPC role checks on financial tables (safeguards are UI-level today).
- Customer-edit → QBO push (e.g. email change; today contact edits don't sync to QBO — create-only).
- `invoice_adjustments` UI (supplements/denials — table exists, unused).
- Update the employee guide/PDF/Help to the builder flow.
- Drop deprecated `billing_overview` / `get_ar_jobs` once confident.

---

## 4. Stripe S3 — build spec (for the new chat)

**Owner setup checklist (prerequisite — can't build/test without it):**
1. Stripe account → **test-mode** API keys (publishable + secret).
2. Cloudflare Pages env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` (after registering the webhook).
3. QBO: create a **bank-type "Stripe Clearing"** account + a **"Merchant Fees"** expense account → map them on **`/payments/settings`** (already built; "Load accounts from QuickBooks").

**Build:**
- **Pay-by-link on invoices**: from `InvoiceEditor` (and/or invoice send), create a Stripe Checkout/Payment Link / hosted invoice for the balance; email the client. Store the link/session on the invoice (add a column or a `stripe_*` field).
- **`functions/api/stripe-webhook.js`**: verify `STRIPE_WEBHOOK_SECRET`; on `payment_intent.succeeded`/`charge.succeeded`, read the charge's **`balance_transaction`** for exact `amount`/`fee`/`net`; then:
  1. insert a `payments` row (method `credit_card`/`ach`, `qbo_payment_id` set after push) and call the existing `qbo-payment` rail — BUT deposit to the **Stripe clearing account** (extend `createPayment` to set `DepositToAccountRef` from the mapped clearing account).
  2. post a **fee Purchase/Expense** (from clearing account → Merchant Fees account, both from `get_billing_settings`) for the exact fee.
  3. on `payout.paid`, post a **Transfer** clearing→bank for the net.
- **Instant Payout button** (Payment Settings): `POST /v1/payouts {method:'instant', destination: <instant card>}` via a small `functions/api/stripe-payout.js`.
- **Payout-destination selectors in Payment Settings** (owner-requested): read the account's external accounts from Stripe (bank accounts + debit cards), let the user set the **default payout checking account** (standard deposits) and the **instant-payout debit card** (`destination` for instant payouts). "Add new" → Stripe Dashboard / Financial Connections (no raw entry in UPR). Persist chosen ids in `integration_config` (e.g. `stripe_payout_bank_id`, `stripe_instant_card_id`) — add these keys to the `set_billing_setting` whitelist.
- Mark `stripe_connected` setting true when keys present (so the settings page + button activate).
- **Idempotency:** key on Stripe event id / `qbo_payment_id`; never double-post. **Refunds/disputes (S4):** reverse payment + fee.

Extend `lib/quickbooks.js` with `createPurchase`/`createTransfer` helpers (mirror existing). New Stripe lib `functions/lib/stripe.js` (verify signature, fetch balance_transaction).

---

## 5. Reference map

**Routes:** `/collections` (hub) · `/collections/:claimId` (claim A/R workspace) · `/invoices/:invoiceId` (editor) · `/payments/settings` · `/help` · claim page Billing section · customer Financial tab.
**Frontend:** `src/components/ClaimBilling.jsx` (A/R panel + payments; opens editor) · `src/pages/InvoiceEditor.jsx` · `src/pages/Collections.jsx` (hub shell) · `src/components/collections/ARDashboard.jsx` · `src/components/collections/PaymentsLedger.jsx` · `src/pages/ClaimCollectionPage.jsx` (workspace) · `src/pages/PaymentSettings.jsx` · `src/pages/Help.jsx` · gate helper `src/lib/claimUtils.js` (`canEditBilling`, `BILLING_EDIT_ROLES`, `getBalances`, `withJobFinancials`).
**Workers (`functions/api/`):** `qbo-invoice` (create/update/delete invoice, itemized) · `qbo-payment` (create/delete payment) · `qbo-query` (read-only SELECT passthrough) · `qbo-sync-customer` · `quickbooks-connect`/`-callback`. Lib: `functions/lib/quickbooks.js`.
**RPCs:** `create_invoice_for_job` · `get_job_financials` · `get_ar_invoices` · `get_payments_ledger` · `get_billing_settings` / `set_billing_setting` · `get_claim_detail` · `get_customer_detail`. **Triggers:** `recompute_invoice_from_lines` (lines→invoice total) · `update_invoice_paid` (payments→invoice/job) · invoices→jobs A/R sync.
**Key tables/cols:** `invoices` (qbo_invoice_id/qbo_synced_at/qbo_sync_error, total/adjusted_total/amount_paid/balance_due, sent_at/due_date/paid_at, status, insurance/homeowner/deductible/depreciation split cols) · `invoice_line_items` (+ qbo_item_id/name, qbo_class_id/name) · `invoice_adjustments` (unused UI) · `payments` (invoice_id/job_id/contact_id, amount, payment_date, payer_type, payment_method, reference_number, is_deductible, qbo_payment_id/qbo_synced_at/qbo_sync_error) · `integration_config` (key/value — billing-settings keys + `auto_draft_invoices`) · `contacts.qbo_customer_id` · `jobs.invoiced_value/collected_value` (legacy mirror).
**Migrations (this initiative):** `supabase/migrations/2026061{8,9}_*` (invoice qbo foundation, invoice→job AR sync, get_job_financials, payments_qbo_sync, get_ar_invoices, invoice_line_items_qbo, get_payments_ledger, billing_settings).
**Feature flag:** `feature:billing`. **Env (set):** `QBO_CLIENT_ID/SECRET/ENVIRONMENT/REDIRECT_URI`, `QBO_WEBHOOK_SECRET` (internal trigger secret — NOT a QBO webhook), `SUPABASE_*`. **Env (to add for Stripe):** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.
**Division→QBO map** (`divisionToQbo`): recon→Item 1010000201/Class Reconstruction · mit|water|dry→1010000071/Mitigation · mold→1010000131 · contents→38.

---

## 6. Notes / caveats
- **0 invoices exist** in the DB — all A/R views are empty until one is built. A couple of legacy **job-level payments (~$11.3k)** show in the ledger (no invoice link, not synced).
- The **Item/Class dropdowns + QBO account picker need QuickBooks connected** (they read the live catalog via `qbo-query`).
- I **could not exercise live QBO** from the build environment — the invoice/payment push code follows the proven delete-path pattern and builds clean, but do a **real test on `dev`** (create invoice → add lines → Send → record payment → confirm itemized + applied in QBO).
- Every change this session was committed in small steps and pushed; `dev` and `main` are synced. Production build passes; new code is lint-clean (repo has some pre-existing unused-import lint debt unrelated to this work).

*When the whole initiative is steady-state, fold the essentials into `UPR-Web-Context.md` and delete this file + `QBO-PHASE-2-PLAN.md` (per the Task File Protocol in CLAUDE.md).*
