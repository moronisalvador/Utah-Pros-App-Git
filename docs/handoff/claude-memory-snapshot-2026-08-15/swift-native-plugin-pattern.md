---
name: swift-native-plugin-pattern
description: The proven recipe for app-local Swift Capacitor plugins (photo viewer shipped 2026-08-07) + the ranked backlog of next native items and their traps
metadata: 
  node_type: memory
  type: project
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-07T05:20:44.288Z
---

**The pattern (proven end to end 2026-08-07, UPR Dev 102.1):** app-local Capacitor plugin, no pods/SPM package. Reference implementation: `ios/App/App/NativePhotoViewer.swift` (CAPPlugin + CAPBridgedPlugin with `identifier`/`jsName`/`pluginMethods`), registered in `ios/App/App/AppViewController.swift` (`CAPBridgeViewController` subclass, `capacitorDidLoad()` → `bridge?.registerPluginInstance(...)`; Main.storyboard's VC points at `AppViewController` customModule `App`). **project.pbxproj must be hand-wired** (classic project, no filesystem sync): 4 insertion points per file — PBXBuildFile, PBXFileReference, group children, Sources phase — with unique 24-hex IDs (the `BB0000...` block is taken). JS side: `src/lib/nativePhotoViewer.js` idiom — `registerPlugin` + `Capacitor.isPluginAvailable()` feature gate so older installed binaries fall back to web gracefully.

**Traps already paid for:**
- Present overlays `.overFullScreen`, NEVER `.fullScreen` — fullScreen unmounts the WKWebView, fires `visibilitychange:hidden` into the SPA, and thread resume/lease logic closes the conversation underneath (sim-reproduced).
- Verification workflow: build `npm run build:ios` then `xcodebuild -project ios/App/App.xcodeproj -scheme "UPR Dev" -configuration Debug -destination 'platform=iOS Simulator,id=<booted>'` (NO .xcworkspace — SPM project; use absolute paths, `cd` doesn't stick in the harness). `simctl install` is an upgrade that preserves the owner's logged-in sim session; bundle id in Debug is `com.utahprosrestoration.upr`. Screenshots via `xcrun simctl io <udid> screenshot` (the Claude sim panel crashes on this Mac — Metal bug); taps/swipes/two-finger pinch via the iOS MCP control tool work headlessly (`touch2_path` proved pinch-zoom).
- The active Xcode is the beta toolchain (macOS beta) — plain `xcodebuild` works; don't switch.

**Why:** the native app should use OS-integration Swift where the web can't match (owner-validated: "zoom in and zoom out as well as drag feels perfect now"). Business UI stays web.

**How to apply — ranked backlog (owner-acknowledged 2026-08-07):**
1. ~~Share/save sheet (`UIActivityViewController`)~~ **SHIPPED 2026-08-07, commit `d1b5face`** — `NativeShare.swift` + `src/lib/nativeShare.js`. Key gotcha: **download the remote file to a temp file BEFORE presenting.** iOS offers only "Copy Link" for a remote URL but Save Image / AirDrop / Messages for a local one, and it picks the offered actions from the **filename extension** — so preserve the name. iPad popover needs an anchor or it throws (fall back to screen centre).
2. ~~Document/PDF preview (`QLPreviewController`)~~ **SHIPPED 2026-08-07, same commit** — `NativeDocPreview.swift` + `src/lib/nativeDocPreview.js`. QuickLook reads a LOCAL file only (an https URL renders a blank sheet with **no error**); stage into a per-preview temp folder keeping the filename, clean up on dismiss, and guard `finish()` so the Capacitor call resolves once whether closed by Done or an interactive swipe. Entry point: the signed work-auth PDF in `TechJobDocuments.jsx` — keep it an `<a>` for web and intercept only when the plugin is available (`target="_blank"` inside the app punts to Safari and leaves it).
3. Background photo uploads (background `URLSession`) — do NOT bolt on quickly; it intersects the offline/idempotency law ([[testflight-release-policy]] era, tech-mobile-ux online-only amendment) — design-review scope, pair with the offline initiative ([[clock-tap-loss-root-cause]] → `docs/offline-clock-queue-proposal.md`).
4. Live Activity / Dynamic Island clock timer — heaviest (new widget extension target, ActivityKit, big pbxproj surgery); fresh session with full context.

**Wiring is now test-pinned:** `tests/qa/unit/native-plugin-wiring.test.js` asserts, for every plugin, the `@objc`/`jsName`/`identifier` contract, registration in `AppViewController`, all four pbxproj entries (assert them **structurally** — the filename appears twice inside a single PBXBuildFile line, so a raw count is misleading), the matching JS `registerPlugin`/`isPluginAvailable` name, and that no overlay uses `.fullScreen`.

New builds go to the UPR Dev app ONLY per [[testflight-release-policy]].
