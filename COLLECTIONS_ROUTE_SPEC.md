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
| `invoice_id` | uuid | **YES** | — | FK → invoices. **Already made nullable** |
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

**Existing trigger on payments:**
```
trg_payment_update_invoice → INSERT/UPDATE/DELETE → update_invoice_paid()
```

**`update_invoice_paid()` — ALREADY FIXED** to handle NULL invoice_id and update `jobs.collected_value` directly by `job_id` (not through invoices join). Also auto-updates `jobs.ar_status`.

**RLS policies — ALREADY APPLIED:** 4 anon policies (SELECT/INSERT/UPDATE/DELETE) + 1 authenticated (ALL).

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

### `billing_overview` view — ALREADY CREATED

Returns 7 claims with $95,129.01 total invoiced. Groups jobs by claim, splits mit/recon.

Columns: `claim_id`, `claim_number`, `claim_carrier`, `date_of_loss`, `claim_status`, `client`, `carrier`, `mit_invoiced`, `mit_collected`, `recon_invoiced`, `recon_collected`, `total_invoiced`, `total_collected`, `outstanding`, `job_count`, `jobs` (jsonb array), `last_updated`.

The `jobs` jsonb array contains per-job objects: `job_id`, `job_number`, `division`, `invoiced`, `collected`, `ar_status`, `phase`.

---

## UI Spec

### Route: `/collections`

Nav key: `'collections'` (already in nav_permissions, route already in App.jsx, sidebar entry already exists).

**3 tab views** (same tab pattern as JobPage):

---

### Tab 1: "Overview" (default)

**Data source:** `billing_overview` view via REST:
```javascript
const data = await db.select('billing_overview', 'order=outstanding.desc');
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
```javascript
await db.insert('payments', { job_id, amount, payment_date, payer_type, payment_method, reference_number, is_deductible, is_depreciation_release, notes });
```
- `invoice_id` is omitted (NULL) — nullable now
- `recorded_by` is omitted for now (no auth session to populate it)
- Success toast: "Payment of $X,XXX.XX recorded for [job_number]"
- Reset form, refresh recent payments list

**Right section: Recent Payments**

Query:
```javascript
const payments = await db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)');
```

Mini table: Date, Job #, Client, Amount, Source, Method, Ref #. Each row has delete button (with confirmation modal) that sends:
```javascript
await db.delete('payments', `id=eq.${paymentId}`);
```

---

### Tab 3: "Dashboard"

**KPI Cards (top):**
All computed from `billing_overview` view rows summed client-side:

| Card | Value | Color |
|------|-------|-------|
| Total Billed | sum of total_invoiced | blue |
| Total Collected | sum of total_collected | green |
| Outstanding | sum of outstanding | red |
| Collection Rate | collected / billed | amber |
| Mit Billed | sum of mit_invoiced | light blue |
| Recon Billed | sum of recon_invoiced | green |

**Outstanding by Carrier table:**
Group `billing_overview` by `carrier` (normalize with `.toUpperCase().trim()`) → show: Carrier, # Claims, Billed, Collected, Outstanding.

**AR Status breakdown:**
Query jobs directly:
```javascript
const arJobs = await db.select('jobs', 'select=ar_status,invoiced_value,collected_value&invoiced_value=gt.0');
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
src/pages/Collections.jsx           — REPLACE (3-tab shell)
src/components/collections/
  CollectionsOverview.jsx            — Tab 1: claim-level billing table
  PaymentLogger.jsx                  — Tab 2: form + recent payments list
  CollectionsDashboard.jsx           — Tab 3: KPIs and summaries
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
