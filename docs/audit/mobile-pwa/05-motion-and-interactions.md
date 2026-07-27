# UPR Mobile PWA and Capacitor Audit — Motion and Interactions

## Severity calibration

The specialist review rated the systemic motion gap P1 because it conflicts with a mandatory project
standard across primary routes. The orchestrator normalizes `MOB-MOTION-029` to **P2, non-blocking by
itself**: the source confirms broad quality, accessibility, and performance debt, but it does not by
itself establish data loss, authorization failure, application unavailability, or an unusable core
workflow. The separate CreatePicker defect (`MOB-MOTION-038`) is also P2.

Real-device feel and frame-rate checks remain part of the P1 release-validation gate
`MOB-TEST-025`.

## Existing motion foundation

The shared stylesheet defines a coherent catalog at `src/index.css:95-109`:

- fast: 120ms;
- base: 220ms;
- slow: 320ms;
- standard, decelerate, and accelerate easing curves;
- a dependency-free `linear()` spring for one-shot enters.

Shared `Modal`, toast, button, icon-button, and view-transition rules use those tokens, implement
enter/exit lifecycles, and include reduced-motion fallbacks. This is a sound foundation.

The tech route tree also contains route fades, pane transitions, skeleton shimmer, button presses,
FAB/menu entrances, schedule movement, toast entrances, sheet entrances, progress/spinner motion,
photo feedback, pull-to-refresh, task swipe, and native haptics.

## Timing and easing inventory

### Shared approved patterns

| Pattern | Implementation | Status |
|---|---|---|
| Button press | transform on fast/standard token | generally compliant |
| Shared modal | tokenized enter plus 75%-duration exit | compliant |
| Shared mobile sheet | bottom enter/exit with decelerate/accelerate | compliant |
| Shared toast | tokenized spring enter and accelerated exit | compliant |
| View transition | directional push with reduced-motion kill switch | foundation is compliant; route overlap needs care |
| v2 skeleton | shimmer with reduced-motion disable | compliant |

### Parallel tech-specific patterns

The specialist scan found 27 raw-duration motion declarations in the tech-specific sections and
little consistent use of the central token catalog in the core field sheets/gestures. Examples:

- route/detail content is keyed by pathname to replay a 0.2s fade in
  `src/components/TechLayout.jsx:326-334`;
- several detail pages also animate their own entrance, which can stack with route/view transitions;
- seven major sheets use inline/raw entry animation and conditional unmount with no exit lifecycle:
  `PhotoNoteSheet`, `ReadingEntrySheet`, `ClockSupersedeSheet`, `EquipmentPlacementSheet`,
  `EsignRequestSheet`, `AddRoomSheet`, and `TechHelpSheet`;
- Tech Messages intentionally closes some overlays instantly;
- the tech toast path parallels the shared compliant toast;
- spinner, schedule, FAB, dock, and progress animations do not all have matching reduced-motion rules.

This fragmentation is `MOB-MOTION-029`.

## Gesture inventory

| Gesture/interaction | Current implementation | Assessment |
|---|---|---|
| Native scrolling | schedule week strip, agenda/chips, panes | preferred foundation; browser momentum/scroll snap |
| Pull to refresh | `src/components/PullToRefresh.jsx` | touch-move updates React state; transitions layout/`all`; no pointer capture/velocity model |
| Task swipe | `src/pages/tech/TechTasks.jsx` | per-move React state; no pointer capture; needs device/accessibility fallback proof |
| Sheet dismissal | overlay tap/close button on custom sheets | no shared drag/velocity/exit contract |
| Tab/day/filter switch | buttons and scroll snap | generally direct and high-frequency, as desired |
| Browser/history back | visible controls and `navigate(-1)` | verified |
| Native iOS edge swipe | comments/style imply swipe-back | no repository implementation or WKWebView gesture configuration; human gate (`MOB-NAV-032`) |
| Haptics | `impact`, notification, selection helpers | impact/notification usage is appropriate; `selection()` starts/ends without `selectionChanged()` and likely produces no iOS tick |

The project motion standard deliberately limits custom drag mechanics. The correct remediation is not
to add animation everywhere; high-frequency field controls should remain instant or at most 120ms.

## Confirmed CreatePicker defect

`src/index.css:5697-5705` applies `tv2-pill-in` to `.tv2-sheet`. The keyframe retains
`translateX(-50%)`, which belongs to the separately centered Today pill. The sheet itself is already
centered by its flex backdrop and has no `left: 50%`.

The result is a visible left shift during the 200ms entrance and a snap back when the non-filling
animation ends. `src/pages/tech/v2/schedule/CreatePicker.jsx:39-71` is the sole call site. It also
unmounts immediately on close and has no dedicated reduced-motion rule. This is
`MOB-MOTION-038` (P2, XS, not a production blocker).

## Performance concerns

- per-touch-move React state in pull-to-refresh and task swipe can rerender large content trees;
- animating `height`, `left`, and `width` can trigger layout/paint instead of compositor-only work;
- backdrop blur, large fixed overlays, and stacked route/page animations require low-end device
  profiling;
- hidden persistent panes can keep non-motion work active, which competes with animation for main
  thread/radio resources (`MOB-PERF-007`);
- no frame-rate trace or throttled-device measurement was available.

## Reduced-motion compliance

Shared primitives and view-transition rules contain good reduced-motion behavior. Coverage is not
complete across the custom tech system: sheets, toast/spinner paths, gesture settling, schedule/FAB/
dock motion, and CreatePicker do not consistently collapse to instant or opacity-only end states.

No automated test was found for:

- `prefers-reduced-motion` final state;
- enter/exit completion and focus return;
- duplicate/stacked route transitions;
- haptic behavior;
- pull-to-refresh/task-swipe pointer cancellation;
- motion performance.

## Recommended canonical motion system

1. Use the existing `--motion-*` catalog; do not mint a separate tech timing vocabulary.
2. Keep clock, task, tab, segment, day, and filter interactions instant or ≤120ms.
3. Migrate all custom sheets to one accessible sheet lifecycle with tokenized enter, 75%-duration exit,
   safe unmount, reduced motion, focus management, and platform-back handling.
4. Remove duplicate route/page entrance layers; make view-transition opt-in the only route-level
   motion when enabled.
5. Use transform/opacity for moving surfaces. Avoid `transition: all` and per-frame React state.
6. Implement only the project-approved gesture utility surfaces, with pointer capture, rAF, velocity
   threshold, cancellation, and a button/keyboard alternative.
7. Fix native selection haptics by using the plugin's supported selection lifecycle, or remove the
   ineffective feedback.
8. Add deterministic reduced-motion/end-state tests plus an owner/device feel gate.

## Verification matrix

| Check | Evidence required |
|---|---|
| Route navigation | forward/back, feature flag on/off, view transitions on/off, no double animation |
| Sheets | enter, dismiss, Escape/back, focus trap/return, reduced motion, keyboard open |
| Gestures | pointer cancel, slow/fast release, scroll conflict, one-hand/glove use |
| Performance | throttled trace and real iPhone check with blur, long lists, hidden panes |
| Haptics | real iPhone impact/selection/notification feedback with user setting respected |
| Accessibility | reduced motion, VoiceOver/TalkBack, keyboard/button alternative |

## Motion conclusion

UPR has the right shared motion foundation, but primary field surfaces still implement a parallel,
inconsistent layer. This does not independently create the audit's highest production risks, yet it
meaningfully lowers perceived quality, accessibility, and gesture reliability. Standardizing the
existing mechanics should follow containment of security/data-loss blockers and precede broad field
rollout.
