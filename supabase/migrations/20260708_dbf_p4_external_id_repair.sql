-- ═════════════════════════════════════════════════════════════════════════════
-- 20260708_dbf_p4_external_id_repair.sql
-- DB-Foundation Phase P4 — external-ID dedup repair  [item ②]  ⚠️ RED — OWNER-GATED
--   docs/db-foundation-roadmap.md → Phase P4 block · docs/db-foundation-p4-orphan-report.md §3
--
--   ⚠️  DATA UPDATE on the shared production DB. Per the roadmap autonomy ledger
--       this is RED-tier: it is STAGED, not auto-applied. Apply via the Supabase
--       MCP only after the owner approves, in a window that does NOT overlap the
--       P3 anon-closure apply (both strong-lock claims/contacts — report §7).
--
-- WHAT THIS DOES (plain language):
--   Two kinds of genuine duplicate imports left two rows pointing at the same
--   external record. This clears the external-ID from ONLY the wrong (non-
--   canonical) row of each pair so each external record maps to exactly one UPR
--   row. It never touches the canonical row, and never touches a money or status
--   column — only the external-ID text column is set to NULL.
--
--   • claims.encircle_claim_id (4 pairs): the canonical row is the one Encircle's
--     own `contractor_identifier` names (verified live via the Encircle API). In
--     every case that is the CLM-2606-* row; the older CLM-260[34]-* row had the
--     Encircle id wrongly attached and is cleared. Jobs/rooms on both rows are
--     untouched — clearing the id only unlinks the wrong row from Encircle.
--   • contacts.qbo_customer_id (1 pair): "Jaren Pope" was imported twice; the row
--     carrying the claim + email is canonical, the stray zero-reference row is
--     cleared.
--
--   Each UPDATE is guarded by BOTH the row id AND the current external-ID value,
--   so it is idempotent (re-running changes 0 rows) and a no-op if the data has
--   since changed. A final assertion RAISEs if any duplicate external-ID remains.
--
--   NOT repaired (see report §2/§3): invoices.qbo_invoice_id / payments.qbo_payment_id
--   (legitimate combined billing, both rows canonical); invoices.qbo_invoice_id=4274
--   (anomaly for owner/QBO review). Owner follow-ups: merge the same-claim pair
--   4077213 and the duplicate contact 531 (fold the correct +1 801 phone into the
--   canonical row, delete the stray) — out of P4's narrow external-ID scope.
--
-- ROLLBACK (restores each cleared id to its pre-repair value):
--   UPDATE public.claims   SET encircle_claim_id='4018951' WHERE id='cd742f5a-f28b-438d-930a-46feb3f15216';
--   UPDATE public.claims   SET encircle_claim_id='4077213' WHERE id='ff218cae-70b4-4873-8138-1f437bd84836';
--   UPDATE public.claims   SET encircle_claim_id='4382559' WHERE id='afa6648f-390c-4af9-b72a-5544e9d0a8b7';
--   UPDATE public.claims   SET encircle_claim_id='4392873' WHERE id='65b7493f-8a9d-4ddf-95d1-66fd0fc19efb';
--   UPDATE public.contacts SET qbo_customer_id='531'      WHERE id='93bd0fc8-2fed-4d11-9b00-c4b909a6ba7b';
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── claims: clear encircle_claim_id on the NON-canonical (older CLM-260[34]) row ──
UPDATE public.claims SET encircle_claim_id = NULL
  WHERE id = 'cd742f5a-f28b-438d-930a-46feb3f15216' AND encircle_claim_id = '4018951';
UPDATE public.claims SET encircle_claim_id = NULL
  WHERE id = 'ff218cae-70b4-4873-8138-1f437bd84836' AND encircle_claim_id = '4077213';
UPDATE public.claims SET encircle_claim_id = NULL
  WHERE id = 'afa6648f-390c-4af9-b72a-5544e9d0a8b7' AND encircle_claim_id = '4382559';
UPDATE public.claims SET encircle_claim_id = NULL
  WHERE id = '65b7493f-8a9d-4ddf-95d1-66fd0fc19efb' AND encircle_claim_id = '4392873';

-- ── contacts: clear qbo_customer_id on the stray zero-reference duplicate ──
UPDATE public.contacts SET qbo_customer_id = NULL
  WHERE id = '93bd0fc8-2fed-4d11-9b00-c4b909a6ba7b' AND qbo_customer_id = '531';

-- ── assertion: no duplicate external-ID may remain on the repaired columns ──
DO $$
DECLARE d int;
BEGIN
  SELECT count(*) INTO d FROM (
    SELECT encircle_claim_id FROM public.claims
    WHERE encircle_claim_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1
  ) x;
  IF d <> 0 THEN RAISE EXCEPTION 'P4 repair FAIL: % duplicate claims.encircle_claim_id group(s) remain', d; END IF;

  SELECT count(*) INTO d FROM (
    SELECT qbo_customer_id FROM public.contacts
    WHERE qbo_customer_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1
  ) x;
  IF d <> 0 THEN RAISE EXCEPTION 'P4 repair FAIL: % duplicate contacts.qbo_customer_id group(s) remain', d; END IF;

  -- canonical rows must still carry their external id (never cleared)
  PERFORM 1 FROM public.claims WHERE id='e8c0ef86-9bf2-4545-be08-313d7b3a80a0' AND encircle_claim_id='4018951';
  IF NOT FOUND THEN RAISE EXCEPTION 'P4 repair FAIL: canonical claim 4018951 lost its id'; END IF;
  PERFORM 1 FROM public.contacts WHERE id='2c97bcce-9d65-41d3-bc9d-9c92aaad8612' AND qbo_customer_id='531';
  IF NOT FOUND THEN RAISE EXCEPTION 'P4 repair FAIL: canonical contact 531 lost its id'; END IF;
END $$;

COMMIT;
