<!--
FILE: docs/handoff/promotion-readiness-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for the session that promotes dev to production. Written
  at the end of the 2026-07-27 PR #525 integration, which merged the mobile
  hardening, survived a real blank-page outage, and closed a live data exposure.

NOTES / GOTCHAS:
  - State verified 2026-07-27 ~21:00Z. RE-VERIFY; dev moves.
  - There is ONE ordering constraint that can take production down. See §2.
-->

# Handoff — promote dev to production

Paste from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). The
previous session integrated PR #525, recovered from an outage, and closed a live
security hole. Your job is to finish the promotion safely.

**Work in a git worktree cut from current `origin/dev`.**

## 1. What is already done

**Merged to `dev` and live on dev.utahpros.app:**
- PR #525 — mobile PWA/Capacitor hardening
- PR #526 — deploy-cache-poisoning survival + `npm run smoke:deploy`
- PR #527 — office appointment route (bell fix; also fixed a ClaimPage 404)

**Applied to the shared database** (name → assigned ledger version):
- `mobile_employee_identity_authority` → `20260727154506`
- `anon_closure_tranche_b` → applied 2026-07-27
- `notification_role_defaults_rpc_only` → applied 2026-07-27

Ledger versions are assigned AT APPLY TIME, not from the filename. Record them or
the provenance gate reports unmapped rows.

**Verified live, not inferred:** field-tech role redirects (`/conversations`,
`/schedule`, `/claims/:id` all bounce to `/tech/*`), the offline reading fix
(error toast, sheet stays open, typed values survive), the legal-shell fix, the
bell fix on desktop, dev smoke PASS.

## 2. The ordering constraint — this one can take production down

`20260726182000_mobile_employee_identity_containment` revokes `employees` to a few
columns and restricts reads to the caller's own row. Code on `main` still reads
`employees` directly in 14 files (Schedule, TimeTracking, settings/Team, Login,
ClaimPage, CustomerPage, JobPage, Jobs, Production, CrmTasks). **One database
serves both branches.** Applying it before production runs the new bundle breaks
the schedule board, timesheets, the team screen and the crew pickers on
production.

Order:
1. Merge PR #528 (see §3) into `dev`.
2. `npm run smoke:deploy -- https://dev.utahpros.app` — wait for PASS.
3. Promote `dev` → `main`.
4. `npm run smoke:deploy -- https://utahpros.app` — **wait for PASS before
   declaring success.** The Cloudflare check goes green up to ~9 minutes before
   the alias actually swaps. Measured, twice, on 2026-07-27.
5. **Only now** apply `20260726182000`.
6. Re-verify those surfaces in a browser. A catalog query will not catch this —
   the failure looks like "no crew", not an error.
7. Then `20260727020000` → `20260727022920` (their preflights enforce the order).

## 3. Open PR

**#528 — `fix(db): grant employees.is_external`.** Merge before promoting.

A real defect, caught unshipped. `20260726182000` grants four employees columns;
the sibling migrations `20260726183409` and `20260726260000` add POLICIES whose
predicates read `employees.is_external`. Policy predicates evaluate with the
CALLING role's privileges, so with the column ungranted every authenticated
SELECT on those tables fails — CRM Leads board, task picker, forecast widget,
Realtime bell delivery. Both siblings preflight that the column EXISTS, never
that it is GRANTED, and the fault only fires once #2 plus one sibling are live.

## 4. Still unapplied, and why

| Migration | Status |
|---|---|
| `20260726110000_notify_emit_service_boundary` | Safe. Not applied only because hand-transcribing 404 lines of DDL through a tool parameter was judged riskier than deferring. Apply from the file. |
| `20260726194300_create_notification_service_boundary` | Same — 200 lines. |
| `20260727020000_upsert_employee_page_access_provenance_reconciliation` | Same — 259 lines. |
| `20260726182000_mobile_employee_identity_containment` | HOLD until after step 5 above. |
| `20260726183409_inbound_lead_recording_source_boundary` | HOLD until #528 merges. |
| `20260726260000_notification_read_recipient_boundary` | HOLD until #528 merges. |
| `20260727022920_mobile_personal_ownership_boundary` | HOLD — preflight requires the two above. |

Both `migration-safety-checker` and `anon-grant-auditor` reviewed all nine on
2026-07-27: no grant/secret/admin-gate findings. The holds are ordering, not
correctness.

## 5. What today taught us — treat these as standing rules

**A green check is not a deploy.** The previous session called dev "verified" off
a bundle grep. That proved the bundle was current, never that the app rendered.
`npm run smoke:deploy` exists because of that mistake — use it after every deploy.

**The deploy race is real and recurrent.** It fired twice on 2026-07-27, once
during the very deploy that shipped the fix. For ~45–90 seconds after the alias
swaps, `index.html` can reference assets that have not propagated, and those
HTML-under-a-.js-URL responses carry `Cache-Control: immutable` — poisoning
clients for a year. Prevention is NOT available at the Pages layer (two
`_redirects` 404 variants were tried and both were ignored; see the comment in
`public/_redirects`). Recovery is what protects users: the boot guard in
`index.html`, which repairs entries with `fetch(cache:'reload')`.

**Safari does not implement `Clear-Site-Data`.** `/reset` therefore does nothing
on iOS — proven on a real iPhone. Never treat it as the recovery path for the
field app. Any safety mechanism must be tested on the platform that has the users.

**A guard that cannot run is not a guard.** Every recovery path lived inside the
app, so the one failure that stops the app disabled all of them. Ask of any new
safety mechanism: does this still work in the failure it exists for?

## 6. Known-open, not blocking

- **Resume quirk:** minimize/resume preserves typed input, but the screen flashes
  and scroll position moves. `page-lifecycle.md` forbids both. Not data loss.
- **Conversation archive:** `conversations.status` supports `resolved` and the
  inbox renders a "Resolved" filter tab, but nothing in the UI ever writes that
  status. The tab is permanently empty. Small feature, data model already there.
- **`/claims` and `/jobs` index routes do not redirect for field techs** — a
  deliberate design decision ("being bounced off a list you opened is its own
  bug"). A tech who types those URLs gets the office page in responsive form.
  Worth confirming that is still the intent.
- **Capacitor is entirely unverified** — no Xcode build, signing, entitlements or
  push enrolment. Deferred by owner decision.
- **`is_external` structural fix (roadmap):** route the two sibling policies
  through a SECURITY DEFINER helper — the pattern
  `can_current_employee_access_settings()` already establishes in
  `20260726182000` — so the column need not be granted at all and the grant list
  stops growing for the next policy. Remove the carve-out when it lands.

## 7. Hard constraints

- Do not apply a migration without fresh, task-specific owner authorization.
- A green Cloudflare check does not mean production serves your code. Fetch the
  asset.
- Report actual results, never expected. Say plainly what you skipped and why.
