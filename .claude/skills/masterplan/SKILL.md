---
name: masterplan
description: Dispatcher for an explicitly requested UPR initiative plan or /masterplan invocation. Produces an evidence-backed plan and challenge report; repository writes, live seed/apply actions, commit, push, PR, and deploy remain separate owner-authorized steps.
---

# masterplan

You are running a PLANNING session, not a build session. The deliverable is an
adversarially-reviewed plan of record proposal (roadmap section, dispatch blocks, optional seeds,
agents) — zero feature code. Work read-only until the owner explicitly approves repository writes;
live database work and publication require separate approval. Best run as: fresh session, strongest available
model, high effort, plan mode on, "ultracode" included in the invocation — the
challenge pass (section 5) fans out many agents.

**Delegation vocabulary (used throughout):** "fan out" = spawn parallel READ-ONLY
subagents. Use the Workflow orchestration tool when available (ultracode sessions);
otherwise launch parallel Explore-type subagents via the Agent/Task tool. Same intent
either way: many independent read-only investigators, results structured back to you.
**Model routing for fan-outs:** inventory / localization / "where is X, who calls Y"
investigators use the `upr-scout` agent type (Haiku — a subagent with no model set
inherits the expensive session model, which mechanical searching doesn't need).
Reserve session-model/Opus agents for judgment work: the challenge pass, counter-
ordering, security/money review, and acceptance grading.

**Calibration:** the worked example of this entire standard is the "Roadmap v3"
section of `docs/crm-roadmap.md` plus `docs/crm-dispatch.md` — skim both first to see
what "done" looks like.

**Setup:** the initiative is whatever follows `/masterplan`. If genuinely ambiguous
(which surface, for whom, replace vs extend), ask 2-3 sharp questions first — then
proceed without check-ins until the plan is presented. Pick a short kebab-case slug
once (e.g. `sched-board`) and use it consistently for `docs/<slug>-roadmap.md`,
`docs/<slug>-dispatch.md`, and `.claude/rules/<slug>-wave-ownership.md`.

## 1. Read scope, then verify the ACTUAL state — never trust docs or memory

- Read `CLAUDE.md` and the domain doc for the surface (`UPR-Web-Context.md`
  schema/RPCs; `BILLING-CONTEXT.md` money/QBO; `UPR-Design-System.md` UI;
  `EMAIL-DELIVERABILITY.md` sends; if the surface has no dedicated doc, default to
  `UPR-Web-Context.md` + `UPR-Design-System.md`), plus any existing
  `docs/*-roadmap.md` touching it.
- Verify live via Supabase MCP (`information_schema.columns`, `pg_tables` +
  `pg_policies` for RLS posture, `pg_get_functiondef` for RPCs — some live functions
  are NOT in `supabase/migrations/`; that schema drift is itself a finding) and via
  real file reads. If the initiative has a live progress tracker (CRM:
  `crm_build_phases`/`crm_build_stages`), statuses come from IT, "not assumed from
  the doc"; otherwise from the roadmap doc's checklists.
- **Verify platform/external facts against CURRENT sources, not training memory.** When the initiative
  depends on how a platform or third party behaves (iOS/Safari PWA lifecycle, a browser API, a
  Twilio/QBO/Stripe/Encircle capability or limit), confirm it via web research (WebSearch/WebFetch) and
  cite it in the plan. Training data goes stale; a 2026-07 example: the iOS-26/27 PWA resume behavior
  materially changed a design and was confirmed live, not assumed.
- Fan out the broad inventories (frontend, backend/schema, docs/conventions) — keep
  this session's context for judgment.
- Produce a **finish-first list**: everything open in in-flight work, as concrete
  stages with acceptance criteria, BEFORE proposing anything new. Disclose stale
  checkbox states (shipped-but-unticked, done-looking-but-todo) — never silently flip.

## 2. Gap audit against a capability taxonomy

- Use the owner's taxonomy if given; otherwise construct one for the domain (grouped
  capability areas A/B/C…) and say so.
- Every row gets a verdict — **HAVE / PARTIAL / MISSING** (compounds like
  "PARTIAL + P0 bug" or "wired, unverified" allowed) — with concrete evidence:
  `file:line`, RPC/table name, or live-query result. **HAVE only from code/schema,
  never from docs.**
- Any bug found: write a numbered severity finding (mechanism + root cause),
  **quantify real exposure with a live query**, give interim operating guidance until
  the fix lands, and slot the fix into the earliest phase (or flag it as a standalone
  hotfix with its own dispatch block).

## 3. Design the phases

- Group MISSING/PARTIAL into phases sized for **one focused session each** (a phase
  ≈ 1 table-group + 1 worker + 1 screen; 3× that is a scope defect — split it).
  ROI-order for the business, not feature-count.
- Every phase block uses the standard schema: `### Phase X — Title` + blockquote
  (**Branch** (session-assigned; illustrative name) / **Prerequisite** / **Model ·
  effort** / **Read scope**) + checkbox **Close-out checklist** (named test-first
  targets → acceptance criteria → `npm run test` + `build` + eslint → reviewer-agent
  gauntlet → **the `.claude/rules/close-out-standard.md` checks: minimize/resume test, 390px
  mobile check on any touched page, loading/empty/error states forced, perf delta** →
  `UPR-Web-Context.md` → set-status + reconcile + test-data cleanup + push/PR) + one-line
  **Scope** naming owned files and fillable RPC bodies.
- **Model/effort logic:** Opus·high for money math, consent/compliance, live-RPC
  replaces, public unauthenticated surfaces; Opus·medium for data-integrity CRUD;
  Sonnet·medium for verification/close-out and mechanical scaffolding. State which
  and why per phase.
- Explicit **out-of-scope list**. Contested build-vs-buy / replace-vs-keep calls get
  an **options-on-record evaluation** (alternatives, trade-offs, firm recommendation,
  the caveat under which the cheaper option wins). Undecided owner calls become
  **decision forks** encoded in the work ("if X, close stage as superseded; default =
  verify anyway") so sessions proceed deterministically either way.
- External dependencies (carrier approvals, tokens, credentials) are **hard gates —
  "do not launch on hope"**, and the gated session must not build or test the gated
  live path until the gate is confirmed. They get an anytime lane, not a wave slot.

## 4. Restructure for maximum parallelism (Foundation → one wave)

- Extract every shared dependency into **Phase F — Foundation** (one Opus·high
  session): 100% of the wave's SCHEMA (tables/columns/policies/indexes — wave
  sessions ship ZERO schema); the only shared live-RPC REPLACEs (each
  backward-compatible: new params DEFAULT, committed test that the shipped caller
  still succeeds — one shared Supabase means a replace is live in production the
  moment it applies); **signature-frozen stubs** for every phase-private RPC
  (SECURITY DEFINER + GRANT, body RAISE 'not implemented'; signatures are contracts —
  changing one post-F is forbidden, `migration-safety-checker` enforces); shared
  helpers extracted once with tests; shared UI extracted behavior-identical;
  **the design seam** — Foundation owns/extends the shared UI primitives (Modal, StatusPill,
  EmptyState, ErrorState, PageHeader, form fields, the resume/lookup hooks) + the semantic design
  tokens the wave consumes, the SAME way it owns 100% of schema; wave sessions IMPORT them and never
  hand-roll a variant (this makes "no manual UX/UI cleanup" structural, not hoped-for);
  **slot components** so two phases never co-edit a page; ALL wiring (routes via a
  stub-page pattern, nav, icons, reserved css section markers per phase); and the
  **ownership manifest** `.claude/rules/<slug>-wave-ownership.md` (Session → files
  owned exclusively → RPC bodies it fills, plus the frozen-file list nobody edits
  in-wave; shared log tables get DATA writes only).
- Wave sessions may ship **function-body-only** `CREATE OR REPLACE` migrations for
  their OWN frozen stubs — the standing amendment to "zero migrations" (a literal
  rule would force Foundation to build the whole backend serially without per-phase
  test-first). Any further rule you bend gets **rule-amendment transparency**: state
  the original, the amendment, the rationale.
- Where Foundation can pre-build a gated capability behind a default-OFF kill-switch
  (e.g. a send path behind an `automation_settings` flag), do it — it dissolves
  serial constraints between phases that would otherwise edit the same seam.
- **Dispatch model:** Wave 0 = Foundation PLUS any phase that consumes nothing from
  it (verification/close-out work runs beside F, not behind it). Wave 1 = everything
  else in parallel once F merges. **Merge order within a wave is a preference, never
  a gate** — each PR is independent, and how many sessions run at once is purely the
  owner's review-bandwidth choice ("throttle freely"). The dependency graph names its
  edge types: hard artifact edges, independent, externally-gated, soft
  verification-tails, and future/unscheduled.
- Cross-phase consumptions that survive become **disclosed verification tails**
  (build against frozen signatures + directly-inserted TEST rows; the E2E check runs
  after the other phase merges — said in the PR, never faked).
- Close with the honest **"what resisted maximum parallelism"** ledger: every rule
  bent, dependency softened, external gate, protocol-fragile pair (with its
  fallback-to-serial), risk accepted by owner directive, and Foundation-as-single-
  point-of-failure priced in via the reviewer gauntlet.

## 5. Adversarial challenge pass (mandatory — never present an unchallenged plan)

Fan out read-only agents against the designed structure:
1. **Refute-first re-verification** of the ~5 least-certain HAVE/PARTIAL verdicts —
   fresh file/DB reads, prompted to REFUTE, structured verdict
   CONFIRMED/REFUTED/MODIFIED + plan impact.
2. **Disjointness proofs** for every pair of phases the wave runs in parallel:
   enumerate the exact tables and files each touches; hunt hidden shared artifacts
   (icon modules, shared css, shared libs, RPCs two phases would edit, shared-DB
   signature hazards). Can't prove disjoint → mark serial, split the phase, or move
   the seam into Foundation.
3. **Counter-ordering**: one skeptical Opus-tier agent argues the strongest case for
   a DIFFERENT priority ordering (for CRM initiatives the `crm-phase-reviewer` agent
   type fits; otherwise a general-purpose agent prompted as a skeptical
   acceptance-grader), then adjudicate and record which ordering survived and why.
Fold every outcome back into sections 2-4 and **report what changed** — demoted
verdicts, new serial constraints, reordered waves. The challenge runs BEFORE anything
is committed or seeded.

## 6. Present, then WAIT

Present the plan + the challenge report ("what changed"). **Write nothing until the owner approves
repository authoring.** That approval does not authorize live database changes or publication.

## 7. On authoring approval — prepare the plan of record (docs and agents; no feature code)

1. Preserve the current worktree/branch unless the owner separately requests a branch action.
2. **Roadmap doc**: append a dated, versioned section to `docs/<slug>-roadmap.md`
   (create it if new): status-reconciliation table + stale-todo disclosures, severity
   findings with exposure + interim guidance, gap-audit appendix (evidence table,
   Challenge-CONFIRMED markers on adversarially-survived claims), all phase blocks,
   dependency graph (ASCII, edge types named), dispatch model (waves, merge-order-is-
   preference, throttle note, owner pre-decisions), ownership matrix + frozen list +
   amended migration rule, what-resisted ledger, options-on-record evaluations.
   Supersede outdated rules in place (strike + pointer) — don't rewrite history.
3. **Seed progress tracking**: CRM-side initiatives seed `crm_build_phases` /
   `crm_build_stages` idempotently (`ON CONFLICT (phase_key) DO NOTHING` /
   `ON CONFLICT (phase_key, title) DO NOTHING`; never touch existing rows; text
   phase_keys; status changes only ever via `set_crm_phase_status` /
   `set_crm_stage_status`; progress surfaces on /crm/roadmap + public /status via
   `get_crm_build_progress()`). Non-CRM initiatives: no generic tracker exists —
   track via the roadmap doc's checklists, or propose cloning the tracker pattern as
   explicit owner-approved scope; never bolt onto the CRM tracker.
4. **Dispatch doc** `docs/<slug>-dispatch.md`: a Preconditions preamble (which PR
   unlocks each wave + owner pre-decisions due, each tied to the session it forks),
   then one code-fenced copy-paste block per session — settings header
   (`[Session <letter> — Wave <n>]` / Branch / Model / Effort / Launch after) +
   a COMPLETE cold-session prompt: role + "one phase only, no scope creep", read
   scope (CLAUDE.md + its phase block + the ownership manifest), branch instruction,
   "Foundation shipped" recap, hard constraints (zero schema, frozen files, reserved
   css section, call-only send paths where relevant), ordered build list (riskiest
   first — e.g. data-integrity migrations before UI), named test-first targets, and
   the full close-out. Each wave session's close-out states that commit/push/PR happen only when
   that delivery is explicitly authorized; when authorized, it opens a **PR into `dev`
   as a handoff and stops** — the owner/orchestrator merges it; sessions never
   click-merge, subscribe to, babysit, or wait for a review on a PR (bot reviewer off).
   No block may reference any conversation. Blocks that cite Foundation's artifact names
   note the manifest + phase block are authoritative if names drift. State per wave that
   its sessions may launch simultaneously. **Base-preflight (mandatory in the dispatch
   preamble):** verify that the assigned worktree is based on the designated release branch and
   that the plan-of-record files are on disk. If missing, stop and request resynchronization; do not
   run a branch-reset recipe or recreate the plan without explicit authorization.
5. **Agents**: reuse the existing roster in `.claude/agents/` (`ls` it — currently
   `upr-pattern-checker`, `design-consistency-checker`, `page-behavior-checker`,
   `migration-safety-checker`, `anon-grant-auditor`, `consent-path-auditor`, and the per-initiative
   phase-reviewers). Any wave phase touching `src/pages`|`src/components` runs the **3-agent UI
   gauntlet** (`upr-pattern-checker` + `design-consistency-checker` + `page-behavior-checker`) per
   `.claude/rules/close-out-standard.md`. Create a new agent ONLY for a
   job recurring across 3+ phases (frontmatter name/description/tools/model;
   read-only tools + sonnet for checkers, opus for judgment graders; body = ground
   truth, procedure, classification taxonomy, output format).
6. **CLAUDE.md**: amend the relevant workflow section only if the initiative changes
   standing rules; otherwise leave it.
7. **`UPR-Web-Context.md`** (Rule 9): session entry — what shipped, key findings,
   dispatch summary.
8. Verify: `npm run test` + `npm run build` green; eslint n/a if no JS changed (say
   so). A proposed seed remains an authored migration unless the owner separately authorizes its
   live apply; if authorized, follow `database-standard.md` §0/§5 and re-query. Run
   `upr-pattern-checker` on changed files.
9. Stop with a diff and verification report unless publication was separately requested. If it was,
   follow the current `CLAUDE.md` routine-versus-wave delivery path. Never push `main` directly.
10. **Final message = the Wave 0 dispatch blocks verbatim** + the wave table, so the
    owner can launch immediately.

## Standing guardrails (bind every phase whose surface they touch — carry them into the blocks)

- **Frontend excellence (any phase touching `src/pages`|`src/components`):** the page complies with
  `.claude/rules/page-lifecycle.md` (does nothing on resume — no refetch flash, no spinner-gated reload,
  no hard reload; the minimize test passes) and `loading-error-states.md` (a failed load never renders
  the success empty-state or a blank page); it consumes the design-system tokens + shared primitives
  (zero new hardcoded hex / bespoke `const C={}` palette); on tech surfaces it meets `tech-mobile-ux.md`.
  The 3-agent gauntlet + the `close-out-standard.md` minimize/390px/perf checks enforce this — carry
  them into the phase block, the same way consent/DB guardrails are carried.
- Additive-only migrations; browser-readable tables get RLS + operation-specific
  owner/role/assignment/org/capability policies in the same migration, while documented
  service-only tables may intentionally have no browser policy; `org_id` on domain parents (documented
  child/global-tracker exceptions); UNIQUE on external-system IDs + ON CONFLICT upserts
  (namespaced synthetic IDs like `'form:'||token` count); prefer `SECURITY INVOKER`; necessary
  definers validate callers, pin `search_path`, revoke `PUBLIC, anon`, and grant only intended
  roles. Public exceptions require the §2 allowlist + reason + abuse tests. Include rollback on any
  live-table/RPC change; no secret column readable by anon/authenticated; `timestamptz` +
  `America/Denver` bucketing; idempotent seeds.
- Consent gate structurally unbypassable (any phase that sends): automated/marketing
  sends only through `sendAutomatedMessage()`/`sendGatedEmail()`; no direct
  Twilio/Resend and no `skip_compliance` anywhere; consent
  writes land in `sms_consent_log`/`email_suppressions` with actor/IP (+ consent-text
  version for forms); suppressed/DND contacts excluded from audiences AND durably
  skipped at send time. TCPA penalties are per message — weight reviews accordingly.
- Public unauthenticated endpoints: server-side validation, XSS-safe rendering (no
  raw HTML; scheme-whitelisted links), spam gate (honeypot + fill-time + rate limit +
  Turnstile-behind-a-toggle), draft/publish versioning that never mutates a published
  row.
- UTC storage, Mountain-Time day boundaries via the tested `functions/lib/date-mt.js`
  helpers; every cron/webhook worker writes a `worker_runs` row.
- Test-first with NAMED targets on money/consent/idempotency/date-boundary/public-
  surface logic; committed failing test → implementation; never edit a committed test
  to green it. Test data disposable (TEST org / dev tracking number) and deleted at
  close-out.
- Isolation by feature flag (+ `dev_only_user_id`), not branch; staff rollout gated
  on a roles-defined phase; flag flips stay the owner's.
- End-of-phase order: commit → set status shipped → update docs → THEN open the PR
  into `dev` as a handoff (owner/orchestrator merges; sessions don't click-merge,
  subscribe, or babysit); two-direction checkbox reconciliation (no
  done-to-look-finished, no finished-left-as-todo; owner-blocked stages stay open with
  the reason disclosed) — the phase reviewer audits this.

Companion skills for the sessions this skill DISPATCHES (this skill only plans):
`/new-feature` is the per-session build loop for any surface; `/new-crm-module`
additionally scaffolds CRM phases. Before writing any query, confirm real column
names live — never from memory.
