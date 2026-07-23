
# July 2026 Prioritized Remediation Backlog

This backlog does not authorize source changes. It sequences the canonical findings in the other audit documents. Effort: S ≤1 day, M 1–3 days, L 1–3 weeks, XL >3 weeks.

## Priority 0 — Immediate live-data and money-path containment

| Order | Finding | Action | Effort | Depends on / coordinate with | Exit evidence |
|---:|---|---|---:|---|---|
| 1 | DB-003 | **COMPLETED 2026-07-23:** revoked PUBLIC/anon/authenticated execution; retained verified service-role owner boundary | S | None for revoke | Live catalog passed; anon/authenticated returned `42501`; service role passed; advisor no longer references function |
| 2 | DB-004 | Close highest-risk anonymous SELECT/write policies in tested workflow waves | L | TEST-002; messaging/scheduling/CRM owners | Anon role matrix denies every non-allowlisted table and core public journeys still work |
| 3 | AUTH-004 | Make form Worker/service role the sole submission boundary; stop trusting caller consent context | M | DB-004, TEST-002 | Direct RPC denied; Worker abuse/schema/consent tests pass |
| 4 | SEC-005 | Disable obsolete `sheets-proxy` or bring it under source control, authentication and limits | S–M | Integration owner, TEST-004 | Live hash matches release source; hostile/unauthenticated requests denied |
| 5 | SEC-004 | Remove job-file listing; migrate sensitive files to private/signed access | M–L | DB-004, data classification | Anon cannot list; authorized signed/public artifact flows pass |
| 6 | AUTH-001 | Enforce active employee + canonical billing roles on QBO charge; record actor | S | COR-002 | Denied-role tests prove provider is never called |
| 7 | AUTH-002 | Enforce active employee + canonical billing roles on Stripe pay-link | S | COR-003 | Denied-role tests prove Stripe is never called |
| 8 | COR-002 | Add durable charge attempt/idempotency and captured-but-unrecorded recovery | M–L | AUTH-001, Intuit sandbox | Failure-injection retry produces one charge/one payment |
| 9 | COR-001 | Use Mountain business date for UPR/QBO payment dates | S | Same charge-path change | DST and Mountain-midnight tests pass |
| 10 | COR-003 | Reuse/replace Stripe sessions under explicit concurrency/expiry rules | M | AUTH-002, Stripe sandbox | Concurrent/retry test produces one active session |

## Priority 1 — Restore trustworthy authorization and release provenance

| Order | Finding | Action | Effort | Depends on / coordinate with | Exit evidence |
|---:|---|---|---:|---|---|
| 11 | DB-005 | Reconcile live feature-branch migrations into `dev`; add migration provenance gate | S–M | Owner/Git history | Every new live ledger entry maps to a commit reachable from release ref |
| 12 | ARCH-001 | Provision an isolated non-production Supabase environment and provider sandboxes | L | Owner/cloud access | Clean migration apply + seeded test users without production mutation |
| 13 | TEST-002 | Split blocking unit and database contract lanes; eliminate unexpected DB skips | L | ARCH-001 | CI reports zero unexpected DB skips and tested migration head |
| 14 | DB-001 | Regenerate catalog baseline/schema/RPC docs from one read-only live snapshot | S | Live read access | Counts/policies agree and capture metadata is current |
| 15 | DB-002 | Classify/tighten authenticated grants, RLS and privileged RPCs in sensitivity order | XL | ARCH-001, TEST-002 | Representative-role matrix proves least privilege for priority objects |
| 16 | AUTH-005 | Enforce e-sign status/expiration in public RPCs and minimize returned fields | S–M | TEST-002, signing owner | Direct expired/revoked token calls disclose no payload |
| 17 | SEC-006 | Enable leaked-password protection and verify account policy/recovery | S | Auth owner/test account | Advisor cleared; compromised test password rejected |
| 18 | TEST-004 | Validate deployment variables and add read-only post-deploy smoke | S–M | Cloudflare/GitHub access | Missing required config blocks promotion |
| 19 | SEC-003 | Make production CORS deterministic and test both origins | S | TEST-004 | Deployed preflight/actual requests pass; hostile origin fails |
| 20 | AUTH-003 | Separate rollout state from authorization and fail closed on flag-load error for controlled routes | M | DB-002 defense in depth | RPC-failure route tests keep rollout-hidden pages unavailable |

## Priority 2 — Supply chain, reliability, performance and engineering gates

| Order | Finding | Action | Effort | Depends on / coordinate with | Exit evidence |
|---:|---|---|---:|---|---|
| 21 | SEC-001 | Triage/upgrade production dependency advisories | M | iOS/native smoke environment | No unexpired critical/high advisory without reviewed exception |
| 22 | REL-001 | Add bounded Supabase Worker fetches with timeout tests | S–M | COR-002 retry semantics | All shared DB operations abort predictably; webhook tests converge |
| 23 | MAINT-003 | Separate product lint from tooling/generated scopes | S | None | `lint:app` has deterministic file universe |
| 24 | MAINT-002 | Capture baseline, block new lint issues, then reduce to zero | M–L | MAINT-003 | New violation fails CI; total trends down; final lint blocking |
| 25 | TEST-003 | Configure explicit Vitest includes/excludes and unit/DB patterns | S | TEST-002 naming | Test list contains no nested worktree/generated paths |
| 26 | PERF-001 | Enforce reviewed per-asset bundle regression budgets | S | None | Intentional size regression fails CI |
| 27 | PERF-003 | Add prioritized FK indexes; optimize/consolidate RLS policies with plan/role evidence | M–L | ARCH-001, DB-002, TEST-002 | Advisor debt falls; plans improve; role behavior unchanged |

## Priority 3 — Production security and observability

| Order | Finding | Action | Effort | Depends on / coordinate with | Exit evidence |
|---:|---|---|---:|---|---|
| 28 | SEC-002 | Capture deployed headers; stage a route-aware security-header baseline/CSP | M | OBS-001 for CSP reports | Automated production/Preview header assertions pass |
| 29 | OBS-001 | Add privacy-reviewed client error reporting and Worker alerts | M | COMP-001, COMP-004 | Synthetic failure produces one redacted actionable event |
| 30 | TEST-001 | Add browser smoke journeys and native release verification | L | ARCH-001, TEST-002 | Representative-role critical journeys run on PR/release |
| 31 | ACC-001 | Add axe/static checks and manual keyboard/VoiceOver matrix | L | TEST-001 | Critical routes have no serious/critical automated violations and manual evidence is current |

## Priority 4 — Compliance operations and product quality

| Order | Finding | Action | Effort | Depends on / coordinate with | Exit evidence |
|---:|---|---|---:|---|---|
| 32 | COMP-002 | Document and implement auditable deletion-request fulfillment | M–L | COMP-001, DB-002 | Request closes, access is revoked, retention action is recorded |
| 33 | COMP-001 | Build data inventory; reconcile privacy notice, retention and providers | M–L | OBS-001/owner/legal | Signed inventory/notice/App Store cross-check |
| 34 | COMP-004 | Resolve Apple Financial Info classification from current definitions/flow | S–M | COMP-001 | Approved written rationale matches App Store answers |
| 35 | COMP-003 | Complete reviewer account, screenshots, enrollment and ASC data | M | ACC-001, COMP-001/002/004 | TestFlight/reviewer checklist complete |
| 36 | PERF-002 | Split global CSS by route/domain behind visual coverage | L | TEST-001, ACC-001 | Global CSS shrinks; route screenshots/interactions pass |
| 37 | MAINT-001 | Decompose highest-risk large modules behind characterization tests | XL | TEST-001, PERF-002 | Smaller ownership units with stable contracts and no behavior drift |

## Finding disposition ledger

Every formal finding is scheduled above:

- Architecture/database: ARCH-001, DB-001, DB-002, DB-003, DB-004, DB-005.
- Authorization: AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005.
- Security: SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006.
- Correctness/reliability: COR-001, COR-002, COR-003, REL-001.
- Performance: PERF-001, PERF-002, PERF-003.
- Maintainability: MAINT-001, MAINT-002, MAINT-003.
- Testing/observability: TEST-001, TEST-002, TEST-003, TEST-004, OBS-001.
- Accessibility/compliance: ACC-001, COMP-001, COMP-002, COMP-003, COMP-004.

## Decision gates requiring owner/external input

| Gate | Needed before |
|---|---|
| Canonical billing role set and webhook-secret caller inventory | AUTH-001/AUTH-002 implementation |
| Intuit and Stripe sandbox/idempotency semantics | COR-002/COR-003 completion |
| Supabase environment ownership, budget and seed policy | ARCH-001/TEST-002 |
| Product future: internal-only versus multi-tenant SaaS | DB-002 architecture |
| Required logged-out workflows and public file classification | DB-004/SEC-004 containment |
| Public form UUID exposure and consent-evidence standard | AUTH-004 implementation |
| Google Apps Script owner, behavior and call history | SEC-005 disposition |
| Signing-link retention/revocation requirements | AUTH-005 implementation |
| Data classification, retention, deletion SLA and legal review | COMP-001/COMP-002 |
| Apple distribution model and current privacy definitions | COMP-003/COMP-004 |
| WCAG target and supported assistive technology/device matrix | ACC-001 |
| Error telemetry vendor/retention/PII policy | OBS-001 |

## Suggested implementation batches

1. **Emergency database/public-boundary containment:** DB-003 is complete; continue with highest-risk
   DB-004 policies, AUTH-004, SEC-004 and SEC-005.
2. **Payment authorization + consistency:** AUTH-001, AUTH-002, COR-001, COR-002, COR-003.
3. **Provenance + isolated authorization testing:** DB-005, ARCH-001, TEST-002, DB-001, DB-002,
   AUTH-005 and SEC-006.
4. **Release/performance gates:** TEST-004, SEC-003, MAINT-003, MAINT-002, TEST-003, PERF-001,
   PERF-003 and SEC-001.
5. **Production evidence:** SEC-002, OBS-001, TEST-001, ACC-001.
6. **Compliance operations/refactoring:** COMP-001–004, PERF-002, MAINT-001.

Each batch should be independently releasable, have rollback/recovery evidence, and avoid combining schema risk with broad visual refactors.
