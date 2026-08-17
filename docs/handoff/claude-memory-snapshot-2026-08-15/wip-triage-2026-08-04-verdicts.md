---
name: wip-triage-2026-08-04-verdicts
description: "Full 3-workflow triage of 55 remote branches, 15 closed PRs, 13 dirty worktrees — verdicts and where the report lives"
metadata: 
  node_type: memory
  type: project
  originSessionId: 821d385a-ca1c-4ac2-bd78-318c18ecc1c0
  modified: 2026-08-05T03:52:21.648Z
---

On 2026-08-04 an ultracode 3-workflow sweep triaged all abandoned work. Report (with delete lists
and evidence): `docs/audit/2026-08/wip-triage-2026-08-04.md`. Register entries: `docs/wip/*.md`
(10 items). Headline: **nothing of substance was lost** — the pile was almost entirely squash
merges/relands git ancestry can't see.

- **45 remote branches provably dead** (24 recoverable via PR after deletion, 21 with no PR).
  Deletion is owner-gated and had NOT been run as of the sweep.
- **Keep forever:** `codex/native-ios-plan` (only copy of owner-accepted native-Swift blueprint),
  `codex/mobile-readiness-conversation-notifications` (design ref for per-conversation mute, the
  one capability dev lacks), both `rescue/*`.
- **4 dirty worktrees hold real uncommitted work:** `inspiring-tesla-8b829c` (QBO grouped
  receive-payment repair — feature never worked; migration 20260805010000 + tests, base 14
  commits stale), `epic-blackburn-d8654f` (only copy of `docs/qbo-invoice-drift-2026-08-04.md`),
  `vibrant-einstein-fa6091` (−36KB verified dead-CSS sweep of index.css, needs porting),
  `kind-grothendieck-9f41f6` (ratchet-baseline audit, blocked on owner decision re 82-file
  baseline expansion).
- 9 other dirty worktrees verified REDUNDANT/JUNK — every hunk found in pushed dev commits — but
  discard stays owner-gated.
- The 3 stashes were NOT triaged; review by hand before dropping.
- PR #224's site-wide CSP never shipped (tracked as backlog 28/SEC-002). 3 workers with
  session-only auth (stripe-accounts, analyze-xactimate, collections-chat) spun off as a chip.
- Outside this repo: utah-pros-website PRs #19/#20 open since 2026-07-19; XactimaPro has 4
  abandoned July worktree sessions.

Related: [[rescue-branches-2026-08-01]], [[uncaptured-local-work-2026-07-31]].
