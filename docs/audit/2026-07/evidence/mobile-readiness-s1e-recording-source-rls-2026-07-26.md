<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1e-recording-source-rls-2026-07-26.md

WHAT THIS DOES (plain language):
  Records sanitized S1e live metadata, source decisions, verification and external gates.

DEPENDS ON:
  Internal: S1e migration/rollback/tests, R0-S1d evidence, canonical mobile/security docs
  Data:     reads → catalog/source metadata only
            writes → documentation only

NOTES / GOTCHAS:
  - No recording URL, row, customer, provider, configuration or secret value was selected.
  - The migration is authored only and is not live.
-->

# Mobile readiness S1e — recording-source RLS

**Captured:** 2026-07-26 18:43 UTC  
**Branch:** `codex/mobile-readiness-s1e-recording-source-rls`  
**Requested base:** `fa58dba49817dd50671c0dbca0e353074dc599e1`  
**Fetched origin/dev:** `6b5dc802710d78c8f4329ae0f47379f2ecf1a5ee`  
**Drift merge:** `02ed432a7ff209ac730859c90563d0e08fdb5835`  
**Migration:** `20260726183409_inbound_lead_recording_source_boundary.sql` — not applied

## Bounded live evidence

Only catalog metadata was selected. `get_inbound_leads(p_limit integer) -> jsonb` is SQL,
`SECURITY DEFINER`, owner `postgres`, `search_path=public`, body MD5
`8e9119ed1af57bd45c6af4ed227ef38f`, definition MD5
`91f8a68db54b69dd0005602f174dee86`, denied to `anon`, and executable by
`authenticated`/`service_role`. Its body selects `il.*`, so it returns the stored URL.

`inbound_leads` has RLS enabled but not forced. Its exact ACL grants all table privileges to
`postgres`, `anon`, `authenticated`, and `service_role`; its sole policy is permissive
`inbound_leads_all FOR ALL TO authenticated USING (true) WITH CHECK (true)`. No application trigger
exists. The table includes nullable text `recording_url`.

Available authority fields are `employees.auth_user_id`, `role`, `is_active`, `is_external`;
`employee_page_access(employee_id,nav_key,can_view)`; and
`nav_permissions(nav_key,role,can_view,can_edit)`. `inbound_leads.org_id` points to `crm_orgs`, but
`crm_orgs` has no employee membership. `crm_tasks.assignee_id` is task assignment only, and
`lead_pipeline_stage` has no employee assignment. A narrower employee/CRM organization predicate
cannot be honestly constructed from the current model.

## Exact consumers and compatibility

The browser RPC callers are desktop `CrmCallLog.jsx` and mobile `AdminLeadCenter.jsx`. Both use
`recording_url` only as truthy availability and send only `lead_id` to the approved proxy. Direct
browser table consumers are `CrmLeads`, `CrmTasks`, `CrmOverview`, and `ForecastWidget`;
`CrmLeads` uses `select=*`. Service-role readers are the recording proxy, transcription Worker, and
ingestion idempotency checks. Composite-return/activity RPCs make column-only revocation
insufficient: raw URLs must leave the public row to close response paths without breaking shapes.

## Authored boundary

The migration creates a forced-RLS, service-only source table, backfills raw URLs without returning
or logging them, replaces public values with `upr-recording://available`, and installs a
deferrable-FK BEFORE trigger so future writes are captured before composite `RETURNING` responses.
It removes anonymous privileges and authenticated DML. Direct SELECT is company-wide for active
non-external employees because the model supports no narrower assignment.
`get_inbound_leads` preserves signature, JSON keys, order and 1–500 limit while requiring admin or
effective `crm_call_log` capability.

The proxy and transcription Worker read the service-only source table. Proxy identity,
lead/provider-call binding, URL allowlist, credential ordering, direct/signed audio streaming,
timeout and JSON error contracts remain unchanged.

Rollback drops the trigger, restores raw URLs and the exact prior RPC body/grants/policy, then
drops the source table. It deliberately reopens the finding.

## Verification and reviews

Initial focused verification passed 46/46 tests. Full build/test/lint and independent
security/contract/release results are recorded in the final handoff; live role behavior remains
unproved until an authorized apply.

## Rollout

1. Integrate the reviewed complete foundation→S1e history into the release branch.
2. Deploy compatible `callrail-recording` and `transcribe-call` source first.
3. Recapture only target function/table/policy/trigger/source-table metadata; stop on drift.
4. Apply only S1e in a serialized owner window, separately from S1d.
5. Verify marker-only browser responses, denied anon/inactive/external/direct DML, allowed active
   internal reads, admin/`crm_call_log` RPC access, and service-only source access without selecting
   URL values.
6. Run advisors, capture ledger/provenance, and only under separate provider authorization perform
   a non-customer playback/transcription canary.

## Residuals

S1d apply, `create_notification`, QBO actor telemetry, `qbo_attachments` RLS, private media, wider
identity/device/route-family RPC/RLS, external-partner UI compatibility, provider/device/native and
release gates remain separate. No live mutation or provider action occurred.
