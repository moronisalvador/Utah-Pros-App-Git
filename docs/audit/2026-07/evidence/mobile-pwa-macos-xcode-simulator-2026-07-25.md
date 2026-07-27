# UPR Mobile PWA/Capacitor macOS and Xcode validation — 2026-07-25

## Scope and source boundary

This began as a no-remediation addendum to the completed mobile PWA/Capacitor audit. After the
initial environment gate was identified, the owner explicitly authorized installation of the
missing Xcode platform and continuation of the bounded simulator pass.

| Field | Value |
|---|---|
| Validation branch | `audit/mobile-pwa-production-readiness` |
| Validation anchor | `79a9e4edb53b8b57b677e4c4b023a84c2f9c34ee` |
| Original audited application source | `ef305f6d6afab4d846eab92fc1b04038d70221f0` |
| Host time | `2026-07-25T21:44:50-06:00` |
| External-state boundary | Supabase, production, providers, deployment, Apple services, TestFlight, and customer data were not accessed or changed |
| Native mutation boundary | No `cap sync`, dependency install/update, project edit, archive, export, signing, upload, physical-device action, or production action |

The original audited application source remains the source boundary for the audit. This pass
validated only the checked-in native state contained in the audit documentation commit. The
pre-existing unrelated modification to `.claude/settings.local.json` was not touched.

Every launched command used a 300-second timeout. Commands ran in a dedicated subprocess session;
on timeout the owned process group would receive `SIGTERM`, then `SIGKILL` after a five-second grace
period. The simulator build used an automatically removed temporary DerivedData directory. No
command timed out and no owned child remained to clean up.

## Host and toolchain

| Check | Observed result |
|---|---|
| Host | macOS 27.0 build `26A5388g`, Apple silicon (`arm64`) |
| Selected developer directory | `/Applications/Xcode.app/Contents/Developer` |
| Xcode | 26.6 build `17F113` |
| Node/npm | Node 26.5.0; npm 11.17.0 |
| Ruby | 2.6.10 |
| Xcode first-launch status | `xcodebuild -checkFirstLaunchStatus` exited 0 |
| Code-signing identities | `security find-identity -v -p codesigning` reported 2 valid identities; identity names were deliberately not recorded |

The host differs from repository CI's declared Node 22 environment. The presence of two local
identities is not provisioning, entitlement, archive, export, TestFlight, App Store Connect, or
physical-device proof.

## Checked-in project and package graph

`xcodebuild -project ios/App/App.xcodeproj -list` completed successfully with automatic package
resolution disabled and the checked-in `Package.resolved` enforced. It found:

- one application target and scheme: `App`;
- Debug and Release configurations;
- Capacitor/plugin SPM products;
- locked remote packages from the existing local Xcode package cache;
- local plugin products from the repository's existing `node_modules`.

No CocoaPods workspace was required for this project inspection. This proves that the checked-in
project and current local dependency cache can be enumerated; it is not a clean dependency install
or reproducibility result.

Static property-list validation passed for:

- `ios/App/App/Info.plist`;
- `ios/App/App/App.entitlements`;
- `ios/App/App/PrivacyInfo.xcprivacy`;
- the checked-in Xcode workspace-check plist.

The privacy manifest remains absent from `project.pbxproj` target membership, as recorded by the
completed audit. A valid plist file on disk does not prove that the built application embeds it.

Recorded SHA-256 values:

```text
project.pbxproj  e0778348c1356542435d068edc18915fd0467de2ac4be05823b4736d3dd9ae60
Package.resolved a9d8dfcb2754a1b5d65b21fc077c19b93a670b80c6a0a19b8ebb496c590253aa
Info.plist       149f9682881e6a72335d77ff28dc22513a997d451e1c85051dce66d524681cfb
App.entitlements 7bf8e813b39b5382f98ced7ed4953167133f1549202cfa1583ac9ec795151059
PrivacyInfo      a331d51864743ebe4e00dd22360b4a538b6b3ac26a6b3eb54094e60a36959a12
```

## Simulator inventory and compile attempt

The first sandboxed `simctl`/`xcodebuild` attempts could not access CoreSimulatorService or Xcode's
user caches. They were repeated with approved host access. During the first approved simulator
inventory, Xcode automatically ran and completed a simulator-support component installation before
returning results. No runtime download was explicitly requested, no repository file changed, and
the host-level side effect is recorded here rather than treated as a product result.

CoreSimulator then reported:

- iOS 26.3 and 26.4 runtimes;
- shutdown iPhone and iPad simulator devices for those runtimes;
- no booted device.

`xcodebuild -showsdks` reported iOS/iOS Simulator SDK 26.5. However,
`xcodebuild -showdestinations` found no eligible destination for `App`, and the bounded unsigned
simulator build:

```text
xcodebuild -project ios/App/App.xcodeproj \
  -scheme App -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  -disableAutomaticPackageResolution \
  -onlyUsePackageVersionsFromResolvedFile \
  CODE_SIGNING_ALLOWED=NO build
```

stopped before compilation with exit 70:

```text
Supported platforms for the buildables in the current scheme is empty.
Unable to find a destination matching generic/platform=iOS Simulator.
iOS 26.5 is not installed.
```

The available 26.3/26.4 simulator runtimes did not satisfy Xcode's required 26.5 platform state.

## Owner-authorized platform install and simulator continuation

The owner then explicitly authorized installing what the validation required.
`xcodebuild -downloadPlatform iOS` downloaded and installed the iOS 26.5 Simulator runtime
(`23F77`, arm64; 8.52 GB) in one bounded attempt. This was a host/Xcode change, not a repository,
application, Supabase, production, provider, or deployment change.

After installation:

- the generic unsigned Debug simulator build completed successfully;
- a device-specific unsigned Debug build completed successfully for an iPhone 17 Pro simulator on
  iOS 26.5;
- the build compiled and linked the `App` target and its 38-target dependency graph for the
  simulator;
- the produced `App.app` existed;
- the produced app did **not** contain `PrivacyInfo.xcprivacy`, confirming
  `MOB-NATIVE-021` against a real build artifact;
- the previously shutdown simulator booted successfully;
- `simctl install` succeeded;
- `simctl launch` returned a process ID for `com.utahprosrestoration.upr`;
- the installed app container resolved after five seconds.

The smoke did not authenticate or exercise business data. It did not claim visual correctness,
network behavior, a successful user workflow, or physical-device behavior.

Cleanup ran in `finally`: the app was terminated and uninstalled, the simulator started by this
pass was shut down, and temporary DerivedData/build products were removed. A final check showed the
iOS 26.5 iPhone 17 Pro simulator shutdown and no booted simulator.

## Honest result and remaining gates

This pass improves the prior Windows-only evidence by proving that this macOS/Xcode host can parse
the checked-in project and locked SPM graph, compile/link an unsigned simulator application, and
boot/install/launch that application on an iOS 26.5 simulator.

The following remain unverified:

- visual inspection and authenticated simulator workflows;
- simulator navigation, permissions, safe areas, keyboard, lifecycle, push, deep links, biometrics,
  privacy snapshot, offline queue, or OTA behavior;
- complete produced `.app` content inspection beyond confirming the missing privacy manifest;
- physical iPhone/iPad behavior;
- development/distribution provisioning compatibility, archive/export, codesign and final
  entitlements;
- App Store Connect authentication, TestFlight upload/install, App Review, or release readiness.

Archive/sign/export and physical-device work remain separate explicitly authorized release gates.
The successful simulator smoke does not close the privacy-manifest finding or any signed-device,
security, privacy, push, deep-link, OTA, accessibility, or release gate.
