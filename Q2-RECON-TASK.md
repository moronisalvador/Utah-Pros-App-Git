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

- **Estimates verified + repaired on mobile PWA (2026-07-07).** Audited the admin-mobile
  invoice/estimate/payment screens for the invoice fixes above. Findings: mobile **invoice view +
  payment recording are solid** (money is header-authoritative; payment insert writes only whitelisted
  columns, never the trigger-owned `amount_paid`/`status`/`paid_at`; QBO mirror synced-only + non-fatal;
  double-submit guarded). But **estimates had the same import gap** — 34 of 37 imported estimates had a
  header `amount` but **no line items**, and the estimate screens compute totals **from lines**, so they
  showed **$0** and the 21 `submitted` couldn't convert. Fixes: (a) backfilled 57 line rows from each
  estimate's QBO source (`scripts/backfill-recon-estimate-lines.sql`, self-asserting `amount` unchanged;
  the −$562.50 deposit kept as a negative line); (b) hardened estimate numbering
  (`supabase/migrations/20260707_harden_estimate_number_generation.sql`: `UNIQUE(estimate_number)` +
  drift-proof `generate_estimate_number()` under an advisory lock — mirrors the invoice/claim fix; it
  wasn't colliding because imports used plain QBO DocNumbers, a separate namespace from `EST-######`).
  Verified: 0 lineless-with-amount, every estimate amount = line sum, next number `EST-001005`.
- **Invoice-number generator hardened + duplicate resolved (2026-07-07).** A new July draft
  (job `W-2607-003`) had been handed `INV-000062` — already used by the reconciliation import —
  because `generate_invoice_number()` drew from `invoice_number_seq`, which the explicit-numbered
  backfills (INV-000049–087) never advanced (real max was 87; the sequence sat ~62, so the next ~25
  new invoices would each collide). Same failure class as the 6/30 claim-number collision. Fix
  (`supabase/migrations/20260707_harden_invoice_number_generation.sql`, mirrors the claim fix):
  renumbered the stray draft → **INV-000088**; added **`UNIQUE(invoices.invoice_number)`**; rewrote
  `generate_invoice_number()` to derive max-suffix+1 from real rows under an advisory lock (sequence
  kept as a synced secondary guard). Verified: 0 duplicate numbers, next number now `INV-000089`.
  (qbo_doc_number intentionally NOT made unique — split/deductible invoices legitimately reuse it.)
- **4 confident-batch invoices had wrong line amounts — corrected (2026-07-07).** INV-000011,
  INV-000029 (a recon+mit split of QBO 4309), INV-000036, INV-000037 had their **total** set
  correctly to the QBO-billed amount but their **line** keyed at the wrong figure (gross estimate,
  not approved), so `subtotal ≠ total`. Verified each against QuickBooks (`qbo_get`) and corrected the
  line to the QBO-billed amount (11→7925.43, 29→3745.16, 36→3286.37, 37→795.00), adopting QBO's
  descriptions. **Totals/balances/paid-status unchanged** (QBO has no separate discount line for these,
  so the line was corrected, not offset with a negative line). Script:
  `scripts/fix-recon-invoice-line-amounts.sql`. Re-runnable health check added:
  `scripts/invoice-integrity-check.sql` (the #6 "final sweep" proof — all classes now 0).
- **Missing invoice line items backfilled (2026-07-07).** The reconciliation imports after the
  "confident batch" (INV-000010–028) wrote invoice **headers + payments** but skipped the
  **`invoice_line_items`** — leaving **35 invoices with a total but no line detail** (the 8 with an
  open balance showed "amount due, no line items"; the rest were paid so their $0 balance hid it).
  Root cause: header-only direct inserts (`create_invoice_for_job` never sets a total, so these came
  from the manual imports), masked in QBO by `qbo-invoice.js`'s no-lines summary fallback. Fix: pulled
  each invoice's real lines from its QBO source (`qbo_get Invoice`), classified each by QBO item
  (mitigation/reconstruction/mold/testing/contents/discount per BILLING-AR §4), and restored **50 line
  rows** across the 35 via `scripts/backfill-recon-invoice-lines.sql` — an idempotent, all-or-nothing
  DO block that asserts each invoice's recomputed total equals its prior total to the cent, so **zero
  AR/total/status movement** (verified: every total = Σ line_total; no invoice left lineless). The 4
  water/recon **split** pairs were allocated by trade; the offsetting **$1,005.63** pair (INV-000080 /
  INV-000081, both paid) kept its per-job grouping — the recon charge physically on QBO 4275 stays on
  INV-000080 to preserve both paid headers. Per-service line data now exists for the future
  `get_revenue_by_division` line-item rewire (BILLING-AR §5). *(Also surfaced the duplicate
  `INV-000062` — see OPEN.)*
- **Trevor Merrill** imported: 2 LOCKED split invoices (water $4,710.44 + recon $19,989.26 = QBO 3559, paid). Re-pointed Encircle → real 4236131; deleted dup claim CLM-2604-087.
- **Dave Bevan** reconciled: combined QBO inv 4196 (water $5,385.26 + recon $4,112.54) + $1,000 deductible (3969) imported as LOCKED rows; created recon job R-2603-011; deleted junk "26-2" job. Remodel (4704) already correct.
- **Remodeling reporting fix**: reclassified 4 remodel jobs `reconstruction→remodeling`; split Virginia Roundy remodel to R-2604-260; repointed her misrouted payment. Dashboard Remodeling now Revenue $31,828.66 / Payments $22,638.81 / Avg $6,365.73 (was $0).
- **Remodeling UI**: already in `main` (prior rollout); PR **#154** completed the tech-app color gap (merged).
- **Tanra Hill** payment-trigger regression fixed & verified; mitigation invoice W-2606-022 payment recorded.
- **Claim-number collision fixed (serious — 2026-06-30)**: Tanner Johnson's new claim got
  `CLM-2606-167`, already held by Dorothy Killian, so the Encircle sync linked Tanner's job to
  Dorothy's Encircle claim. Cause: `generate_claim_number()` used a sequence that drifted behind
  the real max because imported/backfilled claims were inserted with explicit numbers. Fixes:
  (a) resynced the sequence; (b) gave Tanner a fresh number **CLM-2606-172** + his own Encircle
  claim **4764070**, restored Dorothy; (c) migration `20260630_harden_claim_number_generation`
  — UNIQUE constraint on `claims.claim_number` + drift-proof generator (max+1, advisory lock);
  (d) hardened the Encircle worker to verify policyholder/address before linking a CLM match.
- **Paul Engman** mitigation reconciled (found 6/30 via the WF bank cross-check): his $10,538.19 State Farm check had been deposited straight to Sales (QBO Deposit 5555, no invoice). Created QBO invoice **26-20** + payment 5604, relinked Deposit 5555 to the payment (income counted once, stays in …2227); consolidated onto his EXISTING records (contact qbo 567→**579**, claim **CLM-2603-002**, water job **"26-20"**, Encircle **4422148**, real phone/email) and deleted the duplicate customer/contact/claim/job first created under the "Engemann" spelling. Recon job **R-2604-024** still open (separate scope).
