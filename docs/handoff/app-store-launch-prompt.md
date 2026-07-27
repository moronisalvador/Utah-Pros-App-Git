<!--
FILE: docs/handoff/app-store-launch-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for a fresh session that closes the remaining gaps before
  the Capacitor app can be submitted to the App Store. Written 2026-07-27, the day
  the Apple Developer Program enrolment was approved.

DEPENDS ON:
  Internal: .claude/rules/app-store-readiness-wave-ownership.md,
            docs/app-store-readiness-roadmap.md,
            docs/handoff/pr-525-integration-prompt.md (must land first),
            ios/App/App.xcodeproj/project.pbxproj, ios/App/App/Info.plist
  Data:     reads → repository + read-only live catalog
            writes → ios/ project files, docs

NOTES / GOTCHAS:
  - Most of what remains can ONLY be done by the owner on a Mac. The session's job is
    to make the repository side correct so the Xcode work is short and boring.
  - Verified state 2026-07-27. Re-check; several claims are file-existence checks.
-->

# Handoff — close the App Store gaps for the Capacitor build

Paste everything from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). The Apple Developer
Program enrolment was approved on 2026-07-27. The plan is: ship the **Capacitor** app first, the owner
self-tests for a few days, then the whole team uses it while native Swift work begins separately.

Your job is the **repository side** of App Store readiness. Most of what is left can only be done by
the owner on a Mac; your goal is to make the Xcode work short and boring rather than exploratory.

## Prerequisite — do not start until this is true

**PR #525 must be integrated first.** It *is* the mobile PWA/Capacitor hardening: 11 `ios/` files, the
`AuthContext` rewrite, the offline work. Its plan is `docs/handoff/pr-525-integration-prompt.md`, and
it carries a confirmed blocker that discards a technician's moisture reading while showing
"Reading saved". Shipping the Capacitor app without it means shipping without the hardening.

Also land the two security migrations named in `docs/handoff/apply-window-and-followups-prompt.md`
before any App Store distribution. Reason: the anon key is embedded in the shipped bundle, and #525's
`employees` containment plus the `contacts` closure are exactly the privacy improvements that should
be *inside* the binary, not bolted on after it is on devices you cannot force-refresh.

Check `git log --oneline origin/main..origin/dev` and the PR state before assuming either is done.

## Already verified present — do NOT redo this work

- `ios/App/App/PrivacyInfo.xcprivacy` (Apple's privacy manifest, mandatory since May 2024)
- `ios/App/App/Info.plist` with `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSFaceIDUsageDescription`
  — and the app genuinely uses camera (9 files), geolocation (4), biometrics (4), so each string is
  justified rather than boilerplate
- **Account deletion** — `request_account_deletion` wired in `src/pages/settings/MyAccount.jsx` with
  its migration. This is Guideline 5.1.1(v) and a very common rejection. It is done.
- `/privacy`, `/terms`, `/support` routed in `src/App.jsx` — the URLs App Store Connect asks for
- `ios/fastlane/Fastfile` and `.github/workflows/ios-release.yml`
- Bundle identity consistent: `com.utahprosrestoration.upr` in both `project.pbxproj` and
  `capacitor.config.json`; `AppIcon.appiconset` and `Splash.imageset` populated

## Task 1 — The build blocker

`ios/App/App.entitlements` **does not exist**, but `ios/App/App.xcodeproj/project.pbxproj` references
it **4 times**. That is a dangling project reference: the build fails, or the push entitlement silently
never ships. `.claude/rules/app-store-readiness-wave-ownership.md` assigns this file to Phase F1, whose
work looks incomplete.

Create it. It needs at minimum `aps-environment` (`development` for TestFlight builds, `production`
for release — Xcode normally manages this per configuration, so verify how the project is set up rather
than hardcoding one). Confirm the four `project.pbxproj` references resolve to the path you create, in
both Debug and Release configurations. **You cannot compile here** — state that plainly and hand the
build check to the owner.

## Task 2 — Push notifications on the native build

There is no `UIBackgroundModes` → `remote-notification` in `Info.plist`. The app has a full
notification stack — the bell, `device_tokens`, the `send-push` worker, `functions/lib/webPush.js` — and
on a native build without the capability, none of it delivers. That is the first thing the team will
report as broken.

Add the background mode, and confirm the APNs registration path in `AppDelegate.swift` actually
registers the device token against `device_tokens`. Trace it; do not assume the plumbing is complete
just because the table exists.

Note: Web Push (the PWA path) and APNs (the native path) are different mechanisms. Establish which one
the Capacitor build is meant to use before changing anything — the repo has both.

## Task 3 — Produce the App Store Connect answer sheet

The owner has to fill in App Privacy, and wrong answers there are both a rejection risk and a
compliance problem. Do the work of finding the truth and write it down, in
`docs/app-store-privacy-disclosure.md`:

- **What personal data the app actually collects**, derived from the schema and the code, not guessed.
  At minimum expect: names, phone numbers, email addresses, physical addresses, photos, precise
  location (`job_time_entries` geolocation), and employee identifiers.
- For each: is it linked to identity, used for tracking, and what is the purpose (app functionality vs
  analytics)? This app does not appear to do third-party ad tracking — verify rather than assert.
- Which third parties receive data: Supabase, Cloudflare, Twilio/CallRail, Resend, QuickBooks, Stripe,
  Encircle, Google. Each needs a purpose line.
- Whether any of it is collected from people who are **not** the user — customers' data entered by
  employees. This is the subtle one, and it changes the disclosure.

## Task 4 — The demo account plan

Apple reviewers must be able to log in. An employee-only tool with no self-signup gets rejected fast
without working credentials in App Store Connect.

There is already a `[Local Dev Test Account]` pattern (`admin` role, `is_external: true`, its own Auth
user). Write the plan for a **review-only** account modelled on it: what it can see, what it must not
be able to do, and how it is disabled after review. Do not create it and **never type credentials** —
hand the exact steps to the owner.

## Task 5 — Submission checklist

Write `docs/app-store-submission-checklist.md` covering, with owner-vs-session ownership marked on
each: version and build numbers (currently `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`),
screenshots per required device size, age rating answers, export-compliance (the app uses HTTPS —
usually the standard exemption, confirm), the privacy-policy and support URLs, and the TestFlight
internal-testing route for the owner's own multi-day test.

## Distribution route — DECIDED: public App Store

**The owner has decided on the public App Store, not Apple Business Manager custom distribution.**
Reason: the product is heading toward multi-tenant, and having the app already approved makes that
transition far easier than starting a review cycle later. Do not reopen this decision.

What that means for your work: the app must read as a **B2B product other companies could subscribe
to**, not as one company's internal tool. Apple can reject a single-company internal app submitted for
public distribution, and the usual trigger is a listing that makes it obvious. Login-gated B2B apps are
entirely normal on the public store — the difference is positioning and reviewability, both of which
are solvable:

- The App Store listing description should describe the product (restoration job management,
  scheduling, field documentation, billing), not "Utah Pros staff app".
- **Working demo credentials are non-negotiable** here, more so than for custom distribution — a
  reviewer who cannot get past the login screen has no way to evaluate anything. See Task 4.
- Expect a possible Guideline 4.2 / 4.3 question. The honest answer is that this is a vertical B2B
  SaaS product; if a reviewer pushes back, the response is product framing plus a working account, not
  an argument.

Flag to the owner, without blocking on it: if multi-tenant is genuinely near, the account/organisation
model and the sign-up path are what a reviewer will look for. Nothing in the current app lets a new
company self-register, so the listing should not promise that until it exists.

## What only the owner can do

Say so plainly rather than appearing to have covered it: the Xcode build, archive and signing;
certificates and provisioning profiles; the App Store Connect app record, App Privacy answers,
screenshots, age rating and demo credentials; TestFlight distribution; and the on-device checks that
`close-out-standard.md` §3 and §7 require — minimize/resume on a real installed iPhone, 390px, and
gesture feel. This environment has no Xcode and cannot compile or sign iOS code.

## Hard constraints

- Do not apply a migration, commit, push, open a PR or deploy without the owner asking.
- Do not create the review account or enter any credential.
- Report actual results, never expected. Every claim about the iOS project should be a file you read.
