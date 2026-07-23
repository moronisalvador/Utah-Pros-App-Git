<!--
FILE: docs/upr-engineering-foundation-roadmap.md

WHAT THIS DOES (plain language):
  Proposes one finish-first engineering program for Utah Pros. It reconciles unfinished work,
  security containment, test isolation, tooling governance, design-system work, and product
  completion while preserving the landed Encircle contract and pending rollout gates.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, canonical docs, UPR-Web-Context.md,
            docs/audit/2026-07/, docs/upr-unfinished-work-registry.md,
            docs/upr-engineering-foundation-dispatch.md,
            .claude/rules/upr-engineering-foundation-wave-ownership.md
  Data:     reads → documentation and read-only catalog evidence
            writes → documentation only

NOTES / GOTCHAS:
  - DRAFT FOR OWNER REVIEW. This is not current project law until explicitly adopted.
  - Encircle implementation landed at 0a06a21 and released its application/database writer lease.
  - Its migration is unapplied, rollout flag OFF, credentials unchanged, and rollout tails pending.
  - Audit snapshots are historical unless a current query below explicitly re-verifies them.
-->

# UPR Engineering Foundation and Unfinished-Work Roadmap

**Draft v1:** 2026-07-23
**Evidence checkout:** branch `codex/foundation-roadmap` at `0a06a21`, matching `origin/dev`
**Program slug:** `upr-engineering-foundation`
**Mode:** planning/documentation only; no code, migration, live write, external mutation, commit, push,
deployment, or PR is authorized by this document.

## 1. Program decision

UPR should pause new major product foundations and finish the existing system through one controlled
program. The program starts with evidence and containment, not a broad rewrite:

1. Treat Encircle implementation commit `0a06a21` as landed and its writer lease as released.
   Preserve its pending rollout gates: migration unapplied, flag OFF, credentials unchanged.
2. Reconcile work and ownership truth into one registry with explicit states and retirement rules.
3. `exec_read_sql` containment and F2 migration provenance reconciliation completed and verified on
   2026-07-23; preserve both as release-control regression boundaries.
4. Create isolated QA data and representative roles before making database/browser tests blocking.
5. Repair skills/agents/plugin permissions and trigger governance before adding Figma or more
   automation.
6. Complete owner gates and started product workflows before starting net-new product scope.

The Encircle lease is closed. No implementation currently holds the application/database writer
lease under this roadmap. Encircle’s later migration apply, flag change, candidate entry, credential
rotation, and obsolete Netlify retirement are owner/external gates, not an active writer reservation.
Any authorized Encircle database apply still serializes with every other shared-database phase.

## 2. Evidence boundary

### Current, verified 2026-07-23

- At the F1 apply, `origin/dev` was `1875e63`; reviewed containment commit `5cf546b` was reachable
  from both `origin/dev` and `origin/main`.
- Owner-reported GitHub CI and Cloudflare staging passed for `0a06a21`.
- Repository and canonical docs confirm the managed-credential migration remains unapplied, the
  rollout flag remains OFF, and no credential entry/rotation/revocation occurred.
- The owner confirmed the legacy Netlify Demo Sheet is obsolete and unsupported; retirement of the
  deployment and any remaining binding is cleanup, not a supported-consumer migration.
- Read-only live catalog query against project `glsmljpabrwonfiltiqm` returned:
  - 130 public tables, 225 public policies, and 366 public functions;
  - 345 `SECURITY DEFINER` functions;
  - 342 `SECURITY DEFINER` overloads executable by `authenticated`;
  - 33 unrestricted anonymous-policy cases and 176 unrestricted authenticated-policy cases under
    the audit classifier;
  - before F1, `public.exec_read_sql(p_query text)` was `SECURITY DEFINER` and executable by
    `authenticated` and `service_role`; the 2026-07-23 apply now denies `PUBLIC`, `anon`, and
    `authenticated` while preserving `service_role`;
  - CRM phases `4b` and `5-ops` remain `planned` with 12 `todo` stages;
  - no public table name contains `test`, `qa`, or `sandbox`.
- The four July migration-ledger entries previously identified as branch-ahead-of-`dev`
  (`crm_denver_day_bucketing`, `crm_sales_summary_total_vs_traced`,
  `crm_dedup_repeat_caller_leads`, `crm_caller_name_follows_merge`) now map to byte-verified restored
  source on `dev`; the live `set_lead_caller_name` body differs only by comments and is not rewritten.
- Current source confirms `qbo-charge.js` authenticates any valid Supabase user before moving money
  and uses UTC date slicing (`functions/api/qbo-charge.js:22-31,77-90`); `stripe-pay-link.js`
  likewise accepts any valid user and always creates a new Checkout session
  (`functions/api/stripe-pay-link.js:14-22,28-70`).
- Current source confirms the UX foundation exists but adoption is incomplete:
  `src/hooks/useResumeRefetch.js:78-107` has no page/component consumers; only two page/component
  consumers use `useTwoClickConfirm`; 68 files still dispatch raw `upr:toast`.

### Historical, not re-proven in this session

The July audit’s business-row exposure counts, Storage object counts, advisor totals, Edge Function
runtime configuration, provider state, exploitation history, and representative-role behavior remain
historical evidence from `docs/audit/2026-07/`. They guide priority but must be refreshed before an
implementation relies on them.

### Not inspected or changed

No business rows, secrets, Auth identities, Storage objects, raw logs, provider payloads, Cloudflare
settings, Apple consoles, or connected plugins were read or changed. No build, test, lint, browser,
device, or provider verification was run for this documentation-only initiative.

### Reproducible live-query record

The current counts above came from read-only catalog queries over `pg_class`, `pg_policy`,
`pg_proc`, `information_schema.routine_privileges`, and the migration ledger. The unrestricted
policy classifier counts explicit unconditional `USING`/`WITH CHECK` cases; it is a triage signal,
not proof that every matching object is exploitable. Before S/D work, preserve the exact query
text and raw results in a newly dated evidence addendum and add direct intended/denied-role tests.

### Severity findings and interim controls

1. **Contained Critical regression boundary — privileged SQL execution:** F1 now denies browser
   roles from `exec_read_sql` and preserves only the verified service-role consumer. Do not add
   browser consumers or cite the function as a supported client contract.
2. **Critical — broad database authorization:** aggregate unrestricted grants/policies remain large.
   Freeze new anonymous grants and new `SECURITY DEFINER` browser contracts pending classification.
3. **Contained High regression boundary — live/source provenance drift:** F2 restored only the four
   reviewed source records and added a fresh-evidence release gate. Do not replay live rows or replace
   live bodies merely to align filenames or comments.
4. **High — money authorization/idempotency:** current QBO/Stripe Workers authenticate without the
   required billing-role boundary. Do not expand callers or add adjacent money flows before M.
5. **High — public form/signing/file coupling:** signing writes into the `job-files`/document path.
   Signing and Storage require one co-designed contract and serialized database applies.
6. **High — no isolated QA target:** mutation-heavy database/browser verification is not safely
   blocking until F3. This does not prevent a narrowly reviewed emergency revoke: use static
   migration checks plus immediate direct negative-role verification, then close the QA tail.

## 3. Status system

Capability and delivery state are separate:

### Capability verdict

- `HAVE`: current code/schema/live evidence implements the acceptance contract.
- `PARTIAL`: a real path exists, but adoption, safety, verification, rollout, or cleanup is incomplete.
- `MISSING`: no current implementation satisfies the capability.

### Delivery axes

Do not overload one status field:

- **Implementation:** `not_started | ready | writing | landed | verified`.
- **Gate:** `none | internal | external | owner | verification_tail`.
- **Disposition:** `active | superseded | cancelled | archived`.

Capability (`HAVE | PARTIAL | MISSING`) remains a fourth, independent verdict. “Blocked” therefore
means an explicit gate on a named implementation state, not a substitute for progress.

Every active item must name an owner, next action, evidence date/commit, acceptance criteria,
dependencies, exact files/schema/external systems, and retirement condition.

## 4. WIP and writer limits

- **Now:** no application/database writer lease is active. Encircle code is landed; its pending
  rollout gates do not retain a lease.
- **Next:** one owner-authorized database/migration writer at a time. F1 and F2 are complete; the
  separately authorized Encircle rollout or the next selected finish-first phase uses the window.
- Two application writers is an initial
  cap, not a target; use fewer unless pairwise disjointness is proven. Each implementation gets an
  independent review lane.
- `src/App.jsx`, `src/index.css`, auth/realtime, shared Worker libraries, messaging chokepoints, and
  canonical docs each have one owner at a time.
- A phase cannot be parallel merely because its branch is separate. Pairwise file, function/table,
  migration/apply-window, test-fixture, and external-side-effect disjointness must be recorded.
- Non-writing items with `external`, `owner`, or `verification_tail` gates do not consume
  implementation WIP, but each needs an owner and review date.
- No new major initiative starts while a P0/P1 item is `ready` and unowned.

## 5. HAVE / PARTIAL / MISSING summary

| Capability | Verdict | Current evidence | Confidence | Exit condition |
|---|---|---|---|---|
| Architecture/project law | HAVE | `CLAUDE.md`; `AGENTS.md`; canonical `docs/*.md` | High | Keep current and conflict-tested |
| Master-planning pattern | HAVE | `.claude/skills/masterplan/SKILL.md:1-275`; CRM worked example | High | Use one registry/status model |
| Durable program registry | MISSING | `src/lib/roadmapData.js:27-47` has only three states and July 3 freshness; CRM tracker is domain-specific | High | Registry fields/statuses/WIP/retirement enforced |
| Encircle managed integration | PARTIAL; landed with owner/external verification tails | `0a06a21` on `origin/dev`; owner reports CI/staging passed; migration unapplied, flag OFF, credentials unchanged | High | Apply-window tests; owner-only flag; candidate activation; multi-runtime smoke; rotation/fallback cleanup |
| `exec_read_sql` containment | HAVE; Critical boundary contained | Applied/verified 2026-07-23; browser-role denials, service-role smoke, catalog fingerprint, ledger, and advisor evidence recorded | High | Keep service-only regression test and ACL invariant |
| Anonymous/authenticated least privilege | PARTIAL + Critical | Current policy/function counts; July evidence enumerates affected objects | High aggregate; object behavior needs role tests | Classified role matrix and staged closures |
| Migration provenance | HAVE; High boundary reconciled | F2 maps the seven-entry live tail to reviewed release source and checks 11 function plus one policy fingerprint | High | Refresh read-only evidence within six hours of release validation |
| Worker auth/shared libraries | PARTIAL | Shared helpers exist; inventory found 17 local auth helpers and limited timeout/telemetry adoption | High | Sensitive Workers use canonical auth/role/timeout/telemetry contracts |
| Money-path safety | PARTIAL + High/Critical | `qbo-charge.js` and `stripe-pay-link.js` current-source gaps | High | Role denial, stable idempotency, recovery/reuse, Denver date tests |
| Public form/signing/file boundaries | PARTIAL + High | July evidence plus current migration/Worker source | High design evidence; live behavior needs refresh | Direct bypass denied; minimal capability DTOs; signed/private files |
| Authenticated local QA login | HAVE narrow path | `CLAUDE.md:124-129`; `src/pages/Login.jsx:86-90,259` | High | Keep restricted to dedicated test account |
| Isolated DB/browser QA | MISSING | Shared production DB; no named QA tables; no Playwright/axe scripts | High | Separate target, seeded roles, reset, zero unexpected skips |
| Skills/agents/plugin governance | PARTIAL | `tooling-capability-review.md`; broad shared permissions; broken duplicate ports | High | Canonical source, validated adapters, narrow permissions, trigger tests |
| Shared design tokens/primitives | HAVE foundation / PARTIAL adoption | `UPR-Web-Context.md:125-150`; UX adoption metrics above | High | W1-W5 adoption and visual/accessibility evidence |
| Figma workflow | MISSING; internal gate | Tooling review defers Figma until governance and QA readiness | High | Owner-approved connection/seat, source-of-truth and handoff rules |
| CRM completion | PARTIAL | Live tracker: 4b and 5-ops planned; real CRM routes at `src/App.jsx:430-450` | High | A2P gate or explicit supersession; 5-ops acceptance |
| Omni inbox | PARTIAL | Foundation files exist; inbound Worker/API absent; O/U superseded by SMS work | High | Re-baselined Phase I and live inbound verification |
| SMS/Tech Messages | PARTIAL; owner/verification-tail gates | Code waves shipped; device/A2P/deep-link/rollout tails remain | High | On-device evidence, specific-thread deep link, rollout decision |
| Tech v2 route/flag resilience | PARTIAL | Route elements can be null only when current runtime flags are disabled/force-disabled; missing flags default enabled (`App.jsx`, `TechLayout.jsx`, `AuthContext.jsx`, `featureFlags.js`) | Medium until all live flag states are queried | Test missing/enabled/disabled/force-disabled; provide explicit fallback |
| Tech Job Hub H3 | PARTIAL / owner gate | `docs/tech-v2-roadmap.md:551-561`; legacy routes/files remain | High | Written bake, resolver/retarget/cleanup/device verification |
| Schedule Desktop | PARTIAL/MISSING | Current bugs at `Schedule.jsx:66,392,554-555,766`; roadmap unbuilt | High | Correctness first, then A→B→C completion |
| App Store release | PARTIAL; external gate | `docs/app-store-readiness-roadmap.md:214-225` | High | Xcode/TestFlight/ASC owner evidence |
| Account deletion fulfillment | PARTIAL | Request-linked processor is absent; a generic Team hard-delete path exists (`Team.jsx`, `admin-users.js`) | High | Decide integrate/replace/disable; retention/revocation/audit tests |
| UX failure/loading/resume | PARTIAL | Customers/Leads/Marketing failure→empty; Job/Customer detail blank; hook adoption gaps | High | Split list-page work from Encircle-frozen detail pages; errors/retry, silent resume, 390px/minimize tests |

The detailed line-item registry is `docs/upr-unfinished-work-registry.md`.

## 6. Foundation phases

### Phase E — Encircle landed implementation and rollout tails

> **Implementation:** `landed` at `0a06a21` · **Gate:** `owner + external + verification_tail`
> **Disposition:** `active` until rollout/rotation cleanup · **Writer lease:** released
> **Model · effort:** strongest available, high; integration/data-contract risk
> **Read scope:** Encircle reference/handoff, current callers, related migrations/tests, canonical
> integration/auth/database docs

**Scope:** preserve the landed managed-credential application/Worker/database contract and track its
remaining production rollout without treating the tail as an active code writer.

**Close-out checklist**

- [x] Application, Worker, tests, migration, rollback, and canonical docs committed/pushed to
      `origin/dev` at `0a06a21`; owner reports CI and Cloudflare staging passed.
- [x] Writer lease released; Foundation planning rebased onto the landed commit.
- [ ] Apply `20260723_encircle_managed_credentials.sql` in its own authorized, serialized window and
      run the short-lived-role contract test. It remains unapplied.
- [ ] Keep the flag OFF until the owner selects the dev-only user and browser/device checks pass.
- [ ] Enter/activate a candidate, smoke Pages Preview/Production and `upr-mcp`, then separately
      authorize old-token rotation and fallback removal.
- [ ] Retire the obsolete/unsupported Netlify Demo Sheet deployment and any remaining secret binding;
      do not preserve or migrate it as a supported consumer.

### Phase F0a/F0b — Registry adoption and ownership retirement

> **Implementation:** `ready` for docs-only review · **Gate:** `owner` · **Disposition:** `active`
> **Prerequisite:** owner approves vocabulary and repository location
> **Model · effort:** high; cross-program governance

**Scope:** promote these four draft artifacts or their approved replacements. Zero application,
schema, live, or external changes.

**Acceptance**

- One active registry; stable IDs; capability and delivery states separated.
- Every active item has evidence/owner/next action/dependencies/acceptance/retirement.
- Existing active manifests reclassified as writer, owner gate, verification tail, superseded, or
  archivable.
- Public roadmap remains presentation, not engineering authority.
- F0a adopts the registry/control schema; F0b separately inventories every existing ownership
  manifest, branch, and worktree and records retain/supersede/archive decisions. No deletion occurs.

### Phase F1 — Emergency `exec_read_sql` containment

> **Implementation:** `verified` · **Gate:** complete · **Disposition:** `archived`
> **Completed:** 2026-07-23; live ledger `20260723221707`; evidence addendum linked below
> **Model · effort:** highest/high; privileged production boundary
> **Scope:** one reviewed migration, one database-contract test, one rollback note; no Encircle tables

**Acceptance**

- Revoke `PUBLIC`, `anon`, and `authenticated` execution; retain only a documented service-only
  boundary if the owner proves a consumer.
- Direct `anon` and `authenticated` calls are denied for representative public/auth/credential reads.
- Service consumer (if retained) works through a non-browser contract.
- Live ACL/function fingerprint, advisors, migration ledger/source reachability, rollback, and schema
  cache are verified.
- If F3 is unavailable, emergency containment may proceed only with static migration/ACL checks and
  immediate direct post-apply negative tests for `anon` and `authenticated`; isolated-QA rerun stays
  an explicit verification tail.

All acceptance checks passed. Evidence:
`docs/audit/2026-07/evidence/exec-read-sql-containment-2026-07-23.md`.

### Phase F2 — Migration provenance reconciliation

> **Implementation:** `verified` · **Gate:** complete · **Disposition:** `archived`
> **Completed:** 2026-07-23; release evidence and reviewer results linked below
> **Prerequisite:** F1 complete; applies serialized
> **Model · effort:** high; shared-production reproducibility
> **Scope:** reconcile four known live-only ledger entries and add a read-only provenance gate

**Acceptance**

- Exact live definitions are compared to the named branch commits before source is restored.
- No live body is overwritten merely to match a filename.
- Restore only the four selected reviewed migration/source files, never an entire historical commit.
- Each new live ledger entry maps to reviewed source reachable from the release ref.
- CI/release evidence reports ledger/source and selected function/policy fingerprint drift.

All acceptance checks passed without a live write. The gate maps the seven-entry ledger tail,
enforces reviewed-origin blob equality, bounds evidence freshness to six hours, verifies capture-base
ancestry, and checks 11 function plus one policy fingerprint. The one raw body difference is
comment-only and remains a warning. Evidence:
`docs/audit/2026-07/evidence/migration-provenance-2026-07-23.md`.

### Phase F3a/F3b/F3c — Isolated QA access and test-data foundation

> **Implementation:** P0 decision package complete; F3a internal ownership checkpoint ready ·
> **Gate:** `external + owner` · **Disposition:** `active`
> **Prerequisite:** owner chooses Supabase ownership/budget/reset policy
> **Model · effort:** high; auth/data-isolation architecture
> **Scope:** separate Supabase target or approved local stack, representative roles, TEST organization,
> deterministic seeds/reset, provider sandboxes; never shared production

**Split and acceptance**

- **F3a — environment/bootstrap:** owner-selected hosted/local target, migration-from-zero, and CI
  refusal of production project URLs/IDs.
- **F3b — identities/data:** anon, admin, office/PM, supervisor, field-tech, CRM-partner, inactive,
  unknown-employee, TEST organization, deterministic seeds, and no real employee credentials.
- **F3c — reset/subsystems:** idempotent cleanup plus Storage/Auth/Realtime coverage. Provider
  sandboxes are separate external verification tails, not blockers for the core isolated target.

The 2026-07-23 P0 addendum records the safe environment, identity, provider, telemetry, GitHub,
accessibility, and Encircle boundaries. It supersedes—not merges—the `3841056` plan because that plan
would keep mutation-heavy integration tests on the shared production database. P1/P2a may begin only
after exact file ownership is opened; hosted project/account creation remains an owner/external gate.

### Phase F4a/F4b/F4c — Test, CI, deployment, and observability gates

> **Implementation:** `not_started` · **Gate:** `internal` on F3 · **Disposition:** `active`
> **Model · effort:** medium/high
> **Scope:** split pure unit/Worker/database/browser lanes; deployment config preflight; provenance and
> no-new-regression gates

**Split and acceptance**

- **F4a — unit/database:** deterministic blocking `test:unit`; `test:db` only against F3 with zero
  unexpected skips; migration and authorization gates.
- **F4b — browser/accessibility:** representative roles/core journeys, Playwright/axe, 390px,
  minimize/resume, and forced failure/empty/loading states.
- **F4c — deployment/observability:** lint/bundle new-debt ratchets, binding preflight, provenance,
  read-only deployed smoke, and explicit native/provider verification tails.

### Phase F5a/F5b/F5c — Skills, agents, hooks, and plugin governance

> **Implementation:** `ready` after owner decisions · **Gate:** `owner` · **Disposition:** `active`
> **Parallelism:** conditional with F3 after exact paths are assigned
> **Model · effort:** high; automation authority
> **Scope:** `.claude` governance and tests only; no app/database/provider writes

**Split and acceptance**

- **F5a — secret/permission containment:** owner rotates/revokes exposed Encircle credential, decides
  history treatment, removes tracked machine-local permissions, and makes shared defaults read-mostly.
- **F5b — canonical adapters/paths:** one skill/agent source, deterministic validated adapters, zero
  unresolved paths, and required reviewer parity.
- **F5c — trigger/plugin governance:** collision/authority tests distinguish plan/write/apply/publish;
  plugins are active/conditional/unavailable and cannot broaden task authority. Figma remains
  uninstalled/unconnected until F6 and explicit owner approval.

### Phase F6a/F6b — Design-system and Figma operating model

> **Implementation:** `not_started` · **Gate:** `internal + owner` on F4/F5 and seat decision
> **Disposition:** `active`
> **Model · effort:** high; product-wide visual authority
> **Scope:** design source-of-truth, inspection/handoff/versioning rules, token/component coverage map;
> no opportunistic page rewrite

**Split and acceptance**

- **F6a — authority/handoff:** decide authority by artifact type; map Figma variables/components to
  semantic code tokens/primitives; define inspect/export/handoff/review permissions and seat exit.
- **F6b — QA baselines/adoption:** establish isolated-QA dark/mobile/accessibility baselines and
  replan UX W1-W5 with exact disjoint page/CSS sets.

## 7. Finish-first product waves

These are program lanes, not immediate authorization. Each row must be split into one-session phase
blocks and re-proven against the current release head and any later Encircle rollout changes.

| Order | Lane | Earliest state | Key work | Hard edges |
|---:|---|---|---|---|
| 1 | S — Public/data containment | after F3 | highest-risk anon policies, form RPC, signing DTO/expiry, job-file privacy | one DB writer; rebase/serialize any Encircle contract overlap |
| 2 | M — Money correctness | after F3 | QBO role/idempotency/recovery/Denver date; Stripe role/reuse/concurrency | shared auth/http seams owned once; provider sandboxes |
| 3 | O — Owner/verification tails | anytime after relevant code | App Store Xcode/ASC, Tech Messages bake, Job Hub bake, Web Push, P9 cutover, purge cron, A2P | external/owner gates; no coding slot |
| 4 | C — Started communications | after F3/F5 | per-thread push link, Omni inbound Phase I, CRM 4b decision, CallRail auth seam | messaging chokepoints serialized; consent auditor |
| 5 | D — DB Foundation tails | after S | P8 Storage, P5 index tail, privileged-RPC contract inventory, leaked-password owner action | data classification; one DB writer |
| 6 | P — Product completion | after F4/F6 | UI error/blank states, deletion fulfillment, Tech More decisions, CRM 5-Ops, Schedule A→B→C | exact page ownership; Schedule serial |
| 7 | U — UX adoption | after current product owners release files | current W1-W5 rebaseline; primitives/toast/resume/a11y/perf adoption | W3 sole cross-cutting owner; no overlap with product lanes |
| 8 | N — New product scope | only after P0/P1 registry is clear | owner-selected initiatives | no ready critical/high item unowned |

## 8. Parallelism proof and safest launch sequence

### Current post-Encircle baseline

- No application/database writer lease is active.
- Registry review, read-only security/provenance refresh, QA architecture, governance design, and
  owner-gate preparation may run together.
- F1 and F2 are complete; provenance validation remains a CI/release regression boundary.
- The unapplied Encircle migration remains a separate owner-gated rollout window and cannot overlap
  another database apply.

### Foundation and later waves

- Any later database phase starts from the completed F1/F2 release-control baseline and applies serially.
- F3 and F5 are parallel only after exact paths are assigned. F5 trigger/checker tests may execute
  F3/CI tools, so shared fixtures and CI configuration have one owner and both lanes rebase/retest.
- F4 follows F3 because it consumes the isolated environment.
- F6 follows F4/F5 because design inspection needs governed tools and visual QA.
- QBO and Stripe code phases are file-disjoint, but any shared `auth/http/supabase/worker-runs`
  change belongs to one Foundation owner and lands first.
- Public form work is mostly code-disjoint from signing, but tests/docs are serialized. Signing and
  Storage are **not disjoint**: `submit-esign.js` writes PDFs into the `job-files`/`job_documents`
  path. They co-design one privacy contract and apply serially.
- Schedule A→B→C stays serial. UX W1/W2/W3 does not overlap Schedule, Tech, CRM, Settings, or
  Encircle files until pairwise ownership is re-proven.

## 9. What resisted maximum parallelism

- One shared production Supabase makes every migration immediately cross-environment.
- Encircle `0a06a21` changed shared auth/credential/worker-run seams and related UI/Workers; every
  dependent phase must rebase on that contract.
- `src/App.jsx`, `src/index.css`, shared auth/HTTP/database libraries, and messaging chokepoints are
  genuine hotspots.
- Owner/device/provider gates cannot be converted into coding work.
- Current initiative manifests use “active” for writers, dark launches, verification tails, and
  shipped owner gates; registry reconciliation must precede trustworthy dispatch.
- Foundation is a single point of failure; its containment/QA/governance changes require independent
  reviewer evidence before product waves.

## 10. Options on record

### Registry storage

- **Recommended:** versioned Markdown registry first. It is reviewable, branch-aware, and cannot
  mutate production.
- Generic database tracker wins only after isolated QA exists and the owner wants a runtime board.
- Do not bolt non-CRM work onto `crm_build_phases`.

### QA database

- **Recommended:** isolated hosted Supabase project for deployed/browser/provider parity, optionally
  paired with local Supabase for migration-from-zero speed.
- TEST rows in shared production are only a temporary, narrowly authorized fallback and do not
  satisfy isolation.

### Figma authority

- **Recommended:** Figma owns design intent and review artifacts; repository tokens/components own
  executable truth. Changes require an explicit mapping and parity check.
- Figma should not become a second uncontrolled design system or a prerequisite for routine bug fixes.

## 11. Owner decisions

1. Approve the status vocabulary, WIP limits, and Markdown registry as the first authority.
2. Schedule the Encircle migration/flag/candidate/rotation rollout as separate owner-gated windows;
   keep the migration unapplied, flag OFF, and credentials unchanged until authorized.
3. **Completed 2026-07-23:** authorized and verified the F1 production containment apply window.
4. **Partially completed 2026-07-23:** dedicated/local isolation, reset safety, and representative
   role design are recorded; hosted ownership, budget, retention, and project creation remain gates.
5. **Completed 2026-07-23:** `3841056` is superseded, not merged; retain its diagnosis while moving
   all mutation-heavy database tests to the isolated-environment contract.
6. Decide which logged-out workflows and `job-files` objects must remain public.
7. Confirm canonical billing roles and provider sandbox availability.
8. Approve credential rotation/history treatment, obsolete Netlify retirement, canonical skill
   source, and permission reductions.
9. Authorize Figma connection/one-month seat only after F4/F5 readiness.
10. Resolve owner gates: A2P, Job Hub, Tech Messages, Web Push, P9 credentials, Apple/Xcode/ASC,
    feedback purge scheduling, and account-deletion SLA.

## 12. Adversarial challenge report

Independent refute-first, disjointness, and counter-order reviews changed the draft:

| Challenge | Result | Plan change |
|---|---|---|
| “Encircle must finish before critical containment” | RESOLVED | Encircle landed first; its writer lease was released; F1 then applied and verified independently |
| One delivery-status column | REFUTED | Separate implementation, gate, disposition, and capability |
| Full isolated QA is a hard prerequisite for F1 | MODIFIED | Emergency revoke may use static checks + immediate direct negative tests; QA rerun is a tail |
| F3/F4/F5/F6 are one-session phases | REFUTED | Split into a/b/c bounded phases |
| Signing and Storage are parallel | REFUTED | Shared file/document contract; co-design and serial apply |
| Q and G are automatically disjoint | REFUTED | Conditional on exact CI/fixture/checker ownership |
| Tech null routes are currently P0 | MODIFIED | P1 pending complete live flag-state proof; test all flag states |
| Deletion has no fulfillment path at all | MODIFIED | Generic hard-delete exists; request-linked compliant orchestration is missing |
| Cold blocks are portable from `origin/dev` | REFUTED | They exist only on the local Foundation branch until separately pushed/adopted |

### Required rule amendments before adoption

- Add the three-axis status contract and namespaced stable IDs with `audit_refs`.
- Require writer leases to have review dates and explicit owner extension/pause/transfer.
- Require pairwise file/schema/test-fixture/external-system verdicts; “separate branch” is insufficient.
- Add a canonical-document reconciler after implementation phases; canonical docs are a serial seam.
- Make registry retirement reconcile manifests, branches, and worktrees without deleting them.

### Explicitly out of scope

This initiative does not implement a fix, apply SQL, create QA/provider/Figma accounts, rotate a
credential, inspect business rows or secrets, resolve owner/provider gates, merge historical work,
push/merge the Foundation commit, or declare audit findings remediated.
