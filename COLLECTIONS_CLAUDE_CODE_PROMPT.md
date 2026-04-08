# Collections Page — Claude Code Build Prompt

Read the file `COLLECTIONS_ROUTE_SPEC.md` in the repo root — that is the feature spec. The database migrations have already been applied and verified. **Do NOT run any SQL migrations.**

## What already exists — DO NOT recreate these

The following are **already wired up**. Do NOT modify these files for routing/nav/permissions:

- **`src/App.jsx`** — already has `/collections` route with `<FeatureRoute flag="page:collections">` wrapping
- **`src/components/Sidebar.jsx`** — already has "Collections" nav entry with `IconCollections` icon and `featureFlag: 'page:collections'`
- **`src/contexts/AuthContext.jsx`** — `canAccess('collections')` already works. `canAccess()` is generic — it queries `nav_permissions` rows dynamically, no hardcoded keys needed
- **Feature flag** `page:collections` — already enabled in the database
- **Database** — all 4 migrations already applied: `invoice_id` is nullable, `update_invoice_paid()` trigger is fixed, anon RLS policies on payments exist, `billing_overview` view exists and returns 7 claims totaling $95,129.01

## What to build

Replace the existing `src/pages/Collections.jsx` with a completely new implementation. The current file is an old job-level A/R tracker that patches `jobs.collected_value` directly. The new architecture uses the `payments` table as the source of truth, with a trigger that auto-updates `jobs.collected_value` and `jobs.ar_status`.

Create 3 sub-components in `src/components/collections/`.

## CRITICAL — Data access pattern

**Use the `db` helper from `useAuth()` for ALL data operations.** Do NOT use raw `fetch()`. The app has a full REST client in `src/lib/supabase.js` with retry logic and timeout handling.

```javascript
const { db } = useAuth();

// SELECT — db.select(table, queryString)
const data = await db.select('billing_overview', 'order=outstanding.desc');
const payments = await db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)');
const jobs = await db.select('jobs', 'select=id,job_number,insured_name,division,invoiced_value,collected_value,claim_id&invoiced_value=gt.0&order=insured_name');

// INSERT — db.insert(table, object) → returns array with inserted row
const result = await db.insert('payments', { job_id, amount, payment_date, payer_type, payment_method, reference_number, is_deductible, is_depreciation_release, notes });

// DELETE — db.delete(table, filterString)
await db.delete('payments', `id=eq.${paymentId}`);
```

**Read `src/lib/supabase.js` first** to confirm these method signatures. All methods throw on error with descriptive messages. Always wrap in try/catch.

**Toast pattern** (never use `alert()` or `confirm()`):
```javascript
window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Payment recorded', type: 'success' } }));
```

## CRITICAL — Read files before editing

Before writing ANY code, read these files to understand existing patterns:
- `src/pages/Jobs.jsx` — page structure, table styling, card patterns
- `src/pages/JobPage.jsx` — tab navigation pattern
- `src/components/Layout.jsx` — toast system, overall layout
- `src/lib/supabase.js` — the db helper (select, insert, update, delete, rpc methods)
- `src/index.css` — design system, look for `.ar-*` CSS classes (the old Collections page used many — check if they still exist and reuse where appropriate)
- `src/design-tokens.css` — CSS variables

## Execution order

### Step 1: Replace Collections.jsx

Delete the entire contents of `src/pages/Collections.jsx` and replace with a clean 3-tab page shell:
- Tab 1: "Overview" (default) → renders `CollectionsOverview`
- Tab 2: "Log Payment" → renders `PaymentLogger`
- Tab 3: "Dashboard" → renders `CollectionsDashboard`

Use the same tab pattern as `JobPage.jsx` (URL-hash or state-based tabs, same styling).

### Step 2: Build CollectionsOverview.jsx

`src/components/collections/CollectionsOverview.jsx`

Queries `billing_overview` view via `db.select('billing_overview', 'order=outstanding.desc')`.

**Table columns:** Client, Claim #, Carrier, Mit Invoiced, Mit Collected, Recon Invoiced, Recon Collected, Total, Collected, Outstanding.

**Key behaviors:**
- Default sort: outstanding DESC (biggest balances first)
- Search: filter client name or claim number (client-side)
- Filter pills: "All" / "Has Balance" / "Paid in Full"
- Expandable rows: click a row → show the `jobs` jsonb array inline as cards (job_number, division, invoiced, collected, ar_status)
- Clicking a job card → `navigate('/jobs/${jobId}')`
- Totals row pinned at bottom
- Outstanding cells: red when > 0, green when = 0
- Mobile: card layout (hide table, show stacked cards)

### Step 3: Build PaymentLogger.jsx

`src/components/collections/PaymentLogger.jsx`

Two-panel layout: form on left, recent payments on right (stacked on mobile).

**Form fields (mapped to `payments` table columns):**

| Field | Type | Column | Required | Notes |
|-------|------|--------|----------|-------|
| Job | searchable select | `job_id` | YES | Query: `db.select('jobs', 'select=id,job_number,insured_name,division,invoiced_value,collected_value,claim_id&invoiced_value=gt.0&order=insured_name')`. Display: `W-2603-006 — Trevor Merrill (water)` |
| Amount | currency input | `amount` | YES | Must be > 0 (DB CHECK constraint) |
| Payment Date | date picker | `payment_date` | YES | Default: today |
| Source | select | `payer_type` | YES | **MUST use exact DB CHECK values:** `insurance` → "Insurance", `homeowner` → "Homeowner", `mortgage_co` → "Mortgage Co", `property_manager` → "Property Manager", `other` → "Other" |
| Method | select | `payment_method` | NO | **MUST use exact DB CHECK values:** `check` → "Check", `ach` → "ACH", `credit_card` → "Credit Card", `wire` → "Wire", `cash` → "Cash", `insurance_direct` → "Insurance Direct", `other` → "Other" |
| Reference # | text | `reference_number` | NO | Check number, EFT ref, etc. |
| Is Deductible | toggle | `is_deductible` | NO | Default: false |
| Is Depreciation Release | toggle | `is_depreciation_release` | NO | Default: false |
| Notes | textarea | `notes` | NO | |

**On submit:**
```javascript
await db.insert('payments', { job_id, amount, payment_date, payer_type, payment_method, reference_number, is_deductible, is_depreciation_release, notes });
```
- Do NOT include `invoice_id` (it's nullable, omit entirely)
- Do NOT include `recorded_by` (no auth session in dev)
- Success toast: "Payment of $X,XXX.XX recorded for [job_number]"
- Reset form, refresh recent payments list

**Recent payments panel:**
```javascript
const payments = await db.select('payments', 'order=created_at.desc&limit=25&select=*,jobs(job_number,insured_name,division)');
```

Mini table/cards: Date, Job #, Client, Amount, Source, Method, Ref #. Each row has delete button — use a confirmation modal (NOT `confirm()`), then:
```javascript
await db.delete('payments', `id=eq.${paymentId}`);
```

### Step 4: Build CollectionsDashboard.jsx

`src/components/collections/CollectionsDashboard.jsx`

**KPI Cards (top row):**
Fetch billing_overview and aggregate client-side:

| Card | Computation | Color |
|------|-------------|-------|
| Total Billed | sum of total_invoiced | blue |
| Total Collected | sum of total_collected | green |
| Outstanding | sum of outstanding | red |
| Collection Rate | collected / billed as % | amber |
| Mit Billed | sum of mit_invoiced | light blue |
| Recon Billed | sum of recon_invoiced | green |

**Outstanding by Carrier table:**
Group billing_overview rows by `carrier` (normalize with `.toUpperCase().trim()`) → Carrier, # Claims, Billed, Collected, Outstanding.

**AR Status breakdown:**
```javascript
const arJobs = await db.select('jobs', 'select=ar_status,invoiced_value,collected_value&invoiced_value=gt.0');
```
Group client-side by `ar_status` → Status, Count, Invoiced, Collected, Outstanding.

### Step 5: CSS

Check `src/index.css` for existing `.ar-*` CSS classes from the old Collections page. Reuse them where they fit the new layout. Add new styles as needed for the 3-tab layout, billing overview table, payment form, and dashboard cards.

All CSS changes that affect mobile must use `@media (max-width: 768px)`. Do NOT change desktop UI, layout, colors, or spacing of other pages.

### Step 6: Test the full flow

1. Navigate to `/collections` — verify Overview tab loads with 7 claim rows
2. Go to Log Payment tab — select a job, enter $100, Source = Insurance, Method = Check
3. Submit — verify success toast
4. Check Overview tab — verify that claim's collected value updated
5. Navigate to `/jobs/:jobId` Financial tab — verify `collected_value` shows $100
6. Go back to Log Payment, delete the test payment
7. Verify everything resets

## Rules — NO EXCEPTIONS

1. **Read files from disk before editing.** Never rely on memory.
2. **Use `write_file` for full rewrites** (edit_file fails on CRLF files).
3. **Never use `alert()` or `confirm()`** — use the `upr:toast` event pattern.
4. **Always use `const { db } = useAuth()`** — never import db directly.
5. **Work on `dev` branch only.** Never touch main.
6. **All CSS changes must use `@media (max-width: 768px)`** unless provably safe on desktop.
7. **Commit and deploy after every 2-3 files.** Test on real iPhone before continuing.

## Design context

- The app uses a **dark UI theme**. Follow existing design tokens from `design-tokens.css`.
- The existing `get_ar_jobs` RPC still exists — leave it. It's not used by the new page.
- Component file structure:
```
src/pages/Collections.jsx                    — REPLACE (3-tab shell)
src/components/collections/                  — CREATE directory
  CollectionsOverview.jsx                    — Tab 1
  PaymentLogger.jsx                          — Tab 2
  CollectionsDashboard.jsx                   — Tab 3
```

## NOT in scope

- Invoice generation (invoices table stays empty)
- PDF output
- Payment reminders / automated follow-ups
- QuickBooks sync
- Editing job financial fields from this page (stays on JobPage Financial tab)
- Creating/editing claims from this page
- Modifying App.jsx, Sidebar.jsx, or AuthContext.jsx
