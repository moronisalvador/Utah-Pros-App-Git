<!--
FILE: docs/native-ios/08-platform-capabilities.md

WHAT THIS DOES (plain language):
  Defines the proposed native-iOS capability architecture, permission boundaries, fallbacks, and
  validation gates.

DEPENDS ON:
  Internal: CLAUDE.md, docs/app-store-readiness-roadmap.md, docs/testing-and-deployment.md,
            docs/native-ios/README.md
  External: Apple Developer Documentation and current DocuSign developer documentation
  Data:     reads → repository, dated audit, and official platform evidence
            writes → documentation only

NOTES / GOTCHAS:
  - This is a planning document, not implementation proof.
  - It does not authorize provider changes, production writes, entitlements, or App Store actions.
-->

# Native iOS Platform Capabilities

**Status:** Proposed architecture, not implemented
**Last reviewed:** 2026-07-25
**Scope:** The future Swift app. The existing PWA and Capacitor app remain unchanged.

## Evidence language

Use the six canonical evidence labels from `01-principles-and-definition-of-done.md`: **Verified**,
**Source-confirmed**, **Inferred**, **Blocked**, **Owner gate**, and **Not tested**. Record provenance
separately as repository, owner, device/user, official source, or external provider. Record a
decision separately as proposed, approved, deferred, or superseded.

Repository declarations are not proof that Apple, DocuSign, Supabase, APNs, or any production service is configured.

## Platform direction

- **Decision state: proposed — SwiftUI first.** New screens, navigation, state presentation, accessibility, and design-system components use SwiftUI.
- **Decision state: proposed — UIKit by bridge, not by rewrite.** Use `UIViewRepresentable` or `UIViewControllerRepresentable` for mature UIKit-only controllers, vendor SDKs, and cases where SwiftUI lacks an equivalent. Each bridge owns its coordinator, cancellation, teardown, and test seam.
- **Decision state: proposed — protocol-bound capabilities.** Camera, scanning, location, notifications, background transfer, signing, AI, and intents sit behind small protocols. Views depend on protocols, not Apple or vendor singletons.
- **Decision state: proposed — capability code has no database authority of its own.** It calls the same authenticated repository/use-case layer as ordinary screens. No service-role key, provider secret, signing private key, or administrator credential may ship in the app.
- **Decision state: proposed — availability is a normal state.** Every capability has supported, unavailable, denied, restricted, interrupted, and failed UI states. A permission denial must not strand unrelated work.

Apple documents `UIViewControllerRepresentable` as the lifecycle-managed way to host UIKit controllers inside SwiftUI; changes flow through an explicit coordinator rather than automatically. See [UIViewControllerRepresentable](https://developer.apple.com/documentation/swiftui/uiviewcontrollerrepresentable).

## Capability matrix

| Capability | Native approach | First permitted scope | Required gates | Safe fallback and proof |
|---|---|---|---|---|
| Camera and photo selection | AVFoundation capture where custom capture is required; PhotosUI for user-selected library content | Attach a photo to an isolated-QA job or document | **Owner gate:** purpose strings, privacy classification, physical-device test | File picker/manual entry; denial and interruption tests; camera proof on a real device |
| Barcode/text scanning | VisionKit `DataScannerViewController` through a SwiftUI bridge | Read a supported code or text value into a draft | **Owner gate:** device support, camera permission, minimum-device decision | Manual entry and ordinary camera capture; test `isSupported` and `isAvailable` |
| Document scanning | VisionKit `VNDocumentCameraViewController`, followed by local review and explicit upload | Create reviewed pages for a document draft | **Owner gate:** retention, file-size, Storage contract, redaction/privacy decisions | PhotosUI/Files import; cancel without mutation; real multi-page device proof |
| Location | Core Location, initially one-shot or foreground updates using the lowest adequate accuracy | Add an optional, user-visible location to an allowed field action | **Owner gate:** purpose, accuracy, retention, role contract, privacy label | Approximate location, manual address, or continue without location where business rules allow |
| Notifications | UserNotifications + APNs; server-managed user/device registration | Read-safe notification deep links before notification actions | **Owner gate:** Apple capability, APNs environments, server token lifecycle, content policy | In-app inbox/badge; denied-permission path; physical-device APNs proof |
| Background transfer | Background `URLSession` for file-backed uploads/downloads | Resume large photo/document transfer | **Owner gate:** server idempotency and reconciliation | Foreground retry queue; explicit pending/failed state; termination and relaunch proof |
| Deferred maintenance | `BGAppRefreshTask` or `BGProcessingTask` only for eligible best-effort work | Refresh noncritical cache or compact completed local work | **Owner gate:** background modes and measured energy value | Foreground refresh; correctness must never depend on a scheduled launch |
| Biometrics and secrets | LocalAuthentication for convenience; Keychain for refresh/session material | Re-unlock an already authorized local session | **Owner gate:** threat model and logout/wipe rules | Device passcode/app login; biometrics never replace server authorization |
| PDF/document display | PDFKit or Quick Look through a focused bridge | Review an already authorized document | **Owner gate:** cache, export, sharing, and screenshot/privacy policy | Secure download/open-in-browser where approved |
| DocuSign | Server-owned DocuSign integration; embedded/native signing experience selected after evaluation | Demo-account envelope creation and signing only | **Owner gate:** commercial account, OAuth model, Connect webhook verification, go-live, legal/privacy review | Existing approved e-sign path or read-only document handoff; never put integration secrets in iOS |
| On-device AI | Foundation Models behind OS/model/language availability checks and a deterministic use-case boundary | Assistive drafting, extraction, or classification with human review | **Owner gate:** minimum OS/device, data policy, evaluation set, legal/privacy approval | Ordinary deterministic UI; no required workflow may depend on Apple Intelligence |
| App Intents | App Intents as thin wrappers around existing authorized use cases | Open/search/read-safe actions | **Owner gate:** explicit action allowlist and authentication behavior | Deep link into the app; no hidden mutation or privileged fallback |

## Camera, photos, and scanning

1. Ask for camera access only when the person invokes a camera feature. Do not prompt at first launch.
2. Use PhotosUI selection rather than broad photo-library access when selection is sufficient.
3. Write captured media to an app-owned temporary location, strip unnecessary metadata when policy requires it, and present a review/delete step before upload.
4. Give every upload a stable client operation ID and content hash so relaunch/retry cannot create duplicate attachments.
5. Delete temporary files after verified upload or explicit cancellation, subject to the documented recovery window.
6. Check VisionKit support and current availability before presenting a scanner. Apple notes that Data Scanner availability depends on permission and device support; the feature must retain a manual path. See [DataScannerViewController](https://developer.apple.com/documentation/visionkit/datascannerviewcontroller) and [Scanning data with the camera](https://developer.apple.com/documentation/visionkit/scanning-data-with-the-camera).
7. **Owner gate:** define which document types may be scanned, where each is stored, who may read it, and when it is deleted before implementation.

## Location

- **Decision state: proposed.** Start with foreground, when-in-use authorization. Do not request always-on authorization in the foundation phase.
- **Decision state: proposed.** Request a one-time fix or bounded foreground updates, then stop. Choose the lowest accuracy and largest acceptable distance filter.
- **Decision state: proposed.** Show the captured value and its accuracy before saving. Mark location provenance and timestamp in the contract if the backend supports them.
- **Decision state: proposed.** Location corroborates a field event; it does not establish employee identity, authorization, payroll entitlement, or proof of work by itself.
- **Owner gate.** Background location requires a separate decision record covering business necessity, Apple eligibility, retention, employee notice/consent, battery evidence, and an always-visible off switch.
- **Owner gate.** Adding location fields or RPC parameters is backend work and cannot be inferred from the Swift UI.

Apple recommends selecting an efficient location service and reducing accuracy/frequency where possible. See [Core Location](https://developer.apple.com/documentation/corelocation), [Getting the current location](https://developer.apple.com/documentation/corelocation/getting-the-current-location-of-a-device), and [Handling location updates in the background](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background).

## Notifications and deep links

- Ask for notification authorization in context, after explaining the value. The app must remain usable when permission is denied.
- Register with APNs on every launch when notifications are enabled. Apple says not to cache the device token because it can change; forward the current token to the server after authentication. See [Registering with APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns).
- Model registration by installation, user, environment, token, app build, and last-seen time. Logout must detach the user association without assuming the token belongs to no other local account.
- Never include sensitive job, client, payroll, health, credential, or document content in a push payload. Treat the push as a hint and fetch authorized content after opening.
- Notification categories and actions are an API surface. Initially permit only navigation/read actions. Any later mutation must use the same role checks, confirmation, idempotency, and audit trail as the foreground app.
- Deep links resolve to typed routes, validate identifiers, authenticate, reauthorize, and fail to a safe landing screen. They never accept a role or trusted state from the URL.
- Test foreground, background, terminated, denied, stale-token, logged-out, wrong-role, duplicate, and expired-content paths on a real device.

Apple requires explicit notification permission and documents separate handling for foreground delivery and notification actions. See [Asking permission to use notifications](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications) and [Handling notifications and actions](https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions).

## Background execution and reliability

Background execution is opportunistic, power-managed, and capability-specific:

- Use a short `beginBackgroundTask` only to finish bounded foreground work; always end it and honor expiration.
- Use a background `URLSession` for file transfers that must continue while suspended. Persist the transfer-to-operation mapping, recreate the session with the same identifier after relaunch, and upload from a file for out-of-process reliability.
- Use `BGAppRefreshTask` for small, noncritical refresh work and `BGProcessingTask` only for deferrable, eligible processing. Register identifiers before scheduling, cancel on expiration, and report completion.
- A background push is a hint, not guaranteed delivery. It may refresh state but may not be the sole trigger for a required business action.
- No mutation may be repeated blindly after an ambiguous response. Reconcile by operation ID before retrying.
- Show pending, retrying, failed, canceled, and completed states. Let the user safely resume foreground work.

Apple’s [background-strategy guide](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app) states that the system chooses when deferred work runs and grants limited execution time. Apple’s [background download guide](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background) documents persistent session identifiers and file-backed transfer constraints.

## DocuSign boundary

**Decision state: proposed.** Treat DocuSign as a server integration with an optional iOS presentation layer:

1. A trusted worker owns OAuth credentials, envelope creation, recipient-view creation, idempotency, and Connect webhook verification.
2. The iOS app requests an allowed operation using its UPR session; it never stores a DocuSign client secret or JWT private key.
3. Build and test against a DocuSign developer/demo account first. Production go-live and account configuration are separate owner/provider gates.
4. Evaluate the currently supported native SDK against an authenticated web signing session before adopting it. Record maintenance status, package distribution, minimum OS, accessibility, offline claims, privacy manifest, binary size, and exit strategy.
5. Envelope status is server-owned and reconciled from verified events. A redirect or client callback alone is not proof of completion.

DocuSign documents [embedded signing](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/embedding/embedded-signing/). Exact SDK and OAuth choices remain an **Owner gate** because provider offerings and account terms can change.

## Apple Intelligence and on-device AI

- AI output is proposed text or classification, never an authorization, compliance, safety, payroll, money, or destructive decision.
- Check API availability, device eligibility, Apple Intelligence enablement, model readiness, supported language, and task-specific policy before showing the feature.
- Provide a complete non-AI workflow. Do not upload private input merely because the on-device model is unavailable.
- Define allowed inputs, retention, tool access, output schema, human review, error states, and an evaluation set before a feature slice starts.
- Test prompts against each supported OS/model version. Apple states that the on-device model can change with OS updates.
- Log operational measurements without raw sensitive prompts or generated content unless a separately approved policy permits it.

See Apple’s [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) and [Foundation Models updates](https://developer.apple.com/documentation/updates/foundationmodels). **Owner gate:** current beta or future-OS APIs must be revalidated against final Xcode and OS releases before adoption.

## App Intents

**Decision state: proposed — initial allowlist:**

- Open the app to Today, a job, a dry log, or a document.
- Search authorized jobs or documents and return minimal metadata.
- Start a draft by opening the app with user confirmation; do not complete the mutation in the background.

**Not allowed in the initial release:**

- Sending SMS/email, changing DND or consent, approving payroll, moving money, signing, deleting, assigning work, changing credentials, or executing an arbitrary RPC.
- Passing a raw database identifier from an untrusted phrase directly into a mutation.
- Returning sensitive field data in Siri, Spotlight, widgets, or snippets while the device is locked.

App Intents are thin wrappers around existing application actions; they do not become a second implementation. Test them in Simulator and on device, including locked, logged-out, wrong-role, ambiguous-entity, and canceled-confirmation paths. See [Creating your first app intent](https://developer.apple.com/documentation/appintents/creating-your-first-app-intent).

## Energy, privacy, and observability

- Measure camera, scanning, location, networking, background work, scrolling, and AI on representative physical devices.
- Establish feature-specific baselines before optimizing; use Xcode Organizer, Instruments Power Profiler, XCTest performance metrics, and MetricKit where supported.
- Collect only operational data needed to diagnose reliability. Scrub credentials, access tokens, client/customer PII, document content, notification payloads, and precise location.
- A new SDK or capability triggers privacy-manifest, App Store privacy-label, purpose-string, retention, and deletion review.

Apple recommends first doing less work, then doing remaining work efficiently, and avoiding API misuse. See [Analyzing battery use](https://developer.apple.com/documentation/xcode/analyzing-your-app-s-battery-use), [Reducing battery use](https://developer.apple.com/documentation/xcode/reducing-your-app-s-battery-use), and [MetricKit](https://developer.apple.com/documentation/metrickit).

## Decisions required before implementation

| Decision | Owner/external gate | Blocking scope |
|---|---|---|
| Minimum iOS/iPadOS and supported device classes | Product owner + iOS lead | Project creation, API availability, test matrix |
| iPhone-only versus iPad support | Product owner | Layout, orientation, screenshots, device matrix |
| Foreground-only versus background location | Product, legal/privacy, security | Location implementation and App Store disclosure |
| Camera/document retention and offline cache window | Product, security, compliance | Capture and Storage slices |
| DocuSign build/buy and authentication model | Owner + DocuSign account administrator | Signing slice |
| First AI use case and data classification | Product, security/privacy | Foundation Models experiment |
| Initial App Intents allowlist | Product + security | Siri/Shortcuts slice |
| Operational telemetry destination and retention | Security/privacy + operations | MetricKit/crash reporting |

No capability moves from proposed to implementation until its contracts, privacy effects, fallback, test environment, and owner gate are recorded in a decision record.
