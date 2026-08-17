---
name: gcal-acl-finding-already-resolved
description: The notify_google_calendar_sync authenticated-EXECUTE finding is already fixed inside pending migration 20260730214500 — do not author a separate ACL migration
metadata: 
  node_type: memory
  type: project
  originSessionId: b5629a24-afe3-4d47-ae0c-77d961126cbe
  modified: 2026-07-31T14:12:26.850Z
---

A stale task/finding circulates asking for a standalone ACL-only migration revoking
`authenticated` EXECUTE on `public.notify_google_calendar_sync(uuid,text,jsonb)`, citing a
DEFERRED note and post-apply body md5 `9c12900f57b2516170dc374b5a63cc23`. Both facts describe the
ORIGINAL draft of `supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql` (commit
b30356b8). Commit f2ea2ef1 (2026-07-30 23:59) amended that still-unapplied migration in place:
the ACL tightening is folded in (service-role-only), the DEFERRED entry was removed, and the real
post-apply body md5 is `07ee1574e28447ddae2c868a841eb2d8`.

**Why:** authoring the "requested" follow-up migration would duplicate existing statements and
ship a drift guard keyed to an md5 that will never match.

**How to apply:** if a finding names this function's authenticated grant, check
20260730214500 (and `git log` on it) before authoring anything. The change ships when the owner
authorizes that migration's apply window; live DB still grants `authenticated` until then.
Verified 2026-07-31: migration-safety-checker + anon-grant-auditor both pass on the amended
version; only fix applied was a commented re-GRANT escape hatch in the rollback header.
