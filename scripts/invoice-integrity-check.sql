-- ════════════════════════════════════════════════
-- SCRIPT: invoice-integrity-check.sql  (read-only)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   A re-runnable health check for invoice data integrity. It surfaces the three
--   defect classes the Q2-2026 reconciliation exposed, so a future manual import
--   (or any bad write) can't hide the way these did. Run it any time; every count
--   should be 0 (aside from legitimately-empty $0 drafts). This is the programmatic
--   proof step (#6 "final Q2 automated sweep") from Q2-RECON-TASK.md.
--
--   Note: the app itself can no longer CREATE these — invoice totals are derived
--   from line items by the recompute_invoice_from_lines() trigger, and duplicate
--   numbers are blocked by the UNIQUE(invoice_number) constraint + the drift-proof
--   generate_invoice_number() (20260707_harden_invoice_number_generation.sql).
--   This check guards against direct/manual writes that bypass those paths.
-- ════════════════════════════════════════════════

WITH li AS (
  SELECT invoice_id, COUNT(*) AS n, COALESCE(SUM(line_total),0) AS sum_lt
  FROM invoice_line_items GROUP BY invoice_id
)
SELECT
  -- (1) money on the invoice but no line detail (excludes benign $0 drafts)
  (SELECT COALESCE(json_agg(i.invoice_number ORDER BY i.invoice_number), '[]')
     FROM invoices i LEFT JOIN li ON li.invoice_id = i.id
     WHERE COALESCE(li.n,0) = 0 AND COALESCE(i.adjusted_total, i.total, 0) <> 0
  ) AS lineless_with_amount,

  -- (2) stored total doesn't equal sum(line_total) + tax
  (SELECT COALESCE(json_agg(i.invoice_number ORDER BY i.invoice_number), '[]')
     FROM invoices i JOIN li ON li.invoice_id = i.id
     WHERE round(i.total,2) <> round(li.sum_lt + COALESCE(i.tax,0), 2)
  ) AS total_ne_lines_plus_tax,

  -- (3) duplicate invoice numbers
  (SELECT COALESCE(json_agg(invoice_number ORDER BY invoice_number), '[]')
     FROM (SELECT invoice_number FROM invoices GROUP BY invoice_number HAVING COUNT(*) > 1) d
  ) AS duplicate_numbers;
