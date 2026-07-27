<!--
════════════════════════════════════════════════
FILE: agent-alignment-roadmap.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This is the plan for making Claude Code and OpenAI Codex work from the same
  written rules in this repository, so that either tool can pick up the other's
  work without breaking anything. It describes what is true today (measured, not
  remembered), what should change, in what order, and how each step is proved.
  It changes no application code and no live system by itself.

DEPENDS ON:
  Internal:  AGENTS.md, CLAUDE.md, docs/tooling-governance.md,
             .claude/rules/close-out-standard.md,
             .claude/rules/documentation-standard.md,
             .claude/rules/database-standard.md,
             docs/agent-alignment-dispatch.md,
             docs/agent-alignment-ownership-DRAFT.md,
             docs/agent-alignment-challenge-report.md
  Data:      reads → none · writes → none

NOTES / GOTCHAS:
  - Docs/config only. No change to src/, functions/, supabase/, ios/. Zero
    migrations. No live, provider, or external state is touched.
  - Reading or approving this plan authorizes nothing. Commit, push, PR, deploy,
    migration apply and provider actions each require their own owner instruction.
  - Several numbers inherited from the original task prompt were measured to be
    wrong. §2 records the corrections rather than quietly using the right ones.
════════════════════════════════════════════════
-->

# Agent Instruction Alignment — Roadmap (plan of record)

**Created / last verified:** 2026-07-26
**Slug:** `agent-alignment`
**Base verified:** `dev` at `6b5dc80`, working tree carrying untracked `.agents/` and `.codex/` (both are this plan's subject — see §2)
**Ownership:** `docs/agent-alignment-ownership-DRAFT.md` (a DRAFT under `docs/`, deliberately **not** in `.claude/rules/`; the owner promotes it after review)
**Dispatch:** `docs/agent-alignment-dispatch.md`
**Challenge report:** `docs/agent-alignment-challenge-report.md`
**Governing project law:** `docs/tooling-governance.md` (owner-approved), `CLAUDE.md` rules 1–12, `.claude/rules/*`

**Evidence marking used throughout:** 🟢 verified this session with a named command · 🟡 inherited, plausible, not re-checked · 🔵 owner-or-external, unverifiable from this environment.

---

## ⚠️ STATUS CORRECTION — 2026-07-26, after this plan was written

**This plan was authored before anyone checked unmerged branches, and part of it
describes work that already existed.** Read this section before executing any phase.

Commit `5694d47` on `chore/tooling-governance-pilot` (2026-07-24, 2 commits ahead of `dev`, 62 behind,
never merged) had already built the L3 mechanism: `tooling/` as the runtime-neutral source,
`scripts/render-tooling-adapters.mjs` rendering 18 adapters, and blocking adapter-drift /
runtime-coupling / reviewer-parity checks in the validator. Recovered and landed as `0e27be0`.

| This plan says | Actually |
|---|---|
| **L3 / P13** must *build* single-sourcing | The mechanism exists and passes tests. The lane becomes **extend coverage from 7 of 39 capabilities to 39**. |
| P13: run `scripts/render-capability-adapters.mjs --check` | That file never existed. It is `npm run check:tooling-generated` (`scripts/render-tooling-adapters.mjs`). |
| P13: emit `allow_implicit_invocation: false` for gated capabilities; "verified 0 such files exist" | 4 `agents/openai.yaml` files exist, and the flag is now **data-driven** from `capabilities.json` → `modelInvocable` (`545645f`). |
| P13: port the 3 Codex reviewer twins with `sandbox_mode = "read-only"` | The twins exist (`0e27be0`) and are now **pinned** (`41091bc`). 30 of 33 `.codex/agents/*.toml` remain ungoverned and inherit the parent sandbox. |
| P13: **generated thin POINTER adapters** | The shipped renderer emits **full generated copies**, not pointers. Pointers remain the stated preference in `tooling-governance.md` §7; changing the renderer is an open choice, not a completed one. |
| The **maintenance contract** is a new proposal | Its core is implemented: neutral source + renderer + blocking drift check, and the rule *"edit the neutral source and regenerate; never hand-edit a generated adapter"* is back in `CLAUDE.md` and `AGENTS.md`. What remains is a **decision log with durable IDs** and a **cross-tool behavioural fixture** (`tooling/evals/skill-routing.json` is a partial start). |

**Superseded by owner direction (2026-07-26).** L3's *"mark every side-effectful capability
non-model-invocable"* is replaced by **gate the mutation, not the dispatcher**. `db-migration` is
red-tier and stays model-invocable; the apply is gated by `.claude/hooks/block-destructive-sql.sh`
(hardened in `21e0b86`: 8 SQL-reaching tools, fail-closed, node-parsed, `ROLLBACK` section required)
plus a separate owner authorization. Locking the dispatcher would have cost working overnight
autonomy while doing nothing about the step that touches production.

**Process lesson, for any future planning brief.** Four adversarial reviewers missed this because
nothing in the plan looked at unmerged branches. **Search unmerged branches for an existing
implementation before designing one** — `CLAUDE.md:74-77` already requires it, and the recovered
`masterplan` neutral source states it directly: *"Finish already-started work before inventing a
replacement."* That text was not on `dev` when this plan was generated.

### L0/L1 status — P1, P2 and P3 LANDED 2026-07-26

`AGENTS.md` is the shared law core (P1), `CLAUDE.md` line 1 is `@AGENTS.md` (P2), and **the duplicate
is gone (P3, `89c9432a`)** — `AGENTS.md` is now the sole carrier of rules 1–12. Evidence and the full
no-weakening coverage table: [`docs/agent-alignment-l0-coverage.md`](agent-alignment-l0-coverage.md).

**P3's gate was met, but not by the test this plan specified.** The anchor-token canary proved
unrunnable: a compaction summary can carry the token forward, so a session's quote is a contaminated
self-report. What answered it was the P7 instrument reading the loader's own record — across a real
`/compact`, `AGENTS.md` reloaded with `reason=include, parent=CLAUDE.md`, alongside all 23 unscoped
rules files. `node scripts/instructions-loaded-report.mjs --assert-core` → PASS.
Details: [`docs/agent-alignment-l2-evidence.md`](agent-alignment-l2-evidence.md) §4b.

Two knock-on results:

- **Ledger #11 is now measured, not argued.** 23 of 23 rules reload at compaction *because they are
  unscoped*. Scoping `database-standard.md` would drop the shared-production apply gate at every
  `/compact`. P9 must keep it unscoped.
- **Coverage §5's delete-list had a self-contradicting row** (`## Deployment & Release Workflow` is
  an anchor target for Rule 4 and cannot be deleted). Corrected in place. The general rule: when a
  block's heading is an anchor target, carry the prose into the core and **keep the heading**.

**P7 is partially landed:** the `InstructionsLoaded` recorder, the reporter with `--assert-core`, and
the empirical baseline exist and are wired. The glob linter and the four glob refutations in
`agent-alignment-l2-evidence.md` §5 are still UNMEASURED — P8/P9 must not start on belief.

**Superseded by owner direction (2026-07-26): the byte budget is not a target.** Challenge finding
P-1 set 22,000 B / 26,000 B ceiling; the brief for session 4 said 8–12 KB. The owner asked whether
either limit was real. It is not — the **only** hard mechanism is Codex's `project_doc_max_bytes`,
whose 32,768 default drops the chain's tail silently, and this phase raised it to 65,536 in the new
tracked `.codex/config.toml`. Both prose targets were self-imposed. **Write the law complete and
dense; let the size be an outcome.** Landed at 25,325 B with ~40 KB of headroom. The real cost of a
long instruction file is attention dilution, which argues for density — never for compressing law,
which the initiative's constraints forbid outright.

Current state and the ordered next steps live in
[`docs/handoff/agent-alignment-session-4-handoff.md`](handoff/agent-alignment-session-4-handoff.md).

---

## §0 Outcome and scope

**Target architecture (five layers).**

| Layer | What it is | Claude mechanism | Codex mechanism |
|---|---|---|---|
| **L0** | One shared neutral core of law both tools load automatically | `AGENTS.md` reached by a first-line `@AGENTS.md` import in `CLAUDE.md` | `AGENTS.md` natively, at the git root |
| **L1** | Thin per-tool routing below the core | `CLAUDE.md` below the import; `.claude/settings.json` | a tracked `.codex/config.toml` |
| **L2** | On-demand depth — **asymmetric by necessity** | `paths:` frontmatter on `.claude/rules/*.md` | a root **pointer table** (primary) + nested `AGENTS.md` (belt only) |
| **L3** | Single-source capabilities | `.claude/skills/`, `.claude/agents/` as canonical bodies | generated pointer adapters in `.agents/`, `.codex/agents/` |
| **L4** | Handoff + close-out contract + mechanical invariant guard | one extended `close-out-standard.md`, one handoff schema, one CI guard | same artifacts, plus `codex review` as an independent reviewer |

**Explicitly NOT in scope.** Not a rewrite of any rule's substance. Not a renumbering of `CLAUDE.md` rules 1–12 (they carry live references). Not a change to any **active** ownership manifest's §2 ownership matrix. Not an adapter *generation* project beyond the thin pointer adapters `tooling-governance.md` §7 already sanctions. Not a change to Rule 4 or Rule 6 (both explicit owner decisions — see ledger #15). No migration authored or applied; no provider, deployment, credential, or live-database action.

**The single load-bearing constraint on the whole design.** Safety-critical law must be **UNSCOPED at the root of the shared core**. `paths:`-scoped rules and nested `CLAUDE.md`/`AGENTS.md` files are dropped at `/compact` until a matching file is read again. So money, consent/TCPA, shared-Supabase apply-gate, server-side-authorization and never-push-`main` law can never live behind a glob or in a subdirectory file. Only reference depth may be scoped.

**The second constraint, which fixes the phase order.** Safety-critical law may never be unenforced even transiently. Therefore: the L0 core is authored **additively** while all 23 rules stay unconditional; the duplicate is deleted only after the bridge is proved to survive compaction; and mixed rules files are scoped **one at a time**, each only after its own safety fragment exists at L0 and has been observed to load. Batching is forbidden, and there is no way to make a batched conversion of a mixed file safe.

---

## §1 Verified current state

Measured this session at the repo root unless marked otherwise.

**Root instruction files** 🟢
- `CLAUDE.md` 30,774 B / 250 lines. `AGENTS.md` 12,418 B. Combined 43,192 B against Codex's documented `project_doc_max_bytes` default of 32,768 — a naive merge sits past the cliff, and Codex drops the **tail** with no warning.
- `CLAUDE.md`'s `## ⚠️ NON-NEGOTIABLE RULES` section is **3,283 B** and contains exactly **12** numbered rules (`awk '/^## ⚠️ NON-NEGOTIABLE RULES/,/^## How we work/' CLAUDE.md | wc -c`).
- There is **no** `@`-import anywhere in either file today, so the bridge mechanism is unproven in this repo.

**The rules directory** 🟢
- 23 files, **210,784 B**, **2,977 lines** (`wc -c .claude/rules/*.md`). **Zero** use `paths:` frontmatter, so all 210.8 KB enters every Claude session unconditionally, at the same priority as `CLAUDE.md`.
- Largest: `motion-standard.md` 26,649 · `crm-wave-ownership.md` 24,296 · `sms-experience-wave-ownership.md` 23,321 · `messaging-transport-wave-ownership.md` 15,250.
- **8 of 23** carry a `Last verified` stamp in their header (first 12 lines), across **three** spellings: 6× `**Last verified:**`, 1× `**Last-verified:**`, 1× bare `Last-verified:`. `documentation-standard.md` — which mandates the stamp — carries none.
- Two files auto-load but bind nothing: `admin-mobile-wave-ownership.md` (358 B, a tombstone whose own text says "it binds no active session") and `upr-engineering-foundation-wave-ownership.md` (8,302 B, whose first line reads "DRAFT FOR OWNER REVIEW … not binding project law until the owner explicitly adopts it").

**Capabilities** 🟢
- Claude: 24 skill directories, 15 subagents — both **tracked**. Codex: 51 `.agents/skills`, 30 `.codex/agents/*.toml` — both **untracked** (`git ls-files .agents` → 0, `git ls-files .codex` → 0, and neither is gitignored). A Codex cloud session or the Codex-hosted PR reviewer checks out the committed tree only, so those 81 entrypoints do not exist there and nothing reports it.
- 31 `.agents/skills/seo*` + 18 `.codex/agents/seo*.toml` are live for Codex; Claude has zero. `tooling-governance.md` §5 records the owner retiring exactly "31 tracked SEO skill bundles and 18 tracked SEO agent entrypoints" on 2026-07-23 — realised only for the tracked `.claude` copies.
- `.claude/tooling-governance.json` → `trackedInventory` = `{skills: 24, agents: 15, rules: 23, hooks: 2}`, `asOf 2026-07-23`. This is the **mechanically enforced** counter (`validateInventoryCounts` compares it by exact equality against `git ls-files`); `docs/tooling-governance.md` §1's prose stamp is not. `npm run validate:tooling` is currently green.

**Hooks and permissions** 🟢
- `.claude/hooks/block-secrets.sh` 3,207 B vs `.codex/hooks/block-secrets.sh` 2,569 B — the Codex copy is missing the entire literal `Authorization: Bearer|Basic` credential check added 2026-07-23. `block-destructive-sql.sh` is 2,725 B in **both** trees (identical), which proves the divergence is copy-drift, not a fork.
- `${CLAUDE_PROJECT_DIR}` appears 4× in `.claude/settings.json` and 2× in `.codex/hooks.json` (a variable Codex never sets). `.codex/hooks.json` also hardcodes a Windows absolute path.
- `.codex/config.toml` **does not exist**, so there is no Codex config layer at all today — `features.hooks` is unset, and whether either `.codex` PreToolUse hook currently fires is unknown.
- `.claude/settings.json` `permissions.deny` has 13 entries. It denies `git push --force`/`-f` but has **no** entry for a plain `git push origin main`, no `.env` read/edit deny, and no `apply_migration`/`execute_sql` deny.
- **Deny/alias drift (new finding).** The destructive MCP denies are keyed to aliases `mcp__UPR_MCP__*`, `mcp__github__*`, `mcp__Gusto__*`. The live servers in session are `mcp__c6f3f344-…` (UPR) and `mcp__1cd66b34-…` (Supabase). So `upr_sql` (free-form SQL on the shared production project), `upr_update`, `upr_delete`, `upr_insert`, `upr_upsert`, `upr_rpc`, `github_commit_file`, `github_merge_pr` and `github_request` are live with **no matching deny**. The PreToolUse regex matcher `mcp__.*__(apply_migration|execute_sql)` survives id churn but covers only those two tools.
- **CAP-SEC-001 is wider than recorded.** The **tracked** `.claude/settings.local.json` has 121 `permissions.allow` entries and **no `deny` key**. Among them: `apply_migration`, `execute_sql`, `Bash(git push *)`, `Bash(git add *)`, `Bash(git commit -m ' *)`, `Bash(gh pr *)`. So publication to `dev` and shared-production apply are both pre-approved, in a file that ships to every clone.

**Platform** 🟢
- `claude --version` → **2.1.85**. The installed bundle *does* contain `InstructionsLoaded` (with `load_reason ∈ {session_start, nested_traversal, path_glob_match, include, compact}`), `path_glob_match`, `claudeMdExcludes`, `disable-model-invocation`, and *does* inject `CLAUDE_PROJECT_DIR` into the hook environment. It does **not** contain `/goal` or `skillListingBudgetFraction`. 2.1.85 predates the `paths:` fixes at 2.1.207 / 2.1.211 / 2.1.217 — **present but unpatched is worse than absent** (see ledger #1).
- `codex` is not resolvable on PATH in the project shell, so **no Codex-side value in this plan was verified here**. 🔵
- win32. Claude Code has no OS-level sandbox on native Windows; Codex sandboxes natively. This asymmetry is inverted from intuition, and it means **sandboxing must never be listed as a Claude-side control on this platform**.
- 23 git worktrees are live (`git worktree list`), so filesystem isolation per phase is already the de facto practice.

**Repository shape** 🟢
- 239 `supabase/migrations/*.sql`; `functions/api/*.js` = 141 files of which 50 are `*.test.js`, so the real worker count is **91**; `src/pages/*.jsx` = 35; `src/pages/tech/*.jsx` = 21.
- One shared Supabase (`glsmljpabrwonfiltiqm`) behind **both** `dev` and `main`. A migration is live in production the instant it applies.

---

## §2 Status reconciliation — inherited figures that are wrong

Correcting an owner-authored or inherited number is a disclosure, never a silent edit.

| Claim as inherited | Measured | Verdict |
|---|---|---|
| "~1,178 cross-references"; "19× rule 14"; "10× rule 13" (original task prompt) | **209** rule references in the tracked non-vendor tree; exactly **one** genuine dangling reference | Inflated — the original count included untracked `.agents/`, vendor `.claude/skills/`, and `node_modules` |
| Dangling rule references | `documentation-standard.md:3` says "Linked from `CLAUDE.md` rule 14"; the Documentation Standard is **rule 12**. One further grep hit — `functions/api/transcribe-call.js:508` "owner rule 2026-07-22" — is a **date, not a rule number** and needs no edit | 1 real, 1 false positive |
| `.claude/rules/` total 209,774 B / 2,965 lines | **210,784 B / 2,977 lines** | Stale by 1,010 B; the whole delta is `close-out-standard.md`, which the design lanes recorded as 5,898 B and is **6,908 B** |
| `Last verified` stamp coverage 11/23 (ground phase) and 9/23 (a later count) | **8/23** by a header check (stamp within the first 12 lines), 3 spellings | Both inherited counts wrong; one of them also summed to 24 against 23 files |
| Worker count "~95 as of 2026-07"; `CLAUDE.md:165` derive-command `ls functions/api/*.js \| wc -l` | Command returns **141** because 50 files are `*.test.js`; real count **91** | The *command itself* is wrong, not just the number |
| `src/pages/` has 41 files; `src/pages/tech/` has 22 (`CLAUDE.md:134`) | **35** and **21** | Stale |
| "207 local migration files" (`CLAUDE.md`, 2026-07-22) | **239** | Stale |
| `docs/tooling-governance.md` §1 prose stamp is the inventory gate | The gate is `.claude/tooling-governance.json` → `trackedInventory`, compared by exact equality | **No phase in any design lane named the real file.** Corrected in §4 |
| "`${CLAUDE_PROJECT_DIR}` is unsupported at 2.1.85 and falls through to `.`" (one design lane) | The installed bundle **does** set it in the hook environment | Wrong; acting on it would have broken both live guards (see challenge report C-1) |
| "An unescaped `[` in a `paths:` glob silently matches nothing" | Bracket classes **work**; **brace groups** match nothing | Refuted — brace-free, not bracket-free, is the authoring rule |
| "`claudeMdExcludes` has no equivalent for `.claude/rules/`" | It **does** cover `.claude/rules/*.md` (the exclusion runs in the parser shared with `CLAUDE.md`) | Refuted |

**Not findings (verified safe).** `.claude/settings.json` contains no `Write(...)`, `Glob(...)` or `NotebookEdit(...)` permission rule — those spellings are accepted but never matched, so their absence is correct rather than a gap. `block-destructive-sql.sh` is byte-identical across both trees, so it needs no reconciliation. No ancestor `CLAUDE.md`/`AGENTS.md` exists above the repository and no `~/.claude/rules/` exists on this machine, so ancestor suppression is **preventive**, not a live defect.

---

## §3 Severity findings (live today, each with interim guidance)

**S1 — The Codex copy of the secret-blocking guard is 638 bytes short of the Claude copy, and the missing bytes are the whole credential check.**
*Mechanism:* `.codex/hooks/block-secrets.sh` is a frozen 2026-07-18 snapshot; the 2026-07-23 hardening added a literal `Authorization: Bearer|Basic <credential>` check that the Codex copy lacks. *Exposure today:* a credential pasted into a Codex-authored file passes a check the Claude side blocks. Aggravated by two probably-inert matchers — the secrets matcher is `Write|Edit` and omits Codex's primary edit tool `apply_patch`, and the SQL matcher uses Claude's `mcp__server__tool` naming, which is not established for Codex. *Interim guidance:* treat the Codex hook layer as **best-effort, not enforced**; do not report a Codex-side gate as held until a human has re-trusted the hook via `/hooks` and pasted an observed refusal. *Resolution:* P5.

**S2 — 81 Codex capability entrypoints do not exist in any cloud session, and nothing says so.**
*Mechanism:* `.agents/` and `.codex/` are untracked; a Codex cloud container checks out the committed tree. *Exposure today:* local Codex and cloud Codex behave differently with no signal; the Codex-hosted PR reviewer runs with zero repo subagents and zero repo skills. Worse, `.agents/skills/supabase/SKILL.md` is the **unpatched vendor original** that instructs the agent to use `execute_sql` / `supabase db query` so it "can iterate freely" — aimed at the one shared production database — while the Claude twin carries a mandatory UPR override the Codex copy lacks. *Interim guidance:* **fix, then track** — never track first. The commit that first makes these trees visible to cloud Codex must not also publish the unpatched supabase skill, the inert matchers, or 30 unpinned subagents. *Resolution:* P12 then P13.

**S3 — The two hardest prohibitions in project law are unenforced, and one of them is pre-approved.**
*Mechanism:* `CLAUDE.md` Rule 4 says "never push `main` directly"; there is no deny for a plain `git push origin main`, and Claude's auto mode allows pushing to any branch including the default. `close-out-standard.md` step 11 says publish only when requested; the tracked `settings.local.json` pre-approves `git add`, `git commit`, `git push` and `gh pr`. `database-standard.md` §0 forbids applying a migration without a fresh task-specific owner instruction; the same file pre-approves `apply_migration` and `execute_sql`. *Exposure today:* `block-destructive-sql.sh` is the **sole** surviving gate on the apply path (a PreToolUse exit 2 does beat an allow rule, because PreToolUse runs before permission evaluation) — one hook between a standing pre-approval and shared production. And per §1's alias drift, the free-form `upr_sql` tool has no deny at all. *Interim guidance:* until P6 lands, treat every publication and every apply as prose-governed and owner-gated; do not describe either as mechanised. *Resolution:* P6 + ledger #6 and #7.

**S4 — A mis-authored `paths:` glob deletes project law with no error message, on a build that predates the fixes for exactly that class.**
*Mechanism:* the loader treats a rules file as conditional iff it has surviving `paths:` entries; a glob that matches nothing means the rule loads **never**. The installed 2.1.85 predates 2.1.207 (one invalid pattern broke the Read tool for every evaluated file) and 2.1.217 (heavy brace groups could crash at startup). *Exposure today:* none — no file carries `paths:` yet. *Interim guidance:* do not add a single `paths:` block until ledger #1 is answered and a glob linter plus a per-file load-flip proof exist. *Resolution:* P7 gates P8/P9.

---

## §4 Cross-lane invariants every phase must honour

1. **`.claude/tooling-governance.json` → `trackedInventory` is the file of record for capability counts**, and it is compared by exact equality against `git ls-files`. Any phase changing a tracked entrypoint edits that JSON **and** the `docs/tooling-governance.md` §1 prose stamp, in the same commit, and states its expected 4-tuple. The counter is git-tracked-file-based, so an evicted-but-uncommitted file still counts — `ls .claude/rules/*.md | wc -l` and the validator's count are different instruments and must not be cited interchangeably. **Arithmetic ledger** (single owner: whichever phase runs, in this order):

| After phase | skills | agents | rules | hooks |
|---|---|---|---|---|
| baseline | 24 | 15 | 23 | 2 |
| P6 (+1 publish hook) | 24 | 15 | 23 | **3** |
| P8 (evict 2 non-law manifests) | 24 | 15 | **21** | 3 |
| P11 (deprecation record only, no delete) | 24 | 15 | 21 | 3 |
| P14 → conditional delete of `admin-mobile-phase-reviewer` (ledger #14) | 24 | **14** | 21 | 3 |
| P15 (+`closeout` skill) | **25** | 14 | 21 | 3 |
| P16 (+`gauntlet` skill) | **26** | 14 | 21 | 3 |
| P18 (+`initiative-isolation.md`) | 26 | 14 | **22** | 3 |

2. **No byte constant is ever hardcoded in a guard.** Every arithmetic assertion is self-referential — e.g. `sum(all rules bytes) == sum(scoped) + sum(evicted) + sum(deferred) + sum(unscoped)` — which holds regardless of any file's size. A dated baseline may be *reported* as a non-failing drift line. Rationale: a hardcoded 209,774 would have failed on arrival (§2) in a way indistinguishable from the loss it exists to detect.
3. **One writer per file, per commit.** The root pair (`AGENTS.md` + `CLAUDE.md`), `.claude/settings.json` `permissions`, `.claude/hooks/**`, `.codex/hooks.json`, `.codex/config.toml`, `.codex/rules/**`, `.claude/tooling-governance.json` and `.claude/rules/close-out-standard.md` each have exactly one owning phase. The manifest DRAFT §2 is authoritative on this.
4. **A precondition stated in prose must also be a dependency edge.** No phase may cite a gate it does not depend on.
5. **A mid-session edit to `CLAUDE.md`, `AGENTS.md`, a `SKILL.md` or a settings file does not take effect until `/clear`, `/compact` or restart.** Every verification runs in a session started *after* the edit. No report may contain "rule updated and followed" from one session.
6. **`.claude` is a Claude protected path.** Legitimate edits prompt; `permissions.allow` cannot pre-approve them. Phases touching 17+ rules files therefore **cannot run headless**. Every negative-breakage fixture is built in a temp directory outside the repo, never by planting a real ancestor file.
7. **A guard that has only ever passed on a healthy tree has not been verified.** Every new assertion ships with a deliberate-breakage test that observes the non-zero exit and names the rule.
8. **Exit 1 is NON-blocking in both tools; only exit 2 blocks.** A guard that dies under `set -e`, is unresolvable (exit 127), or is CRLF-broken silently **permits**. Every guard wrapper must fail closed. In Codex, emitting `continue`/`stopReason`/`suppressOutput` from a PreToolUse hook *fails* the hook and Codex then continues the tool call.
9. **Publication posture, on every phase.** Nothing in this plan authorizes a commit, push, PR, deploy, migration apply, credential change, or provider action. Each is a separate owner-authorized delivery step. Any authorized PR is opened as a handoff, marked ready, and not merged, subscribed to, or babysat.

---

## §5 Phases, in dependency order

Status markers, when phases ship, are prepended **inside** the blockquote and are authoritative over the checkboxes: `✅ SHIPPED <date>` · `◐ PART APPLIED · REST STAGED` · `⚙️ HALF SHIPPED`. Checkboxes reconcile in **both** directions — nothing marked done to look finished, nothing finished left as todo, owner-blocked stays open with the reason in prose.

### Wave 0 — Preflight (no behaviour change)

#### P0 — Capability floor: measure what this machine can actually enforce

> **Branch:** session-assigned (illustrative: `agent-alignment/p0-capability-floor`) — cut from `origin/dev`.
> **Prerequisite:** none. This is the first phase.
> **Model · effort:** Sonnet · medium — measurement and one report script; no law moves.
> **Read scope:** this block + `AGENTS.md` + `CLAUDE.md` + `docs/tooling-governance.md` + this initiative's manifest DRAFT.
> **Close-out checklist**
> - [ ] `docs/audit/2026-07/evidence/agent-capability-floor.md` exists with one row per mechanism, each carrying a verdict from `{AVAILABLE, VERSION-GATED, UNSUPPORTED, UNPROBEABLE-HERE}` and a **non-empty evidence field containing a local command and its raw output**
> - [ ] `node scripts/qa/capability-floor.mjs` exits 0 and its JSON `installed_claude_version` equals the output of `claude --version`
> - [ ] `node --test scripts/qa/capability-floor.node-test.mjs` green, including the assertion that **no `AVAILABLE` row cites only a vendor URL** and that an absent binary yields `UNPROBEABLE-HERE` rather than a guessed value
> - [ ] `npm run validate:tooling` + `npm run test:tooling` green; `npx eslint scripts/qa/capability-floor*.mjs` clean (this phase adds JS, so lint **is** meaningful)
> - [ ] Experiments E1/E2/E3 (§6) are **authored** with empty result slots; the stricter reading binds until each slot is filled

**Scope:** owns `docs/audit/2026-07/evidence/agent-capability-floor.md`, `scripts/qa/capability-floor.mjs`, `scripts/qa/capability-floor.node-test.mjs`, one `package.json` script key (`validate:capability-floor`), and `docs/handoff/tooling-upgrade-decision.md`. Records, each with its command: the installed Claude version and which of `paths:`, `InstructionsLoaded`, `claudeMdExcludes`, `disable-model-invocation`, `/goal`, `skillListingBudgetFraction` the bundle contains; the four `${CLAUDE_PROJECT_DIR}` occurrences in `.claude/settings.json` and two in `.codex/hooks.json`, **with the corrected finding that 2.1.85 does inject that variable**; the absence of `.codex/config.toml`; `git grep -c model_instructions_file` = 0 as the baseline the L4 guard protects; the deny/alias drift from §1 including one **probe** of a denied-by-alias tool with the observed result pasted. **Deliberately NOT:** any edit to `AGENTS.md`, `CLAUDE.md`, `.claude/rules/**`, `.claude/settings.json`, `.claude/hooks/**`, `.codex/**`, `.claude/tooling-governance.json`, or any code path.

**Risk tier:** GREEN — read-only inspection plus new additive files.
**Size:** S.
**Rollback:** `git revert` one commit. Nothing references the new files at landing time; no permission, hook, rule or skill is registered.
**Named human check (owner-or-external, cannot be run here):** in a Codex session, `/status` and `codex doctor` output pasted, establishing (a) project trust for `.codex/` layers, (b) whether any managed/enterprise layer is in effect, (c) which `model_reasoning_effort` values the installed binary accepts, (d) whether `features.hooks` is on. Two facts are readable from disk and must be taken from there rather than routed to the owner: `~/.codex/config.toml` carries `trust_level` and a `[hooks.state]` table with a `trusted_hash` per `.codex/hooks.json` entry — record both, because **editing `.codex/hooks.json` changes its hash and silently de-trusts every entry.**

---

### Wave 1 — L0/L1: the shared core and the bridge

#### P1 — Author the L0 shared core in AGENTS.md (additive; nothing is deleted)

> **Branch:** session-assigned. **Prerequisite:** P0 merged.
> **Model · effort:** Opus · high — this is the standing-rule layer; a distortion here propagates to both tools and to every later phase.
> **Read scope:** this block + `AGENTS.md` + `CLAUDE.md` (in full) + `docs/tooling-governance.md` + `.claude/rules/{database-standard,close-out-standard,workers-standard,documentation-standard}.md` + the five send-path sections named below + this initiative's manifest DRAFT.
> **Close-out checklist**
> - [ ] `wc -c AGENTS.md` recorded raw. **Target 22,000 B or less, hard ceiling 26,000 B** — see the byte re-budget below
> - [ ] `grep -n "^## " AGENTS.md` matches the fixed ordered heading list, with `## Code Review Rules` **before** `## Depth map` and before `## Repository model`
> - [ ] **No-weakening coverage table** in the report: one row per L0 statement **and one row per CLAUDE.md block that P2/P3 will later delete**, each citing source file + line, each verdict in `{verbatim, distilled-same-strength, STRICTER}`. **Zero rows may read `weaker`; zero rows may have destination `none`.**
> - [ ] Rules 1-12 present **verbatim**, proven by `diff` against `git show HEAD:CLAUDE.md`; numbering 1..12 with no gaps and no 13+; each carries a unique `[rule:<slug>]` token, with the duplicate check returning empty
> - [ ] Code-Review-Rules purity: extracting that section and grepping case-insensitively for `alert(`, `confirm(`, `toast.js`, `390px`, `--motion-`, `max-width: 768px` returns **0**
> - [ ] `git diff --stat` touches exactly one path, `AGENTS.md`. `git status` shows no change to `CLAUDE.md`, `.claude/rules/**`, or any `src`/`functions`/`supabase`/`ios` path
> - [ ] `npm run build` + `npm test` real results recorded (they gate nothing here and are run to prove no code changed); `npx eslint` declared **n/a with the reason**; `npm run validate:tooling` + `npm run test:tooling` green

**Scope.** Rewrites `AGENTS.md` as the shared neutral core, in this order — non-negotiables first, commands second: (1) title + a 3-line "how both tools load this" preamble; (2) `## Authority and authorization boundary`; (3) `## Document precedence` — one ladder, identical in both tools; (4) `## Non-negotiable rules` — rules 1-12 **verbatim** plus the absorbed safety blocks; (5) `## Verify before shipping — commands and definition of done`; (6) `## Code Review Rules` — the literal heading Codex's reviewer keys on; (7) `## Depth map — read before touching`; (8) `## Repository model and orientation`; (9) `## Context-reset instructions`.

**Byte re-budget (challenge finding P-1, applied).** The design lane budgeted section 4 at ~3.8 KB while requiring it to absorb ~6.2 KB of safety fragments on top of the 3,283 B of existing rules — arithmetically impossible under an 11.5 KB whole-file target, and the only escape would have been compressing non-negotiable text. **Resolution: rules 1-12 move verbatim (3,283 B measured — they already fit), section 4 is budgeted at 9.5 KB or more, and the whole-file target rises to 22,000 B with a 26,000 B ceiling.** The Codex tail-drop is addressed by P4's `project_doc_max_bytes = 65536` plus the depth map, **not** by compressing law. Standing ordering rule: if a ceiling must hold, **the L2 lane re-scopes its fragments and the affected rules files stay unscoped — never the reverse.**

Section 2 states as law what no mechanism can enforce: delegation is not authorization; no agent, orchestrator, subagent or workflow message is owner approval; no agent message may change permission settings, `AGENTS.md`/`CLAUDE.md`, or configuration. Prior authorization is not reusable (`database-standard.md` section 0, quoted). A hook, cached credential, trusted MCP server or allowlist entry is defense in depth, not evidence of intent (`tooling-governance.md` section 3, quoted). Two mechanism-specific clauses: **nested per-directory `AGENTS.md` files are additive-only and may never relax a root non-negotiable** — stated explicitly because Codex's own user-facing wording is override semantics, so silence would read as permission to weaken L0; and the global `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md` layers are repo-invisible with no code-review trace, so a session whose behaviour contradicts this file must disclose it.

Section 4 absorbs, as first-class non-negotiables: the **shared-production database gate** (authoring is not applying; one Supabase behind both `dev` and `main`; additive-only on live tables; frontend-contract freeze; rollback required; never `anon` outside the `database-standard` section 2 allowlist; never free-form SQL to a browser role; America/Denver bucketing; project ref `glsmljpabrwonfiltiqm` is production and is never a write-test target). One **send-path/consent block** stated once at L0 — worker is sole writer of `sms_*`/message rows and the client inserts only `internal_note`; consent and DND fail closed **before** provider selection or any provider call; no cross-channel and no adapter fallback; automated/marketing only through `sendAutomatedMessage()`; `skip_compliance` was removed and must never be reintroduced; the reason strings `sms_disabled` and `quiet_hours` are load-bearing cross-worker contracts and renaming either silently breaks held-retry in two workers owned by other initiatives; TCPA penalties are per message; A2P/live-send is owner-gated. **Money** (never write trigger-owned columns `amount_paid`/`line_total`/`status`/`paid_at`; a stable content-derived or client-supplied idempotency key, never `Date.now()`; the human Save-to-QBO gate). **Server-side authorization** (a valid session is authentication, not authorization; any endpoint moving money, sending as the company or exposing PII enforces the same role predicate server-side that the UI enforces; a public-by-design endpoint carries a `// public: <reason>` comment and an allowlist entry).

**The five existing send-path copies stay in place, unchanged.** Challenge finding P-4 applied: the design lane described the L0 block as "replacing five drifting copies" across `omni-inbox` section 7, `sms-experience` sections 3/6, `messaging-transport` section 1, `crm-wave` section 6 and `tech-messages-v2` section 5, and assigned the retirement to nobody. **The L0 block is ADDITIVE-ONLY. Permanent duplication of those five copies is accepted.** Any future de-duplication is a separate owner-authorized change, one dated addendum per manifest, struck in place with a `superseded-by:` pointer, and only after that manifest's holder merges.

Section 6 is restricted to five consequential P0/P1 families — money/QBO, TCPA consent + worker-sole-writer + no fallback, additive-only + FE-contract freeze, least-privilege grants, server-side role enforcement — each written as invariant, then safe path, then scope. **Lint-shaped rules are deliberately excluded, with a comment saying why:** Codex flags only P0/P1 there, so a no-`alert()` / toast-entry-point / 390px / motion-token rule placed in that section would silently never surface, and eslint plus the changed-files ratchet already enforce them at true parity.

Section 7 is a **pointer table**, because Codex's nested-`AGENTS.md` walk goes git-root to cwd and stops, so nested files fire for nobody in a root-launched session. Rows include a `Runbooks` row (an incident-driven document cannot be reached by a read-trigger — nobody opens `TechDemoSheet.jsx` first when the Scope Sheet is broken in production) and a row for `documentation-standard.md`'s JS/JSX header template (challenge finding P-11: without it, scoping that file makes Rule 12 unreachable for the files it governs).

Section 8 keeps `AGENTS.md`'s accurate Repository model block and adds the pointers absent from the law layer (`.dev.vars.example`, `docs/database/`, `db/baseline/` plus `scripts/db-drift-check.mjs`, `upr-mcp/`, `docs/tooling-governance.md`, `docs/upr-figma-governance-and-handoff.md`, `docs/upr-engineering-foundation-dispatch.md`), carries derive-it commands rather than hand-counted figures, and routes Codex to `CLAUDE.md`'s tool-neutral project-knowledge sections by name as targeted reference reads — replacing today's blanket "read `CLAUDE.md` completely" so **no knowledge Codex has today is lost**.

**Deliberately NOT:** any edit to `CLAUDE.md`, `.claude/rules/**`, `.claude/settings.json`, `.gitignore`, `.claude/tooling-governance.json`, or any code path. No rule renumbered. No ownership matrix touched.
**Risk tier:** RED — authors the standing-rule layer. `tooling-governance.md` section 3 Red; the db-foundation autonomy ledger independently classes any `CLAUDE.md` standing-rule change as RED. Stage the diff and wait for the owner's OK. No live, provider or database action occurs.
**Size:** L.
**Rollback:** `git checkout HEAD -- AGENTS.md` or `git revert`. Unusually safe **because the phase is additive**: `CLAUDE.md` still carries rules 1-12 and all 23 rules files still load unconditionally, so reverting leaves every non-negotiable enforced exactly as today. There is no window in which law is absent.

#### P2 — Bridge only: `@AGENTS.md` first line, with the CLAUDE.md duplicate KEPT

> **Branch:** session-assigned. **Prerequisite:** P1 merged.
> **Model · effort:** Opus · high — the bridge is unproven in this repo on this build.
> **Read scope:** this block + `AGENTS.md` + `CLAUDE.md` + the P1 report.
> **Close-out checklist**
> - [ ] `head -1 CLAUDE.md` is exactly `@AGENTS.md`
> - [ ] `test -L CLAUDE.md` false **and** the git index mode for `CLAUDE.md` is `100644`, not `120000` — proving no symlink was committed. Rationale: Git for Windows sets `core.symlinks=false`, so a committed symlink checks out as a plain text file whose entire content is the string `AGENTS.md` — the canonical silent "the rules stopped working"
> - [ ] `## NON-NEGOTIABLE RULES` is **still present in `CLAUDE.md`** — deliberate duplication, verified by grep
> - [ ] **Cold-session load proof, both tools.** A unique canary token planted in `AGENTS.md` section 2 (uniqueness asserted by a repo-wide grep returning 1) is quoted back by a **fresh** Claude session and a **fresh** Codex session, each with zero file reads. Primary Claude instrument: `/context` showing `AGENTS.md` under Memory files; the canary is the fallback if 2.1.85 does not surface it
> - [ ] The report states plainly that Codex exposes no loaded-doc introspection and no truncation warning, so the Codex side is canary-and-byte-count verified only. **Any claim of verification parity between the two tools fails this phase**
> - [ ] `npm run build`, `npm test`, `npm run validate:tooling`, `npm run test:tooling` real results; `npx eslint` n/a with the reason

**Scope:** `CLAUDE.md` line 1 becomes exactly `@AGENTS.md` — not a symlink, never a committed symlink. Adds **one redirect line** in the routing block, load-bearing for the 209 live references: the numbered non-negotiables live in `AGENTS.md`, imported above, numbering frozen, and a reference of the form "CLAUDE.md Rule N" resolves there. Without that line, a reader following an existing pointer opens `CLAUDE.md`, sees an import, and concludes the rule was deleted. Adds the Claude-only mechanism notes that are silent divergences if unstated: `.claude/rules/*.md` load unconditionally at launch at the same priority as `CLAUDE.md`; `paths:`-scoped rules and nested `CLAUDE.md` are lost at `/compact`, so a non-negotiable must never live in either; `claudeMdExcludes` exists for staged migration and ancestor suppression; `.claude` is a protected path so prompts are correct behaviour and `permissions.allow` cannot pre-approve them; skills are `/name` here and `$name` in Codex, and a skill's slash command comes from the **directory** name, not frontmatter `name`; `claude -p --bare` skips hooks, skills, plugins, MCP, auto memory **and `CLAUDE.md`**, so any future CI gate written that way is bound by no project law unless the core is passed via `--append-system-prompt-file`.
**Deliberately NOT:** no deletion from `CLAUDE.md`. No `.codex/**`. No `permissions` edit. No `.claude/rules/**`.
**Risk tier:** RED — edits the root law bridge. Stage and wait for the owner.
**Size:** S.
**Rollback:** `git checkout HEAD -- CLAUDE.md`. Because the duplicate was kept, a revert removes only the import and leaves law fully present. **Fails toward duplication, never toward absence.**

#### P3 — Prove the import survives `/compact`, then delete the CLAUDE.md duplicate

> **Branch:** session-assigned. **Prerequisite:** P2 merged **and** its cold-session canary green in both tools.
> **Model · effort:** Opus · high — this is the commit after which `AGENTS.md` is the sole carrier of all 12 non-negotiables.
> **Read scope:** this block + `AGENTS.md` + `CLAUDE.md` + P1's coverage table + P2's canary transcripts.
> **Close-out checklist**
> - [ ] **POST-COMPACT CANARY (the gate that makes this phase safe).** In a Claude session with real work in it, run `/compact`, then require the `AGENTS.md` canary token to still be quotable with **zero file reads**, and inspect the `InstructionsLoaded` log (from P7 if landed, else the canary alone) for an `AGENTS.md` entry whose `load_reason` is `session_start` or `include` with `parent_file_path` = `CLAUDE.md`. **If the import does not survive compaction, this phase does not proceed:** the non-negotiables stay in `CLAUDE.md` permanently, the L0 core becomes Codex-only, and that outcome is recorded rather than forced
> - [ ] Only after the above: `## NON-NEGOTIABLE RULES` and the other blocks P1's coverage table assigned a destination are removed from `CLAUDE.md`. **Every deleted block is enumerated one-by-one in the report against its coverage-table row**
> - [ ] `CLAUDE.md:74-77`'s standing rule ("Before starting a new initiative, inspect existing roadmaps, feature flags, stubs and ownership manifests for overlapping or unfinished work... A foundation is not complete when only tokens, primitives, routes, schema or stubs exist") is **verified present in `AGENTS.md`** by a fixed-string grep before deletion. Challenge finding P-2: it is absent from `AGENTS.md` today (grep for "parallel implementation", "overlapping or unfinished", "foundation is not complete" returns 0 hits) and the design lane's keep-list omitted it, so deleting on the strength of "the precedence section owns precedence prose" would have left it enforced nowhere in either tool
> - [ ] The `### Task-specific foundation reading` table (`CLAUDE.md:56-77`) is either moved into `AGENTS.md` section 7 or **left in `CLAUDE.md` below the import** — not deleted
> - [ ] Rule-reference resolvability spot-checked by a **human** against the four densest targets (rule 2 at 217 uses, rule 7 at 204, rule 9 at 199, rule 4 at 187): open `CLAUDE.md`, follow the redirect line, find the rule by number **and** by slug
> - [ ] No-knowledge-lost checklist: every `CLAUDE.md` section Codex previously received via "read CLAUDE.md completely" mapped to its new home — L0 section 4 (law), section 8's targeted-reference row, or section 7's depth map. None silently orphaned
> - [ ] Standard gates as P1; `npx eslint` n/a with the reason

**Scope:** the deletion, the redirect line's final wording, and the block-by-block accounting. `CLAUDE.md` retains: the skill/subagent jurisdiction and precedence table, Local Dev & UI Verification, Stack, DB Client API, AuthContext, File Structure, Workers, Patterns to Follow, What NOT to Touch, Task File Protocol, CRM Phase Workflow, and the foundation-reading table unless moved.
**Deliberately NOT:** no renumbering. No `.claude/rules/**`. No `permissions`. No ownership matrix.
**Risk tier:** RED.
**Size:** M.
**Rollback:** `git revert` restores the full non-negotiables section, after which law is present in **both** `AGENTS.md` and `CLAUDE.md` rather than neither. **Rollback order is fixed:** if both P3 and P1 are being unwound, revert P3 first — reverting P1 while P3 has already deleted the duplicate is the one sequence that leaves law absent.

#### P4 — Per-tool routing: the first Codex config layer, ignores, and the permission surface

> **Branch:** session-assigned. **Prerequisite:** P2 merged (the import exists). Independent of P3.
> **Model · effort:** Opus · high — it edits the shared permission surface and creates the layer that switches Codex hooks on.
> **Read scope:** this block + `.claude/settings.json` + `.claude/settings.local.json` (read-only) + `.gitignore` + `docs/tooling-governance.md` sections 1, 3, 6 + P0's evidence file.
> **Close-out checklist**
> - [ ] `.codex/config.toml` exists, tracked, containing `project_doc_max_bytes = 65536` and `[features] hooks = true`. **This phase is the sole owner of that file and it lands FIRST among all Codex-side changes**, because `features.hooks` is the precondition for every Codex hook probe in P5/P12 — without it, those phases would measure a switched-off hook layer and misreport it as a matcher defect
> - [ ] In-file comments record three deliberate absences so a later session cannot "helpfully" add them: no `project_doc_fallback_filenames = ["CLAUDE.md"]` (it fires only when `AGENTS.md` is *missing* at that level, so with `AGENTS.md` present at the git root it is a silent no-op, not a reverse bridge); no `model_instructions_file` or `experimental_instructions_file` (they **replace** the `AGENTS.md` path rather than layering, so a stale value in any Codex layer silently bypasses the entire L0 law); and none of `profile`, `profiles`, `model_provider`, `model_providers`, `notify`, `otel` or the auth/base-URL keys, which a project-scope config may not override — relevant here because the user layer already sets `notify` and `model_reasoning_effort`
> - [ ] `git check-ignore -v AGENTS.override.md CLAUDE.local.md` prints a matching line for each, and no such file is tracked. `AGENTS.override.md` wins at its own level, so a committed one would silently outrank shared law for everyone
> - [ ] `permissions.deny` additions land, using **only** the `Read(...)` and `Edit(...)` spellings: `Read(.env)`, `Read(**/.env*)`, `Edit(.env)`, `Edit(**/.env*)` — **both** spellings explicitly, because 2.1.85 predates the 2.1.208 read-deny-covers-Edit behaviour. A grep for `Write(`, `NotebookEdit(` or `Glob(` permission rules returns 0
> - [ ] **Regex, not alias, for destructive MCP tools (challenge finding S-3, applied).** The existing PreToolUse matcher is extended to `mcp__.*__(apply_migration|execute_sql|upr_sql|upr_update|upr_delete|upr_insert|upr_upsert)` routed to `block-destructive-sql.sh`, and a second matcher `mcp__.*__(github_commit_file|github_merge_pr|github_request)` routed to P6's publish guard. Rationale: the 13 literal denies are keyed to server **aliases** that do not match the live server ids, so `upr_sql` — a free-form SQL tool on the shared production project — is live with no deny today. Regex matchers survive server-id churn; literal denies do not
> - [ ] Whether `apply_migration` is additionally denied by name is **ledger #6**; if `execute_sql` is denied without it, the report states that the surviving pre-approved path is `apply_migration`, whose guard by design permits additive DDL — so a change intended to increase enforcement would make an un-gated additive live schema change *more* likely (challenge finding S-4)
> - [ ] `codex --strict-config` and `/status` output pasted, showing whether `project_doc_max_bytes` and `[features] hooks` are honoured **at project scope**. If not, the pin stays as documented intent and is explicitly labelled non-load-bearing; the P1 byte budget then becomes the sole protection against the tail-drop (owner-or-external)
> - [ ] Standard gates; `npx eslint` n/a with the reason
> - [ ] The report states, without changing them, the **full** CAP-SEC-001 inventory from section 1 — including `Bash(git push *)`, `Bash(git add *)`, the `git commit -m` prefix rule, and `Bash(gh pr *)` — and labels publication to non-`main` refs **PROSE-ONLY, NOT ENFORCED** (challenge finding S-6)

**Scope:** owns `.codex/config.toml` (net-new) and **all** `.claude/settings.json` `permissions` edits for this initiative. `.gitignore` gains two lines.
**Deliberately NOT:** `.codex/hooks.json`, `.claude/hooks/**`, `.codex/hooks/**`, `.codex/rules/**` (all P5/P6). No skill or agent frontmatter. No `.agents/**`. No change to `.claude/settings.local.json` — that is ledger #6, an existing owner gate.
**Risk tier:** RED — permission change is explicitly section 3 Red. **This phase stages the diff and waits for separate owner authorization.**
**Size:** M.
**Rollback:** per-file and independent: remove `.codex/config.toml`, restore `.gitignore` and `.claude/settings.json`. Every item is additive enforcement, so a revert is a pure loosening back to today's posture and cannot break a workflow that worked before.

---

### Wave 2 — Gates: make the two guards real and the two prohibitions enforced

#### P5 — One canonical guard body per gate, invoked by both wirings, failing closed

> **Branch:** session-assigned. **Prerequisite:** P4 merged (`[features] hooks = true` must exist before any Codex hook probe is meaningful).
> **Model · effort:** Opus · high — it changes two live safety controls on a shared production surface.
> **Read scope:** this block + `.claude/hooks/*.sh` + `.codex/hooks/*.sh` + `.codex/hooks.json` + `.claude/settings.json` + `docs/tooling-governance.md` sections 1 and 3 + `.claude/rules/workers-standard.md` section 1.
> **Close-out checklist**
> - [ ] **STEP 0, before any edit:** `.agents/` and `.codex/` are copied to a timestamped backup directory **outside** the repository and its absolute path recorded in the report. Mandatory and non-obvious: both trees are untracked (0 tracked files, neither gitignored), so `git revert` **cannot** restore them and that backup *is* the rollback for the untracked half
> - [ ] `node scripts/agent-hooks/run-gate-probes.mjs` exits 0: every expected-block fixture returns exit 2 **and every benign control returns 0**. The control half matters as much as the blocking half — a guard that also fires on `.env.example` gets disabled by the next frustrated session
> - [ ] **FAIL-CLOSED PROOF.** With `PATH` broken so `jq` is unavailable, a bearer-credential fixture still returns **2**, not 0. And with the guard made unresolvable, the **wrapper** returns 2. Rationale (challenge finding C-1): `cd src && bash ./.claude/hooks/block-secrets.sh` currently returns **exit 127**, and 127 is not 2, so both guards are silently ABSENT for any session whose cwd is not the repo root
> - [ ] **`${CLAUDE_PROJECT_DIR}` is KEPT, not removed.** The design lane proposed replacing it with in-script `git rev-parse` on the stated grounds that 2.1.85 does not support it. That is **false** — the installed bundle injects it into the hook environment, and a sibling lane recorded the correct fact. In-script resolution cannot help anyway, because the failure happens *before* the script runs. The wrapper form is: resolve `$CLAUDE_PROJECT_DIR`, fall back to `git rev-parse --show-toplevel`, and if the guard file is still not found, **print a reason to stderr and exit 2**
> - [ ] `.gitattributes` gains `*.sh text eol=lf` in the **same commit**. With `core.autocrlf=true` and `* text=auto`, a new guard script checks out CRLF, and a CRLF parse break is exit-not-2, i.e. fail open
> - [ ] Every internal failure path exits 2. No `set -e`. No `continue`/`stopReason`/`suppressOutput` key anywhere (in Codex those *fail* the hook and Codex then continues the tool call — a cosmetic key turns a block into an allow). Verified by three greps returning 0
> - [ ] **Ordering, applied from challenge finding S-8.** (1) Repoint `.codex/hooks.json` at `.claude/hooks/*` through the fail-closed wrapper, widen the secrets matcher to `apply_patch|Edit|Write` (Codex's primary edit tool is `apply_patch`, so the current `Write|Edit` matcher probably never fires on the main write path), add `commandWindows` siblings, drop the hardcoded Windows absolute path and the two `${CLAUDE_PROJECT_DIR:-.}` references, leaving both `.codex/hooks/*.sh` **in place as dead-but-harmless files**. (2) A human re-trusts via `/hooks` and pastes an observed `.env`-write refusal **and** an observed bearer-credential refusal. (3) Only after step 2's transcript exists, delete `.codex/hooks/*.sh` in a **follow-up commit** — and that deletion needs ledger #3 to include it explicitly, because a deletion is neither a repair nor an adapter
> - [ ] `.claude/settings.json` secrets matcher widened from `Write|Edit` to `Write|Edit|MultiEdit` (a MultiEdit secret write is unguarded today, though the sibling PostToolUse impeccable hook already matches MultiEdit)
> - [ ] `scripts/agent-hooks/check-codex-hook-trust.mjs` reads `~/.codex/config.toml`, recomputes each `.codex/hooks.json` entry's hash and asserts it matches the stored `trusted_hash` — turning "the owner re-trusts via /hooks" into a verifiable state check rather than a prose note
> - [ ] `npm run validate:tooling` + `npm run test:tooling` green; the tracked-inventory `hooks` count is **unchanged at 2** in this phase (bodies were collapsed, not added); `npx eslint scripts/agent-hooks/*.mjs` clean

**Scope:** `.claude/hooks/block-secrets.sh` remains the single canonical body (it is the hardened one, 3,207 B, carrying the credential check). `block-destructive-sql.sh` gains the same wrapper and trap; its body logic is unchanged because it is byte-identical across both trees. Owns `.codex/hooks.json`, `.gitattributes`, the two probe scripts, and the `.claude/settings.json` **hooks** block (not `permissions`, which is P4's).

**Collision resolved (challenge finding S-2).** Two design lanes claimed these three files with mutually exclusive designs — one restoring two synchronized copies, the other collapsing to one body — while a third lane deferred them to the first. **Resolution: the collapse-to-one-body design wins and this phase is its sole owner,** because it is the only design that prevents recurrence of the measured 2026-07-18/2026-07-23 drift. The parity-restoration bullet is deleted from the capability lane, which keeps only the `.agents/skills/supabase` override port, the six diverged skill bodies, the path-contamination fixes, and the `sandbox_mode` pins.

**Deliberately NOT:** `permissions` (P4). `.codex/config.toml` (P4). The publish guard (P6). Any skill or agent frontmatter.
**Risk tier:** RED — changes two secret-and-destructive-SQL guard controls and edits the tree `tooling-governance.md` section 1 currently declares untouchable. Read-only inspection and authoring are in scope; applying requires ledger #3 plus the owner's authorization of that delivery action.
**Size:** L.
**Rollback:** the tracked half reverts with `git revert`. The untracked half restores **only** from the step-0 backup. Restoring `.codex/hooks.json` or either script **re-arms Codex's per-hash hook-trust gate**, so the rollback runbook must end with a human `/hooks` re-trust — until that happens the restored hook is silently skipped, which would read as "rollback complete" while the guard is off.

#### P6 — Publish and apply hard gates: never-push-main becomes enforced, not merely written

> **Branch:** session-assigned. **Prerequisite:** P5 merged (the wrapper and fail-closed convention it establishes).
> **Model · effort:** Opus · high.
> **Read scope:** this block + `.claude/settings.json` + `.claude/rules/close-out-standard.md` step 11 + `CLAUDE.md` Rule 4 + `docs/tooling-governance.md` sections 3 and 6.
> **Close-out checklist**
> - [ ] `.claude/hooks/block-branch-publish.sh` exists as the **single** publish gate, resolving the actual ref rather than pattern-matching a literal: `git push origin main`, `git push -u origin main`, `git push origin HEAD:main`, `dev:main`, a bare `git push` resolved against `@{upstream}`, `git push origin HEAD` resolved against the current branch, leading env assignments, `--force`/`-f`/`--force-with-lease`, and the `bash -lc "<script>"` single-command form
> - [ ] `node --test scripts/agent-hooks/block-branch-publish.node-test.mjs` green over a table: `git push origin main`, `HEAD:main`, `dev:main`, bare `git push` with upstream main, `BRANCH=main git push origin $BRANCH`, `git push origin HEAD > log` each return **2**; `git push origin dev` and `git push -u origin claude/foo` each return **0**; and an induced internal error (git unavailable) still returns 2
> - [ ] **END-TO-END WIRING ASSERTION that no deny literal can satisfy (challenge finding S-5).** The design lane's prescribed test was `git push --dry-run origin main`, which (a) matches neither proposed deny spelling because the flag sits between `push` and `origin`, and (b) would be refused by the enumerated deny even if the hook were unwired, unexecutable, CRLF-broken or exiting 127. Replacement: in a live session run `bash -lc "BRANCH=main; git push origin $BRANCH --dry-run"` and require refusal, **and** require a sentinel line written by the hook to a gitignored log for that attempt — so "hook never ran" is mechanically distinguishable from "hook ran and allowed". The same sentinel is added to `block-secrets.sh` and `block-destructive-sql.sh`
> - [ ] **MANDATORY PRE-REGISTRATION GATE.** `run-gate-probes.mjs` must be green against the standalone script **before** the `.claude/settings.json` registration commit, and the phase must document a **non-Bash rollback** (Edit tool, then restart). Rationale: a fail-closed hook on matcher `Bash` with a parse bug blocks **every** Bash call after restart — including the `git revert` and `git checkout` both design lanes named as their rollback
> - [ ] **SUBAGENT COVERAGE PROBE (challenge finding S-9).** Dispatch a subagent instructed to run `git push origin main --dry-run`; require the hook's refusal **plus** the sentinel line. No phase in any design lane tested whether PreToolUse fires for subagent tool calls, and the entire publish gate plus both existing safety gates rest on PreToolUse. `impeccable-manual-edit-applier` is the one write-capable Claude subagent and its `tools:` list includes `Bash`, while `Bash(git push *)` is pre-approved in the tracked local settings — so if hooks do not fire in subagents, that subagent is an un-gated publish **and** un-gated secret-write path. If the probe fails, `Bash` is removed from that subagent's `tools:` rather than documented as deliberate
> - [ ] Enumerated `Bash(...)` push-to-main denies land as **belt only**, behind the hook, and are written to match flag-bearing forms. A broad `Bash(git push *)` deny is explicitly rejected: it cannot carry allowlist exceptions and would block the legitimate `git push -u origin <feature>` every handoff needs, and rule specificity does not reorder evaluation
> - [ ] `.codex/rules/upr.rules` execpolicy: `forbidden` for the push-to-main forms **plus the mandatory companion `bash -lc` rule** without which the no-split behaviour makes every rule trivially evadable; `forbidden` for `supabase db push` / `supabase db query`; `forbidden` for `rm -rf`; `prompt` for other pushes. Verified by `codex execpolicy check --pretty --rules .codex/rules/upr.rules -- git push origin main` **and** the same against `bash -lc "git push $BRANCH"` — both must report forbidden. If the preview CLI is unavailable on this box, say so rather than claim a green run (owner-or-external)
> - [ ] `docs/tooling-governance.md` gains a **dated section 8 addendum, appended, with sections 1-7 byte-unchanged** (`git diff --numstat` shows additions only, zero deletions). It carries: (a) the **gate-parity table** — TRUE PARITY = eslint/CI-enforced rules, because the gate is CI rather than the agent; CLAUDE-ENFORCED / CODEX-BEST-EFFORT = `.env` and secret blocking and self-config protection; ACHIEVABLE-OR-STRONGER ON CODEX = free-form SQL denial; **NOT MECHANISABLE IN EITHER TOOL** = the "fresh, task-specific, owner-not-agent authorization" check behind every apply/send/publish, which is prose forever and must therefore live UNSCOPED at the root of the shared core; and **PROSE-ONLY, NOT ENFORCED** = publication to `dev` and every non-`main` ref, naming the four `settings.local.json` allow entries as the reason. (b) The two fail-open traps written down where a future editor will hit them. (c) The platform inversion, with the standing instruction never to list sandboxing as a Claude-side control on win32
> - [ ] `npm run validate:tooling` + `npm run test:tooling` green with the tracked-inventory `hooks` count bumped **2 to 3** in `.claude/tooling-governance.json` and the section 1 prose stamp, in the same commit
> - [ ] `bash -n` passes on the new script; `npx eslint` n/a for the `.toml`/`.rules`/`.md` files with the reason stated

**Collision resolved (challenge finding S-3).** Two design lanes each created a publish gate — one named `block-branch-publish.sh`, one `block-unauthorized-publish.sh` — same function, same matcher `Bash`, near-identical test tables. If both landed, every Bash call would spawn two bash+git subprocesses, the hooks count would be 4, and each lane's "the gate fires" criterion would be satisfiable by the other's script. **Resolution: one gate, `block-branch-publish.sh`, owned here; the other is deleted from the plan.** Its lane keeps only a dependency on this phase.

**Deliberately NOT:** no change to `.claude/settings.local.json` (ledger #6). No change to Rule 4 or Rule 6 (ledger #15) — this gate enforces a clause Rule 4 **already states** and does not narrow it, which is why the non-blocking proof for `git push origin dev` is a named criterion. `permissions` edits beyond the enumerated push denies belong to P4.
**Risk tier:** RED — new enforcement on the publication path plus a `permissions`/execpolicy change. **Stages the diff and waits for separate owner authorization.**
**Size:** M.
**Rollback:** `git revert`. Every item is additive enforcement, so a revert loosens to today's posture. Expect a protected-path prompt when reverting `.claude/**` — that is correct behaviour. If the Codex execpolicy or hook wiring is reverted, a human `/hooks` re-trust is required before Codex hooks fire again.

---

### Wave 3 — L2: on-demand depth, asymmetric by necessity

#### P7 — Instrumentation, glob linter, and the empirical baseline (zero conversions)

> **Branch:** session-assigned. **Prerequisite:** P0 merged. Independent of Wave 1 and Wave 2.
> **Model · effort:** Opus · high — it edits `.claude/settings.json`'s hooks block, which carries the two live safety hooks.
> **Read scope:** this block + `.claude/settings.json` + `.claude/rules/` (frontmatter only) + P0's evidence file.
> **Close-out checklist**
> - [ ] **SETTINGS INTEGRITY — the constraint-7 gate for this phase.** `.claude/settings.json` parses as JSON, **and** both pre-existing PreToolUse hooks are proven still live by two deliberate triggers: an `Edit` on a scratch file containing a literal bearer credential must be blocked with the hook's stderr reason, and the destructive-SQL matcher must still appear in `claude -p --debug hooks` output. A malformed settings edit would silently disable `block-secrets.sh` — the one gate standing between the tracked `settings.local.json` `apply_migration` allow and shared production
> - [ ] `InstructionsLoaded` registered as **five separate entries, one per literal load reason** (`session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`) rather than a regex alternation: the reason-as-matcher contract is confirmed in the installed bundle but alternation support at this version is untested, and hook layers merge so all matching hooks fire
> - [ ] `scripts/agents/log-instructions-loaded.sh` uses `set +e` and an **unconditional `exit 0`** — InstructionsLoaded cannot block and its exit code is ignored, so a `set -e` death would be a silent logging no-op rather than a visible failure
> - [ ] **BASELINE.** After one `/clear` and one restart at the repo root, the JSONL contains exactly **23** `session_start` entries with `memory_type: "Project"` naming the 23 files in `.claude/rules/`, plus one for `CLAUDE.md`. This is the machine-readable baseline every later phase diffs against
> - [ ] **REAL TOKEN BASELINE (named human check).** `/context` is interactive-only at this version with no non-interactive equivalent, so a human runs `claude` at the repo root, issues `/context`, and pastes the verbatim Memory-files breakdown and total. `/usage` captured in the same session. **Every byte figure in this plan is a measured `wc -c`; every TOKEN figure must trace to one of the three `/context` captures (here, P8, P19) and may never be a chars/4 estimate.** `claude plugin details` does not appear as a literal in the 2.1.85 bundle and is recorded as unavailable rather than cited
> - [ ] **GLOB LINTER SOUND BEFORE IT IS TRUSTED.** `node scripts/agents/verify-rule-globs.mjs --self-test` reproduces the loader's pipeline as read from the bundle — strip a trailing `/**` from each entry, drop empties, and if every survivor is `**` treat the rule as UNCONDITIONAL, then match with gitignore semantics against repo-root-relative paths — and proves the four behaviours measured directly this session: `src/**/*.{js,jsx}` matches **neither** `src/pages/Foo.jsx` nor `src/pages/Foo.js` (brace groups match nothing); `src/pages/**` matches `src/pages/Foo.jsx` and `src/pages/tech/Bar.jsx` but not `src/pagesX/Y.jsx`; `functions/api/callrail-*.js` matches `callrail-connect.js` but not `twilio-webhook.js`; and `src/pages/[A-Z]*.jsx` **does** match `src/pages/Admin.jsx` — **refuting** the inherited claim that an unescaped `[` matches nothing. Brace-free, not bracket-free, is the rule
> - [ ] The linter's matcher dependency is **declared or vendored** (challenge finding F-9): the gitignore-semantics package is present today only as a hoisted transitive dependency and is not in `package.json`, so a clean install could break the require — and the likely failure mode of a linter that cannot load its matcher is that **every glob passes**. `--self-test` asserts the matcher resolved
> - [ ] Experiments E1, E2, E3 (section 6) authored, **with E1 and E2 explicitly marked owner-run** because `codex` is not resolvable in the project shell; this phase's own exit condition is that the fixture repo is committed and the result slots exist but are empty, with the stricter reading binding until filled
> - [ ] `.claude/rules/zz-probe.md` (E3's temporary probe) is **deleted before handoff**; `find .claude/rules -name '*.md' | wc -l` returns 23. This is the phase's own TEST-row deletion
> - [ ] `npm run build` + `npm test` pass (they gate nothing and prove no application code was touched); `npx eslint` on the three new `.mjs` files clean; `npm run validate:tooling` + `npm run test:tooling` green with the tracked inventory **unchanged**

**Scope:** owns the `InstructionsLoaded` block in `.claude/settings.json`, `scripts/agents/log-instructions-loaded.sh`, `scripts/agents/verify-rule-globs.mjs`, `scripts/agents/check-memory-ancestors.sh`, one `.gitignore` line for the JSONL log, `docs/agent-alignment-l2-evidence.md`, and the temporary probe rule. **Converts nothing** — all 23 rules stay unconditional throughout.
**Deliberately NOT:** any `paths:` frontmatter. Any `permissions` edit. Any `AGENTS.md`/`CLAUDE.md` edit.
**Risk tier:** AMBER — the only non-trivial write is one additive block in a protected, safety-hook-bearing file, gated by the JSON-parse plus deliberate-trigger criteria above. No rule is converted; no law moves.
**Size:** M.
**Rollback:** delete the five hook entries, re-run the JSON parse and the two deliberate triggers, delete the new scripts and the probe rule. `git revert` is complete. **A rollback must be followed by a restart before it is reported as effective.** The E1/E2 scratch repo lives outside this repository and is simply discarded.

#### P8 — Reference-depth conversion: scope the ten zero-safety rules, evict the two non-law manifests

> **Branch:** session-assigned. **Prerequisite:** P7 merged. **HARD GATE: ledger #1** — `claude --version` at least 2.1.217, asserted mechanically at phase start.
> **Model · effort:** Opus · high — a mis-authored glob silently unloads a rule with no error.
> **Read scope:** this block + the ten target rules files + P7's linter and baseline + this initiative's manifest DRAFT.
> **Close-out checklist**
> - [ ] `node scripts/agents/verify-rule-globs.mjs` exits 0. Per converted rule it asserts (a) zero brace groups, (b) at least one real tracked file matches under the loader's normalise-then-match pipeline, (c) a **declared near-miss does not match**
> - [ ] **PER-FILE LOADING FLIP — the acceptance evidence for every conversion.** After `/clear`, the JSONL contains **no** `session_start` entry for any of the ten, and still contains one for each unconverted file plus `CLAUDE.md`. Then, per converted file, reading one declared target in a fresh session produces a new entry with `load_reason: "path_glob_match"` and a `trigger_file_path` equal to the file read. **A conversion producing neither entry is a FAILED conversion — that is the silent-deletion outcome — and its frontmatter is reverted before handoff, not shipped with a note**
> - [ ] **`database-standard.md` still produces a `session_start` entry.** This single assertion is the standing proof that the one permanently-unscoped file was not scoped by accident, and it is the most important line in the phase's evidence
> - [ ] **EVICTION USES `git rm`, NOT `git mv` (challenge finding S-7).** `docs/archive/rules/admin-mobile-wave-ownership.md` **already exists at 9,253 B** — verified this session. A plain `git mv` of the 358 B tombstone stub would fail, and a retry with `-f` would **overwrite the archived substantive manifest with the stub**, destroying the only working-tree copy, in a step the design lane rated "effectively nil" risk. Correct form: `git rm` the stub (its own text says it binds no session and points at the archive) and add one row to a new `docs/archive/rules/README.md` index. **Acceptance criterion: the byte size of `docs/archive/rules/admin-mobile-wave-ownership.md` is identical before and after (9,253 B).**
> - [ ] The second eviction — `upr-engineering-foundation-wave-ownership.md`, 8,302 B, self-declared non-binding DRAFT — moves to `docs/` beside its existing roadmap. **Note the mechanism finding: the rules loader recurses into SUBDIRECTORIES of `.claude/rules/`, so moving either file into `.claude/rules/archive/` would NOT stop it loading.** A file must leave the tree entirely or carry `paths:`
> - [ ] `find .claude/rules -name '*.md' | wc -l` returns **21** (not just `ls`, because of the recursion finding), and `git log --follow` shows the second file's move as a rename
> - [ ] Stamp uniformity: all ten converted files carry `**Last verified:** 2026-07-26` in the single canonical spelling, and no converted file retains a variant. **The unstamped baseline is derived at run time and recorded verbatim, never hardcoded** (challenge finding P-13: the design lanes asserted 11/23 and 12-unstamped as hard criteria; the measured figure is **8 stamped / 15 unstamped**, and the checker must ignore rule-text matches by only counting a stamp in the file header)
> - [ ] **BODY TEXT UNCHANGED.** `git diff` on each converted file shows only added frontmatter, an added or bumped stamp line, and added HTML comments — no deletions outside the stamp line being replaced. This is the constraint-5 gate: nothing here is a substantive rule change, so no `superseded-by:` amendment is required **or permitted**
> - [ ] `.claude/tooling-governance.json` `rules` count **23 to 21** plus the section 1 prose stamp, same commit
> - [ ] `upr-pattern-checker` clean; standard gates; `npx eslint` n/a with the reason

**Scope — the ten conversions.** Every glob is brace-free, repo-root-relative, and verified against the installed matcher after the loader's trailing-`/**` stripping. `motion-standard.md` [26,649 B] to `src/index.css`, `src/components/ui/**`, `src/lib/nativeHaptics.js`, `src/components/tech/PullToRefresh.jsx` — **deliberately NOT `src/pages/**`**, which would reload 26.6 KB on nearly every UI session and forfeit the whole win; the standard's own section 1 forbids bespoke keyframes in a page, so real motion work touches `index.css` or a shared primitive, and a stray page-level transition is caught by `design-consistency-checker` section 9 and `review-animations` at close-out. `page-lifecycle.md` [5,245] to `src/pages/**`, `src/components/**`, `src/hooks/**`, `src/lib/stableDb.js`. `perf-budget.md` [3,169] to `package.json`, `vite.config.js`, `src/index.css`, `src/main.jsx`, `src/App.jsx`, `src/lib/mediaCompress.js`, `src/hooks/**`, `.github/workflows/ci.yml`. `documentation-standard.md` [7,182] to `supabase/migrations/**`, `supabase/migrations-staged/**`, `supabase/rollbacks/**`, `.claude/rules/**` — **gated on the L0 depth-map row for the JS/JSX header template existing first** (challenge finding P-11). `tech-v2-wave-ownership.md` [11,324], `app-store-readiness-wave-ownership.md` [3,107], `ux-alignment-wave-ownership.md` [6,565], `settings-overhaul-wave-ownership.md` [9,886], `db-foundation-wave-ownership.md` [8,995] to their own surfaces as enumerated in the manifest DRAFT.

**Deliberately NOT:** no body text edited. No ownership matrix touched. No mixed-content file converted (that is P9). No renumbering.
**Risk tier:** AMBER — these ten carry craft, behaviour and initiative-bookkeeping law and **zero** money, consent, authorization or shared-database content, so scoping them cannot leave a safety non-negotiable unenforced. The glob linter plus the per-file flip check reduce the residual to a detected-and-reverted failure rather than an undetected one. Both evictions are gated on ledger #10.
**Size:** L.
**Rollback:** per-file and instant — delete the `paths:` block and the rule is unconditional again on the next `/clear` or restart, because the loader's rule is strictly binary and there is no residual state. A softer mid-investigation option, without editing the file: set `paths: ["**"]`, which the loader treats as unconditional. `git revert` also restores both evicted files. **A restart is required before any rollback is reported as effective.**

#### P9 — Split-then-scope the seven mixed rules whose holders are not mid-flight

> **Branch:** session-assigned. **Prerequisite:** P7 and P8 merged, **and P3 merged with its post-compact canary green** — the L0 core must demonstrably carry each safety fragment before the file carrying it is scoped.
> **Model · effort:** Opus · high — these seven carry the consent, money, authorization and shared-production-database law.
> **Read scope:** this block + the seven target files + `AGENTS.md` (the landed L0 core) + P7's instruments.
> **Close-out checklist**
> - [ ] **PER-FILE L0-FRAGMENT PRECONDITION — the constraint-7 gate, and the reason this phase cannot be batched.** For each of the seven, a session-recorded check that the corresponding safety text is present in the shared core on disk **and** that the core produced a load entry in this session whose `load_reason` is `session_start` or `include` with `parent_file_path` = `CLAUDE.md`. Challenge finding S-7 applied: the design lane required a bare `session_start` entry, but the core is reached via an `@` import and the bundle's enum treats `include` as a distinct reason — so the check would have false-failed on every conversion and been loosened by the session running it, which is the dangerous outcome. **Loosening the reason set is forbidden. A conversion whose fragment is absent is NOT performed. Batching the seven is forbidden**
> - [ ] **NO SAFETY REGRESSION, PROVEN BY TEXT DIFF NOT ASSERTION.** For each of the seven, a fixed-string grep for a named anchor phrase per fragment in **both** the core and the depth file. Temporary duplication during the migration is **correct, not waste** — nothing is deleted from the depth file in this phase. If the two tools ever genuinely disagreed on a fragment's wording, the **STRICTER** text is what lands and the conflict is surfaced to the owner, never averaged
> - [ ] Glob linter exits 0 for all seven, with near-miss assertions specifically covering the two deliberate exclusions: a migration file must **not** match `crm-wave-ownership.md` (24.3 KB on every migration read would defeat the purpose; its frozen-signature list is reached through the L0 pointer table), and `src/pages/Admin.jsx` must **not** match `motion-standard.md`
> - [ ] Per-file loading flip exactly as P8, plus the standing `database-standard.md` `session_start` assertion
> - [ ] **COMPACTION BEHAVIOUR CONFIRMED ON THE ONE FILE THAT MATTERS (named human check).** In a session with real work in it, run `/compact`, then inspect the JSONL for a `compact` load reason on `database-standard.md` and on `CLAUDE.md`, and confirm the seven converted files do **not** reappear. This demonstrates on this machine the mechanism the whole scoped/unscoped boundary rests on, rather than citing it from documentation
> - [ ] **DEFERRED SET UNTOUCHED.** `git diff --name-only` contains none of `messaging-transport-wave-ownership.md`, `tech-messages-v2-wave-ownership.md`, `omni-inbox-wave-ownership.md`; all three still produce `session_start` entries; and their release condition is stated **in prose in the report** so a held file is never mistaken for a forgotten one
> - [ ] **BYTE ARITHMETIC RECONCILES, SELF-REFERENTIALLY.** A script asserts `sum(all rules bytes) == sum(scoped) + sum(evicted) + sum(deferred) + sum(unscoped)`. Indicative current values: scoped 158,193 + evicted 8,660 + deferred 34,589 + unscoped 9,342 = **210,784**. Challenge finding F-2 applied: the design lane hardcoded 209,774 as an exact-equality assertion, which **fails on arrival** (section 2) in a way indistinguishable from the file loss it exists to detect
> - [ ] Reviewer gauntlet weighted to the content moved: `upr-pattern-checker` (unconditional), `consent-path-auditor` (crm-wave, sms-experience and workers all carry send-path law), `worker-security-reviewer` (workers-standard carries the money and authorization fragments). `migration-safety-checker` and `anon-grant-auditor` declared **NOT APPLICABLE with the reason** — zero migrations, zero grant changes
> - [ ] Standard gates; `npx eslint` n/a with the reason

**Scope — the seven, each with the L0 fragment that must exist first.** `close-out-standard.md` [**6,908 B**, corrected] to `src/pages/**`, `src/components/**`, `src/index.css`, `supabase/migrations/**`, `functions/api/**`, `.github/workflows/**`; fragment = step 11 verbatim, the step-2 reviewer-trigger table condensed to one line per diff type, step 10, and the report-the-real-result rule. `crm-wave-ownership.md` [24,296]; fragment = sends only via `sendAutomatedMessage()`, no `skip_compliance`, worker sole writer, and the section 7 S1 double-send rationale. `sms-experience-wave-ownership.md` [23,321]; fragment **must** include the two load-bearing reason strings — this is the strongest single case in the whole exercise for lifting text to L0, because the file that *documents* the constraint is scoped to `functions/lib/automated-send.js` while the file that would *break* it is `functions/api/process-sequences.js`, owned by a different initiative and covered by a different glob. `workers-standard.md` [4,279]; fragment = UI role gates are not server gates, the `// public: <reason>` requirement, stable idempotency keys, never write trigger-owned columns. `upr-agent-qa-access-ownership.md` [7,476]; fragment = the shared-production project-ref sentinel and read-only smoke. `tech-mobile-ux.md` [4,411]; fragment is a **pointer plus the one-sentence invariant**, never a copy of the column list — the file already defers to `UPR-Web-Context.md` as source of truth and a third copy would be a third thing to drift. `loading-error-states.md` [3,511]; fragment is one sentence about a failed load never rendering the success empty-state. Its section 4 (toast single entry point) is **deleted from the L0 candidate list rather than lifted** — already Rule 2 and eslint-enforced, and a mechanically-checked rule must leave the always-loaded layer entirely. `scope-sheet-rollback.md` [1,869] converts **only after** L0 carries a `Runbooks` pointer line.

**`database-standard.md` [9,342 B] gets NO frontmatter, permanently, by design.** This is the one place where cheap-at-startup must lose to survives-compaction: a mid-task `/compact` would otherwise silently remove the shared-Supabase apply gate, the anon allowlist and the managed-Supabase REVOKE-EXECUTE-FROM-PUBLIC function trap. 9,342 B is 4.4% of the original cost. See ledger #11.

**Deliberately NOT:** no deletion from any depth file. No ownership matrix touched. None of the three deferred files.
**Risk tier:** RED — scoping one of these before its L0 fragment lands, or with a glob that matches nothing, removes a safety non-negotiable from every session with no error message. Per the db-foundation autonomy ledger, staged and waiting for the owner's explicit OK.
**Size:** L.
**Rollback:** per-file, instant, complete — delete the `paths:` block (or set `paths: ["**"]`) and the rule is unconditional on the next `/clear`. Because this phase **adds** the L0 fragment without **removing** the depth text, rolling back the scoping alone leaves the law doubly present. **The L0 fragments are P1/P3's commits and are deliberately NOT reverted by this rollback: reverting them while a depth file is still scoped is the one sequence that leaves law unenforced, so the order is fixed — un-scope first, only then consider touching L0.**

#### P10 — The Codex depth layer: a root pointer table as the mechanism, nested AGENTS.md as the belt

> **Branch:** session-assigned. **Prerequisite:** P1 merged (the root anchor must exist) and P4 merged (the byte cap).
> **Model · effort:** Sonnet · medium — additive context files plus one budget script; removes nothing and gates nothing.
> **Read scope:** this block + `AGENTS.md` + `.codex/config.toml` + P0's evidence file.
> **Close-out checklist**
> - [ ] `node scripts/agents/check-agents-chain-bytes.mjs` computes every git-root-to-directory chain and reports the largest. Deepest real chain = root + `src` + `src/pages` + `src/pages/tech`; pathological bound = root + all seven nested files. The script exits non-zero above a threshold set **against the P1 root size actually landed**, leaving deliberate slack because Codex drops the **tail** silently and the tail is where a nested file's content sits. **Treats the cap as COMBINED — the stricter of two contradicting vendor pages — until E1 says otherwise**
> - [ ] **THE PRIMARY MECHANISM IS PROVEN TO BE THE POINTER TABLE, NOT THE NESTED FILES.** `codex exec` from the **repo root** with a prompt whose correct answer requires content existing only in `src/pages/tech/AGENTS.md`; the expected result is **failure to know it**, which confirms the git-root-to-cwd walk and is exactly why the pointer table exists. Then re-run from `cd src/pages/tech`; the same prompt must succeed. **Both outcomes recorded.** If the root-launched run unexpectedly succeeds, the nested set is stronger than designed and that is recorded as a correction rather than quietly absorbed (owner-or-external — `codex` is not on PATH here)
> - [ ] **POINTER TABLE ACTUALLY FOLLOWED.** `codex exec` from the repo root, asked to make a trivial reversible edit under `supabase/migrations/`, must first read `.claude/rules/database-standard.md` — verified from the session's own tool-call record, not its prose claim. The Claude-side mirror of the same behaviour is the `path_glob_match` entry in P7's JSONL, giving one behaviour with two independent proofs, one per tool
> - [ ] E1's actual result is **consumed, not assumed**: if per-file, the recorded headroom is revised upward and the change disclosed; if combined, the numbers stand
> - [ ] **NESTED FILES CARRY NO SAFETY LAW.** A keyword grep across every nested `AGENTS.md` for `apply_migration`, `skip_compliance`, `anon`, push-to-main, `opt_in`, `consent` returns only **pointer-shaped** lines (a reference to a document), never a normative rule that could be the sole carrier of a non-negotiable. Reviewed as a named human check as well, because the grep proves absence of keywords, not absence of intent. Two independent reasons: a root-launched Codex session never loads them, and the Claude-side analogue is dropped at `/compact`
> - [ ] **EVERY NESTED FILE CARRIES THE ADDITIVE-ONLY HEADER** — "Additive to the root AGENTS.md. Never relaxes a root non-negotiable." Verified by listing files *lacking* the string and expecting only the root. Not decoration: Codex's user-facing wording is override semantics, so without the header a subdirectory file reads as licence to weaken L0
> - [ ] The evidence document states plainly that **Codex exposes no way to see which `AGENTS.md` files it loaded or whether truncation occurred**, so the Claude half of this split is PROVEN per file by the reason flip while the Codex half is byte-counted plus canary-probed and is therefore PLAUSIBLE, never proven. **A parity claim is forbidden in the report**
> - [ ] Standard gates; `npx eslint` on the new `.mjs` clean

**Scope:** `docs/agent-depth-map.md` as the **single source** for the path-to-document mapping (long form), with only a condensed version embedded in the L0-owned section — so the mapping cannot drift into two independently-edited copies. Seven nested `AGENTS.md` files: `supabase/migrations/`, `functions/` (placed there, not `functions/api/`, so one file covers both `api` and `lib`), `src/`, `src/pages/`, `src/pages/tech/`, `src/pages/crm/`, `ios/`. Plus `scripts/agents/check-agents-chain-bytes.mjs`.
**Cross-lane seam, negotiated not assumed:** this phase **supplies** the condensed pointer rows; **P1 owns the root file and reserves the anchor.** Two phases co-editing the root pair is the collision the manifest exists to prevent.
**Deliberately NOT:** `.codex/config.toml` (P4's). Any safety law in a nested file. Any `.claude/rules/**` edit.
**Risk tier:** AMBER — adds context files; removes nothing. The genuine risks are a nested file reading as permission to relax L0 (closed by the mandatory header plus the keyword grep) and the whole tier silently doing nothing for root-launched sessions (closed by making the pointer table primary and proving the walk behaviour by experiment).
**Size:** M.
**Rollback:** delete the seven nested files — Codex loses only the secondary tier and the pointer table, the primary mechanism, still functions. The condensed table lives in the P1-owned file and is reverted by coordination with that phase, not unilaterally. **Codex-specific trap: a fresh session must confirm project trust before any `.codex/` layer applies, so a rollback verified in an untrusted session proves nothing.**

---

### Wave 4 — L3: single-source capabilities

> ⚠️ **Read the STATUS CORRECTION at the top of this file first.** The mechanism this wave was
> written to build already exists (`tooling/` + `scripts/render-tooling-adapters.mjs`, landed
> `0e27be0`). This wave is now **extend coverage from 7 of 39 capabilities**, not build. P13's
> renderer filename, its `allow_implicit_invocation` claim, and its reviewer-twin task are all
> superseded — see the correction table.

#### P11 — Cut and instrument the Claude-side roster (no port, no tree commit, no deletion)

> **Branch:** session-assigned. **Prerequisite:** P0 merged. Independent of Waves 1-3.
> **Model · effort:** Sonnet · medium — frontmatter and validator work inside the tracked tree.
> **Read scope:** this block + `.claude/skills/*/SKILL.md` frontmatter + `.claude/agents/*.md` + `docs/tooling-governance.md` sections 1, 2, 5 + `.claude/rules/close-out-standard.md` section 2.
> **Close-out checklist**
> - [ ] `disable-model-invocation: true` added to the retained content/marketing set **and to `animation-vocabulary`** — 10 files. **The four UPR dispatchers are excluded from this phase and belong to P14** (challenge finding S-10: three phases across two lanes each proposed editing the same four `SKILL.md` files). `user-invocable: false` is **not** used — it hides the `/` menu only and does not block Skill-tool access
> - [ ] Two lines appended to each of the seven cross-cutting reviewer definitions: a ~1,000-2,000 token return budget inside the existing verdict-plus-numbered-findings format, and the **corrected** scope line. Verified this session: **not one** of the 15 reviewer definitions carries a return budget or a scope limit today, while the stated subagent value proposition is the condensed return and the stated risk is that a reviewer prompted to find gaps reports some even when the work is sound
> - [ ] **THE SCOPE LINE IS THE CORRECTED WORDING (challenge finding P-4).** The design lanes' draft — "flag only gaps affecting correctness or the stated requirements" — would license a reviewer to suppress a documented blocker: `design-consistency-checker` check 1 makes a page-scoped palette object a blocker, and `motion-standard.md` section 6 makes a missing `prefers-reduced-motion` fallback and an ungated `:hover` transform HARD failures, none of which is "correctness" or a stated requirement of the change under review. **Shipped wording: "Flag gaps affecting correctness, the stated requirements, or any violation of a cited project standard (CLAUDE.md non-negotiables and .claude/rules blockers and HARD failures). A standard-cited finding is never dropped to fit the return budget."**
> - [ ] `.claude/agents/impeccable-manual-edit-applier.md` keeps `tools: Read, Write, Edit, Bash, Glob, Grep` and `maxTurns: 12` **unchanged** (verified the only write-capable Claude subagent, intentionally so) and gains one inline note that the write capability is deliberate, so a later uniformity sweep does not "fix" it. **Subject to P6's subagent-coverage probe:** if PreToolUse does not fire for subagent tool calls, `Bash` is removed here rather than documented
> - [ ] **DEPRECATION RECORD ONLY — NO DELETION (challenge finding P-6).** `.claude/agents/admin-mobile-phase-reviewer.md` gets the evidence-led deprecation record `tooling-governance.md` section 5 requires (owner, reason, replacement = none, observation date), **and stays on disk.** The design lane performed the deletion with `depends_on: []` and did not list the required approval as a dependency; section 5 permits recording the deprecation now, not the removal. The deletion plus the agents `15 to 14` bump is P14's, gated on **ledger #14**
> - [ ] `skillOverrides` set to `name-only` for the down-ranked vendor specialists — reclaiming listing budget without forking any vendor bundle, since section 1 preserves upstream authorship and licence
> - [ ] `scripts/validate-tooling-governance.mjs` gains assertions with a **PINNED extraction rule** for the description-budget report (frontmatter `description` plus `when_to_use`, multi-line folded, counted in characters) so before/after numbers are comparable across phases; plus assertions that every gated capability carries the flag and every reviewer carries both new lines. **Three proposed assertions are DELETED as already-shipping** (challenge finding S-11): skill-dir-equals-frontmatter-name, agent name uniqueness, and duplicate-entrypoint-name all already exist in the validator and pass today; re-proposing them inflated the phase's claimed value and risked two competing implementations
> - [ ] Each new assertion is **proven live**: temporarily remove one gate flag and one reviewer scope line, observe a non-zero exit naming both files, restore. Failing output pasted
> - [ ] **`/context` after-capture taken in a session started AFTER the edit** (challenge finding S-12): the skill listing is built at session start, so an after-capture from the editing session shows the pre-edit listing and would read as a failure of `disable-model-invocation`. A gated skill's description is absent from the listing by design
> - [ ] `.claude/tooling-governance.json` **unchanged** in this phase — gating is not removal, and no entrypoint is added or deleted here. Recorded as an explicit "no change required, counts re-verified" statement rather than a silent omission
> - [ ] `npm run build` + `npm test` real results; `npx eslint` on the two changed validator files clean

**Scope:** owns `.claude/skills/*/SKILL.md` frontmatter **except the four dispatchers**, `.claude/agents/*.md`, the `skillOverrides` block in `.claude/settings.json` (no `permissions` key touched), and the two validator files.
**Deliberately NOT:** `.agents/**` or `.codex/**` (P12) — so this phase needs **no** amendment to `tooling-governance.md` section 1 and can land while every owner decision is still open. No deletion. No dispatcher frontmatter. No `permissions`.
**Coordination:** `.claude/agents/**` is claimed by the self-declared non-binding DRAFT `upr-engineering-foundation-wave-ownership.md` section 3 lane G, **and** the seven checker agents are frozen by the **active** `ux-alignment-wave-ownership.md` section 1 ("the checker agents... A session updates its OWN phase's checkboxes/status; it never re-authors these"). Challenge finding P-3 applied: only one design lane surfaced the ux-alignment freeze, and only for one file. **Ledger #9 is a hard dependency of this phase.**
**Risk tier:** AMBER — repository edits and reviewed configuration only; no `permissions` key, no database, secret, money, messaging or deployment action. Expect protected-path prompts editing `.claude` — correct behaviour, not a bug.
**Size:** M.
**Rollback:** one `git revert` restores every flag, the `skillOverrides` key and both validator files atomically. Partial: removing a `disable-model-invocation` line restores model-invocability on the next `/clear` — **and the phase must restart before reporting its own effect.**

#### P12 — Close the Codex-side safety divergences and replace two inferred claims with measured ones

> **Branch:** session-assigned. **Prerequisite:** P4 merged (`features.hooks`), P5 merged (hook wiring is P5's, not this phase's). **HARD GATE: ledger #3.**
> **Model · effort:** Opus · high — it fixes a live production-data hazard and the sandbox posture of 30 subagents.
> **Read scope:** this block + `.claude/skills/supabase/SKILL.md` + `.agents/skills/supabase/SKILL.md` + the six diverged bodies + `.codex/agents/*.toml` + `docs/tooling-governance.md` sections 1 and 5 + `.claude/rules/database-standard.md` section 0.
> **Close-out checklist**
> - [ ] **STEP 0: the out-of-repo backup from P5 exists and its path is recorded.** Both trees are untracked, so `git revert` cannot restore them.
> - [ ] **HIGHEST-SEVERITY ITEM, FIXED FIRST.** The 15-line `## UPR project override (mandatory)` block is ported **verbatim** from `.claude/skills/supabase/SKILL.md` (12,795 B) into `.agents/skills/supabase/SKILL.md` (12,091 B). The Codex copy is the unpatched vendor original instructing the agent to make schema changes with `execute_sql` / `supabase db query` so it "can iterate freely" — aimed at the one shared Supabase behind both `dev` and production, where a migration is live in prod the instant it applies. Verbatim, no rewording, so the two stay diffable. **Never weaken the Claude copy to match** (constraint 2: stricter wins). A `diff` showing only documented tool-name substitutions and **zero normative delta** is the acceptance evidence
> - [ ] The other five diverged bodies re-synced **from** `.claude/` (`content-strategy` 12,636 vs 12,033; `copywriting` 7,878 vs 7,775; `cro` 6,287 vs 6,184; `impeccable` 22,330 vs 22,337; `product-marketing` 7,877 vs 7,456), each remaining delta enumerated and justified. **One canonical `product-marketing.md` write target settled** — the Claude copies write `.claude/product-marketing.md`, the Codex copies `.agents/product-marketing.md`, which will silently produce two divergent context documents. The Codex `content-strategy` also cross-references the retired `seo-audit` / `ai-seo` / `programmatic-seo` skills, re-advertising the section 5 retirement by reference
> - [ ] All 31 `.Codex/` path references across 18 files repointed to the real tracked `.claude/...` paths — the rules and the impeccable scripts have exactly one home. Two concrete breakages closed: `impeccable`'s Codex copy invokes 5 scripts under a directory that does not exist, and `page-behavior-checker.toml` cites `.Codex/rules/page-lifecycle.md` when no `.codex/rules/` directory exists at all. These resolve case-insensitively and still miss on Windows, and fail outright on the Linux filesystem of a Codex cloud container. Verified by a grep returning 0 plus a resolver script reporting zero missing targets
> - [ ] `sandbox_mode = "read-only"` pinned on every reviewer/auditor/scout `.codex/agents/*.toml` (verified 0 of 30 pin it today, while 12 describe themselves as "Reports; does not edit"). Codex subagents inherit `sandbox_mode`, `mcp_servers` and `skills.config` from the parent when omitted, **and** inherit the composer's permission mode. `impeccable-manual-edit-applier` is pinned write-capable **explicitly** rather than by inheritance, with a turn cap matching the Claude twin's `maxTurns: 12`. `upr-scout` — the most frequently spawned subagent in the repo, currently pinning only `model_reasoning_effort` — is pinned too
> - [ ] **THE PIN IS PROVEN BY EFFECT, NOT BY GREP (challenge finding F-4).** `~/.codex/config.toml` sets `sandbox = "elevated"` at the user layer. A string-presence grep proves nothing about whether an agent-level pin overrides that, yet the design lane simultaneously claimed these pins are "a genuine structural guarantee on the Codex side with NO Claude-side equivalent". **Effect test:** from a write-enabled parent, spawn one pinned read-only reviewer and have it attempt a write to a scratch file; PASS = refused, transcript pasted. The user-layer `elevated` value is recorded in the capability matrix with a statement of which layer wins. **If the effect test cannot be run, the parity-table entry is downgraded to "declared, unverified" and the claim of Codex-side superiority is removed from the plan**
> - [ ] **PROBE 3 — SECRETS HOOK (replaces an inference).** In a scratch worktree, have Codex attempt via its normal edit tool (a) adding a literal bearer-credential line and (b) a write to a scratch `.env`. Record for each whether the call was **BLOCKED with the stderr reason**. If not blocked, capture the tool name Codex actually reported, fix the matcher, re-probe. **Report the OBSERVED behaviour, never the intended behaviour.** A Codex repo hook is inert unless `features.hooks` is on, the project is trusted, AND the hook's current hash is trusted — and editing the hook re-arms that gate, so a human `/hooks` re-trust is part of the probe (owner-or-external)
> - [ ] **PROBE 4 — DESTRUCTIVE-SQL HOOK.** Invoke the Supabase MCP SQL tool from Codex against a harmless `select 1` and record whether the hook fired and **exactly what tool-name string appeared in the hook payload**. That observed string becomes the matcher. If Codex uses bare tool names, the existing `mcp__.*__execute_sql` matcher is **PROVEN inert** and that finding is recorded as a live security gap, not quietly fixed and forgotten (owner-or-external)
> - [ ] `docs/tooling-governance.md` section 1 amendment authored per **ledger #3**, struck in place with a `superseded-by:` pointer, quoting the original provision, the rationale and the owner approval line. **Note (challenge finding P-7): the amendment as requested permits "safety-parity repair, path-contamination repair, and generated adapters" — a DELETION is none of those, so P5's follow-up deletion of `.codex/hooks/*.sh` needs a fourth enumerated operation added to the amendment text, or the wrapper-in-place alternative is used instead**
> - [ ] `npm run validate:tooling` + `npm run test:tooling` green; `npx eslint` n/a with the reason (shell, TOML and markdown only)

**Deliberately NOT:** `.codex/hooks.json` or either hook script (P5's, per the collision resolution). No `git add` of either tree (P13). No deletion of any capability. No `permissions` edit.
**Risk tier:** RED — it edits the trees section 1 declares untouchable and changes the sandbox posture of 30 subagents. Authoring is in scope; the amendment and any application require the owner.
**Size:** L.
**Rollback:** the tracked half (the section 1 amendment) reverts with `git revert`. **The untracked half restores only from the step-0 backup.**

#### P13 — Single-source via generated pointer adapters, then commit both trees

> **Branch:** session-assigned. **Prerequisite:** P11 and P12 merged, **ledger #4 answered** (the SEO disposition determines what the commit contains), P2/P3 merged so the "canonical body under `.claude/`" convention is stated in law rather than only in this manifest.
> **Model · effort:** Sonnet · medium for the renderer; the commit step is a publication action.
> **Read scope:** this block + `docs/tooling-governance.md` section 7 + P11/P12 reports.
> **Close-out checklist**
> - [ ] **MECHANISM, with the evidence that forces it.** Committed symlinks are **rejected** (`core.symlinks=false` measured in this repo; a committed symlink checks out as a text file whose entire content is the target path). Directory junctions are a **developer convenience only**, never the mechanism — machine-local and absent from every fresh clone, CI runner and cloud container, which is precisely the failure this phase fixes. `[[skills.config]]` does **not** add a discovery root — it keys on a path to enable or disable a specific skill, so it is a toggle, not a registration, and cannot make `.claude/skills` visible to Codex; recorded so no later session plans on it. **Therefore: generated thin POINTER adapters**, which is exactly the owner-approved model in section 7 ("adapters containing pointers where the runtime supports them, with content duplication only when required and always generated")
> - [ ] `node scripts/render-capability-adapters.mjs --check` exits 0 on a clean tree; then mutate one generated adapter by a single character, re-run, observe a non-zero exit naming the file, restore. Both runs pasted
> - [ ] Adapter shape: ~300-600 B — a front-loaded trigger description, the **BINDING CONSTRAINTS inline at the TOP**, then a pointer to the canonical body. Constraints go at the top because re-injected skill bodies are truncated **keeping the START** of the file
> - [ ] Zero normative duplication proven mechanically: every generated `.agents/skills/*/SKILL.md` is either under a stated byte ceiling (pointer class) or carries a `generated-from` header plus a matching source hash (generated-copy class). Exact count in each class reported, with every copy-class file named and the reason a pointer could not work
> - [ ] Generated `agents/openai.yaml` carrying `policy.allow_implicit_invocation: false` for every capability gated in P11 and P14. Verified 0 such files exist anywhere today, so the Codex half of the owner-authorization posture is currently prose-only while all 51 Codex skills are implicitly invocable. Explicit `$name` invocation still works
> - [ ] The 3 missing reviewer twins ported to `.codex/agents/` — `upr-pattern-checker`, `worker-security-reviewer`, `db-foundation-phase-reviewer` — each with `sandbox_mode = "read-only"` and P11's two lines. `upr-pattern-checker` is the priority: `close-out-standard.md` section 2 makes it mandatory "always, on any `src` change", so the Codex close-out gauntlet is today structurally unable to run its one unconditional gate and could report the gauntlet as run
> - [ ] Codex description budget re-measured with P11's pinned extraction rule against the documented 8,000-char cap, alongside the pre-phase baseline. **Report the real number even if still over** — the outcome depends on ledger #4 and must not be presented as resolved by this phase alone
> - [ ] **FRESH-CLONE VISIBILITY PROBE — the criterion that proves the lane's premise.** Before the commit: clone the branch to a temp dir; `ls <tmp>/.agents/skills | wc -l` and `ls <tmp>/.codex/agents/*.toml | wc -l` must both be **0**, demonstrating today's silent failure. After the authorized commit: both non-zero. **Both halves recorded**
> - [ ] `git ls-files .claude/worktrees | wc -l` remains **0** — load-bearing, because that path holds live worktrees and is gitignored, so a careless staging command must not capture them
> - [ ] **CROSS-TOOL REVIEWER PROBE.** In the fresh clone, run `codex review --base dev` against a deliberately law-violating scratch diff. Record whether the three newly-ported reviewers are discoverable and whether the review surfaces the violation. If local `codex review` does not honour the root `## Code Review Rules` section, **record that as a MEASURED gap and state that the review gate exists only on the PR path.** Do not report a gate that was not observed to hold (owner-or-external)
> - [ ] `.claude/tooling-governance.json` updated for the newly tracked entrypoint counts plus the section 1 prose stamp, same commit
> - [ ] `npm run validate:tooling`, `npm run test:tooling`, `npm run build`, `npm test` real results; `npx eslint scripts/render-capability-adapters.mjs` clean

**Cost stated plainly before the commit step:** `.agents/` is 551 files / 6,028,609 B, of which SEO is 250 files / 1,605,122 B and `impeccable` + `playwright-core` are 3,773,385 B of progressive-disclosure level-3 reference weight; `.codex/` is 33 files / 124,392 B. Pointer adapters remove most of the non-SEO body weight; the SEO decision determines the rest, which is why **the commit cannot precede ledger #4**. Consider deduplicating `impeccable` in the same commit: the `.agents` copy is 2.2 MB whose 5 script paths are broken, while `.codex/hooks.json`'s PostToolUse hook **already** points correctly at `.claude/skills/impeccable/scripts/hook.mjs` — the working hook reaches into the Claude tree, direct evidence the duplicate is dead weight.
**CI step:** one added step running `--check` plus `validate:tooling`. **Gated on ledger #8.** If declined, the check runs via `validate:tooling` only and the degraded path is documented — the phase degrades rather than stalls.
**Risk tier:** AMBER for authoring the renderer, adapters and ported reviewers. **The `git add` / commit step is a PUBLICATION action requiring separate owner authorization** — section 3: commit/push/PR/deploy are separate delivery actions and are never implied by authoring.
**Size:** L.
**Rollback:** the renderer is deterministic and idempotent, so re-running it against the prior `.claude/` state regenerates every adapter byte-for-byte — content rollback needs no backup. `git revert` of the tracking commit returns both trees to untracked; **the working-tree files survive that revert**, so no capability is lost locally, only cloud visibility. The revert record must state that it silently restores the cloud-invisibility failure.

#### P14 — Dispatcher skill conformance, and the one sanctioned deletion

> **Branch:** session-assigned. **Prerequisite:** P11 merged (it owns the other 20 skills' frontmatter). **Ledger #13 answered** before any rename; **ledger #14 answered** before the deletion.
> **Model · effort:** Sonnet · medium.
> **Read scope:** this block + the four dispatcher `SKILL.md` files + `docs/tooling-governance.md` sections 2 and 5.
> **Close-out checklist**
> - [ ] `disable-model-invocation: true` on all four dispatchers — `masterplan` (19,672 B), `db-migration` (5,905), `new-feature` (4,461), `new-crm-module` (2,231) — verified per file. **This phase is the sole owner of these four files** (challenge finding S-10)
> - [ ] **THE HIGHEST-CONSEQUENCE FINDING IN THIS PHASE.** `masterplan/SKILL.md` at 19,672 B is roughly 5,000 tokens, i.e. sitting exactly on the per-skill re-injection cap, and **truncation keeps the START** — so its late sections are the ones at risk, and its section 5 mandatory challenge pass and section 6 "Present, then WAIT — write nothing until the owner approves repository authoring" are both deep in the file. **The instruction that stops a planning session from writing is the instruction most likely to be truncated away.** Fix: hoist a top authority block into the first ~25 lines carrying the planning-not-building framing, the write-gate verbatim, and the challenge mandate; then reduce the body to a navigator. Verified by the validator measuring under 4,000 estimated tokens **and** a grep for the two required marker strings within `head -25`
> - [ ] `masterplan/references/{challenge-pass,artifact-templates,phase-block-schema}.md` created as a **relocation, not a rewrite** — proven by a reviewer diffing the removed `SKILL.md` blocks against the new reference files and asserting the union of the four files contains every requirement line the original did
> - [ ] `new-feature/SKILL.md`: the existing section 2 authority paragraph moved **above** section 1. `new-crm-module/SKILL.md`: a top authority block added plus a read-scope line naming `docs/crm-roadmap.md` and `.claude/rules/crm-wave-ownership.md`, whose section 3 frozen signatures it must not change. `db-migration/SKILL.md`: **frontmatter only** — it already puts its authority gate at line 13 and is the in-repo reference implementation; `git diff --stat` must show 1 insertion, 0 deletions
> - [ ] **Each of the four still resolves as a slash command, checked in a session started AFTER the edit** (challenge finding S-12) — the flag suppresses model auto-invocation, not human invocation, so a failure here means the flag was misapplied
> - [ ] Validator gains a SKILL.md size assertion (under 500 lines **and** under ~5,000 estimated tokens, report-only above 4,000 as an early warning) and an assertion that each dispatcher carries `disable-model-invocation: true` plus an authority block within its first 40 lines, matched by a required marker string. **The three already-shipping assertions are not re-added** (challenge finding S-11)
> - [ ] **CONDITIONAL, ledger #14 only:** delete `.claude/agents/admin-mobile-phase-reviewer.md` (5,116 B; its initiative is tombstoned, manifest archived 2026-07-13; **zero** references in `CLAUDE.md` or any rules file), capture the untracked `.codex` twin's diff in the deprecation record before deleting it, and bump `.claude/tooling-governance.json` agents `15 to 14` **plus** remove its row from `governedEntrypoints` — otherwise the validator raises `missing-governed-entrypoint`
> - [ ] **CONDITIONAL, ledger #13 only:** if the owner chooses the rename, all four directories become `upr-*` **and all 36 tracked references are repointed in the SAME commit** (measured: `db-migration` 11, `masterplan` 17, `new-feature` 4, `new-crm-module` 4) — plus the four `governedEntrypoints` paths in `.claude/tooling-governance.json` and the frontmatter `name` fields, or the validator raises 4x `missing-governed-entrypoint` and `entrypoint-name-mismatch`. Both the old names failing to resolve and the new names resolving are recorded (8 results) — a rename leaving the old name working means the directory was copied, not moved
> - [ ] A **report-only** shadow-detection check comparing `~/.claude/skills/*` directory names against `.claude/skills/*`, printing any collision with the note that the personal copy wins. **This is detection, not prevention** — the 20 vendor-named skills cannot be renamed without forking bundles section 1 requires to retain upstream authorship. Proven by planting a throwaway personal skill, observing the collision report, and deleting it
> - [ ] `docs/tooling-governance.md` section 2 repointed if names changed, and its stale `seo` dispatcher reference — which names `seo` as "the only broad SEO dispatcher" while zero SEO capability exists on the Claude side — corrected or struck in place per ledger #4
> - [ ] Standard gates; `npx eslint` on the changed validator/detection JS clean

**Risk tier:** AMBER — repository edits; the conditional rename carries a 36-file reference sweep whose missed reference is a **silent** routing failure, which is why the reference-grep and per-command resolution criteria are the load-bearing gates and neither may be reported as passing on inspection alone.
**Size:** M (L if the rename is authorized).
**Rollback:** one `git revert` restores the directory names and all 36 repointed references atomically — **the rename and the sweep must therefore be one commit**, which is a constraint on how the phase lands, not just how it is undone. The shadow-detection check is additive and report-only. **Record in the commit message which ledger-13 option was chosen, so a later session does not re-apply the other one.**

---

### Wave 5 — L4: working practice, handoff, and the mechanical guard

#### P15 — Mechanised close-out: one runnable evidence command plus a per-item classification

> **Branch:** session-assigned. **Prerequisite:** P0 merged. **Ledger #9** (the `close-out-standard.md` amendment against the active ux-alignment freeze) is a hard gate.
> **Model · effort:** Sonnet · medium.
> **Read scope:** this block + `.claude/rules/close-out-standard.md` + `.github/workflows/ci.yml` (read-only) + `docs/tooling-governance.md` section 6.
> **Close-out checklist**
> - [ ] `node scripts/qa/closeout-evidence.mjs` emits exactly one delimited evidence block containing, per gate, the exact command, its exit code and its real output tail: `npm run build`, `npm test`, `npx eslint` on changed files only, `npm run validate:tooling`, `npm run test:tooling`, `npm run validate:provenance`, the gzipped bundle figure against the `perf-budget.md` guide, and the stamp check. It prints a **HUMAN-GATES-OUTSTANDING** section naming the minimize/resume and on-device items verbatim so they cannot be silently skipped, and exits non-zero only on a genuinely failed scripted gate — **never on an outstanding human gate, which is a disclosure not a failure**
> - [ ] On a tree with a deliberately broken test, the script exits non-zero **and the evidence block still contains the failing gate's real output** — proving failures are reported, not swallowed
> - [ ] On a docs-only diff the eslint line reads the literal `n/a — no JS/JSX changed` and the overall exit code is still 0. This is the mechanical form of the do-not-fabricate-a-green-lint-run rule
> - [ ] `node scripts/qa/lastverified-stamps.mjs` reports the stamp baseline **derived at run time and recorded verbatim, never hardcoded**, ignoring rule-text matches by counting only a stamp in the file header. Measured today: **8 stamped, 15 unstamped, 3 spellings** (challenge finding P-13 — the design lanes asserted 11/23 and "exactly 12 unstamped" as hard criteria, one of which also summed to 24 against 23 files). Ships **report-only** so pre-existing debt is surfaced without blocking
> - [ ] Every one of the 11 items in `close-out-standard.md` carries exactly one classification tag — `[scripted]` / `[instrumented: <fidelity limit>]` / `[human: <named check>]` — and every `[scripted]` tag names a command that resolves. Enforced by a new validator assertion that parses the tags and resolves each command
> - [ ] **The amendment adds no text that removes or weakens an existing item.** `git diff` shows zero deleted requirement lines outside struck-in-place blocks, and every `~~`-struck block is followed within 3 lines by a `superseded-by:` pointer — verified by grep as well as by a reviewer
> - [ ] `/closeout` resolves as a slash command from its **directory** name; frontmatter carries `disable-model-invocation: true` (close-out is a human-initiated act) and its binding constraint — "paste the real output; a summarised or remembered result is not evidence" — in the first 15 lines, because a re-injected skill body is capped and truncation keeps the START
> - [ ] `.claude/tooling-governance.json` skills **24 to 25** plus the prose stamp, same commit
> - [ ] Standard gates; `npx eslint` on the new JS clean

**Classification produced by auditing all 11 items.** SCRIPTED: item 1 build/test/lint, item 6 perf delta, item 8 doc and stamp checks, and the migration-header/ROLLBACK check. INSTRUMENTED: item 4 390px viewport, item 5 loading/empty/error forcing (route the RPC to fail and assert `ErrorState` renders and never `EmptyState` — the exact rule of `loading-error-states.md` section 1), item 7's three CI-runnable motion axes. **HUMAN, irreducibly:** item 3 minimize/resume on a real installed iPhone (iOS suspension and eviction cannot be emulated; a Chromium visibility-change event is a different signal), item 7's gesture fling / Taptic / 60fps-under-`backdrop-filter` feel, item 9's metric re-measure and both-directions reconciliation, item 10's ad-hoc TEST-row cleanup. Item 2 is DEFERRED to P16 because its **trigger**, not its content, is the defect. Item 11 stays textually intact with a pointer to P6 — **nothing is removed from this file before its replacement gate exists.**

**Explicit NO-CHANGE verdicts recorded in the amendment.** The minimize/resume test and on-device motion feel stay named human checks: instrumenting them would produce a **false pass, which is worse than an honest gap**. And a **Stop hook is rejected as the close-out enforcement mechanism** on three independent grounds — it is overridden after 8 consecutive blocks so it can never be sole enforcement for anything safety-critical; it cannot spawn a subagent, so it cannot run the gauntlet; and it cannot perform a human on-device check. `/goal` is **absent from the installed 2.1.85 bundle** (measured) and is recorded as an optional future enhancement only, never the mechanism — its evaluator also cannot run commands or read files, which is precisely why the evidence block must exist first.

**The Rule 6 contradiction is surfaced, not scoped (challenge finding P-12).** The design lane proposed writing an "interim default" into the rules file, which reads as a de facto narrowing of an explicit owner decision performed in a different file. **Shipped wording is a pointer only:** "Rule 6's commit cadence and step 11's publication gate are in tension; the governing text today is AGENTS.md's publication clause and step 11 above. Conflict surfaced to the owner, unresolved." See ledger #15.
**Risk tier:** AMBER.
**Size:** M.
**Rollback:** `git revert`. The merged section is additive and the source lists stay in place in the same commit, so a revert can never leave the repo with no definition of done.

#### P16 — Reviewer gauntlet: a computed trigger and a single fan-out

> **Branch:** session-assigned. **Prerequisite:** P15 merged (it owns `close-out-standard.md`). **Ledger #8** for the CI step; **ledger #9** for the checker-agent lines if P11 has not already landed them.
> **Model · effort:** Sonnet · medium.
> **Close-out checklist**
> - [ ] **The honest finding stated first: a hook cannot trigger the gauntlet.** Hooks cannot spawn subagents; PostToolUse cannot block at all regardless of exit code; a Stop hook is overridden after 8 consecutive blocks and is silently converted to `SubagentStop` when declared in subagent frontmatter. "Hook-triggered" is not an available answer and is not planned
> - [ ] `node scripts/qa/required-reviewers.mjs --base dev` computes the required set from the diff using `close-out-standard.md` section 2's rules and prints it as a human list plus JSON, emitting **`none required`** for a docs-only diff rather than defaulting to the full gauntlet — a trigger that over-fires is as wrong as one that under-fires
> - [ ] Fixture diffs prove each trigger: `src/pages/**` yields the three gauntlet agents; `supabase/migrations/**` yields the two database reviewers; `functions/api/send-message.js` yields `consent-path-auditor` **and** `worker-security-reviewer`; an `src/index.css` motion change yields `review-animations`; docs-only yields `none required`
> - [ ] `/gauntlet` runs the computed set in **one fan-out** and prints each verdict in the standard format. Binding constraint in the first 15 lines: spawn only the computed set, never the full roster, and never edit a file the reviewers flag in the same invocation
> - [ ] On a fixture `src/pages` change, exactly **three** agents are spawned — counted by the owner or from a transcript; over-spawning is the specific regression this replaces
> - [ ] The CI evidence step fails a synthetic PR whose body omits a required verdict and passes one that includes all of them. Scoped `if: github.event_name == 'pull_request'` and `continue-on-error: true` on first landing. **Deliberately PR-only, and the report says so:** Rule 4 routes routine work direct to `dev`, and a gate that cannot fire there must not be presented as covering it. This is the concrete cost of Rule 4 and belongs in ledger #15, not smuggled in here
> - [ ] **The subagent-context multiplier is CLOSED with a recorded measurement, not an estimate.** `docs/qa/subagent-context-probe.md` contains an executed result section stating whether unscoped `.claude/rules/*.md` reached the subagent, the method, and the version measured on, plus an explicit statement that the Codex side is unmeasurable and **no parity claim is made**. Two cost reductions land regardless of the result — the single fan-out and the return budget — so **E3 sizes the win, it does not decide it**
> - [ ] **The design lane's alternate-instrument fallback is DELETED (challenge finding F-5).** One lane stated `InstructionsLoaded` has "no evidence of support at 2.1.85" and built a weaker transcript-inspection fallback; the bundle **does** contain it (9 hits, with the full five-value reason enum). This phase consumes P7's `InstructionsLoaded` log
> - [ ] `.claude/tooling-governance.json` skills **25 to 26** plus the prose stamp; standard gates; `npx eslint` on the new JS clean

**Risk tier:** AMBER — the reviewer edits are two additive lines per file with zero deletions, and the CI step lands non-blocking.
**Size:** M.
**Rollback:** `git revert`. `close-out-standard.md` section 2's trigger table is left intact by this phase rather than replaced, so reverting `/gauntlet` restores the prior prose-triggered flow exactly.

#### P17 — Handoff baton: one canonical schema and lifecycle that composes with resume, /rename and memory

> **Branch:** session-assigned. **Prerequisite:** P15 merged (single-writer order on `close-out-standard.md`: P15, then P17, then P9's frontmatter). **Ledger #9.**
> **Model · effort:** Sonnet · medium.
> **Close-out checklist**
> - [ ] `docs/handoff/README.md` carries the schema with each required field **justified rather than asserted**: `Tool` (which runtime parked it — effort vocabularies, `$name` vs `/name`, and sandbox availability all differ); `Base verified` (exact commit SHA) and `Worktree/branch` (with 23 live worktrees "the repo" is ambiguous, and one worktree is recorded as do-not-merge with a base predating a rewrite); `Evidence` (the command and its real captured output, not a claim); `Owner gates` (blocked-on-owner separated from merely unfinished); `Durable decisions to promote`; and `Opening prompt` (fully self-contained, referencing no conversation)
> - [ ] The composition table gives **exactly one owning job per mechanism** — session resume owns in-tool context replay and is machine-local; `/rename` owns findability (name the session after the handoff slug); auto memory owns durable cross-conversation constraints and is re-injected after compaction; the handoff doc owns the **cross-tool baton, which is the only one of the four that exists at all** (a Codex session cannot resume a Claude session, transcripts are per-tool and machine-local, and `claude -p --bare` skips memory and `CLAUDE.md` entirely)
> - [ ] The lifecycle section states the **promote-before-delete** rule (durable owner decisions and standing constraints go to memory or a canonical doc *before* a handoff doc is deleted; per-task state never goes into memory, where it goes stale and re-injects forever) and **quotes** `CLAUDE.md`'s Task File Protocol punch-list carve-out rather than paraphrasing it into a different rule
> - [ ] Its dated section in `close-out-standard.md` absorbs `AGENTS.md`'s Definition of done and Documentation duties **by reference, not restatement** — a fourth copy is the disease, not the cure — with a change-type-to-docs-to-update table, and records that **git is the only reliable undo** (Claude checkpoints do not track bash-made edits, do not restore subagent edits, and normally miss concurrent-session changes; this repo dispatches heavily to subagents, applies migrations out of band, and has 23 worktrees). A phase's rollback is a git ref, never a checkpoint
> - [ ] The three operational warnings are recorded where a session will hit them: a mid-session `CLAUDE.md`/`AGENTS.md` edit does not apply until `/clear`, `/compact` or restart; a Codex repo hook is skipped until a human re-trusts its hash and editing it re-arms the gate; a fresh Codex session must confirm project trust or the whole `.codex/` layer silently supplies nothing
> - [ ] `node scripts/qa/validate-handoff-docs.mjs` asserts the six required fields, that `Base verified` resolves as a real commit, and that `Evidence` contains at least one command-and-output pair rather than only prose. **Report-only** against the three existing handoff docs
> - [ ] **ROUND-TRIP TEST — the only criterion that matters for a handoff artifact (named human check).** A fresh session of the **other** tool is given only `docs/handoff/agent-alignment-handoff.md`, with no conversation history, and must correctly state the next action, the exact files in scope, and what is out of scope. **If it cannot, the template is under-specified and this phase is not done.** No command substitutes for this
> - [ ] **Neither `AGENTS.md` nor `CLAUDE.md` is modified** — verified by `git diff --name-only` containing neither path. The two citation lines are supplied as `docs/handoff/l0-pointer-text.md` for **P1/P3 to install**, because the root pair is a single seam with a single owner
> - [ ] Standard gates; `npx eslint` on the new JS clean

**Risk tier:** AMBER.
**Size:** S.
**Rollback:** `git revert`. Additive documentation plus one report-only validator; the three existing handoff docs are not edited, and because the root pair is untouched a revert cannot leave a dangling pointer in the shared core.

#### P18 — Future-initiative isolation model: keep what worktrees cannot solve, mechanise the two obligations that matter

> **Branch:** session-assigned. **Prerequisite:** P14 merged (it owns `masterplan/SKILL.md`, which gains one navigator line here). **HARD GATE: ledger #1** — this phase authors a `paths:`-scoped rule.
> **Model · effort:** Sonnet · medium.
> **Close-out checklist**
> - [ ] `.claude/rules/initiative-isolation.md` created **with `paths:` frontmatter** scoped to `docs/*-roadmap.md`, `docs/*-dispatch.md`, `.claude/rules/*-wave-ownership.md`, so it loads only when someone is authoring or reading an initiative plan and adds **zero** bytes to the always-loaded set. Its glob contains zero brace groups (verified), and its load behaviour is proven by the P7 instrument — **the PR records which method was used and why; an unverified `paths:` claim is not accepted**
> - [ ] The honest sorting is stated: worktrees **do** solve concurrent edits to the same file, accidental cross-phase edits, and the whole purpose of the `index.css` reserved-marker convention (a worktree surfaces the collision as a merge conflict at merge time, strictly better than a hand-maintained prose reservation nothing enforces). Worktrees **do not** solve (a) **shared-Supabase apply windows** — one database behind both `dev` and `main`, so a migration is live in production regardless of which worktree authored it, and two migrations issuing strong-lock DDL against the same hot tables must not have overlapping apply windows even though merge order is free; and (b) **frozen RPC signature and return-shape contracts** — a merge can be textually clean and semantically breaking, with the concrete precedent that `sendAutomatedMessage`'s reason vocabulary is keyed on by two workers in *other* initiatives, so renaming `quiet_hours` is a two-line refactor that passes lint and build and results in messages sent during quiet hours with no test failure
> - [ ] `node scripts/check-frozen-contracts.mjs` parses `supabase/migrations/**/*.sql` for `CREATE OR REPLACE FUNCTION` signatures and `RETURNS` shapes, compares against a generated snapshot, and fails on a change not accompanied by a `-- frozen-contract-amendment: <reason>` comment. Four cases proven: an unannotated signature change **fails**; an annotated one passes; a body-only replace passes (the sanctioned form); a new-required-parameter change fails while a new-parameter-with-DEFAULT passes
> - [ ] **Its limitation banner prints on every run** and names the repository-derived scope: the snapshot is derived from `supabase/migrations/` only (239 local files measured), **not** the live catalog, and the 2026-07-22 audit found local files diverging from live ledger entries — so it is a repository contract, not live truth, and the doc says so rather than implying coverage it lacks
> - [ ] `docs/apply-window-register.md` created with the standing rule that two entries whose strong-lock tables intersect may not hold overlapping windows — the mechanised form of the existing prose sequencing rule
> - [ ] **NO file matching `.claude/rules/*-wave-ownership.md` is modified** — `git diff --name-only` containing zero such paths is the mechanical proof that constraint 4 was honoured. This phase creates a **new** rule for future initiatives rather than retrofitting existing manifests; existing ones migrate only when they tombstone
> - [ ] `.claude/tooling-governance.json` rules **21 to 22** plus the prose stamp; standard gates; `npx eslint` on the new JS clean

**Risk tier:** AMBER — additive; the CI step lands non-blocking; no active manifest is edited.
**Size:** L.
**Rollback:** `git revert`. The new rule is path-scoped so its removal cannot leave a dangling always-loaded reference; the snapshot is reproducible from `supabase/migrations/` so it is not unique state. **Ordering caution: revert P18 before P14 if both are being unwound**, since P14 owns `masterplan/SKILL.md` and P18 adds one line to it.

#### P19 — The single CI invariant guard

> **Branch:** session-assigned. **Prerequisite:** P3, P4, P8, P9, P10, P15 merged (it asserts what they establish). **HARD GATE: ledger #8.**
> **Model · effort:** Sonnet · medium.
> **Close-out checklist**
> - [ ] **ONE guard, not two (challenge finding S-4).** Two design lanes each proposed a near-identical invariant script with its own npm key and its own CI step, asserting the same ten invariants, and only one of them named the shared allowlist file. **Resolution: `scripts/validate-agent-instruction-layer.mjs` + `validate:agent-layer` + `scripts/agent-instruction-layer.allowlist.json` + one CI step, owned here.** The L2 lane's duplicate script and key are deleted from the plan; it contributes its three rules-specific assertions into this script and keeps `verify-rule-globs.mjs` and `check-agents-chain-bytes.mjs` as libraries this guard delegates to
> - [ ] Named-invariant assertions, each with its own check id so a failure is actionable: (1) `CLAUDE.md` line 1 is exactly `@AGENTS.md`, **and** `fs.lstat` confirms it is not a symlink **and** its entire content is not the literal string `AGENTS.md`; (2) `model_instructions_file` appears nowhere in the repo; (3) every `.claude/rules/*.md` either carries `paths:` or is in the tracked intentionally-unscoped allowlist with a one-line reason — an **INTENT** check, so it passes before and after the L2 migration and can never be silently satisfied by scoping a file that must survive compaction; (4) every `paths:` glob is brace-free; (5) every glob matches a tracked file and misses its declared near-miss; (6) the `AGENTS.md` chain is within the budget pinned in `.codex/config.toml`; (7) `claudeMdExcludes` is absent or empty in every **tracked** settings file; (8) no ancestor or user-scope memory file; (9) the `Last verified` stamp present in one canonical spelling; (10) no tracked `AGENTS.override.md` or `CLAUDE.local.md`; (11) hook-layer invariants — no `CLAUDE_PROJECT_DIR` **inside** a hook script, every wiring path exists on disk, both wirings reference the same canonical script, the Codex secrets matcher includes `apply_patch` and excludes `MultiEdit`, no never-matched `Write(`/`Glob(`/`NotebookEdit(` permission spelling; (12) `.claude/tooling-governance.json` `trackedInventory` matches `git ls-files`; (13) the P15 close-out-coverage check
> - [ ] The allowlist keeps `database-standard.md` unscoped, with its reason recorded
> - [ ] **PROVEN BY DELIBERATE BREAKAGE, not by a green run.** Twelve negative tests, each mutating one thing **in a temp directory outside the repo** and asserting a non-zero exit that names the specific rule — including a fixture where `CLAUDE.md`'s entire content is the literal string `AGENTS.md`, and one where a `paths:` glob contains a brace group. **The guard is root-parameterized (`--root <dir>`) so no fixture writes inside `.claude` or plants a real ancestor file** (challenge finding S-13: the design lanes' suites would prompt or be denied inside the protected path, and the ancestor fixture would inject into every sibling repository under the parent if left behind)
> - [ ] The guard **names which glob dialect** it is rejecting whenever it rejects a pattern, because `paths:` (gitignore semantics, repo-relative, braces dead, trailing `/**` stripped) and `claudeMdExcludes` (picomatch, absolute, braces live) behave differently on identical-looking patterns
> - [ ] **NEGATIVE CI PROOF.** A scratch branch deleting `CLAUDE.md`'s `@AGENTS.md` first line makes the verify job RED; the run URL is recorded and the scratch branch deleted. Branch-protection required-check status is a GitHub Settings value, not a file — the owner confirms it separately (owner-or-external)
> - [ ] **BOTH REFUTATIONS RECORDED** in `docs/agent-alignment-l2-evidence.md`: bracket classes **do** work in `paths:` globs, so the inherited "an unescaped `[` silently matches nothing" is refuted (brace groups, not brackets, are the failure mode); and `claudeMdExcludes` **does** cover `.claude/rules/*.md`. Recording a refuted claim is the point of the evidence file
> - [ ] **THIRD `/context` CAPTURE** pasted beside the P7 baseline and the P8 interim, giving three real token measurements. **Any token claim not traceable to one of those three is removed from the report**
> - [ ] `npm run validate:agent-layer` exits 0 on a clean checkout; `validate:tooling` and `test:tooling` still pass, proving the new script was wired in without breaking the existing pair; `npx eslint` on both new `.mjs` files clean (this phase adds JS, so lint **is** meaningful)
> - [ ] **CI OWNERSHIP RESOLVED BEFORE THE FILE IS TOUCHED:** either a dated addendum exists in `.claude/rules/upr-agent-qa-access-ownership.md` naming this exact additive job block, or `.github/workflows/ci.yml` is absent from `git diff --name-only` and the degraded path (guard via `validate:tooling` only) is documented. **Both outcomes are acceptable; touching the file without the addendum is not**

**Risk tier:** AMBER — the guard is read-only and additive, and the CI step lands blocking only because every invariant it asserts has a silent failure mode with no runtime error.
**Size:** M.
**Rollback:** remove the npm key and delete the scripts — the guard stops running and the repo returns to its current unguarded state, a loss of protection rather than a break. Revert the CI job block independently if it was the problem. **If a recorded finding in the evidence document is later contradicted, it is struck in place with a `superseded-by:` pointer, never deleted**, so the history of what was believed and when is preserved.

#### P20 — Release the deferred rules files (merge-keyed, not date-keyed)

> **Branch:** session-assigned. **Prerequisite:** P9 and P19 merged, **and each holder merged** — condition-checked, never date-checked.
> **Model · effort:** Opus · high — it converts the highest-consequence rules file in the set.
> **Close-out checklist**
> - [ ] Before converting any of the three, `git log origin/dev` confirms the holder merged **and** `git status` in the relevant worktree shows no uncommitted work. As of this plan: `messaging-transport-wave-ownership.md` [15,250 B] is held by a live writer with 61 uncommitted files on `codex/messaging-transport-build`, and it carries the highest-consequence law in the set — where a load miss can cost money and create legal exposure in the same action; `tech-messages-v2-wave-ownership.md` [8,766] and `omni-inbox-wave-ownership.md` [10,573] are named explicitly as amendment targets by the owner-approved 2026-07-26 participant-scoping work
> - [ ] Globs are the ones **pre-authored and pre-linted** in `docs/agent-alignment-l2-evidence.md`, so the follow-up is mechanical
> - [ ] The full P9 procedure per file: L0-fragment precondition, glob linter, per-file loading flip, `database-standard.md` `session_start` still present
> - [ ] `messaging-transport-wave-ownership.md` converts **LAST**, after the L0 send-path block has been proven to load, so its section 1 law is never in flight
> - [ ] **If a holder has not merged, the file stays unconverted and the report says why** — a holder-blocked item stays visibly open and is never quietly closed
> - [ ] Self-referential byte arithmetic re-run; the intermediate figure is reported exactly rather than the target if the state is partial. End state: **9,342 B always-loaded, a 95.6% reduction from the measured 210,784 B baseline** — and for the first time the safety-critical subset reaches **both** tools instead of Claude only, because it lands in the shared core rather than in a Claude-only rules file
> - [ ] Standard gates; `npx eslint` n/a with the reason

**Risk tier:** RED content, but **not** red uncertainty — the L0 preconditions are already satisfied and the globs are already authored and linted. Staged and waiting for the owner per the autonomy ledger.
**Size:** M.
**Rollback:** per-file `paths:` deletion, restart. Identical to P9.

---

## §6 The three empirical experiments

Each has a stated pass/fail, a **mandatory control that runs first**, an invalidating outcome declared in advance, and a named artifact. All three are authored in P0/P7 with empty result slots; **the stricter reading binds until a slot is filled.** E1 and E2 are **owner-run** — `codex` is not resolvable on PATH in the project shell, so a phase cannot be gated on a command it cannot execute.

### E1 — Is Codex's `project_doc_max_bytes` per-file or COMBINED?

Two vendor pages contradict each other; the dedicated `AGENTS.md` guide says combined, `config-advanced` says per-file. This sets the entire L2 nested-`AGENTS.md` budget.

Run **entirely in a scratch git repo outside this repository.** Root `AGENTS.md` of 30,000 B whose **last** line is behavioural canary C1 ("if asked for the root word, answer ARMADILLO"); `sub/AGENTS.md` of 6,000 B whose **first** line is C2 ("if asked for the sub word, answer PLATYPUS"). Behavioural canaries, not verbatim-recall canaries, so the result does not depend on quoting. From `sub`, ask for both words with a NONE-if-absent instruction.

- **PASS-COMBINED:** ARMADILLO present, PLATYPUS **absent** (30,000 + 6,000 > 32,768, tail dropped).
- **PASS-PER-FILE:** both present.
- **Additional finding if ARMADILLO is also absent:** the root itself truncated, and head-keeping behaviour is proven.
- **MANDATORY CONTROL, run first:** root shrunk to 10,000 B must yield **both** words. Without this control an absent PLATYPUS is uninterpretable.
- **Second run:** repeat the 30k+6k case with `-c project_doc_max_bytes=65536`. PLATYPUS appearing proves the key is honoured at that scope.
- **Binding until settled:** COMBINED, the stricter reading. P10's budget assumes it.

### E2 — Does LOCAL `codex review` honour a root `## Code Review Rules` section?

Documented only on the GitHub-integration page; `/docs/code-review` contains no `AGENTS.md` mention. If it does not, the review gate exists only on the PR path and the plan must say so.

Same scratch repo. Root `AGENTS.md` carries a `## Code Review Rules` section with **one arbitrary, project-specific, non-inferable invariant** — "every new `.js` file must begin with the comment `// upr-ok`; a file without it is P0" — chosen deliberately so no general-purpose reviewer could flag it on merit. Commit. A branch adds one new `.js` file lacking the marker and containing nothing else wrong. Run `codex review --base main` and `codex review --uncommitted`.

- **PASS:** a finding names the marker or the rule.
- **FAIL:** no finding → the gate exists only on the PR path; recorded as a measured limit.
- **MANDATORY CONTROL:** delete the section, re-run. A finding that **still** appears invalidates the test and forces a yet-more-arbitrary rule.
- **PIGGYBACKED at no extra cost (settles a fourth open question):** move the section to the **end** of a root `AGENTS.md` padded past 32,768 B and re-run. If the finding disappears, the section is itself subject to the byte cap and **placing it early in the root file becomes a binding instruction to P1** — which is why P1 already places it early as the cheap hedge.

### E3 — Do unscoped `.claude/rules/*.md` load into Claude SUBAGENTS?

The vendor docs enumerate a subagent's startup context exhaustively and are **silent** on rules files. With 15 subagents and a mandatory 3-agent gauntlet, the 210.8 KB is either paid once or three to four times per task.

`.claude/rules/zz-probe.md` (unconditional, no frontmatter) contains only a canary token instruction. Nothing is added to `CLAUDE.md`. Dispatch `upr-scout` (Read/Grep/Glob, haiku) with a prompt that never mentions the token and instructs it to read no files.

- **PASS (rules DO reach subagents):** the token is returned.
- **FAIL:** NONE.
- **CONTROL 1 (confound):** a trial where the probe carries `paths: ["docs/nonexistent/**"]` must return NONE either way — this proves the probe measures loading rather than the subagent guessing or finding the file.
- **CONTROL 2 (challenge finding F-8, added):** a trial where `zz-probe.md` is **absent entirely** must also return NONE, and the parent session must be freshly `/clear`ed with zero reads of the probe file before dispatch. Control 1 alone does not exclude the token arriving via the delegation message or the parent's already-loaded context, which is the actual alternative explanation for a PASS.
- **INVALIDATING OUTCOMES, declared in advance:** NONE with the file present, or the token returned with the file absent, **voids the probe** rather than being reported as a result.
- **CORROBORATION ONLY:** a second `InstructionsLoaded` entry during subagent assembly, recorded honestly as corroboration since whether that event fires inside subagent assembly is itself undocumented.
- **CONSEQUENCE STATED IN ADVANCE SO THE RESULT CANNOT MOVE THE GOALPOSTS:** a PASS multiplies the always-on cost by roughly 3-4x per gauntlet task and raises this plan's value proportionally; a FAIL means the saving accrues to the main session only. **No phase is gated on either outcome. E3 sizes the win; it does not decide it.**

---

## §7 Dependency graph

```
P0  Capability floor  (green, no gate)
 |
 +--> P1  L0 core (additive)  ──> P2  bridge, duplicate KEPT ──> P3  post-compact proof, THEN delete
 |         |                          |
 |         |                          +--> P4  .codex/config.toml + permissions [ledger #1? no · #3 · #6 · #7]
 |         |                                    |
 |         |                                    +--> P5  guard single-source, fail-closed [ledger #3]
 |         |                                    |          |
 |         |                                    |          +--> P6  publish/apply gates [ledger #6 #7]
 |         |                                    |
 |         +--> P10 Codex depth (pointer table primary) <----+ (needs P1 anchor + P4 cap + E1)
 |
 +--> P7  instrumentation + glob linter + baseline
 |         |
 |         +==[HARD GATE ledger #1: claude >= 2.1.217]==> P8  scope 10 zero-safety rules + evict 2 [ledger #10]
 |                                                          |
 |                        P3 (post-compact green) ──────────>+--> P9  split-then-scope 7 mixed [ledger #11 #12]
 |                                                                     |
 +--> P11 Claude roster cut [ledger #9 HARD]                           |
 |         |                                                           |
 |         +--> P12 Codex divergences [ledger #3 HARD]                 |
 |         |          |                                               |
 |         |          +--> P13 adapters + commit [ledger #4 #5 #8]     |
 |         |                                                           |
 |         +--> P14 dispatcher conformance [ledger #13 #14]            |
 |                    |                                                |
 +--> P15 close-out mechanisation [ledger #9 HARD]                     |
           |          |                                                |
           +--> P16 gauntlet trigger [ledger #8]                       |
           |                                                           |
           +--> P17 handoff schema                                     |
                      |                                                |
                      +--> P18 isolation model [ledger #1 HARD]        |
                                 |                                     |
                                 +--> P19 CI guard [ledger #8 HARD] <--+
                                            |
                                            +--> P20 release deferred set (merge-keyed)
```

**Edge types.** Solid arrows are hard artifact edges. `==[...]==>` is a version gate. Every precondition stated in a phase's prose is also an edge here (§4 invariant 4). **Externally gated, do not launch on hope:** P4's Codex key verification, P5/P12's hook probes, P10's `codex exec` walk test, P13's cross-tool review probe, P19's branch-protection confirmation, and E1/E2 — all require the Codex CLI or a live session and are marked owner-or-external.

**Adjudicated version-gate contradiction (challenge finding S-10).** Two design lanes read the same measurement and reached opposite conclusions: one declared the version finding "a HARD GATE on the separate L2 `paths:` lane"; the other listed it under "EXPLICITLY NOT A DEPENDENCY, recorded so it cannot become an excuse to delay". A cold session reading only one lane would start the retrofit on 2.1.85; one reading the other would refuse. **Adjudicated once, here, and the losing text is deleted from both:** P7 and P10 proceed on 2.1.85 (they add no `paths:` blocks); **P8, P9, P18 and P20 carry a single hard precondition of `claude --version` ≥ 2.1.217, asserted mechanically at phase start.** Reasoning: the pre-2.1.207 class (one invalid pattern breaking the Read tool for every evaluated file) is **not** avoidable by authoring care, whereas the brace-crash class is avoidable by the brace-free discipline. Present-but-unpatched is worse than absent.

---

## §8 Before / after measurement table

Every row names its instrument. A row with no instrument is not a measurement.

| Metric | Before (measured 2026-07-26) | Target after | Instrument | Confidence |
|---|---|---|---|---|
| Always-loaded rule **bytes** | 210,784 B across 23 files | **9,342 B** (1 file) — 95.6% reduction | `wc -c` over files lacking `paths:`, asserted **self-referentially** (§4 invariant 2) | 🟢 before · design target after |
| Always-loaded rule **tokens** | unknown — **no token figure exists yet** | to be recorded | `/context` Memory-files line, captured three times (P7 baseline, P8 interim, P19 final), interactive-only at this version | 🔵 — **no token claim may be made until a capture exists; chars/4 estimates are forbidden** |
| Rules files carrying `paths:` | 0 of 23 | 20 of 21 (after 2 evictions); `database-standard.md` deliberately excluded | `InstructionsLoaded` reason flip `session_start` → `path_glob_match`, per file | 🟢 before |
| Rules files auto-loading that bind nothing | 2 (358 B tombstone + 8,302 B DRAFT) | 0 | `find .claude/rules -name '*.md'` (not `ls` — the loader recurses into subdirectories) | 🟢 |
| Law reaching **Codex** | `AGENTS.md` 12,418 B only; the 23 rules are Claude-only | the full safety-critical subset, via the shared core | fresh-session canary in both tools; Codex has no loaded-doc introspection, so the Codex side is **plausible, not proven** | 🟢 before · asymmetric after |
| `Last verified` stamp coverage | **8 of 23**, three spellings | 21 of 21, one spelling | `scripts/qa/lastverified-stamps.mjs`, header-only match, **baseline derived at run time** | 🟢 |
| Genuine dangling rule references | 1 (`documentation-standard.md:3` → rule 14; the Standard is rule 12) | 0 | `git grep -nE` excluding vendor/untracked, with the one false positive documented | 🟢 |
| `CLAUDE.md` derive-commands that return the wrong number | ≥1 (worker count returns 141; real 91) | 0 | re-run each command and paste output | 🟢 |
| Codex capability entrypoints visible to a cloud session | **0** of 81 | all surviving entrypoints | fresh-clone probe, run **before and after** | 🟢 before |
| Codex skill description budget | 19,742 chars vs an 8,000-char cap (2.5x over; SEO is 11,318 of it) | depends on ledger #4; pointer adapters cut the rest | pinned extraction rule (frontmatter `description` + `when_to_use`, folded, char count) | 🟡 inherited — **re-measure with the pinned rule before quoting** |
| Reviewer definitions with a return budget + scope line | **0 of 15** | 7 of 7 cross-cutting | grep for the required strings, one per file | 🟢 |
| Codex subagents pinning `sandbox_mode` | **0 of 30** | all reviewers/auditors/scouts | grep **plus a write-attempt effect test** (a user-layer `sandbox = "elevated"` exists, so presence proves nothing) | 🟢 before |
| Guard-script bodies per gate | 2 for secrets (**diverged**, 3,207 vs 2,569 B), 2 for SQL (identical) | 1 each | `cmp`, plus a fail-closed fixture returning exit 2 | 🟢 |
| Guards resolvable from a subdirectory | **NO** — exit **127** from `src/`, i.e. fail-open | yes, or exit 2 | `cd src && bash ./.claude/hooks/block-secrets.sh` with a payload; then the wrapper fixture | 🟢 — reproduced this session |
| Push-to-`main` enforcement | **none** (only `--force`/`-f` denied) | hook + belt denies, `dev` push unaffected | fixture table (exit 2 / exit 0) + an end-to-end `bash -lc` attempt + a hook sentinel line | 🟢 before |
| Free-form SQL tool denied | **NO** — `upr_sql` live; denies keyed to non-matching server aliases | regex matcher covering the real tool names | a probe of a denied-by-alias tool with the observed result pasted | 🟢 — new finding |
| `.env` read/edit denied | none | both `Read(...)` and `Edit(...)` spellings | live-session attempt, transcript pasted | 🟢 |
| Publication to non-`main` refs | pre-approved in a **tracked** file | unchanged by this plan; labelled PROSE-ONLY | inspection of `settings.local.json`; ledger #6 | 🟢 |
| Invariants mechanically guarded | 0 | 13 named check ids | `validate:agent-layer` **plus 12 deliberate-breakage fixtures** | 🟢 before |

---

## §9 Autonomy ledger

Reconciled against **both** colour systems, stated separately rather than blended: `docs/tooling-governance.md` §3 is owner-approved repo-wide project law (Green / Amber / Red); the per-initiative GREEN/YELLOW/RED ledger invented by `docs/db-foundation-roadmap.md` is the finer-grained one, and **by its own words "any CLAUDE.md standing-rule change" is RED** — so this initiative's core deliverable is RED-tier by the existing ledger's own definition.

| Phase | Tier | What it needs from the owner |
|---|---|---|
| **P0** | 🟩 GREEN | Nothing to start. The Codex `/status` + `/hooks` paste is an owner-supplied *input*, not an approval. |
| **P7** | 🟨 AMBER | Confirm the `.claude/settings.json` hooks-block claim (ledger #2/#9 adjudication). Nothing else. |
| **P10** | 🟨 AMBER | E1's result, or acceptance of the COMBINED reading. The `codex exec` walk test is owner-run. |
| **P11** | 🟨 AMBER | **Ledger #9** (checker agents are frozen by the *active* ux-alignment manifest) — hard. |
| **P8** | 🟨 AMBER | **Ledger #1** (version) and **#10** (evictions) — both hard. |
| **P13** | 🟨 AMBER → 🟥 for the commit | **Ledger #4** (SEO) before the commit; **#5** authorizes the `git add`; **#8** for the CI step. |
| **P14** | 🟨 AMBER | **Ledger #13** before any rename; **#14** before the deletion. Both conditional-only. |
| **P15 · P16 · P17 · P18 · P19** | 🟨 AMBER | **Ledger #9** for the `close-out-standard.md` amendment; **#8** for every CI step; **#1** for P18's `paths:`. |
| **P1** | 🟥 RED | Authorizes authoring the standing-rule layer. Stage the diff and approve. Also **ledger #7** (precedence rung) and **#16** (Codex depth primacy) shape its content. |
| **P2** | 🟥 RED | Approve the bridge. **Ledger #2** (lane G) for touching the root pair under a claimed `.claude` surface. |
| **P3** | 🟥 RED | Approve deleting the `CLAUDE.md` duplicate — **and accept that if the post-compact canary fails, the deletion does not happen and the L0 core stays Codex-only.** |
| **P4** | 🟥 RED | A permission change is explicitly §3 Red. Plus **ledger #3** (edit `.codex/`), **#6** (CAP-SEC-001), **#7-new** (regex vs alias denies). |
| **P5** | 🟥 RED | **Ledger #3**, extended to cover a **deletion** if `.codex/hooks/*.sh` are to be removed (§P12 note). Plus **#18** (canonical guard location). |
| **P6** | 🟥 RED | Approve new enforcement on the publication path. **Ledger #6**, **#15** (confirm Rules 4/6 unchanged), **#20** (do not claim sandboxing as a Claude control). |
| **P9** | 🟥 RED | **Ledger #11** (`database-standard.md` permanently unscoped) and **#12** (defer the three held files). Staged overnight per the db-foundation pattern. |
| **P12** | 🟥 RED | **Ledger #3** — hard. Nothing in P12 may run without it. |
| **P20** | 🟥 RED content, not red uncertainty | **Ledger #12** plus per-file confirmation that each holder merged. |

**Pre-authorization escape, offered explicitly.** If the owner prefers not to gate each RED phase individually, the sanctioned form is a named-item pre-authorization: *"P1, P2, P4 and P5 may proceed to a staged diff without further approval; P3, P6, P9, P12 and P20 each still require a fresh instruction."* Anything broader would itself violate `database-standard.md` §0's rule that a persistent permission is not reusable authorization.

**What no tier can cover, stated so it is never mistaken for mechanised.** The check that an authorization is **fresh, task-specific, and from the owner rather than from an orchestrating agent** is not enforceable by any mechanism in either tool. It is prose forever, and that is exactly why it must live UNSCOPED at the root of the shared core rather than in a `paths:`-scoped rule or a nested file, both of which are dropped at `/compact`.

---

## §10 OWNER DECISION LEDGER

Twenty decisions, collected from all five design lanes and de-duplicated. **None is resolved here.** Where a decision touches a recorded prior owner decision, that original rationale is quoted rather than summarised.

---

### 1. Upgrade Claude Code from the installed 2.1.85?

**Blocks:** P8, P9, P18, P20 (hard). Not P0, P7, P10, or Wave 1/2/4.
**Options.** (a) Upgrade to ≥ 2.1.217 before any `paths:` work. (b) Stay on 2.1.85, ship only the script-first phases, and accept that the 210.8 KB always-loaded problem **cannot be fixed at all** — `paths:` is the entire fix. (c) Upgrade **and** pin the version in the capability-floor doc so every future phase states the version it was verified on.
**Recommendation:** (a) then (c)'s pinning discipline, and let Wave 1 proceed now regardless — nothing in P0–P6 depends on any version above 2.1.85.
**Why this is more consequential than "too old".** Measured: `claude --version` → 2.1.85 on both PATH entries; a grep of the installed bundle finds `InstructionsLoaded` (9 hits, full five-value reason enum), `path_glob_match` (4), `claudeMdExcludes` (2), `disable-model-invocation` (4), and **no** `/goal` or `skillListingBudgetFraction`. So the mechanisms **exist** — which is worse than absent: pre-2.1.207 a single invalid `paths:` pattern broke the Read tool for **every** evaluated file, and pre-2.1.217 heavy brace groups could **crash at startup**. Two secondary consequences: `${CLAUDE_PROJECT_DIR}` (2.1.196+) — which the bundle *does* inject, contrary to one design lane's claim — and Read-deny-covering-Edit (2.1.208+) is absent, which is why P4 writes both `Read(...)` and `Edit(...)` denies explicitly.
**Caveat stated honestly:** the harness running a session may be a newer build than the CLI on PATH, so P0 records the in-session `/status` version too — but 2.1.85 is what a fresh `claude` launch uses, and that is the operative number.
**Prior owner decision:** none on versioning.

---

### 2. Does this initiative own the `.claude/` instruction-layer paths?

**Blocks:** P2, P4, P7, P11 (the `.claude` surface generally).
**Options.** (a) Declare this initiative to be lane G's instruction-layer slice, recorded as a dated addendum in that manifest. (b) Claim the specific paths from lane G with a narrow carve-out, leaving G otherwise intact. (c) Pause until lane G is either adopted as binding or retired.
**Recommendation:** (a), following the established house pattern ("Recorded so §1's frozen list stays truthful"). Cost is low — `.claude/rules/upr-engineering-foundation-wave-ownership.md` self-declares "DRAFT FOR OWNER REVIEW … not binding project law until the owner explicitly adopts it. It grants no authority", and its own §1 reports F1 and F2 complete with no active writer lease. **But the adjudication must be WRITTEN, not assumed: skipping it is precisely how two sessions end up each believing they own `.claude/`.**
**Prior owner decision (quoted):** that manifest's §3 assigns lane **G — Governance** "F5a secret/permissions; F5b adapters/paths; F5c triggers/plugins; exact `.claude` paths and evaluation tests", and its §5 marks `Q ∥ G` and `S1 ∥ G` CONDITIONAL pending "exact CI/config/fixture/checker paths must be assigned first". This decision satisfies that condition.
**Worth noting independently:** that 8,302 B draft auto-loads into every Claude session today and, by sitting in the law directory, **reads as law regardless of its disclaimer** — the exact inverse of this initiative's goal. Its disposition is ledger #10.

---

### 3. May this initiative edit `.agents/` and `.codex/` at all?

**Blocks:** P5's Codex wiring, **all of P12**, and therefore P13.
**Options.** (a) A narrow dated amendment permitting exactly: safety-parity repair, path-contamination repair, and generated adapters — leaving "not authoritative" intact, struck in place with a `superseded-by:` pointer. (b) A full amendment designating the trees governed and validated, bringing them under `validate:tooling` (which today references neither). (c) No amendment — P5's Codex half and P12 do not run; the unpatched vendor `supabase` skill, the stale `block-secrets.sh`, the two probably-inert matchers, the 31 broken `.Codex/` paths and 30 unpinned subagents all persist, and Codex cloud continues to run with zero capabilities.
**Recommendation:** (a) now, (b) as P13's natural tail once the renderer exists and the validator can check the generated output. **Sequence FIX-THEN-TRACK.** Tracking is *necessary* for Codex cloud to see anything, but tracking as-is would publish the unpatched supabase skill and the inert matchers to every clone and CI runner in one commit.
**One extension needed if P5's deletion is wanted (challenge finding P-7):** the amendment as worded permits repair and adapters; a **deletion** is neither. Either add a fourth enumerated operation — "removal of a superseded duplicate hook body, with the original content captured in the deprecation record" — or use the wrapper-in-place alternative and delete nothing.
**Prior owner decision (quoted):** §1 — "The tracked `.claude/` tree is the temporary canonical source … The untracked `.agents/` and `.codex/` candidate ports are not authoritative. They are not copied, promoted, deleted, edited, or validated by this initiative." The word *temporary*, and §7's owner-approved adapter direction, both anticipate this amendment.

---

### 4. What happens to the SEO trees?

**Blocks:** P13's commit step (the commit's contents depend on the answer). Everything else can be authored while it is open.
**Scale:** 31 skill bundles (`.agents/skills/seo*`, 232 files, 1,540,210 B) + 18 agents (`.codex/agents/seo*.toml`, 64,912 B) = **250 files / 1,605,122 B**, live for Codex, absent for Claude, and **57%** of Codex's description weight (11,318 of 19,742 chars).
**Options, costed.** (a) **DELETE both.** Takes Codex from 2.5x over its 8,000-char cap to ~1.05x and fully realises the recorded intent. Costs: collides with §1's "not deleted"; collides with §5's "Do not mass-delete optional bundles"; and because `.agents/` is untracked, any `.agents`-specific delta is **irrecoverable** (the `.claude` copies are recoverable from `ff76e01^`; these are not). (b) **TRACK as-is.** Commits 1.6 MB, makes them live in Codex cloud and the PR reviewer for the first time, and leaves Codex 2.5x over its cap so roughly half of all 51 skills stay silently invisible to implicit matching. Contradicts the recorded retirement intent. (c) **`git mv` both sets to a tracked quarantine outside every discovery root** (e.g. `docs/archive/tooling/seo-2026-07/`). Satisfies §1 (not deleted), realises §5's intent (not discoverable), satisfies §5's evidence-preservation procedure **in-tree** rather than only in git history, and fixes the truncation. Cost: 1.6 MB tracked.
**Recommendation:** (c). It is the only option that satisfies **both** governance provisions rather than picking a winner, and it preserves the evidence §5 explicitly requires.
**Prior owner decision (quoted).** §5: "On 2026-07-23, the owner confirmed that this repository does not own the public website and does not need a repository-local SEO provider suite. The 31 tracked SEO skill bundles and 18 tracked SEO agent entrypoints (250 files total) were therefore retired rather than promoted into the governed tooling surface." And: "Deprecation is evidence-led … then obtain owner approval before removal. Do not mass-delete optional bundles." Commit `ff76e01` deleted only the **tracked** `.claude` copies, so these untracked twins survived and the finding is unrealised for Codex. **The two provisions do not literally contradict — §5 scoped itself to *tracked* bundles, §1 protects the untracked trees — the conflict is on EFFECT.**
**Also worth surfacing:** `docs/tooling-governance.md` §2 still names `seo` as "the only broad SEO dispatcher" while zero SEO capability exists on the Claude side — a stale reference this decision makes either correctable or strikeable.

---

### 5. Authorize committing `.agents/` and `.codex/` to the repository?

**Blocks:** P13's final step. **Nothing in this plan performs it.**
**Scale:** `.agents/` 551 files / 6,028,609 B; `.codex/` 33 files / 124,392 B.
**Options.** (a) Commit after P12's fixes and ledger #4, with pointer adapters minimising body weight. (b) Commit only `.codex/` (124 KB — subagents, hooks, config), leaving `.agents/skills` untracked and accepting that Codex cloud has subagents and hooks but no skills. (c) Leave both untracked; Codex cloud and the PR reviewer keep running with zero capabilities and nothing reports it.
**Recommendation:** (a), strictly after P12 and ledger #4. Consider deduplicating `impeccable` in the same commit: the `.agents` copy is 2,222,139 B / 102 files whose five script paths are broken, while `.codex/hooks.json`'s PostToolUse hook **already** points correctly at `.claude/skills/impeccable/scripts/hook.mjs` — the working hook reaches into the Claude tree, direct evidence the duplicate is dead weight. Note the residual bulk after ledger #4 is mostly `impeccable` and `playwright-core` (3,773,385 B combined), both **progressive-disclosure level-3 reference weight**, both named in project law, both worth keeping.
**Prior owner decision (quoted):** §1 designates the tracked `.claude/` tree "the temporary canonical source", and §7's owner-approved strategy anticipates neutral packaging rather than permanent per-runtime duplication — so committing pointer adapters advances the approved direction, whereas committing 6 MB of duplicated bodies would entrench what §7 sets out to remove.

---

### 6. CAP-SEC-001 has come due — what happens to the tracked `settings.local.json`?

**Blocks:** P4 and P6's honesty claims (not their code). **No phase in this plan changes this file.**
**Measured, and wider than previously recorded:** the file is **tracked**, has **121** `permissions.allow` entries and **no `deny` key**. Among them: `apply_migration`, `execute_sql`, `Bash(git push *)`, `Bash(git add *)`, the `git commit -m` prefix rule, `Bash(gh pr *)`, `Bash(git checkout:*)`, `Bash(git merge:*)`, `Bash(git reset --soft:*)`. One allow entry embeds a literal live Encircle API bearer token in cleartext.
**Options.** (a) Add **name-based** denies in `.claude/settings.json` (deny beats allow at every level and cannot be re-allowed), preferring names over the current session-scoped MCP server-id hash. (b) **Untrack** the file — `.gitignore:34` already lists it, but the file was committed before that entry so the ignore is inert; `git rm --cached` is the actual fix, not another gitignore edit. (c) Both. (d) Defer to the recorded waiver date.
**Recommendation:** (c), and rotate the Encircle credential now. Both halves close different holes: untracking stops the pre-approval shipping to every clone; the deny closes it on this machine. **The residual mechanism, stated precisely:** `permissions.deny` in `settings.json` covers `mcp__UPR_MCP__upr_sql` but neither `apply_migration` nor `execute_sql`, so `block-destructive-sql.sh` is the **sole** surviving gate — it holds only because PreToolUse runs before permission evaluation, so exit 2 beats an allow. One hook stands between a standing pre-approval and shared production. And P12's probe 4 may reveal the Codex-side twin of that hook never fires at all. Note also that the cleartext credential in a tracked file is exactly what `block-secrets.sh` check #3 exists to prevent — the one check missing from the Codex copy P5 is collapsing.
**Prior owner decision (quoted):** `docs/tooling-governance.md` §6 — "The tracked `.claude/settings.local.json` remains a known critical owner gate from CAP-SEC-001 and CAP-GOV-001. This initiative does not alter credentials. The temporary validator waiver expires on **2026-08-06**; the owner must rotate/revoke the credential, review history, sanitize/untrack the file, and reset local approvals before that date." And `database-standard.md` §0 — "Applying a migration … requires a fresh, task-specific owner instruction … A skill, roadmap, persistent tool permission, provider approval, or prior apply instruction is not reusable authorization."

---

### 7. Replace the alias-keyed MCP denies with regex matchers? *(new — surfaced by the challenge pass)*

**Blocks:** P4's deny design; P6's parity-table honesty.
**Measured:** `.claude/settings.json` denies `mcp__UPR_MCP__upr_sql`, `mcp__UPR_MCP__upr_delete`, `mcp__UPR_MCP__upr_update`, `mcp__UPR_MCP__qbo_delete_*`, `mcp__github__merge_pull_request`, `mcp__Gusto__run_payroll`. The **live** servers in session are `mcp__c6f3f344-…` and `mcp__1cd66b34-…`. `settings.local.json` uses three further aliases including hash forms — direct evidence of alias drift across re-registrations. There is no `.mcp.json` in the repo to pin names.
**Consequence:** `upr_sql` (free-form SQL on the shared production project), `upr_update`, `upr_delete`, `upr_insert`, `upr_upsert`, `upr_rpc`, `github_commit_file`, `github_merge_pr` and `github_request` (raw GitHub API passthrough — can commit to `main` or merge a PR, bypassing git entirely) are **live with no matching deny**.
**Options.** (a) Extend the existing PreToolUse **regex** matcher to `mcp__.*__(apply_migration|execute_sql|upr_sql|upr_update|upr_delete|upr_insert|upr_upsert)` and add a second matcher for the GitHub write tools — regex survives server-id churn, literal denies do not. (b) Re-key the literal denies to the current server ids — fragile, and un-auditable by name. (c) Pin server names in a repo `.mcp.json` first, then keep literal denies.
**Recommendation:** (a). It is the only form that cannot silently lapse on the next server re-registration, and it is what P4 is written to do. **The parity table must state which gates are regex-backed and which are name-keyed-and-unverified.**
**Prior owner decision:** none specifically; this implements `database-standard.md` §1 ("Never expose free-form SQL to browser roles" and the free-form-SQL containment) and Rule 4.

---

### 8. Grant this initiative ownership of `.github/workflows/ci.yml` and `package.json` script keys?

**Blocks:** P13's `--check` step, P16's evidence step, P18's frozen-contracts step, **P19 (hard)**.
**Options.** (a) Claim via a dated addendum in `.claude/rules/upr-agent-qa-access-ownership.md` naming the exact additive blocks. (b) Decline the CI edits; run every guard only through the existing `validate:tooling` / `test:tooling` pair, which this plan already wires up — accepting that a manual gate is not a gate. (c) Defer all CI work until that initiative's P6 runs.
**Recommendation:** (a) if the owner will grant it — but note the guards do **not** depend on it. The degraded path (b) already gives real enforcement, so the CI block buys enforcement on contributions that do not run those commands: worth a one-paragraph addendum, not worth stalling on. **(c) is the weakest:** every failure mode these guards catch is silent, and "manual checks until P6" is precisely how a mis-authored glob survives into `dev`. Whichever is chosen, the decision is recorded **before** the file is touched, and if (b), the close-out says the invariant is not enforced rather than describing it as enforced.
**Prior owner decision (quoted):** that manifest's §1 records P1 as having delivered **and released** ownership of `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `vitest.config.js` and `playwright.config.js`; §3 reserves "assigned CI/release/native QA files" for a future P6; and §3 states verbatim: "If a phase needs an unlisted file, stop and obtain ownership. Do not self-expand the phase." `package.json` + lockfile is separately frozen by `db-foundation-wave-ownership.md` §1, `tech-messages-v2-wave-ownership.md` §1 and `ux-alignment-wave-ownership.md` §1. **This plan adds only script keys and no dependency, so no lockfile change is required.**

---

### 9. Authorize the `close-out-standard.md` amendment and the `paths:` retrofit on the five standards docs plus the checker agents, against the **active** ux-alignment freeze?

**Blocks:** P11 (hard), P15 (hard), P16, P17, P8/P9's frontmatter on those five files.
**Options.** (a) One dated addendum in `.claude/rules/ux-alignment-wave-ownership.md` authorizing (i) frontmatter-only `paths:` additions to the five standards docs and (ii) the two additive lines on the checker agents, plus the `close-out-standard.md` dated amendment. (b) Create a new sibling `handoff-standard.md` instead of amending. (c) Defer until the ux-alignment W1–W5 status is resolved.
**Recommendation:** (a). **(b) would create a FOURTH overlapping close-out list, which is precisely the problem this work exists to remove**, and the original task prompt explicitly directs preferring extension of `close-out-standard.md` because it is already law and already auto-loaded.
**Why this needs your attention beyond the addendum:** challenge finding P-3 established that **four** phases across two design lanes edit files this manifest freezes, and only one lane surfaced the freeze at all, for one file. Separately: ux-alignment W1–W5 have **no commits since 2026-07-18** while F-S1 (which authored these five standards) has shipped — so please say whether that initiative is stalled or live. It changes whether this addendum is a coordination note or a handover.
**Prior owner decision (quoted):** §1 — "**Plan-of-record docs** (`docs/ux-quality-roadmap.md`, `docs/ux-quality-dispatch.md`, this manifest, **the five `.claude/rules/` standards docs, the checker agents**). A session updates its OWN phase's checkboxes/status; it never re-authors these."

---

### 10. Evict the two `.claude/rules/` files that are not law?

**Blocks:** P8.
**A newly-measured fact changes the options:** the rules loader **recurses into subdirectories** of `.claude/rules/`, so moving either file into `.claude/rules/archive/` would **not** stop it loading. To stop loading, a file must leave the tree entirely — or carry `paths:`.
**Options.** (a) Evict both: `git rm` the 358 B tombstone (its own text says it binds nothing and points at the archive) and `git mv` the 8,302 B DRAFT to `docs/` beside its existing roadmap, starting a `docs/archive/rules/README.md` index so the next three archivals produce index rows instead of stubs. (b) Leave both in place but add `paths:` frontmatter scoping them to something they will never match — same byte saving, at the cost of a rule that is deliberately unreachable, which is dishonest bookkeeping. (c) Leave both loading unconditionally — 8,660 B and 4.1% of all rule bytes, of which 8,302 B is self-declared non-binding text that **reads as law because of where it sits**.
**Recommendation:** (a). The strongest argument is not the bytes: it is that 8.3 KB of admitted non-law in the law directory reads as law regardless of its disclaimer. Two mitigations make it cheap — an L0 pointer row for the draft's genuinely useful §5 disjointness ledger and §6 lease protocol, and the archive index so the breadcrumb survives. **Critical mechanical note (challenge finding S-7): `docs/archive/rules/admin-mobile-wave-ownership.md` already exists at 9,253 B**, so a plain `git mv` of the stub fails and a retry with `-f` would overwrite the archived substantive manifest with the stub. P8 therefore uses `git rm` plus an index row, with a before/after byte assertion on the archived file.
**Prior owner decision (quoted):** `CLAUDE.md` already records the rule — wave-ownership manifests "live here while their initiative is active; when its LAST phase merges, `git mv` the manifest to `docs/archive/rules/` with a one-line tombstone (keeps the active set honest)." Admin-mobile is the worked precedent (complete 2026-07-13, manifest moved, flag opened 2026-07-07). Eviction applies your own recorded rule; the only novelty is doing it without leaving a stub behind.

---

### 11. Confirm `database-standard.md` stays permanently unscoped at its full 9,342 B?

**Blocks:** P9.
**Options.** (a) Keep the full 9,342 B unscoped and let P1 decide independently what it also lifts, accepting deliberate duplication between L0 and this file. (b) Trim to ~5,500 B unscoped once the L0 lift lands, recovering a further 3,842 B — lifting §0, §3, §5's shared-Supabase sentence, §6 and §7 to L0 and leaving §1's function trap, §2's anon allowlist, §4 and §5's apply-window serialization. (c) Scope it like the others behind `supabase/migrations/**`.
**Recommendation:** (a), and **reject (c) outright.** This is the one file where cheap-at-startup must lose to survives-compaction: a mid-task `/compact` would silently remove the shared-production apply gate, and the content at stake governs the one Supabase behind both staging and production where a migration is live the instant it applies. 9,342 B is **4.4%** of the measured 210,784 B baseline — a rounding error against the 95.6% this plan removes. (b) is defensible later but should follow the L0 lift rather than accompany it, because a trim performed before the lift is verified would briefly leave the §2 allowlist as the only carrier of boundaries it does not fully state.
**Prior owner decision (quoted):** §0 is itself the rule that makes this file's availability non-negotiable — "Applying a migration or running SQL that can mutate the shared project requires a fresh, task-specific owner instruction to perform that live action. A skill, roadmap, persistent tool permission, provider approval, or prior apply instruction is not reusable authorization." A rule that must be present the moment a session *considers* applying cannot be one a compaction can remove. The file is also the most recently amended rules file (2026-07-25).

---

### 12. Hold the three deferred rules files until their holders merge?

**Blocks:** P9's scope, P20 entirely.
**Scale:** `messaging-transport-wave-ownership.md` 15,250 B + `tech-messages-v2-wave-ownership.md` 8,766 B + `omni-inbox-wave-ownership.md` 10,573 B = **34,589 B, 16.4%** of the baseline.
**Options.** (a) Hold all three, keyed to a named **merge** condition rather than a date; globs pre-authored and linted so the follow-up is mechanical. (b) Convert all three now and let whoever merges second resolve a frontmatter conflict — genuinely trivial, a few added lines at the top of each file. (c) Convert `tech-messages-v2` and `omni-inbox` now (their amender has not started) and hold only `messaging-transport`.
**Recommendation:** (a). The mechanical conflict *is* trivial, which makes (b) tempting and wrong for a different reason: `messaging-transport` carries the highest-consequence law in the set — the send-path invariants where a load miss can cost money and create legal exposure in the same action — and its holder currently has **61 uncommitted files** on `codex/messaging-transport-build`, so a conversion now would be authored against a base about to change substantially. The other two are named explicitly as amendment targets by the owner-approved 2026-07-26 participant-scoping work, whose own prompt declares it amends exactly those two manifests. (c) is the closest call, but holding costs 16.4% of a saving deferred by days, while a bad conversion on a consent-law file costs an unbounded amount.
**Prior owner decision (quoted):** this applies the deferred-hardening pattern you already approved for db-foundation, which gates on merges rather than dates — `db-foundation-wave-ownership.md` §8: "P3/P4 changes on these tables land only after the owning phase merges OR ship a committed backward-compat test that the in-flight caller still succeeds … Everything else is uncontested." The reasoning transfers cleanly from tables to files.

---

### 13. How are Claude skills made un-shadowable — rename, plugin, or accept?

**Blocks:** P14's conditional rename only. P11–P13 do not depend on it.
**The mechanism:** skill precedence is **managed > user (personal) > PROJECT** — the *inverse* of subagents, where project beats user — so a developer's `~/.claude/skills/<name>` **silently shadows** the repo-committed skill of the same name, with no warning and no way for CI to detect it (a personal directory is invisible to the repository).
**Options.** (a) **Rename the four UPR dispatchers** to a `upr-` prefix. Cost: 36 tracked files reference the current names (measured: `db-migration` 11, `masterplan` 17, `new-feature` 4, `new-crm-module` 4) and all must be repointed in one commit; the slash command comes from the **directory** name, so this is a directory rename. Protects the four that matter most for safety; does **not** protect the 20 vendor-named skills — `supabase`, `impeccable`, `cro`, `playwright-core` — which are the ones most likely to exist in a personal directory *because* they come from public marketplaces, and `supabase` is the one carrying the mandatory UPR override. (b) **A skills-directory plugin** (`.claude/skills/.claude-plugin/plugin.json`), namespaced and discovered in place, immunising **all** skills. Three documented limits, all material here: project scope loads only from the **launch directory's** `.claude/skills` and does **not** walk up to the repo root, so `cd functions && claude` silently yields zero skills — the same class of silent-absence failure this whole plan exists to fix, made worse because P10's Codex mitigation actively encourages subdirectory launches; changes to `hooks/`, `.mcp.json` or `agents/` need `/reload-plugins`; and a plugin-**bundled** MCP server changes the matcher string to `mcp__plugin_<plugin>_<server>__<tool>`, silently breaking **6 of the 13** `permissions.deny` rules and **5** `allow` rules. (c) Accept the risk, mitigated only by the fact that no personal-scope skill of those names exists today.
**Recommendation:** (c) for now, revisited if you ever add personal-scope skills — plus the report-only shadow-detection check P14 ships regardless, and **keeping the UPR MCP server out of any plugin now and forever whatever you decide.** The two design lanes disagreed here (challenge finding S-10: one recommended the rename, one recommended keeping the names), so this is presented once with both arguments. The risk is real but unrealised; a rename changes muscle memory for four commands you invoke regularly and touches 36 files; and (b)'s launch-directory limitation is disqualifying as a *primary* mechanism in a repo with 23 live worktrees. If (b) is ever adopted it must be **additive to (a), never a replacement.**
**Prior owner decision this collides with:** the 13 `permissions.deny` rules in `.claude/settings.json` are the enforced half of `database-standard.md` §0 and of §3's money/destructive posture. **Silently breaking 6 of them is strictly worse than the shadowing risk being solved.**

---

### 14. Approve deleting `admin-mobile-phase-reviewer`?

**Blocks:** P14's conditional deletion and the agents `15 → 14` bump.
**Options.** (a) Delete both copies. Evidence: the initiative is tombstoned ("initiative complete — all 7 phases merged … it binds no active session"; manifest archived to `docs/archive/rules/` on 2026-07-13) and the agent has **zero** references in `CLAUDE.md` or any `.claude/rules/` file. The Claude copy (5,116 B) is recoverable from git; the `.codex` twin is untracked, so its trivial `.Codex/`-contaminated delta must be captured in the deprecation record before deletion. (b) Keep it, marked archive-candidate per §5's vocabulary, and revisit when the other four initiative phase-reviewers tombstone.
**Recommendation:** (a). This is the single clean deletion in the whole plan — dead capability, archived initiative, zero law references, zero ambiguity — and admin-mobile is already the worked precedent for the archival rule. Record owner, reason, replacement = none, observation date; bump `.claude/tooling-governance.json` agents 15 → 14 **and remove its `governedEntrypoints` row**, or the validator raises `missing-governed-entrypoint`.
**Prior owner decision (quoted):** §5 — "Deprecation is evidence-led: mark a capability conditional, unavailable, superseded, or archive candidate; record owner, reason, replacement, and observation date; **then obtain owner approval before removal.** Do not mass-delete optional bundles." §1 additionally "requires this inventory stamp to change when tracked capability entrypoints are deliberately added or removed."
**Deferred and recorded, not proposed:** collapsing the **five** initiative phase-reviewers (crm, settings, sms-experience, tech, db-foundation) into one parameterized reviewer is the largest remaining consolidation, but each is named in its **active** ownership manifest's close-out section, so the collapse would edit live inter-session contracts — barred by constraint 4. Revisit as each initiative tombstones.

---

### 15. Confirm Rules 4 and 6 stay exactly as written — and how do their two internal tensions resolve?

**Blocks:** P1's §4 content, P6's framing, P15's amendment wording, P16's PR-only scope.
**Three questions in one, because they share a rationale.**

**15a — Mirror both verbatim?** Options: (a) verbatim, unchanged — **default and recommended**. (b) Reopen Rule 4 for RED-tier instruction-layer work specifically. (c) Reopen either generally.
**Recommendation:** (a). This plan needs no change to proceed: its RED phases already default to staged-diff-and-wait on the independent ground of risk tier, which is a **consequence** of tier, not an amendment to Rule 4. **Encoded as a decision fork so sessions proceed deterministically either way:** DEFAULT = both rules mirrored verbatim; FORK = if you reopen either, that ships as a separate disclosed amendment carrying the original rationale, never folded into this reconciliation.

**15b — Rule 6 vs close-out item 11.** Rule 6 ("Commit after every 2-3 files") directly contradicts `AGENTS.md`'s publication clause and `close-out-standard.md` step 11 ("Do not create commits, push, open PRs, deploy, or apply shared-database migrations unless the user requested that delivery step"). Options: (a) scope Rule 6 explicitly to "**once delivery has been authorized**, commit in small increments" — resolves the contradiction as a sequencing clarification without weakening either rule. (b) Retire Rule 6's cadence in favour of checkpointing plus one authorized commit at close-out. (c) Keep both and record the conflict — the status quo.
**Recommendation:** (a), with the stricter side (do not commit unprompted) governing meanwhile — which is what P15 records as a **pointer, not an interim default** (challenge finding P-12). Against (b): Rule 6's recoverability purpose is genuinely still needed and is **not** covered by checkpointing — Claude checkpoints do not track file changes made by bash commands, do not restore subagent edits, and normally miss concurrent-session changes, and this repo dispatches heavily to subagents, applies migrations via MCP, and has 23 live worktrees. Git really is the only reliable undo here. But recoverability during unauthorized work is served by small commits on a **session-assigned branch**, which is compatible with never publishing to `dev` unprompted. (c) leaves a live conflict in project law that two tools will resolve differently.

**15c — Rule 4 vs PR-time cross-tool review.** Codex's PR reviewer — which would consume the new `## Code Review Rules` section — only fires on a PR, and Rule 4 routes routine work direct to `dev`. Options: (a) keep Rule 4 exactly as written and route review to P16's in-session `/gauntlet`. (b) Keep Rule 4 as default but add a **named exception**: work touching a red-tier surface (money, consent/messaging, auth/RLS, migrations, public unauthenticated endpoints) goes via a PR into `dev` specifically to collect the cross-tool review, while genuinely routine work stays direct. (c) Reverse Rule 4 and require a PR for all work.
**Recommendation:** (b), as a **proposal only**. Two measurements sharpen the trade, both in your favour. First, the cost driver you identified is preserved: the quota burn was attributed specifically to PR-activity polling and per-PR bots, not to opening a PR, and `CLAUDE.md` already forbids sessions subscribing to or babysitting PRs — so a PR opened as a handoff and left for you to merge does not reintroduce the polling cost. Second, and this materially shrinks what a PR buys: **`.github/workflows/ci.yml` triggers on push to `dev` as well as on `pull_request`**, so build, test, `validate:tooling`, `test:tooling`, figma governance, migration provenance and the Playwright lane **already run** on direct-to-`dev` commits. The genuine PR-only losses are narrow and enumerable — the changed-files lint ratchet (explicitly gated on `github.event_name == 'pull_request'`), any Codex PR-time review, and P16's review-evidence gate. That makes (c) unjustifiable: full recorded cost for three narrow things. (b) buys the cross-tool fresh-context review exactly where the blast radius warrants it — one shared Supabase behind both `dev` and production, and TCPA penalties assessed **per message** — and nowhere else. If you prefer (a), P16 still delivers the computed trigger and single fan-out; only the independent fresh-context review is forgone.

**Prior owner decisions (quoted).** Rule 4 / Deployment, 2026-07-02: per-change feature-branch+PR for routine work was retired because "it exploded GitHub API usage and added a manual merge click for no benefit on a solo-owned repo", and more precisely because "it burned GitHub API quota (**mostly the PR-activity watch/babysit polling + the per-PR Cloudflare/claude[bot] bots, not the merge itself**) and added a manual click." Production still goes via a reviewed `dev → main` PR because "that's the one place a PR earns its keep (CI build+test gate before prod)." Rule 6 verbatim: "Commit after every 2-3 files. Small commits, clear messages." **No separate rationale is recorded for the cadence itself**; the nearest recorded reasoning is Rule 4's PR-cost argument, which does not transfer and is not presented as if it did.

---

### 16. For Codex, is on-demand depth delivered by the root pointer table or by nested `AGENTS.md`?

**Blocks:** P1 §7's content (~1.6 KB of the L0 budget), P10's whole design.
**Options.** (a) **Pointer-table-primary** in the root `AGENTS.md`, with nested files as a secondary belt for cd-into-subdirectory sessions and directory-scoped cloud tasks. (b) Nested-primary, which requires every Codex session to launch from the working subdirectory. (c) Both, with no stated primacy.
**Recommendation:** (a). Codex walks git root **down to cwd** and never descends past cwd, so a nested `AGENTS.md` at `functions/api/` or `src/pages/tech/` fires for **exactly nobody** in a root-launched session — which is every normal session in this repo. **Shipping nested files as the Codex mirror of `paths:` without resolving this would deliver a depth layer that silently does nothing, which is the single most likely way this reconciliation could look complete and be hollow.** Nested files remain worth adding as a belt, counted against the same chain budget. P10's `codex exec` walk test proves the behaviour rather than assuming it, and records the opposite outcome as a correction if it occurs.
**Prior owner decision:** none. Surfaced because it changes what L0 must contain.

---

### 17. Where does `docs/tooling-governance.md` sit on the unified precedence ladder?

**Blocks:** P1 §3's wording.
**Options.** (a) Rung 2 (project law) for tooling, capability and authorization questions; rung 4 (canonical doc) otherwise. (b) Rung 2 universally. (c) Rung 4 universally.
**Recommendation:** (a), stated explicitly in one line. The document labels itself owner-approved project law, and its §1 holds that a skill, agent, vendor bundle, plugin prompt, hook, permission allowlist or generated adapter cannot override `AGENTS.md`, `CLAUDE.md` or `.claude/rules/` — so it is **law about tooling** and subordinate to the core on everything else. Leaving this implicit is exactly the "the roadmap says X but the manifest says Y" failure the ladder exists to resolve, and it is cheap to state.
**Prior owner decision (quoted):** §1 makes those three project law that no capability can override, while §2 sets a separate trigger-precedence order for tooling selection. The two are consistent once the subject split is named, and ambiguous until then.

---

### 18. Where does the ONE canonical guard-script body live?

**Blocks:** P5's design.
**Options.** (a) Keep canonical in `.claude/hooks/` and point `.codex/hooks.json` at it. (b) Move both bodies to a neutral `scripts/agent-hooks/` and point both wirings there.
**Recommendation:** (a). **The runtime-specific path IS the enforcement here:** `.claude` (except `.claude/worktrees`) is a Claude PROTECTED PATH where writes are prompted in default mode, denied in `dontAsk`, and — critically — **cannot be pre-approved by `permissions.allow`**, because the safety check runs before allow rules are evaluated. Moving the guard bodies to a neutral directory would let a Claude session silently edit its own secret-blocking guard. The cross-tree reference is already precedented in this exact file: `.codex/hooks.json`'s PostToolUse impeccable hook already reaches into `.claude/skills/`. Expect prompts when legitimately editing `.claude/` during P5/P6 — correct behaviour, not a bug.
**Prior owner decision (quoted), and why it is deliberately not followed here:** §7, owner-approved 2026-07-23, prefers "one neutral instruction body using repository-root symbolic references rather than runtime-specific `.claude`/`.codex` paths." **Recorded as the rejected alternative, with the reason: for executable guards specifically, the `.claude` path carries a protection a neutral path forfeits.** For non-executable instruction bodies, §7's preference stands unchanged.

---

### 19. What is the standing posture on `claudeMdExcludes`?

**Blocks:** nothing hard; shapes P19's invariant 7 and any staged-migration convenience.
**Options.** (a) Use exclusions **only** in an uncommitted working tree for investigation, and add a guard assertion that `claudeMdExcludes` is absent or empty in every **tracked** settings file. (b) Untrack `.claude/settings.local.json` entirely (per ledger #6), then use exclusions freely in it. (c) Do not use the key at all — rely solely on adding and removing `paths:` frontmatter, which is already a complete and instant per-file switch.
**Recommendation:** (a) now, with (b) as a separate change. The guard assertion is the load-bearing half: exclusion arrays **merge** across settings layers, and `settings.local.json` is tracked, so a committed or forgotten exclusion silently keeps a rules file out of context **in every clone, forever, with no error** — the worst failure mode in this plan, and worse than the problem exclusions solve. (c) is nearly sufficient and worth stating plainly: because `paths:` can be added and removed per file with instant effect, and `paths: ["**"]` reverts a file to unconditional without deleting anything, exclusions are a convenience rather than a necessity. **Two mechanism notes for whoever implements it:** `claudeMdExcludes` **does** cover `.claude/rules/*.md` (refuting the inherited claim), and it uses a **different glob dialect** from `paths:` — picomatch on absolute forward-slash paths where brace groups work, versus gitignore semantics on repo-relative paths where they do not.
**Prior owner decision:** intersects ledger #6's open CAP-SEC-001 gate; adding migration-staging state to that file would compound an open finding rather than work around it.

---

### 20. Will Claude Code run inside WSL2, or is enforcement parity abandoned on this platform?

**Blocks:** nothing in this plan. Shapes P6's §8 parity table honesty and every future claim about Claude-side controls.
**Options.** (a) Run Claude Code inside WSL2 to gain an OS-level sandbox — noting the sandbox **fails open by default** unless `sandbox.failIfUnavailable` is set. (b) Stay on native win32 and accept that Claude's only OS-independent hard enforcement is `permissions.deny` plus PreToolUse hooks — which is exactly what P4/P6 build. (c) Defer.
**Recommendation:** (b) for now, with the standing instruction that **this repo must never list sandboxing as a Claude-side control on the current platform.** The asymmetry is inverted from intuition and load-bearing: Codex sandboxes natively on Windows; Claude does not. P12's `sandbox_mode` pins are therefore a genuine structural guarantee on the **Codex** side with **no Claude-side equivalent** on this machine — but even that claim is downgraded to "declared, unverified" unless P12's write-attempt effect test passes, because a user-layer `sandbox = "elevated"` exists and a grep for the key proves nothing.
**Prior owner decision:** none.

---

*Governing project law for this initiative: `docs/tooling-governance.md` (owner-approved) and `CLAUDE.md` rules 1–12. Reviewer set actually used: `upr-pattern-checker` (unconditional), `consent-path-auditor` and `worker-security-reviewer` on P9, `design-consistency-checker` and `page-behavior-checker` n/a (no UI touched), `migration-safety-checker` and `anon-grant-auditor` n/a (zero migrations) — each n/a stated with its reason rather than omitted. `UPR-Web-Context.md` remains the schema source of truth and is untouched by this plan except for its Rule 9 session entry. Verify live, not from memory.*
