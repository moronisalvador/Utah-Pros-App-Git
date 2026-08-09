# Handoff — invoice release reconciliation

**Written:** 2026-08-04 night · **For:** whoever reconciles the four concurrent sessions

This exists because four sessions were started at once and they land on shared files. Read
`docs/invoice-send-review-roadmap.md` first — it holds the frozen contracts, the design decisions
with their reasoning, and the production apply status. This file only covers **coordination**.

## Production state — verified, do not re-derive from docs

Applied to `glsmljpabrwonfiltiqm` and verified read-only:

| Migration | Verified |
|---|---|
| `20260804193000_money_table_anon_grant_closure` | `anon` = no SELECT/UPDATE/DELETE/TRUNCATE on invoices, invoice_line_items, estimates, payments. `authenticated` + `service_role` unchanged. RLS on. |
| `20260804210000_invoice_activity` | RLS enabled **and forced**; `service_role` SELECT+INSERT, UPDATE/DELETE **false**; zero browser table privilege; `anon` cannot execute the reader; guard trigger present; 2 columns, 4 functions. |

**Not applied:** `20260804120100_billing_editor_role_boundary`.

Both applied migrations are **inert against deployed code** — `main` references none of the new
objects. Nothing user-visible has changed. That is a deliberate, stable resting point.

## The one hard constraint

`codex/invoice-send-review-activity` widens `BILLING_EDIT_ROLES` to
`['admin','office','project_manager']`. `public.billing_edit_access()` in production still holds
the narrow set until `20260804120100` applies.

**Deploying that code without that migration shows office and project_manager billing controls the
database refuses (42501).** Migration first, always.

## FIRST: find the four sessions — git will not tell you

Chip sessions generate their own branch and worktree names, and those names have **no relation to
the task**. Tonight's two earlier chips came back as `claude/elastic-kowalevski-00006c` (the anon
closure) and `claude/objective-greider-77e603` (the billing boundary) — nothing in git connects
either name to what it did, and both left their work **uncommitted** at first, so `git branch`
and `git log` showed nothing at all.

Do not go looking through branches. Map title → worktree → branch with the session tooling:

- `mcp__ccd_session_mgmt__list_sessions` returns `{title, cwd, branch, isRunning}` for every
  session. Match on the chip titles below.
- `mcp__ccd_session_mgmt__search_session_transcripts` finds a session by something it discussed
  when the title is not enough.

Then, for each worktree it names, check `git status --porcelain` **before** assuming there is
nothing there — a finished session may have left everything uncommitted. That was true of both
earlier chips, and their work would have been lost to a `git clean`.

The four titles to look for:

1. `Finish invoice release: apply billing migration, deploy`
2. `Make the SQL hook verify apply payloads match the file`
3. `Fix "Sent" mislabel across the remaining billing surfaces`
4. `Add role checks to the estimate-creation RPCs`

Already merged into `codex/invoice-send-review-activity`, do not re-merge:
`claude/elastic-kowalevski-00006c` and `claude/objective-greider-77e603`.

## The four sessions and where they collide

| Session | Owns | Collides on |
|---|---|---|
| Finish invoice release | the release chain; merges to `dev` then `main` | everything downstream — let it go **first** |
| SQL hook payload fidelity | `.claude/hooks/block-destructive-sql.sh` | **the release session's apply runs through this hook.** Sequence it after the release, or expect a confusing refusal |
| "Sent" mislabel sweep | ARDashboard, InvoicesList, invoiceMath, dashFormat, useCollections, ClaimBilling | `UPR-Web-Context.md` |
| Estimate-creation role checks | a new migration + `NewEstimateModal` | `UPR-Web-Context.md`, `initiative-status.md`, and **`tests/qa/unit/db-lane-coverage.test.js`** |

**`db-lane-coverage.test.js` is the sharp one.** Its `LOCAL_ONLY_SQL` is compared with `toEqual`
against a sorted directory listing — exact equality. Two sessions adding a `*.test.sql` will
conflict, and a bad merge fails the whole qa lane with an error that looks unrelated to either
change.

Suggested merge order: release → "Sent" sweep → estimate role checks → hook.

## Things that are true and easy to get wrong

- **`'manager'` is not a member of the `public.employee_role` enum.** It never was. Any code or SQL
  naming it is a branch that cannot be true. `canEditBilling` was admin-only in practice until the
  2026-08-04 widening.
- **A column-level `REVOKE` cannot subtract a privilege held through a table-level `GRANT`.** It
  runs without error and does nothing. `public.invoices` still carries a blanket grant to
  `authenticated`, which is why `customer_message`/`send_cc_email` are protected by a **trigger
  guard**, not by a revoke. Do not "simplify" that into a revoke.
- **`invoice_activity.invoice_id` is deliberately not a foreign key.** `InvoiceEditor.doDelete()`
  hard-deletes invoices; CASCADE would let the audited party erase their own trail, RESTRICT would
  break a shipped flow. The audit outlives its subject on purpose.
- **`initiative-status.md` wrongly says `20260803192344` is unapplied.** Production disagrees:
  `billing_edit_access()`, `oop_estimates_billing_write` and `oop_estimate_lines_billing_write` are
  all live and the legacy `allow_authenticated_estimates` policy is gone. Correct that passage.
- **`src/index.css` has ~89 bytes of headroom** against a CI-blocking 600,000 ceiling. New global
  CSS is effectively blocked; use a component-scoped stylesheet.

## Apply discipline, learned the hard way tonight

The first apply attempt abbreviated a migration header to save context, which silently dropped the
required ROLLBACK section — the payload was no longer the reviewed file.
`.claude/hooks/block-destructive-sql.sh` caught it, but **only because it greps for the literal
string `ROLLBACK`**. A payload that dropped a `REVOKE` line would have applied clean.

Read the file and pass it **verbatim**, then verify the resulting catalog objects rather than
trusting the payload. A chip is open to make the hook enforce this mechanically.

## Not automated, on purpose

The end-to-end check — an office-role user recording a payment and sending one real invoice — is a
human action. dev, Preview and TestFlight all point at the production Supabase project, so there is
no isolated client to rehearse it against.
