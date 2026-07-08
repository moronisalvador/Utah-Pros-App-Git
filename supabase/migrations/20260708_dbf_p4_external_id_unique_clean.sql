-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p4_external_id_unique_clean.sql
-- DB-Foundation Phase P4 — external-ID uniqueness (dup-free columns)  [item ③, clean subset]
--   docs/db-foundation-roadmap.md → Phase P4 block · docs/db-foundation-p4-orphan-report.md §1
--
-- WHAT THIS DOES (plain language):
--   Two external-ID columns are one-to-one identities (one UPR row per external
--   record) and have ZERO duplicates today, but nothing stopped a future double
--   import from creating one. This adds a uniqueness guard on each so the same
--   external record can never be imported twice:
--     • forms.encircle_note_id            (the Encircle note a form created; 6 rows)
--     • google_calendar_links.google_event_id (the Google event a link maps to; 23 rows)
--   Both use the partial-unique-index form (WHERE ... IS NOT NULL) so the many
--   rows that legitimately have no external id yet are unaffected. The Google
--   sync updates a link in place (never duplicate-inserts) and clears the id to
--   NULL on delete, so this guard matches existing behavior — verified in
--   functions/lib/google-calendar.js.
--
--   Most other 1:1 import-identity columns are ALREADY unique from prior
--   migrations (inbound_leads.callrail_id, job_documents.encircle_media_id,
--   job_notes.encircle_note_id, rooms.encircle_room_id, messages.twilio_sid,
--   payments.stripe_charge_id). The QBO invoice/payment ids are NOT unique
--   (combined billing — report §2) and are excluded. claims.encircle_claim_id and
--   contacts.qbo_customer_id need a data repair first and land in the RED
--   companion migration (…_external_id_unique_repaired.sql).
--
-- APPLY-WINDOW (database-standard.md §5): YELLOW / additive. Neither table is
--   P3-contested; applied 2026-07-08 in a discrete window. CREATE UNIQUE INDEX
--   (non-concurrent) on 6/23-row tables is a sub-millisecond lock.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.forms_encircle_note_id_uniq;
--   DROP INDEX IF EXISTS public.google_calendar_links_google_event_id_uniq;
-- ═════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS forms_encircle_note_id_uniq
  ON public.forms (encircle_note_id)
  WHERE encircle_note_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_links_google_event_id_uniq
  ON public.google_calendar_links (google_event_id)
  WHERE google_event_id IS NOT NULL;
