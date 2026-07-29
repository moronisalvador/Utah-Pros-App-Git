# Native Push and TestFlight preflight evidence — 2026-07-28

**Last verified:** 2026-07-28
**Branch:** `codex/mobile-readiness-native-usability`
**Base SHA:** `bf45ae00fd96e8b115220fab2d2920472b9ca533`
**Result SHA:** pending; this evidence describes an uncommitted reviewed batch.

## Scope and limits

This is sanitized local qualification evidence. It did not sign, upload,
deploy, mutate a provider, send a notification, or touch the shared database.
It does not replace the clean-`main` signed artifact produced by the protected
GitHub workflow.

## Exact production-configured bundle command

```bash
node scripts/qa/run-owned-subprocess.mjs --timeout-ms 290000 -- \
  env VITE_BUILD_TARGET=native \
  VITE_NATIVE_API_ORIGIN=https://utahpros.app \
  VITE_NATIVE_PUSH_ENABLED=true \
  VITE_APNS_ENV=production \
  VITE_RELEASE_SHA=local-testflight-preflight \
  node --env-file=/Users/moronisalvador/APPS/Utah-Pros-App-Git/.env.local \
  node_modules/vite/bin/vite.js build
```

Result: Vite 8.0.1 transformed 457 modules and completed successfully. The
owned process group was verified gone.

Capacitor synchronization then ran under the same five-minute owned-process
boundary:

```bash
node scripts/qa/run-owned-subprocess.mjs --timeout-ms 290000 -- \
  npx cap sync ios
```

Result: ten reviewed Capacitor plugins were synchronized. The generated config
contained `PushNotifications.presentationOptions` exactly
`["badge","sound","alert"]`, and `git diff --exit-code -- ios/App` passed.

## Exact unsigned Release compile command

The temporary derived-data directory was
`/private/tmp/upr-testflight-final.MDYw0I`.

```bash
node scripts/qa/run-owned-subprocess.mjs --timeout-ms 290000 -- \
  xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination generic/platform=iOS \
  -derivedDataPath /private/tmp/upr-testflight-final.MDYw0I \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

Result: Xcode 26.6 / build 17F113 printed `** BUILD SUCCEEDED **`, and the
wrapper verified process group `6102` was gone. The built app reported:

- bundle identifier `com.utahprosrestoration.upr`;
- marketing version `1.0.0`;
- build number `1`;
- app-target `PrivacyInfo.xcprivacy` present;
- compiled assets containing `https://utahpros.app`;
- compiled assets containing `local-testflight-preflight`.

The temporary derived-data directory was then removed and its absence was
verified. No unsigned app artifact was retained or presented as distributable.

## Source and test evidence

- Native account-bound preference, cleanup, tap, and Settings lane:
  63 unit tests passed.
- APNs serialization lane: 13 Worker tests passed.
- iOS workflow source contract: 30 tests passed.
- Targeted ESLint for the changed executable files: zero findings.
- `git diff --check`: passed.
- Repository-wide lint remains the recorded baseline and reports 2,963
  pre-existing findings outside this batch.

## Remaining gates

The protected workflow must still run from an exact reviewed `main` SHA. It
must install Ruby 3.3.12/Bundler 2.5.22, build with
`VITE_NATIVE_API_ORIGIN=https://utahpros.app`,
`VITE_RELEASE_SHA=${{ github.sha }}`, production Push flags, sign with the
App Store profile, verify the archive/IPA, and retain the sanitized report
before any separately authorized TestFlight upload.
