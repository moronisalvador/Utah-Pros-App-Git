/**
 * ════════════════════════════════════════════════
 * FILE: 20260702_crm_phase5_replan_stages.sql
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Updates the CRM build tracker for the Phase 5 re-plan (2026-07-02). Phase 5
 *   ("Visual automation builder") had been parked as future/unscheduled with a single
 *   placeholder stage; the owner scheduled it today as a linear automation-recipes
 *   build. This refreshes the phase's title, swaps the placeholder stage for the real
 *   stage list, and leaves every other row untouched.
 *
 * DEPENDS ON:
 *   Data: writes → crm_build_phases (title/sort refresh — status NOT touched),
 *                  crm_build_stages (delete 1 placeholder, insert 7 real stages)
 *
 * NOTES / GOTCHAS:
 *   - Idempotent: the phase upsert uses ON CONFLICT (phase_key) DO UPDATE on title +
 *     sort_order only (status is never touched, so a re-run can't un-ship anything);
 *     stage inserts use ON CONFLICT (phase_key, title) DO NOTHING; the placeholder
 *     DELETE matches its exact title, so a re-run deletes nothing.
 *   - The placeholder deletion is DISCLOSED in docs/crm-roadmap.md ("Phase 5 re-plan"
 *     → status reconciliation): the stage said "defined when this phase is actually
 *     scheduled" — it now IS scheduled, so keeping it would surface a permanently
 *     false open todo on /crm/roadmap and the public /status page.
 *   - Status changes only ever flow through set_crm_phase_status /
 *     set_crm_stage_status (the Session K build flips them at close-out).
 * ════════════════════════════════════════════════
 */

-- Refresh the Phase 5 row (status stays 'planned' — flips to shipped only via
-- set_crm_phase_status at the build session's close-out).
INSERT INTO crm_build_phases (phase_key, title, sort_order)
VALUES ('5', 'Automation recipes — linear visual builder', 8)
ON CONFLICT (phase_key) DO UPDATE
  SET title = EXCLUDED.title, sort_order = EXCLUDED.sort_order;

-- Remove the pre-plan placeholder stage (now false-by-design; disclosed in the roadmap).
DELETE FROM crm_build_stages
WHERE phase_key = '5'
  AND title = 'Close-out checklist defined when this phase is actually scheduled — inherits the generic close-out rule';

-- The real stages (mirrors the Phase 5 close-out checklist in docs/crm-roadmap.md
-- → "Phase 5 re-plan (2026-07-02)").
INSERT INTO crm_build_stages (phase_key, title, sort_order) VALUES
  ('5', 'Test-first: idempotent run-creation (UNIQUE(automation_id, triggering_event_id)); S1 trigger-collision guard blocks save AND fire; SMS held (kill-switch/quiet-hours) never dropped; AND-condition evaluator null-safe', 0),
  ('5', 'Acceptance: /crm/automations builder (trigger → AND conditions → ordered actions: email/sms/enroll/task) behind feature:crm_automations; engine fires on system_events through the frozen gate; runs logged to crm_automation_runs + worker_runs', 1),
  ('5', 'npm run test + npm run build + npx eslint pass; ONE additive migration only (crm_automations + crm_automation_runs + own RPCs, RLS + policy at creation)', 2),
  ('5', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off weighted on send path + S1 guard', 3),
  ('5', 'Visual: builder + run log on preview', 4),
  ('5', 'UPR-Web-Context.md updated', 5),
  ('5', 'Set phase 5 shipped; delete test rules/runs; pushed, verified, PR opened', 6)
ON CONFLICT (phase_key, title) DO NOTHING;
