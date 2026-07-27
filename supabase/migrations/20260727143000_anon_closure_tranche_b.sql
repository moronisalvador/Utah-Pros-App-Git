-- ════════════════════════════════════════════════
-- MIGRATION: 20260727143000_anon_closure_tranche_b
-- Phase: Anon closure, tranche (b) — the customer record itself
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Stops anyone on the internet from reading or changing our customer list.
--
--   The key the website uses to talk to the database is public by design — it
--   ships inside the browser bundle, so every visitor has it. Today that key can
--   read every contact we have: name, phone, email, billing address. It can also
--   edit any of them, and read every conversation and who was in it. Nobody has
--   to log in.
--
--   After this, those three tables answer only to a logged-in employee. Nothing
--   a person actually uses changes: every screen that reads them is behind the
--   login, and the office/field policies that serve them are left exactly as
--   they are.
--
-- ADDITIVE-ONLY:
--   No — this is a deliberate REVOKE (RED tier), which is the point. It drops
--   eight always-true anon policies and revokes table privileges from the anon
--   role. It creates and drops no table, column, index or function, touches no
--   `authenticated` policy, and changes no row of business data.
--
-- EVIDENCE (live catalog + caller inventory, 2026-07-27):
--   - contacts: allow_anon_read_contacts (SELECT/true), allow_anon_update_contacts
--     (UPDATE/true/true), allow_anon_insert_contacts (INSERT/true). anon also holds
--     the DELETE privilege with no policy behind it — the revoke closes that too.
--   - conversations: allow_anon_read/update/insert_conversations, same shape.
--   - conversation_participants: allow_anon_read/insert_conversation_participants.
--   - The `authenticated` side already covers every real caller and is UNTOUCHED:
--     contacts_authenticated_{select,insert,update,delete} (is_crm_partner-scoped),
--     allow_authenticated_conversations (ALL/true),
--     allow_authenticated_conversation_participants (ALL/true).
--   - Caller inventory: 21 direct browser reads of these tables, ALL on
--     authenticated surfaces (Layout, Conversations, Customers, CRM, tech pages,
--     DevTools, Merge/Estimate/Esign modals). They run with a real JWT as
--     `authenticated`, so the revoke does not reach them.
--   - The ONLY logged-out surface is SignPage, and it reads NONE of these three.
--     It calls two token-scoped RPCs (get_sign_request_by_token,
--     get_sign_document_templates) and POSTs /api/submit-esign. Verified by
--     reading the file, not inferred.
--   - Neither AuthContext nor Login reads these tables, so the pre-login
--     bootstrap path is unaffected.
--   - Workers are unaffected: they use the service-role client
--     (functions/lib/supabase.js), which this revoke never names.
--   - Realtime is unaffected: subscriptions run on the logged-in user's JWT as
--     `authenticated`. Precedent — `messages` anon access was already closed the
--     same way (sms-experience F-red) and realtime kept working.
--
-- DEFERRED-BUCKET RELEASE (disclosed):
--   .claude/rules/db-foundation-wave-ownership.md §8 defers these three tables
--   pending Schedule-A / omni-inbox. This ships under §8's alternative clause —
--   "OR ship a committed backward-compat test that the in-flight caller still
--   succeeds" — exactly as tranche (a) did. Tests:
--     supabase/tests/anon_closure_tranche_b.test.js   (behavioural; db lane)
--     tests/qa/unit/anon-closure-tranche-b.test.js    (CI-visible source contract)
--   The db lane does NOT run in `npm test` (backlog 6.1), so the CI-visible test
--   is what actually gates this in CI. It proves INTENT, not effect.
--
-- ════════════════════════════════════════════════
-- ROLLBACK:
--   Run supabase/rollbacks/20260727143000_anon_closure_tranche_b.rollback.sql
--   It recreates all eight anon policies with their exact original predicates and
--   re-grants SELECT, INSERT, UPDATE, DELETE on the three tables to anon,
--   restoring the prior (deliberately permissive) posture.
-- ════════════════════════════════════════════════

-- ── contacts ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS allow_anon_read_contacts   ON public.contacts;
DROP POLICY IF EXISTS allow_anon_update_contacts ON public.contacts;
DROP POLICY IF EXISTS allow_anon_insert_contacts ON public.contacts;

-- ── conversations ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS allow_anon_read_conversations   ON public.conversations;
DROP POLICY IF EXISTS allow_anon_update_conversations ON public.conversations;
DROP POLICY IF EXISTS allow_anon_insert_conversations ON public.conversations;

-- ── conversation_participants ───────────────────────────────────────────────
DROP POLICY IF EXISTS allow_anon_read_conversation_participants   ON public.conversation_participants;
DROP POLICY IF EXISTS allow_anon_insert_conversation_participants ON public.conversation_participants;

-- Defence in depth: RLS with no anon policy already denies, but the table
-- privileges are unnecessary for a role that must never reach these tables.
-- `authenticated` and `service_role` are deliberately NOT named here.
REVOKE ALL ON TABLE public.contacts                  FROM anon;
REVOKE ALL ON TABLE public.conversations             FROM anon;
REVOKE ALL ON TABLE public.conversation_participants FROM anon;
