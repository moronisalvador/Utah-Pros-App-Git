<!--
FILE: docs/upr-unfinished-work-registry.md

WHAT THIS DOES (plain language):
  Lists UPR work that is started, incomplete, dark-launched, owner-gated, externally blocked,
  stale, or shipped without reconciliation. It is the proposed engineering truth table behind
  the Foundation roadmap.

DEPENDS ON:
  Internal: docs/upr-engineering-foundation-roadmap.md and evidence paths named in each row
  Data:     reads → documentation, source, Git metadata, and read-only catalog results
            writes → documentation only

NOTES / GOTCHAS:
  - DRAFT. Rows are evidence records, not authorization to implement them.
  - Capability, implementation, gate, and disposition must never be collapsed into one status.
-->

# UPR Unfinished-Work Registry

**Draft refreshed:** 2026-07-23 on `codex/foundation-roadmap` at base `0a06a21`
**Review cadence proposal:** update on ownership/status change; stale after 14 days for active work,
30 days for owner/external gates, and every release for security/live-state evidence.

## Registry rules

Each authoritative control row requires: namespaced stable ID, audit references, capability verdict,
implementation state, gate, disposition, one priority, severity, accountable owner, exact evidence,
acceptance, dependencies, owned surfaces, next action, review date, and retirement condition.
Unchecked boxes in historical roadmaps are evidence only; the latest reconciled row wins.

## Authoritative control ledger proposal

`unassigned` is deliberate: a proposed role is not an accountable person. Dates below must be set
when the owner adopts the registry.

| Stable ID | Work | Capability | Implementation | Gate | Disposition | Severity / priority | Audit refs | Accountable owner | Owned surfaces | Acceptance / next review / retirement |
|---|---|---|---|---|---|---|---|---|---|---|
| UPRF-LEASE-001 | Encircle writer lease | HAVE | verified | none | archived | High / P0 | owner instruction, `0a06a21` | none | landed handoff evidence | Lease released after commit/push and owner-reported CI/staging; retain as provenance |
| UPRF-ENC-001 | Encircle managed-credential rollout | PARTIAL | verification_tail | owner + external | active | High / P1 | `0a06a21`, `encircle-managed-credential-readiness-2026-07-23.md`, ENC-001 | owner + rollout owner | migration/flag/candidate/runtime smoke/rotation | Repository readiness reverified at current `origin/dev`; migration unapplied, flag OFF, credentials unchanged; serialize apply; retire after rotation/fallback cleanup |
| UPRF-NET-001 | Obsolete Netlify Demo Sheet retirement | MISSING cleanup | not_started | owner + external | active | Medium / P1 | owner decision 2026-07-23 | owner | Netlify deployment and any remaining secret binding | Retire without migration/preservation; verify URL/binding gone; not a rotation dependency |
| UPRF-SEC-001 | `exec_read_sql` containment | HAVE | verified | none | archived | Critical regression boundary / completed P0 | SEC-001, DB-AUTH-001 | none | migration/test/rollback; service-only function ACL | Applied 2026-07-23; browser roles denied; service contract and advisor verified; retain evidence/regression test |
| UPRF-SEC-002 | broad grant/policy classification | PARTIAL | not_started | internal | active | Critical / P0 | DB-RLS-001, DB-AUTH-002 | unassigned | classified policies/functions | role matrix, staged closes, negative tests; rebase on `0a06a21`; archive after child rows resolve |
| UPRF-REL-001 | migration provenance | HAVE | verified | none | archived | High regression boundary / completed P0 | ARCH-001, REL-001, `8c3fc05` | none | four restored source records + read-only gate | Seven-entry ledger tail mapped; 11 function/one policy fingerprints checked; refresh evidence within six hours |
| UPRF-CAP-001 | credential/permission containment | PARTIAL | not_started | external + owner | active | Critical / P0 | CAP-SEC-001, CAP-GOV-001 | owner + unassigned implementer | secret rotation/history; `.claude` permissions | rotate without reproducing secret; review date; retire after validation/history ruling |
| UPRF-QA-001 | isolated QA foundation | PARTIAL | ready | external + owner | active | High / P0 | TEST-001, ARCH-002, `qa-foundation-decision-addendum-2026-07-23.md` | owner + unassigned QA implementer | exact P1/P2a ownership; isolated target/config/seeds/reset/CI refusal | P0 repository decisions complete; open exact internal file ownership, while hosted target/accounts remain owner/external; retire into maintained QA operations |
| UPRF-MNY-001 | QBO/Stripe safety | PARTIAL | not_started | internal + external | active | Critical / P0 | AUTH-001/002, COR-001/002 | unassigned | separate Workers/tests; shared helpers serial | role denial, provider-not-called, stable idempotency/recovery/date/concurrency |
| UPRF-PUB-001 | public form boundary | PARTIAL | ready | owner apply + verification_tail | active | Critical / P0 | PUB-001, `public-form-rpc-boundary-readiness-2026-07-23.md` | public boundary owner | `20260723235900` ACL migration/rollback/static and post-apply tests | Commit/push reviewed source; then serialized apply, browser-role denial, service Worker smoke, provenance/advisors; archive after live verification |
| UPRF-FILE-001 | signing/Storage privacy contract | PARTIAL | not_started | internal + owner | active | High / P0 | PUB-002, DBF-001 | unassigned | signing RPC/Worker + `job-files`/`job_documents` | one classification/DTO/expiry/signed-access contract; serial apply |
| UPRF-DOC-001 | canonical documentation reconciliation | PARTIAL | not_started | internal | active | Medium / P1 | DOC-001 | unassigned | canonical docs and UPR context, one owner at a time | reconcile after each landed phase; retire when release evidence and docs agree |
| UPRF-REG-001 | manifest/branch/worktree retirement | MISSING | ready | owner | active | Medium / P1 | ROAD-001, BRANCH-001 | unassigned | registry + existing ownership metadata only | retain/supersede/archive decisions; no merge/delete; review each release |

## Evidence backlog

This broad table preserves discovery detail. It is not authoritative for ownership/status until each
row is promoted into the control ledger with the full schema above.

| ID | Initiative / work | Verdict | Delivery | Priority | Evidence | Next acceptance / dependency | Proposed owner |
|---|---|---|---|---:|---|---|---|
| ENC-001 | Encircle managed integration | PARTIAL | verification_tail | P1 | `0a06a21`; `encircle-managed-credential-readiness-2026-07-23.md`; current live catalog compatible; managed migration unapplied, flag OFF, credentials unchanged | Authorized apply/test; owner-only flag; candidate activation; Pages/MCP smoke; rotation/fallback cleanup | Owner + rollout owner |
| SEC-001 | `exec_read_sql` containment | HAVE | shipped | completed P0 | `20260723205127_exec_read_sql_containment.sql`; dated live apply evidence | Preserve service-only ACL; rerun negative tests after relevant DB changes | Security DB owner |
| SEC-002 | Anonymous/high-risk policy closure | PARTIAL | blocked_internal | P0 | Current aggregate policy query; July `live-supabase.md:39-74` | Isolated roles/tests; classify public workflows; defer Encircle tables | Security DB owner |
| REL-001 | Migration provenance | HAVE | shipped | completed P0 | `6261601` source restore; `047ac50` gate; `8c3fc05` hardened evidence contract | Preserve gate; do not rewrite comment-only live drift; refresh read-only evidence per release | Release/DB owner |
| CAP-001 | Exposed Encircle credential and tracked local permissions | PARTIAL | blocked_external | P0 | `tooling-capability-review.md` CAP-SEC-001/CAP-GOV-001 | Rotate/revoke; decide history; stop tracking local permissions | Owner + governance |
| AUTH-001 | QBO charge authorization | PARTIAL | planned | P0 | `functions/api/qbo-charge.js:22-31,45-49` | Billing roles; 401/403; provider never called for denied role | Money owner |
| COR-001 | QBO captured-but-unrecorded/idempotency/Denver date | PARTIAL | blocked_internal | P0 | `qbo-charge.js:77-115` | AUTH-001; durable attempt/key/recovery; Intuit sandbox | Money owner |
| AUTH-002 | Stripe pay-link authorization | PARTIAL | planned | P0 | `stripe-pay-link.js:14-22,28-39` | Billing roles and provider-not-called denial tests | Money owner |
| COR-002 | Stripe Checkout reuse/concurrency | PARTIAL | blocked_internal | P1 | `stripe-pay-link.js:37-70` | AUTH-002; expiry/reuse policy; sandbox concurrency tests | Money owner |
| QA-001 | Dedicated real-login test admin | HAVE | verification_tail | P1 | `CLAUDE.md:124-129`; `Login.jsx:86-90,259` | Confirm account lifecycle and restriction without exposing credentials | QA owner |
| QA-002 | Isolated Supabase and test data | PARTIAL design / MISSING target | blocked_external | P0 | `qa-foundation-decision-addendum-2026-07-23.md`; shared DB remains forbidden | Owner budget/project/region/retention/roles; migration-from-zero; exact local-runner ownership | QA/DB owner |
| QA-003 | Split unit/DB/browser/accessibility lanes | MISSING | ready_internal | P1 | P0 addendum; `package.json` has build/lint/Vitest only; CI nonblocking lint/bundle | Open exact P1 paths; credential-free unit/mock lane first; isolated DB later with zero unexpected skips; Playwright/axe/device matrix | QA owner |
| GOV-001 | Canonical skills/agents source and adapters | PARTIAL | planned | P1 | `tooling-capability-review.md:152-202` | Owner source choice; generated validated adapters; missing reviewer fixed | Governance owner |
| GOV-002 | Permission and trigger governance | PARTIAL | planned | P1 | `.claude/settings.json:52-115`; tooling CAP-GOV/TRIG/HOOK findings | Read-mostly defaults; prompt/hook fixtures; explicit write authority | Governance owner |
| DES-001 | Shared code design system | HAVE foundation | verification_tail | P1 | `UPR-Web-Context.md:125-150`; `UPR-Design-System.md` | Adoption and parity metrics; retire competing local palettes | Design owner |
| DES-002 | Figma operating model | MISSING | blocked_internal | P2 | `tooling-capability-review.md:375-426` | GOV-001/002, QA-003, owner connection/seat decision | Design owner |
| UX-001 | UX W1-W5 adoption | PARTIAL | planned | P1 | `ux-quality-roadmap.md:164-201`; current adoption counts | Rebaseline, exact ownership, lifecycle/error/mobile/perf evidence | UX wave owner |
| UX-002 | Failure→empty and blank detail pages | PARTIAL/MISSING | planned | P1 | `Customers.jsx:21-31,72-78`; `Leads.jsx:11-19,35-39`; `Marketing.jsx:9-13,30-34`; `JobPage.jsx:130-131`; `CustomerPage.jsx:93-94` | Error/not-found/retry; preserve prior data; rebase overlapping pages on `0a06a21` | Desktop behavior owner |
| TECH-001 | Tech v2 flag-off blank-screen resilience | PARTIAL | planned | P1 | `App.jsx:254-264`; `TechLayout.jsx:260-266,302-315`; `AuthContext.jsx`; `featureFlags.js:98-115` | Query every live flag; test missing/enabled/disabled/force-disabled; explicit fallback | Tech owner |
| TECH-002 | Job Hub H3 | PARTIAL | owner_gate | P1 | `tech-v2-roadmap.md:551-561`; legacy routes/files remain | Owner phone bake, resolver/retarget/cleanup/device proof | Tech H3 owner |
| TECH-003 | Tech Messages rollout and shed scope | PARTIAL | owner_gate | P1 | `tech-messages-v2-roadmap.md:238-254`; flag default-off | Owner bake/flip; decide new conversation/scheduled send | Tech messages owner |
| TECH-004 | Tech More “Soon” rows | MISSING | planned | P2 | `TechMore.jsx:253-283` | Link, build, remove, or explicitly retire each row with role tests | Product owner |
| MSG-001 | Specific-thread notification deep link | MISSING | planned | P0 | `Conversations.jsx:280-310`; `public/sw.js:50,60-71`; `sms-experience-roadmap.md:347-355` | Producer includes conversation ID; web/PWA/tech tap tests | SMS owner |
| MSG-002 | A2P and SMS device verification | PARTIAL | blocked_external | P1 | `sms-experience-roadmap.md:281,318,356,420-425` | Provider configuration/approval, live smoke, on-device verification | Owner |
| MSG-003 | Provider-neutral staff messaging transport | PARTIAL | verification_tail | P0 | live ledgers `20260723215926`/`20260723220207`; `2fbf755`; two confirmed/reconciled outbound attempts; `messaging-transport-2026-07-23.md` | No resend; direct signed-event/inbound projection proof; isolated SQL/runtime fixtures; Production stays disabled pending owner gate | Messaging owner + owner |
| MSG-004 | Atomic provider-event write contracts | PARTIAL | blocked_internal | P1 | `callrail-text-webhook.js` direct service-role insert/update; unique `dedupe_key` claim | Replace complex new-table REST mutations with narrow service-role RPC claim/state transitions in a serialized reviewed migration; preserve webhook compatibility | Messaging DB owner |
| OMNI-001 | Inbound email Phase I | MISSING | blocked_external | P1 | Foundation files exist; `email-worker/` and `inbound-email.js` absent | Cloudflare route/secret; spoof-safe triage/idempotency/live tail | Omni owner |
| OMNI-002 | O/U roadmap reconciliation | PARTIAL | superseded | P2 | `omni-inbox-wave-ownership.md:20-27,54-61` | Rewrite dispatch against SMS-owned current code before any work | Registry owner |
| CRM-001 | Text campaigns 4b | MISSING/PARTIAL | blocked_external | P1 | Live phase `4b planned`; `Marketing.jsx:25,30-38` | A2P or explicit supersession; compliance-gated send only | CRM/SMS owner |
| CRM-002 | Automation 5-Ops | MISSING | planned | P1 | Live phase `5-ops planned`; roadmap phase block | QA isolation; exact current file/schema rebaseline | CRM owner |
| CRM-003 | Dead/stale CRM artifacts | MISSING cleanup | planned | P3 | Unused `CrmStubPage.jsx`; orphan `ClaimPage_header.jsx:1-4` | Characterize/build, then remove | Cleanup owner |
| SCHED-001 | Schedule correctness | PARTIAL | planned | P1 | `Schedule.jsx:66,392,554-555,766`; error logging paths | Fix remodeling/month/error behavior with tests | Schedule A owner |
| SCHED-002 | Booking/schedule-from-job completion | MISSING | blocked_internal | P2 | `JobPage.jsx:964`; dead props `CreateJobModal.jsx:572-573` | SCHED-001; rebase on `0a06a21`; A→B→C serial | Schedule owners |
| DBF-001 | Public/private Storage P8 | PARTIAL | blocked_internal | P0 | `db-foundation-roadmap.md:172-204`; July job-files evidence | Co-design with PUB-002; classify all call sites; signed URLs; negative tests | Storage/signing owner |
| DBF-002 | P5 index tail / pg_net / leaked-password action | PARTIAL | owner_gate | P2 | `db-foundation-roadmap.md:118-150` | Fresh plans/advisors; separate RED review; dashboard action | DB/owner |
| DBF-003 | Privileged RPC contract registry | MISSING | planned | P1 | Current 342 authenticated-executable definer overloads | Caller/data/definer/grant/negative-test owner for each | DB security owner |
| PUB-001 | Public form RPC bypass | PARTIAL | ready_owner_apply | P0 | live ACL capture; `20260723235900_public_form_rpc_boundary.sql`; Worker caller inventory | Apply only from reviewed `dev`; direct PUBLIC/anon/authenticated denial; service Worker smoke; provenance/advisors | Public boundary owner |
| PUB-002 | E-sign status/expiry/minimal DTO | PARTIAL | planned | P1 | `dbf_p3_sign_document_templates_rpc.sql:35-50`; `submit-esign.js:155-172`; July evidence | Co-design with DBF-001; lifecycle/minimal DTO/private-file direct negative tests | Storage/signing owner |
| DEL-001 | Account deletion fulfillment | PARTIAL | owner_gate | P1 | `MyAccount.jsx:222-330`; generic hard-delete `Team.jsx:129-151` → `admin-users.js:352-381`; no request-linked processor | Decide integrate/replace/disable; SLA, retention, revocation, action audit | Compliance owner |
| CALL-001 | CallRail query-secret placeholder | PARTIAL | blocked_external | P1 | `callrail-webhook.js:24-32` | Verify provider auth; signature/replay/rotation tests | CRM integration owner |
| APP-001 | App Store/Xcode/ASC completion | PARTIAL | blocked_external | P1 | `app-store-readiness-roadmap.md:214-225` | Enrollment, Xcode/TestFlight, screenshots, demo account, ASC | Owner |
| APP-002 | Native privacy screen/Keychain decision | MISSING/PARTIAL | planned | P2 | `nativeBiometric.js:1-5,67-70`; `App.jsx:620-624` | Accept or implement; device/background/screenshot tests | Native owner |
| SET-001 | Legacy Cloudflare credential cutover | PARTIAL | owner_gate | P1 | `settings-overhaul-roadmap.md:490-513` | Owner removes old env values and verifies managed credentials | Owner |
| NOTIFY-001 | Web Push live owner-device proof | PARTIAL | verification_tail | P1 | `UPR-Web-Context.md:6694-6698,6767-6772` | Real device/browser delivery and tap evidence | Owner |
| FEED-001 | Feedback purge/device gates | PARTIAL | blocked_external | P2 | `UPR-Web-Context.md:6483-6487,6519-6520` | APNs/device registration and purge scheduling | Owner |
| ROAD-001 | Public/company roadmap staleness | PARTIAL | planned | P1 | `src/lib/roadmapData.js:41-47,91,96-120` contradicts shipped work | Rebuild from approved registry projection or clearly date/archive | Registry owner |
| BRANCH-001 | Unreconciled worktrees/branches | PARTIAL | planned | P1 | Messaging transport build/live-contract branches reconciled into `dev`; `3841056` superseded by the isolated-QA addendum and must not be blindly merged; other stale initiative branches/worktrees remain | Owner may archive the superseded branch; adopt/supersede/archive every remaining item; no blind merge/delete | Owner/release |

## Landed Encircle contract and rollout seam set

The writer lease is released. These are no longer globally frozen, but any phase touching them must
rebase on `0a06a21`, preserve the landed contract/tests, and serialize exact overlaps:

- `src/pages/EncircleImport.jsx`, `src/pages/DevTools.jsx`, `src/pages/tech/TechDemoSheet.jsx`,
  `src/components/CreateJobModal.jsx`, `src/pages/tech/TechNewJob.jsx`;
- `src/App.jsx`, `src/lib/navItems.jsx`, `src/pages/JobPage.jsx`, `src/pages/Jobs.jsx`,
  `src/pages/Production.jsx`, `src/pages/tech/TechAppointment.jsx`,
  `src/pages/tech/v2/hub/HubTools.jsx`, `src/components/demo-sheet/DemoSheetRenderer.jsx`,
  `src/pages/Help.jsx`;
- `src/components/MergeModal.jsx`, `src/components/JobDetailPanel.jsx`,
  `src/components/OverflowDrawer.jsx`, and `src/components/AddRelatedJobModal.jsx` require explicit
  `0a06a21` contract review before another writer claims them;
- all Encircle Workers/tests and shared `auth/http/supabase/worker-runs/credentials` seams;
- `claims`, `jobs`, `contacts`, `contact_addresses`, `contact_jobs`, `rooms`, Encircle-linked forms,
  documents, notes, external-ID indexes, sync status/error/permalink columns, and provider identity.

The pending Encircle migration, flag, candidate entry, runtime smoke, rotation, fallback removal, and
obsolete Netlify retirement are rollout gates. They do not reserve application files, but live
database applies and external mutations require their own owner-authorized windows.

## Retirement rules

- `complete` + no rollout/verification tail → archive manifest at the next registry review.
- `owner_gate`/`blocked_external` → keep active row, but manifest becomes non-writer and names review date.
- `superseded` → point to replacement and remove old dispatch blocks from active launch surfaces.
- `cancelled` → retain rationale and data/flag cleanup requirements.
- No stale branch/worktree is deleted or merged from this registry alone; the owner chooses after
  read-only diff/provenance review.
