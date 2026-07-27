# UPR Mobile PWA and Capacitor Audit — Responsive, Accessibility, and Devices

## Viewport and responsive findings

### Verified strengths

- `index.html` uses `viewport-fit=cover`.
- the mobile shell uses `100dvh`, contained scrolling, and top/bottom safe-area variables;
- the bottom tab bar and major docked controls account for the iOS home indicator;
- mobile form inputs in the v2 message/search surfaces use 16px text;
- week/day strips and chip rows use native horizontal overflow and momentum-friendly scrolling;
- v2 list rows, message filters/send, sheet choices, and primary field actions generally meet the
  48px project target, with a few documented 44px dense-control exceptions;
- native iPhone orientation is declared portrait; native iPad declares portrait and landscape.

### Confirmed source defects

- task rows in appointment/edit flows are pointer-clickable non-semantic `<div>` elements
  (`src/pages/tech/TechAppointment.jsx:920`,
  `src/pages/tech/TechEditAppointment.jsx:521`);
- primary tech navigation explicitly removes the focus outline without a replacement
  (`src/index.css:4960-4962`);
- the schedule CreatePicker sheet reuses a pill keyframe whose transform shifts the full sheet left
  during its 200ms entrance and snaps back afterward (`MOB-MOTION-038`);
- several custom overlays lack a common focus-trap, focus-return, and platform-back contract.

### Responsive uncertainty

The shell is mobile-first and applies at all widths, while many shared/legacy rules switch only at
`max-width: 768px`. The native iPad target supports landscape, but no authenticated iPad or split-view
evidence was available. There is also no checked-in Android native project. Static CSS cannot prove
keyboard occlusion, visual-viewport resizing, notch/island behavior, Dynamic Type, browser chrome,
or OEM WebView differences.

The brief's required widths—**320, 360, 375, 390, 412, 430, and 768 CSS pixels**—were not exercised
against authenticated UPR field screens. The credential-free fixture ran at 390px, but it is not the
application and is not promoted to route proof. Every listed width therefore remains an explicit
human/device validation gate.

## Platform assessment

### iPhone / iOS PWA

Source addresses safe areas, installed-mode route restoration, 16px inputs, and push capability
detection. iOS Web Push requires an installed Home Screen web app; browser support does not prove
VAPID configuration or delivery. The service worker provides push only, so an installed app cannot
cold-start the shell without network (`MOB-OFFLINE-010`).

Required device checks:

- Safari install prompt/instructions, icon/title, first launch, repeat launch, and upgrade;
- keyboard behavior in Messages, customer/job/appointment forms, and scope sheet;
- camera/file capture, rotation policy, safe areas, pull-to-refresh, and scroll restoration;
- VoiceOver reading order/actions, text zoom, reduced motion, notification permission/tap;
- logout/account switch with cache, drafts, offline work, and push subscription present.

### Capacitor iPhone

The native wrapper declares camera, photo library, location, and Face ID usage descriptions.
Repository abstractions exist for keyboard, camera, haptics, location, appearance, biometric, updater,
and push. No Xcode build, signed archive, TestFlight install, entitlement inspection, device launch,
background termination, push, OTA rollback, deep link, or App Review path was verified.

Native primary use remains blocked by `MOB-SEC-016`, `MOB-PRIV-009`, `MOB-NATIVE-020`,
`MOB-NATIVE-021`, `MOB-NATIVE-022`, `MOB-NATIVE-023`, and `MOB-TEST-025`.

### Android PWA

The manifest supplies the core name/start/display/orientation/icon fields and should be assessed as an
installable web-app candidate, not as a native Android app. Required Chrome/Android checks are:
install UI, icon/mask behavior, system back, standalone scope, notification permission/delivery,
background resume, keyboard, file/camera capture, offline messaging, and update recovery.

### Android Capacitor

No Android project is checked in. Absence is not a defect if iOS-only is the product decision, but
future documentation and release plans must not imply Android native support.

### Tablet/iPad

The current native plist permits iPad landscape. The route tree packages the full field and
admin-mobile surfaces, while the CSS has no evidenced adaptive two-column/tablet information
architecture for the field shell. Validate at minimum:

- 768×1024 portrait;
- 1024×768 landscape;
- common iPad split-view widths;
- keyboard-connected navigation/focus;
- sheet maximum widths, long forms, tables/admin financial screens, and large photo grids.

## Accessibility assessment

### What is implemented

- labels on many icon-only controls;
- dialog roles/names on several field sheets;
- radiogroup semantics for settings segments;
- semantic buttons for most v2 schedule/message rows;
- partial `prefers-reduced-motion` coverage;
- shared `Modal` supports focus handling where adopted;
- a credential-free browser fixture passes serious/critical axe checks at 390 and 1440.

### What is missing or inconsistent

- keyboard activation semantics for critical task rows;
- a visible focus indication for the tech tab bar;
- one focus-trap and focus-return contract across all mobile sheets/lightboxes/menus;
- real-app axe scans on authenticated routes;
- VoiceOver and TalkBack proof for task completion, clocks, schedules, messages, photo tagging, and
  destructive confirmations;
- Dynamic Type/text zoom and reflow proof;
- contrast verification for all hard-coded legacy status/background combinations and dark mode;
- announcements for background sync state, optimistic sends, timer changes, and mutation errors;
- accessible back/dismiss behavior tied to Android system back and iOS/native lifecycle events.

`MOB-A11Y-028` groups the confirmed semantic/focus defects. `MOB-TEST-025` covers the missing
authenticated device and assistive-technology release proof.

## Required device matrix

| Platform | Viewport/device | Required modes | Critical workflows |
|---|---|---|---|
| iOS Safari | current small and large iPhones | browser + installed PWA; light/dark; reduced motion | login, tabs, schedule, task, job hub, camera, messages, offline/resume/update |
| Capacitor iOS | current supported iPhone OS/device | debug + signed TestFlight; foreground/background/terminated | auth/biometric, secure storage, camera/location, push/tap, deep link, OTA rollback |
| iPadOS | portrait, landscape, split view | PWA + signed native if supported | admin-mobile, long forms, sheets, tables, keyboard/focus |
| Android Chrome | current Pixel-class phone plus one OEM | browser + installed PWA | install, system back, camera/file, notifications, offline/update |
| Desktop safety | 1440px Chromium/WebKit-equivalent smoke | keyboard + screen-reader spot check | public signing, responsive shell guardrails |

Every matrix row needs a named build/commit, database compatibility snapshot, tester/device/OS,
expected result, observed result, screenshots or logs without customer data, and a disposition for
failures. Synthetic fixtures remain useful but do not satisfy this matrix.

For the field-shell width gate, record each of 320, 360, 375, 390, 412, 430, and 768px separately;
do not infer the intervening widths from the 390px fixture.

## Responsive/accessibility conclusion

Source demonstrates deliberate mobile ergonomics, especially safe areas, tap sizes, status color,
16px inputs, and the v2 shell. Production readiness is still unproven on real devices and assistive
technology, and confirmed focus/semantic defects affect core navigation and task completion. The
appropriate conclusion is “promising implementation with a blocked device/accessibility release
gate,” not “responsive because the CSS contains media queries.”
