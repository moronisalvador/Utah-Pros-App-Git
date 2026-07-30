# Session handoff — 2026-07-30 (TestFlight build nights)

**Read this if you are picking up UPR work fresh.** The repository law
(`CLAUDE.md` → `AGENTS.md`, `.claude/rules/`, agents, skills, hooks) is checked
in and binds you already — this file carries only what the law cannot: current
state, open gates, and decisions made in conversation.

## Where the iOS app is

- **Internal TestFlight is the distribution channel.** App Store submission is
  deferred (`docs/mobile/app-store-submission-strategy.md`). Do not submit to
  App Review.
- **Build 1.0.0 (2)** is installed on the owner's iPhone and available to
  internal testers. **Build 1.0.0 (3)** is archived, verifier-PASSED, and staged
  in the Xcode Organizer awaiting the owner's Apple sign-in to upload.
- **Build route is Path B (local archive)** — `docs/handoff/testflight-2026-07-30-macbook.md`.
  Path A (the audited `ios-release.yml` workflow) is still blocked on the seven
  `ios-signing` GitHub secrets, which only the owner can populate. Once they
  exist, releases become `gh workflow run ios-release.yml --ref main -f publish_to_testflight=true`.
- **Never build with the Xcode 27 beta** — its iOS 27 SDK hard-traps the app at
  launch (classic AppDelegate lifecycle). Use the CLI toolchain (Xcode 26.6, the
  CI pin). Detail + the UIScene tech-debt item: `docs/mobile/dev-app-variant.md`.
- **`npm run ios:dev`** puts the side-by-side UPR Dev app (dev branch, dev
  workers, sandbox push) on the owner's phone in one command.

## Open owner gates (not done — do not report these as verified)

1. **Second-account half of the account-switch check.** Sign-out and token
   detach are proven on device; signing in as a *different* employee and
   confirming native Push defaults OFF for them — and that events for employee A
   raise no banner while B is active — has never been observed.
2. **`session_id` claim shape** — decode one real access token locally to confirm
   what the ended-session revival guard keys on.
3. **Cloudflare Preview `APNS_TOPIC`** must change to
   `com.utahprosrestoration.upr.dev` before push reaches the UPR Dev app.
   Owner-only dashboard change.
4. **A2P live sends, provider webhooks, feature-flag flips** — always owner-gated.

## Decisions made in conversation (not derivable from code)

- **Consent is opt-out-only for staff 1:1 service SMS** (owner, 2026-07-28) —
  applied live 2026-07-30, ledger `20260730121811`. Automated/bulk/marketing
  remain global-opt-in-only. Authority: `.claude/rules/sms-experience-wave-ownership.md` §13.
- **Sign-out must always complete immediately** (owner, 2026-07-30). The old
  blocking "Finish securing this device" wall was rejected as overprotective;
  the device-token detach is now invisible and journaled. Do not reintroduce a
  wall for transient failures.
- **Onboarding is three forward-only screens** — no X, no skip — ending in one
  button that triggers the iOS permission prompt. Allow and deny both continue.
  The show-once flag is versioned so the same shell becomes "What's New" later.
- **Capgo OTA is not needed** while TestFlight is the channel; revisit only if
  App Store review latency becomes the constraint.

## Working norms that earned trust this session

- **Verify before claiming.** "Uploaded to Apple" and "available in TestFlight"
  are different facts; say which one you have. Report the actual command output.
- **The verifier is a hard gate.** `scripts/qa/verify-ios-release-artifact.mjs`
  must PASS before any upload, every time, including local builds.
- **Run the lint ratchet AFTER committing.** It reads committed state — checking
  it while changes are staged gives a false pass (this cost a CI cycle on PR #558).
- **Never `git add -A` in this tree.** Other sessions leave uncommitted work
  here; add by explicit path. (Sweeping in another session's WIP test files
  without their paired migrations broke CI on PR #558.)
- **Agent-spawned chips compound.** Sessions suggest tasks that spawn sessions
  that suggest more. Consolidate deliberately; parallel edits to the same file
  create real conflicts that need hand-reconciliation, not blind merges.
- **Proportionality on lint debt.** When the changed-files ratchet demands
  clearing unrelated structural debt for a cosmetic change in a build going to
  technicians, reverting the cosmetic change in those files is the right call —
  and file the deferral.

## Where the running work list lives

`docs/mobile/field-polish-punchlist.md` — on-device findings from real use,
grouped by theme. Open at handoff: notification-bell cold-start jank, a
dedicated Settings → Notifications page, side-tab accent borders, the UIScene
migration, and four files deferred out of the dark-theme sweep.

## Under discussion, not decided

**Messaging channel separation.** The owner wants sales / mitigation /
reconstruction conversations isolated so technicians never see sales pricing or
get reconstruction notifications months after their work. Proposal on the table
was three phone numbers + three inboxes. The counter-argument (recorded here so
the debate is not relitigated from zero): three numbers move misrouting onto the
customer, who cannot know your org chart; they make STOP legally ambiguous
because consent keys on the contact's phone, not the UPR number; and they triple
the A2P surface. The `conversations` table already carries `job_phase_context`,
`job_id`, `assigned_to` and a per-conversation `twilio_number`, so phase-scoped
threads with phase-derived access and notification audiences are mostly a
finishing job, not a rewrite. The hard part either way is inbound routing, which
needs a staff "move to…" control regardless of how many numbers exist. A second
number is defensible for marketing-vs-service (different compliance class,
different carrier treatment) but not for mitigation-vs-reconstruction. **No
decision made.** This deserves `/masterplan`, not an ad-hoc build.
