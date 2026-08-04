# Invoice Send-Review & Activity History — Roadmap

**Last verified:** 2026-08-04
**Status:** P0 contract freeze complete (repository-only). No database, provider, deployment, or
customer-send action is authorized by this document.
**Base:** `origin/dev` `2c1ae73e` · branch `codex/invoice-send-review-activity`

## Goal

Make sending an invoice a reviewed action instead of a two-click guess: show who it is going to,
let staff correct the address and add one CC, let them edit the message the customer actually
sees, and record an honest activity history of edits, saves, sends, and payments.

---

## P0 — Frozen contracts (verified against source, not assumed)

Everything in this section is **live behavior on `origin/dev` `2c1ae73e`**. A later phase may add
to it; nothing here may change shape.

### P0.1 Worker request contract — `POST /api/qbo-invoice`

| Element | Frozen value |
|---|---|
| Authorization | `authorizeQboBrowserRequest` — active, non-external **admin** Bearer session. Never the shared QBO webhook secret (`qbo-invoice.js:236-238`). |
| `Idempotency-Key` header | **Required**, must match `QBO_COMMAND_ID_RE` (UUIDv4). Rejected 400 otherwise. |
| Command identity | one key ≡ one `(invoice_id, action, actor, realm_id)`. A mismatch is 409, never a silent re-target (`qboCommandIdentityMatches`). |
| `body.action` | `'send'` \| `'delete'` \| anything else coerced to `'save'` (`:244`). |
| `body.send_to` | **Already supported today** (`:162`) — overrides the recipient for `action:'send'`, falling back to the contact's email. Validated by `emailOk`. |

**This is the single most useful P0 finding: the recipient override already exists server-side and
is simply not exposed in the UI.** P1/P5 expose an existing, already-hardened parameter — they do
not add a new provider capability.

### P0.2 Response shapes — frozen, additive-only

```
save   → { ok, mode: 'created'|'updated', qbo_invoice_id, doc_number, total,
           online_pay_warning, customer_relink }
send   → { ok: true, emailed_to, email_status }
delete → { deleted }
error  → { error, code?, retry_same_request?, intuit_tid? }
```

`retry_same_request` is load-bearing: `qboInvoiceWorker.js:107-111` keeps the client operation id
alive on an ambiguous outcome and retires it otherwise. Renaming or reshaping it reintroduces
duplicate-send risk. Treat it exactly like the `sms_disabled` / `quiet_hours` strings.

### P0.3 The byte-compare constraint — the sharpest limit on this work

`currentMatchesStoredAttempt` (`:216-230`) rebuilds the save intent **from live database state**
and compares `stableJsonStringify(local) === stableJsonStringify(stored)`. A mismatch turns a
retry into a durable `needs_reconciliation` 409.

**Therefore:** every new field that reaches the QBO payload must be a *deterministic read of a
stored column*. A customer-visible message that lives anywhere non-deterministic (component state,
a request body not persisted before the command is frozen, a timestamp) makes every retry a false
"invoice changed" 409. This is the single easiest way to break money-path recovery, and it is why
P2's schema must land before P4's send flow.

### P0.4 Provider capability — measured, not assumed

- `sendInvoice(env, id, sendTo, { requestId })` → `POST /invoice/{id}/send?sendTo={one email}`
  (`quickbooks.js:574-576`). **The send endpoint accepts exactly one recipient and has no CC
  parameter.**
- **CC therefore requires setting `BillEmailCc` on the invoice via an UPDATE *before* the send** —
  a second provider side effect, and the reason a one-stage command cannot represent
  "update presentation, then send".
- `CustomerMemo` **is already sent on every save** (`:152`), carrying the same server-derived
  `memo` string as `PrivateNote` (`:144` — date of loss · job · claim · service address).
  Making the customer-visible message editable means *splitting those two fields*, not adding new
  provider plumbing. `PrivateNote` must keep the derived string so internal QBO context survives.

### P0.5 Two-stage precedent that already exists

Two mechanisms already support staging and must be reused rather than reinvented:

- `qboInvoiceRequestId(action, invoiceId, clientRequestId, stage = 'primary')` (`:41`) already
  carries a **`stage`** discriminator, used today for the `without-online-pay` /
  `without-doc-number` / `customer-relinked` fallbacks.
- The client already keys its operation id **per action** —
  `storageKey(ownerId, invoiceId, action)` (`qboInvoiceWorker.js:31`) — so `emailInvoice` already
  performs save and send as two independently-recoverable commands (`InvoiceEditor.jsx:399-400`).

The reviewed send becomes `update(BillEmailCc + CustomerMemo)` → `send`, as two commands with
distinct identities, never one command with two provider effects.

### P0.6 Untouchable — corrected 2026-08-04 against the live baseline

**The trigger-owned set is larger than `AGENTS.md` §15 lists.** §15 names
`amount_paid, line_total, status, paid_at`. The real surface, read from the committed baseline:

| Owner | Columns it writes | Evidence |
|---|---|---|
| `update_invoice_paid()` (on `payments`) | `amount_paid`, `insurance_paid`, `homeowner_paid`, `status`, `paid_at`, `updated_at` | `db/baseline/schema.sql:16661-16672`, trigger `:24702` |
| `recompute_invoice_from_lines()` (on `invoice_line_items`) | `subtotal`, `total`, `updated_at` | `db/baseline/schema.sql:13950-13953`, trigger `:24625` |
| **Postgres** (`GENERATED ALWAYS … STORED`) | `invoices.balance_due`, `invoice_line_items.line_total` | `:2428`, `:19460` |

Two consequences the plan must respect: `insurance_paid`, `homeowner_paid`, `subtotal` and `total`
are trigger-owned too — writing `subtotal`/`total` directly is silently overwritten by the next
line-item change. And `line_total` **is not a column of `invoices`** at all; it belongs to
`invoice_line_items` and, like `balance_due`, is generated — a write fails hard rather than
silently, which is the safer of the two failure modes.

- The human Save-to-QuickBooks gate — no automated path may reach `/api/qbo-invoice`.
- `cas_qbo_invoice_link` parameter list, including the send-only
  `p_qbo_emailed_at` / `p_qbo_email_status` / `p_sent_to_email` / `p_write_email_metadata`.
- Rule 2: the send confirm stays a real control, never `confirm()`. Destructive actions
  (Revert / Delete) keep inline two-click.

### P0.7 Findings that change the design (verified 2026-08-04)

1. **A relink erases send history.** `cas_qbo_invoice_link` nulls `qbo_emailed_at`,
   `qbo_email_status` and `sent_to_email` whenever the QBO link target changes. The activity table
   must therefore own send history **independently**, or an automatic customer-relink silently
   destroys the record of what was sent.
2. **`qbo_invoice_commands_one_active_per_invoice`** is a partial unique index — only one active
   command per invoice. So in P4 the `update` stage must reach a **terminal** status before the
   `send` stage can be prepared. This is the concrete mechanism that makes the two-stage flow
   serial, and it is a constraint, not a choice.
3. **`invoice_status_history` already exists** (`20260708_dbf_lifecycle_history.sql:49-76`) and
   must **not** be extended: no actor column, an always-true authenticated read policy, and a
   trigger keyed on `status` — which a QBO send never changes. The new table sits alongside it;
   the read projection may union it.
4. **"Sent" is not the send date.** `invoices.sent_at` is written only by `qbo-invoice.js:376`, on
   the **first successful save to QuickBooks**, never on send. Ten-plus UI sites label it "Sent".
   The real customer-email timestamp is `qbo_emailed_at`. P1 corrects this on the invoice page.

### P0.8 Pre-existing defects found while planning — NOT introduced here, NOT in scope

Recorded so they are not silently inherited or mistaken for this initiative's work:

- **`GRANT ALL ON TABLE public.invoices TO anon`** — `db/baseline/schema.sql:29727`. Also
  `authenticated`. Contrary to `database-standard.md` §1–§2.
- **`InvoiceEditor.jsx:326` writes the trigger-owned `invoices.status` directly**, and the
  compensating `derive_invoice_qbo_lifecycle_status` trigger lists only
  `UPDATE OF qbo_invoice_id, qbo_emailed_at`, so a status-only write bypasses it entirely. Its
  failure is swallowed by `.catch(() => {})`.
- **A non-admin money path:** `JobPage.jsx:539` grants `office` and `project_manager` the
  ClaimBilling record/delete-payment controls, wider than `BILLING_EDIT_ROLES = ['admin','manager']`,
  and `payments` carries a `FOR ALL TO authenticated` policy with no role predicate, so those
  writes succeed server-side.
- **`qbo_multi_invoice_payment_receipts.test.sql`** is registered in the db-lane `LOCAL_ONLY_SQL`
  inventory but no runner executes it — registered-but-dark.

---

## Phases

| Phase | Scope | Depends on |
|---|---|---|
| **P1** | Customer identity: name → `/customers/:contactId` link, email presented clearly, honest fallback when `contact_id` and `job.primary_contact_id` are both null. **No schema.** | P0 |
| **P2** | Additive private schema: invoice activity/audit, delivery record, staged-command support. Paired rollback + CI-visible static contract test in `tests/qa/unit/`. Proven on a disposable local stack. | P0 |
| **P3** | Semantic attribution for invoice mutations so edits carry an actor. | P2 |
| **P4** | Two-stage reviewed send state machine (`update` → `send`), idempotent per stage. | P2, P3 |
| **P5** | Accessible review modal (To / one CC / customer message) + paginated activity timeline. | P4 |

### Honest limits, stated up front

- **Historic send actors cannot be reconstructed.** The timeline starts when P2 lands; earlier
  sends show "recorded before activity history" rather than a fabricated actor.
- **Provider acceptance is not inbox delivery.** `email_status: 'EmailSent'` means QBO accepted the
  request. The timeline must say "sent to QuickBooks for delivery", never "delivered".
- **Private command payloads are not the activity feed.** `qbo_invoice_commands` holds frozen
  provider payloads; the timeline reads a purpose-built projection, never that table.

## Owner gates (none of these are implied by any phase above)

Shared-database apply · deployment · merge · feature-flag or cron changes · any real QBO write ·
any customer-facing send.
