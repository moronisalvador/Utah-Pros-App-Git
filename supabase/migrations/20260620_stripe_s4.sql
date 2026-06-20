-- 20260620_stripe_s4.sql
-- Stripe S4 — refunds & disputes. When Stripe refunds a charge or a dispute is opened,
-- the collected funds are reversed in UPR and QuickBooks so A/R reopens.
--
-- payments.amount has CHECK (amount > 0), so a refund can't be a negative row — instead
-- we net it via refunded_amount and teach the rollup trigger to subtract it. Defaulting
-- refunded_amount to 0 means existing rows behave exactly as before.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS refunded_amount numeric NOT NULL DEFAULT 0,  -- refunded/withheld (disputes) — netted out of collected
  ADD COLUMN IF NOT EXISTS refunded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_status  text;                        -- Stripe dispute status when under dispute

-- Recompute payments → invoice/job rollup, netting refunded_amount everywhere "amount"
-- was summed. Also reopen a previously-paid invoice's status when collected drops back to
-- 0 (refund/dispute, or a deleted payment) — the old version left it stale at 'paid'.
CREATE OR REPLACE FUNCTION public.update_invoice_paid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_invoice_id uuid;
  target_job_id uuid;
  ins_paid numeric;
  ho_paid numeric;
  total_paid_amt numeric;
  invoice_total numeric;
  job_collected numeric;
BEGIN
  target_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  target_job_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_id ELSE NEW.job_id END;

  -- INVOICE UPDATE (only if invoice_id is NOT NULL)
  IF target_invoice_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(amount - COALESCE(refunded_amount, 0)) FILTER (WHERE payer_type = 'insurance'), 0),
      COALESCE(SUM(amount - COALESCE(refunded_amount, 0)) FILTER (WHERE payer_type IN ('homeowner','other')), 0),
      COALESCE(SUM(amount - COALESCE(refunded_amount, 0)), 0)
    INTO ins_paid, ho_paid, total_paid_amt
    FROM payments WHERE invoice_id = target_invoice_id;

    SELECT COALESCE(adjusted_total, total) INTO invoice_total
    FROM invoices WHERE id = target_invoice_id;

    UPDATE invoices SET
      amount_paid = total_paid_amt,
      insurance_paid = ins_paid,
      homeowner_paid = ho_paid,
      status = CASE
        WHEN invoice_total > 0 AND total_paid_amt >= invoice_total THEN 'paid'
        WHEN total_paid_amt > 0 THEN 'partially_paid'
        WHEN status IN ('paid','partially_paid') THEN 'sent'   -- reopened by refund/dispute/removed payment
        ELSE status
      END,
      paid_at = CASE WHEN invoice_total > 0 AND total_paid_amt >= invoice_total THEN now() ELSE NULL END,
      updated_at = now()
    WHERE id = target_invoice_id;
  END IF;

  -- JOB COLLECTED_VALUE UPDATE (always, using job_id directly)
  job_collected := COALESCE((SELECT SUM(amount - COALESCE(refunded_amount, 0)) FROM payments WHERE job_id = target_job_id), 0);
  UPDATE jobs SET
    collected_value = job_collected,
    ar_status = CASE
      WHEN job_collected = 0 THEN CASE WHEN invoiced_value > 0 THEN 'invoiced' ELSE 'open' END
      WHEN job_collected >= COALESCE(invoiced_value, 0) THEN 'paid'
      ELSE 'partial'
    END,
    updated_at = now()
  WHERE id = target_job_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
