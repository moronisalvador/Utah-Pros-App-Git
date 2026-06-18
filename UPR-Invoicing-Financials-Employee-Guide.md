# UPR Invoicing & Financials — Employee Guide

A plain-English walkthrough of how we create invoices, push them to QuickBooks, and
track collections inside the UPR app. Read the **Big Picture** once, then keep the
**Step-by-Step** and **Good Practices** sections handy.

---

## 1. The Big Picture (how it all fits together)

```
   JOB  ──►  CREATE INVOICE  ──►  PUSH TO QUICKBOOKS  ──►  COLLECTIONS
 (the work)     (draft in UPR)      (real QBO invoice)     (get paid + track)
```

A few core ideas that make everything else make sense:

- **One invoice per job — and a job is one division.** A claim with both Mitigation
  and Reconstruction is **two jobs = two invoices**. That's on purpose: insurance pays
  each category on a separate check, so each check matches its own invoice.
- **"Invoiced" means *pushed to QuickBooks*.** When you first create an invoice it's a
  **draft** — it doesn't count as billed yet. The moment you **Push to QuickBooks**, it
  becomes a real invoice, the customer's balance "clock" starts, and it shows up in
  Collections.
- **QuickBooks is the official record of the invoice. UPR is where you build it and
  chase payment.** You create and price the invoice in UPR, push it to QuickBooks, then
  manage getting paid from the Collections screen.
- **The Financials/Collections numbers come straight from your invoices now.** Once a
  job has a pushed invoice, its Invoiced / Balance figures update automatically — you
  don't type them in by hand anymore.

---

## 2. Who Can Do What

- **Create invoices, set amounts, push to QuickBooks, log payments:** Admins, Managers,
  Project Managers, and Supervisors.
- **Everyone else:** can *see* the billing and financial info (read-only). The edit
  buttons simply won't show.

---

## 3. Step-by-Step: Create & Send an Invoice

**Where:** Open the **Claim**, then find the **Billing** section.
*(Desktop: it's the "Billing" card near the bottom. Phone: tap **Billing** to expand it.)*

1. **Open the claim** (from Claims, or from a job's "View Job" → claim).
2. Go to the **Billing** section. You'll see **one row per job/division**, e.g.
   *"Reconstruction · J-1042"*.
3. Click **Create invoice**. The row now shows a draft with an invoice number and the
   status **draft** (e.g. *"INV-000123 · $0.00 · draft"*).
4. Type the invoice amount in the box and click **Save amount**.
5. **Double-check the amount.** This is the number that goes to QuickBooks.
6. Click **Push to QuickBooks**.
7. Confirm you see the green **QuickBooks #…** badge. ✅ That means it's officially
   invoiced.

**Fixing mistakes:**
- 🔴 **Red "Error" badge?** Hover over it to read the reason (most often the customer
  isn't linked in QuickBooks yet). Fix the cause, then push again.
- **Pushed the wrong amount?** Click **Remove from QuickBooks**, correct the amount, and
  **Push to QuickBooks** again.

---

## 4. Step-by-Step: Track Payments & Collections

**Where:** **Collections** in the main menu → click the claim you want.

Each job shows a quick summary like *"$8,500 billed / $2,000 in"* plus its **Balance**
and an **A/R status**.

1. **A payment comes in?** Click **+ Log Payment**.
   - Choose where it came from (e.g. **insurance**, **deductible**, **homeowner/out-of-pocket**).
   - Enter the **amount** and the **date**, then save. The Balance updates automatically.
2. **Deductible collected?** Click the amber **"○ $X owed"** button next to *Deductible*.
   It flips to green **"✓ Rcvd"** with the date.
3. **Update the A/R status** with the dropdown as the file moves along:
   **Open → Invoiced → Partial → Paid** (or **Disputed** / **Written Off**).
4. **Log every follow-up.** Click **📝 Notes** to record calls, voicemails, and
   promised-payment dates. This builds the **Collections Log** so anyone can pick up
   where you left off.

---

## 5. Reading the Numbers

| Term | What it means |
|---|---|
| **Estimated** | What we expected the job to be worth (early on). |
| **Approved** | What the carrier approved. |
| **Invoiced** | Total **pushed to QuickBooks**. This is what we've officially billed. |
| **Collected** | Payments you've **logged** as received. |
| **Balance** | Invoiced − Collected. What's still owed. |
| **Deductible Owed** | The customer's deductible that hasn't been collected yet. |
| **Insurance A/R** | What insurance still owes after the deductible. |

Rule of thumb: **Invoiced − Collected = Balance.** If the Balance looks wrong, the fix is
almost always (a) an invoice that hasn't been pushed, or (b) a payment that hasn't been
logged.

---

## 6. Good Practices ✅ / ❌

**Do:**
- ✅ **One invoice per division.** Mitigation and Reconstruction get their own invoices.
- ✅ **Only push when the amount is final.** Pushing creates the real QuickBooks invoice
  and starts the A/R clock. If you're not sure yet, leave it as a saved **draft**.
- ✅ **Verify the amount before pushing**, and confirm the green **QuickBooks #…** badge
  after.
- ✅ **Log payments the day they arrive**, with the correct source.
- ✅ **Mark the deductible received** as soon as it's collected.
- ✅ **Keep the Collections Log current** — note every follow-up.

**Don't:**
- ❌ **Don't try to make several invoices for the same job.** The system keeps one per
  job; create it once and edit the amount.
- ❌ **Don't push a guess.** A pushed invoice is a real bill in QuickBooks. Save the draft
  and push when you know the number.
- ❌ **Don't hand-edit the old Revenue numbers on a job that already has a real invoice.**
  The invoice is now the source of truth — editing the old field will just be overwritten.
- ❌ **Don't "Remove from QuickBooks"** unless you genuinely mean to pull the invoice back
  to correct and re-push it.

---

## 7. FAQ / Troubleshooting

**Q: The Collections balance still shows an old number.**
That job probably predates this system. **Older jobs keep their existing numbers** and
don't need to be re-invoiced. Only jobs with a freshly **pushed** invoice switch to the
new invoice-based figures.

**Q: I logged a payment but Invoiced didn't change.**
Correct — logging a payment changes **Collected** and **Balance**, never **Invoiced**.
Invoiced only changes when you push (or adjust) the invoice itself.

**Q: Does QuickBooks payment info flow back automatically?**
Not yet. **For now, log payments by hand** in Collections. Automatic QuickBooks payment
sync is planned for a later update.

**Q: I got a red "Error" badge.**
Hover it to see why. Usually the contact needs to be linked to a QuickBooks customer
first. Fix that, then **Push to QuickBooks** again.

**Q: Can I undo a push?**
Yes — **Remove from QuickBooks** pulls it back so you can correct the amount and re-push.

---

## 8. Quick Cheat-Sheet

**To bill a job:** Claim → **Billing** → *Create invoice* → enter amount → *Save amount* →
*Push to QuickBooks* → confirm green badge.

**To collect:** **Collections** → open claim → *+ Log Payment* (and mark the deductible
**Rcvd**) → update **A/R status** → add a **Notes** entry.

---

*Questions or something doesn't match what's on your screen? Send a note to Moroni.*
