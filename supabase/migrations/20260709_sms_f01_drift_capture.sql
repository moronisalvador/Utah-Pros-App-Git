-- ════════════════════════════════════════════════
-- MIGRATION: 20260709_sms_f01_drift_capture
-- Phase: SMS-Experience Wave 0 — F-core (Foundation)
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   The five tables that power the whole texting/inbox system — messages,
--   conversations, conversation_participants, sms_consent_log and
--   scheduled_messages — exist in the LIVE database but were never written down
--   in a migration file (they "drifted in", created by hand outside schema-as-code).
--   This migration re-derives their EXACT current shape from the live catalog so
--   the repo can rebuild them and so every later phase has one written source of
--   truth. It changes NOTHING in production: every statement is IF-NOT-EXISTS /
--   existence-guarded, so applying it to the live database is a no-op. On a fresh
--   database it recreates the five tables faithfully.
--
--   Reproduced from information_schema / pg_get_* introspection on 2026-07-09
--   (project glsmljpabrwonfiltiqm, schema public): columns, PK/FK/UNIQUE/CHECK
--   constraints, every index (incl. the messages.twilio_sid UNIQUE constraint +
--   its partial index — untracked drift the roadmap calls out), RLS on/off, and
--   the live row-level policies.
--
--   Precedent: 20260708_dbf_drift_capture_system_events.sql,
--   20260703_tech_v2_phaseF_drift_capture.sql (same schema-as-code baseline move).
--
-- ADDITIVE-ONLY / NO-OP ON LIVE:
--   No table DROP/RENAME/ALTER COLUMN, no data change. Structure via
--   CREATE TABLE/INDEX IF NOT EXISTS; policies via existence-guarded CREATE (never
--   DROP) so no lock or gap is taken on the live hot tables. The two additive
--   columns messages.num_segments / messages.price ship in the SEPARATE migration
--   20260709_sms_f02 (they are NOT live yet, so they are not part of this snapshot).
--
-- ── DEFERRED (Wave 0-RED / F-red · owner-gated) ──
--   messages / conversations / conversation_participants still carry PERMISSIVE
--   `anon` SELECT/INSERT/UPDATE policies (the db-foundation §8 deferred-anon gap).
--   This migration reproduces that live surface FAITHFULLY — it does NOT close it.
--   Closing those anon policies TO authenticated is F-red's behavior-neutral,
--   owner-gated RED change (roadmap "Wave 0-RED"); do not fold it in here. The
--   anon table GRANTs below are reproduced ONLY for the columns the RLS policies
--   actually exercise (SELECT/INSERT/UPDATE); the live over-grants (anon
--   DELETE/TRUNCATE/REFERENCES/TRIGGER) are deliberately NOT re-asserted here and
--   NOT revoked here (revoke is F-red's job) — they remain exactly as live.
--   scheduled_messages / sms_consent_log are already authenticated-scoped (the
--   `allow_anon_*` NAMES on them are historical; the live roles are authenticated).
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   This is a faithful no-op snapshot of already-live objects; there is nothing to
--   undo on the live database (re-applying is idempotent, un-applying changes
--   nothing that was not already present). For a FRESH build only, the created
--   objects drop with their tables:
--     DROP TABLE IF EXISTS public.scheduled_messages CASCADE;
--     DROP TABLE IF EXISTS public.sms_consent_log CASCADE;
--     DROP TABLE IF EXISTS public.conversation_participants CASCADE;
--     DROP TABLE IF EXISTS public.messages CASCADE;
--     DROP TABLE IF EXISTS public.conversations CASCADE;
-- ════════════════════════════════════════════════

-- ─── 1. conversations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  type                  text        NOT NULL DEFAULT 'direct',
  title                 text,
  job_id                uuid,
  status                text        NOT NULL DEFAULT 'needs_response',
  assigned_to           uuid,
  twilio_number         text,
  twilio_group_sid      text,
  unread_count          integer     NOT NULL DEFAULT 0,
  last_message_at       timestamptz,
  last_message_preview  text,
  first_response_at     timestamptz,
  status_changed_at     timestamptz DEFAULT now(),
  job_phase_context     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- omni-inbox Foundation (20260704_omni_inbox_foundation.sql) added this column;
  -- reproduced here so this snapshot is a complete standalone table definition.
  email_reply_token     text        DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text)),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_type_check   CHECK ((type   = ANY (ARRAY['direct'::text, 'group'::text, 'broadcast'::text]))),
  CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['needs_response'::text, 'waiting_on_client'::text, 'resolved'::text, 'archived'::text]))),
  CONSTRAINT conversations_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(id),
  CONSTRAINT conversations_job_id_fkey      FOREIGN KEY (job_id)      REFERENCES public.jobs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_email_reply_token_key ON public.conversations USING btree (email_reply_token) WHERE (email_reply_token IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned     ON public.conversations USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_conversations_job          ON public.conversations USING btree (job_id) WHERE (job_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON public.conversations USING btree (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status       ON public.conversations USING btree (status) WHERE (status <> 'archived'::text);

-- ─── 2. messages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  conversation_id   uuid        NOT NULL,
  type              text        NOT NULL,
  body              text,
  channel           text        DEFAULT 'sms',
  status            text        NOT NULL DEFAULT 'queued',
  twilio_sid        text,
  sent_by           uuid,
  sender_phone      text,
  sender_contact_id uuid,
  media_urls        jsonb,
  rcs_content_sid   text,
  read_at           timestamptz,
  clicked_at        timestamptz,
  error_code        text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- omni-inbox Foundation columns (20260704) — reproduced for a complete snapshot.
  direction         text,
  email_message_id  text,
  in_reply_to       text,
  email_references  text,
  email_from        text,
  email_to          text,
  subject           text,
  email_html        text,
  sender_email      text,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_twilio_sid_key UNIQUE (twilio_sid),
  CONSTRAINT messages_type_check      CHECK ((type = ANY (ARRAY['sms_inbound'::text, 'sms_outbound'::text, 'internal_note'::text, 'email_inbound'::text, 'email_outbound'::text]))),
  CONSTRAINT messages_status_check    CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'undelivered'::text, 'received'::text]))),
  CONSTRAINT messages_channel_check   CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['sms'::text, 'mms'::text, 'rcs'::text, 'email'::text])))),
  CONSTRAINT messages_direction_check CHECK (((direction IS NULL) OR (direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'note'::text])))),
  CONSTRAINT messages_conversation_id_fkey   FOREIGN KEY (conversation_id)   REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT messages_sender_contact_id_fkey FOREIGN KEY (sender_contact_id) REFERENCES public.contacts(id),
  CONSTRAINT messages_sent_by_fkey           FOREIGN KEY (sent_by)           REFERENCES public.employees(id)
);

-- twilio_sid: the live UNIQUE constraint (above) is backed by messages_twilio_sid_key;
-- there is ALSO a partial index for lookups. Both are untracked drift — captured here.
CREATE INDEX IF NOT EXISTS idx_messages_twilio_sid ON public.messages USING btree (twilio_sid) WHERE (twilio_sid IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages USING btree (conversation_id, created_at DESC);
-- omni-inbox partial-unique on email_message_id (20260704) — reproduced for completeness.
CREATE UNIQUE INDEX IF NOT EXISTS messages_email_message_id_key ON public.messages USING btree (email_message_id) WHERE (email_message_id IS NOT NULL);

-- ─── 3. conversation_participants ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL,
  contact_id      uuid        NOT NULL,
  phone           text        NOT NULL,
  role            text,
  is_active       boolean     NOT NULL DEFAULT true,
  added_at        timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  email           text,  -- omni-inbox (20260704)
  CONSTRAINT conversation_participants_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_participants_conversation_id_contact_id_key UNIQUE (conversation_id, contact_id),
  CONSTRAINT conversation_participants_contact_id_fkey      FOREIGN KEY (contact_id)      REFERENCES public.contacts(id),
  CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_contact_id ON public.conversation_participants USING btree (contact_id);
CREATE INDEX IF NOT EXISTS idx_participants_conversation ON public.conversation_participants USING btree (conversation_id) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_participants_phone ON public.conversation_participants USING btree (phone);

-- ─── 4. sms_consent_log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_consent_log (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  contact_id   uuid        NOT NULL,
  phone        text        NOT NULL,
  event_type   text        NOT NULL,
  source       text,
  details      text,
  performed_by uuid,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_consent_log_pkey PRIMARY KEY (id),
  CONSTRAINT sms_consent_log_contact_id_fkey   FOREIGN KEY (contact_id)   REFERENCES public.contacts(id),
  CONSTRAINT sms_consent_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.employees(id)
);

CREATE INDEX IF NOT EXISTS idx_consent_log_contact ON public.sms_consent_log USING btree (contact_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_event   ON public.sms_consent_log USING btree (event_type);
CREATE INDEX IF NOT EXISTS idx_consent_log_phone   ON public.sms_consent_log USING btree (phone);

-- ─── 5. scheduled_messages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL,
  body            text        NOT NULL,
  media_urls      jsonb,
  send_at         timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  template_id     uuid,
  created_by      uuid,
  sent_message_id uuid,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'cancelled'::text, 'failed'::text]))),
  CONSTRAINT scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT scheduled_messages_created_by_fkey      FOREIGN KEY (created_by)      REFERENCES public.employees(id),
  CONSTRAINT scheduled_messages_sent_message_id_fkey FOREIGN KEY (sent_message_id) REFERENCES public.messages(id),
  CONSTRAINT scheduled_messages_template_id_fkey     FOREIGN KEY (template_id)     REFERENCES public.message_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON public.scheduled_messages USING btree (send_at) WHERE (status = 'pending'::text);

-- ─── 6. RLS (all five already ENABLED live; idempotent) ───────────────────────
ALTER TABLE public.conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_consent_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_messages        ENABLE ROW LEVEL SECURITY;

-- ─── 7. Policies (existence-guarded CREATE — no DROP, so no lock/gap on live) ──
-- Faithful reproduction of the LIVE policy surface. The `anon` policies on
-- messages/conversations/conversation_participants are the db-foundation §8
-- deferred-anon gap; F-red (Wave 0-RED) closes them — NOT this migration.
DO $$
BEGIN
  -- conversations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='allow_anon_read_conversations') THEN
    CREATE POLICY allow_anon_read_conversations   ON public.conversations FOR SELECT TO anon USING (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='allow_anon_insert_conversations') THEN
    CREATE POLICY allow_anon_insert_conversations ON public.conversations FOR INSERT TO anon WITH CHECK (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='allow_anon_update_conversations') THEN
    CREATE POLICY allow_anon_update_conversations ON public.conversations FOR UPDATE TO anon USING (true) WITH CHECK (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='allow_authenticated_conversations') THEN
    CREATE POLICY allow_authenticated_conversations ON public.conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='allow_anon_read_messages') THEN
    CREATE POLICY allow_anon_read_messages  ON public.messages FOR SELECT TO anon USING (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='allow_anon_write_messages') THEN
    CREATE POLICY allow_anon_write_messages ON public.messages FOR INSERT TO anon WITH CHECK (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='allow_authenticated_messages') THEN
    CREATE POLICY allow_authenticated_messages ON public.messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- conversation_participants
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversation_participants' AND policyname='allow_anon_read_conversation_participants') THEN
    CREATE POLICY allow_anon_read_conversation_participants   ON public.conversation_participants FOR SELECT TO anon USING (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversation_participants' AND policyname='allow_anon_insert_conversation_participants') THEN
    CREATE POLICY allow_anon_insert_conversation_participants ON public.conversation_participants FOR INSERT TO anon WITH CHECK (true);  -- public: deferred-anon (F-red closes)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversation_participants' AND policyname='allow_authenticated_conversation_participants') THEN
    CREATE POLICY allow_authenticated_conversation_participants ON public.conversation_participants FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- sms_consent_log (already authenticated-scoped; names are historical)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sms_consent_log' AND policyname='allow_anon_read_consent_log') THEN
    CREATE POLICY allow_anon_read_consent_log   ON public.sms_consent_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sms_consent_log' AND policyname='allow_anon_insert_consent_log') THEN
    CREATE POLICY allow_anon_insert_consent_log ON public.sms_consent_log FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sms_consent_log' AND policyname='allow_authenticated_consent_log') THEN
    CREATE POLICY allow_authenticated_consent_log ON public.sms_consent_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- scheduled_messages (already authenticated-scoped; names are historical)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_messages' AND policyname='allow_anon_read_scheduled_messages') THEN
    CREATE POLICY allow_anon_read_scheduled_messages   ON public.scheduled_messages FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_messages' AND policyname='allow_anon_insert_scheduled_messages') THEN
    CREATE POLICY allow_anon_insert_scheduled_messages ON public.scheduled_messages FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_messages' AND policyname='allow_authenticated_scheduled_messages') THEN
    CREATE POLICY allow_authenticated_scheduled_messages ON public.scheduled_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 8. Grants ────────────────────────────────────────────────────────────────
-- Trusted roles: reproduce the live grant set (minus the TRUNCATE privilege — a
-- fresh build stays least-privilege; live grants are untouched since GRANT never
-- revokes. Omitted deliberately: the block-destructive-sql guard rejects the
-- TRUNCATE token and no code path truncates these tables).
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.conversations             TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.messages                  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.conversation_participants TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.sms_consent_log           TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.scheduled_messages        TO authenticated, service_role;

-- anon: reproduce ONLY the surface the live RLS policies exercise (the
-- deferred-anon gap F-red will close). The live over-grants (anon DELETE/TRUNCATE/
-- REFERENCES/TRIGGER) are intentionally NEITHER re-asserted NOR revoked here —
-- revoke is F-red's owner-gated RED change (see DEFERRED note in the header).
GRANT SELECT, INSERT         ON public.messages                  TO anon;  -- public: deferred-anon (F-red closes)
GRANT SELECT, INSERT, UPDATE ON public.conversations             TO anon;  -- public: deferred-anon (F-red closes)
GRANT SELECT, INSERT         ON public.conversation_participants TO anon;  -- public: deferred-anon (F-red closes)
