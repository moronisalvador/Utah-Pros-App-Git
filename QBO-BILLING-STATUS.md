# QBO Billing & A/R — Project Status & Handoff
**Last updated:** 2026-06-19 · **Branch:** `dev` (auto-deploys to Cloudflare Pages) · **Supabase:** `glsmljpabrwonfiltiqm`

> **START HERE if you're resuming this work in a new chat.** This is the index for the
> QuickBooks billing / invoicing / A/R initiative: what's done, what's left, and how to
> pick up. Read order: **(1) this file → (2) `QBO-PHASE-2-PLAN.md` (detailed roadmap) →
> (3) `UPR-Web-Context.md` (permanent technical truth — all tables/RPCs/components).**

---

## TL;DR — where things stand (Jun 2026)
The **outbound** direction is built and live on `dev`: you create an invoice on a Claim,
the amount **auto-syncs to QuickBooks**, and the dashboard/Collections read from invoices.
It's **safeguarded** (master switch + tight roles + confirms). The **inbound** direction
(QuickBooks → UPR: payments and invoice changes flowing *back*) is **planned but NOT built**
— that's the next major effort and needs a one-time Intuit setup first.

---

## ✅ DONE (live on `dev`)

**Invoicing → QuickBooks (outbound)**
- QBO connect (OAuth), customer create/link, invoice push worker, division→Item/Class mapping. *(pre-existing foundation)*
- Dashboard/Collections read invoices as source of truth (`get_job_financials`, legacy fallback for historical jobs).
- **Phase 0.5 — auto-push invoice edits** (commit `22466ad`): `qbo-invoice` worker now **creates _or_ updates** (new `updateInvoice()` in `functions/lib/quickbooks.js`, sparse update via SyncToken). Billing UI (`ClaimBilling.jsx`) autosaves the amount and pushes automatically; editing a synced invoice re-syncs it.

**Safeguards** (commits `5f9df11`, `d2713fb`)
- **Master on/off switch:** Billing section gated by feature flag **`feature:billing`** (enabled). Dev Tools → Feature Flags → "Billing & Invoicing": off = hidden for all; set a dev-only user = limit to one person.
- **Restricted roles (intentional — keep tight):** billing + Collections A/R editing = **admin + manager only** via `canEditBilling()` in `src/lib/claimUtils.js` (`BILLING_EDIT_ROLES`). PMs/supervisors are read-only by design.
- **Confirm new invoices:** first push is a deliberate **"Send to QuickBooks"** button; edits to an already-synced invoice still auto-sync.
- **"Remove from QuickBooks"** needs a two-click confirm.
- **Collections is read-only** for non-billing roles (Log Payment / A/R status / mark-deductible / Notes hidden or disabled).

**Employee tutorial** (commits `99f251f`, `fa06d73`, `2c7f2b4`)
- In-app **Help page** at `/help` (`src/pages/Help.jsx`, sidebar "Help & Guides", visible to everyone).
- Markdown guide `UPR-Invoicing-Financials-Employee-Guide.md` + downloadable PDF `public/UPR-Invoicing-Financials-Guide.pdf` (regenerate with `scripts/build-invoicing-guide-pdf.py`).

**Decisions locked** (commit `650a67d`)
- Payments will be **QBO-only** (manual "Log Payment" to be retired in Phase 2).
- Invoice edits **auto-push immediately** (done for outbound; inbound needs echo-suppression).

---

## ⏳ NOT DONE YET — next work (detail in `QBO-PHASE-2-PLAN.md`)

| Phase | What | Notes |
|---|---|---|
| **0** | Flip `integration_config.auto_draft_invoices` → `true` | After a real prod test of the Billing UI. Config flip, no code. |
| **1** | **Inbound webhook infra** | `qbo-webhook` + `qbo_sync_events` queue + CDC reconcile. **Needs Intuit setup first (see blockers).** |
| **2** | **Payments QBO→UPR** + retire manual Log Payment | The "payment received in QBO shows in UPR" requirement. |
| **3** | **Invoice changes QBO→UPR** + echo-suppression | The "invoice edited in QBO shows in UPR" requirement. |
| **4** | Customer two-way sync | Incl. "edit email in UPR updates QBO" (today it does NOT). |
| **5** | Invoice editing depth | Line items / adjustments / deductible-depreciation splits (tables exist; mostly UI). |
| **6** | A/R ops & polish | Aging, statements, sync-error/retry panel, realtime. |
| **—** | **Deeper security** | Current safeguards are **UI-level only**. Add RLS / RPC role enforcement on financial tables so the restriction can't be bypassed via the API. |

---

## 🚧 Blockers / open decisions (before inbound, Phases 1–3)
- **Intuit setup (you must do once):** subscribe the **production** QBO app to **Invoice / Payment / Customer** webhooks; add **`QBO_WEBHOOK_VERIFIER_TOKEN`** in Cloudflare (distinct from the existing internal `QBO_WEBHOOK_SECRET`). Webhook URL: `https://utahpros.app/api/qbo-webhook`.
- **CDC cadence:** default plan = webhooks + a 15-min safety reconcile (confirm or change).
- **Field-collected deductibles:** if a tech ever collects a deductible check that never touches QBO, that's the one case that would keep a manual "deductible received" control. Otherwise everything comes from QBO.
- **Untested:** the live QBO invoice **update** path (Phase 0.5) couldn't be end-to-end tested from the build environment — worth a quick real test on `dev` (edit a synced invoice's amount → confirm QBO updates).

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
