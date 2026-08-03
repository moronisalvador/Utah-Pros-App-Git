-- Roll back W-9 provider handoff metadata and checklist.
DROP FUNCTION IF EXISTS public.get_contractor_w9_tax_year_checklist(integer, text, text, text, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.contractor_w9_upsert_provider_handoff(uuid, integer, text, text, text, text, date, text);
DROP TABLE IF EXISTS public.contractor_w9_provider_handoffs;
