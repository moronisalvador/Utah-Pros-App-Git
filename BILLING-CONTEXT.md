# UPR Billing, QuickBooks & Xactimate AI — Engineering Context

**Last updated:** August 10, 2026
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

The **Xactimate AI import** is an optional front door: upload a PDF on a draft invoice, the AI reads
it and pre-fills the single summary line + a recap banner. It does **not** touch QBO.

Estimates are a parallel track that **converts into** invoices (`convert_estimate_to_invoice`); the
editor (`EstimateEditor.jsx`) mirrors the invoice builder.

The OOP calculator is an additional draft front door: a billing admin can explicitly turn a saved,
job-linked, canonical OOP quote into one itemized draft estimate, then review it in the existing
Estimate editor. The conversion itself performs no provider call. The existing human Save action
remains the only step that mirrors the estimate to QuickBooks.

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
  `qbo_bill_email` + `qbo_email_checked_at` (**migration `20260807190000` authored, NOT applied**).
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

### Grouped QBO receipt schema (live; rollout disabled)

- `payment_receipts` — one grouped header per `(qbo_realm_id, qbo_payment_id)`, including totals,
  method/reference/deposit account, source/actor, provider version, status, and normalized snapshot.
- `payment_receipt_attempts` — durable pre-provider client/Intuit request identity, fingerprint,
  request, provider snapshot, outcome, recovery state, and a realm-scoped unique QBO Payment fence.
- `payment_receipt_events` — append-only lifecycle/audit evidence, including terminal tombstones.
- `payments.receipt_id` — 1–100 active per-invoice allocation projections for a grouped receipt.

The foundation is live under production ledger `20260731225654_qbo_multi_invoice_payment_receipts`.
The tables are forced-RLS with no `anon` or `authenticated` access; browser mutation goes through
an admin Worker and six service-only receipt-state RPCs, while a seventh worker-only RPC atomically
claims QBO events with retry identity. Production grant containment under
`20260731230907_qbo_receipt_service_grant_containment` limits direct `service_role` access to
`SELECT` on `payment_receipts` and `payment_receipt_attempts`, with no direct privilege on
`payment_receipt_events`; all writes remain through those seven gated `SECURITY DEFINER` RPCs.
**The feature has never once worked, and the reason is a dead authorization check (found
2026-08-05).** All eight of its database routines — the seven `SECURITY DEFINER` RPCs above plus the
`public.guard_payment_receipt_link_write()` trigger on `payments` — gate on the **legacy flattened
PostgREST GUC** `current_setting('request.jwt.claim.role', true)`. Modern PostgREST does not
populate that name, so the check can never pass for **any** caller, including the service role. A
live end-to-end attempt on `dev.utahpros.app` recorded
`worker_runs qbo-receive-payment` → `error` →
`Supabase RPC reserve_qbo_payment_receipt: 403 {"code":"42501","message":"NOT_AUTHORIZED"}`, which
is consistent with `payment_receipts` / `payment_receipt_attempts` / `payment_receipt_events`
sitting at **zero rows since the foundation applied**. The failure is the role check alone — the
`INVALID_ACTOR` raise a few lines below never fired.

Two things made this survivable for five days and are worth remembering:

- **`current_user` is NOT the fix.** `get_service_sms_consent_status` gates on
  `current_user <> 'service_role'` and works — but only because it is `SECURITY INVOKER`. All seven
  receipt RPCs are `SECURITY DEFINER`, where `current_user` resolves to the function **owner**, and
  the eighth is invoker but *runs inside* those definers. Copying that idiom breaks them a second
  way while looking correct.
- **The behavioural proof was hollow.** `supabase/tests/qbo_multi_invoice_payment_receipts.test.sql`
  called `set_config('request.jwt.claim.role', …)` — it manufactured the exact signal the live API
  layer never sends, so the suite passed against a condition production can't reproduce. It now sets
  only `request.jwt.claims` (what PostgREST actually sends) and asserts the legacy name stays empty.

The repair is `20260805010000_qbo_receipt_service_role_check_repair.sql` (**authored, UNAPPLIED**):
one `CREATE OR REPLACE` per object changing **only** the check to `auth.role() <> 'service_role'`,
the idiom already carrying the applied `20260731210000` QBO invoice command ledger — `SECURITY
DEFINER` functions reached over the identical `functions/lib/supabase.js` service-role transport,
which succeed in production while these return 42501. GUCs are session-scoped and unaffected by
`SECURITY DEFINER`, so `auth.role()` reads the real caller in both the definer and the trigger.

Both receive-payment rollout gates remain disabled. No provider or payment action has been taken
under this foundation beyond the single failed attempt above, which created no QuickBooks Payment.

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
- **Authored, unapplied mobile line-edit boundary:**
  `20260810010000_invoice_line_edit_lock_boundary` tightens the existing direct-line policy around
  unlocked parents and adds the trigger-owned eligible linked/unpaid revision-to-draft transition;
  it deliberately exposes no browser write RPC. Companion migration
  `20260810020000_qbo_invoice_command_reservation` adds service-only
  `stage_qbo_invoice_line_update(...)` and `finalize_qbo_invoice_line_update(...)`. The first freezes
  the exact safe patch and source preimage under the durable command reservation without changing
  UPR. The Worker builds and sends QBO the patched invoice, and only after QBO reaches
  `provider_succeeded` does the second RPC lock line → invoice → command → reservation, verify the
  preimage/command, and apply description, QBO Item/Class, quantity and unit price. A known QBO
  rejection leaves the UPR line untouched; ambiguity retains the command/reservation; a
  post-provider source mismatch becomes reconciliation. `line_total`, header totals and lifecycle
  status remain trigger-owned. Both migrations are repository source, not shared-database
  capabilities, until separately reviewed and applied.

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
  uncollected). Creating a new Stripe link is source-refused; an already stored URL is display/copy
  only. A ✓ "synced" stamp shows when `qbo_synced_at` is set.
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
- **Payments:** recording a new legacy payment writes `payments` and—only when the invoice is
  synced—mirrors create to `POST /api/qbo-payment`. Edit/delete is allowed only for an unlinked
  local row. A row with `qbo_payment_id` is refused in the UI; the Worker delete action is also
  source-disabled with `qbo_payment_delete_durable_boundary_required`. Pre-existing Stripe-sourced
  payments are view-only. When the current employee is an admin, the invoice/contact are
  QBO-linked, and `feature:qbo_receive_payment` is enabled, **Receive payment** instead opens
  `/collections/receive-payment?contact=…&invoice=…`. Grouped/QBO-originated rows are view-only in
  the legacy modal and are corrected in QBO as a whole receipt.

### Gating & feature flags
- Page lives behind **`feature:billing`**.
- `canEdit` (billing role) controls all mutating UI; `synced` controls Send/Revert.
- **`feature:ai_xactimate`** gates the Import button (+ `canEdit && !synced && job?.id`).
- **`feature:qbo_receive_payment`** independently gates the new admin route/button and is authored
  disabled. The grouped Receive Payment UI has an additional, exact-literal Vite build gate:
  **`VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED=true`**. Without it (including absent, malformed, or
  non-literal values), the route redirects to the legacy Collections payments view and the invoice
  button preserves the legacy per-invoice payment modal. The Worker/reconciliation path separately
  requires **`QBO_RECEIVE_PAYMENT_ENABLED=true`**. These are rollout switches, not authorization;
  the UI gate is Preview/client containment and Production remains dark unless that exact build
  value is deliberately supplied.

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
Stored in **`integration_credentials`** (provider `'quickbooks'`, service-role only). The authored,
unapplied `20260810182905_qbo_single_company_binding` adds the private durable singleton
`qbo_company_binding { environment, realm_id, generation }`, which survives credential deletion.
It permits only a same-company reconnect; reconnect and token refresh use generation CAS so a stale
refresh cannot overwrite a newer credential. Replacing the QBO realm/environment is break-glass
full data reconciliation, never an ordinary reconnect or credential deletion. `getConnection`
/ `saveTokens` read/write credentials; **`getValidAccessToken(env)`** returns `{accessToken, realmId,
environment}` and **auto-refreshes** when within ~5 min of expiry (rolling the refresh token forward).
**`qboFetch(env, path, options)`** is the authed wrapper used by everything below.

### Division → QBO mapping (the one place this lives)
**`divisionToQbo(division)`** (substring match on the job's division):

| Division contains | itemId | itemName | className |
|---|---|---|---|
| `recon` | `1010000201` | Reconstruction/ Remodeling Services | `Reconstruction` |
| `remodel` | `1010000201` | Reconstruction/ Remodeling Services | `Reconstruction` |
| `mold` | `1010000131` | Mold Remediation Services | `null` |
| `content` | `38` | Contents | `null` |
| `mit` / `water` / `dry` | `1010000071` | Water Damage Mitigation And Drying | `Mitigation` |
| *(anything else)* | — | — | returns `null` |

`findClassId(env, name)` resolves a class **name → QBO class id** at runtime (so ids aren't
hardcoded). `QBO_INSURANCE_ADJUSTMENT_ITEM_ID = '1010000231'`. This same mapping drives both the
invoice-sync line building **and** the Xactimate Item/Class autofill — change it in one place.

### Workers (`functions/api/`)
Worker identities vary by route. Server-capability and Bearer-only boundaries are defined in
“QBO Worker identity boundary (S1a/S1b, 2026-07-26)” below; UI callers obtain their Bearer through
the established authenticated request helpers.

- **`qbo-invoice.js`** — `POST {invoice_id, action?: 'send'|'delete', send_to?}`.
  - Loads invoice + job + contact + claim and requires a mappable `job.division`. A QBO customer id
    must exist before the invoice provider request; after the invoice command is reserved, the
    explicit human save may invoke the server-to-server customer sync and re-read the mapping.
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
- **`qbo-payment.js`** — `POST {payment_id}` still mirrors a newly recorded legacy UPR payment → QBO
  (requires the invoice already synced + customer in QBO; idempotent on `qbo_payment_id`). Its
  historical `{action:'delete'}` path is source-disabled after authorization and cheap identifier
  validation with `503 qbo_payment_delete_durable_boundary_required`, before configuration,
  connection, business rows, local mutation, or QBO. The invoice UI refuses edit/delete for any
  linked QBO payment and directs correction in QBO followed by UPR reconciliation.
- **`qbo-receive-payment.js`** — active billing-role GET/POST boundary for
  one human-confirmed Payment allocated across 1–100 same-customer QBO invoices. It reserves a
  durable attempt before QBO, derives a stable realm-scoped Intuit `requestid`, creates one Payment
  with multiple Invoice `LinkedTxn` lines, verifies every reviewed accounting field and invoice
  balance delta, then finalizes receipt/projection state. Timeout/transport ambiguity is
  `unknown_outcome`; an unchanged retry resolves the original request instead of creating a new one.
  Authored, unapplied `20260810030000_qbo_payment_allocation_lock_fence` adds a service-only durable
  fence for every allocated invoice before connection/provider work. Reservation and finalizers lock
  invoice UUIDs in one deterministic order; a concurrent manual lock either wins first and causes a
  423/refusal, or loses to the active fence. Known terminal attempt states release the fence;
  `unknown_outcome` has no TTL and retains it. Receipt projection/reconciliation refuses a locked
  invoice rather than overwriting it, and rollback refuses any legacy or fenced nonterminal attempt.
- **`qbo-query.js`** — `POST {query}`, **SELECT-only** passthrough; the frontend uses it to load the
  Item/Class catalog.
- **`qbo-sync-customer.js`** — contact → QBO Customer (per-contact via `{contact_id}`, or `{backfill}`).
  Dedups only on verified identity: exact email, then family name plus exact normalized phone; a
  display name alone never links a money path. A duplicate-name 6240 response retries once with a
  phone-last-four disambiguated name. Every attempted create carries a deterministic, at-most-50-character Accounting API
  `requestid` derived from realm, contact and stage (`primary` versus `disambiguated`). Contact link
  and error writes are null-only/expected-old-value CAS operations, so concurrent workers re-read
  and converge without overwriting an established link. Writes `contacts.qbo_customer_id`.
  - **On-demand creation (Phase A, shipped; estimate-command hardening authored):** `qbo-estimate.js` calls
    `ensureQboCustomer(request, env, contactId)` (in `functions/lib/quickbooks.js`) when a billable
    contact has no `qbo_customer_id` yet — it invokes this server capability, then re-reads the id
    and throws the usual "sync the client first" error only if it is still missing. The authored,
    unapplied estimate-command boundary places that self-heal **after** a durable estimate
    reservation, binds its deterministic customer request id into that reservation, and retains
    the exact fence/key if the outcome is unknown.
    The human-only `qbo-invoice.js` path may use this server capability only after its own durable
    command reservation. It re-reads the contact mapping and retains the same command identity when
    the customer-sync outcome is missing or ambiguous; a stale provider reference may still be
    re-linked after a definitive QBO rejection. Settings preview/backfill remains an explicit
    manual path.
  - **Phase B (SHIPPED — `20260701_crm_qbo_phase_b_gate_contact_trigger.sql`):** `trg_qbo_customer_sync`
    is now a **no-op** — `notify_qbo_customer_sync()` was replaced with a `RETURN NEW` body (the
    trigger is kept attached, not dropped, so restoring the prior body re-enables auto-sync; the
    original body is preserved in the migration's comment). Contacts are **no longer** auto-synced to
    QBO on insert — estimate and explicit invoice push may self-heal a missing link, but background
    contact creation remains disabled.
    Applied to the shared DB **after** Phase A reached production `main` (verified live: a qualifying
    `homeowner`+named contact insert no longer syncs — `qbo_customer_id` stays null, no
    `qbo_sync_error`). The `qbo-sync-customer` worker + its `{backfill}` mode remain for explicit/
    manual syncs.
    - **The "name added after insert" hole is covered at the human transaction boundary:** the
      trigger never fires at all; estimate push and the reserved invoice-save path sync on demand
      regardless of when the name was set.
- **`qbo-estimate.js`** — Bearer-only, human-authorized estimate save/send/delete and focused
  line create/update/delete/reorder. It rejects `x-webhook-secret`, requires a UUIDv4
  `Idempotency-Key`, and uses a private estimate command ledger when the authored migration below
  is applied. It preserves `estimate_number` + `intended_division` semantics and has no automatic
  provider path.

### QBO Worker identity boundary (S1a/S1b, 2026-07-26)

- Browser invoice, estimate, payment, receive-payment and query calls require a valid Supabase
  session resolving to an active, non-external billing employee (`admin`, `office`, or
  `project_manager`). Customer sync, manual payment sync and OAuth credential management remain
  active, non-external admin-only.
- `qbo-receive-payment` uses only that human Bearer boundary; it never accepts
  `QBO_WEBHOOK_SECRET`, and it checks its Worker kill switch before connection/data/provider work.
- The exact `QBO_WEBHOOK_SECRET` capability remains secret-first only on the existing
  background-safe server paths: payment/query, customer sync and HTTP payment sync.
  `/api/qbo-invoice` **and** `/api/qbo-estimate` are human Bearer-only and explicitly reject it.
  The payment poller's direct `scheduled()` entry remains separate.
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
auto-posts a draft. Every invoice save/send/delete request requires an active, non-external billing
employee Bearer session; the shared QBO server secret is explicitly rejected on this human-only
endpoint. Typing/editing alone never invokes it.

Authored migration `20260810020000_qbo_invoice_command_reservation` extends recovery ahead of intent
construction and customer self-heal. A service-only reservation binds invoice, command, action,
actor and realm under the invoice row lock; a concurrent false→true manual lock is refused while
that reservation or a legacy active command exists. Ambiguous work has no automatic TTL, a
different command cannot adopt it, and terminal success/rejection releases it. The migration and
paired rollback are repository source only and **have not been applied to the shared project**.

For the Admin Mobile line editor, the same migration freezes the requested line patch and source
preimage under that reservation but does not mutate UPR before QBO. The patched provider payload is
part of the immutable command intent. Only `provider_succeeded` may invoke the service-only local
finalizer, which applies the exact patch after a line-first lock and preimage check. Definitive
provider rejection releases without a local edit; ambiguous/provider-succeeded recovery retains the
same operation identity and reservation until local finalization or explicit reconciliation. The
browser persists only the opaque UUID plus a SHA-256 request fingerprint, so a changed form cannot
silently retire an unresolved operation.

**Required rolling order once separately authorized:** apply the compatible migration first, then
deploy the new Worker. During that narrow compatibility window, the old deployed Worker has no
pre-intent reservation call, so `prepare_qbo_invoice_command(...)` may create the exact
reservation only when no other active command exists. The new Worker reserves before it builds
intent, attempts customer self-heal, or reaches an invoice provider call. This is deployment
compatibility, not a second provider path: ambiguity retains its reservation without a TTL and
only `succeeded`/`rejected` releases it. Do not describe either behavior as live until the
separately authorized apply and deployment have evidence.

### Admin Mobile P4c financial-document command boundaries (AUTHORED/UNAPPLIED)

The production-maintenance foundation is also **AUTHORED/SOURCE-ONLY**. The global provider key is
`integration_config.key = 'qbo_provider_traffic_enabled'`; only exact text `'true'` allows QBO.
Missing/NULL/false, case or whitespace variants, malformed data, a bounded lookup timeout, or a
database error all deny with `qbo_provider_traffic_disabled`, and an allow result is not cached.
Pages rechecks before OAuth exchange/refresh, credential replace/save/generation-CAS, before token
acquisition and immediately before Accounting/Payments fetches, and before token acquisition plus
the raw multipart upload. QBO-backed routes stop before command/receipt reservation or local
provider-derived mutation. Stripe entry is separately source-disabled before event claim or local
projection; its hard durable-boundary response appears below. A signed QBO webhook
durably records its full retry identity, returns 200 and does no provider work. The scheduled QBO
reconciliation sweep skips and writes best-effort maintenance telemetry. UPR MCP uses the same
bounded, fresh refresh/CAS/provider gate while keeping `upr_mcp_enabled` separate.

This global brake does not reopen intentionally source-contained seams, even at exact `'true'`.
`/api/qbo-charge` is disabled after active internal admin/manager authorization and cheap input
validation: it returns `503` with `qbo_charge_durable_boundary_required` before card capture,
payment persistence, credentials, or QBO work. `/api/qbo-attach` upload/delete similarly return
`503` with `qbo_attachment_durable_boundary_required` after authorization and cheap validation;
read-only metadata/listing paths remain available. MCP QBO create/update/delete/send and
inspection-backed mutation tools return `qbo_mcp_mutation_durable_boundary_required` before
credentials, refresh/CAS, or a provider request, regardless of either global gate; MCP QBO reads
remain gated by `qbo_provider_traffic_enabled` and independent `upr_mcp_enabled`. Eligible
Pages/MCP reads pin the admitted realm through final provider dispatch, and event reconciliation
carries its stored realm through every nested read. Browser-readable telemetry/evidence returns
stable error categories plus `intuit_tid`, not raw OAuth/QBO fault text. Stripe webhook
processing checks configuration and signature (invalid signature is 400), then returns retryable
`503 stripe_projection_durable_boundary_required` before Supabase, claim, local money projection,
QBO, notification, event-finalization, or worker-run work. `/api/stripe-pay-link` authenticates and
cheaply validates `invoice_id`, then returns the same `503` before configuration, invoice/local
reads or writes, or Stripe; no executable in-repository Checkout creator remains and stored URLs
are display-only. Legacy `/api/qbo-payment` create remains, but delete returns
`503 qbo_payment_delete_durable_boundary_required` after authorization/cheap identifier validation
and before configuration, rows, local mutation, or QBO. The invoice UI refuses edit/delete for
linked QBO payments and directs correction in QBO followed by UPR reconciliation. Durable
boundaries for card charge, attachments, MCP writes, Stripe payment/accounting projection, and
legacy payment correction are deferred, separately reviewed work—not flag changes.

The close-race response follows the durable work already completed for eligible routes;
`/api/qbo-charge` is not eligible and always returns its durable-boundary 503 before card capture.
`analyze-xactimate` may still complete its local
import and records `qbo_mapping_unavailable` if
the optional QBO Class lookup closes. An already-started Collections chat turn receives a sanitized
maintenance tool result rather than an HTTP retry. Invoice, estimate and grouped-receipt commands
that already have durable identities retain their identity/fence and return stable 503 with the
same/unchanged-request retry signal where applicable.

`feature:qbo_document_command_v2` is independent of that provider brake and is strict: only
`enabled === true && force_disabled !== true`, never a `dev_only_user_id` preview, permits the
schema-dependent document commands. Web/native route wrappers strict-gate only the focused line
routes. Invoice detail uses it only for line links/add/edit, not legacy Send or Pay; estimate detail
also withholds its QBO Save/Send/Convert-backed actions while closed. The invoice Worker requires
it only for `line_update`/`line_change` operations, preserving legacy invoice save/send/delete
without a line operation as the migration-abort fallback. The estimate Worker requires it for
every save/send/delete/line mutation. New invoice/estimate local draft creation and non-line
invoice routes remain outside this capability.

The actual config row and flag row, their values, Pages/MCP deployment, and live behavior are
**UNKNOWN**. No migration, configuration write, provider call, or deployment is implied. Follow
[`docs/admin-mobile-p4c-production-runbook.md`](docs/admin-mobile-p4c-production-runbook.md) for
operations; this document does not contain reusable authorization or company/credential values.

`20260810182847_invoice_document_line_operations` extends the invoice command boundary from a
single line update to explicit document-line create, update, delete and reorder. Each request is
frozen in the durable invoice command, QBO receives the canonical quantity×rate amount, and only a
service-only finalizer projects the exact change locally after `provider_succeeded`. Browser RLS
does not gain a new mobile mutation path; generated totals and lifecycle state stay database-owned.
The existing desktop invoice and estimate builders remain matching local-draft editors outside an
active reservation. Their explicit Save/Send action freezes and pushes the full current document;
typing never calls QBO, and the reservation guards refuse a concurrent draft write.

`20260810182855_estimate_qbo_command_boundary` is the parallel but **separate** estimate ledger:
private forced-RLS command/reservation rows serialize save/send/delete and focused line
create/update/delete/reorder with browser line writes and conversion. `/api/qbo-estimate` is now a
Bearer-only human endpoint with one UUIDv4 identity per unresolved command; it rejects the generic
webhook secret. The reservation happens before the durable customer-self-heal prerequisite and any
  estimate provider call. A definitive rejection leaves UPR unchanged; an ambiguous customer or
  estimate result stays fenced for the same-key retry/reconciliation; provider success finalizes the
  local estimate projection atomically. Browser invoice and estimate creation derive `created_by`
  from the active internal billing employee; neither can spoof another employee.

`20260810182905_qbo_single_company_binding` adds the service-only durable QBO company binding and
credential generation guard. It seeds only from an attributable existing credential, refuses an
unbound reconnect when QBO-linked artifacts exist, and makes same-company reconnect/refresh CAS
operations; it does not backfill ambiguous external IDs. The binding remains after credential
deletion. A realm or environment replacement requires separately reviewed break-glass full data
reconciliation, not a normal sandbox-to-production cutover, reconnect, or credential deletion.
Its storage-level realm-binding guard covers the nine realm-bearing QBO ledgers/projections and
rejects non-service or wrong-binding writes. Ordinary manual null-realm payments remain compatible
only when neither the current nor prior row carries a QBO payment or Stripe-fee identity.
`qbo_events` intentionally remains foreign-realm audit input; consumers realm-check it before
acting. This is all **AUTHORED/UNAPPLIED** source, not live database behavior.
`upr-mcp/src/qbo.js` is a separately deployed Worker sharing this credential row. Do not apply the
binding migration until both Pages and UPR MCP use the generation-CAS refresh/fail-closed path, or
the MCP QBO tools are disabled; an MCP source fix alone is not deployed coverage.

All three migrations and their paired rollbacks are **AUTHORED/UNAPPLIED** repository source. They
are not shared-database capabilities and do not authorize a QBO write, deployment or migration apply.

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
Eligible Workers log to **`worker_runs`** (`worker_name`, status, counts, error; direct receipts as
`qbo-receive-payment`). Source-disabled `qbo-attach` and Stripe entry routes stop before worker-run
telemetry. QBO webhook delivery/retry state logs to
**`qbo_events`**; grouped receipt lifecycle evidence lives separately in
**`payment_receipt_events`**.

### Attachments on invoices & estimates (2026-07-24)
Historical implementation: staff could attach a file to a **synced** invoice/estimate through the
QuickBooks Attachable API with `IncludeOnSend=true`; UPR stored metadata only in `qbo_attachments`,
never the bytes. For the P4c release, upload and delete are source-disabled after authorization and
cheap validation with `503 qbo_attachment_durable_boundary_required`. The UI's metadata/listing read
remains, as do the underlying `uploadAttachable`/`deleteAttachable` helpers for a future durable
command design, but no current route reaches them. The direct metadata SELECT policy still lacks the
Worker's `is_external=false` predicate; that database residual remains separately tracked.

### Payment two-way sync activation (2026-07-24)
The QBO→UPR payment path is built; the hourly safety-net poller is now wired via pg_cron
(`20260724180100_qbo_payments_sync_cron.sql`, live ledger `20260724190848`) →
`/api/qbo-payments-sync` using `integration_config.qbo_webhook_secret`. The real-time webhook is
live (`QBO_WEBHOOK_VERIFIER_TOKEN` set; Payment events verified processing in `qbo_events`).
The Intuit Production subscription at `https://utahpros.app/api/qbo-webhook` now retains
**Payment** and **PaymentMethod** and includes **Estimate** with every operation Intuit offered.
Per-transaction method still comes from the Payment payload's `PaymentMethodRef`; PaymentMethod
events report catalog-definition changes. Dedup on `qbo_payment_id` keeps the webhook and poller
from double-counting. The authored receipt mode adds realm/payment and event-key dedup plus CDC
retry state but is not deployed/applied/active.

---

## 5. Stripe pay links & payment projection (SOURCE-DISABLED)

`POST /api/stripe-pay-link {invoice_id}` authenticates and cheaply validates the identifier, then
returns retryable `503 stripe_projection_durable_boundary_required` before Stripe configuration,
invoice/local reads or writes, or Stripe calls. No executable in-repository Checkout creator
remains; existing stored URLs are display/copy-only. The webhook validates configuration and
signature (invalid signature is 400), then returns the same hard 503 before Supabase, event claim,
local payment/refund/dispute/payout projection, QBO, notifications, event/finalization, or
worker-run telemetry. Neither route can be reopened by the QBO or MCP gate. A durable payment and
accounting projection boundary is required before either entry point may resume.

**Server boundary refresh (2026-07-23; charge mutation superseded by P4c containment):** both `/api/stripe-pay-link` and `/api/qbo-charge` now
resolve an active employee and require the same `admin`/`manager` billing-role predicate as the UI
before configuration, invoice, credential, or provider access. The charge endpoint rejects the
generic QBO webhook secret and external employees, and validates a stable `Idempotency-Key` and
whole-cent amount; it then returns `503 qbo_charge_durable_boundary_required` without Intuit work,
card capture, or UPR payment persistence. The durable charge command/reconciliation boundary is
deferred.

This is authorization/request-id containment, not full charge reconciliation. A durable
pre-provider charge-attempt row, captured-but-unrecorded recovery, and Intuit sandbox failure
injection remain required before COR-002 can close. Stripe's existing content-derived provider key
reduces concurrent duplicate creation, but stored-session reuse/expiration and sandbox concurrency
proof remain COR-003.

---

## 6. Xactimate AI import — `functions/api/analyze-xactimate.js` (+ InvoiceEditor)

UPR's only AI/LLM integration. Upload an Xactimate PDF on a draft invoice; Claude reads it and
pre-fills the single insurance-billable line + a recap. **Draft only — never posts or mutates QBO;
the optional Class lookup is a live QBO read.**

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
  from the same `divisionToQbo`/`findClassId` the sync uses. The optional Class lookup is
  best-effort: if the QBO traffic gate closes, the local import still finishes and the recap records
  `qbo_mapping_unavailable: 'qbo_provider_traffic_disabled'`.
- **Persistence:** writes the full recap to **`invoices.xactimate_meta`** (best-effort). The editor
  re-shows the banner from there on every load, so it survives refresh and stays visible after QBO
  save (only the "review before Save" line is gated to drafts).
- Logs `worker_runs` as `analyze-xactimate`. Returns `{ok, billable, totals, paid_when_incurred,
  work_type, checks, reconciles, claim_number, date_of_loss, line_count, imported_at}` plus optional
  `qbo_mapping_unavailable` when the live Class mapping was maintenance-blocked.

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
- **QBO needs the customer first** — the provider request never runs without
  `contact.qbo_customer_id`; explicit invoice Save first attempts guarded customer self-heal after
  its command reservation, then retains/refuses safely if the mapping remains unavailable or
  ambiguous.
- **`adjusted_total ?? total`** is the billable amount everywhere (no-lines fallback, AR balance).
- **Shared Supabase** — DB/flag changes affect `dev` and `main` together.
- **Release flow** — feature branch → `dev` (staging) → reviewed **`dev → main` PR** (merge commit,
  then fast-forward `dev` to `main`). Never push to `main` directly. Cloudflare Pages build is the
  gating check.
- **Coordination** — `InvoiceEditor.jsx`, `NewInvoiceModal.jsx`, the billing schema, `CLAUDE.md`, and
  `UPR-Web-Context.md` are touched by multiple chats. `git fetch origin dev` + rebase before pushing.
- **DocNumber** is unique per invoice — the number QBO already assigned, else `job_number` (first
  invoice on the job) or `job_number-N` (the Nth, e.g. a supplement). A job **can** have more than one
  invoice (you can't add lines to an already-paid invoice, so supplements get their own). Only prints
  if "Custom transaction numbers" is ON in QBO.
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
  token store + refresh logic, the Save→QBO invoice gate, and the two-click admin receipt gate.

---

*Source files: `functions/lib/{quickbooks,qbo-payment-sync,qbo-receipt}.js`;
`functions/api/qbo-{invoice,payment,receive-payment,query,estimate,sync-customer,webhook,
payments-sync}.js`, `analyze-xactimate.js`, `stripe-pay-link.js`;
`src/pages/{InvoiceEditor,Collections,ReceivePayment}.jsx`; `src/components/NewInvoiceModal.jsx`,
`src/components/collections/{collKit.jsx,collTokens.js,SearchSelect.jsx,ActionMenu.jsx,
ReceivePaymentForm.jsx,paymentAllocation.js}`, `src/components/{DatePicker,AutoGrowTextarea}.jsx`;
`src/App.jsx`; RPCs `create_invoice_for_job`, `get_ar_invoices`, `convert_estimate_to_invoice`, the
six `*_qbo_payment_receipt` functions, and the worker-only QBO-event claim function.*
