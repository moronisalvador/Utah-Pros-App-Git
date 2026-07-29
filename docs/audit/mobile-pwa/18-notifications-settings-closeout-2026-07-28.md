<!--
FILE: docs/audit/mobile-pwa/18-notifications-settings-closeout-2026-07-28.md
Retained credential-free browser evidence for the Notifications Settings
surface. This is local Chromium evidence, not iPhone/TestFlight proof.
-->

# Notifications Settings browser close-out — 2026-07-28

**Branch:** `codex/mobile-readiness-native-usability`
**Original base:** `bf45ae00fd96e8b115220fab2d2920472b9ca533`
**Reconciled `origin/dev`:** `8e1cf9cceba72f027caf91debded4afb6841b276`
**Merge commit:** `10d8c70ec4cb1582cfa7644ef1e9862290e78bf8`
**Viewport:** 390 × 844, touch/mobile context, reduced motion
**Data boundary:** synthetic in-memory modules; every non-local request blocked

## Exact bounded command

```bash
node scripts/qa/run-owned-subprocess.mjs --timeout-ms 290000 --safe-env -- \
  node scripts/qa/verify-notifications-settings-ui.mjs
```

The runner mounted the real
`src/components/tech/settings/NotificationsSection.jsx` through the checked-in
credential-free fixture and exercised three URL-selected native status modes.
It used the installed local Google Chrome because this machine did not have the
Playwright-managed Chromium bundle.

## Repeatable result

The final exact command passed twice consecutively. Both runs returned the same
meaningful measurements:

```json
{
  "externalWebSocketDenied": true,
  "errorState": "passed",
  "errorViewport": {
    "clipped": false,
    "horizontalOverflowPx": 0,
    "minimumActionHeightPx": 48
  },
  "loadingState": "passed",
  "localPostDenied": true,
  "minimumActionHeightPx": 48,
  "noClippedSettingsCards": true,
  "pressTransformVisible": true,
  "realResumeHook": true,
  "reducedMotionActive": true,
  "reducedMotionPressTransform": "none",
  "resumeSeconds": 31,
  "resumeScrollDriftPx": 0,
  "resumeState": "passed",
  "visibilityTransition": "controlled-hidden-to-visible",
  "viewport": "390x844",
  "horizontalOverflowPx": 0,
  "externalRequestsAllowed": 0
}
```

The resume check uses the real, unmocked `useResumeRefetch` hook. The runner
sets a controlled hidden state, dispatches the browser visibility event, waits
31 real seconds, then sets visible and dispatches the matching event. It
verified:

- the status never flashed back to Checking;
- the ready Push state remained rendered;
- route and the practical scroll position were retained; and
- a half-finished synthetic input retained its value.

After the runner waited for font/layout settling and blurred the synthetic
input, both exact runs on the current source retained scroll with zero measured
drift. The harness still reports drift and fails above two pixels, so later
regressions cannot hide behind the earlier layout-rounding behavior. Loading,
failure, and ready states each had zero horizontal overflow and no clipped
Settings card. Every visible action in the failure and ready states measured
at least 48px high. The button showed a visual press transform with ordinary
motion, and the active reduced-motion media state removed that transform.

The shared browser guard denied local POST and external WebSocket probes,
blocked every non-local request, and observed zero allowed external requests.
The bounded wrapper selected `--safe-env`, so the browser command inherited
only the repository's explicit credential-free child environment.

The owned wrapper reported `Verified owned process group ... is gone.` after
the browser and Vite server closed.

The exact command was rerun after the final `origin/dev` merge and after the
motion feel-gate refinement. Both post-merge runs retained the same contract:
390×844, 48px actions, zero clipping/overflow, real resume hook, 31 seconds
hidden, zero scroll drift, press transform present under ordinary motion and
absent under reduced motion, zero allowed external requests, and verified
owned-process cleanup.

## Motion feel-gate

| Before | After | Why |
| --- | --- | --- |
| Settings buttons transitioned `transform`, background, border, and text color | Transition only `transform` for 120ms using the existing strong custom curve | The purpose is tactile press feedback. Removing paint-triggering color transitions keeps this high-frequency interaction crisp and GPU-only. |

**Verdict: Approve.** The final press feedback has one justified purpose,
uses an interruptible CSS transition, stays inside the 100–160ms button budget,
scales from 1 to 0.97, and removes movement under reduced motion. It has no
keyframe, weak/ease-in curve, layout-property animation, hover motion, or
trigger-origin problem. Chromium proves the behavior and regression contract;
real WKWebView feel remains part of the TestFlight device matrix.

## Corrected attempts

- The first sandboxed attempt could not bind `127.0.0.1:4176` (`EPERM`); the
  approved final runner uses the repository's governed
  `http://127.0.0.1:4173` fixture origin.
- The first post-merge sandboxed attempt likewise could not bind
  `127.0.0.1:4173` and verified its owned process group was gone. The exact
  approved localhost rerun passed.
- The first approved launch found no Playwright-managed browser; the runner now
  uses installed Chrome on this Mac and falls back to Playwright Chromium when
  available elsewhere.
- The first module-mock attempt accidentally loaded the real frontend
  Supabase bootstrap and failed closed before the page rendered. It made no
  external request. The final fixture uses exact checked-in Vite aliases.
- The first aliased page omitted the normal i18n initialization side effect and
  could not match translated copy. The fixture now imports the real bundled
  i18n setup before the component.
- The first close-out draft mocked the resume hook and asserted exact scroll
  equality. Independent review rejected that evidence; one diagnostic run
  measured `556 → 554`, and a later shell-correct run measured `420 → 418`.
  The final runner no longer mocks the hook, waits for font/layout settling,
  blurs the synthetic input before scrolling, exercises the real hook through
  controlled visibility events, and retains the explicit two-pixel failure
  threshold. Both final current-source runs measured zero drift.

## Limitations retained

This proves deterministic Chromium behavior, the actual component/CSS at a
390px viewport, and the real resume-hook subscription under controlled browser
visibility events. It does not prove a real browser-tab suspension, WKWebView
feel, iOS notification permission, APNs foreground/background/terminated
delivery, or TestFlight signing. Those remain physical-device gates after the
clean reviewed build reaches TestFlight.
