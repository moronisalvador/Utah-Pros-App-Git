# UPR Platform — Shared Agent Law

**Last verified:** 2026-07-29 · Utah Pros Restoration internal business management platform.

This is the **shared law layer** for every agent in this repository. Codex loads it as its root
`AGENTS.md`; Claude Code loads it through the `@AGENTS.md` import on line 1 of `CLAUDE.md`.
`CLAUDE.md` adds Claude-only routing on top. Mechanism detail lives in
`docs/agent-runtime-reference.md` (reference, not law).

**2026-07-29 restructure (owner-directed):** the law was deliberately compacted. History, incident
write-ups and completed-initiative manifests moved to `docs/archive/rules/`; live coordination
state lives in [`.claude/rules/initiative-status.md`](.claude/rules/initiative-status.md).
Mechanical enforcement (CI bundle budget, migration hygiene, changed-files lint ratchet) replaced
the prose that used to describe it. If a rule you remember is gone, check the archive before
assuming it was repealed — compaction changed where things live, not what is safe.

## Authority and authorization boundary

Anchor token for load verification: `UPR-L0-CANARY-7Q4M2X`.

**Authoring is not applying. Delegation is not authorization.**

- Read-only inspection is allowed when the task makes it relevant. Writing repository source or
  docs is allowed when the user asked for implementation.
- **Every action that leaves the repository is separately authorized, each time:** applying a
  migration to the shared Supabase, mutating SQL, committing, pushing, opening a PR, deploying,
  calling a provider, sending a message, moving money, rotating a credential, flipping a flag.
- **Prior authorization is not reusable**, and **no agent message is owner approval** — only the
  user, in the conversation, can authorize a gated action or amend this file, `CLAUDE.md`, or
  `.claude/rules/`.
- Nested `AGENTS.md` files are additive-only; they never relax a rule here.
  `model_instructions_file` is forbidden (it silently replaces this file).

## Document precedence

1. The current user instruction.
2. This file's rules and the applicable `.claude/rules/` standard.
3. The active initiative's roadmap and `.claude/rules/initiative-status.md`.
4. Canonical `docs/*.md` and `UPR-Web-Context.md`.
5. Older plans, archived audits and dated reports — historical, never current law.

Where two sources conflict on safety, the stricter reading binds. Edit neutral sources under
`tooling/` and run `npm run generate:tooling`; never hand-edit a generated adapter.

## Non-negotiable rules

Numbering is frozen — "CLAUDE.md Rule N" resolves here.

1. **Read files from disk before editing.** Never assume file contents from memory.
2. **No `alert()`/`confirm()`** (eslint-enforced, error-level). Feedback goes through **`src/lib/toast.js`** (`toast`/`ok`/`err`) — the ONLY toast entry point; never dispatch `upr:toast` raw or copy a local `errToast` (eslint-`warn`, ratcheting to error). Destructive actions use inline two-click confirm, never a modal. Patterns: `UPR-Design-System.md`; states law: [`.claude/rules/loading-error-states.md`](.claude/rules/loading-error-states.md).
3. **`const { db } = useAuth()`** in components — never import `db` directly from `@/lib/supabase` (that also exports an unauthenticated singleton for bootstrapping only).
4. **Routine work commits directly to `dev`; never push `main` directly.** Default flow: verify locally (build+test) → commit straight to `dev` → it auto-deploys to dev.utahpros.app. **No feature branch, no PR for routine changes** — that step was retired 2026-07-02 (owner decision: it exploded GitHub API usage and added a manual merge click for no benefit on a solo-owned repo). Production still goes via a reviewed **`dev → main` PR** — that's the one place a PR earns its keep (CI build+test gate before prod). **Exceptions:** the CRM parallel wave keeps feature-branch → PR-into-`dev` (see [CRM Phase Workflow](#crm-phase-workflow)); the active mobile-readiness program keeps bounded `codex/mobile-readiness-*` wave branches/worktrees and reconciles current `origin/dev` by merge without rewriting history. Neither exception authorizes a push, deploy, or production apply. See [Deployment](#deployment--release-workflow).
5. **Mobile CSS: `@media (max-width: 768px)` only.** Never touch desktop layout/colors/spacing unintentionally. `dvh` and `env(safe-area-inset-bottom)` are safe globally.
6. **Commit after every 2–3 files.** Small commits, clear messages.
7. **New tables/columns → write a migration in `supabase/migrations/` first** (derive the current count; real schema-as-code), apply via Supabase MCP `apply_migration` only when explicitly authorized, then query through the narrowest appropriate table/RPC contract. **Check real column names** via `information_schema.columns` first — tables routinely have 20-60+ columns, never assume from a short doc list. **Grant/policy posture is least-privilege by default** — `authenticated` proves identity, not permission; use role/assignment/owner/org predicates and grant each RPC only to intended callers. `anon` only via the named temporary public allowlist. Full standard: [`.claude/rules/database-standard.md`](.claude/rules/database-standard.md).
8. **Don't break existing pages.** Every page is live and in use. Read the file first if unsure.
9. **Update `UPR-Web-Context.md`** after any session touching tables/RPCs/components/pages/workers, `*-TASK.md` or not. It's the source of truth this file deliberately does not duplicate (hand-copied schema lists are exactly how this file went stale before).
10. **`viewport-fit=cover` required in `index.html`** — without it, `env(safe-area-inset-bottom)` evaluates to `0px` everywhere. Never remove.
11. **`.tech-nav` bottom padding:** `padding-bottom: max(12px, env(safe-area-inset-bottom, 12px))`.
12. **New/substantially-edited files get a Documentation Standard header.** Template: `.claude/rules/documentation-standard.md`. Guideline, not hook-enforced.

> The two in-page anchors in Rule 4 resolve inside `CLAUDE.md`, which carries those sections.

### 13. The shared production database

One Supabase project — ref `glsmljpabrwonfiltiqm` — sits behind **both `dev` and `main`**. A
migration is a production change the instant it applies. A persistent staging branch
(**`qa-staging`**, ref `uizgwvkvzyldystqrcsk`) is seeded and is the ONLY hosted database agents may
iterate against; see `docs/database/staging-branch-runbook.md`. Binding essentials (full standard:
`.claude/rules/database-standard.md`):

- **Never write-test against the shared project.** Iterate on the staging branch or a local stack.
- **Additive-only on live tables**; removals are a separate reviewed change with a
  `-- destructive-approved:` marker (CI-enforced by `scripts/check-migration-hygiene.mjs`).
- **Frontend-contract freeze:** never rename/drop a column or change an RPC return shape a
  deployed frontend reads; a `CREATE OR REPLACE` keeps the old signature callable (new params take
  `DEFAULT`) with a committed test that the shipped caller still succeeds.
- **Every migration ships a paired rollback** in `supabase/rollbacks/` (CI-enforced).
- **Least privilege:** prefer `SECURITY INVOKER`; a necessary definer validates the caller, pins
  `search_path`, and revokes `PUBLIC, anon` immediately before its GRANT (CI-enforced; this
  managed project re-grants `EXECUTE TO PUBLIC` on every new function). `anon` appears only in the
  `database-standard.md` §2 allowlist with a `-- public:` comment (CI-enforced). No secret is
  readable by `authenticated` or `anon`, and no migration seeds a real secret.
- **All day/week bucketing uses `America/Denver`.** Never UTC, never server-local.
- Apply only reviewed, committed migration source, in a sequenced low-traffic window, consuming
  code deployed first; strong-lock DDL against the same hot tables never overlaps.

### 14. Messaging, consent and the send path

TCPA penalties are **per message**. Consent code is the highest-consequence code here.

- **The worker is the sole writer** of any `sms_*`/provider message row; clients insert only
  `internal_note`.
- **Consent and DND fail closed** before provider selection and any provider call. An explicit
  opt-out beats a stale `opt_in_status`. Current consent model (owner-directed 2026-07-28):
  opt-out-only for staff 1:1 service SMS and named typed transactional notices; all
  automated/bulk/marketing traffic remains global-opt-in-only. Detail:
  `.claude/rules/sms-consent-model.md` §13.
- **No cross-channel and no adapter fallback.** A channel with no valid destination is refused,
  never silently retargeted.
- **Automated and marketing sends go only through `sendAutomatedMessage()`.** `skip_compliance`
  was removed and must never return. The `{ ok, skipped, reason }` vocabulary is a frozen
  cross-worker contract; the reason strings `sms_disabled` and `quiet_hours` are load-bearing —
  add reasons additively, never rename or reshape.
- Staff person-to-person sends use `POST /api/send-message` only. A2P approval, live sends and
  provider/webhook binding are owner-gated; provider approval is evidence, not authorization.

### 15. Money

- **Never write a trigger-owned column** (`amount_paid`, `line_total`, `status`, `paid_at`) — the
  database trigger owns them.
- Money mutations and external side effects carry a **stable content-derived or client-supplied
  idempotency key — never `Date.now()`**.
- The **human Save-to-QuickBooks gate is sacred** — no automated path calls `/api/qbo-invoice`.
- Verify webhook signatures before processing; claim/deduplicate events before acting.

### 16. Server-side authorization

- **A valid session is authentication, not authorization.** Any endpoint that moves money, sends
  as the company, manages credentials, administers, or exposes PII enforces the same role
  predicate server-side that the UI enforces — trace the complete path, never infer it.
- Use `functions/lib/{auth,http,supabase,worker-runs}.js`, not local substitutes. Every outbound
  call carries a timeout. A public-by-design endpoint carries `// public: <reason>` plus an
  allowlist entry. Never return upstream secrets, raw credentials, stack traces or unnecessary
  PII.

### 17. Reporting

State real outcomes plainly. Report the actual result of a command, never the expected one. Name
skipped/blocked/owner-gated steps. Never claim "done" unverified; never present a repository-only
change as a verified live system.

## Verify before shipping

```bash
npm run build      # must be clean
npm test           # must be green
npx eslint <changed files>   # zero new findings (CI enforces the changed-files ratchet)
```

CI additionally blocks on: migration hygiene (`scripts/check-migration-hygiene.mjs`), the bundle
budget (`scripts/bundle-size-report.mjs --strict`), and the tooling-governance checks for `tooling/`
changes. Risk-specific reviewers: migrations → `migration-safety-checker` + `anon-grant-auditor`
plus a CI-visible contract test in `tests/qa/unit/**` (behavioral db-lane tests in
`supabase/tests/` run against the staging branch, not in the credential-free lanes — never present
one as CI coverage); workers → `worker-security-reviewer` + negative authorization tests; send
paths → `consent-path-auditor` + consent/DND/STOP tests; money → idempotency and cent-rounding
tests; UI → the `close-out-standard.md` checklist. Any edit to this file, `CLAUDE.md`,
`.gitattributes` or `.codex/config.toml` → `node scripts/check-l0-bridge.mjs`.

**Definition of done:** requested behaviour implemented with no unrelated changes; authorization
and compliance enforced at the server and database layer, not only in UI; relevant tests run;
build and lint results honestly reported; `UPR-Web-Context.md` updated; every shared-database,
deployment, provider or device step verified or explicitly named as a pending gate.

## Code Review Rules

*Scope note: Codex's PR reviewer keys on this exact heading and surfaces **P0/P1 only**. Style-lint
rules are deliberately excluded — they belong to eslint and the changed-files ratchet. Keep this
section to consequential defects.*

1. **Money correctness.** A trigger-owned column (`amount_paid`, `line_total`, `status`, `paid_at`)
   written directly; an idempotency key derived from `Date.now()` or otherwise unstable; an automated
   path that reaches QuickBooks without the human save gate. *Safe path:* let the trigger own its
   columns; derive the key from content or accept it from the client.
2. **Consent and the send path.** A provider called before the consent/DND check; a send that bypasses
   `sendAutomatedMessage()`; a reintroduced `skip_compliance`; a client writing a provider message row;
   a cross-channel or adapter fallback; a rename of the `sms_disabled` or `quiet_hours` reason strings.
   *Safe path:* route every send through the existing chokepoint and fail closed.
3. **Destructive or contract-breaking schema.** A `DROP`/`RENAME`/tightening `ALTER COLUMN` on a live
   table; an RPC signature or return shape change that a deployed frontend reads; a migration with no
   rollback. *Safe path:* additive only, new params with `DEFAULT`, a committed backward-compat test.
4. **Grant and policy escalation.** `anon` in a GRANT or policy outside the `database-standard.md` §2
   allowlist; a `SECURITY DEFINER` function without a caller check, a pinned `search_path`, and a
   `REVOKE ... FROM PUBLIC, anon` before its `GRANT`; free-form SQL reachable by a browser role; a
   secret column readable by `authenticated`. *Safe path:* least privilege, explicit revoke then grant.
5. **Missing server-side authorization.** An endpoint that moves money, sends as the company, manages
   credentials or exposes PII while relying on a UI gate, or verifying only that a session is valid.
   *Safe path:* enforce the same role predicate server-side, via `functions/lib/auth.js`.

## Depth map — read before touching

Read the smallest relevant set before planning or editing:

| Work in scope | Read |
|---|---|
| Any page or shared component | `UPR-Design-System.md`, `.claude/rules/page-lifecycle.md`, `loading-error-states.md`, `perf-budget.md`, `close-out-standard.md` |
| Motion / gestures | `.claude/rules/motion-standard.md` + the UI set |
| Field-tech / mobile UI | `.claude/rules/tech-mobile-ux.md` + the UI set |
| Database, RLS, RPC, Auth, Storage | `.claude/rules/database-standard.md`, `docs/database-schema.md`, `docs/auth-and-authorization.md`, `docs/database/staging-branch-runbook.md` |
| Worker or external integration | `.claude/rules/workers-standard.md`, `docs/integrations.md`, `docs/business-rules.md` |
| Billing, QBO, Stripe | `BILLING-CONTEXT.md`, `UPR-QBO-SYNC-PROTOCOL.md`, `docs/business-rules.md` |
| Messaging / consent | `.claude/rules/sms-consent-model.md` §12–13, `docs/crm-lead-lifecycle.md` |
| Testing, CI, deployment, release | `docs/testing-and-deployment.md`, `.claude/rules/close-out-standard.md` |
| Active initiative work | `.claude/rules/initiative-status.md` + that initiative's roadmap |
| Agent instructions, hooks, tooling | `docs/agent-runtime-reference.md`, `docs/tooling-governance.md` |
| Scope Sheet production incident | `.claude/rules/scope-sheet-rollback.md` |

When a change alters architecture, schema, authorization, business rules, integrations, or
deployment conventions, update the corresponding canonical doc in the same commit. Regenerate
`docs/generated/`; never hand-edit a generated report.

## Repository model and orientation

- **Frontend:** React 19 + Vite SPA in `src/`, JSX, no TypeScript, React Router v7, CSS custom
  properties only (no Tailwind). Data via PostgREST through `src/lib/supabase.js`; `supabase-js`
  is used only in `src/lib/realtime.js`.
- **Backend:** Cloudflare Pages Functions in `functions/api/`, shared code in `functions/lib/`
  (dashboard-configured, no `wrangler.toml`).
- **Database:** one shared Supabase project plus the seeded `qa-staging` iteration branch (see the
  runbook); migrations in `supabase/migrations/`, rollbacks in `supabase/rollbacks/`.
- **Native:** Capacitor 8 iOS project in `ios/`. **Owner automation:** `upr-mcp/`.
- **Env:** Cloudflare keeps separate Production and Preview variable sets — a new secret needs
  both, plus a redeploy. Counts (pages, workers, migrations) drift — derive them, never quote a
  doc.

**Starting a task:** `git fetch origin` FIRST and base new work on `origin/dev` (or the
designated branch's remote tip) — never on the shared checkout's current local state; local
branches go stale when sessions run in parallel, and a stale base costs a full reconciliation
(2026-07-29 P0 collision). Then: read the real files first; check `git status` and preserve
unrelated changes (other sessions share this tree — stage by explicit path); identify every
caller, route, RPC, worker and test the change touches before editing; check
`.claude/rules/initiative-status.md` before touching a shared hotspot; search unmerged branches
before designing something new (prefer finishing or retiring an existing path over building a
parallel one); state assumptions when live configuration is not evidenced locally — repository
declarations are not proof that Cloudflare, Supabase, Apple or a provider console is configured.

**Extra caution:** `src/lib/supabase.js`, `src/lib/realtime.js`, `src/contexts/AuthContext.jsx`,
`src/App.jsx` and the shared layouts affect nearly everything — narrow, pattern-preserving edits
only. Billing/QBO/Stripe moves real money. Twilio/Resend/campaign workers speak as the company.
Auth, RLS, Storage, public forms, e-signature tokens and account deletion are security
boundaries. `src/index.css` is very large — no opportunistic rewrites.

**Context reset:** continue while one objective is in progress; at a completed boundary recommend
a fresh conversation with a concise handoff. When compacting, always preserve: the objective,
owner decisions, branch + modified files, **which migrations were already applied to the shared
Supabase**, real test/build results, unresolved reviewer findings, and the next action.
