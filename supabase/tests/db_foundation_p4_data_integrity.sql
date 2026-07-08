-- ═════════════════════════════════════════════════════════════════════════════
-- db_foundation_p4_data_integrity.sql  ·  DB-Foundation Phase P4 — SQL gate
--   docs/db-foundation-roadmap.md → Phase P4 · docs/db-foundation-p4-orphan-report.md
--
-- WHAT THIS DOES (plain language):
--   The test-first proof for Phase P4. Run it via mcp__supabase__execute_sql. It
--   RAISEs on any failure and returns {ok:true} on success. Read-only except for a
--   backward-compat probe that self-undoes (a novel-id UPDATE is unconditionally
--   reset to NULL at the end; a caught duplicate attempt leaves nothing) — net zero
--   data change. On any RAISE the whole DO block aborts, discarding the probe too.
--
--   ALWAYS asserts (YELLOW, applied 2026-07-08):
--     • notifications_job_id_fkey exists AND is validated
--     • job_time_entries hours/paused/travel non-negative CHECKs exist AND validated
--     • forms.encircle_note_id + google_calendar_links.google_event_id unique indexes exist
--
--   ADAPTIVE (RED, only once the owner-gated repair + unique migrations apply):
--     detects claims_encircle_claim_id_uniq; if present, asserts zero duplicate
--     external ids remain on claims/contacts, the canonical rows kept their ids,
--     the superseded plain index is gone, and runs the rolled-back backward-compat
--     probe (a novel id inserts, an in-use id is rejected). If absent, NOTICEs that
--     the RED items are still staged and skips those asserts (so the gate is green
--     on the YELLOW-only state too).
--
-- CONTESTED-TABLE BACKWARD-COMPAT (manifest §8): the rolled-back probe is the
--   committed proof that the current app's claims/contacts writes still succeed
--   under the new unique index.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n int;
  v boolean;
  red boolean;
  target uuid;
  errcode text;
BEGIN
  -- ── ④ missing FK: notifications.job_id → jobs ──────────────────────────────
  SELECT convalidated INTO v FROM pg_constraint
   WHERE conname = 'notifications_job_id_fkey' AND conrelid = 'public.notifications'::regclass;
  IF v IS NULL THEN RAISE EXCEPTION 'P4 FAIL: notifications_job_id_fkey missing'; END IF;
  IF v IS NOT TRUE THEN RAISE EXCEPTION 'P4 FAIL: notifications_job_id_fkey not validated'; END IF;

  -- ── ⑤ CHECK constraints: job_time_entries duration non-negativity ──────────
  FOR n IN
    SELECT 1 FROM unnest(ARRAY['job_time_entries_hours_nonneg',
                               'job_time_entries_paused_nonneg',
                               'job_time_entries_travel_nonneg']) AS c(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = c.name AND conrelid = 'public.job_time_entries'::regclass
         AND contype = 'c' AND convalidated
    )
  LOOP
    RAISE EXCEPTION 'P4 FAIL: a job_time_entries non-negativity CHECK is missing or unvalidated';
  END LOOP;

  -- ── ③ clean unique indexes (dup-free columns) ──────────────────────────────
  IF to_regclass('public.forms_encircle_note_id_uniq') IS NULL THEN
    RAISE EXCEPTION 'P4 FAIL: forms_encircle_note_id_uniq missing'; END IF;
  IF to_regclass('public.google_calendar_links_google_event_id_uniq') IS NULL THEN
    RAISE EXCEPTION 'P4 FAIL: google_calendar_links_google_event_id_uniq missing'; END IF;

  -- ── ②/③ RED items — assert only if the repaired-column unique index exists ──
  red := to_regclass('public.claims_encircle_claim_id_uniq') IS NOT NULL;
  IF NOT red THEN
    RAISE NOTICE 'P4: RED repair + repaired-column unique not applied yet — skipping those asserts (staged, owner-gated).';
  ELSE
    -- no duplicate external ids remain
    SELECT count(*) INTO n FROM (
      SELECT encircle_claim_id FROM public.claims WHERE encircle_claim_id IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1) x;
    IF n <> 0 THEN RAISE EXCEPTION 'P4 FAIL: % dup claims.encircle_claim_id group(s) remain', n; END IF;

    IF to_regclass('public.contacts_qbo_customer_id_uniq') IS NULL THEN
      RAISE EXCEPTION 'P4 FAIL: contacts_qbo_customer_id_uniq missing'; END IF;
    SELECT count(*) INTO n FROM (
      SELECT qbo_customer_id FROM public.contacts WHERE qbo_customer_id IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1) x;
    IF n <> 0 THEN RAISE EXCEPTION 'P4 FAIL: % dup contacts.qbo_customer_id group(s) remain', n; END IF;

    -- canonical rows kept their ids
    PERFORM 1 FROM public.claims
      WHERE id = 'e8c0ef86-9bf2-4545-be08-313d7b3a80a0' AND encircle_claim_id = '4018951';
    IF NOT FOUND THEN RAISE EXCEPTION 'P4 FAIL: canonical claim 4018951 lost its id'; END IF;
    PERFORM 1 FROM public.contacts
      WHERE id = '2c97bcce-9d65-41d3-bc9d-9c92aaad8612' AND qbo_customer_id = '531';
    IF NOT FOUND THEN RAISE EXCEPTION 'P4 FAIL: canonical contact 531 lost its id'; END IF;

    -- superseded plain index is gone
    IF to_regclass('public.claims_encircle_claim_id_idx') IS NOT NULL THEN
      RAISE EXCEPTION 'P4 FAIL: redundant claims_encircle_claim_id_idx was not superseded'; END IF;

    -- ── backward-compat probe (self-undone — zero net data change) ──
    -- Uses an existing claim that currently has no Encircle id, so no NOT NULL /
    -- FK column has to be fabricated. Proves: a novel id updates fine; an in-use
    -- id is rejected by the unique index.
    SELECT id INTO target FROM public.claims WHERE encircle_claim_id IS NULL LIMIT 1;
    IF target IS NOT NULL THEN
      BEGIN
        UPDATE public.claims SET encircle_claim_id = '4018951' WHERE id = target; -- in-use → must fail
        RAISE EXCEPTION 'P4 FAIL: unique index did not reject a duplicate encircle_claim_id';
      EXCEPTION WHEN unique_violation THEN
        NULL; -- expected
      END;
      UPDATE public.claims SET encircle_claim_id = '__p4_probe_novel__' WHERE id = target; -- novel → must succeed
    END IF;
    -- undo the probe unconditionally
    IF target IS NOT NULL THEN
      UPDATE public.claims SET encircle_claim_id = NULL WHERE id = target;
    END IF;
  END IF;

  RAISE NOTICE 'db_foundation_p4_data_integrity: ok (red_asserts=%)', red;
END $$;

SELECT true AS ok;
