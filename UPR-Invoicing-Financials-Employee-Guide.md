# UPR Invoicing & Financials — Employee Guide

A plain-English walkthrough of how we build invoices and estimates, review and save them to
QuickBooks, record payments, and track collections inside the UPR app. It also calls out
contained operations so no one treats a legacy control or URL as live.

---

## 1. The Big Picture (how it all fits together)

```
   JOB  ──►  BUILD INVOICE  ──►  SEND TO QUICKBOOKS  ──►  GET PAID  ──►  COLLECTIONS
 (the work)  (line items in UPR)   (real QBO invoice)   (payments sync to QBO)  (track A/R)
```

A few core ideas that make everything else make sense:

- **One invoice per job — and a job is one division.** A claim with both Mitigation
  and Reconstruction is **two jobs = two invoices**. That's on purpose: insurance pays
  each category on a separate check, so each check matches its own invoice.
- **Invoices are built line by line.** On the invoice editor each line carries a
  QuickBooks **Item** + **Class**, a description, and quantity × rate. The invoice total
  adds itself up from the lines — there's no single lump-sum box.
- **"Invoiced" means *it's in QuickBooks*.** A new invoice starts as a **draft** in UPR.
  You add the lines, then click **Save** — now it's real, the balance
  "clock" starts, and it shows up in Collections.
- **Invoice authoring is human-directed from UPR to QuickBooks.** Build and save invoices in
  UPR; QuickBooks is the accounting record. Externally managed QuickBooks, receipt, and Stripe
  payments are corrected in their owning system and then reconcile back to UPR.
- **A local manual payment stays local.** You may record, edit, or delete that UPR row without
  deleting or reposting a provider payment. Provider-owned and receipt-backed rows are view-only.
- **The Financials/Collections numbers come straight from your invoices.** Once a job has
  a saved invoice, its Invoiced / Balance figures update automatically — you don't type
  them in by hand.

---

## 2. Who Can Do What

- **Build invoices and estimates, use permitted QuickBooks actions, and record payments:**
  Admins, office staff, and project managers. Estimate QuickBooks actions appear only when the
  strict document capability and provider-traffic gates allow them.
- **Payment Settings and payouts:** admins only.
- **Everyone else:** can *see* the billing and financial info (read-only). The edit
  buttons simply won't show.
- Billing is also behind the **Billing** feature switch — if it's off, the billing areas
  are hidden for everyone.

---

## 3. Start an Invoice

Two ways to begin — both open the same invoice editor. **One invoice per job**: if the
job already has one, you land right back on it (never a duplicate).

- **"+ New invoice" button** — on a **Customer's page** (top of the page) or on the
  **Collections** screen. Pick the job to bill and it opens the editor.
- **From the claim or customer** — open the claim's **Invoices & Payments** panel (or a
  customer's **Financial** tab) and click **Create invoice** on the job's row.

---

## 4. Step-by-Step: Build & Save to QuickBooks

**Where:** the invoice editor (the page that opens after you start an invoice).

1. Click **+ Add line**. Choose the QuickBooks **Item** and **Class**, type a
   **description**, then the **quantity** and **rate**. The line amount and the invoice
   **Total** fill in automatically.
2. Add as many lines as the job needs. **Line edits save by themselves** — there's no
   save button.
3. When the total is right, click **Save**. The status leaves **Draft** with a green
   **QuickBooks #** — now it's officially invoiced and shows
   in Collections.
4. **Need to change it after saving?** Edit the lines and click **Save** again to update
   QuickBooks.
5. The **Item** and **Class** lists come live from QuickBooks, so QuickBooks must be
   connected.

**Fixing mistakes:**
- 🔴 **Red error banner?** It usually means the customer isn't linked in QuickBooks yet. Fix it,
  then click **Save** again.
- **Need to rework a saved invoice?** Use **Manage ▾ → Revert to draft**. An invoice that was
  never saved can be removed with **Manage ▾ → Delete draft**.

**Estimates:** Build and edit estimate lines in UPR. When the strict document capability and
provider-traffic gates are enabled, use **Save to QuickBooks** (or **Update QuickBooks**),
**Send to customer** (or **Resend**), and **Manage ▾ → Revert to draft** for the QuickBooks
estimate. **→ Convert to invoice** stays local: review the converted invoice, then use the
human **Save** action on the invoice page when it is ready for QuickBooks.

---

## 5. Step-by-Step: Get Paid

**Where:** the claim's **Invoices & Payments** panel, a customer's **Financial** tab, or
**Collections** → open the claim.

1. **A payment comes in?** Click **+ Record payment**, enter the amount and date, choose
   who paid (insurance / homeowner / other) and the method, add a reference (check #,
   etc.), and save.
2. A local manual payment updates UPR's **Collected** and **Balance** figures. It is not a
   provider delete/repost path. Use the separate, human-confirmed receipt workflow when a
   QuickBooks payment must be allocated across invoices.
3. **Collected** and **Balance** update right away; **Invoiced** doesn't change (it only
   reflects the invoice itself).

**💳 Card payments (Stripe pay-link):** Card pay-links and Stripe payment projection remain
temporarily unavailable under the current containment. Do **not** create, copy, or share a stored
or legacy Stripe URL. Use the approved manual payment process instead.

---

## 6. Collections & Reading the Numbers

**Collections** in the menu has two tabs: **A/R · Outstanding** (totals, aging buckets,
and an overdue worklist) and **Payments** (cash-in history). Click any row to open that
claim's A/R workspace. The same per-invoice detail also lives on each claim's **Invoices &
Payments** panel and each customer's **Financial** tab.

| Term | What it means |
|---|---|
| **Invoiced** | Total of the invoice's line items, once it's **saved to QuickBooks**. What we've officially billed. |
| **Collected** | Payments recorded or reconciled as received. Provider-owned and receipt-backed rows are view-only. |
| **Balance** | Invoiced − Collected. What's still owed. |
| **Aging** | How overdue the balance is vs. the due date — Current, 1–30, 31–60, 61–90, 90+ days. |
| **Deductible Owed** | The customer's deductible that hasn't been collected yet. |
| **Insurance A/R** | What insurance still owes after the deductible. |

Rule of thumb: **Invoiced − Collected = Balance.** If the Balance looks wrong, it's almost
always an invoice that wasn't saved, or a payment that wasn't recorded.

---

## 7. Good Practices ✅ / ❌

**Do:**
- ✅ **One invoice per division.** Mitigation and Reconstruction get their own invoices.
- ✅ **Build the lines with the right Item + Class** so the numbers land in the correct
  QuickBooks buckets.
- ✅ **Only Save when the total is final.** Saving creates the real bill and starts the A/R
  clock. Not ready? Leave it a draft.
- ✅ **Record payments the day they arrive**, with the correct payer and method.
- ✅ **Use the approved manual process** while card pay-links and Stripe payment projection are unavailable.
- ✅ **Mark the deductible received** as soon as it's collected.

**Don't:**
- ❌ **Don't make a duplicate invoice for the same job** — while the invoice is still open,
  open the existing one and edit its lines instead. *(Exception: a genuine **supplement** after
  the first invoice is already paid is fine — you can't edit a paid invoice, so make a new one.
  It's numbered automatically, e.g. `R-2604-009-2`.)*
- ❌ **Don't save a guess.** A saved invoice is a real bill in QuickBooks.
- ❌ **Don't correct an externally managed payment in UPR.** Correct QBO, receipt, or Stripe
  payments in their owning system, then let the reconciliation path update UPR.
- ❌ **Don't use Revert to draft** unless you mean to pull an invoice back to correct and
  re-save.

---

## 8. FAQ / Troubleshooting

**Q: How do I take a card payment from a customer?**
Card pay-links and Stripe payment projection remain temporarily unavailable under the current
containment. Do **not** share a stored or legacy Stripe URL; use the approved manual payment
process instead.

**Q: I recorded a payment — did it reach QuickBooks?**
Local manual payment records stay in UPR. The separate receipt workflow is a human-confirmed
QuickBooks payment action; QBO-, receipt-, and Stripe-managed payments reconcile back from their
owning systems.

**Q: Can I edit or delete a payment?**
You can update or delete a local manual payment; that changes only the UPR record and never
deletes or reposts a provider payment. QBO-linked, QBO-imported, Stripe-projected,
receipt-backed, and other externally managed payments remain view-only. Correct those through
their owning system or the approved receipt process.

**Q: What changed for estimates?**
Estimates are built and edited in UPR. When the strict document capability and provider-traffic
gates are enabled, **Save to QuickBooks** / **Update QuickBooks**, **Send to customer** /
**Resend**, and **Revert to draft** are available for the QuickBooks estimate. **→ Convert to
invoice** remains local: review the converted invoice, then use the human **Save** action on the
invoice page when it is ready for QuickBooks.

**Q: The Collections balance still shows an old number.**
That job probably predates this system. **Older jobs keep their existing numbers** and
don't need to be re-invoiced. Only jobs with a freshly **saved** invoice switch to the new
invoice-based figures.

**Q: I got a red "Error" badge.**
Hover it to see why. Usually the contact needs to be linked to a QuickBooks customer
first. Fix that, then **Save** again.

**Q: Can I pull a saved invoice back to draft?**
Yes — on the invoice editor, use **Manage ▾ → Revert to draft**. Just fixing line items?
Edit the lines and click **Save** again.

**Q: Why don't I see the Item / Class dropdowns?**
They load **live from QuickBooks**, so QuickBooks must be connected (Dev Tools →
Integrations).

---

## 9. Quick Cheat-Sheet

**To bill a job:** *+ New invoice* (or Claim → **Invoices & Payments** → *Create invoice*)
→ add line items (Item + Class, qty × rate) → *Save* (green QuickBooks # =
done).

**To collect:** **Collections** → open claim → *+ Record payment* (local manual record), or use
the separate human-confirmed receipt workflow when a QBO allocation is required. Card pay-links
are temporarily unavailable; do not share legacy Stripe URLs.

---

*Questions or something doesn't match what's on your screen? Send a note to Moroni.*
