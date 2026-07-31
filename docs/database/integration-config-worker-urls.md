# integration_config worker URLs — registry & ops check

**Last verified:** 2026-07-30

Every database-initiated call to our own Cloudflare workers reads its target URL from an
`integration_config` row. That row is **live configuration, not repository state** — several were
seeded to `dev.utahpros.app` by their migrations and later repointed by hand, and nothing in the
repo shows the current value. On **2026-07-30** exactly this went wrong:
`message_notification_outbox_worker_url` still pointed at `dev.utahpros.app`, the only notifier
woken for message push executed with Cloudflare **Preview** env vars, and Apple rejected every
production push (`DeviceTokenNotForTopic`) until an owner-authorized one-row repoint.

Two layers of defense, with different jobs:

1. **DB-side URL allowlists** (in each pg_net caller) stop a rewritten config row from becoming
   SSRF — the function refuses any URL except the two real UPR origins. They deliberately allow
   BOTH `dev.utahpros.app` and `utahpros.app`, so an allowlist does **not** catch the outage class.
2. **This ops check** catches the outage class: on production posture, every production-critical
   key must point at `utahpros.app`, because `dev.utahpros.app` executes with Preview env vars.

## Registry

Derived from `supabase/migrations/` 2026-07-30 — re-derive when auditing, don't trust this table
over the live catalog.

| `integration_config` key | Worker route | Database caller | URL allowlist | Production value must be |
|---|---|---|---|---|
| `callrail_event_recovery_worker_url` | `/api/process-callrail-events` | `wake_callrail_event_recovery_worker()` | ✅ (20260724002500) | `https://utahpros.app/api/process-callrail-events` |
| `gcal_worker_url` | `/api/google-calendar-sync` | `notify_google_calendar_sync(uuid,text,jsonb)` | ✅ authored 20260730214500 — **pending owner-authorized apply** | `https://utahpros.app/api/google-calendar-sync` |
| `message_notification_outbox_worker_url` | `/api/process-message-notification-outbox` | `wake_message_notification_outbox_worker()` | ✅ (20260724001500) | `https://utahpros.app/api/process-message-notification-outbox` |
| `notify_worker_url` | `/api/notify` | `notify_emit(text,jsonb)` | ✅ authored 20260730214500 — **pending owner-authorized apply** | `https://utahpros.app/api/notify` |
| `ops_health_worker_url` | `/api/ops-health` | `wake_ops_health_worker()` | ✅ (20260725190000) | `https://utahpros.app/api/ops-health` |
| `qbo_payments_sync_worker_url` | `/api/qbo-payments-sync` | `qbo_payments_sync_poll()` | ✅ (20260724180100) | `https://utahpros.app/api/qbo-payments-sync` |
| `qbo_worker_url` | `/api/qbo-sync-customer` | `notify_qbo_customer_sync()` — **no-op since 20260701** (Phase B gate) | n/a (caller never posts) | dormant; repoint if the trigger body is ever restored |
| `transcribe_call_worker_url` | `/api/transcribe-call` | two `pg_cron` command strings (`upr_calls_backfill_safety_net`, `upr_calls_reclassify_safety_net`) | ❌ **no allowlist** — the URL is inlined in the cron command; hardening deferred (see 20260730214500 header) | `https://utahpros.app/api/transcribe-call` |

## The ops check (read-only; owner or owner-authorized session)

Run against the production project during any incident triage, after any config repoint, and as a
periodic sanity check. Requires only read access to `integration_config` — no credentials beyond
that, no writes.

```sql
-- 1. Every worker-URL key at a glance.
SELECT key, value
FROM integration_config
WHERE key LIKE '%worker_url%'
ORDER BY key;

-- 2. The outage class: production-critical keys not pointing at production.
--    Expected result on production posture: ZERO ROWS.
SELECT key, value
FROM integration_config
WHERE key LIKE '%worker_url%'
  AND key <> 'qbo_worker_url'          -- dormant caller (no-op since 20260701)
  AND value NOT LIKE 'https://utahpros.app/api/%'
ORDER BY key;
```

Any row from query 2 means a database-initiated worker call executes on the dev deployment with
**Preview** env vars — the exact 2026-07-30 failure. Repointing a row is a live production config
change and is **owner-gated**, one row at a time, verified afterward with query 1.

## Adding a new worker-URL key

1. Seed the **production** URL (`https://utahpros.app/api/…`), not dev — the 2026-06/07 seeds that
   used dev are what left the latent outage behind.
2. The pg_net caller must carry the exact two-URL allowlist **and** the fail-closed secret check —
   copy `wake_ops_health_worker()` (20260725190000), don't invent a variant. Inlining the URL
   lookup in a `cron.schedule` command string skips the allowlist — put the call in a function.
3. Add the key to the registry table above and to the audit-query expectations in the same commit.
4. `tests/qa/unit/pg-net-worker-url-allowlists.test.js` guards the two 20260730214500 allowlists;
   extend it (or add a sibling) when a new allowlisted caller ships.
