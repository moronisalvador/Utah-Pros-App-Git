-- ════════════════════════════════════════════════
-- MIGRATION: 20260717_account_deletion_requests
-- Phase: App Store Readiness Phase B (Apple Guideline 5.1.1(v) — in-app account deletion)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the "request my account be deleted" flow the App Store requires. UPR
--   employee accounts are created by an admin (there is no self-service signup),
--   and a person's job/claim/time records are a shared business record — so a
--   single employee cannot silently erase them. Instead this adds a small table
--   where an employee's deletion REQUEST is recorded, and a function they call
--   from Settings → My Account to file that request. Filing a request also drops a
--   notification in the admin notification bell so an admin can actually act on it
--   (deactivate access, handle data retention). This is the request-and-confirm
--   pattern Apple accepts for regulated / shared-record apps.
--
-- ADDITIVE-ONLY:
--   New table + two new SECURITY DEFINER functions only. No DROP / RENAME /
--   ALTER COLUMN of any live table. It only ever INSERTs into the existing
--   `notifications` table (the same insert `create_notification` already does).
--   No data change to existing rows.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.request_account_deletion(text);
--   DROP FUNCTION IF EXISTS public.get_my_account_deletion_request();
--   DROP TABLE IF EXISTS public.account_deletion_requests;
--   (All brand-new objects — dropping them fully reverts this migration. No
--    notification rows need cleanup; broadcast/admin bell rows are transient.)
-- ════════════════════════════════════════════════

-- ─── 1. The requests table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','actioned','denied')),
  notes        text,
  actioned_by  uuid REFERENCES public.employees(id),
  actioned_at  timestamptz
);

-- At most one OPEN (pending) request per employee — DB-level idempotency backstop
-- behind the RPC's own pre-check (guards the concurrent double-submit race).
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_pending
  ON public.account_deletion_requests (employee_id)
  WHERE status = 'pending';

-- Admin queue lookups (oldest pending first).
CREATE INDEX IF NOT EXISTS account_deletion_requests_status_idx
  ON public.account_deletion_requests (status, requested_at DESC);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders on top of Foundation's ALTER DEFAULT PRIVILEGES revoke: no
-- anon reach at the grant level either (RLS already denies anon — no anon policy).
REVOKE ALL ON public.account_deletion_requests FROM anon;

-- Employee sees their OWN rows; an active admin sees ALL rows.
DROP POLICY IF EXISTS account_deletion_requests_select ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_select ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.employees
      WHERE auth_user_id = auth.uid() AND role = 'admin' AND is_active
    )
  );

-- Employee may insert only a request for THEMSELVES (the RPC is the real writer,
-- but this scopes any direct authenticated insert to the caller's own row).
DROP POLICY IF EXISTS account_deletion_requests_insert ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_insert ON public.account_deletion_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid())
  );

-- Only an active admin may action/deny a request (set status/actioned_by/actioned_at).
DROP POLICY IF EXISTS account_deletion_requests_admin_update ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_admin_update ON public.account_deletion_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.employees
    WHERE auth_user_id = auth.uid() AND role = 'admin' AND is_active
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.employees
    WHERE auth_user_id = auth.uid() AND role = 'admin' AND is_active
  ));

-- ─── 2. Read RPC — the caller's own OPEN request (or none) ────────────────────
-- SECURITY DEFINER so a brand-new-table PostgREST cache lag can't 404 the read,
-- and so the client never needs table-level SELECT reach beyond its own row.
CREATE OR REPLACE FUNCTION public.get_my_account_deletion_request()
RETURNS public.account_deletion_requests
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.*
  FROM public.account_deletion_requests r
  JOIN public.employees e ON e.id = r.employee_id
  WHERE e.auth_user_id = auth.uid()
    AND r.status = 'pending'
  ORDER BY r.requested_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_account_deletion_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_deletion_request() TO authenticated, service_role;

-- ─── 3. Write RPC — file a deletion request (idempotent) ──────────────────────
-- Resolves the caller via auth.uid() → employees (the codebase's standard pattern).
-- If an open pending request already exists it is returned as-is (no duplicate row,
-- no repeat admin notification). A new request also drops an admin-targeted bell
-- notification (recipient-scoped so it is admin-only, NOT an org-wide broadcast).
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_notes text DEFAULT NULL)
RETURNS public.account_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp public.employees%ROWTYPE;
  v_row public.account_deletion_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_emp
  FROM public.employees
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: no employee for caller' USING errcode = '42501';
  END IF;

  -- Idempotent: an already-open request short-circuits (no dup, no re-notify).
  SELECT * INTO v_row
  FROM public.account_deletion_requests
  WHERE employee_id = v_emp.id AND status = 'pending'
  ORDER BY requested_at DESC
  LIMIT 1;

  IF v_row.id IS NOT NULL THEN
    RETURN v_row;
  END IF;

  -- New request. Guard the concurrent double-submit against the partial-unique index.
  BEGIN
    INSERT INTO public.account_deletion_requests (employee_id, notes)
    VALUES (v_emp.id, NULLIF(btrim(p_notes), ''))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row
    FROM public.account_deletion_requests
    WHERE employee_id = v_emp.id AND status = 'pending'
    ORDER BY requested_at DESC
    LIMIT 1;
    RETURN v_row;
  END;

  -- Admin visibility: one bell notification per active admin (recipient-targeted;
  -- get_notifications shows rows where recipient_id IS NULL OR = the viewer).
  INSERT INTO public.notifications (type, title, body, entity_type, entity_id, recipient_id)
  SELECT
    'account_deletion_requested',
    'Account deletion requested',
    COALESCE(v_emp.full_name, 'An employee')
      || ' requested that their account be deleted. Deactivate their access and handle data retention per policy.',
    'employee',
    v_emp.id,
    a.id
  FROM public.employees a
  WHERE a.role = 'admin' AND a.is_active;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated, service_role;

-- New table + RPCs added after initial deploy → refresh PostgREST's schema cache.
SELECT public.bust_postgrest_cache();
