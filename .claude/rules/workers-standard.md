# Cloudflare Workers Standard

Linked from `CLAUDE.md`. **The law for the ~95 Cloudflare Pages Functions in `functions/api/` and their
shared libs in `functions/lib/`.** Born from the UX audit's worker census: 4 unauthenticated endpoints
not by design, ~8 money/campaign endpoints role-gated in the UI only, `requireAuth` copy-pasted 14×
+ ~20 inline, 0 outbound fetches with a timeout, `worker_runs` hand-rolled in 31 files. Audited by
`upr-pattern-checker` + `anon-grant-auditor` on any worker change.

> **Adoption note:** `functions/lib/{auth,http,worker-runs}.js` are being consolidated by the UX-Quality
> F-B phase (it deletes the inline copies). Until F-B merges, a Phase-0-style inline helper that mirrors
> `sync-encircle.js`/`process-scheduled.js` is the accepted interim; **new** workers use the lib once it
> exists.

## 1. Auth — never open by default

- Every worker with a side effect or that returns non-public data imports from `functions/lib/auth.js`:
  `requireUser` (valid Supabase session), `requireEmployee` (session → employee row), `requireRole(roles)`
  (employee role gate), `checkCronSecret` (scheduler `x-webhook-secret` vs `integration_config`). A local
  auth definition is a review failure once the lib exists.
- **UI role gates are not server gates.** Any endpoint that moves money, sends on behalf of the company,
  or exposes PII must enforce the SAME role predicate server-side that the UI enforces (e.g. billing →
  `['admin','manager']`, mirroring `src/lib/claimUtils.BILLING_EDIT_ROLES`). Verifying only that a token
  is valid is not enough — any employee session would pass.
- **Token verification** uses the **anon** project key as `apikey` on `GET {SUPABASE_URL}/auth/v1/user`
  with the caller's Bearer token (do not spell the service-role env-var name in a worker just to verify a
  token — it trips the secret scanner and isn't needed). Public-by-design endpoints (the
  `database-standard.md` §2 allowlist) are the only exceptions, each with a `// public: <reason>` comment.

## 2. Transport — every outbound call has a timeout

- All outbound `fetch` goes through `functions/lib/http.js` `fetchWithTimeout` (`AbortSignal.timeout`,
  15s default). Adopted inside the shared API libs (`twilio.js`, `quickbooks.js`, `email.js`,
  `callrail.js`) so workers inherit it. A raw un-timed `fetch` to a third party is a review failure (a
  hung Twilio/QBO call otherwise hangs the worker to its platform limit).

## 3. Idempotency

- External webhooks keep the claim-RPC dedup pattern (7/7 coverage today — do not regress it).
- Money mutations carry a **content-derived or client-supplied stable** idempotency key, never
  `Date.now()` (a per-attempt timestamp defeats dedup — a retry double-acts).

## 4. Telemetry

- Cron/webhook/scheduled workers record a `worker_runs` row via `functions/lib/worker-runs.js`
  (`recordWorkerRun` / `withRunRecording`) — no hand-rolled inserts. Console errors use a consistent
  `${workerName}:` prefix.

## 5. Response shape & data access

- New workers return `{ ok: true, … }` on success and `{ error }` on failure (frozen contracts like
  `send-message`'s `{ success }` stay as-is — don't reshape a live contract).
- Data access via `functions/lib/supabase.js` (service-role client); raw `rest/v1` fetches are banned in
  new code. Per-recipient loops use chunked `Promise.all`, not serial awaits.
- Never write DB-trigger-owned columns (`amount_paid`, `line_total`, `status`, `paid_at`, …) — the
  trigger owns them (BILLING-CONTEXT).
