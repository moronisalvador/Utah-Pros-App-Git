# DB Foundation — Session Dispatch Blocks

Copy-paste launch blocks. Each is fully self-contained for a cold session with zero conversation
history: a settings header, then the complete prompt. Claude Code web hands each session a
harness-assigned `claude/…` branch — use it as-is. Where a block cites a Foundation artifact name,
`.claude/rules/db-foundation-wave-ownership.md` + the phase's roadmap block are authoritative if names
drift.

**How work lands (per CLAUDE.md Rule 4 + this initiative's branch rule):** each session works on its
assigned branch cut from `origin/dev`, and opens a PR into `dev` as a handoff — the owner (or the
autonomy policy in `docs/db-foundation-roadmap.md`) merges. Sessions never click-merge, subscribe to,
or babysit their PR.

**⚠️ BASE PREFLIGHT — every session's FIRST action, before any other work (binding on every block below).**
The harness may start your container from `main` or a stale commit, NOT from the `dev` tip that carries
this plan — this is exactly how Phase F went wrong (it branched from `main`, never saw the plan, and
re-authored divergent copies of the roadmap/manifest/rulebook that would have wiped the Wave 1 plan). So
re-base onto latest `dev` first, then verify the plan is present:

```bash
git fetch origin dev
git checkout -B "$(git branch --show-current)" origin/dev   # move your assigned branch onto latest dev
# Verify the plan of record exists — if ANY is missing, your base is wrong: STOP and re-sync, do not proceed:
ls .claude/rules/database-standard.md \
   .claude/rules/db-foundation-wave-ownership.md \
   docs/db-foundation-roadmap.md \
   .claude/agents/db-foundation-phase-reviewer.md \
   .claude/agents/anon-grant-auditor.md
```

These plan documents (`database-standard.md`, this dispatch doc, the roadmap, the ownership manifest) and
the reviewer agents are **CONSUMED, never created or rewritten by a wave session.** If they aren't on disk,
you are on the wrong base — do not recreate them; re-sync from `dev`. `dev` also carries F's shipped
migrations (`supabase/migrations/20260708_dbf_*.sql`) — drift-capture, `mt_*` helpers, history tables,
default-privileges revoke; build on them, don't re-derive them.

**Preconditions:**
- ① Wave 1 launches only after **F is merged into `dev`** (it ships the default-privileges revoke,
  `mt_*` helpers, history tables, and the reviewer/gate scaffolding every wave phase depends on).
- ② P8 launches only after the **tech-v2 Job Hub H3 cutover is complete** (hard external gate — H3
  deletes files P8 touches; do not launch on hope).
- ③ **RED-tier actions** (REVOKE / DROP / data UPDATE / bucket privacy flip / delete orphaned files)
  stage their migration + rollback + tests and **wait for the owner's OK** unless the owner has
  pre-authorized that specific item (autonomy ledger).

---

## Wave 0 — Sessions F and P1 may launch simultaneously (zero overlap)

```
[Session F — Wave 0]
Branch: session-assigned (illustrative: db-foundation/phase-f), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: nothing (Wave 0)

You are building Phase F (Foundation) of the DB Foundation initiative — one phase only, shared-security-weighted. Read scope: CLAUDE.md, docs/db-foundation-roadmap.md (Phase F block + Status reconciliation + Severity findings + Autonomy ledger), .claude/rules/database-standard.md, and .claude/rules/db-foundation-wave-ownership.md. Work on your assigned branch cut from origin/dev. This is ONE shared Supabase (glsmljpabrwonfiltiqm) behind dev AND production — every migration is live in prod on apply; verify live column names via MCP, never from memory.

Hard constraints: additive / policy-grant / index-only, no DROP/RENAME/tightening ALTER on a live table; every migration carries a rollback note; least-privilege grants (GRANT EXECUTE TO authenticated, service_role — never anon outside the database-standard.md §2 allowlist); frontend-contract freeze (no column rename/move, no RPC return-shape change). You edit ONLY the files the ownership manifest assigns to F; frozen files untouched.

Build (riskiest first, test-first — commit the failing test before the code):
① Secret-exposure SQL gate under supabase/tests/ + a committed test asserting anon AND authenticated read 0 rows from integration_credentials, integration_config, user_google_accounts (the deny-all invariant that protects every API key — make it un-regressable).
② set_billing_setting admin gate: CREATE OR REPLACE adding PERFORM public.p9_assert_admin(); as the first statement (signature unchanged); test that a non-admin call raises 42501 and an admin call still succeeds.
③ ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS / REVOKE ALL ON TABLES, SEQUENCES FROM anon (so no future object silently re-opens anon) — with a rollback note.
④ mt_today() and mt_date(timestamptz) IMMUTABLE helpers (America/Denver); tests for the MT day boundary.
⑤ Lifecycle-history capture for claims + invoices: new history tables (RLS + authenticated policy at creation) + AFTER UPDATE triggers carrying WHEN (OLD.<tracked_col> IS DISTINCT FROM NEW.<tracked_col>) — never bare AFTER UPDATE — seeded with a current-state row per entity so funnels accrue from now. (History can't be backfilled; that's why it's in F.)
⑥ Drift reconciliation: a baseline live-schema snapshot committed under a dedicated dir (NOT docs/generated/) + scripts/db-drift-check* that diffs live vs repo; drift-capture migrations for genuinely-untracked live objects — RE-DERIVE the list from the live catalog at run time (system_events, get_dashboard_stats, + whatever a fresh diff shows). Do NOT capture job_sales or billing_overview — they do not exist live; capturing them would CREATE junk views.

Close-out: npm run test + npm run build + npx eslint pass; migration-safety-checker + anon-grant-auditor + db-foundation-phase-reviewer clean; apply + verify each migration live via MCP in a low-traffic window (sequence: helpers/tables before anything that reads them); update UPR-Web-Context.md (new helpers, history tables, event-type registry section); delete TEST rows; push -u, open a PR into dev via the template, mark it ready, then stop — the owner merges. Do NOT subscribe to, babysit, or wait for a review on it.
```

```
[Session P1 — Wave 0]
Branch: session-assigned (illustrative: db-foundation/phase-p1), cut from origin/dev
Model: Opus 4.8
Effort: High
Launch after: nothing (Wave 0) — but your DB migration must APPLY before Session F snapshots the baseline (coordinate the apply order; if unsure, apply P1 first and tell F to re-snapshot).

You are building Phase P1 (advisor quick wins) — one phase only. Read scope: CLAUDE.md, the Phase P1 block in docs/db-foundation-roadmap.md, .claude/rules/database-standard.md, .claude/rules/db-foundation-wave-ownership.md. Assigned branch off origin/dev. One shared Supabase behind prod — verify live via MCP.

Hard constraints: attribute/index-only DB changes + one worker edit; additive; rollback notes; frontend-contract freeze; you edit ONLY your owned files.

Build (test-first where a function body changes):
① ALTER FUNCTION ... SET search_path = public on the 25 mutable functions (7 are SECURITY DEFINER — do those first); confirm the live list via get_advisors, not memory.
② DROP the duplicate job_notes index (idx_job_notes_job_id vs job_notes_job_idx — keep one; confirm both are btree(job_id) live).
③ ALTER EXTENSION pg_net SET SCHEMA extensions (move it out of public).
④ Auth-gate the sync-encircle POST in functions/api/sync-encircle.js (mirror the requireAuth pattern already on GET).
⑤ Note in the PR: enable leaked-password protection (owner dashboard toggle — you can't set it from code).

Close-out: standard gates (test/build/eslint, migration-safety-checker + anon-grant-auditor + db-foundation-phase-reviewer); apply live; rollback notes; update UPR-Web-Context.md; push -u, PR into dev, stop. Do NOT bundle the QBO cent-rounding fix (that's standalone hotfix H0).
```

---

## Wave 1 — Sessions P2, P3, P4, P5, P6, P7 may launch simultaneously (after F merges)

Merge preference (never a gate): **P2 → P3 first**, then the rest; throttle to review bandwidth.

```
[Session P2 — Wave 1]
Branch: session-assigned. Cut from origin/dev. Model: Opus 4.8. Effort: High.
Launch after: F merged into dev.

You are building Phase P2 (storage lockdown stage 1) — one phase only, customer-files-weighted. Read scope: CLAUDE.md, the Phase P2 block in docs/db-foundation-roadmap.md, database-standard.md, the ownership manifest. Assigned branch off origin/dev.

Hard constraints: storage.objects policies ONLY — hard-code schemaname='public' EXCLUSION so you never touch public-schema policies (that's P3's); zero frontend edits; rollback note; use DROP POLICY IF EXISTS so re-runs are no-ops.

Build (test-first): ① a test simulating an expired/absent-JWT offline photo-replay upload. ② Lock message-attachments: drop its 5 bucket-scoped policies, set buckets.public=false (verified zero code consumers). ③ Revoke anon+public WRITE/DELETE on job-files (both the anon_* pair TO anon and the job_files_* pair TO public); KEEP the public READ policy (every browser upload already sends the user JWT, so this is zero prod code impact; do NOT touch the bucket public flag or read policy — that's P8).
RED-tier — stage and wait for owner OK (or pre-authorization): the 21 orphaned message-attachments objects (archive/delete) and the public→private flag flip on message-attachments.
Close-out: standard gates + apply live in a low-traffic window; update UPR-Web-Context.md storage section; PR into dev; stop.
```

```
[Session P3 — Wave 1]
Branch: session-assigned. Cut from origin/dev. Model: Opus 4.8. Effort: High.
Launch after: F merged into dev.

You are building Phase P3 (anon closure) — one phase only, public-surface-regression-weighted. Read scope: CLAUDE.md, the Phase P3 block in docs/db-foundation-roadmap.md, database-standard.md (esp. §2 allowlist), the ownership manifest (esp. §8 deferred-hardening). Assigned branch off origin/dev.

Hard constraints: public-schema (schemaname='public') policies + RPC grants ONLY — storage is P2's, constraints are P4's; generate the revoke/recreate SET from the LIVE catalog (≈329 anon RPCs, ≈163 anon policies), not from docs; MINUS the database-standard §2 allowlist; authenticated role untouched; rollback = re-GRANT script; RED-tier (all REVOKEs stage + wait for owner OK unless pre-authorized); apply-window must NOT overlap P4 (both strong-lock hot tables).

Build (test-first): ① regression tests for every unauthenticated surface (login, set-password, e-sign submit via SignPage, public /status, public form submit). ② Replace SignPage.jsx's direct anon document_templates read with a token-gated RPC (code deploys BEFORE the revoke). ③ Recreate the ~163 public anon policies without anon, chunked into short per-table idempotent (DROP POLICY IF EXISTS) transactions in fixed alphabetical order. ④ REVOKE EXECUTE FROM anon on the anon RPCs minus allowlist. ⑤ ALTER POLICY notifications_select TO authenticated (never DROP — realtime + reads depend on it). ⑥ Own the post-wave sweep: re-run F's drift-check asserting zero anon grants/policies/EXECUTEs outside the allowlist. Defer any change on the §8 deferred-hardening tables until their in-flight phase merges (or ship a backward-compat test). Note in the PR that this supersedes the unapplied migration in PR #224.
Close-out: standard gates; apply live sequenced (code first, then revokes) in the agreed window; update UPR-Web-Context.md; PR into dev; stop.
```

```
[Session P4 — Wave 1]  Branch: session-assigned, off origin/dev. Model: Opus 4.8. Effort: Medium.
Launch after: F merged.
Build Phase P4 (data integrity) — read its roadmap block + database-standard + manifest. Constraints + pre-check repair ONLY; avoid crm_automations; apply-window must not overlap P3. Test-first: the external-ID dedup repair. ① Orphan-data report. ② Repair live duplicate external-IDs — NULL/rewrite ONLY the non-canonical duplicate occurrence (verify against QBO/Encircle first; NEVER the canonical row, NEVER a status/money column) — RED-tier, stage + wait for owner OK. ③ Add UNIQUE on external-ID columns AFTER the repair (partial-unique-index form where dups forced it — that index is P4-owned). ④ Missing FKs via ADD CONSTRAINT NOT VALID → VALIDATE CONSTRAINT. ⑤ CHECK constraints. Rollback notes; standard gates; apply live; UPR-Web-Context.md; PR into dev; stop.
```

```
[Session P5 — Wave 1]  Branch: session-assigned, off origin/dev. Model: Opus 4.8. Effort: Medium.
Launch after: F merged.
Build Phase P5 (performance indexes) — read its roadmap block + manifest. Indexes ONLY; never add/drop an index on P4's declared external-ID columns. ① Covering indexes for hot-path FKs (subset of the 108; plain CREATE INDEX — CONCURRENTLY isn't allowed inside apply_migration's transaction, and data volume is tiny) — may run parallel. ② The DROP-unused/duplicate half runs AFTER P6 merges: re-verify idx_scan live, EXCLUDE anything in P6's view/RPC definitions, flag-gated crm_*/form_*/sequence indexes (cold only because page:crm is closed), and the job_notes dup P1 dropped. All DROPs in ONE revert-ready migration with the CREATE statements in its header (RED-tier — stage + wait). Standard gates; UPR-Web-Context.md; PR into dev; stop.
```

```
[Session P6 — Wave 1]  Branch: session-assigned, off origin/dev. Model: Opus 4.8. Effort: High.
Launch after: F merged (needs mt_* helpers + history tables).
Build Phase P6 (reporting foundation) — read its roadmap block + manifest §3. New views + timezone RPC body-replaces + docs. Frontend-contract freeze is CRITICAL here. ① Reporting-views layer: CREATE VIEW of NEW names, WITH (security_invoker = true), REVOKE ALL FROM anon after each. ② Body-replace the timezone RPCs to use mt_* helpers — drift-dump each via pg_get_functiondef FIRST (3 are not in the repo), keep signature + RETURNS shape IDENTICAL, commit a return-shape guard test per RPC. get_call_volume/get_conversion_trend (CRM-frozen) + get_my_appointments_today/get_assigned_tasks/get_stalled_materials_for_employee (tech-v2-frozen) need a DISCLOSED rule amendment in your PR + the existing backward-compat tests green. ③ event_type registry section in UPR-Web-Context.md. Standard gates; apply live; PR into dev; stop.
```

```
[Session P7 — Wave 1]  Branch: session-assigned, off origin/dev. Model: Sonnet. Effort: Medium.
Launch after: F merged (regenerate docs last so they match post-wave schema).
Build Phase P7 (docs & onboarding) — read its roadmap block + manifest. Docs + generator ONLY; zero schema, zero src/ page edits. ① Plain-English "How the UPR data model works" guide under docs/database/ in the UPR-Invoicing-Financials-Employee-Guide.md style (one ASCII diagram, who-writes-what) — LINK into UPR-Web-Context.md sections, never copy schema (Rule 9), with a header disclaiming schema authority. ② README refresh (point at CLAUDE.md/UPR-Web-Context; stop hand-listing pages). ③ Glossary + "how to safely add a table / RPC / policy" guides. ④ scripts/db-docs-gen* reading live schema via a READ-ONLY path (never service-role DDL creds), emitting docs/generated/** with a "regenerate, don't edit" banner — framed as a drift-verification aid, not a second source of truth; never write F's baseline dir. ⑤ SQL-migration-header addendum to .claude/rules/documentation-standard.md. Standard gates (eslint n/a if no JS beyond the generator); PR into dev; stop.
```

---

## Tail + standalone

```
[Session P8 — TAIL]  Branch: session-assigned, off origin/dev. Model: Opus 4.8. Effort: High.
Launch after: F merged AND the tech-v2 Job Hub H3 cutover is COMPLETE (hard gate — H3 deletes files P8 touches; confirm, do not launch on hope).
Build Phase P8 (storage stage 2, signed URLs) — read its roadmap block + manifest. ① Consolidate the ~15 duplicated job-files public-URL builders into one signed-URL helper. ② Swap all render call sites to it. ③ Flip job-files public=false (RED-tier — stage + wait for owner OK). Sequence: the signed-URL helper deploys BEFORE the bucket flip. Test-first on the helper; regression-test every photo/doc render (web + iOS). Standard gates; PR into dev; stop.
```

```
[H0 — standalone hotfix, anytime]  Branch: session-assigned, off origin/dev. Model: Opus 4.8. Effort: Medium.
Fix QBO invoice cent-rounding in functions/api/qbo-invoice.js: wrap the Amount fields (Number(li.line_total …) and Number(inv.adjusted_total ??  …)) in a round2() to 2 decimals, matching the round2 helpers already in src/components/admin-mobile/invoice/invoiceMath.js. Test-first: a committed test asserting a fractional-cent line total pushes a 2-decimal Amount. Money-weighted — read BILLING-CONTEXT.md. Ships on its own per Rule 4; PR into dev; stop.
```
