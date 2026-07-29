<!--
FILE: docs/integrations.md

WHAT THIS DOES (plain language):
  Maps the external systems UPR talks to, what each connection is for, and where credentials and
  safety checks belong. It is an orientation map, not proof that production consoles are configured.

DEPENDS ON:
  Internal: functions/api/, functions/lib/, docs/testing-and-deployment.md,
            docs/auth-and-authorization.md, docs/business-rules.md
  Data:     reads → integration configuration, provider events and domain records
            writes → documentation only

NOTES / GOTCHAS:
  - Cloudflare/provider console state is external and must be verified separately.
  - Never put real credentials or reviewer identities in this file.
-->

# Integrations

## Integration map

| System | Purpose | Primary boundary |
|---|---|---|
| Supabase | Auth, Postgres/PostgREST, RPCs, Storage and Realtime | Browser user JWT; Worker service role; database RLS/RPCs |
| QuickBooks Online | Customers, estimates/invoices, payments and reconciliation | QBO Worker libraries/endpoints plus durable external IDs |
| Intuit Payments | Tokenized keyed-card charges | Browser tokenizer → Intuit; authorized Worker charge/reconciliation |
| Stripe | Checkout payment links and payment webhooks | Authorized Worker, signed/idempotent webhook |
| Twilio | Current SMS transport and future communications | Provider adapter, consent-gated staff/automation paths, signed inbound/status webhooks |
| Resend / email routing | Transactional/marketing email and replies | Suppression/unsubscribe/DND gates and signed webhooks |
| CallRail / Deepgram | Call/form ingest and planned staff person-to-person SMS transport | Separate voice/form and text adapters into canonical CRM/messaging data |
| Google | Drive, Calendar, Ads and Maps/autocomplete | OAuth callbacks, scoped tokens and server-side provider calls |
| Meta Ads | Advertising integration | OAuth callback and server-side API |
| Encircle | Restoration/job data import and reconciliation | Server-side adapter and external identity mapping |
| Property Meld | Meld ingestion | Authenticated/signed ingestion path and deduplication |
| APNs / Web Push | Native and web notifications | Device subscriptions, provider credentials and recipient targeting |
| Capgo / Apple | OTA/native build and distribution | CI/provider console, signing and release controls |
| GitHub | Repository automation and MCP owner operations | Scoped token/app permissions and explicit write confirmation |
| AI/report providers | Analysis, transcription and document generation | Server-side requests, bounded inputs, structured outputs and review gates |

Exact active providers and configuration must be confirmed against `functions/`, current environment
bindings and provider consoles.

## Shared integration rules

- Credentials remain in Cloudflare/provider secret storage or service-only database objects. Browser
  bundles, migrations, docs and logs never contain real secrets.
- OAuth callbacks validate state, use exact redirect origins and store tokens only in approved
  service-only locations.
- Webhooks verify provider authenticity before parsing side effects and claim/deduplicate a stable
  provider event ID before acting.
- Outbound requests use the shared timeout helper and classify retryable failures.
- Money and company side effects use stable idempotency keys, durable state and reconciliation.
- Workers enforce employee/role authorization before reading private data or calling providers.
- Provider errors returned to clients are sanitized; operational detail goes to controlled logs.
- Every integration has a disabled/unconfigured state that fails safely and explains the next step.
- Production and Preview variables are both inventoried; origin/redirect/CORS values are tested per
  environment.
- Provider-specific raw payloads are normalized at the adapter boundary so business rules consume
  owned canonical fields.
- Native APNs delivery requires a durable producer occurrence ID. Each direct producer supplies its
  persisted source identity; a missing ID skips native delivery rather than deriving identity from
  mutable copy. Delivery claims use a non-reversible token/environment fingerprint and survive
  token-row deletion/re-registration. Explicit APNs 429/5xx refusals release, reclaim, and receive
  one bounded retry; a durable message-notification outbox keeps an exhausted explicit refusal
  retryable in native-only mode so bell/Web Push/email do not duplicate. Timeout/network ambiguity
  retains the claim and is never auto-replayed. The inbound-message claim RPC returns the durable
  outbox `id` but not `provider_event_id`; the worker therefore uses that returned outbox `id` as
  the stable native occurrence across retries. Protected worker telemetry retains only aggregate
  native counts and allowlisted skip categories, never employee/device identifiers or upstream
  provider details.
- One trusted event is dispatched to both exact APNs token cohorts: sandbox for development-signed
  installations and production for TestFlight/App Store installations. Each cohort keeps its own
  token query, Apple host, fingerprint, delivery claim, pruning environment and bounded five-token
  fanout; the configured `APNS_ENV` remains a required fail-closed activation signal. A rejected
  cohort is a sanitized retryable failure, so the durable inbound-message outbox replays native
  delivery only and does not resend bell, Web Push, or email.
- `functions/lib/notificationPresentation.js` is the exhaustive native presentation registry. It
  now also projects separately governed typed bell/PWA definitions for the 15 live event types.
  Admin overrides are validated against event-specific variables and route identifiers before
  dispatch. Native copy remains privacy-locked with no configurable variables, and arbitrary
  producer/admin copy, paths, URLs, data, or route parameters still cannot enter the APNs payload.
  Presentation lookup uses a bounded service client and fails back to code defaults; preview makes
  no APNs, Web Push, email, SMS, or other provider call.
- The owner-only delivery diagnostic may render each of those 15 registry types with synthetic
  values and deliver it to the owner's bell, enrolled Web Push subscriptions, and
  environment-matched iPhone tokens. Each event/surface gets its own stable diagnostic identity;
  Web Push also gets a unique tag so the service worker does not collapse separate types. This
  diagnostic is independent of the source event's master enable switch, creates no source
  business event, and never enters email, SMS, or MMS transport.
- Staff-written SMS uses one server chokepoint and a provider-neutral transport seam. CallRail is
  never an allowed adapter for scheduled, automated, group, broadcast, bulk or campaign sends, and
  no provider failure falls back to another provider/channel. Plan:
  `docs/messaging-transport-roadmap.md`.
- `POST /api/attest-sms-consent` is an evidence-recording integration boundary, not a messaging
  adapter: it makes no Twilio/CallRail request and cannot send an opt-in solicitation. Once verified
  prior service consent is recorded, `POST /api/send-message` remains the sole staff-send
  chokepoint, consumes the service-only consent decision, and adds Utah Pros identification plus
  first-conversation STOP instructions before provider dispatch. Recording permission never
  automatically retries or sends the failed message; staff must choose Retry as a separate action.
  The mobile thread does not call the attestation GET endpoint on open; the server rechecks when
  staff presses Send. Under the reviewed 2026-07-28 opt-out-only rollout, a staff-written direct
  service message may accept the distinct `IMPLIED_CONSENT` code after the matching migration is
  separately applied. Dedicated typed transactional-service producers may also accept
  `SERVICE_CONSENT` or `IMPLIED_CONSENT` for reviewed registry entries, initially
  `appointment_scheduled`, `appointment_canceled`, and `signature_request`. A producer must derive
  its event, destination and approved copy from the server-owned appointment or signature record,
  use a stable source-record/event delivery identity, and write the mandatory durable
  `transactional_service_send_allowed` audit before provider selection. No such automated producer
  is live yet, and the generic `sendAutomatedMessage()` API has no caller-controlled service-purpose
  bypass. Generic automation, scheduled free-form, group, broadcast, bulk, marketing, and campaign
  sends still require `GLOBAL_OPT_IN`.
- The UPR e-sign Worker has a repository-authored, not-yet-released bridge for native Work
  Authorizations. It recognizes only the pinned rendered SMS disclosure and asks a service-only
  database wrapper to complete the signature plus store linked immutable evidence atomically.
  Missing schema or changed disclosure completes signing without permission, so staff messaging
  remains blocked. The bridge calls no SMS provider and cannot send/retry a message.
- `process-scheduled` also submits through `sendAutomatedMessage()` rather than calling Twilio
  directly. This keeps the automation kill-switch, global-consent/DND decision, recipient-local
  quiet hours, provider retry policy, delivery callback and worker-owned message row on one
  structurally shared path. Scheduled media remains Twilio-only; CallRail is not an automated-send
  fallback. Its HTTP trigger accepts the scheduler secret or an active, non-external
  admin/office/project-manager session. An ambiguous provider outcome is not automatically
  resubmitted by scheduled, CRM-automation or sequence consumers; each enters a terminal or paused
  reconciliation state at the exact send action. Fixed automations suppress a later run after their
  terminal event persists, but automated SMS stays activation-blocked until a pre-send reservation
  closes the post-send event-persistence gap.
- Future Twilio RCS uses that same domain boundary. RCS Sender IDs, Content SIDs, rich-content
  shapes, channel capability checks, read receipts and action payloads are Twilio adapter/webhook
  facts; conversations and consent remain UPR-owned. Twilio's automatic RCS-to-SMS/MMS fallback is
  not approved. Readiness contract: `docs/messaging-rcs-readiness.md`.
- CallRail text events require a dedicated route; the current CallRail voice/form webhook treats
  non-form payloads as calls and must never receive SMS Received/Sent webhooks.

## Verification expectations

For a changed integration, verify:

1. missing configuration and revoked/expired credentials;
2. allowed and denied caller roles;
3. timeout, 429, 5xx and malformed response behavior;
4. duplicate/replayed webhook or request behavior;
5. provider sandbox success plus local durable state;
6. partial failure and reconciliation/recovery;
7. logging without credentials, card data or unnecessary PII;
8. deployed Preview/Production callback, CORS and secret bindings;
9. updated privacy/App Store/retention disclosures when data flow changes.

## Live Supabase-managed integrations (verified 2026-07-22)

- Ten `pg_cron` jobs were active; nine had successful 30-day history and the newly scheduled real-job
  reconciler had not reached a recorded run.
- Realtime published `conversations`, `messages` and `notifications`.
- `job-files` was public/listable; `message-attachments` was private with no object policies.
- Two Edge Functions were deployed: a JWT-protected retired `notify-test-push` returning 410, and
  an unauthenticated wildcard-CORS `sheets-proxy` forwarding to Google Apps Script.

The Edge Function list is an external runtime surface, not implied by `functions/api/`. A release
inventory must compare deployed function slugs/hashes/auth settings with source reachable from the
release branch. `sheets-proxy` has no source in audited `dev` and must be removed or brought under
normal auth, source control and deployment verification. See
`docs/audit/2026-07/evidence/live-supabase.md`.

## Local and external limits

Vite alone does not run Pages Functions; local Worker verification requires a built site plus
Wrangler. Many privileged paths require Cloudflare-held secrets and are therefore verified on an
authorized deployed environment or provider sandbox. Repository tests/mocks are necessary but do
not prove console configuration, provider approval, DNS/email routing, Apple signing or production
webhook delivery.

Update this file in the same commit when adding/removing a provider, changing data exchanged,
moving credential ownership, changing webhook/auth/idempotency behavior, or altering production
configuration requirements.

## Encircle managed credential rollout

The permanent target is the service-only `integration_credentials` row managed from Connections.
All seven Pages Encircle workers and the separate `upr-mcp` adapter resolve that row first. The
existing `ENCIRCLE_API_KEY` remains a temporary fallback only while the row is absent or explicitly
`fallback`; `disabled` suppresses it. Candidate activation is active-admin-only and validates via a
bounded read-only organization request before storage.

Read-only Cloudflare inspection on 2026-07-23 confirmed the fallback binding name exists in both
Pages Production and Preview and on the deployed `upr-mcp` Worker; no values were read. A read-only
request to `demo-sheet.netlify.app` returned HTTP 200 with the Utah Pros Demo Sheet title, so that
legacy runtime is still publicly deployed. The owner confirmed on 2026-07-23 that it is obsolete and
unsupported. Retire the Netlify deployment and any remaining secret binding separately; it is not a
supported Encircle consumer or a credential-rotation dependency.

## QuickBooks Online authorization checkpoints (R0 S1a and S1b, 2026-07-26)

The local R0 containment slice centralizes authorization for `/api/qbo-invoice`,
`/api/qbo-estimate`, `/api/qbo-payment`, and `/api/qbo-query`. An exact configured
`x-webhook-secret` preserves the existing server-to-server contract; otherwise a Supabase Bearer
must resolve to an active, non-external `admin`. Authorization completes before connection,
service-role domain reads, telemetry and Intuit calls, and the downstream request/response/provider
contracts are unchanged.

The capability is not a human role and no checked-in caller was found for its use on those four
routes. Do not rotate or retire it independently: customer sync and payment sync share its
lifecycle. Cloudflare binding presence/equality and deployed callers were not inspected.

S1b applies the same browser boundary to customer sync and the payment poller's HTTP GET/POST
handlers while preserving their exact secret-first capability and the poller's separate direct
`scheduled()` entry. OAuth connect is deliberately human-only: a server secret cannot replace
`qbo_oauth_state` or `qbo_oauth_user`. Charge and attachment mutation retain their existing
Bearer-only billing predicate and now explicitly reject external employees before privileged
work. Approved-caller downstream request/response shapes, callback redirects, scheduler behavior
and provider helpers are unchanged; new denials are the deliberate authorization transition.
Customer-sync and manual payment-sync browser authorization resolves the actor but does not
persist that actor in current worker telemetry, so complete QBO actor auditability remains open.

This remains a source-only slice. Direct `qbo_attachments` metadata SELECT does not yet exclude
external admins, and the broader mobile Worker/RPC/RLS/Storage boundary remains open. The real role
is `project_manager`, not `manager`; project-manager billing authority remains owner-gated.
R0 source/live evidence is in
`docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md`; the S1b source,
test, rollout and rollback record is
`docs/audit/2026-07/evidence/mobile-readiness-s1b-qbo-identity-2026-07-26.md`.

## CallRail recording and notification HTTP checkpoints (S1c, 2026-07-26)

`GET /api/callrail-recording` is shared by mobile `LeadRow` and desktop `CrmCallLog`. It now
authorizes an active internal admin or the established `crm_call_log` capability before any
service-role lead/credential read or CallRail request. The exact UUID must name a call row whose
stored `callrail_id` matches the ID in its stored allowlisted `api.callrail.com` or
`app.callrail.com` recording URL. There is no employee-to-CRM-organization mapping, so the approved
capability is explicitly company-wide rather than falsely described as tenant- or assignment-scoped.
External CRM partners are denied even though their current desktop shell exposes the Call Log UI.
The non-admin Worker capability does not currently consume the desktop CRM rollout/kill flags.
Direct authenticated `get_inbound_leads`/`inbound_leads` access remains a separate route around the
proxy and prevents an end-to-end recording-confidentiality claim.

The proxy preserves the deployed 200 audio stream, `Content-Type`, and
`Cache-Control: private, max-age=300` contracts, plus its existing JSON error families. Both the
authenticated CallRail recording fetch and the no-auth signed-audio follow-up are bounded by the
shared 15-second timeout. Browser `Range` and authorization headers are not forwarded. Account
discovery/rewrite remains compatible and can persist a discovered account ID only on an approved
deployed request; no provider or setting was contacted during S1c verification.

HTTP `POST /api/notify` has no checked-in browser/mobile/desktop Bearer caller. Its deployed HTTP
caller is `notify_emit`, which reads the stored URL/secret and is reached by appointment,
estimate, timesheet and abandoned-clock trigger/cron origins. The exact secret remains
header-first and receives the existing full event payload. Direct CallRail/form/feedback/e-sign,
message/webhook/outbox, health, Meld and payment paths continue to import `dispatchEvent`
in-process. Fan-out ordering, preferences, type-disabled skips, channel summaries, VAPID behavior,
dead-subscription pruning and transactional email behavior are unchanged.

The retained legacy Bearer surface now requires an active internal admin and accepts only four
object-derived events: appointment assigned/updated/canceled and estimate accepted. It rejects all
caller message copy, recipient, payload and link fields before dispatch. Shared Auth and Web Push
still use their pre-existing raw fetch paths; adding global timeouts there is outside this identity
slice. Email retains its timed provider request.

At the S1c checkpoint, the dated generated/live inventory showed `notify_emit(text,jsonb)` remained
`SECURITY DEFINER` and executable by `authenticated`; S1c therefore did not close the
database-side capability bypass. That historical gap was closed by the later S1d live apply
described below. S1c evidence:
`docs/audit/2026-07/evidence/mobile-readiness-s1c-callrail-notify-2026-07-26.md`.
Direct authenticated execution of `create_notification` has a separate S1f attribute-only apply
candidate. It retains the service-role Worker and owner-run midnight-clock caller and remains live
exposure until its own reviewed apply/verification window.

## Notification dispatcher database checkpoint (S1d, live 2026-07-27)

The original S1d read-only capture found one exact `notify_emit(text,jsonb) -> void` overload and no
browser/Pages source caller. It is owned by `postgres`, runs `SECURITY DEFINER` with
`search_path=public`, and then granted EXECUTE to `authenticated` and `service_role`.
Its direct database graph is three notification trigger functions, two timesheet RPCs, and the
abandoned-clock scanner; those six definer functions contain seven calls, and the scanner is
scheduled every 30 minutes as `postgres`.

`20260726110000_notify_emit_service_boundary.sql` is live as ledger entry
`20260727233704 notify_emit_service_boundary`. It removes direct browser execution and retains
only owner/`service_role` execution while leaving the
owner-executed database chain intact. The HTTP contract is deliberately frozen: the notification
catalog enabled gate, Worker URL/secret configuration key names, stored values, `Content-Type`,
`x-webhook-secret`, `net.http_post`, fire-and-forget response behavior, and `/api/notify` payload
shape do not change. Only the JSON object merge order changes so the trusted `p_type_key` cannot be
replaced by `p_body`.

Apply and rollback each fail closed on the captured function and caller graph. A 2026-07-28
read-only recapture confirmed owner `postgres`, body hash
`27d638e9e2681bf74f17fa255c7eaf04`, `search_path=public`, and EXECUTE only for owner plus
`service_role`; it invoked no notification or provider. Evidence:
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`.

## Notification read/Realtime recipient checkpoint (S1g, 2026-07-26)

PWA and Capacitor share `NotificationBell` and `subscribeToNotifications`; no client source change
is required for S1g. The deployed list/count/mark call shapes remain exact, and the existing
JavaScript recipient comparison stays as defense in depth.

The unapplied S1g migration moves the primary boundary into Supabase. Direct table SELECT and
Postgres Changes authorize only an active, non-external employee's own targeted rows plus
broadcasts. Because Realtime evaluates table RLS before delivering a Postgres Changes payload, a
foreign targeted title/body/link/payload must no longer reach the callback after apply.
`notifications` remains in `supabase_realtime`; the private receipt table is not published. The
policy's employee lookup depends on authenticated employee SELECT/RLS visibility, which the S1g
preflight pins explicitly.

Broadcast read state becomes per employee through private receipts while the RPC still returns the
same `notifications` composite and projected `read_at`. Existing shared non-null `read_at` values
remain globally read for compatibility. This source checkpoint does not prove a live socket:
apply qualification requires two authenticated synthetic sessions showing own and broadcast
INSERT delivery, foreign INSERT non-delivery, mark isolation, reconnect/token-refresh behavior,
and unchanged PWA/Capacitor call results. It is a separate gate from notification emission,
providers, native push, OTA, signing, and devices.

The guarded SQL behavior matrix passed in an in-memory PostgreSQL-compatible harness and is wired
into the local-only Supabase DB runner. That does not substitute for the two-session PostgREST and
Realtime socket qualification above.

**S1e/S1g apply-order prerequisite:** before either target’s own entry gate, separately apply and
verify `20260726180000_mobile_employee_identity_authority.sql`, deploy compatible
browser/PWA/native clients and retire old clients or record the owner’s explicit risk decision,
then separately apply and verify `20260726182000_mobile_employee_identity_containment.sql`. Current
S1e and S1g preflights fail closed unless exactly one live `mobile_employee_identity_containment`
ledger row exists and its browser-read-only employee contract still matches. Recapture that
catalog/ledger state before the target preflight. This prerequisite neither authorizes nor combines
S1e or S1g; each remains its own owner-approved window.

## Mobile push R0 authorization checkpoint (2026-07-25)

The Web Push subscription RPCs resolve their employee from `auth.uid()` before upsert/delete, but
native post-login `upsert_device_token(p_employee_id, ...)` trusts the browser-supplied employee ID
inside a live `SECURITY DEFINER` function and can reassign an existing token. Notification
preference and bell RPCs similarly accept employee/notification IDs without reconstructing the
caller. These are open `MOB-SEC-014` boundaries; UI visibility and client-side recipient filtering
are not authorization.

No APNs/Web Push provider action, entitlement/signing check, physical-device test, binding change,
or push delivery occurred in R0. Product inclusion and rollout remain owner-gated, and any
containment must preserve account-switch/logout behavior plus deployed RPC response shapes.

## QuickBooks Online attachments (2026-07-24)

`POST /api/qbo-attach` attaches a staff-selected file to a QBO Invoice or Estimate via the QuickBooks
Attachable API (`/v3/company/{realmId}/upload`, multipart) with `IncludeOnSend=true`, so the file
shows on the transaction in QuickBooks **and** rides along on the email QuickBooks sends the customer.
Auth is the literal `requireRole(['admin','manager'])` predicate (mirrors `qbo-charge`); because
`manager` is not a current employee role, it is admin-effective. The Worker explicitly rejects
external employees after that predicate and before connection or data/provider access. It requires
the invoice/estimate to already carry a
`qbo_invoice_id`/`qbo_estimate_id`. The file goes browser → worker → QuickBooks as base64 (≤20 MB);
the raw bytes are never stored in UPR — only metadata + the opaque attachable id in
`qbo_attachments`. Idempotent: a required `Idempotency-Key` header + a pre-insert lookup prevent a
retry from creating a duplicate Attachable (which would email the customer twice). A `delete`
action removes the Attachable from QuickBooks (GET SyncToken → delete) and the tracking row.
Outbound calls use `fetchWithTimeout`. Helpers live in `functions/lib/quickbooks.js`
(`uploadAttachable`/`getAttachable`/`deleteAttachable`/`buildAttachableMetadata`); the UI is the
shared `src/components/collections/QboAttachments.jsx` in the invoice + estimate editors. Uses the
already-granted **accounting** scope (no Payments-scope reconnect needed). The UI lists metadata
directly through the table SELECT policy, which is role-scoped but does not yet exclude external
admins; that RLS residual is tracked separately from Worker mutation containment.

## QuickBooks Online payment two-way sync activation (2026-07-24)

The QBO→UPR payment path (`qbo-webhook.js` real-time + `qbo-payments-sync.js` hourly safety net,
`qbo-payment-sync.js` mapper, dedup on `qbo_payment_id`) is built. Historical 2026-07-24 evidence
records migration `20260724180100_qbo_payments_sync_cron.sql` as applied and wiring the hourly
poller via Supabase pg_cron + pg_net → `/api/qbo-payments-sync`, carrying
`integration_config.qbo_webhook_secret` as `x-webhook-secret` (the value already set in Cloudflare as
`QBO_WEBHOOK_SECRET`, which is how customer-sync authenticates today). S1b did not re-read current
runtime values or invoke the schedule. The real-time half remains owner/dashboard gated: set
`QBO_WEBHOOK_VERIFIER_TOKEN` in Cloudflare (Production + Preview) + redeploy, and subscribe the
**Payment** webhook in Intuit Developer (production) to `https://utahpros.app/api/qbo-webhook`.

## Messaging transport build state (2026-07-23)

Phase 1 is published with Twilio behavior unchanged. The integrated transport foundation adds a
server-only selector (`MESSAGING_SEND_MODE=disabled|callrail|twilio`), a schema writer gated by
`MESSAGING_SCHEMA_MODE=legacy|foundation`, a person-to-person-only CallRail adapter, and a dedicated
`/api/callrail-text-webhook` receiver. Missing/unknown send mode disables outbound messaging;
missing/unknown schema mode stays legacy; missing webhook signing configuration fails closed.
There is no provider or channel fallback.

The receiver verifies CallRail's raw-body signature and timestamp before parsing, validates only
text received/sent events, and claims a normalized dedupe record without retaining raw payloads or
short-lived MMS URLs. The integration branch now projects inbound SMS into canonical contacts,
conversations and messages through an atomic service-role RPC, applies shared STOP/START/HELP state
rules (including a consent-only transaction when MMS capture fails), reconciles sent events by
provider message identity or strict conversation/address/body/time identity, and retains transient
failures with bounded backoff for the protected `process-callrail-events` recovery worker. It deliberately does not auto-send compliance replies
through CallRail. The repository build immediately downloads the signed webhook's short-lived
media endpoint after strict CallRail host/account validation; queue retries refresh current
endpoints through the conversation API. Recovery claims use the service-role-only
`claim_callrail_provider_event` RPC so a successful claim and its returned work item are one
atomic database operation; an empty result means the worker lost the claim without mutating it.
It copies verified MMS bytes into private
`message-attachments`, persists only `upr-storage://` references, and signs a short URL only after
messaging authorization and message/index binding. The separate reconciliation worker polls
CallRail history read-only and projects a winning outcome atomically. Isolated PostgreSQL
compilation, provider fixtures, and reviewed retention remain activation blockers. Repository
source includes atomic canonical-message recovery plus a durable, fenced notification outbox. The
MMS account check supports both CallRail's legacy numeric account id and its current masked
`ACC...` resource id only after `/v3/a.json?fields=numeric_id` proves that they identify the same
API-visible account; arbitrary account paths remain rejected.
foundation and covering-index migrations are live; repository tests cover the SQL callers, but
isolated PostgreSQL compilation of every later projection/recovery contract remains a separate QA
requirement.

Outbound MMS uses the same private bucket without publishing customer photos. Both inboxes upload
through authenticated `POST /api/message-media-upload`; the Worker verifies one final JPEG, PNG, or
GIF no larger than 5,000,000 bytes and returns only an opaque owned reference. `/api/send-message`
downloads and revalidates that object after authorization/consent. The CallRail adapter streams it
as documented multipart `media_file`. The Twilio adapter instead creates a one-hour signed URL
inside the transport boundary because Twilio must fetch `MediaUrl`; that URL is never stored.
CallRail's short-lived inbound provider media URLs are likewise never stored, so there is no
provider-URL cleanup dependency after successful private capture.

Live evidence on 2026-07-23 recorded one inbound iPhone MMS as a signed, deduplicated provider
event, but the deployed derived download path failed before private Storage with
`CALLRAIL_MMS_DOWNLOAD_FAILED`. That event proves receipt, not media completion. The corrected
webhook-URL flow and retry refresh require a controlled post-deploy image reply before this
integration can claim an end-to-end inbound MMS round trip.

The same event exposed a separate recovery-wiring gap: Pages deployed the protected
`/api/process-callrail-events` HTTP route, but an exported `scheduled()` handler does not create a
route-level Pages Cron Trigger. An additive scheduler migration now follows the
repository convention by using pg_cron/pg_net every five minutes, the existing cron secret, an
exact dev/production URL allowlist, and a due-work predicate. It makes no provider send and
preserves retained events on rollback. The owner applied and verified that scheduler on
2026-07-24; the atomic-claim follow-up is coupled to its reviewed worker deployment.

The notification outbox is dispatched through the protected
`/api/process-message-notification-outbox` worker. An additive scheduler migration stores only the
non-secret exact worker URL, reuses the existing scheduler secret, wakes the worker after an outbox
insert commits, and runs a five-minute due/stale-work safety net. Missing configuration, an
unrecognized URL, or an empty queue is a fail-closed no-op. The fenced claim token remains the
delivery concurrency boundary. Bell and push delivery are at-least-once: a worker crash after a
channel side effect but before durable outbox finalization can produce a duplicate alert when the
stale lease is reclaimed.

For `message.inbound`, the provider-neutral notification dispatcher derives both deep links from
the canonical conversation ID. Bell navigation stays in the office inbox at
`/conversations?c=<id>`; Web Push opens the exact thread in the installed field PWA at
`/tech/conversations?c=<id>`. Provider adapters and webhook payloads do not choose UI routes.

The additive foundation migration and its index follow-up are applied to the shared Supabase
project. On 2026-07-23 the owner approved a Preview/dev-only activation for the CallRail sender
ending in `4121`: Preview has the server-side provider bindings, `MESSAGING_SEND_MODE=callrail`,
and separate sent/received text webhooks targeting `/api/callrail-text-webhook`. Production remains
`MESSAGING_SEND_MODE=disabled` and has no CallRail messaging provider bindings.

The first controlled dev send to the owner's phone exposed two contract defects without requiring
a retry: CallRail delivered the message and returned HTTP 200 with a conversation identity, while
the adapter accepted only the documented HTTP 201; the signed sent and received webhooks reached
UPR but failed strict payload normalization before durable claim. The adapter therefore accepts
only HTTP 200 or 201 with a usable conversation identity, while every malformed or unfamiliar 2xx
remains ambiguous and non-retryable pending reconciliation. Webhook authentication remains
fail-closed. Value-free validation telemetry may record only the invalid field name so a later
controlled event can identify provider schema drift without retaining raw payloads, message
content, phone numbers, IDs, or secret material.

That controlled event identified `id` as the drifted field: the valid signed CallRail webhook
omitted the documented secondary numeric event ID while retaining `resource_id`. UPR accepts a
missing/null secondary ID but still requires `resource_id`, which remains the durable provider
message identity and dedupe key. A malformed non-null `id` still fails closed.

The finish-first recapture first found two CallRail attempts (`accepted=1`, `failed=1`) and zero
provider events. Recovery then reconciled both outbound attempts to `confirmed`, with two processed
`text_reconciled` events and two canonical `sent` messages; no resend occurred.

A separate one-time Preview-only history importer was used after read-only checks proved the exact
customer phone mapped to one active direct UPR conversation. Its explicit 18.5-minute window
returned four CallRail records, skipped both outbound records, and projected both missing inbound
SMS records with their provider identities and original timestamps. The canonical rows were
verified as `received`, and the refreshed dev inbox displayed both replies in order. The importer
branch, route alias, and all temporary Preview deployments were deleted and were never merged.

The recovered rows prove live provider-history normalization and canonical inbound projection.
They do not prove automatic direct ingestion from a fresh post-fix signed received webhook; that
remains the next Preview proof before broader activation.

The repository also reserves an unused RCS capability vocabulary for Twilio. This does not alter the
active transport or provider configuration. RCS remains blocked until requested-versus-actual
channel persistence, sender/content identity, signed inbound/status normalization, consent review,
test-device evidence, and an owner-approved no-fallback production configuration are complete.

### Admin messaging setup boundary

The Settings integration surface may read a redacted readiness contract from
`GET /api/messaging-setup` and request bounded, read-only CallRail sender discovery with
`GET /api/messaging-setup?action=callrail-options`. Both operations are active, internal-admin-only
and must authorize before any provider lookup through the stored server credential. The status
contract may expose booleans, safe mode labels, readiness blockers, the dedicated text-webhook
path, and eligible active CallRail trackers/numbers needed to identify the intended sender. It
never returns credentials, signing material, raw provider responses, customer conversations,
destination numbers, or call-flow details.

Configuration presence is not activation readiness. Status stays unverified until bounded live
discovery confirms that the server-configured company and tracking number are the same active
`sms_supported=true`, `sms_enabled=true` CallRail pair. Discovery uses the already-resolved account,
applies a five-second timeout per page, and fails closed rather than returning a truncated
inventory. Recovery counts are shared-database health, not proof that either deployment's webhook
is installed or receiving events.

This surface is an operator aid, not a deployment control plane. It cannot write
`MESSAGING_SEND_MODE`, `MESSAGING_SCHEMA_MODE`, `CALLRAIL_SIGNING_KEY`, provider webhook settings,
or Cloudflare bindings, and it cannot send a test message. Preview and Production bindings remain
owner-managed and independently verified; the shared Supabase project is never used to select a
staging-only provider. Production remains `MESSAGING_SEND_MODE=disabled` until the separately
approved activation window and provider proof. The same boundary applies to future Twilio RCS:
the panel may report readiness, but RCS stays channel-locked with no automatic SMS/MMS fallback.

### Provider-event operations boundary

Ops-health message-event alerts link to the owner-only Provider Events panel at
`/dev-tools?tab=messaging&sub=events`. `GET /api/provider-event-ops` returns a paginated,
no-store list of unresolved failed/retryable events with only operational identity: provider,
direction/type, error/state, attempt count, phone endpoints, provider message ID, timestamps and
outcome. It never returns message content, media references, raw-body hashes or provider payloads.

`POST /api/provider-event-ops` accepts only `retry` or `resolve` for one exact event UUID after the
same active-internal-owner check as Dev Tools. Retry reads the current row server-side and calls the
existing service-only `rearm_callrail_provider_event` RPC with that exact row/error compare-and-set;
the existing scheduled recovery worker later projects the retained event. Resolve calls the existing
service-only `resolve_provider_event` RPC and records the verified owner employee ID. The endpoint
does not call CallRail, choose a provider, submit/resubmit an SMS/MMS, or alter consent.

### CallRail live MMS endpoint compatibility

Authenticated CallRail history observed on 2026-07-24 returned account-scoped media endpoints under
`https://app.callrail.com/msg/a/<account>/messages/<message>/media/<index>`, although the public API
documents the v3 `api.callrail.com` shape. UPR accepts either only when the account, provider message,
media index, HTTPS scheme, port, credentials, and path exactly match already-proven event identity.

After that exact identity validation, UPR proves the legacy numeric/current masked account aliases
through authenticated discovery, prefers the current masked `ACC...` identity, and normalizes the
app-host path to the equivalent documented `api.callrail.com/v3/a/...` endpoint before the CallRail
API token is attached. A controlled 2026-07-24 Preview MMS proved that the app host returns `401`
to that API token, so UPR never presents the credential to the browser-session host or relies on a
numeric-account redirect. Redirects are handled manually. UPR follows
only a valid short-lived AWS4 signed URL on the exact known CallRail MMS S3 host, strips the
CallRail token from that request, rejects further redirects, and still verifies image MIME, magic
bytes, item size, and total size before private Storage ownership. No provider or signed asset URL
is persisted.

CallRail `message.sent` recipients may omit the `+1` stored on the original UPR attempt. Outbound
projection normalizes only validated NANP forms; it does not loosen non-NANP, body, conversation,
provider-message, or attempt identity checks.

### CallRail recording-source isolation (S1e authored, not applied)

The recording proxy keeps its URL allowlist, lead UUID/provider-call binding, credential ordering,
direct/signed audio streaming, private cache header, and JSON error contracts. Its source lookup
changes from browser-readable `inbound_leads.recording_url` to service-only
`inbound_lead_recording_sources`; `transcribe-call` uses the same source. The public lead row keeps
only `upr-recording://available`, preserving mobile/desktop truthiness without disclosing a
provider URL. Both Workers retain a validated legacy-column fallback so compatible code can deploy
before the table; the marker is never accepted as a source. Ingestion recursively strips
`recording` and `recording_url` keys from stored `raw_payload`. No provider request, playback,
credential read, or live setting change occurred.

Outbound MMS media is already copied into UPR's private `message-attachments` bucket before the
provider submission. A signed `message.sent` event therefore confirms the exact send-attempt ledger
identity without downloading UPR's own attachment back from CallRail. Confirmation requires the
event channel to match the attempt channel and every MMS attachment to be a non-empty private
`upr-storage://message-attachments/outbound/` reference. A binding mismatch reuses the deployed
retryable `outbound_unmatched` outcome so older and newer workers both fail closed while the shared
database migration rolls out. Inbound MMS remains
fail-closed: it must download the verified provider media endpoint, validate the response bytes,
and persist an owned private reference before canonical projection.

### Mobile subscription and native-token ownership (S1h authored, not applied)

Web Push registration keeps the deployed endpoint/key/user-agent contract, but authenticated source
resolves the one active, non-external employee from `auth.uid()`. Same-owner registration refreshes
keys and metadata. A foreign-owned endpoint is rejected rather than transferred. List output stays
redacted to ID, label, creation time, and a short endpoint hash; delete rejects a foreign endpoint.
Notification dispatch retains service-role direct reads and stale-subscription pruning.

Native `upsert_device_token(uuid,text,text)` preserves its client shape and validates the supplied
employee against the session. Same-owner refresh succeeds; a token owned by another employee is
rejected. The reviewed service-role branch retains cross-owner registration and pruning for trusted
server/device lifecycle work. Browser roles receive no raw subscription endpoint, Web Push key, or
native token through direct table access: all four personal tables become forced-RLS,
policy-free, and browser-RPC-only after the ordered S1h sequence.

The revised containment and S1h source address the rejected artifact's employee self-promotion and
raw-token takeover findings, but they are not applied or exact database-behavior-verified. Repository
source also journals old-account Web/APNs detachment until cleanup is confirmed and locks account
transitions on cleanup/session errors; that is not evidence that either provider is configured or
delivers.

Provider credentials, VAPID/APNs configuration, feature activation, notification fan-out,
compatible deployment, native logout/account-switch device proof, entitlements, signing,
simulator/device tests, and distribution remain independent. No provider call or device
registration occurred while authoring S1h.
