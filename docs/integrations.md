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
- Staff-written SMS uses one server chokepoint and a provider-neutral transport seam. CallRail is
  never an allowed adapter for scheduled, automated, group, broadcast, bulk or campaign sends, and
  no provider failure falls back to another provider/channel. Plan:
  `docs/messaging-transport-roadmap.md`.
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
endpoints through the conversation API. It copies verified MMS bytes into private
`message-attachments`, persists only `upr-storage://` references, and signs a short URL only after
messaging authorization and message/index binding. The separate reconciliation worker polls
CallRail history read-only and projects a winning outcome atomically. Isolated PostgreSQL
compilation, provider fixtures, and reviewed retention remain activation blockers. Repository
source includes atomic canonical-message recovery plus a durable, fenced notification outbox. The
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
