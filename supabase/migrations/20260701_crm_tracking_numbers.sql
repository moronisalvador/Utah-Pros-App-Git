-- ════════════════════════════════════════════════
-- Migration: CRM tracking-number → campaign labels
-- ════════════════════════════════════════════════
-- WHY: CallRail leaves `campaign`/`source` empty on direct dials, so the
--   tracking number the caller dialed IS the ad-source identity. UPR runs
--   several tracking numbers; this lets staff LABEL each number as a campaign
--   ("Google Ads", "Yard signs") and show that label on every Call Log row.
--
-- Additive: one new table (RLS-enabled at creation) + two RPCs. org_id-scoped
-- for the multi-tenant seam (one org today).
-- ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crm_tracking_numbers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- org_id is always supplied by set_tracking_number_label (Postgres forbids a
  -- subquery DEFAULT); the table is only ever written through that RPC.
  org_id          uuid NOT NULL,
  tracking_number text NOT NULL,
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tracking_number)
);

ALTER TABLE public.crm_tracking_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_tracking_numbers_all ON public.crm_tracking_numbers;
CREATE POLICY crm_tracking_numbers_all ON public.crm_tracking_numbers
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Every DISTINCT tracking number seen in inbound_leads + its label + call count,
-- so the UI lists all numbers (even unlabeled ones) most-active first.
CREATE OR REPLACE FUNCTION public.get_tracking_numbers()
RETURNS TABLE (tracking_number text, label text, call_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT il.tracking_number, tn.label, count(*) AS call_count
  FROM inbound_leads il
  LEFT JOIN crm_tracking_numbers tn ON tn.tracking_number = il.tracking_number
  WHERE il.tracking_number IS NOT NULL
  GROUP BY il.tracking_number, tn.label
  ORDER BY count(*) DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tracking_numbers() TO anon, authenticated;

-- Set/clear the campaign label for a tracking number (upsert on the org's row).
CREATE OR REPLACE FUNCTION public.set_tracking_number_label(
  p_tracking_number text,
  p_label           text
)
RETURNS public.crm_tracking_numbers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := (SELECT id FROM crm_orgs ORDER BY created_at LIMIT 1);
  v_row crm_tracking_numbers;
BEGIN
  IF NULLIF(btrim(p_tracking_number), '') IS NULL THEN
    RAISE EXCEPTION 'tracking_number is required';
  END IF;

  INSERT INTO crm_tracking_numbers (org_id, tracking_number, label)
  VALUES (v_org, btrim(p_tracking_number), NULLIF(btrim(p_label), ''))
  ON CONFLICT (org_id, tracking_number)
  DO UPDATE SET label = EXCLUDED.label, updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO system_events (event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('crm_tracking_number_labeled', 'crm_tracking_number', v_row.id, NULL,
          jsonb_build_object('tracking_number', v_row.tracking_number, 'label', v_row.label));

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_tracking_number_label(text, text) TO anon, authenticated;
