# UPR Billing / A·R — QuickBooks Reconciliation & Consumer Chain

**Last updated:** 2026-06-25 · **Author:** reconciliation session (branch `claude/vigilant-davinci-m2ds35`)
**Status:** Analysis + design complete. **No DB writes made yet** — implementation is **ON HOLD**
to avoid colliding with concurrent work on the shared Supabase: (a) an estimates/invoices chat and
(b) the inbound QBO **payment** webhook + cron that is turning this into a **two-way** integration for
payments (see §3e, §7).

> **Read alongside** `QBO-BILLING-STATUS.md` (the locked billing strategy & status — authoritative)
> and `UPR-Web-Context.md` (full technical reference). This file is the **data-flow map**: it traces
> how an invoice/payment travels from QuickBooks/UPR through the database into every A/R screen, so
> the next person can change one link without breaking the others. It exists because of the one-time
> **90-day QBO→UPR invoice reconciliation** (§6) and the per-service-revenue requirement it surfaced.

---

## 1. The one fact that explains everything

- **Invoices flow UPR → QuickBooks; payments are two-way.** UPR is the system of record and invoices
  are built in UPR and pushed to QBO (`QBO-BILLING-STATUS.md` §1). **Payments sync both directions:**
  UPR-recorded payments push to QBO, **and** payments made online against a QBO invoice (the pay-now
  link) flow **back into UPR** via `qbo-webhook` + the hourly `qbo-payments-sync` cron (in active
  development — §3e). So "QBO is just a mirror" holds for invoice *content*, but **payment events
  originate on both sides.**
- **One invoice = one job = one division.** A claim with Mitigation + Reconstruction is **two jobs**,
  hence **two invoices**. `invoice_line_items` carry a per-line **QBO Item + Class**, but the invoice
  header attaches to exactly **one** `job_id`. There is **no `job_id`/`division` on a line item.**
- Therefore **job revenue rolls up by *whole invoice* → `job_id`** (`sync_job_invoiced_from_invoices`),
  and the live revenue KPI buckets by the **job's** division — *not* by line item. This is the crux of
  the multi-trade problem in §5.

The 90-day reconciliation (§6) is a one-time **inbound backfill of invoices** created *directly in
QuickBooks* before UPR billing existed — a migration to catch UPR up. It is separate from the ongoing
**inbound payment** sync (§3e): the backfill brings in historical invoices (and the payments already
recorded against them), while the webhook/cron keeps *future* online payments flowing into UPR.

---

## 2. Tables (where the money lives)

| Table | Key columns | Notes |
|---|---|---|
| `invoices` | `job_id`→jobs, `contact_id`→contacts, `total`/`adjusted_total`, `amount_paid`, `balance_due`, `status`, `invoice_date`, `due_date`, `sent_at`, `qbo_invoice_id`, `qbo_doc_number`, `qbo_synced_at` | One per job. `qbo_invoice_id` = the QBO `Invoice.Id`; `qbo_doc_number` = QBO `DocNumber` (== job number). `job_id` is **required**. |
| `invoice_line_items` | `invoice_id`→invoices, `description`, `quantity`, `unit_price`, `line_total` (**GENERATED** = qty×price), `category`, `qbo_item_id`/`qbo_item_name`, `qbo_class_id`/`qbo_class_name`, `sort_order` | **No job_id / no division.** The per-line **trade** lives (or will live) in `category` + the `qbo_*` fields. ⚠️ `line_total` is generated — never write it. |
| `payments` | `invoice_id`→invoices, `job_id`→jobs, `contact_id`, `amount`, `payment_date`, `payment_method`, `payer_type`, `reference_number`, `qbo_payment_id`, `source` (`manual`/`qbo`/`stripe`), `refunded_amount`, `dispute_status` | Applied to the whole invoice (QBO has no per-line payment). |
| `jobs` | `division` (single trade), `invoiced_value`, `collected_value`, `ar_status`, `claim_id`→claims, `primary_contact_id`→contacts | `invoiced_value`/`collected_value` are **mirrors** maintained by triggers/`sync_job_invoiced_from_invoices`. |

Relationship for context: **contact (client) ← job → claim**, and `invoice.job_id` is the anchor that
lets every A/R surface show client + claim + division + job number for an invoice.

---

## 3. The consumer chain (DB → RPC/view → screen)

```
                         ┌───────────────────────────────────────────────────────────┐
 QuickBooks (Items/      │  invoices ── invoice_line_items                            │
 Classes, Payments)      │     │              (per-line QBO Item+Class, category)     │
        │  push (UPR→QBO)│     ├── payments                                           │
        │  + 1-time      │     └── job → claim → contact                              │
        │  backfill →    └───────────────────────────────────────────────────────────┘
        ▼                         │                 │                  │
   (writes rows)                  ▼                 ▼                  ▼
                       get_ar_invoices()   get_revenue_by_division()  (direct db.select on
                       get_payments_ledger()  get_job_financials()     invoices/lines/payments)
                                │   │   │            │                         │
        ┌───────────────────────┘   │   └─────────┐  │                         │
        ▼                           ▼             ▼  ▼                         ▼
 ARDashboard.jsx          InvoicesList.jsx  PaymentsLedger.jsx        ClaimBilling.jsx
 (Collections → A/R:      (Collections →    (Collections →           (claim "Invoices &
  Outstanding / Overdue /  Invoices tab)     Payments tab)            Payments" panel +
  aging Current·30·60·90)                                             customer Financial tab)
        ▲
 useCollections.js  ── overview "Collections" card (Past due / Due / Unsent + DSO)
 useRevenue.js      ── overview "Revenue recognized" card  ◄── get_revenue_by_division()
```

> **Two-way for payments:** beyond the UPR→QBO push, payments made online against a QBO invoice flow
> **back** into UPR via `qbo-webhook` + the `qbo-payments-sync` cron — see **§3e**.

### 3a. A/R & aging — `get_ar_invoices()` (the workhorse)
- Returns **one row per invoice** with `balance = adjusted_total/total − amount_paid`, plus `due_date`,
  `status`, `sent_at`, `qbo_invoice_id`, and job/claim/contact/division context. **No date or QBO filter
  — every invoice (incl. drafts) appears.**
- **Consumers:**
  - `src/components/collections/ARDashboard.jsx` — Collections → **A/R · Outstanding** tab. Computes,
    in the frontend:
    - **Outstanding** = Σ `balance` where `balance > 0`.
    - **Overdue** = Σ `balance` where `daysPastDue > 0` (`due_date < today`).
    - **Aging buckets** from `daysPastDue`: `Current` (≤0 or no due date) · `1–30` · `31–60` · `61–90` · `90+`.
    - **Status** chip: Paid (`bal≤0`), Overdue (`bal>0 & past due`), Partial (`paid>0`), Sent
      (`qbo_invoice_id || sent_at`), else Draft.
  - `src/components/overview/hooks/useCollections.js` — overview **Collections card**: **Past due**
    (sent & `due_date<today`), **Due** (sent & not past due), **Unsent** (draft / not sent), + **DSO**
    (avg age from `invoice_date`).
  - `src/components/collections/InvoicesList.jsx` — Collections → **Invoices** tab (full searchable list).

> **What this means for the backfill:** the entire Collections page is driven by per-invoice fields.
> It needs **no code changes** — it lights up automatically as long as each imported invoice has a
> correct `due_date`, `total`, `amount_paid` (→ balance), `status`, and `qbo_invoice_id`/`sent_at`
> (so it reads as *Sent*, not *Unsent*), plus a valid `job_id` (for client/claim/division columns).

### 3b. Payments — `get_payments_ledger()`
- One row per payment with invoice/job/claim/contact context. Consumer:
  `src/components/collections/PaymentsLedger.jsx` (Collections → Payments tab, cash-in history).

### 3c. Revenue by service — `get_revenue_by_division()`
- **Today:** buckets each invoice by `dash_division_bucket(job.division)` and sums the **whole**
  `adjusted_total/total`, **`WHERE qbo_invoice_id IS NOT NULL`**.
  `dash_division_bucket`: `reconstruction`→reconstruction, `mold`→mold, `remodeling`→remodeling,
  **everything else (water/fire/contents/general) → `mitigation`**.
- **Consumer:** `src/components/overview/hooks/useRevenue.js` (overview **Revenue recognized** card),
  which renders the returned `segments` against a **fixed token list** `DIVISIONS` in
  `src/components/overview/tokens.js` = `[mitigation, reconstruction, remodeling, mold]`.
- ⚠️ **Two consequences:** (1) a backfilled invoice **only counts in revenue if `qbo_invoice_id` is set**;
  (2) any segment key not in `DIVISIONS` (e.g. `contents`, `testing`) **won't display** even if the RPC
  returns it.

### 3d. Per-claim / per-customer panel — `ClaimBilling.jsx` (direct selects)
- `src/components/ClaimBilling.jsx` reads `invoices`, `invoice_line_items`, `payments` **directly**
  (`db.select`, filtered by the claim's `job_id`s). Renders per-job invoice + a read-only **line summary
  (already shows `qbo_class_name`)** + payment history + record-payment. Used on the claim page Billing
  section, the **customer Financial tab**, and the per-claim A/R workspace (`ClaimCollectionPage.jsx`).
- ⚠️ **Gotcha:** it keeps **one invoice per job** (`invByJob[inv.job_id] = first`). A job with *multiple*
  invoices (e.g. a base invoice + a later add-on) under-displays here. The global `ARDashboard` is
  invoice-centric and shows them all; the claim panel is the limited one.

### 3e. Inbound payments — the two-way path (in active development)
- **Online payments made on a QBO invoice** (the pay-now link / QuickBooks Payments) flow **back into
  UPR**, so nobody re-keys them. Path: `functions/api/qbo-webhook.js` (Intuit webhook, HMAC-verified,
  claims each event once via `claim_qbo_event` + the `qbo_events` table) **and**
  `functions/api/qbo-payments-sync.js` (hourly cron safety-net) → `functions/lib/qbo-payment-sync.js`
  maps the QBO `Payment` → a `payments` row (`source='qbo'`), matched to the invoice by **`qbo_invoice_id`**.
- **No double-count:** a payment UPR itself pushed to QBO is skipped on its echo because its
  `qbo_payment_id` already exists on a UPR payment. The `update_invoice_paid` trigger then rolls the
  imported payment into `invoices.amount_paid`/`status` and `jobs.collected_value` — so it surfaces in
  `get_ar_invoices`, `get_payments_ledger`, and `ClaimBilling` **automatically** (no extra wiring).
- **Status:** built (`QBO-BILLING-STATUS.md` §4B) and being **activated/extended** by the concurrent
  work that makes payments genuinely two-way. Activation = Intuit webhook subscription on **Payment** +
  `QBO_WEBHOOK_VERIFIER_TOKEN` (Cloudflare) + the hourly cron on `qbo-payments-sync`.
- ⚠️ **Reconciliation interplay (critical):** when the §6 backfill imports an invoice's historical
  payments, each `payments` row **must carry its `qbo_payment_id`** so the inbound sync dedups it and
  does **not** re-import the same payment. Conversely, once the cron is live it may pull those same
  historical QBO payments itself — so the backfill and the cron must be **coordinated** (don't let both
  create the same payment). Match key on both sides is `qbo_payment_id` (+ `qbo_invoice_id` for linkage).

### 3f. Deprecated — do NOT build on these
- **`billing_overview`** (view) and **`get_ar_jobs()`** (RPC) are **unused** — **0 references in `src/`**
  (confirmed) and flagged legacy in `QBO-BILLING-STATUS.md`. `billing_overview` also folds water/**mold**/
  fire/contents into a single `mit_*` bucket. **Don't rewrite it for per-service reporting** — the live
  path is `get_revenue_by_division`. (Safe to drop later.)

---

## 4. The QBO Item → UPR service map (for line-item classification)

Every QBO revenue line carries an **Item** (the **Class** is blank on most lines, so classify by **Item**).
Authoritative IDs come from `divisionToQbo` in the worker (`QBO-BILLING-STATUS.md` §5):

| QBO Item (`qbo_item_name`) | `qbo_item_id` | → UPR service (`category`) |
|---|---|---|
| `Water Damage: …Mitigation And Drying` | `1010000071` | **mitigation** |
| `Reconstruction: …Remodeling Services` | `1010000201` | **reconstruction** |
| `Mold: Mold Remediation Services` | `1010000131` | **mold** |
| `Contents: Pack out/ Pack in` | `38` | **contents** |
| `Testing Mold/ Asbestos/ Sewer Services` | (n/a in map) | **testing** *(decision 2026-06-25: its own service)* |
| `Discounts: Insurance Adjustments` | — | contra (nets against its service) |

In the 90-day window the line mix was: Reconstruction ×31, Water/Mitigation ×19, Mold ×8, Testing ×7,
Contents ×2, Discount ×1 — i.e. **~100% classifiable by Item**.

---

## 5. The multi-trade problem & the chosen model

**Problem:** a few historical QBO invoices (mostly **A2Z Properties**) bill **multiple trades on one
invoice**, but UPR tracks each trade as a **separate job**, and revenue buckets by the **job's** division
+ whole invoice. Attaching such an invoice to one job mis-attributes the other trades' revenue.

**Decision (owner, 2026-06-25):** keep **one UPR invoice per QBO invoice (1:1, so A/R mirrors QBO
exactly)**, attach it to the **dominant-trade job in the correct claim**, and **classify each line's trade**
into `invoice_line_items.category` (from the Item map in §4). Then **drive per-service revenue from the
line items**, not the job division.

**Implementation when un-paused (§7):**
1. **Import** (data): 1 invoice + classified line items + payment(s); set `due_date`, `total`,
   `amount_paid`, `balance_due`, `status`, **`qbo_invoice_id`**, `job_id`/`contact_id`; then call
   `sync_job_invoiced_from_invoices(job_id)`.
2. **Rewire `get_revenue_by_division`** to sum `invoice_line_items.line_total` grouped by `category`
   (keep the same `{total, prev_total, segments}` return shape; keep the `qbo_invoice_id IS NOT NULL`
   gate). → "how much we sold of each service" becomes exact regardless of job attachment.
3. **Add `contents` + `testing` (and confirm `mold`) to `DIVISIONS`** in `tokens.js` so the Revenue
   card actually renders them.
4. **Collections:** nothing to do (§3a).
- *"Sold per service"* = Σ line totals by `category` (exact). *"Collected per service"* = pro-rated from
  each invoice's `amount_paid` by line share (payments aren't line-specific). *Job-level* `invoiced_value`
  stays whole-invoice (only matters if per-**job**, not per-**service**, precision is later required —
  that would need a `job_id` on line items, a larger change not currently planned).

---

## 6. The 90-day reconciliation (what triggered this)

All invoices **created in QuickBooks in the last 90 days** (since 2026-03-27) matched against UPR jobs.
**43 invoices · $258,637.43 billed · $98,349.56 open A/R.** Matching is conservative (service address +
customer + division). Tiers (full review list was delivered separately as an artifact + CSV):

| Tier | # | Meaning |
|---|--:|---|
| Already in UPR | 2 | `qbo_invoice_id` already set (Sebastian Garcia) — skip |
| Confident | 19 | exact address + name → single job; ready to import |
| Probable | 5 | one clear job, minor caveat (no service address / placeholder job address) |
| Name differs | 2 | address exact but QBO customer ≠ UPR insured — confirm same party |
| Pick the job | 12 | property has multiple jobs, or A2Z office-billed (loss site not on invoice) |
| No UPR job | 3 | Nathan Speaker, Brady Hansen, "923 E Alpine Dr / E Builders" — no job exists |

Import uses **direct, controlled inserts** (NOT `create_invoice_for_job` / `convert_estimate_to_invoice`)
specifically so it doesn't couple to the estimate/invoice code the other chat is editing (§7).

### 6a. EXECUTED — Confident batch imported (2026-06-25)

The **19 confident invoices are now in UPR** (`INV-000010`–`INV-000028`), reconciling to QuickBooks
exactly: **$98,577.21 billed · $84,537.61 collected · $14,039.60 open**, 29 line items, 26 payments.
All carry `qbo_invoice_id`/`qbo_doc_number`/`qbo_payment_id` + `qbo_synced_at` so they are treated as
**already in QBO** (no re-push) and the inbound cron dedups them.

Per your rule (revenue must sit in a division-matched job), **6 new jobs were created** for invoices
whose trade had no matching-division job in the claim:
`R-2606-001` (Kelly Dewey recon, inv 1232), `R-2606-002` (Marc Jackson recon, 1265),
`M-2606-001` (Pauline Bradford mold/testing, 1266), `C-2606-001` (Angela Duty contents, 1267),
`M-2606-002` (Jacob Speakman mold, 1269), `M-2606-003` (Jaren Pope mold, 1272).

Per-service revenue (from line items, the figures the rewired KPI will surface): reconstruction
$79,234.63 · mitigation $10,195.93 · contents $5,143.09 · mold $2,500.00 · testing $1,986.06 ·
gratuity $17.50 · discount −$500.00.

Mechanics confirmed: inserting line items auto-set each invoice `total`; inserting payments auto-set
`amount_paid`/`status`/`balance_due` (generated col `total − amount_paid`) and `jobs.collected_value`;
`trg_invoices_sync_job_ar` set `jobs.invoiced_value`. Collections aging now populates from these.

**Still pending:** (a) the `get_revenue_by_division` line-item rewire (§3c/§5) — held until the
estimates/payment-sync chat lands (the per-service line data is already in place, so the rewire is
purely a reporting change); (b) the remaining review tiers — 5 probable, 2 name-differs, 12 pick-the-job
(incl. A2Z), 3 no-UPR-job. Minor: new job `M-2606-003` (unpaid) shows `ar_status='open'` rather than
`'invoiced'` until its first payment fires `update_invoice_paid` — cosmetic, self-corrects.

### 6b. Line-item gap in the later batches — backfilled 2026-07-07

The confident batch (§6a) imported classified line items, but the **later manual reconciliation
imports** (Trevor Merrill, Dave Bevan, Paul Engman, the noon-timestamp batch, etc. → roughly
`INV-000049`–`INV-000087`) inserted only the invoice **header + payment(s)** — no `invoice_line_items`.
Result: **35 invoices carried a total but zero line detail**, surfacing as "amount due, no line items"
on the 8 still-unpaid ones (the paid ones hid it behind a $0 balance) and as an empty grid / "$0 Total
due" preview in `InvoiceEditor` (its subtotal is computed from lines; Save is also gated on
`subtotal > 0`). AR and revenue were unaffected (both read the header `total`, per §3a/§3c). Fixed by
pulling each invoice's lines from its QBO source and restoring them via
`scripts/backfill-recon-invoice-lines.sql` — an idempotent, self-asserting, all-or-nothing backfill
that preserves every header total to the cent (50 line rows across the 35; the 4 water/recon split
pairs allocated by trade; the offsetting $1,005.63 INV-000080/INV-000081 pair kept its per-job
grouping). This puts the per-service line data in place for the §5 revenue rewire. **Lesson for any
remaining tiers:** import the *lines*, not just the header — a header-only invoice ties out in AR but
looks empty everywhere line detail is shown, and `qbo-invoice.js`'s no-lines summary fallback masks it
in QBO.

### 6c. Line-amount corrections + invoice-number hardening — 2026-07-07

Two follow-ups surfaced while verifying §6b:

1. **Wrong line amounts (4 invoices).** The earlier "confident batch" set some invoice **totals**
   correctly (to the QBO-billed amount) but keyed the **line** at the gross estimate, so `subtotal ≠
   total`: INV-000011 & INV-000029 (a recon+mit split of QBO 4309), INV-000036, INV-000037. Each was
   verified against QuickBooks and the line corrected to the QBO-billed figure — **totals/balances
   unchanged** (QBO carries no separate discount line for these, so the line is corrected, not offset
   with a negative line; genuine discounts elsewhere ARE negative line items). Script:
   `scripts/fix-recon-invoice-line-amounts.sql`.

2. **Invoice-number collision (systemic).** `generate_invoice_number()` used `invoice_number_seq`,
   which the explicit-numbered backfills never advanced, so the app began re-issuing used numbers (a
   July draft got INV-000062). Hardened exactly like claim numbers: renumber the stray → INV-000088,
   `UNIQUE(invoice_number)`, and a max-suffix+1 generator under an advisory lock
   (`supabase/migrations/20260707_harden_invoice_number_generation.sql`). A re-runnable
   `scripts/invoice-integrity-check.sql` now flags all three defect classes (lineless-with-amount,
   total≠lines+tax, duplicate numbers) — the #6 "final sweep." **Deliberately left alone:**
   `qbo-invoice.js`'s no-lines fallback (a harmless safety net now that every invoice has lines and the
   app can't create a lineless-with-total one) — changing that money worker wasn't worth the risk.

---

## 7. Conflict & coordination status (IMPORTANT)

- **One shared Supabase** (`glsmljpabrwonfiltiqm`) serves **dev *and* prod** — there is no DB branching.
  Any DB DDL or row write is live for everyone immediately.
- **Concurrent work is changing (a) estimates/invoices and (b) the inbound QBO payment webhook + cron**
  (the two-way payment path, §3e). Frontend is branch-isolated (resolved at merge); the DB is not.
  **Collision surface:** the `invoices`/`invoice_line_items`/`payments` **schema**, the
  **`get_revenue_by_division`** object, the **inbound payment path** (`qbo-webhook`, `qbo-payments-sync`,
  `qbo-payment-sync.js`, `qbo_events`/`claim_qbo_event`), and shared frontend files
  (`InvoiceEditor.jsx`, `Estimates.jsx`, `EstimateEditor.jsx`) — which this work avoids.
- **Current decision: HOLD all writes** (no inserts, no DDL) until the concurrent invoice/estimate **and
  payment-sync** changes land and the table shapes are settled. Before importing, re-validate
  `invoices`/`invoice_line_items`/`payments` columns and `get_revenue_by_division` against the final
  shape, **and confirm the activated inbound payment sync's dedup behavior** so backfilled payments
  (carrying `qbo_payment_id`) and the cron don't double-create (§3e).

---

## 8. File / object index

- **RPCs (live):** `get_ar_invoices` · `get_payments_ledger` · `get_revenue_by_division` ·
  `get_job_financials` · `sync_job_invoiced_from_invoices` · `dash_division_bucket`.
- **RPCs/views (deprecated, unused):** `billing_overview` · `get_ar_jobs`.
- **Inbound payment path (two-way, §3e):** `functions/api/qbo-webhook.js` · `functions/api/qbo-payments-sync.js`
  (hourly cron) · `functions/lib/qbo-payment-sync.js` · RPC `claim_qbo_event` · table `qbo_events` ·
  trigger `update_invoice_paid`. **Outbound:** `functions/api/qbo-invoice.js` · `functions/api/qbo-payment.js`.
- **Frontend:** `src/components/collections/ARDashboard.jsx` · `InvoicesList.jsx` · `PaymentsLedger.jsx` ·
  `src/components/ClaimBilling.jsx` · `src/pages/Collections.jsx` · `src/pages/ClaimCollectionPage.jsx` ·
  `src/components/overview/hooks/{useCollections,useRevenue}.js` · `src/components/overview/tokens.js`
  (`DIVISIONS`).
- **Related docs:** `QBO-BILLING-STATUS.md` (strategy/status) · `UPR-Web-Context.md` (full reference) ·
  `UPR-Invoicing-Financials-Employee-Guide.md` (end-user guide).

---

## 9. User-facing docs to revise when two-way payments ships

These explain the billing model to staff and **currently say payments are one-way** — they need updating
once the inbound payment sync (§3e) is activated. **Coordinate ownership:** the chat shipping the two-way
feature may own these edits, to avoid a `Help.jsx` merge conflict.

- **`src/pages/Help.jsx`** (in-app *Help & Guides → Invoicing & Financials*). Outdated copy:
  - §1 "The Big Picture": *"**Everything flows one way: UPR → QuickBooks … Nobody edits invoices or
    payments directly in QuickBooks**"* and *"Payments you record in UPR post to QuickBooks automatically"*
    — should keep **invoices** as UPR→QBO but state **payments are two-way**: a customer paying the QBO
    invoice online flows **back into UPR automatically**. The diagram line `(payments sync to QBO)` →
    `(payments sync both ways)`.
  - §7 "DON'T": *"Don't enter invoices or payments directly in QuickBooks"* → keep the **invoice** rule,
    but clarify a **customer's online payment on the QBO invoice is expected and syncs back** (not a no-no).
  - Optional new FAQ: *"A customer paid the QuickBooks invoice online — do I record it?"* → *"No, it
    imports to UPR on its own; just confirm it shows up."*
- **`UPR-Invoicing-Financials-Employee-Guide.md`** — same corrections (kept in sync with the Help page).
- **`public/UPR-Invoicing-Financials-Guide.pdf`** — regenerate via `scripts/build-invoicing-guide-pdf.py`
  after the markdown changes.

Phrasing tip: the guide already documents not-yet-live features with a soft caveat (Stripe pay-link
"*available once connected*") — use the same conditional for the inbound payment sync until it's activated.
