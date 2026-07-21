-- ════════════════════════════════════════════════
-- MIGRATION: 20260721_customer_activity_and_claim_creator
-- Phase: n/a (standalone production fix)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The Customer page's Activity tab was showing "No activity yet" even when
--   the CRM side had a rich history for the same person, and claims had no
--   record of who created them. This migration (1) adds a `created_by`
--   column to `claims` so new claims record the employee who filed them, (2)
--   threads that value through `create_job_with_contact` (the only place
--   claims are created), and (3) adds `claim` and `phase_change` arms to the
--   existing `get_contact_activity` feed (the same feed the CRM contact
--   drawer already uses) so claim creation and job phase changes — each with
--   who did it — now show up for both the CRM and the Customer page once the
--   frontend is pointed at this RPC.
--
-- ADDITIVE-ONLY:
--   New nullable column on `claims` (no backfill possible for historical
--   rows — their creator was never recorded). `create_job_with_contact` gets
--   one new trailing DEFAULT NULL parameter, DROP+CREATE per this project's
--   established precedent (20260629 migration) to avoid a PostgREST
--   overload ambiguity; all existing callers use named arguments so they
--   keep working unchanged. `get_contact_activity`'s signature is UNCHANGED
--   (frozen per crm-wave-ownership.md §3; this is a function-body-only
--   CREATE OR REPLACE, precedented by the 2026-07-21 standalone-production-fix
--   amendment in that same manifest) — it only adds two new UNION ALL arms.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   1. `ALTER TABLE public.claims DROP COLUMN created_by;`
--   2. Re-run the prior `create_job_with_contact` body from
--      20260629_create_job_with_contact_existing_claim.sql (32-arg version,
--      no p_created_by).
--   3. Re-run the prior `get_contact_activity` body from
--      20260721_crm_unlinked_lead_activity.sql (without the claim/
--      phase_change arms).
-- ════════════════════════════════════════════════

-- 1. Claim creator attribution (additive column)
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.employees(id);

-- 2. Thread the current employee through claim creation.
--    DROP + CREATE (not a plain CREATE OR REPLACE) mirrors the 20260629
--    migration's own documented reasoning: adding a parameter changes the
--    function's identity, so we drop the known 32-arg signature first to
--    avoid a second PostgREST-ambiguous overload.
DROP FUNCTION IF EXISTS public.create_job_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, integer, text, date, date, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, text, uuid
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
  p_existing_claim_id uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid
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
    INSERT INTO claims(claim_number,insurance_claim_number,contact_id,insurance_carrier,policy_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip,loss_type,status,created_by,created_at,updated_at)
    VALUES(v_claim_number,NULLIF(p_claim_number,''),v_contact_id,NULLIF(p_insurance_company,''),NULLIF(p_job_policy_number,''),p_date_of_loss,NULLIF(p_address,''),NULLIF(p_city,''),NULLIF(p_state,''),NULLIF(p_zip,''),v_loss_type,'open',p_created_by,now(),now())
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

-- Managed-Supabase re-applies EXECUTE TO PUBLIC on every CREATE — explicit revoke first (database-standard.md §1).
REVOKE EXECUTE ON FUNCTION public.create_job_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, integer, text, date, date, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, text, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_job_with_contact(
  uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, integer, text, date, date, text, text, text, text, text, text, text,
  text, text, text, text, uuid, uuid, text, uuid, uuid
) TO authenticated, service_role;

-- 3. Add `claim` + `phase_change` arms to the existing contact-activity feed
--    (function-body-only replace; signature unchanged — see header).
CREATE OR REPLACE FUNCTION public.get_contact_activity(p_contact_id uuid)
 RETURNS TABLE(activity_type text, occurred_at timestamp with time zone, title text, body text, meta jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    'lead'::text,
    COALESCE(il.occurred_at, il.created_at),
    CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END,
    COALESCE(il.transcription, il.notes),
    jsonb_build_object(
      'source_type', il.source_type, 'duration_sec', il.duration_sec,
      'lead_status', il.lead_status, 'source', il.source, 'campaign', il.campaign,
      'recording_url', il.recording_url, 'transcript_analysis', il.transcript_analysis
    )
  FROM inbound_leads il
  WHERE il.contact_id = p_contact_id
    AND il.merged_into_lead_id IS NULL

  UNION ALL

  SELECT
    'sms'::text,
    m.created_at,
    CASE WHEN m.sender_contact_id = p_contact_id THEN 'Received SMS' ELSE 'Sent SMS' END,
    m.body,
    jsonb_build_object(
      'type', m.type, 'status', m.status,
      'sent_by_name', COALESCE(es.display_name, es.full_name)
    )
  FROM messages m
  LEFT JOIN employees es ON es.id = m.sent_by
  WHERE m.conversation_id IN (
    SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'note'::text,
    jn.created_at,
    'Note'::text,
    jn.body,
    jsonb_build_object('job_id', jn.job_id, 'author_name', jn.author_name)
  FROM job_notes jn
  WHERE jn.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'estimate'::text,
    e.created_at,
    'Estimate ' || COALESCE(e.estimate_number, e.id::text),
    NULL::text,
    jsonb_build_object(
      'status', e.status, 'amount', e.amount, 'estimate_id', e.id,
      'created_by_name', COALESCE(eest.display_name, eest.full_name)
    )
  FROM estimates e
  LEFT JOIN employees eest ON eest.id = e.created_by
  WHERE e.contact_id = p_contact_id

  UNION ALL

  SELECT
    'email'::text,
    COALESCE(r.sent_at, r.created_at),
    'Campaign email'::text,
    ec.subject,
    jsonb_build_object('status', r.status, 'campaign', ec.name, 'campaign_id', ec.id)
  FROM email_campaign_recipients r
  JOIN email_campaigns ec ON ec.id = r.campaign_id
  WHERE r.contact_id = p_contact_id

  UNION ALL

  SELECT
    'job'::text,
    j.created_at,
    'Job ' || COALESCE(j.job_number, j.id::text),
    j.address,
    jsonb_build_object('status', j.status, 'job_id', j.id)
  FROM jobs j
  WHERE j.id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'task'::text,
    COALESCE(t.due_at, t.created_at),
    t.title,
    t.notes,
    jsonb_build_object(
      'status', t.status, 'due_at', t.due_at, 'task_id', t.id,
      'created_by_name', COALESCE(etc.display_name, etc.full_name),
      'assignee_name', COALESCE(eta.display_name, eta.full_name)
    )
  FROM crm_tasks t
  LEFT JOIN employees etc ON etc.id = t.created_by
  LEFT JOIN employees eta ON eta.id = t.assignee_id
  WHERE t.contact_id = p_contact_id
     OR t.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  UNION ALL

  SELECT
    'appointment'::text,
    (a.date + COALESCE(a.time_start, '00:00'::time))::timestamptz,
    COALESCE(a.title, 'Appointment'),
    a.notes,
    jsonb_build_object(
      'status', a.status, 'type', a.type, 'time_start', a.time_start,
      'time_end', a.time_end, 'job_id', a.job_id,
      'created_by_name', COALESCE(eap.display_name, eap.full_name)
    )
  FROM appointments a
  LEFT JOIN employees eap ON eap.id = a.created_by
  WHERE a.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  UNION ALL

  SELECT
    'invoice'::text,
    COALESCE(i.invoice_date::timestamptz, i.created_at),
    'Invoice ' || COALESCE(i.invoice_number, i.id::text),
    NULL::text,
    jsonb_build_object(
      'status', i.status, 'total', i.total, 'amount_paid', i.amount_paid,
      'balance_due', i.balance_due, 'invoice_id', i.id, 'due_date', i.due_date,
      'created_by_name', COALESCE(einv.display_name, einv.full_name)
    )
  FROM invoices i
  LEFT JOIN employees einv ON einv.id = i.created_by
  WHERE i.contact_id = p_contact_id

  UNION ALL

  SELECT
    'work_authorization'::text,
    COALESCE(sr.signed_at, sr.sent_at, sr.created_at),
    COALESCE(initcap(replace(sr.doc_type, '_', ' ')), 'Work Authorization'),
    NULL::text,
    jsonb_build_object(
      'status', sr.status, 'doc_type', sr.doc_type, 'signed_at', sr.signed_at,
      'signed_file_path', sr.signed_file_path, 'job_id', sr.job_id,
      'sent_by_name', COALESCE(esr.display_name, esr.full_name)
    )
  FROM sign_requests sr
  LEFT JOIN employees esr ON esr.id = sr.sent_by
  WHERE sr.contact_id = p_contact_id

  UNION ALL

  SELECT
    'stage_change'::text,
    lsh.moved_at,
    'Moved to ' || ps.name,
    NULL::text,
    jsonb_build_object(
      'from_stage_id', lsh.from_stage_id, 'stage_id', lsh.stage_id, 'lost_reason', lsh.lost_reason,
      'moved_by_name', COALESCE(elsh.display_name, elsh.full_name)
    )
  FROM lead_stage_history lsh
  JOIN pipeline_stages ps ON ps.id = lsh.stage_id
  LEFT JOIN employees elsh ON elsh.id = lsh.moved_by
  WHERE lsh.lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  UNION ALL

  SELECT
    'follow_up_call'::text,
    COALESCE(fu.occurred_at, fu.created_at),
    CASE WHEN fu.source_type = 'call' THEN 'Follow-up call' ELSE 'Follow-up web form' END,
    COALESCE(fu.transcription, fu.notes),
    jsonb_build_object(
      'source_type', fu.source_type, 'duration_sec', fu.duration_sec,
      'caller_number', fu.caller_number, 'recording_url', fu.recording_url,
      'transcript_analysis', fu.transcript_analysis, 'merged_lead_id', fu.id
    )
  FROM inbound_leads fu
  WHERE fu.merged_into_lead_id IN (SELECT id FROM inbound_leads WHERE contact_id = p_contact_id)

  UNION ALL

  -- NEW: claim creation, with who filed it.
  SELECT
    'claim'::text,
    cl.created_at,
    'Claim ' || COALESCE(cl.claim_number, cl.id::text),
    NULLIF(TRIM(BOTH ' ' FROM COALESCE(cl.loss_type, '') || CASE WHEN cl.insurance_carrier IS NOT NULL THEN ' — ' || cl.insurance_carrier ELSE '' END), ''),
    jsonb_build_object(
      'status', cl.status, 'claim_id', cl.id, 'insurance_carrier', cl.insurance_carrier,
      'date_of_loss', cl.date_of_loss,
      'created_by_name', COALESCE(ecl.display_name, ecl.full_name)
    )
  FROM claims cl
  LEFT JOIN employees ecl ON ecl.id = cl.created_by
  WHERE cl.contact_id = p_contact_id

  UNION ALL

  -- NEW: job phase changes, with who moved it (mirrors get_customer_detail's activity arm).
  SELECT
    'phase_change'::text,
    h.changed_at,
    'Phase: ' || COALESCE(pf.label, h.from_phase) || ' → ' || COALESCE(pt.label, h.to_phase),
    NULL::text,
    jsonb_build_object(
      'job_id', h.job_id, 'from_phase', h.from_phase, 'to_phase', h.to_phase,
      'changed_by_name', COALESCE(eph.display_name, eph.full_name)
    )
  FROM job_phase_history h
  LEFT JOIN employees eph ON eph.id = h.changed_by
  LEFT JOIN job_phases pf ON pf.key = h.from_phase
  LEFT JOIN job_phases pt ON pt.key = h.to_phase
  WHERE h.job_id IN (
    SELECT cj.job_id FROM contact_jobs cj WHERE cj.contact_id = p_contact_id
  )

  ORDER BY 2 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_contact_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_activity(uuid) TO authenticated, service_role;
