<!--
FILE: docs/auth-and-authorization.md

WHAT THIS DOES (plain language):
  Describes how UPR proves who a caller is and how each layer decides what that caller may do. It
  separates login, employee membership, roles, page rollout and database row access.

DEPENDS ON:
  Internal: src/contexts/AuthContext.jsx, src/App.jsx, functions/lib/auth.js,
            .claude/rules/workers-standard.md, .claude/rules/database-standard.md
  Data:     reads → employees, permissions, page access, feature flags and protected domain data
            writes → documentation only

NOTES / GOTCHAS:
  - UI visibility is not server authorization.
  - A valid session is authentication only.
-->

# Authentication and Authorization

## Identity model

1. Supabase Auth issues and refreshes the user session.
2. `AuthContext` resolves the Auth user to an `employees` row and builds an authenticated browser
   database client.
3. Employee role, navigation permissions, per-employee overrides and feature flags inform the UI.
4. Workers independently verify the session and resolve employee/role for protected side effects.
5. RLS, RPC validation and database privileges enforce data access regardless of the UI.

An Auth user without an allowed active employee is not equivalent to an authorized UPR employee.

## Client gates

`src/App.jsx` and `src/contexts/AuthContext.jsx` provide these distinct controls:

- private/authenticated routes;
- hard role gates such as admin-only routes;
- `canAccess(navKey)` using force-disable, employee override, admin and role permission;
- feature flags for staged rollout;
- special product identities such as field technician, CRM partner and explicitly owner-only tools.

Client gates improve navigation and UX. They do not protect Workers, RPCs or direct PostgREST calls.
Feature flags must not become an authorization source unless that design is explicitly documented
and enforced again on the server/database.

### OOP pricing access boundary

The repository OOP builder keeps rollout and authority separate:

- `/settings/oop-pricing` is web-only and `AdminRoute`-protected; its draft-save and publish RPCs
  independently resolve `auth.uid()` to an active, non-external employee with literal role
  `admin`;
- desktop and native/tech operational calculator routes remain behind `tool:oop_pricing`. Their
  config read and quote read/save RPCs independently require an active internal employee whose
  role is exactly `admin`, `office`, `supervisor`, `estimator` (sales rep), or `project_manager`;
  those eligible roles may access all OOP quotes company-wide. `field_tech`, `crm_partner`/
  external, inactive, unsupported, and unauthenticated actors are denied;
- the four new pricing/snapshot tables are forced-RLS with no direct browser grants, so config and
  internal-rate snapshots are exposed only through the role-gated RPC shapes; and
- converting a saved quote into an official estimate is a separate financial-authority boundary:
  the browser/PWA calculator hides the action unless the existing Estimates page and billing-edit
  role gate both pass; the native calculator exposes it only to a literal admin and routes the
  result to the narrow native OOP estimate-review screen. `convert_oop_quote_to_estimate`
  independently requires the same literal billing role (`admin`; the compatibility token
  `manager` is retained although it is not a current enum value). Eligible calculator roles that
  are not billing editors may price and save, but cannot create an estimate;
- DevTools may switch the calculator flag from owner preview to availability for all eligible roles
  (never all staff), while a missing flag or `force_disabled` remains the fail-closed client and
  server kill switch. Neither state grants database access.

The builder migration is live under reconciled ledger row
`20260731175328_oop_pricing_builder`. Direct production verification confirmed the four private
tables are forced-RLS with no browser grants, client RPCs deny `anon`, and the literal role/flag
boundary above is enforced server-side. The rollout flag remains disabled and preview-scoped.
The additive quote-to-estimate migration `20260803192344_oop_quote_to_estimate.sql` is authored but
not applied. It also narrows direct Estimate/line writes to the billing-editor boundary and adds
an admin-only, OOP-provenance-checked atomic correction RPC with optimistic concurrency and an
invoice-conversion lock. Until separately applied and deployed, conversion and native correction
are not live capabilities.

## Worker authorization

Use `functions/lib/auth.js`:

- `requireUser` proves a valid Supabase user token.
- `requireEmployee` proves the user maps to an employee.
- `requireRole` proves the employee has an allowed role.
- scheduler/webhook secrets and provider signatures authenticate non-human callers.

Money, payroll, PII, campaigns, company messaging, credentials and administrative actions require
the same or stronger role boundary server-side as the UI. Perform authorization before provider
calls or service-role reads/writes. Record the actor for sensitive state changes.

`POST /api/feedback-resolved-notify` mirrors the Feedback Inbox's `AdminRoute`
with `requireRole(['admin'])` before reading the feedback row or dispatching
bell, Web Push, native Push, or email as the company. A technician may receive
and configure their own `feedback.resolved` notification, but cannot invoke the
administrative sender.

## Database authorization

- RLS and RPC bodies are the final data boundary for browser-accessible paths.
- `TO authenticated` is not row or role authorization by itself; add ownership, assignment,
  organization or role predicates as the data model requires.
- Privileged RPCs validate `auth.uid()`/employee status and explicitly revoke unintended execution.
- Service-role Workers bypass ordinary RLS and therefore must enforce authorization before access.
- Public access is restricted to the allowlist in `.claude/rules/database-standard.md` and must be
  token/identifier constrained where appropriate.
- Authorization data must not rely on user-editable metadata. If JWT app metadata is used, account
  for claim staleness until token refresh.

### Verified live posture (2026-07-22 audit; boundaries refreshed 2026-07-24 UTC)

Fresh catalog capture found RLS on all 133 public tables, but RLS-enabled does not mean
least-privilege:

- anonymous always-true policies still permit broad reads and mutations on deferred operational,
  customer, messaging and CRM tables;
- authenticated always-true policies grant company-wide access to many tables;
- 346 of 373 public function overloads are `SECURITY DEFINER`, and 363 total overloads are
  executable by `authenticated`; these fresh aggregate counts are not a finding-by-finding
  reclassification of the July 22 audit;
- the dated snapshot found `exec_read_sql(text)` executable by authenticated callers; migration
  `20260723205127_exec_read_sql_containment.sql` was applied and verified on 2026-07-23, and now
  denies `PUBLIC`, `anon`, and `authenticated` while preserving only `service_role`;
- the public form writer still permits direct browser execution around Worker abuse/consent checks;
  `20260723235900_public_form_rpc_boundary.sql` is authored and reviewed to make it service-only but
  remains unapplied; signing RPC status/expiration/minimal-payload work is still pending.

The original snapshot is in `docs/audit/2026-07/evidence/live-supabase.md`; the DB-003 apply result
is in `docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`. Other remediation
findings remain in the dated security audit.

Until those findings are fixed:

- do not represent a hidden route or valid session as protection for data;
- do not add a new authenticated/anonymous grant by copying an existing broad policy;
- never call or re-grant `exec_read_sql` from browser code/roles, or treat read-only execution as
  authorization;
- put public anti-abuse, consent and capability-link rules at the server/database boundary, not
  only in a caller.

## Public form submission boundary

The supported unauthenticated path is `POST /api/form-submit`, plus the separately
shared-secret-authenticated Webflow adapter. Missing Webflow secret configuration fails closed.
Both use the service-role client and call
`upsert_lead_from_form` only after their server-side schema, abuse, consent, or webhook checks.
Browser code does not call that RPC directly.

The Webflow adapter's only pre-authentication service-role access is the exact deny-all
`integration_config.webflow_webhook_secret` lookup required to compare the supplied credential.
Missing request credentials skip even that lookup. Mismatch, missing configuration, or lookup
failure denies before form/lead data, RPCs, writes, notifications, or telemetry.

Migration `20260723235900_public_form_rpc_boundary.sql` preserves the exact function
signature/body/return shape while revoking `PUBLIC`, `anon`, and `authenticated` execution and
retaining `service_role`. It is repository-ready but unapplied as of the evidence capture; therefore
the live bypass remains open until a separately authorized serialized apply and direct role
verification complete.

## Authorization review checklist

For a new or changed workflow, document:

| Question | Required evidence |
|---|---|
| Who can see the route/control? | Route wrapper, navigation rule and feature behavior |
| Who can call the Worker/RPC directly? | Session, employee and role checks before side effects |
| Which rows can the identity read/write? | Live RLS/grants plus positive and negative role tests |
| Can service-role access widen the result? | Query minimization and server-side authorization |
| Is there a non-human caller? | Signature/secret verification, replay protection and rotation owner |
| What happens after role/account removal? | Session revocation/expiry and inactive-employee handling |

## Test requirements

- Missing/expired token → 401.
- Valid user without allowed employee → 403.
- Valid employee with the wrong role → 403 before side effects.
- Each allowed role succeeds only within its row/data scope.
- Direct Worker/RPC/PostgREST calls match UI expectations.
- Public/token routes reject enumeration, expired tokens and malformed identifiers.
- Deactivation/deletion tests verify sessions and access are actually revoked.

Known dated findings are in `docs/audit/2026-07/security-findings.md`. Update this canonical file in
the same commit as a role, identity, route-gate, RLS or authorization-boundary change.

## Contractor Compliance authorization (production)

`/contractors` is web-only and requires the explicit `page:contractors` rollout row (seeded OFF,
enabled in Production on 2026-08-03), the `contractors` page permission, and an active internal
admin/office/project-manager role.
The role check is repeated by each internal Worker and the read RPCs. Admin/office may manage;
project managers receive readiness only. Field, external, inactive, unmapped, and other roles are
denied. Project-manager projections omit W-9 filenames, tax years, dates, hashes, document rows,
Storage references, previews, and downloads.

The public `/contractor-upload#token=…` page is a capability client, not anonymous database access.
The fragment is removed from browser history after capture and is never sent in the page request or API URL.
Only the Worker sees the raw token; Postgres stores its SHA-256 digest and enforces contractor,
requested-type, expiry, pause/revoke/complete, and attempt bounds. The Worker validates MIME,
magic bytes, and size before a service-role private Storage write. Upload never marks a document
accepted. Signed retrieval is short-lived, `no-store`, and available only after a fresh
admin/office document authorization. Production activation on 2026-08-03 verified the signed-in
admin surface and negative unauthenticated Worker behavior: internal upload, file, request, and
reminder endpoints returned 401, while the public endpoint returned a generic error without a
capability token. Preview remains disabled.

`/contractors/audits` repeats the feature/page/role gates. Admin/office may create, materialize,
lock, filter, and export named insurance manifests; project managers receive only insurance
readiness and interval counts, with period payment/activity facts, external source IDs, and
document IDs redacted server-side. `/contractors/tax-readiness` and both W-9 checklist/handoff
RPCs are admin/office-only. They return no W-9 file metadata or tax identifier. A non-`not_ready`
provider state also requires an accepted W-9 for that tax year in the mutation boundary.

The production `page:contractors` flag is enabled and not force-disabled. Cloudflare Production
has both exact Worker switches enabled as encrypted values; feature and reminder switches remain
off in Preview. A synthetic request reached the intended mailbox, retained a provider message ID,
and was then made inactive and reminder-paused with an audit event. This operational proof does
not broaden the role predicates or authorize real-document import without an authoritative
contact mapping.

## Credential-management authorization

Credential-management Workers require a valid session, an employee row with `is_active=true`, and
the `admin` role before any provider request or secret write. The Encircle rollout additionally
requires an explicit enabled/dev-only flag row and treats a missing row as OFF. This server check is
the authority; `/settings/integrations` remaining under `AdminRoute` is only the matching UI gate.

Encircle service-role writers have separate operational capabilities. Manual selective import is
limited to active `admin`, `office`, or `project_manager` employees; historical backfill and the
legacy bulk sync repeat the owner-only Dev Tools predicate server-side. The automatic new-claim
push, Scope Sheet search/room reads, and note upload require an active employee because field
technicians use those paths; inactive and non-employee sessions are denied before service-role or
provider access.

## Messaging transport authorization

The messaging build branch introduces one server-side `conversations` capability predicate for
`POST /api/send-message`: authenticated user, resolved active non-external employee, force-disable
precedence, employee override, admin allowance, then role permission. The worker derives
`sent_by` from that identity and rejects a forged actor before service-role domain reads or
provider calls.

The currently deployed production policies still treat conversations as company-wide for internal
employees who have that capability. The participant-control release candidate adds a narrower
staff-membership decision and keeps the page capability as a required outer gate. Anonymous users,
nonemployees, inactive employees, external employees, force-disabled access, and denied
overrides/roles remain excluded. A future tenant scope must tighten Worker and RLS together.

The compatible participant foundation and unread-state compatibility layer are now present only
on isolated `qa-staging` (ledgers `20260731143710` and `20260731181046`), not production. The
authored, unapplied correction
`20260731213000_conversation_assignment_authority_containment.sql` replaces every independent
participant/contact helper with one trusted decision shared by the inbox, message-author lookup,
admin membership controls, technician self-leave, and service-only recipient/search/create
helpers: privileged internal role → explicit per-chat override → default technician → deny.
`crm_partner` never passes. Appointment, job, claim, and crew records are scheduling context, not
conversation authorization, because browser roles can currently mutate those records. The
correction preflights the exact employee-identity containment posture and replaces
`messaging_employee_can_access_conversation`, `get_conversation_members`,
`find_or_create_scoped_conversation`, and `search_scoped_conversation_contacts`. The admin/self
mutation RPCs derive the actor from `auth.uid()` and the membership tables deny direct browser
reads/writes.

The candidate clients retain actor-scoped conversation data only under a 30-second proof measured
from request start, not response receipt. A response resolving after that boundary is rejected.
Desktop poll/resume requests are monotonic, so a superseded response cannot commit rows, leases, or
active-thread effects after a newer proof. Silent refresh preserves existing order and unchanged
row identity while applying authoritative removals and additions.
Successful desktop inbox omission clears every removed draft and lease; tech expiry removes only
IDs whose own proof expired, after enumerating their thread/member/access/inbox/draft state. Because
the tech inbox RPC is filtered, searched, and capped, absence from that result is never itself
revocation proof. The QA-applied 40338 snapshot RPC rechecks IDs in actor-derived batches of at
most 200: filtered hooks submit only their exact prior-page omissions, while the always-mounted
default hook also submits current-generation leases and thread/member/access/draft cache IDs
outside the top 50. Each allowed ID renews its own request-start lease; a denied ID is tombstoned
in place and loses only its thread, inbox row, member cache, and draft. Account-generation guards
make delayed callbacks and timers from an ended account inert, and background-query errors retain
visible data only while the current owner's last proof is still fresh. An expired list proof
retains an explicit unverified marker even though React Query cache pruning changes query status;
the UI presents verification/error-and-retry rather than a false successful empty state until an
accepted proof clears the marker. On
hidden→visible, both desktop and tech synchronously purge expired inbox labels/previews before
starting revalidation, even when no thread is open.

This staging schema does not make the product participant-scoped in production.
`20260731040338_conversation_unread_state_compatibility.sql` adds the actor-derived unread writer
and is applied only to QA as ledger `20260731181046`; catalog and rolled-back no-write behavior
checks passed. It also completes the standard `authenticated, service_role` grants without
rewriting the already-applied staging foundation source.
`20260731213100_conversation_participant_policy_enforcement.sql` remains authored and unapplied
everywhere. It follows the authority correction and narrows the existing broad `ALL` policies in
place to membership-scoped reads with a
fail-closed write check, revokes browser direct table writes, and explicitly preserves
`service_role`. Its preflight requires the exact expected policy/ACL allowlist across
`conversations`, `conversation_participants`, and `messages`, so an extra policy or grant aborts
the migration. Candidate Workers also
recheck current membership before sends/notes, use scoped contact search/creation, and resolve
inbound recipients only through the canonical helper. Production must apply
`40337 → 40338 → 31213000` in one exposure-free, separately authorized window; QA needs only
`31213000` because its immutable `40337/40338` sources are already applied. Verify that no trusted
function contains appointment/job/claim authority, then deploy compatible web and supported
native callers. Apply `31213100` only after older direct-unread writers are unsupported,
disposable DB proof passes, and a separate owner-authorized window is open. Reverse recovery is
`31213100 → 31213000 → 40338 → 40337` and is a fail-closed service pause, never restoration of
broad browser access.

`/api/callrail-connect` is separately admin-only and rejects inactive or external employees before
credential or webhook-secret access. These repository changes are not proof of deployed
protection. Tests cover missing authentication, denied roles, inactive/external employees, forged
actors, and allowed callers; deployed role behavior remains a release verification gate.

Inbound notification audience resolution is also fail-closed. Explicit recipient IDs, assigned
employees, appointment crews, and role-based fallback audiences are all intersected with the
current active, non-external employee directory before bell, push, or email fan-out. An inactive,
external, deleted, or unknown employee ID is not trusted merely because it arrived in an internal
event payload or still has a historical push subscription.

The inactive Twilio inbound route is public by provider necessity but not anonymous in authority:
before any event, Storage, consent, canonical-message, unread, or notification work, it requires
`MESSAGING_SCHEMA_MODE=foundation`, a configured account/token, and an
`X-Twilio-Signature` valid for the exact public URL plus every received form parameter. AccountSid
must match the configured account. Before signature success, database access is limited to the
exact Twilio token row and AccountSid key; outbound sender configuration is not read and no
telemetry/domain write occurs. Its atomic `project_twilio_inbound_event(uuid,boolean)` RPC is
`SECURITY INVOKER`, rejects every `current_user` except `service_role`, and explicitly revokes
execution from `PUBLIC`, `anon`, and `authenticated`. Browser roles have no path to manufacture a
provider event projection or message notification.

`GET /api/messaging-setup` and its `action=callrail-options` discovery mode use the same strict
integration-administrator boundary: valid Supabase session, resolved employee, `role='admin'`,
`is_active=true`, and `is_external=false`. Authorization completes before service-role reads or
CallRail requests. The route is read-only and redacted: it may report configuration-presence
booleans, safe server mode labels, blockers, and eligible sender identifiers/numbers, but never an
API key, access token, signing key, legacy webhook secret, raw upstream response, customer
conversation, destination number, or call-flow payload. Missing or invalid authorization is
fail-closed and provider discovery is not attempted.

The browser has no authorization path for changing messaging/schema modes, webhook signing
material, Cloudflare bindings, provider-console configuration, or sending a test message. A visible
admin route or readiness indicator does not replace the separate owner-approved activation gate.

`POST /api/message-media-upload` uses the same server-side Conversations capability plus the
service-only employee/conversation membership predicate before reading image bytes or performing
any service-role Storage write. Upload also binds a valid conversation, verifies the final image
bytes, and creates a random private object path. `POST /api/message-media-url` calls the
service-only `messaging_get_authorized_message_media(employee_id,message_id)` boundary, which
returns canonical conversation/media metadata only when the strict employee/conversation
predicate succeeds; the Worker never performs a pre-authorization service-role message read.
Both routes use bounded Worker transport for Auth, PostgREST, RPC, and Storage. There is
intentionally no browser delete route: cleanup needs a durable draft-to-message claim before it
can safely distinguish an orphan from sent/failed/ambiguous history. Missing and nonmember objects
are indistinguishable, authorization lookup failures fail closed, and neither route accepts a
caller-supplied bucket or path.

The CallRail recovery worker claims provider events only through
`claim_callrail_provider_event`. The RPC is `SECURITY INVOKER` with an empty search path, rejects
any JWT role other than `service_role`, and revokes execution from `PUBLIC`, `anon`, and
`authenticated`. Its exact event/state/time predicate and `UPDATE ... RETURNING` result are the
worker's claim authority; browser sessions cannot claim or replay provider events. It is live
under migration-ledger version `20260724051500`; read-only catalog verification confirmed the
reviewed body fingerprint and the same service-only invoker boundary.

### Scheduled-message delivery boundary (authored; not applied)

The authored scheduled-message hardening is a code-first, two-migration release candidate, not
evidence of a deployed or applied control. After the participant foundation, the hardened callers
deploy first and fail closed while their RPCs are absent. Compatibility then moves browser
scheduling to `create_scheduled_message`, which derives the employee from `auth.uid()` rather than
accepting an actor ID. The RPC requires an active, non-external
employee with the Conversations capability and current conversation membership/access, then
requires exactly one active customer participant with a non-empty phone. It persists the derived
creator plus the exact recipient contact/phone snapshot and rejects an idempotency-key reuse with
changed content. `get_scheduled_queue` and
`cancel_scheduled_message` are exact DevTools-owner contracts; cancellation is restricted to an
unreserved pending row.

Compatibility first requires the exact `31213100` participant-policy ledger and catalog posture,
takes the queue lock, and aborts the transaction with SQLSTATE `55000` if the aggregate count of
legacy `pending` rows is nonzero. It never quarantines, fails, or otherwise edits those rows.
It then creates a FORCE-RLS actor-derived provenance ledger whose immutable snapshot includes the
creator, conversation, canonical body/send time, recipient contact, and recipient phone; only a
row whose stored values still match that snapshot may be claimed or reserved. It closes raw
browser queue writes in the same transaction, changes the three historical queue policies to
explicit `false` predicates, and preserves the legacy claim signature plus its historical
authenticated/service grants as a callable `false` no-op. A stale caller therefore stops normally
without reading or claiming a row. After compatible web/Worker callers are deployed and verified,
enforcement follows compatibility in the same serialized release window. The policy objects
remain as fail-closed catalog records while table ACLs also make them unreachable; this avoids
destructive policy DDL while retaining the provenance boundary. Browser roles have no raw queue
read/write route and retain only the narrow authenticated RPCs above. The frozen legacy
`claim_scheduled_message(uuid)` signature cannot claim or initiate a send.

All lifecycle operations after browser creation are `SECURITY INVOKER`, service-role-only RPCs
with an explicit `current_user = 'service_role'` fence: token-fenced claim, token-matched
release/failure, reservation, and reconciliation. `claim_token` prevents an old worker from
releasing or finishing a newer claim. A nullable `delivery_attempt_id`, uniquely linked to one
`message_send_attempts` row, prevents a linked scheduled row from being reclaimed for another
provider submission; it must be reconciled instead. Reservation revalidates the stored creator's
capability and conversation access, the immutable recipient contact/phone snapshot against both
the scheduled row and current participant, and the canonical body in the same transaction. Before
it inserts that attempt, the same service-role transaction share-locks the current automated-SMS
kill-switch row and invokes the canonical phone-locked consent RPC. Only `GLOBAL_OPT_IN` may
cross this scheduled free-form boundary; disabled SMS, DND, explicit opt-out, pending STOP,
service/implied consent, or any unreadable result returns no attempt. The
Worker also repeats creator access and exact-recipient checks at
dequeue, so capability revocation, membership removal, deactivation, or recipient drift fails
closed before provider dispatch.

`GET`/`POST /api/process-scheduled` is not public: it accepts either the validated scheduler
secret or the exact DevTools-owner identity, and the human path must also retain Messages
capability. The direct platform `scheduled()` handler is a distinct non-HTTP scheduler capability.
Authorized delivery still routes through `sendAutomatedMessage()` and its consent/DND gates; the
new reservation/reconciliation boundary does not authorize a provider bypass or automatic replay
of an ambiguous outcome. The HTTP/scheduled wrappers, owner Auth check, service PostgREST/RPC
client, and provider adapter use the bounded worker transport. A scheduled reservation also selects
fresh fail-closed Twilio credential resolution: managed-store timeout cannot fall back to an older
cache/environment secret and reaches no provider request. Ordinary non-scheduled credential
consumers retain the existing bounded DB-first/environment-fallback compatibility behavior.

Required release evidence is negative as well as positive: browser raw-table and lifecycle-RPC
calls must be denied; wrong, inactive, external, revoked-capability, non-member, or non-owner
actors must fail before queue mutation or provider work; exact recipient changes must fail at
dequeue/reservation; and a durable link must allow only one attempt/materialization. Run the
behavioral SQL proof only against an isolated disposable database, plus source-level ACL/rollback
tests. The full recovery-only reverse chain is
`31220100 → 31220000 → 31213100 → 31213000 → 40338 → 40337`. Each rollback seals browser
tables and RPCs, preserves provenance/reservation evidence, and preflights unresolved linked
pending work; it never restores broad authenticated access or appointment-derived authority.
Unknown provider outcomes are retained for owner review and never automatically resubmitted.
Neither rollback, migration apply, Worker deployment, scheduler-secret configuration, nor
provider activation is authorized by this repository documentation.
For PR #565 specifically, neither scheduled-delivery migration has been applied to a hosted
database; no flag, cron/scheduler, or provider activation changed. The compatibility deferral and
final Denver-time reservation check are authored source only.

## Prior SMS consent attestation (live database boundary verified 2026-07-23)

`POST /api/attest-sms-consent` requires a valid Supabase session and an active, non-external
employee whose role is `admin` or `office`. The Worker derives the actor from that session; a
request-body actor or IP cannot select or forge the audit identity/context. The server accepts only
the trusted Cloudflare connection IP, and validates a supported evidence method, non-future consent
date and evidence note before invoking the service-role-only database operation.

The database rechecks the same employee authority and current contact suppression state inside the
transaction. Browser roles have no policy or grant on `service_sms_consents` or the append-only
`service_sms_consent_attestations` evidence history and cannot execute either consent RPC directly.
Raw evidence and request IP never enter the broadly readable legacy consent log. DND,
duplicate-contact suppression, STOP/provider opt-out, a durable STOP awaiting provider-event
projection, missing contacts and phone mismatch fail closed.

`GET /api/attest-sms-consent?contact_id=...` requires the shared server-side Conversations
capability and returns only the service-role status decision; it never exposes the evidence note,
phone, actor IP or full row. Conversation UI visibility is presentation only; these Worker and
database checks are the authority.

The database boundary is live under migration-ledger version
`20260724035913_attest_prior_sms_consent`. Read-only role verification confirmed neither `anon` nor
`authenticated` can access the two evidence tables or execute the RPCs. A rollback-only synthetic
transaction, acting through `service_role` with a real active internal admin/office identity,
confirmed that duplicate-contact DND and pending STOP state fail closed while raw evidence remains
outside the legacy browser-readable log. No provider send occurred during verification. Detailed
sanitized evidence is in
`docs/audit/2026-07/evidence/prior-sms-consent-live-apply-2026-07-23.md`.

Additive hardening migration `20260724043000_harden_service_sms_consent.sql` is live under
migration-ledger version `20260724043000`. It pins and revalidates the contact phone after entering
the inbound-projection serialization boundary and requires a strictly later processed START to
supersede a pending STOP; equal timestamps remain blocked. The actor row is held `FOR SHARE`
through the attestation write, closing concurrent role/deactivation races. The patch refuses any
function-definition hash drift or duplicate patch anchor before replacing either service-only RPC.
Read-only catalog recapture confirmed both functions remain `SECURITY INVOKER`, use an empty
`search_path`, deny browser roles and permit only `service_role` execution.

## Native UPR Work Authorization consent bridge (repository only; not applied)

Migration `20260727005212_upr_work_authorization_sms_consent.sql` proposes a separate immutable
evidence table and service-role-only, invoker-rights completion wrapper. The public signing request
still reaches only the Worker; the Worker supplies the exact approved disclosure version/hash, and
the wrapper calls the existing completion RPC plus records evidence in one transaction. `PUBLIC`,
`anon` and `authenticated` receive neither table privileges/policies nor wrapper execution.

The bridge does not manufacture an employee actor and does not use the admin/office attestation
RPC. The shared status RPC remains service-role-only and evaluates duplicate-contact DND,
`opt_out_at`, pending STOP, destination/phone consistency and global opt-in before considering
signed Work Authorization evidence. A missing/mutated disclosure or absent migration leaves
messaging blocked while allowing the legal signature workflow to complete. Repository source is
not proof that this boundary exists in the shared database or deployed Worker.

The signing Worker supplies its trusted Cloudflare connection IP to the completion RPC. The
dedicated service-role-only Work Authorization evidence stores that IP and refuses automatic
consent when it is absent. The legacy `sms_consent_log` remains redacted and does not receive the
raw signer IP.

`GET/POST /api/message-conversations` requires the same server-side Conversations capability as
the messaging send surface before any service-role read or write. Its Auth and service-database
requests use the bounded Worker transport. Contact search is length- and grammar-bounded, returns
only `id`, `name`, `phone`, and `company`, and caps results at 25.
`find_or_create_conversation(uuid)` is `SECURITY INVOKER`, asserts `service_role` inside the
function, and denies direct execution to `PUBLIC`, `anon`, and `authenticated`.

The mobile PWA may read one contact's redacted consent decision through the existing
`GET /api/attest-sms-consent` Worker. Only active, internal admin/office employees can record prior
consent; technicians cannot. The UI fails closed while status is loading or unavailable, and
`/api/send-message` independently rechecks consent and DND before provider dispatch.

## QuickBooks Online attachments authorization (2026-07-24)

`POST /api/qbo-attach` (push/remove a file on a QBO invoice/estimate) enforces
`requireRole(['admin','manager'])` server-side — the same literal predicate the UI's
`canEditBilling` checks — before any QuickBooks or DB side effect; the client `canEdit` prop is
defense-in-depth only. `manager` is not a current `employee_role` value (`project_manager` is), so
this is effectively an active-admin gate. The Worker now explicitly rejects
`is_external=true` after the role check and before connection, attachment metadata, telemetry or
provider access.
The new `qbo_attachments` table is a **new** table, so it does NOT copy the documented-broad
"any authenticated" read policy of `invoices`/`estimates` (that broad pattern is a known finding to
fix, per the notes below — not a template). Its only policy is a SELECT scoped to active
literal `admin`/`manager` roles (`NOT is_crm_partner(auth.uid())` plus an `employees.auth_user_id =
auth.uid() AND is_active AND role IN ('admin','manager')` predicate). It has no browser
INSERT/UPDATE/DELETE policy — the worker writes via the service role (which bypasses RLS). The table
holds no secret (opaque QuickBooks attachable id + file metadata only). Coverage: the
`qbo-attachments-migration` test asserts the role-scoped predicate and the absence of a bare
`USING (true)`; the `worker-security-reviewer` verified the server-side role gate. The SELECT
policy does not yet require `is_external=false`, so a hypothetical external admin can still read
metadata directly through PostgREST even though the Worker denies attach/remove. That is a
separately gated RLS migration finding, not closed by the Worker slice.

## Mobile QBO authorization checkpoints (R0 S1a and S1b, 2026-07-26)

The local R0 slice routes `/api/qbo-invoice`, `/api/qbo-estimate`, `/api/qbo-payment`, and
`/api/qbo-query` through `functions/lib/qbo-auth.js` before connection, domain-table, telemetry or
provider access. Browser Bearer access requires a valid session resolving to an active,
non-external employee with `role='admin'`. The human-only invoice endpoint rejects the preserved
`x-webhook-secret`; background-safe estimate/payment/query paths retain that exact server
capability. Missing sessions return the deployed `401 {"error":"Unauthorized"}` contract; known
employees outside that boundary return 403; auth/configuration failures fail closed. These
admin-mobile QBO screens remain web/PWA-only. The owner-directed OOP exception bundles one narrow
native estimate review/correction screen. It requires the estimate to retain an OOP source-quote
link and writes only the service-address and existing line description/quantity/rate/order
columns. It does not call a provider Worker; Collections, invoice, payment, QBO catalog,
QuickBooks send and estimate-to-invoice screens remain excluded from Capacitor.

S1b extends the same active, non-external `admin` browser boundary to
`/api/qbo-sync-customer` and the HTTP GET/POST forms of `/api/qbo-payments-sync`, while preserving
their exact secret-first `QBO_WEBHOOK_SECRET` capability. The poller's direct Cloudflare
`scheduled()` entry remains a distinct non-HTTP capability. `/api/quickbooks-connect` uses the
human-only form of the gate: the server secret cannot replace OAuth state. `/api/qbo-charge` and
`/api/qbo-attach` retain their existing Bearer-only billing-role contract and now explicitly deny
external employees before connection, domain, telemetry or provider work. Handler-level negative
and failure-path tests prove those denied paths reach at most Supabase Auth plus the employee
lookup. The customer-sync and manual payment-sync gates resolve the human actor but their current
`worker_runs` records do not durably persist that actor; adding an audit field/write is a separate
schema/telemetry decision.

This is still not a global QBO or mobile authorization claim. The direct `qbo_attachments` SELECT
policy does not exclude external admins; other notification, recording, RPC, direct-table and
Storage boundaries remain open. The shared QBO capability's deployed binding equality and
lifecycle were not inspected, and the S1a caller set remains unproven. `project_manager` inclusion
and capability retention/rotation are owner decisions.

## QBO invoice command recovery authorization (database applied 2026-07-31)

The owner-authorized apply of exact source commit `3f61e7fa` is recorded in production as
`20260731205928_qbo_estimate_conversion_concurrency` and
`20260731205942_qbo_invoice_command_ledger`. The `qbo_invoice_commands` table and its command/CAS
RPCs are forced-RLS and service-role-only; a browser has no ledger grant. Every invoice
save/send/delete action requires an active, non-external `admin` Bearer session. The shared QBO
server secret is explicitly rejected on this human-only endpoint and cannot stand in for a person.
The command binds the authenticated actor before an Intuit write, so retry recovery cannot silently
become a different authority path.

The compatible Worker/client source ships in the same `dev` release as this documentation, but
repository state does not prove it is deployed. Cloudflare binding/deployment,
authenticated-browser and provider proof remain separate owner/external gates.

### Multi-invoice receipt authorization (database live; rollout disabled)

The authored `/api/qbo-receive-payment` route uses the human-only
`authorizeQboBrowserRequest` path: a valid Bearer session must resolve to an active, non-external
literal `admin` before the QBO connection, contact/invoice data, payment options, durable attempt,
worker telemetry, or provider are touched. It never accepts `QBO_WEBHOOK_SECRET`. Route visibility
through `AdminRoute` is defense-in-depth. The Worker independently reads the exact
`feature:qbo_receive_payment` row and requires `enabled=true` plus `force_disabled=false`, as well
as the separate literal `QBO_RECEIVE_PAYMENT_ENABLED=true` switch, before any QBO work. Both are
rollout containment, not authority.

The foundation is live under production ledger
`20260731225654_qbo_multi_invoice_payment_receipts`; its service-grant containment is live under
`20260731230907_qbo_receipt_service_grant_containment`. Receipt, attempt, and event tables have
forced RLS and no `anon`/`authenticated` grants. `service_role` has direct `SELECT` only on
`payment_receipts` and `payment_receipt_attempts`, and no direct privilege on
`payment_receipt_events`; receipt writes remain exclusively behind the seven gated
`SECURITY DEFINER` RPCs. The foundation migration also revokes every `anon` privilege on
`payments` and drops its four inherited broad
`allow_anon_*_payments` policies while retaining the existing authenticated policy. A
`SECURITY INVOKER` receipt-link trigger independently rejects any non-service JWT role that tries
to set or change `payments.receipt_id`. Their six state-mutation RPCs plus the atomic QBO-event
claim RPC are worker-only, service-role-only, and independently verify the service JWT claim; a
browser cannot bypass the Worker through PostgREST.
Inbound reconciliation remains a server capability: real-time events require the exact Intuit
signature/realm boundary, and scheduled/HTTP recovery uses the existing scheduler capability or
active-admin gate.

Required negative proof before activation is: missing/invalid session, wrong role, inactive or
external employee, either rollout gate disabled/missing/malformed, malformed request,
cross-customer invoice, and stale balance all fail before the QBO create call; direct browser
table/RPC access is denied. The migration was qualified in `qa-staging` before its owner-authorized
production apply; the feature flag and environment gate remain disabled, and no provider or payment
action has been performed under this foundation.

PR #565 keeps QBO server authorization bounded on every caller path: the shared browser gate uses
the timeout-bounded authorization transport, while server-secret callers retain only their existing
webhook-secret route. Legacy QBO payment endpoints validate UPR payment IDs as UUIDs before any
database/provider work, bound provider payment IDs, and strictly URL-encode every PostgREST filter
value. These source hardenings neither authorize a provider action nor prove a deployed binding.

## Message-media compatibility authorization (source only)

`POST /api/message-media-url` normally reads media through the service-only
`messaging_get_authorized_message_media(employee_id,message_id)` RPC. If—and only if—PostgREST
returns the exact `PGRST202` missing-function response for that RPC, it may read the minimal message
row and then independently require the already-live service-only
`messaging_employee_can_access_conversation(employee_id,conversation_id)` RPC. Every other
failure, including timeout, permission, or catalog error, remains closed; a row is never returned
without that conversation-access decision. This is a serialized-migration compatibility seam, not
proof that the new RPC, native client, or hosted deployment is live.

## Mobile S1c CallRail recording and notification HTTP authorization (2026-07-26)

The local S1c source slice replaces `/api/callrail-recording`'s any-employee boundary with an
active, non-external employee check followed by either `role='admin'` or the existing
`crm_call_log` employee/role capability. This preserves the admin-mobile caller and approved
internal desktop Call Log callers while deliberately denying external identities, including
`crm_partner`, before the lead row, CallRail credential, account discovery or recording fetch.
Missing/invalid sessions keep the deployed `401 {"error":"Unauthorized"}` shape.

The recording object boundary validates a UUID, requires an `inbound_leads` call row, requires its
stored `callrail_id` to match the call ID embedded in its stored allowlisted CallRail URL, and only
then reads the credential. UPR has no employee-to-CRM-organization assignment model, and
`get_inbound_leads` itself is company-wide. S1c therefore documents `crm_call_log` as company-wide
recording authority; it does not claim tenant/assignment scoping that the data model cannot express.
The non-admin Worker capability does not mirror the desktop rollout/kill flags. The later live S1e
database boundary removed authenticated lead DML and moved the provider URL to a forced-RLS,
service-only source table; browser/RPC callers now receive only an opaque recording marker. The
remaining residual is company-wide active-internal lead metadata/read scope, not raw recording-URL
exposure or mutation.

HTTP `/api/notify` retains two distinct identities:

- an exact stored `x-webhook-secret`, checked first with no Bearer fallback on mismatch, preserves
  the deployed database-trigger payload and response contract; and
- a Supabase Bearer must resolve to an active, non-external `admin`, then may request only
  `estimate.accepted`. The repository-only five-producer repair retires the three appointment
  Bearer types because a human request cannot mint the database occurrence identity required by
  those producers. The Worker verifies the estimate state and passes only its object ID to
  `dispatchEvent`; caller-supplied recipients, title/body/HTML, payload/data, entity/job fields and
  links are rejected.

There is no checked-in mobile/desktop/browser HTTP Bearer caller. Trusted Workers continue to
import `dispatchEvent` in-process, and the secret-authenticated database trigger path is unchanged.
The Bearer Auth lookup and production Web Push dispatch both use the bounded Worker transport;
tests keep the transport injectable without changing the authorization or provider contracts.
The database-RPC residual that existed when S1c was authored is now closed: live
`20260727233704_notify_emit_service_boundary` removed authenticated execution and made the trusted
event type authoritative, and live `20260731165215_pg_net_worker_url_allowlists` added the
two-origin URL allowlist plus blank-secret no-op. S1c did not author those later boundaries, but an
authenticated browser can no longer execute `notify_emit(text,jsonb)`.
The authenticated-executable `create_notification` definer is another direct bell-emission path
outside the HTTP Worker. S1f now has an attribute-only, locally tested apply candidate that revokes
browser execution and retains `service_role`; it is not live until its separate owner apply.

## Mobile S1d notification dispatcher RPC boundary (live 2026-07-27)

A fresh read-only catalog capture confirmed one live
`public.notify_emit(p_type_key text,p_body jsonb) RETURNS void` function owned by `postgres`, with
`SECURITY DEFINER`, `search_path=public`, and direct EXECUTE grants then held by `authenticated`
and `service_role` while `PUBLIC`/`anon` were denied. No browser or Pages Worker source caller was
found.
The exact database graph is six owner-run definer functions/seven calls: appointment assignment,
appointment update/cancel, estimate acceptance, timesheet request/review, and the abandoned-clock
scan reached by its `postgres` cron job.

The applied `20260726110000_notify_emit_service_boundary.sql`, recorded as live ledger entry
`20260727233704 notify_emit_service_boundary`, revokes
`PUBLIC`, `anon`, and `authenticated` after the body replacement and grants only `service_role`.
Owner-executed trigger/RPC/cron chains remain compatible through PostgreSQL ownership; adding an
in-body session-role assertion would break those intended database callers and is forbidden for
this contract. The body replacement changes only JSON object merge order, making the trusted
`p_type_key` authoritative while retaining URL/secret lookup, headers, `net.http_post`, ignored
response, no-op gates, signature, result, security mode, and search path.

A 2026-07-28 read-only recapture confirmed owner `postgres`, body hash
`27d638e9e2681bf74f17fa255c7eaf04`, `search_path=public`, and EXECUTE only for owner plus
`service_role`; `authenticated` can no longer execute the function.
The 2026-07-31 allowlist hardening subsequently replaced the body again; current live fingerprint
`c72e0f7fd40a4abec42cce1cd912a45b` retains the same service-role-only ACL and adds the
two-origin URL gate plus blank-secret no-op.
`create_notification`, direct recording-source access, wider mobile RPC/direct-policy boundaries,
and private media remain separate. Exact migration, rollback, catalog-only role/caller checks and
evidence are recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`.

## Five contained notification producer authorization (QA applied; Production pending)

Reviewed source `20260801215912_notification_producer_authorization.sql` is applied to QA only as
hosted ledger `20260803182131_notification_producer_authorization`; shared Production remains
unchanged. It preserves the deployed browser/service RPC signatures while
requiring browser calls to resolve one active, non-external internal employee from `auth.uid()`.
`p_actor_id` remains in each compatibility signature but must be null or equal that resolved
employee; time-entry review additionally requires the existing admin tier. Trusted
`service_role`/database-owner chains remain compatible, but any supplied audit actor must itself be
active/internal.

`appointments` and `appointment_crew` lose anonymous table privileges/policies. Authenticated
direct access requires an active internal employee; a private appointment is visible/mutable only
to an admin/project manager or assigned crew member. Assigned crew may not delegate private access:
only an active internal admin/project manager may change a private appointment's crew. Privacy
elevation is independently trigger-guarded and direct INSERT/UPDATE policy checks fail closed for
non-managers. For a public appointment, broad mutation/crew authority belongs to active internal
admin/office/project-manager/supervisor roles; a field tech or estimator must already be assigned
or be the server-bound creator of that new public appointment. The additive
`appointments.created_by_employee_id` is set by a BEFORE trigger from `auth.uid()` and is immutable
to browser callers, preserving the field create-then-assign flow without granting self-assignment
to someone else's appointment. The update and delete RPCs bind their actor and check the same
object predicate before mutation. The crew RPC locks its appointment row, applies that separate
management predicate, validates one duplicate-free active/internal target set, then applies only
delete/update/insert differences. A browser may update only a crew row's role; `id`,
`appointment_id`, and `employee_id` are trigger-immutable so an existing assignment occurrence
cannot be relabeled to another employee. Direct crew inserts/updates also reject inactive or
external target employees. Timesheet submit locks the entry and pending request, returns the
same row for an exact retry, and rejects a different concurrent proposal; review locks the request
and records the server-derived reviewer. The existing broad authenticated
`time_entry_change_requests` read policy is narrowed to the active internal requester for their own
row or an active internal admin/office/project-manager/supervisor for all rows. Unrelated,
inactive, external, and authenticated accounts without an employee mapping receive no rows.

The five trigger/RPC producers may emit only through a private durable occurrence row. The Worker
rejects these types without that row's UUID, re-resolves appointment crew or timesheet audience,
and validates each delivery recipient against the exact producer entity. Timesheet request rows,
not webhook JSON, own the requester, admin audience, status, review note, entry ID, copy, and
destination; supplied recipients/copy/link/payload are discarded. Service-only per-target claims
cover bell, Web Push, and email. Guarded APNs uses a new per-device claim that atomically combines
the same occurrence/entity/recipient predicate with current token ownership before Apple is
called. Guarded Web Push atomically proves the selected subscription still has the same
ID/employee/endpoint; guarded email proves the normalized address is still current. No provider
receives stale target data after logout, reassignment, deactivation, or address change. Unguarded
notification types retain their deployed claims. Preflight/postflight also
require the exact policy commands/roles/count and enabled, unrestricted trigger bindings so
permissive policy or trigger drift stops the migration. QA then applied the compatible dispatcher
source `20260802040935_preserve_notify_emit_event_id.sql` as hosted ledger
`20260803182303_preserve_notify_emit_event_id`. Catalog/postflight confirms both private evidence
tables are empty with forced RLS, no browser-role access, and reviewed least-privilege service
access; all five
producer flags remain false, `appointment.reminder` is absent/fail-closed, and its cron is absent.
Shared Production has neither migration. Three unindexed foreign keys and pre-existing
browser-role grants on the RLS/no-policy `billing_2fa_codes`, `integration_config`, and
`user_google_accounts` tables remain separate P2 cleanup. No provider call, delivery, activation,
or device proof is implied.

### Appointment-reminder claim authorization (repository candidate)

The activation candidate resolves those database prerequisites and adds a reminder-only claim
boundary without changing the exact-five guarded set. Browser/Public table and column privileges
are removed from `billing_2fa_codes`, `integration_config`, and
`user_google_accounts`; postflight requires the intended service-role CRUD set and denies every
browser role.

The Worker alone may execute the new reminder validator/claim/release functions. Each claim
reconstructs authority from database state immediately before the side effect: the catalog type
must be enabled, the occurrence must match a scheduled appointment and current start time inside
the one-hour due window, the employee must be an active non-external current crew member, and the
target must exactly match the current channel destination. Assigned active/internal crew may have
any legitimate role; an unassigned admin or office employee has no reminder authority. The
service-only invoker functions and forced-RLS table grant nothing to PUBLIC, `anon`, or
`authenticated`.

This source is not live authorization evidence. The prerequisite and reminder-claim migrations
remain unapplied, and activation remains blocked until their exact committed train has local and
hosted QA behavior proof plus a separately authorized shared-project apply.

The QBO human-actor telemetry gap and the external-admin `qbo_attachments` metadata SELECT policy
remain separate residuals. They were not changed or treated as notification/recording work.

R0's corrected transitive mobile census found 84 client-reachable live `SECURITY DEFINER`
functions: 82 in the authenticated `/tech` graph plus the two public-signing RPCs mounted by
`NativeRoutes`, not only the 68 inline calls in the historical audit. All 84 allow
`authenticated`; four allow `anon`, and three allow `PUBLIC`. Shared bell, preference,
native-device-token, clock-precheck, and destructive job/claim-merge functions generally trust
caller-supplied employee/object IDs without reconstructing the caller. The Web Push upsert/delete
pair is the narrow exception in that group: it resolves the employee with
`employees.auth_user_id = auth.uid()`.

The public signing pair is intentionally anon-callable but currently checks token equality only;
status and expiry are enforced later by the UI/submit Worker, not by either read RPC. The exact
allowlist is `get_sign_document_templates` for `anon` and
`get_sign_request_by_token` for `PUBLIC`/`anon`, with both also executable by authenticated/service
roles. These are open containment findings, not approved authorization contracts.

The route/RPC/direct-policy and read-only live evidence is
`docs/audit/2026-07/evidence/mobile-readiness-r0-recapture-2026-07-25.md`. `MOB-SEC-014` remains
open; source-only addenda are
`docs/audit/2026-07/evidence/mobile-readiness-s1b-qbo-identity-2026-07-26.md` and
`docs/audit/2026-07/evidence/mobile-readiness-s1c-callrail-notify-2026-07-26.md`. A React admin
route is not a substitute for the remaining Worker, RPC or RLS boundaries.

## Mobile S1e recording-source authority (live)

Migration `20260726183409_inbound_lead_recording_source_boundary.sql` is live under QA ledger
`20260731224513_inbound_lead_recording_source_boundary` and production ledger
`20260731225511_inbound_lead_recording_source_boundary`. `get_inbound_leads` requires an active,
non-external employee and either `admin` or the existing
`crm_call_log` employee/role capability. Its only browser callers remain the mobile Admin Lead
Center and desktop Call Log. Direct `inbound_leads` SELECT remains company-wide for active internal
employees because the current model has no employee organization membership or lead assignment;
`crm_tasks.assignee_id` is task ownership, not lead visibility. Authenticated direct DML is removed.

Raw provider URLs are held in forced-RLS, service-only `inbound_lead_recording_sources`; nested
recording-source keys were removed from `raw_payload` on backfill and are removed from future writes. Browser and
legacy composite RPC responses see only a truthy opaque marker. Authenticated execution of the
service ingestion RPC is revoked. The approved CallRail proxy keeps
the narrower admin/`crm_call_log` boundary and is the only interactive audio-delivery path.

## Mobile S1g notification read/mark boundary (live, partial client proof)

The catalog-only S1g capture found the exact four deployed bell RPCs, each owned by `postgres`,
SQL `SECURITY DEFINER`, `search_path=public`, executable by `authenticated` and `service_role`,
with no direct database-body caller:

- `get_notifications(integer DEFAULT 30, uuid DEFAULT NULL) -> SETOF notifications`;
- `get_unread_notification_count(uuid DEFAULT NULL) -> integer`;
- `mark_notification_read(uuid) -> void`; and
- `mark_all_notifications_read(uuid DEFAULT NULL) -> void`.

Those captured pre-S1g bodies trusted caller-supplied employee/notification IDs, and the old
`notifications_select USING (true)` exposed targeted payloads across employees. Migration
`20260726260000_notification_read_recipient_boundary.sql` closed that boundary on 2026-07-28 as
ledger entry `20260728192024_notification_read_recipient_boundary`.

The live replacement preserves all four
signatures, defaults, results, old `{}`/`{p_limit}` broadcast-only calls, list fields, newest-first
ordering, and trusted service-role behavior. Authenticated execution instead reconstructs the
unique active, non-external employee from `auth.uid()` and raises SQLSTATE `42501` for a foreign
non-null employee parameter or foreign targeted notification. Missing/null mark-one IDs retain the
deployed void no-op.

Broadcast reads use forced-RLS, browser-inaccessible `notification_reads` with an explicit
authenticated deny-all policy; targeted rows
retain their existing `read_at`. Already-globally-read legacy broadcasts remain read for every
employee. `notifications_select` stays the same policy object but becomes active-internal
own-or-broadcast authorization, authenticated table access becomes SELECT-only for Realtime, and
the obsolete authenticated sentinel-delete policy object is made inert with `USING (false)`. The
existing client recipient check remains defense in depth.

The unchanged service-role branch retains the exact deployed base-row list/count, mark-one, and
null/non-null mark-all semantics. Rollback refuses exact forward-state drift, preserves identity
containment and recipient-scoped policies, drops receipt history only behind an explicit owner
guard, and disables authenticated bell/Realtime access while retaining gated service-role behavior.
It never restores the historical anonymous notification-table grant.

The exact value-free postcondition passed live. Moroni Salvador's authorized active-internal test
identity passed list/count and direct-RLS visibility without returning notification contents or
changing read state; foreign-selector and unmapped callers both failed with SQLSTATE `42501`.
Anonymous access, authenticated writes, and direct receipt access are denied. Security/performance
advisors reported no S1g regression, and fresh provenance matched the four functions and three
policies. Two-session PostgREST/Realtime sockets plus PWA/Capacitor bell behavior remain the
close-out gate; S1d/S1e/S1f, private media, providers, deployment, signing, and device work remain
separate.

**Historical S1e/S1g apply-order prerequisite:** each target required the separately governed
`20260726180000_mobile_employee_identity_authority.sql` and
`20260726182000_mobile_employee_identity_containment.sql` sequence plus the compatible-client/
old-client decision. Their successful preflights proved there was no duplicate containment ledger
row and that the browser-read-only employee catalog contract matched. S1e and S1g are now live;
neither is an authorization to combine or replay them in a later window.

## Mobile S1h identity and personal ownership source (retired; do not apply)

The browser authentication path is selector-free. `AuthContext` starts from a genuine Supabase
session, resolves the caller through `get_my_employee_profile()`, validates profile/role/feature and
page-access response types, and publishes an internal employee only after the required permission
bootstrap succeeds. The former anonymous employee picker and `devLogin` bypass are removed.
Account transitions suspend old-account work immediately and keep the app in a cleanup/error lock
when local session or device detachment cannot be confirmed.

The old S1h proposal was an ordered four-migration source sequence, not one apply:

1. `20260726180000_mobile_employee_identity_authority.sql` adds selector-free profile and employee
   directory RPCs without revoking the deployed table contract.
2. `20260726182000_mobile_employee_identity_containment.sql` is schema-last. Only after compatible
   PWA/Capacitor/browser code is deployed and old-client risk is resolved does it remove browser
   employee writes, narrow direct identity reads, and gate roster/commission RPCs.
3. `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql` normalizes the
   already-live permission-writer body fingerprint without changing behavior.
4. `20260727022920_mobile_personal_ownership_boundary.sql` would replace the nine existing personal
   RPC bodies while preserving identities, defaults, return types, successful authorized fields,
   ordering, and reviewed service compatibility.

Authenticated personal selectors must map to the one active, non-external employee bound to
`auth.uid()`. The only foreign selector exception is the Page Access read used by an active
internal admin. `employee_page_access`, `notification_prefs`, `push_subscriptions`, and
`device_tokens` become forced-RLS, policy-free, browser-RPC-only tables; direct owner and
`service_role` access remains. Browser Web Push and native registration may refresh an existing
token only for the same employee. A token already owned by another employee is rejected with
`42501`; possession is not transfer authority. Trusted service code retains the reviewed
cross-owner maintenance path.

This revised source removes the rejected artifact's two escalation paths: browser roles cannot
write employee authority fields after containment, and they cannot enumerate or rebind another
employee's raw Web/native token. The rejected filename and reasoning are retained only as dated
evidence under `docs/audit/2026-07/evidence/rejected-sql/`.

`20260727022920_mobile_personal_ownership_boundary.sql` is retired and must never be applied. Its
preflight correctly refused catalog/function drift: newer notification-preference and native-token
lineage supersedes the old bodies, including the live native APNs token boundary and APNs-topic
addition. Applying the stale source would overwrite newer contracts and reopen legacy raw-token
paths. Any remaining Page Access or Web Push ownership work requires a new, later, narrowly scoped
migration that preserves the live notification and native-token contracts; it is not an S1h apply.

The narrower native-token activation boundary is separate from the retired
four-migration S1h proposal. `20260728223000_native_apns_token_boundary.sql` is
live under reconciled ledger row `20260729021021`; direct browser table
privileges are revoked and native registration/deletion use selector-free
self-scoped RPCs. `20260730170000_device_token_apns_topic.sql` is live under reconciled ledger row
`20260731154315_device_token_apns_topic`; it removes
the remaining inert authenticated SELECT policy from `device_tokens`, adds the
per-install APNs topic, and preserves the old two-argument registration call
through one trailing defaulted parameter. No checked-in browser caller reads
the raw token table directly.

## Notification presentation administration

The UI `AdminRoute` and web-only Settings navigation are usability gates, not the authorization
boundary. Every `/api/notification-presentation` action first verifies the Supabase session,
resolves an active employee through shared auth helpers, requires literal `role='admin'`, and
rejects `is_external !== false` before reading catalog overrides/history or accepting preview/save/
reset input. Auth and service database calls use bounded fetches.

The browser cannot query or mutate the presentation tables/RPC. The Worker uses the service role,
and the database writer independently requires the service-role claim plus the supplied actor's
active/internal/admin row before its atomic write. Preview is a pure synthetic render and performs
no configuration write or provider call.

## Payment table authorization

The live QBO receipt foundation removes the inherited anonymous payment policies and the broad
`allow_authenticated_payments FOR ALL` policy before adding `payments.receipt_id`. Replacement
policies are operation-specific: active, non-external internal employees may read payment history;
manual ungrouped payment INSERT/UPDATE/DELETE is limited to active admin employees, matching the
effective `canEditBilling` boundary; and browser inserts must set `recorded_by` to the caller's own employee row.
Provider-originated, Stripe, and grouped receipt rows are not browser-mutable. Receipt linkage is
independently guarded by a service-role-only trigger; the seven receipt RPCs remain callable only
by `service_role`, while direct service access is limited to `SELECT` on receipt/attempt headers
and denied entirely on append-only receipt events. The feature remains disabled, so this is schema
and authorization evidence only, not evidence of a QBO payment or provider action.

## Owner notification delivery diagnostics

`POST /api/notification-test` is a separate fixed-scope diagnostic boundary. It requires
`requireOwner()` before reading an address/subscription or causing any side effect. The
authenticated employee is the only possible recipient; the request accepts only an allowlisted
channel, a client-created UUID, and optionally one of the 15 code-owned presentation event keys.
Title, body, destination, sender, provider, and recipient remain server-owned.

The endpoint can create one owner-targeted bell row or send one owner-only Web Push, native APNs,
or transactional email test. The optional event key is accepted only for bell, Web Push, and
native APNs; email remains generic. The all-type UI therefore creates 15 owner bell rows, 15 Web
Push fanouts, and 15 native APNs occurrences without creating business records or entering an
email/SMS/MMS path. The synthetic diagnostic requires a registered catalog row but does not consume
the real-event `enabled` master switch; it qualifies presentation/transport, not producer
activation. It cannot select another employee or provide arbitrary content.

Before any channel side effect, the Worker claims the owner/channel/request tuple through the
service-only diagnostic ledger and stores the bounded result; a lost HTTP response therefore
replays the prior result instead of sending again. Typed tests derive a separate stable UUID from
the request UUID, channel, and event key so no event can cross-replay another. APNs and the generic
Resend test consume their stable identities at the provider boundary. Provider errors are reduced
to allowlisted diagnostic reasons and never return upstream details.
