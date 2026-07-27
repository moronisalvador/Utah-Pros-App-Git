<!--
FILE: docs/handoff/agent-alignment-session-2-handoff.md

WHAT THIS DOES (plain language):
  The baton for the second working session on making Claude Code and Codex work
  from the same rules. It says exactly what landed, what is verified, what is
  still open, and what to do next — so a fresh session (Claude OR Codex) can
  pick the work up without re-deriving anything.

DEPENDS ON:
  Internal: docs/agent-alignment-roadmap.md (plan of record, PARTLY STALE — see §6),
            docs/agent-alignment-challenge-report.md, docs/agent-alignment-dispatch.md,
            docs/agent-alignment-ownership-DRAFT.md, CLAUDE.md, AGENTS.md,
            .claude/rules/database-standard.md, docs/tooling-governance.md
  Data:     reads  → documentation, source, Git metadata
            writes → documentation and agent-configuration only

NOTES / GOTCHAS:
  - Every number here was measured on 2026-07-26. Re-measure, don't trust.
  - The repo moves under you: 11 commits landed from parallel sessions during
    session 1. Rebase and re-measure before acting on any figure.
-->

# Handoff — Agent alignment, session 2

> **SUPERSEDED 2026-07-26** — its ordered steps 1–4 are complete and landed
> (`245c0c4..e0d7557`). Current baton:
> [`agent-alignment-session-4-handoff.md`](agent-alignment-session-4-handoff.md)
> (session-3 is also superseded; pointer updated 2026-07-26 to skip the dead hop).
> Kept for history; do not execute from this file.

**Written:** 2026-07-26 · **Session 1 base:** `dev` at `245c0c4` · **Branch:** `recover/tooling-governance-neutral-sources` (pushed, 2 commits ahead of `dev`)

---

## Goal

Make Claude Code and Codex work from one shared law layer, at full capability, with gates that
actually fire — and so either tool can pick up the other's work. Session 1 did the research, produced
the plan, and closed one live security hole. Session 2 finishes the merges and corrects the plan.

## Context — what landed in session 1

Two commits, pushed, **not merged to `dev`**:

| Commit | What | Verified by |
|---|---|---|
| `0e27be0` | Recovers the stranded neutral-source + renderer machinery from `5694d47` (committed to `chore/tooling-governance-pilot` 2026-07-24, never merged). `tooling/` is the runtime-neutral source for 7 capabilities; `scripts/render-tooling-adapters.mjs` renders 18 `.claude`/`.agents`/`.codex` adapters; validator gained blocking drift/coupling/parity checks. | `npm run check:tooling-generated` → 18 files current, zero drift · `npm run test:tooling` → 14/14 · `npm run validate:tooling` → 0 errors, 2 warnings (both CAP-SEC-001/GOV-001) |
| `21e0b86` | Closes a live hole: `upr_sql` had **zero** gates (deny keyed to a server alias that never matches the live hashed id; hook matcher covered only `apply_migration|execute_sql`). Guard now covers 8 SQL-reaching tools in both tools' wiring, parses with node not jq, fails closed, requires a `ROLLBACK` section on `apply_migration`, and `.codex/hooks.json` references the single canonical guard body. | `node --test scripts/block-destructive-sql.node-test.mjs` → 25 fixture cases, deliberately bad on purpose |

### Design decision, owner-directed — record it, don't re-litigate

**Gate the mutation, not the dispatcher.** `db-migration` stays model-invocable so overnight autonomy
is unaffected; the gate sits at the apply. This *supersedes* the roadmap's "mark every side-effectful
capability non-model-invocable". `allow_implicit_invocation: true` on `db-migration` is therefore
**correct**, not a defect.

## Constraints

- Docs / agent-configuration only. No `src/`, `functions/`, `supabase/`, `ios/`. No migration authored
  or applied. No live or provider state.
- Do not weaken a `CLAUDE.md` non-negotiable or a `.claude/rules/` standard while harmonising. Where
  the tools disagree the **stricter** side is the default and the conflict goes to the owner.
- Do not renumber `CLAUDE.md` rules 1–12 (209 live references).
- Substantive rules changes are **disclosed amendments** — strike in place with `superseded-by:`.
- Nothing authorizes a commit, push, PR, deploy, migration apply, credential change, or provider
  action without a fresh owner instruction for that exact step.

## Done when — session 2, in order

1. **Read `tooling/skills/*/SKILL.md` and `tooling/agents/*.md`** (~600 lines), then merge `0e27be0`
   to `dev` — or report what's wrong in it. This is the one outstanding trust gap: that work was
   verified *by execution* but its prose was never read, and merging replaces the four live
   dispatchers and three reviewer agents with versions authored before session 1's research.
2. **Merge `21e0b86` to `dev`** so other clones, CI and Codex cloud get the closed hole. It is
   currently active on the owner's machine only.
3. **Three-way merge the three files session 1 deliberately skipped**, worst-first:
   `.claude/rules/close-out-standard.md` (3 parties have now edited it), `UPR-Web-Context.md`
   (18 commits on `dev` since), `docs/testing-and-deployment.md` (3).
4. **Correct then land the four plan docs** (still untracked — see §6).
5. **Add `riskTier` to `tooling/capabilities.json`** and have the renderer emit gates from it. Needed
   for anything that genuinely should be human-only later; `db-migration` is not one of those.

## Files and interfaces in scope

`tooling/**`, `scripts/render-tooling-adapters.mjs`, `scripts/validate-tooling-governance.mjs`,
`scripts/block-destructive-sql.node-test.mjs`, `.claude/hooks/**`, `.claude/settings.json` (hooks +
permissions), `.codex/hooks.json`, `.codex/config.toml` (to be created), `CLAUDE.md`, `AGENTS.md`,
`.claude/rules/**`, `docs/agent-alignment-*.md`, `.gitattributes`.

## Explicitly out of scope

- `functions/lib/callrail-mms.js` + test. They sit in `4abe483` on `chore/tooling-governance-pilot`,
  the commit that introduces preferring the masked CallRail account identity — the defect backlog item
  1.2 flags as blocking 5 MMS and driving the daily alert nag. **Leave stranded on purpose. Do not
  merge that branch wholesale.**
- Every active ownership manifest's file-ownership matrix.
- `CLAUDE.md` Rules 4 and 6 as written. Their tensions are surfaced as proposals with the original
  owner rationale; the owner has not ruled.

## Verification step

```bash
git fetch && git log --oneline origin/dev -5        # the repo moves; rebase first
npm run check:tooling-generated                     # expect: 18 generated file(s) current
npm run test:tooling                                # expect: 14/14
npm run validate:tooling                            # expect: 0 errors, 2 warnings
node --test scripts/block-destructive-sql.node-test.mjs   # expect: pass, 0 fail
```

Guard checks that are ACTIVE and will bite: `apply_migration` without a `ROLLBACK` section is refused;
unfiltered `upr_update`/`upr_delete`/`upr_upsert` is refused; `GRANT … TO anon`, `DROP CONSTRAINT` and
`ALTER COLUMN SET NOT NULL` are refused.

---

## §6 — What in the plan of record is already stale

`docs/agent-alignment-roadmap.md` (194 KB, 21 phases) was authored **before** the stranded work was
found. Two lanes are wrong:

- **L3 / P13** assume the neutral-source mechanism must be **built**. It exists and passes tests.
  They become *"extend the neutral source from 7 capabilities to 39"*.
- The **maintenance-contract** proposal is largely already implemented (neutral source + renderer +
  blocking drift check). What remains is a decision log with durable IDs and a cross-tool behavioural
  fixture — `tooling/evals/skill-routing.json` is a partial start on the latter.

The challenge report's compliance reviewer missed this because nothing in the plan looked at unmerged
branches. **Add that to any future planning brief:** search unmerged branches for existing
implementations before designing one.

## §7 — Owner decisions still open

Full ledger: `docs/agent-alignment-roadmap.md` §10 (20 decisions). Answered in session 1: #1 (Claude
Code upgraded 2.1.85 → **2.1.220**, clears the ≥2.1.217 gate), #2 (this initiative is lane G's
instruction-layer slice — lane G F5b/F5c is **done but unmerged**), #3 (yes, fix-then-track), #6+#7
(fix the wiring; keep the pre-approvals), #9 (dated addendum; the ux-alignment freeze is already being
crossed by other work), #16, #18, #20.

**Still open and blocking:**
- **CAP-SEC-001** — the tracked `.claude/settings.local.json` has 121 allow entries, no `deny` key,
  and a live cleartext Encircle bearer token. Waiver expires **2026-08-06**. Rotating the credential
  is owner-only; the untrack + name-based denies are ready to do. The 121 pre-approvals are a
  deliberate, valuable overnight-autonomy capability — **preserve them**, move them out of the tracked
  file and make the backstops real.
- **#4** SEO trees (31 skills + 18 agents live for Codex, retired for Claude) — recommendation is a
  tracked quarantine outside every discovery root, which satisfies both governance provisions.
- **#5** authorize committing `.agents/` and `.codex/` (584 files backed up to the session scratchpad
  before anything was touched).
- **#8** CI ownership for the invariant guard.

## §8 — Standing facts worth not rediscovering

- Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`. The bridge is an `@AGENTS.md` import on line 1.
  **Never a symlink on Windows** — Git for Windows checks it out as a text file containing the literal
  string `AGENTS.md`, which presents as "the rules stopped working".
- Codex caps its `AGENTS.md` chain at `project_doc_max_bytes` (32 KiB default) and drops the **tail**
  silently. Treat the cap as COMBINED (two vendor pages disagree; stricter reading binds).
- Codex has **no** conditional-markdown loading. `.codex/rules/*.rules` is Starlark command policy,
  not context. Codex depth is a root pointer table; a nested `AGENTS.md` below the launch directory
  fires for nobody in a root-launched session.
- `paths:`-scoped rules and nested `CLAUDE.md` are **dropped at `/compact`** until a matching file is
  re-read. Safety-critical law therefore stays UNSCOPED at the root, permanently.
- **Exit 1 is non-blocking in both tools.** Only exit 2 blocks. A guard that dies under `set -e`, is
  unresolvable (exit 127), or is CRLF-broken silently **permits**.
- On win32 **Codex sandboxes natively and Claude cannot sandbox at all** (WSL2 required, and it fails
  open by default). Never list sandboxing as a Claude-side control on this platform.
- A mid-session edit to `CLAUDE.md`/`AGENTS.md`/a `SKILL.md`/a settings file **does not take effect
  until `/clear`, `/compact` or restart.** Never report "rule updated and followed" from one session.
- `jq` is **not installed** on the owner's machine. Parse hook payloads with node.
- Live MCP server ids are hashed UUIDs, so every `mcp__UPR_MCP__*` / `mcp__Supabase__*` permission
  rule — allow **and** deny — matches nothing. Regex hook matchers are the only gate that fires.
