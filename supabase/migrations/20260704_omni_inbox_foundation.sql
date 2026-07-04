-- ─────────────────────────────────────────────────────────────────────────────
-- Omnichannel Inbox — Phase F (Foundation) schema + shared RPCs
--
-- docs/omni-inbox-roadmap.md "Phase F", .claude/rules/omni-inbox-wave-ownership.md §3
-- (the authoritative spec on names). Foundation owns 100% of the wave's schema; the
-- Inbound (I) / Outbound (O) / Unified-UI (U) sessions ship ZERO schema.
--
-- Adds INBOUND + OUTBOUND EMAIL to the existing SMS-only conversation model, unified
-- into one per-contact thread. All changes are ADDITIVE (CLAUDE.md Rule 7):
--   • new nullable columns (existing writers keep working untouched),
--   • CHECK constraints WIDENED only (every value that validated before still does —
--     proved by the omni_verify_foundation() self-test + the committed vitest suite),
--   • one new table (email_inbound_events) RLS-enabled with a policy at creation,
--   • three new SECURITY DEFINER functions.
-- No ALTER/DROP/rename of any live table's existing shape.
--
-- One shared Supabase across dev + main → every change here is live in BOTH the moment
-- it applies. Consuming code (workers/UI) deploys AFTER this, so the additive columns
-- and widened constraints are inert until something writes the new values.
--
-- DISCLOSED DEVIATIONS from manifest §3 (which assumed a pre-existing vocabulary):
--   1. email_suppressions.reason CHECK really allowed only
--      (unsubscribed|bounced|complained|manual). The manifest/roadmap name the gate
--      vocabulary hard_bounce|complaint|global, and the resend-webhook is specified to
--      write reason='hard_bounce'/'complaint'. Resolved by a WIDEN-ONLY CHECK swap that
--      keeps the four legacy values AND adds hard_bounce|complaint|global. Additive,
--      test-guarded — Foundation owns 100% of schema and CHECK widens (manifest §4).
--   2. record_email_suppression() — a Foundation-internal helper (resend-webhook only,
--      consumed by NO wave session, so it breaks no cross-session contract). Needed
--      because email_suppressions has a UNIQUE(lower(email)) EXPRESSION index that
--      PostgREST cannot upsert against from the worker; the RPC does the conflict +
--      reason-precedence upsert server-side (never downgrades a hard suppression).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. messages — direction + email columns, widened channel/type CHECKs ═══════

-- direction: convenience discriminator (the wave renders off `type`; direction is a
-- generic inbound/outbound/note axis for future non-SMS/email channels). NULLABLE so
-- the frozen SMS writers (twilio-webhook / send-message / process-scheduled), which do
-- not set it, keep inserting. Backfilled from the existing `type` below.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS direction text;

-- Email fields — all nullable (only inbound/outbound EMAIL rows populate them).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_message_id text;  -- provider Message-ID (inbound) — UNIQUE below
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS in_reply_to      text;  -- In-Reply-To header of an inbound email
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_references text;  -- References header (thread chain)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_from       text;  -- raw From header
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_to         text;  -- raw To header
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS subject          text;  -- email subject
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_html       text;  -- sanitized inbound HTML / outbound HTML
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_email     text;  -- parsed sender address (display only; NOT a threading key — spoofable)

-- UNIQUE on the provider Message-ID (partial: only where present) → inbound idempotency
-- as a secondary guard behind claim_inbound_email. Partial so the many NULLs don't clash.
CREATE UNIQUE INDEX IF NOT EXISTS messages_email_message_id_key
  ON public.messages (email_message_id) WHERE email_message_id IS NOT NULL;

-- direction CHECK (passes on NULL — legacy/SMS-writer rows). Backfill from type.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_direction_check;
ALTER TABLE public.messages ADD  CONSTRAINT messages_direction_check
  CHECK (direction IS NULL OR direction IN ('inbound', 'outbound', 'note'));

UPDATE public.messages SET direction = CASE
    WHEN type IN ('sms_inbound', 'email_inbound')   THEN 'inbound'
    WHEN type IN ('sms_outbound', 'email_outbound') THEN 'outbound'
    WHEN type = 'internal_note'                     THEN 'note'
    ELSE direction
  END
  WHERE direction IS NULL;

-- channel: give it DEFAULT 'sms' (finding F-2 — three writers bypassed any new param)
-- and backfill existing NULLs, then WIDEN the CHECK to add 'email'. Kept NULLABLE so no
-- frozen writer breaks; the DEFAULT catches inserts that omit it.
ALTER TABLE public.messages ALTER COLUMN channel SET DEFAULT 'sms';
UPDATE public.messages SET channel = 'sms' WHERE channel IS NULL;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE public.messages ADD  CONSTRAINT messages_channel_check
  CHECK (channel IS NULL OR channel IN ('sms', 'mms', 'rcs', 'email'));

-- type: WIDEN to add email_inbound / email_outbound (existing three retained).
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages ADD  CONSTRAINT messages_type_check
  CHECK (type IN ('sms_inbound', 'sms_outbound', 'internal_note', 'email_inbound', 'email_outbound'));

-- ═══ 2. conversation_participants — email address ══════════════════════════════
-- Nullable: SMS-only participants have no email; email participants populate it.
ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS email text;

-- ═══ 3. conversations — email_reply_token (the sole authoritative reply correlator) ═
-- Replies come back to reply+<token>@utahpros.app; the token → conversation mapping is
-- unspoofable and provider-independent (Resend does not return outbound Message-IDs).
-- ≥128-bit random: two dashless UUIDs = 64 hex chars = 256 bits, dependency-free.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS email_reply_token text
  DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

-- Backfill every existing conversation so all threads are email-reply-ready.
UPDATE public.conversations
  SET email_reply_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  WHERE email_reply_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_email_reply_token_key
  ON public.conversations (email_reply_token) WHERE email_reply_token IS NOT NULL;

-- ═══ 4. email_suppressions.reason — WIDEN CHECK (see disclosed deviation #1) ════
ALTER TABLE public.email_suppressions DROP CONSTRAINT IF EXISTS email_suppressions_reason_check;
ALTER TABLE public.email_suppressions ADD  CONSTRAINT email_suppressions_reason_check
  CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual', 'hard_bounce', 'complaint', 'global'));

-- ═══ 5. email_inbound_events — inbound/email-event idempotency ledger ═══════════
-- One row per claimed provider event key. claim_inbound_email() (Phase I) claims an
-- inbound Message-ID; resend-webhook reuses it (key 'resend:<svix-id>') for webhook
-- dedup — both are email-event idempotency, one namespaced ledger, no collision.
CREATE TABLE IF NOT EXISTS public.email_inbound_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_key text NOT NULL UNIQUE,      -- inbound Message-ID or 'resend:<svix-id>'
  claimed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_inbound_events ENABLE ROW LEVEL SECURITY;
-- Staff may read/manage the ledger; the anon path reaches it ONLY through the
-- SECURITY DEFINER claim RPC (which bypasses RLS), and the service-role workers bypass
-- RLS. No anon table policy → anon cannot pre-poison the ledger directly.
DROP POLICY IF EXISTS "email_inbound_events_authenticated" ON public.email_inbound_events;
CREATE POLICY "email_inbound_events_authenticated" ON public.email_inbound_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ 6. claim_inbound_email(p_message_key) → boolean ═══════════════════════════
-- Idempotency claim: TRUE the first time a key is seen, FALSE on every duplicate.
-- A blank/NULL key returns FALSE (never claims). SECURITY DEFINER so the anon inbound
-- worker path and the resend-webhook can claim without a table policy.
CREATE OR REPLACE FUNCTION public.claim_inbound_email(p_message_key text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows int;
BEGIN
  IF p_message_key IS NULL OR btrim(p_message_key) = '' THEN
    RETURN false;
  END IF;
  INSERT INTO public.email_inbound_events (message_key)
  VALUES (btrim(p_message_key))
  ON CONFLICT (message_key) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_inbound_email(text) TO anon, authenticated;

-- ═══ 7. record_email_suppression(p_email, p_reason, p_source) (see deviation #2) ═
-- Upserts one suppression row per address (UNIQUE lower(email)), NEVER downgrading a
-- hard suppression back to a soft 'unsubscribed'. Fed by resend-webhook on permanent
-- bounce (hard_bounce) / complaint (complaint). Resolves the live (non-test) org.
CREATE OR REPLACE FUNCTION public.record_email_suppression(
  p_email  text,
  p_reason text,
  p_source text DEFAULT NULL
)
RETURNS public.email_suppressions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_row public.email_suppressions;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN NULL;
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN
       ('unsubscribed', 'bounced', 'complained', 'manual', 'hard_bounce', 'complaint', 'global') THEN
    RAISE EXCEPTION 'invalid suppression reason: %', p_reason;
  END IF;

  v_org := (SELECT id FROM public.crm_orgs WHERE is_test = false ORDER BY created_at LIMIT 1);

  INSERT INTO public.email_suppressions (org_id, email, reason, source)
  VALUES (v_org, btrim(p_email), p_reason, p_source)
  ON CONFLICT (lower(email)) DO UPDATE
    SET reason        = CASE WHEN public.email_suppressions.reason = 'unsubscribed'
                             THEN EXCLUDED.reason ELSE public.email_suppressions.reason END,
        source        = COALESCE(EXCLUDED.source, public.email_suppressions.source),
        suppressed_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_email_suppression(text, text, text) TO anon, authenticated;

-- ═══ 8. omni_verify_foundation() → jsonb — self-cleaning migration self-test ════
-- Proves, against the live schema, that every OLD + NEW messages.type/channel value
-- inserts and bogus values are rejected, plus claim_inbound_email idempotency — then
-- deletes all throwaway rows it created (conversation, messages, their system_events,
-- the claim key). Whole body is one transaction: on any error everything rolls back, so
-- it NEVER leaves residue. Backs supabase/tests/omni_messages_check_widen.test.js and
-- doubles as a post-deploy health check.
CREATE OR REPLACE FUNCTION public.omni_verify_foundation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv     uuid;
  v_msg      uuid;
  v_ids      uuid[] := '{}';
  v_val      text;
  v_type_ok    jsonb := '{}'::jsonb;
  v_channel_ok jsonb := '{}'::jsonb;
  v_type_rej boolean := false;
  v_chan_rej boolean := false;
  v_key      text;
  v_claim1   boolean;
  v_claim2   boolean;
  v_types    text[] := ARRAY['sms_inbound','sms_outbound','internal_note','email_inbound','email_outbound'];
  v_channels text[] := ARRAY['sms','mms','rcs','email'];
BEGIN
  INSERT INTO public.conversations (type, status, title)
  VALUES ('direct', 'needs_response', '__omni_selftest__')
  RETURNING id INTO v_conv;

  FOREACH v_val IN ARRAY v_types LOOP
    BEGIN
      INSERT INTO public.messages (conversation_id, type, channel, body)
      VALUES (v_conv, v_val, 'sms', 'selftest') RETURNING id INTO v_msg;
      v_ids := array_append(v_ids, v_msg);
      v_type_ok := v_type_ok || jsonb_build_object(v_val, true);
    EXCEPTION WHEN check_violation THEN
      v_type_ok := v_type_ok || jsonb_build_object(v_val, false);
    END;
  END LOOP;

  FOREACH v_val IN ARRAY v_channels LOOP
    BEGIN
      INSERT INTO public.messages (conversation_id, type, channel, body)
      VALUES (v_conv, 'sms_outbound', v_val, 'selftest') RETURNING id INTO v_msg;
      v_ids := array_append(v_ids, v_msg);
      v_channel_ok := v_channel_ok || jsonb_build_object(v_val, true);
    EXCEPTION WHEN check_violation THEN
      v_channel_ok := v_channel_ok || jsonb_build_object(v_val, false);
    END;
  END LOOP;

  BEGIN
    INSERT INTO public.messages (conversation_id, type, channel, body)
    VALUES (v_conv, '__bogus__', 'sms', 'selftest');
  EXCEPTION WHEN check_violation THEN v_type_rej := true;
  END;

  BEGIN
    INSERT INTO public.messages (conversation_id, type, channel, body)
    VALUES (v_conv, 'sms_outbound', '__bogus__', 'selftest');
  EXCEPTION WHEN check_violation THEN v_chan_rej := true;
  END;

  v_key    := 'selftest:' || gen_random_uuid()::text;
  v_claim1 := public.claim_inbound_email(v_key);
  v_claim2 := public.claim_inbound_email(v_key);

  -- Clean up every artifact (append-only system_events from the insert trigger too).
  DELETE FROM public.system_events WHERE entity_type = 'message' AND entity_id = ANY(v_ids);
  DELETE FROM public.messages       WHERE conversation_id = v_conv;
  DELETE FROM public.conversations  WHERE id = v_conv;
  DELETE FROM public.email_inbound_events WHERE message_key = v_key;

  RETURN jsonb_build_object(
    'type_accepts',          v_type_ok,
    'channel_accepts',       v_channel_ok,
    'type_rejects_bogus',    v_type_rej,
    'channel_rejects_bogus', v_chan_rej,
    'claim_first',           v_claim1,
    'claim_second',          v_claim2
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.omni_verify_foundation() TO anon, authenticated;

-- ═══ 9. feature:email_inbox flag — dev-only for the owner until U ships ═════════
INSERT INTO public.feature_flags (key, enabled, dev_only_user_id, category, label, description, updated_at)
VALUES (
  'feature:email_inbox',
  false,
  'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da',
  'feature',
  'Email Inbox',
  'Omnichannel inbox — inbound + outbound email unified into the SMS conversation thread (docs/omni-inbox-roadmap.md). Owner-only until Phase U ships and the owner opens it in DevTools → Flags.',
  now()
)
ON CONFLICT (key) DO UPDATE
  SET dev_only_user_id = EXCLUDED.dev_only_user_id,
      category         = EXCLUDED.category,
      label            = EXCLUDED.label,
      description      = EXCLUDED.description,
      updated_at       = now();

-- New table + functions added after initial deploy → refresh PostgREST's schema cache.
SELECT public.bust_postgrest_cache();
