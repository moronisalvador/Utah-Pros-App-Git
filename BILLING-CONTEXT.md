# UPR Billing, QuickBooks & Xactimate AI — Engineering Context

**Last updated:** June 26, 2026
**Scope:** Everything behind the invoice builder, the two-way QuickBooks Online (QBO) sync,
payments, Stripe pay links, and the Xactimate AI import. Read this before building on the billing
stack so you extend it cleanly instead of re-deriving (or accidentally redesigning) it.

> This is a deep-dive companion to `UPR-Web-Context.md` (the master context doc). When you change
> anything described here, update this file too.

---

## 0. The one rule: money is human-in-the-loop

Nothing reaches QuickBooks automatically. The Xactimate AI and the invoice builder only ever produce
or edit a **DRAFT**. A person reviews it and clicks **Save invoice**, which is the single action that
pushes to QBO. Keep that gate. Every "smart" feature (AI extraction, reconciliation, Item/Class
autofill) is a *pre-fill or a check*, never an auto-post.

Two more invariants that bite if ignored:
- **Shared Supabase across `dev` and `main`.** A DB or feature-flag change hits both environments at
  once. Sequence schema changes so the code that understands them is live first.
- **Computed columns are never written by app code:** `invoice_line_items.line_total` is a GENERATED
  column, and `invoices.amount_paid` is recomputed by a DB trigger from the `payments` table. Write
  `quantity`/`unit_price` and insert `payments`; let the DB derive the rest.

---

## 1. Mental model (the spine)

```
job ──create_invoice_for_job──▶ draft invoice ──▶ InvoiceEditor (build/edit)
                                                       │  Save invoice
                                                       ▼
                                              POST /api/qbo-invoice  ──▶  QBO Invoice
                                                       │  (writes qbo_invoice_id back)
                          ┌────────────────────────────┴───────────────────────────┐
            Receive payment │ Send to customer                                       │
                  ▼         ▼                                                        ▼
        POST /api/qbo-payment   POST /api/qbo-invoice {action:'send'}        customer pays online
                  │  (mirror UPR → QBO)                                             │
                  └────────────────────────────────────────────────────────────────┘
                                                       ▼
                              /api/qbo-webhook (real-time)  +  /api/qbo-payments-sync (hourly)
                                                       ▼
                              insert into payments (source='qbo')  ──trigger──▶ invoice.amount_paid
```

The **Xactimate AI import** is an optional front door: upload a PDF on a draft invoice, the AI reads
it and pre-fills the single summary line + a recap banner. It does **not** touch QBO.

Estimates are a parallel track that **converts into** invoices (`convert_estimate_to_invoice`); the
editor (`EstimateEditor.jsx`) mirrors the invoice builder.

---

## 2. Data model

### `invoices` (key columns)
- **Identity:** `id`, `invoice_number`, `invoice_type`, `status`, `job_id`, `contact_id`,
  `estimate_id`.
- **Money:** `subtotal`, `tax`, `total`, **`adjusted_total`** (manual override; the "true" billable
  is `adjusted_total ?? total`), `amount_paid` (**trigger-recomputed**), `balance_due`,
  `original_total`, `adjustment_reason/at/by`.
- **Insurance split:** `insurance_responsibility`, `deductible_amount`, `depreciation_withheld`,
  `depreciation_released`, `homeowner_responsibility`, `insurance_paid`, `homeowner_paid`,
  `billed_to`, `carrier_name`, `claim_number`, `policy_number`.
- **Dates/sending:** `invoice_date`, `due_date`, `sent_at`, `paid_at`, `sent_to_email/phone`.
- **QBO:** `qbo_invoice_id`, `qbo_doc_number`, `qbo_synced_at`, `qbo_sync_error`, `qbo_emailed_at`,
  `qbo_email_status`.
- **Stripe:** `stripe_payment_link_url`, `stripe_checkout_session_id`, `stripe_payment_link_created_at`.
- **AI:** **`xactimate_meta` JSONB** — the persisted Xactimate recap (see §6).
- `pdf_url`, `notes`, `internal_notes`, `created_by`, `created_at`, `updated_at`.

### `invoice_line_items`
`id`, `invoice_id`, `description`, `quantity`, `unit_price`, **`line_total` (GENERATED — never write)**,
`qbo_item_id`, `qbo_item_name`, `qbo_class_id`, `qbo_class_name`, `sort_order`, `xactimate_code`,
`created_at`, `updated_at`.

### `payments`
`id`, `invoice_id`, `job_id`, `contact_id`, `amount`, `payment_date`, `payer_type`
(`insurance`|`homeowner`|`other`), `payment_method` (`check`|`eft`/`ach`|`credit_card`|`cash`|`other`),
`reference_number`, `qbo_payment_id`, **`source`** (`manual`|`qbo`|`stripe`), `refunded_amount`,
`recorded_by`. Inserting/deleting a payment triggers recomputation of `invoices.amount_paid`/`status`.

### Key RPCs
- `create_invoice_for_job(p_job_id, p_created_by DEFAULT NULL)` → invoice row. **Idempotent** —
  returns the existing invoice if the job already has one.
- `get_ar_invoices()` → AR list with computed `balance = (adjusted_total ?? total) − amount_paid`,
  ordered by balance desc. Used by Collections.
- `convert_estimate_to_invoice(p_estimate_id, p_force DEFAULT false, p_created_by DEFAULT NULL)` →
  jsonb. Copies estimate lines → invoice lines; auto-creates claim+job if the estimate has none;
  returns `{needs_confirm:true}` if the target invoice already has lines and `p_force` is false.
- `get_customer_detail(p_contact_id)`, `search_contacts_for_job(p_query)` — power NewInvoiceModal.
- `insert_job_document(...)` — used to retain the source Xactimate PDF on the job.

---

## 3. The invoice builder page — `src/pages/InvoiceEditor.jsx`

**Route:** `/invoices/:invoiceId` (in `src/App.jsx`), inside the `Layout` shell, gated by the
`page:collections` feature route. **Reached from** the Collections "Invoices" tab (row click) or from
`NewInvoiceModal` (`create_invoice_for_job` → `navigate('/invoices/:id')`).

### load()
Fetches `invoices` (all columns), then `jobs` (division, job_number, claim_id, primary_contact_id,
address…), `claims` (claim_number, insurance_carrier, date_of_loss, loss address…), `contacts`
(name, email), `invoice_line_items` (ordered by `sort_order`, `created_at`), and `payments`. It also:
- auto-inserts **one blank line** when an editable, unsent invoice has none (so the grid opens ready);
- **re-hydrates the Xactimate recap banner** from `inv.xactimate_meta` **once per mount** (guarded by
  `xactHydratedRef`, so a manual ✕ dismiss isn't undone by later reloads from line edits).
- loads the QBO **Item/Class catalog** via `POST /api/qbo-query` into `qboItems` / `qboClasses`.

### Layout (render order)
- **Toolbar:** `Save invoice` · `✨ Import Xactimate` · `Receive payment` · `Create/Copy pay link` ·
  `Preview` · `Manage ▾` (ActionMenu: *Revert to draft* when synced, *Delete draft* when not synced &
  uncollected). A ✓ "synced" stamp shows when `qbo_synced_at` is set.
- **Header card:** INVOICE + `StatusBadge`, big doc number (`qbo_doc_number || invoice_number`),
  **Bill To** (contact name/email), and a field grid: Carrier, Claim, Job (`job_number · division`),
  Date of loss, Sent, **Due date** (a `DatePicker` when editable). Address line via `MapPin`.
- **Banners** (each conditional): `qbo_sync_error` (danger), `catalogMsg` (warning — QBO catalog
  unavailable), `stripe_payment_link_url` (info), and the **Xactimate recap** (success, or warning if
  `reconciles === false`) — see §6.
- **Line-item grid:** drag handle · `SearchSelect` Item (options `qboItems`) · `AutoGrowTextarea`
  Description · `SearchSelect` Class (options `qboClasses`) · Qty · Rate · computed Amount · delete.
  Read-only roles get a non-editable variant.
- **Totals:** Subtotal (Σ `line_total`) · Tax (`inv.tax`) · Total.
- **Payments section:** Invoiced / Collected / Balance + a `ProgressBar`; payment rows are clickable
  (→ payment modal).
- **Modals:** customer **Preview/Print** (formal layout, print CSS), **payment modal** (view → Edit →
  form; Stripe payments are view-only; two-click delete), and the **Xactimate progress modal**
  (spinner + rotating status + simulated bar; see §6).

### State & derived
Core: `inv`, `job`, `claim`, `contact`, `lines`, `payments`, `qboItems`, `qboClasses`. UI: `busy`,
`payForm`/`payView`/`delPayArmed` (payment modal), `showPreview`, `xactBusy`/`xactInfo`/`xactStage`/
`xactPct`, `dragIdx`. Derived: **`synced = !!inv.qbo_invoice_id`**, **`canEdit = canEditBilling(role)`**
(admin/manager — from `claimUtils`), `payMode` (`view`|`edit`|`new`), `subtotal`/`liveTotal`,
`invoiced = adjusted_total ?? total`, `balance`, `docNumber`, `stKind = invoiceStatusKind(...)`.

### Line edits "save as you type"
`setLineLocal(id, patch)` updates local state optimistically (recomputes qty×unit_price for display);
`saveLine(line)` PATCHes `invoice_line_items` on blur / select (no reload). `addLine`/`removeLine`
write then `load()`; drag reorder rewrites `sort_order`. **Never write `line_total`.**

### Save → QBO, send, payments
- **Save:** `flushAndPush()` writes any pending line edits, then `callWorker({})` → `POST
  /api/qbo-invoice {invoice_id}`. **Send:** `{action:'send', send_to}`. **Revert to draft:**
  `{action:'delete'}` (removes from QBO, keeps the UPR draft).
- **Payments:** `recordPayment`/`editPayment`/`deleteEditingPayment` write the `payments` table and —
  **only when the invoice is synced** — mirror to `POST /api/qbo-payment`. Stripe-sourced payments are
  view-only (reconcile them in QBO).

### Gating & feature flags
- Page lives behind **`feature:billing`**.
- `canEdit` (billing role) controls all mutating UI; `synced` controls Send/Revert.
- **`feature:ai_xactimate`** gates the Import button (+ `canEdit && !synced && job?.id`).

### Reused building blocks
`DatePicker` (`src/components/DatePicker.jsx` — calendar, `YYYY-MM-DD` value/onChange),
`SearchSelect` + `ActionMenu` (`src/components/collections/`), `AutoGrowTextarea`
(`src/components/AutoGrowTextarea.jsx`), and the collections design system: **`collKit.jsx`**
(CollCard, GhostButton, PrimaryButton, StatusBadge, ProgressBar, SegControl, Pill, MapPin, EmptyState)
+ **`collTokens.js`** (`C` palette, `STATUS`, `fmt$`/`fmt$2`/`fmtK`, `fmtDate`, `mono`, `tnum`,
`invoiceStatusKind`, `divLabel`, `divColor`, `periodRange`/`inPeriod`, `downloadCsv`).

### Creation + listing
- **`src/components/NewInvoiceModal.jsx`** — customer search (`search_contacts_for_job`) →
  `get_customer_detail` (claims→jobs, with a bulk check of which jobs already have invoices) → click a
  job → `create_invoice_for_job` → navigate to the builder. Falls back to `CreateJobModal` for new
  customers.
- **`src/pages/Collections.jsx`** — the billing hub: SegControl tabs (A/R · Invoices · Estimates ·
  Payments) + a period switch (All/MTD/Last 30/QTD/YTD). Invoice rows link to `/invoices/:id`.

---

## 4. QuickBooks Online sync

All QBO helpers live in **`functions/lib/quickbooks.js`** (no SDK — `fetch` against the QBO REST API,
`MINOR_VERSION = '70'`, sandbox/production via `QBO_ENVIRONMENT`).

### OAuth tokens
Stored in **`integration_credentials`** (provider `'quickbooks'`, service-role only). `getConnection`
/ `saveTokens` read/write them; **`getValidAccessToken(env)`** returns `{accessToken, realmId,
environment}` and **auto-refreshes** when within ~5 min of expiry (rolling the refresh token forward).
**`qboFetch(env, path, options)`** is the authed wrapper used by everything below.

### Division → QBO mapping (the one place this lives)
**`divisionToQbo(division)`** (substring match on the job's division):

| Division contains | itemId | itemName | className |
|---|---|---|---|
| `recon` | `1010000201` | Reconstruction/ Remodeling Services | `Reconstruction` |
| `mold` | `1010000131` | Mold Remediation Services | `null` |
| `content` | `38` | Contents | `null` |
| `mit` / `water` / `dry` | `1010000071` | Water Damage Mitigation And Drying | `Mitigation` |
| *(anything else)* | — | — | returns `null` |

`findClassId(env, name)` resolves a class **name → QBO class id** at runtime (so ids aren't
hardcoded). `QBO_INSURANCE_ADJUSTMENT_ITEM_ID = '1010000231'`. This same mapping drives both the
invoice-sync line building **and** the Xactimate Item/Class autofill — change it in one place.

### Workers (`functions/api/`)
All accept either an `x-webhook-secret` (server-to-server) or a Supabase Bearer token (the UI uses
`getAuthHeader()` from `src/lib/realtime.js`).

- **`qbo-invoice.js`** — `POST {invoice_id, action?: 'send'|'delete', send_to?}`.
  - Loads invoice + job + contact + claim. **Requires `contact.qbo_customer_id`** (sync the customer
    first) and a mappable `job.division`.
  - Builds lines from `invoice_line_items`: `ItemRef = li.qbo_item_id || map.itemId`,
    `ClassRef = li.qbo_class_id || divClassId`, plus Qty/UnitPrice. **No-lines fallback:** one summary
    line at `adjusted_total ?? total`. Throws if the total ≤ 0.
  - Sets `DocNumber = job_number` (needs "Custom transaction numbers" ON in QBO, else ignored), a
    PrivateNote memo (date-of-loss / job / claim / address), `ShipAddr`, and a `LinkedTxn` to the QBO
    estimate when converted.
  - **Writeback:** `qbo_invoice_id`, `qbo_doc_number`, `qbo_synced_at`, `qbo_sync_error=null`; first
    create also sets `sent_at` + `due_date` (+30 days). `action:'send'` → QBO emails the customer and
    sets `qbo_emailed_at`/`qbo_email_status`; `action:'delete'` removes the QBO invoice.
- **`qbo-payment.js`** — `POST {payment_id}` mirrors a UPR payment → QBO (requires the invoice already
  synced + customer in QBO; idempotent on `qbo_payment_id`). `{action:'delete'}` (by `payment_id` or
  `qbo_payment_id`) removes the QBO payment.
- **`qbo-query.js`** — `POST {query}`, **SELECT-only** passthrough; the frontend uses it to load the
  Item/Class catalog.
- **`qbo-sync-customer.js`** — contact → QBO Customer (trigger-driven per contact, or `{backfill}`).
  Dedups by email then display name; auto-disambiguates duplicate-name (code 6240) with the phone's
  last 4. Writes `contacts.qbo_customer_id`.
- **`qbo-estimate.js`** — estimate push/send/delete (mirrors `qbo-invoice`; uses `estimate_number` +
  `intended_division`).

### Payments flowing back from QBO (and Stripe)
- **`qbo-webhook.js`** — Intuit-signed webhook (Payment entity). Idempotent via the `claim_qbo_event`
  RPC; always returns 200 (per-event errors logged to `qbo_events`).
- **`qbo-payments-sync.js`** — hourly safety-net poll (7-day lookback) for anything the webhook missed.
- Both call **`functions/lib/qbo-payment-sync.js`** → `syncQboPaymentToUpr` (fetch QBO payment, dedup
  on `qbo_payment_id`, insert into `payments` with `source='qbo'`, and **adopt** QBO-auto-created
  invoices when a customer pays an estimate deposit online — via `convert_estimate_to_invoice`) /
  `removeQboPaymentFromUpr`. The `amount_paid` trigger does the rest.

### Logging
Workers log to **`worker_runs`** (`worker_name`, status, counts, error). Webhook events log to
**`qbo_events`**.

---

## 5. Stripe pay links & fee automation (DORMANT until keys are set)

`POST /api/stripe-pay-link {invoice_id}` creates a hosted pay link (returns `url`; 503 if keys
absent). `functions/lib/quickbooks.js` also has clearing-account helpers (`createPurchase` for the
processor fee, `createTransfer` for the net payout) for automated QBO fee reconciliation. Stripe
payments land in UPR through the **same** QBO payment sync (`source='stripe'`) and are **view-only**
in the UI — adjust/refund them in QBO so reconciliation stays intact.

---

## 6. Xactimate AI import — `functions/api/analyze-xactimate.js` (+ InvoiceEditor)

UPR's only AI/LLM integration. Upload an Xactimate PDF on a draft invoice; Claude reads it and
pre-fills the single insurance-billable line + a recap. **Draft only — never touches QBO.**

### The worker
- **Anthropic Messages API:** `POST https://api.anthropic.com/v1/messages`, headers
  `x-api-key: env.ANTHROPIC_API_KEY` + `anthropic-version: 2023-06-01`, model **`claude-opus-4-8`**.
  The PDF is a base64 **`document`** content block (GA, no beta header). Output is a **forced strict
  tool** (`submit_estimate`, `tool_choice:{type:'tool'}`, `strict:true`) — there is **no fine-tuning**.
- **Strict schema:** `line_items[]`; `totals{line_item_total, overhead, profit, sales_tax, rcv,
  depreciation, acv, deductible, net_claim, paid_when_incurred}`; `billable{amount,
  basis(RCV|ACV|net_claim|line_item_total), confidence(high|medium|low), rationale}`; `claim_number`;
  `date_of_loss`. All fields required; absent values come back `0`/`""`.
- **Work-type-aware prompt** (derived from the job's division via `divisionToQbo` →
  `mitigation`|`reconstruction`):
  - *Mitigation* (water/fire/mold cleanup): expect **no depreciation/deductible**; bill the **full
    RCV = the total**; be decisive (high confidence); don't treat missing ACV/deductible as a problem.
  - *Reconstruction*: depreciation/ACV/deductible may appear, **and** detect **"Paid When Incurred"
    (PWI)** line items (carriers hold back continuous flooring etc. until completed/photographed) →
    sum into `paid_when_incurred`. **Billable stays the full RCV** — PWI is surfaced, **not
    subtracted**.
  - The prompt carries a **`## Worked examples`** section (one reconstruction + one mitigation
    example). **This is the training surface** — see §6 "Improving it" below.
- **Deterministic reconciliation** (math can't hallucinate): checks `RCV ≈ line_item_total + overhead
  + profit + sales_tax`, `ACV ≈ RCV − depreciation`, `net_claim ≈ RCV − depreciation − deductible`,
  within $1 / 1%. **Reconciles against RCV, never ACV** (Xactimate omits the ACV line when there's no
  depreciation). Absent figures never fail a check; if it doesn't tie out, a `high` confidence is
  downgraded to `medium` and the banner shows a ⚠ warning.
- **Item/Class autofill:** the inserted summary line gets `qbo_item_id`/`name` + `qbo_class_id`/`name`
  from the same `divisionToQbo`/`findClassId` the sync uses (best-effort — never fails the import).
- **Persistence:** writes the full recap to **`invoices.xactimate_meta`** (best-effort). The editor
  re-shows the banner from there on every load, so it survives refresh and stays visible after QBO
  save (only the "review before Save" line is gated to drafts).
- Logs `worker_runs` as `analyze-xactimate`. Returns `{ok, billable, totals, paid_when_incurred,
  work_type, checks, reconciles, claim_number, date_of_loss, line_count, imported_at}`.

### The frontend (InvoiceEditor)
`importXactimate(file)`: uploads the PDF to `job-files/{job_id}/xactimate/{ts}-{name}.pdf` (dedup by
filename + `xactimate` category, reusing an existing copy) → `insert_job_document` (audit) →
`POST /api/analyze-xactimate {invoice_id, file_path}`. While it runs, a **progress modal** shows a
spinner + a simulated bar + a rotating status line (`XACT_STAGES`). On return, the **recap banner**
shows billable amount · basis · confidence · rationale · totals breakdown · the ⏳ PWI note.

### Ops to go live
- `ANTHROPIC_API_KEY` in Cloudflare Pages env (**Preview + Production**) — env vars only take effect on
  a **fresh deploy**. Until present, the worker returns 503.
- The `feature:ai_xactimate` flag (DevTools → Feature Flags; flags self-register from
  `src/lib/featureFlags.js`).

### "Training" it / getting consistent behavior
No fine-tuning, and the API is **stateless** — the Anthropic Console (Workbench/Evals) is only for
*prototyping* prompt wording; it does **not** push to UPR. The durable behavior is: **strict schema +
the `## Worked examples` block + the pinned model + the deterministic cross-check + human review.** To
teach it a new rule, add guidance / a worked example / a check in `analyze-xactimate.js` and ship.

---

## 7. Conventions, guardrails & gotchas
- **Human-in-the-loop for money** — the Save→QBO gate is sacred; AI fills drafts only.
- **Computed columns:** never write `invoice_line_items.line_total` (GENERATED) or
  `invoices.amount_paid` (trigger from `payments`).
- **QBO needs the customer first** — `qbo-invoice` errors without `contact.qbo_customer_id`
  (`qbo-sync-customer` populates it).
- **`adjusted_total ?? total`** is the billable amount everywhere (no-lines fallback, AR balance).
- **Shared Supabase** — DB/flag changes affect `dev` and `main` together.
- **Release flow** — feature branch → `dev` (staging) → reviewed **`dev → main` PR** (merge commit,
  then fast-forward `dev` to `main`). Never push to `main` directly. Cloudflare Pages build is the
  gating check.
- **Coordination** — `InvoiceEditor.jsx`, `NewInvoiceModal.jsx`, the billing schema, `CLAUDE.md`, and
  `UPR-Web-Context.md` are touched by multiple chats. `git fetch origin dev` + rebase before pushing.
- **DocNumber** uses `job_number` and only prints if "Custom transaction numbers" is ON in QBO.
- **Reconciliation flags, never blocks** — a non-reconciling estimate still imports; it's just marked.

---

## 8. Extending this cleanly
- **Itemized / per-category invoice lines** (instead of one summary line) — the schema already
  supports it: each `invoice_line_items` row carries its own Item/Class + `xactimate_code`, and
  `qbo-invoice` already maps per-line. The Xactimate worker would insert multiple lines instead of one.
- **New division → QBO mapping** — add a branch to `divisionToQbo` (one place; powers both sync and AI
  autofill).
- **New AI document types** (e.g. a different estimate format, scope sheets) — clone the
  `analyze-xactimate` pattern: strict tool + worked examples + deterministic checks + draft-only +
  human review.
- **Auto-filling tax / deductible / depreciation** columns from the extraction — the `invoices` table
  already has the fields; do it as adjustments, carefully, to avoid double-counting against the line
  total.
- **Prompt caching** — when the worked-examples set grows past the model's cache minimum, move the
  stable prompt+examples into a `cache_control` prefix to keep cost/latency flat.
- **Do not touch** without good reason: the GENERATED/trigger columns, the `integration_credentials`
  token store + refresh logic, and the Save→QBO human gate.

---

*Source files: `functions/lib/{quickbooks,qbo-payment-sync}.js`; `functions/api/qbo-{invoice,payment,
query,estimate,sync-customer,webhook,payments-sync}.js`, `analyze-xactimate.js`, `stripe-pay-link.js`;
`src/pages/{InvoiceEditor,Collections}.jsx`; `src/components/NewInvoiceModal.jsx`,
`src/components/collections/{collKit.jsx,collTokens.js,SearchSelect.jsx,ActionMenu.jsx}`,
`src/components/{DatePicker,AutoGrowTextarea}.jsx`; `src/App.jsx`; RPCs `create_invoice_for_job`,
`get_ar_invoices`, `convert_estimate_to_invoice`.*
