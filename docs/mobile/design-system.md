<!--
FILE: docs/mobile/design-system.md

WHAT THIS DOES (plain language):
  Records the mobile visual and interaction conventions that exist today, then labels the proposed
  consolidation needed to make them one coherent system.

DEPENDS ON:
  Internal: UPR-Design-System.md, src/index.css, src/components/ui/,
            src/components/tech/, src/components/admin-mobile/,
            .claude/rules/tech-mobile-ux.md
  Data:     reads → documentation and UI source only
            writes → documentation only

NOTES / GOTCHAS:
  - Current standards and proposed standards are separate below.
  - Do not invent tokens or primitives in implementation without design ownership and rendered QA.
-->

# Mobile Design System

**Last verified:** 2026-07-25 against audit snapshot
`ef305f6d6afab4d846eab92fc1b04038d70221f0`.

## Authority and current reality

`UPR-Design-System.md` remains the platform-wide design authority. Field-mobile adds the
`.tech-layout` token scope and `tv2-*` primitives; admin-mobile uses `am-*` primitives over shared
platform roles.

Three generations currently coexist:

1. legacy tech pages with substantial inline style objects;
2. tech v2 field primitives/classes;
3. admin-mobile components/classes.

That is current architecture, not permission to create a fourth system. New mobile work should reuse
the appropriate existing primitive and token. Consolidation must be incremental and regression-tested.

## Current implemented foundations

### Color roles

Use existing CSS custom properties rather than copying values:

- shared surfaces/text/borders: `--bg-*`, `--text-*`, `--border-*`, `--accent*`;
- field scope: `.tech-layout` `--tech-*`;
- semantic workflow states: `--status-*` background/foreground/border roles for scheduled,
  en-route, working, paused, completed, and related statuses;
- dark mode: existing scoped token rebinding under the current theme selector.

Hard-coded color remains in legacy/dynamic code, but it is debt—not the pattern for new work.
Status must never be conveyed by color alone; pair it with text/icon/accessible name.

### Typography

- Use the inherited platform font family and existing type roles.
- Form/search/composer controls on mobile use at least 16px text where iOS focus zoom would
  otherwise occur.
- Preserve readable line height and do not encode information only through font weight.
- A new font/weight must satisfy the existing performance/font-loading rules; do not add a
  render-blocking font request.

### Spacing, radius, shadow, and elevation

Use existing `.tech-layout`, shared, `tv2-*`, or `am-*` values/classes. The audited implementation
contains multiple legacy radius/shadow/overlay values; they are not a canonical scale. Until a
reviewed token consolidation lands:

- copy a matching existing primitive, not a numeric value from an unrelated screen;
- keep surfaces/elevation purposeful (sheet, tab bar, modal, card);
- account for `env(safe-area-inset-top/bottom)` on docked edges;
- avoid new blur/shadow effects without performance and dark-mode review.

## Current mobile primitives

### Shared platform

`Modal`, `IconButton`, `SearchInput`, `StatusPill`, `EmptyState`, `ErrorState`, `PageHeader`,
platform buttons/inputs/cards, and the global toast service.

### Field

- shell/layout: `TechLayout`, `TechPane`, `TechV2Page`, `Hero`, `ActionBar`;
- information: `StatusChip`, `DetailRow`, appointment rows, `RoomCard`, `RoomChip`, skeletons;
- media: `PhotosGroup`, `Lightbox`, `PhotoNoteSheet`;
- field input: reading/equipment/room sheets;
- workflow: `TimeTracker`, clock supersession, e-sign, offline status;
- v2 Dashboard/Schedule/Messages/Job Hub subcomponents.

### Admin-mobile

`AdminMobilePage`, access guard, headers/tabs/list rows, stat/money cards, totals, period controls,
invoice/payment/estimate/lead components, and route helpers.

Use the primitive owned by the surface. Reusing business logic does not require compressing a desktop
presentation into a mobile viewport.

## Interaction states

Every interactive control must implement:

- default and clear affordance;
- pressed/touch feedback;
- visible `:focus-visible`;
- selected/current state where applicable;
- disabled state that prevents the action and explains why when material;
- loading/busy state that prevents duplicate submission;
- success and actionable failure;
- accessible name/role/value and keyboard activation.

Hover may be additive for pointer devices but cannot be the only affordance. Touch targets use the
field 48px target; a 44px dense secondary exception must be deliberate and documented. Do not create
new smaller primary controls.

## Navigation conventions

- Primary field modules use the five-tab safe-area-aware `TechLayout` bar.
- Nested details/forms use a visible route header/back action and real router history.
- Job/appointment links use the current centralized link helpers where applicable.
- Do not navigate by mutating `window.location` for internal routes.
- A modal/sheet dismissal is not silently treated as a route change; overlay and history priority
  must follow the navigation contract in `architecture.md`.
- The primary action should remain reachable one-handed without covering the home indicator,
  keyboard, or required content.

## Modal and sheet conventions

### Current approved behavior

Prefer shared `Modal` when its presentation fits because it has the strongest focus lifecycle.
Existing specialized field sheets may remain until migrated, but new ones must include:

- semantic dialog role and accessible name;
- initial focus, focus containment, and return focus;
- backdrop, explicit close, Escape, and platform-back behavior;
- safe-area bottom padding and keyboard avoidance;
- no dismissal during a non-cancelable critical commit;
- entry/exit and reduced-motion behavior from `motion-system.md`.

### Proposed consolidation

A canonical `MobileSheet` primitive is **proposed, not currently complete**. It should wrap the shared
modal lifecycle and allow bottom-sheet presentation/content slots. Do not introduce it as an
additive duplicate; migrate and delete equivalent local behavior in reviewed slices.

## Loading, empty, error, offline, and success

### Current standard

- Cold initial load: use the appropriate shared/v2 skeleton.
- Background refresh/resume: retain usable data and refresh silently where safe.
- Empty: render only after a successful zero-result response.
- Error: explain what failed and offer retry/recovery; do not convert a permission/network error to
  an empty state.
- Mutation: disable duplicate submission, show progress, confirm durable success, and surface
  partial/ambiguous outcomes.
- Offline: distinguish cached/stale data, queued work, sync error, and online-required action.
- Update: stale-chunk reset exists; do not invent a success/update banner without the release
  lifecycle supporting it.

### Proposed shared route states

The following consolidation is proposed:

1. cold skeleton;
2. stale-data banner with refresh age/action;
3. actionable error with safe retry/reset;
4. successful empty state;
5. offline/queued/reconciliation state;
6. durable success/partial-success result.

It must reuse current `EmptyState`/`ErrorState`/skeleton/toast behavior rather than create another
parallel kit.

## Destructive and high-impact actions

Follow the project's established two-step/two-click destructive pattern. Typed confirmation may be
used for rare, high-blast-radius operations such as job archive/merge when the domain owner requires
it. The server/database must authorize and enforce the action regardless of confirmation UI.

Money, company messages, provider operations, role changes, deletion, and media removal require:

- clear object/action/impact;
- busy/duplicate protection;
- deterministic result or explicit reconciliation;
- server authorization and audit trail;
- accessible confirmation/failure.

## Known current inconsistencies

- legacy, v2, and admin-mobile headers/sheets/toasts/loaders coexist;
- approximately 1,388 inline style objects were counted in the audited mobile source;
- legacy and v2 job workflows overlap;
- focus/semantic behavior is not consistent across task rows and custom sheets;
- scope sheet implementation and navigation status disagree;
- device `sms:` shortcuts use a different compliance boundary than in-app messages;
- global CSS exceeds its current budget.

These facts should guide consolidation order; they are not instructions for a broad rewrite.

## Required visual/accessibility verification

For changed mobile UI, render the actual route and states at:

`320`, `360`, `375`, `390`, `412`, `430`, and `768` CSS pixels, plus relevant tablet landscape/
split-view. Cover light/dark, reduced motion, zoom/Dynamic Type, keyboard open, long/localized
content, safe areas, loading/error/empty/offline, and destructive confirmation.

Run semantic/keyboard/axe checks and complete VoiceOver/TalkBack on critical workflows before
release. A fixture or stored CSS review is not rendered application proof.
