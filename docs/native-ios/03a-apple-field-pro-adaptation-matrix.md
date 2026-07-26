<!--
════════════════════════════════════════════════
FILE: 03a-apple-field-pro-adaptation-matrix.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This document records which Apple Field Pro layouts, workflows, and refinements the native iOS
  app preserves, which parts translate into native controls, which parts require field-friendly
  adaptation, and which unfinished areas must return to owner discovery.

DEPENDS ON:
  Internal: docs/native-ios/02-owner-decisions-and-discovery.md ·
            docs/native-ios/03-design-system.md ·
            docs/tech-redesign/TECH-DESIGN-STANDARD.md ·
            docs/tech-redesign/SESSION-STATE.md ·
            docs/tech-redesign/UX-FLOWS-BRIEF.md ·
            docs/tech-redesign/prototypes/full-app.html ·
            docs/tech-redesign/prototypes/serve.cjs ·
            .claude/rules/tech-mobile-ux.md
  External: published Claude artifact linked in section 2
  Data:     reads  → repository design evidence and dated owner direction
            writes → documentation only

NOTES / GOTCHAS:
  - Apple Field Pro is the approved product/experience starting blueprint, not a pixel-for-pixel
    SwiftUI spec or a preapproved native visual system.
  - The current PWA is a field-usability reference, not a visual mandate.
  - A prototype marked locked can still require native control, accessibility, device, or backend
    contract validation.
  - Incomplete Apple Field Pro flows remain incomplete; agents must not fill them with guesswork.
════════════════════════════════════════════════
-->

# Apple Field Pro native adaptation matrix

**Last-verified:** 2026-07-26
**Product/experience direction status:** **APPROVED — EVOLVE**
**Implementation status:** Not started
**Applies to:** Product/design continuity for the new native Swift/SwiftUI client

## 1. Owner decision

On 2026-07-26 the owner chose Apple Field Pro as the native app's starting blueprint:

- preserve its considered layouts, information hierarchy, workflow decisions, and refinements by
  default;
- learn from the operational PWA where it is easier to read, understand, reach, and tap in field
  conditions;
- recompose the result with native SwiftUI/UIKit navigation, controls, keyboard, safe-area,
  accessibility, lifecycle, and platform behaviors;
- change Apple Field Pro only when field evidence, native-platform behavior, accessibility,
  security, or a verified product/backend contract justifies the departure.

This closes the high-level `preserve / evolve / replace` question as **evolve** for the
product/experience blueprint. It does not close the still-important choices about typography,
colors, symbols, materials, exact tokens, tab structure, supported devices, theme, component
measurements, or first release scope.

The intended result is:

> Apple Field Pro's refinement and workflow thinking, the current PWA's owner-reported operational
> field strengths to verify, and native iOS behavior — combined into one system rather than choosing
> only one of the three.

## 2. Evidence boundary

| Evidence | Label and provenance | What it supports | Boundary |
|---|---|---|---|
| Owner direction in the 2026-07-26 planning session | **Verified · owner**; decision **approved** | Evolve Apple Field Pro; retain its layouts/workflows/refinements; improve field readability and tapping using PWA lessons | Authorizes planning and prototype direction only, not implementation or release |
| Owner report that technicians find the current design easier on the eyes and easier with gloves | **Verified · owner** | The current PWA must be included in comparative field validation | This is not independently observed technician research or device proof |
| `TECH-DESIGN-STANDARD.md`, `SESSION-STATE.md`, `UX-FLOWS-BRIEF.md`, mockups, specs, and prototypes | **Source-confirmed · repository** | Apple Field Pro foundations, locked decisions, prototype maturity, and known unfinished work | Repository state is not proof that the design is deployed or preferred in current field use |
| `docs/tech-redesign/prototypes/full-app.html` | **Source-confirmed · repository** | Durable combined prototype source with Schedule, Add Visit, Job Hub states, Room, Notes, Docs, Activity, and New Job states | It is an HTML prototype, not production React or SwiftUI |
| [Published Apple Field Pro artifact](https://claude.ai/code/artifact/c7a22959-8a60-403a-8d4f-c000b08e730e?org=d137bb60-ad62-4349-858b-7098b468cfdc) | **Verified · external provider · 2026-07-25** | The published artifact opened as “UPR Tech PWA — Combined Prototype” and exposed the expected navigable states | The committed local HTML remains the durable source of truth |
| `src/pages/tech/v2/TechDashV2.jsx`, `src/pages/tech/v2/TechScheduleV2.jsx`, `src/pages/tech/v2/TechJobHub.jsx`, `src/pages/tech/v2/TechMessagesV2.jsx`, `src/pages/tech/TechClaims.jsx`, `src/pages/tech/TechTasks.jsx`, and `src/pages/tech/TechMore.jsx` | **Source-confirmed · repository** | Starting points for same-workflow current-client comparison | The functional React screens are separate from the Apple Field Pro prototype; fresh flag/deployment/device evidence is still required |
| Current PWA/Capacitor screens and behavior | **Not tested · user/device** | Practical legibility, density, reach, keyboard, and field behavior to evaluate | Fresh comparison is required; do not infer current deployment, flag state, authentication, or device behavior from source alone |

## 3. Adaptation vocabulary

Every screen or component decision uses one of these dispositions:

| Disposition | Meaning |
|---|---|
| **PRESERVE** | Keep the workflow outcome, information placement, hierarchy, terminology, or owner-locked interaction unless contrary evidence is recorded. |
| **TRANSLATE** | Keep the intent but implement it with native navigation, controls, semantics, keyboard, safe areas, and lifecycle behavior. |
| **ADAPT** | Deliberately change visual density, sizing, contrast, reach, disclosure, or feedback to improve field use or accessibility while preserving the task. |
| **REOPEN** | The prior artifact is unfinished, owner-disapproved, stale, or unsupported; return to bounded discovery instead of inventing a native answer. |
| **VERIFY** | Preserve provisionally, but do not freeze or scale until the named owner, technician, device, contract, or security evidence exists. |

These dispositions can coexist. For example, Add Visit is **PRESERVE** for field order and
full-screen structure, **TRANSLATE** for native date/time pickers and keyboard behavior, **ADAPT**
for target size and text reflow, and **VERIFY** on physical devices.

Unless a row says otherwise, Apple Field Pro's exact palette, typography, symbols, materials,
shadows, radii, card styling, and control appearance start as **VERIFY/ADAPT**. The owner approved
their product/layout/workflow context, not a frozen native token set.

## 4. Screen and workflow preservation matrix

“Maturity” describes the Apple Field Pro artifact, not a completed native screen.

| Surface / flow | Apple Field Pro maturity and source | Preserve by default | Native / field adaptation | Remaining gate |
|---|---|---|---|---|
| App shell and top-level navigation | Foundation is source-confirmed; final native tab set was not owner-approved | Stable, labeled destinations; retained state per destination; job-centered field work | **TRANSLATE** to native tabs, navigation stacks, toolbars, safe areas, deep links, and platform back behavior | Owner approves final launch tabs, role scope, and iPad behavior |
| Today / dashboard | Direction B mockup of record; design standard §8.1 | Greeting/attention → NOW/NEXT hero → day context → later work; one dominant current action; honest travel/on-site/total time | Increase readable type and separation where needed; put frequent actions in comfortable one-hand reach; keep native list/refresh/lifecycle behavior | Compare current PWA, Apple Field Pro, and adapted SwiftUI on smallest supported phone |
| Schedule — month | **LOCKED** in `schedule.html` and §12.6 | Day tap updates the in-place appointment preview; it does not surprise-navigate to Day | Native calendar/date semantics, Dynamic Type reflow, larger day selection region, strong selected/today distinction | VoiceOver, large text, gloves, sunlight, and dense-month device proof |
| Schedule — day / empty / loading / error | **LOCKED** in `schedule.html` and §12.6 | Week strip, explicit day movement, timeline/day panels; true empty differs from failure; last-good rows remain under error | Native scrolling and refresh; reachable day controls; readable appointment cards; truthful cached/offline state | Current PWA comparison plus interruption/resume proof |
| Schedule / job search result | **LOCKED** shared result grammar in §12.6.1 | Loss type + abbreviated date of loss; full address/city; claim + job number | Let important text reflow at large sizes instead of relying on web nowrap; preserve unambiguous identity | Validate real maximum-length synthetic content and localization |
| Add Visit | **LOCKED** in `schedule.html` and §12.3 | Full-screen long form; reachable close; pinned completion action; Job → Date → Start/End → Type → Title → Crew → Notes; full New Job detour returns selection | Native full-screen presentation, pickers, focus and keyboard; explicit Start/End; larger rows; scrolling 4–5 techs; unsaved-draft recovery | Physical keyboard/safe-area test; collision and write contracts; representative technician completion |
| Job Hub structure | **LOCKED** in `job-hub.html` and §12.5; owner described it as “amazing” | Job-centric workspace; adaptive hero; concise action model; do-now before look-up; Visits then Activity | Preserve hierarchy, not web cards/pixels; use native lists, disclosure, sheets, menus, scrolling, and toolbar placement where field testing improves reach | Same-content PWA/Apple Field Pro/SwiftUI comparison before foundation freeze |
| Adaptive hero and clock lifecycle | **LOCKED** in §12.4–§12.5 | Data-driven hero precedence; Scheduled → On My Way → Working → Paused → Done; address/navigation; appointment note; travel/on-site/total; no Finish without active context | Native timers, app lifecycle, Live Activity only if later approved; clear large status/action; safe confirmation/undo/receipt rather than blindly copying web mechanics | Contract/idempotency review, background/resume/device proof, owner approval of Paused/Finish behavior |
| Work Authorization alert | Built and WebKit-checked; owner physical-device reaction was still pending in `SESSION-STATE.md` | Unsigned compliance state remains prominent and links to the correct signing flow; signed state becomes calm | Native warning semantics, Dynamic Type, VoiceOver, no red-only meaning, no accidental signature action | Owner/device visual reaction plus signing authorization/contract proof |
| Crew strip | Built and WebKit-checked; owner physical-device reaction was still pending | Visit-scoped crew and lead context remain visible near the hero | Adapt avatar density and long names for large text and localization; full accessible names | Owner/device reaction and real crew-count stress case |
| Dry Logs gateway and module anatomy | Hub placement/module name owner-locked; `hydro-b.html` is a mockup of record | Dry Logs → Tasks → Scope Sheet → Rooms ordering; summary-to-module continuity; chamber/room grouping; “Dry Logs” names the tool, “Drying” names the phase | Native numeric typography, large reading rows, keyboard, units, errors, offline receipts, efficient lists | First-slice decision; backend contract and field-science review |
| Dry Logs write flows | **REOPEN** — Add Reading, place/pull equipment, and chamber management were not completed | Preserve only owner-locked full technician chamber control and Rooms fallback | Design native numeric/keypad flow from real contracts and field tasks; do not infer missing steps from the mockup | Owner workshop, data contract, mutation safety, offline, technician/device proof |
| Tasks | Behavior source-confirmed and owner-refined | Default-collapsed hub section; whole-row actions; optimistic check with reconciliation; Done-collapse and completion acknowledgement | Native toggle/button semantics, large rows, VoiceOver state, undo/retry/uncertain outcome | Verify task source/authorization/mutation contract and glove operation |
| Scope Sheet | Placement and field importance owner-locked; detailed native flow not complete | Standalone do-now entry in the Job Hub; room-by-room work context | Native focused workflow, draft recovery, large controls, unambiguous job/room context | Inventory current workflow/contracts and prototype the complete task |
| Rooms and photos | **LOCKED** in §12.5.2 | Rooms are the documentation spine; room-first capture; Photos/Notes room tabs; Add Room; Unsorted fallback | Native camera/photo picker, durable staging, upload progress, offline retry, low-storage handling, private media access | Camera/device lifecycle, Storage authorization, metadata/idempotency, representative field proof |
| Appointment, job, and room notes | **LOCKED** as three distinct scopes | Keep scopes visibly distinct; appointment note in visit context; job notes on dedicated page; room notes in room; authorship/timestamps and ownership-transfer rule | Native editor, keyboard, attachments, drafts, accessibility, save/queued/failed receipts | Verify live schema/business rule and interruption/account-switch handling |
| Documents, signatures, and reports | Dedicated page structure **LOCKED**; provider capabilities extend beyond prototype proof | One paperwork home; signed/unsigned status; Water Loss Report affordance; document list; request-signature entry | Native document preview/import/camera, secure caching, standard sharing only when permitted, clear online/provider limitations | Storage/signing/DocuSign threat model, sandbox, contract, legal, retention, and device proof |
| Activity | Placement/content rule **LOCKED** in §12.5.1 | Reverse-chronological attributable system/business history; no casual send action; only approved event families | Native grouped list, readable actor/time, pagination, offline/stale state, accessibility summary | Verify event source, authorization, completeness, and pagination contract |
| Customer and claim access from Job Hub | Header entry points are source-confirmed; destination screens remain incomplete | Customer identity and claim number remain reachable without a wall of equal actions | Native navigation affordance must be discoverable and large enough; consider explicit rows if text-link styling fails field tests | Prototype destination hierarchy and validate discoverability with technicians |
| New Job | Prototype exists; owner explicitly requested rework | Preserve only the explicitly approved minimal job-flow customer quick-add and save-to-Job-Hub destination; treat the claim fork as source-confirmed current behavior to verify | **REOPEN** the sequence, claim-fork presentation, external-sync receipt, copy, steps, keyboard, interruption, validation, and recovery using current PWA lessons | Owner explains desired improvements; verify creation/duplicate/provider contracts before design lock |
| Standalone New Customer | **REOPEN** — not built | Preserve land-back-with-success behavior and stay inside the field shell | Design from current workflow/contracts with native forms, duplicate handling, draft recovery, and readable errors | Owner scope, destination, authorization, and contract inventory |
| New Event / Edit or reschedule Visit | **REOPEN / partial** — Add Visit foundation exists; these flows were unfinished | Reuse the approved long-form/picker grammar; preserve explicit edit/collision context | Native edit state, destructive action safety, conflict feedback, unsaved changes, keyboard and interruption | Complete owner flow design and verify crew/task mutation behavior |
| Claims | Apple Field Pro system rules exist; bespoke list/detail remained unfinished | Preserve required claim identity/search and job entry; reuse locked search-result hierarchy | Native searchable list/detail, role-aware actions, accessible long insurance content | Workflow classification, prototype, contracts, authorization, representative content |
| Standalone Tasks | **REOPEN** — the Job Hub task section is refined, but the separate `TechTasks` surface had no bespoke locked Apple Field Pro design | Preserve task meaning, assignment context, full-row interaction, and the approved Job Hub task behavior where shared | Native task list/filter/detail using the shared task component/state contract; do not assume it must remain a top-level destination | Owner launch/navigation scope, source/contract inventory, prototype and field validation |
| Messages | Prior brief said reskin with compliance seams frozen; bespoke Apple Field Pro flow remained unfinished | Preserve conversation outcome and every consent/DND/STOP/quiet-hours/server-send boundary | Native conversation list/thread, keyboard/composer, attachment lifecycle, pagination, push/deep links, explicit send receipts | Owner launch scope, provider/worker contracts, synthetic no-send QA, real-device keyboard/push proof |
| More, Help, Feedback, Settings | System-derived, not bespoke/locked | Preserve necessary support, diagnostics, language/appearance/privacy/account functions | Use native Settings/form/list patterns; keep field-critical diagnostics plain and reachable | Owner launch scope, screen inventory, privacy/support ownership |

## 5. Field-friendly adaptation contract

The native design does not become “field friendly” through a rugged-looking theme. It must meet
observable interaction and readability requirements.

### 5.1 Touch, gloves, and reach

- Treat **48 points as the floor for field actions** and **44 points only for documented secondary
  utilities**. A smaller visible glyph can sit inside the full hit region.
- Prototype 56-point or larger full-row actions for frequent, gloved interactions instead of
  assuming the minimum is optimal.
- Separate adjacent actions enough to prevent glove mis-taps; do not place two destructive or
  state-changing icon-only targets tightly together.
- Make the whole logical row tappable where it has one outcome.
- Keep frequent actions in comfortable one-hand reach or provide an equally clear reachable path.
- Do not hide required work behind a precise swipe, long press, tiny drag handle, or hover-only
  affordance.

Exact larger measurements become approved tokens only after representative device/task testing.

### 5.2 Readability and comprehension

- Treat Apple Field Pro's ink-first, color-is-state discipline as a **VERIFY/ADAPT** starting point,
  not preapproved native token law. Remeasure every native color pairing. Body text must meet at
  least 4.5:1; primary field text should lean toward 7:1 in sunlight.
- Use Dynamic Type and native semantic text styles. Preserve hierarchy and character, not fixed web
  font sizes.
- Let essential text wrap and reflow before truncating it. Claim/job identifiers, units, dates,
  names, addresses, and action labels must remain understandable at accessibility sizes.
- Maintain status as word + symbol + color. Material blur, shadows, subtle gray, animation, or
  haptics may never carry essential meaning alone.
- Prefer plain action verbs, one primary action, and progressive disclosure over dense equal-weight
  control grids.
- Use representative long names, addresses, translations, claim numbers, documents, tasks, rooms,
  readings, and error messages during design—not polished short placeholders.

### 5.3 Native behavior

- Use native navigation, sheets, alerts, menus, pickers, selection, scrolling, focus, and back
  behavior unless a documented field need proves a custom interaction better.
- The keyboard must sit naturally below the active composition/input field with no WebView viewport
  shim, extra PWA browser layer, hidden footer, or unreachable completion action.
- Keyboard type, input accessory actions, focus order, validation, dictation, paste, autofill, and
  dismissal are designed per workflow and tested on device.
- Safe areas, Dynamic Island/camera housing, home indicator, orientation, Display Zoom, and text
  reflow use native layout APIs.
- Standard controls keep VoiceOver, Voice Control, Switch Control, Full Keyboard Access, Reduce
  Motion, Increased Contrast, Differentiate Without Color, and Reduce Transparency behavior.

### 5.4 Reliability and battery

- Keep last-good content visible and distinguish offline, queued, syncing, committed, failed,
  conflict, and uncertain outcomes.
- Avoid decorative polling, permanent high-frequency location, uncontrolled Realtime channels,
  large list media, unnecessary blur, and animation that increases energy cost without helping the
  task.
- Preserve drafts and staged evidence according to the approved data-protection/account-switch
  policy; never trade data integrity for visual simplicity.

## 6. Required comparison before design-foundation freeze

For the same realistic synthetic job and the same task, review three views side by side:

1. the current PWA/Capacitor workflow;
2. the committed Apple Field Pro source/published artifact;
3. the field-adapted SwiftUI prototype.

Start with at least:

- Schedule month/day → Add Visit; and
- Job Hub → one active clock action → Room/Photo or the selected first-slice task.

Use the smallest supported iPhone and a current large iPhone, default and accessibility text sizes,
light and dark if both are proposed, portrait plus any approved landscape, and realistic field
content. The review must cover:

- time to find and complete the primary task;
- wrong taps, missed targets, accidental navigation, and recovery;
- readable hierarchy indoors and in bright sunlight;
- one-hand and glove operation;
- keyboard/focus/scroll behavior;
- VoiceOver and non-color state comprehension;
- interruption, offline, queued, failed, and retry states;
- comfort, confidence, and explicit preference with reasons.

Owner review and representative-technician evidence are separate. If a representative technician,
physical device, sunlight/glove setting, authenticated workflow, or safe QA environment is
unavailable, record the missing proof as **Blocked**. Continue safe unrelated design/contract work,
but do not call the screen field-validated or freeze/scale its foundation.

## 7. Required screen implementation record

Before implementation begins for a screen/state, create a record containing:

```text
Screen ID / native route / Swift module:
Workflow ID, authorized roles, and business outcome:
Current PWA route/component and observed status:
Apple Field Pro file/section/prototype/date:
Source maturity: locked | pending device reaction | rework | unfinished | current-only | native-new
Locked anatomy / zone order / primary-action placement:
Locked refinements and owner decision IDs:
Disposition by material element: Preserve | Translate | Adapt | Reopen | Verify
Native navigation/control/presentation/keyboard/safe-area mapping:
Field/accessibility adaptation:
Required data/connectivity/auth/permission/mutation/lifecycle states:
Current-PWA lesson and evidence:
Intentional departure record:
Contract IDs and PWA/Capacitor compatibility:
Prototype / Simulator / device / technician evidence status:
Design, workflow, contract, and review owners:
Next gate:
```

This screen record complements the workflow/contract matrix in
`04-information-architecture-and-workflow-parity.md`; it does not duplicate or replace it.

## 8. Deviation rule

No agent may silently redesign an Apple Field Pro decision or silently copy it into SwiftUI.

Every material departure uses:

```text
Surface / workflow:
Apple Field Pro source and maturity:
Preserved outcome:
Proposed departure:
Reason: field evidence | native behavior | accessibility | security | verified contract | owner
Current PWA evidence reviewed:
Alternatives considered:
Owner decision:
Representative technician evidence:
Device / OS / text size:
Backend and PWA compatibility impact:
Decision status and revisit trigger:
```

A departure caused only by builder preference is rejected. A change supported by better field,
accessibility, native-platform, security, or contract evidence is controlled evolution—not a
failure to preserve the design.

## 9. First Mac session use

Discovery Session A must open this matrix beside:

- `docs/tech-redesign/prototypes/full-app.html`;
- the published artifact in section 2;
- `docs/tech-redesign/TECH-DESIGN-STANDARD.md`;
- `docs/tech-redesign/SESSION-STATE.md`;
- current PWA screenshots or safe device/browser evidence for the same workflows.

Render the committed prototype through `docs/tech-redesign/prototypes/serve.cjs` only. The
prototype files are HTML fragments and can render blank or incorrectly on iOS through `file://` or
a bare static server. Any local server remains subject to the five-minute attempt, recorded-child,
and guaranteed-finally cleanup contract.

Do **not** ask the owner to choose preserve, evolve, or replace again. Ask only for unresolved scope,
field adaptation, device, typography, navigation, theme, and first-slice decisions. Mark each matrix
row used by the first slice as Preserve, Translate, Adapt, Reopen, and/or Verify before implementation
begins.
