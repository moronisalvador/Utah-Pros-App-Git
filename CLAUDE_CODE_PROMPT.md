Read the file COLLECTIONS_ROUTE_SPEC.md in the repo root — that is your complete feature spec. It has been verified against the live Supabase database (project: glsmljpabrwonfiltiqm). Every table, column, constraint, trigger, view, enum value, and RLS policy has been audited. Trust the spec.

## What to build

A `/collections` route for the UPR Platform — a billing and payment tracking page with 3 tabs: Overview (claim-level AR table), Log Payment (payment entry form + recent payments), and Dashboard (KPIs and summaries).

## Execution order — do these in sequence

### Step 1: Run the 4 database migrations

Connect to Supabase project `glsmljpabrwonfiltiqm` and apply these migrations in order. The SQL is in the spec under "Migration Plan". Apply them as Supabase migrations:

1. `make_payments_invoice_nullable` — ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL
2. `fix_payment_trigger_for_nullable_invoice` — CREATE OR REPLACE FUNCTION update_invoice_paid() (the full function is in the spec — use it exactly)
3. `add_payments_anon_rls` — 4 CREATE POLICY statements for anon role on payments
4. `create_billing_overview_view` — CREATE OR REPLACE VIEW billing_overview

After each migration, verify it succeeded. After all 4, run a quick test:
```sql
SELECT * FROM billing_overview ORDER BY outstanding DESC LIMIT 5;
```
You should see 7-10 rows with total_invoiced summing to $95,129.01.

### Step 2: Add route and sidebar entry

**Before writing any code, read these files to understand existing patterns:**
- `src/pages/Jobs.jsx` and `src/pages/JobPage.jsx` — for page structure, tab pattern, table styling
- `src/components/Layout.jsx` and `src/components/Sidebar.jsx` — for nav/sidebar pattern
- `src/contexts/AuthContext.jsx` — for `canAccess()` function (needs `'collections'` key added)
- `src/index.css` and `design-tokens.css` — for the design system
- `DESIGN_SYSTEM.md` — for component patterns

Then:
- Add `'collections'` to the `canAccess()` function in AuthContext.jsx
- Add `/collections` route to the router (same pattern as other routes)
- Add "Collections" to the sidebar (use a dollar sign or similar icon, place it after "Production" or wherever billing fits in the nav)
- Create `src/pages/Collections.jsx` with 3 tabs: Overview, Log Payment, Dashboard

### Step 3: Build CollectionsOverview.jsx

`src/components/collections/CollectionsOverview.jsx`

This queries the `billing_overview` view via REST (same `db` pattern used throughout the app — check how other pages fetch data). Renders a table with columns specified in the spec. Each row expandable to show individual jobs from the `jobs` jsonb array. Use the existing dark theme and table patterns from Jobs.jsx.

Key details:
- REST endpoint: `/rest/v1/billing_overview?order=outstanding.desc`
- Totals row at bottom
- Outstanding cells: red background when > 0, green when = 0
- Search by client name or claim number
- Filter: All / Has Balance / Paid in Full

### Step 4: Build PaymentLogger.jsx

`src/components/collections/PaymentLogger.jsx`

Two-panel layout: form on left, recent payments on right (stacked on mobile).

**Form fields** — the spec has the exact field list with column mappings and CHECK constraint values. The dropdowns MUST use these exact values (lowercase with underscores for the database value, display-friendly labels in the UI):
- payer_type: `insurance`, `homeowner`, `mortgage_co`, `property_manager`, `other`
- payment_method: `check`, `ach`, `credit_card`, `wire`, `cash`, `insurance_direct`, `other`

**Job selector** — searchable dropdown. Query jobs with invoiced_value > 0:
```
GET /rest/v1/jobs?select=id,job_number,insured_name,division,invoiced_value,collected_value,claim_id&invoiced_value=gt.0&order=insured_name
```
Display as: `W-2603-006 — Trevor Merrill (water)`

**On submit:** POST to `/rest/v1/payments`. Do NOT include `invoice_id` (it's nullable now). Show success toast, reset form, refresh recent payments.

**Recent payments panel:** GET last 25 payments with job join. Each row has delete button with confirmation.

### Step 5: Build CollectionsDashboard.jsx

`src/components/collections/CollectionsDashboard.jsx`

KPI cards and summary tables. Queries the same `billing_overview` view and aggregates client-side. Plus a carrier breakdown and AR status breakdown as described in the spec.

### Step 6: Test the full flow

1. Go to `/collections` — verify Overview tab loads with the 7+ claim rows
2. Go to Log Payment tab — select a job, enter $100, source = Insurance, method = Check
3. Submit — verify success toast
4. Check Overview tab — verify that claim's collected value updated
5. Check the job in `/jobs/:jobId` Financial tab — verify `collected_value` shows $100
6. Go back to Log Payment, delete the test payment
7. Verify everything resets to 0

## Important context

- The app is at `utah-pros-app-git.pages.dev`, repo: `moronisalvador/Utah-Pros-App-Git`
- Supabase project: `glsmljpabrwonfiltiqm` (us-east-2)
- The app uses REST for all data queries, NOT Supabase JS client. Look at how existing pages construct fetch calls with `db.baseUrl` and `db.apiKey`.
- The app uses a dark UI theme. Follow existing design tokens.
- Dev login bypasses Auth. The app uses the anon key for REST.
- RLS is permissive (anon has access to everything via policies).
- Work on a `feature/collections` branch. Do not push to main.
