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
- QBO invoice retries use one stable UUIDv4 operation id while the outcome is ambiguous. The
  service-only durable command ledger is created before the provider write and recovery checks it
  before another provider call, including interruptions on either side of local CAS writeback.
- Estimate conversion/QBO decisions are row-locked. A populated target invoice remains a manual
  review boundary; a combined QBO invoice/estimate match is intentionally non-unique and must be
  reconciled, never allocated arbitrarily.
- The human Save-to-QuickBooks action remains the only user-authorized QBO provider write; durable
  recovery is not an automatic-post mechanism. Browser actions require active internal admin
  authorization, and the shared QBO server secret is rejected by the invoice endpoint.
- The live-but-disabled multi-invoice receipt foundation defines a separate human-confirmed action:
  one active internal administrator may create exactly one QBO Payment and allocate positive integer
  cents across 1–100 UPR invoices only when every invoice belongs to one UPR contact and the same
  QBO customer. It remains inactive until both rollout gates are explicitly enabled.
- Before that provider write, the Worker re-reads the QBO invoices and balances. It projects
  receipt-backed `payments` rows only after the returned Payment preserves the reviewed customer,
  date, method, reference, deposit account, total and exact allocations and fresh invoice balances
  show the expected deltas.
- A canonical `client_request_id` plus request fingerprint and derived Intuit `requestid` identify
  an unchanged retry. A timeout or transport ambiguity is `unknown_outcome`, never proof of
  rejection; deterministic provider refusal is `rejected`; accepted lifecycle states are
  `qbo_created`, `locally_finalized`, and `reconciled`.
- A realm-scoped QBO Payment identity can belong to only one receipt header and one durable outbound
  attempt. A second attempted claim stops as an audited conflict before local finalization.
- In receipt mode QBO is authoritative for later accounting corrections. Update replaces the
  complete active allocation projection; Void/Delete removes those projections together while
  retaining receipt, attempt, event, and terminal-tombstone evidence.
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
- OOP calculator pricing is a versioned business rule, not a collection of editable client
  constants. Administrators may edit and save a draft, but only an explicit publish makes that
  revision current for new quotes. Existing configured quotes remain pinned to the exact revision,
  config and inputs used when they were saved; that detail lives in a private companion row, not on
  the broadly readable legacy quote row.
- The browser may preview OOP totals, but the versioned quote RPC recalculates the persisted total,
  evaluated lines, project-minimum adjustment and margin from validated inputs. It never accepts a
  browser-supplied final total as authoritative.
- The unchanged legacy quote-save signature remains callable. The live builder migration bounds
  those legacy inputs and recomputes the v1 total and margin server-side instead of trusting the
  browser snapshots.
  Any authorized legacy/direct update clears the current private snapshot so a later v2 read cannot
  combine new legacy values with stale configured-pricing details.
- Line minimums apply only to positive line amounts. Project minimums apply only to a positive
  visible subtotal. Hidden/internal lines never increase the customer subtotal or a customer
  percentage base. Final-total internal allocations use the customer total after the project
  minimum adjustment.
- Pricing edits are admin-only at both the web-only Settings route and RPC boundary. Calculator
  use is exactly for active internal `admin`, `office`, `supervisor`, `estimator` (sales rep), and
  `project_manager` roles; each may see all OOP quotes company-wide. `field_tech`,
  `crm_partner`/external, inactive, unsupported, and unauthenticated actors are denied. The
  `tool:oop_pricing` flag is a separate fail-closed rollout gate: global means all eligible roles,
  never all staff; a missing or force-disabled flag denies.
- OOP quotes are internal pricing artifacts. An authorized billing admin may explicitly convert a
  saved, job-linked, versioned quote into one draft UPR estimate. The database copies only the
  canonical customer-visible evaluated lines, verifies that their generated line total equals the
  quote total, links the source quote, and returns the same estimate on retry. A converted quote is
  frozen so its pricing cannot drift from the official estimate.
- Claim selection never silently chooses among multiple jobs. A claim with exactly one job may
  auto-link it; a claim with multiple jobs requires the user to choose the destination job before
  saving or estimate conversion. Choosing another claim clears the prior job candidates, and
  changing the destination job is tracked as an unsaved quote change. A freeform, unlinked quote
  remains allowed only after the user unlinks the claim.
- Quote conversion never calls QuickBooks. Browser/PWA opens the existing Estimate editor. Native
  opens a narrow admin-only OOP estimate-review screen with the already-saved canonical lines and
  total and can correct the service address or existing description/quantity/rate/order columns.
  It refuses an estimate without an OOP source-quote link and contains no provider action.
  QuickBooks save/update and customer email remain explicit human actions in the existing web/PWA
  Estimate editor. The conversion RPC itself remains provider-free.
- The Job Hub may deep-link an eligible, flag-enabled user into OOP pricing with a validated job
  id. This preselects the estimate destination; it does not bypass calculator role/flag checks or
  the billing-admin conversion boundary.
- `feature:qbo_receive_payment` and `QBO_RECEIVE_PAYMENT_ENABLED=true` are independent default-OFF
  rollout gates for the new receipt path, and the money endpoint enforces both server-side. Neither
  flag grants authority; the Worker still requires an active, non-external literal `admin` before
  private reads, durable reservation, or a QBO call.
- The receipt foundation is live under production ledger `20260731225654_qbo_multi_invoice_payment_receipts`
  and its grant containment under `20260731230907_qbo_receipt_service_grant_containment`. Browser
  roles have no receipt-table or RPC access; `service_role` has direct `SELECT` only on receipt and
  attempt headers, no direct privilege on append-only events, and all writes go through seven gated
  `SECURITY DEFINER` RPCs. No provider/payment action is implied while the feature remains disabled.

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
  central boundary rechecks the unchanged global `sms_sending_enabled` switch, global opt-in, DND
  and recipient-local quiet hours immediately before Twilio submission. Only after all of those
  gates pass may a scheduled worker create and link its one durable provider-attempt reservation;
  that reservation permits one Twilio invocation, never a retrying second submission. A disabled
  switch or quiet hours releases the unreserved claim for a later retry; durable consent failures
  remain terminal. Once a row is linked, replay reconciles the durable attempt and never submits
  again: a fresh linked attempt remains in flight, while an unknown stale outcome fails closed for
  owner review. The creator's active internal membership and conversation capability, plus exactly
  one active customer recipient with a usable phone, are checked at creation/dequeue and again at
  the final reservation boundary. The browser supplies a stable, owner-scoped operation ID for an
  identical retry; the RPC derives the actor and rejects a changed payload for that ID. The HTTP
  trigger accepts only the scheduler secret or the exact active internal DevTools owner, who must
  also retain the Conversations capability; an ordinary authenticated or privileged session is
  insufficient. All Auth/database/provider calls are timeout-bounded. Once reservation exists,
  Twilio credential resolution is fresh and fail closed: a managed credential-store timeout may
  not use a cache or environment fallback and must reach no provider request.
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
- Native lock-screen presentation is selected by trusted event type, not caller-supplied APNs copy
  or paths. Owner decision 2026-07-29 permits native to render the same event-approved variables as
  PWA, including customer, scheduling, and payment details. Values must come from typed server
  context; missing context uses the immutable generic event copy. Native tap destinations remain
  field-only, and unknown types fall back to generic copy and native home.
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
  owner-run trigger/RPC/cron callers remain database-internal. Live S1d ledger
  `20260727233704_notify_emit_service_boundary` makes the trusted type authoritative and limits
  execution to the owner plus `service_role`; authenticated browser execution is closed.
- Direct `create_notification` bell emission and direct recording-source reads are independent
  authorization boundaries; neither is implicitly approved or closed by the `notify_emit` patch.
  S1f's unapplied bell migration makes direct emission service-only without changing recipient or
  broadcast semantics; only applied role proof can close that residual.
- Notification list, unread-count, mark-one, and mark-all operations are a separate read-state
  boundary. Live S1g ledger `20260728192024_notification_read_recipient_boundary` reconstructs one
  active, non-external employee from `auth.uid()`, rejects a foreign supplied
  employee/notification ID, and scopes direct `notifications` reads (including Realtime payloads)
  to broadcasts plus that employee's targeted rows.
- A targeted notification continues to use its row-level `notifications.read_at`. A broadcast uses
  a private `(notification_id, employee_id)` receipt so one employee cannot mark it read for
  everyone. A legacy broadcast whose shared `read_at` is already non-null remains read for
  everyone; the live migration does not resurface historical notifications.

## Capability links and public documents

- Public signing links are capabilities: unguessable token, explicit status, expiration and
  revocation are enforced in the database retrieval/mutation boundary.
- Expired, completed or revoked tokens disclose no signer/job/claim payload through direct RPCs.
- Public document access returns a minimal purpose-built DTO or signed object URL, not a full
  internal row or listable bucket.

### Contractor compliance

- A contractor is a contact whose role is `subcontractor`; legacy W-9/COI summary fields are not
  the compliance source of truth.
- Required readiness groups are current Denver-calendar-year W-9, workers' compensation
  certificate **or** Utah coverage waiver, and general liability.
- Current readiness evaluates today in `America/Denver`. Audit readiness evaluates the explicit
  requested date or interval; a currently stored PDF cannot fill a historical coverage gap.
- Document versions and verified coverage intervals are retained. Uploads enter
  `pending_review`; only an admin/office acceptance may satisfy a requirement.
- Overall and requirement statuses are `ready`, `missing`, `needs_review`, `expiring`, `expired`,
  `gap`, or `inactive`. The database derives them; clients do not reinterpret coverage.
- The MVP has no manual compliance override and is warning-only. It never blocks assignment,
  scheduling, billing, or payment.
- Automatic renewal email uses roughly 60/30/14/7-day, expiration, and capped weekly-overdue
  stages. Annual W-9 requests apply only to active contractors for the stored required year.
  Accepted current evidence stops later claims. SMS is not an automatic channel.
- A named insurance audit preserves a point-in-time roster, accepted WC/waiver and GL coverage
  intervals, gaps, document versions, and request history. Current active status is not proof of
  activity or payment during the period; those facts stay unknown until explicitly sourced.
- Annual W-9 readiness is `valid`, `missing`, `needs_review`, `rejected`, or
  `stale_previous_year`. Admin/office may record QuickBooks/Gusto external IDs and a provider
  handoff status/date/reference only after a valid W-9. UPR does not track reportable amounts or
  generate, store, correct, file, email, or distribute 1099 documents.

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
- Conversation staff authority is privileged internal role → explicit per-chat override → default
  technician → deny. Appointment, job, claim, crew, dry-log, and room records are scheduling or
  operational context, never conversation authorization, while browser roles can mutate them.
  A future dry-completion removal must use a trusted server/privileged operation that records an
  explicit membership decision; it must not derive authority from browser-writable job state.
- Trusted service-role dispatchers may resolve employee preferences and directly read/prune
  subscription/token rows only after their own Worker authorization or trusted scheduler/webhook
  boundary. The stale S1h personal-ownership migration is retired and must never apply: newer live
  notification-preference and native-token lineage supersedes it. Remaining Page Access/Web Push
  ownership work needs a new, later, narrowly scoped migration; browser roles do not inherit any
  service capability.

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
- The editor lists every trusted value the selected event can actually resolve. Appointment
  assigned/updated/canceled includes customer name and job number from the linked job plus the
  appointment title/time and separately labeled estimated, approved, invoiced, and collected job
  values. The system does not collapse those distinct financial states into an ambiguous `amount`.
- Routes are code-owned identifiers with server-derived parameter contracts, never saved paths or
  arbitrary URLs. Missing route context or invalid configuration uses the code default.
- Native lock-screen templates may use the same event-specific allowlisted variables as PWA under
  the owner decision dated 2026-07-29. This does not allow generic payload traversal, arbitrary
  provider/caller fields, HTML, scripts, secrets, paths, or URLs. Missing trusted values atomically
  use immutable generic copy; rendered copy and the final APNs payload are bounded before provider
  use; office-only native destinations remain `/`. Detailed lock-screen copy is an explicit
  server opt-in: only `NATIVE_RICH_NOTIFICATION_PRESENTATION=true` enables it. Unset, `false`, or
  any other value keeps generic native copy without disabling ordinary Push.
- Preview uses fixed synthetic values and never loads customer/payment/message/job/provider data or
  sends a notification. Every save/reset is revision-checked, idempotent, and audited.
- Owner delivery diagnostics are deliberately separate from business-event dispatch. They use
  fixed privacy-safe copy, target only the authenticated owner, and may test bell, Web Push,
  native APNs, or transactional email independently of personal notification preferences. The
  optional 15-type sweep renders each code-owned catalog event with synthetic values on bell,
  Web Push, and native APNs only, independently of the real-event master enable switch. It proves
  presentation/transport rather than source-workflow activation, never creates a business
  occurrence, and never includes email, SMS, or MMS in that sweep.

## QBO P4c maintenance rule (2026-08-12)

The schema-free D1 foundation is a local, unshipped safety release. A fresh server-side read of
`integration_config.qbo_provider_traffic_enabled` permits supported QBO traffic only for the exact
text `'true'`; every other result fails closed before refresh, credential persistence, or provider
work. It does not grant authority and does not override existing billing role checks or the human
Save-to-QuickBooks gate. D1 preserves current invoice and receipt behavior against the existing
schema. Estimate QuickBooks mutations are temporarily source-disabled until D2's durable command
owner exists; local estimate editing remains available. Attachment, card-charge, payment-delete,
and Stripe projection mutation surfaces remain contained. D1 neither requires nor creates P4c
command, allocation-fence, or binding rows.

The schema-dependent `feature:qbo_document_command_v2` capability and restored estimate provider actions are D2-only and remain absent
from D1. No configuration value, deployment, provider call, money action, or migration apply is
asserted by this source state.
