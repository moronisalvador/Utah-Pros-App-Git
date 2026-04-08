# /collections Route — Feature Spec (VERIFIED)

> **Audited April 8, 2026** — Every table, column, constraint, trigger, view, enum, and RLS policy verified against live Supabase (glsmljpabrwonfiltiqm). This spec is safe to hand to Claude Code.

---

## Overview

Add a `/collections` route to the UPR Platform that replaces the team's Google Sheets collections tracker. Built on the existing `jobs`, `payments`, and `claims` tables.

**Core pattern:** Payments are the engine. Log payments → trigger auto-updates `jobs.collected_value` → Overview and Dashboard reflect changes instantly.

**Route key:** `'collections'` — already exists in `nav_permissions` with admin/manager/office access granted. No new permissions needed.

---

## Current Schema State (verified)

### `jobs` — 81 rows

**Financial columns (all `numeric`, all nullable):**
| Column | Current state |
|--------|--------------|
| `estimated_value` | some populated |
| `approved_value` | all NULL on invoiced jobs |
| `invoiced_value` | 14 jobs populated ($95,129.01 total) |
| `collected_value` | **all NULL** — will be auto-computed from payments |
| `deductible` | all NULL on invoiced jobs |
| `depreciation_held` | all NULL |
| `depreciation_released` | all NULL |
| `supplement_value` | all NULL |

**AR columns:**
| Column | Type | Current state |
|--------|------|--------------|
| `ar_status` | text | 67 × `'open'`, 14 × `'invoiced'` |
| `ar_notes` | text | all NULL |
| `invoiced_date` | date | all NULL |
| `last_followup_date` | date | all NULL |
| `deductible_collected` | boolean | all NULL |
| `deductible_collected_date` | date | all NULL |

**⚠ CHECK constraint on `ar_status`:**
```
(ar_status = ANY (ARRAY['open','invoiced','partial','paid','disputed','written_off']))
```
UI dropdowns MUST use exactly these values.

**Division enum (`job_division`):**
```
{water, mold, fire, reconstruction, contents, general}
```

**Display grouping:**
- **Mitigation** = `water`, `mold`, `fire`, `contents`, `general`
- **Reconstruction** = `reconstruction`

**Other key columns:** `insured_name`, `insurance_company` (free text, inconsistent: "AllState"/"All State"/"allstate"), `claim_number` (text, only 4 populated), `claim_id` (uuid FK → claims, 36 populated — **all 14 invoiced jobs have claim_id**), `job_number`, `division`, `phase`, `status`.

**Existing triggers on jobs:**
| Trigger | Event | Function |
|---------|-------|----------|
| `jobs_updated_at` | UPDATE | `update_updated_at()` — sets `updated_at = now()` |
| `trg_auto_job_number` | INSERT | `trigger_auto_job_number()` |
| `trg_job_events` | INSERT, UPDATE | `trigger_job_events()` — logs to system_events, **including `collected_value` changes** |
| `trg_log_phase_change` | UPDATE | `log_phase_change()` |
| `trg_sync_job_to_claim` | UPDATE | `sync_job_to_claim()` |

**Important:** `trigger_job_events()` already detects `collected_value` changes and logs a `'job.payment_received'` event. Our trigger that updates `collected_value` on jobs will automatically generate these audit events.

---

### `payments` — 0 rows, schema ready

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `invoice_id` | uuid | **NO** ⚠ | — | FK → invoices. **Must make nullable** |
| `job_id` | uuid | NO | — | FK → jobs |
| `contact_id` | uuid | YES | — | FK → contacts |
| `amount` | numeric | NO | — | |
| `payment_method` | text | YES | — | CHECK constrained |
| `payment_date` | date | NO | `CURRENT_DATE` | |
| `reference_number` | text | YES | — | |
| `payer_type` | text | YES | `'insurance'` | CHECK constrained |
| `payer_name` | text | YES | — | |
| `is_deductible` | boolean | YES | `false` | |
| `is_depreciation_release` | boolean | YES | `false` | |
| `notes` | text | YES | — | |
| `recorded_by` | uuid | YES | — | FK → employees |
| `created_at` | timestamptz | NO | `now()` | |

**⚠ CHECK constraints — UI MUST match exactly:**
```sql
-- payment_method:
(payment_method = ANY (ARRAY['check','ach','credit_card','wire','cash','insurance_direct','other']))

-- payer_type:
(payer_type = ANY (ARRAY['insurance','homeowner','mortgage_co','property_manager','other']))

-- amount:
(amount > 0)  -- no zero or negative
```

**⚠ Existing trigger on payments:**
```
trg_payment_update_invoice → INSERT/UPDATE/DELETE → update_invoice_paid()
```

**Current `update_invoice_paid()` function body:**
```sql
DECLARE
  target_invoice_id uuid;
  target_job_id uuid;
  ins_paid numeric;
  ho_paid numeric;
  total_paid_amt numeric;
  invoice_total numeric;
BEGIN
  target_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;

  -- Sums payments by invoice_id (BREAKS if invoice_id is NULL)
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE payer_type = 'insurance'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payer_type IN ('homeowner','other')), 0),
    COALESCE(SUM(amount), 0)
  INTO ins_paid, ho_paid, total_paid_amt
  FROM payments WHERE invoice_id = target_invoice_id;

  -- Updates invoices table (no-op if invoice_id is NULL)
  SELECT COALESCE(adjusted_total, total) INTO invoice_total
  FROM invoices WHERE id = target_invoice_id;

  UPDATE invoices SET
    amount_paid = total_paid_amt,
    insurance_paid = ins_paid,
    homeowner_paid = ho_paid,
    status = CASE
      WHEN total_paid_amt >= invoice_total THEN 'paid'
      WHEN total_paid_amt > 0 THEN 'partially_paid'
      ELSE status
    END,
    paid_at = CASE WHEN total_paid_amt >= invoice_total THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = target_invoice_id;

  -- Updates jobs.collected_value by joining through invoices (MISSES payments with NULL invoice_id)
  UPDATE jobs SET
    collected_value = COALESCE((
      SELECT SUM(p.amount) FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      WHERE i.job_id = target_job_id
    ), 0),
    updated_at = now()
  WHERE id = target_job_id;

  RETURN COALESCE(NEW, OLD);
END;
```

**⚠ CRITICAL PROBLEM:** The `jobs.collected_value` update joins `payments → invoices → jobs`. If `invoice_id` is NULL, this join skips those payments entirely. The function MUST be rewritten.

**⚠ RLS PROBLEM:** payments only has `allow_authenticated_payments` (ALL, authenticated role). **No anon policies.** The web app uses the anon key. Payments will be blocked by RLS without anon policies.

---

### `claims` — 29 rows

Key columns: `id`, `claim_number` (format: `CLM-YYMM-XXX`), `insurance_carrier`, `date_of_loss`, `status`, `deductible`.

**CHECK on status:**
```
(status = ANY (ARRAY['open','in_progress','closed','denied','settled','supplementing']))
```

**Relationship to jobs:** `jobs.claim_id` → `claims.id`. All 14 invoiced jobs have `claim_id` set. 7 claims have multiple jobs (mit + recon under same claim).

---

### `invoices` — 0 rows (NOT part of MVP)

Referenced by: `invoice_adjustments`, `invoice_line_items`, `payments`. All empty. Has rich schema for future invoice generation. Leave untouched.

---

### `insurance_carriers` — reference table with proper names

Has `name`, `short_name`, `is_active`, `sort_order`. But `jobs.insurance_company` is free text, not FK. Carrier breakdown on dashboard should use `UPPER(TRIM(jobs.insurance_company))` for grouping.

---

### Existing views that reference financial data

**`active_jobs`** — includes `invoiced_value`, `collected_value`, computes `total_revenue`, `total_cost`, `gross_profit`. Our trigger updating `collected_value` will automatically be reflected here.

**`job_equipment_costs`** — computes equipment costs. Not affected.

---

## Migration Plan

### Migration 1: `make_payments_invoice_nullable`

```sql
-- Drop the NOT NULL constraint on invoice_id
-- The column itself and FK constraint remain — just nullable now
ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL;
```

### Migration 2: `fix_payment_trigger_for_nullable_invoice`

Replace the existing `update_invoice_paid()` function to handle NULL invoice_id:

```sql
CREATE OR REPLACE FUNCTION update_invoice_paid()
RETURNS TRIGGER AS $$
DECLARE
  target_invoice_id uuid;
  target_job_id uuid;
  ins_paid numeric;
  ho_paid numeric;
  total_paid_amt numeric;
  invoice_total numeric;
BEGIN
  target_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;

  -- ═══ INVOICE UPDATE (only if invoice_id is NOT NULL) ═══
  IF target_invoice_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE payer_type = 'insurance'), 0),
      COALESCE(SUM(amount) FILTER (WHERE payer_type IN ('homeowner','other')), 0),
      COALESCE(SUM(amount), 0)
    INTO ins_paid, ho_paid, total_paid_amt
    FROM payments WHERE invoice_id = target_invoice_id;

    SELECT COALESCE(adjusted_total, total) INTO invoice_total
    FROM invoices WHERE id = target_invoice_id;

    UPDATE invoices SET
      amount_paid = total_paid_amt,
      insurance_paid = ins_paid,
      homeowner_paid = ho_paid,
      status = CASE
        WHEN total_paid_amt >= invoice_total THEN 'paid'
        WHEN total_paid_amt > 0 THEN 'partially_paid'
        ELSE status
      END,
      paid_at = CASE WHEN total_paid_amt >= invoice_total THEN now() ELSE NULL END,
      updated_at = now()
    WHERE id = target_invoice_id;
  END IF;

  -- ═══ JOB COLLECTED_VALUE UPDATE (always, using job_id directly) ═══
  UPDATE jobs SET
    collected_value = COALESCE((
      SELECT SUM(amount) FROM payments WHERE job_id = target_job_id
    ), 0),
    ar_status = CASE
      WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE job_id = target_job_id), 0) = 0 THEN
        CASE WHEN invoiced_value > 0 THEN 'invoiced' ELSE 'open' END
      WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE job_id = target_job_id), 0) >= COALESCE(invoiced_value, 0) THEN 'paid'
      ELSE 'partial'
    END,
    updated_at = now()
  WHERE id = target_job_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

**What changed from the original:**
1. Invoice update wrapped in `IF target_invoice_id IS NOT NULL` — preserves all existing invoice logic for future use
2. Job collected_value now queries `payments WHERE job_id = target_job_id` directly — no longer joins through invoices
3. Auto-updates `ar_status` based on payment state (open → invoiced → partial → paid)
4. `trigger_job_events()` on jobs will automatically log the collected_value change to system_events

**No new trigger needed.** The existing `trg_payment_update_invoice` trigger already fires on INSERT/UPDATE/DELETE. We're just fixing the function it calls.

### Migration 3: `add_payments_anon_rls`

```sql
-- The web app uses anon key. Payments needs anon policies to match
-- the pattern used by jobs, claims, and all other tables.
CREATE POLICY allow_anon_select_payments ON payments FOR SELECT TO anon USING (true);
CREATE POLICY allow_anon_insert_payments ON payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY allow_anon_update_payments ON payments FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_anon_delete_payments ON payments FOR DELETE TO anon USING (true);
```

### Migration 4: `create_billing_overview_view`

```sql
CREATE OR REPLACE VIEW billing_overview AS
SELECT
  c.id as claim_id,
  c.claim_number,
  c.insurance_carrier as claim_carrier,
  c.date_of_loss,
  c.status as claim_status,
  -- Use first job's insured_name as client name for the claim
  (array_agg(j.insured_name ORDER BY j.created_at))[1] as client,
  -- Carrier: prefer claims table, fallback to first job
  COALESCE(c.insurance_carrier, (array_agg(j.insurance_company ORDER BY j.created_at) FILTER (WHERE j.insurance_company IS NOT NULL))[1]) as carrier,
  -- Mitigation rollup (water + mold + fire + contents + general)
  COALESCE(SUM(j.invoiced_value) FILTER (WHERE j.division IN ('water','mold','fire','contents','general')), 0) as mit_invoiced,
  COALESCE(SUM(j.collected_value) FILTER (WHERE j.division IN ('water','mold','fire','contents','general')), 0) as mit_collected,
  -- Reconstruction rollup
  COALESCE(SUM(j.invoiced_value) FILTER (WHERE j.division = 'reconstruction'), 0) as recon_invoiced,
  COALESCE(SUM(j.collected_value) FILTER (WHERE j.division = 'reconstruction'), 0) as recon_collected,
  -- Totals
  COALESCE(SUM(j.invoiced_value), 0) as total_invoiced,
  COALESCE(SUM(j.collected_value), 0) as total_collected,
  COALESCE(SUM(j.invoiced_value), 0) - COALESCE(SUM(j.collected_value), 0) as outstanding,
  -- Job details for drill-down
  COUNT(j.id) as job_count,
  jsonb_agg(jsonb_build_object(
    'job_id', j.id,
    'job_number', j.job_number,
    'division', j.division,
    'invoiced', j.invoiced_value,
    'collected', j.collected_value,
    'ar_status', j.ar_status,
    'phase', j.phase
  ) ORDER BY j.division, j.job_number) as jobs,
  MAX(j.updated_at) as last_updated
FROM claims c
JOIN jobs j ON j.claim_id = c.id
WHERE j.invoiced_value > 0 OR j.collected_value > 0
GROUP BY c.id, c.claim_number, c.insurance_carrier, c.date_of_loss, c.status;
```

**Why `claim_id` as the grouping key:** All 14 invoiced jobs have `claim_id` set. Only 4 have `claim_number` text populated on the job itself. `claim_id` is the reliable FK. The `claims` table always has `claim_number` populated (NOT NULL constraint).

**The `jobs` jsonb array** gives the frontend everything it needs for drill-down without extra queries — each job's number, division, invoiced, collected, status, and phase.

---

## UI Spec

### Route: `/collections`

Nav key: `'collections'` (already in nav_permissions). Add to router + sidebar.

**3 tab views** (same tab pattern as JobPage):

---

### Tab 1: "Overview" (default)

**Data source:** `billing_overview` view via REST:
```
GET /rest/v1/billing_overview?order=outstanding.desc
```

**Table columns:**

| Column | Source | Notes |
|--------|--------|-------|
| Client | `client` | |
| Claim # | `claim_number` | CLM-YYMM-XXX format |
| Carrier | `carrier` | |
| Mit Invoiced | `mit_invoiced` | currency |
| Mit Collected | `mit_collected` | currency |
| Recon Invoiced | `recon_invoiced` | currency |
| Recon Collected | `recon_collected` | currency |
| Total | `total_invoiced` | currency |
| Collected | `total_collected` | currency |
| Outstanding | `outstanding` | currency, red if > 0, green if = 0 |

**Behavior:**
- Default sort: outstanding DESC (biggest balances first)
- Search: filter by client name or claim number
- Filter pills: "All" / "Has Balance" / "Paid in Full"
- Clicking a row expands inline to show the `jobs` array — individual job cards with job_number, division, invoiced, collected, ar_status
- Clicking a job card navigates to `/jobs/:jobId` (Financial tab)
- Totals row pinned at bottom showing aggregate mit/recon/total
- Mobile: horizontal scroll on table, or card layout

---

### Tab 2: "Log Payment"

**Left section: Payment Form**

| Field | Type | Maps to | Required | Notes |
|-------|------|---------|----------|-------|
| Job | searchable select | `job_id` | YES | Show `job_number — insured_name (division)` for jobs with `invoiced_value > 0`. Group by claim. |
| Amount | currency input | `amount` | YES | Must be > 0 (CHECK constraint) |
| Payment Date | date picker | `payment_date` | YES | Default: today |
| Source | select | `payer_type` | YES | Options: `Insurance`, `Homeowner`, `Mortgage Co`, `Property Manager`, `Other` |
| Method | select | `payment_method` | NO | Options: `Check`, `ACH`, `Credit Card`, `Wire`, `Cash`, `Insurance Direct`, `Other` |
| Reference # | text | `reference_number` | NO | Check number, EFT ref, etc. |
| Is Deductible | toggle | `is_deductible` | NO | Default: false |
| Is Depreciation Release | toggle | `is_depreciation_release` | NO | Default: false |
| Notes | textarea | `notes` | NO | |

**On submit:**
```
POST /rest/v1/payments
Body: { job_id, amount, payment_date, payer_type, payment_method, reference_number, is_deductible, is_depreciation_release, notes }
```
- `invoice_id` is omitted (NULL) — nullable now
- `recorded_by` is omitted for now (no auth session to populate it)
- Success toast: "Payment of $X,XXX.XX recorded for [job_number]"
- Reset form, refresh recent payments list

**Right section: Recent Payments**

Query:
```
GET /rest/v1/payments?order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)
```

Mini table: Date, Job #, Client, Amount, Source, Method, Ref #. Each row has delete button (with confirmation modal) that sends:
```
DELETE /rest/v1/payments?id=eq.[id]
```

---

### Tab 3: "Dashboard"

**KPI Cards (top):**
All computed from `billing_overview` view rows summed client-side, or from a single query:

```sql
SELECT
  SUM(total_invoiced) as total_billed,
  SUM(total_collected) as total_collected,
  SUM(outstanding) as total_outstanding,
  SUM(mit_invoiced) as mit_billed,
  SUM(mit_collected) as mit_collected,
  SUM(recon_invoiced) as recon_billed,
  SUM(recon_collected) as recon_collected,
  COUNT(*) as active_claims
FROM billing_overview;
```

| Card | Value | Color |
|------|-------|-------|
| Total Billed | sum of total_invoiced | blue |
| Total Collected | sum of total_collected | green |
| Outstanding | sum of outstanding | red |
| Collection Rate | collected / billed | amber |
| Mit Billed | sum of mit_invoiced | light blue |
| Recon Billed | sum of recon_invoiced | green |

**Outstanding by Carrier table:**
Group `billing_overview` by `UPPER(TRIM(carrier))` → show: Carrier, # Claims, Billed, Collected, Outstanding.

**AR Status breakdown:**
Query jobs directly:
```
GET /rest/v1/jobs?select=ar_status,invoiced_value,collected_value&invoiced_value=gt.0
```
Group client-side by `ar_status` → show: Status, Count, Invoiced, Collected, Outstanding.

---

## Design Tokens

Follow existing app dark theme (DESIGN_SYSTEM.md + design-tokens.css):
- Primary: `--upr-blue` (#1B3A5C)
- Accent: `--upr-accent` (#2E75B6)
- Success: green for paid/collected
- Danger: red for outstanding/overdue
- Use existing component patterns (card layouts, tables, tab bar from JobPage)

---

## File Structure

```
src/pages/Collections.jsx           — Main page with tab navigation
src/components/collections/
  CollectionsOverview.jsx            — Tab 1: claim-level billing table
  PaymentLogger.jsx                  — Tab 2: form + recent payments list
  CollectionsDashboard.jsx           — Tab 3: KPIs and summaries
```

---

## Data Access Pattern

REST for all queries (existing pattern). Use the `db` utility with `baseUrl` + `apiKey`:

```javascript
// Read billing overview
const res = await fetch(`${db.baseUrl}/rest/v1/billing_overview?order=outstanding.desc`, {
  headers: { 'apikey': db.apiKey, 'Authorization': `Bearer ${db.apiKey}` }
});

// Insert payment
const res = await fetch(`${db.baseUrl}/rest/v1/payments`, {
  method: 'POST',
  headers: {
    'apikey': db.apiKey,
    'Authorization': `Bearer ${db.apiKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  },
  body: JSON.stringify({ job_id, amount, payment_date, payer_type, ... })
});

// Delete payment
const res = await fetch(`${db.baseUrl}/rest/v1/payments?id=eq.${id}`, {
  method: 'DELETE',
  headers: { 'apikey': db.apiKey, 'Authorization': `Bearer ${db.apiKey}` }
});
```

---

## NOT in Scope

- Invoice generation (invoices table stays empty)
- PDF output
- Payment reminders / automated follow-ups
- QuickBooks sync
- Editing job financial fields from this page (stays on JobPage Financial tab)
- Creating/editing claims from this page

---

## Execution Order for Claude Code

### Phase 1: Database (migrations)
1. `make_payments_invoice_nullable` — ALTER TABLE
2. `fix_payment_trigger_for_nullable_invoice` — CREATE OR REPLACE FUNCTION
3. `add_payments_anon_rls` — CREATE POLICY × 4
4. `create_billing_overview_view` — CREATE VIEW

### Phase 2: Route scaffolding
5. Add `/collections` route to router
6. Add sidebar entry using `'collections'` nav_key
7. Verify `canAccess('collections')` works (should already — nav_key exists)

### Phase 3: Build UI
8. `Collections.jsx` — page shell with 3 tabs
9. `CollectionsOverview.jsx` — table from billing_overview view
10. `PaymentLogger.jsx` — form + recent payments
11. `CollectionsDashboard.jsx` — KPIs and summaries

### Phase 4: Verify
12. Log a test payment via the form
13. Verify `jobs.collected_value` auto-updated (check via /jobs/:jobId)
14. Verify billing_overview reflects the change
15. Verify system_events logged a `'job.payment_received'` event
16. Delete the test payment, verify collected_value resets to 0

---

## Acceptance Criteria

- [ ] `/collections` route loads with 3 tabs
- [ ] Overview shows all claims with invoiced jobs, grouped correctly (7 multi-job claims visible)
- [ ] Totals row shows $95,129.01 total invoiced (current data)
- [ ] Payment form validates: amount > 0, job required, payer_type uses exact CHECK values
- [ ] Payment INSERT succeeds (not blocked by RLS)
- [ ] After payment, `jobs.collected_value` auto-updates via trigger
- [ ] After payment, `jobs.ar_status` auto-updates (open→partial or partial→paid)
- [ ] `system_events` receives a `'job.payment_received'` entry
- [ ] Delete payment reverses all of the above
- [ ] Dashboard KPIs match Overview totals
- [ ] Mobile responsive
- [ ] Dark theme consistent with existing app

---

## Risks & Notes

1. **Carrier name inconsistency** — `jobs.insurance_company` is free text with variations ("AllState" vs "All State"). Dashboard carrier grouping uses `UPPER(TRIM())`. Long-term fix: normalize to `insurance_carriers` table FK.

2. **`recorded_by` is nullable** — Dev login doesn't create auth sessions, so we can't populate this. When real auth is implemented, update the payment form to pass the authenticated user's employee ID.

3. **Billing overview view performance** — With 81 jobs this is instant. At 500+ jobs, consider materializing or adding indexes. Not a concern now.

4. **The trigger fires 3 SUMs per payment operation** — Acceptable at current scale. If payments table grows to 1000+ rows per job (unlikely), optimize with a single CTE.

5. **Future invoice integration** — When invoicing is built, payments can optionally set `invoice_id` to link to a formal invoice. The trigger already handles both paths (with and without invoice_id). No migration needed at that point.
