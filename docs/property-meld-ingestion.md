# Property Meld — live meld ingestion (owner setup)

We're a **vendor** in our property-manager client's Property Meld (no vendor API), but we get an
email for every Meld (work order). The `POST /api/inbound-meld` worker turns those emails into rows
in `property_meld_melds` and pushes the owner when a new restoration meld arrives. This doc is the
one-time setup to feed it. Nothing here needs a code change — it's config on your side.

## What the worker does (recap)
- Parses each email (`functions/lib/property-meld.js`), keeps **restoration** melds only
  (account `83074`); carpet-cleaning (`51865`) and daily digests are dropped.
- Upserts idempotently by meld number (re-sending the same email is safe).
- On a meld's **first** assignment, sends the owner a bell + push (`meld.received`).

## Step 1 — set the shared secret
Pick a long random string. In the **Cloudflare Pages** project → Settings → Environment variables,
add `INBOUND_MELD_SECRET` to **both** the Production and Preview sets, then redeploy.
The forwarder must send it as the `x-meld-secret` header; requests without it get `401`.

## Step 2 — forward Property Meld emails (recommended: Gmail Apps Script)
No Cloudflare Email Routing / MX changes needed. In the Gmail account that receives the melds:

1. Go to <https://script.google.com> → New project. Paste the script below.
2. Set `ENDPOINT` (use `https://dev.utahpros.app/api/inbound-meld` to test on staging first, then
   switch to the production domain) and `SECRET` (the value from Step 1).
3. Run `forwardMelds` once and grant the Gmail + external-request permissions.
4. Add a **time-driven trigger** (clock icon → Add Trigger → `forwardMelds`, every 5–15 minutes).

```javascript
// Property Meld → UPR ingestion. Forwards Property Meld emails to the inbound-meld worker.
const ENDPOINT = 'https://dev.utahpros.app/api/inbound-meld'; // swap to prod when ready
const SECRET   = 'PASTE_INBOUND_MELD_SECRET';                 // must match Cloudflare env

function forwardMelds() {
  // Only recent, not-yet-sent Property Meld mail. The worker is idempotent, so
  // an accidental resend is harmless — the label just avoids extra requests.
  const label = GmailApp.getUserLabelByName('upr-melds-sent') || GmailApp.createLabel('upr-melds-sent');
  const threads = GmailApp.search('from:msg.propertymeld.com newer_than:2d -label:upr-melds-sent', 0, 50);

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      const payload = {
        from: m.getFrom(),                 // "Property Meld <uuid@msg.propertymeld.com>"
        subject: m.getSubject(),
        text: m.getPlainBody(),
        received_at: m.getDate().toISOString(),
      };
      UrlFetchApp.fetch(ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-meld-secret': SECRET },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
    });
    thread.addLabel(label);
  });
}
```

### Alternative — Cloudflare Email Routing
If you'd rather not use Apps Script: create an Email Routing address (e.g. `melds@utahpros.app`)
bound to a small Email Worker that POSTs `{ from, subject, text, received_at }` to the same endpoint
with the `x-meld-secret` header, then add a Gmail filter forwarding `from:msg.propertymeld.com` to
that address. (Same request shape; more moving parts than the Apps Script.)

## Endpoint contract
`POST /api/inbound-meld` · header `x-meld-secret: $INBOUND_MELD_SECRET`

Body — a single email **or** a batch:
```json
{ "from": "...", "subject": "...", "text": "...", "received_at": "2026-07-08T15:00:00Z" }
```
```json
{ "emails": [ { "from": "...", "subject": "...", "text": "...", "received_at": "..." } ] }
```
Response: `{ ok, processed, ingested, new_count, notified, results: [...] }`.
Non-restoration melds and digests return `ingested:false` (with `business` / `needs_review`).
