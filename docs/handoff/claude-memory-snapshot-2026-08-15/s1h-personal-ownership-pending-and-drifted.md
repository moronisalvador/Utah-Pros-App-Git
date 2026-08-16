---
name: s1h-personal-ownership-pending-and-drifted
description: 20260727022920_mobile_personal_ownership_boundary was never applied and its own preflight would now fail on RLS drift — meanwhile the anon policy it closes is still live
metadata: 
  node_type: memory
  type: project
  originSessionId: 0f547a20-1cbb-4bc2-a94e-8757aac64730
  modified: 2026-08-01T03:49:43.130Z
---

`supabase/migrations/20260727022920_mobile_personal_ownership_boundary.sql` is on `origin/dev` but was
**never applied** to production (`glsmljpabrwonfiltiqm`). Verified 2026-07-31: its only new object
`is_current_active_internal_employee(uuid)` returns null from `to_regprocedure`.

Two things make this more than a routine pending apply:

1. **It can no longer be applied as written.** Its `DO $s1h_preflight$` block requires all four target
   tables at `relrowsecurity=true AND relforcerowsecurity=false`. Only 2 now qualify — `device_tokens`
   and `notification_prefs` had FORCE RLS enabled by later migrations. Applying it raises
   `S1h preflight table owner/RLS drift`. It needs a revision, not just an apply window.
2. **The hole it exists to close is still open.** `employee_page_access` still carries policy
   `anon_read_employee_page_access` granted to `anon` + `authenticated` for SELECT with `qual=true`.

All three named ledger prerequisites are satisfied (`permission_write_gates` @20260727012825,
`upsert_employee_page_access_provenance_reconciliation` @20260727233845,
`mobile_employee_identity_containment` @20260728002105) — the apply simply never happened.

It is **missing from** `.claude/rules/initiative-status.md`'s "Authored but NOT applied" section,
which lists only the conversation_participant pair. That omission is why it went unnoticed.

Runbook: `docs/mobile/s1h-database-apply-runbook.md`. Paired rollback exists, guarded by
`SET upr.allow_unsafe_s1h_rollback='on'`.
