<!--
════════════════════════════════════════════════
FILE: agent-alignment-dispatch.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  Copy-paste launch blocks, one per phase of the agent-instruction alignment
  plan. Each block is written so a brand-new session with no memory of any
  conversation can read it and do exactly one phase correctly, then stop.

DEPENDS ON:
  Internal:  docs/agent-alignment-roadmap.md (the plan of record),
             docs/agent-alignment-ownership-DRAFT.md (the file-ownership manifest),
             AGENTS.md, CLAUDE.md, docs/tooling-governance.md,
             .claude/rules/close-out-standard.md,
             .claude/rules/documentation-standard.md
  Data:      reads → none · writes → none

NOTES / GOTCHAS:
  - No block references any conversation. If a block seems to assume context you
    do not have, that is a defect in the block — say so rather than guessing.
  - NO BLOCK AUTHORIZES a commit, push, PR, deploy, migration apply, credential
    change, or provider action. Every one is a separate owner instruction.
  - Two runtimes are dispatched here. Each block states its Tool, because model
    names, effort vocabularies, skill-invocation syntax and sandbox availability
    all differ between them.
════════════════════════════════════════════════
-->

# Agent Instruction Alignment — Dispatch blocks

> ## ⚠️ STOP — READ BEFORE LAUNCHING ANY BLOCK
>
> **Added 2026-07-26, after these blocks were written.** Several are stale in ways that will send a
> cold session to build work that already exists or to run a command that does not exist.
>
> **Read [`docs/agent-alignment-roadmap.md`](agent-alignment-roadmap.md) §STATUS CORRECTION and
> [`docs/handoff/agent-alignment-session-3-handoff.md`](handoff/agent-alignment-session-3-handoff.md)
> first.** Where they and a block below disagree, **they win.**
>
> Known-stale in this file:
> - **`scripts/render-capability-adapters.mjs` never existed.** The real renderer is
>   `scripts/render-tooling-adapters.mjs`, invoked as `npm run generate:tooling` /
>   `npm run check:tooling-generated`.
> - **The L3 mechanism is already built** (`tooling/` + renderer + blocking drift check, landed
>   `0e27be0`). Any block telling you to build single-sourcing is superseded: the lane is
>   **extend coverage from 7 of 39 capabilities**, not build.
> - **`allow_implicit_invocation` is data-driven now** from `tooling/capabilities.json` →
>   `modelInvocable` (`545645f`). Any block claiming "0 such files exist" is wrong; 4 exist.
> - **The 3 Codex reviewer twins exist and are sandbox-pinned** (`0e27be0`, `41091bc`).
> - **"Mark side-effectful capabilities non-model-invocable" is SUPERSEDED** by owner direction:
>   *gate the mutation, not the dispatcher.* `db-migration` stays model-invocable; its apply is gated
>   by `.claude/hooks/block-destructive-sql.sh`.
> - **Do not edit `.github/workflows/ci.yml`.** It already runs `validate:tooling`, which blocks
>   adapter drift by itself. New invariants go inside `scripts/validate-tooling-governance.mjs`.
> - **Gates #4, #5 and #8 are closed** (SEO mirrors deleted; the trees are NOT to be committed; CI
>   ownership dissolved). Do not re-open them.
>
> **Before designing anything, run `git branch -a --no-merged dev`.** These blocks were authored
> without checking unmerged branches, which is exactly how the plan came to reimplement finished work.


**Created / last verified:** 2026-07-26 · **Slug:** `agent-alignment`
**Plan of record:** `docs/agent-alignment-roadmap.md` — the phase block there is authoritative on intent; `docs/agent-alignment-ownership-DRAFT.md` is authoritative on **names and paths** where the two drift.

---

## Preamble — read before using any block

**Each block is fully self-contained for a cold session with zero conversation history.** Use the branch your harness assigned you as-is; a `claude/…` or `codex/…` name is fine and the illustrative names below are cosmetic. Isolation in this initiative is **not** the branch — it is the file-ownership split in the manifest DRAFT plus the deferred-hardening bucket keyed to in-flight merges.

**Two runtimes.** Every block carries a `Tool:` line. Claude sessions invoke skills as `/name` (from the **directory** name, not frontmatter `name`); Codex sessions invoke them as `$name` and **must confirm project trust first** — an untrusted `.codex/` layer silently supplies no config, no hooks and no rules, and a fresh clone or CI runner starts untrusted.

**How work lands.** `CLAUDE.md` Rule 4 routes routine work **direct to `dev` with no PR**. This initiative's content is RED-tier under both `docs/tooling-governance.md` §3 and the db-foundation autonomy ledger (which classes any standing-rule change as RED), so **the default here is: stop with the diff, the verification report and the owner gates.** That is a consequence of risk tier, not an amendment to Rule 4. If — and only if — the owner separately authorizes publication, open a PR into `dev` as a handoff, mark it ready, and **stop**: do not merge, subscribe to, or babysat it.

**Standing hard constraints, repeated in every block because a cold session will not have read this preamble:**
1. **Docs and config only.** No change to `src/`, `functions/`, `supabase/`, `ios/`. Zero migrations. No live, provider, credential or external state.
2. **Do not renumber `CLAUDE.md` rules 1–12.** They carry 209 live references.
3. **Do not edit any active ownership manifest's ownership matrix.** Several initiatives are mid-flight and those matrices are live contracts between sessions.
4. **A substantive change to a `.claude/rules` file is a DISCLOSED AMENDMENT:** strike the old text in place with a `superseded-by:` pointer per `documentation-standard.md`. Never silently rewrite.
5. **If the two tools genuinely disagree, the STRICTER rule is the default and the conflict is surfaced to the owner** — never averaged, never silently resolved.
6. **A mid-session edit to `CLAUDE.md`, `AGENTS.md`, a `SKILL.md` or a settings file does not take effect until `/clear`, `/compact` or restart.** Verify in a session started *after* your edit. Never write "rule updated and followed" from one session.
7. **Report the real result.** `npx eslint` is not meaningful for a docs-only diff — **say so, with the reason, rather than fabricating a green run.**
8. **Nothing in your block authorizes a commit, push, PR, deploy, migration apply, or provider action.**

---

## ⚠️ BASE PREFLIGHT — every session's FIRST action, before reading anything else

```bash
git fetch origin dev
git checkout -B "$YOUR_ASSIGNED_BRANCH" origin/dev   # or stay on the harness branch if already based on dev

# The plan of record must be on disk. If ANY of these is missing, your base is WRONG.
ls -la docs/agent-alignment-roadmap.md \
       docs/agent-alignment-dispatch.md \
       docs/agent-alignment-ownership-DRAFT.md \
       AGENTS.md CLAUDE.md \
       docs/tooling-governance.md \
       .claude/rules/close-out-standard.md \
       .claude/rules/documentation-standard.md \
       .claude/rules/database-standard.md

# Initiative-specific preflight (two extra steps — do not skip):
claude --version                      # 17 documented version gates depend on this; record it verbatim
git status --porcelain | head -40     # a dirty tree here is a base problem, not yours to clean
```

**If any plan-of-record file is missing: STOP and re-sync from `origin/dev`. Do NOT recreate them, do not run a branch-reset recipe, and do not re-author a divergent copy.** This block exists because a prior initiative's Foundation phase branched from `main`, never saw its plan, and re-authored divergent copies of its roadmap, manifest and rulebook. This initiative's blast radius is the same law layer.

**Codex sessions additionally:** run `/status` and confirm this repository is **trusted** for project `.codex/` layers before you rely on any `.codex/` file, and record whether any managed/enterprise layer is in effect (managed layers override even CLI `-c` overrides, which would invalidate any reproducibility claim).

---

## Preconditions — which gate unlocks what

① **Wave 1 is serial.** P1 → P2 → P3. P4 needs P2 only. Do not launch P3 until P2's cold-session canary is green **in both tools**.
② **P8, P9, P18 and P20 require `claude --version` ≥ 2.1.217** (owner decision #1). The installed version is **2.1.85**, which contains the `paths:` mechanism but predates its bug fixes — present-but-unpatched is worse than absent. Assert the version mechanically at phase start; if it fails, **stop and report**, do not proceed with brace-free globs as a workaround.
③ **P9 additionally requires P3 merged with its post-compact canary green.** No mixed-content rules file is scoped before its safety fragment demonstrably loads from the shared core.
④ **No phase edits a deferred-hardening file until its in-flight holder merges.** The four held files are named in the manifest DRAFT §8.
⑤ **RED-tier items stage the diff and wait for the owner.** See the roadmap §9 autonomy ledger for which phase is which tier and what each needs.
⑥ **Nothing in any block authorizes a commit, push, PR, deploy, migration apply, or provider action.**

---

## Wave 0

### [Session P0 — Wave 0] Capability floor

```
Tool:         claude-code
Branch:       session-assigned (illustrative: agent-alignment/p0-capability-floor), cut from origin/dev
Model:        Sonnet
Effort:       medium
Launch after: nothing — this is the first phase
```

You are measuring what this machine can actually enforce, so that no later phase is authored against a feature that does not exist here. **One phase only, no scope creep.**

Run the BASE PREFLIGHT above first.

**Read:** this block · `docs/agent-alignment-roadmap.md` §§1, 2, 6 · `AGENTS.md` · `CLAUDE.md` · `docs/tooling-governance.md` · `docs/agent-alignment-ownership-DRAFT.md`.

**Build, riskiest first:**
① Write `scripts/qa/capability-floor.mjs`. It prints `claude --version`; greps the installed bundle (`$(npm root -g)/@anthropic-ai/claude-code/cli.js`) for `InstructionsLoaded`, `path_glob_match`, `claudeMdExcludes`, `disable-model-invocation`, `/goal`, `skillListingBudgetFraction`; attempts `codex --version` and records **absence** rather than guessing; counts `${CLAUDE_PROJECT_DIR}` occurrences in `.claude/settings.json` and `.codex/hooks.json`; checks whether `.codex/config.toml` exists; reads `~/.codex/config.toml` for `trust_level` and the `[hooks.state]` `trusted_hash` entries; runs `git grep -c model_instructions_file` as a baseline; and emits machine-readable JSON.
② Write `scripts/qa/capability-floor.node-test.mjs`. It must assert that **no row with verdict `AVAILABLE` cites only a vendor URL as evidence**, and that an absent binary yields `UNPROBEABLE-HERE` rather than an inferred value.
③ Write `docs/audit/2026-07/evidence/agent-capability-floor.md` — one row per mechanism, each with a verdict from `{AVAILABLE, VERSION-GATED, UNSUPPORTED, UNPROBEABLE-HERE}` and a **non-empty evidence field containing a local command and its raw output.** Mark every row 🟢 verified-here / 🟡 inherited / 🔵 owner-or-external.
④ Add one `package.json` script key: `"validate:capability-floor"`.
⑤ Write `docs/handoff/tooling-upgrade-decision.md` — the owner-facing brief listing which phases unlock at which Claude version.
⑥ Author (do not run) experiments E1, E2, E3 from roadmap §6, each with an **empty result slot**.

**Two corrections you must carry, not re-derive.** (a) The installed 2.1.85 bundle **does** inject `CLAUDE_PROJECT_DIR` into the hook environment — an earlier draft claimed otherwise, and acting on that claim would have broken both live safety guards. (b) Bracket classes **work** in `paths:` globs; **brace groups** match nothing. Record both as refutations.

**Frozen — do not touch:** `AGENTS.md`, `CLAUDE.md`, `.claude/rules/**`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/**`, `.codex/**`, `.claude/tooling-governance.json`, and everything under `src/`, `functions/`, `supabase/`, `ios/`.

**Acceptance:** every acceptance criterion in the roadmap's P0 block, verbatim.

**Close-out:** `npm run validate:tooling` + `npm run test:tooling` green · `npm run build` + `npm test` real results recorded (they gate nothing and prove no code changed) · `npx eslint scripts/qa/capability-floor*.mjs` clean (**this phase adds JS, so lint IS meaningful here**) · `.claude/tooling-governance.json` **unchanged** and say so explicitly · update `UPR-Web-Context.md` per Rule 9 · reconcile your roadmap checkboxes both directions · **then STOP with the diff, the verification report, and the two owner-or-external items (the Codex `/status` paste and owner decision #1).**

**NOT AUTHORIZED by this block:** commit, push, PR, deploy, migration apply, credential change, provider action.

---

## Wave 1 — the shared core and the bridge

### [Session P1 — Wave 1] Author the L0 shared core (additive; nothing is deleted)

```
Tool:         claude-code
Branch:       session-assigned (illustrative: agent-alignment/p1-l0-core), cut from origin/dev
Model:        Opus
Effort:       high   — reason: this is the standing-rule layer; a distortion propagates to both tools and every later phase
Launch after: P0 merged
```

You are creating the one body of law both tools load automatically. **This phase is purely ADDITIVE: all 23 rules files stay unconditional, `CLAUDE.md` keeps its full text, nothing is deleted. The temporary duplication is correct, not waste** — safety-critical law may never be transiently unenforced, so the core must exist and be proven to load before anything is removed or scoped.

Run the BASE PREFLIGHT first.

**Read:** this block · roadmap §§0, 1, 3, 4 and the P1 block · `AGENTS.md` · `CLAUDE.md` **in full** · `docs/tooling-governance.md` · `.claude/rules/database-standard.md`, `close-out-standard.md`, `workers-standard.md`, `documentation-standard.md` · the five send-path sections named in the roadmap's P1 scope · the manifest DRAFT.

**Build, riskiest first:**
① The `## Authority and authorization boundary` and `## Non-negotiable rules` sections — the safety content, first, because everything else in the file is navigation.
② `## Document precedence` — one ladder, identical in both tools (see owner decision #17 for where `tooling-governance.md` sits; if unanswered, state both readings and pick the stricter).
③ `## Code Review Rules` — placed **before** the depth map, restricted to the five P0/P1 families, with the comment explaining why lint-shaped rules are excluded.
④ `## Depth map`, `## Repository model and orientation`, `## Verify before shipping`, `## Context-reset instructions`.

**Byte budget — do not compress law to fit it.** Target ≤ 22,000 B, hard ceiling 26,000 B. Rules 1–12 move **VERBATIM** (measured 3,283 B — they already fit) and §4 gets ≥ 9.5 KB. **If a ceiling would force compression of a non-negotiable: STOP and report. The correct resolution is that the L2 phases re-scope their fragments and the affected rules files stay unscoped — never the reverse.**

**The single most important deliverable is the no-weakening coverage table.** One row per L0 statement **and one row per `CLAUDE.md` block that P2/P3 will later delete**, each citing source file and line, each verdict ∈ `{verbatim, distilled-same-strength, STRICTER}`. **Zero rows may read `weaker`. Zero rows may have destination `none`.** Pay particular attention to `CLAUDE.md:74-77` (the no-parallel-implementation rule) — it is **absent from `AGENTS.md` today** and must have a destination before P3 can delete it.

**Frozen:** `CLAUDE.md` (P2/P3's), `.claude/rules/**` (P8/P9's), `.claude/settings.json` (P4's), `.codex/**` (P4/P5/P10's), `.claude/tooling-governance.json`, all code paths. **The five existing send-path copies stay in place unchanged — the L0 block is ADDITIVE-ONLY and permanent duplication is accepted.**

**Acceptance:** the roadmap's P1 checklist verbatim.

**Close-out:** `git diff --stat` touches exactly one path · `npm run build` + `npm test` real results · `npx eslint` **declared n/a with the reason** · `npm run validate:tooling` + `npm run test:tooling` green · `UPR-Web-Context.md` Rule 9 entry · checkboxes reconciled both directions · **STOP with the diff, the coverage table, and the owner gates (#1 shapes nothing here; #7 and #16 shape this file's content; #2 covers touching the `.claude` surface).** This is a **RED** phase: stage and wait.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P2 — Wave 1] Bridge only — `@AGENTS.md`, with the duplicate KEPT

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: the @-import bridge is unproven in this repo on this build
Launch after: P1 merged
```

You are making both tools actually load the core, **without deleting anything.** There is no `@`-import anywhere in `CLAUDE.md` or `AGENTS.md` today, so this mechanism is unproven here.

Run the BASE PREFLIGHT first.

**Read:** this block · roadmap P1 and P2 blocks · `AGENTS.md` · `CLAUDE.md` · P1's coverage table.

**Build:**
① `CLAUDE.md` line 1 becomes exactly `@AGENTS.md`. **NOT a symlink, and never a committed symlink** — Git for Windows sets `core.symlinks=false`, so a committed symlink checks out as a plain text file whose entire content is the string `AGENTS.md`. That is the canonical silent "the rules stopped working".
② **One** redirect line in the routing block stating that the numbered non-negotiables live in `AGENTS.md`, imported above, numbering frozen, and that a "CLAUDE.md Rule N" reference resolves there. Without it, a reader following a live pointer sees only an import and concludes the rule was deleted.
③ The Claude-only mechanism notes listed in the roadmap's P2 scope.
④ Plant a unique canary token in `AGENTS.md` §2 and assert its uniqueness (`git grep -c <token>` → 1).

**Do NOT delete `## ⚠️ NON-NEGOTIABLE RULES` from `CLAUDE.md`.** That is P3's, and only after a post-compact proof.

**Acceptance:** the roadmap's P2 checklist. The load proof must be run in a session started **after** your edit — a mid-session edit does not apply until `/clear`, `/compact` or restart, so a same-session check verifies a stale state.

**Honesty requirement:** Codex exposes no loaded-doc introspection and no truncation warning. Your report must say so, and must **not** claim verification parity between the two tools.

**Frozen:** `AGENTS.md` content (P1's — you only add the canary), `.codex/**`, `permissions`, `.claude/rules/**`.

**Close-out:** as P1, plus both cold-session transcripts pasted. **RED — stage and wait.**

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P3 — Wave 1] Post-compact proof, then delete the CLAUDE.md duplicate

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: after this commit, AGENTS.md is the SOLE carrier of all 12 non-negotiables
Launch after: P2 merged AND its cold-session canary green in both tools
```

You are ending the duplication — but **only if** the import provably survives compaction.

Run the BASE PREFLIGHT first.

**Read:** this block · roadmap P1, P2, P3 blocks · `AGENTS.md` · `CLAUDE.md` · P1's coverage table · P2's canary transcripts.

**Build, in this order and no other:**
① **THE GATE.** In a session with real work in it, run `/compact`, then require the `AGENTS.md` canary to still be quotable with **zero file reads**. If the `InstructionsLoaded` instrument exists (P7), also require an `AGENTS.md` entry whose `load_reason` is `session_start` **or** `include`, with `parent_file_path` = `CLAUDE.md`. **If the canary does not survive: STOP. Do not delete anything.** The correct outcome is that the non-negotiables stay in `CLAUDE.md` permanently, the L0 core becomes Codex-only, and you record that finding. This is a legitimate result, not a failure of your session.
② Only if ① passed: verify by fixed-string grep that `CLAUDE.md:74-77`'s no-parallel-implementation rule is present in `AGENTS.md`. It is **absent today**, so if P1 did not carry it, **stop and report** rather than deleting it.
③ Delete only the blocks P1's coverage table assigned a destination, enumerating each one-by-one in your report against its row.
④ Decide the `### Task-specific foundation reading` table: move it into the depth map **or** leave it in `CLAUDE.md` below the import. **Do not delete it.**

**Acceptance:** the roadmap's P3 checklist, including the human spot-check that a "Rule N" reference still resolves via the redirect line, tested against rules 2, 7, 9 and 4 (the four densest reference targets).

**Rollback order, stated because it matters:** if both P3 and P1 must be unwound, **revert P3 first.** Reverting P1 while the duplicate is already deleted is the one sequence that leaves law absent.

**Frozen:** rule numbering, `.claude/rules/**`, `permissions`, `.codex/**`, any ownership matrix.

**Close-out:** as P1. **RED — stage and wait, and note explicitly in your report whether the post-compact canary passed or failed.**

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P4 — Wave 1] Per-tool routing: first Codex config layer, ignores, permission surface

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: edits the shared permission surface and creates the layer that switches Codex hooks on
Launch after: P2 merged. Independent of P3.
```

You own **all** `.claude/settings.json` `permissions` edits for this initiative, and `.codex/config.toml`. **This file lands FIRST among all Codex-side changes**, because `[features] hooks = true` is the precondition for every Codex hook probe in P5 and P12 — without it, those phases would measure a switched-off hook layer and misreport it as a matcher defect.

Run the BASE PREFLIGHT first, plus: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` to confirm the file parses before you touch it.

**Read:** this block · roadmap P4 block and §1's permissions findings · `.claude/settings.json` · `.claude/settings.local.json` (**read-only — do not edit it**) · `.gitignore` · `docs/tooling-governance.md` §§1, 3, 6 · P0's evidence file.

**Build, riskiest first:**
① `.codex/config.toml` (net-new): `project_doc_max_bytes = 65536`, `[features] hooks = true`, plus in-file comments recording the three deliberate absences (`project_doc_fallback_filenames`, `model_instructions_file`/`experimental_instructions_file`, and the keys a project scope may not override) so a later session cannot "helpfully" add them.
② **Regex, not alias, for destructive MCP tools.** Extend the existing PreToolUse matcher to `mcp__.*__(apply_migration|execute_sql|upr_sql|upr_update|upr_delete|upr_insert|upr_upsert)`, and add a second matcher `mcp__.*__(github_commit_file|github_merge_pr|github_request)` routed to P6's publish guard. **Why:** the 13 existing literal denies are keyed to server *aliases* (`mcp__UPR_MCP__*`) that do not match the live server ids, so the free-form `upr_sql` tool on the shared production project is live with no deny today. Regex survives server-id churn; literal denies do not. This is owner decision #7.
③ `.env` denies using **only** the `Read(...)` and `Edit(...)` spellings, **both** written explicitly — 2.1.85 predates read-deny-covering-Edit. **Never** use `Write(...)`, `Glob(...)` or `NotebookEdit(...)`: they are accepted but never matched, and this version emits no warning.
④ Two `.gitignore` lines: `AGENTS.override.md`, `CLAUDE.local.md`.

**Do not change `.claude/settings.local.json`.** Its pre-approvals are owner decision #6, an existing gate. **Do** record its full inventory in your report — including `Bash(git push *)`, `Bash(git add *)`, the `git commit -m` prefix rule and `Bash(gh pr *)` — and label publication to non-`main` refs **PROSE-ONLY, NOT ENFORCED.**

**Frozen:** `.codex/hooks.json`, `.claude/hooks/**`, `.codex/hooks/**`, `.codex/rules/**` (all P5/P6). No skill or agent frontmatter. No `.agents/**`. `AGENTS.md`/`CLAUDE.md`.

**Acceptance:** the roadmap's P4 checklist, including the Codex `--strict-config` / `/status` evidence that the two keys are honoured **at project scope** — and if they are not, the pin stays as documented intent explicitly labelled non-load-bearing.

**Close-out:** as P1, plus a fresh-session launch confirming **no permission-rule startup warning**. **RED — a permission change is explicitly §3 Red. Stage the diff and wait.** Owner gates: #3, #6, #7.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

## Wave 2 — gates

### [Session P5 — Wave 2] One canonical guard body per gate, failing closed

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: changes two live safety controls guarding a shared production surface
Launch after: P4 merged (features.hooks must exist before any Codex hook probe is meaningful)
```

You are collapsing a measured divergence: `.claude/hooks/block-secrets.sh` is 3,207 B and `.codex/hooks/block-secrets.sh` is 2,569 B, and the missing 638 bytes are the **entire** literal `Authorization: Bearer|Basic` credential check. `block-destructive-sql.sh` is byte-identical in both trees, which proves this is copy-drift, not a fork.

**STEP 0, BEFORE ANY EDIT — mandatory and non-obvious.** Copy `.agents/` and `.codex/` to a timestamped backup directory **outside** this repository and record its absolute path in your report. Both trees are untracked (`git ls-files` returns 0 for each) and neither is gitignored, so **`git revert` cannot restore them.** That backup *is* the rollback for the untracked half.

Run the BASE PREFLIGHT, plus the settings JSON-parse check.

**Read:** this block · roadmap P5 block · `.claude/hooks/*.sh` · `.codex/hooks/*.sh` · `.codex/hooks.json` · `.claude/settings.json` · `.claude/rules/workers-standard.md` §1 · `docs/tooling-governance.md` §§1, 3.

**The measured defect you are fixing, which is not the one the drafts described.** `cd src && bash ./.claude/hooks/block-secrets.sh` with a `.env` payload returns **exit 127**. 127 is not 2, and **exit 1 (or 127) is NON-blocking in both tools** — so both guards are silently **absent** for any session whose cwd is not the repo root. **Keep `${CLAUDE_PROJECT_DIR}`** in both wirings: the installed 2.1.85 bundle *does* inject it (verified), and in-script resolution cannot help because the failure happens before the script runs. The fix is a **fail-closed wrapper**: resolve `$CLAUDE_PROJECT_DIR`, fall back to `git rev-parse --show-toplevel`, and if the guard file is still not found, print a reason to stderr and **exit 2**.

**Build, riskiest first:**
① The fail-closed wrapper in both wirings, plus `*.sh text eol=lf` in `.gitattributes` **in the same commit** (with `core.autocrlf=true` a new guard script checks out CRLF, and a CRLF parse break is exit-not-2, i.e. fail open).
② Repoint `.codex/hooks.json` at `.claude/hooks/*`; widen its secrets matcher to `apply_patch|Edit|Write` (Codex's primary edit tool is `apply_patch`, so the current `Write|Edit` matcher probably never fires on the main write path); add `commandWindows` siblings; remove the hardcoded Windows absolute path and both `${CLAUDE_PROJECT_DIR:-.}` references. **Leave both `.codex/hooks/*.sh` in place as dead-but-harmless files.**
③ Widen `.claude/settings.json`'s secrets matcher to `Write|Edit|MultiEdit`.
④ Audit every exit path in both scripts: no `set -e`, every internal failure exits 2, and **no `continue`/`stopReason`/`suppressOutput` key anywhere** — in Codex those *fail* the hook and Codex then continues the tool call, so a cosmetic key turns a block into an allow.
⑤ `scripts/agent-hooks/run-gate-probes.mjs` + fixtures, and `scripts/agent-hooks/check-codex-hook-trust.mjs` (recompute each `.codex/hooks.json` entry's hash against the stored `trusted_hash` in `~/.codex/config.toml`).
⑥ **Only after** a human has re-trusted via `/hooks` and pasted an observed refusal for both a `.env` write **and** a bearer credential: delete `.codex/hooks/*.sh` in a **follow-up commit** — and only if owner decision #3's amendment explicitly covers a **deletion**, which as currently worded it does not.

**Acceptance:** the roadmap's P5 checklist. The controls matter as much as the blocks — **a guard that also fires on `.env.example` gets disabled by the next frustrated session.**

**Frozen:** `permissions` and `.codex/config.toml` (P4's). The publish guard (P6's). Any skill or agent frontmatter.

**Close-out:** as P1, plus the `hooks` count in `.claude/tooling-governance.json` **unchanged at 2** (bodies collapsed, not added) and say so. **RED — stage and wait.** Owner gates: #3 (and its deletion extension), #18.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P6 — Wave 2] Publish and apply hard gates

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high
Launch after: P5 merged (its wrapper and fail-closed convention)
```

`CLAUDE.md` Rule 4 says "never push `main` directly." Measured: `.claude/settings.json` denies only `git push --force` and `-f`; there is **no** deny for a plain `git push origin main`, and Claude's auto mode allows pushing to any branch including the default. **You are enforcing a clause Rule 4 already states — you are not changing Rule 4.**

Run the BASE PREFLIGHT, plus the settings JSON-parse check.

**Read:** this block · roadmap P6 block · `.claude/settings.json` · `.claude/rules/close-out-standard.md` step 11 · `CLAUDE.md` Rule 4 and its Deployment section · `docs/tooling-governance.md` §§3, 6.

**Build, riskiest first:**
① `.claude/hooks/block-branch-publish.sh` — the **single** publish gate, **parsing the resolved ref** rather than pattern-matching a literal: `git push origin main`, `-u origin main`, `HEAD:main`, `dev:main`, bare `git push` resolved against `@{upstream}`, `origin HEAD` resolved against the current branch, leading env assignments, force variants, and the `bash -lc "<script>"` single-command form. A broad `Bash(git push *)` deny is **rejected** — it cannot carry allowlist exceptions and would block the `git push -u origin <feature>` every handoff needs.
② `scripts/agent-hooks/block-branch-publish.node-test.mjs` — the negative table, **plus** the two non-blocking controls (`git push origin dev` and `git push -u origin claude/foo` must return 0) **plus** a fail-closed case (git unavailable still returns 2).
③ **MANDATORY PRE-REGISTRATION GATE.** `run-gate-probes.mjs` green against the standalone script **before** the `.claude/settings.json` registration commit, and a documented **non-Bash rollback** (Edit tool, then restart). **Why:** a fail-closed hook on matcher `Bash` with a parse bug blocks *every* Bash call after restart — including the `git revert` you would use to undo it.
④ A sentinel line written by the hook to a gitignored log on every invocation, so "hook never ran" is mechanically distinguishable from "hook ran and allowed". Add it to `block-secrets.sh` and `block-destructive-sql.sh` too.
⑤ **The end-to-end assertion no deny literal can satisfy:** in a live session run `bash -lc "BRANCH=main; git push origin $BRANCH --dry-run"`, require refusal, **and** require the sentinel. Do **not** use `git push --dry-run origin main` as the test — the flag sits between `push` and `origin` so it matches no deny spelling, and the enumerated deny would refuse it even if your hook were unwired or exiting 127.
⑥ **Subagent coverage probe:** dispatch a subagent instructed to run `git push origin main --dry-run`; require the refusal **and** the sentinel. No design lane tested whether PreToolUse fires for subagent tool calls, and the entire gate rests on PreToolUse. If it fails, remove `Bash` from `impeccable-manual-edit-applier`'s `tools:` list rather than documenting the write capability as deliberate.
⑦ `.codex/rules/upr.rules` — `forbidden` for the push-to-main forms **plus the mandatory companion `bash -lc` rule**, without which the no-split behaviour makes every rule trivially evadable. Verify with `codex execpolicy check` against both forms.
⑧ `docs/tooling-governance.md` **dated §8 addendum, appended, §§1–7 byte-unchanged** — the gate-parity table (including the **NOT MECHANISABLE** and **PROSE-ONLY** tiers), the two fail-open traps, and the platform inversion with the standing instruction never to list sandboxing as a Claude-side control on win32.

**Acceptance:** the roadmap's P6 checklist, including `git diff --numstat docs/tooling-governance.md` showing additions only and zero deletions.

**Frozen:** `.claude/settings.local.json` (owner decision #6). Rule 4 and Rule 6 text (owner decision #15) — **the non-blocking proof for `git push origin dev` is a named criterion precisely so Rule 4's routine path is demonstrated intact rather than assumed.** `permissions` beyond the enumerated push denies (P4's).

**Close-out:** as P1, plus `hooks` count **2 → 3** in `.claude/tooling-governance.json` **and** the `docs/tooling-governance.md` §1 prose stamp, same commit. **RED — stage and wait.** Owner gates: #6, #7, #15, #20.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

## Wave 3 — on-demand depth

### [Session P7 — Wave 3] Instrumentation, glob linter, empirical baseline (zero conversions)

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: edits .claude/settings.json's hooks block, which carries the two live safety hooks
Launch after: P0 merged. Independent of Waves 1 and 2.
```

You are building the only instrument that can **prove** a rule went from unconditional to on-demand, plus the linter that catches the silent-non-match failure mode mechanically. **You convert nothing.** All 23 rules stay unconditional throughout, so no law is transiently unenforced.

Run the BASE PREFLIGHT, plus `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`.

**Read:** this block · roadmap P7 block and §§1, 6 · `.claude/settings.json` · `.claude/rules/` **frontmatter only** · P0's evidence file.

**Build, riskiest first:**
① The `InstructionsLoaded` block in `.claude/settings.json`, as **five separate entries — one per literal load reason** (`session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`) — not a regex alternation. The reason-as-matcher contract is confirmed in the installed bundle; alternation support at this version is untested; hook layers merge so all matching hooks fire.
② **PROVE YOU DID NOT BREAK THE SAFETY HOOKS.** After the edit: the file parses as JSON, **and** both pre-existing PreToolUse hooks are shown still live by two deliberate triggers — an `Edit` on a scratch file containing a literal bearer credential must be blocked with the hook's stderr reason, and the destructive-SQL matcher must still appear in `claude -p --debug hooks`. A malformed settings edit silently disables `block-secrets.sh`, which is the one gate between the tracked `settings.local.json` `apply_migration` allow and shared production.
③ `scripts/agents/log-instructions-loaded.sh` — appends one JSONL line per load with `file_path`, `memory_type`, `load_reason`, `globs`, `trigger_file_path`, `parent_file_path`, timestamp. **Uses `set +e` and ends with an unconditional `exit 0`**: InstructionsLoaded cannot block and its exit code is ignored, so a `set -e` death would be a silent logging no-op rather than a visible failure.
④ `scripts/agents/verify-rule-globs.mjs` with `--self-test`. Reproduce the loader's pipeline exactly: strip a trailing `/**` from each entry, drop empties, and **if every survivor is `**` treat the rule as UNCONDITIONAL**; then match with gitignore semantics against repo-root-relative paths. `--self-test` must prove these measured behaviours — **CORRECTED 2026-07-26, do not build to the old spec:** `src/**/*.{js,jsx}` **DOES match** `src/pages/Foo.jsx` and `src/pages/Foo.js`. The equivalent shape was probed on both installed builds and loaded on both (`docs/agent-alignment-l2-evidence.md` §4c); the previous "brace groups match nothing" line would have made the linter enforce a behaviour the loader does not have. What the linter must actually catch is the **expansion budget**: a `paths:` entry whose brace groups multiply out to ≥ ~1,000 patterns silently never matches on 2.1.219 (measured: 512 loads, 1024 does not). Also: `src/pages/**` matches `src/pages/Foo.jsx` and `src/pages/tech/Bar.jsx` but not `src/pagesX/Y.jsx`; `functions/api/callrail-*.js` matches `callrail-connect.js` but not `twilio-webhook.js`; `src/pages/[A-Z]*.jsx` **does** match `src/pages/Admin.jsx` — **bracket classes work; the inherited claim that an unescaped `[` matches nothing is REFUTED.** Also assert the matcher module **resolved** — the gitignore-semantics package is present today only as a hoisted transitive dependency and is not in `package.json`, and a linter that cannot load its matcher would pass every glob.
⑤ `scripts/agents/check-memory-ancestors.sh` — walks to the filesystem root for `CLAUDE.md`/`AGENTS.md`/`CLAUDE.local.md` and checks `~/.claude/`. **Measured: none exist above or outside the repo on this machine, so this is PREVENTIVE, not a cleanup.** Say so.
⑥ Baseline captures: the JSONL must contain exactly **23** `session_start` entries with `memory_type: "Project"` plus one for `CLAUDE.md`. Then the **named human check** — a human runs `claude`, issues `/context`, and pastes the verbatim Memory-files breakdown and total, plus `/usage`. **This is the only source of a token figure. `claude plugin details` does not exist in the 2.1.85 bundle — record it as unavailable rather than citing it.**
⑦ Author experiments E1, E2, E3 (roadmap §6). **E1 and E2 are OWNER-RUN** — `codex` is not resolvable on PATH in the project shell, so your exit condition is that the fixture repo is committed and the result slots exist but are **empty**, with the stricter reading binding until filled. E3 you can run: use the temporary `.claude/rules/zz-probe.md`, both controls, and the invalidating outcomes declared in advance.
⑧ **Delete `zz-probe.md` before handoff** and confirm `find .claude/rules -name '*.md' | wc -l` returns 23. This is your TEST-row deletion.

**Frozen:** any `paths:` frontmatter (P8/P9's). `permissions` (P4's). `AGENTS.md`/`CLAUDE.md`.

**Close-out:** as P1, plus `npx eslint` on the three new `.mjs` files clean (**this phase adds JS**), and `.claude/tooling-governance.json` **unchanged** — say so. **AMBER.** A rollback must be followed by a restart before it is reported as effective.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P8 — Wave 3] Scope the ten zero-safety rules; evict the two non-law manifests

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: a mis-authored glob silently unloads a rule with no error message
Launch after: P7 merged. HARD GATE: assert `claude --version` >= 2.1.217 at phase start (owner decision #1).
```

**FIRST ACTION AFTER PREFLIGHT: assert the version.** If it is below 2.1.217, **STOP and report** — do not proceed with brace-free globs as a workaround. Pre-2.1.207, a single invalid `paths:` pattern broke the Read tool for **every** evaluated file, and that class is not avoidable by authoring care.

**Read:** this block · roadmap P8 block · the ten target files · P7's linter and baseline · the manifest DRAFT §§2, 8.

**Build, riskiest first — the largest byte win, taken first because these ten carry zero safety content:**
① The four largest: `motion-standard.md` (26,649 B), `tech-v2-wave-ownership.md` (11,324), `settings-overhaul-wave-ownership.md` (9,886), `db-foundation-wave-ownership.md` (8,995).
② `documentation-standard.md` (7,182) — **gated on the L0 depth-map row for the JS/JSX header template existing first.** Without that row, scoping this file makes `CLAUDE.md` Rule 12 unreachable for the `src/`/`functions/` files it governs. If the row is absent, skip this one file and say why.
③ `ux-alignment-wave-ownership.md` (6,565), `page-lifecycle.md` (5,245), `perf-budget.md` (3,169), `app-store-readiness-wave-ownership.md` (3,107).
④ The two evictions.

**`motion-standard.md` is deliberately NOT scoped to `src/pages/**`.** That would reload 26.6 KB on nearly every UI session and forfeit the whole win. The standard's own §1 forbids bespoke keyframes in a page, so real motion work touches `src/index.css` or a shared primitive; a stray page-level transition is caught by `design-consistency-checker` §9 and `review-animations` at close-out. Use the glob list in the roadmap's P8 scope verbatim.

**THE EVICTIONS — read this carefully, a naive command destroys data.** `docs/archive/rules/admin-mobile-wave-ownership.md` **already exists at 9,253 B.** A plain `git mv` of the 358 B `.claude/rules/` tombstone stub into that directory **fails**, and a retry with `-f` would **overwrite the archived substantive manifest with the stub**, destroying the only working-tree copy. Correct form: **`git rm`** the stub (its own text says it binds no active session and points at the archive) and add one row to a new `docs/archive/rules/README.md` index. **Assert the archived file's byte size is 9,253 both before and after.** The second eviction — `upr-engineering-foundation-wave-ownership.md`, 8,302 B, self-declared non-binding DRAFT — `git mv`s to `docs/` beside its existing roadmap.

**Mechanism finding you must honour:** the rules loader **recurses into subdirectories** of `.claude/rules/`, so moving a file into `.claude/rules/archive/` would **not** stop it loading. A file must leave the tree entirely or carry `paths:`. Verify with `find`, not `ls`.

**Acceptance:** the roadmap's P8 checklist. **The load-flip proof is per file and two-sided:** no `session_start` entry after `/clear`, **and** a `path_glob_match` entry with the correct `trigger_file_path` after reading a declared target. **A conversion producing neither is a FAILED conversion — revert its frontmatter before handoff, do not ship it with a note.** And `database-standard.md` must **still** produce a `session_start` entry — that single assertion is the standing proof the one permanently-unscoped file was not scoped by accident.

**Stamps:** derive the unstamped baseline **at run time** and record it verbatim. Measured today: **8 stamped, 15 unstamped, 3 spellings.** Do not hardcode any of those numbers as an acceptance threshold — earlier drafts asserted 11/23 and "exactly 12 unstamped", and one of them summed to 24 against 23 files.

**Frozen:** all body text (frontmatter + stamp + HTML comments only — `git diff` must show no deletions outside the stamp line). Any ownership matrix. The three deferred files (manifest DRAFT §8). The seven mixed files (P9's). `database-standard.md`.

**Close-out:** as P1, plus `.claude/tooling-governance.json` `rules` **23 → 21** and the prose stamp, same commit; `upr-pattern-checker` clean. **AMBER.** Owner gates: #1, #10.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P9 — Wave 3] Split-then-scope the seven mixed rules

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: these seven carry the consent, money, authorization and shared-production-database law
Launch after: P7 and P8 merged, AND P3 merged with its post-compact canary GREEN. HARD GATE: claude >= 2.1.217.
```

You are converting the files that mix safety-critical law with reference depth — **one at a time, each only after its own safety fragment demonstrably loads from the shared core.** Batching is forbidden and there is no way to make a batched conversion of a mixed file safe.

Run the BASE PREFLIGHT and assert the version.

**Read:** this block · roadmap P9 block · the seven target files · `AGENTS.md` (the landed L0 core) · P7's instruments.

**THE PRECONDITION, PER FILE — this is the whole safety argument.** Before adding `paths:` to any one of the seven: (a) confirm by fixed-string grep that its safety fragment is present in `AGENTS.md` on disk, **and** (b) confirm the core produced a load entry **in this session** whose `load_reason` is `session_start` **or** `include` with `parent_file_path` = `CLAUDE.md`. **The reason set is `{session_start, include}` and loosening it is forbidden** — the core is reached via an `@` import and the bundle's enum treats `include` as distinct, so a `session_start`-only check would false-fail on every conversion and tempt you to relax it, which is the dangerous outcome. **A conversion whose fragment is absent is NOT performed — stop and report that file.**

**Build, riskiest first:** `sms-experience-wave-ownership.md` (23,321 B) → `crm-wave-ownership.md` (24,296) → `close-out-standard.md` (**6,908 B** — note the corrected figure; an earlier draft said 5,898) → `workers-standard.md` (4,279) → `upr-agent-qa-access-ownership.md` (7,476) → `tech-mobile-ux.md` (4,411) → `loading-error-states.md` (3,511) → `scope-sheet-rollback.md` (1,869, **only after L0 carries a `Runbooks` pointer line**).

**The single strongest reason this phase exists, in its own words.** `sms-experience`'s two load-bearing reason strings (`sms_disabled`, `quiet_hours`) are documented in a file scoped to `functions/lib/automated-send.js`, while the file that would **break** them is `functions/api/process-sequences.js` — owned by a different initiative and covered by a different glob. **A cross-initiative contract fact is unreachable from the place it matters unless it is at L0.** Confirm that fragment is in the core before scoping this file.

**Two deliberate glob exclusions, and the near-miss assertions that prove them:** a migration file must **not** match `crm-wave-ownership.md` (24.3 KB on every migration read defeats the purpose; its frozen-signature list is reached via the L0 pointer table), and `src/pages/Admin.jsx` must **not** match `motion-standard.md`.

**`database-standard.md` gets NO frontmatter, permanently.** This is the one place where cheap-at-startup must lose to survives-compaction. 9,342 B is 4.4% of the 210,784 B baseline. See owner decision #11.

**Byte arithmetic must be SELF-REFERENTIAL, never a constant.** Assert `sum(all rules bytes) == sum(scoped) + sum(evicted) + sum(deferred) + sum(unscoped)`. An earlier draft hardcoded 209,774 as exact equality, which **fails on arrival** (the real total is 210,784) in a way indistinguishable from the file loss the check exists to detect. Report the dated baseline as a non-failing drift line.

**Also required:** the named human check that `/compact` produces a `compact` load reason on `database-standard.md` and `CLAUDE.md` while the seven converted files do **not** reappear. That demonstrates on this machine the mechanism the whole boundary rests on.

**Frozen:** the three deferred files (P20's) — `git diff --name-only` must contain none of them, all three must still produce `session_start` entries, and **their release condition goes in your report in prose so a held file is never mistaken for a forgotten one.** No deletion from any depth file (temporary duplication is correct). Any ownership matrix.

**Close-out:** as P1, plus the reviewer gauntlet weighted to the content moved — `upr-pattern-checker` (unconditional), `consent-path-auditor`, `worker-security-reviewer`; `migration-safety-checker` and `anon-grant-auditor` declared **NOT APPLICABLE with the reason**. **RED — stage and wait.** Owner gates: #1, #9, #11, #12.

**Rollback order is fixed:** un-scope first, and only then consider touching L0. Reverting an L0 fragment while a depth file is still scoped is the one sequence that leaves law unenforced.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P10 — Wave 3] The Codex depth layer

```
Tool:         claude-code (authoring) + codex (the two behavioural probes)
Branch:       session-assigned
Model:        Sonnet
Effort:       medium   — additive context files plus one budget script; removes nothing, gates nothing
Launch after: P1 merged (the root anchor must exist) and P4 merged (the byte cap)
```

Codex has **no** conditional-markdown mechanism at all. Its nested-`AGENTS.md` walk goes **git root down to cwd and stops** — so a nested file at `functions/api/` or `src/pages/tech/` fires for **exactly nobody** in a root-launched session, which is every normal session in this repo. **The pointer table is the mechanism; nested files are the belt.** Shipping nested files as the mirror of `paths:` without this correction would deliver a depth layer that silently does nothing — the single most likely way this reconciliation could look complete and be hollow.

Run the BASE PREFLIGHT. Codex-side probes additionally require project trust confirmed via `/status`.

**Read:** this block · roadmap P10 block and owner decision #16 · `AGENTS.md` · `.codex/config.toml` · P0's evidence file.

**Build:**
① `docs/agent-depth-map.md` — the **single source** for the path-to-document mapping, long form. Only a **condensed** version goes into the L0 file, so the mapping cannot drift into two independently-edited copies.
② The condensed rows, **supplied to P1's owner, not written by you into `AGENTS.md`.** This is a negotiated cross-lane seam: you supply the rows, P1 owns the root file and reserves the anchor. **Two phases co-editing the root pair is exactly the collision the manifest exists to prevent.**
③ Seven nested `AGENTS.md`: `supabase/migrations/`, `functions/` (placed there, not `functions/api/`, so one file covers both `api` and `lib`), `src/`, `src/pages/`, `src/pages/tech/`, `src/pages/crm/`, `ios/`.
④ Every nested file carries the fixed header **"Additive to the root AGENTS.md. Never relaxes a root non-negotiable."** Not decoration: Codex's user-facing wording is *override* semantics, so without the header a subdirectory file reads as licence to weaken L0.
⑤ `scripts/agents/check-agents-chain-bytes.mjs` — computes every git-root-to-directory chain, treats the cap as **COMBINED** (the stricter of two contradicting vendor pages) until E1 says otherwise, and exits non-zero above a threshold set against the root size P1 actually landed, leaving deliberate slack because Codex drops the **tail** silently.

**NO SAFETY LAW IN ANY NESTED FILE.** Two independent reasons: a root-launched Codex session never loads them, and the Claude-side analogue is dropped at `/compact`. Verify with a keyword grep (`apply_migration`, `skip_compliance`, `anon`, push-to-main, `opt_in`, `consent`) returning only **pointer-shaped** lines — and review it as a human check too, because the grep proves absence of keywords, not absence of intent.

**The two behavioural probes (owner-run — `codex` is not on PATH here):** (a) `codex exec` from the **repo root** with a prompt whose correct answer requires content only in `src/pages/tech/AGENTS.md` — expected result is **failure to know it**, confirming the walk. Then re-run from `cd src/pages/tech`; it must succeed. **Record both outcomes; if the root-launched run unexpectedly succeeds, record that as a correction rather than quietly absorbing it.** (b) `codex exec` from the root asked to make a trivial reversible edit under `supabase/migrations/` must **first read** `database-standard.md`, verified from the session's own tool-call record, not its prose claim.

**Honesty requirement:** state plainly that Codex exposes no way to see which `AGENTS.md` files it loaded or whether truncation occurred. The Claude half is **proven** per file by the reason flip; the Codex half is byte-counted plus canary-probed and is therefore **plausible, never proven.** A parity claim is forbidden.

**Frozen:** `.codex/config.toml` (P4's). `AGENTS.md` (P1's). `.claude/rules/**`.

**Close-out:** as P1, plus `npx eslint` on the new `.mjs` clean. **AMBER.** Owner gates: #16, and E1's result (or acceptance of the COMBINED reading).

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

## Wave 4 — capabilities

### [Session P11 — Wave 4] Cut and instrument the Claude-side roster

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P0 merged. HARD GATE: owner decision #9 (the checker agents are frozen by the ACTIVE ux-alignment manifest).
```

You are applying the roster cut and reviewer hardening **entirely inside the tracked `.claude/` tree**, so this phase needs no amendment to `tooling-governance.md` §1 and can land while every other owner decision is open. **You delete nothing and you do not touch `.agents/` or `.codex/`.**

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P11 block · `.claude/skills/*/SKILL.md` frontmatter · `.claude/agents/*.md` · `docs/tooling-governance.md` §§1, 2, 5 · `.claude/rules/close-out-standard.md` §2 and its "Standard agent output format" section · `.claude/agents/design-consistency-checker.md` check 1 · `.claude/rules/motion-standard.md` §6.

**Build:**
① `disable-model-invocation: true` on the retained content/marketing set **plus `animation-vocabulary`** — 10 files. **The four UPR dispatchers are P14's, not yours.** Do **not** use `user-invocable: false`: it hides the `/` menu only and does not block Skill-tool access.
② Two lines appended to each of the **seven** cross-cutting reviewer definitions: a ~1,000–2,000 token return budget inside the existing verdict-plus-numbered-findings format, and this **exact** scope line: *"Flag gaps affecting correctness, the stated requirements, or any violation of a cited project standard (CLAUDE.md non-negotiables and .claude/rules blockers and HARD failures). A standard-cited finding is never dropped to fit the return budget."* **Do not use the shorter draft wording** ("only gaps affecting correctness or the stated requirements") — it would license a reviewer to suppress a documented blocker, since `design-consistency-checker` check 1 makes a page-scoped palette object a blocker and `motion-standard.md` §6 makes a missing reduced-motion fallback a HARD failure, and neither is "correctness" or a stated requirement of the change under review.
③ `.claude/agents/impeccable-manual-edit-applier.md` — keep `tools:` and `maxTurns: 12` **unchanged** (it is the only write-capable Claude subagent, intentionally) and add one inline note that the write capability is deliberate, so a later uniformity sweep does not "fix" it. **Subject to P6's subagent-coverage probe:** if PreToolUse does not fire for subagent tool calls, `Bash` comes out.
④ **Deprecation record ONLY for `admin-mobile-phase-reviewer` — the file STAYS on disk.** Record owner, reason, replacement = none, observation date, per §5. **The deletion and the agents `15 → 14` bump are P14's, gated on owner decision #14.** §5 permits recording the deprecation now, not the removal.
⑤ `skillOverrides` set to `name-only` for the down-ranked vendor specialists — reclaims listing budget without forking any vendor bundle.
⑥ Validator assertions with a **PINNED extraction rule** for the description-budget report (frontmatter `description` + `when_to_use`, multi-line folded, counted in characters) so before/after numbers are comparable across phases; plus assertions that every gated capability carries the flag and every reviewer carries both new lines. **Do NOT add** skill-dir-equals-frontmatter-name, agent-name-uniqueness, or duplicate-entrypoint-name assertions — **all three already ship in `scripts/validate-tooling-governance.mjs` and pass today.** Note that fact in your report instead.
⑦ Prove each new assertion **live**: remove one gate flag and one reviewer scope line, observe a non-zero exit naming both files, restore, paste the failing output.

**`/context` after-capture must be taken in a session started AFTER the edit.** The skill listing is built at session start, so an after-capture from your editing session shows the pre-edit listing and would read as a failure of `disable-model-invocation`. A gated skill's description is absent from the listing **by design** — do not misread that as a broken skill.

**Frozen:** `.agents/**`, `.codex/**` (P12's). The four dispatcher `SKILL.md` files (P14's). `permissions` (P4's). Any deletion.

**Close-out:** as P1, plus `.claude/tooling-governance.json` **unchanged** with an explicit "no change required, counts re-verified" statement; `npx eslint` on the two changed validator files clean. Expect protected-path prompts editing `.claude` — **correct behaviour, not a bug.** **AMBER.** Owner gates: #9 (hard), #2.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P12 — Wave 4] Close the Codex-side safety divergences

```
Tool:         claude-code (authoring) + codex (probes 3 and 4, and the sandbox effect test)
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: fixes a live production-data hazard and the sandbox posture of 30 subagents
Launch after: P4 merged (features.hooks) and P5 merged (hook wiring is P5's, not yours). HARD GATE: owner decision #3.
```

**STEP 0, BEFORE ANY EDIT:** confirm P5's out-of-repo backup of `.agents/` and `.codex/` exists and record its path. Both trees are untracked, so `git revert` cannot restore them.

Run the BASE PREFLIGHT. Codex probes require project trust confirmed first.

**Read:** this block · roadmap P12 block · `.claude/skills/supabase/SKILL.md` **and** `.agents/skills/supabase/SKILL.md` · the six diverged bodies · `.codex/agents/*.toml` · `docs/tooling-governance.md` §§1, 5 · `.claude/rules/database-standard.md` §0.

**Build, riskiest first — and the first item is the highest-severity finding in the whole initiative:**
① Port the 15-line `## UPR project override (mandatory)` block **verbatim** from the Claude copy (12,795 B) into `.agents/skills/supabase/SKILL.md` (12,091 B). The Codex copy is the **unpatched vendor original**, instructing the agent to make schema changes with `execute_sql` / `supabase db query` so it "can iterate freely" — aimed at the one shared Supabase behind both `dev` and production, where a migration is live in prod the instant it applies. **Verbatim, no rewording, so the two stay diffable. Never weaken the Claude copy to match — stricter wins.** Acceptance is a `diff` showing only documented tool-name substitutions and **zero normative delta**.
② Re-sync the other five diverged bodies **from** `.claude/`, enumerating and justifying each remaining delta, and settle **one** canonical `product-marketing.md` write target (the two trees currently write different paths, which will silently produce two divergent context documents). Note that the Codex `content-strategy` cross-references the retired `seo-audit` / `ai-seo` / `programmatic-seo` skills, re-advertising the §5 retirement by reference.
③ Repoint all **31** `.Codex/` path references across 18 files to the real tracked `.claude/...` paths. Two concrete breakages closed: `impeccable`'s Codex copy invokes 5 scripts under a directory that does not exist, and `page-behavior-checker.toml` cites `.Codex/rules/page-lifecycle.md` when **no `.codex/rules/` directory exists at all.** These resolve case-insensitively and still miss on Windows, and fail outright on the Linux filesystem of a Codex cloud container. Verify with a grep returning 0 plus a resolver script reporting zero missing targets.
④ Pin `sandbox_mode = "read-only"` on every reviewer/auditor/scout `.codex/agents/*.toml` (**0 of 30 pin it today**, while 12 describe themselves as "Reports; does not edit"). Codex subagents inherit `sandbox_mode`, `mcp_servers` and `skills.config` from the parent when omitted, **and** inherit the composer's permission mode. Pin `impeccable-manual-edit-applier` write-capable **explicitly** rather than by inheritance, with a turn cap matching the Claude twin's `maxTurns: 12`. Pin `upr-scout` too — it is the most frequently spawned subagent in the repo and currently pins only `model_reasoning_effort`.
⑤ **PROVE THE PIN BY EFFECT, NOT BY GREP.** `~/.codex/config.toml` sets `sandbox = "elevated"` at the user layer. A string-presence grep proves nothing about whether an agent-level pin overrides that. **Effect test:** from a write-enabled parent, spawn one pinned read-only reviewer and have it attempt a write to a scratch file; PASS = refused, transcript pasted. Record the user-layer value and which layer wins. **If the effect test cannot be run, downgrade the parity-table entry to "declared, unverified" and remove any claim of Codex-side superiority from the plan.**
⑥ **PROBE 3 (secrets hook):** in a scratch worktree, have Codex attempt via its normal edit tool (a) a literal bearer-credential line and (b) a `.env` write. Record for each whether the call was **BLOCKED with the stderr reason.** If not, capture the tool name Codex actually reported, fix the matcher, re-probe. **Report the OBSERVED behaviour, never the intended behaviour.**
⑦ **PROBE 4 (destructive-SQL hook):** invoke the Supabase MCP SQL tool from Codex against a harmless `select 1` and record **exactly what tool-name string appeared in the hook payload.** That observed string becomes the matcher. If Codex uses bare tool names, the existing `mcp__.*__execute_sql` matcher is **PROVEN inert** — record that as a live security gap, do not quietly fix and forget it.
⑧ Author the `docs/tooling-governance.md` §1 amendment per owner decision #3, struck in place with a `superseded-by:` pointer, quoting the original provision, the rationale and the owner approval line. **Note: as worded, the amendment permits repair and adapters — a DELETION is neither**, so if P5's follow-up deletion of `.codex/hooks/*.sh` is wanted, the amendment needs a fourth enumerated operation, or the wrapper-in-place alternative is used and nothing is deleted.

**Remember: a Codex repo hook is inert unless `features.hooks` is on, the project is trusted, AND the hook's current hash is trusted — and editing a hook re-arms that gate.** A human `/hooks` re-trust is part of probes 3 and 4.

**Frozen:** `.codex/hooks.json` and both hook scripts (P5's). Any `git add` of either tree (P13's). Any capability deletion. `permissions`.

**Close-out:** as P1, plus `npx eslint` declared **n/a with the reason** (shell, TOML, markdown only). **RED — nothing in this phase may run without owner decision #3.**

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P13 — Wave 4] Generated pointer adapters, then commit both trees

```
Tool:         claude-code (authoring) + codex (the cross-tool review probe)
Branch:       session-assigned
Model:        Sonnet
Effort:       medium   — the renderer is mechanical; the commit step is a publication action
Launch after: P11 and P12 merged, P2/P3 merged, AND owner decision #4 answered (the SEO disposition determines the commit's contents)
```

You are establishing **one canonical body per capability with zero duplicated normative text**, then — **only with separate owner authorization** — getting both trees committed so Codex cloud sessions and the Codex-hosted PR reviewer stop silently running with no capabilities at all.

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P13 block · `docs/tooling-governance.md` §7 · P11 and P12 reports.

**Three mechanisms are REJECTED — record why, so no later session plans on them.** (a) Committed symlinks: `core.symlinks=false` is measured in this repo, and a committed symlink checks out as a text file whose entire content is the target path. (b) Directory junctions: machine-local, absent from every fresh clone, CI runner and cloud container — which is precisely the failure this phase fixes, so they are a developer convenience only. (c) `[[skills.config]]`: it keys on a path to enable or disable a specific skill, so it is a **toggle, not a registration**, and cannot make `.claude/skills` visible to Codex. **Therefore: generated thin POINTER adapters**, which is exactly the owner-approved model in §7.

**Build:**
① `scripts/render-capability-adapters.mjs` — deterministic, with a `--check` mode exiting non-zero on any drift. Adapter shape ~300–600 B: a front-loaded trigger description, the **BINDING CONSTRAINTS inline at the TOP**, then a pointer to the canonical body. **Constraints go at the top because a re-injected skill body is truncated keeping the START.**
② Generated `agents/openai.yaml` with `policy.allow_implicit_invocation: false` for every capability gated in P11 and P14. **Zero such files exist anywhere today**, so the Codex half of the owner-authorization posture is currently prose-only while all 51 Codex skills are implicitly invocable. Explicit `$name` still works.
③ Port the 3 missing reviewer twins — `upr-pattern-checker`, `worker-security-reviewer`, `db-foundation-phase-reviewer` — each with `sandbox_mode = "read-only"` and P11's two lines. **`upr-pattern-checker` is the priority:** `close-out-standard.md` §2 makes it mandatory "always, on any `src` change", so the Codex close-out gauntlet is today structurally unable to run its one unconditional gate and could report the gauntlet as run.
④ Validator assertions: adapter drift (delegating to `--check`) and zero normative duplication (every generated `SKILL.md` is either under a byte ceiling (pointer class) or carries a `generated-from` header plus a matching source hash (copy class), with every copy-class file named and the reason a pointer could not work).
⑤ Prove the drift check live: mutate one generated adapter by a single character, re-run, observe the named failure, restore. Paste both runs.
⑥ **FRESH-CLONE VISIBILITY PROBE — run BOTH halves.** Before the commit: clone the branch to a temp dir; `ls <tmp>/.agents/skills | wc -l` and `ls <tmp>/.codex/agents/*.toml | wc -l` must both be **0**, demonstrating today's silent failure. After an authorized commit: both non-zero.
⑦ `git ls-files .claude/worktrees | wc -l` remains **0** — load-bearing, because that path holds live worktrees and is gitignored, so a careless staging command must not capture them.
⑧ **Cross-tool review probe (owner-run):** in the fresh clone, `codex review --base dev` against a deliberately law-violating scratch diff. Record whether the three ported reviewers are discoverable and whether the review surfaces the violation. **If local `codex review` does not honour the root `## Code Review Rules` section, record that as a MEASURED gap and state that the review gate exists only on the PR path. Do not report a gate that was not observed to hold.**
⑨ **THE COMMIT STEP IS SEPARATE AND REQUIRES OWNER DECISION #5.** State the cost plainly first: `.agents/` is 551 files / 6,028,609 B (SEO is 250 files / 1,605,122 B; `impeccable` + `playwright-core` are 3,773,385 B of level-3 reference weight); `.codex/` is 33 files / 124,392 B. **Do not stage anything without that authorization.**

**The CI step** (`--check` + `validate:tooling`) is gated on owner decision #8. If declined, the check runs via `validate:tooling` only and you **document the degraded path** rather than describing the invariant as enforced.

**Frozen:** the canonical `.claude/` bodies (P11/P12/P14's). `permissions`.

**Close-out:** as P1, plus `.claude/tooling-governance.json` updated for the newly tracked counts **and** the prose stamp, same commit; `npx eslint scripts/render-capability-adapters.mjs` clean. **AMBER for authoring; the `git add` is RED and separately authorized.** Owner gates: #4, #5, #8.

**NOT AUTHORIZED without a separate instruction:** the commit itself. Nor push, PR, deploy, apply, or provider action.

---

### [Session P14 — Wave 4] Dispatcher skill conformance, and the one sanctioned deletion

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P11 merged. Owner decision #13 before ANY rename; #14 before the deletion. Both are conditional-only.
```

You own the four UPR dispatcher `SKILL.md` files exclusively. Measured sizes: `masterplan` 19,672 B, `db-migration` 5,905, `new-feature` 4,461, `new-crm-module` 2,231.

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P14 block · the four dispatcher files · `docs/tooling-governance.md` §§2, 5 · `.claude/tooling-governance.json` (its `governedEntrypoints` array names all four by path).

**Build, riskiest first:**
① **THE HIGHEST-CONSEQUENCE ITEM.** `masterplan/SKILL.md` at 19,672 B is roughly 5,000 tokens — exactly the per-skill re-injection cap — and **truncation keeps the START.** So its late sections are the ones at risk, and its §5 mandatory challenge pass and §6 *"Present, then WAIT — write nothing until the owner approves repository authoring"* are both deep in the file. **The instruction that stops a planning session from writing is the instruction most likely to be truncated away.** Hoist a top authority block into the first ~25 lines carrying the planning-not-building framing, the write-gate **verbatim**, and the challenge mandate; then reduce the body to a navigator, moving the depth into `masterplan/references/{challenge-pass,artifact-templates,phase-block-schema}.md`. **This is a RELOCATION, not a rewrite** — prove it by diffing the removed blocks against the new reference files and asserting the union of the four files contains every requirement line the original did.
② `disable-model-invocation: true` on all four.
③ `new-feature/SKILL.md`: move the existing §2 authority paragraph **above** §1. `new-crm-module/SKILL.md`: add a top authority block plus a read-scope line naming `docs/crm-roadmap.md` and `.claude/rules/crm-wave-ownership.md`, whose §3 frozen signatures it must not change. `db-migration/SKILL.md`: **frontmatter only** — it already puts its authority gate at line 13 and is the in-repo reference implementation; `git diff --stat` must show 1 insertion, 0 deletions.
④ Validator: a SKILL.md size assertion (under 500 lines **and** under ~5,000 estimated tokens, report-only above 4,000) plus an assertion that each dispatcher carries the flag and an authority block within its first 40 lines. **Do NOT re-add the three already-shipping assertions** (skill-dir-equals-name, agent-name-uniqueness, duplicate-entrypoint-name).
⑤ A **report-only** shadow-detection check comparing `~/.claude/skills/*` against `.claude/skills/*`, printing collisions with the note that the personal copy wins. **This is detection, not prevention** — the 20 vendor-named skills cannot be renamed without forking bundles §1 requires to retain upstream authorship. Prove it by planting a throwaway personal skill, observing the report, and deleting it.
⑥ **CONDITIONAL on owner decision #14 only:** delete `admin-mobile-phase-reviewer` from both trees (5,116 B; tombstoned initiative, manifest archived 2026-07-13, **zero** references in `CLAUDE.md` or any rules file), capturing the untracked `.codex` twin's diff in the deprecation record first, and bump `.claude/tooling-governance.json` agents `15 → 14` **and remove its `governedEntrypoints` row** — otherwise the validator raises `missing-governed-entrypoint`.
⑦ **CONDITIONAL on owner decision #13 only:** if the rename is authorized, all four directories become `upr-*` and **all 36 tracked references are repointed in the SAME commit** (`db-migration` 11, `masterplan` 17, `new-feature` 4, `new-crm-module` 4), **plus** the four `governedEntrypoints` paths **and** the frontmatter `name` fields — or the validator raises four `missing-governed-entrypoint` errors and `entrypoint-name-mismatch`. Record **all eight** results (four new names resolving, four old names not). **A rename that leaves the old name working means the directory was copied, not moved.**

**Every slash-command resolution check must run in a session started AFTER the edit.** The flag suppresses model auto-invocation, not human invocation, so a `/name` failure means the flag was misapplied — but a stale session would show you the pre-edit state either way.

**Record in your commit message which owner-decision-#13 option was chosen,** so a later session does not re-apply the other one.

**Frozen:** the other 20 skills' frontmatter (P11's). `permissions`. Any active ownership matrix.

**Close-out:** as P1, plus the tracked-inventory tuple you actually landed. **AMBER** (L if the rename is authorized). Owner gates: #13, #14.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

## Wave 5 — working practice, handoff, and the guard

### [Session P15 — Wave 5] Mechanised close-out

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P0 merged. HARD GATE: owner decision #9 (close-out-standard.md is frozen by the ACTIVE ux-alignment manifest).
```

You are converting an 11-item prose checklist into a runnable evidence command plus an honest per-item classification. **You are the FIRST of three phases that touch `close-out-standard.md`** — the single-writer order is P15, then P17, then P9's frontmatter. Do not reorder it.

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P15 block · `.claude/rules/close-out-standard.md` **in full** · `.github/workflows/ci.yml` (**read-only**) · `docs/tooling-governance.md` §6 · `AGENTS.md`'s publication clause.

**Build:**
① `scripts/qa/closeout-evidence.mjs` — one delimited evidence block, per gate the exact command, its exit code and its real output tail. It prints a **HUMAN-GATES-OUTSTANDING** section naming the minimize/resume and on-device items verbatim, and exits non-zero **only** on a genuinely failed scripted gate — never on an outstanding human gate, which is a **disclosure, not a failure**.
② Prove two behaviours by test: on a tree with a deliberately broken test it exits non-zero **and the block still contains the failing gate's real output** (failures reported, not swallowed); and on a docs-only diff the eslint line reads the literal `n/a — no JS/JSX changed` with an overall exit 0. **That second one is the mechanical form of the do-not-fabricate-a-green-lint-run rule.**
③ `scripts/qa/lastverified-stamps.mjs` — **report-only**, with the baseline **derived at run time and recorded verbatim, never hardcoded.** Count only a stamp in the file **header**, ignoring rule-text matches (`documentation-standard.md` mentions the stamp in its own prose at line 94 and must not count as stamped). Measured today: **8 stamped, 15 unstamped, 3 spellings.**
④ Tag all 11 items `[scripted]` / `[instrumented: <fidelity limit>]` / `[human: <named check>]`, plus a validator assertion that every `[scripted]` tag names a command that resolves.
⑤ The `/closeout` skill (directory name `closeout`), with `disable-model-invocation: true` and its binding constraint — *"paste the real output; a summarised or remembered result is not evidence"* — **in the first 15 lines**, because a re-injected skill body is capped and truncation keeps the START.
⑥ Record two explicit NO-CHANGE verdicts in the amendment: the minimize/resume test and on-device motion feel **stay named human checks** (instrumenting them would produce a **false pass, which is worse than an honest gap** — iOS suspension and eviction cannot be emulated and a Chromium visibility-change event is a different signal); and **a Stop hook is REJECTED** as the enforcement mechanism on three grounds — it is overridden after 8 consecutive blocks so it can never be sole enforcement for anything safety-critical, it cannot spawn a subagent so it cannot run the gauntlet, and it cannot perform a human on-device check. Also record that `/goal` is **absent from the installed 2.1.85 bundle** and that its evaluator cannot run commands or read files anyway — which is exactly why the evidence block must exist first.
⑦ Item 11 stays **textually intact** with a forward pointer to P6. **Nothing is removed from this file before its replacement gate exists.**
⑧ The Rule 6 tension is a **POINTER, not an interim default.** Shipped wording: *"Rule 6's commit cadence and step 11's publication gate are in tension; the governing text today is AGENTS.md's publication clause and step 11 above. Conflict surfaced to the owner, unresolved."* **Do not write "interim default"** — stating one inside a rules file is a de facto scoping of an explicit owner decision, performed in a different file. See owner decision #15b.

**Amendment discipline:** append a dated section; strike superseded text **in place** with a `superseded-by:` pointer; bump the file's own stamp. `git diff` must show **zero deleted requirement lines** outside struck blocks, and every `~~`-struck block must be followed within 3 lines by its pointer.

**Frozen:** `.github/workflows/ci.yml` (P16/P19's, and gated on #8). `AGENTS.md`/`CLAUDE.md`. Any ownership matrix.

**Close-out:** as P1, plus `.claude/tooling-governance.json` skills **24 → 25** and the prose stamp; `npx eslint` on the new JS clean. **AMBER.** Owner gate: #9 (hard).

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P16 — Wave 5] Reviewer gauntlet: computed trigger, single fan-out

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P15 merged. Owner decision #8 for the CI step; #9 if P11 has not already landed the checker-agent lines.
```

The gauntlet is mandatory but fires only if an agent **remembers** — the exact failure mode a mechanism should remove.

**State the honest finding first and do not plan around it: a hook CANNOT trigger the gauntlet.** Hooks cannot spawn subagents; PostToolUse cannot block at all regardless of exit code; and a `Stop` hook is overridden after 8 consecutive blocks and is silently converted to `SubagentStop` when declared in subagent frontmatter. "Hook-triggered" is not an available answer.

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P16 block · `.claude/rules/close-out-standard.md` §2 · the seven reviewer definitions · P7's `InstructionsLoaded` log.

**Build:**
① `scripts/qa/required-reviewers.mjs --base dev` — computes the required set from the diff using §2's rules, printing a human list plus JSON, and emitting **`none required`** for a docs-only diff rather than defaulting to the full gauntlet. **A trigger that over-fires is as wrong as one that under-fires.**
② Fixture tests proving each trigger: `src/pages/**` → the three gauntlet agents; `supabase/migrations/**` → the two database reviewers; `functions/api/send-message.js` → `consent-path-auditor` **and** `worker-security-reviewer`; an `src/index.css` motion change → `review-animations`; docs-only → `none required`.
③ The `/gauntlet` skill — runs the computed set in **one fan-out**, prints each verdict in the standard format, with the binding constraint in its first 15 lines: spawn only the computed set, never the full roster, and never edit a file the reviewers flag in the same invocation. **On a fixture `src/pages` change, exactly three agents are spawned** — count them; over-spawning is the specific regression this replaces.
④ `scripts/qa/check-review-evidence.mjs` + its CI step, `if: github.event_name == 'pull_request'` and `continue-on-error: true` on first landing. **Deliberately PR-only, and your report must say so:** Rule 4 routes routine work direct to `dev`, and a gate that cannot fire there must not be presented as covering it. That is the concrete cost of Rule 4 and belongs in owner decision #15c, not smuggled in here.
⑤ `docs/qa/subagent-context-probe.md` with an **executed** result section: whether unscoped `.claude/rules/*.md` reached the subagent, the method, and the version measured on, plus an explicit statement that the Codex side is unmeasurable and **no parity claim is made.** **Consume P7's `InstructionsLoaded` log — do NOT build a transcript-inspection fallback.** An earlier draft claimed that instrument has "no evidence of support at 2.1.85"; the bundle contains it (9 hits, full five-value reason enum). Two cost reductions land regardless of the result — the single fan-out and the return budget — so **E3 sizes the win, it does not decide it.**

**Frozen:** `close-out-standard.md` §2's trigger table (left intact by this phase rather than replaced, so a revert restores the prior prose-triggered flow exactly). The reviewer definitions' content beyond P11's two lines.

**Close-out:** as P1, plus `.claude/tooling-governance.json` skills **25 → 26** and the prose stamp; `npx eslint` on the new JS clean. **AMBER.** Owner gates: #8, #9.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P17 — Wave 5] Handoff baton: one canonical schema and lifecycle

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P15 merged (single-writer order on close-out-standard.md: P15, then you, then P9). Owner decision #9.
```

The mechanism already works — three files sit in `docs/handoff/` and a session picked up parked work from one. **The reform is composition and lifecycle, not replacement.**

**The distinction that makes this load-bearing rather than redundant: a handoff doc is the ONLY cross-tool baton that exists.** A Codex session cannot resume a Claude session and vice versa; transcripts are per-tool and machine-local; and `claude -p --bare` skips hooks, skills, plugins, MCP, auto memory **and `CLAUDE.md`** entirely.

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P17 block · `docs/handoff/*.md` (all three existing files) · `.claude/rules/close-out-standard.md` (post-P15) · `CLAUDE.md`'s Task File Protocol · `AGENTS.md` lines covering Definition of done and Documentation duties.

**Build:**
① `docs/handoff/README.md` — the schema with each required field **justified, not asserted**: `Tool`; `Base verified` (exact SHA) and `Worktree/branch` (with **23 live worktrees** "the repo" is ambiguous, and one worktree is recorded do-not-merge with a base predating a rewrite); `Evidence` (command + real output, not a claim); `Owner gates` (blocked-on-owner separated from merely unfinished); `Durable decisions to promote`; `Opening prompt` (self-contained, referencing no conversation).
② The composition table, **exactly one owning job per mechanism**: session resume owns in-tool context replay and is machine-local; `/rename` owns findability (name the session after the handoff slug — that is the whole integration and it costs nothing); auto memory owns durable cross-conversation constraints and is re-injected after compaction; the handoff doc owns the cross-tool baton.
③ The lifecycle: created at park, consumed at pickup, `git rm`'d at completion — **with the promote-before-delete rule** (durable owner decisions and standing constraints go to memory or a canonical doc **before** the handoff doc is deleted; per-task state **never** goes into memory, where it goes stale and re-injects forever). **Quote** `CLAUDE.md`'s punch-list carve-out rather than paraphrasing it into a different rule.
④ Its dated section in `close-out-standard.md` absorbs `AGENTS.md`'s Definition of done and Documentation duties **by reference, not restatement** — a fourth copy is the disease, not the cure — with a change-type-to-docs-to-update table, and records that **git is the only reliable undo** (Claude checkpoints do not track bash-made edits, do not restore subagent edits, and normally miss concurrent-session changes; this repo dispatches heavily to subagents, applies migrations out of band, and has 23 worktrees). **A phase's rollback is a git ref, never a checkpoint.**
⑤ The three operational warnings recorded where a session will hit them: the mid-session-edit no-op; the Codex per-hash hook-trust re-arm; and the Codex project-trust requirement.
⑥ `scripts/qa/validate-handoff-docs.mjs` — **report-only** against the three existing docs; asserts the six fields, that `Base verified` resolves as a real commit, and that `Evidence` contains at least one command-and-output pair rather than only prose.
⑦ `docs/handoff/_TEMPLATE.md` and this initiative's own instance, `docs/handoff/agent-alignment-handoff.md`, dogfooding the schema.
⑧ **THE ROUND-TRIP TEST — the only criterion that matters (named human check).** A fresh session of the **other** tool is given only `docs/handoff/agent-alignment-handoff.md`, no conversation history, and must correctly state the next action, the exact files in scope, and what is out of scope. **If it cannot, the template is under-specified and this phase is NOT done.** No command substitutes for this.

**You do NOT edit `AGENTS.md` or `CLAUDE.md`.** Supply the two citation lines as `docs/handoff/l0-pointer-text.md` for P1/P3 to install — the root pair is a single seam with a single owner. Verify by `git diff --name-only` containing neither path.

**Close-out:** as P1, plus `npx eslint` on the new JS clean. **AMBER.** Owner gate: #9.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P18 — Wave 5] Future-initiative isolation model

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P14 merged (it owns masterplan/SKILL.md, which gains one navigator line here). HARD GATE: claude >= 2.1.217 (you author a paths:-scoped rule).
```

`git worktree list` returns **23**, so per-phase filesystem isolation is already the de facto practice, while the manifests were authored for a world where two sessions shared one working tree.

Run the BASE PREFLIGHT and assert the version.

**Read:** this block · roadmap P18 block · `.claude/rules/db-foundation-wave-ownership.md` §§4, 5, 8 (the apply-window and FE-contract-freeze precedents) · `.claude/rules/documentation-standard.md`.

**Build:**
① `.claude/rules/initiative-isolation.md` **with `paths:` frontmatter** scoped to `docs/*-roadmap.md`, `docs/*-dispatch.md`, `.claude/rules/*-wave-ownership.md` — so it loads only when someone is authoring or reading an initiative plan and adds **zero** bytes to the always-loaded set. Brace-free glob. Carries a `**Last verified:**` stamp. **Prove its load behaviour with P7's instrument and record which method you used and why — an unverified `paths:` claim is not accepted.**
② The honest sorting. Worktrees **do** solve: concurrent edits to the same file, accidental cross-phase edits, and the whole purpose of the `index.css` reserved-marker convention (a worktree surfaces the collision as a **merge conflict at merge time**, strictly better than a hand-maintained prose reservation nothing enforces). Worktrees **do not** solve: (a) **shared-Supabase apply windows** — one database behind both `dev` and `main`, so a migration is live in production regardless of which worktree authored it, and two migrations issuing strong-lock DDL against the same hot tables must not have overlapping apply windows even though merge order is free; (b) **frozen RPC signature and return-shape contracts** — a merge can be textually clean and semantically breaking, with the concrete precedent that `sendAutomatedMessage`'s reason vocabulary is keyed on by two workers in *other* initiatives, so renaming `quiet_hours` is a two-line refactor that passes lint and build and results in messages sent during quiet hours **with no test failure**.
③ `scripts/check-frozen-contracts.mjs` — parses `supabase/migrations/**/*.sql` for `CREATE OR REPLACE FUNCTION` signatures and `RETURNS` shapes, compares against a generated snapshot, fails on an unannotated change. Four cases proven by test: unannotated signature change **fails**; annotated one passes; body-only replace passes (the sanctioned form); new-required-parameter fails while new-parameter-with-DEFAULT passes.
④ **Its limitation banner prints on EVERY run** and names the scope: derived from `supabase/migrations/` only (**239 local files measured**), **not** the live catalog, and the 2026-07-22 audit found local files diverging from live ledger entries — so it is a repository contract, **not live truth.** Say so rather than implying coverage it lacks.
⑤ `docs/apply-window-register.md` — one tracked table with the standing rule that two entries whose strong-lock tables intersect may not hold overlapping windows.
⑥ One line in `masterplan/SKILL.md`'s navigator pointing new plans at the new rule.

**Frozen — and this is the mechanical proof of constraint 3:** `git diff --name-only` must contain **zero** paths matching `.claude/rules/*-wave-ownership.md`. You create a **new** rule for future initiatives; you do **not** retrofit existing manifests. Existing ones migrate only when they tombstone.

**Close-out:** as P1, plus `.claude/tooling-governance.json` `rules` **21 → 22** and the prose stamp; `npx eslint` on the new JS clean. **AMBER.** Owner gates: #1 (hard), #8 for the CI step. **Ordering caution: if both P18 and P14 must be unwound, revert P18 first** — P14 owns `masterplan/SKILL.md`.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P19 — Wave 5] The single CI invariant guard

```
Tool:         claude-code
Branch:       session-assigned
Model:        Sonnet
Effort:       medium
Launch after: P3, P4, P8, P9, P10, P15 merged. HARD GATE: owner decision #8 (.github/workflows/ci.yml ownership).
```

You are making the layering self-defending. **Every failure mode this guard catches is silent:** a brace-containing glob matches nothing, a stale exclusion deletes law forever, a new rules file lands with no `paths:` and quietly re-inflates the always-on cost, an ancestor memory file appears that Codex cannot see.

**ONE guard, not two.** Two design lanes each proposed a near-identical script with its own npm key and its own CI step. **You own the single one:** `scripts/validate-agent-instruction-layer.mjs` + `validate:agent-layer` + `scripts/agent-instruction-layer.allowlist.json` + one CI step. The other lane's duplicate is deleted from the plan; you consume `verify-rule-globs.mjs` and `check-agents-chain-bytes.mjs` as **libraries** you delegate to.

Run the BASE PREFLIGHT.

**Read:** this block · roadmap P19 block · P7's linter · P10's chain script · the invariant list in the roadmap's P19 checklist.

**Build:**
① The 13 named-invariant assertions, each with its own check id so a failure is actionable. Full list in the roadmap's P19 block. Note three that matter most: invariant 1 must use `fs.lstat` **and** check that `CLAUDE.md`'s entire content is not the literal string `AGENTS.md` (Git for Windows checks a committed symlink out exactly that way); invariant 3 is an **INTENT** check (every rules file either carries `paths:` **or** is in the tracked allowlist with a one-line reason) so it passes before **and** after the L2 migration and **can never be silently satisfied by scoping a file that must survive compaction**; invariant 12 asserts `.claude/tooling-governance.json` `trackedInventory` matches `git ls-files`.
② `scripts/agent-instruction-layer.allowlist.json` — keeps `database-standard.md` unscoped with its reason recorded.
③ **PROVEN BY DELIBERATE BREAKAGE, not by a green run.** Twelve negative tests, each mutating one thing and asserting a non-zero exit naming the specific rule — including a fixture where `CLAUDE.md`'s entire content is the literal string `AGENTS.md`, and one where a `paths:` glob contains a brace group. **The guard MUST be root-parameterized (`--root <dir>`) so every fixture is built in a temp directory outside the repo.** Do **not** write fixtures inside `.claude` (protected path: prompted in default mode, denied in `dontAsk`) and **never plant a real ancestor `CLAUDE.md`** — if left behind it silently injects into every sibling repository under that parent.
④ The guard **names which glob dialect** it is rejecting: `paths:` uses gitignore semantics on repo-relative paths where braces are dead and a trailing `/**` is stripped; `claudeMdExcludes` uses picomatch on absolute paths where braces work. **The same-looking pattern behaves differently in the two keys.**
⑤ **NEGATIVE CI PROOF.** A scratch branch deleting `CLAUDE.md`'s `@AGENTS.md` first line makes the verify job **RED**; record the run URL and delete the scratch branch. Branch-protection required-check status is a GitHub **Settings** value, not a file — the owner confirms it separately.
⑥ Record **both refutations** in `docs/agent-alignment-l2-evidence.md`: bracket classes **do** work in `paths:` globs (so the inherited "unescaped `[` matches nothing" is refuted — brace groups are the failure mode), and `claudeMdExcludes` **does** cover `.claude/rules/*.md`. **Recording a refuted claim is the point of the evidence file.**
⑦ The **third** `/context` capture, pasted beside P7's baseline and P8's interim. **Any token claim not traceable to one of those three captures is removed from your report.**

**CI ownership resolved BEFORE the file is touched:** either a dated addendum exists in `.claude/rules/upr-agent-qa-access-ownership.md` naming this exact additive job block, **or** `.github/workflows/ci.yml` is absent from your diff and you document the degraded path (guard via `validate:tooling` only). **Both outcomes are acceptable; touching the file without the addendum is not.**

**Close-out:** as P1, plus `npx eslint` on both new `.mjs` files clean (**this phase adds JS**), and `validate:tooling` + `test:tooling` still passing (proving the new script was wired in without breaking the existing pair). **AMBER.** Owner gate: #8 (hard). **If a recorded finding is later contradicted, strike it in place with a `superseded-by:` pointer — never delete it.**

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

### [Session P20 — Tail] Release the deferred rules files (merge-keyed, not date-keyed)

```
Tool:         claude-code
Branch:       session-assigned
Model:        Opus
Effort:       high   — reason: it converts the highest-consequence rules file in the set
Launch after: P9 and P19 merged, AND each holder merged — condition-checked, never date-checked. HARD GATE: claude >= 2.1.217.
```

Three files were deliberately held. **Confirm the release condition per file before touching it**, and if it is unmet, leave the file unconverted and say why in your report — a holder-blocked item stays visibly open and is never quietly closed.

Run the BASE PREFLIGHT and assert the version.

**Per-file release check, before any edit:** `git log origin/dev` confirms the holder merged, **and** `git status` in the relevant worktree shows no uncommitted work. As of this plan's authoring: `messaging-transport-wave-ownership.md` (15,250 B) is held by a live writer with **61 uncommitted files** on `codex/messaging-transport-build`; `tech-messages-v2-wave-ownership.md` (8,766) and `omni-inbox-wave-ownership.md` (10,573) are named explicitly as amendment targets by the owner-approved 2026-07-26 participant-scoping work.

**Read:** this block · roadmap P20 block · P9's procedure · `docs/agent-alignment-l2-evidence.md` (your globs are **pre-authored and pre-linted** there, so this is mechanical).

**Build:** the full P9 procedure per file — L0-fragment precondition, glob linter, per-file loading flip, `database-standard.md` `session_start` still present. **`messaging-transport-wave-ownership.md` converts LAST**, after the L0 send-path block has been proven to load, so its §1 law is never in flight. It carries the highest-consequence law in the set: a load miss there can cost money and create legal exposure in the same action.

**Acceptance:** self-referential byte arithmetic re-run. If the state is partial, **report the exact intermediate figure rather than the target.** End state: **9,342 B always-loaded, a 95.6% reduction from the measured 210,784 B baseline** — and for the first time the safety-critical subset reaches **both** tools instead of Claude only.

**Close-out:** as P9. **RED content, but not red uncertainty** — the L0 preconditions are already satisfied and the globs are already authored and linted. Stage and wait. Owner gate: #12.

**NOT AUTHORIZED:** commit, push, PR, deploy, apply, provider action.

---

*Every block above ends the same way by design: with the diff, the verification report, and the named owner gates. `docs/agent-alignment-ownership-DRAFT.md` is authoritative where a name or path here drifts. If a block asks you to do something that would violate one of the eight standing constraints in the preamble, the constraint wins and the block is the defect — say so.*
