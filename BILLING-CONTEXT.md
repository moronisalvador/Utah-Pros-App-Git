# UPR Billing, QuickBooks & Xactimate AI — Engineering Context

**Last updated:** August 3, 2026
**Scope:** Everything behind the invoice builder, the two-way QuickBooks Online (QBO) sync,
payments, Stripe pay links, and the Xactimate AI import. Read this before building on the billing
stack so you extend it cleanly instead of re-deriving (or accidentally redesigning) it.

> This is a deep-dive companion to `UPR-Web-Context.md` (the master context doc). When you change
> anything described here, update this file too.

---

## 0. The one rule: money is human-in-the-loop

No browser automation posts a financial transaction to QuickBooks. The Xactimate AI and invoice
builder only produce or edit a **DRAFT**; a person reviews it and clicks **Save invoice**. The
separate multi-invoice receipt path is also human-initiated: an active admin reviews the exact
payment and confirms it twice before `POST /api/qbo-receive-payment`. Keep both gates. Smart
features (AI extraction, reconciliation, Item/Class autofill) remain pre-fill/check/recovery paths,
never unprompted financial posting.

### Test-customer allowlist (owner-directed 2026-08-05) — the ONLY exception

An agent may drive both gates end to end against these QuickBooks customers, so the money paths can
be verified without waiting for a real payment. Mirrored as law in `AGENTS.md` §15.

| QBO `CustomerRef` | Display name (informational only) |
|---|---|
| `548` | Moroni |
| `565` | Moroni Salvador (5700) |

Binding conditions — **all** must hold, or the human gate applies:

- **Match on the numeric customer ID, never the display name.** A real customer can be named
  "Test" or share a staff name; `UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md` §5 records exactly that
  trap (a real job wearing smoke-test placeholders). The ID is the identity.
- **Under $10 per transaction.** Anything larger is a real transaction by definition.
- **The agent deletes every record it created before the session ends** — payment first, then
  invoices (QuickBooks refuses to delete an invoice with a payment applied; guide §8).
- **No linkage to a real claim or job.** If a would-be test invoice attaches to a live claim/job,
  stop — it is not a test.
- **Attended runs only.** This authorizes agent-run verification with the owner present. It never
  authorizes an unattended, scheduled, or background path to either endpoint.

Extending this table requires a fresh owner instruction in conversation, one row at a time, naming
the exact customer ID. Every customer not listed here keeps the human gate at every amount.

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
  legacy /api/qbo-payment OR admin /api/qbo-receive-payment                 customer pays online
                  │  (one QBO Payment; receipt path can link 1–100 invoices)          │
                  └────────────────────────────────────────────────────────────────┘
                                                       ▼
                              /api/qbo-webhook (real-time)  +  /api/qbo-payments-sync (hourly)
                                                       ▼
                    reconcile receipt + payments projections  ──trigger──▶ invoice.amount_paid
```

**Historical pre-D1 behavior:** the Xactimate AI import was an optional front door that uploaded a
PDF on a draft invoice and pre-filled a summary line. D1 source-disables that operation; no upload,
AI request, QBO lookup, or financial-line write is reachable. Existing recap evidence is read-only.

Estimates are a parallel track that **converts into** invoices (`convert_estimate_to_invoice`); the
editor (`EstimateEditor.jsx`) mirrors the invoice builder.

The OOP calculator is an additional draft front door: a billing editor can explicitly turn a saved,
job-linked, canonical OOP quote into one itemized draft estimate, then review it in the existing
Estimate editor. The conversion itself performs no provider call. In D1 the estimate stays local;
QuickBooks save/update/send/delete returns only with D2's durable command ownership.

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
- **QBO:** `qbo_invoice_id`, `qbo_doc_number`, `qbo_synced_at`, `qbo_sync_error`, `qbo_emailed_at`
  (UPR-triggered send only), `qbo_email_status` (QuickBooks' own EmailStatus as last observed),
  `qbo_bill_email` + `qbo_email_checked_at` (the applied
  `20260808034430_invoice_qbo_email_mirror` successor; the older `20260807190000` note is superseded).
- **Stripe:** `stripe_payment_link_url`, `stripe_checkout_session_id`, `stripe_payment_link_created_at`.
- **AI:** **`xactimate_meta` JSONB** — the persisted Xactimate recap (see §6).
- `pdf_url`, `notes`, `internal_notes`, `created_by`, `created_at`, `updated_at`.

### `invoice_line_items`
`id`, `invoice_id`, `description`, `category`, `xactimate_code`, `room`, `quantity`, `unit`,
`unit_price`, **`line_total` (GENERATED — never write)**, `original_quantity`, `original_unit_price`,
`original_line_total`, `was_adjusted`, `was_denied`, `adjustment_note`, `sort_order`, `created_at`,
`qbo_item_id`, `qbo_item_name`, `qbo_class_id`, `qbo_class_name`.

> **No `updated_at` on this table** — only `created_at`. Writing `updated_at` errors with `42703`.
> Editing `quantity`/`unit_price` fires the header trigger that recomputes the parent invoice's
> `subtotal`/`total`/`balance_due`, so never write those by hand either.

### `payments`
`id`, `invoice_id`, `job_id`, `contact_id`, `amount`, `payment_date`, `payer_type`
(`insurance`|`homeowner`|`other`), `payment_method` (`check`|`eft`/`ach`|`credit_card`|`cash`|`other`),
`reference_number`, `qbo_payment_id`, **`source`** (`manual`|`qbo`|`stripe`), `refunded_amount`,
`recorded_by`, and authored `receipt_id`. Inserting/deleting a payment triggers recomputation of
`invoices.amount_paid`/`status`.

### Grouped QBO receipt schema (live; rollout enabled)

- `payment_receipts` — one grouped header per `(qbo_realm_id, qbo_payment_id)`, including totals,
  method/reference/deposit account, source/actor, provider version, status, and normalized snapshot.
- `payment_receipt_attempts` — durable pre-provider client/Intuit request identity, fingerprint,
  request, provider snapshot, outcome, recovery state, and a realm-scoped unique QBO Payment fence.
- `payment_receipt_events` — append-only lifecycle/audit evidence, including terminal tombstones.
- `payments.receipt_id` — 1–100 active per-invoice allocation projections for a grouped receipt.

The foundation and grant containment are live under production ledgers `20260731225654` and
`20260731230907`. The tables are forced-RLS with no `anon` or `authenticated` access; lifecycle
writes remain behind service-only RPCs. The null-context-safe role-check repair is applied under
production ledger `20260806034004_qbo_receipt_service_role_check_repair`. Both rollout switches
are live (`feature:qbo_receive_payment` enabled/not force-disabled and
`QBO_RECEIVE_PAYMENT_ENABLED=true` in both Cloudflare variable sets), and the first successful
production receipt ran on 2026-08-06. Browser and Worker authorization is active non-external
`admin`, `office`, or `project_manager`; neither rollout switch grants authority.

**Historical incident, superseded:** the original routines read the retired flattened
`request.jwt.claim.role` GUC, so a 2026-08-05 live attempt failed with 42501 and produced no receipt.
The proof now uses the real `request.jwt.claims` shape and the applied repair uses `auth.role()`.
`current_user` remains unsafe inside `SECURITY DEFINER` because it resolves to the function owner.

### Key RPCs
- `create_invoice_for_job(p_job_id, p_created_by DEFAULT NULL)` → invoice row. **Idempotent** —
  returns the existing invoice if the job already has one.
- `get_ar_invoices()` → AR list with computed `balance = (adjusted_total ?? total) − amount_paid`,
  ordered by balance desc. Used by Collections.
- `convert_estimate_to_invoice(p_estimate_id, p_force DEFAULT false, p_created_by DEFAULT NULL)` →
  jsonb. Copies estimate lines → invoice lines; auto-creates claim+job if the estimate has none;
  returns `{needs_confirm:true}` if the target invoice already has lines and `p_force` is false.
- `get_customer_detail(p_contact_id)`, `search_contacts_for_job(p_query)` — power NewInvoiceModal.
- `insert_job_document(...)` — historically retained a source Xactimate PDF; the D1 invoice UI and
  source-disabled Worker do not call it.

---

## 3. The invoice builder page — `src/pages/InvoiceEditor.jsx`

**Route:** `/invoices/:invoiceId` (in `src/App.jsx`), inside the `Layout` shell, gated by the
`page:collections` feature route. **Reached from** the Collections "Invoices" tab (row click) or from
`NewInvoiceModal` (`create_invoice_for_job` → `navigate('/invoices/:id')`).

### load()
Fetches `invoices` (all columns), then `jobs` (division, job_number, claim_id, primary_contact_id,
address…), `claims` (claim_number, insurance_carrier, date_of_loss, loss address…), `contacts`
(name, email), `invoice_line_items` (ordered by `sort_order`, `created_at`), and `payments`. It also:
- **re-hydrates the Xactimate recap banner** from `inv.xactimate_meta` **once per mount** (guarded by
  `xactHydratedRef`, so a manual ✕ dismiss isn't undone by later reloads from line edits).
- loads the QBO **Item/Class catalog** via `POST /api/qbo-query` into `qboItems` / `qboClasses`.

### Layout (render order)
- **Toolbar:** `Save invoice` · `Receive payment` · historically `Create/Copy pay link` ·
  `Preview` · `Manage ▾` (ActionMenu: *Revert to draft* when synced, *Delete draft* when not synced &
  uncollected). D1 removes the pay-link action and displays any stored URL only as inactive evidence.
  A ✓ "synced" stamp shows when `qbo_synced_at` is set.
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
- **Modals:** customer **Preview/Print** (formal layout, print CSS) and the legacy **payment modal**
  (view → Edit → form; Stripe, grouped receipt, and QBO-originated rows are view-only). D1 contains
  deletion of those externally managed rows; local manual payments may still be edited or deleted.

### State & derived
Core: `inv`, `job`, `claim`, `contact`, `lines`, `payments`, `qboItems`, `qboClasses`. UI: `busy`,
`payForm`/`payView`/`delPayArmed` (payment modal), `showPreview`, `xactInfo`, `dragIdx`. Derived:
**`synced = !!inv.qbo_invoice_id`**, **`canEdit = canEditBilling(role)`**
(`admin|office|project_manager` — from `claimUtils`), `payMode` (`view`|`edit`|`new`), `subtotal`/`liveTotal`,
`invoiced = adjusted_total ?? total`, `balance`, `docNumber`, `stKind = invoiceStatusKind(...)`.

### Line edits "save as you type"
`setLineLocal(id, patch)` updates local state optimistically (recomputes qty×unit_price for display);
`saveLine(line)` PATCHes `invoice_line_items` on blur / select (no reload). `addLine`/`removeLine`
write then `load()`; drag reorder rewrites `sort_order`. **Never write `line_total`.**

### Save → QBO, send, payments
- **Save:** `flushAndPush()` writes any pending line edits, then `callWorker({})` → `POST
  /api/qbo-invoice {invoice_id}`. **Send:** `{action:'send', send_to}`. **Revert to draft:**
  `{action:'delete'}` (removes from QBO, keeps the UPR draft).
- **Payments:** record/edit behavior follows the existing invoice/receipt contracts. D1 source-disables
  provider-linked payment deletion before a QBO or local projection write; Stripe-sourced,
  grouped-receipt, and QBO-originated rows are view-only, while local manual rows retain local
  edit/delete. When the current employee is an active billing editor, the invoice/contact are
  QBO-linked, and `feature:qbo_receive_payment` is enabled, **Receive payment** instead opens
  `/collections/receive-payment?contact=…&invoice=…`. Grouped/QBO-originated rows are view-only in
  the legacy modal and are corrected in QBO as a whole receipt.

### Gating & feature flags
- Page lives behind **`feature:billing`**.
- `canEdit` (billing role) controls all mutating UI; `synced` controls Send/Revert.
- When **`feature:ai_xactimate`** is enabled, the editor shows maintenance copy: import is source-disabled
  until D2 supplies durable operation ownership. Historical `xactimate_meta` recaps remain read-only.
- **`feature:qbo_receive_payment`** independently gates the grouped route/button and is live enabled
  in the shared production database. The retired `VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED` build gate is
  no longer a caller contract: billing roles see the same database-gated UI on both origins. The
  Worker/reconciliation path separately requires **`QBO_RECEIVE_PAYMENT_ENABLED=true`**, which is
  behaviorally proven open in both Cloudflare variable sets. These switches control rollout, not
  authorization; the Worker still repeats the billing-role predicate server-side.

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
| `remodel` | `1010000201` | Reconstruction/ Remodeling Services | `Reconstruction` |
| `mold` | `1010000131` | Mold Remediation Services | `Mitigation` |
| `content` | `38` | Contents | `null` |
| `mit` / `water` / `dry` | `1010000071` | Water Damage Mitigation And Drying | `Mitigation` |
| *(anything else)* | — | — | returns `null` |

`findClassId(env, name)` resolves a class **name → QBO class id** at runtime (so ids aren't
hardcoded). `QBO_INSURANCE_ADJUSTMENT_ITEM_ID = '1010000231'`. This same mapping drives both the
invoice-sync line building and historically drove Xactimate Item/Class autofill. The D1 Xactimate
boundary does not reach it.

### Workers (`functions/api/`)
Worker identities vary by route. Server-capability and Bearer-only boundaries are defined in
“QBO Worker identity boundary (S1a/S1b, 2026-07-26)” below; UI callers obtain their Bearer through
the established authenticated request helpers.

- **`qbo-invoice.js`** — `POST {invoice_id, action?: 'send'|'delete', send_to?}`.
  - Loads invoice + job + contact + claim. If the contact is not linked, the human save path runs
    the authorized customer sync using the frozen realm, then re-reads the link. A mappable
    `job.division` is still required.
  - Builds lines from `invoice_line_items`: `ItemRef = li.qbo_item_id || map.itemId`,
    `ClassRef = li.qbo_class_id || divClassId`, plus Qty/UnitPrice. **No-lines fallback:** one summary
    line at `adjusted_total ?? total`. Throws if the total ≤ 0.
  - Sets `DocNumber` to a **unique-per-invoice** number: it reuses the one QBO already assigned, else
    `job_number` for the first invoice on the job and `job_number-N` for the Nth — so a job's 2nd+
    invoice (a supplement) doesn't collide ("Duplicate Document Number"). Needs "Custom transaction
    numbers" ON in QBO, else ignored. Also a PrivateNote memo (date-of-loss / job / claim / address),
    `ShipAddr`, and a `LinkedTxn` to the QBO estimate when converted. On a residual duplicate-number
    fault (code 6140) it retries once without the forced number, so Save never hard-fails.
  - **Writeback:** `qbo_invoice_id`, `qbo_doc_number`, `qbo_synced_at`, `qbo_sync_error=null`; first
    create also sets `sent_at` + `due_date` (+30 days). `action:'send'` → QBO emails the customer and
    sets `qbo_emailed_at`/`qbo_email_status`; `action:'delete'` removes the QBO invoice.
    Every non-delete response is a full Invoice entity, so it also mirrors QuickBooks' own
    `EmailStatus`/`BillEmail` through `functions/lib/qbo-invoice-email-mirror.js` — observation
    columns only, never `qbo_emailed_at` (a trigger derives invoice status and CRM lead value
    from it). Same mirror runs in `qbo-payment-sync.js` and `qbo-invoice-drift.js`; the drift
    sweep is the only one that reaches an invoice born in QuickBooks.
- **`qbo-payment.js` historical mutation behavior** — `POST {payment_id}` mirrored a UPR payment → QBO (requires the invoice already
  synced + customer in QBO; idempotent on `qbo_payment_id`). `{action:'delete'}` (by `payment_id` or
  `qbo_payment_id`) removes a legacy one-invoice QBO payment. It refuses receipt-linked, shared,
  QBO-originated, and Stripe rows because a one-row correction could change several invoices. In D1,
  legacy deletion is source-contained; D2 requires durable operation ownership before it can return.
- **`qbo-receive-payment.js`** (live on both origins since 2026-08-06) — active non-external billing-editor
  (`admin|office|project_manager`) GET/POST boundary for
  one human-confirmed Payment allocated across 1–100 same-customer QBO invoices. It reserves a
  durable attempt before QBO, derives a stable realm-scoped Intuit `requestid`, creates one Payment
  with multiple Invoice `LinkedTxn` lines, verifies every reviewed accounting field and invoice
  balance delta, then finalizes receipt/projection state. Timeout/transport ambiguity is
  `unknown_outcome`; an unchanged retry resolves the original request instead of creating a new one.
- **`qbo-query.js`** — `POST {query}`, **SELECT-only** passthrough; the frontend uses it to load the
  Item/Class catalog.
- **`qbo-sync-customer.js`** — contact → QBO Customer (per-contact via `{contact_id}`, or `{backfill}`).
  Links only by exact email or family name + exact normalized phone; DisplayName alone is never
  identity proof. Duplicate-name creation (code 6240) is disambiguated with the phone's last 4.
  Writes `contacts.qbo_customer_id`.
  - **Historical on-demand creation (Phase A, superseded during D1):** `qbo-estimate.js` called
    `ensureQboCustomer(request, env, contactId)` (in `functions/lib/quickbooks.js`) when a billable
    contact has no `qbo_customer_id` yet — it POSTs to this worker (shared webhook secret), then
    re-reads the id and throws the usual "sync the client first" error only if it is still missing.
    Current D1 instead lets the human-only `qbo-invoice.js` path invoke the customer sync without
    substituting the server capability for its signed-in actor. Settings preview/backfill remains
    an explicit manual path.
  - **Phase B (SHIPPED — `20260701_crm_qbo_phase_b_gate_contact_trigger.sql`):** `trg_qbo_customer_sync`
    is now a **no-op** — `notify_qbo_customer_sync()` was replaced with a `RETURN NEW` body (the
    trigger is kept attached, not dropped, so restoring the prior body re-enables auto-sync; the
    original body is preserved in the migration's comment). Contacts are **no longer** auto-synced to
    QBO on insert. Historically, estimate push could self-heal a missing link; D1 source-disables
    estimate push, while human invoice save can establish a safely matched link.
    Applied to the shared DB **after** Phase A reached production `main` (verified live: a qualifying
    `homeowner`+named contact insert no longer syncs — `qbo_customer_id` stays null, no
    `qbo_sync_error`). The `qbo-sync-customer` worker + its `{backfill}` mode remain for explicit/
    manual syncs.
    - **Historical estimate behavior:** the trigger never fired and estimate self-heal synced at
      transaction time regardless of when the name was set. D1 does not run that provider path;
      D2 restores it behind the durable ledger. Human invoice save owns its authorized sync.
- **`qbo-estimate.js`** — historically pushed/sent/deleted estimates. D1 now returns stable
  `qbo_estimate_durable_boundary_required` after authorization and cheap validation, with no
  configuration, business-record, or provider work; D2 restores this behind its durable ledger.

### QBO Worker identity boundary (S1a/S1b, 2026-07-26)

- Browser calls use the route-specific `QBO_BROWSER_ROLES` boundary (active, non-external
  `admin`, `office`, or `project_manager`) unless the narrower endpoint contract below applies.
  Invoice remains a human Bearer-only path; operational capability routes remain separately named.
- `qbo-receive-payment` uses only that human Bearer boundary; it never accepts
  `QBO_WEBHOOK_SECRET`, and it checks its Worker kill switch before connection/data/provider work.
- The exact `QBO_WEBHOOK_SECRET` capability remains secret-first only on the existing background-safe
  server paths: estimate/payment/query, customer sync and HTTP payment sync. The human-only invoice
  endpoint explicitly rejects it. The payment poller's direct `scheduled()` entry remains separate.
  OAuth connect never accepts that capability.
- QBO card charge and attachment mutation retain their existing Bearer-only
  `requireRole(['admin','manager'])` contract and explicitly reject external employees before
  business data, telemetry or provider calls. `manager` is not a current role; adding
  `project_manager` remains an owner decision.
- Approved-caller downstream bodies/statuses, OAuth callback redirects, scheduler behavior and
  provider helpers are preserved; the new 403 results are the deliberate authorization
  transition. Negative/failure-path tests assert denied requests reach at most Auth plus the
  employee lookup.
- Customer-sync and manual payment-sync resolve the human caller for authorization but do not
  persist that actor in current `worker_runs` telemetry. A durable actor field/write requires a
  separate schema/telemetry decision.
- This is Worker containment only. Direct `qbo_attachments` metadata SELECT remains role-scoped
  without an explicit `is_external=false` predicate and requires a separate reviewed migration.
  Binding equality, deployed hashes and representative live identities remain release gates.

### Durable invoice command recovery (database applied 2026-07-31)

The owner-authorized database apply used reviewed source commit `3f61e7fa`: production ledger rows
`20260731205928_qbo_estimate_conversion_concurrency` and
`20260731205942_qbo_invoice_command_ledger` record the estimate/conversion concurrency and invoice
command-ledger migrations. `qbo_invoice_commands` is forced-RLS and service-only: browser callers
never read or write its durable command state. A browser operation holds a stable UUIDv4
idempotency key while its result is ambiguous; the Worker freezes the command and deterministic
Intuit request id before the provider call, then recovers safely whether a retry arrives before or
after the local compare-and-swap writeback. This is not a second QBO side effect.

Estimate conversion/QBO decision application is row-locked. A populated target invoice stays a
manual boundary, and a combined QBO invoice/estimate match is intentionally non-unique: no helper
may allocate it to a UPR invoice arbitrarily. Service-only recovery records unresolved cases for
reconciliation. The invoice-link/send metadata CAS and lifecycle trigger own their respective
state; Workers do not write trigger-owned billing columns.

The human **Save → QBO** action remains the only user-authorized provider write; recovery never
auto-posts a draft. Every invoice save/send/delete request requires an active, non-external
`admin|office|project_manager` Bearer session; the shared QBO server secret is explicitly rejected
on this human-only endpoint.
GitHub CI's schema `verify` and governed `db-lane` jobs are green, and the compatible Worker/client
source ships in the same `dev` release as this documentation. Do not claim Cloudflare deployment,
authenticated-browser, or Intuit provider proof until those separate gates have evidence.

### Payments flowing back from QBO (and Stripe)
- **`qbo-webhook.js`** — Intuit-signed webhook (Payment + Estimate entities). Idempotent via the
  `claim_qbo_event` RPC; always returns 200 (per-event errors logged to `qbo_events`).
- **`qbo-payments-sync.js`** — hourly safety-net poll (7-day lookback) for anything the webhook missed
  (payments AND estimate answers; the estimate sweep is failure-isolated from payment reconciliation).
- Both call **`functions/lib/qbo-payment-sync.js`** → `syncQboPaymentToUpr` (fetch QBO payment, dedup
  on `qbo_payment_id`, insert into `payments` with `source='qbo'`, and **adopt** QBO-auto-created
  invoices when a customer pays an estimate deposit online — via `convert_estimate_to_invoice`) /
  `removeQboPaymentFromUpr`. That legacy behavior remains while the receipt Worker flag is off.
  With receipt mode on, the same feeds replace a complete grouped projection transactionally,
  preserve a UPR-origin receipt's actor/payer classification, ignore older provider versions,
  queue transient failures, and retain terminal audit while Void/Delete removes all active
  allocations. The `amount_paid` trigger does the rest in either mode.

### Estimate answers flowing back from QBO (2026-07-31)
- Both paths also call **`functions/lib/qbo-estimate-sync.js`** → `syncQboEstimateToUpr`: a customer
  **accepting** an estimate online marks the UPR estimate `approved` (stamping
  `approved_at`/`approved_amount` from QBO's `AcceptedDate`/`TotalAmt`) and runs the same
  `convert_estimate_to_invoice` RPC the staff button uses → a draft UPR invoice, ready for human
  review. The status flip fires the pre-existing `trg_estimate_accepted_notify` DB trigger → the
  `estimate.accepted` admin notification. A customer **declining** marks it `denied`
  ("Declined by customer in QuickBooks"). A QBO-side **conversion** is adopted via
  `adoptInvoiceFromQboEstimate` (same helper the deposit path uses).
- Guards: only pre-decision estimates (`draft`/`submitted`/`under_review`/`revised`) are
  auto-advanced — a UPR decision (approved/denied/paid) is never overwritten (incl. by a QBO-side
  conversion); UPR's own conversion echoes back from QBO as `Converted` with `converted_invoice_id`
  already set → no-op; if the target invoice already has line items the sync approves WITHOUT
  appending (double-billing guard, `needs_confirm`) and leaves conversion to a human.
- Concurrency hardening is live: `convert_estimate_to_invoice` row-locks the estimate before making
  the conversion decision, and the QBO decision application holds the same lock while adopting or
  reconciling a provider-side invoice. The earlier webhook-vs-hourly-sweep double-append residual is
  superseded by `20260731180000_qbo_estimate_conversion_concurrency.sql`.
- **The human Save-to-QuickBooks gate is untouched** — nothing here calls `/api/qbo-invoice`; the
  converted UPR invoice waits for a human to push/send it.
- **Intuit dashboard gate:** the webhook subscription must include the **Estimate** entity (it was
  Payment-only). Until the owner adds it, the hourly sweep still mirrors answers within the hour.

### Logging
Workers log to **`worker_runs`** (`worker_name`, status, counts, error — attachments as
`qbo-attach`, direct receipts as `qbo-receive-payment`). Webhook delivery/retry state logs to
**`qbo_events`**; grouped receipt lifecycle evidence lives separately in
**`payment_receipt_events`**.

### Attachments on invoices & estimates (2026-07-24)
**Applied schema; historical mutation behavior is source-contained in D1:**
`20260724180000_qbo_attachments` is applied/live. Attachment upload and delete are disabled before
business-record, credential, provider, or telemetry work. `qbo_attachments` remains metadata-only
read evidence; `QboAttachments` exposes neither upload nor removal controls in D1. The direct
metadata SELECT residual (no explicit `is_external=false` predicate) is still a separate database
issue; containment does not claim that it is closed. D2 needs durable operation ownership before
the prior QBO Attachable workflow may return.

### Payment two-way sync activation (2026-07-24)
The QBO→UPR payment path is built; the hourly safety-net poller is now wired via pg_cron
(`20260724180100_qbo_payments_sync_cron.sql`, live ledger `20260724190848`) →
`/api/qbo-payments-sync` using `integration_config.qbo_webhook_secret`. The real-time webhook is
live (`QBO_WEBHOOK_VERIFIER_TOKEN` set; Payment events verified processing in `qbo_events`).
The Intuit Production subscription at `https://utahpros.app/api/qbo-webhook` now retains
**Payment** and **PaymentMethod** and includes **Estimate** with every operation Intuit offered.
Per-transaction method still comes from the Payment payload's `PaymentMethodRef`; PaymentMethod
events report catalog-definition changes. Dedup on `qbo_payment_id` keeps the webhook and poller
from double-counting. The live receipt mode adds realm/payment and event-key dedup plus durable CDC
retry state; its foundation, role repair, and both rollout gates are recorded above as applied/live.

---

## 5. Stripe pay links & fee automation (historical; source-contained in D1)

Historically, `POST /api/stripe-pay-link {invoice_id}` created a hosted pay link. D1 now returns
stable `stripe_projection_durable_boundary_required` after authorization and cheap validation,
before invoice/provider work. The signed webhook uses the same stable refusal before claim or local
projection, and qbo-charge uses its separate durable-boundary refusal. Stored checkout URLs are
non-clickable evidence. `functions/lib/quickbooks.js` also has dormant clearing-account helpers (`createPurchase` for the
processor fee, `createTransfer` for the net payout) for automated QBO fee reconciliation. Stripe
payments historically landed in UPR through the QBO payment sync (`source='stripe'`). D1 prevents
new pay-link/webhook projections, so this statement describes existing records and the future
durable restoration only; existing Stripe rows remain view-only in the UI.

**Historical server boundary refresh (2026-07-23; superseded by D1 containment):** both
`/api/stripe-pay-link` and `/api/qbo-charge`
resolve an active employee and require the same `admin`/`manager` billing-role predicate as the UI
before configuration, invoice, credential, or provider access. The charge endpoint no longer
accepts the generic QBO webhook secret as an alternate money-moving identity and now explicitly
rejects external employees before privileged work. It requires a stable
client `Idempotency-Key`, passes it to Intuit as the request ID, rejects fractional-cent or
over-balance charges, records the actor employee, and uses the Mountain-Time business date for both
UPR and QBO.

This is authorization/request-id containment, not full charge reconciliation. A durable
pre-provider charge-attempt row, captured-but-unrecorded recovery, and Intuit sandbox failure
injection remain required before COR-002 can close. Stripe's existing content-derived provider key
reduces concurrent duplicate creation, but stored-session reuse/expiration and sandbox concurrency
proof remain COR-003.

---

## 6. Xactimate AI import — `functions/api/analyze-xactimate.js` (+ InvoiceEditor)

**D1 current state (local source only, not a live claim):** the prior PDF/Anthropic import is
source-disabled. After the normal browser authorization and cheap request validation,
`POST /api/analyze-xactimate` returns the stable
`xactimate_import_durable_boundary_required` 503. It performs no document lookup or Storage read,
no Anthropic request, no QBO lookup, no financial-line mutation, and no worker-run write. The
InvoiceEditor exposes no import control or file picker; it shows maintenance copy instead.
Previously persisted `invoices.xactimate_meta` remains a read-only recap so old evidence is not
hidden. D2 must introduce a durable request/operation owner before the historical import path can
be restored. Do not configure or infer an Anthropic rollout from D1.

---

## 7. Conventions, guardrails & gotchas
- **Human-in-the-loop for money** — the Save→QBO gate is sacred; AI fills drafts only.
- **Computed columns:** never write `invoice_line_items.line_total` (GENERATED) or
  `invoices.amount_paid` (trigger from `payments`).
- **QBO needs the customer first** — the human `qbo-invoice` save self-heals a missing customer link
  through the safe customer-sync helper, then refuses if no proven link exists.
- **`adjusted_total ?? total`** is the billable amount everywhere (no-lines fallback, AR balance).
- **Shared Supabase** — DB/flag changes affect `dev` and `main` together.
- **Release flow** — routine work commits to `dev` and its Cloudflare **Preview** deployment;
  Production uses a reviewed **`dev → main` PR**. Never push `main` directly. The isolated
  `qa-staging` Supabase branch is the only environment called staging.
- **Coordination** — `InvoiceEditor.jsx`, `NewInvoiceModal.jsx`, the billing schema, `CLAUDE.md`, and
  `UPR-Web-Context.md` are shared hotspots. Fetch first, preserve other work, and reconcile from a
  clean worktree without rewriting published history.
- **DocNumber** is unique per invoice — the number QBO already assigned, else `job_number` (first
  invoice on the job) or `job_number-N` (the Nth, e.g. a supplement). A job **can** have more than one
  invoice (you can't add lines to an already-paid invoice, so supplements get their own). Only prints
  if "Custom transaction numbers" is ON in QBO.
- **Historical Xactimate reconciliation:** before D1 a non-reconciling estimate could still import
  with a marker. D1 source-disables Xactimate import, so no estimate is imported by that path.

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
  token store + refresh logic, the Save→QBO invoice gate, and the two-click billing-editor receipt gate.

---

*Source files: `functions/lib/{quickbooks,qbo-payment-sync,qbo-receipt}.js`;
`functions/api/qbo-{invoice,payment,receive-payment,query,estimate,sync-customer,webhook,
payments-sync}.js`, `analyze-xactimate.js`, `stripe-pay-link.js`;
`src/pages/{InvoiceEditor,Collections,ReceivePayment}.jsx`; `src/components/NewInvoiceModal.jsx`,
`src/components/collections/{collKit.jsx,collTokens.js,SearchSelect.jsx,ActionMenu.jsx,
ReceivePaymentForm.jsx,paymentAllocation.js}`, `src/components/{DatePicker,AutoGrowTextarea}.jsx`;
`src/App.jsx`; RPCs `create_invoice_for_job`, `get_ar_invoices`, `convert_estimate_to_invoice`, the
six `*_qbo_payment_receipt` functions, and the worker-only QBO-event claim function.*

---

## P4c deployment boundary (2026-08-12)

D1 is a local-only, schema-free maintenance/containment release. It adds a fail-closed
`qbo_provider_traffic_enabled` check while retaining the current invoice Save-to-QBO and legacy
receipt database contracts when exact `'true'` is configured. Estimate QuickBooks mutations are
temporarily source-disabled until D2's durable command ledger is deployed; local estimate editing
remains available while every estimate screen presents explicit maintenance copy instead of a dead
provider control. Attachment metadata is read-only, stored Stripe checkout URLs are not clickable,
and the unsafe legacy card, attachment, payment-delete, and Stripe projection writers remain
contained. Payment and Estimate webhook work interrupted by maintenance/connection races is retained
with exact realm/entity identity in `qbo_events` and recovered by the scheduled realm-pinned drain,
including legacy payment mode. D1 neither
creates new QBO document commands nor changes trigger-owned money fields. No D1 configuration,
deployment, provider request, or money action has occurred.

The later D2 release owns `feature:qbo_document_command_v2`, restored durable line/estimate commands,
allocation fences, and company binding. Its six migrations are still unapplied; do not treat D1 as
evidence that any D2 RPC/table exists.
