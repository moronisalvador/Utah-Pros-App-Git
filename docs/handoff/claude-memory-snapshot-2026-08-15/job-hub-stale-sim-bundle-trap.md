---
name: job-hub-stale-sim-bundle-trap
description: A stale installed simulator/device bundle looks exactly like a feature-flag or routing bug — grep the installed app before debugging the code
metadata: 
  node_type: memory
  type: feedback
  originSessionId: ab5c0ae0-482f-4316-ba3c-d14864994f6b
  modified: 2026-08-09T12:11:26.997Z
---

**Paid for 2026-08-07/08.** Wave 1 of the Job Hub shipped, and tapping Claims → claim → job kept
landing on the legacy page. Two hypotheses were carried for a day — (a) the signed-in employee id
didn't match `dev_only_user_id`, (b) a Capgo OTA bundle was overriding local builds. **Both were
wrong.** The installed "UPR Dev" app on both simulators was simply built Aug 3 / Aug 6, before
wave 1 landed on `dev` (Aug 7 11:20). The code, the flag and the employee id were all correct the
whole time.

**Why:** an app icon carries no version. A simulator app installed days ago is indistinguishable
on screen from a fresh one, so a stale bundle presents as "the code doesn't work" — and every
hypothesis you form after that is about code that isn't running.

**How to apply — check the artifact before the source.** Grep the *installed* bundle for a string
unique to the change:

```
p=$(xcrun simctl get_app_container <udid> com.utahprosrestoration.upr.dev)
grep -rl '<marker unique to your change>' "$p/public" | wc -l
stat -f '%Sm' "$p"     # install date
```

Zero matches = stale bundle, stop debugging. This is seconds of work and it is the *first* thing
to do, not the last.

Two corollaries found the same day:

- **Both bundle ids exist side by side on these sims.** `com.utahprosrestoration.upr` (the
  production id — the `-configuration Debug` accident from [[direct-iphone-install-workflow]]) had
  wave 1; `…upr.dev` did not. Confirm *which app* a symptom came from before trusting it.
- **Capgo OTA was never in play** and can be ruled out cheaply: committed `capacitor.config.json`
  sets `autoUpdate: false`, OTA needs `VITE_NATIVE_OTA_ENABLED=true` which only
  `build:ios:dev:capgo` sets (plain `build:ios:dev` does not), and the app's data container held
  no downloaded bundle at all.

**Driving the sim when the Claude simulator panel is dead** (it is, on this Mac —
[[ios-sim-panel-metal-crash]]): `xcrun simctl` has no tap, and `idb`/`cliclick` are not installed.
Use the deep link instead — `xcrun simctl openurl <udid>
"com.utahprosrestoration.upr://app/tech/job/<jobId>"` (scheme + `app` host from
`src/lib/nativeNavigationTarget.js`) then `xcrun simctl io <udid> screenshot`. That reaches any
route and proves render without any input tooling. Reinstalling over the same bundle id preserves
the logged-in session.

**⚠ The deep link cannot choose between the two apps (found 2026-08-08).** Both bundle ids
register the SAME `CFBundleURLSchemes` entry — `com.utahprosrestoration.upr` — because
`Info.plist` doesn't vary it by configuration. So `simctl openurl` silently routes to whichever
app iOS picks (in practice the production id, not `.dev`), and you screenshot the *wrong app's*
state while believing you navigated. Symptom: the screen shows a plausible route you didn't ask
for. Confirm with `plutil -p <App.app>/Info.plist | grep -A8 CFBundleURLTypes` — if the scheme
isn't suffixed, the deep link is not a targeting mechanism. Until Info.plist varies the scheme by
configuration, driving a *specific* app needs real taps.

**And when taps are also unavailable, verify the built artifact instead.** With the sim MCP
crashed and computer-use held by another session, the blank-screen class of defect is still
provable from `dist/app-assets/`: `grep -o 'from"\./[A-Za-z0-9_-]*\.js"' <Page>-*.js | sort -u`
shows whether the page imports the REAL primitive chunks or the denying shim, and `cat` on a small
chunk shows whether it exports a real component. That is stronger than reading the source, because
it inspects what Rollup actually resolved. It is not a substitute for looking at the screen — say
so — but it closes the specific defect.

**Two sessions on one simulator is its own failure mode.** On 2026-08-08 a second session was
driving the same device: a `com.apple.WebKit.WebContent` crash and a white screen appeared
mid-run, on the other app, and read as "the change broke it". Check `xcrun simctl list devices
booted` and ask before assuming a symptom is yours.
