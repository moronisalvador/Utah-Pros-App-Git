-- ─────────────────────────────────────────────────────────────────────────────
-- CRM Phase 9 — Intelligence RPC bodies (function-body-only replaces)
--
-- docs/crm-roadmap.md "Phase 9 — Intelligence" + .claude/rules/crm-wave-ownership.md.
-- Fills the bodies of Phase 9's eight signature-frozen stubs from
-- 20260702_crm_phase0F_rpc_stubs.sql. **Signatures are unchanged** (name / args /
-- arg order / defaults / return type all identical to the stubs) — this is a
-- body-only CREATE OR REPLACE, the only migration a wave session may ship
-- (migration-safety-checker enforces). ZERO schema changes: no table/column is
-- created, altered or dropped here.
--
-- Money/decision math convention (mirrors src/lib/attribution.js): these RPCs
-- return RAW COUNTS/SUMS only. Rates, ratios, and the "guard div-by-zero, a real
-- 0 is real" rendering all live in the pure, unit-tested JS layer
-- (attribution.js / crmPipeline.js) — never in SQL.
--
-- History-backed reports (get_speed_to_lead, get_pipeline_movement) accrue data
-- only from Phase F's move_lead_to_stage replace onward; each row carries a
-- data_since timestamp so the UI can render "since <date>" honestly rather than
-- implying history that predates the log.
--
-- One shared Supabase across dev + main — live in both on apply, but every
-- consumer sits behind the page:crm feature flag until the owner opens it.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ score_lead(p_lead_id) → integer ═══
-- Rule-based, deterministic (NO ML). Mirrors the point table in
-- src/lib/crmPipeline.js scoreLeadFactors() exactly; persists the per-factor
-- breakdown to lead_score_factors and the clamped total to inbound_leads.lead_score.
CREATE OR REPLACE FUNCTION score_lead(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead        inbound_leads;
  v_channel     text;
  v_first_touch numeric;   -- minutes to first outbound touch; NULL if none yet
  v_source_pts  int;
  v_engage_pts  int;
  v_speed_pts   int;
  v_sent_pts    int;
  v_topic_pts   int;
  v_label       text;
  v_urgent      boolean;
  v_total       int;
BEGIN
  SELECT * INTO v_lead FROM inbound_leads WHERE id = p_lead_id;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'unknown inbound_leads id: %', p_lead_id;
  END IF;

  -- Idempotent re-score: clear this lead's prior factor rows first.
  DELETE FROM lead_score_factors WHERE lead_id = p_lead_id;

  -- Spam hard-zeros to a single factor, regardless of other signals.
  IF COALESCE(v_lead.spam_flag, false) THEN
    INSERT INTO lead_score_factors (lead_id, org_id, factor, points, detail)
    VALUES (p_lead_id, v_lead.org_id, 'spam', 0, jsonb_build_object('spam', true));
    UPDATE inbound_leads SET lead_score = 0, updated_at = now() WHERE id = p_lead_id;
    RETURN 0;
  END IF;

  -- 1. Source quality (canonical crm_channel_for_source buckets).
  v_channel := crm_channel_for_source(v_lead.source);
  v_source_pts := CASE v_channel
    WHEN 'referral'   THEN 20
    WHEN 'insurance'  THEN 18
    WHEN 'google_ads' THEN 15
    WHEN 'organic'    THEN 10
    WHEN 'meta_ads'   THEN 8
    ELSE 5
  END;

  -- 2. Engagement: long answered call > short call; form > missed call (=0).
  IF v_lead.source_type = 'call' THEN
    v_engage_pts := CASE
      WHEN COALESCE(v_lead.duration_sec, 0) >= 120 THEN 20
      WHEN COALESCE(v_lead.duration_sec, 0) >= 60  THEN 12
      WHEN COALESCE(v_lead.duration_sec, 0) >= 20  THEN 6
      ELSE 0
    END;
  ELSIF v_lead.source_type = 'form' THEN
    v_engage_pts := 10;
  ELSE
    v_engage_pts := 5;
  END IF;

  -- 3. Speed-to-first-touch. An answered inbound call is touched during the call
  -- (0 min). Otherwise the earliest outbound staff message after the lead
  -- arrived (inbound texts carry sender_contact_id; staff sends leave it NULL).
  IF v_lead.source_type = 'call' AND COALESCE(v_lead.duration_sec, 0) > 0 THEN
    v_first_touch := 0;
  ELSE
    BEGIN
      SELECT EXTRACT(EPOCH FROM (MIN(m.created_at) - COALESCE(v_lead.occurred_at, v_lead.created_at))) / 60.0
        INTO v_first_touch
      FROM messages m
      JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
      WHERE cp.contact_id = v_lead.contact_id
        AND m.sender_contact_id IS NULL
        AND m.created_at >= COALESCE(v_lead.occurred_at, v_lead.created_at);
    EXCEPTION WHEN OTHERS THEN
      v_first_touch := NULL;
    END;
  END IF;

  v_speed_pts := CASE
    WHEN v_first_touch IS NULL OR v_first_touch < 0 THEN 0
    WHEN v_first_touch <= 5    THEN 15
    WHEN v_first_touch <= 30   THEN 10
    WHEN v_first_touch <= 120  THEN 5
    WHEN v_first_touch <= 1440 THEN 2
    ELSE 0
  END;

  -- 4. Transcript sentiment.
  v_label := v_lead.transcript_analysis -> 'sentiment' ->> 'label';
  v_sent_pts := CASE v_label WHEN 'positive' THEN 15 WHEN 'neutral' THEN 5 ELSE 0 END;

  -- 5. Transcript topics — restoration-urgency keywords → a real job.
  v_urgent := EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_lead.transcript_analysis -> 'topics', '[]'::jsonb)) AS t(topic)
    WHERE t.topic ~* '(water|flood|fire|smoke|mold|sewage|storm|leak|burst|emergenc|damage|restorat|asbestos|hail|wind)'
  );
  v_topic_pts := CASE WHEN v_urgent THEN 15 ELSE 0 END;

  INSERT INTO lead_score_factors (lead_id, org_id, factor, points, detail) VALUES
    (p_lead_id, v_lead.org_id, 'source', v_source_pts,
       jsonb_build_object('channel', v_channel, 'source', v_lead.source)),
    (p_lead_id, v_lead.org_id, 'engagement', v_engage_pts,
       jsonb_build_object('source_type', v_lead.source_type, 'duration_sec', v_lead.duration_sec)),
    (p_lead_id, v_lead.org_id, 'speed_to_first_touch', v_speed_pts,
       jsonb_build_object('first_touch_minutes', v_first_touch)),
    (p_lead_id, v_lead.org_id, 'sentiment', v_sent_pts,
       jsonb_build_object('label', v_label)),
    (p_lead_id, v_lead.org_id, 'topics', v_topic_pts,
       jsonb_build_object('urgent', v_urgent));

  v_total := GREATEST(0, LEAST(100, v_source_pts + v_engage_pts + v_speed_pts + v_sent_pts + v_topic_pts));
  UPDATE inbound_leads SET lead_score = v_total, updated_at = now() WHERE id = p_lead_id;

  INSERT INTO system_events (event_type, entity_type, entity_id, payload)
  VALUES ('crm_lead_scored', 'inbound_lead', p_lead_id,
          jsonb_build_object('score', v_total, 'channel', v_channel));

  RETURN v_total;
END;
$$;
GRANT EXECUTE ON FUNCTION score_lead(uuid) TO anon, authenticated;

-- ═══ get_conversion_trend(p_start, p_end, p_org_id) → SETOF json ═══
-- Monthly leads → estimates → won → revenue series (defaults to the last 12
-- months). Raw counts; JS deriveConversionTrend() attaches the guarded rates.
CREATE OR REPLACE FUNCTION get_conversion_trend(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_start date;
  v_end   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, CURRENT_DATE);
  v_start := COALESCE(p_start, (date_trunc('month', v_end::timestamptz) - interval '11 months')::date);

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(date_trunc('month', v_start::timestamptz),
                           date_trunc('month', v_end::timestamptz),
                           interval '1 month') AS m
  ),
  lead_c AS (
    SELECT date_trunc('month', COALESCE(il.occurred_at, il.created_at)) AS m, COUNT(*) AS c
    FROM inbound_leads il
    WHERE il.org_id = v_org AND COALESCE(il.spam_flag, false) = false
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  est_c AS (
    SELECT date_trunc('month', e.created_at) AS m, COUNT(*) AS c
    FROM estimates e
    WHERE e.status IS DISTINCT FROM 'draft'
      AND e.created_at >= v_start::timestamptz AND e.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  ),
  job_c AS (
    SELECT date_trunc('month', j.created_at) AS m, COUNT(*) AS c, COALESCE(SUM(j.invoiced_value), 0) AS rev
    FROM jobs j
    WHERE j.phase <> 'lead' AND j.status <> 'deleted'
      AND j.created_at >= v_start::timestamptz AND j.created_at < (v_end + 1)::timestamptz
    GROUP BY 1
  )
  SELECT json_build_object(
    'period',       to_char(months.m, 'YYYY-MM'),
    'period_start', months.m::date,
    'leads',        COALESCE(lead_c.c, 0),
    'estimates',    COALESCE(est_c.c, 0),
    'won_jobs',     COALESCE(job_c.c, 0),
    'revenue',      COALESCE(job_c.rev, 0)
  )
  FROM months
  LEFT JOIN lead_c ON lead_c.m = months.m
  LEFT JOIN est_c  ON est_c.m  = months.m
  LEFT JOIN job_c  ON job_c.m  = months.m
  ORDER BY months.m;
END;
$$;
GRANT EXECUTE ON FUNCTION get_conversion_trend(date, date, uuid) TO anon, authenticated;

-- ═══ get_estimator_leaderboard(p_start, p_end, p_org_id) → SETOF json ═══
-- Per estimator (jobs.estimator): assigned jobs, won jobs, won revenue. JS
-- deriveLeaderboard() computes win rate + revenue/won and sorts. jobs are
-- single-tenant so p_org_id is accepted for signature-compat but not filtered on.
CREATE OR REPLACE FUNCTION get_estimator_leaderboard(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT json_build_object(
    'estimator',  j.estimator,
    'total_jobs', COUNT(*),
    'won_jobs',   COUNT(*) FILTER (WHERE j.phase <> 'lead'),
    'revenue',    COALESCE(SUM(j.invoiced_value) FILTER (WHERE j.phase <> 'lead'), 0)
  )
  FROM jobs j
  WHERE j.estimator IS NOT NULL AND btrim(j.estimator) <> '' AND j.status <> 'deleted'
    AND (p_start IS NULL OR j.created_at >= p_start::timestamptz)
    AND (p_end   IS NULL OR j.created_at <  (p_end + 1)::timestamptz)
  GROUP BY j.estimator
  ORDER BY COALESCE(SUM(j.invoiced_value) FILTER (WHERE j.phase <> 'lead'), 0) DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_estimator_leaderboard(date, date, uuid) TO anon, authenticated;

-- ═══ get_call_volume(p_start, p_end, p_org_id) → SETOF json ═══
-- Daily inbound-call counts (defaults to the last 30 days): total, answered
-- (duration > 0), missed (duration = 0). Spam excluded.
CREATE OR REPLACE FUNCTION get_call_volume(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_start date;
  v_end   date;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_end   := COALESCE(p_end, CURRENT_DATE);
  v_start := COALESCE(p_start, (v_end - 29));

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_start::timestamptz, v_end::timestamptz, interval '1 day') AS d
  ),
  calls AS (
    SELECT date_trunc('day', COALESCE(il.occurred_at, il.created_at)) AS d,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(il.duration_sec, 0) > 0) AS answered,
           COUNT(*) FILTER (WHERE COALESCE(il.duration_sec, 0) = 0) AS missed
    FROM inbound_leads il
    WHERE il.org_id = v_org AND il.source_type = 'call' AND COALESCE(il.spam_flag, false) = false
      AND COALESCE(il.occurred_at, il.created_at) >= v_start::timestamptz
      AND COALESCE(il.occurred_at, il.created_at) <  (v_end + 1)::timestamptz
    GROUP BY 1
  )
  SELECT json_build_object(
    'period',       to_char(days.d, 'YYYY-MM-DD'),
    'period_start', days.d::date,
    'total',        COALESCE(calls.total, 0),
    'answered',     COALESCE(calls.answered, 0),
    'missed',       COALESCE(calls.missed, 0)
  )
  FROM days
  LEFT JOIN calls ON calls.d = date_trunc('day', days.d)
  ORDER BY days.d;
END;
$$;
GRANT EXECUTE ON FUNCTION get_call_volume(date, date, uuid) TO anon, authenticated;

-- ═══ get_speed_to_lead(p_start, p_end, p_org_id) → SETOF json ═══
-- Response-time buckets: minutes from a lead's creation to its FIRST pipeline
-- move (lead_stage_history). within_sla flags the ≤5-min bucket; JS
-- speedToLeadSummary() computes the SLA hit rate. data_since (earliest history
-- row) lets the UI say "since <date>" — the log only accrues from Phase F on.
CREATE OR REPLACE FUNCTION get_speed_to_lead(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_since timestamptz;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_since := (SELECT MIN(moved_at) FROM lead_stage_history WHERE org_id = v_org);

  RETURN QUERY
  WITH first_move AS (
    SELECT lsh.lead_id, MIN(lsh.moved_at) AS first_moved_at
    FROM lead_stage_history lsh
    WHERE lsh.org_id = v_org
    GROUP BY lsh.lead_id
  ),
  gaps AS (
    SELECT EXTRACT(EPOCH FROM (fm.first_moved_at - COALESCE(il.occurred_at, il.created_at))) / 60.0 AS mins
    FROM first_move fm
    JOIN inbound_leads il ON il.id = fm.lead_id
    WHERE (p_start IS NULL OR fm.first_moved_at >= p_start::timestamptz)
      AND (p_end   IS NULL OR fm.first_moved_at <  (p_end + 1)::timestamptz)
  ),
  binned AS (
    SELECT CASE
      WHEN GREATEST(mins, 0) <= 5 THEN 1
      WHEN mins <= 30            THEN 2
      WHEN mins <= 60            THEN 3
      WHEN mins <= 240           THEN 4
      WHEN mins <= 1440          THEN 5
      ELSE 6
    END AS b
    FROM gaps
  ),
  counts AS (SELECT b, COUNT(*) AS c FROM binned GROUP BY b),
  defs(sort_order, label, within_sla) AS (
    VALUES (1, '≤5 min', true), (2, '5–30 min', false), (3, '30–60 min', false),
           (4, '1–4 hr', false), (5, '4–24 hr', false), (6, '>24 hr', false)
  )
  SELECT json_build_object(
    'bucket',     defs.label,
    'sort_order', defs.sort_order,
    'within_sla', defs.within_sla,
    'count',      COALESCE(counts.c, 0),
    'data_since', v_since
  )
  FROM defs
  LEFT JOIN counts ON counts.b = defs.sort_order
  ORDER BY defs.sort_order;
END;
$$;
GRANT EXECUTE ON FUNCTION get_speed_to_lead(date, date, uuid) TO anon, authenticated;

-- ═══ get_estimate_aging(p_org_id) → SETOF json ═══
-- Open estimates (submitted, not yet converted) bucketed by age since submitted.
-- estimates are single-tenant; p_org_id is accepted for signature-compat only.
CREATE OR REPLACE FUNCTION get_estimate_aging(p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH open_est AS (
    SELECT COALESCE(e.submitted_at, e.created_at) AS since, e.amount
    FROM estimates e
    WHERE e.status = 'submitted' AND e.converted_invoice_id IS NULL
  ),
  aged AS (
    SELECT amount, EXTRACT(EPOCH FROM (now() - since)) / 86400.0 AS days FROM open_est
  ),
  binned AS (
    SELECT CASE
      WHEN days <= 7  THEN 1
      WHEN days <= 14 THEN 2
      WHEN days <= 30 THEN 3
      WHEN days <= 60 THEN 4
      ELSE 5
    END AS b, amount
    FROM aged
  ),
  counts AS (SELECT b, COUNT(*) AS c, COALESCE(SUM(amount), 0) AS amt FROM binned GROUP BY b),
  defs(sort_order, label) AS (
    VALUES (1, '0–7 days'), (2, '8–14 days'), (3, '15–30 days'), (4, '31–60 days'), (5, '60+ days')
  )
  SELECT json_build_object(
    'bucket',       defs.label,
    'sort_order',   defs.sort_order,
    'count',        COALESCE(counts.c, 0),
    'total_amount', COALESCE(counts.amt, 0)
  )
  FROM defs
  LEFT JOIN counts ON counts.b = defs.sort_order
  ORDER BY defs.sort_order;
END;
$$;
GRANT EXECUTE ON FUNCTION get_estimate_aging(uuid) TO anon, authenticated;

-- ═══ get_pipeline_movement(p_start, p_end, p_org_id) → SETOF json ═══
-- Per-stage moves in/out over the window (lead_stage_history). data_since marks
-- when the log began (Phase F onward) for honest "since <date>" rendering.
CREATE OR REPLACE FUNCTION get_pipeline_movement(p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid;
  v_since timestamptz;
BEGIN
  v_org   := COALESCE(p_org_id, (SELECT id FROM crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1));
  v_since := (SELECT MIN(moved_at) FROM lead_stage_history WHERE org_id = v_org);

  RETURN QUERY
  WITH moves AS (
    SELECT lsh.stage_id, lsh.from_stage_id
    FROM lead_stage_history lsh
    WHERE lsh.org_id = v_org
      AND (p_start IS NULL OR lsh.moved_at >= p_start::timestamptz)
      AND (p_end   IS NULL OR lsh.moved_at <  (p_end + 1)::timestamptz)
  ),
  in_c  AS (SELECT stage_id AS sid, COUNT(*) AS c FROM moves GROUP BY stage_id),
  out_c AS (SELECT from_stage_id AS sid, COUNT(*) AS c FROM moves WHERE from_stage_id IS NOT NULL GROUP BY from_stage_id)
  SELECT json_build_object(
    'stage_id',   ps.id,
    'stage_name', ps.name,
    'sort_order', ps.sort_order,
    'is_won',     ps.is_won,
    'is_lost',    ps.is_lost,
    'moved_in',   COALESCE(in_c.c, 0),
    'moved_out',  COALESCE(out_c.c, 0),
    'net',        COALESCE(in_c.c, 0) - COALESCE(out_c.c, 0),
    'data_since', v_since
  )
  FROM pipeline_stages ps
  LEFT JOIN in_c  ON in_c.sid  = ps.id
  LEFT JOIN out_c ON out_c.sid = ps.id
  WHERE ps.org_id = v_org
  ORDER BY ps.sort_order;
END;
$$;
GRANT EXECUTE ON FUNCTION get_pipeline_movement(date, date, uuid) TO anon, authenticated;

-- ═══ get_contact_ltv(p_contact_id, p_org_id) → SETOF json ═══
-- One contact's lifetime value (when p_contact_id given) or the top 25 contacts
-- by won-job revenue. jobs are single-tenant; p_org_id is signature-compat only.
CREATE OR REPLACE FUNCTION get_contact_ltv(p_contact_id uuid DEFAULT NULL, p_org_id uuid DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH won AS (
    SELECT j.primary_contact_id AS cid,
           COUNT(*) AS jobs,
           COALESCE(SUM(j.invoiced_value), 0) AS revenue,
           MIN(j.created_at) AS first_job_at,
           MAX(j.created_at) AS last_job_at
    FROM jobs j
    WHERE j.phase <> 'lead' AND j.status <> 'deleted' AND j.primary_contact_id IS NOT NULL
      AND (p_contact_id IS NULL OR j.primary_contact_id = p_contact_id)
    GROUP BY j.primary_contact_id
  )
  SELECT json_build_object(
    'contact_id',   won.cid,
    'contact_name', c.name,
    'jobs',         won.jobs,
    'revenue',      won.revenue,
    'first_job_at', won.first_job_at,
    'last_job_at',  won.last_job_at,
    'is_repeat',    (won.jobs > 1)
  )
  FROM won
  LEFT JOIN contacts c ON c.id = won.cid
  ORDER BY won.revenue DESC
  LIMIT (CASE WHEN p_contact_id IS NULL THEN 25 ELSE 1 END);
END;
$$;
GRANT EXECUTE ON FUNCTION get_contact_ltv(uuid, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
