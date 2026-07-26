<!--
════════════════════════════════════════════════
FILE: design-review-checklist.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This reusable checklist records whether a native iOS design is understandable, consistent,
  accessible, and proven on the devices and conditions where employees will use it. It prevents
  a polished screenshot from being mistaken for a complete, production-ready workflow.

DEPENDS ON:
  Internal: docs/native-ios/02-owner-decisions-and-discovery.md ·
            docs/native-ios/03-design-system.md ·
            docs/native-ios/03a-apple-field-pro-adaptation-matrix.md ·
            docs/native-ios/04-information-architecture-and-workflow-parity.md
  External: Apple Human Interface Guidelines and accessibility guidance
  Data:     reads  → none
            writes → none

NOTES / GOTCHAS:
  - Copy this template into the evidence area for each reviewed foundation, screen, or workflow.
  - An unchecked item is not implicitly waived. Mark it blocked, not applicable with a reason,
    or failed.
  - Owner approval, simulator proof, automation, and physical-device proof are different evidence.
════════════════════════════════════════════════
-->

# Native iOS design review checklist

## Review identity

| Field | Value |
|---|---|
| Review ID | |
| Feature/workflow | |
| Screen/state | |
| Apple Field Pro source/maturity | |
| Current PWA source/evidence | |
| Disposition | Preserve / Translate / Adapt / Reopen / Verify |
| Design-system version | |
| Workflow-contract version | |
| Prototype/build commit | |
| Classification | `FOUNDATION` / `NATIVE-LAUNCH` / `NATIVE-V1` / `NATIVE-FUTURE` |
| Review date | |
| Designer/agent | |
| Reviewer | |
| Owner decision required | Yes / No |
| Data environment | Mock / Local QA / Hosted QA / Other |
| Physical devices | |
| Simulator devices | |

## Evidence and decision labels

Use the plan-of-record evidence labels exactly:

- `Verified`
- `Source-confirmed`
- `Inferred`
- `Blocked`
- `Owner gate`
- `Not tested`

Record provenance separately (`repository`, `owner`, `user/device`, or `external provider`).
Record decision lifecycle separately (`proposed`, `approved`, `deferred`, or `superseded`).

## 1. Scope and truthfulness

- [ ] The business outcome and primary user are stated.
- [ ] The workflow classification and owner are recorded.
- [ ] Verified facts, proposals, and inferences are labeled separately.
- [ ] Current behavior was inspected rather than reconstructed from memory.
- [ ] The exact Apple Field Pro source and maturity are recorded; unfinished/rework work is not
      mislabeled locked.
- [ ] Locked anatomy, content priority, workflow refinements, and owner decision IDs are recorded.
- [ ] Current-PWA field lessons were inspected for the same task/content.
- [ ] The design does not claim a backend, authorization, offline, or device behavior that has not
      been verified.
- [ ] No production data, customer identity, credential, or secret appears in the prototype/evidence.
- [ ] Intentional departures from the current app are listed.
- [ ] Legacy-only, blocked, and deferred behavior is not disguised as complete.

Evidence:

```text

```

## 2. Owner decisions

- [ ] The owner saw concrete alternatives where a cross-app decision was still open.
- [ ] The recommendation and tradeoffs were stated.
- [ ] The owner explicitly approved the selected direction; silence was not treated as approval.
- [ ] Rejected alternatives and reasons remain recorded.
- [ ] The owner reviewed a real workflow, not only isolated components.
- [ ] Any phrase requiring interpretation ("calmer," "more native," "less busy") was translated
      into concrete changes and reconfirmed.
- [ ] Revisit triggers are defined for intentionally deferred decisions.

Decision IDs and evidence:

```text

```

## 3. Information architecture and workflow

- [ ] The screen has a clear place in the approved navigation hierarchy.
- [ ] Entry points include tab, parent screen, notification, deep link, and cold launch where relevant.
- [ ] Back behavior and dismissal behavior are unambiguous.
- [ ] The primary task is evident without instructions.
- [ ] One primary action is visually dominant in each state.
- [ ] Secondary actions remain discoverable without competing with the primary action.
- [ ] Information appears in the order needed to make the next decision.
- [ ] Long workflows show progress, save state, and a safe exit.
- [ ] The workflow cannot strand the employee outside the native shell.
- [ ] Deep links handle signed-out, loading, forbidden, deleted, and stale objects.
- [ ] Screen-to-screen context is preserved without hidden global state.

Evidence:

```text

```

## 4. Design-system use

- [ ] Approved semantic tokens are used; no feature-specific duplicate palette exists.
- [ ] Approved typography roles are used with Dynamic Type.
- [ ] Approved spacing, target, safe-area, and radius roles are used.
- [ ] Standard SwiftUI controls are used where they meet the requirement.
- [ ] A custom control has a documented field/domain reason and complete behavior contract.
- [ ] Common platform actions use familiar SF Symbols or an approved alternative.
- [ ] Custom UPR symbols are cataloged and accessibility-labeled where meaningful.
- [ ] No feature-private copy of a shared button, row, status, field, sheet, loading, empty, or error
      component was created.
- [ ] Any new reusable component was added to the catalog with all states.
- [ ] Light, dark, increased-contrast, and reduce-transparency appearances are reviewed.

Evidence:

```text

```

## 5. State completeness

### Data

- [ ] Cold loading
- [ ] Cached/last-good content
- [ ] Silent refresh
- [ ] Genuine empty result
- [ ] Partial result
- [ ] Recoverable error with retry
- [ ] Error while stale content remains visible

### Connectivity and mutation

- [ ] Offline before action
- [ ] Queued
- [ ] Syncing
- [ ] Failed with recovery
- [ ] Synced/committed receipt
- [ ] Duplicate tap/retry
- [ ] Server committed but response was lost
- [ ] Conflict with another device/user
- [ ] App background, termination, and relaunch
- [ ] Logout/account switch cleanup

### Authorization and permission

- [ ] Signed out/session expired
- [ ] Missing or inactive employee
- [ ] Forbidden role/object
- [ ] Permission not requested
- [ ] Permission granted
- [ ] Permission limited
- [ ] Permission denied/restricted
- [ ] Manual alternative or Settings path where valid

### Control

- [ ] Rest
- [ ] Pressed
- [ ] Focused
- [ ] Selected
- [ ] Disabled with reason where needed
- [ ] Loading without geometry shift or duplicate action
- [ ] Success
- [ ] Warning
- [ ] Destructive/terminal confirmation

Evidence:

```text

```

## 6. Accessibility

### Dynamic Type and layout

- [ ] Meaningful text uses Dynamic Type.
- [ ] Default and accessibility sizes were reviewed.
- [ ] Horizontal layouts reflow before important content clips.
- [ ] User-generated content has a way to reveal the full value.
- [ ] Fixed-height containers do not clip localized or large text.
- [ ] Bold Text and Display Zoom remain usable.

### VoiceOver

- [ ] Reading order matches task order.
- [ ] Controls have concise labels, values, traits, and hints only when useful.
- [ ] Composite rows avoid duplicate or fragmented announcements.
- [ ] Status is announced as a word/value, not only a color or icon.
- [ ] Timers do not announce every tick.
- [ ] Charts, timelines, and instrument summaries have meaningful alternatives.
- [ ] Dynamic results and errors announce without unexpected focus theft.
- [ ] Custom actions expose swipe/overflow behavior.
- [ ] The primary task was completed manually with VoiceOver.

### Other assistive behavior

- [ ] Voice Control can address controls by visible labels.
- [ ] Switch Control has a logical, nontrapping focus order.
- [ ] Differentiate Without Color preserves every state.
- [ ] Increased Contrast remains readable.
- [ ] Reduce Transparency provides opaque readable surfaces.
- [ ] Reduce Motion removes unnecessary spatial movement.
- [ ] No gesture is the only path to an action.
- [ ] Hit regions meet at least 44-by-44 points; field actions meet the approved larger floor.
- [ ] Automated Accessibility Inspector/UI-test audit was run.
- [ ] Automated findings were resolved or individually justified.

Evidence:

```text

```

## 7. Content and localization

- [ ] Plain, action-oriented language is used.
- [ ] Labels use the employee's terminology, not implementation terminology.
- [ ] Error copy explains what happened and the safe next step without leaking internals.
- [ ] Destructive actions name the object and consequence.
- [ ] Dates, times, measurements, currency, and units use approved locale/domain formatting.
- [ ] English and all launch languages were reviewed with realistic long strings.
- [ ] Layout direction and symbol direction are correct if right-to-left support is in scope.
- [ ] Empty states offer a next useful action or upcoming work.
- [ ] No lorem ipsum, fake success, or misleading placeholder production data remains.

Evidence:

```text

```

## 8. Field conditions

- [ ] Primary content/control boundaries remain visible in bright sunlight.
- [ ] The workflow can be operated one-handed.
- [ ] Frequent targets work with gloves/wet fingers and have adequate separation.
- [ ] Critical actions do not depend on sound.
- [ ] Haptics are useful but not required to understand state.
- [ ] Poor/no signal does not discard work or falsely claim completion.
- [ ] The app can be interrupted and resumed without losing task context.
- [ ] Camera, document, and location flows were checked in the actual physical environment where
      practical.
- [ ] Battery/data impact is proportionate; no decorative polling, full-resolution list media, or
      unnecessary continuous location.
- [ ] Dark appearance works in low light without harming sunlight-first readability.

Evidence:

```text

```

## 9. Motion, gestures, keyboard, and haptics

- [ ] Native navigation/sheet behavior is retained unless a documented need requires customization.
- [ ] Motion communicates continuity, state, or consequence.
- [ ] High-frequency actions do not accumulate decorative animation.
- [ ] Custom enter behavior has a corresponding exit.
- [ ] Reduce Motion behavior was observed, not assumed.
- [ ] System back, edge swipe, scrolling, sheet gestures, and custom gestures do not conflict.
- [ ] Keyboard appearance, dismissal, focus progression, and field visibility were verified on
      physical iPhone.
- [ ] Numeric keypad and decimal/unit entry match the domain.
- [ ] Dictation/autofill/password-manager behavior was reviewed where relevant.
- [ ] Haptics were tested on device and do not fire on scroll, typing, or background events.

Evidence:

```text

```

## 10. Privacy and permissions

- [ ] The design requests only permissions required by a current action.
- [ ] A short in-context explanation precedes the system prompt where helpful.
- [ ] Denial is handled without repeatedly prompting.
- [ ] Location precision/background need is explicit and proportional.
- [ ] Sensitive photos/documents are not exposed in inappropriate previews or caches.
- [ ] Share/export affordances obey authorization and business policy.
- [ ] Notification content avoids unnecessary sensitive data.
- [ ] AI-assisted output is visibly reviewable and cannot silently become authoritative data.
- [ ] Privacy, legal, or provider review gates are recorded.

Evidence:

```text

```

## 11. Prototype and device matrix

| Check | Environment/device | Result | Evidence |
|---|---|---|---|
| Smallest supported iPhone | | Pass / Fail / Blocked | |
| Largest supported iPhone | | Pass / Fail / Blocked | |
| Supported iPad compact width | | Pass / Fail / N/A / Blocked | |
| Supported iPad regular width | | Pass / Fail / N/A / Blocked | |
| Portrait | | Pass / Fail / N/A | |
| Landscape | | Pass / Fail / N/A | |
| Default Dynamic Type | | Pass / Fail | |
| All Dynamic Type accessibility sizes | | Pass / Fail | |
| Light | | Pass / Fail | |
| Dark | | Pass / Fail | |
| Increased Contrast | | Pass / Fail | |
| Reduce Transparency | | Pass / Fail | |
| Reduce Motion | | Pass / Fail | |
| VoiceOver | | Pass / Fail / Blocked | |
| Voice Control | | Pass / Fail / Blocked | |
| Offline/interrupted | | Pass / Fail / Blocked | |
| Camera/location/notifications | | Pass / Fail / N/A / Blocked | |
| Sunlight/glove field check | | Pass / Fail / Blocked | |

## 12. Parity and departure

- [ ] The current business outcome is preserved or the owner approved its replacement.
- [ ] Apple Field Pro's locked hierarchy/refinements are preserved or a material departure record
      contains evidence and owner approval.
- [ ] Native translation changes web mechanics without silently erasing the approved product
      structure.
- [ ] Field adaptation addresses reading, reach, gloves, sunlight, keyboard, all Dynamic Type
      accessibility sizes, and VoiceOver for the actual task.
- [ ] The same-content current PWA, Apple Field Pro, and SwiftUI outcomes were compared where the
      matrix requires it.
- [ ] Role and object-level authorization expectations are identified.
- [ ] Current and native entry/exit paths are compared.
- [ ] Offline, background, notification, and deep-link behavior is compared.
- [ ] Storage/media behavior is compared.
- [ ] Provider/compliance boundaries remain server-owned.
- [ ] PWA/Capacitor backward compatibility is recorded.
- [ ] Pixel parity is not being mistaken for workflow parity.
- [ ] Unsafe or legacy-only behavior was not copied merely for parity.

Intentional departures:

```text

```

Preserved refinements and native/field adaptations:

```text

```

## 13. Review outcome

Choose one:

- [ ] **APPROVED** — All required gates pass with evidence.
- [ ] **APPROVED WITH CONDITIONS** — Conditions are bounded, owned, and do not invalidate the
      approved design decision.
- [ ] **REVISE** — Design changes are required before implementation/merge.
- [ ] **BLOCKED** — Named access, device, owner, backend, provider, or policy evidence is missing.
- [ ] **NOT APPLICABLE** — This review was informational only; no approval is being granted.

### Findings

| ID | Severity | Finding | Evidence | Owner | Required before |
|---|---|---|---|---|---|
| | | | | | |

### Conditions, blockers, and residual risk

```text

```

### Approval

| Role | Name | Decision | Date | Evidence |
|---|---|---|---|---|
| Design reviewer | | | | |
| Accessibility reviewer | | | | |
| Workflow/backend reviewer | | | | |
| Owner | | | | |
