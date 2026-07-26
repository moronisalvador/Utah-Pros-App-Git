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
or logging them, replaces public values with `upr-recording://available`, captures future scalar
sources in an AFTER trigger once lead IDs exist, and recursively removes recording-source keys
from historical and future `raw_payload`. The ingestion adapter also strips those keys before the
RPC. It removes anonymous privileges, authenticated DML, and authenticated execution of the
service ingestion RPC. Direct SELECT is company-wide for active
non-external employees because the model supports no narrower assignment.
`get_inbound_leads` preserves signature, JSON keys, order and 1–500 limit while requiring admin or
effective `crm_call_log` capability.

The proxy and transcription Worker read the service-only source table and retain a validated
legacy-column fallback for Worker-first rollout; neither accepts the marker as a source. Proxy identity,
lead/provider-call binding, URL allowlist, credential ordering, direct/signed audio streaming,
timeout and JSON error contracts remain unchanged.

Rollback drops the triggers, restores scalar raw URLs and the exact prior RPC body/grants/policy,
then drops the source table. It deliberately reopens the finding. Removed `raw_payload` keys are
not reconstructed because doing so would require duplicating or retaining the sensitive source.

## Verification and reviews

The first independent security, contract and release reviews rejected the draft for four reasons:
recording keys remained in `raw_payload`; Workers required the table before migration; a BEFORE
trigger could not safely reference a speculative upsert ID; and only static database checks existed.
The corrected source scrubs mapper/backfill and database payloads, supports both deployment states
without accepting the marker, captures scalar sources AFTER the row exists, revokes browser ingest,
adds value-free pre/post-apply SQL, and documents the irreversible privacy scrub.

Actual verification after those corrections:

- focused Worker/migration suite: 77/77;
- full `npm test`: unit 774/774, Worker 1384/1384, QA 16/16;
- web and `VITE_BUILD_TARGET=native` builds: passed, 665 modules each; no Capacitor sync/sign/device;
- changed-file ESLint: passed;
- full lint: known baseline 206 errors/119 warnings, with no changed-file violation;
- tooling governance: zero errors/two temporary CAP warnings; provenance tests 13/13 and worktree
  provenance passed for 27 ledger rows/21 functions/5 policies with four declared semantic warnings.

No isolated PostgreSQL clone was available, so the unapplied migration and apply-window scripts
were not executed. Live role behavior remains an owner-authorized apply-window gate.

## Rollout

1. Integrate the reviewed complete foundation→S1e history into the release branch.
2. Deploy compatible `callrail-recording` and `transcribe-call` source first; their validated
   legacy fallback supports the pre-migration schema.
3. Recapture only target function/table/policy/trigger/source-table metadata; stop on drift.
4. Because the earlier S1d migration remains pending, apply only the exact reviewed S1e SQL through
   an owner-controlled single-migration mechanism; do not run a chronological all-pending command.
5. Verify marker-only browser responses, denied anon/inactive/external/direct DML, allowed active
   internal reads, admin/`crm_call_log` RPC access, and service-only source access without selecting
   URL values.
6. Run advisors, capture ledger/provenance, and only under separate provider authorization perform
   a non-customer playback/transcription canary.

## Residuals

S1d apply, `create_notification`, QBO actor telemetry, `qbo_attachments` RLS, private media, wider
identity/device/route-family RPC/RLS, external-partner UI compatibility, provider/device/native and
release gates remain separate. No live mutation or provider action occurred.
