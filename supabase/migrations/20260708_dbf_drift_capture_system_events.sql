-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_drift_capture_system_events.sql
-- DB-Foundation Phase F — drift capture: system_events  [roadmap item ⑥]
--   docs/db-foundation-roadmap.md → Phase F block (Drift reconciliation).
--
-- WHAT THIS DOES (plain language):
--   The `system_events` audit-log table exists in the LIVE database and dozens of
--   migrations INSERT into it, but it was never defined in a migration — it drifted
--   in (created outside schema-as-code). This migration RE-DERIVES its exact live
--   shape from the catalog so the repo can rebuild it, WITHOUT changing anything in
--   production: every statement is IF-NOT-EXISTS / idempotent, so applying it to the
--   live DB is a no-op. On a fresh database it recreates the table faithfully.
--
--   Reproduced verbatim from pg_get_… introspection on 2026-07-08 (columns, FKs,
--   the 6 indexes, RLS + the two anon policies, and the live grants). This is a
--   FAITHFUL capture of the existing posture — it deliberately does NOT tighten the
--   table's anon access (that would be a separate reviewed change, not a drift
--   capture). The explicit anon GRANTs below are needed to reproduce the live state
--   on a fresh build now that default privileges no longer auto-grant anon.
--
-- ADDITIVE / IDEMPOTENT. ROLLBACK: none needed on live (no-op). On a fresh build:
--   DROP TABLE IF EXISTS public.system_events CASCADE;
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.system_events (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_type  text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   uuid        NOT NULL,
  actor_id    uuid,
  job_id      uuid,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_events_pkey PRIMARY KEY (id),
  CONSTRAINT system_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.employees(id),
  CONSTRAINT system_events_job_id_fkey   FOREIGN KEY (job_id)   REFERENCES public.jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_system_events_type          ON public.system_events (event_type);
CREATE INDEX IF NOT EXISTS idx_system_events_entity        ON public.system_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_system_events_job           ON public.system_events (job_id);
CREATE INDEX IF NOT EXISTS idx_system_events_created       ON public.system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_actor         ON public.system_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_system_events_job_type_date ON public.system_events (job_id, event_type, created_at DESC);

ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_insert_system_events ON public.system_events;
DROP POLICY IF EXISTS anon_select_system_events ON public.system_events;
CREATE POLICY anon_insert_system_events ON public.system_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_select_system_events ON public.system_events FOR SELECT TO anon USING (true);

-- Live grants (faithful reproduction).
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_events TO service_role;
