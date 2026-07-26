<!--
FILE: docs/agent-runtime-reference.md

WHAT THIS DOES (plain language):
  Explains how Claude Code and OpenAI Codex actually work on this repo — which
  files each one reads, what it ignores, where the hard limits are, and which
  safety gates really stop an action versus only asking nicely. Written from the
  vendors' own documentation so nobody has to re-derive it.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, .claude/rules/**, docs/tooling-governance.md
  Data:     reads  → vendor documentation, local measurement
            writes → documentation only

NOTES / GOTCHAS:
  - This is a REFERENCE, not project law. CLAUDE.md, AGENTS.md and .claude/rules/
    are law; where this file and a standard disagree, the standard wins.
  - Every mechanism here was read from a vendor page on 2026-07-26 and, where
    possible, measured locally. Vendor behaviour changes — re-verify before
    depending on a detail, and update the Last-verified stamp when you do.
  - Two vendor inconsistencies are recorded as such rather than resolved. Do not
    silently pick a side.
-->

# Agent Runtime Reference — Claude Code and Codex

**Last verified:** 2026-07-26 · Sources: `code.claude.com/docs`, `learn.chatgpt.com/docs`, `agents.md`

Both tools are used on this repo, often concurrently, against one shared Supabase that serves staging
and production. This file records how each one actually behaves so sessions stop rediscovering it.

---

## 1. Instruction loading — the difference that drives everything

| | Claude Code | Codex |
|---|---|---|
| Root file | `CLAUDE.md` — **does not read `AGENTS.md`** | `AGENTS.md` (+ `AGENTS.override.md`, which wins at its level) |
| Discovery | Walks **up** from cwd; subdirectory files load **on demand** when a file there is read | Walks git root **down to cwd**; concatenated root-first. Never searches above the git root |
| Global layer | `~/.claude/CLAUDE.md`, managed policy path | `~/.codex/AGENTS.override.md` else `~/.codex/AGENTS.md` — **repo-invisible, no code-review trace** |
| Size limit | none enforced; target **< 200 lines**, "bloated files cause Claude to ignore your instructions" | **hard: `project_doc_max_bytes`, default 32768.** Past the cap the **tail** is dropped, silently |
| Cross-tool bridge | **`@AGENTS.md` import on line 1 of `CLAUDE.md`** — the documented mechanism | `project_doc_fallback_filenames` — fires **only where `AGENTS.md` is absent**, so it cannot bridge in this repo |
| Conditional depth | `.claude/rules/*.md` with **`paths:` frontmatter** | **none.** `.codex/rules/*.rules` is Starlark command policy, not context |
| Introspection | `InstructionsLoaded` hook, `/context`, `/doctor`, `claude plugin details`, `/usage` | **none documented** — the Codex side is *plausible*, never *proven* |

**Consequences that bind design here:**

- A rules file **without** `paths:` loads unconditionally at launch with the same priority as
  `.claude/CLAUDE.md`. That is why all 23 files enter every session.
- `paths:`-scoped rules and nested `CLAUDE.md` are **dropped at `/compact`** until a matching file is
  re-read. Cheap-at-startup and survives-compaction are **mutually exclusive**. Safety-critical law
  therefore stays unscoped at the root, permanently.
- An over-braced `paths:` glob (the list shares a 1,000-expanded-pattern / 4 MiB budget) is used
  **unexpanded** and matches nothing — the rule loads **never**, with no error. Prefer several
  brace-free patterns. Bracket classes work; braces are the hazard.
- **Never commit a symlink** as the bridge: Git for Windows sets `core.symlinks=false` and checks it
  out as a text file whose entire content is the string `AGENTS.md`. Presents as "the rules stopped
  working." Anthropic explicitly recommends the import on Windows.
- `model_instructions_file` in any Codex layer **replaces** the AGENTS.md path rather than layering —
  a stale value silently bypasses all shared law. Forbidden in this repo.
- Imports do **not** reduce context: imported files load at launch. Max 4 hops.
- Block-level HTML comments in `CLAUDE.md` are stripped before injection (free provenance channel).
  **Claude-only** — assume Codex pays for those tokens in `AGENTS.md`.

**Recorded vendor inconsistency:** the dedicated AGENTS.md guide says `project_doc_max_bytes` is a
**combined** budget; `config-advanced` says per-file. Treat it as combined (stricter, and the dedicated
guide's reading) until measured.

---

## 2. Capabilities — where each thing lives

| Concern | Claude Code | Codex |
|---|---|---|
| Skills | `.claude/skills/<name>/SKILL.md` | `.agents/skills/`, `~/.agents/skills`, `/etc/codex/skills` |
| Subagents | `.claude/agents/*.md` | `.codex/agents/*.toml` (a full config **layer**, not a manifest) |
| Hooks | `.claude/settings.json` | `.codex/hooks.json` **or** inline `[hooks]` in `config.toml` (4 locations, **additive**) |
| Config | `settings.json` (managed → user → project → local) | `config.toml`: defaults → system → user → **profile** → project → CLI `-c`; **managed layers override CLI** |
| Invocation | `/name` (from the **directory** name, not frontmatter) | `$name` |
| Human-only gate | `disable-model-invocation: true` | `policy.allow_implicit_invocation: false` in `<skill>/agents/openai.yaml` |
| Reasoning control | model + effort per agent | `model_reasoning_effort`; **two vendor pages disagree** on whether `ultra`/`max` exist beyond `minimal|low|medium|high|xhigh` — check the binary |
| OS sandbox | **none on native Windows** (WSL2 required; fails **open** by default) | **native Windows support**, `sandbox_mode = read-only\|workspace-write\|danger-full-access` |

**Precedence traps:**

- Claude **skills**: managed > user > **project**. A developer's `~/.claude/skills/<name>` **silently
  shadows** the repo-committed skill. Subagents go the other way (project > user).
- Claude SKILL.md frontmatter has ~17 optional fields, including `paths`, `context: fork` + `agent`
  (run a skill as a subagent), `hooks`, and `effort` — not just name/description.
- `.claude/commands/` and skills are **one merged namespace**; the skill wins a collision.
- A **plugin**-bundled MCP server changes the matcher string to
  `mcp__plugin_<plugin>_<server>__<tool>`; a matcher on the bare server key **never fires**. Keep the
  UPR MCP server out of any plugin or existing deny rules break.
- Codex subagents **inherit** `sandbox_mode`, `mcp_servers` and `skills.config` when the agent file
  omits them, and inherit the composer's permission mode. Pin explicitly.
- Both tools **silently truncate** capability discovery lists (Claude ~1% of context, per-entry
  description cut at 1,536 chars, least-used dropped first; Codex 2% of context or 8,000 chars). With
  a large roster some capabilities are invisible to implicit matching. Cut before porting.

---

## 3. Gates — what actually stops an action

| Gate | Claude Code | Codex | Parity |
|---|---|---|---|
| Deny a tool outright | `permissions.deny` (bare-name deny removes it from context; deny beats ask beats allow at every level) | `mcp_servers.<id>.disabled_tools`, `tools.<tool>.approval_mode` | **achievable** |
| Content-inspecting block | `PreToolUse` hook, exit 2 — runs **before** permission evaluation, so it beats an allow rule | same event, same exit-2 contract | **achievable**, one script serves both |
| Repo policy a user cannot weaken | — | `.codex/rules/*.rules` `decision = "forbidden"`; strictest-wins beats a user `allow` | **Codex-only** |
| Protect the agent's own config | **built in**: `.claude`, `.git`, `.mcp.json` are protected paths; `permissions.allow` **cannot** pre-approve them | none documented | **Claude-only** |
| OS-level isolation | none on win32 | native | **Codex-only on this platform** |
| Lint / CI rules | eslint + CI | same commands | **true parity — the gate is CI, not the agent** |

**Fail-open modes — the important part:**

- **Exit 1 is NON-blocking in both tools.** Only exit 2 blocks. A guard that dies under `set -e`, is
  unresolvable (exit 127), or is CRLF-broken silently **permits**. `.gitattributes` pins `*.sh` to LF.
- Emitting `continue`/`stopReason`/`suppressOutput` from a **Codex** PreToolUse hook **fails** the
  hook, and on failure **Codex continues the tool call**. A cosmetic extra key turns a block into an
  allow.
- Claude's Bash sandbox **fails open** unless `sandbox.failIfUnavailable: true`.
- A Codex **repo** hook is skipped until a human trusts its **hash** via `/hooks` — and editing the
  hook re-arms the gate. Three gates must all pass: `features.hooks` on, project trusted, hash trusted.
- In Claude **auto mode**, *"pushing to any branch of the repository you're working in, including the
  default branch"* is allowed by default. A prose "never push `main`" is not enforcement.
- `permissions.deny` cannot carry allowlist exceptions, and `Write(path)` / `Glob(path)` /
  `NotebookEdit(path)` rules are **accepted but never matched** — use `Edit(...)` / `Read(...)`.
- A Codex `prefix_rule(["git","push"])` never matches `git push $BRANCH`: scripts containing
  substitutions, redirection or control flow collapse to one `["bash","-lc","<script>"]` command.
- A `Stop` hook is overridden after **8 consecutive blocks**, so it can never be sole enforcement.
- Neither tool's hooks or deny rules cover a subprocess doing its own I/O — a Python/Node script that
  opens a file or a database connection bypasses everything above.
- **Not mechanisable in either tool:** whether an authorization is *fresh, task-specific, and from the
  owner rather than an orchestrating agent.* That check is prose forever, which is why it must live
  unscoped at the root where compaction cannot drop it.

---

## 4. What the vendors actually recommend

Both converge: lead with commands, keep the instruction file short and accurate, add a rule only when
the agent repeats a mistake, and **give the agent a check it can run**.

- **Anthropic optimises for context economy** — *"performance degrades as context fills."* Hence
  path-scoped rules, skills over rules, subagent delegation, `/clear` between tasks. The advice is
  *load less*. Named failure modes: the kitchen-sink session, correcting twice instead of re-prompting,
  the over-specified CLAUDE.md, the trust-then-verify gap, infinite exploration.
- **OpenAI optimises for configured repeatability** — *"treat Codex less like a one-off assistant and
  more like a teammate you configure."* Reasoning levels by task difficulty, profiles, execpolicy, and
  a **Goal / Context / Constraints / Done-when** prompt structure. The advice is *configure more*.
- Neither contradicts the other. Take context economy from Anthropic and explicit done-when plus hard
  policy gates from OpenAI.
- Anthropic's verification ladder, weakest to strongest: ask in the prompt → `/goal` condition → `Stop`
  hook → an independent subagent that tries to **refute** the result. And: *"a fresh context improves
  code review since Claude won't be biased toward code it just wrote"* — which makes
  `codex review --base dev` a genuinely independent second reviewer for Claude's work, and vice versa.
- Codex's PR reviewer honours a section literally headed **`## Code Review Rules`** in `AGENTS.md`
  (root plus the nearest file per changed path). It flags **P0/P1 only**, so lint-shaped rules placed
  there silently never surface — OpenAI says keep those in CI.

---

## 5. Local facts about this machine and repo

Re-measure before relying on any of these.

- **Two Claude Code installations**: npm-global (active) and a vestigial native one under
  `~/.local/share/claude`. Any version assertion must resolve the binary explicitly.
- **`jq` is not installed.** Parse hook payloads with node, which is a hard repo dependency.
- **Live MCP server ids are hashed UUIDs.** Every `mcp__UPR_MCP__*` / `mcp__Supabase__*` permission
  rule — allow **and** deny — matches nothing. Regex hook matchers are the only gate that fires.
- **Codex cloud sessions see only the committed tree.** Untracked `.agents/` / `.codex/` do not exist
  there, and nothing reports their absence — local and cloud Codex behave differently, silently.
- The scheduling API **auto-attaches every connected MCP connector** to a new routine unless cleared.
- Platform inversion, worth repeating: on win32 **Codex can sandbox and Claude cannot.**

---

## 6. Re-verification

```bash
# Vendor sources, in order of authority
# Claude Code:  https://code.claude.com/docs/llms.txt   (index; append .md to any page)
# Codex:        https://learn.chatgpt.com/docs/...       (developers.openai.com/codex/* 308-redirects here)
# AGENTS.md:    https://agents.md/
```

Dated raw findings from the 2026-07-26 documentation sweep, including the per-cluster detail this file
distils: `docs/audit/2026-07/evidence/agent-runtime-doc-sweep.md`. That is dated evidence, not current
law — re-read the vendor page before depending on a specific key.
