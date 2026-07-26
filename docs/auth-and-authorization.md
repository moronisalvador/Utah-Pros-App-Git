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

## Worker authorization

Use `functions/lib/auth.js`:

- `requireUser` proves a valid Supabase user token.
- `requireEmployee` proves the user maps to an employee.
- `requireRole` proves the employee has an allowed role.
- scheduler/webhook secrets and provider signatures authenticate non-human callers.

Money, payroll, PII, campaigns, company messaging, credentials and administrative actions require
the same or stronger role boundary server-side as the UI. Perform authorization before provider
calls or service-role reads/writes. Record the actor for sensitive state changes.

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

`/api/callrail-connect` is separately admin-only and rejects inactive or external employees before
credential or webhook-secret access. These repository changes are not proof of deployed
protection. Tests cover missing authentication, denied roles, inactive/external employees, forged
actors, and allowed callers; deployed role behavior remains a release verification gate.

Inbound notification audience resolution is also fail-closed. Explicit recipient IDs, assigned
employees, appointment crews, and role-based fallback audiences are all intersected with the
current active, non-external employee directory before bell, push, or email fan-out. An inactive,
external, deleted, or unknown employee ID is not trusted merely because it arrived in an internal
event payload or still has a historical push subscription.

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
outside the HTTP Worker and remains in the later notification/RPC containment inventory.

## Mobile S1d notification dispatcher RPC boundary (2026-07-26)

A fresh read-only catalog capture confirmed one live
`public.notify_emit(p_type_key text,p_body jsonb) RETURNS void` function owned by `postgres`, with
`SECURITY DEFINER`, `search_path=public`, and direct EXECUTE grants to `authenticated` and
`service_role` while `PUBLIC`/`anon` are denied. No browser or Pages Worker source caller was found.
The exact database graph is six owner-run definer functions/seven calls: appointment assignment,
appointment update/cancel, estimate acceptance, timesheet request/review, and the abandoned-clock
scan reached by its `postgres` cron job.

The reviewed but unapplied `20260726110000_notify_emit_service_boundary.sql` revokes
`PUBLIC`, `anon`, and `authenticated` after the body replacement and grants only `service_role`.
Owner-executed trigger/RPC/cron chains remain compatible through PostgreSQL ownership; adding an
in-body session-role assertion would break those intended database callers and is forbidden for
this contract. The body replacement changes only JSON object merge order, making the trusted
`p_type_key` authoritative while retaining URL/secret lookup, headers, `net.http_post`, ignored
response, no-op gates, signature, result, security mode, and search path.

This is local apply readiness, not live containment: until the shared migration is applied in a
separate owner-authorized window, `authenticated` can still execute the deployed function.
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

Raw provider URLs move to forced-RLS, service-only `inbound_lead_recording_sources`. Browser and
legacy composite RPC responses see only a truthy opaque marker. The approved CallRail proxy keeps
the narrower admin/`crm_call_log` boundary and is the only interactive audio-delivery path.
