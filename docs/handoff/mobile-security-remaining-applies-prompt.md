<!--
FILE: docs/handoff/mobile-security-remaining-applies-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for the session that applies the last four Mobile
  Production Readiness security migrations. Written at the end of the
  2026-07-27 promotion session, which promoted dev to production and applied
  the first three of seven.

DEPENDS ON:
  Internal: docs/handoff/promotion-readiness-prompt.md (the predecessor),
            .claude/rules/database-standard.md §0 and §5,
            scripts/migration-provenance-manifest.json,
            supabase/migrations/2026072[6-7]*, supabase/rollbacks/ (same names)
  Data:     reads  → read-only live catalog, Git, documentation
            writes → the shared Supabase project, but ONLY under a fresh
                     owner instruction for each named migration

NOTES / GOTCHAS:
  - State verified 2026-07-27 ~23:50Z. RE-VERIFY. Four sessions moved dev today.
  - The single highest-risk item renders as an EMPTY LIST, not an error. §6.
-->

# Handoff — the last four mobile-security migrations

Paste from `You are continuing UPR Platform work` onward into a fresh session.

---

You are continuing UPR Platform work (`moronisalvador/Utah-Pros-App-Git`). The
previous session promoted `dev` to production and applied three of seven pending
security migrations. Four remain. **Re-verify everything below before acting.**

**Work in a git worktree cut from current `origin/dev`.** One already exists at
`C:\Users\moronisalvador\APPS\upr-promotion-wt` — reuse or remove it, don't
create a second.

## 1. Verified state at 2026-07-27 23:50Z

- `origin/main` = `4ad79612`, `origin/dev` = `1d544860` (dev 1 ahead: a docs commit).
- **Production runs the promoted bundle.** Confirmed by asset-path change
  (`/assets/` → `/app-assets/`, from `03638752`), not by a green check.
  `npm run smoke:deploy -- https://utahpros.app` → PASS.
- **The ordering constraint from the previous handoff is RESOLVED.** `main` no
  longer reads `employees` directly; all 13 files route through
  `get_employee_directory()` / `get_message_author_directory()`, both live.
- Provenance gate PASS at ledger=44.

Re-derive before trusting any of it:

```bash
git fetch origin && git rev-list --left-right --count origin/main...origin/dev
npm run validate:provenance -- --strict-freshness
node scripts/smoke-deploy.mjs https://utahpros.app
```

## 2. Already applied — do NOT re-apply

| Ledger | Name |
|---|---|
| `20260727233252` | `create_notification_service_boundary` |
| `20260727233704` | `notify_emit_service_boundary` |
| `20260727233845` | `upsert_employee_page_access_provenance_reconciliation` |

All three are mapped in `scripts/migration-provenance-manifest.json`.

## 3. The four remaining, in the only valid order

Each is its own owner-authorized window. `20260726260000` says explicitly:
*"Do not batch with S1d, S1e, S1f, private media, or other pending SQL."*

| Order | Migration | Lines | Depends on |
|---|---|---|---|
| 1 | `20260726182000_mobile_employee_identity_containment` | 1,148 | production on new bundle ✅ |
| 2 | `20260726183409_inbound_lead_recording_source_boundary` | 1,078 | #1 |
| 3 | `20260726260000_notification_read_recipient_boundary` | 1,520 | #1 |
| 4 | `20260727022920_mobile_personal_ownership_boundary` | 2,257 | #1 + `20260727020000` ✅ |

Their preflights enforce these dependencies and refuse otherwise. Rollback files
exist for all four in `supabase/rollbacks/` under the same names.

**What each closes:**

1. **containment** — today any signed-in employee can read the whole `employees`
   table: names, emails, phones, `hourly_rate`, `overtime_rate`, commissions.
   Restricts browser reads to the caller's own row, makes `get_all_employees()`
   admin-only, gates commission read/write server-side. **This is the payroll
   exposure — highest value and highest risk of the four.**
2. **inbound_lead recording** — customer call-recording URLs sit in
   browser-readable `inbound_leads` rows. Moves them to a service-only table,
   leaves a truthy availability marker, gates playback behind Call Log.
3. **notification recipient** — `notifications_select USING (true)`; any employee
   can read *and mark read* anyone else's notifications, including via Realtime.
4. **personal ownership** — page access, notification settings, push devices and
   native `device_tokens` become owned by the signed-in employee. Also the one
   Capacitor push will depend on.

## 4. How to apply — read this before touching anything

`apply_migration` (Supabase MCP) is the only viable path, and it requires
retyping the SQL as a tool parameter. **`supabase db push` is NOT safe in this
repo:** local migration filenames do not match ledger versions, so it would see
hundreds of phantom-pending migrations and try to re-apply them.

Four operational facts, each learned the hard way on 2026-07-27:

- **Include the file's full header.** `.claude/hooks/block-destructive-sql.sh`
  blocks any migration whose SQL carries no `ROLLBACK:` section. Transcribing
  from the first `DO $$` down will be refused — correctly.
- **These migrations hash-pin their own RESULT**, not just their input. The
  containment file has 27 guard sites. A mistyped byte fails a postcondition and
  aborts the transaction. That is what makes hand-applying acceptable at all —
  but it only holds if you transcribe the guards too. Never "simplify" one.
- **On a connector timeout, check state before retrying.** It happened once.
  Query the live body hash / ledger first; a blind retry on a partially-applied
  migration is how you get a mess. Last time it had rolled back cleanly.
- **Record the ledger mapping in the SAME commit as the apply.** Versions are
  assigned AT APPLY TIME, not from the filename. Four rows were left unmapped
  earlier today precisely because this was deferred.

After each apply:

```bash
# 1. verify against the live catalog — never trust {"success": true}
# 2. add {version, name, path, reviewedOriginCommit} to ledgerMappings
# 3. refresh evidence, then:
npm run validate:provenance -- --strict-freshness   # expect PASS
npm run test:provenance                             # expect 15/15
```

Six `WARN … semantic hash matches` lines are expected and are not drift.

## 5. The browser check that actually matters

**After `20260726182000`, before applying anything else.** The failure mode is an
**empty crew picker — not an error**. No catalog query, smoke check or test will
catch it. A human must look at these, logged in:

- `/schedule` — the board renders and crew avatars/names appear
- `/timetracking` — employee list populates
- `/settings/team` — the roster loads
- `/tech/appointments/new` and an appointment **edit** sheet — crew picker populated
- `/jobs`, `/production`, a customer page, a job page, a claim page
- `/crm/tasks` — assignee picker

All 13 consumers go through `src/lib/employeeDirectory.js`. If one is empty,
**stop and run the rollback** — do not proceed to migrations 2–4.

Also confirm commission editing still works for an admin, and that a non-admin
does *not* gain access.

## 6. Hard constraints

- **Apply nothing without a fresh, task-specific owner instruction naming that
  migration** (`database-standard.md` §0). Authorization for one is not
  authorization for the next.
- One Supabase serves `dev` and `main`. Every apply is a production change.
- **The team is actively using the app.** Prefer a low-traffic window; the owner
  said plainly: don't break production.
- Never re-apply an applied migration. Check the ledger first.
- Report actual results, never expected. Say plainly what you skipped and why.

## 7. Known-open, explicitly not blocking

- **Capacitor is unverified** — no Xcode build, signing, entitlements or push
  enrolment. **None of these four migrations blocks it**; they are server-side
  authorization. App Store work is gated on Xcode and signing and can proceed in
  parallel. Start at `docs/app-store-readiness-roadmap.md` + the F1 phase in
  `.claude/rules/app-store-readiness-wave-ownership.md`.
- Ledger row `20260726233416 encircle_managed_credentials` is mapped but was
  applied by another session; nobody has re-reviewed its source.
- Resume quirk (screen flashes, scroll moves — `page-lifecycle.md` forbids both).
- Conversation "Resolved" filter tab is permanently empty; nothing writes that status.
- Six `retryable` `CALLRAIL_OUTBOUND_UNMATCHED` provider events, unexamined.
- `rearm_callrail_provider_event()` / `resolve_provider_event()` are live with no
  UI — the ops-health alert escalates to `critical` after 3 unresolved days and
  links to `/devtools`, which shows none of it.

## 8. Close-out

`.claude/rules/close-out-standard.md` — note step 2b: a migration needs a
CI-visible static contract test under `tests/qa/unit/**`, because
`supabase/tests/**` is in the `db` lane and `npm test` does not run it.

Update `UPR-Web-Context.md` (Rule 9) with what applied and its real ledger
version. Remove the worktree when done.
