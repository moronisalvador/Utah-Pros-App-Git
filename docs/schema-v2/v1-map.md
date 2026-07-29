# Schema v2 — v1 Usage Map (Phase P0)

**Generated:** 2026-07-29 · code as of `dev` @ `1bee3d60` · Phase **P0** of [`docs/schema-v2-plan.md`](../schema-v2-plan.md)
**Deliverable:** every public table (141), column (1,746), function/RPC (400), RLS policy (223) and trigger (52) in the live schema, classified **used / dead / duplicated / band-aid** from the code that actually touches it.

**This is a map, not a design.** v2 design is Phase P1 — a separate session, after the owner reviews the dead list below.

**Per-object detail with evidence lives in [`domains/`](domains/)** — one report per domain, ~2,200 lines total. This file is the synthesis: how it was built, what the numbers are, the ten worst structural problems, and the questions only the owner can answer.

| Domain | Report |
|---|---|
| Jobs & Claims | [`domains/jobs.md`](domains/jobs.md) |
| Scheduling & Appointments | [`domains/sched.md`](domains/sched.md) |
| Billing / QBO / Stripe | [`domains/billing.md`](domains/billing.md) |
| Messaging & Consent | [`domains/msg.md`](domains/msg.md) |
| CRM & Leads | [`domains/crm.md`](domains/crm.md) |
| Tech App & Time-Tracking | [`domains/tech.md`](domains/tech.md) |
| Auth / Employees / Admin | [`domains/auth.md`](domains/auth.md) |
| Documents & Storage | [`domains/docs.md`](domains/docs.md) |

---

## 1. Method and sources

- **Catalog:** extracted fresh 2026-07-29 from the `qa-staging` branch (`uizgwvkvzyldystqrcsk`), parity-verified against production the same day — 141 tables / 400 functions / 219 public policies on both. Two branch-seed gaps were found and closed from production read-only queries: the four `storage.objects` policies and the realtime publication (`conversations`, `messages`, `notifications`) did not survive the schema-only seed. No write of any kind was performed against either database.
- **Production usage statistics (read-only):** `pg_stat_user_tables` row estimates, insert/update/delete counters, last-scan timestamps; the 14 active `pg_cron` jobs with their commands; storage buckets; auth-schema triggers. **`track_functions` is off in production**, so RPC call counts do not exist — every RPC verdict rests on code evidence alone.
- **Usage ground truth is code:** `src/` (the SPA — the Capacitor iOS app wraps it; verified zero direct REST references under `ios/`), `functions/` (workers + libs), `scripts/`, `upr-mcp/`, and the test lanes. `supabase/migrations/` counts as **provenance** (where an object was born), never as usage. Docs are orientation, never evidence.
- **Process:** one mapper agent per domain classified every assigned object with an explicit evidence trail; a per-domain **adversarial verifier** then attacked every "dead" claim — name variants, camelCase, dynamically-constructed table names, PostgREST embeds, function bodies, trigger/view definitions, cron commands, realtime publications, `upr-mcp`/scripts/CI callers — before the claim was allowed to stand. 22 claims were overturned and reclassified.
- **Classification precedence** when several labels fit: dead > band-aid > duplicated > used. A "band-aid" or "duplicated" object is still live; the label records the structural fact. Columns with generic names on used tables are counted **uncertain** rather than guessed. Test-only references count as dead with a note — a contract test keeps a signature alive artificially, which is not business usage.

## 2. Verification status — three passes, all complete

Every classification survived three independent passes:

1. **Mapping** — one agent per domain, classifying each object with an explicit evidence trail from application code.
2. **Adversarial verification** — a second agent per domain tried to *refute* every "dead" claim: name variants, camelCase, dynamically-built table names, PostgREST embeds, function bodies, trigger/view definitions, cron commands, realtime publications, `upr-mcp`/scripts/CI callers. **22 claims were overturned.**
3. **Non-app-code blind-spot sweep** — prompted by the billing verifier's discovery that code-only checking has a systematic gap. Four surfaces keep objects alive invisibly: (1) repo-root and `docs/` runbooks *executed* against production (`UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md` carries the canonical `INSERT INTO invoices` the owner runs by hand); (2) recent data-repair migrations that are *writes*, not just DDL (`20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql`, two days before this map); (3) `UPR-Web-Context.md` annotations naming **external** consumers this repository cannot inspect (line 669: `vendor_invoices` "also used by Netlify vendor app"); (4) doc-designated computation contracts whose callers are unobservable because `track_functions` is off in production (`get_commissions` — "the one place commissions are ever computed"). **A further 38 claims were reclassified**, on top of billing's 21 from the pass that discovered the gap.

**Net effect of pass 3:** dead tables 23 → 18, dead columns 306 → 268, dead RPCs 32 → 17, dead policies 34 → 33. Reclassification rates varied by domain in a way that makes sense — scheduling 15 (a fossil ring the owner had explicitly ruled "keep dormant"), messaging 11, billing 21, but **CRM 0 of 24**, because its dead set is genuinely un-shipped product rather than operational surface the owner touches by hand.

**What "uncertain" means here.** 15 RPCs, 5 tables and 92 columns now sit in an honest uncertain bucket rather than on a kill list. Most resolve with a single owner answer — see §7's question 17, which names the objects whose only possible callers live outside this repository.

**Still true:** these lists are a **review queue, not a kill list.** Pass 3 also produced **55 kill-notes** — dependencies a future `DROP` must carry so P5 does not break something live. See §8.

## 3. Prerequisite state, and one correction

`docs/schema-v2-plan.md` §1 requires a committed `db/baseline/schema.sql` before P0. **It exists and the prerequisite is met.** Commit `8e1cf9cc` ("db: commit production schema baseline (DR + local replay seed)"), 2026-07-28 23:43 — 1,218,319 bytes, produced by `pg_dump 18.4` against PostgreSQL 17.6, containing 141 tables, 400 functions, 219 public policies and 13 custom types. Those numbers match this map's independently-extracted catalog exactly, which is a useful cross-check in both directions: the baseline is complete, and the extraction is faithful.

> **Correction (2026-07-29).** Earlier revisions of this section stated the baseline did not exist. That was wrong. The checkout's `origin/dev` reference was stale — pinned at `e54afcce`, 21 commits behind — so a branch-wide search for the file read a snapshot of the repository that predated the baseline commit and returned nothing. The stale ref was not detected because the search trusted local remote-tracking refs without fetching. Recorded here rather than silently edited, because "verify against the live catalog, never memory" is this map's own method and a stale git ref is the same failure in a different store.

The older `db/baseline/live-schema-snapshot.json` remains in place and is genuinely stale — 125 tables / 332 functions against the live 141 / 400 — so `scripts/db-drift-check.mjs`'s baseline diff (§4) reports drift against it, not against `schema.sql`. Refreshing that snapshot is the small remaining follow-up; the DR-grade artifact is committed.

Of the §7 refresh checklist: items 1–2 (re-research Anthropic/Supabase guidance) are satisfied by the plan being authored the same day, 2026-07-29; **item 3 is fully met** (staging branch seeded ✓, committed baseline ✓, WIP reduced ✓ on gate day); item 4 (re-read the WIP inventory) is done. **WIP inventory item #12 is complete** and its row should be closed on the next inventory rewrite.

## 4. Provenance — restorable from the repo, not replayable from the ledger

These are two different properties and only one of them is a gap. Measured this session with `scripts/db-drift-check.mjs` against the fresh snapshot (full output: [`provenance-drift-2026-07-29.txt`](provenance-drift-2026-07-29.txt)):

- **Disaster recovery is CLOSED.** `db/baseline/schema.sql` (§3) is a complete `pg_dump` of the live schema committed to the repository. If the project were lost, the schema could be restored from git — all 141 tables, 400 functions, 219 policies and 13 custom types. That was the actual risk, and it no longer exists.
- **Ledger replay is still BROKEN.** **67 of 141 tables** and **87 of 400 functions** have **no `CREATE` statement in any migration.** They exist only because someone ran DDL against the live database before schema-as-code discipline — which is why branch creation died replaying the ledger at entry 4 of 419, and why `supabase start` cannot reconstruct the schema from `supabase/migrations/` alone.
- **The distinction matters practically.** Restoring from the baseline gives you the schema *as it is*, with no history and no way to reason about how any object came to exist or to re-derive it after an edit. Replaying the ledger would give you a schema you can *reason about and evolve*. The baseline is a photograph; the ledger is meant to be the recipe, and the recipe is missing two-thirds of its steps.
- Every one of the 77 objects added since the 2026-07-08 snapshot (14 tables, 63 functions) **is** migration-born. Discipline has held since it was imposed; the debt is entirely historical and is not growing.
- **For v2:** the plan's "CI boots the entire schema from migrations on every PR" makes the broken half structurally impossible to recur — a schema that cannot boot from zero fails the build. The untracked surface enumerated per-domain is exactly what a v1→v2 ETL must treat as source-of-truth-by-inspection rather than source-of-truth-by-history, since for those objects no history exists to consult.

---

## 5. Summary — counts per classification per domain

**Final, after all three verification passes.** Every row sums to the live catalog totals (141 tables / 1,746 columns / 400 RPCs / 223 policies / 52 triggers). **U** = used, **Unc** = uncertain, **De** = dead, **Du** = duplicated, **B** = band-aid.

| Domain | Tables U/Unc/De | Columns U/Unc/De/Du/B | RPCs U/Unc/De/Du/B | Policies U/Unc/De/Du/B | Triggers U/De/Du/B |
|---|---|---|---|---|---|
| Jobs & Claims | 18/0/4 | 221/15/61/2/0 | 65/2/6/0/1 | 5/0/4/6/25 | 12/2/0/1 |
| Scheduling | 11/2/4 | 98/25/52/0/0 | 21/4/2/1/0 | 0/0/10/0/36 | 9/0/0/0 |
| Billing / QBO / Stripe | 11/1/2 | 184/24/38/1/0 | 30/1/3/0/2 | 6/1/2/0/8 | 10/0/0/1 |
| Messaging & Consent | 28/2/4 | 307/19/79/1/0 | 57/4/1/0/1 | 9/0/13/5/14 | 2/0/0/0 |
| CRM & Leads | 29/0/2 | 346/2/15/1/1 | 86/0/5/0/1 | 6/0/2/1/30 | 4/0/0/0 |
| Tech App & Time | 6/0/1 | 83/1/12/0/0 | 26/1/0/0/0 | 1/0/1/0/5 | 2/0/0/0 |
| Auth / Employees / Admin | 12/0/0 | 97/2/2/0/0 | 61/3/0/3/1 | 8/0/0/0/6 | 1/0/0/0 |
| Documents & Storage | 3/0/1 | 43/4/9/1/0 | 12/0/0/0/0 | 2/0/1/1/15 | 8/0/0/0 |
| **TOTAL** | **118/5/18** | **1379/92/268/6/1** | **358/15/17/4/6** | **37/1/33/13/139** | **48/2/0/2** |

### What the totals say

- **18 of 141 tables (13%) are dead**, down from 23 before the blind-spot sweep; 5 more are uncertain pending an owner answer.
- **268 of 1,746 columns (15%) are dead**, of which roughly 170 are dead-by-inheritance from dead tables. A further **92 are honestly uncertain** rather than guessed either way.
- **Only 17 of 400 RPCs are dead** — the sweep more than halved this from 32. Dormant-but-designated contracts (owner-run reconciliation RPCs, CI-executed shape freezes, ops scalpels held for a live open incident) are indistinguishable from dead code when you search application code alone.
- **The policy row is the headline: only 37 of 223 policies (17%) do real authorization work.** 139 are band-aids — overwhelmingly `USING (true)` always-true policies — 34 sit on dead tables, and 13 are redundant duplicate generations. **This is the single worst number in the map** and it matches the live audit's independent count of 146 always-true policies.
- **48 of 52 triggers are used** and doing real work. The trigger layer is the healthiest part of v1.

---

## 6. The ten worst structural problems

Ranked across all domains by severity and blast radius. Each was found with file-level evidence; per-domain detail is in the linked reports. 66 problems were catalogued in total — these are the ten that should shape v2.

### 1. Anonymous read/write reaches live business tables in five domains (severity 5)

The browser-shipped publishable key can, **with no login**, reach production data across:
- `jobs` / `claims` / `job_phase_history` — insert, update, and (via `claims_anon_delete`, whose `NOT is_crm_partner(auth.uid())` predicate passes for anon because `auth.uid()` is NULL) **delete claims** ([jobs](domains/jobs.md));
- `appointments` — full CRUD, the only sched table whose policies still name anon ([sched](domains/sched.md));
- `job_documents` — full CRUD, because the `TO public` CRM-partner policy family passes for anon and the P3 closure only re-scoped the differently-named `anon_*` family ([docs](domains/docs.md));
- `crm_automations` / `crm_automation_runs` — the anon key can create and rewrite automation rules that the live `process-crm-automations` cron then executes ([crm](domains/crm.md));
- `email_campaigns` / `email_campaign_recipients` / `email_campaign_exclusions` — campaign content and **recipient email addresses** readable and writable un-logged-in ([msg](domains/msg.md)).

All are outside the `database-standard.md` §2 allowlist. P3's anon closure treated some as a temporary deferred list and never returned. This is the most urgent finding in the map and is worth fixing in v1 rather than waiting for v2.

### 2. Authorization is decorative: 139 always-true policies plus a 342-overload ungated definer surface (severity 4–5)

Only 17% of policies enforce anything. Simultaneously, ~85 of 88 CRM definers, 68 of 74 jobs definers, and comparable shares elsewhere are `SECURITY DEFINER`, granted to `authenticated`, with **no caller check in the body** — verified by body scan, not inferred. Because definer bypasses RLS, every carefully-written policy predicate (including the CRM-partner carve-outs) is void through the RPC layer. Any logged-in field tech can rewrite pipeline stages, delete sequences, edit audit logs, queue email blasts, or mass-update lead PII. **v2's "least privilege by construction" principle is the direct answer, and this is the strongest argument for the rebuild.**

### 3. Consent truth is fragmented across five stores (severity 5)

One send decision consults `contacts.opt_in_status`/`opt_out_at`/`dnd` (CRM-owned), `sms_consent_log`, `service_sms_consents`, `work_authorization_sms_consents`, **and** a live regex scan of raw `message_provider_events.content` for pending STOP keywords — all inside the 6.7 KB `get_service_sms_consent_status`, with 10-digit phone normalization re-implemented in at least three functions. Worse, the TCPA evidence ledger `sms_consent_log` is **client-mutable**: an always-true ALL policy lets any logged-in session UPDATE or DELETE consent history, and `DevTools.jsx:1533` bulk-deletes from it (production shows 15 deletes). TCPA penalties are per message; this is the highest-consequence modeling debt in the schema. v2 should model one consent-state projection per normalized phone, fed by the evidence tables as append-only events — `service_sms_consent_attestations` (service-role INSERT/SELECT only) is the correct posture to copy.

### 4. Money columns the database owns are written directly by clients (severity 5)

`InvoiceEditor.jsx:301` writes `{status:'draft'}` from the browser on any line edit, and `qbo-invoice.js` writes `'draft'`/`'sent'`/`'saved'`. `update_invoice_paid()` owns `status` per AGENTS.md Rule 15, and the repo's own negative tests list it as forbidden. **Concrete failure:** editing a line on a paid invoice stamps `status='draft'`, and the paid state is misreported until the next payments-table event re-fires the trigger — the editor guard blocks only *locked*, not *paid*. Related: `claim_qbo_event`/`claim_stripe_event` are executable by any authenticated user, who can pre-insert a provider event id so the real webhook dedups to a no-op — a silent payment-recording denial vector.

### 5. `jobs` duplicates the claim's identity across ~12 columns, patched by a sync trigger (severity 4)

`insurance_company`/`insurance_carrier`, `claim_number`, `policy_number`, `date_of_loss`, `address`/`loss_address` (+city/state/zip) and the adjuster fields exist on **both** `jobs` and `claims`. `trg_sync_job_to_claim` one-way-syncs three of them with only-if-unchanged guards while the rest silently drift, and `merge_jobs` must `COALESCE` 30+ columns to survive it. **This is the single biggest normalization win available to v2.**

### 6. Payroll inputs accept caller-supplied identity (severity 4)

`clock_appointment_action`, `admin_clock_out_entry`, `admin_upsert_time_entry`, `delete_time_entry` and `review_time_entry_change_request` authorize via a `p_actor_id`/`p_employee_id` **passed by the caller** and never bound to `auth.uid()`. Employee ids are readable by all staff, so any authenticated session can pass an admin's id and edit, delete or approve hours that feed payroll. `approve_time_entries` has no caller check at all. `auth.uid()` is already available in the same schema (`jte_select_all` uses it) — the fix is mechanical, and it violates AGENTS.md §16 today.

### 7. Two writers for one history table, each carrying half the data (severity 4)

`trg_log_phase_change` (BEFORE UPDATE on `jobs`) inserts a `job_phase_history` row with `duration_hours`, **and** `JobPage.jsx:108`, `Production.jsx:179` and `JobDetailPanel.jsx:38` each insert their own row with `changed_by` on the same phase change. Result: doubled rows, each holding half the fact. Production counters (95 inserts / 81 deletes) are consistent with someone periodically deduplicating by hand.

### 8. Privacy and immutability enforced in the reader, not the database (severity 3–4)

`appointments.is_private` is filtered inside the reader RPCs while RLS is `USING (true)` — a direct `/rest/v1/appointments` select bypasses it entirely, and the live `get_claim_appointments` (3 call sites) returns private appointments unfiltered. Same shape in e-sign: `get_sign_request_by_token` (granted `anon` **and** bare `PUBLIC`) does token-only lookup with no status or `expires_at` predicate and returns job PII; expiry is enforced only in `SignPage.jsx` and the worker. Same shape again in moisture readings: a 10-minute edit window with audit columns exists in `update_reading`/`delete_reading`, but nothing calls them and always-true policies let any client UPDATE/DELETE the rows directly.

### 9. Signed legal PDFs sit on public URLs (severity 4)

The `job-files` bucket is `public=true`, so every object — **including the signed Work Authorizations and Reconstruction Agreements** that `complete_sign_request` writes there — is fetchable by anyone with the link, unauthenticated, indefinitely. Two redundant SELECT policies additionally permit anonymous **listing** of the whole bucket, and `job_files_authenticated_delete` lets any staff session delete any object, including contract evidence. This was deliberately deferred to DB-Foundation P8 (signed URLs), which is unshipped and itself gated on the Tech-v2 H3 cutover.

### 10. Abandoned subsystems are still live, callable schema (severity 2–3)

Six dead scheduling tables (`on_call_schedule`, `schedule_blocks`, `selection_dispatches`, `selection_responses`, `sub_confirmations`, `appointment_dependencies`) retain full anon table grants; a scheduler-v1 fossil ring persists alongside the live dispatch calendar; `job_costs` and `job_assignments` (0 rows ever) lost to hand-logged columns and `appointment_crew`; `contact_tags` never held a row while segments filter a `contacts.tags` jsonb blob; Phase-9 lead scoring shipped **writer-less and reader-less**; the invoice-adjustments feature is stillborn yet its keystone column `adjusted_total` drives every balance formula with no writer. Each is a v2 descope decision, and several are also live anon-exposure surface (see #1).

---

## 7. Open questions — only the owner can answer these

59 questions were raised across the domains; the full lists are at the end of each domain report. These are the ones that **change v2's shape** rather than settle a detail.

### Scope: what belongs in v2 at all

1. **Homebuilding vertical** (`homebuilding_*`, Moroni-only routes) — model it in v2's operational schema, or move it outside?
2. **Multi-org**: every CRM table carries `org_id` and every reporting RPC takes `p_org_id`, but production is one real org. Is multi-tenancy for *customers* a real prospect (the v2 plan assumes `tenant_id` everywhere), or should CRM collapse to single-org and tenancy be modeled only at the plan's level?
3. **Templates/Wizard scheduling**: the 2026-07-03 "hide, keep dormant as future Gantt groundwork" ruling was never executed. Does it stand — and should v2 model templates/plans at all, or is dispatch calendar + `job_tasks` the whole model of record?
4. **`selection_dispatches`/`selection_responses`/`sub_confirmations`/`on_call_schedule`/`schedule_blocks`** — never had code, 0 rows. Console-era experiments to drop, or still-wanted flows?
5. **Equipment & drying documentation**: `equipment_placements` and `moisture_readings` have working UIs and zero production rows. Real future field use worth first-class v2 modeling, or descope?
6. **Bulk SMS**: `Marketing.jsx` still says "Coming in Phase 4b," but you ruled out bulk marketing texts on 2026-07-28. May `campaigns`/`campaign_recipients` and the Marketing SMS tab be retired?
7. **Email-in-conversations** (built, unwired: `conversation-email.js`, `email_reply_token`, 8 email columns on `messages`) — a future v2 should model, or delete? Omni-inbox was killed on gate day.

### Business truth: which representation wins

8. **Deductible source of truth**: `jobs.deductible` (hand-entered) vs `invoices.deductible_amount` (never written)?
9. **Insurance short-pays/adjustments**: `adjusted_total` drives every balance formula but has no writer — is adjusting done in QBO only, or by hand-editing the database?
10. **Per-job costing**: `job_costs` (0 rows) vs hand-logged `jobs.total_*_cost` (also no live writer) — should itemized costing return as a real workflow, or is it dead as a practice?
11. **AR on jobs**: collections now run on invoices, leaving `ar_notes`, `last_followup_date`, `deductible_collected`/`_date` write-orphaned but still rendered as permanently stale data in two tech surfaces. Drop the family?
12. **Lead progress vocabulary**: `inbound_leads.lead_status` (set by CrmCallLog/AdminLeadCenter) runs parallel to the kanban pipeline stage. Is triage-label a real part of your workflow, or should pipeline stage be the only progress field?
13. **Phase history**: should a phase change record `changed_by`, `duration_hours`, or both? Today the trigger and the client each write half.
14. **Estimate lifecycle**: do "submitted to carrier / denied" remain tracked states (the CRM aging widget assumes them), or is the real lifecycle Draft → pushed-to-QBO → emailed → converted?

### External consumers I cannot see from this repository

15. **`vendor_invoices`** — `UPR-Web-Context.md:669` says "also used by Netlify vendor app," and it holds 8 rows with real vendors and UNPAID statuses. Is vendor-bill tracking done elsewhere now (QBO bills?), and does that external app still read it?
16. **`email_sync_log`** — annotated as written by the "vendor invoice app"; 81 inserts, latest 2026-07-28. What writes it, and does it belong inside the app schema in v2?
17. **`get_commissions`, `get_payroll_summary`, `get_qbo_connection_status`, `get_ad_spend`, `get_contact_addresses`, `get_job_demo_sheets`, `link_contact_to_job`, `upsert_time_entry`, `job_equipment`** — dead from the repository's perspective. Does anything outside the repo call them (a personal script, a spreadsheet, a bookmark, the MCP `upr_rpc` tool, the Supabase dashboard)? **This question is the §2 blind-spot sweep in miniature; answering it converts the largest block of uncertainty into decisions.**
18. **Anon-key writers**: before closing the anon grants on `crm_automations`/`crm_automation_runs` (and the others in problem #1) — does any external tool write those tables with the anon key today?

### Policy decisions v2 must encode

19. **Who sees pay?** Every staff member can currently read every employee's `hourly_rate`, overtime and labor cost (`get_timesheet_entries` family, `jte_select_all`, `time_entry_deletions` snapshots). Intended, or admin/office-only in v2?
20. **Who edits legal text?** Any logged-in employee of any role can rewrite Work Authorization / Reconstruction Agreement templates via Settings → Templates.
21. **Are appointments company-wide visible?** This decides whether v2 keeps documented always-true authenticated reads or scopes them — and how urgently the `appointments` anon closure must be scheduled.
22. **Signed PDFs on public URLs** (problem #9): acceptable short-term, and what priority does the signed-URL work get?
23. **Should the database refuse expired signing tokens?** Today only the page and worker do; an internal caller can complete an expired request.
24. **Retention**: how much history do you actually need for `worker_runs`, `system_events`, `upr_mcp_audit`, `job_phase_history`, `appointment_status_history`?
25. **Unread state**: is one shared unread count per conversation for the whole office the intended behavior, or should v2 model per-employee read state (what the dead `conversation_reads` was for, and what notifications already do)?

---

## 8. Kill-notes — what a future DROP must carry (Phase P5)

The blind-spot sweep produced **55 kill-notes**: objects that survive as genuinely dead, but whose eventual removal has a dependency. Full per-object detail is in each domain report's amendment section. The patterns that matter:

**`merge_jobs()` is the single highest-leverage blocker.** It mechanically sweeps a dozen dead or dying tables by name — `job_costs`, `job_assignments`, `document_requests`, `schedule_blocks`, `selection_dispatches`, `selection_responses`, `sub_confirmations` — and COALESCEs 30+ `jobs` columns including several dead ones (`lead_source_detail`, `lead_tech`). plpgsql resolves relations at execution time, so a `DROP TABLE` without a paired `CREATE OR REPLACE FUNCTION merge_jobs(...)` **in the same migration** makes every job merge throw at runtime. `merge_jobs` is live and user-invoked (`MergeModal.jsx:62`) and is also executed during owner reconciliation work. `merge_contacts` has the same property for `campaign_recipients` and `sub_confirmations`.

**The CI db lane executes objects that look dead.** `get_payroll_summary` is called by `supabase/tests/db_foundation_p6_timezone_rpcs.test.js` with a frozen 12-column assertion; `get_jobs_list` and `save_estimate_lines` are called by `uxq_fb_rpcs`. The lane runs against the seeded `qa-staging` branch on every PR, so dropping any of them reddens CI rather than failing silently.

**The five `rv_*` reporting views project "dead" columns.** `jobs.lead_converted_at` (twice — raw and as `mt_date(...) AS converted_day`), `payments.is_depreciation_release`, `invoices.carrier_name`. `ALTER TABLE ... DROP COLUMN` fails without `CASCADE`, and `CASCADE` would silently take the view and its P6 db-lane test with it.

**Committed rollback blocks reference objects by name.** The four `appointment_dependencies` policies are re-created by name in the ROLLBACK block of `20260708_dbf_p3_anon_policy_closure.sql`. Dropping them makes that rollback un-runnable, so P5 must explicitly supersede it rather than leave a rollback that cannot execute.

**Ordering traps.** `job_checklists.template_id` must go before `checklist_templates` (inbound FK on a live table). `selection_responses` before `selection_dispatches`. Never emit a `DROP POLICY` after its table's `DROP TABLE`. And per `database-standard.md` §3/§6, every one of these is a destructive change needing a `-- destructive-approved:` marker plus a paired rollback — CI enforces both.

**Docs that must change in the same commit.** `docs/generated/schema-overview.md` is regenerated, never hand-edited. `UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md` §8's FK map is a procedure the owner *executes*; dropping `document_requests` removes a delete-blocker it names, so leaving it stale misleads the next operator.

## 9. What P1 should carry forward

- The **five modeling wins** with the clearest payoff: one consent projection per phone (#3), claim-identity normalization off `jobs` (#5), server-derived actor identity everywhere (#6), one writer per history table (#7), and database-enforced privacy/expiry instead of reader-side filtering (#8).
- The **authorization model is the rebuild's main justification** (#1, #2). v2's least-privilege-by-construction principle should be specified as an RLS matrix and a definer-caller-check rule that CI enforces, not prose.
- **Not every v1 problem needs v2 to fix it.** Problem #1 (anonymous write access to live business tables) is a present-tense production exposure. It should be closed in v1 on its own schedule — the strangler-fig plan explicitly keeps v1 running for months, and this map should not become a reason to wait.
