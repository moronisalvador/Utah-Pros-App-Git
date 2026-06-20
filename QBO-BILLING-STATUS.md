# QBO Billing & A/R — Project Status & Handoff
**Last updated:** 2026-06-19 · **Branch:** `dev` (auto-deploys to Cloudflare Pages) · **Supabase:** `glsmljpabrwonfiltiqm`

> **START HERE if you're resuming this work in a new chat.** This is the index for the
> QuickBooks billing / invoicing / A/R initiative: what's done, what's left, and how to
> pick up. Read order: **(1) this file → (2) `QBO-PHASE-2-PLAN.md` (detailed roadmap) →
> (3) `UPR-Web-Context.md` (permanent technical truth — all tables/RPCs/components).**

---

## TL;DR — where things stand (Jun 2026)
**Direction (decided Jun 19): one-way, UPR → QuickBooks.** UPR is the system of record;
QuickBooks is a downstream mirror. **All** invoices *and* payments are entered in UPR and
pushed to QBO — we never enter payments in QuickBooks. One-way keeps QBO current **as long
as nobody edits invoices/payments directly in QBO.** No inbound sync / webhooks needed
(that earlier plan is dropped).
Built & live on `dev`: invoice create + **auto-push** to QBO, safeguarded (master switch +
tight roles + confirms). **Not yet built:** recording payments in UPR + **pushing them to
QBO** (today the Log Payment flow does NOT reach QBO), invoice **sent/due-date + aging**,
and a proper invoice-centric **A/R view** (redesign).

---

## ✅ DONE (live on `dev`)

**Invoicing → QuickBooks (outbound)**
- QBO connect (OAuth), customer create/link, invoice push worker, division→Item/Class mapping. *(pre-existing foundation)*
- Dashboard/Collections read invoices as source of truth (`get_job_financials`, legacy fallback for historical jobs).
- **Phase 0.5 — auto-push invoice edits** (commit `22466ad`): `qbo-invoice` worker now **creates _or_ updates** (new `updateInvoice()` in `functions/lib/quickbooks.js`, sparse update via SyncToken). Billing UI (`ClaimBilling.jsx`) autosaves the amount and pushes automatically; editing a synced invoice re-syncs it.
- **Payment → QBO foundation** (commit `40099b0`): `qbo-payment` worker + `createPayment`/`deletePayment` (applies a Payment to the QBO invoice); `payments.qbo_payment_id/qbo_synced_at/qbo_sync_error` (migration applied); invoice push now stamps `sent_at` + a default Net-30 `due_date`.
- **Invoice-centric A/R panel on the CLAIM PAGE** (commit `df8effb`): the claim section is now **"Invoices & Payments"** — per-invoice **Sent / Due-aging / Total / Collected / Balance / status** + a claim Invoiced/Collected/Balance summary, and **invoice-linked payment recording that pushes to QBO** (`qbo-payment` wired, insert + delete), with payment history + two-click delete. Edits gated by admin+manager; section behind `feature:billing`.
- **Same A/R panel on the CLIENT PROFILE** (commit `098a25e`): `CustomerPage` → **Financial** tab now shows all the client's invoices + a client-level Invoiced/Collected/Balance, with the same payment recording (reuses `ClaimBilling`).

**Safeguards** (commits `5f9df11`, `d2713fb`)
- **Master on/off switch:** Billing section gated by feature flag **`feature:billing`** (enabled). Dev Tools → Feature Flags → "Billing & Invoicing": off = hidden for all; set a dev-only user = limit to one person.
- **Restricted roles (intentional — keep tight):** billing + Collections A/R editing = **admin + manager only** via `canEditBilling()` in `src/lib/claimUtils.js` (`BILLING_EDIT_ROLES`). PMs/supervisors are read-only by design.
- **Confirm new invoices:** first push is a deliberate **"Send to QuickBooks"** button; edits to an already-synced invoice still auto-sync.
- **"Remove from QuickBooks"** needs a two-click confirm.
- **Collections is read-only** for non-billing roles (Log Payment / A/R status / mark-deductible / Notes hidden or disabled).

**Employee tutorial** (commits `99f251f`, `fa06d73`, `2c7f2b4`)
- In-app **Help page** at `/help` (`src/pages/Help.jsx`, sidebar "Help & Guides", visible to everyone).
- Markdown guide `UPR-Invoicing-Financials-Employee-Guide.md` + downloadable PDF `public/UPR-Invoicing-Financials-Guide.pdf` (regenerate with `scripts/build-invoicing-guide-pdf.py`).

**Decisions** (updated Jun 19 — supersedes commit `650a67d`)
- ~~Payments QBO-only / inbound webhooks~~ → **Payments are entered in UPR and pushed to QBO** (one-way, like Housecall Pro / Albiware). **Keep** the "Log Payment" UI; build its QBO push. **No inbound webhooks.**
- Invoice edits **auto-push immediately** (built).
- Billing / A/R edit roles stay **admin + manager only** (keep restricted).

---

## ⏳ NOT DONE YET — next work

**Foundation (needed regardless of card processor):**
| Item | What | Notes |
|---|---|---|
| **Payments → QBO (invoice-centric)** | **DONE on the claim page** (`df8effb`): payment entry records `invoice_id` + pushes via `qbo-payment` (insert & delete). Remaining: same flow on the client profile + global dashboard; retire the old job-level `ARPage` entry. | |
| **Invoice lifecycle fields** | `sent_at` + `due_date` columns exist; **stamped on push** (Net-30 default); surfaced in the claim panel. | Aging = today − due_date. Terms configurable later. |
| **A/R views (redesign)** | **Claim page + client profile DONE** (`df8effb`, `098a25e` — `ClaimBilling` reused on `CustomerPage` Financial tab). Remaining: a **global A/R dashboard** (total outstanding + aging buckets + overdue worklist); then consolidate/retire the job-centric `ARPage` + `billing_overview` + `ClaimCollectionPage` + stale `COLLECTIONS_*.md`. | |
| **Rollups + reliability** | collected = Σ payments, balance, status (paid/partial/overdue); payment-push error/retry surfacing; optional periodic read-back reconcile to catch QBO drift. | One-way is only correct if QBO isn't hand-edited. |

**Card payments (collect by credit card) — processor TBD:**
| Item | What |
|---|---|
| **Choose processor** | **Stripe** (best UX/dev; UPR stays system-of-record; push payment → QBO) vs **QuickBooks Payments** (native to QBO books, but collecting via QBO's invoice makes the payment originate in QBO → mild inbound). |
| **Send invoice + pay link** | Email the client an invoice with a "Pay now" (card/ACH) link; on payment, record in UPR → push Payment to QBO. Needs the processor's payment-confirmation webhook (small, well-defined). |
| **Reconciliation** | Record processing fees + match payouts/deposits in QBO. |

**Other:** Phase 0 (flip `auto_draft_invoices` after prod test) · invoice editing depth (line items/adjustments — tables exist) · **deeper security** (RLS/RPC role enforcement; safeguards are UI-level today) · customer-edit → QBO push (e.g. email change; today it doesn't sync).

---

## 🚧 Key rule & decisions
- **QuickBooks must be treated as read-only by people.** One-way only stays correct if nobody enters/edits payments or invoices directly in QBO. (A periodic read-back reconcile can flag drift.)
- **Card processor (open):** Stripe (recommended — UPR stays system-of-record) vs QuickBooks Payments. NOT needed for the recording + A/R foundation — can be chosen later.
- **"Sent" definition:** for now = invoice issued/pushed date; full "emailed with a pay link" arrives with the processor work.
- **Default payment terms** (e.g. Net 30 / due on receipt) to drive aging.
- **Untested:** live QBO invoice **update** path (Phase 0.5) — verify on `dev` (edit a synced invoice's amount → confirm QBO updates).
- The earlier Intuit **accounting** webhook + `QBO_WEBHOOK_VERIFIER_TOKEN` is **no longer needed** (inbound dropped). A **processor** webhook (Stripe / QBO Payments) is needed only if/when we add card collection.

---

## 🔑 Key facts for a cold resume
- **Work happens on `dev`**; pushing there auto-deploys to Cloudflare Pages. Never `main`.
- **Stack:** React 19 + Vite (JSX), Supabase Postgres + PostgREST (no JS SDK for data), Cloudflare Pages Functions in `functions/api/`.
- **QBO files:** `functions/api/qbo-invoice.js` (push/create/update/delete), `functions/lib/quickbooks.js` (helpers), `qbo-sync-customer.js`, `qbo-query.js`, `quickbooks-connect/callback.js`.
- **Billing UI:** `src/components/ClaimBilling.jsx` (on the Claim page). **A/R UI:** `src/pages/ClaimCollectionPage.jsx` + `src/components/collections/ARPage.jsx`. **Role gate:** `canEditBilling()` in `src/lib/claimUtils.js`.
- **Master switch flag:** `feature:billing` in the `feature_flags` table (toggle from Dev Tools).
- **Already-built schema to reuse:** `invoices` (qbo_invoice_id, qbo_synced_at, qbo_sync_error, total, amount_paid, balance_due), `payments` (no `qbo_payment_id` yet — Phase 2 adds it), `invoice_line_items`, `invoice_adjustments`, `integration_config` (key/value), `contacts.qbo_customer_id`.

---

*When this initiative is fully done, fold the final state into `UPR-Web-Context.md` and delete this status file + `QBO-PHASE-2-PLAN.md` so they don't go stale (per the Task File Protocol in `CLAUDE.md`).*
