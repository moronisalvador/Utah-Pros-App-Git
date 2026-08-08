---
name: upr-interface-craft
description: Supporting UPR UI/UX specialist for substantial React web/PWA or Capacitor iOS interface work. Use with new-feature or masterplan for new pages and surfaces, material component or interaction changes, mobile/native adaptation, reusable primitives, or the replacement design system. Skip trivial copy, icon, or existing-token fixes and backend work. Impeccable owns visual direction; project law remains binding.
---

# UPR interface craft

Create one coherent, production-grade UPR interface language without turning every small UI edit into
a design project. This is a supporting specialist: `new-feature` still owns ordinary implementation
and `masterplan` still owns the future cross-app redesign program.

## 1. Preserve the authority stack

Use this precedence:

1. Current owner instruction and the requested outcome.
2. `AGENTS.md`, `CLAUDE.md`, `UPR-Design-System.md`, and applicable `.claude/rules/`.
3. The accepted product/surface brief and real workflow evidence.
4. `impeccable` as visual-direction and interface-craft lead.
5. `apple-design` and `emil-design-eng` as conditional taste specialists.

Vendor guidance never overrides UPR behavior, accessibility, performance, authorization, or
component contracts. Do not import a library, framework, font, or runtime dependency because a
specialist recommends it; UPR's stack and performance budget decide implementation mechanics.

## 2. Classify the design lane

| Lane | Examples | Required path |
|---|---|---|
| Trivial correction | Typo, icon swap, existing token, disabled state with an established pattern | Do not load the design suite. Make the narrow project-law-compliant correction. |
| Bounded refinement | Improve hierarchy, layout, form flow, responsive behavior, component feel | Run Impeccable setup for the target and preserve the incumbent visual world outside scope. |
| New surface | New page, workflow, reusable primitive, or materially new interaction | Use Impeccable `new-work`; establish the surface brief before editing. |
| Replacement system | Full mobile/web redesign or a new visual language across shells | Route planning through `masterplan`, then read [redesign-from-scratch.md](references/redesign-from-scratch.md). |

Until the replacement program begins, the current design system remains the live compatibility
contract: reuse its closest primitive and do not invent another kit. During the replacement program,
the owner has explicitly rejected the current visual system as a foundation. Preserve product truth,
workflows, data contracts, and native affordances, but do not blend the discarded look into the new
world.

## 3. Establish interface truth

Before choosing visuals:

1. Read the target and at least one representative source of incumbent visual or workflow truth.
2. Identify the user, physical environment, primary job, frequency, urgency, and failure consequence.
3. Map cold loading, success, empty, error, stale data, mutation, disabled, offline, permission-denied,
   long-content, keyboard/focus, resume, and reduced-motion states.
4. State the visual lane, acceptance criteria, non-goals, and contracts that cannot change.
5. Run Impeccable's context setup once for the target and follow its selected playbook.

For technician surfaces, design for the persona in `.claude/rules/tech-mobile-ux.md`: older,
non-technical, one-handed, gloved, wet, hurried, and often in poor light. For office surfaces,
optimize dense work for scanability without turning every datum into a card.

## 4. Select specialists deliberately

- Use `impeccable` for visual direction, information hierarchy, typography, color, composition,
  responsive adaptation, critique, and polish.
- Add `apple-design` for gesture-driven surfaces, sheets, swipe/drag behavior, spatial consistency,
  materials, native typography, or iPhone-specific interaction questions.
- Add `emil-design-eng` for motion decisions and the micro-details that make a component feel
  responsive. UPR motion tokens and `.claude/rules/motion-standard.md` remain binding.
- Invoke `review-animations` by name only when motion changed; it is a strict close-out review, not a
  design director.

Do not stack specialists by default. Each loaded specialist must answer a concrete question the
primary workflow cannot answer alone.

## 5. Build the smallest complete interface

Use the selected visual direction consistently across the whole touched surface:

- prefer shared primitives and semantic tokens over page-local variants;
- use one kit per live surface and one replacement-system boundary during redesign;
- keep one obvious primary action and make dangerous actions deliberately harder;
- use semantic controls, persistent labels, visible focus, useful error recovery, and gesture
  alternatives;
- keep text resilient to long values and translation;
- make touch targets, safe areas, keyboard behavior, and coarse-pointer behavior intentional;
- use motion to explain spatial change or provide feedback, never to decorate routine work;
- preserve loading, resume, scroll, mutation, and navigation behavior from the page lifecycle laws;
- fit the established bundle, CSS, image, font, and query budgets.

Do not declare a component complete because the happy-state screenshot looks good.

## 6. Verify the experience, not just the source

For changed pages or substantial components:

1. Render at 390px and the representative desktop width; include light/dark themes when supported.
2. Exercise loading, empty, error, long-content, pending mutation, and permission-denied states.
3. Verify keyboard order, focus visibility, accessible names, pointer/touch behavior, and reduced
   motion.
4. Run the minimize/resume test without losing content, scroll, or in-progress input.
5. Compare against the accepted brief and run one bounded Impeccable inspection/fix pass.
6. Run `design-consistency-checker`, `page-behavior-checker`, and
   `interface-accessibility-reviewer`; add `review-animations` when motion changed.
7. Record Chromium/browser evidence separately from real iPhone/WKWebView feel. Gestures, haptics,
   safe areas, keyboard behavior, sunlight legibility, and sustained device performance require an
   owner on-device gate when they matter.

Report what was visually rendered, what was source-reviewed, and what remains device-gated.
