-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p3_drop_document_templates_bridge.sql
-- DB-Foundation P3 — remove the temporary document_templates anon-read bridge.
--
-- The dev→main release (#355) is live: production's SignPage now reads templates via
-- get_sign_document_templates() (SECURITY DEFINER, anon-allowlisted), so the temporary
-- anon-read policy on document_templates is no longer needed. This completes the P3
-- anon closure — document_templates is now authenticated-only (RLS), matching every
-- other business table.
--
-- POLICY/GRANT-ONLY. No table/column/function change.
-- ROLLBACK (restore the bridge if prod signing regresses):
--   CREATE POLICY "temp anon read document_templates (until prod SignPage release)"
--     ON public.document_templates FOR SELECT TO anon USING (true);
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "temp anon read document_templates (until prod SignPage release)"
  ON public.document_templates;
