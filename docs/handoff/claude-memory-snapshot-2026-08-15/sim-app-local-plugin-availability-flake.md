---
name: sim-app-local-plugin-availability-flake
description: "On the iOS 26.3 sim (beta macOS), app-local Capacitor plugins intermittently read unavailable — reinstall before launch fixes it; also Device Hub window vanishes and multiple sessions collide on one booted sim"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7bd3a52a-6502-4f80-838f-24c87c9473cc
  modified: 2026-08-14T18:35:34.032Z
---

Three simulator traps observed 2026-08-14 while verifying the composer camera attach flow (extends [[driving-ios-simulator-for-ui-verification]] and [[ios-sim-panel-metal-crash]]):

1. **`Capacitor.isPluginAvailable('<AppLocalPlugin>')` intermittently returns false** on some launches, same binary — registration is `bridge?.registerPluginInstance(...)` in `AppViewController.capacitorDidLoad()` (the documented hook), yet 3 of 5 launches read unavailable while the launch immediately after a fresh `simctl install` reliably read available. Looks exactly like a broken feature; it is the environment. **Fix: `simctl install` the .app again, then launch.** Feature-detected fallbacks (file input, JS lightbox) fire on affected launches — expected, by design. No evidence of this on physical devices.
2. **Device Hub's window vanishes spontaneously** (app keeps running, menu bar intact) — `open_application` reopens it, but it reopens at the small zoom; re-zoom with the toolbar + magnifier before tapping. WebContent processes also die with dyld SIGBUS at spawn on this macOS 27 beta (crash logs in ~/Library/Logs/DiagnosticReports) — a white-screened app after such a crash is the environment, not the code.
3. **Multiple Claude sessions collide on the one booted simulator** (terminate/install/launch under each other — the owner spotted it 2026-08-14). Before a sim pass, message sibling sessions (`list_sessions` → `send_message`) to hold device actions, and signal "simulator free" after. Builds don't collide; only simctl device actions do.

**Why:** each of these mimics an application bug (missing plugin = broken feature; white screen = crash; app relaunching mid-test = state loss) and can burn an hour of false debugging.
**How to apply:** when a feature-detected native path unexpectedly degrades on the sim, reinstall before diagnosing; when the app's state jumps mid-verification, check for sibling sessions first.
