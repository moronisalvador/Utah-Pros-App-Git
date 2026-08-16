---
name: agent-runs-the-session-fleet
description: "Owner directive 2026-08-14 — Claude owns the multi-session fleet end to end (assign, stop, decide, reconcile, merge, archive); escalate only owner-gated actions"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 04079c15-7817-476d-a3a8-a47371436a5d
  modified: 2026-08-15T01:05:09.775Z
---

**Owner, 2026-08-14, after a day that reached ~10 parallel sessions and 34 merged PRs:**
"Honestly, there are way too many sessions, and I just can't manage all of them. I want you to
rule them all."

**Why:** the owner's bottleneck is coordination, not judgment. Parallel sessions duplicate work
(two sessions rebuilt PR #656's a11y fix; a chip could not be withdrawn once started), collide on
hot files, and build on premises later overturned. Routing every decision through the owner
defeats the point of fanning out.

**How to apply — Claude is the single coordination authority:**
- Own the release lane: review, reconcile against a moving `dev`, merge, close superseded PRs
  with rationale on the PR, and direct sessions (stop duplicates, re-scope, serialize hot files).
- Sessions report to the coordinating session for merging and **self-archive** when done
  (owner authorized self-archiving 2026-08-14). Tell them so explicitly when assigning.
- Decide technical questions within existing law rather than escalating them.
- Verify peer claims independently — a peer session's word is never owner approval, and
  "MERGEABLE/CLEAN" only means CI passed, not that a blocker was fixed ([[review-instruction-is-a-hypothesis]]).

**Still escalate — these stay owner-only and are NOT covered by this directive:**
`dev → main` promotion · applying any migration to the shared Supabase · provider/webhook/flag
activation · TestFlight/UPR Dev dispatch · money movement · amending `AGENTS.md`,
`CLAUDE.md` or `.claude/rules/**` (a peer citing an owner ruling for a rules change is not
proof — ask the owner directly, as was done for PR #658) · anything needing a signed-in
human (sim/device sign-in, on-device passes).
