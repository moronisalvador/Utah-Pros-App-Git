<!--
FILE: docs/contractor-compliance-roadmap.md

WHAT THIS DOES (plain language):
  Defines the approved build order and proof required for UPR's contractor document tracking.
  It keeps private tax files, public upload links, reminders, and the staff dashboard inside one
  reviewed plan without treating repository source as a live deployment.

DEPENDS ON:
  Internal: AGENTS.md, docs/contractor-compliance-dispatch.md,
            .claude/rules/contractor-compliance-wave-ownership.md
  Data:     reads → repository evidence named below
            writes → documentation only

NOTES / GOTCHAS:
  - Planning and repository implementation are authorized.
  - Database apply, deployment, provider sends, imports, commits, pushes, and PRs remain gated.
-->

# Contractor Compliance Roadmap

**Status:** Tier 2 implementation, QA qualification, shared-database apply, and production code
promotion completed 2026-08-03; controlled feature activation, canary, and identity-safe import
remain.
**Live state:** five additive migrations and the private bucket/cron are live; PR #574 is deployed.
The database page flag remains OFF, automatic reminders remain OFF, and no provider send or
real-document import has occurred.
**Route target:** `/contractors` (internal) and `/contractor-upload#token=…` (public capability; fragment is stripped before API use).

## Outcome

UPR can see whether every `contacts.role = 'subcontractor'` record has:

1. an accepted W-9 for the required Denver calendar year;
2. accepted workers' compensation coverage or an accepted Utah coverage waiver; and
3. accepted general liability coverage.

The system preserves document versions and coverage intervals, separates current readiness from
audit-period readiness, protects W-9s as tax-sensitive files, and sends renewal email only through
the existing automated-email compliance boundary.

The MVP is warning-only. It does not block scheduling, assignment, billing, or payment.

The annual extension keeps two adjacent workflows separate:

- named insurance audit periods preserve a roster and accepted WC/waiver and GL interval manifest;
- tax-year readiness derives from private W-9 versions and records only the external identifiers,
  status, date, and reference needed to hand a ready contractor to QuickBooks or Gusto.

## Planning decisions

- **Identity:** `contacts` remains the contractor identity. New normalized tables reference it;
  `contacts.w9_on_file` and `contacts.coi_expiration` remain read-only legacy summaries.
- **Required W-9 year:** the active requirement is the current calendar year in
  `America/Denver`. The year is stored explicitly on each compliance profile so rollover and
  audit results are reproducible.
- **Coverage:** accepted and superseded verified versions remain eligible historical evidence.
  Current readiness evaluates today; audit readiness evaluates the requested date/period.
- **Alternative group:** `workers_comp` and `workers_comp_waiver` satisfy one requirement group.
- **Roles:** active internal `admin` and `office` may manage. Active internal
  `project_manager` may view readiness only. Other roles are denied.
- **W-9 redaction:** project managers never receive W-9 filenames, tax years, storage paths,
  hashes, previews, downloads, or document-history rows.
- **Manual exceptions:** omitted from this MVP. The underlying requirement status stays honest;
  adding an override later requires a separate audited, reasoned, expiring contract.
- **Storage:** a dedicated private bucket is Worker-only. Browser and anonymous roles receive no
  raw bucket/table access. Signed retrieval URLs are short-lived and minted after each role check.
- **Public intake:** a bounded Worker accepts the file bytes, validates MIME plus magic bytes and
  size, hashes the content, selects the object path, and writes `pending_review`. A signed upload
  URL is insufficient because it cannot inspect bytes before storage.
- **Capability retries:** Workers derive the unguessable raw token from a stable request identity
  with a server-only HMAC secret; Postgres stores only its digest. Retries can therefore reproduce
  one link without persisting raw token material.
- **Rollout:** both routes and reminder execution fail closed behind a default-OFF
  `page:contractors` feature flag. Reminder execution also requires a separate exact Cloudflare
  enable binding.
- **Messaging:** automated email routes through `sendAutomatedMessage('email', ...)`. No SMS
  producer, adapter fallback, or new provider door is added.
- **Named insurance audits:** a period has a name, start/end dates, lifecycle, inclusion basis,
  nullable paid/activity evidence, and a materialized roster/evidence manifest. `paid_in_period`
  remains unknown until a human or later import supplies an explicit source; the system never
  infers QuickBooks/Gusto facts.
- **Audit immutability:** an open period may be refreshed; locking records the materialization
  time and freezes roster/evidence rows for auditor reproduction. Historical readiness never
  reuses a current-PDF boolean.
- **Provider responsibility:** QuickBooks and/or Gusto prepares, files, and sends 1099s. UPR stores
  no 1099 PDFs, reportable amounts, corrections, recipient access, or delivery history.
- **W-9 handoff:** admin/office may record tax-year provider target, QuickBooks/Gusto contractor
  IDs, handoff status/date, and a non-sensitive reference. A provider-ready state requires an
  accepted W-9 for that year. The checklist/export contains no W-9 file metadata or tax identifier.

## Evidence ledger

| Verdict | Claim | Evidence | Consequence / next proof |
|---|---|---|---|
| HAVE | Contractor identity and legacy fields exist | `src/components/AddContactModal.jsx`; `docs/schema-v2/domains/crm.md` | Reference contacts; never write legacy fields from compliance |
| HAVE | Active employee and role checks exist | `functions/lib/auth.js` | Reuse `requireRole`; add admin/office and PM denial tests |
| HAVE | Private Worker upload and signed-download seams exist | `functions/api/message-media-upload.js`, `functions/api/message-media-url.js`, `functions/lib/message-media.js`, `functions/lib/supabase.js` | Reuse the pattern, not the message bucket or messaging authorization |
| HAVE | Automated email suppression/DND boundary exists | `functions/lib/automated-send.js`, `functions/lib/email.js` | Extend stable provider idempotency additively and keep all sends inside the chokepoint |
| HAVE | Scheduler and telemetry patterns exist | `functions/api/process-sequences.js`, `functions/lib/worker-runs.js` | Reuse bounded cron auth and `worker_runs`; log IDs/counts only |
| HAVE | Lazy route, navigation, React Query, and state primitives exist | `src/routes/buildTargetPages.web.jsx`, `src/App.jsx`, `src/lib/navItems.jsx`, `src/components/ProviderEventOps.jsx`, `src/components/ui/` | Integrate narrowly with Main/Shared design |
| PARTIAL | Storage exists but neither bucket is suitable | `job-files` is public; `message-attachments` is message-private | Add a dedicated private bucket and keep browser policies absent |
| PARTIAL | Status primitives exist | `StatusPill` does not classify all compliance states | Add explicit tones or a tested additive mapping |
| PARTIAL | Hosted QA exists | `docs/database/staging-branch-runbook.md` | Schema is usable, ledger replay is not; any later QA apply is a separate owner action |
| MISSING | Compliance profiles/documents/requests/history and RPCs | repository-wide search 2026-08-03 | Add new prefixed objects; do not revive retired tables |
| MISSING | Hashed/revocable/scoped public upload token and rate bound | repository-wide Worker/schema search 2026-08-03 | Add purpose-built service boundary and negative tests |
| MISSING | Reminder reservation/outbox with stable provider identity | existing schedulers do not provide this contractor contract | Claim before provider call; never blind-retry an ambiguous send |
| MISSING | Named insurance audit roster and point-in-time evidence manifest | ad hoc date filters do not preserve a reproducible package | Add period/roster/evidence rows plus role-redacted manifest RPC |
| MISSING | Authoritative paid/active-in-period data | QBO/Gusto ingestion is explicitly out of scope | Keep nullable manual/import roster seams with source and reconciliation metadata; never fabricate |
| MISSING | Annual W-9 provider reconciliation | no tax-year handoff contract exists | Add an admin/office-only checklist and narrow QuickBooks/Gusto external-ID/handoff seam |
| UNKNOWN | Current live contacts columns, grants, functions, policies, bucket catalog, and migration ledger tail | live catalog not inspected in this task | Fresh value-free catalog preflight before any apply |
| UNKNOWN | Cloudflare route/cron/binding and Resend sender readiness | repository files cannot prove dashboards/providers | Owner-authorized readback and deployment/provider canary later |
| UNKNOWN | Existing real contractor documents and audit-sheet interpretation | import explicitly excluded | Owner-reviewed import mapping after deployment |

## Contracts and data model

The planned additive object family is:

- `contractor_compliance_profiles` — one row per subcontractor, active state, required W-9 year,
  assigned owner, request pause, and timestamps;
- `contractor_compliance_documents` — immutable version identity, type, explicit coverage/tax
  dates, review state, verification, storage metadata, content hash, source/external seam, and
  non-critical extracted JSON;
- `contractor_compliance_requests` — requested type scope, hashed capability token, expiry,
  revoke/pause/complete state, recipient snapshot, creation source, and stable request identity;
- `contractor_compliance_request_deliveries` — one claim/result per request reminder stage with a
  stable provider idempotency key and sanitized outcome;
- `contractor_compliance_activity` — append-only notes and safe lifecycle events without tokens,
  filenames, URLs, tax identifiers, or document contents;
- `contractor_compliance_public_attempts` — bounded, hashed public-attempt telemetry used only for
  rate limiting and abuse review.
- `contractor_compliance_audit_periods` — named annual/other insurance audit windows, lifecycle,
  inclusion policy, materialization/lock provenance;
- `contractor_compliance_audit_roster` — point-in-time contractor inclusion with nullable
  paid/active-in-period facts and explicit external/manual source/reconciliation seam;
- `contractor_compliance_audit_evidence` — materialized WC/waiver and GL coverage/gap intervals
  linked to the accepted historical document version used;
- `contractor_w9_provider_handoffs` — tax-year QuickBooks/Gusto contractor IDs, provider target,
  readiness/handoff/reconciliation status, handoff date/reference, and actor/time. W-9
  readiness itself is always derived from `contractor_compliance_documents`.

No browser role receives direct table privileges. Purpose-built internal read RPCs reconstruct the
active employee and return role-specific projections. Service-only mutation RPCs recheck the
supplied active internal actor for multi-row review/request transitions.

Dashboard and detail contracts return JSON so the role-redacted shape is explicit and can evolve
additively:

- `get_contractor_compliance_dashboard(search,status,limit,offset,audit_start,audit_end)`;
- `get_contractor_compliance_detail(contact_id,audit_start,audit_end)`.

Readiness vocabulary is `ready`, `missing`, `needs_review`, `expiring`, `expired`, `gap`, and
`inactive`. The RPC owns evaluation. UI code only presents returned statuses.

## Dependency graph

```text
F0 frozen role/status/RPC/Worker contracts
 └─> F1 additive tables + private bucket + grants/RLS + default-off flag/nav permission
      ├─> A1 internal dashboard/detail read path
      ├─> A2 internal upload/download/review/note/request APIs
      │    └─> A3 internal dashboard/detail UI
      └─> B1 hashed public request + bounded upload path
           └─> B2 durable reminder claim + automated email
                └─> B3 public upload UI + manual/resend/pause/revoke UI
                     ├─> D1 named audit period + roster/evidence materialization
                     │    └─> D2 audit workspace/checklist manifest
                     └─> E1 W-9 checklist + provider-handoff seam
                          └─> C verification, docs, and owner-gated rollout
```

The work is serialized. Shared migrations, `src/App.jsx`, navigation registries, automated email,
and private Storage are single-writer seams. Parallel implementation is not justified until F0/F1
contracts are frozen.

## Phase contracts

### F — Foundation

**Outcome:** reviewed additive schema, private bucket declaration, RPC contracts, rollbacks, static
contract tests, and isolated behavioral SQL source.

**Acceptance:**

- all new tables enable and force RLS at creation and deny browser roles directly;
- every definer pins `search_path`, rechecks actor/capability, revokes `PUBLIC, anon`, and grants
  only intended roles;
- private bucket is non-public with MIME/size limits and no browser object policy;
- W-9 year, coverage dates, review state, version, source, storage metadata, verifier, rejection,
  and hashes are explicit columns;
- dashboard is paginated, searched, risk-sorted, one row per contractor, and has no N+1 client
  query;
- current and audit-period tests cover gaps, alternative workers-comp evidence, future/expired
  documents, and superseded historical evidence;
- migration has a paired rollback and credential-free static contract test.

**Stop conditions:** live catalog drift, object-name collision, missing role columns, or an
unresolved public grant.

### A — Internal warning-only dashboard

**Outcome:** admin/office manage; project manager readiness-only view.

**Acceptance:**

- `/contractors` is web-lazy, Main/Shared, page-access/role/feature guarded, and present in all
  applicable navigation registries;
- KPI counts, search/filter/pagination, risk matrix, earliest expiration, owner/last request, and
  three requirement groups use the server-derived contract;
- detail shows trade/contact data, redacted role-appropriate document cards, full authorized
  version history, coverage timeline, request/activity history, notes, and review actions;
- internal upload validates bytes server-side and returns no raw object path;
- download/preview issues `no-store` short-lived signed URLs only after document/contact/role
  authorization; PM and denied roles cannot mint W-9 URLs;
- cold loading, stale refetch error, success-empty, mutation, resume, back/scroll, and 390px
  behavior follow project standards.

### B — Public intake and renewals

**Outcome:** scoped no-login upload and durable automatic email renewal source, both default-off.

**Acceptance:**

- only the raw token enters the URL/client; storage keeps a non-reversible digest;
- token must be unexpired, unrevoked, open, contractor-bound, and type-scoped;
- invalid/expired/revoked/exhausted tokens return enumeration-safe responses;
- PDF/JPEG/PNG bytes, MIME, size, hash, and path are validated/derived server-side;
- every public upload creates a new `pending_review` version and never marks readiness accepted;
- attempts are rate-bounded without storing raw IP or token;
- reminder stages are approximately 60/30/14/7 days, expiration, then weekly overdue with a cap;
- accepted current evidence stops later claims immediately;
- annual W-9 runs only for active contractors and the stored Denver calendar year;
- each send is claimed before provider call, has a stable request/stage idempotency key, records a
  sanitized result, and never blind-retries an ambiguous provider outcome;
- manual create/send, resend, pause, revoke, and history use the same request/delivery model;
- email identifies Utah Pros Restoration, states exact missing/expiring groups, and links only to
  the scoped upload route;
- no SMS code path or provider fallback is introduced.

### C — Close-out and rollout preparation

**Outcome:** repository proof and a safe, explicit live runbook.

**Acceptance:**

- build, credential-free suites, focused Worker/security/consent tests, changed-file lint,
  migration hygiene, strict bundle report, and diff checks pass;
- required reviewers pass or every unresolved blocker is reported;
- page rendered checks cover desktop, 390px, loading/error/empty, and minimize/resume when the
  environment supports them;
- canonical architecture/schema/auth/business/integration/testing docs and
  `UPR-Web-Context.md` are current;
- migration apply, bucket/Storage readback, Cloudflare bindings/cron, provider canary, deployment,
  activation, and real-data import remain explicitly pending unless separately authorized.

### D — Annual insurance audit workspace

**Outcome:** admin/office can define a named period and materialize a reproducible insurance
checklist; project managers may view insurance readiness but never tax/file metadata.

**Acceptance:**

- period name/start/end/status are explicit and dates are validated;
- roster rows distinguish `active_profile`, `manual`, and `external_import` inclusion;
- `paid_in_period` is nullable and always carries an explicit source when populated;
- materialization records WC/waiver and GL `coverage` or `gap` intervals across the entire period,
  linking accepted/superseded document IDs/versions without copying file paths;
- locking a period prevents silent roster/evidence rewrites and records actor/time;
- one paginated/filtered manifest RPC returns contractor, roster basis, both requirement statuses,
  intervals, request history summary, and clean checklist fields without N+1 reads;
- CSV/JSON export is client-side from the role-redacted manifest only; an evidence ZIP/package is
  a later owner-gated slice because short-lived file retrieval and retention need separate design.

### E — Annual W-9 and provider handoff

**Outcome:** admin/office can prove annual W-9 readiness and record a bounded handoff to
QuickBooks/Gusto without building a second tax filing or distribution system.

**Acceptance:**

- checklist readiness is derived from versioned private W-9 records as `valid`, `missing`,
  `needs_review`, `rejected`, or `stale_previous_year`;
- active-only is the default and the checklist includes last verification/request time without
  returning filenames, storage paths, hashes, PDFs, SSNs, or EINs;
- the unique contractor/tax-year handoff row stores only provider target, QuickBooks/Gusto
  external IDs, `not_ready`/`ready`/`handed_off`/`reconciled` status, handoff date/reference,
  and actor/time;
- `ready`, `handed_off`, and `reconciled` cannot be recorded without an accepted W-9 for the year;
- admin/office may view/update/export; project manager, field, external, inactive, and unmapped
  identities are denied by the RPC;
- the CSV is generated from the role-gated checklist and includes no tax identifier or file link;
- no amount, 1099 document, correction, delivery, recipient-access, provider-send, or live import
  object exists. QuickBooks/Gusto integration remains a future separately authorized seam.

## Challenge record

| Objection | Evidence | Decision |
|---|---|---|
| Reuse `document_requests` or vendor tables | docs-domain audit shows dead/job-specific contracts and live merge dependencies | Rejected; new prefixed schema |
| Reuse `job-files` | current bucket is public/listable | Rejected for every compliance document |
| Reuse `message-attachments` | private but messaging-owned authorization and path contract | Rejected; pattern only |
| Browser direct upload with signed URL | no pre-storage magic-byte inspection; signed URLs cannot be revoked early | Rejected; bounded Worker proxy |
| Put PM on the same detail payload | would expose W-9 metadata even if buttons are hidden | Rejected; server-side role-redacted projection |
| Derive readiness in React | would duplicate date/alternative/history rules and create N+1 reads | Rejected; one server-derived RPC |
| Add manual overrides now | creates a second truth source and hides gaps unless deeply audited | Deferred outside MVP |
| One combined deploy/apply/activation | shared production DB, private Storage, provider, and cron are distinct gates | Rejected; staged default-off rollout |
| Infer paid contractors from current contact state | no payment ledger/provider evidence is in scope | Rejected; nullable sourced roster fact only |
| Store annual audit only as a date filter | later edits would change historical evidence | Rejected; materialized roster/evidence manifest with lock |
| Build UPR 1099 generation/storage/distribution | owner clarified QuickBooks/Gusto owns preparation, filing, and sending | Rejected; W-9 readiness and provider handoff only |

## Separately authorized owner/external gates

1. read-only live catalog/bucket/ledger preflight;
2. isolated `qa-staging` apply and behavioral proof;
3. commit/push/PR or other publication;
4. reviewed shared-production migration apply;
5. Cloudflare Preview/Production feature, reminder, HMAC-token, rate-limit-salt, and Cron
   configuration;
6. app deployment and `page:contractors` activation;
7. Resend sender/template/provider canary or any outbound email;
8. real contractor document/audit-sheet import;
9. production smoke and later `dev → main` promotion.

## Qualification and rollout evidence (2026-08-03)

- Final local `npm test`: 129 unit files / 1,592 tests, 130 Worker files / 1,998 tests, and 104 QA
  files / 1,091 tests passed (4,681 total); no unexpected skips.
- `npm run build`, migration hygiene, credential-free focused migration/UI contracts,
  changed-file lint, lint-ratchet check, tooling governance, artifact scan, strict bundle report,
  and `git diff --check` passed. The entry graph is 10,270 gzip bytes below the blocking line;
  Contractor Compliance routes and CSS remain lazy chunks.
- Migration safety, anonymous-grant, Worker security, automated-send consent, project-law,
  design-consistency, and page-behavior reviews passed after findings were resolved.
- The isolated SQL behavior transaction passed on `qa-staging` and rolled back with zero residue.
  The five QA ledgers are `20260803214228`, `20260803214235`, `20260803214243`,
  `20260803215739`, and `20260803215741`.
- The same five reviewed sources are live in production as `20260803220653`,
  `20260803220656`, `20260803220659`, `20260803220704`, and `20260803220711`. Postflight proved
  12/12 tables have forced RLS, 12 service-only policies, zero `anon`/`authenticated` table
  grants, zero anonymous target-RPC grants, a private 6 MiB PDF/JPEG/PNG bucket, one active
  `23 13 * * *` cron, and zero uncovered foreign keys. All new business tables remain empty.
- GitHub CI run 1082 passed both `verify` and hosted `db-lane`; PR #574 merged to `main` at
  `7388faad`. Production smoke returns 200 for `/contractors` and fail-closed 404s from both
  public-intake and reminder endpoints while the rollout gates are dark.
- Separate high-entropy token/rate salts are configured in Preview and Production. The Production
  Worker feature switch has been changed to encrypted `true` for the next deployment; Preview and
  both reminder switches remain false. The database page flag remains false pending post-deploy
  authorization tests.
- The reviewed audit sheet/folder were read without mutation. The folder currently contains six
  PDFs for Sunny Day, DMH Services, Reindor, and FORCOMP. No matching `contacts` rows exist, so
  import is blocked on authoritative contact identity/phone/email mapping instead of fabricating
  CRM data. No provider email or real document upload has occurred.

## Rollback posture

Code rollback disables the feature flag and reminder binding first. Additive tables and private
objects remain inert for evidence preservation. The repository rollback revokes RPCs and browser
surfaces before dropping new empty objects; once real documents, requests, or delivery evidence
exist, destructive removal is not an operational rollback and requires a separate retention-aware
owner decision.
