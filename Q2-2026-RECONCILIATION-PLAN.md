# Q2 2026 Reconciliation Plan — UPR ↔ Encircle ↔ QuickBooks
**Created:** 2026-06-27 · **For:** tomorrow's session (and beyond) · **Owner:** Moroni + Claude
**Read first:** `UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md` (the how-to), `RECONCILIATION-HANDOFF.md` (history), `CLAUDE.md` (rules).

---

## 0. Objective & definition of done

Make **UPR match Encircle (field truth) and QuickBooks (money) perfectly for Q2 2026 (April 1 – June 30)** so the dashboard reports are accurate.

**Done when, for Q2:**
1. **Every real job is confirmed against Encircle** (work on **≥2 distinct days**) or is a contracted recon job (QBO invoice / accepted estimate). Inspections/estimates are marked, not counted.
2. **Every QBO invoice (TxnDate in Q2) is mirrored in UPR**, linked to a job → claim, with `invoice_date = QBO TxnDate` and matching totals/balance.
3. **Every Encircle claim (work in Q2) exists in UPR** with the correct loss date.
4. **Every UPR claim/job is correctly dated** (`created_at` = true loss date) — no import inflation.
5. **No orphans** (every invoice has a job + claim) and **no duplicates / test data**.
6. Dashboard **New claims booked / Revenue / Avg ticket** reconcile to the verified real numbers.

---

## 1. Current state (already done — don't redo)

- ✅ **April 4/19 import batch backdated** to real loss months (April claims 63 → 25; Sept 2025–Mar 2026 history restored to correct months). Rollback saved.
- ✅ **Test/junk claims deleted** (Moroni/"Mr"/"Test" at office address 1055 N State St; June Test); Angela Duty re-addressed to 1801 Fort Canyon Rd.
- ✅ **Real-job classifier built & live on `main`** (PR #117): `jobs.is_real_job` + triggers (signed work_auth / invoice / approved estimate) + manual toggle + `get_real_claims_created`. Migration `20260627_real_job_classification.sql`.
- ✅ **Q2 real-job pass applied via the multi-day PROXY** (appt-days/clock-in-days ≥2): real claims **April 8 · May 10 · June 12 = 30**. *(Proxy only — Phase 3 replaces it with authoritative Encircle verification.)*
- ✅ **Tanra Hill fully imported** end-to-end (claim CLM-2606-157 dated 2025-09-30, water + recon jobs, recon invoice 1196 mirrored, mitigation estimate 1065 converted to QBO invoice 5582 and mirrored). **Use her as the template.**
- ✅ **Reconciliation guide** written (`UPR-QBO-ENCIRCLE-RECONCILIATION-GUIDE.md`).

**Known gaps to fix (sized):** 5 invoices with no claim; 25 Q2 jobs with no Encircle link; the proxy-based real flags need Encircle confirmation; clients can be **entirely missing** from UPR (Tanra was).

---

## 2. The approach: a Q2 three-way master ledger

Reconciliation = build **one row per real loss/job** and confirm it exists & agrees in all three systems. Work **one client at a time** down the ledger.

```
Encircle claim (Q2 work)  ──┐
QBO customer + invoices    ─┼─►  UPR claim → job(s) → invoice(s)   ✅ matched & dated
QBO estimates (mitigation) ─┘
```

---

## 3. Phases (run in order)

### Phase 1 — Build the Q2 master lists (read-only, ~30 min)
Produce three lists and diff them:
1. **UPR Q2:** every claim with `created_at` in Apr–Jun (after correction) + its jobs + invoices + `is_real_job` + `encircle_claim_id`.
   ```sql
   SELECT c.claim_number, ct.name, c.created_at::date, c.encircle_claim_id,
          j.job_number, j.division, j.is_real_job, j.real_job_source,
          i.invoice_number, i.qbo_doc_number, i.total, i.invoice_date
   FROM claims c JOIN jobs j ON j.claim_id=c.id LEFT JOIN contacts ct ON ct.id=c.contact_id
   LEFT JOIN invoices i ON i.job_id=j.id
   WHERE c.created_at>='2026-04-01' AND c.created_at<'2026-07-01' ORDER BY ct.name;
   ```
2. **QBO Q2:** every invoice with `TxnDate` in Q2 → customer, DocNumber, TotalAmt, Balance. (`qbo_query`; also pull **estimates** in Q2 — mitigation often lives there.)
3. **Encircle Q2:** `encircle_list_claims` paged, newest first, until `date_claim_created` < 2026-04-01 → policyholder, id, date, address.
**Output:** a worksheet flagging, per client: present-in-UPR? invoice-mirrored? Encircle-linked? dated-right?

### Phase 2 — Find & import MISSING clients (the Tanra pattern)
- Diff Encircle Q2 and QBO Q2 against UPR. Any Encircle claim or QBO invoice with **no UPR claim** = a missing client → import via the **Tanra playbook** (Guide §7): `create_job_with_contact` → `add_related_job` → backdate `created_at`/`encircle_claim_id` → mirror invoice(s).
- ⚠️ Convert **pending mitigation estimates → invoices** where work was done (as we did for Tanra 1065→5582), if Moroni confirms each.

### Phase 3 — Authoritative real-job verification via Encircle (replace the proxy)
Verify **per CLAIM, not per job** (recon inherits the claim's shared Encircle file). For each Q2 claim:
- Take **`claims.encircle_claim_id`** (not the job's — recon jobs often lack a job-level id but the claim has one). Call `encircle_list_media(<claim encircle id>)`; compute distinct `primary_client_created` days.
- **≥2 days ⇒ the whole claim is real** → mark all its jobs (water + recon) real. **Empty or single-day ⇒ inspection** → all its jobs estimate.
- Then push the verdict to `jobs.is_real_job` via `set_job_real_job(...)`, overriding the proxy/auto-classifier where they disagree.
- A claim that is **invoiced/contracted but single-day** in Encircle → **flag for Moroni** (don't silently keep or drop).
- ⚠️ Media is verbose/unsorted — pull per claim, scan dates only.
- ⚠️ **The proxy UNDERCOUNTS the 4/19 import-batch historical jobs** (old losses backdated into April): they were worked months ago and have **no UPR appointments/clock-ins**, so appointment/clock-in-days can't confirm their multi-day work and they read not-real (April currently shows only **4** real claims — almost certainly low). **Verify each against Encircle photos** (multi-day) and mark the real ones. Expect the **April real count to rise** after this pass. The current QTD total (**21** = Apr 4 / May 9 / Jun 8) is a **floor**, not the final number.
- Reconcile each verdict with `is_real_job`; fix mismatches via `set_job_real_job(...)`.
- ⚠️ Media is verbose/unsorted — pull per claim, scan dates only, don't dump in bulk.

### Phase 4 — Date correctness audit
- Confirm every Q2 claim/job `created_at` = true loss date (Encircle `date_of_loss`/`date_claim_created`, else QBO). No record still on an import-batch date.
- Confirm every invoice `invoice_date` = its QBO `TxnDate` (re-check the one June mismatch INV-000042: UPR 6/19 vs QBO 6/26).
- Backfill `jobs.encircle_created_at` for all Encircle-linked Q2 jobs.

### Phase 5 — Linkage, orphans & invoice numbering
- **Number every invoice to its job:** set QBO `DocNumber` **and** UPR `qbo_doc_number` to the **job number** (e.g. `R-2606-009`) so UPR and QBO match one-to-one (Guide §2). Rename the legacy numeric DocNumbers (`1196`, `1248`, `1264`, `1267`, `1274`, `1276`, …) to their job numbers — `qbo_update_entity('Invoice', id, {"DocNumber":"<job#>"})` + UPR `qbo_doc_number`.
- Fix the **5 invoices whose job has no claim** (one client at a time): Sarah Garcia (R-2606-003 + W-2606-016 / QBO 1116), Stuart Hernandez (R-2606-004 / QBO 1264 → his CLM-2604-109), April Smith (M-2606-004 / QBO 1248), Virginia Roundy (W-2606-018 / QBO 1274). Create/link the claim per Encircle+QBO.
- Re-run the audit until **0 invoices without a job+claim** and **0 jobs without a claim**.

### Phase 6 — Dedupe
- Resolve Encircle re-push duplicates and same-address claims (Guide §5). Merge with `merge_claims(keep, merge)` / `merge_jobs`. Verify with Moroni before merging (A2Z has many *legit* separate losses — don't over-merge).

### Phase 7 — Final verification & sign-off
- Re-run `get_real_claims_created` for Apr/May/Jun → confirm the numbers match the Encircle-verified ledger.
- Reconcile UPR Q2 invoice total vs QBO Q2 invoice total (should tie out).
- Spot-check the dashboard tiles (Revenue by `invoice_date`, New claims by real `created_at`).
- Update `RECONCILIATION-HANDOFF.md` and this plan's checklist.

---

## 4. Per-client checklist (the loop — repeat for every client)
- [ ] Found in Encircle (loss date, multi-day work?), QBO (invoices/estimates, TxnDate), UPR.
- [ ] Claim exists in UPR, dated to true loss date, `encircle_claim_id` set.
- [ ] Jobs exist per division (W mitigation, R recon, M mold, C contents), dated right.
- [ ] Each job: real vs estimate decided from **Encircle multi-day** (or contracted recon).
- [ ] Every QBO invoice mirrored in UPR (date = TxnDate, totals/balance match, linked to job).
- [ ] Pending mitigation estimate invoiced if work was done (confirm w/ Moroni).
- [ ] No duplicate/test record left.

---

## 4b. Revenue tile investigation (the "$122K June" puzzle)

The **Revenue recognized · MTD** tile (`get_revenue_by_division`) sums invoices by **`invoice_date`** (billing date). June shows **$122,504**, but by the underlying claim's true loss month that is: **March $40,572 · April $43,234 · May $8,015 · June (actual new work) $14,232 · no-claim orphans $16,451.** So only ~12% is June work — ~75% is **old jobs completed & billed in June** (correct accrual revenue; invoice dates match QBO `TxnDate`), and ~13% is on the 2 orphan invoices.

**Do:**
1. **Link the 2 orphan invoices** (Stuart Hernandez `INV-000035` $15,701 / QBO 1264; Virginia Roundy `INV-000038` $750 / QBO 1274) to claims — they're billing into June revenue with no claim. (Part of Phase 5.)
2. **Verify no duplicate June invoices** (group QBO invoices by job/amount/date).
3. **Decide on a "revenue by work/loss month" view** — add an optional tile/report so the dashboard can show *June-produced* revenue (~$14K) next to *June-billed* revenue ($122K). This is the number that matches "June was slow." Code change → `dev → main` PR.
4. Confirm with Moroni that **billing-date revenue is the intended definition** for the main tile (it's standard), with the work-month view as the secondary lens.

## 5. Decisions (locked with Moroni — 2026-06-27)
1. **Q2 scope = by LOSS DATE.** A claim/job belongs to Q2 if the loss/work occurred **Apr 1 – Jun 30**. Invoices keep their real QBO `TxnDate` (revenue lands in the month billed).
2. **Missing clients = LIST FIRST.** Build the full list of Encircle/QBO records with no UPR match, Moroni reviews, then import the approved ones via the Tanra playbook (§Phase 2).
3. **Mitigation estimates = CASE-BY-CASE.** Flag each pending mitigation estimate with the Encircle evidence that work was done; Moroni confirms; convert + mirror the approved ones (like Tanra 1065→5582).
4. **Real job = ENCIRCLE MULTI-DAY PROOF — verified at the CLAIM level.** A claim is real if its **Encircle file** (referenced by `claims.encircle_claim_id`) has photos on **≥2 distinct days**, or it has ≥2 days of UPR appointments/clock-ins. **Recon shares the claim's Encircle file with the mitigation** (the multi-day documentation), and **there are no recon-only jobs** — so every recon job inherits its claim's multi-day mitigation proof and never drops for lack of its own photos. If a claim's Encircle file is **empty or single-day**, it's an inspection → not real (a QBO invoice alone is NOT sufficient; flag any contracted-but-single-day claim for Moroni).
   - ⚠️ This is **stricter** than the deployed auto-classifier (which marks real on invoice/work-auth/estimate). The classifier stays as the **going-forward default**; the Q2 reconciliation **overrides it via Encircle verification** and may *lower* counts further (e.g. recon jobs with an invoice but no multi-day Encircle/UPR evidence). It **supersedes Guide §3's "recon = contracted" caveat** for this pass.

---

## 6. Effort estimate
- Phase 1 (lists): ~30 min · Phase 2 (missing imports): depends on count, ~10 min/client · Phase 3 (Encircle verify): the bulk, ~5 min/claim × ~40 claims · Phases 4–5: ~1–2 hr · Phase 6–7: ~1 hr.
- **Realistic: one focused day** for Q2, working the master ledger top to bottom, one client at a time.

---

## 7. Guardrails (from hard-won experience)
- One client at a time; verify across all three systems **before** changing anything.
- **Encircle is the source of truth** for whether work happened (multi-day photos). QBO `TxnDate` is truth for invoice dates.
- Preview every write; back up before bulk changes; don't "fix" what isn't broken (Sam Hunter's split, A2Z's many legit claims).
- Never push `main` directly — ship code via `dev → main` PR. Data changes go through previewed SQL.
