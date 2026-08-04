# Appointment Reminder Containment — Ownership

**Last-verified:** 2026-08-03

## Purpose

This manifest records the one-hour appointment-reminder incident repair and its bounded activation
prerequisites. It authorizes repository work only. It does not authorize a hosted migration,
reminder activation, cron scheduling, Production deployment, provider traffic, or device traffic.

## Primary owner and release lane

- Containment source from `codex/mobile-readiness-appointment-reminder-fix` landed through PR #571
  and is now in both `dev` and `main`.
- The five-producer authorization source landed through PR #573 and PR #577 and is now in both
  `dev` and `main`; its two migrations remain QA-only and unapplied to the shared project.
- The current activation-prerequisite task owns
  `codex/mobile-readiness-reminder-activation`, qualified at exact clean commit
  `1d3c987dd4e5ce3c31ff333b387757dea5d82856`. Its implementation
  `1cc1840dfe408b1b4d4f6e61b7b199958e692d2a` was reconciled without history rewriting through
  merge `6f6aa8a2d25bedc4dc9ab75753005d2b004e51dc`, whose second parent is exact
  `origin/dev@1eef7b5806dbd65a30482b35e3c666333ab8f585`.
- The current wave remains inert: source may be reviewed and qualified, but hosted apply,
  application promotion, enablement, scheduling, provider calls, and device traffic require
  separate owner checkpoints.

## Exact file ownership

- `UPR-Web-Context.md`
- `docs/integrations.md`
- `docs/testing-and-deployment.md`
- `functions/api/notify.js`
- `functions/api/notify.test.js`
- `functions/lib/apns.js`
- `functions/lib/apns.test.js`
- `functions/lib/notificationPresentation.js`
- `functions/lib/notificationPresentation.test.js`
- `supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql`
- `supabase/rollbacks/20260802040935_preserve_notify_emit_event_id.rollback.sql`
- `tests/qa/unit/appointment-reminder-delivery-contract.test.js`
- `supabase/migrations/20260803221500_notification_activation_prerequisites.sql`
- `supabase/rollbacks/20260803221500_notification_activation_prerequisites.rollback.sql`
- `tests/qa/unit/notification-activation-prerequisites.test.js`
- `supabase/migrations/20260803223000_appointment_reminder_delivery_claims.sql`
- `supabase/rollbacks/20260803223000_appointment_reminder_delivery_claims.rollback.sql`
- `tests/qa/unit/appointment-reminder-activation-contract.test.js`
- `supabase/tests/appointment_reminder_delivery_claims_isolated.sql`
- `scripts/qa/qualify-notification-producer-local.mjs`
- `scripts/qa/seed-notification-producer-local.sql`
- `tests/qa/unit/notification-producer-local-bootstrap.test.js`
- `.claude/rules/appointment-reminder-wave-ownership.md`
- `.claude/rules/initiative-status.md`
- `.claude/tooling-governance.json`

`functions/api/notify.js`, `functions/lib/apns.js`, and their tests are shared notification
hotspots. The reminder remains outside the exact-five `GUARDED_PRODUCER_TYPES`; its claims use a
separate service-only table/RPC family and must not widen the five-producer occurrence constraints.
The activation branch may compose the five-producer source but must not duplicate its separate migration or delivery-claim schema.

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

The reminder type stays disabled and the named cron stays absent. QA-only application and
producer-containment qualification evidence completed on 2026-08-03: reviewed source
`20260801215912` maps to hosted ledger
`20260803182131`, followed by `20260802040935` as hosted ledger `20260803182303`; QA still has no
`appointment.reminder` catalog row or reminder cron.

The current source candidate adds three missing activation boundaries without activating them:

- covering indexes plus fail-closed browser-role ACL removal for three RLS/no-policy secret tables;
- a separate forced-RLS, service-only reminder delivery-claim path for bell, Web Push, email, and
  APNs that atomically revalidates the enabled flag, stable occurrence, one-hour due window,
  scheduled appointment, exact active/internal crew member, and current channel target;
- bounded producer replay with the same stable occurrence ID so Worker/provider retries cannot
  multiply side effects.

The exact committed train passed fresh disposable forward/rollback and clean-reapply cycles at
`1d3c987d`, with manifest
`796208d8d5dcc7876f90cc0dd9adf8ee072fa6871472f25d2a7675605b4e7952`; the invalid earlier
`6f6aa8a2` attempt is not evidence. Activation still requires separate QA qualification,
shared-project apply, compatible Worker promotion and exact Production revision verification.
Enabling the type, scheduling its cron, provider proof, and physical-device receipt remain later
owner-authorized actions.
