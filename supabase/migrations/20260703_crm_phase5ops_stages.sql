-- ════════════════════════════════════════════════
-- FILE: 20260703_crm_phase5ops_stages.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the "Phase 5-Ops" row and its stage checklist to the CRM build tracker.
--   Phase 5-Ops extends the automation engine with operations actions (staff
--   notify, job note, job phase, draft invoice), scheduled-scan triggers, and a
--   starter recipe pack. Seeded 'planned'; the build session flips statuses via
--   the status RPCs at its close-out.
--
-- DEPENDS ON:
--   Data: writes → crm_build_phases (one new row), crm_build_stages (7 new rows)
--
-- NOTES / GOTCHAS:
--   - Idempotent: ON CONFLICT (phase_key) DO UPDATE refreshes title/sort only
--     (status untouched — a re-run can never un-ship anything); stage inserts are
--     ON CONFLICT (phase_key, title) DO NOTHING.
--   - Plan of record: docs/crm-roadmap.md → "Phase 5-Ops plan (2026-07-03)".
-- ════════════════════════════════════════════════

INSERT INTO crm_build_phases (phase_key, title, sort_order)
VALUES ('5-ops', 'Ops actions, scan triggers & recipe pack', 16)
ON CONFLICT (phase_key) DO UPDATE
  SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order;

INSERT INTO crm_build_stages (phase_key, title, sort_order) VALUES
  ('5-ops', 'Test-first: scan idempotency (deterministic uuid dedup); draft-invoice never double-invoices and never touches /api/qbo-invoice; set_job_phase writes jobs AND job_phase_history; moisture scan honors MT day boundary; seeds all enabled=false', 0),
  ('5-ops', 'Acceptance: 4 ops actions (notify_staff/job_note/set_job_phase/create_draft_invoice) + scan rules (5-scan registry, thresholds-only config) live in the builder + engine; 7 starter recipes seeded disabled; S1 guard untouched', 1),
  ('5-ops', 'npm run test + npm run build + npx eslint pass; ONE additive migration (2 ADD COLUMNs + set_job_phase RPC + seeds)', 2),
  ('5-ops', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off weighted on draft-invoice + scan idempotency', 3),
  ('5-ops', 'Visual: ops actions + a scan rule in the builder on preview', 4),
  ('5-ops', 'UPR-Web-Context.md updated', 5),
  ('5-ops', 'Set phase 5-ops shipped; delete test rules/runs/draft invoices; pushed, verified, PR opened', 6)
ON CONFLICT (phase_key, title) DO NOTHING;
