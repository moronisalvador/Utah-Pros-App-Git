-- ════════════════════════════════════════════════
-- FILE: 20260702_crm_roadmap_v3_phases.sql
-- ════════════════════════════════════════════════
--
-- WHAT THIS DOES (plain language):
--   Adds the Roadmap v3 build phases (Foundation F, 6a, 6b, 7, 8, 9, 10) and
--   their checklist stages to the CRM build-progress tracker, so the
--   /crm/roadmap page and the public /status page show the new plan. Also
--   adds one new checklist item to Phase 1 (verifying web-form capture).
--   Purely additive seed data — existing phase/stage rows are never touched
--   (ON CONFLICT DO NOTHING throughout).
--
-- DEPENDS ON:
--   Data: writes → crm_build_phases, crm_build_stages
--         reads  → (none)
--
-- NOTES / GOTCHAS:
--   - Spec of record: docs/crm-roadmap.md → "Roadmap v3" section.
--   - Phase keys are text ('F', '6a', '10'); sort_order continues after
--     phase 5 (sort 8). Display order is roadmap order, not execution order
--     (execution: F first, then one parallel wave — see the roadmap doc).
--   - Stage rows are idempotent on UNIQUE(phase_key, title).
-- ════════════════════════════════════════════════

INSERT INTO crm_build_phases (phase_key, title, sort_order) VALUES
  ('F',  'Foundation — schema, interfaces & wiring (parallel-wave enabler)', 9),
  ('6a', 'Contacts read & segments',                                        10),
  ('6b', 'Ownership, CSV import, staff roles & audit hardening',            11),
  ('7',  'Daily driver — tasks, timeline, comms in shell',                  12),
  ('8',  'Drip / nurture sequences',                                        13),
  ('9',  'Intelligence — scoring, forecasting, reports, AI digest',         14),
  ('10', 'CRM Forms — embeddable lead capture',                             15)
ON CONFLICT (phase_key) DO NOTHING;

INSERT INTO crm_build_stages (phase_key, title, sort_order) VALUES
  -- Phase 1 (additive stage — roadmap v3 finding: form path wired but untested)
  ('1', 'Form-capture verified: real CallRail form fixture + mapFormPayload/ingestion tests — or closed as superseded by Phase 10 CRM Forms (owner decision, disclosed)', 8),

  -- Phase F — Foundation
  ('F', 'Test-first: merge_contacts CRM-safety + shared-RPC backward-compat + consentAllows + normalizePhone', 0),
  ('F', 'Acceptance: all wave schema (8 groups) live with org_id+RLS; ~31 signature-frozen stubs; sms branch behind sms_sending_enabled kill-switch; slots + wiring + ownership manifest committed', 1),
  ('F', 'npm run test + npm run build + npx eslint pass', 2),
  ('F', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off', 3),
  ('F', 'Visual: stub routes render on branch preview; no live-page regressions', 4),
  ('F', 'UPR-Web-Context.md updated', 5),
  ('F', 'Set phase F shipped; reconcile stages; pushed to dev, verified, dev → main PR opened', 6),

  -- Phase 6a — Contacts read & segments
  ('6a', 'Test-first: get_contact_consent unified DNC read; segment filter round-trip; email-normalized duplicate detection', 0),
  ('6a', 'Acceptance: contacts directory + read detail (tags, DNC badge, timeline) in F skeleton; segments CRUD reusable in campaigns; merge fix verified landed', 1),
  ('6a', 'npm run test + npm run build + npx eslint pass; zero schema migrations (body replaces only)', 2),
  ('6a', 'migration-safety-checker + upr-pattern-checker clean; crm-phase-reviewer sign-off', 3),
  ('6a', 'Visual: /crm/contacts on branch preview', 4),
  ('6a', 'UPR-Web-Context.md updated', 5),
  ('6a', 'Set phase 6a shipped; delete TEST-org rows; pushed, verified, PR opened', 6),

  -- Phase 6b — Ownership, import, roles & audit hardening
  ('6b', 'Test-first: import_contacts dedupe-on-import; audit-hardening events fire; campaign-sent event de-duplicated with counts payload', 0),
  ('6b', 'Acceptance: CSV import/export + MergeTool in skeleton slots; owner + lifecycle settable; per-screen staff roles via feature:crm_* + employeePageAccess before page:crm opens', 1),
  ('6b', 'npm run test + npm run build + npx eslint pass; zero schema migrations', 2),
  ('6b', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off weighted on audit/consent', 3),
  ('6b', 'Visual: import wizard + role-gated nav on preview', 4),
  ('6b', 'UPR-Web-Context.md updated', 5),
  ('6b', 'Set phase 6b shipped; delete TEST-org import rows; pushed, verified, PR opened', 6),

  -- Phase 7 — Daily driver
  ('7', 'Test-first: get_overdue_tasks Mountain-Time predicate; lost-reason required-on-lost via new UI path (RPC backward-compat stays green)', 0),
  ('7', 'Acceptance: CrmTasks real; overdue widget on Overview; win/loss prompt + stage-age badges; CrmConversations staff SMS call-only (never skip_compliance); click-to-call logs system_event', 1),
  ('7', 'npm run test + npm run build + npx eslint pass; zero schema migrations', 2),
  ('7', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off', 3),
  ('7', 'Visual: Tasks, Conversations, Overview widget, lost-reason flow on preview', 4),
  ('7', 'UPR-Web-Context.md updated', 5),
  ('7', 'Set phase 7 shipped; delete test task rows; pushed, verified, PR opened', 6),

  -- Phase 8 — Drip sequences
  ('8', 'Test-first: enrollment idempotency; step-advance math (MT); exit-on-reply/conversion predicates; consent-gated send skip durable', 0),
  ('8', 'Acceptance: sequences CRUD + segment enrollment + pause/stop; process-sequences cron with worker_runs; email live, SMS held behind kill-switch until 4b', 1),
  ('8', 'Segment-UI-to-enroll E2E verification tail after 6a merges (disclosed)', 2),
  ('8', 'npm run test + npm run build + npx eslint pass; zero schema migrations; automated-send.js import-only', 3),
  ('8', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off weighted on consent', 4),
  ('8', 'Visual: sequence builder + enrollments on preview', 5),
  ('8', 'UPR-Web-Context.md updated', 6),
  ('8', 'Set phase 8 shipped; delete test sequences/enrollments; pushed, verified, PR opened', 7),

  -- Phase 9 — Intelligence
  ('9', 'Test-first: score_lead rule math; stageWeight win_probability preference + positional fallback; report RPC math with div-by-zero + null guards', 0),
  ('9', 'Acceptance: fixed report set live (trend, leaderboard, call volume, speed-to-lead, estimate aging, pipeline movement, LTV); ForecastWidget; weekly AI digest via sendGatedEmail; AI reply drafts human-send-only', 1),
  ('9', 'npm run test + npm run build + npx eslint pass; zero schema migrations', 2),
  ('9', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor (digest) clean; crm-phase-reviewer sign-off weighted on money math', 3),
  ('9', 'Visual: Reports set + forecast widget on preview', 4),
  ('9', 'UPR-Web-Context.md updated', 5),
  ('9', 'Set phase 9 shipped; pushed, verified, PR opened', 6),

  -- Phase 10 — CRM Forms
  ('10', 'Test-first: XSS sanitizer; server-side schema validation; upsert_lead_from_form idempotency; consent-write correctness (IP + text version); spam predicates', 0),
  ('10', 'Acceptance: builder (fields incl. consent, link markup, theme, live preview, draft-to-publish versioning); hosted form + embed.js with UTM/gclid/referrer capture; submissions to inbound_leads (form: namespace) + attribution + system_events', 1),
  ('10', 'npm run test + npm run build + npx eslint pass; zero schema migrations', 2),
  ('10', 'migration-safety-checker + upr-pattern-checker + consent-path-auditor clean; crm-phase-reviewer sign-off weighted on public endpoint + consent', 3),
  ('10', 'Visual: builder + live embedded form on a test page', 4),
  ('10', 'UPR-Web-Context.md updated', 5),
  ('10', 'Set phase 10 shipped; delete test forms/submissions; pushed, verified, PR opened', 6)
ON CONFLICT (phase_key, title) DO NOTHING;
