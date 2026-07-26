<!--
FILE: docs/native-ios/06-security-privacy-and-compliance.md

WHAT THIS DOES (plain language):
  Defines the native application's threat model, authorization boundaries, on-device protection,
  privacy decisions, regulated side-effect controls, and evidence required before release.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, docs/auth-and-authorization.md, docs/business-rules.md,
            docs/integrations.md, docs/audit/2026-07/evidence/live-supabase.md,
            docs/native-ios/05-data-contracts-and-environments.md
  External: Apple platform security/privacy requirements, Supabase Auth/RLS/Storage/Realtime
  Data:     reads → approved contracts and current read-only security evidence
            writes → documentation only

NOTES / GOTCHAS:
  - A valid Supabase session is authentication, not authorization.
  - Navigation visibility and cached employee roles never authorize a side effect.
  - Historically observed unresolved job-files exposure must be recaptured read-only and resolved
    before native job media is approved.
-->

# Native iOS Security, Privacy, and Compliance

## Security objective

The native client must let an authorized UPR employee complete approved work while minimizing the
data, permissions, credentials, and durable authority placed on the device. A lost device,
malicious employee, tampered request, compromised session, stale cache, untrusted network, or
misconfigured build must not become a path to another customer's data, company-wide privileged
actions, provider secrets, uncontrolled messaging, money movement, or silent data corruption.

Security and privacy approval is per workflow. “The app uses Supabase” or “the screen is hidden for
techs” is not evidence.

## Evidence boundary at plan creation

The repository and the dated `2026-07-22` read-only Supabase snapshot indicate important risks:

- all observed tables had RLS enabled, but some policies/grants were broader than row-level
  business authorization;
- many functions were `SECURITY DEFINER`, which makes internal caller validation critical;
- `job-files` was observed as public/listable;
- `message-attachments` was observed as private, with access mediated by Workers in current source;
- Realtime publication included `conversations`, `messages`, and `notifications`.

These are historical observations, not current live proof. Canonical documents also record
subsequent security work. Recapture the exact current state read-only before approving a native
contract; do not “resolve” conflicting evidence in client code.

## Threat model

Review each vertical slice against at least these actors and failures:

| Threat | Example | Required control |
|---|---|---|
| Lost, stolen, or shared device | Unlocked field phone exposes customers/photos | Device lock requirement, Keychain, file protection, local purge, short sensitive views |
| Malicious authenticated employee | Tech requests an unassigned claim ID | Server/database row authorization and negative cross-ID tests |
| Inactive or changed employee | Cached role remains after termination | Server membership check, session revalidation, subscription cancellation, local quarantine |
| Tampered client | Modified binary calls hidden RPC directly | Treat client as untrusted; enforce every sensitive rule server-side |
| Credential extraction | Binary inspected for keys | Publishable key only; no privileged/provider secrets |
| Token theft/replay | Refresh token copied from device backup/log | Keychain class, TLS, no logs, revocation, account/device response |
| Untrusted network | Request interception or response manipulation | ATS/TLS, system trust, safe error handling; pinning only after an operational decision |
| Cross-environment mistake | Debug build points to production | Fail-closed project/host/provider sentinels |
| Duplicate/ambiguous mutation | Timeout causes two charges/messages/toggles | Server idempotency, receipts, reconciliation, no blind retry |
| Storage reference attack | User guesses another job's object path | Private bucket, object-scoped RLS/Worker authorization, short signed access |
| Realtime data leak | Broad channel streams unrelated conversations | Publication/RLS/private-channel authorization and negative subscription tests |
| Local data remanence | Previous account's jobs survive sign-out | Account-scoped encryption/protection and verified purge/quarantine |
| Diagnostic leakage | Crash log contains message body or signed URL | Structured allowlist logging and redaction tests |
| Supply-chain compromise | Package update adds unsafe behavior | Pin dependencies, review diffs/licenses/advisories, generate SBOM |
| Social/operational misuse | Staff app bypasses consent or approval | Server compliance gates, human confirmation, audit record, kill switch |

Maintain the threat model as features add location, documents, signing, notifications, and AI. A
new capability is a new data flow and permission boundary, not merely a UI addition.

## Data classification

Every contract field and local artifact must be assigned a classification and handling rule:

| Class | Examples | Default handling |
|---|---|---|
| Public | App Store copy, public company contact data | Integrity controls; no unnecessary local persistence |
| Internal | Non-sensitive workflow labels, feature configuration | Authenticated access; redact operational internals from public logs |
| Confidential | Customer identity/contact, claim/job details, schedules, messages | Need-to-know row scope, protected local storage, redacted telemetry |
| Restricted | Signatures, IDs, insurance documents, precise location history, payment/payroll data, credentials | Explicit purpose, strongest access boundary, minimal retention, no general cache |
| Regulated/consent-bound | SMS consent/DND state, electronic signature evidence, financial/provider records | Server authority, immutable audit trail, legal/owner review |

The feature packet records:

- each field/object and classification;
- collection purpose and lawful/business need;
- users and roles allowed to access it;
- server, local, log, telemetry, backup, and third-party destinations;
- retention/deletion owner;
- export/account-deletion implications;
- whether screenshots, screen recording, notifications, widgets, or app switching could expose it.

Unknown classification blocks persistence and telemetry.

## Trust boundaries and credential rules

### Public mobile client

The binary may hold only the Supabase project URL, a publishable key, public API origins, App/Team
identifiers, and other expressly public client identifiers. Public does not mean interchangeable:
runtime sentinels must bind each value to the intended environment.

Never ship:

- Supabase secret or `service_role` keys;
- provider API secrets, OAuth client secrets not designed for native public clients, webhook
  verifiers, private keys, or signing certificates;
- Cloudflare administrative tokens;
- privileged SQL/RPC tunnels;
- real fixture credentials or production access tokens.

### Server/Worker boundary

Provider secrets and privileged orchestration remain server-side. A Worker returning non-public
data or causing a side effect must:

1. validate the Supabase session server-side;
2. resolve an active employee when membership matters;
3. enforce role, organization, owner, assignment, and resource authorization;
4. validate content type, schema, identifiers, size, and domain transition;
5. apply rate limits, timeouts, idempotency, and provider-mode controls;
6. return a stable redacted error and correlation ID;
7. record the appropriate audit/worker-run evidence without sensitive payloads.

A valid JWT is only authentication. It is never a blanket administrative grant.

## Authentication and session lifecycle

Use the session state machine in `05-data-contracts-and-environments.md`. Security-specific
requirements include:

- Keychain storage uses an accessibility class chosen deliberately for expected locked-device and
  background behavior; do not default without testing;
- do not put session material in `UserDefaults`, SwiftData/Core Data fields, files, logs, analytics,
  screenshots, clipboard, or notifications;
- centralize refresh and prevent a refresh storm;
- require reauthentication for owner-approved high-risk actions when appropriate;
- distinguish network unavailability, expired credentials, inactive employee, missing membership,
  authorization denial, and account deletion;
- cancel Realtime, background uploads, queued mutations, deep-link continuation, and sensitive
  tasks when the session is no longer valid;
- protect password-reset/deep-link callback state against replay and environment confusion;
- test device restore, app reinstall, token rotation, password change, remote revocation, employee
  deactivation, multi-device sessions, and clock skew.

Before native authentication is approved, decide and document the canonical employee binding. The
current email lookup and `auth_user_id` guidance must not coexist as ambiguous security semantics.
Any backfill or database change is separate reviewed work and must preserve existing clients.

## Authorization matrix

For each contract, record and test:

```text
subject
  + active employee membership
  + organization/company boundary
  + role/capability
  + assignment/ownership/resource relationship
  + allowed transition
  + record/object/channel scope
```

Required negative cases:

- anonymous user;
- expired/revoked session;
- authenticated user with no employee row;
- inactive employee;
- wrong role;
- correct role but wrong organization/assignment/owner;
- valid parent ID combined with an unrelated child ID;
- guessed row/object/channel identifiers;
- archived/deleted resource;
- stale role or assignment cached before a change;
- direct RPC/REST/Worker/Storage/Realtime call bypassing the UI.

UI capability checks remain useful for discoverability and should fail closed, but they are not
counted as enforcement evidence.

## Supabase boundary requirements

### Tables and RLS

- Enable RLS and grant only required operations/columns/schemas.
- Treat grants and RLS as separate controls; both must be correct.
- Scope policies to the real company/organization/role/assignment/owner model.
- Do not approve `TO authenticated USING (true)` merely because login is required.
- Test policies directly using representative JWTs and cross-resource identifiers.
- New API-exposed tables require an explicit grant decision; do not rely on changing platform
  defaults.

Supabase has announced changes to automatic Data API grants for new projects and later all
projects. The native plan therefore requires explicit grants in reviewed migrations and tests:
[Data API grant change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

### Functions and RPCs

- Prefer `SECURITY INVOKER`.
- A necessary `SECURITY DEFINER` function revokes public execution, uses least-privilege grants,
  fixes its `search_path`, validates the trusted caller/resource internally, and documents why
  definer rights are necessary.
- Inspect overloads and exact deployed signatures; function name alone is insufficient.
- Preserve deployed response shapes or version the contract.
- Never expose a free-form SQL function to browser/mobile roles.

### Storage

Storage protection includes bucket configuration **and** object-level database policy. Every
upload/read/delete contract must prove its exact object authorization.

`job-files` being historically public/listable is a native release blocker for job media,
documents, or signatures. Before approval:

- decide the object ownership/assignment model;
- make access private or otherwise prove a narrowly justified public requirement;
- enforce object-scoped read/write/delete;
- use short-lived signed access or an authorized Worker;
- migrate existing object references compatibly;
- prevent sensitive URLs from logs, notifications, pasteboard, and retained screenshots;
- validate cache headers and offline retention;
- define deletion and orphan cleanup.

Do not make a bucket public to simplify SwiftUI image loading.

### Realtime

- Prove publication and row/channel authorization.
- Prefer private authorized channels when the data warrants it.
- Treat payloads as hints; reconcile authoritative state.
- Cancel on sign-out/account switch and refresh authorization on token/role changes.
- Test cross-conversation, cross-job, and cross-assignment subscription attempts.
- Do not include private message bodies or customer data in channel/topic names.

References:

- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)

## On-device protection

### Storage choices

| Material | Default location | Protection |
|---|---|---|
| Session/refresh credentials | Keychain through approved Auth mechanism | Non-synchronizing unless explicitly approved; intentional accessibility class |
| Non-sensitive preferences | `UserDefaults` | No secrets/PII; account/environment namespace |
| Cached confidential records | Account-scoped database/file store | Data Protection class, minimum fields, retention/purge |
| Draft text/forms | Account-scoped durable store | Protected, encrypted if threat model requires, explicit retention |
| Photos/documents awaiting upload | Protected app container | File protection, backup exclusion, stable operation ownership, purge |
| Signed URLs/provider tokens | Memory where possible | Never durable beyond required lifetime |

Database encryption beyond iOS Data Protection must be a written decision based on the threat
model, locked-device/background requirements, backup behavior, operational key recovery, and
supported library review. “Encrypted database” is not useful if its key is stored beside it
without a defensible policy.

### Account and environment isolation

All durable records include an environment and immutable account/employee namespace. On sign-out,
account change, employee deactivation, or environment change:

1. stop new reads and mutations;
2. cancel subscriptions and background transfers;
3. move ambiguous in-flight operations to a protected reconciliation/quarantine state;
4. purge caches, drafts, thumbnails, temporary exports, clipboard content owned by the app, and
   safe-to-remove queued work according to policy;
5. remove credentials;
6. prove that the next account cannot observe or submit the previous account's material.

Never process a queue created under one user after another user signs in.

### UI leakage controls

Decide per screen whether to:

- redact content in the app switcher snapshot;
- prevent sensitive notification previews;
- avoid widgets/Live Activities for restricted data;
- keep data out of the pasteboard or use expiring/local-only pasteboard options;
- warn or restrict export/sharing;
- avoid persisting WebView/browser state;
- prevent secrets or document URLs from accessibility labels and debug overlays.

iOS cannot guarantee prevention of all screenshots on an ordinary application. Do not promise it.
Minimize exposed data and address managed-device requirements separately if needed.

## Network and transport

- Require ATS/TLS and never add broad insecure transport exceptions.
- Validate all redirects and callback hosts/schemes.
- Use `URLSession`/SDK cancellation, request/body size limits, and contract-specific timeouts.
- Certificate pinning is not a default. Adopt it only with a rotation, outage, CDN/provider, and
  emergency-release plan.
- Do not trust reachability as proof a request can succeed.
- Redact `Authorization`, cookies, tokens, signed query strings, PII, message bodies, documents,
  and full request/response payloads from logging.

## Permissions and privacy manifest

Every Apple capability follows a just-in-time, purpose-limited sequence:

1. owner approves the user value and exact data use;
2. privacy inventory records collection, transmission, third parties, retention, linking, and
   tracking status;
3. app explains the benefit before the system prompt;
4. request the narrowest permission only at the moment of need;
5. provide a functional denied/restricted path and Settings recovery;
6. stop access when the workflow ends;
7. test initial, denied, limited, restricted, revoked, changed-in-Settings, and interrupted states;
8. align `Info.plist`, entitlements, privacy manifest, App Store privacy answers, support copy, and
   actual runtime behavior.

### Capability-specific minimums

- **Camera:** capture only in the intended job context; strip/retain metadata deliberately; protect
  pending files.
- **Photo library:** prefer limited picker access and avoid broad library permission when a system
  picker suffices.
- **Location:** request When In Use first; precise/background access requires a separately approved
  workflow, retention, battery, employee-notice, and legal decision. Do not create passive employee
  tracking by accident.
- **Notifications:** request after value is clear; route payloads through an authenticated
  authoritative fetch; minimize lock-screen content; support revocation and token rotation.
- **Microphone/speech:** absent by default; purpose, retention, transcription provider, and consent
  require approval.
- **Contacts/calendar/Bluetooth/local network:** absent unless an owner-approved workflow proves
  necessity.
- **Documents/signing:** use private scoped access, immutable audit evidence, signer authorization,
  expiration, and provider contract review.

Maintain a privacy manifest inventory for the app and every SDK, including required-reason APIs.
Dependency updates cannot silently change collected data or privacy declarations.

## Messaging and communications compliance

Native messaging must reuse the existing server compliance boundary; it may not create an alternate
send path.

Requirements:

- server-owned recipient resolution and authorization;
- consent source, purpose, timestamp, actor, and scope recorded;
- DND and STOP remain absolute; START/HELP and quiet-hour behavior follow approved rules;
- transactional, employee, and marketing purposes remain distinct;
- no bulk/automated/campaign behavior without separately approved compliance work;
- stable send idempotency and provider event reconciliation;
- attachment authorization and private-object handling;
- approved sender/mode and an operational kill switch;
- synthetic QA only unless a narrowly controlled real-device test is separately authorized;
- audit proof across attempt, provider event, canonical message, attachment, notification, inbox,
  and device as applicable.

Notification permission never grants message consent.

## Money, payroll, and financial actions

The native app must not perform money movement, payroll approval, refunds, charges, invoice
mutation, or provider credential changes through a generic client path.

For each financial action:

- authorize role and resource server-side;
- display exact amount, currency, counterparty, and consequence;
- require the approved human confirmation pattern;
- use integer/decimal money semantics and stable idempotency;
- reconcile provider and internal records;
- distinguish accepted, pending, failed, duplicate, and ambiguous states;
- audit actor, source record, operation ID, and provider reference without credentials;
- enforce rate limits and an emergency containment path.

Read-only financial summaries still require least-privilege row/column scope and screenshot/log
review.

## Documents and electronic signatures

Before adding document generation, export, DocuSign, or another signature provider, approve:

- document authority and template/version ownership;
- signer identity and authorization;
- data fields and restricted-data classification;
- provider environment and OAuth model;
- envelope/request idempotency;
- callback/webhook signature validation and deduplication;
- immutable completion/audit evidence;
- expiration, void, resend, correction, and dispute handling;
- private Storage and signed/download access;
- retention, legal hold, deletion, export, and customer access;
- PWA/Capacitor compatibility.

A drawn signature image alone is not an electronic-signature system.

## AI and Apple intelligence features

No customer, claim, document, message, employee, location, or financial data may be sent to an AI
model merely because an OS or SDK exposes a convenient API. Each feature requires:

- exact model/runtime and whether processing is on-device, private cloud, or third party;
- data fields and classification;
- retention/training/logging commitments;
- user disclosure and opt-out when appropriate;
- authorization before retrieval and before acting on output;
- prompt-injection and untrusted-document defenses;
- human review for consequential actions;
- hallucination/error UX and provenance;
- telemetry minimization;
- legal, privacy, security, cost, and availability review;
- deterministic non-AI fallback.

AI output cannot authorize, send, sign, pay, alter a claim, or overwrite durable facts without the
existing approved business boundary.

## Logging, telemetry, and support evidence

Use an allowlist, not “log then redact later.” Permitted diagnostic fields can include:

- build/version/environment;
- safe screen/workflow identifier;
- contract ID;
- redacted error category and stable machine code;
- correlation/operation ID;
- duration, retry count, queue age, and network class;
- device/OS class without unnecessary fingerprinting.

Do not retain:

- tokens, headers, cookies, credentials, signed URLs;
- raw request/response bodies;
- customer names, phones, email, addresses, claim details, message bodies;
- photos, documents, signatures, exact coordinates;
- full database identifiers when a rotated/hashed correlation serves the need.

Define destination, access roles, retention, deletion, incident use, sampling, consent, and crash
attachment behavior. Provide a support export that is deliberately redacted and owner-visible
before sharing.

## Supply-chain and build integrity

- Pin Swift packages and commit `Package.resolved`.
- Minimize dependencies; document purpose, owner, license, maintainer health, binary artifacts,
  network/data collection, privacy manifest, and removal plan.
- Review dependency diffs and advisories before update.
- Generate a release dependency inventory/SBOM.
- Keep signing credentials out of source and agent output.
- Separate development, QA, and production entitlements.
- Verify archive contents for secrets, debug endpoints, QA fixtures, unexpected frameworks,
  symbols, privacy manifests, and environment values.
- Protect CI credentials with least privilege and environment approval.
- Record exact source commit, Xcode/Swift version, dependencies, archive, signing identity class,
  and TestFlight/App Store build.

## Incident response and key rotation

Before beta, define owners and runbooks for:

- lost/stolen device or suspected token theft;
- compromised public key, privileged server secret, APNs key, signing certificate, or provider
  credential;
- unauthorized data exposure or Storage URL leak;
- abusive/mistaken messaging;
- duplicate financial/provider side effect;
- malicious or broken app release;
- Realtime cross-scope leak;
- offline queue corruption.

The runbook includes containment, revocation/rotation order, client compatibility window, kill
switches, evidence preservation, customer/legal notification decision, rollback/minimum-version
strategy, and post-incident verification. Practice in isolated QA; do not discover the sequence
during an incident.

## Required security test matrix

Every vertical slice includes:

- authentication lifecycle and revoked-session tests;
- direct-layer negative authorization for anonymous, inactive, wrong role, wrong assignment,
  wrong owner/organization, and mixed parent/child IDs;
- RLS/grant/function/Worker tests in isolated local/QA;
- Storage guess/read/write/delete and expired signed-access tests;
- Realtime cross-scope subscription and reconnect tests;
- malformed, oversized, replayed, duplicate, and rate-limited requests;
- idempotency and ambiguous-result reconciliation;
- local data isolation, backup exclusion, account switch, sign-out, uninstall/reinstall, and device
  restore behavior;
- notification/app-switcher/log/crash/support-export leakage review;
- permission denied/revoked/restricted flows;
- dependency/archive secret and configuration scanning;
- PWA/Capacitor compatibility;
- real-device verification for Keychain, Data Protection, permissions, push, background work, and
  protected files.

No security test may write to the shared project or call a production provider without a separate
explicit authorization.

## Security and privacy readiness gate

A vertical slice cannot reach `approved_native` until:

- its threat model and data-flow inventory are reviewed;
- each field/object is classified with purpose and retention;
- the app contains no privileged/provider secrets;
- environment sentinels and archive inspection pass;
- authentication and canonical employee binding are proved;
- authorization is enforced and negatively tested at every direct boundary;
- RPC grants/security mode and Worker authorization are reviewed;
- Storage and Realtime scopes are proved;
- local protection, sign-out/account-switch purge, backup, and leakage controls pass;
- permissions, privacy manifest, App Store privacy answers, and runtime behavior align;
- consent, DND, STOP, signing, money, location, or AI-specific gates pass where applicable;
- telemetry is useful and redacted;
- compatibility and incident/containment plans exist;
- current external-state evidence is captured read-only;
- owner/legal/security decisions are explicitly recorded.

`job-files`-backed native media remains blocked until its public/listable risk is resolved with a
reviewed, backwards-compatible private/object-scoped design and verified current evidence.
