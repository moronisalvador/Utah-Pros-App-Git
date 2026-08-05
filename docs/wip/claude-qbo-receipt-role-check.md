---
branch: claude/qbo-receipt-role-check
ships: true
opened: 2026-08-05
---

# What

QBO grouped receive-payment repair: all 8 DB routines fixed (feature has NEVER worked) — UNCOMMITTED in worktree inspiring-tesla-8b829c

# Why it matters

Complete reviewed-quality fix incl. migration 20260805010000_qbo_receipt_service_role_check_repair + rollback + tests; discarding the worktree loses it

# Next action

Resume session 'Fix NOT_AUTHORIZED in 7 QBO receipt RPCs'; reconcile with origin/dev, then commit
