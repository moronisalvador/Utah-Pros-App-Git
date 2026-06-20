-- 20260619_invoice_line_items_qbo.sql
-- Full invoice builder: line items carry their QBO Item + Class (selectable per line),
-- and the invoice total is rolled up from the line items. Keeps UPR ↔ QBO in sync:
-- each line pushes to QBO as its own SalesItemLine with ItemRef + ClassRef.

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS qbo_item_id   text,
  ADD COLUMN IF NOT EXISTS qbo_item_name text,
  ADD COLUMN IF NOT EXISTS qbo_class_id  text,
  ADD COLUMN IF NOT EXISTS qbo_class_name text;

-- Recompute invoices.subtotal/total from the line items whenever they change.
CREATE OR REPLACE FUNCTION recompute_invoice_from_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target uuid;
  sub    numeric;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF target IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(line_total), 0) INTO sub FROM invoice_line_items WHERE invoice_id = target;
  UPDATE invoices
     SET subtotal   = sub,
         total      = sub + COALESCE(tax, 0),
         updated_at = now()
   WHERE id = target;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_total ON invoice_line_items;
CREATE TRIGGER trg_invoice_lines_total
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION recompute_invoice_from_lines();
