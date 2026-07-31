<!--
FILE: docs/handoff/apply-window-and-followups-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for a fresh session. Two jobs: apply the two security
  migrations that are authored-but-not-applied, then pick up the remaining
  follow-ups. Written at the end of the 2026-07-27 session that authored them.

DEPENDS ON:
  Internal: supabase/migrations/20260727143000_anon_closure_tranche_b.sql,
            supabase/migrations/20260727144500_notification_role_defaults_rpc_only.sql,
            .claude/rules/db-foundation-wave-ownership.md §8,
            .claude/rules/database-standard.md §0 §5,
            docs/upr-build-fix-backlog.md
  Data:     reads → documentation, Git, read-only live catalog
            writes → documentation only (this prompt)

NOTES / GOTCHAS:
  - State below verified 2026-07-27 ~15:00Z. RE-VERIFY before acting.
  - The two migrations are NOT applied. That is deliberate, not an oversight.
-->

# Handoff — the apply window, then the remaining follow-ups

> **SUPERSEDED — historical handoff only; do not execute it as current state.** Its database-lane
> premise and `DARK_BASELINE` instructions were retired 2026-07-31 after hosted `qa-staging`
> reached zero failed assertions; the raw receipt also exposed separate setup-suite debt that is
> now tracked shrink-only. Re-read `.claude/rules/initiative-status.md` and the staging runbook
> before considering any remaining migration named below; each live apply still requires a fresh
> exact-source review and separate owner authorization. Its
> `sms_sending_enabled=true` statement is also historical: production is explicitly false as of
> 2026-07-31, while staff P2P CallRail SMS/MMS remains separate and untouched.

Paste everything from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). The previous session
promoted the day's work to production and authored two security migrations without applying them.
**Re-verify everything below before acting.** `dev` moves fast — several sessions push to it.

## Verified state at 2026-07-27 ~15:00Z

- `origin/dev` = `origin/main` = **`b142424f`** at the time of writing, and production is deployed
  from it. Confirm with `git rev-list --left-right --count origin/main...origin/dev` — expect `0 0`.
- **107 commits landed today.** Production now has: the provenance-gate fix, notification routing
  into the tech PWA, the in-app Message button, the raw-error fix on six tech screens, the
  caller-name fix, and the signed work-authorization consent work from a parallel Codex session.
- **Two migrations are authored, reviewed, and NOT applied:**
  - `supabase/migrations/20260727143000_anon_closure_tranche_b.sql` — closes `anon` on `contacts`,
    `conversations`, `conversation_participants`
  - `supabase/migrations/20260727144500_notification_role_defaults_rpc_only.sql` — closes the
    bypass around the admin gate on `notification_role_defaults`
- **SMS is live to real customers.** `sms_sending_enabled=true`, `missed_call_textback=true` on the
  live org. TCPA penalties are per message. Treat anything near the send path accordingly.
- Both migrations passed `migration-safety-checker` and `anon-grant-auditor` (PASS each). The
  safety checker found two documentation errors in the first draft, both since corrected — read
  those corrections in `b142424f`, they are a good calibration for how precise the headers must be.

## Task 1 — The apply window (the main job)

**Read the `APPLY-WINDOW CAVEAT` block in the tranche (b) migration header first.** It exists
because every policy name and grant cited in that header came from a read-only catalog capture, and
the repository cannot verify those facts. If a policy has been renamed or added since the capture,
`DROP POLICY IF EXISTS` silently no-ops — the hole stays open while the migration reports success.

So, in order:

1. **Re-capture the live state** for the four tables (`contacts`, `conversations`,
   `conversation_participants`, `notification_role_defaults`): every policy name, command, role,
   `qual`, `with_check`, and the anon/authenticated table privileges. Read-only.
2. **Diff that against the migration headers.** If any policy name differs, stop and fix the
   migration before applying — do not adjust the catalog to match the migration.
3. **Apply**, with fresh owner authorization for that exact action (`database-standard.md` §0).
   Give these two their own apply window; do not share it with other policy DDL on the same hot
   tables (§5).
4. **Verify live**: anon denied on all four tables; `authenticated` still permitted; the §2 public
   allowlist untouched (`get_crm_build_progress` still anon-executable, the e-sign RPCs too).
5. **Run the behavioural test**: `RUN_TRANCHE_B=1` against the db lane.
6. **Verify in the app, as a real logged-in user** — this is the part no test covers:
   - `/customers` loads (199 clients)
   - `/conversations` loads and a thread opens
   - the CRM contacts screen loads
   - the tech PWA: `/tech/claims/<id>` and `/tech/jobs/<id>` load real data
   - `/settings` → Notification Defaults loads **and a toggle saves** (this is the specific
     behavioural proof the notification migration deliberately shipped no db-lane test for)
   - `/status` still answers logged out
7. **Refresh provenance evidence and map the new ledger rows.** Applying adds two rows; the gate
   will fail on unmapped rows until they are mapped in
   `scripts/migration-provenance-manifest.json`. Use
   `node scripts/capture-migration-provenance.mjs --print-sql`, run that read-only query, then
   `--assemble`. The evidence has a **6-hour TTL**, so capture close to when CI will run.

**Rollbacks** are paired in `supabase/rollbacks/` for both. Once applied, `git revert` alone no
longer undoes them — an undo means running the rollback file, which is itself a fresh
owner-authorized apply.

## Task 2 — A small ops surface (the highest-value build left)

`rearm_callrail_provider_event()` and `resolve_provider_event()` are live and proven, but only a
service-role caller can invoke them — there is no button. Meanwhile **6 `CALLRAIL_OUTBOUND_UNMATCHED`
events are stuck** (created 2026-07-27 00:06–00:19Z, 6–7 attempts each, retrying and failing). The
ops-health alert escalates to `critical` after 3 unresolved days and links to `/devtools`, which
shows none of this. So it will shout with no way to act from the app.

Build a small admin list of failed/retryable provider events with Retry and Mark-resolved, calling
both RPCs through a thin authenticated worker. Pure additive — no schema, no migration.

Worth knowing: **new** outbound sends reconcile correctly now (verified 2026-07-27 — two live sends
produced `processed` events with 0 retries). These 6 are legacy and will not self-heal.

## Task 3 — Remaining follow-ups

1. **CallRail has no delivery confirmation.** `num_segments`, `price` and `status='delivered'` are
   written only by the Twilio path (`twilio-status.js`); there is no CallRail receipt handler. So a
   CallRail message sits at `status='sent'` forever, and a silent delivery failure looks identical to
   success. First question to answer: does CallRail's API even offer delivery receipts? Do not build
   before establishing that.
2. **Backlog 5.2** — NotificationBell hygiene debt. A stale diff exists in the
   `determined-swartz-162487` worktree; **do not merge it**, its base predates the bell rewrite.
   Rewrite from current `dev`.
3. **3.1 tranches (c)+ and 3.2** — each is its own initiative with a roadmap, not a feature session.
   `is_active_internal_admin()` is live and is the shared predicate 3.2 should roll out rather than
   reviewing 342 functions individually. **Re-run advisors first** — the "146 policies / 342
   definers" figures are stale.
4. **The rules cleanup.** The provenance gate was fixed this session (moved after Build/Test,
   staleness warns, strict only for PRs into `main`). The owner wants the remaining overprotective
   friction removed. Recommendation from the last session: keep exactly four gates — consent/TCPA,
   the human Save-to-QuickBooks gate, the shared-database apply gate, and server-side worker
   authorization. Those protect against irreversible outward harm. Most other friction is
   self-inflicted.

## Owner-gated, cannot be done from here

- **Missed-call textback** needs a real call to the tracking number and a hang-up.
- **Inbound MMS** needs someone to reply to a thread with an image.
- A **field-tech login** on production, if you need to see a technician's own RLS-scoped view. Dev
  Mode authenticates the employee row but runs as `anon`, so every `TO authenticated` RPC returns
  `42501` — that is expected, not a bug, and is what produced the `get_claim_detail 401` screenshot.

## Hard constraints

- **Do not apply a migration without a fresh, task-specific owner instruction** for that exact
  action. A roadmap, a plan, or a previous apply is not authorization (`database-standard.md` §0).
- **A green Cloudflare Pages check does not mean production is serving your code.** This bit the last
  session: the check went green on the *build* while the production alias still served the previous
  bundle, and a fix appeared not to work. Verify by fetching the deployed asset and grepping it, not
  by trusting the check.
- **Do not trust a recorded number.** Several this session were wrong: a caller-inventory count that
  missed five `d.select` call sites, a precedent attributed to a migration that does not exist, and a
  worker count that double-counted tests. Derive counts; do not quote them.
- Commit/push/PR/deploy only when the owner asks. Never click-merge or babysit a PR.

## Close-out

`.claude/rules/close-out-standard.md` in full. Note step 2b: a migration PR must ship a CI-visible
static contract test under `tests/qa/unit/**`, because `supabase/tests/**` is the `db` lane and
`npm test` does not run it — **77 guards are currently dark in CI** (backlog 6.1). If you add a
db-lane test you must raise `DARK_BASELINE` in the same commit; that is the deliberate acknowledgement.

Report actual results, never expected. Say plainly what you skipped and why.
