# Codex session instructions — App Store Connect console lane (2026-07-30)

**Last verified:** 2026-07-31 · **Scope: exactly the three items below, in the browser.**
A separate Claude Code session owns the build lane
(`testflight-2026-07-30-claude-session.md`); the master runbook is
`testflight-2026-07-30-macbook.md`. `AGENTS.md` binds this session in full.

## Verified console follow-up (2026-07-31)

- **Cloudflare Preview fallback restored — complete.** In Pages project
  `utah-pros-app-git`, Preview `APNS_TOPIC` was
  `com.utahprosrestoration.upr.dev` and was changed to
  `com.utahprosrestoration.upr`. `APNS_KEY_ID=JX22945D4T` was confirmed;
  `APNS_ENV`, `APNS_TEAM_ID`, and encrypted `APNS_P8_KEY` were present without
  reading or copying the secret. The latest `dev` Preview deployment was
  retried and finished `success` as deployment
  `2d255a10-7bed-49e6-9e0c-8c238bf078f4`. Production was untouched. This
  matches the superseding per-token-topic contract in
  `docs/mobile/push-activation-owner-gate.md`; do not flip the fallback again.
- **Xcode Cloud trigger pause — still open; no change was made.** The UPR Xcode
  Cloud page and the team Xcode Cloud page both showed Apple's “Create a
  workflow in Xcode to get started” state, with no workflow list. Direct Xcode
  inspection found both shared schemes (`App` and `UPR Dev`), but
  Integrate → Xcode Cloud → Manage Workflows was disabled for both and Cloud
  Reports showed `Get Started…`.
- **Mailbox evidence proves the hidden workflow is still running against
  `dev`.** Gmail contained 96 Xcode Cloud failure notices spanning builds 1–98
  from 2026-07-27 through 2026-07-31. Representative messages identify product
  `App`, workflow `Default`, branch `dev`, and failures in
  `ios/App/ci_scripts/ci_post_clone.sh` or missing Capacitor packages under
  `node_modules`. Their report links omit an app id (`/apps//ci/builds/...`),
  which explains why this may be an orphaned or incorrectly linked Xcode Cloud
  product, but that diagnosis is not yet provider-confirmed. Do not report the
  workflow as paused or deactivated.
- **Technician roster status was not re-read during this documentation
  follow-up.** Do not infer final invite/accept/install state from this file;
  use the live App Store Connect internal group before making a roster claim.

## The three tasks (nothing else)

1. **Pause the Xcode Cloud workflow's automatic trigger.** App Store Connect → the UPR app
   → Xcode Cloud tab → workflow "Default": disable/pause its PR-triggered builds. Do NOT
   delete the workflow. Reason on file: its builds bypass the repository artifact verifier
   and PR-triggered builds burn the free compute allowance.
2. **Invite the technicians as internal testers.** ASC → Users and Access: invite each
   technician's Apple ID (the owner supplies the list of emails in conversation); then
   TestFlight → Internal Testing: ensure an internal group exists and add the invited
   users to it. Internal testing requires NO Apple review.
3. **Report evidence.** Return a plain list of what was changed: workflow trigger state
   before/after, exact invitees and their invite status, group name. The Claude session
   records it in the repo; this session commits nothing.

## Hard boundaries (each is absolute)

- No signing material, certificates, profiles, keys, or secrets — viewing, creating,
  downloading, or entering. If a page asks for any of these, stop and tell the owner.
- The owner performs every login themselves; never enter credentials.
- No repository commits, pushes, or file edits. Read-only if run inside the repo.
- No workflow dispatches (GitHub or Xcode Cloud), no build starts, no
  `publish_to_testflight` toggles, no App Review submission, no app-metadata edits,
  no user-role changes beyond the invitations in task 2, no deletions of any kind.
- When the three tasks are done, stop. "Found ways to keep helping" is out of scope
  by owner instruction.
