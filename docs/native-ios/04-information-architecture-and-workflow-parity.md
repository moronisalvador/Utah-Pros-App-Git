<!--
════════════════════════════════════════════════
FILE: 04-information-architecture-and-workflow-parity.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This document defines how the existing UPR workflows are mapped into a clear native iOS
  structure. It prevents a screen-by-screen copy from missing permissions, failure states,
  offline behavior, or important steps that currently live across several parts of the product.

DEPENDS ON:
  Internal: docs/native-ios/02-owner-decisions-and-discovery.md ·
            docs/native-ios/03-design-system.md ·
            docs/native-ios/03a-apple-field-pro-adaptation-matrix.md ·
            docs/tech-redesign/TECH-DESIGN-STANDARD.md ·
            docs/tech-redesign/UX-FLOWS-BRIEF.md · UPR-Web-Context.md
  External: Apple Human Interface Guidelines linked below
  Data:     reads  → none
            writes → none

NOTES / GOTCHAS:
  - Workflow parity means preserving authorized business outcomes and recovery behavior, not
    reproducing every web route or pixel.
  - This is a planning taxonomy. Exact backend contracts must be verified separately before wiring.
  - Existing behavior can be classified as legacy-only or unsafe; parity is never a reason to copy
    an insecure or unreliable path.
════════════════════════════════════════════════
-->

# Native iOS information architecture and workflow parity

**Last-verified:** 2026-07-26
**Document status:** Apple Field Pro workflow continuity approved; native navigation and parity
release set require owner approval
**Implementation status:** Not started

## 1. Outcome

The native app must preserve what employees need to accomplish while reorganizing those tasks into
an iPhone-native structure.

Parity is measured at the workflow level:

> Can an authorized employee achieve the same required business outcome, with equivalent or better
> integrity, recovery, accessibility, and evidence?

Parity is **not** measured by:

- matching the number of React pages;
- copying route names;
- reproducing CSS layouts;
- issuing the same database calls directly from a view;
- retaining an unsafe or obsolete workflow because it exists today.

Apple Field Pro is now the default layout/workflow blueprint, not a pixel contract. Preserve its
owner-locked information hierarchy and choreography unless a documented field, native-platform,
accessibility, security, or verified-contract reason supports a departure. The screen-level boundary
and incomplete-flow ledger live in `03a-apple-field-pro-adaptation-matrix.md`.

Apple recommends concentrating the iPhone interface on primary tasks, limiting onscreen controls,
adapting to Dynamic Type and appearance, and placing frequent interactions within comfortable reach.
See [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios/).

## 2. Classification model

Every current and planned capability receives one classification:

| Classification | Meaning |
|---|---|
| **NATIVE-LAUNCH** | Required before the native app can replace the current App Store client. |
| **NATIVE-V1** | Required for the first complete native release but may follow the first internal slice. |
| **NATIVE-FUTURE** | Deliberately belongs in the native roadmap after the core release. |
| **WEB-SUPPORTED** | Remains available in the PWA/office web product; no native implementation required. |
| **LEGACY-ONLY** | Existing client may continue temporarily, but new native code must not adopt it. |
| **BLOCKED** | Cannot be assigned until security, backend contract, product, or provider questions are resolved. |
| **RETIRED** | Intentionally omitted because the owner has approved a replacement or removal. |

Each classification must record:

- owner and approval date;
- affected roles;
- backend-contract status;
- offline requirement;
- notification/deep-link requirement;
- replacement/fallback path;
- release gate.

## 3. Proposed native navigation model

The exact model is an owner decision under `NIOS-DES-004`. The recommended starting point is:

```text
App
├─ Today
│  ├─ Assigned visits
│  ├─ Live clock state
│  └─ Attention and upcoming work
├─ Jobs
│  ├─ Search/recent/assigned jobs
│  └─ Job workspace
│     ├─ Overview and visit
│     ├─ Rooms
│     │  ├─ Photos
│     │  └─ Notes
│     ├─ Dry Logs
│     ├─ Equipment
│     ├─ Tasks
│     ├─ Documents/signatures
│     ├─ Job notes
│     └─ Activity
├─ Schedule
│  ├─ Day/week/month
│  └─ Create/edit visit
├─ Messages
│  ├─ Conversation list
│  └─ Thread
└─ More
   ├─ Claims/customers/search
   ├─ Time and history
   ├─ Notifications
   ├─ Settings
   ├─ Help/feedback
   └─ Role-authorized tools
```

This is a **PROPOSED** IA, not an approved tab contract. The owner reviews alternatives with real
workflow prototypes.

The existing Apple Field Pro/TechLayout prototype baseline is
`Dash | Claims | Schedule | Messages | More`. The proposed tree above explores
`Today | Jobs | Schedule | Messages | More`; accepting Apple Field Pro as the product/experience
blueprint does not silently approve replacing Claims with Jobs or changing tab membership.
`NIOS-DES-004` remains an owner decision, evaluated with the locked screen hierarchy and real
first-slice entry paths.

Native navigation should begin with `TabView` and separate `NavigationStack` state per tab. Apple's
tab-bar guidance says tabs represent stable top-level navigation, preserve navigation state, remain
visible consistently, and use labels. See
[Apple HIG: Tab Bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars).

Actions such as Add Reading, Capture Photo, or Start Work do not become tabs. They belong in the
current content or toolbar.

## 4. Job workspace as the documentation spine

The owner has approved preserving Apple Field Pro's job-centric workspace as the native starting
hierarchy. Native discovery validates its field presentation and exact platform navigation rather
than relitigating the structure without evidence:

1. A job is the durable working context.
2. A visit supplies schedule, crew, and clock context.
3. Rooms organize photos and room notes.
4. Dry Logs organize chambers/rooms, readings, material points, and equipment.
5. Documents organize generated reports, files, signatures, and DocuSign state.
6. Job notes remain distinct from appointment notes and room notes.
7. Activity is a read-only, attributable history of system and authorized user events.

The hierarchy prevents duplicate screens and lost context. A Dry Logs module may expose summary
information in the job workspace, but data entry belongs in its own focused flow.

A departure from this hierarchy requires the deviation record in
`03a-apple-field-pro-adaptation-matrix.md`; builder preference is not evidence.

## 5. Workflow record required before design or implementation

Every workflow receives a record with:

```text
Workflow ID and version:
Business outcome:
Current entry points and callers:
Native entry points:
Allowed roles/capabilities:
Object-level authorization rule:
Preconditions:
Happy path:
Alternate paths:
Offline behavior:
Background behavior:
Interruption/termination recovery:
Permission states:
Loading/stale/empty/error states:
Mutations and idempotency:
Uncertain-outcome handling:
Storage/media behavior:
Realtime/notification behavior:
Deep links:
Accessibility task:
Audit/observability receipt:
Current backend contracts:
Native contract status:
PWA compatibility requirement:
Owner classification:
Evidence:
```

A screen mockup without this record is incomplete for a complex workflow.

## 6. Workflow families and design coverage

The classifications below are planning recommendations only. The native release plan must replace
them with owner-approved values.

### 6.1 Identity and session

Coverage:

- login and password recovery;
- session restoration and refresh;
- auth user to active employee resolution;
- inactive, missing, or unauthorized employee;
- role/capability loading;
- biometric convenience if approved;
- logout and account switch;
- local cache, draft, queue, Realtime, notification, and background-task cleanup.

**Proposed classification:** `NATIVE-LAUNCH`.

No business content is designed as available until this state machine is resolved.

### 6.2 Today, schedule, and visits

Coverage:

- today's assigned visits and upcoming work;
- day/week/month schedule;
- job/event distinction;
- create and edit visit;
- crew and task assignment visibility;
- collision feedback;
- deep link to a specific visit;
- cold load, last-good stale view, genuine empty day, offline schedule;
- live clock state and cross-device conflict.

**Proposed classification:** `NATIVE-LAUNCH`.

### 6.3 Clock lifecycle and time evidence

Coverage:

- scheduled → on my way → working → paused → done;
- location permission and distance warning where authorized;
- superseding another active clock;
- travel/on-site/paused/total breakdown;
- approved terminal-action safety contract (confirmation and/or undo, receipt, and recovery), with
  the native presentation decided per action rather than copied from the web;
- duplicate taps, request timeout, uncertain commit, retry, and server truth;
- background/resume/termination continuity;
- accessibility announcements that do not read the timer every second.

**Proposed classification:** `NATIVE-LAUNCH`.

### 6.4 Jobs, customers, claims, and creation

Coverage:

- assigned/recent job search;
- job workspace;
- customer and claim identity;
- job creation and customer quick-add;
- standalone customer creation;
- existing/new claim fork;
- addresses and Maps;
- Encircle or other integration receipts without blocking the entire save;
- duplicate and conflict behavior.

**Proposed classification:** Job read/workspace `NATIVE-LAUNCH`; creation flows `NATIVE-V1`,
subject to owner release scope.

### 6.5 Tasks

Coverage:

- assignment source and visibility;
- optimistic check/uncheck with server reconciliation;
- completed-task collapse;
- failure rollback and offline queue;
- task history where required;
- full-row targets and VoiceOver toggle semantics.

**Proposed classification:** `NATIVE-LAUNCH`.

### 6.6 Rooms, photos, and notes

Coverage:

- room list/add/edit;
- room-first photo capture;
- job, appointment, and room note scopes;
- capture, local staging, compression, upload, metadata commit, retry, duplicate prevention,
  orphan cleanup, and failure receipt;
- limited Photos access, camera denial, storage denial, and low-disk behavior;
- thumbnails versus full-resolution viewing;
- termination/background transfer;
- sensitive media authorization and signed access.

**Proposed classification:** `NATIVE-LAUNCH` if the native app performs field documentation;
otherwise the replacement is incomplete.

### 6.7 Dry Logs and equipment

Coverage:

- room/chamber grouping and fallback;
- ambient/control/affected readings;
- moisture points, goals, tolerances, trends, and stalled state;
- numeric entry, units, validation, and calculator behavior;
- equipment placement, movement, count, day derivation, and pull;
- offline mutation queue and idempotency;
- mirror integrity between workspace summary and module;
- audit/history and report inputs.

**Proposed classification:** `NATIVE-V1` and recommended first full vertical slice after the
read-only shell, because it exercises native numeric input, offline work, domain state, and field
documentation.

### 6.8 Documents, reports, signatures, and DocuSign

Coverage:

- document list and authorization;
- scan/import/camera source;
- generated water-loss and other reports;
- draft, generated, sent, delivered, viewed, signed, declined, expired, voided, failed states;
- secure server-owned DocuSign integration;
- offline limitations stated before entry;
- sensitive file caching and cleanup;
- deep links and notification receipts;
- native preview, annotation, and share controls only where policy permits.

**Proposed classification:** Existing required documents/signatures `NATIVE-V1`; broader DocuSign
capabilities `NATIVE-FUTURE` until provider and contract design are approved.

### 6.9 Messaging

Coverage:

- conversation list/thread;
- attachments and upload state;
- Realtime and pagination;
- notification/deep-link entry;
- consent, DND, STOP, quiet hours, sender authority, and worker-owned send path;
- scheduled/automated messages kept outside casual client actions;
- optimistic send and provider failure reconciliation.

**Proposed classification:** `NATIVE-LAUNCH` if employees rely on the current App Store client for
messaging; otherwise `NATIVE-V1`. Owner decision required.

### 6.10 Notifications and location

Coverage:

- permission education before the system prompt;
- provisional/authorized/denied/limited states where applicable;
- APNs registration and employee/device association;
- foreground, background, terminated, and stale deep-link behavior;
- notification categories and actions;
- location purpose, precision, foreground/background scope, and visible use indicator;
- battery-aware update strategy;
- revocation and device/account change.

**Proposed classification:** Required transactional notifications and scoped foreground location
`NATIVE-LAUNCH`; broader proactive/location features `NATIVE-FUTURE` behind separate privacy review.

### 6.11 Settings, help, feedback, and administration

Coverage:

- appearance, language, notification, privacy, and account settings;
- help and support;
- diagnostic/sync status;
- feedback;
- role-authorized admin capabilities.

**Proposed classification:** Employee settings/help `NATIVE-LAUNCH`; broad administration
`WEB-SUPPORTED` unless the owner identifies a native field need.

### 6.12 Apple ecosystem and AI capabilities

Coverage:

- App Intents, Siri, Spotlight, widgets, and Live Activities;
- on-device model availability and fallback;
- user confirmation before authoritative writes;
- provenance, confidence, privacy, and observability;
- no dependence on AI for a safety- or compliance-critical workflow;
- energy and supported-device constraints.

**Proposed classification:** `NATIVE-FUTURE`. Architecture may reserve clean seams, but release-one
work does not prebuild speculative AI UI.

## 7. Required state and interruption parity

Each workflow prototype and acceptance test covers:

1. First load.
2. Cached/last-good load.
3. Successful empty result.
4. Partial result.
5. Permission denied.
6. Authorization revoked.
7. Offline before action.
8. Connection loss during action.
9. Server committed but response was lost.
10. Retry and duplicate prevention.
11. Conflict with another device/user.
12. App background and resume.
13. App termination and relaunch.
14. Account switch/logout.
15. Deep link from cold launch.
16. All Dynamic Type accessibility sizes; any safety-driven exception requires an approved
    rationale and alternate large-content presentation.
17. VoiceOver completion.

Optional runtime evidence that cannot be obtained safely is marked blocked with a human/device gate;
it never stalls unrelated design documentation.

## 8. Workflow parity matrix

The canonical matrix uses one row per workflow, not one row per screen:

| Workflow | Current outcome | Native outcome | Classification | Roles | Read contracts | Write contracts | Offline | Media | Notification/deep link | Design status | Contract status | Device evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Example only: moisture reading | Authorized technician records an attributable reading for a job location | Same outcome through native numeric entry with safe retry | **PROPOSED: NATIVE-V1** | Verify | Verify | Verify | Required | No | Optional | Not started | Not approved | None |

The example is not evidence that a specific RPC or authorization contract is approved.

## 9. Reuse and departure rules

### Preserve

- business outcome and terminology;
- server-enforced authorization;
- data ownership and attribution;
- current provider/compliance boundaries;
- backward compatibility while Capacitor remains installed;
- proven workflow decisions unless explicitly superseded;
- Apple Field Pro's owner-locked layouts, hierarchy, and refinements under the adaptation matrix;
- user-visible receipts and audit history;
- field persona and accessibility requirements.

### Improve

- information hierarchy;
- native navigation and presentation;
- keyboard and input behavior;
- camera/document/location experiences;
- offline clarity and recovery;
- accessibility and localization;
- performance and energy use;
- state feedback.

### Do not copy

- UI-only role gates;
- broad or unverified database access;
- direct table/RPC strings inside views;
- WebView safe-area/keyboard workarounds;
- obsolete routes or duplicate screens;
- silent failure;
- raw production experiments;
- existing behavior already classified as unsafe, legacy-only, or blocked.

## 10. Slice design and approval sequence

For each vertical slice:

1. Approve workflow classification and outcome.
2. Verify current callers and backend contracts.
3. Record roles and object-level authorization.
4. Classify each involved Apple Field Pro surface as Preserve, Translate, Adapt, Reopen, and/or
   Verify; record evidence for every departure.
5. Draw the native state/entry/exit map.
6. Reuse approved design-system components.
7. Prototype happy, offline, error, permission, and interruption paths.
8. Run owner design review.
9. Run accessibility review.
10. Validate the provisional implementation in Simulator; record physical-iPhone and representative-
   technician proof as required gates before slice acceptance, foundation freeze, or scaling.
11. Connect only to isolated QA after the data-readiness and owner gates pass. A blocked
    physical-device/human gate does not prohibit safe provisional mock/isolated-QA work.
12. Compare native, Apple Field Pro, and current PWA outcomes using identical synthetic fixtures.
13. Record parity, intentional departures, and unresolved release gates.

## 11. Exit criteria

Information architecture and parity planning are ready for implementation when:

- the current PWA/Capacitor fallback has a current, owner-accepted `NIOS-H: READY` record;
- the owner approves top-level navigation and role scope;
- every current mobile workflow has a classification;
- every first-slice Apple Field Pro surface has a preservation/adaptation disposition;
- every `NATIVE-LAUNCH`/`NATIVE-V1` workflow has an owner and dependency order;
- each first-slice workflow has a complete record from section 5;
- no screen contains an unidentified backend or authorization assumption;
- legacy-only and blocked paths have safe fallbacks;
- required states from section 7 are represented in prototypes/tests;
- PWA/Capacitor compatibility remains explicit;
- the launch-parity set is defined without claiming pixel or implementation parity.

This planning readiness still requires Phase 0 closure, current-base reconciliation, a fresh
implementation worktree, and separate implementation authority before Swift code begins.
