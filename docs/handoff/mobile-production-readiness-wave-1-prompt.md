/**
 * ════════════════════════════════════════════════
 * FILE: mobile-production-readiness-wave-1-prompt.md
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Provides the exact opening request for the first implementation task after the foundation.
 *   It keeps the task focused on current-state proof and the two urgent security boundaries.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  docs/mobile-production-readiness-roadmap.md,
 *              docs/mobile-production-readiness-wave-ownership.md
 *   Data:      reads  → documentation only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Select GPT-5.6 Sol with Ultra reasoning before sending this prompt.
 *   - This prompt explicitly stops before all production, provider, signing, and deployment writes.
 * ════════════════════════════════════════════════
 */

# Wave 1 Prompt — Current-State Recapture and P0 Implementation Map

Open a new Codex task in the UPR repository, select **GPT-5.6 Sol** and **Ultra** reasoning, check
out `codex/mobile-pwa-readiness-foundation`, and send the following:

```text
Begin UPR Mobile Production Readiness Wave R0 from branch
codex/mobile-pwa-readiness-foundation.

Read AGENTS.md and CLAUDE.md completely, then the applicable .claude/rules, the canonical
docs/mobile/* set, docs/mobile-production-readiness-roadmap.md,
docs/mobile-production-readiness-wave-ownership.md, docs/audit/mobile-pwa/*,
docs/audit/2026-07/evidence/live-supabase.md, docs/architecture.md,
docs/database-schema.md, docs/auth-and-authorization.md, docs/business-rules.md,
docs/integrations.md, docs/testing-and-deployment.md, and UPR-Web-Context.md. Use
$mobile-readiness-wave.

Create a fresh isolated worktree and codex/ wave branch from the foundation HEAD. Fetch current
origin/dev, record its SHA, and reconcile any newer commits without dropping the foundation. After
the foundation is integrated into dev, current origin/dev becomes the base. Preserve the audit
history and record the audit source SHA ef305f6d6afab4d846eab92fc1b04038d70221f0, foundation/wave
base SHA, and current origin/dev SHA. Do not assume the dated audit describes current dev.

Your bounded outcome is:
1. recapture the current source/configuration/caller state relevant to MOB-SEC-014 and MOB-SEC-015;
2. produce an exact route → UI caller → worker/RPC/direct query → policy/grant/object boundary map;
3. record owner decisions still required for PWA cold-offline support, Capacitor field-route scope,
   admin-mobile exclusion, push, OTA, account deletion, and pilot support;
4. propose the smallest contract-preserving containment slices, negative-test matrix, rollout,
   rollback, and separate live-apply plan;
5. if the current evidence is sufficient, implement and locally verify only a narrowly bounded
   source/test/documentation slice that does not mutate any external system. Otherwise leave a
   review-ready implementation handoff rather than guessing.

Use one GPT-5.6 Sol Ultra primary and at most three subagents. Delegate only concrete bounded work
under docs/mobile-production-readiness-wave-ownership.md. Start with the
mobile-readiness-mapper, use mobile-readiness-security-reviewer for an independent adversarial pass,
use mobile-readiness-contract-tester for the negative/failure matrix, and use
mobile-readiness-release-auditor at close-out. Only the primary writes unless it declares disjoint
file ownership first.

Keep Supabase, Storage, Cloudflare, providers, production, customer data, Apple signing, TestFlight,
and App Store Connect read-only. Do not apply migrations, deploy, send messages or push, move
money, inspect customer object contents, change secrets/settings, merge, sign, distribute, or
submit. Any live apply or deployment must be a later, separately authorized task from a reviewed
commit.

Bound every server/browser/simulator/Xcode subprocess to five minutes. Guarantee owned child-tree
cleanup in try/finally and verify the port/process afterward. Record unavailable authenticated
identities, physical devices, signing, entitlements, provider access, and simulator limitations
honestly; do not turn them into inferred proof.

Before editing, report the base SHA, worktree state, current finding drift, complete affected caller
inventory, ownership table, and planned verification. Preserve deployed contracts and unrelated
changes. Add negative authorization and failure-path tests for any implemented sensitive change.
Update canonical docs and the unfinished-work registry when decisions or status change. Finish with
actual verification results, exact changed files, commit/working-tree state, open external gates,
and the next ready-to-use session prompt.
```

## Expected first-task deliverables

- a current-state P0 contract map tied to the new `origin/dev` SHA;
- an owner decision record for supported mobile scope;
- a bounded implementation sequence with explicit file and system ownership;
- negative authorization, Storage, and rollback matrices;
- either a locally verified first containment slice or an honest implementation handoff;
- no external mutation.
