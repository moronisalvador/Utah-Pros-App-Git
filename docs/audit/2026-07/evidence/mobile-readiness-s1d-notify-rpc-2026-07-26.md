<!--
FILE: docs/audit/2026-07/evidence/mobile-readiness-s1d-notify-rpc-2026-07-26.md

WHAT THIS DOES (plain language):
  Records the source, live catalog, caller, ACL/body, test, review, rollout and rollback evidence
  for Mobile Production Readiness S1d: public.notify_emit(text,jsonb).

DEPENDS ON:
  Internal: supabase/migrations/20260726110000_notify_emit_service_boundary.sql,
            its rollback and catalog-only checks, direct caller migrations, notification Worker
            contracts, mobile roadmap/registry, canonical database/security/integration documents,
            R0/S1b/S1c evidence, and migration provenance tooling
  Data:     reads → repository source, Git metadata, pg_proc/ACL/trigger/cron/migration catalog
                       metadata, and dated evidence
            writes → documentation only

NOTES / GOTCHAS:
  - This is reviewed source/local-test and read-only live-catalog evidence, not a migration apply,
    provider, customer, notification, runtime-setting, secret-value, or deployment proof.
  - No notification/customer/configuration value, secret value, pg_net response, payload row,
    provider response, or recording content was selected or inspected.
  - No function, trigger, schedule, notification, provider, migration, deployment, setting, secret,
    message, push, or other external side effect was invoked.
-->

# Mobile readiness S1d — notify RPC capability — 2026-07-26

## Result

S1d produced a narrow, locally verified shared-database apply candidate for
`public.notify_emit(text,jsonb)`:

- direct EXECUTE moves from live `authenticated` plus `service_role` to `service_role` only;
  `PUBLIC` and `anon` remain denied and the owner remains `postgres`;
- the function signature, `void` result, PL/pgSQL, `SECURITY DEFINER`, `search_path=public`,
  volatility/parallel/strict/leakproof modes, catalog/URL no-op gates, configuration key names,
  HTTP URL/secret/header contract, `net.http_post`, and ignored response remain unchanged;
- the one body change reverses the top-level JSON object merge, so a verified object `p_body`
  cannot replace the trusted `p_type_key`;
- no in-body role assertion is added: the exact six database callers are owner-run definers, and
  the abandoned-clock schedule runs as `postgres`;
- no caller, trigger, schedule, table, row, policy, configuration, secret, Worker, response, or
  provider contract is rewritten; and
- the exact prior body and ACL have a drift-guarded emergency rollback.

The migration is **not applied**. Live `authenticated` execution therefore remains until a
separate owner-authorized apply/verification window. S1d alone does not close `MOB-SEC-014`.

## Provenance, instructions and isolation

| Item | Evidence |
|---|---|
| Required base branch | `codex/mobile-readiness-s1c-callrail-notify` |
| Required exact base | `352be211a26f17dffc01565a3d8c75c0fa7e06c7` |
| Fetched `origin/dev` | `d54b6ba7c712384ee592d29de0082edc73493db2` |
| Shared merge base | `90b265ee6f733c8dbcd75786f4e4057dd3355d38` |
| Reconciliation | merge commit `a8708127936a004b025076e020a4bd7d9b633c5f`, parents exact S1c plus `d54b6ba`; no rebase/reset/history rewrite |
| Provenance-only drift | `d54b6ba` changes only the provenance manifest/evidence to map duplicate idempotent `ops_health_alerting` ledger versions `20260725201238` and `20260725201303` to the same reviewed migration |
| S1d branch | `codex/mobile-readiness-s1d-notify-rpc` |
| Isolated worktree | `/private/tmp/upr-mobile-readiness-s1d-notify-rpc` |
| Original checkout | unrelated `.claude/settings.local.json` modification remained untouched |
| Migration/rollback | `48a788f` |
| Static/apply-window tests | `bde5708` |
| Canonical database/security rules | `65ff5c7` |
| Integration/testing/mobile data contracts | `86386ef` |
| Roadmap/registry/master context | `d0a079d` |
| Live capture | `2026-07-26 16:52:53.369884 UTC` |
| Evidence refreshed | `2026-07-26 17:12 UTC` |

The primary reread `AGENTS.md`, `CLAUDE.md`, the complete `$mobile-readiness-wave` skill, applicable
database/scope/documentation/close-out rules, the Supabase skill, canonical architecture/schema/
authorization/business/integration/testing documents, all mobile contracts/roadmaps/ownership
files, the unfinished-work registry, latest dated `live-supabase.md`, full R0/S1b/S1c evidence, and
the relevant notification/audit/context history before editing.

The current official Supabase function guidance says functions are executable by any role by
default unless privileges are explicitly revoked, and recommends explicit role grants plus a
fixed search path for definer functions. S1d therefore performs the revoke after
`CREATE OR REPLACE` and asserts the final ACL. References:
[database functions](https://supabase.com/docs/guides/database/functions?example-view=sql&language=sql&queryGroups=example-view&queryGroups=language)
and [API security](https://supabase.com/docs/guides/api/securing-your-api).

| Owner | Mode | Owned scope | Deliverable |
|---|---|---|---|
| Primary | sole writer/live-read lead | migration, rollback, tests, evidence and canonical docs | integrated S1d result, verification, commits and handoff |
| Caller mapper | read-only | repository caller/trigger/cron graph | exact direct caller and compatibility map |
| Contract auditor | read-only | ACL/body/HTTP/failure/rollback/provenance contracts | independent compatibility verdict |
| Security auditor | read-only | browser bypass, definer, ACL, trusted-key and drift boundaries | independent security verdict |
| Release auditor | read-only after integration | Git state, verification, evidence, apply/rollback gates | final release-readiness verdict |

Only the primary queried live catalog metadata. No concurrent live reads occurred.

## Bounded live capture

Project `glsmljpabrwonfiltiqm` reported `ACTIVE_HEALTHY`, region `us-east-2`, PostgreSQL
`17.6.1.063`. A bounded sequence of primary-only read-only catalog queries selected only:

- target signature/result/language/owner/security/runtime flags/search path/ACL and source hashes;
- the target function source text, which contains configuration **key names**, not stored values;
- direct caller identities, owner/security/search path/body hashes, and call counts;
- trigger definitions/enabled modes;
- the one named cron job's schedule/command/owner/active metadata; and
- migration ledger version/name metadata.

The exact body was recaptured a second time as base64 solely to preserve whitespace and confirm
the recorded `prosrc` hash. At `2026-07-26 17:18:17 UTC`, one final metadata-only SELECT executed
the migration's regex caller counter, trigger status-column predicate, and cron predicate; it
returned exactly six functions, seven calls, three triggers, and one cron job. No data or
configuration row was selected. Notification tables,
customers/contacts/leads, integration configuration values, credential/secret values, logs,
pg_net request/response rows, payload contents, recordings, and providers were excluded.

## Exact live target

| Property | Captured value |
|---|---|
| Identity arguments | `p_type_key text, p_body jsonb` |
| Result | `void` |
| Language/kind | `plpgsql`; function (`prokind='f'`) |
| Owner | `postgres` |
| Security | `SECURITY DEFINER`; non-strict; non-leakproof |
| Runtime config | `search_path=public` |
| Volatility/parallel | volatile (`v`); parallel unsafe (`u`) |
| Direct EXECUTE ACL | `postgres`, `authenticated`, `service_role`; none grantable |
| Effective browser roles | `PUBLIC=false`, `anon=false`, `authenticated=true` |
| Intended server role | `service_role=true` |
| `prosrc` MD5 | `5935917b313c772a964b7c02e67c8dd4` |
| full-definition MD5 | `da6b30d100720605990491d4028560f0` |

Exact live `prosrc` text follows. Catalog bytes begin with one newline and end with one ASCII space
after `END;`; the byte-exact hash above includes both.

```sql
DECLARE v_enabled boolean; v_url text; v_secret text;
BEGIN
  IF p_type_key IS NULL THEN RETURN; END IF;
  SELECT enabled INTO v_enabled FROM public.notification_types WHERE type_key = p_type_key;
  IF v_enabled IS NOT TRUE THEN RETURN; END IF;
  SELECT value INTO v_url    FROM public.integration_config WHERE key = 'notify_worker_url';
  SELECT value INTO v_secret FROM public.integration_config WHERE key = 'notify_webhook_secret';
  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('type_key', p_type_key) || COALESCE(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', COALESCE(v_secret,''))
  );
END;
```

The live merge gives the right operand precedence for duplicate object keys, so a caller-controlled
top-level `type_key` in `p_body` can replace `p_type_key`.

## Exact direct caller, trigger and cron graph

Every captured caller is owned by `postgres` and is `SECURITY DEFINER`.

| Direct function | Search path | `prosrc` MD5 | Calls |
|---|---|---:|---:|
| `review_time_entry_change_request(uuid,boolean,uuid,text)` | `public, extensions, pg_temp` | `dfc660aa915c4c8ce8e02592a8faa7a3` | 1 |
| `scan_abandoned_clocks(timestamptz,integer)` | `public` | `8977dcbb788d85ade975936820a85f38` | 1 |
| `submit_time_entry_change_request(uuid,jsonb,text,uuid)` | `public, extensions, pg_temp` | `e234c89fb88563c0e1c801cef3976852` | 1 |
| `trg_appt_crew_notify()` | `public` | `31f6810a3fac42fae029b6d30ea239e0` | 1 |
| `trg_appt_notify()` | `public` | `0fe47fea140d0a1f108061a14d45c3b5` | 2 |
| `trg_estimate_accepted_notify()` | `public` | `7061fe1b9f8a212ed44e7e30492fa206` | 1 |

All seven calls pass `jsonb_build_object(...)`. The exact trusted type keys are:
`appointment.assigned`, `appointment.updated`, `appointment.canceled`, `estimate.accepted`,
`timesheet.change_requested`, `timesheet.change_reviewed`, and `clock.abandoned`.

| Trigger | Relation/event | Function | Enabled |
|---|---|---|---|
| `trg_appointment_crew_notify` | `appointment_crew`, AFTER INSERT | `trg_appt_crew_notify()` | origin (`O`) |
| `trg_appointment_notify` | `appointments`, AFTER UPDATE | `trg_appt_notify()` | origin (`O`) |
| `trg_estimate_accepted_notify` | `estimates`, AFTER INSERT OR UPDATE OF `status` | `trg_estimate_accepted_notify()` | origin (`O`) |

The one scheduler caller is cron job ID `4`, name `upr_scan_abandoned_clocks`, active every
30 minutes (`*/30 * * * *`) as `postgres`, with exact command
`SELECT public.scan_abandoned_clocks();`.

Repository-wide current/history search found no product source
`rpc('notify_emit', ...)`, `/rest/v1/rpc/notify_emit`, or browser `/api/notify` caller.
The database functions above are the complete direct SQL caller set observed at capture.

## Migration, rollback and test contract

`20260726110000_notify_emit_service_boundary.sql`:

1. begins one transaction and fails closed on the exact target signature/metadata/body/full
   definition/ACL;
2. pins all six caller body hashes, owners, security modes and search paths plus exact six-function/
   seven-call count, three trigger bindings/enabled modes, and the abandoned-clock cron contract;
3. replaces only the target body, reversing
   `jsonb_build_object(type_key) || p_body` to
   `p_body || jsonb_build_object(type_key)`;
4. revokes EXECUTE from `PUBLIC`, `anon`, and `authenticated` after replacement and grants only
   `service_role`; and
5. asserts forward body hash `27d638e9e2681bf74f17fa255c7eaf04` plus exact owner/service ACL
   before commit.

The forward body is byte-for-byte the live `prosrc` after replacing only the merge expression.
`NULL` type, disabled catalog type, missing/blank URL, URL/secret key names, headers,
`PERFORM net.http_post`, and ignored response are identical. Because every verified body caller
uses an object, the trusted type key remains top-level and wins without changing event payload
fields.

The paired rollback refuses drift from the forward body/ACL, restores byte-exact live body hash
`5935917b313c772a964b7c02e67c8dd4`, keeps `PUBLIC`/`anon` denied, restores
`authenticated` plus `service_role`, and asserts the exact prior ACL before commit. It is not a
neutral rollback: it deliberately restores the browser confused-deputy path and trusted-key
override.

The apply-window preflight/post-apply SQL reads catalog metadata only. It never invokes the target,
a trigger, pg_net, cron, Worker, or provider. Positive service and owner-chain compatibility is
proved through ACL/ownership/caller metadata until a separately authorized synthetic canary exists.

The credential-free Worker-lane contract suite covers:

- exact one-expression body diff and forward/rollback hashes;
- `PUBLIC`/`anon`/`authenticated` denial and `service_role` retention;
- every direct object-body event and exact caller count;
- absence of an in-body role assertion;
- trigger/cron preservation and no caller DDL;
- null/disabled/missing-URL/pg_net/ignored-response behavior;
- target/caller/trigger/cron drift failure before DDL;
- catalog-only pre/post-apply scripts;
- no browser/Pages RPC caller; and
- no premature live provenance mapping plus both `d54b6ba` ops-health ledger rows.

The new migration is intentionally absent from `scripts/migration-provenance-manifest.json` and the
dated live evidence because it is not applied. After an authorized apply, map the actual live
ledger version/name to the reviewed release commit and add a fresh selected-function ACL/body
fingerprint; never predeclare a live row.

## Verification

All commands ran in the isolated S1d worktree. No browser, server, simulator, Xcode build, function,
trigger, schedule, provider, or persistent child process was started.

| Command | Observed result |
|---|---|
| `npm ci` | passed; 418 locked packages; lockfile unchanged; existing audit summary 10 vulnerabilities (1 low, 8 high, 1 critical) |
| focused S1d Vitest | 11/11 passed |
| `npm test` | passed: unit 774/774, Worker 1,369/1,369, QA 16/16; 2,159 total, zero unexpected skips |
| `npm run build` | passed; Vite production build, 665 modules transformed |
| native-target Vite build | passed with `VITE_BUILD_TARGET=native`; no Capacitor sync, signing, archive, simulator or device action |
| changed-file ESLint | passed with zero findings for `notify-emit-migration.test.js` |
| `npm run lint` | reports unchanged full-tree baseline: 206 errors and 119 warnings; no changed JavaScript finding |
| `npm run validate:tooling` | passed; zero errors, two dated CAP-GOV/CAP-SEC waiver warnings; generated adapters match |
| `npm run test:tooling` | 12/12 passed |
| `npm run test:provenance` | 13/13 passed |
| `npm run validate:provenance -- --worktree` | passed for 27 ledger rows/21 functions/5 policies; four declared raw comment/whitespace drift warnings |
| read-only live precondition predicates | passed: 6 caller functions, 7 call sites, 3 matching triggers, 1 matching cron; no function invocation or data/config row read |
| `npm run preflight:mobile` | zero errors; expected dirty-tree warning before commit, local Node 26 vs CI Node 22, optional GitHub delivery unavailable |
| `git diff --check` | passed |

SQL was not applied or executed against production. Its static syntax/contract review and
catalog-derived preconditions are local evidence; the real migration transaction and post-apply
checks remain an external owner gate.

## Independent review

Independent read-only passes reviewed the integrated diff:

- **Contract: pass, review-ready.** It independently proved the exact forward/rollback body
  hashes and one-expression diff, ACL transition, six-function/seven-call/three-trigger/one-cron
  graph, URL/secret-header/payload/pg_net/ignored-response/no-op behavior, rollback fidelity,
  non-invoking catalog checks, unapplied provenance, and both required Git ancestors. It observed
  64/64 focused notify/migration tests, 13/13 provenance tests, clean changed-file ESLint and
  `git diff --check`.
- **Security: pass after correction.** It found that final ACL assertions initially checked
  grantee names/effective EXECUTE but not `acl.is_grantable`. Forward postcondition, standalone
  post-apply, rollback preflight/postcondition, and static regression coverage now all require zero
  grantable EXECUTE ACL entries. A second check required the test to distinguish forward preflight
  from forward postcondition; exact occurrence coverage was added. The final re-review reported no
  security findings and independently observed 11/11 focused tests plus clean diff-check.
- **Release:** performed after the reviewed commits and final clean-tree verification; its verdict
  is recorded in the final handoff and this section is updated before close-out if it identifies a
  documentation or gate defect.

Reviewers made no edits or live queries and do not infer live apply, deployment, provider,
customer, notification, configuration-value, secret-value, or device proof.

## Residuals carried forward

1. **S1d apply gate:** live `authenticated` still executes `notify_emit` until the reviewed
   migration is applied and verified from a reviewed release commit.
2. **Recording-source RLS/RPC:** authenticated `get_inbound_leads` and broad `inbound_leads`
   policies expose stored recording URLs outside the proxy. This is the next separate source slice.
3. **Direct bell RPC:** authenticated `create_notification` remains independently executable
   outside `/api/notify`; do not combine it with S1d apply or recording-source work.
4. **Wider mobile authorization:** identity/device/preference/bell/merge/public-signing and
   route-family RPC/direct-policy boundaries remain under `MOB-SEC-014`.
5. **QBO actor telemetry, separate:** customer/manual-payment sync do not persist durable human
   actor telemetry.
6. **QBO attachment RLS, separate:** live `qbo_attachments` SELECT does not exclude an external
   admin.
7. **Worker/runtime residuals:** shared Auth/Web Push timeout completion and external-partner
   recording-control compatibility remain.
8. **Private media:** `MOB-SEC-015` and all private object compatibility/apply work remain separate.
9. Account/device state, offline durability, native scope, push/APNs, OTA, privacy, deletion,
   signing/TestFlight/device and final qualification gates remain unchanged.

## Rollout

No rollout was authorized or performed. A future owner-authorized apply should:

1. integrate the complete foundation→R0→S1b→S1c→S1d range into the designated release branch
   without dropping the S1c or `d54b6ba` provenance parent;
2. confirm the exact S1d commit is reviewed and reachable from that branch;
3. immediately recapture only target/caller/trigger/cron/ledger catalog metadata and run
   `notify_emit_service_boundary_preflight.sql`;
4. stop on any signature, owner, security/search-path, body/full-definition hash, ACL, caller,
   trigger, schedule, or provenance drift;
5. apply only `20260726110000_notify_emit_service_boundary.sql` in a serialized low-traffic
   owner window; do not deploy source or change URL/secret/configuration with it;
6. run `notify_emit_service_boundary_post_apply.sql` and prove `PUBLIC`/`anon`/`authenticated`
   denied plus owner/`service_role` caller metadata, without invoking a real event;
7. run database security/performance advisors and capture the actual ledger row plus fresh
   `notify_emit` fingerprint;
8. only under separate explicit notification authorization, use a non-customer synthetic fixture
   for one approved trigger/service canary and inspect summaries, not notification contents; and
9. monitor HTTP/pg_net failures without selecting payloads, secrets, customer data, or response
   content.

Do not combine this apply with recording-source RLS, `create_notification`, QBO telemetry/RLS,
private media, deployment, secret rotation, provider testing, or device work.

## Rollback

Prefer a reviewed forward repair. If an owner-approved compatibility failure requires emergency
rollback:

1. externally constrain/pause the relevant notification entrypoint before restoring the capability;
2. confirm the live target still matches forward body hash
   `27d638e9e2681bf74f17fa255c7eaf04` and its service-only ACL;
3. apply only `20260726110000_notify_emit_service_boundary.rollback.sql`;
4. verify exact prior body hash `5935917b313c772a964b7c02e67c8dd4`,
   `PUBLIC`/`anon` denial, and `authenticated`/`service_role` grants;
5. record that arbitrary authenticated emission and body type-key override were re-opened;
6. refresh ledger/provenance evidence and continue monitoring without reading notification/customer
   contents; and
7. ship a reviewed forward containment repair before re-enabling the path.

Rollback does not rotate a secret, change a URL/setting, rewrite callers/triggers/schedules, deploy
a Worker, or roll back S1c HTTP authorization.

## External gates and next bounded session

Open S1d gates: push/PR/release integration, owner migration approval, same-window live drift
preflight, shared-database apply, post-apply role/caller proof, actual ledger provenance/fingerprint,
database advisors, and any separately authorized non-customer canary.

The next source session is **S1e recording-source authorization only**. Start from the final S1d
tip reported in the handoff; fetch current `origin/dev` and reconcile without rewriting history.
Read the governing wave and R0→S1d evidence, then recapture only `get_inbound_leads`, direct
`inbound_leads` grants/policies, exact recording URL consumers, and available employee/CRM
assignment fields. Never read recording/customer contents or secret values. If evidence is
sufficient, author the smallest compatible RLS/RPC migration, rollback, negative/positive tests and
docs. Do not apply, deploy, push, call providers, inspect recordings, or combine with the pending
S1d apply, `create_notification`, QBO telemetry/RLS, private media, identity/device, native, push or
OTA work.

No migration apply, deployment, push, notification, function/trigger/schedule/provider invocation,
secret read/rotation, live setting change, customer/notification/recording-content inspection,
message, call, file transfer, money movement, signing or distribution occurred in S1d.
