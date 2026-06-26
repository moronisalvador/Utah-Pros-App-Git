-- ════════════════════════════════════════════════
-- MIGRATION: 20260626_pr2_clock_enforce_flag
-- PR-2 (Time-Tracking build plan) — seed the hard-block feature flag (OFF).
--
-- WHAT THIS DOES (plain language):
--   Adds a single feature-flag row that the office can flip ON later to require techs
--   to explicitly clock out of a prior job before starting a new one (instead of the
--   default behavior, which auto-closes the prior clock). Seeded OFF so nothing
--   changes until someone turns it on.
--
-- NOTES / GOTCHAS:
--   - ON CONFLICT DO NOTHING → idempotent / safe to re-run.
--   - Read backend-side by clock_omw_precheck + clock_appointment_action. The client
--     reads the raw enabled value (NOT isFeatureEnabled, which fails-open to true).
-- ════════════════════════════════════════════════
insert into feature_flags (key, enabled, category, label, description, updated_at)
values (
  'clock_enforce_explicit_clockout',
  false,
  'time_tracking',
  'Enforce explicit clock-out',
  'When ON, going On-My-Way while still clocked in on another job is blocked until the prior job is clocked out manually (no auto-supersede). When OFF (default), the prior clock auto-closes after the tech confirms.',
  now()
)
on conflict (key) do nothing;
