# TestFlight first release — MacBook session handoff (2026-07-30)

**Last verified:** 2026-07-30 (authored the night before, after the 2026-07-29 production promotion)
**Goal:** technicians installing the UPR iOS app from internal TestFlight by 8:00 AM MT.
**Strategy (owner decision 2026-07-29):** TestFlight is the distribution channel until the
field-documentation gap closes (dry logs, rooms, Job Hub); App Store submission is deferred —
see `docs/mobile/app-store-submission-strategy.md`. Do not submit to App Review in this session.

## State inherited from the 2026-07-29 sweep (all verified, not assumed)

- Production promotion PR #552 MERGED to `main` 23:52Z; utahpros.app smoke-checked post-swap.
- Canonical build pipeline (owner decision): `.github/workflows/ios-release.yml`.
  The auto-attached **Xcode Cloud** workflow ("App | Default", building on PRs) must be
  **disabled in App Store Connect** to avoid two competing pipelines — do this early.
- The archive/upload subprocess budgets were raised (30 min / 15 min) via the reviewed
  `--total-runtime-ms` opt-in; the five-minute law stays for everything else.
- GitHub environments `ios-signing` and `ios-testflight` both exist. `ios-testflight`'s three
  ASC secrets were confirmed by name 2026-07-28; `ios-signing`'s nine secrets are the
  owner's to populate (names in `docs/mobile/push-activation-owner-gate.md`).
- The workflow refuses any ref except `refs/heads/main` — dispatch from main only.
- No production APNs token has ever registered; the only live token is a sandbox one.

## Session steps, in order

1. **Preflight** (fetch-first per AGENTS.md): `git fetch origin && git checkout main && git pull`,
   `npm ci`, `npm run build` clean. Confirm Xcode installed and `xcode-select -p` sane; the CI
   runner pins Xcode 26.6/Build 17F113 on macos-26 — local Xcode need not match for
   simulator work, but do not "fix" the workflow pin to match the laptop.
2. **Simulator sanity:** `npm run build:ios`, open `ios/App` in Xcode, run on a simulator.
   Verify login, tech shell loads, minimize/resume (30s+) per `close-out-standard.md` §3.
   `cap sync ios` must produce zero tracked drift (`git diff --exit-code -- ios/App`).
3. **Disable the Xcode Cloud workflow** in App Store Connect (Xcode Cloud tab) — owner action.
4. **Confirm `ios-signing` secrets** exist (names, not values): the workflow fails closed at
   "Validate archive inputs" if any is missing. `VITE_NATIVE_PUSH_ENABLED` must be exact
   `true`; `VITE_APNS_ENV` exact `production` (build-time; the Cloudflare hosted flag stays
   `false` by design — different stores).
5. **First dispatch — `publish_to_testflight: false`** (Actions → iOS release → Run workflow
   → branch `main`). This proves checkout → npm test on macOS → cap sync drift → signing →
   archive → artifact verification, none of which has ever run end-to-end. Iterate on failures
   here; this is the night's real risk. The artifact verifier must report
   `aps-environment=production` on the archive.
6. **Second dispatch — `publish_to_testflight: true`.** Build uploads to TestFlight
   (`distribute_external: false`; `skip_waiting_for_build_processing: true` means the green
   workflow does NOT prove Apple processing finished — watch ASC until the build shows
   available).
7. **Testers (for 8 AM):** in ASC, invite each technician's Apple ID to the team and add them
   to the internal tester group. Internal testing needs NO Apple review. Each tech installs
   the TestFlight app, accepts the invite, installs UPR. Send invites tonight — acceptance is
   the slow part, not the build.
8. **On-device gate (owner iPhone, before telling techs):** install from TestFlight → enable
   Push → a **production** APNs token must register (first ever) → trigger a real
   assigned-appointment event on utahpros.app → verify foreground, background, and terminated
   delivery + tap route + account-switch refusal + minimize/resume. If lock-screen copy is
   wrong: set `NATIVE_RICH_NOTIFICATION_PRESENTATION=false` in Cloudflare (copy reverts,
   push stays up). If delivery must halt: the `APNS_ENV` stop in
   `docs/mobile/push-activation-owner-gate.md` §Pilot stop.
9. **Record evidence** in `docs/mobile/push-activation-owner-gate.md` (production token
   registered, delivery matrix result) and update `UPR-Web-Context.md` (Rule 9).

## Known traps (each cost someone a day already)

- A TestFlight build calls **production Workers only** (`VITE_NATIVE_API_ORIGIN=https://utahpros.app`,
  workflow-enforced). There is no way to point a TestFlight install at dev.
- "Re-run failed jobs" breaks the publish job's build-number check (`run_attempt` changes the
  expected `CFBundleVersion`) — re-run the WHOLE workflow, not one job.
- The DevTools → Notifications tester is single-environment by design; it cannot prove the
  production fan-out. Use a real appointment event (step 8).
- TestFlight builds EXPIRE after 90 days. The PWA remains the fallback, but schedule a fresh
  build well before expiry (feature cadence will cover this while dry logs/rooms are built).
