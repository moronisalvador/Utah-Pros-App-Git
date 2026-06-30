# UPR ↔ QuickBooks ↔ Encircle — Reconciliation & Data-Entry Guide
**Audience:** a fresh Claude Code session reconciling UPR (Supabase) against QuickBooks Online (QBO) and Encircle.
**Last updated:** 2026-06-27 (rev 2). Built from two days of reconciliation (April de-inflation, real-job classifier, Tanra Hill import, the Q2 Encircle day-count scan, and a full owner walk-through of the verification sheet).

> Read this **with** `RECONCILIATION-HANDOFF.md` (mission/history) and `CLAUDE.md` (project rules). This file is the **how-to**: the data model, the legitimacy test, the date rules, the import playbook, and the tooling gotchas.

---

## 1. The three systems (and who is the source of truth for what)

| System | Source of truth for | Tooling |
|---|---|---|
| **Encircle** | The **field reality** — did real work happen, on which days, the loss/claim date, photos, scope. **Encircle is the source of truth for whether a job is real.** | `encircle_get_claim`, `encircle_list_claims`, `encircle_list_media`, `encircle_list_notes` |
| **QuickBooks (QBO)** | The **money** — customers, invoices, estimates, payments, and the **invoice date (`TxnDate`)**. | `qbo_query` (read-only SQL), `qbo_get`, `qbo_list_*` |
| **UPR (Supabase)** | The **operational record** — claims, jobs, contacts, invoices mirrored from QBO, scheduling, time. | `upr_sql` (read-only), Supabase `execute_sql` (writes), `upr_rpc`, `upr_select/insert/update` |

**Golden rule:** verify a client across **all three** systems before changing anything. Work **one client at a time**. Check for an existing claim/contact before creating one. Don't "fix" things that aren't broken.

---

## 2. The hierarchy (data model we enforce)

```
CLAIM            — the loss (one address/event). NOT a sale. Has date_of_loss, insurance, encircle_claim_id.
  └── ESTIMATE   — a priced scope (QBO Estimate). May convert to a job/invoice.
        └── JOB  — the work, division-coded: W=water mitigation, M=mold, R=reconstruction, C=contents.
              └── INVOICE — billed work, mirrors a QBO invoice (qbo_invoice_id + qbo_doc_number).
```

- One **claim** can have **multiple jobs** (e.g. water mitigation **and** reconstruction = two jobs, one claim).
- Mitigation and reconstruction are **separate jobs** under the same claim, usually billed on **separate** QBO invoices/estimates (mitigation is often billed to insurance; recon to the customer).
- **Numbers auto-generate** on insert: `CLM-YYMM-NNN`, `INV-NNNNNN`, job `W/M/R/C-YYMM-NNN`. They use the **current** sequence/month, so a backdated record keeps a number whose `YYMM` prefix won't match its real date — **that is expected; the dates are what matter, not the number prefix.** Don't hand-edit the auto-generated `CLM-`/`INV-`/job numbers.
- **Invoice display number = the JOB number, in BOTH systems.** The invoice the UI shows is `qbo_doc_number || invoice_number`. The convention is to set the invoice's **QBO `DocNumber`** *and* UPR **`invoices.qbo_doc_number`** to the **job number** (e.g. `R-2606-009`, `W-2606-022`) so UPR and QBO line up one-to-one. Legacy invoices with numeric QBO DocNumbers (e.g. `1196`, `1264`) should be **renamed to their job number** during reconciliation:
  - QBO: `qbo_update_entity('Invoice', <id>, {"DocNumber": "<job#>"})`
  - UPR: `UPDATE invoices SET qbo_doc_number='<job#>' WHERE qbo_invoice_id='<id>';`
  - One invoice = one job; a split claim (water + recon) has **two** invoices, each numbered to its own job (W-… and R-…).
  - ⚠️ **A job with more than one invoice** (e.g. a **supplement** billed after the first was paid) must **not** have both numbered to the bare job number — that triggers QBO's *Duplicate Document Number* error. The 2nd+ invoice is numbered `job_number-N` (e.g. `R-2604-009-2`); the `qbo-invoice` worker assigns this automatically, so leave each invoice's existing `qbo_doc_number` as-is rather than forcing it back to the bare job number.

---

## 3. Is a job REAL? (the legitimacy test) — **the most important section**

A "real job" = actual multi-day remediation/reconstruction work. An **inspection or unsold estimate is NOT a real job**, even if it has photos or got billed an inspection fee.

**A job is REAL if ANY of these is true:**
1. **Signed work authorization** in UPR (`sign_requests.doc_type IN ('work_auth','recon_agreement')` with `status='signed'`). ← the gate going forward.
2. **Accepted/approved estimate**, or a **QBO invoice for actual work**.
3. **Multi-day work in Encircle** — photos/reports on **≥2 distinct days**.

**A job is NOT real if:**
- Encircle is **empty** (no media) → no work documented → inspection/estimate.
- Encircle media is **all on a single day** → an inspection (even if there are 40 photos). *Real remediation spans multiple days (drying takes days).*
- **Clock-ins alone do NOT count** — techs clock in to go do estimates too, even on jobs that don't sell.
- A single appointment with no return visit.

### How to check (cheap → authoritative)
1. **Cheap UPR proxy (validated against Encircle):** distinct **appointment-days** or **clock-in-days** ≥ 2 ⇒ multi-day ⇒ real. ≤1 ⇒ suspect; verify in Encircle.
   ```sql
   SELECT (SELECT count(DISTINCT date) FROM appointments WHERE job_id=j.id) AS appt_days,
          (SELECT count(DISTINCT clock_in::date) FROM job_time_entries WHERE job_id=j.id) AS clockin_days
   FROM jobs j WHERE j.id = '<job>';
   ```
2. **Authoritative (Encircle Activity page):** the **Activity tab** in the Encircle web app is the **ground truth** for multi-day work — it groups every event (photos, notes, moisture, sketches, contents) by **Day 1 / Day 2 / …** with author + time. Direct URL (skips the overview click):
   `https://encircleapp.com/app/property-claims/claim/{id}/activity`
   The public API has **no activity endpoint** (404), so reconstruct it from `encircle_list_media` + `encircle_list_notes`.
3. **API day-count (bulk, deterministic):** `encircle_list_media(claim_id, limit=100)` → count **distinct `primary_client_created` calendar days** with `jq`. Big results overflow to a file (jq that path); small ones return inline.
   ```
   jq -r '.list[].primary_client_created' FILE | cut -dT -f1 | sort -u | wc -l   # distinct work-days
   jq -r '.list[].primary_client_created' FILE | sort | uniq -c | sort -rn | head -1   # collapse check (max items @ one timestamp)
   ```

> ### ⚠️ The media API lies about dates on re-pushed claims — TRUST THE ACTIVITY PAGE
> - **Timestamp collapse:** when UPR re-syncs/re-pushes a claim, the media endpoint reports the **bulk re-sync time**, not the real capture time — dozens of photos share **one identical `primary_client_created`** (e.g. Matterhorn's photos were taken Apr 7 but the API says Apr 9, all at the same second). A high `max_burst` (many items at one timestamp) = collapsed = the day-count is unreliable (can merge several real days into one).
> - **100-photo cap:** `encircle_list_media` returns ≤100 and the cursor isn't exposed — big claims **truncate**, hiding later days.
> - Both failure modes only ever **undercount** days. So the rule is directional: **≥2 clean days (low burst) ⇒ real, trustworthy**; **exactly 1 day, or 2-with-heavy-collapse, or truncated ⇒ ambiguous → open the Activity page.**

> ### ⚠️ Multi-day photos are NECESSARY but NOT SUFFICIENT — the owner's verdict is final
> A multi-day photo spread can still be a **multi-day inspection or a multi-day *sales attempt*** (Laksnie Bunnirth = "tried to sell for a few days"; Grant Erickson/Page Vorwlaer = 2 clean days but inspection only). Encircle is the source of truth for *whether work happened*, but the day-count alone **cannot** distinguish work from repeated visits. For anything uncertain, give the owner a sheet (Encircle Activity link + appt/clock-in days + QBO $) and let them call it. **Never auto-promote on day-count alone.**
>
> Conversely, a **real job can have ~1 Encircle day or none** — a recon-only job sold on a signed work-auth (Kate Dalton), or work documented poorly. Use the §3 criteria (work-auth / invoice), not photos alone.

- **Moisture/Hydro readings** (`/v2/property_claims/{id}/material_readings`, `/affected_atmosphere_readings`) would be the strongest multi-day signal (daily drying logs) — but the endpoints, while live, are **empty** for our claims (the team doesn't log Hydro). Don't rely on them yet.
- ⚠️ Media lists are large; pulling them for many claims blows context. For a fleet scan, **delegate to subagents** that run the `jq` day-count and return only a compact table (claim_id, days, total, max_burst, truncated) — never have an agent *interpret* photo contents (that's where they err); keep it to mechanical timestamp counting.

### Recon/contents caveat
Reconstruction is multi-day by nature but often isn't tracked via UPR appointments/clock-ins or Encircle. Treat an **R-** job as real if it's **contracted/invoiced** (QBO invoice or accepted estimate), not by the photo-day test.

---

## 4. The date-correction rule (de-inflate the reports)

Imports stamped many old claims/jobs with the **import date** (e.g. a single 2026-04-19 batch held 8 months of history → April showed 63 claims, really ~25). Fix dates to the **true oldest** date.

**Priority (oldest/most-trusted wins):** `date_of_loss` → Encircle `date_claim_created` → QBO `TxnDate` → existing older UPR date.

- **Claims/jobs `created_at`:** set to `date_of_loss` (or Encircle date) **at noon** to avoid timezone day-slip:
  ```sql
  UPDATE claims SET created_at = (date_of_loss + time '12:00') AT TIME ZONE 'UTC'
  WHERE created_at::date='2026-04-19' AND date_of_loss IS NOT NULL;   -- scope by the IMPORT DAY, not claim_id
  ```
  ⚠️ Scope by `created_at::date = '<import day>'`, **NOT** by `claim_id` — later genuine work (recon added months after) lives under the same claim on other days and must keep its real date.
- **Invoice dates:** the UPR `invoice_date` must equal the QBO **`TxnDate`** — QBO is the source of truth. Verify, don't fabricate. (June revenue matched QBO `TxnDate` exactly — it was *real* late-billed old work, not a date bug.)
- **Backfill `jobs.encircle_created_at`** from Encircle `date_claim_created` while you're there (it was NULL on all imported jobs).

**Which dashboard tiles read what** (so you fix the right thing):
- **Revenue / Avg ticket** → `invoices.invoice_date` (NOT `created_at`). Fix invoice dates to de-inflate revenue.
- **New claims booked** → `claims.created_at`, **and now only counts claims with a real job** (see §6). Fix claim dates + real-job flags.

---

## 5. Duplicates & test data

- **UPR re-pushed old claims into Encircle**, creating **new Encircle IDs on old losses** ("old claims rising to the top of the Encircle list"). A fresh-range Encircle ID on an old loss = a re-push duplicate.
- Detect: same `encircle_claim_id` on two UPR claims; same normalized `loss_address`; an empty-Encircle claim that mirrors a populated one.

### The "empty re-push duplicate" pattern (seen 5× — Stucki, Greg, Stuart, Julia Grant, A2Z Southgate)
The re-push creates a **fresh, EMPTY Encircle claim** (0 media, `date_claim_created` recent) **tagged with our CLM#** in `contractor_identifier`, while the **real field photos stay in the ORIGINAL Encircle claim** (often with no/old CLM tag). UPR frequently links to the **empty** one. Resolution **(do NOT merge inside Encircle — just fix the UPR link, then the owner deletes the empty Encircle claim)**:
1. Find both Encircle claims (`encircle_list_claims(policyholder_name=…)`); confirm which is populated via `encircle_list_media` (the one with photos = keep).
2. Re-point UPR **claim + every job** from the empty id → the populated id:
   ```sql
   UPDATE claims SET encircle_claim_id='<real>', encircle_synced_at=now() WHERE id='<claim>';
   UPDATE jobs   SET encircle_claim_id='<real>' WHERE claim_id='<claim>';   -- watch the (encircle_claim_id, division) UNIQUE constraint
   ```
3. Tell the owner the **empty** Encircle id(s) are safe to delete (nothing in UPR references them anymore). Give a direct link.

### Two UPR claims for ONE loss (duplicate-claim merge — A2Z Southgate)
Sometimes the same loss exists as **two UPR claims** — one with the real Encircle link + jobs but no billing, one with the empty link but the invoices. **Merge** (owner-confirm first — it deletes a claim that holds invoices):
1. **Move the invoices** onto the surviving claim's matching-division jobs (`UPDATE invoices SET job_id=…, qbo_doc_number='<new job#>'`) and rename the **QBO `DocNumber`** to match (`qbo_update_entity('Invoice', id, {DocNumber})`).
2. Promote the surviving claim's jobs to real; delete the now-invoice-less duplicate (system_events → jobs → claim).
3. A multi-unit property manager (e.g. A2Z, formerly **Presidio Property Management** — search **both** names) can have **several real losses at one address** on different dates — don't collapse genuinely distinct losses; only merge the true duplicate.

- **Test data:** the office address **`1055 N State St`** and contacts like "Test", "Mr", "123 Test St", `TEST-RPC-1`, "RPC smoke test", or staff names are training/test artifacts — safe to delete (verify no real billing first). One real claim (Stuart Hernandez) was a *real* job wearing smoke-test placeholders (`123 Test St` / `TEST-RPC-1`) pointing at a **non-existent** Encircle id — fixed the data to the real Encircle claim, didn't delete. Verify a same-address claim isn't a *real* mis-addressed job first (Angela Duty's real job was mis-stamped with the office address — fixed the address, didn't delete).

---

## 6. The real-job classifier (what's built in UPR)

- **`jobs.is_real_job` (bool)**, `jobs.real_job_source` (`work_auth`|`invoice`|`estimate`|`manual`|`verified`|`backfill`|`encircle:*`), `jobs.real_job_marked_at`.
- **Triggers** auto-set `is_real_job=true`: `invoice_real_job` (invoice insert), signed `work_auth`, accepted estimate. They never auto-clear; **manual override wins**.
- **Dashboard:** `get_real_claims_created(p_start)` and `useNewClaims` count only claims with ≥1 real job. Estimates stay in the **Open estimates** tile.
- **Manual toggle** lives on the Job page (`src/pages/JobPage.jsx`).
- Migration: `supabase/migrations/20260627_real_job_classification.sql`.

---

## 7. Importing a client into UPR (the Tanra Hill playbook)

1. **Search all three systems** — never duplicate:
   - UPR: `upr_search('<name>')` (check `contacts` is empty).
   - Encircle: `encircle_list_claims(policyholder_name='<name>')` → get `id`, `date_of_loss`, `date_claim_created`, address, insurer, adjuster.
   - QBO: `qbo_query("SELECT ... FROM Customer WHERE DisplayName LIKE '%<name>%'")`, then `Invoice`/`Estimate WHERE CustomerRef='<id>'`.
2. **Determine correct dates:** loss = Encircle `date_of_loss`; first-work = earliest Encircle photo; invoice = QBO `TxnDate`.
3. **Create contact + claim + first job:** `create_job_with_contact(...)` (one division). For more divisions: `add_related_job(p_source_job_id, p_division, p_invoiced_value, ...)`.
4. **Backdate** (the RPC stamps `created_at = now()`):
   ```sql
   UPDATE claims SET created_at='<loss> 12:00:00+00', encircle_claim_id='<id>', encircle_synced_at=now() WHERE id='<claim>';
   UPDATE jobs   SET created_at='<loss> 12:00:00+00', encircle_claim_id='<id>', encircle_created_at='<loss>' WHERE claim_id='<claim>';
   ```
5. **Mirror the QBO invoice** into `invoices` (one per billed job):
   ```sql
   INSERT INTO invoices (job_id, contact_id, invoice_number, invoice_type, status, subtotal, total, original_total,
     amount_paid, invoice_date, due_date, qbo_invoice_id, qbo_doc_number, qbo_synced_at, carrier_name, claim_number,
     billed_to, insurance_paid, notes, created_at, updated_at)
   VALUES ('<job>','<contact>', generate_invoice_number(), 'standard', '<status>', <subtotal>, <total>, <total>,
     <total - balance>, '<TxnDate>', '<DueDate>', '<qbo Id>', '<DocNumber>', now(), '<carrier>', '<CLM>',
     'insurance', <insurance_paid>, '<note>', '<TxnDate> 12:00:00+00', now());
   ```
   - `status`: `paid` / `partially_paid` / `sent` / `draft`. `invoice_type`: `standard`.
   - The `invoice_real_job` trigger flips the job to real on insert.
   - **Number it to the job:** set both QBO `DocNumber` and UPR `qbo_doc_number` to the job number (e.g. `R-2606-009`), not the numeric QBO number — see §2.

### Import gotchas (hit during Tanra Hill)
- `contacts.role` is an enum-checked set: **`homeowner`**, adjuster, subcontractor, property_manager, agent, mortgage_co, tenant, other, vendor, referral_partner, insurance_rep, broker. (Not "customer".)
- `jobs.source` is an enum — `create_job_with_contact` defaults it; don't pass `p_source='encircle'` (invalid). Omit it.
- `invoices.balance_due` is a **generated column** — never insert/update it (it = total − amount_paid).
- Mitigation is frequently **estimated but not invoiced** in QBO (billed to insurance). Check `Estimate`, not just `Invoice` — attach the estimate to the **water (W) job**; only create a UPR invoice if QBO actually has one.

---

## 8. Tooling & environment gotchas

- **`upr_sql`** is read-only (SELECT/WITH only) and **rejects a query that starts with a `--` comment** — put comments after the first keyword or omit them.
- **Writes:** use Supabase **`execute_sql`** (raw SQL). `upr_update` is per-row and can't do column=column or bulk `created_at = date_of_loss`.
- **Encircle API** returns `date_claim_created` (a **date**, not `created_at`); `date_of_loss` is often **defaulted to the creation date** when the tech didn't enter a real one — so "loss = claim-created" usually means *unknown*, not a real same-day loss. Media is verbose and unsorted.
- **MCP connector** drops/reconnects mid-session and sometimes returns `"requires approval"` transiently — **retry**; if persistent, the user re-connects. A write that errors mid-transaction **rolls back** (verify state before re-running).
- **Deletes & FKs:** `claims→jobs` is `ON DELETE SET NULL` (deleting a claim orphans its jobs, doesn't delete them). Most `job→child` FKs CASCADE, **but** `system_events`, `payments`, `conversations`, `document_requests`, `notification_queue`, `sub_confirmations`, `vendor_invoices` are `NO ACTION` and block a job delete. Order: delete `job_documents` + `job_tasks` first (their AFTER-DELETE triggers log a `document.deleted` event into `system_events`), **then** `system_events` for the job, **then** the job, **then** the claim.
- **UPDATE triggers are column-conditional:** `trigger_claim_events` / `trigger_job_events` only log on status/phase/carrier/value changes; `sync_job_to_claim` only on insurance/date/address changes. **Changing only `created_at` / `encircle_claim_id` fires no events** — bulk backdates are quiet (just `updated_at` bumps).
- **`contacts.phone` is `NOT NULL` *and* `UNIQUE`** — a phone-less contact can't be `null` or a second `''`. `create_job_with_contact` will 409 on a duplicate empty phone. Pass a short unique placeholder (the data already uses `'+'`, `'+1'`, `'+2'`…) and note "fill real number later".
- **`jobs` has a `UNIQUE (encircle_claim_id, division)`** — two jobs of the same division can't share an Encircle id. When re-linking duplicates, this blocks the collision (it's the guardrail that surfaces the dup). A split claim (W + R) is fine; two W jobs on one Encircle id is not.
- **QBO has no exposed "void" op** — `qbo_delete_invoice` **deletes** (guarded: refuses if a payment is applied — re-link/delete payments first). For an erroneous, unpaid invoice ("Ben did it wrong, never sold"), delete it + delete the UPR `invoices` row. If the owner truly needs a QBO *void* (zero-but-keep for audit), zero the lines via `qbo_update_invoice` instead.
- **`encircle_list_media` output is huge** and overflows to a file (path in the error) — `jq` that file; never read it into context raw. The `after` cursor isn't exposed, and `source` is a media-type filter, not pagination — so you can't page past 100 with this tool (use the Activity page for the full timeline).
- **MCP server names drift** mid-session (`UPR_systems` ↔ `UPR_MCP`) and tools disconnect/reconnect — when a tool 404s as "no such tool", re-`ToolSearch` for it under the current prefix.

---

## 9. The reconciliation loop (run this for every client)

1. **Find** the client in UPR, Encircle, QBO.
2. **Verify** the loss date (Encircle), the work (multi-day photos), the money (QBO invoices/estimates, `TxnDate`).
3. **Decide** real vs estimate (§3). Mark `is_real_job` accordingly.
4. **Correct dates** (§4): claim/job `created_at` → true loss date; invoice `invoice_date` → QBO `TxnDate`.
5. **Link** every invoice → job → claim (no orphans — see open items).
6. **Dedupe / clean** test data (§5).
7. **Preview** writes, change one client at a time, report honestly.

---

## 10. Known open items (as of 2026-06-27 rev 2)

**Done in this pass (don't redo):** all 5 orphan invoices linked (Sarah Garcia, Stuart Hernandez, April Smith, Virginia Roundy); Q2 Encircle day-count scan run on all ~54 claims; owner verified the whole sheet; promotes/demotes/merges applied (Brandon Hahn, John Sanders, A2Z Southgate merge, Julia Grant re-link+promote → real; Kemble Wright Jun, Jay Jayaseelan → not-real; Emiliano test claim + Jaren Pope erroneous invoice deleted); imports done (Jay—now inspection, Kate Dalton, Tanra Hill).

**Still open:**
- **Owner to delete empty Encircle claims** (UPR no longer references them): `4657796` (Stucki), `4717588` (Greg), `4717590` (Julia Grant), `4717593` (A2Z Southgate). Stuart's `4537046` was a non-existent id (nothing to delete).
- **Phase 5c — invoice re-dating to date_of_loss (NOT done; gated on the owner finishing loss-date reconciliation):** set invoice date = `date_of_loss` on **BOTH** QBO `TxnDate` (`qbo_update_entity('Invoice', id, {TxnDate})`) and UPR `invoices.invoice_date`, so the Revenue widget tracks **sales by when the loss happened**, not when billed. The new **Payments-received** widget (keyed off `payment_date`) is unaffected and already live.
- **Jay Jayaseelan** (CLM-2606-158) is parked as an estimate — homeowner declined, expected to call back in ~2 months. Re-evaluate then.
- **John Sanders** (CLM-2604-051) is now real but his QBO payment isn't mirrored into UPR `invoices` — backfill the invoice row from QBO.
- Cosmetic: a CLM-2604-076 job has `job_number = 'A2Z Properties'` (malformed) instead of a `W-…` number.
