<!--
FILE: docs/business-rules.md

WHAT THIS DOES (plain language):
  Records the business definitions that code must preserve across screens, Workers and database
  logic. It also names which layer should enforce each kind of rule.

DEPENDS ON:
  Internal: BILLING-CONTEXT.md, UPR-QBO-SYNC-PROTOCOL.md, docs/crm-lead-lifecycle.md,
            functions/lib/sms-consent.js, functions/lib/automated-send.js
  Data:     reads → documentation and implementation contracts
            writes → documentation only

NOTES / GOTCHAS:
  - Detailed domain guides remain authoritative for worked examples and exceptions.
  - Do not copy a rule into multiple layers without naming the enforcement boundary here.
-->

# Business Rules

## Enforcement boundary

Do not duplicate business rules across UI, API, Edge Functions and SQL without documenting the
enforcement boundary.

| Rule type | Primary enforcement | Mirrors allowed for |
|---|---|---|
| Cross-client data invariant | Constraint, trigger or RPC | UI explanation and pre-validation |
| Provider/secret side effect | Worker/server | UI eligibility and status display |
| Authorization | Worker/RPC/RLS | Route/navigation UX |
| Presentation-only choice | Client | Native/web variants when equivalent |
| Provider webhook normalization | Ingest adapter + durable canonical fields | Reporting helpers using the canonical fields |

If the same predicate must exist in SQL and JavaScript, identify them as twins, test the same cases
against both and change both in one commit.

## Billing and money

- Money remains human-in-the-loop: AI/extraction/builders prepare drafts; a person explicitly posts
  or saves financial transactions to QBO.
- `invoice_line_items.line_total` and payment-derived invoice/job totals are database-owned. App code
  writes inputs and payment rows, not generated/trigger-owned totals.
- The billable amount is `adjusted_total ?? total` where the established billing contract requires it.
- QBO customer identity exists before invoice push.
- A job can have multiple invoices; supplements do not silently rewrite a completed/paid invoice.
- Imported provider payments carry stable external identity and source so they do not re-push.
- Retries of money movement use a stable idempotency key and durable attempt/reconciliation state.
- Financial dates use the Denver business day, not UTC string slicing.
- Current employee roles contain `project_manager`, not `manager`. The historical
  `admin`/`manager` billing predicate is therefore admin-effective; adding `project_manager`
  authority requires an owner decision and coordinated UI, Worker, RLS and allow/deny tests.
- The current S1a/S1b target for browser-initiated QBO provider actions is an active,
  non-external `admin`.
  Invoice/estimate attachments remain human-selected: a person chooses which file(s) to push to
  which QBO invoice/estimate (via `/api/qbo-attach`), never an automatic batch. The attachment and
  card-charge Workers explicitly reject external employees before business or provider work.
  They are pushed with `IncludeOnSend` so they ride along on the QBO-sent email; attach before send.
- The `qbo_attachments` metadata SELECT policy is still role-scoped without an explicit
  `is_external=false` predicate. Closing that direct-read residual requires a separately reviewed
  migration; Worker containment is not a claim that the metadata surface is fully closed.
- A server-side QBO capability may support the customer-sync and payment-sync scheduler paths, but
  it does not grant a browser role or identify a human actor. OAuth connect, keyed card charge and
  attachment mutation remain Bearer-only. Capability retention, caller binding and
  rotation/retirement must be decided and rolled out across all dependent workers together.

Detailed authority: `BILLING-CONTEXT.md`, `UPR-QBO-SYNC-PROTOCOL.md` and the current billing code/tests.

## CRM and leads

- A sale is `jobs.is_real_job = true`; phase, stage or invoice presence is not a substitute.
- Sale date is the documented claim/job creation fallback, with the deliberate commissions exception.
- A countable marketing lead is non-spam, non-merged, and a form or answered call.
- Speed-to-lead begins with the first human stage move; system moves do not count as response.
- Operational boards and marketing metrics intentionally have different inclusion scopes.
- CRM sales headlines are CRM-traced; when company-wide context is shown, both traced and total
  won/revenue values come from `get_crm_sales_summary` for the same Denver-day window and are
  explicitly labeled. Do not calculate the comparison independently in the UI.
- Merged leads resolve to one canonical root and do not own independent stage state.
- Human Won/Lost decisions are sticky except for explicitly recoverable stages.
- Automated identity linking is auditable/reversible and follows one normalized phone rule.
- Public form acceptance flows through the Worker enforcement boundary: abuse controls, published
  schema validation, organization identity, request IP/user agent and consent evidence are
  server-derived. The underlying transaction RPC must not be a second public entry point.
  `20260723235900_public_form_rpc_boundary.sql` implements that ACL contract in source but is
  unapplied as of 2026-07-23; until its serialized apply, direct browser execution remains a known
  live exception rather than an enforced rule.
- The Webflow form adapter requires its configured shared secret and fails closed if the expected
  database/environment value is missing; there is no unauthenticated bootstrap mode.

Detailed authority and open rulings: `docs/crm-lead-lifecycle.md`.

## Messaging and consent

- Automated SMS requires a valid number, positive opt-in and no DND.
- A global kill switch precedes consent evaluation.
- Recipient-local quiet hours defer messages rather than silently dropping them.
- STOP/START/HELP, suppression, delivery status and consent changes are durable/auditable.
- Automated sending uses the shared compliant send path; no alternate provider call bypasses gates.
- Provider retries distinguish transient from permanent failures and remain idempotent.
- Email and SMS have different consent models; do not reuse one predicate for the other.
- A caller-supplied boolean or IP address is not consent evidence by itself. Consent records must
  originate from the approved server path and bind the rendered disclosure/version, submitted
  choice, server-observed request context and resulting contact.
- Valid service-message permission may also have been obtained verbally on a customer call or in
  writing outside UPR, including an older signed work authorization. Authorized admin/office staff
  may attest that verified prior permission only by recording its method, date and evidence note;
  UPR records their server-derived identity, audit timestamp, attestation version, Utah Pros sender
  identity and the fixed `service_related_customer_project_messages` scope.
- A Work Authorization signed through UPR's own e-sign flow is not a staff attestation. When its
  rendered SMS section exactly matches the approved version/hash, UPR may record separate immutable
  system evidence bound to the sign request, signed PDF, phone snapshot and signature timestamp.
  Template drift records no messaging permission. Contact existence, an assumed business
  relationship, or merely lacking a STOP record is never permission. Neither evidence path
  authorizes promotional, campaign or unrelated message subjects.
- Prior-consent attestation is not re-subscription. It never clears manual DND, STOP, provider
  opt-out or `opt_out_at`; customer re-consent after revocation follows the established inbound
  START/affirmative written path.
- Verified service-message permission is stored separately from `contacts.opt_in_status`. It is
  consumed only by the direct staff person-to-person send boundary and never authorizes a group,
  broadcast, automated, campaign, bulk or promotional send. Recording it cannot itself trigger a
  send or retry. Each attestation preserves raw evidence in service-only append history; the legacy
  consent log receives only redacted reference metadata.
- Staff messages still send only through `POST /api/send-message`. Every message identifies Utah
  Pros Restoration, and the first outbound message in a conversation includes “Reply STOP to
  unsubscribe.” A separate outbound SMS asking an unconsented number to opt in is prohibited; staff
  instead records consent already obtained through the approved evidence flow.
- CallRail's text API is restricted to a staff-triggered, person-to-person send. UPR scheduled,
  automated, group, broadcast, bulk and campaign sends must never use it.
- Scheduled SMS/MMS must call `sendAutomatedMessage()` rather than a provider primitive. That
  central boundary rechecks the global `sms_sending_enabled` switch, global opt-in, DND and
  recipient-local quiet hours immediately before Twilio submission. A disabled switch or quiet
  hours releases the scheduled claim for a later retry; durable consent failures remain terminal.
  The HTTP trigger accepts only the scheduler secret or an active internal admin, office or
  project-manager session; authentication without that role is insufficient.
- CallRail inbound STOP/START/HELP changes the same canonical consent/DND state as Twilio, but UPR
  must not auto-send the keyword reply through CallRail. HELP requires a staff response until an
  owner-approved provider-native compliant mechanism is evidenced.
- Outbound message images are canonical private objects, never public customer-photo URLs. The
  current cross-provider envelope is one verified JPEG, PNG, or GIF up to 5,000,000 bytes. Clients
  keep only an opaque private reference; provider-specific byte upload or signed fetch exposure
  happens after consent inside the selected adapter.
- A messaging-provider failure does not fall back to another provider or channel. Ambiguous
  provider timeouts are not automatically resubmitted by scheduled sends, sequences, or CRM
  automation runs: they enter a terminal or paused reconciliation state at the same action. Fixed
  automations suppress a later run only after their terminal event persists; automated SMS remains
  activation-blocked until a pre-send reservation closes that post-send persistence gap.
- RCS is a channel inside the existing messaging domain, not a new consent or conversation domain.
  Canonical records distinguish the requested channel from the provider-confirmed actual channel.
- Twilio provider-managed RCS-to-SMS/MMS fallback is prohibited. It may be enabled only by a
  separate owner-approved policy/schema/consent rollout that records the fallback and proves both
  channels are permitted for that purpose.
- An RCS Sender identity is not a phone number. Preserve typed sender/recipient addresses and never
  use a provider sender, Messaging Service, template, or provider thread as UPR conversation
  identity.
- RCS STOP/START/HELP, rich quick replies, delivery/read receipts, and action payloads enter through
  authenticated provider webhooks and update the same canonical consent/audit domain idempotently.

Detailed transport authority: `docs/messaging-transport-roadmap.md` and
`docs/messaging-rcs-readiness.md`.

For a direct staff send, `client_request_id` identifies one user action. A transport retry must
reuse it; reusing it with changed recipient/content/media/provider is a conflict. An accepted or
ambiguous attempt is returned/reconciled rather than automatically submitted again. Internal notes
remain provider-free, and group/broadcast sends cannot enter the CallRail adapter.

## Internal notifications and call recordings

- A human HTTP notification request is not trusted notification content. The Worker allowlists the
  event, proves its appointment/crew/estimate object, derives audience/copy/routes from server data,
  and rejects client-supplied recipients, body, HTML, payload, entities, jobs and links.
- Database triggers use a distinct exact secret-first capability, and trusted Workers call the
  dispatcher in-process. Those two service contracts retain the event-specific payloads needed for
  existing fan-out; they do not make an arbitrary browser payload trusted.
- Every final notification audience is intersected with active, non-external employees before bell,
  push or email. Per-channel failure remains best-effort and is reported in the existing summary.
- Native lock-screen presentation is selected by trusted event type, not caller-supplied copy or
  paths. Every live type has explicit privacy-conscious title/body rules and a field-route
  selection; unknown types and office-only destinations fall back to generic copy or native home.
  Web Push, bell and email retain their separately governed richer presentation.
- Resolving feedback and sending `feedback.resolved` as the company is admin-only server-side.
  The submitting technician is the sole recipient and may configure the event, but a valid
  technician session cannot invoke the sender.
- Staff recording playback is company-wide only for an active internal admin or the explicit
  `crm_call_log` capability. The Worker must bind the UUID to an actual call row, match its stored
  provider call ID to its stored allowlisted URL, and complete those checks before credential or
  provider access.
- Recording responses remain private (`Cache-Control: private`) and the clients require an
  `audio/*` success type before playback. The proxy never accepts a raw caller-provided URL or
  forwards browser Range/authentication headers upstream. Existing bounded provider detail/snippet
  error fields and the provider-returned signed URL/content type are compatibility residuals, not
  a claim of complete upstream-response redaction.
- A database-originated notification has one trusted top-level `type_key`; an object payload may
  not override it. Direct execution of `notify_emit` is a server capability, while its verified
  owner-run trigger/RPC/cron callers remain database-internal. The S1d migration authors this
  service-only ACL and trusted-key merge but is not live until a separate authorized apply, so the
  current authenticated-executable deployment remains an explicit residual.
- Direct `create_notification` bell emission and direct recording-source reads are independent
  authorization boundaries; neither is implicitly approved or closed by the `notify_emit` patch.
  S1f's unapplied bell migration makes direct emission service-only without changing recipient or
  broadcast semantics; only applied role proof can close that residual.
- Notification list, unread-count, mark-one, and mark-all operations are a separate read-state
  boundary. S1g's unapplied migration reconstructs one active, non-external employee from
  `auth.uid()`, rejects a foreign supplied employee/notification ID, and scopes direct
  `notifications` reads (including Realtime payloads) to broadcasts plus that employee's targeted
  rows.
- A targeted notification continues to use its row-level `notifications.read_at`. A broadcast uses
  a private `(notification_id, employee_id)` receipt so one employee cannot mark it read for
  everyone. A legacy broadcast whose shared `read_at` is already non-null remains read for
  everyone; migration must not resurface historical notifications.

## Capability links and public documents

- Public signing links are capabilities: unguessable token, explicit status, expiration and
  revocation are enforced in the database retrieval/mutation boundary.
- Expired, completed or revoked tokens disclose no signer/job/claim payload through direct RPCs.
- Public document access returns a minimal purpose-built DTO or signed object URL, not a full
  internal row or listable bucket.

## Identity, rollout and access

- Authentication, employee membership, authorization and feature rollout are separate decisions.
- UI gates are not sufficient for money, PII, company messaging or administrative operations.
- Force-disable, employee overrides, admin/role permissions and rollout flags retain their documented
  precedence.
- Personal page overrides, personal notification preferences, Web Push subscriptions, and native
  device tokens belong to the active, non-external employee mapped from the authenticated user.
  A caller-supplied employee ID is a selector to validate, never proof of ownership.
- An active internal admin may inspect another employee's page-access overrides for the Page Access
  control surface. That exception does not extend to another employee's personal notification
  settings, Web Push devices, or native-token mutation.
- Effective notification preference precedence remains catalog default → role default → employee
  override → unlocked personal preference. A non-customizable role default suppresses the personal
  value; a disabled notification type is omitted only from the self-service list.
- Web Push endpoints and native device tokens are not bearer capabilities for browser users.
  Authenticated registration may refresh a token only when it already belongs to the same verified
  active-internal employee. A foreign-owner conflict is denied; only reviewed owner/service
  maintenance may reassign it. Logout detachment and provider delivery remain separate rules.
- Employee identity and authorization predicates may trust `employees.auth_user_id`, status, and
  role only after browser roles are unable to insert, update, delete, self-bind, or self-promote
  those authority fields.
- Trusted service-role dispatchers may resolve employee preferences and directly read/prune
  subscription/token rows only after their own Worker authorization or trusted scheduler/webhook
  boundary. All four personal tables are browser-RPC-only after S1h; browser roles do not inherit
  that service capability.

## Initial mobile offline boundary

- The initial production PWA/Capacitor release admits no automatic offline command and performs no
  automatic replay. Field writes remain online-only and an offline attempt must never be presented
  as saved or queued.
- Historical IndexedDB rows are recovery data, not commands. The app may inspect only payload-free
  counts, quarantine every legacy/unsupported/foreign-owner row, and perform bounded owner-scoped
  cleanup of already-completed local photo data. It may not send those rows.
- Destructive local recovery clears every offline store only after the existing two-click
  confirmation explicitly warns that another account's unsynced local data can also be removed.
- A future offline writer requires a separately reviewed end-to-end idempotency, account ownership,
  crash consistency, cross-tab coordination, and server-authorization contract before admission or
  replay is enabled.

## Time

- Store timestamps as `timestamptz`.
- Business-day/week bucketing uses `America/Denver` unless a documented external contract explicitly
  requires another zone.
- Tests cover Mountain midnight and daylight-saving boundaries.

## Account deletion and retention

- Users request account deletion; an authorized administrator verifies and fulfills the request.
- Login/session access is revoked as part of fulfillment.
- Shared job, claim, time, photo and financial records may be retained only under the approved
  business/legal retention policy; personal data is deleted or anonymized where required.
- Request status, actor, decision, retained-data treatment and requester communication are auditable.

## Change duty

When a change introduces, removes or reinterprets a business rule, update this file and the detailed
domain guide in the same commit. Add regression tests at the primary enforcement boundary and at any
documented twin. Dated unresolved findings live in `docs/audit/2026-07/`.

## Credential rotation

- A candidate provider credential is validated with a read-only provider request before it becomes
  active; failure leaves the current credential and technician workflows untouched.
- A migration fallback is allowed only while explicitly marked `fallback`. An explicit `disabled`
  state suppresses the legacy environment credential.
- Provider keys are write-only to the browser. Status may disclose connection state, safe account
  labels, and verification time, never the credential or raw provider error body.
- Old credentials are revoked only after every surviving runtime is inventoried, deployed against
  the managed source, and smoke-tested.

## Mobile person-to-person messaging

- Starting a conversation is not consent and never sends a message.
- Owner decision 2026-07-28: staff-written direct service messages use an opt-out-only model. A
  reachable contact phone with no recorded objection may produce the distinct `IMPLIED_CONSENT`
  decision for that one-to-one path. The worker must durably record
  `service_send_allowed_existing_client` before it calls a provider; an audit
  write failure blocks the send.
  DND, explicit opt-out, pending STOP, phone mismatch, missing contact/phone, and an unavailable or
  unknown server decision still fail closed before provider selection.
- Typed transactional-service exception, owner decision 2026-07-28. The initial reviewed registry
  entries are
  `appointment_scheduled`, `appointment_canceled`, and `signature_request`. They may
  consume `SERVICE_CONSENT` or `IMPLIED_CONSENT` only through a dedicated typed
  producer that derives its purpose and copy from the server-owned appointment
  or signature record and records `transactional_service_send_allowed` before
  provider selection. The generic `sendAutomatedMessage()` path cannot assert
  one of those labels or accept implied consent. No such automated producer is
  live yet; the existing staff-initiated signature text continues through
  `/api/send-message`. Those names are a policy allowlist, not examples accepted
  by a generic bypass; additional service-notice purposes require a reviewed
  registry change. Generic
  automation, scheduled free-form messages, group, broadcast, bulk, marketing,
  and campaign traffic still require `GLOBAL_OPT_IN`.
- Active internal admin/office employees may still attest documented prior service consent, and a
  native UPR Work Authorization with the pinned SMS disclosure may still provide stronger evidence.
  Technicians cannot create either record, and neither evidence path can clear DND/STOP/opt-out.
- The mobile thread no longer performs a consent-status request on open. It derives the visible
  DND state from the already-loaded contact and leaves the server as the final authority at Send.
  An explicit server refusal never falls back to another channel.
- Recording consent never automatically sends or retries a draft. Staff must explicitly press Send,
  and the server rechecks the complete consent/DND boundary.
- Internal notes remain available when customer messaging is blocked because they do not leave UPR.
- CallRail is person-to-person only. Scheduled, automated, group, bulk, campaign, and broadcast
  sends never use it.
- The opt-out-only source is committed as
  `20260728000000_sms_consent_opt_out_only.sql` but remains inert until that exact migration is
  separately approved, applied, and verified on the shared project: workers accept
  `IMPLIED_CONSENT` only for the direct staff path and the three named
  transactional-service purposes, while the current database does not yet return it.

## Internal notification presentation

- Presentation settings may change only title/body templates and a typed route identifier for a
  code-owned event/surface. They cannot change audience, recipients, channel defaults/preferences,
  consent/DND, delivery occurrence identity, provider, or email behavior.
- Templates support literal text plus exact event-allowlisted `{{variable_name}}` tokens only.
  There is no expression/general template execution, HTML/Markdown, payload traversal, or URL
  interpolation.
- Routes are code-owned identifiers with server-derived parameter contracts, never saved paths or
  arbitrary URLs. Missing route context or invalid configuration uses the code default.
- Native lock-screen copy remains code-owned and exposes no configurable variables. Its privacy
  budget excludes names, message contents, contact details, identifiers, financial amounts,
  appointment times, and free-form notes; office-only native destinations remain `/`.
- Preview uses fixed synthetic values and never loads customer/payment/message/job/provider data or
  sends a notification. Every save/reset is revision-checked, idempotent, and audited.
