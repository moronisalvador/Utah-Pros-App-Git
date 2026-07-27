# UPR Mobile PWA and Capacitor Audit — Authentication, Security, and Privacy

## Security verdict

Authentication is real and centrally managed, but authorization and device-state isolation are not
strong enough for production reliance. Two confirmed database/Storage boundaries are P0. The native
wrapper also keeps bearer sessions in WebView storage behind a UI-only biometric gate whose
exception path can fail open, lacks
app-switcher privacy protection, and does not detach native push tokens on logout.

## Session lifecycle

`AuthContext` listens to Supabase auth changes, restores the session, maps it to an employee, creates
an identity-stable authenticated REST client, and loads permissions, feature flags, and page
overrides. The stable client prevents all `[db]` queries from refetching on every token refresh and
is a sound resume-oriented design.

Logout signs out of Supabase and clears React auth/permission state
(`src/contexts/AuthContext.jsx:272-283`). It does **not** clear or re-key:

- the 24-hour IndexedDB TanStack cache;
- the global offline queue/blob stores;
- all local drafts, route-restoration values, and device preferences;
- the registered native APNs token.

Several query keys omit employee identity (`src/lib/techQuery.js:69-83`), while persistence uses one
device-global database/key (`src/lib/techQueryPersister.js:35-46,83-87`). Raw SMS thread bodies are
intentionally excluded from dehydration (`src/lib/techQuery.js:150-158`), which is a meaningful
privacy strength, but job/customer/schedule/inbox metadata can still cross an account boundary.
`MOB-STATE-001` and `MOB-DATA-002` cover these risks.

## Permission and feature loading

React evaluates role permissions, employee overrides, and feature flags. Permission loading fails
closed when no permissions exist (`AuthContext.jsx:318-338`), but the generic feature helper treats a
missing row as enabled (`:340-360`). A feature-flag load error deliberately stores an empty map
(`:157-184`), so incomplete preview capabilities can become enabled (`MOB-ROLLOUT-005`).

Dashboard and Schedule have no legacy route elements after the v2 cutover
(`src/App.jsx:260-270`). If their persistent v2 panes are disabled, the route can render no usable
screen (`MOB-ROLLOUT-004`). These are rollout/reliability defects; feature flags are not an
authorization layer.

## Authorization enforcement

### Confirmed P0: internal authenticated access is broader than the UI

Repository policy history states the prior convention explicitly: most authenticated staff access
was governed by frontend route guards rather than RLS
(`supabase/migrations/20260701_crm_partner_rls_non_crm_tables.sql:4-12`). The `jobs` policy permits
all operations for every authenticated non-CRM-partner (`:26-31`), while mobile performs a direct
job soft delete after a client-side role-gated menu
(`src/pages/tech/v2/hub/AdminJobMenu.jsx:36-55`).

The impact is not limited to that route. A valid internal bearer token can call PostgREST outside
React, so hidden administrative, financial, customer, or unassigned data/actions need database or
trusted-worker enforcement. `MOB-SEC-014` is P0 because unauthorized access or destructive mutation
is an active boundary risk.

The trusted-worker side independently confirms the pattern. Four QBO workers label Bearer access
“admin” but accept any token that Supabase Auth recognizes, without resolving an employee/role
(`functions/api/qbo-invoice.js:35-45`; `qbo-estimate.js:19-29`;
`qbo-payment.js:16-26`; `qbo-query.js:15-26`). Their service-role/provider paths accept
caller-selected transaction IDs/actions and can create/update/delete/email financial records or
query QBO. `/api/notify` also accepts any valid bearer
(`functions/api/notify.js:400-424`), honors explicit recipient IDs (`:97-106`), and dispatches
caller-controlled bell/Web Push/email content (`:152-222,428-440`). Its push link reaches
`client.navigate`/`openWindow` without a route allowlist (`public/sw.js:59-76`).
The admin-mobile CallRail proxy likewise accepts any resolved employee, then uses the service role
to read a caller-selected lead and stream its recording without an admin/lead-center permission
check (`functions/api/callrail-recording.js:48-70,84-101`).

These are repository-confirmed server authorization bypasses. Current production deployment and
enabled-notification-type reachability were not probed, so runtime exposure is explicitly
unverified; the source boundary still justifies P0 containment before mobile-admin expansion.

### Confirmed P0: public/listable job media

The dated live catalog capture records `job-files` as public, with broad anonymous listing policies,
bucket-wide authenticated insert/delete, no MIME allowlist, 72 objects, and 57,472,887 aggregate
bytes (`docs/audit/2026-07/evidence/live-supabase.md:141-152`). Mobile creates/uses public object
URLs. The workflow is designed to store claim/job photos, signed PDFs, and feedback media; the
sensitivity of the 72 current objects is unverified because paths and contents were intentionally
not opened. `MOB-SEC-015` is P0 as a confidential-by-design media boundary requiring immediate
containment, not as evidence that a breach was observed.

## Client storage and sensitive data

| Store | Examples | Ownership/cleanup status | Risk |
|---|---|---|---|
| Supabase auth storage | access/refresh session | persisted by Supabase JS; cleared on successful sign-out | WebView bearer token not hardware-backed |
| `upr-query-cache` IndexedDB | dashboard, schedule, job, inbox metadata | device-global; 24-hour GC; thread bodies excluded | cross-account residual data |
| `upr-offline` IndexedDB | queued mutations and blobs | no row owner; not purged on logout | later user can submit prior user's work |
| localStorage drafts | demo/scope sheet, composer, filters, route state | inconsistent account namespacing/expiry | residual business data and stale resume |
| push token table | APNs device token to employee | upsert on login; no logout delete caller | token remains targetable after logout/reassignment if native dispatch occurs |

Storage encryption at rest by the OS/browser is not an authorization model. Canonical policy must
define allowed fields, account namespace, retention, logout/account-switch action, quota/eviction
behavior, and whether a store is permitted in PWA versus native.

## Capacitor/WebView security

The native build loads bundled assets and has no remote `server.url`, reducing remote-content and
mixed-version risk. Session storage is still the default persisted Supabase WebView storage
(`src/lib/realtime.js:16-27`).

`nativeBiometric.js` explicitly implements an unlock preference over that existing localStorage
session and exposes a no-op privacy-screen function
(`src/lib/nativeBiometric.js:1-5,24-31,70`). `BiometricGate` opens when biometrics are unavailable or
disabled and opens on exceptions; if sign-out after a failed verification throws, the outer catch
also opens the app (`src/App.jsx:537-563`). This is not a cryptographic credential gate
(`MOB-SEC-016`).

`App` calls the privacy function while documenting that it is an intentional stub
(`src/App.jsx:624-639`). Claim, customer, message, and admin data can therefore appear in the app
switcher (`MOB-PRIV-009`).

No evidence was produced for native secure-storage key migration, jailbreak/root policy, WebView
debug setting in a distribution archive, CSP behavior inside the signed app, or an on-device
credential extraction test. Those remain release gates, not asserted defects.

## Messaging and notification privacy

The in-app message composer uses the governed messaging worker, but multiple field surfaces link
directly to `sms:` (`src/components/tech/ActionBar.jsx:31,91`;
`src/pages/tech/TechAppointment.jsx:712`; `src/pages/tech/v2/hub/HubDock.jsx:206`). Those sends occur
outside UPR's consent/DND/STOP checks, audit trail, templates, and company-number identity
(`MOB-COMP-003`).

Native push registration upserts an employee/device token
(`src/lib/pushNotifications.js:54-60`). Logout has no delete/unregister step, and no application
caller of `delete_device_token` was found (`MOB-PUSH-017`). Push payload content, lock-screen
redaction, foreground display, tap authorization, environment selection, and lost/shared-device
handling need a privacy threat model before native rollout.

## Public signing boundary

Public signing is intentionally reachable without an authenticated employee. Dated evidence found
token lookup functions that retrieve signer/job fields without enforcing request status or expiry
inside the database; browser/worker paths check expiry afterward
(`docs/audit/2026-07/evidence/live-supabase.md:131-139`). That is a shared security concern and must
remain in the security backlog, but it is not elevated as a separate mobile-only finding here
because this audit did not establish exploitability beyond possession of the high-entropy token.

## Security findings

| ID | Severity | Boundary |
|---|---:|---|
| MOB-SEC-014 | P0 | UI role gates are not reconstructed by broad RLS or service-role worker authorization |
| MOB-SEC-015 | P0 | public/listable job media and bucket-wide authenticated object operations |
| MOB-STATE-001 | P1 | persisted query/draft/route state can survive account change |
| MOB-DATA-002 | P1 | offline work is not owned by an account |
| MOB-COMP-003 | P1 | native SMS shortcuts bypass company messaging controls |
| MOB-SEC-016 | P1 | WebView bearer session plus UI gate whose exception path can fail open |
| MOB-PRIV-009 | P1 | app-switcher privacy protection is a no-op |
| MOB-PUSH-017 | P1 | native token is not detached during logout/account change |

## Required security gate

1. Contain the public media boundary without breaking deployed URL consumers; verify object
   confidentiality and least-privilege upload/delete with negative tests.
2. Replace broad internal authenticated policies for high-impact/mobile objects with documented
   role/assignment/organization rules; review every `SECURITY DEFINER` caller.
3. Make all persisted state account-scoped and define logout/account-switch cleanup or quarantine.
4. Give queued mutations an immutable owner and reject cross-owner dispatch.
5. Remove or govern company-message `sms:` escape paths.
6. Use an approved native credential-protection model, fail closed where policy requires it, and
   implement app-switcher privacy.
7. Attach/detach push subscriptions transactionally with session/device lifecycle.
8. Verify revoked/disabled user behavior, expired sessions, background refresh, shared/lost device,
   offline logout, and authenticated deep links on real devices.

## Security conclusion

UPR's central auth plumbing and exclusion of raw thread bodies from persistent query storage are
good foundations. They do not compensate for database/Storage authorization that is broader than
the UI and for device data that lacks account ownership. Daily primary-interface use is not safe
until the P0 boundaries and P1 session/device lifecycle defects are closed and independently
verified.
