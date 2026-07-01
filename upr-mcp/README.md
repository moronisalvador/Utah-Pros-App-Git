# UPR MCP — private remote MCP server (QuickBooks + UPR database)

This is a standalone Cloudflare Worker that exposes a **Model Context Protocol**
server so you can drive QuickBooks Online *and* the UPR (Supabase) database from a
Claude chat — e.g. *"move both payments off invoice 1250 onto R-2604-009"* or
*"mark job R-2604-009 as collected."*

It is **locked to a single owner** via Google login (`ALLOWED_EMAIL`), every call
is **audit-logged**, every write needs **explicit confirmation**, and there is a
one-row **kill switch**.

> It is **not** part of the Pages app and does **not** add any page to UPR. It
> deploys separately with `wrangler`.

## Two OAuth layers (only the first is new)

1. **You → this MCP server.** Google login, allowlisted to your email. This is what
   we set up below.
2. **This server → QuickBooks.** Reuses UPR's *existing* connection — the tokens
   already in Supabase `integration_credentials`. No second QBO authorization.

The Supabase service-role key is what gives full UPR database access, which is
exactly why the whole server is owner-locked.

---

## One-time setup

### 0. Prereqs
- Node + the Cloudflare `wrangler` CLI, logged in (`npx wrangler login`).
- The Supabase **service-role** key and the Intuit app's **client id/secret**
  (the same ones UPR already uses).

### 1. Install
```bash
cd upr-mcp
npm install
# if the pinned versions are stale:
# npm install @cloudflare/workers-oauth-provider@latest wrangler@latest
```

### 2. KV namespace (stores OAuth grants/tokens)
```bash
npx wrangler kv namespace create OAUTH_KV
```
Paste the returned `id` into `wrangler.toml` under `[[kv_namespaces]]`.

### 3. First deploy (to learn your worker URL)
```bash
npx wrangler deploy
```
Note the URL, e.g. `https://upr-mcp.<your-subdomain>.workers.dev`.

### 4. Google OAuth client
In Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID**
(type *Web application*):
- Authorized redirect URI: `https://upr-mcp.<your-subdomain>.workers.dev/callback`
- Copy the **Client ID** and **Client secret**.

### 5. Secrets
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put QBO_CLIENT_ID
npx wrangler secret put QBO_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY   # e.g. `openssl rand -hex 32`
npx wrangler secret put ENCIRCLE_API_KEY        # for the encircle_* tools (same token the Pages functions use)
npx wrangler secret put RESEND_API_KEY          # for the resend_* email tools (same token the Pages functions use)

# ── Optional: the newer integration modules (each dormant until its secret is set) ──
# CallRail + Deepgram need NO secret here — they reuse the tokens already stored in
# Supabase integration_credentials (providers 'callrail' / 'deepgram').
npx wrangler secret put STRIPE_SECRET_KEY               # stripe_* tools
npx wrangler secret put TWILIO_ACCOUNT_SID              # twilio_* tools
npx wrangler secret put TWILIO_AUTH_TOKEN
# npx wrangler secret put TWILIO_MESSAGING_SERVICE_SID  # (optional) preferred SMS sender
# npx wrangler secret put TWILIO_PHONE_NUMBER           # (optional) fallback From number
npx wrangler secret put GOOGLE_ADS_CLIENT_ID            # google_ads_* tools (refreshes the stored token)
npx wrangler secret put GOOGLE_ADS_CLIENT_SECRET
npx wrangler secret put GOOGLE_ADS_DEVELOPER_TOKEN
npx wrangler secret put GOOGLE_ADS_CUSTOMER_ID
# npx wrangler secret put GOOGLE_ADS_LOGIN_CUSTOMER_ID  # (optional) MCC/manager account
npx wrangler secret put META_APP_ID                     # meta_ads_* tools (re-exchanges the stored token)
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_AD_ACCOUNT_ID
npx wrangler secret put GITHUB_TOKEN                    # github_* tools (a PAT)
# npx wrangler secret put GITHUB_DEFAULT_REPO           # (optional) "owner/repo" default
```
`ENCIRCLE_API_KEY` / `RESEND_API_KEY` and every secret in the block above are
optional — each integration's tools simply return a clear "not configured" (or
"not connected in UPR") error until the relevant secret / stored credential is
present.
Confirm `ALLOWED_EMAIL` in `wrangler.toml` is your address, then redeploy:
```bash
npx wrangler deploy
```

### 6. Apply the database migration
Apply `supabase/migrations/20260622_upr_mcp_audit.sql` (creates `upr_mcp_audit`
and the `upr_mcp_enabled` kill-switch row).

### 7. Add it to Claude
Add a **custom connector** pointing at your MCP endpoint:
```
https://upr-mcp.<your-subdomain>.workers.dev/mcp
```
Claude runs the OAuth flow automatically → you'll get a Google login → only
`ALLOWED_EMAIL` is accepted. After that the tools appear in chat.

---

## Tools

**QuickBooks (read):** `qbo_query` (any SELECT), `qbo_get`, `qbo_list_invoices`,
`qbo_list_payments`, `qbo_list_estimates`, `qbo_report`
**QuickBooks (write):** `qbo_create_invoice`, `qbo_update_invoice`,
`qbo_delete_invoice` *(refuses invoices with payments)*, `qbo_send_invoice`,
`qbo_create_payment`, `qbo_relink_payment` *(move a payment between invoices)*,
`qbo_delete_payment`, `qbo_create_customer`, `qbo_update_customer`,
`qbo_create_item`, `qbo_create_estimate`, `qbo_send_estimate`, and generic
`qbo_create_entity` / `qbo_update_entity` / `qbo_delete_entity` *(reach any QBO
entity)*.

**UPR database (Supabase):** `upr_schema` / `upr_describe` (discover tables +
RPCs), `upr_select` (PostgREST query), `upr_sql` *(read-only raw SQL — SELECT/WITH
only, for aggregates/joins; needs the `exec_read_sql` DB function from
`supabase/migrations/20260627_exec_read_sql.sql`)*, `upr_search` (cross-entity
text search), `upr_rpc` (read or, with confirm, any mutating function),
`upr_insert`, `upr_upsert`, `upr_update`, `upr_delete` (writes require a filter +
confirm).

**Encircle (read):** `encircle_get_claim` (by `encircle_claim_id` → full claim
incl. `created_at`, the true claim-filed date), `encircle_list_claims`
*(search by policyholder / CLM# / etc. + paging)*, `encircle_list_media`,
`encircle_list_notes`, `encircle_list_assignments`, `encircle_list_structures`,
`encircle_list_rooms`, `encircle_webapp_link` (deep link), and generic
`encircle_get` (any GET path).
**Encircle (write):** `encircle_update_claim` *(write our CLM# / dates back)*,
`encircle_create_claim`, `encircle_create_note`, `encircle_assign_user`,
`encircle_unassign_user`, and generic `encircle_request` *(any method/path)*.
Requires the `ENCIRCLE_API_KEY` secret on the worker.

**Resend (email — test/troubleshoot/drive):** `resend_send_test_email` *(sends a
real email — guarded)*, `resend_get_email` (delivery status by id),
`resend_list_domains` / `resend_get_domain` (DKIM/SPF/DMARC status),
`resend_verify_domain`, and generic `resend_get` / `resend_request` *(any
endpoint — batch send, audiences, broadcasts, api-keys)*. Requires the
`RESEND_API_KEY` secret on the worker.

**CallRail (call tracking) + Deepgram (transcription):** `callrail_list_calls`,
`callrail_get_call`, `callrail_list_form_submissions`, `callrail_get_recording`
*(resolve a signed audio URL)*, `callrail_transcribe` *(guarded — paid Deepgram
call)*, and generic `callrail_get` / `callrail_request`. Reuses the `callrail` /
`deepgram` keys already in `integration_credentials` — no worker secret needed;
the CallRail account id is resolved automatically.

**Stripe (card payments + payouts):** `stripe_get_balance`, `stripe_list_charges`,
`stripe_retrieve_charge`, `stripe_list_payouts`, `stripe_list_external_accounts`,
`stripe_create_payout` *(moves real money — guarded)*, `stripe_create_payment_link`
*(guarded)*, and generic `stripe_get` / `stripe_request`. Requires `STRIPE_SECRET_KEY`.

**Twilio (SMS/MMS):** `twilio_list_messages`, `twilio_get_message`,
`twilio_send_sms` *(sends a real text — guarded)*, and generic `twilio_get` /
`twilio_request`. Requires `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`.

**Google Ads / Meta Ads (spend reporting):** `google_ads_campaign_spend`,
`google_ads_query` *(raw GAQL)*, `meta_ads_insights`, `meta_ads_get` *(any Graph
read)*. Reuse the `google_ads` / `meta_ads` OAuth tokens already stored in
`integration_credentials`; each also needs its app-credential + account-id secrets
(see setup). Read-only.

**GitHub (repo / PRs / issues / commits):** reads — `github_list_prs`,
`github_get_pr`, `github_list_issues`, `github_search_code`, `github_get_file`
*(the REST "pull")*, `github_list_commits`, `github_get_commit`,
`github_list_branches`, generic `github_get`; guarded writes — `github_merge_pr`,
`github_create_pr`, `github_update_pr`, `github_create_branch`,
`github_commit_file` *(the REST "push")*, `github_create_issue`,
`github_add_comment`, generic `github_request`. A Worker has no git binary, so
"push/pull" are the Contents/Git-data API, not raw git.
**Token:** read from `integration_credentials` (provider=`github`) first — set it on
the app's **admin API-keys page** (`/admin/integrations`), no `wrangler` needed —
falling back to a `GITHUB_TOKEN` worker secret. Default repo comes from
`integration_config.github_default_repo` (also set on that page) or
`GITHUB_DEFAULT_REPO`. The PAT needs **Contents R/W, Pull requests R/W, Issues
R/W** (fine-grained), or classic `repo`.

> **Google Workspace** (Gmail, Drive, Calendar) is intentionally **not** in this
> server — there is no Workspace data-API key here (the Google OAuth in this
> worker is only for owner *login*). Use the dedicated Gmail / Google Drive /
> Google Calendar MCP connectors in Claude for that; adding Workspace here would
> need separate Google OAuth scopes + consent. **Google Ads is separate** from
> Workspace — it uses its own developer-token app and the company-wide
> `google_ads` connection, so it *is* included above.

Every **[WRITE]** tool, called without `confirm: true`, returns a **preview** of
exactly what it would change and does nothing — call again with `confirm: true`
to execute. The generic **power tools** (`*_get` / `*_request` / `*_entity`)
make the server capable of essentially any QBO / Encircle / Resend / Supabase
operation even when there is no dedicated named tool.

## Security

- **Owner-only:** Google login allowlisted to `ALLOWED_EMAIL`, re-checked on every
  tool call.
- **Audit:** all calls (read + write, preview + execute) land in `upr_mcp_audit`.
- **Kill switch:** `UPDATE integration_config SET value='false' WHERE key='upr_mcp_enabled';`
  disables all tool calls instantly.
- **Confirmation:** no write touches QBO or the DB without `confirm: true`.

## Caveat

This worker couldn't be live-tested from the environment it was authored in
(no outbound network). The OAuth wiring follows the documented
`@cloudflare/workers-oauth-provider` API; if your installed version differs,
the `parseAuthRequest` / `completeAuthorization` calls in `src/auth.js` and the
`OAuthProvider` options in `src/index.js` are the only spots to adjust. `wrangler
tail` shows live logs during the first connect.
