-- ═════════════════════════════════════════════════════════════════════════════
-- db_foundation_lifecycle_history.sql  ·  DB-Foundation Phase F — SQL gate  [item ⑤]
--
-- WHAT THIS DOES (plain language):
--   Proves the new status-history capture on the two hot financial tables works
--   AND is safe:
--     1. flipping claims.status / invoices.status writes EXACTLY ONE history row
--        with the correct from/to,
--     2. an UPDATE that does NOT change status writes NOTHING (the WHEN guard),
--     3. the parent UPDATE itself always succeeds (the whole point — the trigger
--        must never be able to block a claim/invoice write),
--     4. each trigger fires only on a real status change (WHEN clause present) and
--        its function swallows its own errors (defensive EXCEPTION block).
--
-- HOW TO RUN: paste into mcp__supabase__execute_sql. Everything happens inside a
--   transaction that ROLLS BACK, so it touches a real row transiently but PERSISTS
--   NOTHING. RAISEs on any failure.
--
-- RED before 20260708_dbf_lifecycle_history.sql applies (history tables/triggers
-- don't exist → error).
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  cid uuid; old_s text; new_c text; h0 int; h1 int; h2 int; lat_from text; lat_to text;
  iid uuid; oi_s text; new_i text; g0 int; g1 int; g2 int;
  se_qual boolean; se_src text;
BEGIN
  -- ── claims ──────────────────────────────────────────────────────────────
  -- status is CHECK-constrained, so flip between two VALID values (innocuous,
  -- non-terminal ones) rather than appending a marker.
  SELECT id, status INTO cid, old_s FROM claims ORDER BY created_at DESC LIMIT 1;
  IF cid IS NULL THEN RAISE EXCEPTION 'no claims row to exercise'; END IF;
  new_c := CASE WHEN old_s = 'in_progress' THEN 'open' ELSE 'in_progress' END;
  SELECT count(*) INTO h0 FROM claim_status_history WHERE claim_id = cid;

  UPDATE claims SET status = new_c WHERE id = cid;                                  -- real change → fire
  SELECT count(*) INTO h1 FROM claim_status_history WHERE claim_id = cid;
  IF h1 <> h0 + 1 THEN RAISE EXCEPTION 'claims: expected 1 new history row, got % (was %)', h1, h0; END IF;

  SELECT from_status, to_status INTO lat_from, lat_to
    FROM claim_status_history WHERE claim_id = cid ORDER BY changed_at DESC LIMIT 1;
  IF lat_to <> new_c OR lat_from IS DISTINCT FROM old_s THEN
    RAISE EXCEPTION 'claims: history from/to wrong: % -> %', lat_from, lat_to;
  END IF;

  UPDATE claims SET status = status WHERE id = cid;                                 -- no change → no fire
  SELECT count(*) INTO h2 FROM claim_status_history WHERE claim_id = cid;
  IF h2 <> h1 THEN RAISE EXCEPTION 'claims: no-op update wrongly captured a row (% -> %)', h1, h2; END IF;

  -- ── invoices ────────────────────────────────────────────────────────────
  SELECT id, status INTO iid, oi_s FROM invoices ORDER BY created_at DESC LIMIT 1;
  IF iid IS NULL THEN RAISE EXCEPTION 'no invoices row to exercise'; END IF;
  new_i := CASE WHEN oi_s = 'sent' THEN 'draft' ELSE 'sent' END;
  SELECT count(*) INTO g0 FROM invoice_status_history WHERE invoice_id = iid;

  UPDATE invoices SET status = new_i WHERE id = iid;                                -- real change → fire
  SELECT count(*) INTO g1 FROM invoice_status_history WHERE invoice_id = iid;
  IF g1 <> g0 + 1 THEN RAISE EXCEPTION 'invoices: expected 1 new history row, got % (was %)', g1, g0; END IF;

  UPDATE invoices SET status = status WHERE id = iid;                              -- no change → no fire
  SELECT count(*) INTO g2 FROM invoice_status_history WHERE invoice_id = iid;
  IF g2 <> g1 THEN RAISE EXCEPTION 'invoices: no-op update wrongly captured a row (% -> %)', g1, g2; END IF;

  -- ── structural: WHEN guard present + defensive body ───────────────────────
  SELECT tgqual IS NOT NULL INTO se_qual FROM pg_trigger
    WHERE tgrelid='public.claims'::regclass AND tgname='trg_claim_status_history';
  IF NOT se_qual THEN RAISE EXCEPTION 'claims trigger missing WHEN clause (would be a bare AFTER UPDATE)'; END IF;
  SELECT tgqual IS NOT NULL INTO se_qual FROM pg_trigger
    WHERE tgrelid='public.invoices'::regclass AND tgname='trg_invoice_status_history';
  IF NOT se_qual THEN RAISE EXCEPTION 'invoices trigger missing WHEN clause'; END IF;

  SELECT pg_get_functiondef(p.oid) INTO se_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='capture_claim_status_history';
  IF position('EXCEPTION' IN se_src) = 0 THEN
    RAISE EXCEPTION 'capture_claim_status_history not defensive (no EXCEPTION handler)';
  END IF;

  RAISE NOTICE 'db_foundation_lifecycle_history: PASS';
END $$;

ROLLBACK;   -- persist nothing

SELECT true AS ok;
