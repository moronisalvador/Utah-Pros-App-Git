-- ════════════════════════════════════════════════
-- ROLLBACK: 20260820020000_stripe_payment_command_ledger
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Removes everything the forward migration added: the record of Stripe
--   accounting actions, the five routines that write it, and its off switch.
--
-- WHY IT IS SAFE:
--   The forward migration is purely additive — it modified no existing table,
--   policy, grant or row — and its feature flag ships DISABLED, so nothing
--   consumes any of this until a later, separately reviewed change turns it on.
--   Running this simply returns the database to its pre-migration shape.
--
-- WHAT IT COSTS:
--   Any rows in `stripe_payment_commands` are destroyed with the table. If the
--   feature was ever enabled and real Stripe payments were projected, those rows
--   are the ONLY record of which QuickBooks entity each Stripe object produced
--   and which Intuit request id was frozen for it. Losing them does not lose
--   money — `payments.qbo_payment_id` and `stripe_fee_qbo_purchase_id` still
--   carry the resulting links — but it does lose the ability to retry an
--   in-flight provider call under its original identity.
--
--   ⚠️ THEREFORE: if the flag has ever been enabled in this environment, take a
--   copy first and confirm no command is mid-flight:
--     SELECT * FROM public.stripe_payment_commands
--      WHERE status IN ('provider_started','ambiguous','needs_reconciliation');
--   That set must be empty. A row in 'provider_started' means a QuickBooks call
--   may have landed whose response was never seen; dropping it discards the only
--   safe retry identity and a later manual retry could double-post.
-- ════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_stripe_payment_command(text, text);
DROP FUNCTION IF EXISTS public.finalize_stripe_payment_command(uuid, text, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.start_stripe_payment_command(uuid);
DROP FUNCTION IF EXISTS public.reserve_stripe_payment_command(text, text, text, text, text, jsonb, uuid, uuid, text);

-- Dropped last: the four routines above call it.
DROP FUNCTION IF EXISTS public.stripe_command_guard();

-- Indexes and the policy go with the table.
DROP TABLE IF EXISTS public.stripe_payment_commands;

DELETE FROM public.feature_flags WHERE key = 'feature:stripe_payment_command_v1';
