<!--
FILE: docs/handoff/agent-alignment-session-3-handoff.md

WHAT THIS DOES (plain language):
  The current baton for making Claude Code and Codex work from the same rules.
  Says what is finished and live, what is left, what only the owner can do, and
  the facts worth not rediscovering — so a fresh session in EITHER tool can pick
  the work up without re-deriving anything.

DEPENDS ON:
  Internal: docs/agent-alignment-roadmap.md (plan of record — read its STATUS
            CORRECTION section first), docs/agent-alignment-challenge-report.md,
            docs/agent-alignment-dispatch.md, docs/agent-alignment-ownership-DRAFT.md,
            CLAUDE.md, AGENTS.md, .claude/rules/database-standard.md,
            docs/tooling-governance.md
  Data:     reads  → documentation, source, Git metadata
            writes → documentation and agent-configuration only

NOTES / GOTCHAS:
  - Supersedes docs/handoff/agent-alignment-session-2-handoff.md.
  - Every number was measured 2026-07-26. Re-measure; do not trust.
  - The repo moves under you. Parallel sessions land commits on dev during a
    session, and at least one has been editing the MAIN working tree directly.
-->

> # ⚠️ SUPERSEDED — do not follow this baton
>
> The current baton is [`docs/handoff/agent-alignment-session-4-handoff.md`](agent-alignment-session-4-handoff.md).
> The routing glob `agent-alignment-session-*-handoff.md` matches this file too, so it is easy to
> open by mistake. Everything below is a point-in-time record of session 3, kept for history.
> Its "what is left" list and its owner-decision ledger are both out of date.

# Handoff — Agent alignment, session 3

**Written:** 2026-07-26 · **Base:** `origin/dev` at `e0d7557` · **Everything below is merged and pushed. No open branch.**

> ### UPDATE 2026-07-26, later the same day — three owner gates closed, numbers changed
>
> Landed after this file was first written: `b075007` (CAP-SEC-001 repo half),
> `d0ca22d` (governance amendment), and the owner-run SEO deletion.
>
> | Gate | Outcome |
> |---|---|
> | **#8** CI ownership | **Dissolved.** `ci.yml` already runs `validate:tooling` + `test:tooling`, and the validator blocks adapter drift by itself (verified: `ERROR [generated-adapter-drift]`, exit 1). Put future invariants inside `scripts/validate-tooling-governance.mjs`; **do not edit `ci.yml`**. |
> | **#5** Commit `.agents`/`.codex` | **Answered NO.** Committing ~345 stale hand-copied mirrors would commit the drift problem. Track only renderer output; grow coverage through the neutral source. |
> | **#4** SEO mirrors | **Deleted** (owner-run — the repo's `Bash(rm -rf:*)` deny correctly blocked the agent). 31 skill bundles + 18 agent entrypoints gone; 93 SEO `SKILL.md` remain recoverable from `ff76e01`. Amendment recorded in `docs/tooling-governance.md` §5. |
> | **#6** CAP-SEC-001 | **Repo half done** (`b075007`): `settings.local.json` untracked (still on disk — the owner's 121 pre-approvals and overnight autonomy are unaffected), plus `.env` and MCP denies added. **Now blocked on a migration apply, not on the owner rotating.** |
>
> **CORRECTED COUNTS — the pre-deletion figures below are stale:**
>
> | | this file first said | actual now |
> |---|---|---|
> | `.agents/skills/` bundles | 51 | **24** |
> | `.codex/agents/*.toml` | 33 | **15** |
> | ungoverned Codex agents inheriting the parent sandbox | 30 of 33 | **12 of 15** |
> | Codex skill-description budget (cap 8,000) | 19,742 (inherited) | **10,671** — still over by 2,671. The deletion helped; it did **not** fix it. The rest is the coverage work. |
>
> `.claude/agents/` (15) and `.codex/agents/` (15) are now at **count parity** for the first time.
>
> **CAP-SEC-001's real unblock, corrected.** Rotating the Encircle key first was wrong ordering — there
> is nowhere sanctioned to put the new key until the credential card renders. The card **is built**
> (`functions/lib/credentials.js` lists `encircle`; `Integrations.jsx` references it 20×), but
> `supabase/migrations/20260723_encircle_managed_credentials.sql` is **unapplied**, so
> `get_managed_credentials_status` returns no row and nothing renders. Correct order: apply that
> migration (owner-authorized live action, `database-standard.md` §0) → card appears → rotate → paste →
> the validator's `secret-bearing-permission` warning clears. Verified the hardened guard **allows**
> that migration (it carries a `ROLLBACK` section), so the new gate will not block the apply.
>
> **⚠️ A SESSION IS ALREADY WORKING L0/L1 FROM THIS FILE.** Before starting anything, `git fetch` and
> check whether the shared core already exists. Do not begin a second L0/L1 attempt.

---

## Goal

One shared law layer that Claude Code and Codex both auto-load; each tool at full documented
capability; gates that actually fire; and either tool able to resume the other's work. Sessions 1–2
did the research, produced the plan, recovered stranded work, and hardened the live gates. **The
centerpiece — the shared core itself — is still ahead.**

## What is DONE and live on `dev`

Eight commits, `245c0c4..e0d7557`:

| Commit | What |
|---|---|
| `0e27be0` | Recovered the stranded neutral-source machinery from `5694d47` (`chore/tooling-governance-pilot`, 2026-07-24, never merged). `tooling/` is the runtime-neutral source for 7 capabilities; `scripts/render-tooling-adapters.mjs` renders 18 adapters; validator gained **blocking** drift / runtime-coupling / reviewer-parity checks. Restored the rule *"edit the neutral source and regenerate; never hand-edit a generated adapter"* to `CLAUDE.md` and `AGENTS.md`. |
| `21e0b86` | `upr_sql` had **zero** gates (deny keyed to a non-matching server alias; hook matcher covered only `apply_migration|execute_sql`). Guard now covers 8 SQL-reaching tools in both tools' wiring, parses with **node not jq**, fails closed, requires a `ROLLBACK` section on `apply_migration`, refuses `GRANT … TO anon` / `DROP CONSTRAINT` / `SET NOT NULL` / `/**/`-comment evasion / unfiltered `upr_update|delete|upsert`. One canonical body; `.codex/hooks.json` references it. |
| `61c416b` | Fixture suite names its parser honestly. |
| `66f7904` | Three-way merged the three files the recovery skipped. Corrected a **load-bearing false claim** in `UPR-Web-Context.md:86` that a Claude Code guardrail blocks `main` pushes — it does not. |
| `545645f` | `capabilities.json` schema v2: `riskTier` (blast radius) + `modelInvocable` (drives `disable-model-invocation` / `allow_implicit_invocation`, emitted from data). |
| `41091bc` | The 3 governed Codex reviewers pin `sandbox_mode = "read-only"`. |
| `e0d7557` | Roadmap STATUS CORRECTION — L3/P13 no longer describe built work as unbuilt. |

**Owner direction that supersedes the plan:** *gate the mutation, not the dispatcher.* `db-migration`
is red-tier and **stays model-invocable** — planning and authoring are safe; the apply is gated by the
guard plus a separate owner authorization. Do not lock the dispatchers; that would cost the overnight
autonomy the owner values and fix nothing that matters.

## What is LEFT, in order

1. **L0/L1 — the shared core. This is the centerpiece and it is untouched.**
   Carve the shared law into `AGENTS.md` (target 8–12 KB, non-negotiables first), put `@AGENTS.md` on
   line 1 of `CLAUDE.md`, and reduce `CLAUDE.md` to that import plus Claude-only routing.
   **Never a symlink** — Git for Windows sets `core.symlinks=false` and checks it out as a text file
   containing the literal string `AGENTS.md`. Add a `## Code Review Rules` section (Codex's PR
   reviewer honours that exact heading; it flags only P0/P1, so keep lint-shaped rules out). State
   that nested `AGENTS.md` files are **additive-only**. Land a tracked `.codex/config.toml`.
   Sequence so law is never transiently unenforced: land the core **additively** (nothing deleted),
   then add the import keeping the `CLAUDE.md` duplicate, then delete the duplicate **only after a
   post-compact canary proves the import survives.**
2. **L2 — on-demand depth.** All 23 `.claude/rules/*.md` still load unconditionally (**212,822 B**,
   the roadmap's "before" number). Add `paths:` frontmatter — **brace-light** globs; an over-braced
   pattern silently matches nothing. Keep `database-standard.md` permanently **unscoped**:
   `paths:`-scoped rules are dropped at `/compact`, and that file carries the shared-production apply
   gate. Codex has **no** conditional-markdown mechanism — its depth is a root pointer table, not
   nested files (a nested `AGENTS.md` below the launch directory fires for nobody). Prove every
   conversion with the `InstructionsLoaded` hook + `/context` in a **fresh** session.
3. **Extend coverage from 7 of 39 capabilities** to all of them (24 Claude skills + 15 subagents).
   Cut the roster before porting: both tools silently truncate their discovery lists, so some
   capabilities are already invisible to implicit matching. 30 of 33 `.codex/agents/*.toml` remain
   ungoverned and inherit the parent sandbox.
4. **The remaining gates.** A ref-parsing `never-push-main` PreToolUse hook (enumerated denies cannot
   carry exceptions, and a bare `["git","push"]` Codex prefix rule never matches `git push $BRANCH`);
   `.env` `Read`/`Edit` denies; `apply_migration` deny-or-ask — **both `execute_sql` and
   `apply_migration` together or neither**, since denying one leaves the survivor allowed *and*
   hook-permitted.
5. **The maintenance contract's remainder:** a decision log with durable IDs that law files cite, and
   a cross-tool behavioural fixture (`claude -p` vs `codex exec --output-schema`) asserting equivalent
   refusals. `tooling/evals/skill-routing.json` is a partial start. Note `claude -p --bare` skips
   CLAUDE.md, hooks, skills and MCP entirely and is slated to become the `-p` default.
6. **Open renderer choice:** the shipped renderer emits **full generated copies**;
   `tooling-governance.md` §7 prefers **thin pointers**. Not decided, not done.

## Constraints

- Docs / agent-configuration only. No `src/`, `functions/`, `supabase/`, `ios/`. No migration
  authored or applied. No live or provider state.
- Never weaken a `CLAUDE.md` non-negotiable or a `.claude/rules/` standard while harmonising. Where
  the tools disagree the **stricter** side wins and the conflict goes to the owner.
- Do not renumber `CLAUDE.md` rules 1–12 (209 live references).
- Rules changes are **disclosed amendments** — strike in place with `superseded-by:`.
- `CLAUDE.md` Rules 4 and 6 stay **as written**; their internal tensions are surfaced as proposals
  with the original owner rationale attached, never planned as decided.
- Commit/push is authorized for this initiative's own docs/config on `dev` (Rule 4 routine flow).
  Migration apply, credential changes, provider actions, and flag flips are **not**.

## Owner decisions still open

Full ledger: `docs/agent-alignment-roadmap.md` §10 (20 items). **Answered:** #1 (Claude Code upgraded
2.1.85 → **2.1.220**, version gate cleared), #2 (this initiative is lane G's instruction-layer slice;
lane G F5b/F5c was done-but-unmerged), #3 (yes, **fix-then-track**), #6+#7 (fix the wiring, keep the
pre-approvals), #9 (dated addendum), #15 (Rules 4/6 unchanged), #16, #18, #20.

**Still blocking:**
- **CAP-SEC-001 — dated.** Tracked `.claude/settings.local.json`: 121 allow entries, no `deny` key,
  plus a live cleartext Encircle bearer token. Validator waiver **expires 2026-08-06**. The 121
  pre-approvals are a deliberate, valuable overnight-autonomy capability — **preserve them**; move
  them out of the tracked file and make the backstops real. Rotating the credential is owner-only.
- **#4** SEO trees — 31 skills + 18 agents live for Codex, retired for Claude. Recommendation: tracked
  quarantine outside every discovery root, which satisfies both governance provisions instead of
  picking a winner.
- **#5** authorize committing `.agents/` / `.codex/` (584 files; backed up to the session scratchpad
  before anything was touched). **Fix then track** — never track first.
- **#8** CI ownership for the invariant guard.

## Verification

```bash
git fetch && git log --oneline origin/dev -5     # the repo moves; rebase first
npm run check:tooling-generated                  # expect: 18 generated file(s) current
npm run validate:tooling                         # expect: 0 errors, 2 warnings (CAP-SEC-001/GOV-001)
npm run test:tooling                             # expect: 15/15
node --test scripts/block-destructive-sql.node-test.mjs   # expect: pass, 0 fail
```

**Gates that are ACTIVE and will bite:** `apply_migration` without a `ROLLBACK` section is refused;
unfiltered `upr_update`/`upr_delete`/`upr_upsert` refused; `GRANT … TO anon`, `DROP CONSTRAINT`,
`ALTER COLUMN SET NOT NULL` refused.

## Hazards

- **A parallel session has been editing the MAIN working tree** — five files under `src/pages`
  (`CustomerPage`, `Customers`, `JobPage`, `Leads`, `Marketing`), matching backlog item 5.1. Stage by
  **explicit path**, never `git add -A`. Use a worktree.
- **Two Claude Code installations exist** (npm-global, and a vestigial native one under
  `~/.local/share/claude`). Any version assertion must resolve the binary explicitly.
- `jq` is **not installed**. Parse hook payloads with node.
- Live MCP server ids are hashed UUIDs, so every `mcp__UPR_MCP__*` / `mcp__Supabase__*` permission
  rule — allow **and** deny — matches nothing. Regex hook matchers are the only gate that fires.

## Standing facts worth not rediscovering

- Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`. The bridge is an `@AGENTS.md` import.
- Codex caps its `AGENTS.md` chain at `project_doc_max_bytes` (32 KiB default) and drops the **tail**
  silently. Treat the cap as COMBINED — two vendor pages disagree; the stricter reading binds.
- **Exit 1 is non-blocking in both tools.** Only exit 2 blocks. A guard that dies under `set -e`, is
  unresolvable (127), or is CRLF-broken silently **permits**. `.gitattributes` pins `*.sh` to LF.
- On win32 **Codex sandboxes natively and Claude cannot sandbox at all** (WSL2 required, fails open by
  default). Never list sandboxing as a Claude-side control on this platform.
- A mid-session edit to `CLAUDE.md`/`AGENTS.md`/a `SKILL.md`/a settings file **does not take effect
  until `/clear`, `/compact` or restart.** Never report "rule updated and followed" from one session.
- Claude skill precedence is managed > user > **project**, so a developer's `~/.claude/skills/<name>`
  silently shadows the repo copy. `.claude/commands/` and skills are one merged namespace.
- `.claude` is a Claude **protected path**: edits prompt, and `permissions.allow` cannot pre-approve
  them. Phases touching many rules files cannot run headless.

## The process lesson — apply it before designing anything

Twelve research agents, five design lanes and four adversarial reviewers all missed that the L3
mechanism already existed, because **nothing looked at unmerged branches.** `CLAUDE.md:74-77` already
requires finishing existing work over parallel implementation, and the recovered `masterplan` source
says it outright — but that text was not on `dev` when the plan ran.

**So: search unmerged branches for an existing implementation before designing one.**
`git branch -a --no-merged dev` and read what you find.
