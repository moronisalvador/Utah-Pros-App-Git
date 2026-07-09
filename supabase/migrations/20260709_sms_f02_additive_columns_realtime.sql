-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_sms_f02_additive_columns_realtime
-- Phase: SMS-Experience Wave 0 — F-core (Foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds two new, optional columns to the `messages` table so we can record, for
--   each outgoing text, how many "segments" Twilio split it into and what it cost —
--   the raw numbers behind a future deliverability/spend dashboard. Nothing reads
--   or requires them yet; older rows simply leave them blank. It also formally
--   records (in schema-as-code) that `messages` and `conversations` are members of
--   the Supabase realtime publication, which is how the inbox UI updates live — a
--   fact that was true in the database but never written down in a migration.
--
-- ADDITIVE-ONLY:
--   Two new nullable columns (no default, no backfill, no data change) and an
--   existence-guarded realtime-publication membership add. No DROP/RENAME/ALTER
--   COLUMN on a live table. The realtime add is a no-op on live (both tables are
--   already members — verified 2026-07-09).
--
--   Capture of the messages.twilio_sid UNIQUE constraint + partial index lives in
--   the sibling drift-capture migration 20260709_sms_f01_drift_capture.sql.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   ALTER TABLE public.messages DROP COLUMN IF EXISTS num_segments;
--   ALTER TABLE public.messages DROP COLUMN IF EXISTS price;
--   -- realtime membership pre-existed this migration; leave it (removing it would
--   -- break the live inbox). If ever needed on a fresh build:
--   --   ALTER PUBLICATION supabase_realtime DROP TABLE public.messages, public.conversations;
-- ════════════════════════════════════════════════

-- Per-message Twilio metering columns (Phase A fills them from the status callback).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS num_segments integer;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS price        numeric;

COMMENT ON COLUMN public.messages.num_segments IS 'Twilio SMS segment count for this message (from the status callback / message resource). Nullable; null on legacy + inbound rows.';
COMMENT ON COLUMN public.messages.price        IS 'Twilio-reported price for this message (negative string in Twilio; stored as numeric). Nullable; null until Twilio reports it.';

-- Track realtime publication membership (untracked drift). Idempotent: only ADD
-- what is missing, so applying to live (both already members) is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END $$;
