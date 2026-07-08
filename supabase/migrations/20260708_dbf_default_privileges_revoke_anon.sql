-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_default_privileges_revoke_anon.sql
-- DB-Foundation Phase F — stop new objects auto-opening to anon  [roadmap item ③]
--   docs/db-foundation-roadmap.md → Phase F block; database-standard.md §2.
--
-- WHAT THIS DOES (plain language):
--   Supabase ships a default that grants the public "anon" (browser) role FULL
--   access to every NEW table/sequence and EXECUTE on every NEW function in the
--   `public` schema. That default is why a single migration that forgets to lock
--   a table down leaks it to the internet. This flips the default the safe way:
--   from now on a newly created TABLE or SEQUENCE grants anon NOTHING. Access for
--   anon must be an explicit, reviewable `GRANT ... TO anon` — the
--   database-standard §2 allowlist (public /status page, form submission, etc.).
--
--   The `authenticated` and `service_role` defaults are LEFT ALONE — this only
--   tightens anon (least privilege for the untrusted role).
--
-- VERIFIED PLATFORM NUANCE (2026-07-08 — important, see database-standard §2):
--   For TABLES and SEQUENCES this revoke is fully effective: a new object denies
--   anon at creation (proven by db_foundation_default_privileges.sql). For
--   FUNCTIONS it is only a BACKSTOP — this managed Supabase re-applies
--   PostgreSQL's built-in `EXECUTE TO PUBLIC` to every new function on
--   `ddl_command_end`, and anon is a member of PUBLIC. So a function that does
--   not lock itself down stays anon-executable REGARDLESS of this default. The
--   enforceable rule (database-standard §2, followed by every Foundation
--   function migration) is: each function migration MUST
--   `REVOKE EXECUTE ... FROM PUBLIC, anon` and grant only its intended roles.
--
-- SCOPE / SAFETY:
--   • ALTER DEFAULT PRIVILEGES changes only FUTURE object creation — it does NOT
--     touch a single existing grant, so nothing live can break on apply.
--   • Targets the `postgres` role (the role migrations run as → the role that
--     creates all schema-as-code objects). Also best-effort tightens
--     `supabase_admin` (dashboard-created objects); skipped without a warning if
--     this role isn't a member of it.
--   • Functions carry TWO default grants that reach anon: Supabase's explicit
--     `anon=EXECUTE`, AND PostgreSQL's built-in `EXECUTE TO PUBLIC` (anon is a
--     member of PUBLIC). BOTH are revoked — revoking anon alone leaves the `=X`
--     PUBLIC grant and anon keeps executing new functions. `authenticated` and
--     `service_role` keep EXECUTE via their own explicit default grants.
--   • One shared Supabase (dev + prod): the new default is live in both on apply.
--
-- ROLLBACK (restores Supabase's permissive default for anon):
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, PUBLIC;
--   (repeat FOR ROLE supabase_admin if it was applied there too)
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- postgres — the migration role; governs every schema-as-code object.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  -- Revoke both the explicit anon grant AND the built-in PUBLIC grant on functions.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC';

  -- supabase_admin — dashboard/table-editor-created objects. Best effort.
  BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'db-foundation: skipped supabase_admin default-privilege revoke (%): %', SQLSTATE, SQLERRM;
  END;
END $$;
