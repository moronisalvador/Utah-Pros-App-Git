-- ════════════════════════════════════════════════
-- MIGRATION: 20260713_uxq_fb_save_estimate_lines
-- Phase: UX-Quality F-B (backend foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds one database helper that saves all the line items on an estimate (or an
--   invoice) in a single, all-or-nothing step. Today the editors save each line
--   with its own separate database write; a dropped connection mid-save can leave
--   the document with a mix of old and new lines and a wrong total. This helper
--   replaces every line for the document in one call, so the document is always
--   internally consistent, and the existing total-rollup trigger recomputes the
--   subtotal exactly once the lines settle.
--
-- ADDITIVE-ONLY:
--   New SECURITY DEFINER function only. No table DROP/RENAME/ALTER COLUMN. It
--   NEVER writes line_total (a GENERATED column on both estimate_line_items and
--   invoice_line_items — the database computes it as quantity * unit_price).
--   Least-privilege grants (authenticated + service_role; never anon).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.save_estimate_lines(uuid, jsonb, text);
--   (EstimateEditor / InvoiceEditor keep working on their per-line db.update
--    writes until swapped to this RPC, so dropping it is safe pre-cutover.)
-- ════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_estimate_lines(
  p_id    uuid,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_kind  text  DEFAULT 'estimate'   -- 'estimate' (default, keeps the 2-arg call valid) | 'invoice'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'save_estimate_lines: p_id is required';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('estimate', 'invoice') THEN
    RAISE EXCEPTION 'save_estimate_lines: p_kind must be ''estimate'' or ''invoice'' (got %)', p_kind;
  END IF;

  -- Atomic replace inside one function body. line_total is GENERATED on both
  -- tables and is deliberately never inserted. The AFTER INSERT/DELETE rollup
  -- trigger (recompute_estimate_from_lines / recompute_invoice_from_lines) keeps
  -- the parent subtotal/amount/total in sync.
  IF p_kind = 'estimate' THEN
    DELETE FROM public.estimate_line_items WHERE estimate_id = p_id;

    INSERT INTO public.estimate_line_items
      (estimate_id, description, xactimate_code, quantity, unit, unit_price,
       qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order)
    SELECT
      p_id,
      COALESCE(elem->>'description', ''),
      elem->>'xactimate_code',
      COALESCE(NULLIF(elem->>'quantity', '')::numeric, 1),
      elem->>'unit',
      COALESCE(NULLIF(elem->>'unit_price', '')::numeric, 0),
      elem->>'qbo_item_id',
      elem->>'qbo_item_name',
      elem->>'qbo_class_id',
      elem->>'qbo_class_name',
      COALESCE(NULLIF(elem->>'sort_order', '')::int, (n - 1)::int)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS arr(elem, n);

    SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.sort_order, e.created_at), '[]'::jsonb)
      INTO v_result
      FROM public.estimate_line_items e
     WHERE e.estimate_id = p_id;
  ELSE
    DELETE FROM public.invoice_line_items WHERE invoice_id = p_id;

    INSERT INTO public.invoice_line_items
      (invoice_id, description, xactimate_code, quantity, unit, unit_price,
       qbo_item_id, qbo_item_name, qbo_class_id, qbo_class_name, sort_order)
    SELECT
      p_id,
      COALESCE(elem->>'description', ''),
      elem->>'xactimate_code',
      COALESCE(NULLIF(elem->>'quantity', '')::numeric, 1),
      elem->>'unit',
      COALESCE(NULLIF(elem->>'unit_price', '')::numeric, 0),
      elem->>'qbo_item_id',
      elem->>'qbo_item_name',
      elem->>'qbo_class_id',
      elem->>'qbo_class_name',
      COALESCE(NULLIF(elem->>'sort_order', '')::int, (n - 1)::int)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS arr(elem, n);

    SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.sort_order, e.created_at), '[]'::jsonb)
      INTO v_result
      FROM public.invoice_line_items e
     WHERE e.invoice_id = p_id;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_estimate_lines(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_estimate_lines(uuid, jsonb, text) TO authenticated, service_role;
