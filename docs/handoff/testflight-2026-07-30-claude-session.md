# Claude Code session instructions — TestFlight build night (2026-07-30, MacBook)

**Last verified:** 2026-07-30 · **Scope: the build lane only.** A separate Codex session
handles the App Store Connect console lane (`testflight-2026-07-30-codex-session.md`);
do not duplicate its work and do not wait on it — the lanes are independent until the
tester-install step.

## Your lane

Execute **Path B (local Xcode archive)** of `docs/handoff/testflight-2026-07-30-macbook.md`,
which is the master runbook. In short: simulator sanity → clean `main` HEAD build with the
workflow invariants as build-time env → Xcode archive with automatic signing (the owner logs
into Xcode/Apple themselves; never enter credentials) → run
`scripts/qa/verify-ios-release-artifact.mjs` against the archive/IPA and require PASS
(including `aps-environment=production`) BEFORE any upload → Organizer upload to internal
TestFlight → then the owner's on-device push gate (master runbook step 10) → record
evidence (step 11).

## Git shape for this session (deliberate — do not "improve" it)

- One clone, no worktree. Start on `dev` (fetch first) to read the handoff docs.
- The BUILD runs from clean **`main` HEAD** (`git checkout main && git pull`;
  `VITE_RELEASE_SHA` = that exact sha; zero tracked drift after `cap sync ios`).
- Evidence/doc commits at the end go to **`dev`** per Rule 4 (checkout dev again for the
  close-out writes). Nothing else writes to this tree tonight, so no worktree is needed.

## Conduct

- The runbook's stop points are the deliverable, not obstacles. Do not proceed past a
  failed verifier, a dirty tree, or a skipped owner gate to "keep momentum".
- Do not dispatch `.github/workflows/ios-release.yml` tonight (Path A waits for signing
  secrets that do not exist yet), do not touch `publish_to_testflight`, and do not submit
  anything to App Review (`docs/mobile/app-store-submission-strategy.md` governs).
- After the upload succeeds, help the owner export the newly created distribution
  certificate (.p12) and download the profile, so the seven `ios-signing` secrets can be
  set (by the owner, from their own terminal — never through an agent) and Path A can be
  proven with a `publish_to_testflight: false` dispatch on a later day.
