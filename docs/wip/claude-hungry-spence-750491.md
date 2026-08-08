---
branch: claude/hungry-spence-750491
ships: true
opened: 2026-08-07
---

# What

OOP quote→estimate billing boundary: the database gate on
`convert_oop_quote_to_estimate` moves from the dead inline literal
`('admin','manager')` to `public.billing_edit_access()`.

# Why it matters

Office and project_manager staff see an ENABLED "Create estimate" button in the OOP
calculator (the UI gates on `canEditBilling`) and get SQLSTATE 42501 from the database.
Same shape as the QBO worker-gate defect: button rendered, server refused. Owner decided
2026-08-07 that conversion follows the billing boundary; `correct_oop_estimate` stays
admin-only and its divergence is now pinned by a test.

# Next action

1. ~~Run the §5b behavioural proof.~~ **DONE — PASSED.**
2. ~~Wait for grouped-lines to be committed.~~ **DONE** — landed on `origin/dev` as
   `20260807210000_oop_estimate_grouped_lines.sql` (renumbered from `…190000` after a
   duplicate-version collision), commit `30734799`, sha256 `e2d8b962…`.
3. ~~Rebuild on the frozen grouped-lines body and re-pin the drift guard.~~ **DONE** —
   base md5 `bbf68c74…`, new body `eee648e4…`, diff is the two gate hunks only. Proof
   RE-RUN and PASSED on the six-predecessor lineage: receipt `448d9083`, manifest
   SHA-256 `268f3664…`.
4. ~~Push.~~ **DONE 2026-08-07** — owner-authorized in-session; `origin/claude/hungry-spence-750491`
   at `56ae8d8a`, remote and local verified identical. Nothing is disk-only any more.
5. **Reviewers not yet run**: `migration-safety-checker` + `anon-grant-auditor`
   (close-out step 2). Note the diff also touches a SHARED BLOCKING CI GATE —
   `scripts/check-migration-hygiene.mjs` — which every other session depends on, so that
   change wants a second pair of eyes even though Rule 4's default is direct-to-`dev`.
6. Then: `qa-staging` apply → owner-authorized production apply. **Both** migrations in
   one window, timestamp order `…210000` then `…220000` — grouped-lines is on `dev` but
   also unapplied, so it is part of the same window.
7. Owner smoke test: an office-role login converting a quote. An agent cannot do this —
   it needs a real office-role authentication, which the test-customer allowlist does not
   substitute for.

# Known follow-ups (not blockers)

- `--iterate` exists on this qualifier and on grouped-lines; the other five still refuse
  arguments. Mechanical to roll out, left alone as other leases' files.
- `stripComments` in the hygiene gate is not importable (top-level runner, `process.exit(1)`),
  so its regression coverage is a source contract. Export + a run-directly guard would allow
  real behavioural tests.
- No SQL parse gate in CI. A Postgres service container would catch the syntax class outright
  and is the highest-value remaining prevention.
- Close-out §5b still reads as satisfied by an AUTHORED proof; recommending it require an
  EXECUTED one with a receipt SHA. Owner's to authorize — a rules edit does not bind a
  running session anyway.
- `no-use-before-define-contract.test.js` gives programmatic ESLint 5s; it timed out at 8.8s
  under Docker load here and passes when quiet. It will flake on a loaded CI runner.
- Proof-harness debt, shrink-only in `scripts/qa/db-proof-harness-baseline.json`: 7 files set
  only the legacy JWT claim, 3 gate on `current_database()`, 3 assume a seeded flag, and 13
  have no executable isolation guard.
