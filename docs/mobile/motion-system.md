<!--
FILE: docs/mobile/motion-system.md

WHAT THIS DOES (plain language):
  Documents the implemented UPR motion vocabulary and the proposed consolidation rules for field
  routes, sheets, feedback and gestures.

DEPENDS ON:
  Internal: .claude/rules/motion-standard.md, src/index.css,
            src/components/ui/, src/components/tech/, src/pages/tech/v2/
  Data:     reads → UI source only
            writes → documentation only

NOTES / GOTCHAS:
  - Existing approved implementation and proposed standardization are labeled separately.
  - Real-device feel and reduced-motion behavior are release gates.
-->

# Mobile Motion System

## Purpose

Motion communicates hierarchy, causality, continuity, progress, or confirmation. High-frequency
field work should feel immediate; decoration is not a reason to animate. The platform-wide
`.claude/rules/motion-standard.md` remains binding.

## Existing approved foundation

`src/index.css` defines the current shared catalog:

| Role | Current duration |
|---|---:|
| Fast | 120ms |
| Base | 220ms |
| Slow | 320ms |

Use the existing standard, decelerate, and accelerate easing tokens and the existing dependency-free
spring where already approved. Do not create a second tech timing/easing vocabulary.

Current shared implementations that establish the preferred pattern:

- button/icon press feedback using transform and the fast token;
- shared Modal enter plus shorter exit lifecycle;
- shared bottom-sheet enter/exit;
- shared toast enter/exit;
- directional View Transitions with reduced-motion fallback;
- v2 skeleton shimmer with reduced-motion disable.

These are source patterns, not proof that every field route already conforms.

## Proposed standardized behavior

The rules below are the target for incremental migration. They do not imply that all current custom
screens already satisfy them.

### Frequency and duration

- task toggle, clock action, tab, day, segment, filter, and other repeated field controls:
  instant or at most 120ms;
- ordinary surface/content state change: base 220ms only when continuity benefits;
- large route/sheet establishment: slow 320ms maximum only when hierarchy needs it;
- exit: approximately 75% of the corresponding entry duration;
- network wait never extends an entrance animation; use a real loading/progress state.

### Easing

- entering/moving into place: existing decelerate curve;
- exiting/moving away: existing accelerate curve;
- small state changes/press: existing standard curve;
- spring: existing approved one-shot enter only, not a repeating or layout-driving effect.

### Animated properties

Prefer compositor-friendly `transform` and `opacity`. Avoid animating `height`, `width`, `top`,
`left`, large blur, and `transition: all` unless a measured, reviewed exception exists. Final layout
must be correct without the animation.

## Navigation transitions

Current route motion includes View Transitions and tech-specific fades. The proposed standard is:

- at most one route-level transition layer;
- direction reflects forward versus back;
- persistent tab switches remain instant or very fast;
- content/loading state does not replay a decorative route entrance on every refetch;
- scroll/focus/history final state is correct before motion polish;
- no route transition when reduced motion is requested.

View Transitions remain feature-controlled until authenticated/device validation proves forward/back,
background/resume, long content, keyboard, and nested routes.

## Modal and sheet transitions

The approved lifecycle:

1. mount backdrop/content in an accessible dialog;
2. enter backdrop opacity and sheet `translateY`/opacity from its true layout baseline;
3. trap/name/focus without waiting on animation;
4. on explicit close/back/Escape/backdrop (when allowed), start exit;
5. return focus and unmount only after the exit finishes/cancels;
6. under reduced motion, establish/remove the final state immediately or with a minimal opacity
   change.

Never reuse a keyframe that changes an unrelated baseline transform. The audited
`tv2-pill-in`/CreatePicker pairing is a known example to retire.

## Feedback motion

- Press: subtle scale/color response, no delayed action.
- Optimistic state: immediate semantic state plus pending indicator; rollback visibly explains
  failure.
- Success: concise toast/status change; do not animate a durable success before the server confirms
  it.
- Error: stable actionable message, optional restrained attention cue, no repeated shaking.
- Progress/loading: use skeleton/spinner/progress only while work is genuinely pending; reduced motion
  shows a static equivalent.
- List insertion/removal: preserve context; animate only when it helps the user locate the change.
- Haptics: impact/notification/selection helpers only on native, respecting user/platform settings;
  use the plugin's complete selection lifecycle.

### Native notification popover

The native field-shell bell now owns one stable popover lifecycle:

- enter scales from `0.96` to `1` while fading in on the fast motion token;
- exit accelerates over 75% of that duration before unmount;
- the badge may scale from `0.9` to `1` only when it mounts;
- subsequent Realtime/resume refreshes preserve existing rows and update silently rather than
  blanking or remounting the list;
- Escape, click-away, route changes, and a persistent pane becoming inactive all run the same close
  lifecycle, with focus entering the dialog and returning to the bell;
- Reduce Motion establishes the open or closed state immediately.

The behavior is scoped to `:root[data-native='true']` at the mobile breakpoint; the office/PWA bell
keeps its existing presentation. A 2026-07-28 simulator visual check observed multi-frame enter and
exit instead of the prior flash, but its unsanitized recording was deleted and is not release
evidence. A sanitized SHA-bound recapture, physical-iPhone feel, and VoiceOver remain release-device
checks.

## Gestures

Native scrolling/scroll snap is the default. Do not add custom drag/swipe solely for novelty.

An approved custom gesture must:

- use pointer events/capture where supported;
- update visual position through rAF/imperative animation rather than rerendering a large tree on
  every move;
- define distance and velocity thresholds;
- handle cancel, multi-touch, nested scroll, browser edge gesture, and platform back;
- have a visible button/keyboard/screen-reader alternative;
- avoid committing destructive or business state on gesture ambiguity.

Current pull-to-refresh/task-swipe behavior requires this migration/device validation before it is a
reference pattern.

## Reduced motion

When `prefers-reduced-motion: reduce`:

- route and large spatial transitions are removed;
- sheets/modals establish their final position immediately;
- shimmer/spinner/progress retain understandable static state;
- press feedback does not scale/move;
- gesture settling avoids spring/overshoot;
- focus, status, and success/error feedback remain available without motion.

Every new keyframe/transition must include a verified reduced-motion final state. “Animation: none”
is insufficient if it leaves content invisible/transformed or prevents an exit callback.

## Known implementation gaps

- 27 raw tech-specific duration declarations were observed in the audited snapshot;
- route fade can stack with screen/View Transition motion;
- several custom sheets unmount without exit/focus-return lifecycle;
- tech toast/spinner/FAB/dock/progress patterns are not fully tokenized/reduced-motion-safe;
- pull-to-refresh/task swipe use per-move React state and lack one pointer/velocity contract;
- selection haptic lifecycle appears incomplete;
- CreatePicker applies a pill keyframe with a mismatched horizontal transform.

These are migration inputs, not authorization for a broad animation rewrite.

## Verification

For any motion change, record:

- entry, exit, interruption, repeated open/close, and final DOM state;
- forward/back and feature-transition on/off;
- reduced-motion final state;
- keyboard open, focus trap/return, Escape/platform back;
- pointer cancellation, nested scroll, edge gesture, and button alternative;
- throttled trace plus real iPhone/device feel for changed primary interactions;
- minimize/background/resume with no replay, jump, or lost input.
