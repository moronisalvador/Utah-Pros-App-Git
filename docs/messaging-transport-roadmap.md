<!--
FILE: docs/messaging-transport-roadmap.md

WHAT THIS DOES (plain language):
  Defines how UPR can use CallRail for staff-written customer texts now while keeping the inbox,
  consent history, conversations, automations, and future Twilio cutover owned by UPR. It records
  the current system, the provider-neutral target, rollout gates, tests, and rollback plan.

DEPENDS ON:
  Internal: CLAUDE.md, .claude/rules/messaging-transport-wave-ownership.md,
            docs/sms-experience-roadmap.md, docs/tech-messages-v2-roadmap.md,
            docs/crm-lead-lifecycle.md, docs/architecture.md, docs/integrations.md
  Data:     reads → documentation and current messaging/integration source
            writes → documentation only

NOTES / GOTCHAS:
  - This plan does not authorize a migration, deployment, provider setting, webhook, secret, or send.
  - Dev and production share Supabase, so every database apply is a production change.
-->

# Provider-Neutral Messaging Transport — Plan of Record

**Created / last verified:** 2026-07-23

**Slug:** `messaging-transport`

**Base verified:** live/repository recapture from `dev` at `bf3b0b9` (2026-07-23)

**Ownership:** `.claude/rules/messaging-transport-wave-ownership.md`

## 0. Outcome and scope

UPR will keep its own conversation, message, consent, DND, scheduling, and automation domain while
placing provider details behind server-side adapters. CallRail is the active Preview-only provider
for owner-controlled staff-to-customer tests; Production remains disabled. Twilio remains a
registered staff-send adapter and the separately governed transport for existing
scheduled/automated paths.

CallRail must never receive UPR scheduled, automated, group, broadcast, bulk, campaign, or text-blast
sends. Those workflows remain Twilio-only until an owner approves a separate provider and compliance
design. Provider failure never causes a fallback to another channel or provider.

Future Twilio RCS is treated as another channel behind the same provider-neutral boundary, not a new
inbox or consent domain. Its readiness contract is `docs/messaging-rcs-readiness.md`. RCS is not
enabled by this initiative, and Twilio's provider-managed RCS-to-SMS/MMS fallback remains prohibited.

This initiative is not the future voice-platform replacement described in
`docs/crm-lead-lifecycle.md`. It must not deepen voice/form ingestion coupling or change the
canonical CRM lead lifecycle.

## 1. Verified current state

Verified from the checkout named above:

- `src/pages/Conversations.jsx` and `src/pages/tech/v2/messages/useThread.js` both send outbound
  messages through `POST /api/send-message`. No client chooses a provider.
- `functions/api/send-message.js` is the staff-send chokepoint. It resolves an active internal
  employee and the conversations capability before service-role access, derives/rejects the actor,
  enforces per-recipient DND and opt-in, dispatches through the server-selected provider adapter,
  writes canonical outbound state, and preserves the frozen response shape additively.
- Internal notes also use `/api/send-message`, but have no transport and must remain provider-free.
- `functions/lib/automated-send.js` and `functions/api/process-scheduled.js` call Twilio directly.
  That is intentional for this initiative: they must not enter a CallRail-selectable seam.
- Twilio inbound and delivery callbacks have separate routes:
  `functions/api/twilio-webhook.js` and `functions/api/twilio-status.js`.
- Canonical messaging data already exists in `conversations`, `messages`,
  `conversation_participants`, `sms_consent_log`, and `scheduled_messages`. Realtime publishes
  `conversations` and `messages`.
- `messages.twilio_sid` is the existing provider-specific unique identity. The current normalized
  status vocabulary is `queued|sent|delivered|read|failed|undelivered|received`.
- Existing CallRail voice/form support is split across `functions/lib/callrail.js`,
  `functions/lib/callrail-api.js`, `functions/api/callrail-connect.js`, and
  `functions/api/callrail-webhook.js`.
- `callrail-webhook.js` decides “form” versus “call” and treats every other payload as a call.
  It is therefore unsafe as a text-message endpoint.
- `send-message.js` now uses shared worker authorization, the live conversations capability
  predicate, and server-derived actor identity. Stable client request IDs and the attempt/event
  foundation are integrated.
- `callrail-connect.js` now requires an active, non-external admin before reading configuration or
  changing the stored key. Its legacy query-secret setup contract remains adjacent debt; the
  dedicated text receiver uses the server-only signing-key binding instead.
- The existing CallRail webhook uses a query-string shared secret even though current CallRail
  documentation defines a `Signature` header generated from the raw payload with the company
  signing key and provides a timestamp for replay defense. That existing voice/form remediation is
  adjacent work; the new text route must use the documented signature design from its first release.

### Provider documentation verified 2026-07-23

Current official [CallRail API v3 documentation](https://apidocs.callrail.com/) states:

- `POST /v3/a/{account_id}/text-messages.json` is only for person-to-person communication inside the
  customer's own application; automated, bulk, and blast messaging is prohibited.
- Content is limited to 140 characters.
- The request identifies `company_id`, customer phone, and the CallRail tracking number. MMS accepts
  either one public `media_url` or one uploaded `media_file`, not both; JPEG, PNG, and GIF are
  supported up to 5 MB.
- SMS send is rate-limited separately (currently documented as 150/hour and 1,000/day by default).
- Although the send endpoint documents `201 Created`, the 2026-07-23 controlled dev send returned
  HTTP 200 with a valid conversation identity and was delivered. The adapter treats only 200/201
  plus a usable identity as accepted; malformed or other 2xx responses require reconciliation and
  must not be retried automatically.
- received and sent text webhooks exist. They carry message/resource identity, numbers, content,
  provider conversation identity, timestamp, type, and short-lived MMS URLs.
- CallRail conversation retrieval exposes only coarse outbound `sent`/error information. It does
  not provide Twilio's queued→sent→delivered/undelivered callback lifecycle.
- CallRail says MMS media URLs are short-lived and should be downloaded immediately rather than
  persisted as the durable media location.

Current official [Twilio Message resource documentation](https://www.twilio.com/docs/messaging/api/message-resource)
and [webhook security guidance](https://www.twilio.com/docs/usage/webhooks/webhooks-security) state:

- message creation returns a provider Message SID and an initial status;
- status callbacks report later transitions and errors, and callback fields may grow over time;
- inbound/status webhooks are signed with `X-Twilio-Signature` and must be validated using the
  exact URL and all received parameters.

Provider limits and fields are adapter facts, not UPR domain rules. Re-verify them before the phase
that implements or activates CallRail.

## 2. Binding invariants

1. **One staff-send chokepoint.** Both inbox clients continue to call only
   `POST /api/send-message`; no client imports or selects CallRail/Twilio.
2. **Worker sole-writer.** A server worker remains the sole writer of `sms_outbound` and
   `sms_inbound` rows. Clients never create a “sent” row.
3. **Consent and DND fail closed.** A missing contact, ambiguous contact, missing destination,
   missing provider configuration, disabled send mode, or unavailable consent evidence blocks the
   provider call.
4. **Adapters contain provider details.** URLs, credentials, request encoding, response parsing,
   provider length/media limits, and provider status vocabulary live in provider adapters.
5. **No cross-channel or cross-provider fallback.** Failure on CallRail does not try Twilio, email,
   or a personal-device SMS link. Failure on Twilio does not try CallRail.
6. **CallRail is person-to-person only.** Only an authenticated staff action in
   `/api/send-message` may select CallRail. Scheduled, automated, group, broadcast, bulk, campaign,
   and retry-daemon workflows cannot.
7. **Provider-neutral domain.** Consent, DND, conversations, participants, automation decisions,
   and client rendering do not branch on the active provider.
8. **Backward-compatible contracts.** Existing `/api/send-message` request/response fields,
   `messages.twilio_sid`, status values, realtime behavior, and client expectations remain while
   generic fields are added.
9. **No activation by database drift.** Provider selection is a server environment decision, not a
   shared-Supabase feature flag or browser input.
10. **Requested and actual channels stay distinct.** Future RCS persistence records what UPR
    requested separately from what the provider confirmed. Unknown actual channel stays null; it is
    never inferred from the recipient address or sender-pool configuration.

## 3. Target outbound contract

The internal transport command will be provider-neutral and server-created:

```js
{
  clientRequestId,       // stable UUID created by the client once and reused on retry
  messageId,             // UPR message row identity once reserved
  conversationId,
  requestedChannel,      // 'sms' | 'mms'; future explicit 'rcs'
  recipient: { contactId, address },
  sender: { employeeId, displayName, address: null },
  content: { body, media: [{ storagePath, mimeType, byteSize }] },
  purpose: 'staff_p2p',
  statusCallbackUrl      // adapter may use it; CallRail ignores it
}
```

The adapter returns normalized acceptance, not invented delivery:

```js
{
  provider,                    // 'callrail' | 'twilio'
  providerMessageId: null,     // null is valid when CallRail POST has no message id
  providerConversationId: null,
  accepted: true,
  status: 'queued' | 'sent',
  providerStatus,
  sentAt: null,
  rawReference: null           // sanitized diagnostic reference, never credentials/payload PII
}
```

The browser must not provide `provider`, sender number, company/account id, tracking number, or a
status callback URL. The worker derives them after authorization, consent, purpose, and mode checks.

## 4. Additive durable data model (future migration; not Phase 1)

No existing column is dropped, renamed, or reinterpreted. Exact columns, constraints, grants,
policies, and backfill are designed from a fresh live catalog capture in the authorized database
phase.

### `messages` additive identity

Proposed nullable fields:

| Field | Meaning |
|---|---|
| `provider` | Adapter that owns this message (`twilio` or `callrail`) |
| `provider_message_id` | Provider message/resource identity when one exists |
| `provider_conversation_id` | Provider thread identity, never the UPR conversation identity |
| `client_request_id` | Stable UPR idempotency identity supplied once per user send |
| `sender_address` | Actual provider sender phone/address used |
| `recipient_address` | Actual destination phone/address used |

`twilio_sid` remains live and unique for deployed clients/callbacks. During transition, new Twilio
writes set both `twilio_sid` and `provider_message_id`; a reviewed backfill may copy existing SIDs
into the generic fields. A partial unique index on `(provider, provider_message_id)` applies only
when the provider id is non-null. `client_request_id` is unique for staff outbound messages.

The current unapplied draft includes partial attempt-level RCS provenance:
`requested_channel`, `actual_channel`, and `channel_fallback_reason`. It does not enable RCS and
does not yet add message-level typed addresses, fallback-observed state, content kind, or provider
template/version identity. Those remain a later reviewed additive extension; see
`docs/messaging-rcs-readiness.md`.

### `message_send_attempts`

One row per provider submission attempt:

- `id`, `message_id`, `attempt_number`, `client_request_id`, `provider`;
- request fingerprint (content/recipient/sender identity hash, no secret);
- exact submitted body, service-role-only, because CallRail history reconciliation must compare the
  immutable staff-prefixed content rather than a later employee name; migration apply requires an
  owner-approved retention/deletion period for this restricted PII;
- requested/actual channel and fallback-reason evidence (RCS remains disabled);
- state: `prepared|submitting|accepted|ambiguous|confirmed|failed|cancelled`;
- provider message/conversation ids when known;
- provider HTTP status and sanitized error code/message;
- `started_at`, `response_at`, `reconcile_after`, `completed_at`, timestamps;
- uniqueness on `(message_id, attempt_number)` and on `client_request_id` for the first submission.

This ledger is the retry/reconciliation authority. It prevents a provider timeout from becoming an
automatic double-send.

### `message_provider_events`

One row per received provider event:

- provider, event type, provider event/message/conversation ids;
- raw-body hash and normalized dedupe key;
- occurred/received timestamps;
- processing state, claimed/processed timestamps, linked message/attempt ids, outcome/error;
- bounded processing-attempt count and next-attempt time for backoff/manual-review cutoff;
- a restricted, retention-bounded raw payload only if operationally required.

Primary dedupe uses CallRail `resource_id` or Twilio Message SID plus event type/status. A fallback
hash uses immutable documented fields and the raw body. Inserts and claim transitions are atomic.
Duplicate delivery returns success without replaying side effects.

## 5. CallRail adapter design

The future adapter lives in the flat `functions/lib/` style and is callable only with
`purpose:'staff_p2p'`. It must:

- reject every other purpose before credential resolution or fetch;
- enforce the current 140-character provider limit against the final prefixed body;
- require one eligible CallRail tracking number and a valid US/Canadian customer number;
- support at most one provider-compatible MMS item until official limits are re-verified;
- use `fetchWithTimeout`, classify 4xx/422 versus 429/5xx, and sanitize errors;
- return normalized acceptance without pretending that CallRail has delivered the message;
- use the existing server-side CallRail API key/account resolver without exposing either;
- never be imported by automated, scheduled, group, broadcast, campaign, or bulk workers.

Group/broadcast sends remain unsupported in CallRail mode even though the current Twilio route can
loop participants. `/api/send-message` fails closed with a stable code before sending any recipient.

## 6. Separate CallRail text webhook

Create `POST /api/callrail-text-webhook`; never point SMS Received/Sent at
`/api/callrail-webhook`.

Processing order:

1. Read the raw JSON body once.
2. Resolve the company signing key server-side.
3. Validate CallRail's `Signature` HMAC against the raw payload and reject invalid signatures.
4. Validate the documented event timestamp but do not reject a first delivery solely for age;
   CallRail does not resend failed webhooks, so signature plus durable dedupe is the replay control.
5. Parse only the SMS Received and SMS Sent documented shapes; reject/ignore calls and forms.
6. Insert/claim the provider event dedupe record before any domain mutation.
7. Normalize phone numbers and resolve the UPR conversation/contact fail closed.
8. For inbound: apply STOP/START/HELP and consent/DND logic before ordinary message processing,
   write the canonical inbound row, update the conversation, and notify through existing paths.
9. For sent: reconcile the pending/ambiguous attempt and message; do not insert a duplicate outbound
   row when UPR initiated the send.
10. Record a worker run. A non-2xx response is observable but is not a recovery strategy because
    CallRail does not resend; conversation polling/reconciliation must cover missed ingress.

CallRail's existing voice/form webhook remains unchanged until a separately reviewed signature
remediation. The text webhook may share pure normalization/signature helpers, not its route parser.

### Short-lived inbound MMS

After event claim and before completing the event:

- fetch each CallRail media URL immediately with the API key and a strict timeout;
- limit redirects, MIME type, bytes, and item count against the current provider contract;
- upload into UPR-owned private storage under an idempotent event/message path;
- store the owned storage path/signed-delivery contract on the message, never the CallRail URL;
- if ingestion fails transiently, retain the claimed event as retryable without duplicating the
  message; permanently unsupported media produces an auditable failed attachment state.

Retention, Storage RLS, signed URL TTL, and malware/content scanning require an owner decision in
the migration phase.

## 7. Idempotency, ambiguous timeout, and reconciliation

### `client_request_id`

- The client creates one UUID when the optimistic bubble is created.
- It sends that UUID on the first request and every retry of that same user action.
- The worker validates the UUID and binds it to conversation, content fingerprint, actor, and
  recipient. Reusing it with different content fails closed.
- A repeated request returns the existing normalized outcome and never submits again when the
  attempt is accepted, confirmed, or ambiguous.
- The field is additive to the public request/response contract. Old clients remain supported only
  through a bounded compatibility window; after all deployed clients send it, absence fails closed.

### Ambiguous provider timeout

If the outbound request may have reached CallRail but no response was received:

1. mark the attempt `ambiguous`;
2. return a retryable-but-not-resubmittable result to the client;
3. wait for the Text Message Sent webhook;
4. reconcile by provider resource id when available, otherwise by provider conversation, exact
   numbers, exact content hash, and a narrow timestamp window;
5. query the CallRail conversation API after a delay if the webhook does not arrive;
6. require explicit operational review when more than one candidate matches;
7. submit again only after reconciliation proves no matching send exists.

CallRail delivery is not at-least-once: a webhook can be lost. Unique event claims make duplicate
domain mutation effectively-once when an event arrives, while polling/reconciliation is required
to discover a missed event. This is not a claim of exactly-once provider delivery.

## 8. Environment-safe selection

Future server-only variable:

```text
MESSAGING_SEND_MODE=disabled|callrail|twilio
MESSAGING_SCHEMA_MODE=legacy|foundation
```

Rules:

- missing, blank, or unknown values fail closed as `disabled`;
- missing, blank, or unknown schema mode remains `legacy`, which never touches the proposed
  columns/tables; only an owner-approved post-migration switch may use `foundation`;
- it is read only inside `/api/send-message` after internal-note handling;
- it never appears as `VITE_*`, a request field, or a shared-Supabase flag;
- Preview and Production Cloudflare values are inventoried separately;
- mode applies only to `purpose:'staff_p2p'`;
- scheduled/automated/campaign code stays explicitly Twilio-only and continues to honor its own
  kill switch and compliance gates;
- changing mode requires an owner-approved deploy/activation window and a rollback value of
  `disabled` (or the previously verified provider).

Because dev and production share Supabase, database state cannot safely select a staging-only send
provider. Phase 1 deliberately does not add or read this variable, so Twilio behavior is unchanged.

### Admin setup/readiness surface

The in-app setup surface is deliberately read-only at the deployment boundary:

- `GET /api/messaging-setup` returns redacted server readiness: resolved schema/send mode, whether
  required CallRail configuration is present, the dedicated text-webhook path, deterministic
  blocker codes, and whether outbound messaging is actually enabled;
- `GET /api/messaging-setup?action=callrail-options` uses the stored server credential to discover
  active CallRail companies and active trackers whose `sms_supported` and `sms_enabled` values are
  both true, with bounded pagination and timed requests;
- provider discovery returns only the company/tracker identifiers, names, types, and tracking
  numbers needed to identify an eligible sender. It excludes destination numbers, call flows,
  customer threads/messages, credentials, signing material, and raw upstream bodies;
- both modes require an active, non-external admin before service-role/provider access and return
  `Cache-Control: no-store`;
- the route accepts no credential, provider mode, schema mode, signing key, company/tracking
  override, webhook mutation, or send command.

The panel may guide an owner through the remaining handoff, but it cannot mutate Cloudflare or
CallRail control-plane state. `MESSAGING_SEND_MODE`, `MESSAGING_SCHEMA_MODE`, signing material,
provider webhooks, and number routing remain server/external configuration. There is no migration
for this surface. Production remains disabled until Phase 5 is separately approved and evidenced.

Presence of CallRail bindings is reported separately from verified readiness. Status stays
unverified until the discovery action matches the configured company and sender to a live, active,
SMS-enabled tracker. Discovery is account-scoped, timeout-bounded, and fails closed on incomplete
pagination. Operational backlog counts are shared-database health only, not proof that a specific
Preview or Production webhook is installed.

## 9. Authorization remediation

### `/api/send-message`

Before any service-role read, consent write, or provider call:

- replace the local token-only helper with shared worker auth;
- require a valid user mapped to an active UPR employee;
- enforce the server equivalent of the `conversations` capability, including the dedicated
  field-tech messaging surface and explicit exclusion of external/CRM-only identities unless the
  owner grants that capability;
- derive `sent_by` from the authenticated employee and reject a conflicting request value;
- verify the employee may access the requested conversation/recipient scope;
- add negative tests for missing token, no employee, inactive/external employee, wrong
  capability/role, forged `sent_by`, and a missing conversation. In the current single-company
  model, capability-granted conversations are intentionally company-wide; add assignment/tenant
  scope tests when such a boundary exists.

The exact capability predicate must be defined once from the current permission/override model,
then reused by inbox reads and sends. A hard-coded UI role list is not sufficient evidence.

### `/api/callrail-connect`

Use `requireRole(..., ['admin'])` for GET/POST/DELETE before reading a signing secret or changing a
credential. Import from `functions/lib/auth.js`, not the legacy Google helper. Add missing-token,
non-employee, non-admin, and admin tests. Never return the API key. In the webhook-signing phase,
replace the query-secret setup instructions with the CallRail signing-key workflow.

Authorization remediation changes behavior for currently over-authorized callers and therefore is
not part of behavior-neutral Phase 1.

## 10. Phased delivery

### Phase 1 — Twilio-only transport seam (published)

Status (2026-07-23): complete and pushed as commit `a6cd652` on
`codex/messaging-transport-phase-1`. No deployment or provider change was made.

Owned changes:

- add `functions/lib/messaging-transport.js`;
- register only the existing Twilio helper;
- make `functions/api/send-message.js` call the seam with no provider/mode input;
- add seam tests proving exact Twilio argument/result parity and unsupported-provider failure;
- amend completed initiative ownership and canonical documentation.

Non-goals: migrations, CallRail send code, environment selection, authorization behavior,
webhooks, credentials, provider activation, request/response changes, client changes, or live send.

Rollback: revert the `send-message.js` import to `functions/lib/twilio.js` and remove the seam/test.

### Phase 2 — Authorization and idempotent persistence foundation

Status (2026-07-23): implemented and deployed. The corrected additive migration applied as
`20260723215926 messaging_transport_foundation`, followed by
`20260723220207 messaging_transport_foundation_indexes`. The generic fields and three service-only
ledgers are live; browser writes to `messages` are closed. The migration must not be reapplied.

Exact proposed next phase:

1. recapture live messaging columns, policies, grants, triggers, indexes, and callers read-only;
2. decide and test the server `conversations` capability predicate;
3. remediate `send-message` and `callrail-connect` authorization;
4. add reviewed, additive generic `messages` identity, `message_send_attempts`, and
   `message_provider_events` migrations with least-privilege grants/policies and rollback;
5. add optional `client_request_id` to both clients and `/api/send-message`, keeping the existing
   response shape;
6. keep Twilio as the only adapter and backfill/synchronize generic identity for Twilio;
7. deploy backward-compatible authorization and request-ID handling without reading or writing the
   new database objects, complete the owner-approved additive migration apply and verification,
   then deploy the generic dual-write path. Do not make a worker depend on unapplied schema.

Phase 2 still does not implement or activate CallRail.

The integration branch now closes two repository-only review gates: group/broadcast sends reserve
one parent request plus one child attempt per eligible recipient, so replay reuses completed
children and continues only recipients with no provider-side-effect claim; and accepted provider
outcomes retain the canonical body/media/address facts needed by the service-only
`materialize_message_send_attempt` recovery RPC. The protected recovery worker is database-only
and never resubmits to a provider.

Remaining verification/retention gates for the live foundation:

- approve and implement restricted `submitted_body` and canonical recovery-snapshot
  retention/deletion before any broader provider activation;
- compile/execute the committed migration and RPCs against an isolated post-Encircle PostgreSQL
  fixture as reproducibility evidence; do not reapply them to shared Supabase.

### Phase 3 — CallRail adapter, Production disabled

Status (2026-07-23): implemented and deployed. Preview is explicitly `callrail` with the required
server bindings; Production is `disabled` and has no CallRail messaging bindings. Owner-approved
controlled sends exposed and drove the HTTP 200 response-contract fix. No further send is
authorized by this status.

- keep official API limits and account/company/tracking-number eligibility current;
- retain unit coverage for the CallRail person-to-person adapter and fail-closed mode resolver;
- preserve proof that group/automated/scheduled/campaign attempts cannot reach the adapter;
- keep Production disabled; additional Preview/provider-console changes require an exact owner gate.

### Phase 4 — CallRail text ingestion and reconciliation

Status (2026-07-23): the signed receiver, normalized service-only event inbox, atomic canonical
inbound processor, STOP/START/HELP state handling (including consent-only MMS failure handling),
sent-event identity reconciliation, provider-history polling, bounded retry worker, and atomic
polling-outcome projection are integrated on `dev`. The
processor never sends an automated compliance reply through CallRail; HELP is recorded as requiring
a staff reply. Private MMS capture now derives fixed authenticated CallRail media endpoints,
enforces redirect/type/signature/size limits, stores only UPR-owned references, and resolves them
through a message-bound authorized short-lived URL route. The schema is live; a real
official/provider media fixture remains an activation blocker. Accepted or ambiguous sends
without a provider message ID are polled by provider conversation, exact addresses, submitted body,
and a narrow time window; zero/multiple matches fail closed. HELP is persisted for staff visibility
and ordinary/HELP inbound projection atomically enqueues a service-only notification outbox row.
A fenced, lease-based worker retries and dead-letters delivery without making the provider-event
projection best-effort. Preview's signed webhook reached the route, but the live payload omitted
the documented secondary `id`; reviewed source now allows only that field to be missing while
retaining required `resource_id` dedupe. Both controlled outbound attempts were later reconciled
without resend to `confirmed`, with processed `text_reconciled` recovery events and canonical
`sent` messages. A one-time Preview-only history importer then read one explicit CallRail
conversation in an owner-approved 18.5-minute window. It returned four records, skipped the two
outbound records so the normal reconciler retained ownership, and projected the two missing inbound
SMS records with their provider identities and original timestamps (`processed=2`, `skipped=2`,
`failed=0`). Canonical database verification and a refreshed dev inbox showed both inbound replies
in the intended direct conversation. The recovery branch, alias, endpoint, and all five temporary
Preview deployments were deleted after verification; the route was never merged into `dev` or
`main`.

This history result proves the normalized inbound processor and canonical projection against live
CallRail history. It does not yet prove that a fresh post-fix signed received webhook directly
claims and projects an inbound event without recovery. That direct webhook proof and a real
provider media fixture remain activation blockers. Production remains unconfigured and fail
closed.

- verify short-lived MMS ingestion/private resolution and provider-history response shapes against
  official or owner-approved provider test fixtures;
- compile and execute both transactional projection functions against isolated PostgreSQL and the
  reviewed live-schema snapshot as reproducibility evidence; do not reapply the live migration;
- execute notification-outbox enqueue/lease/retry behavior in isolated PostgreSQL;
- move Twilio inbound projection behind the same per-phone serialization boundary before any
  dual-provider overlap/cutover window, so late events cannot create competing direct threads;
- provider sandbox/fixture tests for replay, malformed payloads, media failure, and sent/inbound
  ordering;
- keep Production unconfigured; prove Preview's configured signed endpoint can directly claim and
  project sent and received events before any broader activation.

### Phase 5 — Owner-gated activation

Status (2026-07-23): Preview-only activation partially executed under separate owner approvals;
Production remains disabled. The admin readiness surface is shipped. Controlled outbound/reply
traffic reached CallRail and the signed route. Outbound reconciliation completed without resend,
and a bounded one-time provider-history recovery projected the two missing inbound replies into the
canonical conversation. The temporary recovery surface was deleted. A fresh post-fix signed
received webhook still must prove automatic direct ingestion before broader activation. Further
traffic, recovery mutation, provider configuration, or Production activation requires a new exact
owner approval.

- ship the admin-only, read-only setup/readiness surface without changing Production's disabled
  mode; its status/discovery results are preparation evidence, not activation;
- confirm business registration, eligible tracking number, API/signing credentials, documented
  webhook configuration, consent copy, retention, and support runbook;
- configure Preview first with production sending still disabled;
- run a single owner-approved TEST conversation using a dedicated test contact/number;
- verify UPR row, CallRail sent webhook, inbound reply, dedupe, mandatory inbound-MMS handling
  (outbound MMS may remain disabled), and no delivery status fabrication;
- activate Production only in a separately approved window.

### Phase 6 — Twilio-ready cutover proof

Status (2026-07-23): the repository cutover/rollback runbook is drafted. A real non-production
provider-switch proof remains blocked on reviewed deployment/configuration and owner-approved test
traffic.

- switch a non-production test environment from CallRail to Twilio using only server mode/config;
- verify clients, conversations, consent, attempts/events, and automation domain require no rewrite;
- retain provider-specific webhook adapters and number routing; document the production cutover
  runbook before any number move.

### Phase 7 — Twilio RCS readiness and controlled activation

Status (2026-07-23): documentation, partial unapplied attempt-level channel provenance, and unused
pure outbound/observation capability policies are built. RCS remains disabled and unconfigured.

- reserve provider-neutral RCS channel and content vocabulary without changing active behavior;
- finish message/event-level requested-versus-actual channel and fallback-observation evidence
  through a separately reviewed additive migration;
- normalize Twilio RCS sender identity, read receipts, rich-template identity, and inbound actions;
- submit RCS-intended messages using Twilio's documented `rcs:` no-fallback destination form and
  prove incapable recipients fail rather than silently receiving SMS/MMS;
- gate test-device, sender registration, content, deployment, and canary work behind explicit owner
  approval. Detailed plan: `docs/messaging-rcs-readiness.md`.

## 11. Test matrix

| Layer | Required cases |
|---|---|
| Seam | Twilio receives exact existing args; exact result returned; unsupported/missing future provider fails before fetch |
| Staff worker | frozen 201/403/400/401/500 shapes; internal note bypasses transport; consent/DND/missing contact fail closed; group blocked in CallRail mode |
| Authorization | missing/expired token; no/inactive/external employee; wrong capability; forged actor; missing conversation; allowed office/field-tech cases; assignment/tenant denial when that model exists |
| Admin setup | active internal admin only; status/default and CallRail-options actions; unknown action; no-store; redaction; missing config; provider auth/rate-limit/timeout/5xx; eligible active SMS tracker filtering; no write/send/control-plane mutation |
| Idempotency | same request id same content returns prior result; changed content rejected; concurrent duplicates one submission; ambiguous attempt never auto-resubmits |
| CallRail adapter | disabled/missing config; 140-char final-body boundary; number/tracker validation; MMS type/count/size; 201; 4xx/422; 429; 5xx; timeout |
| Webhook security | valid/invalid signature; raw-body integrity; stale timestamp; replay; unknown event; duplicate event |
| Reconciliation | POST-before-webhook; webhook-before-response persistence; no message id in POST; one match; no match; ambiguous multiple matches |
| Inbound | new/existing conversation; normalized phone ambiguity; STOP/START/HELP; consent log; notification; duplicate delivery |
| MMS | immediate authenticated fetch; redirect/MIME/size limits; private owned storage; expired URL retry; no durable provider URL |
| Isolation | scheduled, automated, group, broadcast, bulk, and campaign paths never import/call CallRail |
| Twilio parity | SID/status callback lifecycle remains; legacy `twilio_sid` and response fields remain; provider switch requires no client rewrite |
| RCS readiness | Twilio+RCS capability; CallRail+RCS refusal; requested/actual channel; read/action events; template identity; provider fallback refusal |

Repository unit/contract tests do not prove provider credentials, console configuration, actual
carrier delivery, Cloudflare variables, shared-database migration state, or native behavior.

## 12. Rollout, rollback, and owner gates

Every phase reports separately:

- repository tests/build/lint;
- isolated database contract results;
- deployed Preview/Production configuration;
- provider sandbox/live evidence;
- native/client smoke evidence.

Owner approval is required before:

- applying any migration to shared Supabase;
- adding/changing Cloudflare variables or secrets;
- configuring either provider's webhooks;
- activating `callrail` or `twilio` mode after the disabled rollout;
- sending a real message;
- moving, porting, or reassigning a phone number;
- deploying or promoting code when the user has not requested that delivery step.

Immediate operational rollback is `MESSAGING_SEND_MODE=disabled`, followed by provider webhook
disablement only if inbound processing is unsafe. Code rollback is a reviewed revert. Additive
schema stays in place while consumers roll back; no emergency column/table drop.

## 13. Phone-number cutover implications

Provider selection and phone ownership are related but separate:

- A CallRail tracking number is the required sender for CallRail; a Twilio Messaging Service/number
  is the sender for Twilio.
- A customer reply follows the carrier/provider that owns the number. Switching outbound mode
  without switching inbound routing can split one human conversation across providers.
- UPR conversation identity therefore remains contact/organization-owned; provider conversation ids
  are secondary mappings.
- Consent/DND remains contact/address/domain evidence, not a provider flag, but sender identity,
  disclosures, registration, and customer expectations must be revalidated when the number changes.
- Porting or reassigning a number can create downtime, delayed webhooks, duplicate late events, and
  provider overlap. Freeze sends, drain/reconcile attempts/events, change routing, then reopen.
- Never leave both providers able to originate from what staff believe is the same business number.
- Historical messages retain the provider and actual sender/recipient used at the time.

The production number decision is an owner/provider operation and is not implied by completing the
software phases.

## 14. Ownership supersession

This plan amends completed initiatives only for the named files:

- SMS Experience: `functions/api/send-message.js` may replace its direct Twilio import with the
  Phase-1 seam while preserving every frozen request/response, consent, sole-writer, and no-fallback
  contract. The Twilio helper is consumed as the adapter; its later comment-only RCS guard documents
  why provider-console RCS activation remains prohibited.
- Tech Messages v2: its blanket freeze on `functions/lib/*` and `send-message.js` is amended only for
  this provider seam. The tech client remains provider-blind and call-only; Phase 2 adds only the
  stable `client_request_id` field.
- CRM/omni automation freezes remain: `automated-send.js`, `process-scheduled.js`, campaigns, and
  other non-person-to-person senders do not move to the selectable seam.

The matching amendments are recorded in the old manifests as pointers to the new authoritative
ownership manifest.
