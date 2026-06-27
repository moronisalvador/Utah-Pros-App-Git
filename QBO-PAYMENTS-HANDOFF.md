# QuickBooks Payments — Build Handoff (for a fresh Claude session to finish the feature)

> **What this is:** a complete, self-contained handoff so a NEW chat can take over and finish
> QuickBooks Payments in UPR — what's done, what isn't, the remaining build plan, the open risks,
> and the owner's action items. **Verified against the repo + DB on 2026-06-27** (not from memory).
> Companion to `BILLING-CONTEXT.md`.

---

## 0. The goal (whole feature)
Let Utah Pros take card/ACH money two ways, all reconciling in QBO **and** UPR with no double-counting:
1. **Customer self-pay online** — the invoice UPR generates carries a QBO "Pay now" button. **(DONE — #96.)**
2. **Inbound sync** — payments paid online (or in QBO) flow back into UPR automatically. **(BUILT, DORMANT — #47.)**
3. **In-UPR "Charge a card" virtual terminal** — staff key a card on an invoice and charge it. **(Backend DONE — #97; UI NOT built.)**

Stripe is the *future* processor and stays dormant/untouched throughout.

---

## 1. Orientation (read first)
- **Repo:** `moronisalvador/Utah-Pros-App-Git`. **Supabase project:** `glsmljpabrwonfiltiqm`.
- **Branches / source of truth:** **`dev` is always up to date — branch off `origin/dev`.** At write time
  `dev = afbf0fd`, `main = bee9edf` (`dev` is **+9 ahead of main**, much of it unrelated time-tracking/Drive work).
  Never push `main` directly; release via a reviewed **`dev → main`** PR ("Release dev → main").
  **Shared single Supabase** across dev+main — DB/flag changes hit both at once.
- **Stack:** React 19 + Vite (JSX, no TS); data via `const { db } = useAuth()` + `db.rpc()`; Cloudflare Pages
  Functions in `functions/api/*`; QBO via raw fetch in `functions/lib/quickbooks.js` (no SDK).
- **The one rule (money):** human-in-the-loop. Nothing auto-posts to QBO; a person clicks Save/Charge.
- **Context docs (read in order):** `BILLING-CONTEXT.md` (deep dive — invoice builder, QBO sync, Xactimate AI),
  `QBO-BILLING-STATUS.md` (status), `QBO-PAYMENTS-WEBHOOK-SETUP.md` (inbound activation runbook),
  `UPR-Web-Context.md` (master), `CLAUDE.md` (rules).
- **Git note:** start clean — `git fetch origin dev && git checkout -B <new-branch> origin/dev`. Build +
  `npx eslint <changed>` before pushing; commits authored `Claude <noreply@anthropic.com>`.

---

## 2. DONE — already merged to `dev` (verified present)

### 2A. Customer self-pay online — PR #96 (`b0c4ac0`)
- `functions/api/qbo-invoice.js`: reads `accept_card`/`accept_ach` from `integration_config` and sets
  **`AllowOnlineCreditCardPayment` / `AllowOnlineACHPayment`** on BOTH the create and update QBO payloads
  (only when true). If QBO faults because Payments isn't enabled, it **retries once without the flags** and
  returns `online_pay_warning`.
- `src/pages/PaymentSettings.jsx`: the two toggles moved into a **"Online payments (QuickBooks)"** section.
- `supabase/migrations/20260626_get_payments_ledger_source.sql` (**applied**): adds `source` to
  `get_payments_ledger()`.
- UI: **"Online · QBO"** pill on `source='qbo'` payments in `PaymentsLedger.jsx`, `ClaimBilling.jsx`,
  `InvoiceEditor.jsx`; an **online-payable banner** on synced invoices; `online_pay_warning` toast on Save.
- State: `accept_card`/`accept_ach` are already `'true'`. Once the **inbound webhook is activated (2B)**, the
  customer self-pay loop is fully live.

### 2B. Inbound QBO Payment sync — PR #47 (pre-existing; DORMANT)
- `functions/api/qbo-webhook.js` (Intuit-signed Payment webhook; idempotent via `claim_qbo_event` + `qbo_events`;
  Create/Update → import, Delete/Void/Merge → remove), `functions/api/qbo-payments-sync.js` (hourly safety-net
  poller, 7-day lookback, `scheduled()` exported but **no cron wired**), `functions/lib/qbo-payment-sync.js`
  (`syncQboPaymentToUpr` — QBO Payment → `payments` row `source='qbo'`, **dedups on `qbo_payment_id`**,
  `adoptInvoiceFromQboEstimate`; `removeQboPaymentFromUpr` only touches `source='qbo'`), `functions/lib/intuit.js`
  (HMAC verify). Migration `20260624_qbo_payment_webhook.sql` (**applied**).
- **Still dormant:** `QBO_WEBHOOK_VERIFIER_TOKEN` is **not set**; no cron. **But 46 `source='qbo'` payments are
  already in the DB**, reconciled by manually hitting the poller / via the UPR MCP — not the live webhook.
- Activation runbook: `QBO-PAYMENTS-WEBHOOK-SETUP.md` (owner steps in §5).

### 2C. Virtual-terminal BACKEND — PR #97 (`10f3c50`) — INERT
- `functions/lib/quickbooks.js`:
  - `SCOPE` now `'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment'`.
  - `saveTokens` persists the granted `scope` → `integration_credentials.granted_scopes`.
  - **Payments API client** (the Charges API is a *different host*): `paymentsApiBase(environment)` →
    `https://api.intuit.com` (prod) / `https://sandbox.api.intuit.com` (sandbox); `paymentsFetch(env, path, opts)`
    (adds a `Request-Id` idempotency header); `createCharge(env, { amount, token, currency='USD' })` → POST
    `/charges` `{ amount, currency, token, capture:true, context:{ isEcommerce:true } }`, throws `e.declined`.
- `functions/api/qbo-charge.js` (**NEW**): `POST { invoice_id, token, amount }` →
  1) `createCharge`, 2) insert UPR `payments` row (`source='qbo'`, `payment_method='credit_card'`,
  `reference_number='Card charge #<id>'`, no `qbo_payment_id` yet), 3) `createPayment` (linked QBO Payment, deposit
  routed to `integration_config.qbo_bank_account_id`), 4) stamp `qbo_payment_id` so the #47 webhook **dedups** it.
  Guards on the payment scope; surfaces declines (402).
- `supabase/migrations/20260626_integration_credentials_scopes.sql` (**applied**): `granted_scopes text`.
- **INERT:** nothing calls `/api/qbo-charge` (no UI), and `granted_scopes` is currently **null** → the worker
  refuses with "reconnect QuickBooks" until the owner re-consents.

### 2D. Related, shipped earlier (context only — on main)
Save-safe "Send to customer" (#48), stale-chunk auto-reload (#49), e-sign signing notifications + sidebar bell
(#50), the webhook activation runbook (#51). Not part of the remaining work.

---

## 3. NOT DONE — remaining work (what the new session builds: "slice 2")

### 3A. ⚠️ RESOLVE FIRST — the Intuit browser-tokenization + PCI mechanism (the linchpin)
Before building any card-entry UI, confirm **how the browser turns a raw card into a token without the PAN
touching our servers**. This decides PCI scope: done right = **SAQ A-EP** (light, a questionnaire); done wrong
(card routed through our backend) = **SAQ D** (heavy). Intuit's docs returned 403 to automated fetch, so read
them directly / test in sandbox:
- Tokens API: https://developer.intuit.com/app/developer/qbpayments/docs/api/resources/all-entities/tokens
- Payments API overview: https://developer.intuit.com/app/developer/qbpayments/docs/get-started
- Answer: Does the browser POST card data straight to the tokens endpoint (CORS? what auth/clientId)? Is there an
  Intuit.js / hosted-fields option? The answer dictates the `src/lib/intuitTokenize.js` design.

### 3B. Frontend "Charge a card" tab — `src/pages/InvoiceEditor.jsx` + NEW `src/lib/intuitTokenize.js`
- Add a **"Charge a card"** mode to the existing payment modal (reuse `payForm`/`payView`; see the
  "Receive payment" button + modal). Card fields (number, exp, CVC, zip).
- On submit: tokenize **client-side** → `POST { invoice_id, token, amount }` to `/api/qbo-charge` (already built).
  States: processing → success (close + reload; payment shows via the existing "Online · QBO" path) or decline
  (inline error).
- **Gate the tab** on `canEdit` (admin/manager via `canEditBilling`) **and payment-scope-connected** (see 3D).

### 3C. Payment Settings status — `src/pages/PaymentSettings.jsx`
- Show a **"QuickBooks card terminal"** status: connected (payment scope present) vs "Reconnect QuickBooks to
  enable card charging." Optional: a clearing/deposit-account selector for keyed charges (reuse the QBO account
  picker already there for Stripe).

### 3D. Expose connection/scope status to the frontend (small RPC)
`get_billing_settings` reads `integration_config`, NOT `integration_credentials`, so `granted_scopes` isn't visible
to the UI. Add a **SECURITY DEFINER** RPC `get_qbo_connection_status()` →
`{ connected, has_payment_scope, company_name, environment }` (reads `integration_credentials`), granted to
`anon, authenticated`. Gates 3B/3C.

### 3E. (Optional, later) Refund/void for keyed charges
The Charges API supports refunds; a "refund this card payment" action isn't built. The inbound webhook already
*removes* a `source='qbo'` payment if the QBO Payment is voided, so voiding in QBO already reverses UPR.

---

## 4. Open decisions / risks the new session MUST handle
1. **Accounting reconciliation (validate in sandbox).** Confirm the **Charge** (money movement) + the **linked
   QBO Payment** don't double-count income/deposit. `qbo-charge.js` routes the deposit to
   `integration_config.qbo_bank_account_id`; confirm with the bookkeeper it nets correctly (a clearing account may
   be cleaner, like the Stripe pattern). **Biggest correctness risk.**
2. **No sandbox connection is wired.** The live QBO connection is **production** (`environment='production'`).
   To test safely: (a) create an Intuit **sandbox** app + company, set `QBO_ENVIRONMENT=sandbox` on a Preview
   deploy and reconnect to sandbox (code already branches on `qboEnvironment(env)` / `paymentsApiBase`), or
   (b) do a minimal **real** $1 charge + refund on production after reconnect. **Recommend sandbox.**
3. **`source='qbo'` for keyed charges** gives correct void-reversal (via `removeQboPaymentFromUpr`) and the
   "Online · QBO" pill (slightly generic for a staff-keyed charge — fine, or add a distinct label).
4. **Releasing to production** brings ALL of `dev` (+9 ahead of main, much unrelated). Coordinate the release.

---

## 5. OWNER ACTION ITEMS (unblock the build/testing)
1. **Reconnect QuickBooks** so the Payments scope is granted. After #97 is live where you test (it's on `dev`):
   **Dev Tools → Connect QuickBooks → approve** (it now asks for **Payments** permission).
   - Re-consents the **single shared** QBO connection (used by dev AND main); additive — accounting keeps working.
   - **Verify:** `integration_credentials.granted_scopes` should then contain `payment` (currently null → card
     charging is blocked by design).
2. **(Customer self-pay half — independent of the terminal)** Activate the inbound webhook per
   `QBO-PAYMENTS-WEBHOOK-SETUP.md`: set **`QBO_WEBHOOK_VERIFIER_TOKEN`** in Cloudflare Pages (Production + Preview,
   redeploy), **subscribe the Payment webhook** in Intuit Developer to `https://utahpros.app/api/qbo-webhook`,
   **wire an hourly cron** to `https://utahpros.app/api/qbo-payments-sync` (external pinger or tiny Worker — Pages
   can't cron natively). QuickBooks Payments is already active on the company.
3. **Choose the test path** for the card terminal (sandbox recommended — §4.2) and tell the new session which.
4. **When validated**, approve the `dev → main` release PR.

---

## 6. Paste-this into the new Claude session (kickoff prompt)
> Read `QBO-PAYMENTS-HANDOFF.md` and `BILLING-CONTEXT.md` on the `dev` branch. We're finishing the QuickBooks
> Payments feature. The card-charge **backend is already merged on dev** (`/api/qbo-charge`, `createCharge`,
> scope + `granted_scopes`). I have [reconnected QuickBooks with the Payments scope / NOT yet — say which]. Build
> **slice 2**: first confirm the Intuit browser-tokenization + PCI mechanism (read the Intuit Tokens API docs /
> test in sandbox — see §3A), then build the "Charge a card" tab in the InvoiceEditor payment modal +
> `src/lib/intuitTokenize.js` + a `get_qbo_connection_status()` RPC to gate it + the Payment Settings status.
> Work off `origin/dev` (branch fresh — the old feature branch is stale), never push `main` directly, ship via a
> reviewed `dev → main` PR, build + eslint before pushing, and validate the charge → linked-payment reconciliation
> in the Intuit **sandbox** before any production test.

---

## 7. Verification checklist for slice 2 (end-to-end, sandbox first)
- Reconnect (payment scope) → `get_qbo_connection_status()` shows `has_payment_scope:true`.
- Open a synced invoice → **Charge a card** → enter a sandbox test card → charge **succeeds**:
  - exactly **one** UPR `payments` row (`source='qbo'`, `credit_card`, `reference_number='Card charge #…'`) with
    `qbo_payment_id` set; invoice balance drops; status → Partial/Paid (the `update_invoice_paid` trigger).
  - exactly **one** QBO Payment, **linked to the invoice**; **no double-count** of income/deposit (key check).
- **Decline** path → clear inline error, **no** DB writes.
- Re-fire the QBO webhook for that payment → **no-op** (dedup on `qbo_payment_id`).
- Void the QBO Payment → the imported UPR row is removed, balance reopens.
- `npm run build` ✓, `npx eslint <changed>` ✓, `node --check functions/api/qbo-charge.js` ✓.
- Inspect with `Supabase execute_sql` (`payments`, `worker_runs`, `integration_credentials`) and
  `UPR_MCP qbo_get` for the QBO Charge/Payment objects.

---

## 8. Reference — exact symbols/signatures already in place
- `functions/lib/quickbooks.js`:
  - `createCharge(env, { amount, token, currency='USD', requestId })` → Charge; `e.declined` on decline.
  - `paymentsFetch(env, path, { method, body, requestId, headers })` — base `…/quickbooks/v4/payments`.
  - `paymentsApiBase(environment)` — prod `api.intuit.com`, sandbox `sandbox.api.intuit.com`.
  - `createPayment(env, { customerId, qboInvoiceId, amount, txnDate, privateNote, depositAccountId })` →
    QBO Payment with `Line[0].LinkedTxn = [{ TxnId: invoiceId, TxnType:'Invoice' }]`.
  - `getValidAccessToken(env)` → `{ accessToken, realmId, environment }` (auto-refresh); `getConnection(env)`;
    `saveTokens` (persists `granted_scopes`); `buildAuthorizeUrl` (requests the payment scope).
- `functions/api/qbo-charge.js` — body `{ invoice_id, token, amount }`; auth = `x-webhook-secret` or Supabase
  Bearer; logs `worker_runs` as `qbo-charge`; returns `{ ok, charge_id, payment_id, qbo_payment_id, qbo_sync_error }`
  or `{ error, declined }` (402 on decline).
- Dedup preventing webhook double-count: `qbo-payment-sync.js` `syncQboPaymentToUpr` checks
  `qbo_payment_id=eq.<id> & invoice_id=eq.<id>` and skips if found — stamping `qbo_payment_id` on the UPR row
  (qbo-charge step 4) is what makes it safe.
- `payments` columns: `source` (free text: manual|qbo|stripe), `payment_method`, `qbo_payment_id`, `qbo_synced_at`,
  `qbo_sync_error`, `reference_number`, `refunded_amount`, `amount` (>0). `invoices.amount_paid` is
  trigger-computed (`update_invoice_paid`) — never write it. `invoice_line_items.line_total` is GENERATED — never write it.

---

## 9. Current state snapshot (verified 2026-06-27)
- `dev = afbf0fd`; `main = bee9edf`; old feature branch `claude/gallant-lovelace-78vba5` is **stale** (ignore).
- QBO connection: **production**, company "Utah Pros Restoration", **`granted_scopes = null` (payment scope NOT
  yet granted — owner must reconnect)**.
- `46` `source='qbo'` payments already imported (manual reconcile, not the live webhook).
- Applied migrations of note: `20260624_qbo_payment_webhook.sql`, `20260626_get_payments_ledger_source.sql`,
  `20260626_integration_credentials_scopes.sql`.
