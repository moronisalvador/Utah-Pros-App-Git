# QBO Online-Payment → UPR Reconciliation Routine (daily audit)

**What this is:** a **read-only daily safety-net** that checks whether every *online* QuickBooks
Payments transaction (a customer paying an emailed invoice's card/ACH "pay now" link) has been
entered in UPR. Payments are supposed to be entered in UPR directly by staff; this only **flags the
ones someone forgot** — it never records a payment itself.

**Why it exists:** a stopgap until the real-time QBO Payment webhook + hourly poller are activated
(`functions/api/qbo-webhook.js`, `functions/api/qbo-payments-sync.js` — see
`QBO-PAYMENTS-WEBHOOK-SETUP.md`). Once those are live, this audit can be retired.

**Scope (owner decision):** ONLINE QuickBooks Payments **only**. Checks, cash, manual entries, and
UPR-originated payments are explicitly out of scope.

---

## 1. How to tell an online payment from everything else (verified against live data)

A QBO `Payment` object is a genuine **online QuickBooks Payments** transaction when **any** of these
are true:

- `ProcessPayment == true`, **or**
- `CreditCardPayment.CreditChargeResponse.Status == "Completed"` (card), **or**
- `TxnSource == "EInvoice"` (paid via the emailed invoice link), **or**
- `PrivateNote` starts with `"Paid via QuickBooks Payments"`.

**Exclude** (these are NOT online payments):

- `PrivateNote` starts with `"UPR payment ·"` → the payment **originated in UPR** and was pushed to
  QBO. It is already in UPR; never re-flag it.
- Checks / cash / manual entries — no card-processing block, `ProcessPayment: false`, notes like
  `"AFCU Check No. 0010 …"`, `"Reconstruction Deposit"`, or a `$0` amount.

> Example fingerprints from the live company (2026-07):
> - Online (flag if missing): `#5624 Nicholas Padilla $7,133.24` — `TxnSource: EInvoice`,
>   `CreditChargeResponse.Status: Completed`, note `"Paid via QuickBooks Payments: Payment ID 229418"`.
> - Not online (skip): `#5684 Virginia Roundy $16,927.36` — note `"UPR payment · INV-000031"`,
>   `ProcessPayment: false` (a UPR check pushed to QBO); `#5581 Tanra Hill $4,653.50` — note
>   `"AFCU Check No. 0010"` (a deposited check).

## 2. The daily procedure

Read-only. Uses the UPR MCP tools `qbo_query` (read QuickBooks) and `upr_select` (read UPR).

1. Determine today; set `SINCE` = today − 5 days (overlap absorbs weekends / a skipped run).
2. `qbo_query`:
   `SELECT Id, TxnDate, TotalAmt, CustomerRef, ProcessPayment, PrivateNote FROM Payment WHERE TxnDate >= '<SINCE>' ORDER BY TxnDate DESC MAXRESULTS 100`
   (the result also carries the `CreditCardPayment` / `TxnSource` fields).
3. Keep only the online payments (§1).
4. For each, `upr_select` on `payments` with
   `qbo_payment_id=eq.<Id>&select=id,invoice_id,amount,source`. A row present → already reconciled,
   skip.
5. Any online payment with **no** matching UPR `payments` row is a **discrepancy**. For context,
   read the applied invoice from the payment's `Line[].LinkedTxn` (`TxnType = "Invoice"`), look up
   that invoice's `DocNumber`, and whether a UPR invoice exists
   (`upr_select` invoices `qbo_invoice_id=eq.<invId>`). If the QBO invoice links to an `Estimate`,
   it's an online-deposit estimate conversion that often has no UPR invoice yet.
6. Report (this is the deliverable):
   - Discrepancies → one line each:
     `⚠️ $AMOUNT — CUSTOMER — card/ACH — DATE — QBO Payment #ID → invoice #DOCNUM — NOT in UPR (please enter it in UPR)` + a count and dollar total.
   - None → `✅ All N online QuickBooks payments since <SINCE> are reflected in UPR.`
   - If the QuickBooks/UPR tools are unavailable or a query fails → say the audit **could not run**;
     never report all-clear on a failure.

## 3. Setup — where the schedule lives

The routine needs the **QuickBooks connector** (and UPR data access) at fire time. A routine created
from a CCR/Claude Code session via the trigger API does **not** carry those connectors into its
fired sessions, so it can't reach QuickBooks. **Create it from the claude.ai Routines UI**, where the
connector attaches:

1. claude.ai → **Routines** → **New routine**.
2. Attach the **QuickBooks** connector (+ the UPR data connector).
3. Schedule: **daily, ~9:00 AM Mountain**.
4. Paste the prompt below.

<details>
<summary>Routine prompt (paste verbatim)</summary>

```
Daily QuickBooks → UPR ONLINE-PAYMENT reconciliation audit for Utah Pros Restoration.

PURPOSE: read-only safety-net that verifies every ONLINE QuickBooks Payments transaction (a customer
paying an emailed invoice's card/ACH "pay now" link) is reflected in UPR. Staff enter payments in UPR
directly; this only catches misses. Stopgap until the QBO Payment webhook + poller are activated.

RULES: READ ONLY — never insert/update/delete in UPR or QuickBooks; flag discrepancies for a human to
enter in UPR. Scope is ONLINE QuickBooks Payments only — exclude checks, cash, manual entries, and
UPR-originated pushes.

STEPS:
1. Today − 5 days = SINCE.
2. qbo_query: SELECT Id, TxnDate, TotalAmt, CustomerRef, ProcessPayment, PrivateNote FROM Payment
   WHERE TxnDate >= '<SINCE>' ORDER BY TxnDate DESC MAXRESULTS 100  (result also has CreditCardPayment/TxnSource).
3. Keep ONLY online payments: ProcessPayment==true OR CreditCardPayment.CreditChargeResponse.Status=="Completed"
   OR TxnSource=="EInvoice" OR PrivateNote starts with "Paid via QuickBooks Payments". EXCLUDE PrivateNote
   starting "UPR payment ·", and checks/cash/manual (no processing block).
4. For each, check UPR: upr_select payments qbo_payment_id=eq.<Id>&select=id,invoice_id,amount,source. Present = skip.
5. No matching UPR row = discrepancy. Add context: applied invoice from Line[].LinkedTxn (Invoice), its DocNumber,
   whether a UPR invoice exists (upr_select invoices qbo_invoice_id=eq.<invId>), and note estimate conversions.
6. Report: discrepancies as "⚠️ $AMT — CUSTOMER — card/ACH — DATE — QBO Payment #ID → invoice #DOCNUM — NOT in UPR
   (please enter it in UPR)" + count and total; else "✅ All N online QuickBooks payments since <SINCE> are in UPR";
   if the tools are unavailable/failed, say the audit COULD NOT run — never report all-clear.
```

</details>

**Fully hands-off alternative (no connector needed):** wire a real cron (external pinger or a small
Cloudflare Worker) to `GET https://utahpros.app/api/qbo-payments-sync` per
`QBO-PAYMENTS-WEBHOOK-SETUP.md` Part C. Note that endpoint currently imports **all** QBO payments
(not online-only) and **records** them automatically — the opposite of this audit's report-only,
online-only posture — so it fits "just make it work" better than "verify only."

## 4. First-run snapshot (2026-07-16, last ~26 days)

3 genuine online QuickBooks payments; 2 not yet in UPR:

| QBO Payment | Date | Amount | Customer | In UPR? |
|---|---|---|---|---|
| 5483 | Jun 23 | $750.00 | Virginia Roundy | ✅ yes (`source=qbo`) |
| 5624 | Jul 2 | $7,133.24 | Nicholas Padilla | ⚠️ **no — enter in UPR** (QBO inv #1194, from estimate) |
| 5770 | Jul 16 | $3,778.46 | Brady Hansen | ⚠️ **no — enter in UPR** |

(All checks / UPR-pushed payments in the window were correctly ignored.)
