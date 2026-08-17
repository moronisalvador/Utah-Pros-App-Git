---
name: driving-ios-simulator-for-ui-verification
description: How to actually drive the UPR app in the iOS Simulator when the sim MCP is dead — three traps that each look like a broken app
metadata: 
  node_type: memory
  type: reference
  originSessionId: db98c330-31ca-407a-b999-d4a609f3ca23
  modified: 2026-08-09T00:58:21.675Z
---

The Claude iOS Simulator MCP crashes on this Mac (Metal bug, see
[[ios-sim-panel-metal-crash]]). The working path is **computer-use driving the Simulator window**,
plus `xcrun simctl io … screenshot` for clean device-resolution captures. Ask for Simulator access
with `mcp__computer-use__request_access`; it was denied once and granted on a later ask, so retry
rather than concluding it is unavailable.

Three traps, each of which reads as an app bug until you know:

1. **`type` triggers iOS's press-and-hold accent picker.** Typing "Moroni Salvador" produced `Aa`
   plus an à/á/â popup. Use the pasteboard instead: `printf 'text' | pbcopy` then `cmd+v`. Note
   `cmd+a` goes to the *app*, not the web input, so it will not select-all inside a field — clear
   with `key delete repeat:N` first or the paste appends.
2. **Mouse-wheel scroll does not reach the WKWebView.** `scroll` does nothing on the SPA. Use
   `left_click_drag` from a lower point to a higher one — a real swipe.
3. **Calibrate the window scale from two known landmarks before trusting any tap.** Guessing the
   sim screen bounds put every tap ~190 points high and looked like dead buttons. Take a
   screenshot, pick two elements far apart whose device-point coordinates you know (a top button
   and the tab bar), and solve: `mac = origin + point × scale`. Re-derive after any `cmd+1`/window
   resize.

Deep links do NOT route: `simctl openurl com.utahprosrestoration.upr://<path>` raises an
"Open in UPR Dev?" confirm and then lands on the app's default screen, not the SPA path. Navigate
in-app instead, which is also the more honest test.

Build for the sim with the **`UPR Dev`** scheme:
`xcodebuild -project ios/App/App.xcodeproj -scheme "UPR Dev" -sdk iphonesimulator -destination 'platform=iOS Simulator,id=<udid>' CODE_SIGNING_ALLOWED=NO build`, then `simctl install` + `launch`.
Run `npm run build:native && npm run sync:ios` first or you ship a stale web bundle. The owner
keeps a logged-in sim session, so you land already authenticated.

Proven end to end 2026-08-08: built an OOP quote on the phone, converted it, and saved the estimate
to QuickBooks from the native shell. See [[full-handoff-2026-07-31-mac-reconcile]] for the wider
release context.
