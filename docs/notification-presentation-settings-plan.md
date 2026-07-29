<!--
FILE: docs/notification-presentation-settings-plan.md

WHAT THIS DOES (plain language):
  Defines the safe design for an admin-only desktop Settings page that changes how internal
  employee notifications look and where supported notification taps go. It records the evidence,
  threats, boundaries, tests, rollout order, and dependency on the mobile notification-parity work
  before any shared notification code or database schema is changed.

DEPENDS ON:
  Internal: AGENTS.md, docs/notify-roadmap.md, docs/mobile-production-readiness-roadmap.md,
            functions/api/notify.js, functions/lib/apns.js,
            src/lib/nativeNavigationTarget.js, src/pages/settings/
  Data:     reads → notification presentation catalog/overrides/audit
            writes → audited presentation overrides through the service-only RPC

NOTES / GOTCHAS:
  - Repository, staging, deployed Worker, production database, provider, and device evidence remain
    separate; the status below names which layers are actually verified.
  - The feature extends the reconciled notification-parity registry and does not create a competing
    send path or route registry.
-->

# Notification Presentation Settings — Safe Design and Implementation Plan

**Status:** implemented and adversarially reviewed; isolated `qa-staging` migration/authorization/
concurrency behavior verified; production release pending

**Artifact tier:** Tier 1 (one sequenced implementation plan)

**Last verified:** 2026-07-29

**Authorization:** on 2026-07-29 the owner authorized repository, database, deployment, and release
actions needed to make this page live. No preview/test/real notification or provider call is needed
for this release and none is part of its validation.

## Decision

Build a desktop-only, active-internal-admin Settings page backed by an active-internal-admin Worker
and a service-only, audited persistence boundary.

The page is not a general template engine and not a URL editor. It may select only:

- an event from the code-owned event catalog;
- a surface supported by that event (`bell`, `pwa_push`, `native_push`, and, only if the landed
  registry supports it safely, plain-text employee `email`);
- copy containing literal text plus exact `{{variable_name}}` tokens from that event's allowlist;
- a route identifier from that event/surface's allowlist.

Routes are code, not data. The database stores a route identifier only. Route parameters are derived
at dispatch time from server-owned normalized event context, never from a saved path, query string,
URL, template, or caller-supplied parameter map.

The parent mobile notification-parity task owns the shared typed presentation/routing registry. This
feature adds an override/control plane after that contract lands; it does not replace or fork it.

## Planning contract and authorization

Requested outcome:

- an admin can edit per-event internal notification copy and supported destinations from desktop
  Settings;
- variables such as customer name and amount are available only for events where the server can
  derive them safely;
- preview and validation happen without sending a notification;
- PWA and native copy/routes remain compatible while preserving the field-only native product
  boundary and privacy-safe lock-screen behavior;
- every accepted change is attributable and recoverable.

Release scope does not include changing notification defaults/preferences, provider settings, Apple
credentials, feature flags, or any saved presentation configuration. It also does not send a
preview/test/real notification or widen native routes beyond the approved field-only set.

## Current evidence ledger

| Claim | Verdict | Evidence | Consequence / next proof |
|---|---|---|---|
| A typed notification event catalog exists | HAVE | `notification_types`; seed migrations; `functions/api/notify.js` | Reuse its exact `type_key` identities; do not create caller-defined event keys. |
| Fifteen current event types are in the active product map | HAVE | current migrations plus the parent task's 2026-07-29 read-only catalog query | Reconcile the landed registry against all 15 before implementation closes. |
| Effective recipient/channel preferences have one shared resolver | HAVE | `get_effective_notification_prefs`; `functions/api/notify.js` | Presentation overrides must not change audience or channel eligibility. |
| Browser notification content is currently assembled by producers and `notify.js` | HAVE | producer call sites and `enrich*Body()` helpers | A normalized event context is required before configurable rendering. |
| Native delivery currently replaces caller copy with generic privacy-safe copy | HAVE | `functions/lib/apns.js` | Rich native copy must remain an explicit per-event privacy decision. |
| Native push routes are sanitized against field/public routes | HAVE | `src/lib/nativeNavigationTarget.js` | The new route registry must call the same sanitizer and may not add admin routes to native. |
| Bell and PWA/native routes already differ for some events | HAVE | message and appointment enrichment in `notify.js` | Route selection is surface-specific; one free-form destination field is invalid. |
| UI `AdminRoute` exists for Settings admin pages | HAVE | `src/App.jsx` | It is presentation only; a new Worker and database mutation boundary must repeat the admin gate. |
| Existing notification defaults page changes channels/locks | HAVE | `NotificationDefaultsTab.jsx` | Presentation belongs on a separate page and must not alter preference precedence. |
| A reviewed native presentation registry exists | HAVE | reconciled local commit `9febb9d` (equivalent parent source commit `ff77044`); `functions/lib/notificationPresentation.js`; parent handoff `docs/handoff/native-notification-parity-2026-07-29.md` | Extend this exact registry; retain APNs provider-boundary enforcement. |
| Audited presentation override storage exists | HAVE (source + staging) | migration/rollback `20260729163127_notification_presentation_settings`; isolated `qa-staging` apply and behavior proof on 2026-07-29 | Production remains a separate release step until recorded below/canonical docs. |
| Deployed Worker/database/provider/device behavior for this feature is proven | PARTIAL | local Worker/UI/build tests and isolated staging database behavior are green | Deployment and production catalog verification remain separate; no provider/device send is necessary. |
| Exact parent native registry contract is known | HAVE | `functions/lib/notificationPresentation.js` exports `NATIVE_NOTIFICATION_TYPE_KEYS` and `buildNativeNotificationPresentation(typeKey, body)`; `functions/lib/apns.js` exports the single- and cross-environment senders | Extend these exports after the commit SHA lands; do not create a second native registry or bypass APNs enforcement. |
| Typed PWA/bell presentation context exists | HAVE | shared configurable catalog and runtime resolver in `functions/lib/notificationPresentation.js`; consumption in `functions/api/notify.js` | Email remains separately governed and unchanged. |

### Reviewed parent contract

The 2026-07-29 parent handoff passed Worker security, mobile security, UPR pattern, design,
page-lifecycle, and mobile-contract review after fixing raw APNs copy, unbounded provider fetch,
cross-environment partial failure, feedback-sender authorization, and duplicated catalog evidence.
Its frozen constraints for this task are:

- APNs selects typed presentation inside the provider boundary and ignores arbitrary caller
  `alert`, `data`, title, body, and route values.
- The native privacy budget excludes names, message contents, phone numbers, addresses,
  identifiers, financial amounts, appointment times, and free-form notes.
- Office-only native destinations remain `/`; the native product remains field-only.
- Browser/PWA/bell/email presentation is separate and must be introduced as an additive
  server-validated surface contract.
- Event audience, effective preferences, delivery identity, deduplication, and existing
  authorization predicates remain unchanged.

The parent handoff was committed under the fresh owner authorization and reconciled into this
worktree before shared runtime edits began. The implementation extends that source rather than
forking it.

## Event and presentation contract

The landed code-owned registry is the authority. At minimum, every event definition must expose
equivalent information to:

```text
typeKey
contractVersion
surfaces
  surfaceKey
  codeDefaultTitleTemplate
  codeDefaultBodyTemplate
  allowedVariableKeys
  allowedRouteIds
  codeDefaultRouteId
  privacyClass
variables
  key
  label
  sampleValue
  maxRenderedLength
  sensitivity
routes
  routeId
  requiredContextKeys
  resolveForSurface(normalizedContext)
normalizeTrustedContext(...)
```

The registry must remain dependency-free where the Worker imports it. UI-friendly labels and sample
values may be serialized from the same definitions or projected by the admin Worker; they must not
be copied into a second browser-only catalog.

### Surfaces

- `bell`: in-app office/field bell content and shell-aware destination.
- `pwa_push`: installed web/PWA push content and allowlisted web/field route.
- `native_push`: APNs lock-screen content and a route accepted by
  `resolveNativePushRoute()`.
- `email`: optional only if the landed registry explicitly supports escaped plain text and a
  code-owned HTML wrapper. User-authored HTML, Markdown links, scripts, and raw URLs are forbidden.

Audience, channel enablement, and delivery identity are not presentation settings.

### Template grammar

Accepted grammar:

```text
literal text {{one_allowlisted_variable}} more literal text
```

Rejected:

- unmatched, nested, triple, or escaped braces;
- property traversal (`{{customer.name}}`);
- functions, filters, conditionals, loops, includes, partials, expressions, or JavaScript;
- HTML/Markdown interpretation;
- URL interpolation;
- control characters or surface-forbidden newlines;
- tokens not present in the selected event/surface allowlist;
- templates or rendered results over the surface byte/character budget.

Rendering is a deterministic token substitution over normalized scalar strings. It never uses
`eval`, `Function`, a general-purpose template package, dynamic imports, or recursive rendering.

If an override is absent, disabled, stale, malformed, over budget, references a missing runtime
value, or cannot resolve its selected route parameters, runtime uses the code-owned default for that
surface. It never emits a partly rendered token, blank alert, or caller-provided fallback.

### Variables

Variables are event-specific, surface-specific where privacy requires it, and derived from trusted
server data. The following inventory applies to richer browser surfaces only unless a later
owner-approved native privacy-contract change says otherwise. Under the reviewed parent contract,
`native_push` exposes no customer/contact name, message content, phone, address, identifier, money,
appointment-time, or free-form-note variable:

| Event | Candidate allowlisted variables | Candidate route identifiers |
|---|---|---|
| `message.inbound` | sender display name; privacy-bounded message preview on approved web surfaces only | `conversation.thread`, `field.home` |
| `appointment.assigned` | appointment title, date, start/end time | `appointment.detail` |
| `appointment.updated` | appointment title, date, start/end time | `appointment.detail` |
| `appointment.canceled` | appointment title, date, start/end time | `appointment.detail` |
| `estimate.accepted` | estimate number, approved amount, customer name | `estimate.detail`, `office.home` |
| `payment.received` | amount, payment source, reference, invoice identity when proven | `invoice.detail`, `collections.home`, `office.home` |
| `lead.new` | lead source, caller/customer label, form name when normalized | `crm.lead`, `office.home` |
| `esign.signed` | signer name, document label, job number, property label | `job.detail`, `office.home` |
| `feedback.submitted` | feedback kind, submitter display name | `settings.feedback`, `office.home` |
| `timesheet.change_requested` | employee display name | `time_tracking.home`, `field.home` |
| `timesheet.change_reviewed` | review outcome; privacy-bounded review note only where approved | `time_tracking.home`, `field.home` |
| `clock.abandoned` | employee display name, elapsed duration | `time_tracking.home`, `field.home` |
| `meld.received` | emergency state, meld type, meld number, property label | `melds.home`, `office.home` |
| `feedback.resolved` | feedback kind, resolution outcome | `field.feedback`, `field.home` |
| `ops.health` | condition label and privacy-safe summary/count | `owner.dev_tools`, `office.home` |

Never expose a generic `payload`, `body`, `html`, raw webhook field, raw provider response, phone,
email, address, token, credential, signed URL, recording URL, or arbitrary form answer as a
template variable.

Money variables are display-only. Their source remains the existing server/database record and
their formatting is fixed by the registry; editing notification copy must not perform or influence
money movement.

### Route identifiers

Each route identifier is an enum-like registry key, not a pathname. Its resolver:

1. receives only the event's normalized trusted context;
2. requires exact context keys and validates identifier grammar;
3. selects the destination for the requested surface/shell;
4. returns a short relative route;
5. passes native routes through `resolveNativePushRoute()` and web-push routes through the existing
   service-worker target policy;
6. falls back to the code-owned event/surface default on any failure.

The database and browser never store or submit route parameters. The UI only selects from route IDs
already allowed for the selected event/surface.

Admin-only desktop routes such as CRM, billing, Melds, feedback administration, and Dev Tools are
never added to the native allowlist. A native surface may use a field-supported job,
appointment/conversation/feedback route or a privacy-safe field home fallback only. Expanding the
native product route set is a separate owner decision.

## Threat model and controls

| Threat | Required control |
|---|---|
| Arbitrary URL, open redirect, custom scheme, credential fragment, encoded traversal | Store route IDs only; server resolves; current native/web sanitizers run after resolution; absolute URLs and free-form paths are rejected. |
| Template code execution or resource exhaustion | Tiny non-recursive token grammar; no general template engine; strict byte/token limits; deterministic linear parser/renderer. |
| Secret or PII exposure in editor/preview/history | Catalog exposes names and synthetic examples only; runtime values are never returned to Settings; no generic payload variables; audit stores templates/route IDs, not rendered customer data. |
| Lock-screen privacy regression | `native_push` has separate defaults/allowlists; registry privacy class may prohibit sensitive variables even when PWA/bell allow them. |
| Privilege escalation through UI-only gate | Worker uses shared auth helpers and requires active, internal `admin` before any protected configuration read/write; constructing the server client is not authorization. The database mutation RPC revalidates the actor and is service-role-only. |
| Direct browser table/RPC mutation | New tables have forced RLS, no browser policy/grant; mutation RPC denies `PUBLIC`, `anon`, and `authenticated`. |
| Service-role writer skips audit | Browser Worker receives no direct table mutation path; one atomic database function writes current state and append-only history together. |
| Lost update between two admin tabs | Optimistic revision/expected-version check; stale save returns conflict and forces reload. |
| Replay/duplicate save | Client-supplied UUID request ID with a uniqueness constraint; repeated identical request returns the recorded revision without duplicating audit. |
| Registry/config drift after deployment order changes | Persist contract version; runtime validates against the current definition and falls back to code defaults on mismatch. |
| Config breaks one channel and blocks others | Render/route failure is isolated per recipient/surface; code fallback is used; dispatch summary records only allowlisted reason categories. |
| Preview accidentally sends | Preview endpoint is a pure renderer over synthetic sample values; it imports no provider sender and writes nothing. |
| HTML/script injection in UI or email | React text rendering; no `dangerouslySetInnerHTML`; email, if supported, uses escaped plain text in a code-owned wrapper. |
| Admin changes audience, consent, channel defaults, recipients, or delivery ID | Those fields do not exist in the presentation mutation contract. |
| Event producer injects a fake event/context | Existing trusted trigger/Worker boundary remains; renderer accepts normalized context from the code registry, not raw caller copy. |

## Server and database boundary

### Worker

Implemented route: `GET/POST /api/notification-presentation`.

All actions first:

1. construct the shared server client required by `functions/lib/auth.js`, without reading feature
   configuration;
2. validate the Supabase Bearer session;
3. resolve an active employee;
4. require literal `role='admin'`;
5. reject `is_external !== false`;
6. only then read or mutate feature configuration through the server client.

Actions:

- `GET catalog`: code-owned definitions plus current overrides/revisions; no real rendered data.
- `GET history?type_key=&surface=`: bounded newest-first audit projection.
- `POST preview`: validate and render with registry-owned synthetic examples; no write and no send.
- `POST save`: validate, call the atomic mutation RPC, and return the new revision.
- `POST reset`: two-click UI action; atomic mutation removes the override and audits the reset so
  the code default becomes effective.

Unknown actions, keys, surfaces, route IDs, variables, body fields, or oversized payloads fail
closed. Responses use `Cache-Control: no-store` and return sanitized errors.

### Repository-authored migration

Implemented additive objects:

`notification_presentation_overrides`

- `(type_key, surface)` unique key;
- title/body template text;
- route ID text;
- registry contract version;
- revision;
- updated actor/time;
- forced RLS and zero browser policies/grants.

`notification_presentation_audit`

- append-only UUID identity;
- type key, surface, revision, action;
- before/after configuration JSON containing templates/route ID/version only;
- actor employee ID;
- idempotency request ID unique;
- timestamp;
- forced RLS and zero browser policies/grants.

One service-role-only, owner-run database mutation function:

- pins `search_path`;
- explicitly revokes `PUBLIC`, `anon`, and `authenticated` before granting `service_role`;
- rechecks active, internal, literal-admin actor;
- checks expected revision and request ID;
- inserts/updates/resets the override and inserts audit in one transaction;
- returns the new revision and effective stored configuration;
- cannot change event types, audiences, channel defaults, preferences, recipients, routes outside
  the supplied identifier field, or notification rows.

The database can enforce size, enum surface, references, revision, and audit integrity. The Worker
and code registry enforce the event-specific variable and route allowlists; the runtime repeats
validation and falls back safely because database constraints cannot prove a changing code catalog.

Rollback removes the new service-only function/tables only after confirming no operator needs the
audit history. Application rollback is safer and should happen first: stop reading overrides while
leaving the additive data intact. Dropping audit history is owner-gated and not routine rollback.

## Desktop Settings experience

Implemented route: `/settings/notification-presentation`.

- lazy-loaded in the web build only;
- wrapped in `AdminRoute`;
- visible in the Settings Team group only to admins;
- never added to native build routes;
- calls only the admin Worker with the current session; it never queries the new tables/RPC
  directly.

Page states:

- cold load: shared route-level loading primitive;
- load failure: `ErrorState` with retry, never an empty editor;
- no catalog: explicit safe unavailable state;
- save/preview failure: retain edits and use `src/lib/toast.js`;
- revision conflict: retain draft, show that another admin saved, and require reload/reconcile;
- resume/minimize: no automatic reset/refetch and no loss of drafts;
- reset to default: inline two-click confirmation;
- unsaved navigation: established in-app guard, no browser `confirm()`.

Editor controls:

- event selector/list from the server catalog;
- surface tabs;
- title and body plain-text fields;
- clickable allowlisted variable chips that insert exact tokens;
- route dropdown showing friendly registry labels, never a text input;
- side-by-side synthetic preview for bell/PWA/native as supported;
- visible code-default fallback and reset control;
- validation summary before Save;
- bounded audit history with actor/time/revision and before/after field changes.

Preview never searches customers, payments, messages, jobs, or provider data. Examples such as
`Jordan Lee`, `$1,250.00`, and `JOB-1042` are fixed synthetic registry samples.

## Acceptance criteria

### Functional

1. An active internal admin can load all registry-backed event/surface definitions and current
   overrides from desktop Settings.
2. A non-admin, inactive employee, external employee, unmapped Auth user, missing token, and invalid
   token cannot read catalog overrides/history or mutate them.
3. The UI cannot submit an event, surface, variable, or route ID not emitted by the server catalog.
4. Preview and save produce the same validated result for the same template/route definition.
5. Save is atomic with one audit row; reset restores the code default and records an audit row.
6. Two stale admin sessions cannot silently overwrite one another.
7. Runtime uses a valid override and uses the code default for absent/invalid/stale/missing-context
   overrides.
8. Editing presentation cannot change audience, channel preference/default, consent, recipient,
   delivery occurrence identity, or provider selection.
9. PWA and native route resolutions pass their existing sanitizers.
10. No native route opens an admin/office-only surface.
11. Native privacy restrictions reject sensitive variables even when another surface allows them.
12. No preview/test action sends a notification or calls APNs, Web Push, email, SMS, or another
    provider.

### Negative template and route tests

- unknown token, property traversal, expression, loop, malformed braces;
- title/body/source payload over limit;
- control characters and disallowed newlines;
- generic `payload`, `html`, URL, phone, email, credential, token, signed URL, and recording URL;
- absolute/protocol-relative/custom-scheme URL;
- encoded slash/traversal, fragment, duplicate query key, foreign host/port;
- route ID allowed globally but not for the selected event/surface;
- route missing its server-derived context key;
- admin route chosen for native;
- registry contract version mismatch;
- missing optional/required runtime value;
- malicious text displayed as text, never interpreted as markup.

### Worker/database tests

- 401/403 matrix before any service-role read/write;
- exact request grammar and byte limits;
- preview has zero database/provider writes;
- service-role-only mutation function grants and caller revalidation;
- forced RLS and zero browser table access;
- atomic current-state + audit write;
- request-ID replay and expected-revision conflict;
- append-only audit;
- reset behavior and application-first rollback;
- CI-visible static migration/rollback contract plus isolated database behavior test.

### UI/lifecycle tests

- loading, failure, empty/unavailable, ready, validation, saving, conflict, and reset states;
- keyboard/focus labels and token insertion;
- 390px no-overflow check even though the product target is desktop;
- background/resume retains event, surface, draft, cursor/scroll, and preview;
- route/nav visibility for admin vs non-admin;
- no raw `upr:toast`, `alert()`, or `confirm()`.

## Phase sequence and ownership

### P0 — dependency handoff (complete)

Parent notification-parity task owns:

- shared typed event/presentation/route registry;
- `functions/api/notify.js`;
- `functions/lib/apns.js`;
- native route sanitizer integration;
- parity/privacy/route tests and its canonical documentation.

Completed handoff evidence:

- owner-authorized committed parent source (`ff77044`, reconciled locally as `9febb9d`);
- exact registry filename and exports;
- all native event/copy/route definitions;
- privacy behavior and fallback semantics;
- focused tests green;
- explicit confirmation that the feature task may consume, but not redefine, the registry.

The reviewed handoff satisfies those source-quality checks. The normalized browser-surface context
is P1 work added to the same registry, not a contract falsely attributed to the native-only parent
slice.

### P1 — pure contract tests and admin API (complete)

Own new files for:

- browser-surface normalized trusted context, template parser/renderer tests, and override resolver
  adapter that extends the landed registry;
- admin Worker and negative authorization tests;
- no shared dispatcher edits until the parent handoff is reconciled.

### P2 — repository migration source (complete; staging verified)

The `db-migration` workflow produced the forward migration, paired rollback, and CI-visible
contract tests. `qa-staging` verified real grants/RLS, denial behavior, replay, revision conflict,
atomic audit/current state, and simultaneous first-write serialization; synthetic rows were
removed after the test.

### P3 — desktop page (complete)

Add the web-only lazy page, route, Settings item, tests, and reserved-marker styles. Reuse project
primitives/tokens and the existing Settings shell.

### P4 — narrow runtime consumption (complete)

Only after P0–P3 are reviewed, make the smallest parent-contract-compatible change that loads a
validated override and otherwise uses the code default. Do not change producers, audience,
preferences, delivery identity, consent, provider selection, native route policy, or channel retry
behavior.

### P5 — close-out (in progress)

- targeted tests/lint;
- full `npm test` and `npm run build`;
- changed-file reviewers: UPR pattern, design consistency, page behavior, Worker security,
  migration safety, anonymous-grant audit, and mobile security/contract review for the shared
  native seam;
- update architecture, schema, auth, business rules, integrations, testing/deployment, notify
  roadmap/current mobile evidence as applicable, and `UPR-Web-Context.md`;
- report the exact production migration/deployment state; provider/device sending remains
  intentionally unexercised because the pure synthetic preview path requires none.

## Dependency graph

```text
parent notification parity registry
                |
                v
    parser + override adapter tests
           /             \
          v               v
 admin Worker/API     additive DB source
          \               /
           v             v
       desktop Settings page
                |
                v
    narrow runtime override lookup
                |
                v
 staging proof -> reviewed release -> production verification
```

## Challenge findings

1. **Strongest HAVE refutation:** current rich browser copy is not a typed context; it is often a
   producer-built string. Result: the design requires a normalized registry context before any
   configurable variable is considered available.
2. **Simpler option:** edit hardcoded strings only. Rejected because it does not deliver the
   requested admin control, audit history, or per-surface privacy/routes.
3. **Alternative:** store full templates/routes in `notification_types`. Rejected because that
   table is the event/preference catalog, not a trusted presentation control plane; it cannot
   safely enforce per-event variables, atomic audit, or code-owned routes.
4. **Alternative:** let the page write PostgREST tables/RPCs directly. Rejected because service-role
   mutation plus server-side admin authorization and validation are required; a UI gate is not an
   authorization boundary.
5. **Alternative:** one template and one path per event. Rejected because bell, PWA, native, and
   email have different privacy and route constraints.
6. **Alternative:** use Handlebars/Mustache/liquid-style rendering. Rejected because the requested
   capability needs token substitution only; a general engine adds unnecessary execution and
   complexity risk.
7. **Ordering objection:** database/UI could start before the parent registry. Rejected because
   schema/API choices would freeze a competing event/surface/route contract and create exactly the
   race the owner asked this task to avoid.
8. **Failure recovery objection:** a saved valid template can become invalid after a later registry
   change. Result: persist contract version, validate at runtime, and fall back to code defaults.
9. **Operational-truth objection:** repository tests cannot prove live catalog data, applied schema,
   Cloudflare bindings, APNs behavior, or device routing. Result: every evidence layer and owner gate
   remains separate in close-out.

## Out of scope

- customer SMS/email automation copy, consent, marketing templates, campaigns, and provider content
  templates;
- changing who receives an event or which channels are enabled;
- arbitrary event creation;
- arbitrary links, query parameters, deep-link schemes, or native route expansion;
- real-data preview;
- provider test sends;
- signing, TestFlight, provider test sends, or changes to saved live presentation configuration;
- retroactive re-rendering of existing notification rows.
