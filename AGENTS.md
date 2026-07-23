# Codex Working Manual — UPR Platform

This file is the root entrypoint for OpenAI Codex and other agents that honor `AGENTS.md`.
It intentionally does **not** duplicate the project's changing schema, page inventory, or detailed
engineering laws.

## Authority and required reading

Before modifying this repository:

1. Read `CLAUDE.md` completely. Its non-negotiable rules and workflow apply to Codex too.
2. Read the `.claude/rules/` documents relevant to the files and behavior in scope.
3. Read the canonical domain document(s) listed under Repository knowledge below.
4. Use `UPR-Web-Context.md` for detailed schema/RPC/page/worker history and inventory.
5. Use focused references when applicable: `BILLING-CONTEXT.md`, the QBO guides,
   `UPR-Design-System.md`, `ENCIRCLE_API_REFERENCE.md`, and active initiative/ownership documents.
6. Treat `.claude/rules/` and `CLAUDE.md` as project law. This file adds Codex-specific routing.

If documents conflict, use this precedence:

1. Current user instruction.
2. Root `CLAUDE.md` non-negotiables and applicable `.claude/rules/`.
3. Current initiative roadmap/ownership manifest.
4. Canonical `docs/*.md` knowledge files and `UPR-Web-Context.md`.
5. Focused domain handoffs and active implementation references.
6. Older plans, archived audits, and dated reports.

Audit snapshots under `docs/audit/<year-month>/` are historical evidence, not current project law.

## Repository knowledge

Before making architectural or cross-cutting changes, read:

- `docs/architecture.md`
- `docs/database-schema.md`
- `docs/auth-and-authorization.md`
- `docs/business-rules.md`
- `docs/integrations.md`
- `docs/testing-and-deployment.md`

When a change alters architecture, schema, authorization, business rules, integrations, deployment,
or testing conventions, update the corresponding document in the same commit.

Do not infer production database behavior solely from TypeScript/generated types or client models.
Inspect migrations, SQL functions, triggers, policies, grants, callers, and live catalog state when
access is available.

Before database, authorization, public-form, signing or Storage work, also read the latest dated
live evidence at `docs/audit/2026-07/evidence/live-supabase.md`. Dated evidence is not guaranteed
current; recapture read-only when the decision depends on live state.

Do not duplicate business rules across UI, API, Edge Functions, and SQL without documenting the
enforcement boundary in `docs/business-rules.md`.

## Repository model

- Frontend: React/Vite SPA in `src/`.
- Backend: Cloudflare Pages Functions in `functions/api/` with shared code in `functions/lib/`.
- Database: one shared Supabase project, with migrations in `supabase/migrations/`.
- Native: Capacitor iOS project in `ios/`.
- Owner automation: separate Cloudflare MCP worker in `upr-mcp/`.
- Deployments: `dev` is staging and `main` is production, but both use the same Supabase database.

The shared database means every applied migration is a production change immediately. A frontend
branch, preview, or staging deploy does not create a staging database.

## Starting a task

1. Read the real files before proposing or editing code.
2. Check `git status --short --branch` and preserve unrelated user changes.
3. Search with `rg`/`rg --files`; do not rely on hand-copied file lists.
4. Identify every caller, route, RPC, table, worker, test, and rule affected by the requested
   behavior before editing.
5. Check active initiative ownership manifests before touching shared hotspots.
6. State assumptions when live configuration, third-party behavior, or current deployment state is
   not evidenced locally.

Do not infer that a UI role gate protects a worker or RPC. Trace the complete authorization path.

## Conversation boundaries

Continue in the current conversation while the same objective, implementation, verification, or
closely related decisions remain in progress, even when the conversation is long or compacted. At a
natural completed-task boundary, if the next request is independently scoped and accumulated
unrelated context is likely to reduce reliability, tell the user: “This is a good handoff point. I
recommend continuing in a new conversation.”

Do not recommend switching based on length or an estimated token percentage alone, and never
interrupt in-flight work merely to change conversations. First leave the repository in a known
state and provide a concise handoff: completed outcome, branch/commit and working-tree state,
changed files, verification performed, unresolved decisions or external gates, and a ready-to-use
opening prompt. The user makes the final decision.

## Implementation rules that frequently matter

- Components obtain `db` from `useAuth()`; follow the bootstrapping exceptions documented in
  `CLAUDE.md` rather than importing the anonymous singleton casually.
- UI feedback goes through `src/lib/toast.js`. Do not add browser `alert`, `confirm`, or `prompt`.
- Follow the established two-click destructive-action pattern.
- Mobile changes must respect the project's `max-width: 768px` rule and iOS safe areas.
- Reuse existing components, tokens, loaders, error states, query keys, and invalidation patterns.
- Preserve deployed frontend contracts when changing an RPC or worker response.
- Do not write trigger-owned billing columns directly.
- Do not create an alternate send path around SMS/email compliance gates.
- Do not expose service-role keys, OAuth secrets, private keys, credentials, or real test identities.
- Do not add an anonymous database grant unless it is explicitly permitted by the public allowlist
  and documented in the migration.
- Do not copy an existing `USING (true)`/`WITH CHECK (true)` policy as a default. Classify whether
  access is company-wide, role-, assignment-, owner- or organization-scoped.
- Never expose a free-form SQL RPC to browser roles. The `exec_read_sql` authenticated grant was
  contained on 2026-07-23; its service-only ACL is a standing regression boundary, not a precedent.

## Security review checklist

For every worker that returns non-public data or causes a side effect:

- Verify the Supabase session server-side.
- Resolve the employee when employee membership matters.
- Enforce the required role server-side for money, payroll, PII, campaigns, company messaging,
  credential management, and administrative actions.
- Treat a valid session as authentication only, not authorization.
- Use `functions/lib/auth.js`, `functions/lib/http.js`, `functions/lib/supabase.js`, and
  `functions/lib/worker-runs.js` instead of creating local substitutes.
- Apply timeouts to outbound requests.
- Use stable idempotency keys for money and external side effects.
- Verify webhook signatures before processing and claim/deduplicate events before acting.
- Avoid returning upstream secrets, raw credentials, internal stack traces, or unnecessary PII.

For Supabase work:

- Read `.claude/rules/database-standard.md` completely.
- Inspect real columns, signatures, policies, grants, callers, and current migration history.
- Remember that `SECURITY DEFINER` bypasses RLS and new functions may retain `EXECUTE TO PUBLIC`
  unless explicitly revoked.
- Add explicit `REVOKE` and least-privilege `GRANT` statements.
- Scope policies to tenant/owner/role when the data model supports it; `TO authenticated
  USING (true)` is authentication, not row-level authorization.
- Prefer `SECURITY INVOKER`; every necessary `SECURITY DEFINER` function has a written caller
  contract and validates it inside the trusted boundary.
- Preserve function signatures and return shapes used by deployed clients.
- Provide and review rollback instructions.
- Never apply a migration to the shared project unless the user asked for implementation and the
  required apply-window/verification workflow is satisfied.
- Apply only from a reviewed commit reachable from the designated release branch, or record and
  immediately reconcile an owner-authorized emergency exception.

## Testing and verification

Use verification proportional to risk, and report actual results rather than expected results.

Default code close-out:

```text
npm run build
npm test
npm run lint
```

Known audit caveats as of 2026-07-22:

- Default Vitest/ESLint discovery may descend into `.claude/worktrees`; exclude those paths when
  diagnosing the primary tree until checked-in configuration is corrected.
- Several Supabase integration tests still use the anonymous client even though the live database
  was tightened to `authenticated`; distinguish test-harness/auth drift from product regressions.
- Lint has a large non-blocking baseline. Do not introduce new violations, and lint changed files
  even when the full tree remains red.

Additional requirements:

- Add negative authorization tests for sensitive worker changes.
- Add idempotency and cent-rounding tests for money paths.
- Add consent, DND, STOP/START/HELP, quiet-hours, and retry tests for messaging changes.
- For migrations, run migration safety/anon-grant checks prescribed by project rules and verify the
  applied behavior against the intended role.
- For UI changes, follow the page close-out standard, including loading/error/empty states, mobile
  width, minimize/resume behavior, and targeted browser verification.
- Native changes require a real Xcode/on-device verification handoff when the current environment
  cannot compile or sign iOS code.

## Documentation duties

- Update the applicable canonical file under `docs/` when architecture, schema, authorization,
  business rules, integrations, testing, deployment, or release conventions change.
- Update `UPR-Web-Context.md` after changes to tables, RPCs, pages, components, workers, or major
  initiative state, as required by `CLAUDE.md`.
- Update the relevant domain/roadmap document when a decision or phase status changes.
- Regenerate files under `docs/generated/`; never hand-edit generated schema/RPC reports.
- Add the project documentation header to new or substantially edited files when required.
- Keep dated audit snapshots under `docs/audit/<year-month>/`. Do not silently rewrite a snapshot as
  though it observed later code; create a new snapshot or a clearly dated addendum.

## Git and deployment

- Follow the current branch/release workflow in `CLAUDE.md`; do not assume generic feature-branch or
  PR conventions override it.
- Never push directly to `main`.
- Do not create commits, push, open PRs, deploy, or apply shared-database migrations unless the user
  requested that delivery step.
- Keep commits small and intentional when commits are requested.
- Before reporting success, confirm the working tree, test/build results, migration apply state, and
  any owner-gated deployment or device checks.

## Areas requiring extra caution

- `src/lib/supabase.js`, `src/lib/realtime.js`, `src/contexts/AuthContext.jsx`, `src/App.jsx`, and
  shared layouts affect most of the application.
- Billing/QBO/Stripe code moves or represents real money.
- Twilio/Resend/campaign workers communicate as the company and carry consent obligations.
- Auth, RLS, Storage, public forms, e-signature tokens, and account deletion are security/privacy
  boundaries.
- The global stylesheet and several pages are very large; make narrow, pattern-preserving edits and
  avoid opportunistic rewrites.
- Cloudflare dashboard variables, Supabase live state, Apple signing, and third-party consoles are
  external state. Repository declarations are not proof that those systems are configured.

## Definition of done

A task is done only when:

- The requested behavior is implemented without unrelated changes.
- Authorization and compliance boundaries are enforced at the server/database layer, not only UI.
- Relevant unit/integration/negative tests exist and were run.
- Build and targeted lint results are known and honestly reported.
- Required documentation is updated.
- Shared database/deployment/device steps are either verified or explicitly identified as pending
  owner/external gates.
- No secret, destructive action, production migration, outbound message, or money movement occurred
  outside the user's authorization.
