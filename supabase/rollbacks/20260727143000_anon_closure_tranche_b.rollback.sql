-- ════════════════════════════════════════════════
-- ROLLBACK: 20260727143000_anon_closure_tranche_b
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Puts back the wide-open access that tranche (b) closed, exactly as it was.
--   Only run this if closing anon access actually broke something in production.
--
--   Be aware of what you are restoring: with these policies in place, anyone
--   holding the public browser key — which is every visitor — can read and edit
--   every customer's name, phone, email and address, and read every conversation.
--   Prefer diagnosing the breakage and granting the specific access needed to
--   `authenticated` over restoring blanket anon access.
--
-- FIDELITY:
--   Predicates below are copied verbatim from the live catalog captured
--   2026-07-27 before the migration ran, so this restores the prior state
--   byte-for-byte rather than approximating it.
-- ════════════════════════════════════════════════

-- ── contacts ────────────────────────────────────────────────────────────────
CREATE POLICY allow_anon_read_contacts ON public.contacts
  FOR SELECT TO anon USING (true);
CREATE POLICY allow_anon_update_contacts ON public.contacts
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_anon_insert_contacts ON public.contacts
  FOR INSERT TO anon WITH CHECK (true);

-- ── conversations ───────────────────────────────────────────────────────────
CREATE POLICY allow_anon_read_conversations ON public.conversations
  FOR SELECT TO anon USING (true);
CREATE POLICY allow_anon_update_conversations ON public.conversations
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY allow_anon_insert_conversations ON public.conversations
  FOR INSERT TO anon WITH CHECK (true);

-- ── conversation_participants ───────────────────────────────────────────────
CREATE POLICY allow_anon_read_conversation_participants ON public.conversation_participants
  FOR SELECT TO anon USING (true);
CREATE POLICY allow_anon_insert_conversation_participants ON public.conversation_participants
  FOR INSERT TO anon WITH CHECK (true);

-- Table privileges as they stood before the revoke: anon held SELECT, INSERT,
-- UPDATE and DELETE on all three (DELETE on contacts had no policy behind it).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contacts                  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_participants TO anon;
