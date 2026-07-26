<!--
════════════════════════════════════════════════
FILE: 02-owner-decisions-and-discovery.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This document defines the conversations, evidence, and owner approvals that happen before
  the native iOS interface is designed or built. It turns preferences into recorded decisions
  so the team does not guess, skip important questions, or repeatedly reopen settled choices.

DEPENDS ON:
  Internal: CLAUDE.md · .claude/rules/tech-mobile-ux.md · UPR-Design-System.md ·
            docs/tech-redesign-design-brief.md ·
            docs/tech-redesign/TECH-DESIGN-STANDARD.md ·
            docs/tech-redesign/UX-FLOWS-BRIEF.md
  External: Apple Human Interface Guidelines and Apple accessibility guidance linked below
  Data:     reads  → none
            writes → none

NOTES / GOTCHAS:
  - This is a planning contract, not proof that a proposed choice has been approved.
  - Apple Field Pro is now the approved product/experience starting blueprint; the exact native
    visual system and unfinished workflows remain gated.
  - The current PWA is required comparative field evidence, not an automatic visual specification.
  - The process is intended to prevent avoidable rework. It cannot promise that no learning-driven
    refinement will ever be needed.
════════════════════════════════════════════════
-->

# Native iOS owner decisions and discovery

**Last-verified:** 2026-07-26
**Document status:** Apple Field Pro evolution direction approved; remaining owner discovery pending
**Implementation status:** Not started
**Scope:** Product and design decisions required before native feature UI implementation

## 1. The commitment

The native app does **not** begin with agents translating React screens into SwiftUI. It begins
with an owner-led discovery and design-standard phase.

The objective is to make important decisions when they are inexpensive to change, then freeze
them at the appropriate level before implementation. The process deliberately distinguishes:

- decisions that affect the entire app and must be made first;
- decisions that can safely evolve with a vertical workflow;
- verified facts from the existing product;
- proposed defaults that require the owner's approval;
- questions that must be validated with technicians or real devices.

Apple's current design principles likewise start with purpose and treat accessibility as a
beginning-of-design priority, not a final compliance pass. See
[Apple Design Principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
and [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios/).

## 2. Evidence and decision vocabulary

Use the evidence distinctions defined in `01-principles-and-definition-of-done.md` exactly:

| Evidence label | Meaning |
|---|---|
| **Verified** | Directly observed with command, build, catalog, device, provider, or explicit dated owner-decision evidence. |
| **Source-confirmed** | Present in the reviewed repository commit; not necessarily deployed or live. |
| **Inferred** | Reasoned from evidence but not directly observed. |
| **Blocked** | The check could not run safely because an explicit dependency was absent. |
| **Owner gate** | Requires a product, legal, account, credential, device, signing, cost, or release decision. |
| **Not tested** | Applicable work was omitted; it is not equivalent to blocked. |

Record provenance separately as `repository`, `owner`, `user/device`, or `external provider`.
Decision lifecycle is also a separate field: `proposed`, `approved`, `deferred`, or `superseded`.
This preserves a clear verified-versus-proposed distinction without inventing a second evidence
vocabulary. No agent may present a proposed or inferred choice as a verified owner decision.

## 3. Decisions already supported by current evidence

| ID | Status | Decision or fact | Boundary |
|---|---|---|---|
| `NIOS-OD-001` | **Verified · owner · approved 2026-07-25** | Build a new Swift app from the ground up while keeping the current PWA/Capacitor product operational. | This authorizes planning, not production access, database changes, or Swift implementation on this documentation branch. |
| `NIOS-OD-002` | **Verified · owner · approved 2026-07-25** | The native plan must include the complete design-discovery and design-system process before feature implementation. | Apple Field Pro evolution is now approved; exact native component, token, device, and field-adaptation choices remain open. |
| `NIOS-OD-003` | **Source-confirmed · repository** | The field interface is for a 64-year-old, nontechnical technician using one hand, possibly with gloves, wet fingers, poor connectivity, noise, and direct sunlight. | This persona remains a hard usability constraint unless the owner explicitly expands the user model. |
| `NIOS-OD-004` | **Source-confirmed · repository** | The existing field redesign has a locked "Apple Field Pro" direction, detailed foundations/components, and owner-approved workflow decisions. | Those artifacts are now preserve-by-default product/experience evidence, not automatic SwiftUI code, pixels, a frozen native visual system, or proof for unfinished flows. |
| `NIOS-OD-005` | **Source-confirmed · repository** | Status meaning is currently shape-redundant: color is paired with a word and a recognizable glyph. | Native work must preserve meaning without relying on color alone, even if the palette or symbol artwork changes. |
| `NIOS-OD-006` | **Source-confirmed · repository** | The existing redesign prioritizes one primary action, large field targets, visible offline/sync state, and distinct loading/empty/error states. | These are behavioral requirements; their native presentation may change. |
| `NIOS-OD-007` | **Verified · owner · approved 2026-07-26** | Evolve Apple Field Pro as the native blueprint: preserve its refinements, layouts, information hierarchy, and workflow decisions by default, then adapt them for native iOS and field use. | This closes preserve/evolve/replace, but does not approve exact native tokens, controls, typography, tab structure, devices, or unfinished flows. |
| `NIOS-OD-008` | **Verified as owner report · owner · 2026-07-26** | Technicians have found the current PWA easier on the eyes and easier to use with gloves; native design must learn from those strengths. | The report requires fresh comparative technician/device validation before it becomes direct field evidence. |

## 4. Owner decisions required before native visual design

The discovery session asks these questions using **concrete, phone-openable examples**, not an
abstract questionnaire. For each item the design lead presents a recommended default and one or
two materially different alternatives, including the tradeoff.

### 4.1 Product identity and design continuity

The first question is closed: native UPR is an **evolution of Apple Field Pro**, not a restart.
Use `03a-apple-field-pro-adaptation-matrix.md` to preserve its locked workflow/layout decisions and
to identify incomplete areas. Ask only the remaining questions:

1. Which existing elements must remain visually recognizable beyond the approved layouts and
   workflow refinements: ink-first identity, status meanings, palette,
   typography, icon character, card shapes, information density, or none?
2. Should the native app feel closest to:
   - an Apple first-party field tool;
   - a distinct UPR-branded professional instrument;
   - a rugged utility with minimal visual decoration?
3. What should a technician feel in one word after opening it: calm, certain, fast, capable,
   guided, or something else?
4. On the same real workflow, which current-PWA choices are easier to read, reach, or tap than the
   Apple Field Pro prototype, and why?
5. Which Apple Field Pro screen is closest to the desired quality bar, and which visual details
   still need field adaptation?

### 4.2 Users and environments

1. Are field technicians the only initial users, or must project managers, office users, and
   administrators use the native app at launch?
2. What is the oldest iPhone and minimum iOS version that must be supported?
3. Is iPad required at launch? If so, is it an enlarged iPhone layout or a first-class,
   multi-column working environment?
4. Is portrait-only acceptable for field workflows? Which tasks require landscape, such as
   documents, photos, plans, or tables?
5. Which languages must ship at launch? The current tech standard calls for English, Spanish,
   and Portuguese; the owner must confirm the native release requirement.
6. Which accessibility needs are already known among employees?
7. Which field conditions are most common: gloves, wet hands, bright sun, darkness, ladders,
   one-handed use, poor signal, noise, or shared devices?

### 4.3 Platform character

1. Should navigation use standard SwiftUI `TabView`, navigation stacks, toolbars, sheets, menus,
   and alerts unless a documented field need requires a custom control?
2. Should the native app use San Francisco/Dynamic Type by default or carry Source Sans 3 from the
   existing redesign? The review includes large-text and sunlight examples before choosing.
3. Should common actions use SF Symbols, a custom UPR symbol family, or a controlled hybrid?
4. How much of the current custom material/elevation language should remain versus adopting the
   current iOS control layer?
5. Should light, dark, and system appearance all ship? Which is the default?
6. Which haptics are genuinely useful in a noisy field environment, and which would become fatigue?
7. Which iOS-specific features belong in the first foundation: widgets, Live Activities, App
   Intents, Spotlight, Siri, camera controls, or none until the core app is stable?

### 4.4 Navigation and information architecture

1. What are the four or five top-level destinations?
2. Is the job hub the center of field work, with Dry Logs, rooms, documents, tasks, and visits
   nested beneath it?
3. Does Messaging remain a top-level destination?
4. What must be reachable in one tap from Today, and what may require a drill-in?
5. Which administrative capabilities should remain web-only?
6. What should happen when a deep link or notification opens an item the employee is no longer
   authorized to view?

### 4.5 Safety, interruption, and recovery

1. Which actions are reversible, terminal, financially sensitive, or legally significant?
2. When is a two-step confirmation preferred, and when should native undo be used?
3. What should remain visible during offline operation, sync, retry, conflict, or permission loss?
4. Which drafts must survive app termination, phone restart, or account switch?
5. Which actions may continue in the background, and what visible receipt proves completion?
6. What is the acceptable experience when camera, location, notifications, Photos, microphone,
   biometrics, or cellular access is denied?

## 5. Recommended discovery sequence

### Gate D0 — Evidence pack

The orchestrator prepares a concise evidence pack before asking the owner for visual reactions:

- current PWA/Capacitor screen and workflow census;
- locked tech redesign decisions, prototypes, and unresolved items;
- the preservation/adaptation classifications in `03a-apple-field-pro-adaptation-matrix.md`;
- native platform patterns from current Apple guidance;
- representative field conditions and supported-device assumptions;
- accessibility, localization, permissions, and offline constraints;
- list of decisions that would materially affect architecture or rework.

**Exit criteria**

- Every claim is labeled using section 2.
- Existing decisions and open questions are separated.
- No production data or secrets appear in the pack.
- The pack includes at least one real data-dense workflow, not only a polished dashboard.

### Gate D1 — Field-adaptation workshop

The owner has already selected Apple Field Pro as the layout/workflow/refinement blueprint. Do not
present unrelated blank-slate product directions or ask preserve/evolve/replace again. The exact
native visual system remains a real design decision. The design lead compares the same realistic
content and task in:

1. the current PWA/Capacitor experience;
2. the committed Apple Field Pro prototype; and
3. one or two field-adapted native-intent design translations of Apple Field Pro.

The Session A translations are non-production design artifacts, not Swift implementation.

Use Today plus one data-dense job task where useful. Dry Logs is a candidate, not a preselected
first slice. Each field-adapted translation demonstrates:

- light and dark appearance if both are proposed;
- smallest supported iPhone and a large iPhone;
- standard and accessibility Dynamic Type;
- offline/error state;
- one-handed reach and primary-action placement;
- the same realistic content so the comparison is meaningful.

The owner reacts in plain language. The design lead converts the reaction into a dated decision
record and asks for explicit confirmation.

**Exit criteria**

- Product feeling and the Apple Field Pro preservation/adaptation boundary are recorded.
- Font strategy, symbol strategy, theme strategy, and platform-native control posture are decided.
- Supported form factors and orientation assumptions are recorded.
- Rejected field adaptations and the reason for rejection remain documented.

### Gate D2 — Non-production foundation prototype

Before the Xcode scaffold, the selected direction becomes a phone-openable design/interaction
prototype covering:

- colors/materials and semantic states;
- Dynamic Type typography;
- spacing, safe-area behavior, and density;
- symbols and icon-only controls;
- buttons, rows, lists, fields, pickers, tabs, toolbars, sheets, menus, alerts, banners, and
  feedback;
- loading, stale, empty, error, offline, queued, syncing, failed, disabled, permission-denied,
  success, and destructive-action states;
- reduced motion, increased contrast, and differentiate-without-color variants.

**Exit criteria**

- The owner approves the direction while viewing it at representative iPhone dimensions.
- Accessibility structure, reading order, Dynamic Type reflow, contrast, reduced-motion and control
  semantics are annotated; this is design evidence, not compiled/device proof.
- The foundation's accepted decisions are recorded in `03-design-system.md`.

### Gate D3 — Compiled SwiftUI reference and first workflow prototype

After the approved nonproduction scaffold exists, the owner-selected slice may be implemented
provisionally against fakes/isolated QA. Before that slice is accepted, described as field-
validated, used to freeze the foundation, or copied into additional features, exercise it as one
complete workflow:

`<entry> → <authorized context> → <draft/action> → <confirmation or recovery>`.

Dry Logs is a strong candidate because it exercises numeric entry, offline work and field
documentation, but it is not selected until the owner records the choice. If selected first, the
roadmap merges/reorders its later Dry Logs phase rather than implementing it twice.

This is intentionally more demanding than a static component catalog. It reveals whether the
navigation, keyboard, numeric entry, state hierarchy, and feedback work together.

**Exit criteria**

- The workflow can be completed at all Dynamic Type accessibility sizes without clipped actions or
  hidden fields. Any safety-driven exception requires an approved alternate large-content view.
- VoiceOver can complete the primary task.
- Simulator evidence exists first. Keyboard, safe areas, interaction and numeric entry are then
  verified on a physical iPhone before the foundation is accepted.
- Offline, interruption, and failure paths are demonstrated.
- The owner approves the workflow, not only screenshots.
- At least one representative field technician completes the task-based usability session. If that
  person or device is unavailable, record a named human/device gate and do not call it field-
  validated.

### Gate D4 — Design foundation freeze

The foundation becomes **stable**, not immutable:

- global tokens, navigation rules, accessibility floors, field-state vocabulary, and core
  component contracts require an architecture/design decision to change;
- domain-specific components may be added by later slices;
- a real usability finding may reopen a decision with evidence and migration impact.

No feature agent may silently fork the system.

## 6. How owner approval works

Each decision uses this record:

```text
Decision ID:
Question:
Evidence reviewed:
Options shown:
Recommended option and reason:
Owner choice:
Rejected alternatives:
Consequences:
Revisit trigger:
Approved by:
Approval date:
Evidence link:
```

Approval is valid only when the owner explicitly chooses or confirms an option. A prototype being
opened, silence, or implementation continuing is not approval. When the owner says something like
"that one, but calmer," the design lead must state the interpreted changes and receive confirmation
before calling it locked.

## 7. Preventing expensive rework without pretending to predict everything

The plan avoids known sources of rework by deciding cross-cutting foundations first:

- minimum OS/device and form-factor support;
- navigation and presentation conventions;
- Dynamic Type and accessibility behavior;
- typography and symbol strategy;
- semantic status vocabulary;
- spacing, safe-area, keyboard, and input behavior;
- loading/offline/error/conflict feedback;
- permission-denied experiences;
- design-token and component ownership.

It does **not** attempt to design every future specialty screen before learning from the first
working slice. Doing so would create speculative components that are expensive to maintain. Instead:

- complete the approved **global foundation and the selected slice's required component-state
  matrix** first;
- prototype the first end-to-end workflow before freezing the foundation;
- add specialty components only when a real vertical slice needs them;
- require every addition to meet the same accessibility, state, and device gates;
- record intentional changes rather than treating iteration as failure.

The goal is not "never touch it again." The goal is to eliminate preventable inconsistency and make
necessary learning controlled, evidence-based, and inexpensive.

## 8. Open owner decision register

| ID | Decision | Recommended starting point | Status |
|---|---|---|---|
| `NIOS-DES-001` | Layout/workflow/refinement continuity | Evolve Apple Field Pro as the preserve-by-default product/experience blueprint. | **APPROVED 2026-07-26** |
| `NIOS-DES-002` | Typography | Compare system Dynamic Type with a carefully scaled Source Sans 3 option on real field screens. | **PROPOSED** |
| `NIOS-DES-003` | Symbols | SF Symbols for platform actions; custom symbols only for UPR-specific domain concepts. | **PROPOSED** |
| `NIOS-DES-004` | Navigation | Native tab/navigation containers; do not reproduce WebView shell behavior. | **PROPOSED** |
| `NIOS-DES-005` | Theme | Ship light and dark with system support; decide default after device comparison. | **PROPOSED** |
| `NIOS-DES-006` | Device family | iPhone-first; iPad support requires a separately approved adaptive IA. | **PROPOSED** |
| `NIOS-DES-007` | Orientation | Portrait-first; selectively support landscape where documents/media justify it. | **PROPOSED** |
| `NIOS-DES-008` | Languages | Confirm English/Spanish/Portuguese launch scope before string freeze. | **PROPOSED** |
| `NIOS-DES-009` | Existing flow decisions | Preserve owner-locked Apple Field Pro workflow/layout decisions by default; explicitly reopen only unfinished or evidence-invalidated areas. | **APPROVED 2026-07-26** |
| `NIOS-DES-010` | Current iOS materials | Use system materials where they improve hierarchy; never adopt visual novelty at the cost of field readability or battery. | **PROPOSED** |
| `NIOS-DES-011` | Current PWA field lessons | Compare the current PWA, Apple Field Pro, and adapted SwiftUI using the same tasks; use PWA strengths for readability, reach, gloves, and clarity. | **APPROVED 2026-07-26; exact adaptations pending evidence** |
| `NIOS-DES-012` | Exact native visual system | Start from Apple Field Pro's character, compare current-PWA field strengths, and decide colors, typography, symbols, materials, controls, and measurements through native-intent prototypes and device evidence. | **PROPOSED** |

## 9. Exit criteria for this document

This document spans two stages: Phase 0 direction discovery closes through D0–D2 and the recorded
first-build decisions; D3–D4 validate the compiled first slice later. The full design-discovery and
validation lifecycle is complete only when:

- every section 4 decision has an owner-approved record or an explicit deferral;
- the supported-device, OS, form-factor, orientation, language, and accessibility matrix is known;
- every first-slice screen has a Preserve/Translate/Adapt/Reopen/Verify classification;
- the owner has approved a real-screen direction on a physical iPhone;
- the first vertical workflow prototype has passed owner, accessibility, and field-condition review;
- a representative technician has completed the primary task, or that missing human evidence is a
  named blocker to foundation freeze rather than an assumed pass;
- open decisions have owners and revisit triggers;
- no proposal is mislabeled as verified.

Until Phase 0 closes, committed feature UI implementation remains **Blocked** by design discovery;
only an explicitly authorized disposable, uncommitted toolchain spike may precede it. After Phase 0,
the owner-selected slice may proceed provisionally, but missing physical-device or representative-
technician evidence blocks slice acceptance, foundation freeze, and scaling—not safe Simulator,
mock, or isolated-QA work.
