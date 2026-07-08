-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p4_external_id_unique_repaired.sql
-- DB-Foundation Phase P4 — external-ID uniqueness (repaired columns)  [item ③]  ⚠️ RED
--   docs/db-foundation-roadmap.md → Phase P4 block · docs/db-foundation-p4-orphan-report.md §3
--
--   ⚠️  APPLY ONLY AFTER 20260708_dbf_p4_external_id_repair.sql has been applied and
--       verified (owner-gated). Creating these unique indexes before the repair
--       will FAIL on the existing duplicate values — that ordering is the safety
--       interlock. RED-tier: it also DROPs a now-redundant index. Serialize vs the
--       P3 apply window (both strong-lock claims/contacts — report §7).
--
-- WHAT THIS DOES (plain language):
--   Once the duplicate imports are repaired, each Encircle claim id and each QBO
--   customer id maps to exactly one UPR row. This locks that in so it can never
--   regress: a partial unique index (WHERE ... IS NOT NULL) on
--   claims.encircle_claim_id and contacts.qbo_customer_id. The many rows with no
--   external id yet are unaffected. On claims it also DROPs the old plain
--   (non-unique) partial index `claims_encircle_claim_id_idx`, which the new
--   unique index fully supersedes (same column, same predicate) — no lookup loses
--   its index.
--
-- CONTESTED-TABLE DISCLOSURE (ownership manifest §8): claims + contacts are in the
--   Schedule-Desktop deferred-hardening bucket (that wave is UNSTARTED — no open
--   PR to collide with). Per §8 this ships with a committed backward-compat check
--   that the current app's insert path still succeeds under the new unique index
--   (a fresh distinct external id inserts; a duplicate is rejected) — proven in a
--   rolled-back transaction in supabase/tests/db_foundation_p4_data_integrity.sql.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.claims_encircle_claim_id_uniq;
--   DROP INDEX IF EXISTS public.contacts_qbo_customer_id_uniq;
--   -- restore the superseded plain index:
--   CREATE INDEX IF NOT EXISTS claims_encircle_claim_id_idx
--     ON public.claims USING btree (encircle_claim_id) WHERE (encircle_claim_id IS NOT NULL);
-- ═════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS claims_encircle_claim_id_uniq
  ON public.claims (encircle_claim_id)
  WHERE encircle_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_qbo_customer_id_uniq
  ON public.contacts (qbo_customer_id)
  WHERE qbo_customer_id IS NOT NULL;

-- Supersede the now-redundant plain partial index (unique index above covers it).
DROP INDEX IF EXISTS public.claims_encircle_claim_id_idx;
