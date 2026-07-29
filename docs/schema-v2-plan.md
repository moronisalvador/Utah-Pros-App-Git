# Schema v2 & Clean Rebuild — Baseline Plan

**Last verified:** 2026-07-29 · Status: **QUEUED — not started.** This is the baseline plan the
owner asked to have on file "for when we are ready." It is a plan of record for *how*, not an
authorization to start. Before starting, run the §7 refresh checklist — AI tooling and Anthropic
guidance change fast, and this document is written to be re-validated, not blindly executed.

## 1. What this is and why

Rebuild the database as **schema v2** — clean, deliberately designed, multi-tenant-ready,
reproducible from the repo — and let the already-planned UI/UX redesign land module-by-module on
top of it, stranding the v1 junk (dead columns, orphan tables, always-true policies, band-aid
patterns) rather than "cleaning" it in place. Strategy: **strangler fig**, never big-bang. The
business keeps running on v1 at every moment; each redesigned module cuts over individually.

Prerequisite state (must exist before P0): seeded `qa-staging` branch + committed
`db/baseline/schema.sql` (see `docs/database/staging-branch-runbook.md` §2/§4), and current WIP
reduced per `docs/wip-inventory-2026-07.md` — this initiative wants the repo nearly to itself.

## 2. Sequencing: before or after the UI/UX redesign?

**Schema v2 design comes FIRST; the UI redesign is the delivery vehicle.** Order of operations:

1. **Design schema v2 before redesigning any screen's data flow.** Designing v2 is cheap (a
   document + migrations on an isolated project) and the redesigned UI should be built against it
   once. The failure mode to avoid: redesign the UI on v1's shapes, then re-plumb every screen to
   v2 later — that is paying for the UI twice.
2. **Visual-only work (design system, tokens, component kit) can proceed any time** — it does not
   touch data shapes and loses nothing by preceding v2.
3. **Then migrate module-by-module:** each module gets its v2 tables + ETL + redesigned UI
   together, ships behind a flag, and cuts over when proven. Old modules keep running on v1
   untouched until their turn.

## 3. Target architecture principles (v2 non-negotiables)

- **Schema-as-code from commit #1.** Every object born in a migration; no dashboard DDL, ever.
  CI boots the entire schema from migrations on every PR — that makes the "schema not
  reproducible from its own history" failure (discovered 2026-07-29, ledger dead at entry 4/419)
  structurally impossible to recur.
- **Multi-tenant from day one: shared schema + `tenant_id`.** One database; `tenant_id uuid not
  null` (FK → `tenants`) on every tenant-owned table; RLS keyed on a tenant claim stored in the
  JWT via **`app_metadata`** (server-controlled — never `user_metadata`, which the user can
  edit); composite indexes leading with `tenant_id`; every RLS-referenced column indexed.
  Schema-per-tenant / database-per-tenant is deliberately rejected at this scale — revisit only
  if a future customer contractually requires physical isolation.
- **Least privilege by construction** (carries over from `database-standard.md`): operation-
  specific policies, `SECURITY INVOKER` default, definers validate + pin `search_path` + revoke
  `PUBLIC/anon`, column-level grants where rows aren't the right boundary, no free-form SQL to
  browser roles, secrets never client-readable.
- **Conventions fixed up front:** `timestamptz` everywhere, `America/Denver` bucketing, snake_case
  naming standard, soft-delete policy decided once, `created_at`/`updated_at`/audit pattern
  decided once, idempotency-key pattern for money/side-effect tables.
- **DR is a property, not a task:** schema in git + migrations replayable from zero + seed
  scripts + scheduled data backups + a **quarterly restore drill** (boot a scratch project from
  repo + backup; verify the app runs against it).

## 4. How AI executes this (the working model)

- **Reverse-engineering, not imagination.** The working app is the specification: the live
  schema dump says what exists; the code says what is actually read/written; the audits and WIP
  inventory say what is a band-aid. v1 is mapped mechanically before v2 is designed.
- **Multi-agent orchestration where it pays** (owner opts in per session — say "use ultracode"
  or "use a workflow"): fan out one mapper agent per domain (jobs, scheduling, billing,
  messaging, CRM, tech-app, auth/admin) in P0; run an **adversarial judge panel** over the P1
  design (security lens, migration-cost lens, multi-tenant lens, query-performance lens) before
  anything is built; verify every ETL with independent checker agents comparing row counts,
  invariants, and money totals.
- **All database iteration happens on isolated targets** (the v2 dev project or `qa-staging`
  branch) — the production authorization boundary in `AGENTS.md` §0/§13 binds this initiative
  unchanged. Cutovers are always separate owner-authorized windows.
- **The owner decides, per module:** what data is worth keeping, which workflows change vs.
  are preserved, tenancy/pricing expectations, and every cutover moment. Agents propose;
  evidence decides; the owner authorizes.
- **Session hygiene:** each phase produces a committed artifact (map, design doc, migrations,
  ETL) that the next session starts from — never rely on chat memory across sessions.

## 5. Phase plan

| Phase | Work | Deliverable | Gate |
|---|---|---|---|
| **P0 — Map v1** (1–2 sessions) | Domain-by-domain usage map: every table/column/RPC/policy → used / dead / duplicated / band-aid, traced from code not memory | `docs/schema-v2/v1-map.md` | Owner reviews the "dead" list |
| **P1 — Design v2** (1–2 sessions) | Full v2 schema design: ERD, tenancy, conventions, per-domain tables, RLS matrix, migration order | `docs/schema-v2/design.md` + adversarial review verdicts | Owner sign-off on design |
| **P2 — Foundation** | New Supabase project (v2 dev); migrations 0001+; tenant/auth/RLS core; CI boots schema from zero | Green v2 CI pipeline | — |
| **P3 — ETL rehearsal** | Per-domain ETL scripts v1→v2, run repeatedly against staging data; invariant checks (counts, money totals, FK integrity) | Re-runnable, verified ETL per domain | ETL green twice consecutively |
| **P4 — Module cutovers** (repeat per module) | Redesigned UI module on v2 + final ETL for that domain + flag flip | One module live on v2 | Owner authorizes each cutover |
| **P5 — Strand & delete v1** | After last module: v1 tables archived/exported, project decommission plan | Deletion manifest | Owner authorizes |
| **P6 — DR drill** | First quarterly restore drill on v2 | Drill log in docs | — |

## 6. Research notes (2026-07-29)

- **Tenancy:** shared-schema + `tenant_id` + RLS is the Supabase-idiomatic pattern; put the
  tenant claim in `app_metadata` (server-set) and index every policy-referenced column
  ([Makerkit RLS best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices),
  [Supabase RLS guide 2026](https://designrevision.com/blog/supabase-row-level-security),
  [multi-tenancy discussion](https://roughlywritten.substack.com/p/supabase-multi-tenancy-simple-and)).
  Row-level policies don't restrict columns — revoke table-wide grants and grant back needed
  columns.
- **AI-assisted legacy migration (state of the art 2026):** AI discovery of schema, dependencies
  and relationships replaces weeks of manual documentation; LLM-assisted migrations are reported
  to cut lifecycle time ~50%, with the human role shifting to *validator of architectural
  intent*; universally repeated cautions — never trust generated migration code blindly, always
  rehearse in isolated environments, keep a human on final decisions
  ([V2Soft 2026 practices](https://v2connect.v2soft.com/how-to-modernize-legacy-databases-best-practices-for-2026/),
  [LLM-assisted legacy migration case study](https://www.sciencedirect.com/science/article/pii/S2590005626001293),
  [Reversa reverse-documentation framework](https://arxiv.org/html/2605.18684)).
  The "reverse documentation" pattern — generate inventory → code analysis → domain model →
  migration plan as explicit artifacts for agents — matches this plan's P0/P1 exactly.
- **Anthropic-side guidance:** see §6.1 (researched via live docs the same day).

### 6.1 Anthropic recommendations applied (as researched 2026-07-29)

Researched live from Anthropic's docs 2026-07-29. Headlines:

- **Anthropic's own large-migration framework** (used for their 165k-line and 1M-line code
  migrations) maps directly onto this plan: (1) rulebook + dependency mapping first, (2)
  stress-test the rules on a small slice then refine, (3) large-scale parallel translation with
  cheaper models implementing and stronger models reviewing, (4–6) compile→fix→test loops with
  the test suite as referee. Their key insight, adopted here verbatim: *"You don't fix the code.
  You fix the process that produced the code"* — when a rule is wrong, regenerate the affected
  batch, never hand-patch ([AI code migration blog](https://claude.com/blog/ai-code-migration)).
  For us: P0 = mapping, P1 = the rulebook, P3's ETL rehearsal = the stress-test.
- **Orchestration decision matrix** (current docs): *subagents* for research/isolation within a
  session; *agent teams* for a handful of long-running peers on cross-layer architecture;
  *dynamic workflows* (script-driven, 10–1000s of agents, resumable) for audits and migrations —
  workflows are the current successor to manual multi-session coordination and support the
  adversarial-review phases P1 requires
  ([workflows](https://code.claude.com/docs/en/workflows.md),
  [agent teams](https://code.claude.com/docs/en/agent-teams.md),
  [subagents](https://code.claude.com/docs/en/sub-agents.md)). P0/P3 are workflow-shaped; P1's
  judge panel is a workflow phase.
- **No official schema-redesign playbook exists** — Anthropic's docs cover code migration and
  orchestration, not database redesign specifically. Our local law (`database-standard.md`,
  migration hygiene CI, isolated-target iteration) remains the authoritative pattern and this
  plan is the playbook.
- **Model/capability notes (July 2026):** long-horizon design phases benefit from the largest
  available context and highest effort tiers for planning/review; use cheaper models for
  mechanical batch work per the framework above. Re-check the
  [release notes](https://platform.claude.com/docs/en/release-notes/overview) at start time —
  this is exactly the fast-moving part.
- **Context engineering for Claude 5-generation models** (Anthropic, 2026-07-24): the Claude
  Code team cut >80% of their own system prompt with no eval loss — the shift is "from rules to
  judgment" for *behavioral* instructions. Applied here: agent instructions for this initiative
  state objectives and domain facts, not behavioral micro-rules; hard constraints live in
  mechanical gates (CI, migration hygiene) rather than prose; the small prose core is reserved
  for business/legal invariants (consent, money, tenancy isolation) that no model can infer
  ([post](https://claude.com/blog/best-practices-for-prompt-engineering),
  [trade-off discussion](https://www.ibtimes.sg/anthropic-says-claude-5-needs-shorter-prompts-developers-say-trade-offs-are-more-complicated-90853)).
  This mirrors the 2026-07-29 repo restructure that preceded it by hours.

## 7. Refresh checklist — run this BEFORE starting P0

AI capability and guidance drift fast. On the day this initiative starts:

1. Re-search Anthropic's current docs/blog for agentic-migration and orchestration guidance;
   update §6.1.
2. Re-check Supabase: branching capabilities, data-branch pricing, declarative schema tooling,
   any first-party multi-tenancy primitives added since mid-2026.
3. Re-confirm the prerequisite state in §1 (seeded branch, committed baseline, WIP low).
4. Re-read `docs/wip-inventory-2026-07.md` and update the queue ordering if reality moved.
