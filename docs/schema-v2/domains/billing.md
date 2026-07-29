# Domain: Billing / QBO / Stripe

The money core of the platform: estimates and invoices with line items, payments, QBO push/sync (invoice, estimate, payment, attachment workers + payment-sync poller), Stripe checkout links + webhook, OOP quick-quotes, and a 2FA gate for payout-destination changes. Overall health: the live spine (estimates → line items → invoices → payments, QBO/Stripe workers, dashboard rollup RPCs) is heavily used and carefully test-guarded around trigger-owned money columns — but it drags a stillborn **invoice-adjustments feature** (dead table + 12 dead columns whose `adjusted_total` survivor is still load-bearing with no writer), a **retired vendors/vendor-invoices module** (2 dead tables), a **phantom estimate 'submitted' lifecycle** that a live CRM widget still queries, always-true legacy policies that defeat the CRM-partner carve-out, and near-universal `SECURITY DEFINER`-granted-to-`authenticated` RPCs with no caller checks. Headline numbers: 14 tables (11 used, 3 dead), 247 columns (56 dead), 36 RPCs (30 used, 4 dead, 2 band-aid), 17 policies (8 band-aid, 3 dead), 11 triggers (10 used, 1 band-aid).

Search scope for every claim below: `src/`, `functions/`, `scripts/`, `upr-mcp/`, `tests/`, `supabase/tests/`, `.github/workflows/` (js/jsx/mjs/sql/yml/toml/json), plus the full pg_get_functiondef corpus (fndefs-*.sql), triggers.json, views.json, prod-cron.json, publications.json. `upr-mcp/src/codeIndex.js` is a **generated schema index** — hits there are metadata, never usage. `supabase/migrations/` used for provenance only. No billing table is in the realtime publication. `rv_invoices`/`rv_payments` views exist but are referenced only by a db-lane test (not a usage path).

## Tables (14)

### billing_2fa_codes — USED
- Purpose: single-use, 10-min, SHA-256-hashed email codes gating Stripe payout-destination changes.
- Evidence: `functions/api/billing-2fa.js:76` (insert), `:107` (select by code_hash), `:111` (mark used). UI reaches it via `/api/billing-2fa` from `src/pages/settings/Payments.jsx`. Service-path-only.
- Prod stats: 3 live, 3 ins / 0 upd / 0 del; last_seq 2026-07-08 (matches the audit-scan timestamp cluster), never idx-scanned.
- Provenance: `supabase/migrations/20260620_payout_2fa.sql`.
- Columns: 7 total — 6 used, 1 uncertain, 0 dead.
  - `created_at` — uncertain (default-stamped; never explicitly read/written by code).
- Policies: **none** — RLS enabled with zero policies = deny-all for browser roles; only the service-role worker passes. Matches the 2026-07-22 audit finding; this is the *correct* posture here, not an omission.
- Triggers: none.
- Notes: broad table GRANTs to anon/authenticated remain (moot under deny-all RLS, but one careless policy would expose the code-hash ledger — see structural #7).

### estimate_line_items — USED
- Purpose: line items for estimates (desc/qty/price + QBO Item/Class mapping).
- Evidence: `src/pages/EstimateEditor.jsx:139,143,188,202,212,223,237,272` (full CRUD), `src/pages/tech/admin/AdminEstimateEditor.jsx:90-171`, `AdminEstimateDetail.jsx:92`, `functions/api/qbo-estimate.js:127` (push reads), RPCs `convert_estimate_to_invoice` / `save_estimate_lines`.
- Prod stats: 76 live, 83/107/3, idx scans through 2026-07-28.
- Provenance: `supabase/migrations/20260625_estimate_builder.sql`.
- Columns: 14 total — 14 used, 0 uncertain, 0 dead. `line_total` is a GENERATED column (qty × unit_price, per code headers) — DB-owned, summed by the recompute trigger; no code writes it (correct).
- Policies: `allow_authenticated_estimate_line_items` (ALL, authenticated) — USED — real `NOT is_crm_partner(auth.uid())` carve-out; broad-staff by design.
- Triggers: `trg_estimate_lines_total` → `recompute_estimate_from_lines()` — USED — owns `estimates.subtotal/amount`.
- Notes: FK → estimates ON DELETE CASCADE.

### estimates — USED
- Purpose: estimates (job- or contact-anchored) with QBO estimate sync + conversion into invoices.
- Evidence: `src/pages/Estimates.jsx:64` (`get_estimates`), `EstimateEditor.jsx` (edit/delete/convert), `NewEstimateModal.jsx:76,137`, admin-mobile `EstimateCreateForm.jsx:81,143`, `functions/api/qbo-estimate.js:49-210` (sync writes), `functions/api/notify.js:438`, `functions/lib/qbo-payment-sync.js:125`, RPC bodies (get_commissions, get_real_job_evidence_mismatches, get_open_estimates_summary, get_estimate_aging).
- Prod stats: 51 live, 59/242/9, seq+idx scans current to 2026-07-29.
- Provenance: untracked — predates schema-as-code.
- Columns: 33 total — 28 used, 1 uncertain, 4 dead, 0 band-aid, 0 dup.
  - `submitted_to` — DEAD: greps `'submitted_to'`/bare word across all scope dirs = 0 hits; fndef corpus = NONE.
  - `denied_reason` — DEAD: same trail, 0 hits everywhere.
  - `xactimate_file_url` — DEAD: 0 hits everywhere.
  - `pdf_url` — DEAD: repo-wide `pdf_url` grep in code = 0 hits; fndef corpus = NONE (estimates and invoices both).
  - `notes` — uncertain (generic; only carried by `select *` in qbo-estimate.js; QBO memo is derived, not est.notes).
  - Notes on used-but-unwritten: `submitted_at` (read by `get_estimates` + `get_estimate_aging`, **no writer**), `expiration_date` (read by qbo-estimate.js:178 + collections-chat.js:269, no writer found) — legacy rows only; see structural #5.
- Policies: `allow_authenticated_estimates` (ALL) — USED — `NOT is_crm_partner` carve-out.
- Triggers: `crm_estimate_submitted_advance` → `crm_trg_estimate_submitted()` (CRM-domain fn) — USED, cross-domain stage advance; `estimate_real_job` → `trg_estimate_real_job()` — USED (marks job real on approved/accepted/converted/signed); `trg_estimate_accepted_notify` → notification-domain fn — USED.
- Notes: FKs → jobs (CASCADE), contacts, employees, invoices (converted_invoice_id SET NULL). Triplication watch (cross-domain): `estimates` vs `oop_quotes` vs `homebuilding_estimates` (jobs domain) are three estimate-shaped stores; oop_quotes is a genuinely different artifact (internal margin calculator, no line items, no QBO), so not duplication in the strict sense — flag for the v2 modeling discussion.

### invoice_adjustments — DEAD
- Purpose (intended): audit trail of invoice total adjustments (insurance short-pays etc.) with conversation/message links.
- Evidence trail: greps `invoice_adjustments` (quoted + bare) across src/functions/scripts/upr-mcp/tests/supabase-tests/workflows = only the generated codeIndex; fndef corpus = NONE; no trigger, no view, no cron, not in publication. Prod stats corroborate: **0 live rows, 0 inserts/updates/deletes ever recorded** (147 seq scans are catalog/audit reads; stats-since-reset caveat applies but a zero-insert money-audit table is conclusive alongside zero code paths).
- Prod stats: 0 live, 0/0/0.
- Provenance: untracked — predates schema-as-code.
- Columns: 12 total — 12 dead (dead with table).
- Policies: `allow_authenticated_invoice_adjustments` (ALL, authenticated, USING true / CHECK true) — DEAD (on a dead table; also always-true).
- Triggers: none.
- Notes: the surviving sibling columns on invoices/invoice_line_items (`original_total`, `adjusted_*`, `was_adjusted`…) are dead too — but `invoices.adjusted_total` is still read in every balance formula. See structural #4.

### invoice_line_items — USED
- Purpose: invoice line items (desc/qty/price, QBO Item/Class, Xactimate code).
- Evidence: `src/pages/InvoiceEditor.jsx:214-395` (full CRUD), `AdminInvoiceDetail.jsx:103`, `ClaimBilling.jsx:64`, `functions/api/qbo-invoice.js:142` (push reads), `functions/api/analyze-xactimate.js:215-237` (AI import writes), `collections-chat.js:320`.
- Prod stats: 133 live, 159/213/20, current scans.
- Provenance: untracked — predates schema-as-code.
- Columns: 22 total — 14 used, 8 dead.
  - `category` — DEAD: only hit is analyze-xactimate.js:68 (AI *extraction* schema field, never persisted — the insert at :237 writes description/qty/price/sort+QBO only); fndefs NONE.
  - `room` — DEAD: 0 invoice-context hits (DemoSheet `room` is a different feature); fndefs NONE.
  - `original_quantity`, `original_unit_price`, `original_line_total`, `was_adjusted`, `was_denied`, `adjustment_note` — DEAD: 0 code hits each; fndefs NONE; part of the stillborn adjustments feature.
  - `line_total` GENERATED — DB-owned, used (recompute source, collections-chat select).
- Policies: `allow_authenticated_invoice_line_items` (ALL) — USED — `NOT is_crm_partner` carve-out.
- Triggers: `trg_invoice_lines_total` → `recompute_invoice_from_lines()` — USED — owns `invoices.subtotal/total`.

### invoice_status_history — USED (write-only audit)
- Purpose: append-only ledger of invoice status transitions.
- Evidence: written by trigger `trg_invoice_status_history` → `capture_invoice_status_history()` on every invoices.status change. **No reader anywhere** (code greps = codeIndex only; fndefs = only its own writer).
- Prod stats: 130 live, 131 ins, 0 upd/del — actively written.
- Provenance: `supabase/migrations/20260708_dbf_lifecycle_history.sql`.
- Columns: 5 total — 4 used (written), 1 uncertain (`changed_at` default-stamped).
- Policies: `invoice_status_history_read` (SELECT, authenticated, USING true) — BAND-AID — always-true grant with zero consumers; write path is trigger (definer) so no INSERT policy needed.
- Triggers: none on it.

### invoices — USED
- Purpose: the invoice of record — totals, insurance/homeowner split, QBO + Stripe linkage, lifecycle status.
- Evidence (sample of many): `InvoiceEditor.jsx` (:301 status, :396 delete, :405 due_date), `ClaimBilling.jsx:58`, `ClaimPage.jsx:80`, `NewInvoiceModal.jsx:55`, `AdminInvoiceDetail.jsx`, workers `qbo-invoice.js` (:65-269), `stripe-pay-link.js:33,58`, `stripe-webhook.js:130`, `qbo-payment-sync.js:136-146`, `analyze-xactimate.js:149,256`, `collections-chat.js:318`, RPC bodies (get_job_financials, get_revenue_by_division, get_avg_ticket, get_pipeline_summary, global_search, get_commissions, update_invoice_paid…).
- Prod stats: 95 live, 125/848/37, hottest billing table (24.9k seq / 34.7k idx scans).
- Provenance: untracked — predates schema-as-code.
- Columns: 51 total — 41 used, 0 uncertain, 9 dead, 1 duplicated.
  - `sent_to_phone` — DEAD: 0 code hits; fndefs NONE.
  - `pdf_url` — DEAD: repo-wide 0; fndefs NONE.
  - `internal_notes` — DEAD in invoice context: all hits are `jobs.internal_notes`; invoices-scoped 0; fndef hits are jobs-table functions only.
  - `original_total`, `adjustment_reason`, `adjusted_at`, `adjusted_by` — DEAD: 0 code hits; fndefs NONE (adjustments feature).
  - `carrier_name`, `policy_number` — DEAD on invoices: every code/fndef hit is claims/jobs/contacts-scoped; invoices-scoped readers/writers = 0 (rv_invoices view carries carrier_name but is test-only).
  - `deductible_amount` — DUPLICATED: counterpart `jobs.deductible` (hand-entered on JobPage). Read live via `get_job_financials` → `getBalances()` (claimUtils.js:44 prefers `f.deductible` when > 0) but **no writer exists** — the fallback source jobs.deductible is the real store.
  - Used-but-noteworthy: `adjusted_total` (read in ~10 money formulas via `COALESCE(adjusted_total,total)`, **no writer** — structural #4); `tax` (read-only in editor, "UPR-side, optional", no writer); `insurance_responsibility`/`homeowner_responsibility`/`depreciation_withheld`/`depreciation_released` (returned by get_job_financials, no writer anywhere — default-0 pass-throughs); `insurance_paid`/`homeowner_paid` (trigger-written, no reader); `invoice_type` (written as constant 'standard', never read); `balance_due` (read by get_job_financials/get_contact_activity; no code writer — likely GENERATED, verify `attgenerated` before v2 mapping); `locked` (read-gate InvoiceEditor.jsx:175-178, deliberately DB-set only); `status` (**three writers** — structural #1).
- Policies: `allow_authenticated_invoices` (ALL) — USED (`NOT is_crm_partner`); `allow_anon_read_invoices` (SELECT, roles=[authenticated], USING true) — BAND-AID — renamed legacy anon policy; always-true SELECT that ORs past the partner carve-out (structural #3).
- Triggers: `crm_invoice_created_advance` → crm fn — USED; `crm_invoice_paid_advance` (on amount_paid update) → crm fn — USED; `invoice_real_job` → `trg_invoice_real_job()` — USED; `trg_invoice_status_history` — USED (audit writer); `trg_invoices_sync_job_ar` → `trg_sync_job_invoiced()` — BAND-AID — sync-hack keeping duplicated `jobs.invoiced_value/invoiced_date` aligned (structural #6).
- Notes: combined billing means one `qbo_invoice_id` can legitimately span two UPR invoices with distinct job_ids (docs/db-foundation-p4-orphan-report.md §2) — NOT duplication; keep qbo_invoice_id un-unique in v2.

### oop_quotes — USED
- Purpose: out-of-pocket mitigation quick-quote calculator (equipment counts/days, margin) — internal pricing artifact, no line items, no QBO.
- Evidence: `src/pages/OOPPricing.jsx:49,145,167` and `src/pages/tech/TechOOPPricing.jsx:97,138,211,231` via RPCs `get_oop_quote`/`upsert_oop_quote`/`delete_oop_quote`; routes flag-gated `tool:oop_pricing` (App.jsx:349,563).
- Prod stats: 0 live (2 ins / 2 del — created and deleted), light scans.
- Provenance: `supabase/migrations/20260420_oop_pricing_calculator.sql`.
- Columns: 29 total — 29 used (every column is in the live RPC contract: upsert writes each param, `get_oop_quote` returns `*` to hydrate the form; quote_number/created_at/updated_at generated-or-stamped and displayed/ordered).
- Policies: `oop_quotes authenticated read` (SELECT, USING true) — BAND-AID (always-true; moot anyway — all access flows through SECURITY DEFINER RPCs that bypass RLS); `oop_quotes authenticated write` (ALL, true/true) — BAND-AID (same).
- Triggers: none.
- Notes: zero live rows + a dead list RPC (get_oop_quotes) suggests the tool is barely adopted — owner question #3.

### payments — USED
- Purpose: payment ledger (manual, QBO-mirrored, Stripe) driving invoice paid-state via trigger.
- Evidence: `ClaimBilling.jsx:103,130`, `InvoiceEditor.jsx:415-478`, admin-mobile `recordPayment.js:90`, workers `qbo-charge.js:117-149`, `qbo-payment.js:47-102`, `qbo-payment-sync.js:239-274`, `stripe-webhook.js:140-283`, `collections-chat.js:321`, RPCs (get_payments_ledger, get_payments_received, global_search, update_invoice_paid).
- Prod stats: 89 live, 91/70/1, current scans.
- Provenance: untracked — predates schema-as-code.
- Columns: 26 total — 24 used, 1 uncertain, 1 dead.
  - `is_depreciation_release` — DEAD: 0 code hits (CustomerPage hit is a different RPC's `total_depreciation_released`); fndefs NONE; rv_payments view test-only.
  - `notes` — uncertain (generic; no explicit read/write found).
  - `is_deductible` — used (returned by get_payments_ledger, rendered PaymentsLedger.jsx:149) but **no writer in current code** — legacy rows only.
- Policies: `allow_authenticated_payments` (ALL) — USED (`NOT is_crm_partner`); `allow_anon_select_payments` / `allow_anon_insert_payments` / `allow_anon_update_payments` / `allow_anon_delete_payments` (roles=[authenticated], all USING/CHECK true) — BAND-AID ×4 — renamed legacy anon-era policies; each ORs past the partner carve-out for its command, making the carve-out a dead letter on payments (structural #3).
- Triggers: `trg_payment_update_invoice` → `update_invoice_paid()` — USED — THE money trigger (owns invoices.amount_paid/insurance_paid/homeowner_paid/status/paid_at + jobs.collected_value/ar_status).
- Notes: workers ship explicit negative tests that they never write trigger-owned columns (`qbo-payment.test.js:37`, `stripe-webhook.test.js:35`, `recordPayment.test.js:51`) — the guard culture is real; the gaps are on invoices.status (structural #1).

### qbo_attachments — USED
- Purpose: registry of files attached to QBO invoices/estimates (QBO holds the bytes; UPR keeps the row).
- Evidence: `functions/api/qbo-attach.js:72-166` (claim/insert/update/delete with idempotency), `src/components/collections/QboAttachments.jsx:99,131,205` (list + upload + include_on_send display).
- Prod stats: 1 live, 1/1/0, scans current.
- Provenance: `supabase/migrations/20260724180000_qbo_attachments.sql` (+ paired rollback; migration contract-tested in `functions/api/qbo-attachments-migration.test.js`).
- Columns: 12 total — 12 used (insert at qbo-attach.js:135 writes entity_type/invoice_id-or-estimate_id/qbo_attachable_id/file_name/content_type/file_size/include_on_send/idempotency_key/created_by; UI orders by created_at).
- Policies: `qbo_attachments_select` (SELECT, authenticated) — USED — the one **model policy** in this domain: `NOT is_crm_partner` AND active admin/manager employee predicate.
- Triggers: none.

### qbo_events — USED (write-only event ledger)
- Purpose: QBO webhook event claim/dedup + processing forensics.
- Evidence: `claim_qbo_event` RPC (insert ON CONFLICT DO NOTHING) called at `qbo-webhook.js:85`; status/error/processed_at updates at `qbo-webhook.js:96,111,118`. No reader (by design — inspected by humans).
- Prod stats: 4 live, 4/4/0.
- Provenance: `supabase/migrations/20260624_qbo_payment_webhook.sql`.
- Columns: 7 total — 6 used, 1 uncertain (`created_at` default-stamped).
- Policies: none (RLS enabled, zero policies — deny-all; worker is service-role). Correct posture.
- Triggers: none.
- Notes: `status` has no CHECK constraint (verified in qbo-webhook.test.js header) — 'ignored'/'retry' writable by design.

### stripe_events — USED (write-only event ledger)
- Purpose: Stripe webhook claim/dedup + forensics (payment_intent, refund, dispute events).
- Evidence: `claim_stripe_event` at `stripe-webhook.js:59`; finalize update at `:65` (status/error/payload/processed_at).
- Prod stats: 0 live (2 ins / 2 del), last_idx 2026-06-20.
- Provenance: `supabase/migrations/20260620_stripe_s3.sql`.
- Columns: 7 total — 6 used, 1 uncertain (`created_at`).
- Policies: none (deny-all RLS; service-role worker). Correct.
- Triggers: none.

### vendor_invoices — DEAD
- Purpose (legacy): tracking sub/vendor bills per job (vendor, order_number, amount, UNPAID/paid status, payment_link).
- Evidence trail: greps `'vendor_invoices'`/`"vendor_invoices"`/bare `vendor_invoice` case-insensitive across src/functions/scripts/upr-mcp/tests + sql/yml/toml/json = only generated codeIndex; fndef corpus = **one** hit: `merge_jobs()` re-points `vendor_invoices.job_id` during a job merge — incidental housekeeping, not feature usage; no trigger, no view, no cron, not in publication. The only FK consumer (`job_costs.vendor_invoice_id`) is itself a zero-code-reference table.
- Prod stats: 8 live rows, 42 ins / 26 upd / 0 del since stats reset, but last_seq 2026-07-08 = the audit-scan timestamp cluster and last_idx 2026-07-21 = the live-audit day; no app-shaped access pattern. (Stats-reset caveat: the ins/upd counters show it WAS written at some point in the stats window — consistent with the feature being retired mid-window or a one-time import.)
- Provenance: untracked — predates schema-as-code.
- Columns: 15 total — 15 dead (dead with table).
- Policies: `allow_authenticated_vendor_invoices` (ALL, `NOT is_crm_partner`) — DEAD (on a dead table).
- Triggers: none.
- Notes: integer PK + spreadsheet-shaped columns (vendor as free text despite a `vendors` table) — reads as an imported ops spreadsheet whose UI was removed. 8 rows of real-looking data → owner question #1.

### vendors — DEAD
- Purpose (legacy): vendor registry (name, short_code, color, active).
- Evidence trail: greps `'vendors'`/`"vendors"`/bare `vendors\b` case-insensitive across all scope dirs = only generated codeIndex; all src "vendor" hits are the contacts role vocabulary (AddContactModal role='vendor'), not this table; fndef corpus = NONE; no trigger/view/cron/publication. Not even referenced by vendor_invoices (whose `vendor` column is free text).
- Prod stats: 2 live, 2/0/0; last_idx 2026-03-12 (four months stale); last_seq = audit cluster.
- Provenance: untracked — predates schema-as-code.
- Columns: 7 total — 7 dead (dead with table).
- Policies: `allow_authenticated_vendors` (ALL, USING true / CHECK true) — DEAD (dead table; also always-true).
- Triggers: none.

## RPCs (36)

All are SECURITY DEFINER with pinned search_path except `update_invoice_paid` (invoker). ACL `{postgres, authenticated, service_role}` on every one except `qbo_payments_sync_poll` (postgres-only — the correctly-contained one). **None of the definer RPCs validates the caller in its body** — flagged per-row.

| function(args) | class | security | callers / evidence | notes |
|---|---|---|---|---|
| capture_invoice_status_history() | used | definer | trigger `trg_invoice_status_history` on invoices | trigger-return fn (not PostgREST-callable); swallows own errors (RAISE WARNING) |
| claim_qbo_event(p_id, p_entity, p_operation) | used | definer | qbo-webhook.js:85 | **granted to authenticated with no caller check** — any logged-in user can pre-claim a webhook event id and make the real delivery no-op (silent payment loss); should be service-role-only |
| claim_stripe_event(p_id, p_type) | used | definer | stripe-webhook.js:59 | same authenticated-grant poisoning vector as claim_qbo_event |
| convert_estimate_to_invoice(p_estimate_id, p_force, p_created_by) | used | definer | EstimateEditor.jsx:287, AdminEstimateDetail.jsx:144, qbo-payment-sync.js:131 | no caller check; auto-creates job from contact when needed (calls jobs-domain create_job_with_contact); writes estimates.status='approved' |
| create_draft_invoice_for_job() | used | definer | trigger `trg_create_draft_invoice` AFTER INSERT ON jobs | body gated on integration_config 'auto_draft_invoices'='true' — verify the flag's live value before assuming it fires |
| create_estimate_for_contact(8 args) | used | definer | NewEstimateModal.jsx:137, admin-mobile EstimateCreateForm.jsx:143 | no caller check |
| create_estimate_for_job(p_job_id, p_estimate_type, p_created_by) | **dead** | definer | Zero: greps rpc\('create_estimate_for_job' + quoted + bare across src/functions/scripts/upr-mcp/tests/sql/yml = codeIndex only; fndef corpus callers = NONE; no cron/trigger | superseded by the contact-anchored flow; only internal effect would be generate_estimate_number |
| create_invoice_for_job(p_job_id, p_created_by) | used | definer | ClaimBilling.jsx:87, NewInvoiceModal.jsx:101, + convert_estimate_to_invoice body | idempotent-ish (returns earliest existing invoice) |
| delete_oop_quote(p_id) | used | definer | OOPPricing.jsx:167, TechOOPPricing.jsx:231 | no caller check — any authenticated can delete any quote |
| generate_estimate_number() | used | definer | inside create_estimate_for_contact (live) + create_estimate_for_job (dead) | advisory-lock + regex max scan; also directly grantable — harmless |
| generate_invoice_number() | used | definer | inside create_invoice_for_job + create_draft_invoice_for_job | same pattern |
| generate_oop_quote_number() | used | definer | inside upsert_oop_quote | month-prefixed count — race-prone without lock, low stakes |
| get_avg_ticket(p_start, p_end) | used | definer, stable | useAvgTicket.js:17, admin-mobile FinancialCards.jsx:103 | dashboard |
| get_commissions(p_month) | **dead** | definer, stable | Zero callers: rpc-grep + bare-word grep = only comments in settings/Commissions.jsx (:24,:38 "matches get_commissions"); fndef callers NONE; no cron | fully-built commission report nobody calls; Settings→Commissions edits the *rates* it would use — owner question #4 |
| get_estimate_aging(p_org_id) | used | definer, stable | CrmReports.jsx:108, CrmOverview.jsx:234 | filters status='submitted' which nothing sets → returns zero buckets (structural #5); p_org_id arg ignored in body |
| get_estimates() | used | definer | Estimates.jsx:64, collections EstimatesList.jsx:72, admin-mobile EstimatesTab.jsx:47, collections-chat.js:339 | main list |
| get_job_financials(p_job_ids) | used | definer | claimUtils.js:61 (Jobs/JobPage/ClaimPage/Production overlays), collections-chat.js:354 | returns 4 responsibility/depreciation fields that are never written (always 0) |
| get_oop_quote(p_id) | used | definer | OOPPricing.jsx:49, TechOOPPricing.jsx:97,138 | returns full row |
| get_oop_quotes(p_limit, p_job_id) | **dead** | definer | Zero: rpc-grep + bare grep = codeIndex only; fndef callers NONE; no cron/trigger; both OOP pages load by ?quoteId only — no list UI exists | built for a list view that never shipped |
| get_open_estimates_summary() | used | definer, stable | useOpenEstimates.js:25, admin-mobile WorkCards.jsx:105 | dashboard |
| get_payments_ledger(p_limit) | used | definer | PaymentsLedger.jsx:58, admin-mobile PaymentsTab.jsx:50, collections-chat.js:333 | ledger |
| get_payments_received(p_start, p_end) | used | definer, stable | usePaymentsReceived.js:20, ArAgingTab.jsx:77, MoneySplitCard | dashboard |
| get_pipeline_summary() | used | definer, stable | usePipeline.js:16, admin-mobile OpsCards.jsx:183 | dashboard |
| get_real_job_evidence_mismatches() | used | definer, stable | pg_cron job 10 `upr_real_job_evidence_reconciler` (daily 13:15) → writes system_events | cron-only consumer; no UI |
| get_revenue_by_division(p_start, p_end) | used | definer, stable | useRevenue.js:18, FinancialCards.jsx:93 | dashboard |
| global_search(p_term, p_limit) | used | definer, stable | GlobalSearch.jsx:62 | reads contacts/claims/jobs cross-domain; 'estimates' key hardcoded to `[]` |
| qbo_payments_sync_poll() | used | definer | pg_cron job 13 `upr_qbo_payments_sync_hourly` (:17 hourly) → net.http_post to /api/qbo-payments-sync | ACL postgres-only + URL allowlisted in body — the model containment |
| recompute_estimate_from_lines() | used | definer | trigger trg_estimate_lines_total | owns estimates.subtotal/amount |
| recompute_invoice_from_lines() | used | definer | trigger trg_invoice_lines_total | owns invoices.subtotal/total (= subtotal + tax) |
| save_estimate_lines(p_id, p_lines, p_kind) | **dead** (test-only reference) | definer | Zero app callers (rpc-grep/bare = 0 in src/functions/scripts); only `supabase/tests/uxq_fb_rpcs.sql:65` (db-lane test) + migration-baseline entry; fndef callers NONE | born 20260713_uxq_fb_save_estimate_lines.sql; editors write line rows directly instead; its invoice branch would silently drop the qbo/adjustment columns it doesn't re-insert |
| sync_job_invoiced_from_invoices(p_job_id) | band-aid | definer | trg_sync_job_invoiced (per-row on invoices) | exists solely to keep duplicated jobs.invoiced_value/invoiced_date aligned; guarded "never zero legacy values" |
| trg_estimate_real_job() | used | definer | trigger estimate_real_job | calls jobs-domain mark_job_real |
| trg_invoice_real_job() | used | definer | trigger invoice_real_job | fires on qbo_invoice_id set |
| trg_sync_job_invoiced() | band-aid | definer | trigger trg_invoices_sync_job_ar | sync-hack pair of the above; handles job re-point |
| update_invoice_paid() | used | **invoker** | trigger trg_payment_update_invoice on payments | THE money trigger — owns invoices.amount_paid/insurance_paid/homeowner_paid/status/paid_at + jobs.collected_value/ar_status; invoker security works because triggers run as the row-touching role (worker=service, UI=authenticated with broad policies) |
| upsert_oop_quote(26 args) | used | definer | OOPPricing.jsx:145, TechOOPPricing.jsx:211 | widest signature in the domain; no caller check |

## Structural problems (ranked, worst first)

1. **Trigger-owned `invoices.status` is written directly by the browser and the QBO worker (Rule 15 violation).** Severity 5. `src/pages/InvoiceEditor.jsx:301` writes `{status:'draft'}` from the client on any line edit; `functions/api/qbo-invoice.js` writes 'draft' (:74 unlink), 'sent' (:104 email, tier-guarded), 'saved' (:265 push, tier-guarded). The trigger `update_invoice_paid()` owns status per AGENTS.md Rule 15 (and the repo's own negative tests treat it so — recordPayment.js:43 lists status as forbidden). Concrete failure: edit a line on a **paid** invoice → editor stamps status='draft' → paid state misreported until the next payments-table event re-fires the trigger; the editor guard (`canEdit`) blocks only `locked`, not 'paid'. The worker writes are tier-convention-guarded but make status a three-writer column with the convention enforced nowhere.
2. **Nearly every RPC is `SECURITY DEFINER` granted to `authenticated` with no caller check — including money mutators and webhook claim functions.** Severity 4. Definer bypasses RLS, so the `NOT is_crm_partner` policy carve-outs are void through the RPC layer: a CRM-partner JWT can run `convert_estimate_to_invoice`, `create_invoice_for_job`, `delete_oop_quote`, `save_estimate_lines` (dead but granted), etc. Worse, `claim_qbo_event`/`claim_stripe_event` let any authenticated user pre-insert a provider event id so the real webhook delivery dedups to no-op — a silent payment-recording denial vector. Matches the live audit's 342-definer finding; `qbo_payments_sync_poll` (postgres-only ACL, URL-allowlisted body) is the template to copy.
3. **Always-true legacy policies defeat the CRM-partner carve-out on payments and invoices.** Severity 4. `payments` carries four renamed anon-era policies (`allow_anon_{select,insert,update,delete}_payments`, roles=[authenticated], USING/CHECK true) that OR past `allow_authenticated_payments`' `NOT is_crm_partner` predicate for **every command**; `invoices.allow_anon_read_invoices` (SELECT true) does the same for reads. Net: the partner exclusion on the two most sensitive money tables is decorative. Fix is a policy-drop migration (destructive-approved marker + rollback per database-standard.md).
4. **The invoice-adjustments feature is stillborn but its keystone column is load-bearing.** Severity 3. `invoice_adjustments` (0 rows ever) + 8 `invoice_line_items` columns + 4 `invoices` columns are dead, yet `invoices.adjusted_total` is read in every balance formula (`COALESCE(adjusted_total,total)` in get_job_financials, get_revenue_by_division, get_avg_ticket, get_commissions, collections-chat, InvoiceEditor, ClaimPage) with **no writer in the entire system** — short-pay adjustments currently have no recording path, and v2 must decide: build the writer or fold the column.
5. **The estimate 'submitted' lifecycle is phantom while a live CRM widget queries it.** Severity 3. Nothing sets `estimates.status='submitted'`, `submitted_at`, or `denied_reason` (writers: create RPCs set 'draft', convert sets 'approved'; UI derives display status from qbo/converted fields instead — Estimates.jsx:42). But `get_estimate_aging` (CrmReports + CrmOverview) filters `status='submitted'` → permanently empty buckets, and `get_open_estimates_summary`/`get_commissions` embed status-vocabulary assumptions ('approved','accepted','converted','signed') only one of which ('approved') is ever produced.
6. **Job-level money mirrors maintained by sync band-aids.** Severity 3. `jobs.invoiced_value/invoiced_date` (via trg_invoices_sync_job_ar → sync_job_invoiced_from_invoices) and `jobs.collected_value/ar_status` (via update_invoice_paid's second half) duplicate what get_job_financials computes live — and claimUtils then overlays the RPC *over* the mirrored columns with fallback. Three representations of the same facts; v2 should pick one.
7. **billing_2fa_codes / qbo_events / stripe_events rely on zero-policy RLS while broad table GRANTs remain.** Severity 2. Deny-all-by-no-policy is correct today, but anon/authenticated hold full DML grants on all three (grants.json), so a single future `CREATE POLICY` or RLS toggle exposes a 2FA code-hash ledger and event stores. Revoke the browser-role grants outright.
8. **Dead vendor module and orphan FK chain.** Severity 2. `vendors`, `vendor_invoices` (8 real-looking rows) and the cross-domain `job_costs.vendor_invoice_id` FK form a retired feature island whose only live touch is merge_jobs re-pointing. Cheap v2 win: archive + drop (separate reviewed destructive change).

## Open questions for the owner

1. **vendor_invoices holds 8 rows (real vendors, order numbers, UNPAID statuses).** Is vendor-bill tracking done elsewhere now (QBO bills?), and is this data worth an archive export before the tables are dropped in v2?
2. **How do you record an insurance short-pay/adjustment today?** The adjustments feature never launched, yet `adjusted_total` drives every balance formula — is adjusting done directly in QBO (and should UPR mirror it), or by hand-editing the DB?
3. **OOP Pricing has zero saved quotes and no list screen** — is the calculator used ephemerally (numbers copied out, quote discarded), or was a saved-quotes list planned and still wanted?
4. **Commissions:** rates are maintained in Settings, but the report RPC has no UI. Is a commissions report still on the roadmap, or is payroll handled entirely outside UPR?
5. **Estimate submission tracking:** do you still care about "submitted to carrier / denied" as states (the aging widget assumes them), or is the real lifecycle now just Draft → pushed-to-QBO → emailed → converted?
6. **Deductible source of truth:** jobs.deductible (hand-entered) vs invoices.deductible_amount (never written) — v2 should keep exactly one; which reflects how the office actually works?
7. **invoice_status_history is written on every status change but read by nothing** — keep as audit (add a viewer someday) or drop?
8. **auto_draft_invoices flag:** is `integration_config.auto_draft_invoices` currently 'true' in production (auto-draft an invoice on every new job)? Repo can't see live config; it changes whether create_draft_invoice_for_job ever does work.

## Search appendix

- Call-site greps (per name, quoted `'N'`/`"N"` + bare `\bN\b`, case-insensitive where noted) across `src/`, `functions/`, `scripts/`, `upr-mcp/`, `tests/`, `supabase/tests/`, `.github/workflows/` with globs `*.{js,jsx,mjs,sql,yml,toml,json}`: all 14 table names; all 36 RPC names (plus `rpc\('name'` form); candidate column names (submitted_to, denied_reason, xactimate_file_url, pdf_url, sent_to_phone, internal_notes, original_total, adjustment_reason, adjusted_at, adjusted_by, carrier_name, policy_number, category, room, original_quantity, original_unit_price, original_line_total, was_adjusted, was_denied, adjustment_note, is_depreciation_release, is_deductible, stripe_payment_intent_id, dispute_status, include_on_send, balance_due, expiration_date, submitted_at, adjusted_total, xactimate_meta, locked, billed_to, tax, payer_name, vendor_invoice_id, job_costs, rv_invoices, rv_payments, quoteId=).
- Catalog checks: full fndefs corpus (36/36 definitions extracted and read; per-candidate in-database caller scans), triggers.json (all 11 + the jobs-side trg_create_draft_invoice discovery), views.json (rv_invoices/rv_payments — test-only consumers), publications.json (no billing tables), prod-cron.json (jobs 10 + 13 are billing-relevant), prod-fn-stats.json (empty — track_functions off, so no call-count corroboration for ANY function; dead-RPC claims rest on code+fndef+cron absence alone), prod-stats.json (per-table rows/DML/scan recency; the identical 2026-07-08T04:18 last_seq timestamp across billing_2fa_codes/stripe_events/vendor_invoices/vendors is an audit-scan cluster, not app traffic).
- Files read in full or in relevant part: billing-2fa.js, qbo-invoice.js, qbo-estimate.js (via greps), qbo-attach.js, qbo-webhook.js (greps), stripe-webhook.js, stripe-pay-link.js, qbo-payment-sync.js, analyze-xactimate.js, collections-chat.js (greps), InvoiceEditor.jsx, Estimates.jsx, OOPPricing.jsx/TechOOPPricing.jsx (greps), claimUtils.js, recordPayment.js (greps).
- Ambiguities honestly held: (a) `upr-mcp`'s `upr_rpc` tool can invoke any RPC by name at runtime (owner automation) — I did not count that as usage for anything; if the owner has personal automations calling e.g. get_commissions, my dead calls for the 4 RPCs would need revision. (b) prod-fn-stats is empty, so no server-side call counts corroborate RPC usage/dis-usage. (c) `balance_due` and the two `line_total`s are believed GENERATED columns (code headers say so for line_total) but the catalog extract doesn't carry `attgenerated` — verify before v2 mapping. (d) Generic columns marked uncertain (6: three created_at, changed_at, two notes) could be resolved with one live query each (any non-default values?) — out of scope read-only here. (e) `invoice_adjustments`' 147 seq scans and vendor_invoices' 42 inserts predate-or-postdate unknown stats resets; I weighted code-path absence over stats where they conflict.
