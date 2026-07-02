# UPR Platform — Security & Bug Audit
**Date:** 2026-07-01 · **Branch:** `claude/security-bug-audit-uonb4b` · **Scope:** full codebase — 48 Cloudflare workers, 191 frontend files, 67 SQL migrations, live Supabase security advisors.

Status legend: **✅ FIXED** (in this PR) · **🔶 MIGRATION** (SQL delivered in `supabase/migrations/20260701_security_hardening_revoke_anon.sql` — apply on `dev` first) · **📋 FOLLOW-UP** (documented, needs schema-aware change or a product decision).

---

## Executive summary

The application code has one consistent, high-impact weakness: **authorization is enforced in the UI, not on the server.** Cloudflare workers run with the Supabase service-role key (which bypasses Row-Level Security), and the frontend talks to PostgREST with the **public anon key** — so the real security boundary is server-side worker checks and database RLS/grants, and both were too loose.

The two worst themes:
1. **Unauthenticated access.** Several Encircle worker endpoints had *no auth at all* (anyone could `curl` policyholder PII), and a large set of `SECURITY DEFINER` RPCs is granted to `anon`, so anyone with the public anon key can read the whole business — customers, claims, jobs, invoices, payments, **employee pay rates** — and call payroll "admin" functions, all without logging in.
2. **Authentication ≠ authorization.** Money and financial endpoints (Stripe payouts, QBO) accepted *any* valid session, so the lowest-privilege field tech (or a self-signup account) could trigger payouts or dump QuickBooks.

This PR fixes all the **worker-layer** issues and ships HTTP security headers. The **database-layer** issues (anon grants, `USING(true)` RLS, self-promote-to-admin) are the most severe but sit on a single shared dev+prod Supabase, so they're delivered as a reviewed migration + a documented remediation plan rather than blind-applied.

**Good news, verified:** no secrets are committed; dependencies are clean; Stripe/QBO/Twilio *inbound* webhooks correctly verify signatures; e-sign tokens are unguessable (122-bit UUIDs); there are no reachable XSS sinks and no SSRF; `admin-users` and `billing-2fa` are already correctly role-gated.

---

## Critical

### C1. Unauthenticated Encircle endpoints leak claim PII / allow tampering — ✅ FIXED
`encircle-search`, `encircle-rooms`, `encircle-upload`, and `sync-encircle` (POST) had no authentication. `GET /api/encircle-search` returned the newest property claims (name, address, phone, email, insurer, policy #) to anyone; `encircle-upload` let anyone write notes into any Encircle claim; `sync-encircle` POST forced service-role DB writes. **Fix:** all four now require a valid staff session (`requireEmployee`/`requireAuth`); `TechDemoSheet` updated to send the auth header so the Scope Sheet still works.

### C2. Unauthenticated data exposure via `anon`-granted RPCs — 🔶 MIGRATION
`global_search`, `get_ar_invoices`, `get_payments_ledger`, `get_job_financials`, `get_timesheet_entries_admin` (pay rates + labor cost), `get_water_loss_report_data`, `get_estimates`, `get_upr_mcp_audit`, `get_notifications`, `get_tech_feedback` are `SECURITY DEFINER` and granted to `anon`. `POST /rest/v1/rpc/global_search {"p_term":"a","p_limit":100000}` with only the public anon key dumps the CRM/AR/payments book — no login. Confirmed live (`get_advisors`: 243 anon-executable definer functions). **Fix:** the migration revokes `anon` EXECUTE on these (logged-in `authenticated` users are unaffected). Also cap the caller-controlled `LIMIT` in `global_search`.

### C3. Payroll fraud via time-entry "admin" RPCs — 🔶 MIGRATION + 📋 FOLLOW-UP
`admin_upsert_time_entry`, `admin_clock_out_entry`, `delete_time_entry`, `review_time_entry_change_request` authorize on a **client-supplied `p_actor_id`** (`is_time_admin(p_actor_id)`) and are granted to `anon`. Anyone who knows one admin UUID can forge/inflate/delete timesheets and self-approve change requests. **Fix (partial):** migration revokes `anon` (shrinks exposure from "anyone" to "any authenticated employee"). **Follow-up:** rewrite the function bodies to resolve the actor from `auth.uid()`, never a parameter.

### C4. Client-only access control + `USING(true)` RLS = mass IDOR — 📋 FOLLOW-UP
Route guards and `canAccess()` only hide UI. The frontend reads/writes PostgREST directly with the user JWT, and **127 tables carry `USING (true) WITH CHECK (true)` policies** (confirmed live). So any authenticated user — including a `field_tech` — can `db.select('payments','select=*')`, `db.update('jobs','id=eq.<any>',{...})`, etc. **Follow-up:** replace blanket policies with `auth.uid()`-scoped ones (the repo already does this correctly in `private_appointments` / `google_calendar_sync` — copy that pattern), starting with `payments, invoices, invoice_line_items, contacts, employees, claims, jobs, sign_requests, messages, conversations`.

### C5. Self-promote to admin via `employees` UPDATE — 📋 FOLLOW-UP
`employees` has an always-true policy for `authenticated` (confirmed live). Because RLS is the only gate, any user can `db.update('employees','id=eq.<self>',{role:'admin'})` and gain the full admin surface. (The UI correctly routes role changes through `/api/admin-users`, and no frontend code writes `employees` directly — so a restrictive policy is safe.) **Follow-up:** restrictive `employees` policy that forbids a row changing its own `role`/permission columns; keep writes on the admin worker.

---

## High

### H1. Broken access control on Stripe money endpoints — ✅ FIXED
`stripe-payout`, `stripe-accounts`, `stripe-pay-link` accepted any valid session (`return res.ok`), despite comments admitting "the UI gates to admins/managers." A field tech could force Instant Payouts (draining the balance + fees), enumerate the company bank/debit-card list, or mint checkout links. **Fix:** now require `admin`/`manager` server-side (`BILLING_ROLES`, matching the UI's `BILLING_EDIT_ROLES`).

### H2. Broken access control on QBO endpoints — ✅ FIXED (+ 📋 role-gating)
`qbo-query` (mass exfil of QBO customers/financials), `qbo-invoice` (delete / email an invoice to an attacker-chosen `send_to`), `qbo-estimate`, `qbo-payment`, `qbo-sync-customer`, `qbo-payments-sync` accepted any session. **Fix:** all now require an active employee (`requireEmployee`), which closes the self-signup / non-employee path; the server-to-server `x-webhook-secret` bypass is preserved. **Follow-up:** the billing routes are feature-flag-gated (not role-gated), so consider tightening these to billing roles, and allowlist `qbo-invoice`'s `send_to` to the invoice contact's email.

### H3. `set_billing_setting` anon + payout-key ordering re-opens 2FA'd keys — 🔶 MIGRATION + 📋
`set_billing_setting` is granted to `anon`, and a later migration re-adds the `stripe_payout_*` keys the email-2FA migration removed from the writable set — so the payout destination is writable via `anon`, bypassing the `billing-2fa` worker. **Fix:** migration revokes `anon` on `set_billing_setting`. **Follow-up:** confirm the four `stripe_payout_*` keys are excluded from the writable whitelist as the final state, and keep them writable only by the 2FA worker (service role).

### H4. Systemic PostgREST filter injection — 📋 FOLLOW-UP
`src/lib/supabase.js` interpolates values straight into PostgREST filter strings with no encoding; ~90 call sites pass route params/ids/free-text unencoded (notably `TechAppointment.jsx:156` inside an `or=()` group, and free-text `ilike` in `DevTools.jsx:1026`). Bounded today by the (loose) RLS, but a live footgun — one refactor that puts user text in a non-unique filter becomes a broadened read/delete. **Follow-up:** add an encoding boundary in the client (`encodeURIComponent` values) and/or validate id route params as UUIDs.

### H5. Sensitive documents in PUBLIC storage buckets — 📋 FOLLOW-UP
`job-files` and `message-attachments` are public buckets with broad SELECT policies allowing **listing all files** (confirmed live). Some UI builds `/storage/v1/object/public/job-files/...` URLs — world-readable, access relies on URL secrecy. Insurance auth forms, signed work-auth PDFs, and interior home photos are exposed to anyone with a path. **Follow-up:** drop the broad listing policies; move claim media to a private bucket served via short-TTL signed URLs.

---

## Medium

- **M1. `qbo-charge` amount tampering — ✅ FIXED.** Charged a client-supplied amount with no ceiling. Now rejects any amount above the invoice's outstanding balance; also requires an active employee.
- **M2. `twilio-status` unauthenticated webhook — ✅ FIXED.** No signature check let anyone forge delivery/read-status writes. Now verifies the Twilio HMAC (fails closed if the token is unset), matching `twilio-webhook`.
- **M3. `send-message` `skip_compliance` TCPA bypass — ✅ FIXED.** A client flag skipped the DND/opt-out consent gate. Now only honored for trusted server-to-server callers with the internal secret (no first-party UI sends it).
- **M4. `collections-chat` / `analyze-xactimate` authz — ✅ FIXED.** Both exposed data (full A/R, live QBO balances, labor cost; arbitrary `job-files` reads + Opus spend) to any session. Now require an active employee. **Follow-up:** `analyze-xactimate` should also verify the `file_path` belongs to the caller's invoice/job; `generate-water-loss-report` should allowlist `email_to`.
- **M5. Google Drive OAuth `state` is a global singleton — 📋.** `gdrive_oauth_state`/`gdrive_oauth_user` are single shared rows; concurrent connects can bind one user's Google tokens to another's account. Key the state per employee (or sign it).
- **M6. Feature-flag access control fails OPEN — 📋.** On a `get_feature_flags` load error the client treats every flag as enabled, and `force_disabled` evaluates falsy — a blocked XHR opens all gated pages. Fail closed for gating.
- **M7. No Content-Security-Policy / security headers — ✅ FIXED (headers) + 📋 (CSP).** Added `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS, `Permissions-Policy`, and a **Report-Only** CSP (non-enforcing so it can't break the app or the iOS WebView). Promote the CSP to enforcing after monitoring — important because the Supabase access+refresh token lives in `localStorage`.

---

## Low / hardening

- **L1. `process-scheduled` unauthenticated manual trigger — 📋.** GET/POST run the SMS queue with no auth (only sends already-due `pending` messages, so low impact). Not gated here because the cron path may use the HTTP endpoint; add a shared secret coordinated with the cron config.
- **L2. Twilio signature compare not constant-time — 📋** (`twilio.js` uses `===`; Stripe/Intuit use constant-time).
- **L3. `billing-2fa` has no attempt limit — 📋** on the 6-digit code (admin/manager-gated, so low risk).
- **L4. Service-role key falls back to the anon key — 📋** in several workers (`SERVICE_ROLE_KEY || ANON_KEY`); require it explicitly for data operations.
- **L5. Session JWT + refresh token in `localStorage` — 📋** (framework default; mitigate with the CSP above and, on iOS, a Keychain storage adapter — already noted in `nativeBiometric.js`).
- **L6. SVG upload via prefix check + public bucket — 📋** (bounded: served from the separate `*.supabase.co` origin). Force `nosniff`/attachment for SVGs.
- **L7. `.gitignore` gaps — ✅ FIXED.** Now ignores `.env.*` (keeping `.env.example`) and key/cert file types.
- **L8. Mutable `search_path` on 18 functions — 🔶 MIGRATION.** Pinned to `public, pg_temp`.
- **L9. Supabase leaked-password protection disabled — 📋.** Enable HaveIBeenPwned checks in Auth settings.
- **L10. Verify Supabase email self-signup is DISABLED — 📋.** If it's on, C2/H1/H2 were internet-unauthenticated before this PR; `requireEmployee` now blocks non-employee accounts at the worker layer, but confirm the setting regardless.

---

## Verified safe (checked, not vulnerable)

- **Secrets & deps:** no live secret committed anywhere (JWT/`service_role`/`sk_live` scans clean); dependencies current, all from npm, no malicious install scripts; no prod sourcemaps; CI uses `pull_request` (not `pull_request_target`).
- **Inbound webhooks:** `stripe-webhook` (HMAC + timestamp tolerance + idempotency), `qbo-webhook` (intuit-signature), `twilio-webhook` (X-Twilio-Signature, fail-closed) all verify correctly.
- **E-sign:** signing tokens are 122-bit random UUIDs (not guessable/forgeable); `submit-esign` rejects already-signed/expired requests.
- **Already role-gated correctly:** `admin-users` (verifies JWT **and** `role='admin'`), `billing-2fa` (admin/manager + emailed single-use 10-min code).
- **Frontend injection:** no reachable XSS — all 8 `dangerouslySetInnerHTML` sinks render static developer-authored content; the AI/customer renderers emit React elements (auto-escaped). No `eval`/SSRF/open-redirect; `devLogin` is compiled out of production.
- **`exec_read_sql`:** service-role only, single-statement read-only — not client-reachable.

---

## Database remediation plan (apply order)

The one shared Supabase (dev **and** main) means every change hits both. Sequence:
1. **Apply the delivered migration on `dev`** (`20260701_security_hardening_revoke_anon.sql`) — revokes `anon` on sensitive RPCs and pins `search_path`. Verify dashboards/leads/e-sign still work, then it's safe for main.
2. **Fix time-entry actor-id (C3):** resolve the actor from `auth.uid()` in the function bodies.
3. **Restrictive `employees` policy (C5):** block self role change.
4. **Scope the `USING(true)` policies (C4)** on the sensitive tables to `auth.uid()`-based rules, one table at a time with testing.
5. **Private buckets / signed URLs (H5)** and remove the broad storage listing policies.
6. **Verify `set_billing_setting` payout-key exclusion (H3).**

Full per-agent detail (workers, DB/RLS, frontend auth, XSS, secrets) was produced during the audit; this document is the consolidated, deduplicated result.
