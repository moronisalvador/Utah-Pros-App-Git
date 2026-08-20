-- ═════════════════════════════════════════════════════════════════════════════
-- scripts/db-nonpublic-capture.sql · regenerate db/baseline/non-public.sql
--
-- Run this against the live database (Supabase MCP `execute_sql`, or psql —
-- READ-ONLY, pure catalog/config introspection, the same class of action as
-- scripts/db-drift-check.sql). Rewrite db/baseline/non-public.sql from the JSON
-- it returns, update the CAPTURED date in that file's header, and update
-- db/baseline/captured.json.
--
-- SELECTS ONLY CATALOG/CONFIG COLUMNS on purpose: bucket definitions, policy
-- expressions and cron command text. It must never grow a column that could
-- carry a customer row or a secret VALUE (cron commands read secrets from
-- integration_config at runtime; the command text itself contains none).
-- ═════════════════════════════════════════════════════════════════════════════
SELECT jsonb_pretty(jsonb_build_object(
  'captured_at', now(),
  'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types,
      'avif_autodetection', avif_autodetection) ORDER BY id), '[]'::jsonb)
    FROM storage.buckets),
  'storage_policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tablename', tablename, 'policyname', policyname, 'cmd', cmd,
      'roles', roles::text[], 'permissive', permissive,
      'qual', qual, 'with_check', with_check) ORDER BY tablename, policyname), '[]'::jsonb)
    FROM pg_policies WHERE schemaname = 'storage'),
  'cron_jobs', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'jobname', jobname, 'schedule', schedule, 'command', command,
      'active', active) ORDER BY jobname), '[]'::jsonb)
    FROM cron.job)
)) AS capture;
