-- ════════════════════════════════════════════════
-- ROLLBACK: 20260726193000_ops_health_recipients
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Undoes the "send system health alerts to one person" change. After running
--   this, those alerts go back to every admin, exactly as before.
--
-- SAFETY:
--   Removes one settings row. No customer data, no secret, nothing else reads
--   this key. The Worker treats an absent value as "use the normal audience", so
--   alerting keeps working rather than going silent.
-- ════════════════════════════════════════════════

DELETE FROM public.integration_config
WHERE key = 'ops_health_recipient_ids';
