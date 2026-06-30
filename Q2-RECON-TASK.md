# Q2 2026 Reconciliation — Open To-Do (DO NOT LOSE)

**Owner:** Moroni Salvador · **Scope:** Q2 2026 (Apr 1 – Jun 30, 2026)
**Three-system reconciliation:** QuickBooks Online (money) ↔ UPR/Supabase (operational) ↔ Encircle (field source of truth)
**Last updated:** 2026-06-30

> This is the running punch list to get Q2 to **100% clean and accurate**. Keep it
> updated; delete an item only when it's truly closed. A2Z alone does NOT finish Q2.

---

## OPEN — mine to do (in suggested order)

1. **A2Z unbilled jobs (4)** — biggest remaining bucket; needs billing decisions.
   - `CLM-2603-024` — water + recon (Encircle 4717589), no address/date
   - `CLM-2605-115` — 550 W 200 S, mold + recon (Encircle 4578927)
   - `CLM-2605-119` — 223 E Hill Ave, Millcreek, mold (Encircle 4588829)
   - `CLM-2604-058` — Southgate, mold job M-2604-034 (Encircle 4517466)

2. **Nelson Chavez (the roofer)** — the big A/R item. QBO invoice **1159** ≈ $176k, ~**$84k open**.
   Bookkeeper reassigning Julia Grant's water/mold/recon (inv **3250**, ~$76k) onto Nelson.
   Until done, Q2 A/R isn't reconciled.

3. **Unapplied payment 4691** ($562.50) — apply/clear it.

4. **Direct-to-Sales deposit sweep (NEW — "Ben pattern")** — the bookkeeper sometimes deposits
   customer checks **straight to the Sales income account without applying them to an invoice**,
   so the job is unbilled/untracked in UPR & QBO even though the cash lands in checking …2227.
   Paul Engman's $10,538.19 (found 6/30) was one. **Action:** scan all Q2 QBO Deposits whose
   lines post to an income account with **no linked Payment**, then for each: create customer →
   invoice → apply payment → relink the deposit → mirror to UPR. (Likely more hidden like Paul.)

5. **Wells Fargo bank rec — METHOD RESOLVED (June ties exactly).** Bank deposits never 1:1 equal
   UPR "payments received"; they **bridge**: UPR payments − in-transit (recorded, not yet
   deposited) − non-customer credits (Moju owner transfers + overdraft credit-line) − May
   float-in = bank. June reconciles to the dollar ($75,388 both sides). This is by design, NOT a
   discrepancy — re-run the bridge per month. (June bank …2227: 21 credits = $86,163.11.)

6. **FINAL Q2 automated sweep** (do LAST) — programmatic proof that every Q2 QBO invoice &
   payment has a matching, correctly-linked UPR record, payment dates match, division totals
   tie to QBO, zero orphans/unapplied. This is the certification step.

---

## OPEN — waiting on bookkeeper / Moroni (NOT mine to close)

- Merge duplicate QBO customers **389 + 452** (Trevor Merrill).
- Reassign Julia Grant's $76k (QBO inv **3250**) to **Nelson Chavez**.
- Delete the 4 empty 6/18 Encircle dup claims — see corrected v2 sheet:
  https://docs.google.com/spreadsheets/d/1ooGOW-snvnmH57ueLPggdb7_JG74D6eukPgl3O_V84E/edit
  (4717590 Julia, 4717591 Brooke, 4717592 Trevor-empty, 4717593 A2Z Southgate; KEEP 4236131).

---

## DONE (for context — do not redo)

- **Trevor Merrill** imported: 2 LOCKED split invoices (water $4,710.44 + recon $19,989.26 = QBO 3559, paid). Re-pointed Encircle → real 4236131; deleted dup claim CLM-2604-087.
- **Dave Bevan** reconciled: combined QBO inv 4196 (water $5,385.26 + recon $4,112.54) + $1,000 deductible (3969) imported as LOCKED rows; created recon job R-2603-011; deleted junk "26-2" job. Remodel (4704) already correct.
- **Remodeling reporting fix**: reclassified 4 remodel jobs `reconstruction→remodeling`; split Virginia Roundy remodel to R-2604-260; repointed her misrouted payment. Dashboard Remodeling now Revenue $31,828.66 / Payments $22,638.81 / Avg $6,365.73 (was $0).
- **Remodeling UI**: already in `main` (prior rollout); PR **#154** completed the tech-app color gap (merged).
- **Tanra Hill** payment-trigger regression fixed & verified; mitigation invoice W-2606-022 payment recorded.
- **Paul Engman** mitigation reconciled (found 6/30 via the WF bank cross-check): his $10,538.19 State Farm check had been deposited straight to Sales (QBO Deposit 5555, no invoice). Created QBO invoice **26-20** + payment 5604, relinked Deposit 5555 to the payment (income counted once, stays in …2227); consolidated onto his EXISTING records (contact qbo 567→**579**, claim **CLM-2603-002**, water job **"26-20"**, Encircle **4422148**, real phone/email) and deleted the duplicate customer/contact/claim/job first created under the "Engemann" spelling. Recon job **R-2604-024** still open (separate scope).
