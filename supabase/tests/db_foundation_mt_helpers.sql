-- ═════════════════════════════════════════════════════════════════════════════
-- db_foundation_mt_helpers.sql  ·  DB-Foundation Phase F — SQL gate  [item ④]
--
-- WHAT THIS DOES (plain language):
--   Proves the Mountain-Time date helpers bucket a timestamp into the correct
--   America/Denver calendar day on BOTH sides of local midnight, in summer
--   (MDT, UTC-6) and winter (MST, UTC-7). These helpers back every "today"/
--   "this week" figure in the app, so an off-by-one at the day boundary silently
--   mis-buckets revenue and hours.
--
-- HOW TO RUN: paste into mcp__supabase__execute_sql. RAISEs on any failure,
--   returns {ok:true} on success. Read-only.
--
-- RED before 20260708_dbf_mt_helpers.sql applies (functions don't exist → error).
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  vol_date "char";
  vol_today "char";
  anon_exec boolean;
  auth_exec boolean;
BEGIN
  -- Summer (MDT = UTC-6): 05:30Z is 23:30 the PREVIOUS local day; 06:30Z is 00:30 same day.
  IF public.mt_date(TIMESTAMPTZ '2026-07-08 05:30:00+00') <> DATE '2026-07-07' THEN
    RAISE EXCEPTION 'mt_date MDT pre-midnight FAIL: got %', public.mt_date(TIMESTAMPTZ '2026-07-08 05:30:00+00');
  END IF;
  IF public.mt_date(TIMESTAMPTZ '2026-07-08 06:30:00+00') <> DATE '2026-07-08' THEN
    RAISE EXCEPTION 'mt_date MDT post-midnight FAIL: got %', public.mt_date(TIMESTAMPTZ '2026-07-08 06:30:00+00');
  END IF;

  -- Winter (MST = UTC-7): 06:30Z is 23:30 the PREVIOUS local day; 07:30Z is 00:30 same day.
  IF public.mt_date(TIMESTAMPTZ '2026-01-15 06:30:00+00') <> DATE '2026-01-14' THEN
    RAISE EXCEPTION 'mt_date MST pre-midnight FAIL: got %', public.mt_date(TIMESTAMPTZ '2026-01-15 06:30:00+00');
  END IF;
  IF public.mt_date(TIMESTAMPTZ '2026-01-15 07:30:00+00') <> DATE '2026-01-15' THEN
    RAISE EXCEPTION 'mt_date MST post-midnight FAIL: got %', public.mt_date(TIMESTAMPTZ '2026-01-15 07:30:00+00');
  END IF;

  -- mt_today() agrees with the direct Denver-day expression.
  IF public.mt_today() <> (now() AT TIME ZONE 'America/Denver')::date THEN
    RAISE EXCEPTION 'mt_today FAIL: % <> %', public.mt_today(), (now() AT TIME ZONE 'America/Denver')::date;
  END IF;

  -- Volatility contract: mt_date is IMMUTABLE (usable in index/generated exprs);
  -- mt_today reads now() so it is STABLE, never IMMUTABLE.
  SELECT provolatile INTO vol_date  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='mt_date';
  SELECT provolatile INTO vol_today FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='mt_today';
  IF vol_date <> 'i' THEN RAISE EXCEPTION 'mt_date must be IMMUTABLE, got volatility %', vol_date; END IF;
  IF vol_today <> 's' THEN RAISE EXCEPTION 'mt_today must be STABLE, got volatility %', vol_today; END IF;

  -- Least-privilege grants: NOT anon (not in the §2 allowlist); authenticated yes.
  SELECT has_function_privilege('anon', 'public.mt_today()', 'EXECUTE') INTO anon_exec;
  SELECT has_function_privilege('authenticated', 'public.mt_today()', 'EXECUTE') INTO auth_exec;
  IF anon_exec THEN RAISE EXCEPTION 'mt_today must NOT be executable by anon'; END IF;
  IF NOT auth_exec THEN RAISE EXCEPTION 'mt_today must be executable by authenticated'; END IF;

  RAISE NOTICE 'db_foundation_mt_helpers: PASS';
END $$;

SELECT true AS ok;
