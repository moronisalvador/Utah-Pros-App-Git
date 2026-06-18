# QBO ↔ UPR — Phase 2 Build Plan (Two-Way Sync)

**Goal:** a fully functional billing / A/R / invoicing platform in UPR that is **fully connected to QuickBooks Online — in both directions.** The headline requirement: **any time an invoice changes in QuickBooks, or a payment is received in QuickBooks, it shows and updates in UPR automatically.**

> This is a roadmap spanning several phases. When we start a phase, lift that phase's section into a focused `*-TASK.md` and build it. Phases 1–3 are the priority (they deliver the QBO → UPR sync).

**Locked decisions (Jun 18, 2026):**
- **Payments are QBO-only.** The manual "Log Payment" UI in UPR is **retired** — QuickBooks is the only place a payment is processed, and it syncs *back* to UPR (Phase 2). UPR never originates payments.
- **Invoice edits auto-push immediately.** Any change to an invoice's content in UPR pushes to QBO automatically, in real time — no manual "Push" button (new **Phase 0.5**). Loop-suppression is required so the resulting QBO webhook isn't mistaken for a fresh external change (Phase 3).

---

## Where we are today (recap)

**Live & working (UPR → QBO, outbound):**
- OAuth connect (`quickbooks-connect.js` / `quickbooks-callback.js`), tokens in `integration_credentials`.
- Customers **create/link** on new contact (`qbo-sync-customer.js`, `AFTER INSERT` trigger). One-way, create-only.
- Invoices: create draft (`create_invoice_for_job`), price + **push/remove** to QBO (`qbo-invoice.js`), Billing UI (`ClaimBilling.jsx`).
- Dashboard reads invoices as source of truth (`get_job_financials` + `getBalances` + AR trigger). Collections page (`ClaimCollectionPage` / `ARPage`).

**The gap:** everything is **push-only**. Nothing flows **back** from QBO. Payments are hand-logged; invoice edits/voids in QBO are invisible to UPR; customer edits don't sync.

**Schema already in place we'll build on:** `invoices` (`qbo_invoice_id`, `qbo_synced_at`, `qbo_sync_error`, `total`, `adjusted_total`, `amount_paid`, `balance_due`, `status`), `payments` (`invoice_id`, `job_id`, `contact_id`, `amount`, `payment_method`, `payment_date`, `payer_type`, `is_deductible`, `is_depreciation_release` — **no `qbo_payment_id` yet**), `invoice_line_items` + `invoice_adjustments` (already rich — Phase 5 is mostly UI), `integration_config` (key/value), `contacts` (`qbo_customer_id`…).

---

## Guiding principles

1. **Clear ownership.** UPR **owns invoice content** and **auto-pushes every edit to QBO immediately**. QBO **owns payments and balances** — it is the only place payments are processed, and they sync back to UPR. Inbound sync brings QBO's payments (and any QBO-side invoice voids/edits) into UPR; outbound auto-push keeps QBO's invoice content matching UPR.
2. **Webhook tells us *what* changed; we fetch the current state.** Intuit webhooks carry only `{entity, id, operation, lastUpdated}` — we then read the entity from the QBO API and reconcile.
3. **Idempotent + ordered.** Webhooks can arrive twice or out of order. Every handler is safe to re-run; we gate on `lastUpdated` / stored sync tokens and log every event.
4. **Never silently lose data.** Reconcile updates existing rows; conflicts get flagged (`qbo_sync_error`) not overwritten blindly.
5. **Belt + suspenders.** Webhooks are primary; a scheduled **CDC (Change Data Capture)** reconcile catches anything missed.
6. **Feature-flagged rollout.** Each inbound path behind an `integration_config` switch so we can enable per-entity and roll back instantly.

---

## Cross-cutting foundations (built in Phase 1, used by 2–4)

**New DB:**
- `qbo_sync_events` — append-only log/queue: `id, realm_id, entity (text), qbo_id (text), operation (text), last_updated (timestamptz), received_at, status ('pending'|'done'|'error'), attempts int, error text, payload jsonb`. Dedup key: `(entity, qbo_id, last_updated)`. This is our idempotency + audit + retry backbone.
- `invoices.qbo_sync_token text` — store QBO `SyncToken` (required to push sparse updates/voids back, and to detect drift).
- `payments.qbo_payment_id text` + `payments.source text default 'manual'` (`'manual'|'quickbooks'`) — dedup QBO-sourced payments vs. hand-logged.
- `integration_config` rows: `qbo_inbound_enabled`, `qbo_sync_payments`, `qbo_sync_invoices`, `qbo_sync_customers`, `qbo_autopush_invoices`, `qbo_cdc_cursor` (ISO timestamp of last CDC run).

**New env / Intuit setup:**
- `QBO_WEBHOOK_VERIFIER_TOKEN` — **distinct from** the existing `QBO_WEBHOOK_SECRET` (which is the internal DB-trigger shared secret). The verifier token validates Intuit's `intuit-signature` header.
- In the Intuit developer portal: subscribe the **Production** app to webhooks for **Invoice, Payment, Customer** (and CreditMemo if used); set the webhook URL to `https://utahpros.app/api/qbo-webhook`.

**New shared lib helpers (`functions/lib/quickbooks.js`):**
- `verifyIntuitSignature(rawBody, signatureHeader, env)` — HMAC-SHA256(base64).
- `qboGet(env, path)` / `qboQuery(env, sql)` — already partially present (`qbo-query`); generalize for reads.
- `runCdc(env, entities, changedSince)` — GET `/cdc?entities=...&changedSince=...`.

**Realtime to the UI:** subscribe Collections / Claim / Job pages to Supabase realtime on `invoices`, `payments`, `jobs` so inbound changes appear **live** (the app already ships a realtime client in `src/lib/realtime.js`). Fallback: values refresh on next load regardless.

---

## Phase 0 — Turn on auto-draft (immediate, tiny)
**Objective:** finish 2a. After you create + push a couple of real invoices from the Billing UI on prod and confirm they look right in QBO, flip `integration_config.auto_draft_invoices` → `'true'` so a draft invoice is auto-created per job.
**Work:** 1 config flip + a quick end-to-end sanity check. **Size: XS.** No code.

---

## Phase 0.5 — Auto-push invoice edits (outbound, immediate) ⭐ (locked decision)
**Objective:** the moment an invoice's content changes in UPR, it is pushed to QBO automatically — no manual button.
**Build:**
- `AFTER INSERT/UPDATE` trigger on `invoices` (+ `invoice_line_items`, `invoice_adjustments`) → calls the existing `qbo-invoice` worker via `pg_net` (same pattern as the `contacts → qbo-sync-customer` trigger). **Scope the trigger to content columns only** (`total` / `adjusted_total` / line items / adjustments) — never fire on `amount_paid` / `balance_due` / `qbo_*` fields that *sync* writes, or it self-triggers.
- **Debounce / coalesce** rapid edits (e.g. editing several line items) into one push per invoice (short delay or a "dirty" flag drained by a tiny cron) so we don't hammer the QBO API or hit rate limits.
- **First push:** a brand-new invoice goes to QBO on its **first priced save** (total > 0); empty `$0` drafts stay local until priced — avoids junk `$0` invoices in QBO. *(confirm)*
- **Billing UI (`ClaimBilling.jsx`):** replace the manual `Save amount` + `Push to QuickBooks` two-step with **autosave → auto-push** plus a live status chip (`Syncing… / Synced ✓ / Error`). Keep `Remove from QuickBooks`.
- **Loop guard:** when inbound invoice sync (Phase 3) is live, the push trigger must **skip** rows whose latest change came from a QBO webhook (a `last_sync_source` marker or matching `qbo_sync_token`). Until Phase 3 ships there is no loop, so 0.5 can land first.
**Acceptance:** edit an amount or a line item → the QBO invoice updates within seconds with no button press; rapid edits coalesce into one push; `$0` drafts never hit QBO; errors surface on the row.
**Size: M. Dependency: none for outbound. Coordinate the loop guard with Phase 3.**

---

## Phase 1 — Inbound sync infrastructure (the keystone)
**Objective:** stand up the pipe that receives QBO changes safely. No business logic yet — just receive, verify, log, ack.
**Build:**
- `functions/api/qbo-webhook.js` — `onRequestPost`: read **raw** body, `verifyIntuitSignature`, parse `eventNotifications`, insert each entity change into `qbo_sync_events` (dedup on `(entity,qbo_id,last_updated)`), return **200 immediately** (Intuit requires a fast ack). Log to `worker_runs` as `qbo-webhook`.
- `qbo_sync_events` table + migration (RLS, service-role only).
- Dispatcher: `functions/api/qbo-process-events.js` (cron, mirrors `process-scheduled.js`) — pulls `pending` events, routes by `entity` to the Phase 2/3/4 reconcilers, marks `done`/`error`, retries with backoff (`attempts`).
- CDC fallback cron `functions/api/qbo-cdc-reconcile.js` — every N minutes, `runCdc` since `qbo_cdc_cursor`, enqueue any changes the webhook missed; advance cursor.
- `verifyIntuitSignature` + read/CDC helpers in `lib/quickbooks.js`; `QBO_WEBHOOK_VERIFIER_TOKEN` env.
**Acceptance:** a sandbox change to any subscribed entity lands a verified row in `qbo_sync_events`; bad signature → 401; duplicate delivery → single row; cron drains the queue. **Size: M. Dependency: none. Unlocks 2, 3, 4.**

---

## Phase 2 — Payments: QBO → UPR  ⭐ (your ask)
**Objective:** a payment recorded in QuickBooks appears in UPR and updates Collected / Balance automatically.
**Build:**
- `payments.qbo_payment_id` + `source` columns (migration).
- Reconciler `reconcilePayment(env, qboId)` (in dispatcher): `qboGet /payment/{id}` → for each `Line[].LinkedTxn` where `TxnType='Invoice'`, map `TxnId` → UPR invoice via `qbo_invoice_id`; **upsert** a `payments` row keyed on `qbo_payment_id` (`source='quickbooks'`, amount, date, payer). On payment delete/void → remove/zero that row.
- Rollups: set `invoices.amount_paid` / `balance_due` from QBO invoice `Balance`/`TotalAmt` (authoritative) or from summed payments; extend the AR path so `jobs.collected_value` reflects QBO payments. Update `get_job_financials` `collected` to read real `amount_paid` (it already does — it just becomes non-zero now).
- **Retire the manual payment UI (locked decision):** remove the `+ Log Payment` button + `PaymentModal` + the `handleLogPayment` path from `ClaimCollectionPage` / `ARPage`. Collections becomes a **read-only A/R view** — payments display from the synced `payments` table; UPR no longer originates payments. (Legacy hand-entered `jobs.collected_value` on historical jobs stays as a fallback for pre-QBO data.)
- **Deductibles:** since QBO is the only payment processor, deductible collections are entered in QBO too and arrive as payments (flagged via `payer_type` / `is_deductible`); the manual "mark deductible received" toggle retires with the rest — unless field-collected checks bypass QBO (see Decisions).
- Realtime: Collections reflects new payments live.
**Acceptance:** record a payment (incl. a deductible) on a sandbox invoice → within a minute UPR shows Collected up / Balance down / A/R status auto-advances to Partial/Paid; deleting it in QBO reverses cleanly in UPR; UPR has no manual payment entry left. **Size: M–L. Dependency: Phase 1.**

---

## Phase 3 — Invoice changes: QBO → UPR  ⭐ (your ask)
**Objective:** edits, voids, deletes, and "sent/emailed" status on an invoice in QuickBooks reflect in UPR.
**Build:**
- `invoices.qbo_sync_token` column (migration).
- Reconciler `reconcileInvoice(env, qboId)`: `qboGet /invoice/{id}` → update the UPR invoice matched by `qbo_invoice_id`: `total`/`adjusted_total` (if changed in QBO), `balance_due`, `status` (open/partial/paid via `Balance`), `voided`/`deleted` state, `qbo_sync_token`, `qbo_synced_at`. On QBO **delete/void** → mark UPR invoice `void`/`deleted` (don't hard-delete; the AR rollup drops it from billed automatically).
- **Echo-suppression (required by Phase 0.5):** every UPR auto-push produces a QBO Invoice webhook back to us. Recognize our own echo (match the just-written `qbo_sync_token` / `qbo_synced_at`) and **skip** it — never reconcile-then-re-push in a loop.
- **Authority:** UPR owns invoice *content* (it auto-pushes), so reconcile pulls back what **QBO** owns — `balance` / `status` / `void` / `deleted`. If a QBO-side *content* edit is detected with no pending UPR change, flag `qbo_sync_error` ("changed in QBO — review") rather than silently overwriting.
- Billing UI: show QBO-sourced status (Paid / Voided / Balance) and a "changed in QuickBooks" indicator.
**Acceptance:** change an amount, void, and delete a sandbox invoice → each reflects in UPR's Billing + Collections within a minute; balances recompute; divergence is flagged not lost. **Size: M. Dependency: Phase 1 (pairs naturally with Phase 2).**

---

## Phase 4 — Customers: two-way
**Objective:** keep customer records consistent both ways (this is the "I added an email in UPR" case).
**Build:**
- **UPR → QBO updates:** `contacts` `AFTER UPDATE` trigger (or extend the existing worker) → when email/phone/address/name change on an **already-linked** contact (`qbo_customer_id` set), send a QBO **sparse `Customer` update** (needs the customer's `SyncToken`; store `contacts.qbo_sync_token`). Add `updateCustomer(env, contact)` to `lib/quickbooks.js`.
- **QBO → UPR:** `reconcileCustomer(env, qboId)` on Customer webhook → update the matched UPR contact (email/phone/address), non-destructively.
**Acceptance:** add an email to a synced contact in UPR → it appears on the QBO customer; edit the customer in QBO → it appears in UPR. **Size: M. Dependency: Phase 1.**

---

## Phase 5 — Invoice editing depth (2b)
**Objective:** real invoices, not just a single amount. (Tables already exist — this is mostly UI + push mapping.)
**Build:**
- UI to add/edit `invoice_line_items` (qty/unit/price/Xactimate code/room) and `invoice_adjustments`; capture `deductible_amount`, `depreciation_withheld/released`, `insurance_responsibility`, `homeowner_responsibility` on the invoice.
- Push mapping: send line items (or a summarized set) to QBO instead of one lump line — flowing through the **Phase 0.5 auto-push** trigger (line-item edits already auto-push).
- Surface the richer rollup fields `get_job_financials` already returns (insurance/homeowner split, depreciation) on the Collections dashboard.
**Acceptance:** build a multi-line invoice with a deductible + withheld depreciation; push to QBO; dashboard shows the split. **Size: L. Dependency: none hard, but best after 2/3 so QBO edits reconcile against real line items.**

---

## Phase 6 — A/R operations & polish
**Objective:** make it operable day-to-day.
**Build:** sync-status / retry panel in Dev Tools or Admin (reads `qbo_sync_events` + `qbo_sync_error`); **A/R aging** (30/60/90) + customer statements; token-expiry / reconnect alerts; realtime wiring on all financial views; optional historical-AR backfill into `invoices` so the legacy `jobs.invoiced_value` mirror + trigger can eventually be retired. **Size: M–L. Dependency: 1–3.**

---

## Recommended build order & rough effort

| Order | Phase | Delivers | Size |
|---|---|---|---|
| 1 | **0** Auto-draft on | Drafts auto-created | XS |
| 2 | **0.5** Auto-push edits | ⭐ UPR invoice edits → QBO instantly | M |
| 3 | **1** Inbound infra | The pipe (webhook+CDC+queue) | M |
| 4 | **2** Payments → UPR (QBO-only) | ⭐ payments show in UPR; manual entry retired | M–L |
| 5 | **3** Invoice changes → UPR | ⭐ QBO invoice edits show in UPR + echo-suppression | M |
| 6 | **4** Customer two-way | email/contact edits sync | M |
| 7 | **5** Invoice depth (2b) | line items / adjustments / splits | L |
| 8 | **6** A/R ops & polish | aging, retries, statements | M–L |

**0.5** (outbound auto-push) has no external dependency and can ship first. Phases **1 → 2 → 3** are the inbound direction — best built as one push (shared infra), then 2 and 3 in parallel. Echo-suppression links **0.5 ↔ 3**.

---

## Security & reliability checklist
- Verify **every** webhook via `intuit-signature` (HMAC-SHA256 / verifier token); reject otherwise.
- Webhook endpoint does **no** heavy work — verify, enqueue, 200. Processing is async (cron) so Intuit never times out.
- Idempotency on `(entity, qbo_id, last_updated)`; bounded retries with backoff; everything logged to `qbo_sync_events` + `worker_runs`.
- CDC reconcile as the safety net for missed or dropped webhooks.
- Per-entity kill switches in `integration_config`.

## Testing strategy
- Sandbox first (same flow as the production checklist already in `UPR-Web-Context.md`): create/edit/void invoices, record/delete payments, edit customers — confirm each reflects in UPR.
- Replay a stored webhook payload against the handler (unit-level) to prove idempotency.
- **Auto-push:** edit an invoice amount / line item → QBO updates within seconds; confirm the resulting QBO webhook is echo-suppressed (no reconcile → re-push loop).
- Verify the manual payment entry is fully removed and Collected / Balance derive only from synced QBO payments (plus the legacy fallback for historical jobs).

## Decisions
- ✅ **Payments = QBO-only** — manual "Log Payment" retired (locked Jun 18).
- ✅ **Invoice edits auto-push immediately** — no manual push button (locked Jun 18).
- ✅ **Invoice content authority = UPR** (auto-push wins); QBO owns payments / balance / void; QBO-side content edits get flagged for review.

**Still open (small — I'll default unless you say otherwise):**
1. **CDC cadence:** default = webhooks (near-real-time) + a safety reconcile every **15 min**. OK, or prefer hourly?
2. **`$0` drafts:** default = a new invoice first pushes to QBO on its **first priced save** (total > 0), not while still `$0`. OK?
3. **Field-collected deductibles:** if a tech collects a deductible check in person, will it be entered into **QBO** (so it syncs back)? If some cash/checks never touch QBO, that's the *one* case that would keep a lightweight "deductible received" marker in UPR.

## Docs impact
When Phase 0.5 / Phase 2 ship, update the employee tutorial to match: `src/pages/Help.jsx`, `UPR-Invoicing-Financials-Employee-Guide.md`, and regenerate `public/UPR-Invoicing-Financials-Guide.pdf` (via `scripts/build-invoicing-guide-pdf.py`) — the "Push to QuickBooks" and "Log Payment" steps will change to "edits save & sync automatically" and "payments come from QuickBooks."
