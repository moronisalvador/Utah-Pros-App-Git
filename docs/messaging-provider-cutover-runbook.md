<!--
FILE: docs/messaging-provider-cutover-runbook.md

WHAT THIS DOES (plain language):
  Defines the evidence and owner-controlled operating procedure for proving that UPR can switch
  staff person-to-person SMS between CallRail and Twilio without rewriting the inbox, consent,
  conversations, automation, or canonical messaging data.

DEPENDS ON:
  Internal: docs/messaging-transport-roadmap.md, docs/architecture.md, docs/integrations.md,
            docs/business-rules.md, docs/testing-and-deployment.md,
            .claude/rules/messaging-transport-wave-ownership.md
  Data:     reads → messaging configuration, send attempts, provider events, messages, conversations
            writes → documentation only

NOTES / GOTCHAS:
  - This is a proof and future operations runbook, not authorization to activate a provider.
  - It contains placeholders only: no credentials, account identifiers, or real phone numbers.
  - Dev and production share Supabase; a Preview proof must use isolated, owner-approved test data.
-->

# Messaging Provider Cutover Proof and Runbook

**Created / last verified:** 2026-07-23

**Initiative:** `messaging-transport`

**Status:** Phase 6 design; not executed and not an activation record

## 1. Purpose and hard boundary

This runbook proves that the staff-written, person-to-person SMS transport can move between
CallRail and Twilio by changing server-owned mode/configuration while UPR continues to own:

- the `/api/send-message` client contract;
- conversations, participants, messages, consent, DND, and STOP/START/HELP state;
- idempotent send attempts and provider-event history;
- inbox rendering, optimistic bubbles, retries, and realtime updates;
- scheduled, automated, group, broadcast, bulk, and campaign behavior.

The first execution must be an adapter-only proof in a non-production application environment with
a dedicated provider test sender and dedicated test contact. It does not move a production number.
A production number cutover is a later, separately approved provider operation.

Nothing here authorizes a deploy, environment-variable change, secret change, provider-console
change, webhook registration, number move, database apply, or message send.

## 2. Preconditions

Do not begin the proof until all conditions have current evidence:

1. Phases 2 through 5 of `docs/messaging-transport-roadmap.md` have passed their code, database,
   security, webhook, reconciliation, and owner-gated activation reviews.
2. `/api/send-message` authorizes an active employee with the `conversations` capability, derives
   the actor server-side, and fails closed for missing consent, DND, ambiguous recipients, and
   unsupported purposes.
3. `client_request_id`, generic provider identity, `message_send_attempts`, and
   `message_provider_events` are applied, verified with intended roles, and have a reviewed rollback.
4. Both provider adapters pass their contract tests, but only the chosen mode is reachable for
   `purpose:'staff_p2p'`.
5. CallRail cannot be imported or selected by scheduled, automated, group, broadcast, bulk,
   campaign, or retry-daemon paths.
6. The CallRail text webhook and Twilio inbound/status webhooks have independent signature
   validation, event dedupe, worker-run visibility, and provider-specific fixtures.
7. CallRail inbound MMS is either copied immediately into private UPR-owned storage and rendered
   through an authorized resolver, or current provider evidence proves MMS can be disabled for the
   selected number. MMS-body STOP/START/HELP must still reach canonical consent handling.
8. Every unresolved `prepared`, `submitting`, `accepted`, or `ambiguous` attempt is visible to the operator, and
   reconciliation can complete without resubmitting.
9. Preview and Production server bindings have been inventoried by name and presence without
   exposing values. Production remains unchanged.
10. The dedicated test contact, sender, consent evidence, retention treatment, and cleanup owner are
   recorded. Shared-Supabase test rows cannot collide with production contacts or conversations.
11. Provider registration, sender eligibility, account access, support contacts, maintenance
    window, monitoring owner, rollback operator, and go/no-go authority are confirmed.

Re-verify current provider behavior before execution against the official
[CallRail API v3 documentation](https://apidocs.callrail.com/), the
[Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource),
[Twilio webhook security guidance](https://www.twilio.com/docs/usage/webhooks/webhooks-security),
and applicable phone-number porting documentation.

## 3. Server-only mode and configuration

The only selectable staff-send mode is:

```text
MESSAGING_SEND_MODE=disabled|callrail|twilio
```

The worker reads it after internal-note handling and before any provider call. Missing, blank,
unknown, or malformed values behave as `disabled`. The value must never be:

- a `VITE_*` variable;
- accepted from a browser request;
- stored in shared Supabase as an environment selector;
- inferred from a conversation, contact, phone number, or provider event;
- used by scheduled, automated, group, broadcast, bulk, or campaign sending.

Provider account, company, tracking-number, Messaging Service, sender-number, credential, and
webhook values remain separate server/provider configuration. Changing the mode does not change
number ownership or inbound routing.

RCS hard gate: the active SMS-mode Twilio Messaging Service must not contain an RCS Sender until
the explicit channel-locked RCS adapter, persistence, signed observation handling, and owner
activation plan are deployed. Prefer a separate reviewed Messaging Service/sender pool for RCS.
Inventory this console state before every Twilio activation or rollback; ordinary `To` addressing
must never be allowed to trigger provider-selected RCS/fallback.

For the non-production proof, record only redacted evidence:

| Evidence | Required record |
|---|---|
| Application environment | Preview deployment identifier and commit |
| Initial mode | `disabled` |
| Target mode | `callrail` or `twilio` |
| Sender | Provider and masked test-sender suffix only |
| Contact | Synthetic test-contact identifier; no real number in this document |
| Configuration | Presence/absence and owner; never values |
| Operators | Activation, monitoring, rollback, and go/no-go owners |
| Window | Approved start, decision deadline, and end |

## 4. Number ownership and inbound routing

Outbound adapter selection and telephone-number routing are different control planes:

- CallRail sends from an eligible CallRail tracking number.
- Twilio sends from a Twilio number or Messaging Service sender.
- A customer reply follows the carrier/provider that currently controls messaging for the displayed
  sender number; UPR mode does not redirect that reply.
- Provider conversation IDs are secondary mappings. UPR conversation identity remains owned by
  UPR and must not be replaced during cutover.
- Historical rows retain the actual provider, sender address, recipient address, and provider
  identity used at the time.

Two cutover types must not be mixed:

### Adapter-only proof

Use distinct provider-owned test senders. No port, hosted-messaging change, tracking-number
reassignment, or customer-facing sender substitution is permitted. The proof demonstrates software
portability, not continuity of a production phone number.

### Production number cutover

A true same-number cutover requires a provider-approved routing/ownership plan. Porting can affect
voice and messaging independently or on different timelines, may require messaging registration,
and can produce a period of delayed or split routing. The owner and providers must confirm the
current product, number type, portability, registration, scheduled date, rollback limits, and
expected routing timeline in writing.

Do not assume that changing `MESSAGING_SEND_MODE` moves a number. Never leave both providers able
to originate from what staff understand to be the same business number.

## 5. Provider webhook coexistence

Provider routes coexist during proof, drain, rollback, and the late-event window:

| Provider event | Dedicated route | Authentication | Domain behavior |
|---|---|---|---|
| CallRail SMS Received/Sent | `/api/callrail-text-webhook` | `Signature` over exact raw body plus timestamp/replay check | Normalize and dedupe by CallRail identity |
| Twilio inbound SMS | `/api/twilio-webhook` | `X-Twilio-Signature` using exact URL and all received parameters | Normalize and dedupe by Twilio Message SID |
| Twilio status callback | `/api/twilio-status` | `X-Twilio-Signature` using exact URL and all received parameters | Advance only valid Twilio lifecycle state |

The active outbound mode does not decide whether an authenticated provider event is accepted.
Routes dispatch by authenticated provider identity, not the current mode. The old provider's routes
remain available until the late-event window is complete and every unresolved attempt/event is
closed. The CallRail voice/form route is never used for text events.

CallRail documents separate Text Message Received and Text Message Sent webhooks with stable
resource/conversation identities and short-lived MMS URLs. Twilio documents signed inbound and
asynchronous status callbacks whose parameter sets may grow. Each adapter must preserve its own
verification and parsing rules; neither route imitates the other provider's lifecycle.

## 6. Drain, reconcile, switch, and reopen

### A. Enter the safe state

1. Obtain the owner-approved window and name the go/no-go and rollback authorities.
2. Set the target application environment to `MESSAGING_SEND_MODE=disabled`.
3. Verify a new staff send fails closed before credential resolution or provider fetch.
4. Keep inbound webhooks enabled unless their processing is itself unsafe.
5. Record the cutover high-watermark timestamp, deployment commit, masked sender, and event/attempt
   counts. Do not copy payload bodies or phone numbers into the run record.

### B. Drain and reconcile

1. Query attempts at or before the high-watermark in `prepared`, `submitting`, `accepted`, or
   `ambiguous`.
2. Allow accepted provider requests and authenticated webhooks to settle for the approved drain
   interval.
3. Reconcile by provider message/resource identity first. Use provider conversation, exact
   normalized addresses, content fingerprint, and a narrow time window only when the primary
   identity is unavailable.
4. Never resubmit an ambiguous request merely because the client or provider timed out.
5. Escalate zero-match and multi-match cases for operational review. Record the decision and actor.
6. Confirm every pre-cutover `client_request_id` returns its existing outcome and cannot generate a
   second provider submission.
7. Record unresolved attempts explicitly. Any unresolved potential send is a no-go for reopening.

### C. Prepare the target

1. Verify target credentials and sender eligibility read-only; do not expose values.
2. Verify the target webhook URL, signature secret/key presence, route deployment, dedupe store, and
   alerting before any inbound route is changed.
3. For an adapter-only proof, use the target provider's distinct test sender and leave every
   production number untouched.
4. For a production number cutover, follow the provider-approved routing plan and confirm observed
   inbound ownership independently. A scheduled port date is not proof of completed SMS routing.

### D. Switch and prove

1. Change only the approved environment's server mode from `disabled` to the target provider.
2. Confirm the browser request contains no provider, sender number, callback URL, or provider
   credential.
3. With separate explicit send authorization, perform one test action using the existing inbox and
   the previously approved `client_request_id`.
4. Verify one provider submission, one canonical outbound message, one attempt chain, correct
   provider identity, and the unchanged `/api/send-message` response contract.
5. With separate explicit reply authorization, verify authenticated inbound handling, one canonical
   inbound row, dedupe, conversation continuity, consent/DND behavior, and notification behavior.
6. Verify scheduled/automated/campaign paths remain on their separately governed transport and did
   not observe the staff P2P mode.
7. Return the mode to `disabled` when the proof window ends unless a separate approval explicitly
   authorizes continued operation.

### E. Close the window

1. Keep both providers' webhook routes capable of processing authenticated late events.
2. Reconcile all proof attempts/events and record the event high-watermark.
3. Preserve additive schema and provider history; do not drop fields during operational rollback.
4. Record test evidence, deviations, unresolved items, and the final mode without secrets or PII.
5. Treat provider-console cleanup, test-data deletion, webhook disablement, and number release as
   separate owner-authorized actions.

## 7. No client or domain rewrite proof

The proof passes only when review and runtime evidence answer **yes** to every item:

- Both inbox surfaces still call only `POST /api/send-message`.
- No browser request or shared database flag selects a provider.
- No client component imports a CallRail or Twilio adapter.
- The request and response contract remains backward compatible.
- Conversations and participants keep the same UPR identities across providers.
- Messages use generic provider identity while historical `twilio_sid` compatibility remains.
- Consent, DND, STOP/START/HELP, actor, and access checks execute before adapter selection.
- The worker remains sole-writer for SMS rows.
- `client_request_id` returns the prior outcome for a repeated action across timeout/retry.
- Provider events dedupe before domain mutation and never create a duplicate outbound message.
- CallRail and Twilio retain separate signature, payload, status, and MMS handling.
- A provider error produces no provider or channel fallback.
- Scheduled, automated, group, broadcast, bulk, and campaign code has no CallRail reachability.
- The software cutover diff consists only of reviewed server configuration/provider wiring; it
  requires no inbox, consent, conversation, automation, or schema redesign.

Any required client/domain rewrite fails Phase 6 and reopens the architecture review.

## 8. Evidence matrix

| Area | Required test/evidence | Pass condition |
|---|---|---|
| Disabled default | Missing, blank, unknown, and `disabled` mode contract tests | No provider credential lookup or fetch |
| Mode isolation | Same staff request under each explicit provider mode | Exactly the selected adapter is called |
| Client parity | Existing Conversations and Tech Messages request/response tests | No provider field or contract break |
| Authorization | Missing token, no/inactive employee, wrong capability, forged actor, wrong scope | Denied before service-role/provider access |
| Consent | opted-out, DND, ambiguous/missing contact, STOP/START/HELP cases | Existing fail-closed decisions are unchanged |
| Idempotency | same ID/same content, same ID/changed content, concurrent duplicate | One submission; changed content rejected |
| Ambiguous send | provider timeout before response plus later sent event | No automatic resubmit; one canonical result |
| Webhook security | valid/invalid signature, altered body/URL, stale replay, duplicate | Only authenticated, claimed events mutate data |
| Event order | response-before-webhook, webhook-before-response, late status, duplicate | One message/attempt chain; monotonic valid state |
| Inbound continuity | Reply through each provider's distinct test sender | Same UPR domain behavior; provider history retained |
| MMS | short-lived CallRail URL and Twilio media fixture | Owned private storage; no provider URL retained |
| Automation isolation | import/call graph and negative runtime spies | CallRail receives no non-P2P send |
| No fallback | 4xx, 429, 5xx, timeout, missing config | No alternate provider/channel call |
| Number routing | Provider-console and carrier-observed evidence, masked | Replies reach only the provider that owns routing |
| Rollback | Active target mode changed to `disabled` during controlled test | New staff sends block; inbound/late events still reconcile |
| Repository | targeted tests, full tests, changed-file lint, build | Actual results recorded with known skips/failures |
| Deployment | commit, Preview/Production binding presence, deployed smoke | Exact environment evidenced; Production unchanged |

Mock/unit results do not prove credentials, provider-console settings, carrier delivery, number
routing, Cloudflare bindings, shared-database state, or production readiness.

## 9. Rollback to disabled

`MESSAGING_SEND_MODE=disabled` is the first operational rollback for staff P2P sending.

1. Set the affected environment to `disabled` and verify the deployed value by behavior without
   revealing the binding.
2. Do not immediately switch back to the old provider: first drain and reconcile any target-provider
   request that could have been accepted.
3. Keep authenticated inbound and status webhooks available so replies and late events are not lost.
4. If a webhook is unsafe, disable that provider-console delivery only with explicit owner approval
   and record the resulting reconciliation backlog.
5. Leave additive database structures in place. Code/schema rollback is a reviewed release, not an
   emergency drop.
6. If a number was ported or reassigned, `disabled` stops UPR outbound sends but does not reverse
   carrier routing. Provider-led number rollback has its own feasibility and timeline.

Rollback succeeds when new staff P2P sends are blocked, no ambiguous attempt is resubmitted,
authenticated late events continue to reconcile, and the incident owner has a complete backlog.

## 10. Late-event handling

- Determine the provider from the authenticated route, never from current send mode.
- Claim/dedupe before mutation using provider event/message identity and documented fallback hash.
- Preserve provider event time separately from receipt and processing time.
- Link the event to the historical provider attempt/message; never rewrite it as the new provider.
- Apply only valid monotonic state changes. A late, coarser CallRail event cannot invent Twilio-style
  delivery, and a stale Twilio callback cannot regress a terminal state.
- A late sent event may confirm an ambiguous attempt but must never trigger a replacement send.
- A late inbound STOP/START/HELP message follows the canonical consent path even when its provider is
  no longer active for outbound staff sends.
- Unmatched events enter bounded operational review; they do not create a guessed conversation.
- Keep old webhook routes and required verification material for the approved late-event/retention
  window. Rotation or removal requires evidence that no accepted events remain dependent on it.

## 11. Explicit owner gates

The owner must separately approve each applicable action:

- deploy or promote cutover-capable code;
- add, rotate, or remove Cloudflare/provider secrets or variables;
- change `MESSAGING_SEND_MODE` in Preview or Production;
- register, change, or disable a provider webhook;
- create or modify a provider Messaging Service, tracking number, or sender assignment;
- send a provider sandbox or real SMS/MMS, including a test message;
- use a real customer/contact or production conversation for testing;
- apply a shared-Supabase migration or mutate live test data;
- port, host, release, reassign, or otherwise change number ownership/routing;
- activate Production or leave a provider enabled after the proof window;
- disable the old provider's webhooks or remove its verification credential;
- delete proof data or execute rollback that changes external state.

Approval for one gate does not imply approval for another. A successful non-production proof does
not authorize Production activation or a number move.

## 12. Execution record template

Create a dated evidence record outside this plan with:

- approved scope, environment, window, and named operators;
- source commit/deployment and redacted configuration-presence inventory;
- pre/post mode and masked test identities;
- attempt/event/message counts at both high-watermarks;
- commands and actual test/build/lint results;
- provider-console and carrier-routing evidence without secrets or full phone numbers;
- every owner approval and its exact scope;
- anomalies, reconciliation decisions, rollback actions, and unresolved backlog;
- final mode, webhook posture, number owner/routing owner, and go/no-go decision.

Do not put credentials, tokens, signing keys, full phone numbers, message bodies, or real customer
identities in the record.
