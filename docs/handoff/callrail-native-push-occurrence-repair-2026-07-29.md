# CallRail inbound native Push occurrence repair

**Last verified:** 2026-07-29

## Outcome

Read-only live evidence showed a CallRail inbound event projected and delivered
through `message_notification_outbox`, with Web Push subscriptions in its
effective audience, but no `native_push_delivery_claims` row. Source review
found the exact mismatch:

- `claim_message_notification_outbox` returns the durable outbox `id`, type,
  payload, attempt count, and claim token;
- it deliberately does not return `provider_event_id` or `message_id`; and
- the worker passed absent `row.provider_event_id` as
  `notification_event_id`, causing native dispatch to fail closed as
  `missing_notification_event_id` before APNs configuration, token lookup, or a
  delivery claim.

The worker now uses the returned outbox `id` as the stable native occurrence
across retries. This preserves APNs idempotency without changing the frozen live
RPC shape or adding a migration.

## Scope and safety

The repair changes only the protected inbound-notification outbox worker and
focused tests. It does not change:

- CallRail webhook verification, customer-message persistence, or provider
  sends;
- consent, DND, STOP/START/HELP, audience resolution, or notification
  preferences;
- bell, Web Push, or email fan-out; or
- APNs privacy-safe generic alert copy and recipient-bound route validation.

Protected `worker_runs.meta` now records aggregate native recipients,
attempted, sent, pruned, retryable, ambiguous, and skipped counts. Skip reasons
are restricted to an internal allowlist; unknown/upstream detail becomes
`other`. No employee ID, device-token ID, raw token, event ID, message copy, or
provider detail is retained in the summary.

## Verification and external gates

Verification completed on the uncommitted local repair:

- focused outbox/route/APNs tests: 31/31 passed;
- complete `npm test`: unit 1,356/1,356; worker 1,550/1,550; QA 564/564;
- `npm run build` and `npm run build:native`: passed;
- `npm run test:artifacts`: passed with zero unsafe retained files;
- `npm run preflight:mobile`: zero errors and three expected warnings
  (dirty tree, local Node 26 versus CI Node 22, optional GitHub delivery);
- targeted ESLint on every changed JavaScript/test file: zero findings;
- full `npm run lint`: failed on the pre-existing broad baseline of 1,115
  findings, with none in the changed files; and
- independent `worker-security-reviewer`: pass, with no P0, P1, or P2
  findings. It independently reran 17 focused worker/QA tests plus changed-file
  ESLint and `git diff --check`.

No commit, push, Cloudflare deployment, provider call, notification send,
Supabase mutation, or device update is implied by this source repair. Each
external action remains separately owner-gated.
