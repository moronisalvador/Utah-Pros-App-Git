---
name: close-out-ends-in-pr-and-notification
description: "Owner-directed 2026-08-08 — finished, verified work must end in a pushed PR into dev plus an owner notification, never a silent uncommitted diff"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 164d8638-495e-4d41-85d1-abdfe54f1ff2
  modified: 2026-08-08T18:29:22.282Z
---

On 2026-08-08 the owner replaced close-out-standard.md item 11 ("publish only when requested — stop
with the diff") with: once the checklist is green, **commit, push, open a PR into `dev`, and notify
the owner** (push notification or session message) with the PR link and verification summary.

**Why:** a completed, reviewer-passed security fix (three session-only workers, PR #601) sat
uncommitted in a worktree for 3 days because the session dutifully stopped at the diff waiting for a
publication request. The owner called that "a big problem" — a finished fix nobody knows about
protects nothing.

**How to apply:** treat the PR-plus-notification as the final checklist step of any session whose
work passes verification — do not end a session on a finished diff and do not wait to be asked.
Still owner-gated: click-merging the PR (unless directed in conversation), migration applies,
provider/webhook/flag actions, and `dev → main` promotion. An explicit in-conversation
direct-to-`dev` routing (Rule 4) overrides the default PR. The amended rule is committed in
`.claude/rules/close-out-standard.md` (landed with PR #601's branch, merge `9b1d12fb`); running
sessions that loaded the old text follow the owner's spoken rule, not the stale file.
