<!--
FILE: docs/handoff/pr-525-integration-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for a fresh session that integrates PR #525 (the mobile
  PWA/Capacitor hardening, 315 files) onto current dev without losing the work done
  on 2026-07-27. Written from a 32-agent review of that PR.

DEPENDS ON:
  Internal: PR #525 (branch codex/mobile-readiness-current-origin-review),
            tests/qa/unit/field-surface-invariants.test.js,
            tests/qa/unit/db-lane-coverage.test.js,
            .claude/rules/database-standard.md §5,
            docs/handoff/apply-window-and-followups-prompt.md
  Data:     reads → documentation, Git, read-only live catalog
            writes → documentation only (this prompt)

NOTES / GOTCHAS:
  - State verified 2026-07-27 ~16:00Z. RE-VERIFY; dev moves.
  - There is ONE hard ordering constraint: a migration must be applied BEFORE the
    merge, or every user on dev.utahpros.app is logged out. See Task 0.
-->

# Handoff — integrate PR #525 onto today's baseline

Paste everything from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). Your job is to integrate
PR #525 — "Mobile PWA/Capacitor production-hardening source integration", 315 files, +62,734/−2,940,
branch `codex/mobile-readiness-current-origin-review` — onto current `dev` **without losing the work
done on 2026-07-27**.

That PR was built by a Codex session which is now archived. It is good work: eight RLS/ownership
migrations, a real employee-identity boundary, offline hardening. It is also a **draft**, it
**conflicts**, and it has one defect that loses technicians' work. A 32-agent review produced the
findings below — 3 confirmed, 21 refuted, 13 minor. Trust the specifics; re-verify anything you act on.

**Work in a git worktree, not the main checkout.** The main tree carries another session's
uncommitted files.

## The rule that governs every decision here

**2026-07-27's decisions are the baseline. #525 rebases onto them, never the reverse.** Three guards
enforce this mechanically — if any fails, you have lost something that was fixed today:

- `tests/qa/unit/field-surface-invariants.test.js` — no `sms:` links on tech surfaces; no raw error
  text in user-facing state; CI runs Build+Test before provenance
- `tests/qa/unit/tech-shell-redirect.test.js` — notification links land field techs in `/tech`
- `tests/qa/unit/db-lane-coverage.test.js` — exact db-lane guard count

## Task 0 — The ordering constraint (do this FIRST, it is not optional)

`src/contexts/AuthContext.jsx:972` in the PR bootstraps **every** session through
`db.rpc('get_my_employee_profile')` **with no fallback**, and that function **does not exist in the
shared database**. Rule 4 makes a merge to `dev` a deploy. So merging before applying
`20260726180000_mobile_employee_identity_authority.sql` sends a 404 into the bootstrap catch →
`finishRejectedPrincipal` → local `signOut` **for every user on dev.utahpros.app**.

The PR states the correct order in three places, but all three say "deploy", never "merge", and
nothing mechanical enforces it.

So: **apply `20260726180000` (additive — creates `get_my_employee_profile` and
`get_employee_directory`) before the merge**, with fresh owner authorization for that apply. Verify
both functions resolve live. Only then proceed.

## The OTHER ordering constraint — and this one can take production down

**Corrected 2026-07-27 after the review.** The review's apply order had
`20260726182000_mobile_employee_identity_containment.sql` running once *dev* was verified. That would
have broken **production**. Do not follow that ordering.

Read what the migration actually does (`:834-848`): it drops `allow_anon_read_employees` and
`allow_authenticated_employees`, replaces them with
`employees_self_identity_read ... USING (auth_user_id = auth.uid())` — so an authenticated browser can
read **only its own employee row** — and then revokes `employees` down to four columns
(`id, auth_user_id, role, is_active`).

The code **currently on `main`** reads `employees` directly in **14 files**, asking for much more:

| Surface | Reads | After the migration |
|---|---|---|
| `Schedule.jsx:547` | `display_name, full_name, role, color, avatar_url`, all active | breaks |
| `TimeTracking.jsx:206` | `full_name, hourly_rate` | breaks |
| `settings/Team.jsx:98` | no `select=` filter, i.e. `SELECT *` | breaks |
| `Login.jsx:30` | `full_name, email, role` | breaks |
| ClaimPage, CustomerPage, JobPage, Jobs, Production, CrmTasks | `full_name`, all active | all break |

That is the crew pickers, the schedule board, timesheets, the team screen and the dev-mode employee
picker. **One database serves both branches**, so this lands on production the instant the migration
applies — deploying the new bundle to `dev` does nothing to protect `main`.

The PR's own code is clean: **zero** direct browser reads of `employees` remain (verified — it moved
them all behind RPCs). So this is purely an ordering problem, and the fix is to promote to production
BEFORE applying the containment migration. See "The apply order" below.

## Task 1 — Merge and reconcile

**No rebase needed** — merge `dev` into the branch. Six files were touched on both sides; three
auto-merge (`ClaimPage.jsx`, `Jobs.jsx`, `Production.jsx`) and three conflict.

```
git fetch origin
git checkout codex/mobile-readiness-current-origin-review
git merge origin/dev
```

**Conflict 1 — `tests/qa/unit/db-lane-coverage.test.js` → `DARK_BASELINE = 79`.**
Take **dev's assertion** (`.toBe(...)`, exact, not `<=`) plus **the PR's filter**
(`.test.js || .test.sql`). Verified against a real 3-way tree: 79 files match `.test.js|.test.sql`.
Arithmetic to record in the commit message: **+4** new `.test.sql` guards, **+1** from dev
(`anon_closure_tranche_b.test.js`), **−2** retired anon-client guards (`notify_foundation.test.js`,
`notify_c_my_prefs.test.js` — legitimately replaced by
`tests/qa/unit/notification-read-recipient-boundary.test.js`; this was checked, not assumed).
Keep the exact assertion: `<=` is what let those two deletions through silently.

**Conflict 2 — `src/App.jsx` → take the PR's file, then re-apply dev's fix on top.**
The PR still ships `TechShellRedirect({ resolve, children })` with per-route `resolve` props
(`:251`, `:395`, `:403`, `:416`, `:442`). Dev's `673c70e7` replaced that with
`officeToTechPath(location.pathname)` from `src/lib/techShellRoutes.js` (new file, merges cleanly)
so `App.jsx` and `NotificationBell` cannot drift apart. Drop the then-unused `useParams` and
`jobHref` imports.

**Conflict 3 — `src/pages/tech/v2/hub/HubDock.jsx` → keep BOTH sides.**
From the PR: the removed offline-queue imports/fork and the `navigator.onLine` guard.
From dev: the Message control as a `<button onClick={() => navigate(pickerHref())}>` with the
`pickerHref` import — that is today's "Message opens the UPR thread, not the phone's SMS app" fix.
**Do not let the `sms:` link come back.** `field-surface-invariants.test.js` will fail if it does.

## Task 2 — Fix the confirmed blocker (loses technicians' work)

`src/pages/tech/TechAppointment.jsx:324-330` and `:371-377`;
`src/pages/tech/v2/hub/HubTools.jsx:104-111` and `:135-141`.

The offline branch toasts an error and then `return`s, so the promise **resolves**. Callers treat
resolution as success: `ReadingEntrySheet.jsx:218-220` does
`await onSave?.(payload); fireToast('Reading saved','success'); onClose?.()`, and
`EquipmentPlacementSheet.jsx:134-142` does the equivalent. Real field behaviour with no signal:
error toast → **success toast (last wins)** → sheet closes → **the typed reading is gone.**

On current `dev` the same tap persists to the offline queue, so this is a regression introduced by
the PR. The author edited both sheets' header comments in the same change ("or queues it offline" →
"only while online") without adjusting the success path.

**Fix, one line per handler:** replace `return` with
`throw new Error('Moisture readings require an internet connection. Reconnect and try again.')`
(and the equipment equivalent). Both sheets already `catch`, render `Failed to save reading: …`, and
keep the sheet open with the form intact. Remove the now-redundant `toast(..., 'error')`.

## Task 3 — One governance fix

The PR rewrites the offline law in `.claude/rules/tech-mobile-ux.md:27-32` (confirmed
PR-introduced, and not stale-doc cleanup — `useOfflineQueue.enqueue` is wired at six mutation call
sites on `dev`). Its own roadmap still lists "offline product decision" as a pending owner gate at
`docs/mobile-production-readiness-roadmap.md:92`.

Add a dated owner-attribution amendment in the established format — `db-foundation-wave-ownership.md`
§8 is the pattern — or revert the rewrite. Do not leave a rule rewritten with the decision behind it
still listed as pending.

## Task 4 — Close out and hand back

`npm run build`, `npm test`, `npx eslint` on changed files, then the three guards above must be green.
Mark the PR **ready** (it is currently a draft). Then stop — the owner merges.

## The apply order, once merged

The PR ships **8** migrations, not 4: `20260726110000`, `20260726180000`, `20260726182000`,
`20260726183409`, `20260726194300`, `20260726260000`, `20260727020000`, `20260727022920`. All
unapplied, each with a rollback.

**The PR's 8 and dev's 2 are independent** — disjoint tables, so relative order is free.
PR: `employees`, `inbound_leads`, `notifications`, `employee_page_access`, `notification_prefs`,
`device_tokens`. Dev: `contacts`, `conversations`, `conversation_participants`,
`notification_role_defaults`.

1. `20260726180000` — **before the merge** (Task 0). Additive: it only creates
   `get_my_employee_profile` and `get_employee_directory`. Safe for production, which does not call
   them yet.
2. Merge → dev deploys → **confirm login works on dev.utahpros.app** as a real employee.
3. **Promote `dev` → `main` so PRODUCTION is running the new bundle.** Wait for the Cloudflare
   production deploy and confirm by fetching the deployed asset, not by trusting the green check.
4. **Only now** apply `20260726182000` (the employees containment). Until production runs the new
   code, this migration breaks the schedule board, timesheets, the team screen, the crew pickers and
   the dev-mode employee picker — on production — because one database serves both branches. This is
   the step the original review got wrong; see the section above.
5. `20260727020000` → `20260727022920` (their preflights `RAISE EXCEPTION` out of order — a correct
   fail-closed guard, not a defect).
6. Everything else, including dev's two, in any order, one window at a time.

After step 4, re-verify the same production surfaces that the table lists as at risk. A read-only
catalog check is not enough here: the failure mode is a browser query returning one row instead of
forty, which looks like "no crew" rather than an error.

**Ledger gotcha:** this project assigns the ledger version **at apply time, not from the filename** —
`20260726220000_permission_write_gates.sql` is live as `20260727012825`. Record the assigned versions
or the provenance gate reports them unmapped. One row is already unmapped:
`20260726233416 encircle_managed_credentials`.

## One ruling the owner must make

`20260726180000:348-357` — `get_employee_directory` lets an **active `is_external` account enumerate
the full internal roster**. It is the only place in an identity-containment PR where `is_external` is
not a boundary, and a test comment suggests it is deliberate. Surface it; do not decide it yourself.

## What a human must verify afterwards (nothing automated covers these)

- **Login on dev.utahpros.app** immediately after the merge deploy, as a real employee. The bootstrap
  now destroys the local session on *any* authorization-read failure, including a plain timeout, with
  no retry (`AuthContext.jsx:1180`).
- **The Task 2 fix in the field:** airplane mode → open a moisture reading → save. You must see
  `Failed to save reading: …`, the sheet must stay open, the typed value must survive.
- **Minimize/resume on a real installed iPhone** (`close-out-standard.md` §3). This PR rewrites
  `AuthContext` (+1406) and `App.jsx`; nothing in CI covers suspend/resume.
- **390px** on touched tech surfaces, plus the `OfflineReconciliationPanel` recovery screen.
- **A native Xcode build/sign check** — the PR restructures `App.jsx` around
  `@/routes/buildTargetPages` and `IS_NATIVE_BUILD`; this environment cannot compile or sign iOS.
- **A read-only catalog query in the apply window:** any non-`prosecdef` routine or
  `security_invoker` view referencing `public.employees` that `authenticated` can execute. The live
  catalog holds more routines than the repo, so the containment revoke cannot be proven safe from
  source alone.

## What the review did NOT certify

Say this plainly in the PR rather than implying full coverage:

- the live **behaviour** of all 8 migrations — none applied, none database-verified; the PR's own
  runbook says a PGlite model ran but "did not execute the exact checked-in migrations"
- `20260727022920` (2257 lines) and `20260726260000` (1520 lines) line-by-line beyond their gates,
  grants, policies and rollbacks
- the native iOS build, signing, entitlements, push enrolment
- on-device motion/gesture feel and resume behaviour of the rewritten shell
- most of the added `docs/` and `docs/audit/` evidence, which was sampled

## Other work in flight — NOT yours unless the owner says so

Listed so nothing is orphaned when this PR closes. Do not start any of it without being asked; the
point of naming it here is that it does not get forgotten between sessions.

1. **Two security migrations, authored and reviewed, NOT applied.** `20260727143000_anon_closure_tranche_b`
   (closes `anon` on `contacts`, `conversations`, `conversation_participants` — the entire customer
   list is currently readable and writable with the public browser key) and
   `20260727144500_notification_role_defaults_rpc_only` (closes the bypass around the admin gate on
   notification defaults). Both passed `migration-safety-checker` and `anon-grant-auditor`. Both are
   independent of PR #525 — disjoint tables — so they need no coordination with it, only an apply
   window. Full plan: **`docs/handoff/apply-window-and-followups-prompt.md`**, which also carries the
   `APPLY-WINDOW CAVEAT` (re-capture the catalog first, because `DROP POLICY IF EXISTS` silently
   no-ops on a renamed policy and still reports success).
2. **`dev` is ahead of `main` by verified, unpromoted work** — the notification routing fix, the
   in-app Message button, the raw-error fix on eleven screens, the caller-name fix, and the three
   guards. Check `git rev-list --left-right --count origin/main...origin/dev`. Promoting these is
   independent of #525 and is the owner's call; do not fold it into the #525 merge silently.
3. **A small ops surface for stuck provider events.** `rearm_callrail_provider_event()` and
   `resolve_provider_event()` are live and proven, but no UI calls them, and six
   `CALLRAIL_OUTBOUND_UNMATCHED` events are stuck and will escalate to `critical`. Pure additive UI +
   worker, no schema. Details in the apply-window doc.
4. **CallRail has no delivery confirmation.** A CallRail message sits at `status='sent'` forever, so a
   silent delivery failure is indistinguishable from success. Establish whether CallRail's API even
   offers receipts before building anything.
5. **The rules cleanup.** The provenance gate was fixed 2026-07-27 (moved after Build/Test, staleness
   warns, strict only for PRs into `main`). The owner wants the remaining overprotective friction
   removed and has said so directly. Standing recommendation: keep exactly four gates — consent/TCPA,
   the human Save-to-QuickBooks gate, the shared-database apply gate, and server-side worker
   authorization. Those protect against irreversible outward harm; most other friction is
   self-inflicted.
6. **Owner-gated, cannot be done from a session:** missed-call textback (needs a real call), inbound
   MMS (needs someone to reply with an image), and a real field-tech login if you need a technician's
   own RLS-scoped view.

## Environment notes for a fresh session on this machine

These cost the previous session real time. None is a bug; all are how this repo works.

- **Check first whether you have database tools at all.** There is no project-scoped MCP config in
  this repo (`.mcp.json` is absent; nothing tracked defines `mcpServers`), so the Supabase and UPR MCP
  servers are configured per **account**, not per project. On a different Claude account they may
  simply not exist. Confirm before planning around them: if `upr_rpc` / `exec_read_sql` /
  `apply_migration` are unavailable, you can still do all of the CODE work — merge, the three conflict
  resolutions, the Task 2 blocker fix, build/test/lint, marking the PR ready — but you **cannot**
  verify the live catalog or apply anything. In that case do the code work, and hand the live steps
  (Task 0's verification and every apply) back to the owner explicitly rather than assuming or
  skipping them silently. `gh` is authenticated at machine level, so GitHub access carries over
  regardless.
- **Free-form SQL is denied by policy.** `.claude/settings.json` denies `execute_sql`,
  `exec_read_sql` and `upr_sql`, and deny beats the local allow-list. For read-only catalog work use
  `upr_rpc` with `fn: "exec_read_sql"` and the parameter name **`p_query`** (not `query`). The MCP
  labels it "mutating" from its name prefix and asks to confirm — the underlying function is
  SELECT-only in a read-only transaction, so confirming is correct. It is still a live-catalog read:
  fine for inspection, never for iterating.
- **The main working tree carries another session's uncommitted files** (`.claude/`, `.agents/`,
  `.codex/` adapters). Work in a worktree, and stage by explicit path — never `git add -A`.
- **Tests must run through the npm scripts.** `npx vitest` fails with
  `UPR_TEST_LANE must be exactly unit, worker, qa, or db`. Use `npm test` (unit + worker + qa) or a
  single lane via `npm run test:unit|test:worker|test:qa`.
- **A green Cloudflare Pages check does NOT mean production serves your code.** The check goes green
  on the *build* while the production alias may still serve the previous bundle. The previous session
  concluded "the fix does not work" from exactly this. Verify by fetching
  `https://utahpros.app/` , reading the `assets/index-*.js` name, curl-ing that file and grepping it.
- **Dev Mode is not a real session.** The Login screen's employee picker authenticates the employee
  row but runs as Supabase `anon`, so every `TO authenticated` RPC returns `42501 permission denied`.
  That is expected, not a bug — it is what produces `RPC get_claim_detail: 401 {"code":"42501"...}`.
  For real data use "Dev Mode: Real Data (test admin)", and never type credentials yourself.
- **Ledger versions are assigned at apply time, not from the filename.**
  `20260726220000_permission_write_gates.sql` is live as `20260727012825`.

## Hard constraints

- **Do not apply a migration without fresh, task-specific owner authorization** for that exact action.
- Do not merge the PR yourself; mark it ready and stop.
- **A green Cloudflare Pages check does not mean production serves your code** — it goes green on the
  build while the alias may still serve the previous bundle. Verify by fetching the deployed asset.
- Report actual results, never expected. Say plainly what you skipped and why.
