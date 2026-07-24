# Messaging Transport — File & Contract Ownership Manifest

**Last-verified:** 2026-07-23

**Plan of record:** `docs/messaging-transport-roadmap.md`

This manifest governs the CallRail-first, Twilio-ready messaging transport initiative. Where this
manifest conflicts with an older completed initiative's file freeze, this manifest controls only
the explicit amendments below. `CLAUDE.md`, `database-standard.md`, `workers-standard.md`, and the
standing consent/security rules remain higher authority.

## 1. Binding boundaries

- Staff person-to-person sends use `POST /api/send-message` only.
- The worker remains the sole writer of SMS/MMS message rows.
- Consent and DND fail closed before provider selection or provider calls.
- Clients, conversations, consent, DND, automations, and scheduled messages never choose a provider.
- No adapter fallback and no cross-channel fallback.
- CallRail is forbidden for scheduled, automated, group, broadcast, bulk, campaign, and text-blast
  sends.
- The current production behavior remains Twilio until a later owner-approved activation phase.

## 2. Phase ownership

| Phase | Owns | Must not change |
|---|---|---|
| 1 — Twilio-only seam | new `functions/lib/messaging-transport.js` + test; `functions/api/send-message.js` import/call only; this plan/manifest; named canonical/ownership docs | request/response, DB, auth, clients, provider settings, Twilio helper behavior |
| 2 — auth/idempotency foundation | `send-message.js` + tests; `callrail-connect.js` + tests; both inbox client request-id plumbing; reviewed messaging migration(s); canonical docs | provider activation; CallRail adapter/webhook |
| 3 — CallRail adapter disabled | `messaging-transport.js`; new flat CallRail text adapter + tests; `send-message.js` mode/purpose gate | clients/domain; automated/scheduled/campaign senders |
| 4 — CallRail text ingest | new `callrail-text-webhook.js` + tests; provider-event/reconciliation helpers; worker telemetry; approved private MMS ingestion path | existing voice/form webhook parser; clients; automation |
| 5 — owner activation | configuration/runbook docs and only the code fixes required by sandbox evidence | unapproved live sends, migration applies, number moves |
| 6 — Twilio cutover proof | adapter/config/runbook tests | client/domain rewrites |
| 7 — Twilio RCS readiness | `docs/messaging-rcs-readiness.md`; unused capability policy/tests; reviewed provider-neutral channel vocabulary | runtime activation, Twilio console/sender-pool changes, live schema/config |

Each phase is serial unless a later owner-approved amendment proves file and artifact disjointness.

### 2026-07-23 owner-approved parallel build amendment

The owner authorized build-only parallel work after Phase 1 was published. This amendment permits:

- Phase 2 authorization, client request-ID, and migration-source work;
- Phase 3's disabled CallRail adapter and server-only mode gate;
- Phase 4's signature/event-inbox primitives, unconfigured receiver/recovery routes, and
  repository-only SMS domain processor; and
- Phase 6's cutover runbook.
- Phase 7's repository-only RCS readiness contract and unused capability policy.

Parallel agents owned disjoint new helpers/tests and the CallRail-connect/runbook files. The shared
`send-message.js`, transport registry, clients, migration, canonical docs, and final verification
remain serial integration work. This amendment does not authorize Phase 5, a database apply,
deployment, provider/webhook configuration, secret changes, phone-number work, or a real message.

### 2026-07-23 admin setup surface amendment

The owner authorized repository-only construction of an in-app messaging setup/readiness surface.
This amendment permits a new flat `functions/api/messaging-setup.js` plus focused tests and a
settings-owned panel to consume it. The Worker is GET-only: default status and
`action=callrail-options` read-only provider discovery. It must enforce active, internal admin
authorization before database/provider access; use stored server credentials and timed provider
GETs; return no-store, redacted results; and make no database write, provider mutation, or send.

The surface does not own or change `MESSAGING_SEND_MODE`, `MESSAGING_SCHEMA_MODE`, signing
material, provider webhooks, Cloudflare variables, number routing, migration source, or external
provider state. Production stays disabled. RCS may be shown only as planned/readiness information;
it remains channel-locked and automatic RCS-to-SMS/MMS fallback is prohibited.

### 2026-07-23 inbound notification activation amendment

The owner authorized closing the live CallRail inbound bell/push gap after evidence showed every
canonical inbound projection atomically created a notification-outbox row but no scheduler ever
claimed one. This amendment owns one additive migration, rollback, contract test and the matching
canonical/evidence updates. The migration may add a trigger wake-up plus a five-minute pg_cron
safety net for the already-deployed, scheduler-secret-protected
`/api/process-message-notification-outbox` worker.

The scheduler must use the existing cron secret, accept only the exact dev/production UPR worker
URLs, remain inert when configuration or due work is absent, preserve fenced claims, and retain
pending rows on rollback. It does not broaden the CallRail send scope, enable Production messaging,
change notification preferences, create a browser grant, or authorize unrelated delayed
notifications.

The same owner-authorized live test found that the notification payload linked every channel to the
office `/conversations` list. The follow-up owns the narrow provider-neutral dispatcher correction:
bell links select the exact office thread at `/conversations?c=<id>`, while Web Push selects the
same thread inside the field PWA at `/tech/conversations?c=<id>`.

### 2026-07-24 private outbound media amendment

The owner authorized completing the CallRail picture-message path and keeping the same inbox
contract ready for Twilio MMS/RCS. This amendment owns the authenticated
`/api/message-media-upload` boundary, provider-neutral private-media helpers, the CallRail
multipart `media_file` adapter change, message-bound private resolution, the two existing composer
upload helpers, focused tests, and matching canonical documentation.

Outbound customer images must remain in private `message-attachments`; clients receive only opaque
`upr-storage://` references. The Worker verifies actual JPEG/PNG/GIF bytes and the five-megabyte
limit both at upload and before provider dispatch. CallRail receives at most one verified file by
multipart upload. Twilio may receive only a short-lived signed fetch URL generated inside its
adapter; no client or message row stores that URL. Sent/failed/ambiguous history retains the
private reference for rendering and safe retry. Self-service object deletion is deliberately
excluded until a durable draft-to-message claim can prevent races and history loss; private
orphans are safer than destructive cleanup. This amendment adds no migration, provider binding,
automatic RCS fallback, automated CallRail send, or live/provider test authority.

### 2026-07-24 retained CallRail event recovery amendment

The owner authorized completing the repository-side MMS recovery path after live evidence showed a
retained `retryable` CallRail MMS event and no invocation history for the already-deployed
`/api/process-callrail-events` worker. This amendment owns one additive scheduler migration,
rollback, static contract test, and matching canonical documentation.

The migration may store only a non-secret exact worker URL, reuse the existing cron secret, and run
a five-minute pg_cron/pg_net safety net only when a CallRail SMS/MMS event is received, due for
retry, or stale-claimed. It must accept only exact dev/production UPR worker URLs, grant no browser
or service-role execution, preserve provider events and configuration on rollback, and never send
a customer message. Authoring and deployment do not authorize applying the migration to the shared
Supabase project; that remains a fresh owner-approved apply window.

The owner approved and applied the scheduler on 2026-07-24. Its first controlled retry exposed a
live claim-contract defect: PostgREST mutated four eligible events to `claimed` but returned an
empty representation, so the worker skipped all four. This initiative additionally owns one
service-role-only, invoker-mode atomic-claim RPC migration, the narrow worker caller change,
contract tests, and canonical documentation. The RPC may mutate only one exact due/stale CallRail
SMS/MMS event and must return only the row it successfully claimed. It does not authorize provider
sends, broad event resets, browser grants, or unrelated database work.

## 3. Phase 1 exact amendment

Phase 1 may:

- add a flat provider-neutral transport dispatcher;
- import the existing `functions/lib/twilio.js` helper as its only adapter;
- change `functions/api/send-message.js` to import the dispatcher's same-shaped `sendMessage`;
- add focused pure unit/contract tests;
- update documentation and the explicit completed-manifest pointers.

Phase 1 may not:

- edit `functions/lib/twilio.js`;
- add CallRail send logic or a CallRail adapter registration;
- read `MESSAGING_SEND_MODE` or any new environment variable;
- edit `automated-send.js`, `process-scheduled.js`, Twilio webhooks, CallRail workers, clients, or
  migrations;
- change authorization, request/response fields, row shape, callback URL, status mapping, or
  provider configuration;
- send a message or mutate external state.

## 4. Supersession of completed freezes

- `.claude/rules/sms-experience-wave-ownership.md`: its completed Phase-B ownership and shared-lib
  freeze are amended only for the exact Phase-1 seam above and the later phases listed here.
  SMS Experience's consent, frozen public contract, sole-writer, and no-fallback rules remain binding.
- `.claude/rules/tech-messages-v2-wave-ownership.md`: its `send-message.js` / `functions/lib/*`
  call-only freeze is amended only for this server-side initiative. Tech client files remain frozen
  until Phase 2's additive `client_request_id` work.
- `.claude/rules/omni-inbox-wave-ownership.md` and `.claude/rules/crm-wave-ownership.md`: no Phase-1
  amendment. Automation/campaign workers stay Twilio-specific and outside the selectable seam.

## 5. Shared contracts

Preserve throughout:

- `POST /api/send-message` request/response and error shapes unless a phase explicitly adds an
  additive field with compatibility tests;
- `messages.twilio_sid`, current message type/status vocabulary, and realtime behavior;
- `sendAutomatedMessage` / `sendGatedSms` signature and reason vocabulary;
- worker-only SMS row writes and structurally unbypassable consent;
- separate provider webhook routes and provider-authentication schemes.

Generic message identity and attempts/events are additive. No live function, column, policy, grant,
or provider behavior is inferred from a plan or generated type.

## 6. Database and external-state gate

Phase 1 shipped no migration. The current build branch contains an unapplied Phase 2 migration
draft. Database work requires:

- a fresh read-only live catalog/grant/policy/caller capture;
- additive migration source with explicit rollback;
- negative authorization/idempotency tests;
- migration-safety and anon-grant review;
- owner approval for the shared-production apply window.

No phase configures secrets, Cloudflare variables, Supabase, provider webhooks, phone numbers, or
live messaging without explicit owner authorization.

## 7. Close-out

At minimum:

- focused unit/contract tests;
- full `npm test`;
- `npm run build`;
- ESLint on changed JavaScript files;
- `consent-path-auditor` posture for any send-path change;
- `migration-safety-checker` and `anon-grant-auditor` for migration/auth changes;
- update `UPR-Web-Context.md` and canonical docs affected by the phase;
- report repository proof separately from database, deployment, provider, and device proof.

Do not commit, push, open a PR, deploy, apply a migration, configure a provider, or send a message
unless the user explicitly requests that delivery or external action.

## 8. Verified prior-consent compatibility amendment (2026-07-23)

The owner-approved historical-consent remediation may make the exact additive send-chokepoint
changes named in `.claude/rules/sms-experience-wave-ownership.md` §12. Provider selection,
idempotency, attempt/reconciliation state, message row shape, private-media behavior, and the
public `/api/send-message` response contract remain unchanged. The attestation operation never
calls a provider; any subsequent staff send still passes the complete current transport,
authorization, consent/DND, idempotency, media, and persistence chain.

The compatibility amendment also permits the exact service-only consent-status RPC call from
`send-message.js`. It may change only the consent decision seam: provider choice, submission,
attempt ownership, reconciliation and returned message shapes stay frozen.

The same status RPC may be consumed by automated and scheduled Twilio writers only as a
suppression boundary. Those writers must require `GLOBAL_OPT_IN`; they must never consume
staff-only `SERVICE_CONSENT`, route through CallRail, or change their existing provider contracts.

## 9. 2026-07-24 mobile release and live-readiness amendment

The owner authorized the production-readiness follow-up needed for the team to use the mobile field
inbox. This amendment owns:

- `GET/POST /api/message-conversations`, its tests, and a service-role-only hardening of
  `find_or_create_conversation(uuid)` so authenticated clients cannot invoke the write RPC directly;
- Tech Messages v2's full-screen contact picker and authoritative direct-thread consent status;
- reuse of the existing admin/office prior-consent attestation surface in the mobile PWA, with
  fail-closed loading/error/DND behavior and no automatic send after attestation;
- the narrow CallRail outbound NANP identity fix for ten-digit webhook recipients versus stored
  `+1` E.164 attempts;
- acceptance of the exact account-scoped `app.callrail.com/msg/.../media/...` endpoint observed in
  authenticated CallRail history, followed manually only to the exact known CallRail MMS S3 host
  after AWS signature-shape validation and with the CallRail API token stripped; and
- readiness reporting that separates actionable retry queues from terminal failure history.

This does not permit a second client send route, browser execution of privileged RPCs, consent
inference from contact existence, automated CallRail traffic, provider fallback, public media, or
Twilio/RCS activation. Production activation remains a sequenced owner operation: reviewed commit,
shared-database apply and catalog verification, Preview proof, exact-build promotion, provider
binding/webhook cutover, then controlled Production proof.
