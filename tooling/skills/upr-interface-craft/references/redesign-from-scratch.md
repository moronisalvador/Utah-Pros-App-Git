# UPR replacement interface program

Read this only for planning or executing the future full web/mobile redesign.

## Binding product direction

The owner has defined the redesign as a replacement built from scratch because the current visual
system is inconsistent, unpleasant, and different across pages. The current UI is evidence of
features, workflows, terminology, edge cases, and failure modes. It is not the visual foundation and
must not be averaged into the replacement.

“From scratch” applies to the design language, interaction model, component system, and shell
composition. It does not authorize a simultaneous rewrite of business logic, data contracts,
authorization, or every route. Design the system as one whole; introduce it in complete, reversible
surface waves.

Do not start replacement execution until the priority feature and bug-fix contracts—including dry
logs, rooms, and notes—are stable enough that the redesign will not chase moving workflows.

## Program sequence

### 1. Inventory product truth

- Inventory every route, shell, user role, primary journey, shared primitive, state, theme, and
  platform-specific behavior.
- Capture representative screenshots at mobile and desktop widths only as workflow evidence and
  anti-reference.
- Record current accessibility, performance, bundle, CSS, usability, and device baselines.
- Identify the highest-frequency and highest-consequence journeys for technicians and office staff.
- Separate product debt from visual debt; do not hide behavior changes inside visual replacement.

### 2. Establish the product and visual brief

- Run Impeccable `init` with the owner to create durable product context.
- Define users, environments, brand character, design principles, voice, emotional target, and what
  the replacement must never feel like.
- Create genuinely distinct concepts against the same representative mobile and desktop journeys.
- Select one concept explicitly. Do not blend rejected concepts into a safe compromise.
- Persist the approved direction in the Impeccable product, design, and surface-brief artifacts.

### 3. Design the system before multiplying screens

Define and test:

- typography and numeric treatment;
- semantic color, contrast, themes, and status language;
- spacing, sizing, grids, density, radii, elevation, and materials;
- navigation, shells, page composition, and responsive transformations;
- motion tokens, interaction feedback, gesture alternatives, and reduced motion;
- buttons, inputs, selection controls, tables/lists, cards, sheets, dialogs, navigation, feedback,
  loading, empty, error, permission, and offline states;
- content voice, labels, destructive confirmation, and recovery;
- accessibility and device/input requirements.

Use semantic tokens and a versioned replacement boundary. Do not add replacement tokens to every
legacy kit or let legacy classes leak into replacement surfaces.

### 4. Prove two reference journeys

Build one demanding technician journey and one dense office journey before scaling the system.
Choose flows that exercise forms, media/data, errors, navigation, loading, long content, permissions,
resume, and motion. Validate with the owner on a real iPhone and representative desktop before
declaring the component system ready.

Revise the system from those journeys, not from isolated component-gallery beauty.

### 5. Roll out complete surface waves

- Establish the replacement foundation and shell seam once.
- Migrate complete journeys or route families, not scattered controls across unrelated pages.
- Keep each wave visually coherent, reversible, and contract-compatible.
- Use an explicit flag, shell, or scoped root when coexistence is necessary.
- Do not duplicate business logic to support both looks; preserve shared behavior beneath the
  presentation seam.
- Delete legacy visual code only after its last consumer is proven retired.

### 6. Gate every wave

Require:

- acceptance criteria for task completion and error recovery;
- rendered mobile/desktop/theme/state evidence;
- keyboard, screen-reader semantics, contrast, zoom, and target-size checks;
- minimize/resume, long-content, empty/error/offline, and permission-denied checks;
- bundle/CSS/performance comparison;
- strict motion review when motion changed;
- real iPhone/WKWebView validation for gesture, keyboard, haptic, safe-area, sunlight, and sustained
  performance claims;
- rollback and an honest list of remaining legacy surfaces.

## Completion bar

The replacement is complete only when the active application has one documented visual language,
one coherent component vocabulary, predictable behavior across pages, no legacy-kit leakage into
replacement surfaces, and measured mobile/web usability. A redesigned screenshot set without full
state, workflow, accessibility, and device coverage is not completion.
