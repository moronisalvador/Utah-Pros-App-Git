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
3. **Pause the Xcode Cloud workflow's PR trigger** in App Store Connect (Xcode Cloud tab) —
   owner action. Do not delete the workflow; the reasons it is not canonical are (a) its
   builds bypass `scripts/qa/verify-ios-release-artifact.mjs` entirely and (b) PR-triggered
   builds burn the free compute allowance on noise. Revisit deliberately later if
   Apple-managed CI is ever wanted.

### Build path decision (added 2026-07-29, after the signing-material check)

The owner has **no exported Apple Distribution certificate or App Store provisioning
profile yet**, so the CI workflow's `ios-signing` secrets cannot be populated tonight.
**Path B below is tonight's route; Path A becomes the durable pipeline afterwards.**

**Path B — local Xcode archive (tonight):**
4. In Xcode (`ios/App`), signing set to "Automatically manage signing", team `H6ZUT739T9` —
   Xcode creates/manages the distribution certificate and profile with the owner's Apple ID
   session (the owner logs in; the agent never enters credentials).
5. Build the web bundle with the workflow's exact invariants as build-time env:
   `VITE_NATIVE_API_ORIGIN=https://utahpros.app`, `VITE_NATIVE_PUSH_ENABLED=true`,
   `VITE_APNS_ENV=production`, `VITE_RELEASE_SHA=<exact main HEAD sha>` — via
   `npm run build:ios` (read `scripts/build-native.mjs` for how env flows). Source must be
   clean `main` HEAD, zero tracked drift after `cap sync ios`.
6. Product → Archive (Any iOS Device). Then, BEFORE uploading, run the repo verifier
   against the archive/IPA (`node scripts/qa/verify-ios-release-artifact.mjs --archive ...`)
   — it must pass, including `aps-environment=production`. A local build does not skip the
   safety contract; only the transport differs.
7. Upload to TestFlight from the Xcode Organizer (internal distribution only).
8. **Afterwards (not tonight):** export the now-existing certificate as a `.p12` +
   download the profile, populate the seven `ios-signing` secrets, and prove Path A with a
   `publish_to_testflight: false` dispatch — so every FUTURE build ships through the
   audited workflow.

**Path A — the audited CI workflow (once secrets exist):**
- **Confirm `ios-signing` secrets** exist (names, not values): the workflow fails closed at
  "Validate archive inputs" if any is missing. `VITE_NATIVE_PUSH_ENABLED` must be exact
  `true`; `VITE_APNS_ENV` exact `production` (build-time; the Cloudflare hosted flag stays
  `false` by design — different stores). `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
  fall back to existing repository-level secrets — do not duplicate them.
- **First dispatch — `publish_to_testflight: false`** (Actions → iOS release → Run workflow
  → branch `main`). This proves checkout → npm test on macOS → cap sync drift → signing →
  archive → artifact verification, none of which has ever run end-to-end. The artifact
  verifier must report `aps-environment=production` on the archive.
- **Second dispatch — `publish_to_testflight: true`.** Build uploads to TestFlight
  (`distribute_external: false`; `skip_waiting_for_build_processing: true` means the green
  workflow does NOT prove Apple processing finished — watch ASC until the build shows
  available).

### Both paths continue here

9. **Testers (for 8 AM):** in ASC, invite each technician's Apple ID to the team and add them
   to the internal tester group. Internal testing needs NO Apple review. Each tech installs
   the TestFlight app, accepts the invite, installs UPR. Send invites tonight — acceptance is
   the slow part, not the build.
10. **On-device gate (owner iPhone, before telling techs):** install from TestFlight → enable
   Push → a **production** APNs token must register (first ever) → trigger a real
   assigned-appointment event on utahpros.app → verify foreground, background, and terminated
   delivery + tap route + account-switch refusal + minimize/resume. If lock-screen copy is
   wrong: set `NATIVE_RICH_NOTIFICATION_PRESENTATION=false` in Cloudflare (copy reverts,
   push stays up). If delivery must halt: the `APNS_ENV` stop in
   `docs/mobile/push-activation-owner-gate.md` §Pilot stop.
11. **Record evidence** in `docs/mobile/push-activation-owner-gate.md` (production token
    registered, delivery matrix result, which build path was used) and update
    `UPR-Web-Context.md` (Rule 9).

## Known traps (each cost someone a day already)

- A TestFlight build calls **production Workers only** (`VITE_NATIVE_API_ORIGIN=https://utahpros.app`,
  workflow-enforced). There is no way to point a TestFlight install at dev.
- "Re-run failed jobs" breaks the publish job's build-number check (`run_attempt` changes the
  expected `CFBundleVersion`) — re-run the WHOLE workflow, not one job.
- The DevTools → Notifications tester is single-environment by design; it cannot prove the
  production fan-out. Use a real appointment event (step 10).
- TestFlight builds EXPIRE after 90 days. The PWA remains the fallback, but schedule a fresh
  build well before expiry (feature cadence will cover this while dry logs/rooms are built).
