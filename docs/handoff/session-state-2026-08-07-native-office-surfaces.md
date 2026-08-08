# Handoff — native office surfaces + reconciliation (2026-08-07)

**Branch:** `dev`, 3 commits ahead of `origin/dev`, **not pushed**.
`0edbfb1c` estimate status · `86239c3f` native New Estimate · `9d17ed6f` money-read migration.

**Plan of record:** `~/.claude/plans/i-just-wonder-if-floating-sunbeam.md` (six phases + evidence).

---

## Done

| | State |
|---|---|
| **Phase 1.1 — estimate "Sent"** | Shipped. One shared `src/lib/estimateStatus.js`; 46 of 57 estimates stop claiming they reached customers; 27 open ones worth $156,915 now findable under a new **Saved** tab |
| **Phase 5 step 1 — New Estimate on iOS** | Shipped + device-verified. More → New estimate. Xcode BUILD SUCCEEDED, renders on iPhone 17 Pro |
| **Phase 5 step 2 — money-read migration** | **AUTHORED, UNAPPLIED.** `20260807230000_office_financial_read_boundary` + rollback + 17-check static test |
| **Phase 5 step 2 — behavioural proof** | **EXECUTED, PASSED** 2026-08-07. `npm run test:db:office-financial-read:local`, receipt at `b69a919a`. Found two defects; see below |

Verification at handoff: build clean both targets, `npm test` **5,381 green** across the three
credential-free lanes, eslint 0 on changed files, migration hygiene 0 failures, native boundary
test 8/8, native bundle 98 chunks / entry graph 233,720 B of 237,568 (all budgets pass).

## Next, in order

**2. Behavioural proof for the migration — DONE 2026-08-07.**
`npm run test:db:office-financial-read:local` (also `:iterate` against a dirty tree). Six real
predecessors in ledger order, migration → proof → rollback → rollback proof → re-apply → proof.
Receipt commit `b69a919a`, manifest SHA-256 `fa891bd8…`. 3 ALLOW roles × 5 reports with exact
numbers, **30 refusals** across field_tech/estimator/supervisor/crm_partner/inactive/external,
5 unmapped-user refusals, service_role passing, 5 claimless refusals, and a rollback proof in
which a field technician reads A/R again.

**Two defects it found, both fixed, neither visible to any static check:**
- `get_ar_invoices` and `get_payments_ledger` declare `division text` while `jobs.division` is an
  enum. `LANGUAGE sql` assignment-casts at the result boundary; plpgsql's `RETURN QUERY` does not.
  **Both would have thrown for every caller, admin included, on apply.** Now `j.division::text`.
- **`get_pipeline_summary` is out of the migration** — five reports, not six. `Dashboard.jsx` calls
  `usePipeline()` with no `canFin` argument, so it fetches for every role landing on `/`; guarding
  it would have put a permanent error card on supervisor's and estimator's home screen, for four
  job counts. `docs/database-standard.md` §5b caught it, by way of the caller trace it demands.

**3. Owner authorizes the apply.** One Supabase behind dev and production — this is a
production change. Separate explicit yes; "do it all" does not cover it. **This is the current
gate.** Steps 4 and 5 below are blocked on it by the owner's own "fix the seam, then ship the
screen" sequencing.

**4. Collections + Dashboard native** — blocked on 3. Shipping them first would put A/R on a
phone behind a client-side gate only. Also needs the `overview_financials` grant for
office/project_manager (owner-approved) — it is **not** in `nav_permissions`, and `canAccess`
Layer 3 currently grants it to admins only.

**5. Lead Center** — needs Phase 3 first. `inbound_leads.lead_status` is a **dead state
machine**: 205 of 209 leads still read `new`, including 16 the kanban calls Won. Shipping the
screen unchanged puts a lying list in the owner's pocket. Plan: render the pipeline stage
instead and let the dropdown call `move_lead_to_stage` — delete a state machine rather than
merge two vocabularies. Also fix `get_inbound_leads` (no merged-lead filter; refuses
project_manager) and `update_lead_status` (no authorization check; caller-supplied actor).

## Known open, not mine

- **`recordPayment.js` has no insert-level idempotency key** (self-documented). Blocks bringing
  the invoice screen to native; AGENTS.md §15 requires one.
- **`collections-chat.js`** reads three of the guarded RPCs over service-role. The migration's
  guard carries a `service_role` bypass for exactly this — verify it before applying.
- **Five competing appointment status maps**; `statusTone.js` renders `en_route` blue and
  `paused` gray, against the amber/red in `tech-mobile-ux.md`. Plan phase 1.3.

## Traps that cost time this session

- `npm run build` produces the **web** bundle. Building web overwrites `dist/`; always finish
  with `npm run build:ios` + `node scripts/assert-native-dist.mjs`.
- Test lanes: `tests/qa/unit/**` is the **qa** lane, `src/**` is **unit**. `UPR_TEST_LANE` must
  be set or vitest finds nothing.
- The working tree is **shared with concurrent sessions**. Five commits landed under me
  mid-session, one of which briefly broke two test files. Always `git status` first and stage
  by explicit path.
- The simulator MCP control crashes; `xcrun simctl io <udid> screenshot --type=png` is reliable.
  Simulator text input gets intercepted at the OS level — do not trust it for form entry.
- A migration guard must use `IS DISTINCT FROM`, never `<>`: `auth.role()` is NULL outside a
  PostgREST request and `NULL <> 'x'` is NULL, which PL/pgSQL's `IF` treats as false, silently
  skipping the check.
