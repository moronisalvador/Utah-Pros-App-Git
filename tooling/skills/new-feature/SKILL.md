---
name: new-feature
description: Implement a non-trivial ordinary UPR feature or behavior change using repository-law discovery, risk-based tests and reviewers, contract preservation, and honest verification. Use for scoped implementation work that is not primarily an initiative plan, a database migration, or an active CRM roadmap phase. Planning, authoring, database apply, publication, deployment, outbound communication, and money movement remain separately authorized actions.
---

# New UPR feature

Use this workflow for an ordinary feature implementation. It is a dispatcher, not a substitute for
project law or a grant of authority.

## 1. Confirm the lane and authority

Read `AGENTS.md`, `CLAUDE.md`, `docs/tooling-governance.md`, and the applicable
`.claude/rules/` files before editing. Current user instructions define the objective and authorized
actions; project law defines how the work is performed.

Route instead of duplicating another dispatcher:

- planning a multi-session or cross-cutting initiative → `masterplan`;
- schema, RPC, policy, grant, constraint, index, or data-repair work as the primary deliverable →
  `db-migration`;
- an active phase governed by `docs/crm-roadmap.md` and its ownership manifest →
  `new-crm-module`;
- otherwise continue here, invoking specialist skills only for their bounded domain.

For a new page/surface, substantial component or interaction change, responsive/native adaptation,
or reusable interface primitive, use `upr-interface-craft` as the supporting UI specialist. It does
not replace this dispatcher. Trivial copy, icon, or established-token corrections do not load the
design suite.

Planning, repository authoring, live database apply, provider mutation, commit, push, PR, deploy,
outbound communication, and money movement are distinct actions. Do only the actions the user
actually requested.

## 2. Establish current truth before changing code

1. Run `git status --short --branch`. Preserve unrelated edits and untracked work.
2. Read the real target files and search every affected caller, route, RPC, table, worker, test,
   query key, feature flag, and shared helper.
3. Check active roadmap and ownership manifests plus `docs/upr-unfinished-work-registry.md` when the
   surface belongs to an existing initiative. Respect leases and frozen files.
4. Read the canonical documents that match the change:
   - architecture or cross-layer boundaries → `docs/architecture.md`;
   - schema/RPC/Storage → `docs/database-schema.md`;
   - identity, roles, policies, or worker gates → `docs/auth-and-authorization.md`;
   - calculations, states, workflow, consent, or ownership → `docs/business-rules.md`;
   - third-party/provider behavior → `docs/integrations.md`;
   - tests, rollout, flags, or release → `docs/testing-and-deployment.md`;
   - detailed inventory/history → `UPR-Web-Context.md`;
   - UI → `upr-interface-craft`, `UPR-Design-System.md`, and the applicable lifecycle, loading,
     mobile, performance, and motion standards.
5. Inspect live or provider state read-only only when the decision depends on it and access is
   available. Label unavailable evidence `UNKNOWN`; never upgrade a document, type, test double, or
   prior audit into proof of current live behavior.

State the acceptance criteria, non-goals, contracts that must remain compatible, and any external
or owner gate before implementation.

## 3. Classify risk and select the required path

Use every applicable row:

| Surface | Required treatment |
|---|---|
| UI/page/component | Reuse primitives/tokens; cover loading, error, empty, stale-data, mutation, mobile, focus, minimize/resume, and reduced-motion behavior. |
| Worker/auth/PII/admin | Follow `.claude/rules/workers-standard.md`; verify session, employee membership when relevant, and server-side role/capability. Add denial tests. |
| Database/Storage/public form/signing | Route the database portion through `db-migration`; read current live evidence when it affects the decision; preserve deployed contracts. |
| Money/payroll/QBO/Stripe | Read focused billing guides; test cent rounding, idempotency, concurrency, recovery, and negative authorization. Never move money as test setup. |
| SMS/email/campaign/automation | Preserve the structurally enforced consent path; test consent, DND, STOP/START/HELP, quiet hours, retry, and role denial as applicable. |
| External provider/webhook | Verify configuration assumptions separately; add timeout, signature, deduplication, idempotency, redaction, and failure-path coverage. |
| Native/Capacitor | Preserve web behavior; document the Xcode, signing, hardware, or on-device verification gate when it cannot run locally. |

A valid session is authentication, not authorization. UI visibility is never the only control for
non-public data, money, company messaging, credentials, or administrative side effects.

## 4. Design the smallest complete change

- Prefer the established component, hook, worker library, query key, mutation path, and error state.
- Identify the enforcement boundary for each business rule; do not create competing UI, Worker, and
  SQL implementations without documenting which layer owns enforcement.
- Keep deployed RPC and Worker response contracts backward compatible.
- Avoid opportunistic rewrites and unrelated cleanup.
- If discovery shows the request is materially larger, contested across owners, or requires a new
  architecture decision, pause implementation and produce a `masterplan` recommendation.

## 5. Test first where behavior can regress

Write or identify the test that proves each acceptance criterion before changing the implementation.
Use the narrowest truthful lane:

- pure behavior → unit test;
- Worker contract/auth/side effect → Worker test with negative cases;
- database behavior → migration/SQL test in an authorized isolated environment;
- page lifecycle or interaction → component/browser test;
- provider/native behavior → local contract tests plus an explicit external verification gate.

Never point write-capable tests at the shared Supabase project. A skipped credential-dependent test
is not proof. Do not weaken a valid test merely to make it pass.

## 6. Implement and verify incrementally

Follow the applicable standards while editing. Components obtain `db` through `useAuth()`. Toasts
go through `src/lib/toast.js`. Destructive UI uses the established two-click confirmation pattern.
Use shared Worker helpers, timeouts, stable idempotency keys, and fail-closed authorization.

After implementation:

1. Run targeted tests for the changed behavior.
2. Run targeted lint on changed code and record any baseline distinction.
3. Run the repository close-out commands required by `AGENTS.md` and
   `.claude/rules/close-out-standard.md`.
4. For UI, perform the required browser widths and lifecycle checks when the environment supports
   them; distinguish source inspection from rendered proof.
5. Report repository, isolated-test, shared-database, deployed-runtime, provider, and device evidence
   as separate verification layers.

## 7. Run reviewers selected by changed surfaces

- any `src/` change: `upr-pattern-checker`, `design-consistency-checker`, and
  `page-behavior-checker`;
- any changed page/shared component: `interface-accessibility-reviewer`;
- meaningful motion change: `review-animations`;
- migration/RLS/grant/Storage authorization: `migration-safety-checker` and
  `anon-grant-auditor`;
- Worker returning non-public data or causing side effects: `worker-security-reviewer`;
- automated or marketing SMS/email path: `consent-path-auditor`;
- active initiative phase: its named phase reviewer.

Reviewer outcomes are blocking where `docs/tooling-governance.md` or the applicable standard says
they are. Fix findings or report the unresolved blocker; do not silently waive them.

## 8. Close out without overstating completion

Update every canonical document whose governed facts changed, plus `UPR-Web-Context.md` for changed
tables, RPCs, pages, components, Workers, or major initiative state. Reconcile the active roadmap,
ownership manifest, and unfinished-work registry when their state changed.

Finish with:

- behavior delivered and files changed;
- tests, lint, build, reviewers, and rendered checks actually run;
- migration apply, deployment, provider, credential, and device status;
- remaining owner/external gates and rollback;
- current branch and working-tree state.

Commit, push, PR, deploy, migration apply, feature-flag activation, provider mutation, outbound
communication, and money movement occur only when explicitly requested.
