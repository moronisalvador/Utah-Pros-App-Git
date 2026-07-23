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

### Verified live posture (2026-07-22; DB-003 contained 2026-07-23)

The live database has RLS on all 130 public tables, but RLS-enabled does not mean least-privilege:

- anonymous always-true policies still permit broad reads and mutations on deferred operational,
  customer, messaging and CRM tables;
- authenticated always-true policies grant company-wide access to many tables;
- 345 of 366 public functions are `SECURITY DEFINER`, and 342 privileged overloads are executable
  by `authenticated`;
- the dated snapshot found `exec_read_sql(text)` executable by authenticated callers; migration
  `20260723205127_exec_read_sql_containment.sql` was applied and verified on 2026-07-23, and now
  denies `PUBLIC`, `anon`, and `authenticated` while preserving only `service_role`;
- public form and signing RPCs rely on cooperative Worker/UI checks for some abuse, consent and
  expiration rules.

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

## Messaging transport authorization (built; not deployed)

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
