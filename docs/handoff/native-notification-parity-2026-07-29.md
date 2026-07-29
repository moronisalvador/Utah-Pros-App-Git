# Native notification parity — 2026-07-29 handoff

## Purpose and scope

This document records the notification-parity continuation performed after the
larger native iOS/PWA session in
[`native-ios-push-and-pwa-session-2026-07-28.md`](./native-ios-push-and-pwa-session-2026-07-28.md).
It is intended for an independent Claude Code or Codex review.

The bounded objective was:

1. make ordinary business-event Push reach both direct-development iOS installs
   and TestFlight/App Store installs;
2. give every live notification type reviewed native lock-screen copy and a
   safe tap destination;
3. preserve the working PWA Web Push path;
4. keep Push user-controllable on PWA and native;
5. expose the technician's own `feedback.resolved` preference;
6. provide a stable source contract for a separately owned admin notification
   presentation editor.

This batch did **not** change SMS delivery, CallRail message ingestion,
notification audiences, database schema, Apple signing, Cloudflare variables,
or live deployment state.

## Repository state

- Base: `origin/dev` at `f290e865d25d718dc0ed4a8732e6bf3a621b95c7`
- Branch: `codex/mobile-readiness-notification-parity`
- Isolated worktree: `/private/tmp/upr-mobile-notification-parity`
- Migration files: none
- Shared Supabase changes: none
- Provider calls or test pushes from this batch: none
- Deployment: not performed
- Commit/push: pending fresh owner authorization

The main checkout contained unrelated changes from another session. They were
not edited, staged, reverted, or copied into this worktree.

## Root cause

The working manual native test and the failed appointment test exercised
different Apple environments:

- the directly installed development build registered a `sandbox` token;
- ordinary appointment events reached the production notification Worker;
- the Worker selected only its configured `APNS_ENV`, so it queried only the
  production token cohort;
- PWA Web Push still used its independent subscription path and therefore
  delivered successfully.

Read-only live evidence showed sandbox and unknown native registrations but no
production registration at that moment. That explained why the owner-only test
could reach the development install while the ordinary appointment event
reached only the PWA. No token or employee identifier was recorded here.

## Implemented contracts

### 1. Exhaustive typed native presentation

`functions/lib/notificationPresentation.js` now owns native lock-screen copy
and field-app destinations. Public exports:

```js
NATIVE_NOTIFICATION_TYPE_KEYS
buildNativeNotificationPresentation(typeKey, body)
```

The registry is exhaustive for the 15 live event types. Unknown future types
fail safely to:

```text
Utah Pros notification
Open Utah Pros for details.
/
```

The APNs adapter invokes this registry internally. A caller cannot bypass it by
supplying `alert`, `data`, title, body, customer message content, or a free-form
route.

The approved lock-screen privacy budget excludes:

- customer/contact names;
- message contents;
- phone numbers and addresses;
- claim/reference identifiers;
- financial amounts;
- appointment times;
- free-form notes.

Appointment alerts expose only event state and generic action copy. PWA Web
Push, the in-app bell, and email retain their existing richer presentation.

### 2. Current native presentation catalog

| Type | Native title | Native body | Native tap destination |
|---|---|---|---|
| `message.inbound` | New customer message | Tap to open the conversation. | Exact field conversation |
| `appointment.assigned` | New appointment | Tap to review the appointment. | Exact field appointment |
| `appointment.updated` | Appointment updated | Tap to review the changes. | Exact field appointment |
| `appointment.canceled` | Appointment canceled | Tap to review the appointment. | Exact field appointment |
| `estimate.accepted` | Estimate accepted | Open Utah Pros to review the estimate. | Native home |
| `payment.received` | Payment received | Open Utah Pros to review payment details. | Native home |
| `lead.new` | New lead | Open Utah Pros to review the lead. | Native home |
| `esign.signed` | Document signed | Tap to open the job. | Exact native Job Hub |
| `feedback.submitted` | New feedback | Open Utah Pros to review the feedback. | Native home |
| `timesheet.change_requested` | Timesheet change requested | Open Utah Pros to review the request. | Native home |
| `timesheet.change_reviewed` | Approved/rejected/reviewed state | Open Utah Pros to review your request. | Native home |
| `clock.abandoned` | Clock needs attention | Open Utah Pros to review your time. | Native home |
| `meld.received` | New/emergency meld received | Open Utah Pros to review the meld. | Native home |
| `feedback.resolved` | Feedback or bug report resolved | Tap to review your feedback. | Field feedback page |
| `ops.health` | Operations alert | Open Utah Pros to review system health. | Native home |

Office-only routes deliberately open native home because the current native
product boundary is field-only. Adding admin native routes is a separate
authorization and product-scope decision.

The owner-only diagnostic uses a fixed internal presentation:

```text
UPR notifications are ready
This iPhone can receive UPR alerts.
/tech/settings
```

### 3. Sandbox and production delivery parity

`functions/lib/apns.js` now exports:

```js
sendNativePushToEmployee(...)
sendNativePushToEmployeeAcrossEnvironments(...)
```

Ordinary trusted events use the across-environments sender. It attempts the
same stable occurrence against both exact cohorts:

- `sandbox` for development-signed installs;
- `production` for TestFlight/App Store installs.

The cohorts execute concurrently and settle independently. A thrown sandbox
failure becomes a sanitized `native_push_failed` sandbox summary and does not
prevent production delivery. It is classified as retryable, so the durable
inbound-message outbox persists a native-only retry rather than resending the
bell, PWA Web Push, or email channels.

Each cohort still has its own:

- exact `device_tokens.apns_environment` query;
- Apple host;
- token fingerprint;
- durable delivery claim;
- invalid-token pruning;
- five-token employee bound.

`APNS_ENV` remains required in Worker configuration as a fail-closed activation
signal. The implementation does not merge token environments.

The owner-only diagnostic endpoint intentionally remains single-environment so
it tests the exact currently installed build.

### 4. Timeout, retry, and occurrence behavior

- APNs uses the shared bounded HTTP client with a 15-second abort signal.
- The production HTTP route no longer overrides that client with raw global
  `fetch`.
- Explicit APNs 429/5xx responses retain the existing bounded retry behavior.
- Timeout/network ambiguity retains the durable claim and is not automatically
  replayed.
- Stable source-event and token/environment identities still prevent duplicate
  delivery across retries and token-row re-registration.

### 5. Preferences and PWA non-regression

The existing PWA and native Turn on/Turn off controls remain separate.
Per-event Push preferences continue through the existing notification matrix.

`feedback.resolved` is now included in the field technician's preference list
because the event is sent back to the technician who submitted the feedback.

The PWA fan-out was not replaced or retargeted. It still:

- reads `push_subscriptions`;
- uses Web Push/VAPID;
- retains its richer copy and route;
- prunes only 404/410 subscriptions;
- runs after the native attempt without sharing an Apple token contract.

## Files changed

Runtime and tests:

- `functions/lib/notificationPresentation.js`
- `functions/lib/notificationPresentation.test.js`
- `functions/lib/apns.js`
- `functions/lib/apns.test.js`
- `functions/lib/message-notification-outbox.js`
- `functions/lib/message-notification-outbox.test.js`
- `functions/api/notify.js`
- `functions/api/notify.test.js`
- `functions/api/send-push.js`
- `functions/api/send-push.test.js`
- `functions/api/feedback-resolved-notify.js`
- `functions/api/feedback-resolved-notify.test.js`
- `src/components/tech/settings/NotificationsSection.jsx`
- `src/components/tech/settings/notificationsSection.native.test.jsx`

Canonical documentation:

- `UPR-Web-Context.md`
- `docs/business-rules.md`
- `docs/integrations.md`
- `docs/auth-and-authorization.md`
- `docs/mobile/data-contracts.md`
- `docs/mobile/push-activation-owner-gate.md`
- `docs/mobile/pwa-and-capacitor.md`
- this handoff

## Verification actually performed

| Check | Result |
|---|---|
| Focused Worker tests after final security fixes | 123/123 passed |
| Native notification Settings component | 14/14 passed |
| Full unit lane | 109 files, 1,357/1,357 passed |
| Full Worker lane | 103 files, 1,564/1,564 passed |
| Full QA lane | 58 files, 564/564 passed |
| Full credential-free total | 3,485/3,485 passed; zero unexpected skips |
| Production Vite build | Passed; 693 modules |
| Targeted ESLint on all changed source/test files | Passed with zero findings |
| `git diff --check` | Passed |
| 390×844 notification Settings browser harness | Passed loading/error/ready/resume, no horizontal overflow or clipping, 48px actions, reduced motion |
| Bundle report | Advisory entry graph 258,521 B gzip; 2,804 B below the blocking +10% line |

The bundle advisory predates this worker-heavy batch; the only client runtime
change is one additional type key in an existing filter. It remains debt, not a
new blocking regression.

Adversarial review results:

- mobile security review: pass after two P1 fixes;
- Worker security review: pass after timeout and appointment-copy fixes;
- UPR pattern review: pass;
- design consistency review: pass;
- page lifecycle review: pass;
- mobile contract review: pass after the feedback sender authorization and
  schema-catalog coverage fixes.

No physical-device or live-host claim is inferred from these credential-free
checks.

## Adversarial fixes made during review

1. Raw global `fetch` was reaching APNs from the HTTP route. The default sender
   now keeps its bounded `fetchWithTimeout` client, and a test proves the
   provider call receives an abort signal.
2. Appointment alert bodies initially accepted an enriched free-form string.
   They now use generic action copy; a negative test includes a name, phone
   number, address, identifier, and notes and proves none reaches APNs.
3. The low-level APNs sender initially accepted caller-supplied `alert` copy.
   Presentation selection now occurs inside the provider boundary, making the
   typed privacy policy structurally non-bypassable.
4. Sandbox and production were initially awaited serially. They now settle
   concurrently and independently; a negative test proves production is still
   attempted when sandbox throws and that the private error is not returned.
5. The existing `feedback.resolved` sender proved only a valid session. It now
   repeats the Feedback Inbox's admin-only role gate server-side before reading
   the feedback row or dispatching any channel; a wrong-role test proves no
   service-role read or send occurs.
6. The presentation test initially duplicated the 15-type list. It now derives
   the schema catalog from the four seeding migrations and compares that
   contract to the exported registry keys.
7. A thrown APNs cohort initially looked like a harmless skip. It now reports a
   sanitized retryable failure, and the inbound-message outbox test proves the
   occurrence persists as a native-only retry without repeating other channels.

## Separate admin presentation-editor task

A separate worktree-backed Codex task was created for the requested desktop
admin Settings editor:

```text
client-new-thread:5d029aa4-554a-4bdb-8786-79ce86aeef87
```

That task completed its adversarial architecture and intentionally held shared
runtime/schema edits until this registry is stable. Its implementation must
extend the registry contract above rather than create a competing notification
send path.

Constraints for that continuation:

- browser-provided templates or routes never flow directly into APNs;
- every variable has a type-specific allowlist and privacy classification;
- rendered native copy remains server-derived and length bounded;
- route templates compile only to the native allowlist;
- unsupported/office-only routes retain `/`;
- preview/test operations remain owner-only and content-safe;
- a database-backed overlay, if chosen, requires a separately reviewed
  additive migration and fresh owner authorization before live apply;
- PWA/bell/email presentation changes remain separate from native lock-screen
  disclosure;
- existing event audience, preference, dedup, and authorization contracts do
  not change.

The dependent task should receive the final commit SHA and these public
contracts only after the owner authorizes and the commit succeeds.

## Remaining live gates

Before calling the behavior live:

1. obtain fresh owner authorization to commit and push this branch;
2. integrate it into current `dev` without rewriting history;
3. deploy the reviewed Worker/frontend state to the dev environment;
4. create or update an assigned appointment and verify the direct-development
   native app receives it while the PWA still receives its own Web Push;
5. tap message, appointment, signed-document, and feedback notifications and
   verify exact field routes under the correct employee account;
6. repeat foreground, background, terminated, resume, logout, account-switch,
   offline, and disabled-preference checks on a physical iPhone;
7. upload a reviewed TestFlight build, obtain a production token, and repeat the
   matrix against the production cohort;
8. promote `dev` to `main` only through the normal reviewed production path.

## Rollback

There is no database rollback because this batch has no migration or live data
mutation.

Source rollback is one reviewed revert of the eventual batch commit. If rich
native presentation must be disabled independently, the safe behavior is the
existing generic title/body plus `/` route; PWA Web Push does not need to be
disabled with it.
