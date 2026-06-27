# Claim → Estimate → Job Hierarchy — Feature Plan

**Status:** Planned — NOT started. Deferred until the June/May QBO↔UPR reconciliation is complete.
**Date:** 2026-06-27
**Build path when started:** feature branch → `dev` (staging) → reviewed `dev → main` PR.

---

## 1. Why

Today an estimate only connects to a claim **indirectly, through a job** (`estimates.job_id → jobs.claim_id`). A pending / pre‑sale estimate has no job, so it has **no claim above it** — it floats on just `contact_id`. That makes the pipeline hard to see and leaves estimates homeless until they're won.

**Desired model (clearer, more standard):**

```
Claim   ← umbrella for the loss / opportunity. NOT a sale, NOT "finished".
  └── Estimate(s)        ← proposals under the claim (a claim may hold several)
          └── converts → Job   ← the won / active production work, under the SAME claim
```

A **claim** holds everything related to the loss from day one. An **estimate** always sits under a claim. When an estimate is won it **converts to a job** under that same claim. This cleanly separates *pipeline* (claim + estimates) from *production* (jobs), and every estimate has a home immediately.

---

## 2. Current state (as-is)

- **`estimates`**: has `contact_id`, `job_id` (nullable), `converted_invoice_id`. **No `claim_id`.**
- **`claims`**: top-level; `claim_number` auto-generated via `generate_claim_number()` (`CLM-YYMM-NNN`).
- **`jobs`**: `claim_id`, `primary_contact_id`; auto `job_number` via `trigger_auto_job_number`.
- **Linkage:** claim → jobs → (estimates + invoices, via `job_id`). A pending estimate links to the contact only.
- **RPCs:** `get_claim_detail`, `get_claim_jobs`, `get_claims_list`, `get_claim_demo_sheets`, `generate_claim_number`, `generate_estimate_number`.
- **UI:** `src/pages/Estimates.jsx`, `src/pages/EstimateEditor.jsx`, `src/components/NewEstimateModal.jsx`, `src/pages/ClaimPage.jsx`, `src/pages/ClaimsList.jsx`, `src/pages/CustomerPage.jsx`.

---

## 3. Target state (to-be)

- **`estimates.claim_id`** (FK → `claims.id`) is the source of truth for which claim an estimate belongs to.
- Every estimate has a claim. Estimate creation selects an existing claim or auto-creates one.
- Convert-to-job sets `jobs.claim_id = estimates.claim_id` — the job stays under the claim.
- Claim detail lists its **estimates** (not only jobs); estimate views show their parent claim.

---

## 4. Schema changes

```sql
ALTER TABLE estimates ADD COLUMN claim_id uuid REFERENCES claims(id);  -- nullable during rollout
CREATE INDEX idx_estimates_claim_id ON estimates(claim_id);
-- LATER (after backfill + code live, only if every estimate is guaranteed a claim):
-- ALTER TABLE estimates ALTER COLUMN claim_id SET NOT NULL;
```

Additive + nullable → safe on the shared prod DB; existing code ignores the new column.

---

## 5. Backfill

```sql
-- (a) Estimates whose job already has a claim:
UPDATE estimates e SET claim_id = j.claim_id
FROM jobs j
WHERE e.job_id = j.id AND j.claim_id IS NOT NULL AND e.claim_id IS NULL;

-- (b) Estimates with no claim (pending, no job): need a claim each — see Open Questions
--     for the grouping rule (one claim per estimate vs. group by contact/property).
```

Note: the current **reconciliation already creates a claim per imported estimate** (e.g., Ariel Calvo → `CLM-2606-154`), so recent estimates are covered. The backfill mainly addresses older pending estimates.

Verify afterward: `SELECT count(*) FROM estimates WHERE claim_id IS NULL;` → expected 0 before enforcing NOT NULL.

---

## 6. DB functions / RPCs

- **`get_claim_detail` / `get_claim_jobs`** (or a new `get_claim_estimates`): return an estimates section keyed on `estimates.claim_id`, so a claim shows its estimates even with zero jobs.
- **Estimate-create path:** set `claim_id` (auto-create a claim when none is chosen — reuse `generate_claim_number()` default).
- **Convert-to-job path:** when an estimate becomes a job, set `job.claim_id = estimate.claim_id`.

---

## 7. App / UI changes

- **Estimate creation** (`NewEstimateModal.jsx`, `EstimateEditor.jsx`): choose an existing claim or create a new one; persist `claim_id`.
- **Convert-to-job:** carry the estimate's `claim_id` onto the new job.
- **Claim page** (`ClaimPage.jsx`): list estimates under the claim (alongside jobs).
- **Estimates list** (`Estimates.jsx`): surface the parent claim number.
- **Customer page** (`CustomerPage.jsx`): group estimates under their claims.

---

## 8. QBO sync

- `functions/api/qbo-invoice.js` derives the claim from `job.claim_id` — **unaffected**.
- `functions/api/qbo-estimate.js`: currently has no claim context for a pending estimate; with `estimates.claim_id` it can put the claim number in the estimate memo/note. Review + update.
- No change to QBO customer/estimate identity mapping.

---

## 9. Migration & deploy sequencing (shared prod DB — critical)

One Supabase project serves both `dev` and `main`, so DB changes hit both immediately. Sequence:

1. **Schema add** (nullable `claim_id` + index) — additive, inert until code uses it.
2. **Backfill** `claim_id`.
3. **Deploy app code** that reads/writes `claim_id` (feature branch → `dev` → reviewed `dev → main`).
4. **(Optional)** enforce `claim_id NOT NULL` only after the backfill is verified complete and the code is live in production.

---

## 10. Rollback

- **Code:** revert the `dev → main` merge; Cloudflare redeploys.
- **Schema:** `claim_id` is nullable/additive — safe to leave in place; or `DROP COLUMN claim_id` once no live code references it.

---

## 11. Testing / acceptance criteria

- [ ] A new estimate is created with a claim above it (`claim_id` set).
- [ ] One claim can hold multiple estimates.
- [ ] Converting an estimate to a job puts the job under the same claim.
- [ ] Claim page lists its estimates, including pending (job-less) ones.
- [ ] Existing estimates still display correctly after backfill.
- [ ] QBO estimate + invoice sync behave exactly as before.

---

## 12. Open questions / decisions

- Historical pending estimates with no claim: auto-create **one claim per estimate**, or **group by contact + property** into shared claims?
- Enforce `claim_id NOT NULL` eventually, or keep it nullable for flexibility?
- Is a claim ever allowed to span multiple properties, or is it strictly **one claim = one property/loss**? (Drives the backfill grouping rule and the estimate-create UX.)

---

*Reconciliation convention in the meantime:* every estimate processed during the June/May QBO↔UPR reconciliation gets a claim created above it (matching this target model), so the data is already shaped for the feature when it's built.
