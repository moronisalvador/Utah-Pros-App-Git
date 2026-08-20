-- ════════════════════════════════════════════════
-- ROLLBACK: 20260820030000_invoice_share_tokens
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes the customer invoice links and the read the public page uses.
--
-- WHAT IT COSTS — read before running:
--   ⚠️ This DESTROYS every link already issued. Any URL already emailed to a
--   customer stops working immediately and cannot be restored; the customer
--   would need a fresh link sent. Check what is live first:
--
--     SELECT count(*) FROM public.invoice_shares
--      WHERE status = 'active' AND expires_at > now();
--
--   It also destroys UPR's own send history — who was emailed, when, and how
--   often they opened it. `invoices.qbo_emailed_at` does NOT substitute for
--   that: `cas_qbo_invoice_link` NULLs it whenever the QuickBooks link changes,
--   which is the reason this table exists.
--
-- WHAT IT DOES NOT TOUCH:
--   No invoice, payment, job, contact or claim row is modified. Money is
--   unaffected. The only loss is the links themselves and their history.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_invoice_by_share_token(text);
DROP FUNCTION IF EXISTS public.revoke_invoice_share(uuid);
DROP FUNCTION IF EXISTS public.create_invoice_share(uuid, text, integer, uuid);

-- Indexes and the policy go with the table.
DROP TABLE IF EXISTS public.invoice_shares;
