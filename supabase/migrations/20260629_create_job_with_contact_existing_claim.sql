-- ════════════════════════════════════════════════
-- Migration: create_job_with_contact — optional existing-claim support
-- Date: 2026-06-29
--
-- WHAT THIS DOES (plain language):
--   Lets a new job be filed under an EXISTING claim instead of always
--   minting a brand-new CLM-… claim. Adds one optional parameter,
--   p_existing_claim_id. When it is NULL (the default, and what every
--   current caller sends) the function behaves exactly as before. When a
--   claim id is supplied, the function reuses that claim and skips creating
--   a new one — keeping the whole create in a single atomic RPC.
--
-- WHY DROP + RECREATE:
--   Adding a parameter changes the Postgres function signature, which would
--   create a SECOND overload. Two overloads make PostgREST RPC calls
--   ambiguous (PGRST203 / HTTP 300) — the exact bug that once broke
--   clock_appointment_action. So we DROP the existing 31-arg signature and
--   CREATE the 32-arg version in this one migration. All callers
--   (src/pages/tech/TechNewJob.jsx, src/components/CreateJobModal.jsx) use
--   NAMED arguments, so they bind to the new function with
--   p_existing_claim_id defaulting to NULL and keep working untouched.
--
-- SAFETY:
--   Preserves SECURITY DEFINER + search_path and re-grants EXECUTE to
--   anon, authenticated, service_role (PUBLIC execute is automatic on
--   CREATE). Backward-compatible, so already-live frontend code is fine.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_job_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, integer, text, date, date, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, text
);

CREATE OR REPLACE FUNCTION public.create_job_with_contact(
  p_contact_id uuid DEFAULT NULL::uuid,
  p_contact_name text DEFAULT NULL::text,
  p_contact_phone text DEFAULT NULL::text,
  p_contact_email text DEFAULT NULL::text,
  p_contact_role text DEFAULT 'homeowner'::text,
  p_billing_address text DEFAULT NULL::text,
  p_billing_city text DEFAULT NULL::text,
  p_billing_state text DEFAULT NULL::text,
  p_billing_zip text DEFAULT NULL::text,
  p_insurance_carrier text DEFAULT NULL::text,
  p_policy_number text DEFAULT NULL::text,
  p_division text DEFAULT 'water'::text,
  p_source text DEFAULT 'insurance'::text,
  p_priority integer DEFAULT 3,
  p_type_of_loss text DEFAULT NULL::text,
  p_date_of_loss date DEFAULT NULL::date,
  p_target_completion date DEFAULT NULL::date,
  p_address text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_state text DEFAULT NULL::text,
  p_zip text DEFAULT NULL::text,
  p_insurance_company text DEFAULT NULL::text,
  p_claim_number text DEFAULT NULL::text,
  p_job_policy_number text DEFAULT NULL::text,
  p_adjuster_name text DEFAULT NULL::text,
  p_adjuster_phone text DEFAULT NULL::text,
  p_adjuster_email text DEFAULT NULL::text,
  p_cat_code text DEFAULT NULL::text,
  p_project_manager_id uuid DEFAULT NULL::uuid,
  p_lead_tech_id uuid DEFAULT NULL::uuid,
  p_internal_notes text DEFAULT NULL::text,
  p_existing_claim_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_contact_id uuid; v_claim_id uuid; v_job_id uuid;
  v_job jsonb; v_contact jsonb; v_claim_number text; v_loss_type text; v_has_any_address boolean;
BEGIN
  IF p_contact_id IS NOT NULL THEN
    v_contact_id := p_contact_id;
    UPDATE contacts SET billing_address=COALESCE(billing_address,p_billing_address),billing_city=COALESCE(billing_city,p_billing_city),
      billing_state=COALESCE(billing_state,p_billing_state),billing_zip=COALESCE(billing_zip,p_billing_zip),updated_at=now()
    WHERE id=v_contact_id AND billing_address IS NULL AND p_billing_address IS NOT NULL;
  ELSE
    INSERT INTO contacts(name,phone,email,role,billing_address,billing_city,billing_state,billing_zip,insurance_carrier,policy_number,preferred_contact_method,preferred_language,opt_in_status,dnd,created_at,updated_at)
    VALUES(p_contact_name,p_contact_phone,NULLIF(p_contact_email,''),COALESCE(p_contact_role,'homeowner'),NULLIF(p_billing_address,''),NULLIF(p_billing_city,''),NULLIF(p_billing_state,''),NULLIF(p_billing_zip,''),NULLIF(p_insurance_carrier,''),NULLIF(p_policy_number,''),'sms','en',false,false,now(),now())
    RETURNING id INTO v_contact_id;
  END IF;

  v_loss_type := CASE
    WHEN p_type_of_loss ILIKE '%water%' OR p_division='water' THEN 'water'
    WHEN p_type_of_loss ILIKE '%fire%' OR p_division='fire' THEN 'fire'
    WHEN p_type_of_loss ILIKE '%mold%' OR p_division='mold' THEN 'mold'
    WHEN p_type_of_loss ILIKE '%storm%' OR p_type_of_loss ILIKE '%wind%' THEN 'storm'
    WHEN p_type_of_loss ILIKE '%sewer%' THEN 'sewer'
    WHEN p_division='contents' THEN 'contents' ELSE 'water' END;

  -- ═══ CLAIM: reuse an existing one, or mint a fresh CLM-… ═══
  IF p_existing_claim_id IS NOT NULL THEN
    -- File this job under an EXISTING claim: reuse it, do NOT create a new claim.
    -- (The job's denormalized insurance fields below still come from the
    --  passed params, which the client prefills from this claim.)
    v_claim_id := p_existing_claim_id;
    SELECT claim_number INTO v_claim_number FROM claims WHERE id = v_claim_id;
  ELSE
    v_claim_number := 'CLM-'||to_char(now(),'YYMM')||'-'||lpad(nextval('claim_number_seq')::text,3,'0');
    INSERT INTO claims(claim_number,insurance_claim_number,contact_id,insurance_carrier,policy_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip,loss_type,status,created_at,updated_at)
    VALUES(v_claim_number,NULLIF(p_claim_number,''),v_contact_id,NULLIF(p_insurance_company,''),NULLIF(p_job_policy_number,''),p_date_of_loss,NULLIF(p_address,''),NULLIF(p_city,''),NULLIF(p_state,''),NULLIF(p_zip,''),v_loss_type,'open',now(),now())
    RETURNING id INTO v_claim_id;
  END IF;

  -- ═══ CAST division AND source to their enum types ═══
  INSERT INTO jobs(division,source,phase,priority,status,insured_name,client_phone,client_email,address,city,state,zip,type_of_loss,date_of_loss,target_completion,insurance_company,claim_number,policy_number,adjuster_name,adjuster_phone,adjuster_email,cat_code,project_manager_id,lead_tech_id,internal_notes,primary_contact_id,claim_id,created_at,updated_at)
  VALUES(p_division::job_division, p_source::job_source, 'job_received',p_priority,'active',
    COALESCE(p_contact_name,(SELECT name FROM contacts WHERE id=v_contact_id)),
    COALESCE(p_contact_phone,(SELECT phone FROM contacts WHERE id=v_contact_id)),
    COALESCE(p_contact_email,(SELECT email FROM contacts WHERE id=v_contact_id)),
    NULLIF(p_address,''),NULLIF(p_city,''),NULLIF(p_state,''),NULLIF(p_zip,''),
    NULLIF(p_type_of_loss,''),p_date_of_loss,p_target_completion,
    NULLIF(p_insurance_company,''),NULLIF(p_claim_number,''),NULLIF(p_job_policy_number,''),
    NULLIF(p_adjuster_name,''),NULLIF(p_adjuster_phone,''),NULLIF(p_adjuster_email,''),NULLIF(p_cat_code,''),
    p_project_manager_id,p_lead_tech_id,NULLIF(p_internal_notes,''),
    v_contact_id,v_claim_id,now(),now())
  RETURNING id INTO v_job_id;

  INSERT INTO contact_jobs(contact_id,job_id,role,is_primary) VALUES(v_contact_id,v_job_id,'primary_client',true);

  IF p_address IS NOT NULL AND p_address!='' THEN
    IF NOT EXISTS(SELECT 1 FROM contact_addresses ca WHERE ca.contact_id=v_contact_id AND ca.address=p_address) THEN
      SELECT EXISTS(SELECT 1 FROM contact_addresses WHERE contact_id=v_contact_id) INTO v_has_any_address;
      INSERT INTO contact_addresses(contact_id,label,address,city,state,zip,is_billing)
      VALUES(v_contact_id,'service',p_address,NULLIF(p_city,''),NULLIF(p_state,''),NULLIF(p_zip,''),NOT v_has_any_address);
      IF NOT v_has_any_address THEN
        UPDATE contacts SET billing_address=p_address,billing_city=NULLIF(p_city,''),billing_state=NULLIF(p_state,''),billing_zip=NULLIF(p_zip,''),updated_at=now()
        WHERE id=v_contact_id AND billing_address IS NULL;
      END IF;
    END IF;
  END IF;

  SELECT to_jsonb(j) INTO v_job FROM(SELECT * FROM jobs WHERE id=v_job_id)j;
  SELECT to_jsonb(c) INTO v_contact FROM(SELECT * FROM contacts WHERE id=v_contact_id)c;
  RETURN jsonb_build_object('job',v_job,'contact',v_contact,'claim_id',v_claim_id,'claim_number',v_claim_number);
END;$function$;

GRANT EXECUTE ON FUNCTION public.create_job_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, integer, text, date, date, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, text, uuid
) TO anon, authenticated, service_role;
