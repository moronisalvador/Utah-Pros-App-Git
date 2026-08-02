# Appointment Reminder Containment — Ownership

**Last-verified:** 2026-08-01

## Purpose

This manifest records the standalone, containment-only repair for the one-hour appointment
reminder incident. It authorizes repository work only. It does not authorize a hosted migration,
reminder activation, cron scheduling, Production deployment, provider traffic, or device traffic.

## Primary owner and release lane

- Primary task: the appointment-reminder task on branch
  `codex/mobile-readiness-appointment-reminder-fix`.
- Delivery vehicle: a standalone PR into `dev`, reconciled with current `origin/dev` by merge
  without rewriting history.
- The separate `codex/notification-producer-authorization` candidate may compose this source for
  review, but it is not the delivery vehicle for this inert reminder repair.
- The release coordinator owns merge sequencing. The primary task owns the standalone source,
  focused conflict checks, PR publication, and handoff evidence.

## Exact file ownership

- `UPR-Web-Context.md`
- `docs/integrations.md`
- `docs/testing-and-deployment.md`
- `functions/api/notify.js`
- `functions/api/notify.test.js`
- `functions/lib/apns.test.js`
- `functions/lib/notificationPresentation.js`
- `functions/lib/notificationPresentation.test.js`
- `supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql`
- `supabase/rollbacks/20260802040935_preserve_notify_emit_event_id.rollback.sql`
- `tests/qa/unit/appointment-reminder-delivery-contract.test.js`
- `.claude/rules/appointment-reminder-wave-ownership.md`
- `.claude/rules/initiative-status.md`
- `.claude/tooling-governance.json`

Shared hotspots with the separate five-producer authorization candidate are
`functions/api/notify.js`, `functions/api/notify.test.js`, `functions/lib/apns.test.js`,
`UPR-Web-Context.md`, `docs/testing-and-deployment.md`, and
`.claude/rules/initiative-status.md`. The release coordinator owns reconciliation of every shared
file. The standalone branch keeps the reminder outside that candidate's exact five guarded types
and must not absorb its unapplied migration or delivery-claim schema.

## Review roles

- `worker-security-reviewer`: audience, quiet-time failure, side effects, privacy flag, and
  activation-blocker review.
- `migration-safety-checker`: exact predecessor/replacement hashes, composition-aware rollback,
  containment, and migration hygiene.
- `anon-grant-auditor`: direct PUBLIC detection, browser-role denial, service-only execution, and
  secret-store non-exposure.
- `mobile-readiness-release-auditor`: final containment truth, release evidence, and unresolved
  activation gates.

## Frozen containment and activation gates

The reminder type stays disabled and the named cron stays absent. Activation requires, in separate
reviewed lanes: durable per-recipient/channel reminder claims for bell/PWA/email; server-authoritative
appointment-crew mutations with negative authorization proof; QA apply and behavior evidence; later
Production apply; a compatible Production Worker SHA; and provider/device receipt evidence.
