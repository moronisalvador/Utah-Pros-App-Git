# UPR Mobile PWA and Capacitor Audit — Design System and UI Consistency

## Current visual system

UPR has a documented shared design system and a dedicated field-tech token layer. The mobile shell
scopes typography, radii, shadows, minimum tap size, navigation height, and semantic status colors
under `.tech-layout` in `src/index.css:4549-4588`. It also rebinds shared color roles for dark mode at
`src/index.css:4617-4648`.

Three visual generations coexist inside the mobile route tree:

1. **Legacy tech pages** — large JSX files with extensive inline layout and color objects.
2. **Tech v2** — `tv2-*` classes, shared query/navigation helpers, `TechPane`, `TechV2Page`,
   `StatusChip`, row and skeleton primitives.
3. **Admin Mobile** — a responsive composition of the shared/Main design system using `am-*`
   components and styles.

That separation is documented in `UPR-Design-System.md`, but it is not visually or mechanically
complete. A static count across 127 tech page/component JavaScript files found 1,388 `style={{...}}`
objects, alongside 77 files using class-based styles. The count includes intentional dynamic and
document-rendering styles; it is a maintainability signal, not proof that every inline declaration is
wrong.

## Existing reusable primitives

### Shared/Main primitives used by mobile

- `Modal`, `IconButton`, `SearchInput`, `StatusPill`, `EmptyState`, `ErrorState`, `PageHeader`;
- global `.btn`, `.card`, `.input`, token, semantic-color, and toast conventions;
- admin-mobile cards, headers, totals, rows, money, and routing/access helpers.

### Field-tech primitives

- layout/navigation: `TechLayout`, `TechPane`, `TechV2Page`, `Hero`, `ActionBar`;
- information: `StatusChip`, `DetailRow`, `ApptListRow`, `RoomCard`, `RoomChip`, skeletons;
- media: `PhotosGroup`, `Lightbox`, `PhotoNoteSheet`;
- field input: `ReadingEntrySheet`, `EquipmentPlacementSheet`, `AddRoomSheet`;
- workflow: `TimeTracker`, `ClockSupersedeSheet`, `EsignRequestSheet`, `OfflineStatusPill`;
- dashboard/schedule/messages subcomponents under `src/pages/tech/v2/`.

The v2 dashboard, schedule, and message surfaces show the strongest consistency: status is encoded by
semantic roles, mobile inputs stay at 16px, key controls have 44–48px targets, and the primary shell
uses safe-area-aware spacing.

## Token usage

### Strengths

- `.tech-layout` defines a 48px field tap target (`--tech-min-tap`) and a consistent 64px tab bar.
- scheduled/en-route/working/paused/completed each have background/foreground/border triplets.
- the shell and bottom navigation use `env(safe-area-inset-*)`.
- the message composer/search inputs explicitly use 16px text to avoid iOS focus zoom.
- dark mode is a scoped token swap instead of a second component tree.
- the v2 schedule and message screens largely use classes and semantic tokens rather than ad hoc
  per-row objects.

### Gaps

- legacy pages and sheets repeat semantic reds, greens, ambers, overlays, shadows, and status rules as
  hard-coded hex/RGBA values.
- several bottom sheets are hand-built fixed overlays instead of the shared `Modal`/one canonical
  mobile-sheet primitive.
- the same photo upload, photo-saved toast, note/room assignment, header/back, and destructive-action
  ideas are implemented in multiple components.
- visual state can diverge between legacy `/tech/jobs/:jobId`, v2 `/tech/job/:jobId`, appointment
  detail, claim detail, and their albums.
- source CSS is 583,875 bytes and 12,575 lines; the built CSS is 422,452 bytes, beyond the project's
  400KB raw budget. A single global sheet makes dead-style ownership and regression isolation hard.

These issues are normalized as `MOB-UX-031` and contribute to `MOB-PERF-026`.

## Interaction-pattern consistency

### Consistent patterns

- persistent five-tab shell for primary destinations;
- status-first color semantics in v2 field surfaces;
- snap-first photo capture followed by optional note/room tagging;
- bottom-positioned actions and safe-area spacing for thumb reach;
- two-step or typed confirmation for destructive actions;
- skeleton-first cold loads in major v2 panes and silent refresh intent;
- error toasts and retry affordances for many mutations.

### Inconsistent patterns

- legacy pages mix inline bottom sheets, centered dialogs, lightboxes, native links, and navigation
  transitions with different dismissal/focus behavior;
- some final/destructive actions use the project two-click idiom, while others require typing
  `DELETE` in a modal; the higher-friction rule is not consistently documented by risk class;
- some loaders render shared skeletons, while other routes fall back to bare `Loading…`, empty arrays,
  or local spinners;
- some data errors preserve stale data, while others become an empty state and are indistinguishable
  from a successful zero-row response;
- the implemented Scope Sheet route is presented as “Soon” on at least one navigation surface
  (`MOB-UX-008`);
- `sms:` shortcuts use the device composer while in-app messages use UPR consent, DND, sender,
  worker, and audit controls (`MOB-COMP-003`).

## Accessibility observations

Source includes many positive accessibility details: labeled icon buttons, dialog roles on several
field sheets, radiogroups for appearance/language settings, semantic buttons for most v2 rows, and
reduced-motion rules in parts of the v2 system.

Confirmed gaps remain:

- task completion rows are clickable `<div>` elements without button/checkbox keyboard semantics at
  `src/pages/tech/TechAppointment.jsx:920` and
  `src/pages/tech/TechEditAppointment.jsx:521`;
- `.tech-nav-tab:focus` removes the outline at `src/index.css:4960-4962`, with no matching
  `.tech-nav-tab:focus-visible` replacement in the audited stylesheet;
- custom sheets often add `role="dialog"` but do not share the proven focus-trap/return-focus lifecycle
  of the canonical `Modal`;
- the green browser accessibility result covers a deterministic QA fixture, not authenticated UPR
  screens.

These are grouped under `MOB-A11Y-028`. Contrast, VoiceOver/TalkBack reading order, Dynamic Type/text
zoom, hardware-keyboard focus, and switch-control behavior remain device gates.

## Duplicate-component map

| Concept | Current implementations | Consolidation direction |
|---|---|---|
| Job field execution | legacy `TechJobDetail`, `TechAppointment`, v2 `TechJobHub` | preserve one tested workflow shell after parity/cutover |
| Photo upload | albums, claim/job/appointment details, dashboard capture, hub dock, offline dispatcher | one media service/hook with deterministic ID, compression, privacy, and atomic reconciliation |
| Photo note/room | legacy detail pages, `PhotoNoteSheet`, v2 dashboard/hub | one sheet and query/invalidation contract |
| Bottom sheet | shared `Modal`, multiple tech sheets, v2 CreatePicker, admin action sheets | one accessible mobile sheet primitive plus specialized content |
| Header/back/menu | `Hero`, v2 dashboard/schedule/job/message headers, per-page inline headers | a small set of route-header variants |
| Loading/error/empty | skeletons, `TabLoading`, shared states, local spinners/strings | three canonical state primitives and stale-data banner |
| Status color | tokens, constants, local ternaries, inline hex values | one semantic status map feeding CSS roles |

## Recommended canonical mobile design system

The existing system should be tightened, not replaced:

1. Keep `.tech-layout` as the token scope and make v2 primitives the default for new field screens.
2. Define one accessible `MobileSheet` behavior contract using the shared modal lifecycle:
   role/name, focus trap, return focus, Escape/back dismissal, safe area, keyboard avoidance, enter and
   exit motion, and reduced-motion behavior.
3. Move semantic status values and recurring overlays/shadows to tokens; ban new hard-coded semantic
   triplets in route JSX.
4. Establish three route-state primitives: cold skeleton, stale-data-with-refresh, and actionable
   error. A successful empty state must never represent a failed request.
5. Consolidate media upload/rendering and job/appointment reference sections before removing legacy
   routes.
6. Preserve 48px field targets; require an explicit documented exception for any dense 44px secondary
   control.
7. Add real app accessibility and visual tests at 390, 768, 1024/iPad, and desktop widths, with
   VoiceOver/TalkBack and keyboard checks on critical workflows.

## Design-system conclusion

The v2 field surfaces demonstrate a credible and documented direction. The current application is
not yet one coherent mobile system: legacy and v2 implementations, inline tokens, sheet behavior,
state handling, and accessibility mechanics coexist. Consolidation can be incremental, but expanded
field adoption should not treat visual polish as a substitute for the authorization, data-preservation,
and device-verification blockers elsewhere in this audit.
