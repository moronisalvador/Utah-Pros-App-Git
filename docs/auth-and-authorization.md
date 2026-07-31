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
- DevTools may switch the calculator flag from owner preview to availability for all eligible roles
  (never all staff), while a missing flag or `force_disabled` remains the fail-closed client and
  server kill switch. Neither state grants database access.

The supporting migration is repository source only until a separately authorized apply and direct
role verification prove the live boundary.

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

The current product is single-organization and treats conversations as company-wide for internal
employees who have that capability; there is no narrower conversation assignment/ownership model
to enforce today. The proposed `messages` RLS predicate mirrors the same capability and excludes
anonymous users, nonemployees, inactive employees, external employees, force-disabled access, and
denied overrides/roles. A future tenant or assignment scope must tighten both Worker and RLS
together.

The compatible participant foundation is now present only on isolated `qa-staging` (ledger
`20260731143710`), not production. It defines one staff decision shared by the staged inbox,
message-author lookup, admin membership controls, technician self-leave, and service-only
recipient/search/create helpers: privileged internal roles always pass; `crm_partner` does not;
then explicit per-chat choice wins over default field technician and historical appointment crew.
The admin/self mutation RPCs derive the actor from `auth.uid()` and the membership tables deny
direct browser reads/writes.

This staging schema does not make the product participant-scoped in production. The later policy
enforcement remains blocked until authenticated conversation UPDATE/DELETE authority is narrowed
and the trusted Worker notification path is integrated and independently reviewed. Compatible
Worker/UI deployment and a separate owner-authorized production apply remain mandatory.

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

`POST /api/message-media-upload` uses the same server-side conversations capability before any
service-role Storage access. Upload also binds a valid conversation, verifies the final image
bytes, and creates a random private object path. There is intentionally no browser delete route:
cleanup needs a durable draft-to-message claim before it can safely distinguish an orphan from
sent/failed/ambiguous history. `POST /api/message-media-url` signs only the media reference
already bound to an authorized canonical message row and never accepts a caller-supplied bucket or
path.

The CallRail recovery worker claims provider events only through
`claim_callrail_provider_event`. The RPC is `SECURITY INVOKER` with an empty search path, rejects
any JWT role other than `service_role`, and revokes execution from `PUBLIC`, `anon`, and
`authenticated`. Its exact event/state/time predicate and `UPDATE ... RETURNING` result are the
worker's claim authority; browser sessions cannot claim or replay provider events. It is live
under migration-ledger version `20260724051500`; read-only catalog verification confirmed the
reviewed body fingerprint and the same service-only invoker boundary.

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
the messaging send surface before any service-role read or write. Contact search is length- and
grammar-bounded, returns only `id`, `name`, `phone`, and `company`, and caps results at 25.
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
provider access. The preserved exact `x-webhook-secret` remains a server capability. Browser
Bearer access requires a valid session resolving to an active, non-external employee with
`role='admin'`. Missing sessions return the deployed `401 {"error":"Unauthorized"}` contract;
known employees outside that boundary return 403; auth/configuration failures fail closed.

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
The non-admin Worker capability does not mirror the desktop rollout/kill flags, and the direct
authenticated `get_inbound_leads`/`inbound_leads` paths still expose or can mutate the stored
recording URL outside this proxy. Those are separate operational/database residuals; S1c is not
end-to-end recording confidentiality.

HTTP `/api/notify` retains two distinct identities:

- an exact stored `x-webhook-secret`, checked first with no Bearer fallback on mismatch, preserves
  the deployed database-trigger payload and response contract; and
- a Supabase Bearer must resolve to an active, non-external `admin`, then may request only
  `appointment.assigned`, `appointment.updated`, `appointment.canceled`, or `estimate.accepted`.
  The Worker verifies the appointment/crew/estimate state and passes only object IDs to
  `dispatchEvent`; caller-supplied recipients, title/body/HTML, payload/data, entity/job fields and
  links are rejected.

There is no checked-in mobile/desktop/browser HTTP Bearer caller. Trusted Workers continue to
import `dispatchEvent` in-process, and the secret-authenticated database trigger path is unchanged.
This HTTP-only slice is not complete notification containment: `notify_emit(text,jsonb)` is a
`SECURITY DEFINER` RPC still executable by `authenticated` in the dated generated/live inventory,
so an authenticated browser can cause the database to present the valid secret and arbitrary
payload to the Worker. Its ACL/body containment requires a separate reviewed migration and live
apply. S1c neither authors nor applies that migration.
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
`create_notification`, direct recording-source access, wider mobile RPC/direct-policy boundaries,
and private media remain separate. Exact migration, rollback, catalog-only role/caller checks and
evidence are recorded in
`docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md`.

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

## Mobile S1e recording-source authority (authored, not applied)

`get_inbound_leads` will require an active, non-external employee and either `admin` or the existing
`crm_call_log` employee/role capability. Its only browser callers remain the mobile Admin Lead
Center and desktop Call Log. Direct `inbound_leads` SELECT remains company-wide for active internal
employees because the current model has no employee organization membership or lead assignment;
`crm_tasks.assignee_id` is task ownership, not lead visibility. Authenticated direct DML is removed.

Raw provider URLs move to forced-RLS, service-only `inbound_lead_recording_sources`; nested
recording-source keys are removed from `raw_payload` on backfill and future writes. Browser and
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

**S1e/S1g apply-order prerequisite:** before either target’s own entry gate, separately apply and
verify `20260726180000_mobile_employee_identity_authority.sql`, deploy compatible
browser/PWA/native clients and retire old clients or record the owner’s explicit risk decision,
then separately apply and verify `20260726182000_mobile_employee_identity_containment.sql`. Current
S1e and S1g preflights fail closed unless exactly one live `mobile_employee_identity_containment`
ledger row exists and its browser-read-only employee contract still matches. Recapture that
catalog/ledger state before the target preflight. This prerequisite neither authorizes nor combines
S1e or S1g; each remains its own owner-approved window.

## Mobile S1h identity and personal ownership source (authored, not applied)

The browser authentication path is selector-free. `AuthContext` starts from a genuine Supabase
session, resolves the caller through `get_my_employee_profile()`, validates profile/role/feature and
page-access response types, and publishes an internal employee only after the required permission
bootstrap succeeds. The former anonymous employee picker and `devLogin` bypass are removed.
Account transitions suspend old-account work immediately and keep the app in a cleanup/error lock
when local session or device detachment cannot be confirmed.

S1h is an ordered four-migration source sequence, not one apply:

1. `20260726180000_mobile_employee_identity_authority.sql` adds selector-free profile and employee
   directory RPCs without revoking the deployed table contract.
2. `20260726182000_mobile_employee_identity_containment.sql` is schema-last. Only after compatible
   PWA/Capacitor/browser code is deployed and old-client risk is resolved does it remove browser
   employee writes, narrow direct identity reads, and gate roster/commission RPCs.
3. `20260727020000_upsert_employee_page_access_provenance_reconciliation.sql` normalizes the
   already-live permission-writer body fingerprint without changing behavior.
4. `20260727022920_mobile_personal_ownership_boundary.sql` replaces the nine existing personal
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

None of the four migrations is applied. Credential-free source tests and negative auth/account
transition tests pass, but the exact checked-in forward/preflight/post-apply/isolated/rollback chain
has not run in a retained governed local database, and live GoTrue/PostgREST/RLS behavior is
unproved. Therefore S1h is not database-behavior-verified or `ready_for_apply`. Use
`docs/mobile/s1h-database-apply-runbook.md`; every apply, compatible deployment, synthetic identity
test, rollback, provider action, signing step, and device qualification remains a separate
owner-authorized gate.

The narrower native-token activation boundary is separate from that deferred
four-migration S1h sequence. `20260728223000_native_apns_token_boundary.sql` is
live under reconciled ledger row `20260729021021`; direct browser table
privileges are revoked and native registration/deletion use selector-free
self-scoped RPCs. Pending `20260730170000_device_token_apns_topic.sql` removes
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
