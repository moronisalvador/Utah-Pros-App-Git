# Schema v2 — v1 Usage Map (Phase P0)

**Generated:** 2026-07-29 · code at `dev` @ `576f865a` · Phase **P0** of [`docs/schema-v2-plan.md`](../schema-v2-plan.md)
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

## 2. Verification status — read before acting on the dead list

The dead list is **evidence-backed but not yet decision-ready in full.** Two things qualify it:

1. **The billing verifier found a systemic blind spot, and it is only closed for billing.** Code-only checking misses objects kept alive by four non-code surfaces: (1) repo-root runbooks *executed* against production (`UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md` contains the canonical `INSERT INTO invoices` an owner runs by hand); (2) recent data-repair migrations that are *writes*, not just DDL (`20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql`, two days before this map); (3) `UPR-Web-Context.md` annotations naming **external** consumers this repository cannot see (line 669: `vendor_invoices` "also used by Netlify vendor app"); (4) doc-designated computation contracts whose callers are unobservable because `track_functions` is off (`get_commissions` — "the one place commissions are ever computed"). Re-checking billing against these four surfaces moved **21 of 45** confirmed-dead items to uncertain.
2. **The equivalent sweep for the other seven domains did not run** — it was launched and every agent failed on a session usage limit. So for jobs, scheduling, messaging, CRM, tech, auth and documents, the dead lists are *code-verified and adversarially confirmed, but not yet checked against those four surfaces.* Billing's ~47% reclassification rate on one domain is the honest prior for how much might move.

**Consequence:** treat the per-domain dead lists as a **review queue, not a kill list.** The sweep is one bounded session (7 agents, four named surfaces, method in [`domains/billing.md`](domains/billing.md)) and should run before anything is dropped in P5.

## 3. Prerequisite deviations from the plan, disclosed

`docs/schema-v2-plan.md` §1 requires a committed `db/baseline/schema.sql` before P0. **It does not exist.** Only `db/baseline/live-schema-snapshot.json` does, and it was stale — 125 tables / 332 functions against the live 141 / 400. This session's fresh extraction supersedes it for P0 purposes, but the baseline capture (WIP inventory item #12) is still open and still the right next infrastructure step. Of the §7 refresh checklist: items 1–2 (re-research Anthropic/Supabase guidance) are satisfied by the plan being authored the same day, 2026-07-29; item 3 is partially met (staging branch seeded ✓, committed baseline ✗, WIP reduced ✓ on gate day); item 4 (re-read the WIP inventory) is done.

## 4. Provenance headline — the schema cannot rebuild itself

Measured this session with `scripts/db-drift-check.mjs` against the fresh snapshot (full output: [`provenance-drift-2026-07-29.txt`](provenance-drift-2026-07-29.txt)):

- **67 of 141 tables** and **87 of 400 functions** have **no `CREATE` statement in any migration.** They exist only in the live database, born from dashboard or direct DDL before schema-as-code discipline — the same fact that killed the branch-seed ledger replay at entry 4 of 419.
- Every one of the 77 objects added since the 2026-07-08 baseline (14 tables, 63 functions) **is** migration-born. Discipline has held since it was imposed; the debt is entirely historical.
- **For v2:** the plan's "CI boots the entire schema from migrations on every PR" is the structural fix. The untracked surface enumerated per-domain is exactly what a v1→v2 ETL must treat as source-of-truth-by-inspection rather than source-of-truth-by-history.

---

## 5. Summary — counts per classification per domain

Every column sums to the live catalog totals (141 tables / 1,746 columns / 400 RPCs / 223 policies / 52 triggers). **U** = used, **Unc** = uncertain, **De** = dead, **Du** = duplicated, **B** = band-aid.

| Domain | Tables U/De/Du/B | Columns U/Unc/De/Du/B | RPCs U/De/Du/B | Policies U/De/Du/B | Triggers U/De/Du/B |
|---|---|---|---|---|---|
| Jobs & Claims | 18/4/0/0 | 221/12/64/2/0 | 65/8/0/1 | 5/4/6/25 | 12/2/0/1 |
| Scheduling | 11/6/0/0 | 98/16/61/0/0 | 21/6/1/0 | 0/10/0/36 | 9/0/0/0 |
| Billing / QBO / Stripe | 11/3/0/0 | 184/6/56/1/0 | 30/4/0/2 | 6/3/0/8 | 10/0/0/1 |
| Messaging & Consent | 28/6/0/0 | 307/14/84/1/0 | 57/5/0/1 | 9/13/5/14 | 2/0/0/0 |
| CRM & Leads | 29/2/0/0 | 346/2/15/1/1 | 86/5/0/1 | 6/2/1/30 | 4/0/0/0 |
| Tech App & Time | 6/1/0/0 | 83/1/12/0/0 | 26/1/0/0 | 1/1/0/5 | 2/0/0/0 |
| Auth / Employees / Admin | 12/0/0/0 | 97/0/4/0/0 | 61/3/3/1 | 8/0/0/6 | 1/0/0/0 |
| Documents & Storage | 3/1/0/0 | 43/3/10/1/0 | 12/0/0/0 | 2/1/1/15 | 8/0/0/0 |
| **TOTAL** | **118/23/0/0** | **1379/54/306/6/1** | **358/32/4/6** | **37/34/13/139** | **48/2/0/2** |

### What the totals say

- **23 of 141 tables (16%) are dead** — and that is before the §2 sweep, which will move some back to uncertain.
- **306 of 1,746 columns (18%) are dead**, though 190 of those are dead-by-inheritance from dead tables; roughly 116 are individually-dead columns on live tables. Another 54 are honestly **uncertain** rather than guessed.
- **32 of 400 RPCs are dead** — a low share, but the live 358 include 6 band-aids and a very large ungated `SECURITY DEFINER` surface (see §6).
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

## 8. What P1 should carry forward

- The **five modeling wins** with the clearest payoff: one consent projection per phone (#3), claim-identity normalization off `jobs` (#5), server-derived actor identity everywhere (#6), one writer per history table (#7), and database-enforced privacy/expiry instead of reader-side filtering (#8).
- The **authorization model is the rebuild's main justification** (#1, #2). v2's least-privilege-by-construction principle should be specified as an RLS matrix and a definer-caller-check rule that CI enforces, not prose.
- **Not every v1 problem needs v2 to fix it.** Problem #1 (anonymous write access to live business tables) is a present-tense production exposure. It should be closed in v1 on its own schedule — the strangler-fig plan explicitly keeps v1 running for months, and this map should not become a reason to wait.
