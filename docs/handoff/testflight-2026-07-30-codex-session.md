# Codex session instructions — App Store Connect console lane (2026-07-30)

**Last verified:** 2026-07-30 · **Scope: exactly the three items below, in the browser.**
A separate Claude Code session owns the build lane
(`testflight-2026-07-30-claude-session.md`); the master runbook is
`testflight-2026-07-30-macbook.md`. `AGENTS.md` binds this session in full.

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
