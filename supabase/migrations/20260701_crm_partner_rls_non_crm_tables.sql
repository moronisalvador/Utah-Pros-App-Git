-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Partner — lock non-CRM tables out of the permissive RLS baseline
--
-- Every table below currently has a single `USING (true)` policy for the
-- `authenticated` role (the existing convention: enforcement lives at the
-- frontend route-guard / RPC layer, not RLS). That was fine while every
-- authenticated session belonged to trusted internal staff. A `crm_partner`
-- is a real external account with a real authenticated Supabase session, so
-- it can call PostgREST directly against any table name it can guess —
-- frontend hiding alone does not stop that. This migration re-creates each
-- policy with an added `NOT is_crm_partner(auth.uid())` clause so a partner
-- session is denied at the database, not just hidden in the UI.
--
-- `contacts` is a special case: CRM leads embed the linked contact's
-- name/phone (`inbound_leads.contact_id` → `contacts`), so a partner needs
-- read access to *lead-linked* contacts specifically, not the whole customer/
-- vendor/adjuster table. Its ALL policy is split into a lead-scoped SELECT and
-- a fully-blocked INSERT/UPDATE/DELETE.
--
-- Every other authenticated role keeps exactly the same behavior as before
-- (`is_crm_partner()` is false for them, so the added clause is a no-op).
-- `anon`-role policies (a separate, pre-existing permissiveness issue) are
-- intentionally left untouched — out of scope for this change.
-- ─────────────────────────────────────────────────────────────────────────────

-- jobs ───────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_authenticated_jobs" ON jobs;
CREATE POLICY "allow_authenticated_jobs" ON jobs
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

-- claims ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "claims_auth_select" ON claims;
CREATE POLICY "claims_auth_select" ON claims
  FOR SELECT TO authenticated
  USING (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "claims_auth_insert" ON claims;
CREATE POLICY "claims_auth_insert" ON claims
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "claims_auth_update" ON claims;
CREATE POLICY "claims_auth_update" ON claims
  FOR UPDATE TO authenticated
  USING (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "claims_anon_delete" ON claims;
CREATE POLICY "claims_anon_delete" ON claims
  FOR DELETE TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()));

-- contacts — lead-scoped read, no direct writes for partners ────────────────
DROP POLICY IF EXISTS "allow_authenticated_contacts" ON contacts;

CREATE POLICY "contacts_authenticated_select" ON contacts
  FOR SELECT TO authenticated
  USING (
    NOT is_crm_partner(auth.uid())
    OR contacts.id IN (SELECT contact_id FROM inbound_leads WHERE contact_id IS NOT NULL)
  );

CREATE POLICY "contacts_authenticated_insert" ON contacts
  FOR INSERT TO authenticated
  WITH CHECK (NOT is_crm_partner(auth.uid()));

CREATE POLICY "contacts_authenticated_update" ON contacts
  FOR UPDATE TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

CREATE POLICY "contacts_authenticated_delete" ON contacts
  FOR DELETE TO authenticated
  USING (NOT is_crm_partner(auth.uid()));

-- invoices / estimates / financial line items ───────────────────────────────
DROP POLICY IF EXISTS "allow_authenticated_invoices" ON invoices;
CREATE POLICY "allow_authenticated_invoices" ON invoices
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "allow_authenticated_estimates" ON estimates;
CREATE POLICY "allow_authenticated_estimates" ON estimates
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "allow_authenticated_estimate_line_items" ON estimate_line_items;
CREATE POLICY "allow_authenticated_estimate_line_items" ON estimate_line_items
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "allow_authenticated_invoice_line_items" ON invoice_line_items;
CREATE POLICY "allow_authenticated_invoice_line_items" ON invoice_line_items
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "allow_authenticated_job_costs" ON job_costs;
CREATE POLICY "allow_authenticated_job_costs" ON job_costs
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "allow_authenticated_payments" ON payments;
CREATE POLICY "allow_authenticated_payments" ON payments
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "allow_authenticated_vendor_invoices" ON vendor_invoices;
CREATE POLICY "allow_authenticated_vendor_invoices" ON vendor_invoices
  FOR ALL TO authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "anon_all" ON job_supplements;
CREATE POLICY "anon_all" ON job_supplements
  FOR ALL TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()))
  WITH CHECK (NOT is_crm_partner(auth.uid()));

-- timesheet / payroll ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "jte_select_all" ON job_time_entries;
CREATE POLICY "jte_select_all" ON job_time_entries
  FOR SELECT TO anon, authenticated
  USING (NOT is_crm_partner(auth.uid()));

-- job_documents — field photos/notes, unrelated to CRM ──────────────────────
DROP POLICY IF EXISTS "job_documents_select" ON job_documents;
CREATE POLICY "job_documents_select" ON job_documents
  FOR SELECT TO public
  USING (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "job_documents_insert" ON job_documents;
CREATE POLICY "job_documents_insert" ON job_documents
  FOR INSERT TO public
  WITH CHECK (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "job_documents_update" ON job_documents;
CREATE POLICY "job_documents_update" ON job_documents
  FOR UPDATE TO public
  USING (NOT is_crm_partner(auth.uid()));

DROP POLICY IF EXISTS "job_documents_delete" ON job_documents;
CREATE POLICY "job_documents_delete" ON job_documents
  FOR DELETE TO public
  USING (NOT is_crm_partner(auth.uid()));
