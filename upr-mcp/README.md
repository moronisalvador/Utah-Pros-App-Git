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
```
The last two are optional — the `encircle_*` / `resend_*` tools simply return a
clear "not configured" error until their key is set.
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

> **Google / Workspace** (Gmail, Drive, Calendar) is intentionally **not** in
> this server — there is no Google data-API key here (the Google OAuth in this
> worker is only for owner *login*). Use the dedicated Gmail / Google Drive /
> Google Calendar MCP connectors in Claude for that; adding Workspace here would
> need separate Google OAuth scopes + consent.

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
