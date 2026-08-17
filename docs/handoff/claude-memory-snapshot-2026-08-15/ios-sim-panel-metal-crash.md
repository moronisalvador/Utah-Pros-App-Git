---
name: ios-sim-panel-metal-crash
description: "Claude's iOS Simulator panel cannot stream on this Mac (macOS 27 beta Metal bug); use xcrun simctl for screenshots"
metadata: 
  node_type: memory
  type: project
  originSessionId: 52302af6-7ee2-405b-bfc1-992f4918c2c7
  modified: 2026-07-28T02:57:37.587Z
---

On Moroni's M4 Mac running **macOS 27.0 beta (26A5388g)**, the Claude Code iOS
Simulator panel **cannot display or screenshot** the simulator. Diagnosed
2026-07-27 from the actual crash reports in `~/Library/Logs/DiagnosticReports/claude-ios-sim-*.ips`.

**Root cause:** the `com.facebook.FBSimulatorControl.BitmapStream` thread aborts
inside Metal — `_MTLBinaryArchive loadFromURL:` → `recordBinaryArchiveUsage:` →
`NSArray arrayWithObjects:count:` throws on a nil entry → `objc_terminate` →
`abort()` (SIGABRT). An Apple beta Metal bug hit by the streaming library, not a
corrupt cache: the Metal FE cache was already 0 bytes when cleared, and it did
not help.

**What still works** (do not assume the whole bridge is down):
- MCP `build`, `launch`, `tap`, `type`, `swipe` — all fine
- `xcrun simctl io <udid> screenshot <path>` — 100% reliable, use this for capture
- `xcrun simctl launch` / `boot` / `listapps` — fine

**Workarounds:**
- For Claude's own visual verification: `xcrun simctl io … screenshot`, then Read the PNG.
- For the human to watch: open Simulator.app pointed at the live device —
  `open -a Simulator --args -CurrentDeviceUDID <udid>`. Note `pkill -x Simulator`
  **shuts the booted device down**; re-`boot` and re-`launch` after.
- Typing on the Mac keyboard requires Simulator.app on the *live* device plus
  `Cmd+Shift+K` (Connect Hardware Keyboard). A Simulator.app window showing a
  shut-down device silently swallows keystrokes — that was the cause of a
  reported "keyboard doesn't work" issue.

Re-test after a macOS update; this should resolve when the beta does.
See [[upr-ios-build-toolchain]].
