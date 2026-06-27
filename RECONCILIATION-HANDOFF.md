# UPR Reconciliation — Session Handoff
**Date:** 2026-06-27
**Author of work so far:** Claude Code session `vigilant-davinci-m2ds35`
**Branch:** `claude/vigilant-davinci-m2ds35` · **Draft PR:** #114
**Who continues this:** a fresh Claude Code session (prompt in §9)

> This document is the single source of truth for the QBO ↔ UPR ↔ Encircle
> reconciliation. Read it top to bottom before touching anything. The live
> work-lists in §5 are a snapshot — regenerate them with `upr_sql` at the start
> of the next session so you're working from current data.

---

## 1. The mission (what we're trying to do)

Go through **every invoice and estimate**, one client at a time, and make sure
each one lines up correctly across the three systems and is attached to the right
**claim → job/estimate → invoice** chain:

- **QuickBooks Online (QBO)** — the money: customers, invoices, estimates, payments.
- **UPR (Supabase)** — the operational system: claims, jobs, contacts, invoices.
- **Encircle** — the field/claims source of truth: property claims, the true
  date a claim was filed (`created_at`), date of loss, photos, notes.

**Order of work:** finish **June 2026** completely, then go back and do **May 2026**
the same way. Work **one client/invoice at a time** — do not batch blindly.

There are **two** intertwined goals:

1. **Structural reconciliation** — every estimate sits under a claim; every job
   links to its claim and primary contact; every invoice links to the right job
   and to its QBO doc; split invoices are split correctly; mislinked contacts are
   repointed. (Model in §2.)
2. **Date correction (de-inflate the MTD reports)** — the June import stamped a
   lot of **old** claims/jobs/invoices with a **June `created_at`**, which inflated
   the dashboard (Revenue +645%, "New claims booked 19", etc.). Backdate each to
   its **true oldest date**. (Rule in §3.)

---

## 2. The data model we're enforcing

```
CLAIM  (umbrella for the loss — NOT a sale, NOT a finished job)
  └── ESTIMATE  (a priced scope; can be converted into a job)
        └── JOB  (the work; division-coded: W=water, M=mold, R=recon, …)
              └── INVOICE  (billed work; mirrors a QBO invoice)
```

- A **claim** holds everything related to one loss (address, insurance, date of
  loss, the Encircle file). One claim can have **multiple jobs** (e.g. water
  mitigation + reconstruction) and multiple estimates/invoices.
- **Every estimate should have a claim above it.** (Feature plan to enforce this
  in the app: `CLAIM-ESTIMATE-HIERARCHY-PLAN.md` — planned, not built.)
- **Join path for techs/tasks:** `employee → appointment_crew → appointments → tasks`.
- **Two invoice "numbers":** `invoices.invoice_number` (internal `INV-XXXXXX`, on
  all invoices) vs `invoices.qbo_doc_number` (= the job number, what the UI shows
  via `qbo_doc_number || invoice_number`). When you "rename" an invoice to a job
  number, you're setting `qbo_doc_number` and the QBO `DocNumber`.
- **Number generators (DB):** `generate_claim_number()` → `CLM-YYMM-NNN`;
  `generate_invoice_number()` → `INV-NNNNNN`; `generate_job_number(division)` via
  trigger. Let these fire on insert — don't hand-set numbers.
- **Trigger `sync_job_to_claim`** (AFTER UPDATE on `jobs`) only pushes
  insurance/date/address to the claim when those fields **change** — so updating
  only `claim_id` / `primary_contact_id` on a job is safe.

---

## 3. The date-correction rule (critical)

For each claim and job that currently has a June (or wrong) `created_at`, set
`created_at` to the **OLDEST** real date available for that entity, in this order
of trust:

1. **Encircle claim `date_claim_created`** — for anything with an `encircle_claim_id`,
   this is the truest "when the loss/claim actually started." Pull it with
   `encircle_get_claim(<encircle_claim_id>)`. ⚠️ **The live Encircle API returns
   `date_claim_created` (a date), NOT a `created_at` field** — verified 2026-06-27.
   The claim object also has `date_of_loss` and `contractor_identifier` (= our CLM#).
2. **QBO customer created date** — for non-Encircle clients.
3. **QBO invoice / estimate `TxnDate`** — if older than the above.
4. Any existing older UPR date.

> "Whichever is the **older** date prevails." The point is to stop counting old
> work as if it happened in June. When you backdate a claim, backdate its child
> jobs (and, if needed, the invoice) to match.

> ⚠️ **REVISED PRIORITY (verified 2026-06-27 — read this before backdating claims).**
> Live data shows the **claim/job dates are mostly NOT the problem**: June claim
> count is 19 vs May's 17 (normal), and the Encircle June claims sampled
> (`date_claim_created`) genuinely fall in June. The inflated MTD **Revenue** tile
> is driven by **`invoices.invoice_date`** — June = **$122,138** (matches the
> dashboard exactly) vs May's $21,728. So the real de-inflation work is on
> **invoices**: for each June invoice, compare UPR `invoice_date` to its QBO
> `TxnDate` (source of truth) and correct mismatches to the true (older) date.
> Spot-check the 16 Encircle claims by `date_claim_created` too, but expect most to
> already be correct.

**Also backfill `jobs.encircle_created_at`** while you're there — it is currently
**NULL on all 178 Encircle jobs** because the import never persisted it. Set it to
the Encircle `date_claim_created` you pulled. (Root-cause fix for the import worker is in §6.)

---

## 4. What's DONE (this session)

### MCP server — fully built out and **LIVE** (deployed 2026-06-27)
The `upr-mcp` server now has **53 tools** (was ~30). Merged to `main` + `dev` (PR
#114) and **auto-deployed via Cloudflare Workers Builds** (Version `a6c485a8`) —
the live worker is verified to contain the new code. Reconnect the connector if a
session still shows the old 28-tool list.

- **🐛 Root-cause bug fix:** `buildInvoiceLines` emitted QBO `DetailType:
  'SalesItemLine'` (invalid) → fixed to `'SalesItemLineDetail'`. This is what
  broke **every** `qbo_create_invoice` / `qbo_update_invoice` / `qbo_create_estimate`
  all last session (the "failed to parse json object / unsupported property"
  errors) and forced manual QBO work. **It works now.**
- **Encircle** (was 2 read tools → full read+write): `encircle_get_claim`,
  `encircle_list_claims` (searchable), `encircle_list_media`, `_list_notes`,
  `_list_assignments`, `_list_structures`, `_list_rooms`, `_webapp_link`,
  `_update_claim` (write our CLM#/dates back), `_create_claim`, `_create_note`,
  `_assign_user`, `_unassign_user`, + generic `encircle_get` / `encircle_request`.
- **Resend** (email test/troubleshoot): `resend_send_test_email`, `_get_email`,
  `_list_domains`, `_get_domain`, `_verify_domain`, + generic `resend_get` / `resend_request`.
- **Supabase/UPR:** `upr_sql` (read-only raw SQL — **live and working**, backed by
  the `exec_read_sql` function already applied to the DB), `upr_upsert`, plus the
  existing `upr_select/rpc/schema/describe/search/insert/update/delete`.
- **QBO:** added `qbo_send_estimate`; generic `qbo_*_entity` + `qbo_query` cover the rest.

### Database
- **`exec_read_sql()`** applied to Supabase `glsmljpabrwonfiltiqm` (migration
  `supabase/migrations/20260627_exec_read_sql.sql`). Read-only, SELECT/WITH only,
  read-only transaction, 15s timeout, `service_role` only. Powers `upr_sql`.

### June reconciliation — clients completed last session (verified UPR side)
- **Brady Hansen** — `CLM-2606-152` created; jobs `W-2606-019` + `R-2606-006`
  linked to him; recon invoice (was `INV-000039`) renamed to job # `R-2606-006`
  and linked to QBO invoice 5566; payment moved onto the recon invoice.
- **Kevin → A2Z** — Kevin is really a client of **A2Z**. `CLM-2606-153` created;
  jobs/invoices repointed to A2Z; Kevin kept as **POC** for this one claim only;
  property `24 N Southgate`.
- **A2Z invoice 1273 split** — split in QBO into `R-2604-020` (recon, kept the
  $10k) and `W-2604-227` (water mitigation); UPR invoices relinked to the right
  QBO docs so future UPR edits sync.
- **Ariel** — client + `CLM-2606-154` + estimate 1158 created.
- **Desi / PEG** — contact repointed to PEG (QBO customer 522, "PEG Companies -
  The Flats at Riverwoods"); folded into existing `CLM-2606-133` (same loss);
  the redundant `CLM-2606-155` was deleted. (User merged Natalin/Desi in QBO.)

### Partial date work (NEEDS REDO to the §3 rule)
`CLM-2606-152 → 6/18`, `153 → 6/18`, `154 → 6/25` were backdated to **QBO customer
dates**. The user then said to use the **Encircle claim creation date** (older) —
so these still need to be re-backdated to their true oldest date.

---

## 5. Current-state snapshot (live data, 2026-06-27)

### 🚨 ROOT CAUSE FOUND — the inflation is the APRIL bulk import, not June claims
Verified live 2026-06-27:
- **45 claims were created on a single day, 2026-04-19** — all 45 Encircle-linked
  (87 jobs). This is the initial Encircle bulk-import run.
- Their **true loss months span 2025-09 → 2026-04** (1 Sep, 4 Oct, 9 Nov, 5 Dec,
  8 Jan, 5 Feb, 6 Mar, only 7 genuinely Apr). So ~38 old claims are stamped April 19.
- This is why April shows **63 claims** and the MTD/period reports are wrong: eight
  months of history are collapsed onto one import date.
- **May (17) and June (19) claim counts are clean** (0 claims with a loss date
  predating their created month). The separate **June Revenue** inflation ($122,138)
  is an **`invoices.invoice_date`** problem, not a claim-date one.

**Correct fix (bigger than the original June-only plan):**
1. Backdate the **45 April-19 claims + their 87 jobs** `created_at` to the true
   Encircle **`date_claim_created`** (pull per claim via `encircle_get_claim` using
   the job's `encircle_claim_id`; `date_of_loss` is a fallback proxy). Set
   `jobs.encircle_created_at` too.
2. Separately, fix **June (and May) invoice `invoice_date`** against QBO `TxnDate`.
3. Re-check the other months for smaller clusters once the 4/19 batch is corrected.
This must be done in **previewed batches with confirmation** — it writes to ~45
claims + 87 jobs.

Counts (regenerate with `upr_sql`):

| Metric | Value |
|---|---|
| Claims with June `created_at` | **19** |
| Jobs with June `created_at` | **34** |
| June jobs that have an `encircle_claim_id` (real date recoverable) | **16** |
| Total claims / jobs | 120 / 214 |
| Jobs with an `encircle_claim_id` (all-time) | 178 (but `encircle_created_at` is NULL on all) |

### Work-list A — the 16 June jobs WITH an Encircle id (backdate from Encircle first)
For each: `encircle_get_claim(<id>)` → take `date_claim_created` → backdate the job
(and its claim) per §3, and set `jobs.encircle_created_at`. ⚠️ Most of these
sampled as genuinely-June (see §3 revised priority) — verify, don't assume they're all old.

| Job # | encircle_claim_id | UPR created (wrong) |
|---|---|---|
| M-2606-005 | 4751475 | 2026-06-26 |
| M-2606-007 | 4752829 | 2026-06-26 |
| W-2606-001 | 4657796 | 2026-06-02 |
| W-2606-002 | 4662377 | 2026-06-02 |
| W-2606-003 | 4667305 | 2026-06-03 |
| W-2606-004 | 4667412 | 2026-06-03 |
| W-2606-005 | 4667453 | 2026-06-03 |
| W-2606-006 | 4679394 | 2026-06-08 |
| W-2606-007 | 4671310 | 2026-06-09 |
| W-2606-008 | 4677987 | 2026-06-10 |
| W-2606-009 | 4699520 | 2026-06-13 |
| W-2606-010 | 4713729 | 2026-06-17 |
| W-2606-011 | 4713771 | 2026-06-17 |
| W-2606-012 | 4713775 | 2026-06-17 |
| W-2606-013 | 4737218 | 2026-06-23 |
| W-2606-014 | 4739381 | 2026-06-24 |

### Work-list B — the 19 June claims (verify/backdate each)
`132, 133, 134, 135, 136, 137, 141, 142, 143, 144, 145, 146, 147, 148, 150, 151,
152, 153, 154`. (133 = Desi/PEG; 152/153/154 = created this session, see §4.) The
other ~18 June **jobs without** an Encircle id are non-Encircle — backdate those
from the **QBO customer / invoice date** per §3.

---

## 6. What's LEFT to do (ordered)

1. **Deploy + reconnect the MCP** (user action — see §7). Nothing below that needs
   Encircle dates can proceed until this is done. `upr_sql` already works via the
   Supabase MCP in the meantime.
2. **Recover real dates & backdate June** — Work-list A via `encircle_get_claim`,
   then Work-list B; apply the §3 rule to claims + their jobs; backfill
   `encircle_created_at`. Re-do 152/153/154.
3. **Verify the dashboard de-inflates** — find the RPC behind the MTD
   Revenue / Avg-ticket / New-claims-booked tiles (it is **NOT** `get_dashboard_stats`
   — search the Overview dashboard RPCs, e.g. `20260624_overview_dashboard_rpcs.sql`).
   Confirm the numbers drop after backdating.
4. **Finish June structural loose ends:**
   - `INV-000044` stuck in "draft"; `INV-000005` missing a doc #.
   - ~12 jobs with no `claim_id` — attach each to a claim (create the claim if the
     loss has none, after checking for an existing one).
   - Re-scan for jobs not linked to a claim, and claims not linked to a customer.
5. **Fix the import root cause** — `functions/api/encircle-import.js` (and
   `sync-encircle.js`) should persist `encircle_created_at` **and** set the UPR
   `created_at` to the Encircle `date_claim_created`, so future imports don't re-inflate.
   (Add to `CLAIM-ESTIMATE-HIERARCHY-PLAN.md` or a new task file.)
6. **Then May 2026** — same process, one client at a time.

**Parked (approved but not executed):**
- Jaren Pope duplicate-contact merge.
- Sam Hunter "deposit-as-discount" sweep (with Kelly Dewey) — leave Sam Hunter's
  existing mold/water/recon split **as-is**; it was correct. (Do not "fix" it.)

---

## 7. Deploy + reconnect (user steps)

The `upr-mcp` worker is **separate** from the Cloudflare Pages app and deploys
with `wrangler`:

```bash
cd upr-mcp
wrangler secret put ENCIRCLE_API_KEY   # if not already set
wrangler secret put RESEND_API_KEY     # for the resend_* tools (optional)
npm run deploy
```

Then **reconnect the MCP connector** in Claude so the new tool list loads
(`capabilities.tools.listChanged` is false, so clients don't hot-refresh —
a reconnect is required). Existing chat sessions keep working; they just won't see
the new tools until they reconnect too.

---

## 8. Gotchas & lessons (hard-won — read these)

- **One client at a time. Verify in all three systems before changing anything.**
- **Check for an existing claim before creating one.** A redundant claim
  (`CLM-2606-155`) was created last session because an existing Encircle claim
  (`133`) wasn't checked first.
- **Don't act on assumptions after context loss.** A correct Sam Hunter setup was
  nearly broken by "fixing" something that wasn't wrong. If unsure, ask.
- **`db.rpc()` / `upr_rpc` are the reliable write path** for new tables; PostgREST
  can silently return `[]`. For service-role inserts that no-op'd last session,
  prefer `upr_rpc`/`upr_sql` verification, or the Supabase MCP `execute_sql`.
- **Every MCP write previews unless `confirm: true`.** Read the preview first.
- **`received_date` ≈ import date** (useless as a real date). Use Encircle
  `created_at`.
- **Shared Supabase** serves dev + prod. DB changes hit both. `exec_read_sql` is
  read-only so it's safe, but sequence any *data* changes carefully.
- **Never push to `main` directly**; ship via PR. Develop on the feature branch.

---

## 9. Fresh-session prompt (copy-paste to start the next session)

```
We're continuing the QBO ↔ UPR (Supabase) ↔ Encircle reconciliation. Read
RECONCILIATION-HANDOFF.md in the repo root first — it has the full mission, data
model, the date-correction rule, what's done, and the work-lists. Then read
CLAUDE.md for project rules.

Context: the UPR MCP is live with 53 tools (encircle_get_claim, upr_sql, the QBO
tools, etc.). Verified 2026-06-27: the inflated MTD Revenue tile is driven by
invoices.invoice_date (June = $122,138), NOT by claim/job dates (June claim count
19 ≈ May 17, and the Encircle June claims are genuinely June). So invoices are the
main target. Also: the Encircle API returns date_claim_created, NOT created_at.

Today's job, in order:
1. De-inflate June REVENUE (the real problem). Pull the June invoices
   (upr_sql on invoices where invoice_date in June, with job/claim + qbo_doc_number),
   and for each compare UPR invoice_date to its QBO TxnDate (qbo_query / qbo_get,
   source of truth). Where they differ, correct UPR invoice_date to the true (older)
   date via upr_update. Preview in small batches before confirming.
2. Spot-check claim/job dates. For the 16 June jobs with an encircle_claim_id
   (Work-list A), call encircle_get_claim, read date_claim_created, and backdate the
   job + claim only where Encircle is older than UPR. Set jobs.encircle_created_at.
   Then the non-Encircle June jobs (Work-list B) from QBO dates. Expect few changes.
3. Find the RPC behind the MTD dashboard tiles (Revenue / Avg ticket / New claims
   booked — it's NOT get_dashboard_stats) and confirm the numbers drop after the fixes.
4. Finish June structural loose ends (INV-000044 draft, INV-000005 missing doc#,
   ~12 jobs with no claim_id, any jobs not linked to a claim / claims not linked
   to a customer).
5. Then start May 2026, same process.

Work ONE client/invoice at a time, verify across all three systems before
changing anything, check for an existing claim before creating one, and don't
"fix" things that aren't broken (e.g. Sam Hunter's split is correct — leave it).
Use upr_sql to regenerate the live work-lists since the handoff snapshot may be
stale.
```

---

*Generated by the `vigilant-davinci-m2ds35` session. The MCP code + this doc are
on branch `claude/vigilant-davinci-m2ds35` (PR #114).*
