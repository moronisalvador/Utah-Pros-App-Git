---
name: push-outage-2026-07-30-topic-mismatch
description: "2026-07-30 native push outage — dev-hosted outbox worker + Preview APNS_TOPIC mismatch; worker repointed to production (live config, not in repo)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a425ca0-8326-45fa-9b5a-86cfbefa9630
  modified: 2026-07-31T19:34:40.541Z
---

**2026-07-30 fleet-wide native message-notification outage — root cause and live state.**

- The message-notification outbox worker is woken by pg_cron (`wake_message_notification_outbox_worker()`) at the URL in `integration_config.message_notification_outbox_worker_url`. It pointed at `https://dev.utahpros.app/...` (Cloudflare **Preview** env vars) while every other worker URL points at production.
- Last night's UPR Dev app-variant to-do set Preview `APNS_TOPIC` for the dev bundle id (`com.utahprosrestoration.upr.dev`); the overnight dev redeploy activated it, and Apple then rejected every production-fleet push from dev with 400 `DeviceTokenNotForTopic` — non-retryable, non-pruned, invisible in `worker_runs.meta` (only counters, no reason strings). `docs/mobile/dev-app-variant.md:113-122` had warned about exactly this.
- **Fixed 2026-07-30 (~7:50pm MT) with explicit owner authorization:** one-row UPDATE repointing `message_notification_outbox_worker_url` to `https://utahpros.app/api/process-message-notification-outbox` (allowlisted in the wake function). This is LIVE CONFIG ONLY — no repo change records it; UPR-Web-Context update was offered but not committed in that session.

**Why:** production-critical notifiers must not ride the dev deployment; and one global `APNS_TOPIC` cannot serve two bundle ids (durable fix = per-token topic routing, spawned as a task).

**How to apply:** when debugging "pushes silently fail," check (1) which HOST the sending worker runs on (`integration_config` `*_worker_url` rows + `cron.job`), (2) `POST /api/send-push` (owner-only) on BOTH origins — its response carries Apple's verbatim per-token `reason`, which no table persists. `worker_runs.meta.native` counters decode: attempted>0 + sent=0 + retryable=0 + pruned=0 ⇒ hard 4xx; pruned only increments on 410/BadDeviceToken, so 400-without-prune ⇒ topic-class rejection. A dispatch that produces NO `native_push_delivery_claims` rows died before the send loop (e.g. `token_lookup_failed` selecting a not-yet-migrated column).

**2026-07-31 follow-up (owner-authorized):** the CallRail **call** webhooks (all five call events, integration id 2683808) pointed at dev.utahpros.app — phone-call `lead.new` pushes were dead for the same reason. Repointed to `https://utahpros.app/api/callrail-webhook?secret=...` via the CallRail API; texts stayed dual-host (secret validates against shared-DB `integration_config('callrail_webhook_secret')`, so the swap was host-safe). Provider-console webhook URLs are the third host-selector class alongside `integration_config` rows and browser origin. **2026-07-31 afternoon — CLOSED OUT:** all four pending migrations applied under explicit owner authorization (per-token topic → ledger `20260731154315`, allowlists → `20260731165215`, transcribe-cron → `20260731174734`, OOP builder → `20260731175328`), provenance mappings + evidence refreshed, and dev→main promoted (PR #564, merged 19:34Z). Per-token topic routing is fully live end to end; dev-origin native dispatch works again. Remaining external items: Codex's Cloudflare Preview `APNS_TOPIC` restore + App Store Connect Xcode Cloud pause (owner delegated to GPT Codex — confirm its report). Related: [[ios-sim-panel-metal-crash]]
