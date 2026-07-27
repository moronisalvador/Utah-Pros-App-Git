<!--
FILE: docs/handoff/production-promotion-and-followups-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for a fresh session that promotes the accumulated work
  to production safely, then picks up the follow-ups from the 2026-07-26/27
  security batch.

DEPENDS ON:
  Internal: docs/upr-build-fix-backlog.md, .claude/rules/upr-engineering-foundation-wave-ownership.md §6,
            UPR-Web-Context.md ("Security tightening batch applied — 2026-07-27"),
            scripts/migration-provenance-manifest.json
  Data:     reads → documentation, Git, read-only live catalog
            writes → documentation only (the prompt itself)

NOTES / GOTCHAS:
  - State below verified 2026-07-27 ~02:05Z. RE-VERIFY; dev was moving every few minutes.
-->

# Handoff — production promotion, then the security-batch follow-ups

Paste everything from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). The previous session
applied a security batch to the shared database and ran out of context before promoting the code.
**Re-verify everything below before acting — do not re-derive it from scratch, and do not trust it
blindly. `dev` was moving every few minutes when this was written.**

## Verified state at 2026-07-27 ~02:05Z

- `origin/dev` = `0262d2f0`, `origin/main` = `90b265ee`. **dev is 80 commits ahead.**
- **Two other Claude Code sessions are actively pushing to `dev`** (agent-alignment / tooling
  governance). Last commit at 20:03 local, minutes before this was written.
- **8 migrations are APPLIED to the shared production database** (ledger
  `20260727012536`..`20260727012929`), all mapped in `scripts/migration-provenance-manifest.json`.
  One Supabase serves both branches, so **the schema changes are already live everywhere** — only
  the *code* is unpromoted.
- **`sms_sending_enabled` is now TRUE** (owner-authorized, 2026-07-27 02:01Z). Missed-call textback
  is LIVE for org `b1be7519…`. This is real customer texting. Treat any change near the send path
  with corresponding care.
- Read `UPR-Web-Context.md` → "Security tightening batch applied — 2026-07-27" for exactly what
  changed, and `docs/upr-build-fix-backlog.md` for the remaining work.

## Task 1 — Promote `dev` → `main` (the main job)

**Precondition, do not skip:** confirm `dev` is QUIET first. Check `git log origin/dev -5` timestamps
and ask the owner whether the other sessions have finished. Promoting from a branch two sessions are
pushing to means CI green is computed against a SHA that is already stale, and the agent-alignment
commits arrive in a batoned sequence — promoting mid-sequence ships a partial state. The promotion
hold is recorded in `.claude/rules/upr-engineering-foundation-wave-ownership.md` §6 and is binding.

When it is quiet:

1. Re-run CI on the **actual final `dev` head**, not a carried-forward green.
2. Open a `dev → main` PR, confirm `MERGEABLE`/`CLEAN`, merge with a **merge commit, not squash**,
   then fast-forward `dev` to `main` (CLAUDE.md Rule 4).
3. **Wait for the Cloudflare Pages check** before calling it done.

**Verify after promotion — production runs `main`, so these only become true once it lands:**

- Log in to `utahpros.app` and confirm the nav renders **for a non-admin**. This is the highest-risk
  check in the whole batch: `nav_permissions` had no authenticated SELECT policy of its own, and a
  new one (`nav_permissions_auth_read`) is what keeps the menu alive. It is verified present in the
  catalog, but has not been exercised by a real non-admin session.
- `/settings/roles` loads and a toggle saves as admin.
- The bell loads and shows notifications.
- Open a customer and a job detail page (the `ErrorState` work touched both).
- `/status` still answers logged-out.

## Task 2 — Re-check the ops-health alert recipients (a known regression)

The owner asked for ops alerts to reach him alone, and `integration_config.ops_health_recipient_ids`
is set to his employee id. **But only the NEW worker code reads that key**, and the scheduler now
points at `https://utahpros.app/api/ops-health`, which runs `main`'s OLD worker. So until Task 1
lands, ops alerts still fan out to all five admins.

After promoting, confirm the next ops alert reaches only the owner. If promotion is delayed and the
noise is annoying, the interim fix is to point `ops_health_worker_url` back at `https://dev.utahpros.app/...`
(that deploy has the new code) — both URLs are inside the schedulers' exact-URL SSRF allowlist.

## Task 3 — Get the provenance gate back to PASS

`npm run validate:provenance` currently FAILS for two independent reasons:

1. **Stale evidence.** `docs/audit/2026-07/evidence/migration-provenance-2026-07-24.json` was captured
   at 16:21Z, before the applies. There is **no capture script** — it is assembled by hand from
   read-only catalog queries. Shape: `capturedAt` / `projectRef` / `captureBaseCommit` / `method` /
   `ledgerTail` / `functions` / `policies`. `semanticMd5` is
   `md5(body with -- comments stripped, whitespace collapsed, trimmed)` — see `normalizeFunctionBody`
   in `scripts/check-migration-provenance.mjs`. `rawMd5` is md5 of the unmodified body.
2. **Source on `dev`, not `main`.** §5 wants applied source reachable from the release branch, so the
   gate cannot pass against `origin/main` until Task 1 completes. It DOES resolve against
   `--ref origin/dev` today.

Also: ledger row `20260726233416 encircle_managed_credentials` was applied by a different session and
is **unmapped**. The previous session deliberately did not map source it had not reviewed. Fresh
evidence will report it as an unmapped live ledger row until its owner maps it — surface that to the
owner rather than mapping it yourself unless you actually review that migration.

## Task 4 — Follow-ups, in the order the backlog recommends

1. **A small ops surface.** `rearm_callrail_provider_event()` and `resolve_provider_event()` are live
   and proven, but only a service-role caller can invoke them — there is no button. The ops-health
   alert links to `/devtools`, which shows none of it, and the alert escalates to `critical` after 3
   unresolved days. So it will eventually shout with no way to act from the app. Build a small
   admin list of failed events with Retry / Mark-resolved, calling both RPCs through a thin worker.
2. **Backlog 5.2** — NotificationBell hygiene debt. ⚠️ A stale diff exists in the
   `determined-swartz-162487` worktree; **do not merge it**, its base predates the bell rewrite.
   Rewrite from current `dev`.
3. **Six `retryable` provider events** (`CALLRAIL_OUTBOUND_UNMATCHED`, 5 attempts each) — unexamined.
   Likely what the ops-health "stuck past retry time" condition reports; relates to the outbound NANP
   identity seam.
4. **3.1 tranches (b)/(c) and 3.2** — each is its own initiative with a roadmap, not a feature
   session. `is_active_internal_admin()` is live and is the shared predicate 3.2 should roll out
   rather than reviewing 342 functions individually. **Re-run advisors first** — the "146 policies /
   342 definers" figures are from 2026-07-22 and the refreshed catalog numbers are ~196/227 and 342
   respectively (see the backlog §3).

## Hard constraints

- **Nothing needs applying.** All 8 migrations are already live. Do not re-apply. If you believe a
  migration needs applying, re-read `database-standard.md` §0 — that needs a fresh owner instruction.
- **Do not re-arm the two remaining `failed` outbound MMS.** Owner confirmed 2026-07-27 they are test
  data from building the integration; there is nothing to recover. All three *inbound* MMS were
  recovered successfully.
- Every migration has a paired rollback in `supabase/rollbacks/`. Since they are applied, `git revert`
  alone no longer undoes them — an undo means running the rollback file, which is a fresh
  owner-authorized apply.
- Commit/push/PR/deploy only when the owner asks. Never click-merge or babysit a PR.
- **Do not trust a recorded fact without checking live state.** On 2026-07-26 five separate recorded
  "facts" turned out stale: registry rows, a worker count, `.env.local` in worktrees, a whole dark
  test lane, and an `error_message` that described an already-fixed bug. Checking first paid off
  every time.

## Close-out

Re-read `.claude/rules/close-out-standard.md` before finishing — it changed on 2026-07-26 (new step
2b: a migration PR must ship a CI-visible static contract test, because `supabase/tests/**` is in the
`db` lane and `npm test` does not run it; 75 guards are dark in CI, tracked as backlog 6.1).

Report actual results, never expected. Say plainly what you skipped and why.
