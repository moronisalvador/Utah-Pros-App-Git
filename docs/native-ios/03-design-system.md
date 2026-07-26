<!--
════════════════════════════════════════════════
FILE: 03-design-system.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This document defines how the native iOS design system will be chosen, built, tested,
  and safely extended. It keeps the app consistent and accessible while allowing real
  workflow learning to improve the system without every feature inventing its own UI.

DEPENDS ON:
  Internal: docs/native-ios/02-owner-decisions-and-discovery.md ·
            docs/native-ios/03a-apple-field-pro-adaptation-matrix.md ·
            UPR-Design-System.md · docs/tech-redesign/TECH-DESIGN-STANDARD.md ·
            docs/tech-redesign/specs/foundations.md ·
            docs/tech-redesign/specs/components-core.md ·
            .claude/rules/tech-mobile-ux.md
  External: Apple Human Interface Guidelines and SwiftUI accessibility guidance linked below
  Data:     reads  → none
            writes → none

NOTES / GOTCHAS:
  - Apple Field Pro evolution is approved; exact values remain proposed until the discovery
    decision register marks them approved.
  - Web CSS values are not copied mechanically into Swift points or custom SwiftUI controls.
  - The approved global foundation and selected slice's required component-state matrix are built
    first; domain-specific components evolve through reviewed vertical slices so the team does not
    overdesign imaginary needs.
════════════════════════════════════════════════
-->

# Native iOS design system

**Last-verified:** 2026-07-26
**Document status:** Apple Field Pro evolution approved; native details and device approval pending
**Foundation status:** Not implemented
**Applies to:** The new native Swift/SwiftUI client only

## 1. Design-system outcome

The native design system must make a complex field app feel coherent without forcing SwiftUI to
imitate a browser.

It will define:

- design principles and field-persona constraints;
- semantic color and material roles;
- Dynamic Type typography;
- spacing, sizing, safe-area, and adaptive-layout rules;
- symbol and imagery strategy;
- core controls and their complete state matrix;
- navigation and presentation patterns;
- motion and haptic vocabulary;
- accessibility behavior;
- field, offline, permission, and interruption behavior;
- prototype, simulator, and real-device acceptance gates;
- a controlled process for adding or changing components.

It will not be called complete merely because a token file and a few buttons exist.

## 2. Approved continuity versus proposed native choices

### 2.0 Approved direction

Apple Field Pro is the native product/experience starting blueprint. The native team preserves its
owner-locked layouts, information hierarchy, workflow decisions, and refinements by default while
adapting them for easier field reading and tapping, full accessibility, and native iOS behavior.
The current PWA is reviewed beside it to retain field strengths rather than discarded as “legacy.”
This approval does not freeze the exact native palette, typography, symbols, materials, controls,
or measurements; those are decided through the process in this document.

The binding screen-by-screen boundary is
`03a-apple-field-pro-adaptation-matrix.md`. It prevents two opposite mistakes:

- starting over and losing hours of owner design decisions; and
- copying an HTML prototype so literally that the native app inherits web keyboard, safe-area,
  density, readability, or interaction compromises.

### 2.1 Preserve as product and usability requirements

These current principles are supported by repository evidence and should survive unless the owner
explicitly supersedes them:

- Apple Field Pro's owner-locked screen hierarchy and workflow decisions, subject to the
  preservation/adaptation matrix;
- the gloved, one-handed, sunlight-exposed field persona;
- large, forgiving primary targets;
- one clear primary action per working context;
- status conveyed by color **plus** shape and text;
- quiet data presentation with color reserved for state;
- labeled travel, on-site, and total time rather than an ambiguous total;
- visible loading, stale, empty, error, offline, queued, syncing, and failed states;
- cold-start loading that does not blank already rendered content on refresh;
- no dead-end empty states;
- task completion that is understandable without color;
- deliberate confirmation for terminal or difficult-to-recover actions;
- room/job/document context that prevents misfiled field evidence;
- owner reaction to concrete prototypes as the design-tuning mechanism.

The approved continuity boundary covers layouts, workflow choreography, hierarchy, and refinements.
Visual traits such as ink-first identity, exact palette, font, symbols, materials, card styling,
shadows, radii, and button appearance begin as **VERIFY/ADAPT** inputs rather than preapproved native
tokens.

### 2.2 Translate, do not copy

| Existing PWA element | Native treatment to evaluate |
|---|---|
| CSS `--t-*` color and spacing tokens | Re-express as semantic Swift types and asset-catalog colors; preserve meaning, not syntax. |
| Fixed pixel typography | Use Dynamic Type text styles and scaled metrics; preserve hierarchy and field legibility. |
| Source Sans 3 | Compare against the iOS system font before deciding. Custom type must prove legibility, scaling, loading, and localization value. |
| Custom duotone SVG system | Prefer SF Symbols for standard platform actions; retain custom symbols only where the UPR domain lacks a clear system symbol. |
| Custom tab bar and sticky WebView shell | Start with native `TabView`, `NavigationStack`, toolbars, safe areas, and per-tab navigation state. |
| Web bottom sheets and modal lifecycle | Use native sheets, detents, presentation behavior, and accessibility unless a documented field need requires customization. |
| CSS keyboard/safe-area workarounds | Use SwiftUI/UIKit keyboard-safe layout and native safe-area APIs. |
| Web toast channel | Choose native in-context confirmation, banner, overlay, or alert based on urgency; do not recreate a global toast by default. |
| CSS motion tokens and custom gestures | Map intent to native transactions/transitions and system gestures; respect Reduce Motion. |
| Capacitor haptic wrapper | Use SwiftUI sensory feedback or UIKit feedback generators through one reviewed service. |
| Custom status chips | Preserve status semantics and redundancy; implementation may use native labels, symbols, and accessibility values. |

### 2.3 Revisit rather than inherit

The following are PWA-specific or unresolved and require an explicit native decision:

- exact tab count and hierarchy;
- custom black-pill primacy versus current native prominent-button styling;
- custom font versus San Francisco;
- fully custom icon artwork versus SF Symbols;
- exact light/dark palettes and current iOS material use;
- full-width controls where Apple recommends respecting system margins;
- toast-versus-banner feedback conventions;
- the PWA's custom pull-to-refresh, scroll restoration, and keep-alive behavior;
- WebView-specific keyboard hiding, viewport, and transform workarounds;
- arbitrary fixed heights that fail Dynamic Type;
- hover states that have no iPhone meaning;
- current design decisions marked open, deferred, or superseded in the tech standard.

## 3. Native-first design rules

1. **Use platform semantics before custom drawing.** Standard SwiftUI buttons, toggles, text fields,
   pickers, lists, navigation, menus, sheets, alerts, and accessibility behaviors are the starting
   point.
2. **Customize hierarchy, not fundamental behavior.** UPR may own color, typography choice, spacing,
   content hierarchy, and domain components; it should not casually replace native scrolling,
   keyboard avoidance, focus, selection, or presentation behavior.
3. **Accessibility is part of each component's API.** Labels, values, traits, actions, focus order,
   Dynamic Type behavior, and reduced-motion behavior are specified with the visual design.
4. **Content leads chrome.** Controls remain discoverable but do not overpower job information.
5. **Field use raises the floor.** Apple's general button guidance calls for at least a 44-by-44
   point hit region; UPR uses a 48-point floor for field actions and reserves 44 points for
   documented secondary utilities. High-frequency whole-row actions should prototype 56 points or
   more when glove/device evidence supports it.
   See [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).
6. **System changes are inputs, not automatic redesign orders.** New iOS visual capabilities are
   adopted only after compatibility, accessibility, field readability, performance, and owner
   review.
7. **One implementation per shared concept.** A feature may not copy and privately restyle Button,
   Status, Error, Loading, Sheet, or Field primitives.
8. **No hidden state.** A user can tell whether work is local, queued, syncing, failed, complete,
   unauthorized, or awaiting another step.
9. **Routine field actions do not interrupt with alerts.** Keep choices and recoverable work in
   context or in a scoped sheet. Preserve the safety invariant for irreversible or ambiguous
   actions through an owner-approved confirmation, undo, receipt, and recovery contract; do not
   assume the web two-step presentation is automatically the right native interaction. Reserve a
   system alert for critical, immediate information or an uncommon irreversible consequence where
   interruption is justified. Apple's alert guidance similarly recommends
   action sheets for choices tied to an intentional action and sparing use of alerts; see
   [Apple HIG: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts).

## 4. Foundation built before feature UI

The foundation phase is completed in this order.

### F1 — Semantic foundations

Define stable semantic roles rather than screen-specific names:

- `background`, `groupedBackground`, `surface`, `raisedSurface`;
- `labelPrimary`, `labelSecondary`, `labelTertiary`, `separator`;
- `actionPrimary`, `actionDestructive`;
- `statusScheduled`, `statusEnRoute`, `statusWorking`, `statusPaused`, `statusDone`;
- `semanticSuccess`, `semanticWarning`, `semanticDanger`, `semanticInfo`, `semanticNeutral`;
- focus, selection, disabled, skeleton, scrim, and permission-warning roles.

Each color role must include:

- light and dark appearance;
- increased-contrast behavior;
- differentiate-without-color behavior;
- intended foreground/background pairing;
- measured contrast evidence;
- status symbol and text label where applicable.

**Exit criteria**

- No feature-facing API exposes raw hex values.
- Status meaning survives grayscale.
- Light, dark, and increased-contrast samples pass review.
- The owner approves the exact field-adapted native visual system on device; Apple Field Pro
  layout/workflow/refinement continuity is already approved.

### F2 — Typography and content sizing

Use Dynamic Type as a foundation, not an afterthought:

- map each UPR role to a native text style;
- use `Font` text styles and relative custom fonts rather than fixed point sizes;
- use `@ScaledMetric` for icon, spacing, and control dimensions that must grow with text;
- preserve tabular numerals for timers, time, currency, counts, and instrument readings;
- let labels wrap where meaning would be lost by truncation;
- reflow horizontal layouts into vertical layouts at accessibility sizes;
- avoid capping Dynamic Type unless a documented safety case and alternate large-content
  presentation are approved;
- test Bold Text, Button Shapes, and Display Zoom.

Apple recommends supporting text enlargement and identifies Dynamic Type as the standard mechanism.
See [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
and [SwiftUI `dynamicTypeSize`](https://developer.apple.com/documentation/swiftui/environmentvalues/dynamictypesize).

**Exit criteria**

- The type ramp is approved in realistic data-dense screens.
- The smallest supported iPhone has no clipped primary actions at all Dynamic Type accessibility
  sizes. A safety-driven exception requires a documented rationale and alternate large-content
  presentation; visual preference is not enough.
- Timers and instrument columns remain understandable with large text.
- VoiceOver does not repeat decorative text or omit meaningful units.

### F3 — Spacing, safe areas, and adaptive layout

Define:

- spacing and corner-radius roles;
- content margins and readable-width limits;
- minimum hit regions and separation between adjacent actions;
- safe-area and keyboard behavior;
- compact/regular horizontal-size-class behavior;
- portrait and approved landscape behavior;
- iPhone and, if approved, iPad navigation structure;
- sheet detents and scroll ownership;
- Dynamic Island, camera housing, home indicator, and status-bar accommodation.

Use native safe-area and adaptive-layout APIs. Do not transplant `dvh`, CSS viewport, or WebView
keyboard calculations. Apple's layout guidance requires adapting to screen sizes, orientation,
Dynamic Type, locale, and safe areas. See
[Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout).

**Exit criteria**

- No critical control is obscured by keyboard or system chrome.
- Orientation and size-class behavior match the approved support matrix.
- Scrolling is owned by one clear container per screen.
- Accessibility text sizes reflow rather than overlap.

### F4 — Symbol and imagery system

Decide and document:

- SF Symbols usage for platform-standard actions;
- custom UPR symbols for domain-only concepts;
- symbol rendering modes, weights, scales, and filled/outline selection behavior;
- accessibility labels for meaningful images and hidden treatment for decoration;
- status-shape vocabulary;
- photography, thumbnail, placeholder, annotation, and document-preview behavior;
- app icon direction as its own owner-approved artifact.

Custom symbols must align optically with SF Symbols and have a documented reason to exist.

**Exit criteria**

- No emoji is used as product iconography unless explicitly approved as content.
- Every icon-only control has a concise label.
- Common actions use familiar symbols or a tested alternative.
- Symbols remain legible at actual rendered size and in increased-contrast mode.

### F5 — Core component library

Build only after F1–F4 are approved:

- primary, secondary, destructive, icon, and loading buttons;
- tab/navigation items and toolbars;
- list/card/row patterns;
- status labels and badges;
- text fields, secure fields, search, text editor, numeric entry, pickers, toggles, checks, and
  validation messaging;
- section headers, progress, timers, and instrument numerals;
- loading/skeleton, stale-content banner, empty, error, offline, sync, and permission states;
- menus, action/confirmation sheets, critical alerts, full-screen covers, and nonblocking feedback;
- photo/document thumbnails, upload progress, and failure receipts;
- accessibility wrappers only where standard components do not already provide correct semantics.

Every component has a state contract:

| State family | Required examples |
|---|---|
| Interaction | Rest, pressed, focused, selected, disabled, loading |
| Data | Cold loading, stale, empty, loaded, partial, error |
| Connectivity | Offline, queued, syncing, retrying, failed, synced |
| Authorization | Signed out, session expired, inactive employee, forbidden, reassigned |
| Permission | Not requested, granted, limited, denied, restricted, unavailable |
| Mutation | Draft, validating, submitting, committed, uncertain outcome, duplicate, conflict |
| Accessibility | Large text, VoiceOver, Reduce Motion, Differentiate Without Color, Increased Contrast |

**Exit criteria**

- Components use real native controls where appropriate.
- Every state has a visual and accessible description.
- Components have previews covering theme, size, locale, and state variants.
- No feature module owns a duplicate shared primitive.

### F6 — Motion and haptics

Define a restrained vocabulary:

- native navigation and sheet transitions remain system-owned;
- high-frequency state switches prefer immediate feedback;
- custom motion communicates continuity or consequence rather than decoration;
- timers never animate every digit change;
- Reduce Motion replaces spatial movement with an immediate change or restrained crossfade;
- no essential meaning depends on motion or haptics;
- haptics are reserved for selection, meaningful threshold, commit, success, warning, and failure;
- background events do not generate gratuitous haptics.

SwiftUI exposes system accessibility preferences including Reduce Motion, Differentiate Without
Color, VoiceOver, and Reduce Transparency. See
[`EnvironmentValues`](https://developer.apple.com/documentation/swiftui/environmentvalues) and
[`accessibilityReduceMotion`](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion).

**Exit criteria**

- Motion is categorized by purpose and frequency.
- Every custom transition has a reduced-motion behavior.
- Haptics are tested on device and never required to understand the outcome.
- Repeated field use does not produce sensory fatigue.

### F7 — Documentation and enforcement

Create:

- semantic token catalog;
- component catalog with code examples and state previews;
- accessibility notes and VoiceOver phrases;
- native navigation/presentation pattern catalog;
- design-decision register;
- deprecation list for replaced components;
- review checklist at `templates/design-review-checklist.md`;
- preview and snapshot coverage for shared components.

The design system receives an explicit version. Breaking changes require a migration note and
owners for affected features.

## 5. Accessibility acceptance contract

SwiftUI supplies baseline accessibility for standard controls, but custom composition still requires
deliberate structure and testing. See
[SwiftUI Accessibility Fundamentals](https://developer.apple.com/documentation/swiftui/accessibility-fundamentals).

Every screen and component must address:

### 5.1 Dynamic Type

- All meaningful text scales.
- Horizontal rows reflow before important labels clip.
- Controls remain reachable at accessibility sizes.
- User-generated text is not forcibly truncated without a way to read the full value.
- Fixed-height text containers are prohibited unless the content is fixed and proven to fit.

### 5.2 VoiceOver

- Reading order matches task order, not accidental view-tree order.
- Composite rows have a concise label, value, hint only when needed, correct trait, and relevant
  custom actions.
- Status changes and mutation outcomes are announced without stealing focus unexpectedly.
- Timers do not announce every tick.
- Charts/timelines provide a meaningful textual summary.
- Decorative symbols and repeated visual metadata are hidden from the accessibility tree.

### 5.3 Voice Control and Switch Control

- Visible labels match spoken names.
- Targets are not gesture-only.
- Swipe actions have accessible alternatives.
- Focus order is stable and does not trap the user.
- Custom controls expose standard actions and values.

### 5.4 Visual settings

- Increased Contrast remains readable.
- Differentiate Without Color exposes shape/text equivalents.
- Reduce Transparency replaces material with an opaque, readable surface.
- Bold Text and Display Zoom do not collapse hierarchy.
- Smart Invert does not corrupt photos, scans, or thermal imagery.

### 5.5 Motion and cognitive load

- Reduce Motion is respected.
- Repetitive, blinking, or peripheral animation is avoided.
- One primary action and progressive disclosure reduce choice overload.
- Multistep work communicates current step, remaining work, save state, and safe exit.

### 5.6 Verification

Apple's Accessibility Inspector can detect issues including missing descriptions, small hit regions,
contrast, clipped Dynamic Type text, and traits. Automated audits are required for stable screens,
but do not replace manual VoiceOver completion. See
[Performing accessibility audits](https://developer.apple.com/documentation/accessibility/performing-accessibility-audits-for-your-app)
and [Performing accessibility testing](https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app).

## 6. Field-condition acceptance contract

Every primary workflow is reviewed under these conditions:

| Condition | Required design response |
|---|---|
| Bright sunlight | High primary contrast, visible control boundaries, no low-contrast material-only hierarchy. |
| Gloves/wet fingers | Large targets, adequate separation, whole-row actions, no tiny drag handles as the sole control. |
| One-handed use | Frequent actions in comfortable reach; safe alternative for top-edge controls. |
| Poor/no network | Last-good content stays visible; queued versus committed is unambiguous. |
| Noise | Sound is never the only feedback; haptic and visual receipts are available. |
| Darkness | Approved dark appearance; no glare-heavy full-white transition screens. |
| Interruption | Draft and navigation state recover after lock, phone call, backgrounding, and termination. |
| Low battery/data | Avoid decorative work, uncontrolled polling, full-resolution list media, and unnecessary location use. |
| Camera/location denied | Explain impact in context and offer Settings or a manual alternative where valid. |
| Stress/time pressure | One primary action, plain verbs, no hidden destructive gestures, clear recovery. |

Field evaluation compares the **same task and content** in the current PWA, committed Apple Field
Pro prototype, and field-adapted SwiftUI prototype. Owner approval and representative-technician
evidence remain separate. The detailed comparison protocol and per-screen maturity live in
`03a-apple-field-pro-adaptation-matrix.md`.

## 7. Prototype and real-device gates

A component is not approved from a static image alone.

### Simulator/preview gate

- Smallest and largest supported iPhone.
- Approved iPad size classes if applicable.
- Portrait and approved landscape.
- Light, dark, and increased contrast.
- Default, largest standard, and accessibility Dynamic Type.
- English plus the longest supported localized strings.
- Offline/error/permission states.

### Automated gate

- Component tests for state and accessibility values.
- Screenshot or image-diff evidence for stable visual contracts where useful.
- UI accessibility audit for every stable screen.
- UI tests use accessibility identifiers for dynamic/localized controls, not visible English strings.

### Physical-device gate

- VoiceOver workflow completion.
- Keyboard, dictation, numeric keypad, and focus behavior.
- Sheet detents, swipe-back, scrolling, and system gesture interaction.
- Camera/photo/document capture.
- Haptics and Reduce Motion.
- Light/dark readability indoors and in sunlight.
- Memory, thermal, and energy behavior during repeated field use.
- Real supported-device safe areas and rotation.

Device-only failures are recorded as blocked when the necessary hardware, identity, permission, or
service is unavailable; an optional check must not stall the entire design program.

## 8. How the system evolves through vertical slices

The foundation is comprehensive; the domain library is incremental.

For each vertical slice:

1. Inventory the needed UI against the component catalog.
2. Compose existing primitives first.
3. If a gap exists, document the reusable requirement and reject screen-specific styling when a
   shared concept is present.
4. Add the component with its full state/accessibility matrix.
5. Exercise it in the real workflow, not only a gallery.
6. Review on device.
7. Add it to the catalog and record ownership.
8. Deprecate any temporary duplicate and migrate its callers before marking the slice complete.

This prevents two failure modes:

- designing only a handful of generic components and discovering late that critical states were
  omitted;
- designing every imagined domain component up front and accumulating unused abstractions.

## 9. Definition of ready for first-slice acceptance and foundation scaling

The native design foundation is ready to be frozen and reused broadly when:

- section 2 reuse/departure decisions are owner-approved;
- every first-slice screen is classified under the Apple Field Pro adaptation matrix, and every
  departure has a recorded reason and evidence gate;
- F1–F7 exit criteria pass;
- the first end-to-end workflow prototype passes owner and physical-device review;
- navigation, Dynamic Type, symbol, theme, motion, and field-state conventions are frozen at the
  foundation level;
- the component catalog covers all controls needed by the first vertical slice;
- accessibility audits and manual VoiceOver evidence exist;
- open items are explicitly blocked or deferred with owners;
- no application feature code needs to invent a foundational visual or interaction rule.

It is **not** necessary to prebuild every Dry Logs, DocuSign, messaging, camera, or AI component
before the first slice. Those components join the system through section 8 when their real workflow
is designed.

Provisional implementation of the single owner-selected slice may begin after the Phase 0
first-build gate using fakes or isolated QA. Missing physical-device or representative-technician
evidence must be recorded as **Blocked** and prevents acceptance/freeze/scaling; it does not stall
unrelated Simulator or contract work.
