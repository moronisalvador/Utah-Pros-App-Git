-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p3_document_templates_anon_bridge.sql
-- DB-Foundation Phase P3 — TEMPORARY prod-safety bridge (applied WITH the P3 closure)
--
-- WHY: P3's anon_policy_closure moves document_templates to authenticated-only, on the
--   assumption the RPC-based SignPage (get_sign_document_templates) is live everywhere.
--   It IS live on `dev`, but PRODUCTION (`main`) still runs the old SignPage that reads
--   document_templates DIRECTLY as anon. One shared Supabase → applying the closure without
--   this bridge would break the public signing page on utahpros.app until the dev→main
--   release ships the new SignPage.
--
-- WHAT: re-adds anon SELECT on document_templates under a DISTINCT policy name, applied
--   BEFORE the closure so anon read is never interrupted. Read-only (write stays closed).
--   document_templates is boilerplate legal text shown on public signing pages — no new
--   exposure vs. today.
--
-- REMOVE THIS after the dev→main release that ships the RPC-based SignPage to prod:
--   DROP POLICY "temp anon read document_templates (until prod SignPage release)"
--     ON public.document_templates;
-- ═════════════════════════════════════════════════════════════════════════════

CREATE POLICY "temp anon read document_templates (until prod SignPage release)"
  ON public.document_templates FOR SELECT TO anon USING (true);
