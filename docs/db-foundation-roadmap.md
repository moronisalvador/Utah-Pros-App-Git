# DB Foundation — Roadmap (2026-07-08)

This document is the **dispatch model of record** for the Database Foundation initiative: hardening
the shared Supabase into a secure, organized, professional foundation ready for advanced reporting and
future features — while breaking nothing. It was produced by a masterplan planning session (gap audit
vs the owner-supplied "Supabase Database Foundation Master Playbook" as capability taxonomy, seeded
from `AUDIT-REPORT.md`, adversarially reviewed by a multi-agent challenge pass that refuted two of its
own draft claims). **All statuses below were verified against the live Supabase project
`glsmljpabrwonfiltiqm` on 2026-07-08 and against real file reads — not assumed from any doc.**

Copy-paste launch blocks live in [`docs/db-foundation-dispatch.md`](db-foundation-dispatch.md); the
binding file/RPC ownership split lives in
[`.claude/rules/db-foundation-wave-ownership.md`](../.claude/rules/db-foundation-wave-ownership.md);
the standing rules this initiative installs live in
[`.claude/rules/database-standard.md`](../.claude/rules/database-standard.md).

**Supersedes:** the remaining open items of `AUDIT-REPORT.md` (2026-06-24) Batches B/D/E, and its
"Multi-tenant SaaS track" — carried forward here with supersede-transparency. This initiative does NOT
touch in-flight work (see Status reconciliation).

---

## Status reconciliation (live DB + repo, 2026-07-08)

| Area | Live status | Notes |
|---|---|---|
| RLS posture | **Permissive by design** | 125 public tables, all RLS-enabled; 198/220 policies `USING(true)`, 163 grant `anon` (incl. `payments`/`invoices`/`employees` write). Enforcement lives in the app + SECURITY DEFINER RPC layer, not policies. |
| Anon RPC surface | **~329 anon-executable** SECURITY DEFINER functions | Generated from the live catalog, not docs (the repo greps under-count). |
| Secrets in DB | **No exposure (verified)** | Every API key/OAuth token is in a deny-all RLS table (RLS on, zero policy); `anon`+`authenticated` read 0 rows. Plaintext at rest (Vault installed, empty). One config-write RPC lacks an admin gate (finding S2). |
| Storage | **Both buckets public + anon write/delete** | `job-files` (live, load-bearing reads) and `message-attachments` (21 orphaned objects, zero code consumers). |
| Migration drift | **290 live vs 133 in repo** | ~157 pre-May-2026 migrations untracked; `system_events` + `get_dashboard_stats` + a few objects exist live-only. |
| Data integrity | **Live duplicates present** | e.g. `invoices.qbo_invoice_id` 7 dup groups, `payments.qbo_payment_id` 5, `claims.encircle_claim_id` 4 — must be repaired before UNIQUE. |
| Performance | **108 unindexed FKs, 45 unused indexes** | At tiny data volume (tens of jobs) — low urgency, real for growth. |
| `search_path` | **25 mutable (7 SECURITY DEFINER)** | Down from 126 in June; scripted pin. |
| Reporting | **~25 per-widget RPCs, 0 tracked views** | Healthy pattern; no reporting-views layer; 3-way timezone inconsistency; funnel history accrues only since 2026-07. |
| Docs | **No plain-English data-model guide** | `UPR-Web-Context.md` is the expert source of truth (Rule 9); README stale. |

**Stale-doc disclosures (honest reconciliation, not silently flipped):** `CLAUDE.md` said "66+
migrations" — the dir has 133 files and the live DB has 290 applied. `AUDIT-REPORT.md`'s
`security_definer_view` ERRORs (5) are **gone** — those views were dropped, not converted; a related
drift is that `20260630_job_sales_canonical.sql` defines `public.job_sales` but no such view exists
live. These are captured in Phase F's drift reconciliation.

---

## Severity findings (with interim guidance until fixed)

**S1 — Anonymous role has read/write on financial + PII tables (P1-class exposure).** The
`VITE_SUPABASE_ANON_KEY` ships in every browser bundle; `anon` policies grant direct
select/insert/update/delete on `payments`, `invoices`, `employees`, and ~160 more tables, plus
execute on ~329 RPCs, plus write/delete on both storage buckets. *Mechanism:* anyone who extracts the
key (trivial) bypasses the app entirely. *Exposure today:* live and internet-reachable. *Interim
guidance until P2/P3 land:* this has been the posture since inception and no incident is known;
treat the anon key as sensitive, do not publicize it, and prioritize P2 (storage write/delete, zero
code impact) then P3. *Resolution:* P2 + P3 + Foundation's `ALTER DEFAULT PRIVILEGES` revoke (which
stops every FUTURE object from re-opening anon). Deferred-hardening on in-flight tables (see graph).

**S2 — `set_billing_setting` is anon-callable with no admin gate (P2 integrity, not a secret leak).**
`set_billing_setting(p_key, p_value)` is `SECURITY DEFINER`, granted to `anon`, guarded only by a
key-whitelist — no `p9_assert_admin()`. *Mechanism:* an unauthenticated anon-key holder can write
billing-config keys (`qbo_bank_account_id`, `qbo_fee_expense_account_id`, `surcharge_pct`,
`default_terms`). No secret is exposed. *Exposure today:* live. *Resolution:* Phase F adds
`PERFORM public.p9_assert_admin();` as the first statement (mirrors `set_integration_secret`), with a
committed test that a non-admin call raises and an admin call still succeeds.

**S3 — Storage buckets are world-writable/deletable.** Both buckets carry anon write/delete policies;
`job-files` holds live customer job photos/PDFs. *Mechanism:* an anon-key holder can overwrite or
delete any job photo. *Exposure today:* live. *Interim guidance:* same as S1. *Resolution:* P2 stage 1
(revoke anon write/delete — verified zero prod code impact) then P8 (private + signed URLs).

**Not findings (verified safe):** no third-party API key/OAuth token is anon/authenticated-readable
(all in deny-all tables); the logged-in app runs as `role=authenticated` and is unaffected by the
anon closure; realtime survives it (with `notifications_select` altered, not dropped).

---

## Gap-audit appendix (HAVE only from code/schema, never from docs)

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| 1 | Per-user auth (JWT) already in place | **HAVE** | `AuthContext.jsx` builds client from `session.access_token`; `employees.auth_user_id` → `auth.uid()` used in CRM-partner + P9 RPCs. Challenge-CONFIRMED. |
| 2 | Deny-by-default RLS | **MISSING** | 198/220 `USING(true)`; only 22 scoped policies (CRM partner). |
| 3 | Anon closure without breaking app | **PARTIAL** | authenticated role untouched → app safe; true-anon surface enumerated (5 items). Challenge-CONFIRMED. |
| 4 | Secrets not exposed | **HAVE** | Deny-all tables; anon+auth read 0 rows. Challenge-CONFIRMED live. |
| 5 | Secrets encrypted at rest | **MISSING** | Plaintext; Vault empty. Decision fork (Vault vs plaintext-behind-service-role). |
| 6 | Storage locked down | **MISSING** | Both buckets public + anon write/delete. |
| 7 | Migration drift reconciled | **MISSING** | 290 live vs 133 repo; no drift-check tooling. |
| 8 | External-ID uniqueness | **PARTIAL + live dup data** | Dup groups present; needs repair-then-UNIQUE. |
| 9 | FK covering indexes | **PARTIAL** | 108 unindexed FKs. |
| 10 | `search_path` pinned | **PARTIAL** | 25 mutable remain (7 DEFINER). |
| 11 | Reporting views layer | **MISSING** | 0 tracked views; per-widget RPCs healthy. |
| 12 | SQL timezone convention | **MISSING** | 3-way inconsistent (date-mt.js JS / inline AT TIME ZONE / naive CURRENT_DATE). |
| 13 | Lifecycle history for funnels | **PARTIAL** | `job_phase_history` + `lead_stage_history` (since 2026-07); claims/invoices lack transition history — cannot be backfilled. |
| 14 | Plain-English data-model guide | **MISSING** | Only `UPR-Invoicing-Financials-Employee-Guide.md` (billing). |
| 15 | Least-privilege standing rules | **MISSING → shipped by this plan** | `database-standard.md` + CLAUDE.md/checker edits (committed with this roadmap). |

---

## Phases

### Phase F — Foundation
> **✅ SHIPPED 2026-07-08** (PR #346, reviewed via the full gauntlet). All six items applied + verified live. The review found and closed two live anon exposures F had reproduced from old drift — `get_dashboard_stats` EXECUTE and the `system_events` audit-log read/write — via follow-up `20260708_dbf_revoke_anon_dashboard_and_events.sql` (now RLS-on deny-all; no anon consumer existed). The `set_billing_setting` "manager regression" the reviewer flagged was verified a non-issue (no employee holds the `manager` role `canEditBilling` checks, so effective behavior was already admin-only). F branched from `main` and re-authored divergent copies of this roadmap / the manifest / `database-standard.md`; those were **discarded** for the authoritative `dev` versions, with F's genuine improvements (the managed-Supabase per-object function-revoke rule; the UPR-Web-Context Phase-F summary) folded in.
> **Branch:** session-assigned (illustrative: `db-foundation/phase-f`) — cut off `dev`.
> **Prerequisite:** none. Model: **Opus · high** (100% of shared security scaffolding + live-RPC touches on the one shared prod DB).
> **Read scope:** this block + `CLAUDE.md` + `.claude/rules/database-standard.md` + `.claude/rules/db-foundation-wave-ownership.md`.
> **Close-out checklist (all true before the PR):**
> - [ ] Test-first, now green: deny-all-secrets invariant test (anon+auth read 0 rows from `integration_credentials`/`integration_config`/`user_google_accounts`); `set_billing_setting` non-admin-raises / admin-succeeds test; `mt_today()`/`mt_date()` MT-boundary tests; drift-check script self-test.
> - [ ] Acceptance: baseline snapshot committed + drift-check script green; drift-capture migrations for genuinely-untracked live objects **re-derived from the live catalog at run time** (`system_events`, `get_dashboard_stats`, + whatever a fresh diff shows — do NOT capture the nonexistent `job_sales`/`billing_overview` views); `mt_today()`/`mt_date(timestamptz)` IMMUTABLE helpers live; `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ... FROM anon` shipped; lifecycle-history capture (tables + `WHEN (OLD.col IS DISTINCT FROM NEW.col)` guarded triggers) for claims + invoices, seeded with a current-state row; `set_billing_setting` admin gate; the deterministic secret-exposure SQL gate script under `supabase/tests/`.
> - [ ] `npm run test` + `npm run build` + `npx eslint` pass; migrations additive-only, each with a rollback note.
> - [ ] `migration-safety-checker` + `anon-grant-auditor` + `db-foundation-phase-reviewer` clean.
> - [ ] `UPR-Web-Context.md` updated (new helpers, history tables, event registry section).
> - [ ] Rollback notes present; apply sequenced per `database-standard.md` §5; TEST rows deleted; pushed; PR into `dev` as a handoff.

Scope: Foundation owns 100% of the initiative's schema scaffolding + the shared security invariants.
Deliberately NOT: any REVOKE of existing anon grants (that is P2/P3), any DROP, any data repair.

### Phase P1 — Advisor quick wins
> **✅ SHIPPED 2026-07-08** (branch `claude/db-foundation-phase-p1-yxjclx`, full gauntlet green). Applied + verified live: `search_path` pinned on all 25 mutable functions (`function_search_path_mutable` advisor 25 → 0), duplicate `job_notes` btree(job_id) index dropped, `sync-encircle` POST auth-gated (test-first). **Two items deferred with documentation, not done:** (a) `pg_net` out of `public` — `ALTER EXTENSION … SET SCHEMA` verified to ERROR live (pg_net non-relocatable); only fix is a destructive `DROP`/`CREATE EXTENSION` that violates P1's additive/no-DROP scope → **separate RED-tier reviewed change** (`extension_in_public` stays 1); (b) leaked-password protection — Supabase Auth **dashboard toggle**, no SQL surface → **owner action** (`auth_leaked_password_protection` stays 1). Migration `20260708_dbf_p1_advisor_quick_wins.sql`.
> **Branch:** session-assigned. **Prerequisite:** none (runs beside F in Wave 0). Model: **Opus · high** (touches live functions + a worker on shared prod).
> **Read scope:** this block + `CLAUDE.md` + the two rules files.
> **Close-out:** pin `search_path` on the 25 mutable functions (`ALTER FUNCTION ... SET search_path`, behavior-preserving); drop the duplicate `job_notes` index; move `pg_net` out of `public`; auth-gate the unauthenticated `sync-encircle` POST; enable leaked-password protection (owner dashboard toggle — note in PR). Test-first where a function body changes; rollback notes; all standard gates.

Scope: advisor-flagged, low-risk, additive/attribute-only. One migration for the DB changes (applies
BEFORE F's baseline snapshot — see graph). Deliberately NOT: the QBO cent-rounding fix (extracted to
hotfix H0), any REVOKE.

### Phase P2 — Storage lockdown stage 1
> **Branch:** session-assigned. **Prerequisite:** F merged (default-privileges + baseline). Model: **Opus · high** (customer files on shared prod).
> **Close-out:** lock `message-attachments` (drop its 5 bucket-scoped policies, set `public=false`) — zero code consumers (verified: full-schema scan found nothing referencing it); revoke anon+public **write/delete** on `job-files` (keep public READ) — zero prod code impact (every browser upload already sends the user JWT); decide the 21 orphaned objects (owner: archive/delete — RED-tier). Test-first: an expired/absent-JWT offline-replay upload test. Scope migration strictly to storage.objects INSERT/DELETE policies; hard-code `schemaname='public'` exclusion so nothing else is touched.

Scope: storage policies only, no public-schema changes, no frontend edits. Deliberately NOT: bucket
privacy flip on `job-files` (that is P8).

### Phase P3 — Anon closure
> **Branch:** session-assigned. **Prerequisite:** F merged. Model: **Opus · high** (revokes on shared prod; public-surface regression risk).
> **Close-out:** recreate the ~163 public-schema `anon` policies without anon + `REVOKE EXECUTE FROM anon` on the ~329 anon RPCs (generated from the live catalog), MINUS the `database-standard.md` §2 allowlist; replace SignPage's direct `document_templates` anon read with a token RPC (edits `SignPage.jsx` + one new/extended RPC, code-deploys-first); regression-test every unauthenticated surface (login, set-password, e-sign submit, public `/status`, public form submit). Chunk policy recreates into short per-table idempotent (`DROP POLICY IF EXISTS`) transactions in fixed order; `schemaname='public'` only (storage is P2's). `notifications_select` is ALTERed to `TO authenticated`, never dropped. Amend CLAUDE.md/`migration-safety-checker` are already shipped; this phase supersedes stale `anon` grants live.

Scope: public-schema policies + RPC grants + `SignPage.jsx`. Deliberately NOT: storage (P2), any
table constraint (P4). Supersedes stale PR #224's unapplied hardening migration — note it for closing.

### Phase P4 — Data integrity
> **Branch:** session-assigned. **Prerequisite:** F merged. Model: **Opus · medium** (data-repair on money-adjacent columns).
> **Close-out:** orphan-data report; repair live duplicate external-IDs (NULL/rewrite ONLY the non-canonical duplicate, verified against QBO/Encircle, never the canonical row, never a status/money column) BEFORE adding UNIQUE; add UNIQUE on external-ID columns (partial-unique-index form where dups forced it — that index is P4-owned); add missing FKs (`NOT VALID` → `VALIDATE`); CHECK constraints. Avoids `crm_automations` (5-Ops owns an ALTER there). Test-first on the repair. Apply-window serialized vs P3 (both hit hot tables).

Scope: constraints + pre-check repair. Deliberately NOT: index-only additions (P5), policy/grant
changes (P3), any `crm_automations` touch.

### Phase P5 — Performance indexes
> **Branch:** session-assigned. **Prerequisite:** F merged. Model: **Opus · medium**.
> **Close-out:** covering indexes for hot-path FKs (subset of 108) — may run parallel; the DROP-unused/duplicate half runs AFTER P6 merges with a fresh `idx_scan` re-verify (excludes flag-gated CRM/form indexes that only look unused because `page:crm` is closed, anything in P6's view/RPC definitions, and the `job_notes` dup P1 already dropped). Every DROP in one revert-ready migration with the CREATE statements in its header.

Scope: indexes only. Deliberately NOT: any constraint on P4's declared external-ID columns.

### Phase P6 — Reporting foundation
> **Branch:** session-assigned. **Prerequisite:** F merged (needs `mt_*` helpers + history tables). Model: **Opus · high** (live-RPC body-replaces on shared prod).
> **Close-out:** tracked reporting-views layer (`CREATE VIEW` of NEW names, `WITH (security_invoker=true)`, `REVOKE ... FROM anon` after each); body-replace the timezone RPCs to use `mt_*` helpers — **drift-dump each via `pg_get_functiondef` first** (3 are not in the repo), **signatures + return shapes IDENTICAL** (FE-contract freeze; committed return-shape guard test per RPC); event_type registry doc section in `UPR-Web-Context.md`. `get_call_volume`/`get_conversion_trend` are CRM-frozen + `get_my_appointments_today`/`get_assigned_tasks`/`get_stalled_materials_for_employee` are tech-v2-frozen — body-only replaces with a **disclosed rule amendment** and the existing backward-compat tests green.

Scope: new views + timezone RPC bodies + docs. Deliberately NOT: new indexes (P5), history tables
(F owns them).

### Phase P7 — Docs & onboarding
> **Branch:** session-assigned. **Prerequisite:** none (docs only; regenerates last). Model: **Sonnet · medium**.
> **Close-out:** plain-English "How the UPR data model works" guide (invoicing-guide style — one ASCII diagram, who-writes-what, links-not-copies into `UPR-Web-Context.md` with a header disclaiming schema authority per Rule 9); README refresh (point at CLAUDE.md/UPR-Web-Context, stop hand-listing pages); glossary; "how to safely add a table / RPC / policy" guides; `scripts/db-docs-gen` generator (reads live schema via a read-only path, emits `docs/generated/**` with a regenerate-don't-edit banner — framed as a drift-verification aid, never a second source of truth); SQL-migration-header addendum to `documentation-standard.md`.

Scope: docs + generator only. Zero schema, zero `src/` page edits. F owns the baseline-snapshot dir;
P7 owns `scripts/db-docs-gen*` + `docs/generated/**` and never writes F's baseline.

### Phase P8 — Storage stage 2 (signed URLs)
> **Branch:** session-assigned. **Prerequisite:** F merged **AND** the tech-v2 Job Hub H2/H3 cutover complete (H3 deletes files P8 would touch — hard serial gate, do not launch on hope). Model: **Opus · high**.
> **Close-out:** consolidate the ~15 duplicated `job-files` public-URL builders into one helper; switch reads to signed URLs; flip `job-files` `public=false`. Test-first on the helper; regression-test every photo/doc render (web + iOS). Sequence: code (signed-URL helper) deploys BEFORE the bucket flip.

Scope: URL-helper refactor + bucket privacy. Serial tail — the only phase that changes where FE data
resolves (photo URLs), which is exactly why it is isolated and gated.

### H0 — QBO invoice cent-rounding hotfix (standalone, not a wave phase)
2-line fix in `functions/api/qbo-invoice.js` (`round2()` on `Amount` fields) + a test. Ships on its own
per CLAUDE.md Rule 4 (money change deserves focused review, not burial in a security batch). Not
gated on anything.

---

## Dependency graph

```
H0 QBO rounding ──> (independent, standalone — ship anytime)

P1 quick-wins ──> apply BEFORE F's baseline snapshot (Wave 0 ordering; else 26 false drifts)
              └─> otherwise independent

F Foundation ──> P2, P3, P4, P5, P6 (one parallel wave once F merges)
             ├─> ships ALTER DEFAULT PRIVILEGES revoke anon (structural fix: no future object re-opens anon)
             └─> ships mt_* helpers + claims/invoices history (P6 consumes helpers; history can't be backfilled → in F, not P6)

P3 anon-closure  ──> supersedes stale PR #224; owns the post-wave "zero anon outside allowlist" sweep
P3 ↔ P4          ──> serialized APPLY WINDOWS (both strong-lock DDL on hot tables); merge order still free
P4 data-repair   ──> must merge BEFORE P6 triggers OR P6 triggers carry WHEN-guards (F ships them guarded → safe either order)
P5 DROP-index half ──> soft: runs after P6 merges (fresh idx_scan re-verify)
P6 timezone RPCs ──> body-only replace of CRM/tech-v2 frozen-signature RPCs (disclosed amendment)
P7 docs          ──> regenerates last (docs match post-wave schema); independent otherwise
P8 signed-URLs   ──> HARD external gate: tech-v2 Job Hub H3 cutover complete (file-deletion collision)
P7-authRLS + multitenant + Vault ──> DESIGN-ONLY decision forks (owner calls; not phases)
```

## Dispatch model: Wave 0 → Wave 1 → tail

- **Wave 0 (now, parallel):** F + P1. P1's DB migration applies before F snapshots the baseline.
- **Wave 1 (parallel once F merges):** P2, P3, P4, P5, P6, P7. **Merge preference (never a gate):
  P2 → P3 first** (protection lands earliest), then the rest; throttle to review bandwidth.
- **Tail:** P8 after the Job Hub cutover. H0 anytime.
- **How work lands (per CLAUDE.md Rule 4 + this initiative's branch rule):** each phase is its own
  session on its assigned branch, PR into `dev` as a handoff the owner (or the autonomy policy) merges.
  Sessions do not click-merge, subscribe, or babysit their PR.

## File-ownership matrix (committed as `.claude/rules/db-foundation-wave-ownership.md`)

See the manifest — it is authoritative where prose here drifts. Summary: F owns all schema scaffolding
+ security invariants; P1 owns the advisor-fix migration + 2 worker/function edits; P2 owns
storage.objects policies; P3 owns public-schema policies/grants + `SignPage.jsx`; P4 owns constraints +
repair; P5 owns indexes; P6 owns views + timezone RPC bodies + `UPR-Web-Context` reporting section; P7
owns docs + generator; P8 owns the URL helper + bucket flip.

**Frozen in-wave (nobody edits):** in-flight files listed in the manifest (Job Hub `hub/**` +
`TechJobHub.jsx` + `App.jsx` tech routes + `TechAppointment/TechJobDetail` + `TimeTracker.jsx`;
omni-inbox `send-message.js` + `Conversations.jsx` + `email-worker/**`; schedule `Schedule.jsx` +
`JobPage.jsx`; CRM `Marketing.jsx` + `process-crm-automations.js` + `crm_automations`), plus
`functions/lib/*` and the shared consent gate.

**Migration rule (amended for this initiative):** F owns 100% of schema + the shared security
invariants + both live-RPC touches (`set_billing_setting` gate, the default-privileges revoke). Wave
sessions ship only their own owned migrations (P1 advisor fixes, P2 storage policies, P3
grant/policy recreates, P4 constraints+repair, P5 indexes, P6 view+body-replace). Every migration is
additive or policy/grant/index-only, carries a rollback note, and — because one Supabase backs prod —
is apply-window-sequenced per `database-standard.md` §5.

## Deferred-hardening (in-flight tables — re-check keyed to merges)

P3's anon closure and P4's constraints must either land before, or ship a committed backward-compat
test for, the tables in-flight sessions are actively writing: `messages`/`conversations`/`email_*`
(omni I/O/U), `crm_automations`/`crm_automation_runs`/`jobs`/`job_phase_history` (5-Ops),
`appointments`/`jobs`/`claims`/`contacts` (schedule A), `automation_settings` (CRM 4b). The manifest
lists these as a deferred-hardening bucket with re-check dates keyed to those merges. Everything else
(~80 of 91 tables, both buckets, the 108 FKs, the drift gap) is uncontested and proceeds immediately.

## What resisted maximum parallelism (honest record)

① P3 and P4 both issue strong-lock DDL on the same hot tables → apply windows serialized (merge order
still free). ② P6's timezone RPCs include CRM/tech-v2 frozen-signature functions → body-only replace
with a disclosed amendment + backward-compat tests. ③ Postgres default privileges auto-grant anon on
every new object → F must ship `ALTER DEFAULT PRIVILEGES` or every later phase silently re-opens the
door (this was found by the challenge pass, not the draft). ④ Lifecycle history can't be backfilled →
capture moved into F, accepting a bigger F. ⑤ P8 hard-gated on an external in-flight cutover (Job Hub
H3) → serial tail, not in the wave. ⑥ F is the single point of failure (owns all invariants) → priced
in via the full reviewer gauntlet (`migration-safety-checker` + `anon-grant-auditor` +
`db-foundation-phase-reviewer`).

## Options on record (owner decision forks — 2026-07-08)

| Decision | Recommendation | Rejected alternative + when it wins |
|---|---|---|
| Deny-by-default **per-employee** RLS (scope the `authenticated` role by role/assignment) | **Design-only for now.** This plan closes `anon` (the real exposure) and leaves `authenticated` broad but app-safe. | Full per-row scoping is the multi-tenant re-architecture priced by AUDIT-REPORT as "a project, not a cleanup pass" — do it only if selling to other companies (then P3's anon closure IS its foundation). |
| **Multi-tenant** retrofit (`tenant_id` on ~60 core tables) | **Design-only.** Not built. | Wins only on a confirmed decision to sell UPR as SaaS; would be its own initiative. |
| Secrets: **Vault vs plaintext-behind-service-role** | **Keep plaintext (deny-all + service-role only) + retire the redundant Cloudflare env copies** for fully-migrated providers so there's one rotation source. Simplest, and no exposure exists. | Vault/pgsodium (ciphertext at rest + rotation trail) wins if you later want defense-in-depth beyond service-role isolation, or a compliance requirement demands encryption-at-rest. |
| The 21 orphaned `message-attachments` objects | **Archive then delete** (nothing references them). | Keep only if you recall a reason they exist (none found in code or DB). RED-tier — owner confirms. |
| **Autonomy policy** (run while you sleep) | **Adopt the GREEN/YELLOW/RED ledger below.** | Fully-autonomous RED (auto-apply revokes/drops/data-repair) — declined by default; owner may pre-authorize specific RED items by name. |

## Autonomy ledger (the "while you sleep" policy)

Governs what an autonomous overnight run may do without waking the owner. One shared Supabase behind
production means a migration is live for real customers on apply — so the line is drawn at
irreversible/production-destructive actions.

- **GREEN — runs fully autonomously:** all read-only audits; the baseline snapshot; drift-check runs;
  writing/committing docs, tests, scripts, agents; opening PRs (never merging). Zero prod impact,
  reversible.
- **YELLOW — runs autonomously IF `migration-safety-checker` + `anon-grant-auditor` +
  `db-foundation-phase-reviewer` + tests + drift-check are all green:** purely **additive** migrations
  — new views (`security_invoker`), `CREATE INDEX` (never DROP), new history tables + guarded triggers,
  `search_path` pins, the `ALTER DEFAULT PRIVILEGES` revoke, the `mt_*` helpers. Cannot break existing
  readers; each ships a rollback script. Auto-apply to Supabase + auto-open PR; may auto-merge to `dev`.
- **RED — staged overnight, waits for the owner's OK:** any **REVOKE** (P3 anon closure), any **DROP**
  (unused/dup indexes, storage policies, the dead bucket's policies), any **data UPDATE/DELETE** (P4
  external-ID repair, deleting the 21 orphaned files), any **storage bucket privacy flip** (P2 public
  flag, P8), and any **CLAUDE.md standing-rule change**. Overnight the agents still write the migration,
  the rollback, the tests, and get reviewer sign-off — only the final apply/merge waits. Owner wakes to
  a short approve-list. **Pre-authorization:** the owner may name specific RED items to run auto (e.g.
  "lock `message-attachments` + delete its 21 orphaned files — confirmed").

## Challenge report (adversarial pass, run before this roadmap was committed)

- **R1 (`message-attachments` dead) — CONFIRMED.** Full-schema scan of 581 columns / 116 tables: zero
  references; 21 orphaned objects unreferenced. Safe to lock. → P2.
- **R2 (storage writes ride user JWT) — CONFIRMED.** All 14 browser write/delete sites + the offline
  queue send `Bearer <user JWT>`; restricting write/delete is zero prod code change. → P2.
- **R3 (anon allowlist complete) — MODIFIED.** Allowlist correct for the Postgres anon role; must also
  name the `message-attachments` bucket + verify service-role key in both Cloudflare env sets. → folded
  into P2/P3.
- **R4 (realtime survives) — CONFIRMED.** Verified into supabase-js internals; `notifications_select`
  must be ALTERed not dropped. → P3 rule.
- **R5 (quick-win counts) — MODIFIED.** 25 mutable functions (7 DEFINER) ✓; security-definer views
  already gone ✓; `pg_net` the one public extension ✓; timezone surface is 8 live RPCs (3 not in repo,
  drift-dump first) + column defaults, not 16 flat replaces. → P1/P6 re-scoped.
- **Draft claims REFUTED by the pass:** "capture 3 live views" (they don't exist — would create junk);
  "~200 anon RPCs" (actually 329). Corrected above.
- **Disjointness:** every Wave-1 pair proven DISJOINT-WITH-RULE (rules folded into the manifest);
  F↔P1 flagged the baseline-race (P1 applies first) and the default-privileges leak (F ships the fix).
- **Counter-ordering:** an independent skeptic argued alternatives; adjudicated → moved lifecycle
  capture into F, extracted H0, set P2→P3 merge preference, added F exit-criteria. All adopted.

---
*Standing DB rules: [`.claude/rules/database-standard.md`](../.claude/rules/database-standard.md).
Reviewers: `migration-safety-checker`, `anon-grant-auditor`, `db-foundation-phase-reviewer`.
Schema/RPC truth stays `UPR-Web-Context.md` (Rule 9) — verify live, not from memory.*
