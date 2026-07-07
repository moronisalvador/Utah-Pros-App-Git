-- ════════════════════════════════════════════════
-- SCRIPT: fix-recon-invoice-line-amounts.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Corrects the LINE AMOUNTS on 4 invoices from the earlier "confident batch" of
--   the Q2-2026 reconciliation. Those imports set each invoice's TOTAL correctly to
--   the amount QuickBooks actually billed, but keyed the line item at the wrong
--   number (the gross estimate, not the approved amount). This sets each line to the
--   QBO-billed amount, so the line grid ties to the total. QuickBooks has no separate
--   discount line for these, so this corrects the line rather than adding a negative
--   "discount" line (contrast the genuine discounts in the backfill, which ARE
--   negative line items, e.g. "Settlement" / "Discount - Deductible (BNI)").
--
--   APPLIED to the shared Supabase (project glsmljpabrwonfiltiqm) on 2026-07-07.
--
-- SAFETY: single transaction; each invoice's TOTAL is captured before, and the
--   correction is ASSERTED not to move it (the QBO-billed amount == the already-
--   correct stored total), plus subtotal == total and line-sum == total after. Any
--   drift raises and rolls back all 4. Never writes the GENERATED line_total.
--
-- Verified against QuickBooks (qbo_get Invoice) before applying:
--   INV-000011 (QBO 4309, recon)  line 7978.11 -> 7925.43   total stays 7925.43 (paid)
--   INV-000029 (QBO 4309, mit)    line 3770.60 -> 3745.16   total stays 3745.16 (paid)
--   INV-000036 (QBO 4620, recon)  line 4081.37 -> 3286.37   total stays 3286.37 (sent)
--   INV-000037 (QBO 5568, mit)    line  550.00 ->  795.00   total stays  795.00 (sent)
-- (INV-000011/029 are a recon+mitigation split of the same QBO invoice 4309.)
-- ════════════════════════════════════════════════

DO $fix$
DECLARE
  r record;
  v_before numeric;
  v_after  numeric;
  v_sub    numeric;
  v_rows   int;
  fixes jsonb := $j$[
    {"id":"46d1dec5-7c77-4340-86ce-86792c56baba","inv":"INV-000011","unit_price":7925.43,"description":"Insurance Approved Estimate","class_id":null,"class_name":null},
    {"id":"49292784-88bc-446f-82f0-6bd91697ecc4","inv":"INV-000029","unit_price":3745.16,"description":"Insurance Approved Estimate","class_id":null,"class_name":null},
    {"id":"9eee5818-d5ce-45d7-87f0-02556f0b6cdf","inv":"INV-000036","unit_price":3286.37,"description":"Replace all affected baseboards in bathroom and hallway, replace affected floor planks and moldings, replace piece of vanity toe kick, paint all baseboards, reinstall toilet, install LVP flooring on hallway and stairs (requires removing and reinstalling stairs railing), repair drywall on ceiling, texture and paint. Do carpet patch in bedroom affected.","class_id":null,"class_name":null},
    {"id":"cf9e3078-4d1b-43e3-b50c-8553554bffc2","inv":"INV-000037","unit_price":795,"description":"Water Damage Mitigation and Drying - Sewer clean up after toilet overflow","class_id":"1000000005","class_name":"Mitigation"}
  ]$j$::jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_to_recordset(fixes)
    AS t(id uuid, inv text, unit_price numeric, description text, class_id text, class_name text)
  LOOP
    SELECT total INTO v_before FROM invoices WHERE id = r.id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'invoice % (%) not found', r.inv, r.id; END IF;

    UPDATE invoice_line_items
       SET unit_price     = r.unit_price,
           description    = r.description,
           qbo_class_id   = COALESCE(r.class_id, qbo_class_id),
           qbo_class_name = COALESCE(r.class_name, qbo_class_name)
     WHERE invoice_id = r.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'expected exactly 1 line for % (%), updated % — aborting', r.inv, r.id, v_rows;
    END IF;

    SELECT total, subtotal INTO v_after, v_sub FROM invoices WHERE id = r.id;
    IF round(v_after,2) <> round(v_before,2) THEN
      RAISE EXCEPTION 'TOTAL DRIFT on % (%): before % / after % — aborting', r.inv, r.id, v_before, v_after;
    END IF;
    IF round(v_sub,2) <> round(v_after,2) THEN
      RAISE EXCEPTION 'subtotal<>total after fix on % (%): sub % total % — aborting', r.inv, r.id, v_sub, v_after;
    END IF;
    IF round((SELECT COALESCE(SUM(line_total),0) FROM invoice_line_items WHERE invoice_id=r.id),2) <> round(v_after,2) THEN
      RAISE EXCEPTION 'line sum <> total after fix on % (%)', r.inv, r.id;
    END IF;
  END LOOP;
  RAISE NOTICE 'DONE — 4 invoice line amounts corrected to QBO-billed values, totals unchanged';
END $fix$;
