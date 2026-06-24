# QBO Online Payments → UPR — Setup Runbook

**Goal:** when a client pays a QuickBooks invoice **online** (the "pay now" card/ACH link),
the payment flows into UPR automatically, updates the invoice balance/status, and is **never
duplicated** anywhere.

**Status of the code:** already shipped to production and **dormant** — the webhook receiver
acks `200` and does nothing until you set the verifier token below, so it is safe right now.
This runbook is the owner-side activation. Nothing here requires a code change.

**The two pieces you're turning on:**
1. `POST https://utahpros.app/api/qbo-webhook` — receives QBO Payment events in real time.
2. `GET  https://utahpros.app/api/qbo-payments-sync` — hourly safety-net poller that catches
   anything a webhook ever misses.

---

## Prerequisite — turn on QuickBooks Payments

In QuickBooks Online: **Settings (⚙) → Account and Settings → Payments** → connect/enable
**QuickBooks Payments** (card + ACH). This is what puts the **"pay now" link** on the invoices
you email, so customers can actually pay online. Your QBO OAuth connection to UPR is already in
place — no reconnect needed.

---

## Part A — Intuit Developer: subscribe the Payment webhook

1. Go to **https://developer.intuit.com** → sign in → **My Apps / Dashboard** → open your UPR app.
2. Left nav → **Production Settings → Webhooks** (use **Production**, not Development —
   `utahpros.app` talks to your live company).
3. **Endpoint URL:**
   ```
   https://utahpros.app/api/qbo-webhook
   ```
4. **Subscribe to the `Payment` entity** and check **all** of its operations:
   **Create, Update, Delete, Void, Merge.**
   (Delete/Void/Merge are what let UPR remove an imported payment if it's reversed in QBO.)
   - Leave **Invoice / Customer unchecked** — we deliberately sync payments only.
5. Click **Save**, then **copy the Verifier Token** shown on that page — you need it in Part B.
6. *(Optional — test on staging first)* You can instead point the endpoint at
   `https://dev.utahpros.app/api/qbo-webhook`, test on `dev`, then switch it to the production
   URL above. Intuit allows one endpoint URL per environment.

---

## Part B — Cloudflare: add the verifier token

1. Cloudflare dashboard → **Workers & Pages** → open your **Pages project** (the Utah-Pros app).
2. **Settings → Variables and Secrets** (a.k.a. Environment variables).
3. Add a new variable, **type: Secret (encrypted)**:
   - **Name:** `QBO_WEBHOOK_VERIFIER_TOKEN`
   - **Value:** the token you copied in Part A, step 5
4. Add it to **both** environments — **Production** *and* **Preview** (Preview covers `dev`).
5. **Redeploy both** — env-var changes don't take effect until a new deploy. Either push a commit,
   or in **Deployments**, on the latest Production *and* latest Preview deploys click
   **⋯ → Retry deployment**.

> Until this token is set, `qbo-webhook` safely **acks 200 and ignores** every event, so nothing
> breaks before you finish — it just stays dormant.

---

## Part C — Cloudflare: the hourly safety-net cron

The poller catches anything a webhook ever drops. Cloudflare **Pages** can't run cron itself, so
use the **same mechanism you already use for `process-scheduled`**. Pick one:

### Option 1 — External HTTP cron (simplest, no code)
In a scheduler such as **cron-job.org**, **EasyCron**, or **UptimeRobot**, create a job:
- **Method:** `GET`
- **URL:** `https://utahpros.app/api/qbo-payments-sync`
- **Schedule:** every 1 hour (`0 * * * *`)
- **Auth:** none needed (the endpoint just triggers an idempotent reconcile).

### Option 2 — A small Cloudflare Worker with a real cron trigger
Create a **separate Worker** (not the Pages project):

```toml
# wrangler.toml
name = "upr-qbo-poller"
main = "src/index.js"

[triggers]
crons = ["0 * * * *"]   # top of every hour
```

```js
// src/index.js
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch("https://utahpros.app/api/qbo-payments-sync"));
  }
};
```

Deploy with `npx wrangler deploy`.

> Whatever drives `process-scheduled` today — add this one beside it the same way.

---

## Part D — Why nothing ever duplicates (built-in safeguards)

Three layers, all already in the shipped code, guarantee each real payment is recorded **exactly
once** — even with the webhook *and* the hourly poller both running:

1. **Each webhook event is claimed once.** `claim_qbo_event` (the `qbo_events` table) records every
   event id; a re-delivered or duplicate webhook **no-ops**.
2. **Each QBO payment imports at most once.** The mapper **skips any QBO payment whose
   `qbo_payment_id` already exists on a UPR payment.** So whichever of {webhook, poller} runs
   second finds the payment already recorded and skips it — no duplicate.
3. **UPR's own payments never round-trip.** When UPR pushes a payment to QBO, QBO fires a webhook
   for that same payment — but it already carries that `qbo_payment_id` in UPR, so rule #2 skips
   it. **Only payments made *directly in QBO* (the online pay-now link) get imported.**

**Recording is correct** because the imported `payments` row (`source='qbo'`, linked to the
invoice by `qbo_invoice_id`) flows through the existing **`update_invoice_paid`** trigger, which
rolls it into `invoices.amount_paid` / `balance_due` / `status` and the job's collected total —
the same path as a manually recorded payment.

---

## Part E — Verify it end-to-end

1. Open an invoice in UPR (`/invoices/:id`) → **Save** → **Send invoice to customer**.
2. As the customer, open the email and **pay online** with the QBO pay-now link
   (use a small amount, or QuickBooks test mode, first).
3. Within a minute (webhook) — or within the hour (poller) — confirm in UPR: a payment appears,
   the **balance drops**, and status advances to **Partial / Paid**.
4. **Idempotency check:** in Intuit's dashboard, **re-send** that webhook event → confirm nothing
   changes (no second payment).
5. **Reversal check:** void/delete that payment in QBO → confirm the imported UPR payment is
   removed and the balance reopens.

---

## Reference — what's under the hood

| Piece | File | Notes |
|---|---|---|
| Webhook receiver | `functions/api/qbo-webhook.js` | HMAC-verifies `intuit-signature` vs `QBO_WEBHOOK_VERIFIER_TOKEN`; claims event via `claim_qbo_event`; mirrors `Payment` entities |
| Hourly poller | `functions/api/qbo-payments-sync.js` | open `GET`/`POST` + `scheduled()`; logs `worker_runs` as `qbo-payments-sync` |
| Shared mapper | `functions/lib/qbo-payment-sync.js` | QBO Payment → `payments` rows by `qbo_invoice_id`; dedup on `qbo_payment_id` |
| Signature verify | `functions/lib/intuit.js` | base64 HMAC-SHA256 |
| Schema | `supabase/migrations/20260624_qbo_payment_webhook.sql` | `qbo_events` table + `claim_qbo_event` RPC (applied) |

**Env var:** `QBO_WEBHOOK_VERIFIER_TOKEN` — distinct from the existing `QBO_WEBHOOK_SECRET`
(which is the internal DB-trigger secret, unrelated to Intuit).

**Card-processing direction (owner, Jun 24 2026):** "QBO now, Stripe later." QuickBooks Payments
(this pay-now path) is the active card processor; the dormant Stripe stack is held ready for a
future migration. Keep **UPR as the only writer to QBO** under either processor.
