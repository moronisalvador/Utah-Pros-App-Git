# UPR Invoicing & Financials — Employee Guide

A plain-English walkthrough of how we build invoices, send them to QuickBooks, take
payments, and track collections inside the UPR app. Read the **Big Picture** once, then
keep the **Step-by-Step** and **Good Practices** sections handy.

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
  You add the lines, then click **Send to QuickBooks** — now it's real, the balance
  "clock" starts, and it shows up in Collections.
- **Everything flows one way: UPR → QuickBooks.** QuickBooks is the official record; UPR
  is where you build the invoice, send it, take payment, and chase the balance. Nobody
  edits invoices or payments directly in QuickBooks.
- **Payments you record in UPR post to QuickBooks automatically**, applied against the
  invoice.
- **The Financials/Collections numbers come straight from your invoices.** Once a job has
  a sent invoice, its Invoiced / Balance figures update automatically — you don't type
  them in by hand.

---

## 2. Who Can Do What

- **Build invoices, send to QuickBooks, record payments, manage Payment Settings:**
  Admins and Managers.
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

## 4. Step-by-Step: Build & Send to QuickBooks

**Where:** the invoice editor (the page that opens after you start an invoice).

1. Click **+ Add line**. Choose the QuickBooks **Item** and **Class**, type a
   **description**, then the **quantity** and **rate**. The line amount and the invoice
   **Total** fill in automatically.
2. Add as many lines as the job needs. **Line edits save by themselves** — there's no
   save button.
3. When the total is right, click **Send to QuickBooks**. The status goes
   **Draft → Sent** with a green **QuickBooks #** — now it's officially invoiced and shows
   in Collections.
4. **Need to change it after sending?** Edit the lines and click **Update in QuickBooks**
   to re-push.
5. The **Item** and **Class** lists come live from QuickBooks, so QuickBooks must be
   connected.

**Fixing mistakes:**
- 🔴 **Red "Error" badge?** Hover to read the reason (usually the customer isn't linked in
  QuickBooks yet). Fix it, then click **Send / Update** again.
- **Sent the wrong thing?** Edit the lines and **Update**, or use **Remove from
  QuickBooks** to pull it out. An unsent draft can be removed with **Delete draft**.

---

## 5. Step-by-Step: Get Paid

**Where:** the claim's **Invoices & Payments** panel, a customer's **Financial** tab, or
**Collections** → open the claim.

1. **A payment comes in?** Click **+ Record payment**, enter the amount and date, choose
   who paid (insurance / homeowner / other) and the method, add a reference (check #,
   etc.), and save.
2. The payment **posts to QuickBooks automatically**, applied to that invoice — a green
   **✓ QB** appears next to it. (If you see **! QB**, the invoice isn't in QuickBooks yet
   — send it first.)
3. **Collected** and **Balance** update right away; **Invoiced** doesn't change (it only
   reflects the invoice itself).

**💳 Card payments (Stripe pay-link):** On the invoice editor click **Create pay link** to
generate a secure Stripe link for the balance, then send it to the customer. When they pay
by card, the payment is recorded and synced to QuickBooks automatically — including the
processing fee, which is booked for you. *Available once Stripe is connected (Collections
→ ⚙ Payment Settings).*

---

## 6. Collections & Reading the Numbers

**Collections** in the menu has two tabs: **A/R · Outstanding** (totals, aging buckets,
and an overdue worklist) and **Payments** (cash-in history). Click any row to open that
claim's A/R workspace. The same per-invoice detail also lives on each claim's **Invoices &
Payments** panel and each customer's **Financial** tab.

| Term | What it means |
|---|---|
| **Invoiced** | Total of the invoice's line items, once it's **sent to QuickBooks**. What we've officially billed. |
| **Collected** | Payments you've **recorded** as received (they also post to QuickBooks). |
| **Balance** | Invoiced − Collected. What's still owed. |
| **Aging** | How overdue the balance is vs. the due date — Current, 1–30, 31–60, 61–90, 90+ days. |
| **Deductible Owed** | The customer's deductible that hasn't been collected yet. |
| **Insurance A/R** | What insurance still owes after the deductible. |

Rule of thumb: **Invoiced − Collected = Balance.** If the Balance looks wrong, it's almost
always an invoice that wasn't sent, or a payment that wasn't recorded.

---

## 7. Good Practices ✅ / ❌

**Do:**
- ✅ **One invoice per division.** Mitigation and Reconstruction get their own invoices.
- ✅ **Build the lines with the right Item + Class** so the numbers land in the correct
  QuickBooks buckets.
- ✅ **Only Send to QuickBooks when the total is final.** Sending creates the real bill and
  starts the A/R clock. Not ready? Leave it a draft.
- ✅ **Record payments the day they arrive**, with the correct payer and method.
- ✅ **Use the card pay link** for deductibles / out-of-pocket — it reconciles itself.
- ✅ **Mark the deductible received** as soon as it's collected.

**Don't:**
- ❌ **Don't make a duplicate invoice for the same job** — while the invoice is still open,
  open the existing one and edit its lines instead. *(Exception: a genuine **supplement** after
  the first invoice is already paid is fine — you can't edit a paid invoice, so make a new one.
  It's numbered automatically, e.g. `R-2604-009-2`.)*
- ❌ **Don't send a guess.** A sent invoice is a real bill in QuickBooks.
- ❌ **Don't enter invoices or payments directly in QuickBooks** — always do it in UPR so
  the two stay in sync.
- ❌ **Don't "Remove from QuickBooks"** unless you mean to pull it back to correct and
  re-send.

---

## 8. FAQ / Troubleshooting

**Q: How do I take a card payment from a customer?**
Open the invoice editor and click **Create pay link** — a secure Stripe link for the
balance. Send it; when they pay, the payment is recorded and synced to QuickBooks
automatically. *(Available once Stripe is connected in Payment Settings.)*

**Q: I recorded a payment — did it reach QuickBooks?**
Yes, automatically — as long as the invoice was already **sent to QuickBooks**. A green
**✓ QB** shows next to the payment. A **! QB** means the invoice isn't in QuickBooks yet;
send it first.

**Q: The Collections balance still shows an old number.**
That job probably predates this system. **Older jobs keep their existing numbers** and
don't need to be re-invoiced. Only jobs with a freshly **sent** invoice switch to the new
invoice-based figures.

**Q: I got a red "Error" badge.**
Hover it to see why. Usually the contact needs to be linked to a QuickBooks customer
first. Fix that, then **Send / Update to QuickBooks** again.

**Q: Can I undo a send?**
Yes — on the invoice editor, **Remove from QuickBooks** pulls it out entirely. Just fixing
line items? Edit the lines and click **Update in QuickBooks**.

**Q: Why don't I see the Item / Class dropdowns?**
They load **live from QuickBooks**, so QuickBooks must be connected (Dev Tools →
Integrations).

---

## 9. Quick Cheat-Sheet

**To bill a job:** *+ New invoice* (or Claim → **Invoices & Payments** → *Create invoice*)
→ add line items (Item + Class, qty × rate) → *Send to QuickBooks* (green QuickBooks # =
done).

**To collect:** **Collections** → open claim → *+ Record payment* (it posts to
QuickBooks) — or open the invoice and *Create pay link* for a card payment.

---

*Questions or something doesn't match what's on your screen? Send a note to Moroni.*
