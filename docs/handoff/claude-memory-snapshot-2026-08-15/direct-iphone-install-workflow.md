---
name: direct-iphone-install-workflow
description: "How to build and install UPR Dev straight onto the owner's iPhone with Xcode CLI, and why push keeps working"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-08T03:45:33.054Z
---

> ## 🚨 `-configuration Dev`, NEVER `Debug` — the flag that overwrites the official app
>
> **Paid for 2026-08-07.** The scheme name "UPR Dev" does NOT decide the bundle id — the
> **configuration** does. `-configuration Debug` builds to `Debug-iphoneos/` under
> **`com.utahprosrestoration.upr`**, the PRODUCTION bundle id, so `devicectl install` performs an
> upgrade-install straight over the owner's official App Store/TestFlight app and displaces the
> frozen release. (Data and session survive — same bundle id — but the icon labeled "UPR" is then
> running a local dev build, and TestFlight must be used to restore the real one.)
>
> `-configuration Dev` builds to `Dev-iphoneos/` under **`com.utahprosrestoration.upr.dev`**,
> side-by-side, which is the whole point of the separate app.
>
> **Confirm before installing to a physical device, every time:**
> `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' <App.app>/Info.plist`
> If it does not end in `.dev`, do not install.

Verified 2026-08-06. The owner's iPhone 17 Pro Max (devicectl id
`E4A6B5B1-BAF4-5551-925D-94B8729006D9`) accepts direct CLI installs:

1. `npm run build:ios:dev` (sandbox APNs + push enabled — correct for development signing).
2. `xcodebuild -project ios/App/App.xcodeproj -scheme "UPR Dev" -destination 'id=<udid>'
   -derivedDataPath ios/DerivedData -allowProvisioningUpdates build` — automatic signing,
   team H6ZUT739T9, bundle `com.utahprosrestoration.upr.dev` (side-by-side with official).
3. `xcrun devicectl device install app --device <udid> ios/DerivedData/Build/Products/Dev-iphoneos/App.app`
4. `xcrun devicectl device process launch --device <udid> com.utahprosrestoration.upr.dev`
   (fails with a clear message if the phone is locked — installing still works).

**Push survives the signing flip:** a dev-signed install gets SANDBOX APNs tokens, and
`sendNativePushToEmployeeAcrossEnvironments` (functions/lib/apns.js) deliberately fans every
delivery out to BOTH environments with per-token topics. Verified live: the fresh install
enrolled a `sandbox`/`.upr.dev` token seconds after launch. A later TestFlight update simply
flips the token back to production. Installing over the TestFlight build preserves app data
(login/lease).

Watch the shell cwd: `cd ios/App && xcodebuild …` persists into later Bash calls — relative
paths then break (`git add`, `devicectl install`). Use absolute paths after any ios/App build.

Related: [[ios-sim-panel-metal-crash]] (simulator panel can't stream on this Mac; the login
screen has no dev-login button in built bundles, so simulator verification stops at boot).
