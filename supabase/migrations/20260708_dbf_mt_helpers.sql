-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_mt_helpers.sql
-- DB-Foundation Phase F — Mountain-Time date helpers  [roadmap item ④]
--   docs/db-foundation-roadmap.md → Phase F block.
--
-- WHAT THIS DOES (plain language):
--   Two tiny helpers that turn a moment in time into the correct America/Denver
--   calendar day. The business runs on Mountain Time, so "today" and "this week"
--   must be measured in Denver's day, not UTC's. Bucketing in UTC silently
--   mis-files anything that happens between 5pm/6pm local and midnight.
--     • mt_date(ts) → the Denver calendar date of a timestamptz. IMMUTABLE so it
--       can be used inside indexes and generated columns.
--     • mt_today() → today's Denver date. STABLE (it reads now()), never
--       IMMUTABLE — a now()-based function that claimed IMMUTABLE would be cached
--       across a day boundary and return yesterday.
--
-- SECURITY / GRANTS (database-standard §2): pure date utilities, no data access —
--   granted to authenticated + service_role only, NOT anon (not on the allowlist).
--
-- ADDITIVE / SAFE: new functions only. One shared Supabase (dev + prod) — live in
--   both on apply; nothing references them yet, so applying first is safe.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.mt_today();
--   DROP FUNCTION IF EXISTS public.mt_date(timestamptz);
-- ═════════════════════════════════════════════════════════════════════════════

-- mt_date: Denver calendar date of a moment. `timestamptz AT TIME ZONE 'zone'`
-- yields the wall-clock timestamp in that zone; ::date drops the time. Declared
-- IMMUTABLE (the standard bucketing-helper convention) so it is usable in index
-- and generated-column expressions.
CREATE OR REPLACE FUNCTION public.mt_date(p_ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (p_ts AT TIME ZONE 'America/Denver')::date;
$$;

-- mt_today: today's Denver date. STABLE because it depends on now().
CREATE OR REPLACE FUNCTION public.mt_today()
RETURNS date
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'America/Denver')::date;
$$;

-- Explicitly revoke anon (belt-and-suspenders): Supabase's default privileges
-- auto-grant anon EXECUTE at creation, and REVOKE ... FROM PUBLIC does not remove
-- that role-specific grant. This keeps the helpers anon-denied regardless of
-- whether the default-privileges migration has applied yet.
REVOKE ALL ON FUNCTION public.mt_date(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mt_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mt_date(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mt_today() TO authenticated, service_role;
