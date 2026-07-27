<!--
FILE: docs/audit/2026-07/evidence/agent-runtime-doc-sweep.md

WHAT THIS DOES (plain language):
  The raw findings from reading OpenAI Codex and Claude Code documentation on
  2026-07-26. Twelve parallel readers covered ~40 vendor pages and reported 277
  capabilities; one synthesiser consolidated them. Kept verbatim so the detail
  behind docs/agent-runtime-reference.md is auditable.

NOTES / GOTCHAS:
  - DATED EVIDENCE, not current project law. Vendor behaviour changes.
  - The curated, maintained version is docs/agent-runtime-reference.md.
  - Findings marked as coming from a non-vendor source are labelled inside.
-->

# Agent runtime documentation sweep — raw findings (2026-07-26)

12 doc clusters · 277 capabilities reported · 13 agents · 0 errors · ~2.6M subagent tokens.
Sections: `new_capabilities_unused`, `corrections` (14 — several correcting the orchestrating
session's own prior claims), `recipe_additions`, `hard_gates_available`, `remaining_gaps` (17).

```json
{
  "new_capabilities_unused": [
    {
      "capability": "`paths:` YAML frontmatter on .claude/rules/*.md — converts unconditional loading to read-triggered loading",
      "tool": "claude-code",
      "why_it_matters": "A rule WITHOUT `paths:` loads unconditionally at launch with the same priority as .claude/CLAUDE.md. That is precisely why all 23 rules files (209.8 KB) enter every session today, and Anthropic's own memory/best-practices docs name the fix. The same key exists on SKILL.md ('Uses the same format as path-specific rules'), so path-scoping is available to skills too — the recipe does not have to use rules to get path-gating. HARD CAVEAT: `paths:`-scoped rules are LOST at compaction 'until a matching file is read again', so cheap-at-startup and survives-compaction are mutually exclusive properties.",
      "config": "`paths:` (YAML list of globs) in the frontmatter of each `.claude/rules/*.md`; same key optional in `.claude/skills/<name>/SKILL.md`. Budget: a rule's whole `paths` list shares 1,000 expanded patterns / 4 MiB; brace-free patterns don't count.",
      "layer": "L2"
    },
    {
      "capability": "Nested per-directory AGENTS.md — the ONLY on-demand depth mechanism Codex has",
      "tool": "codex",
      "why_it_matters": "Codex has no `paths:`/frontmatter conditional-context mechanism at all. `.codex/rules/*.rules` is Starlark execpolicy (command allow/deny), NOT markdown context — mirroring the 23 rules into `.codex/rules/` would do nothing. Codex depth must be nested `AGENTS.md` files, which load only when cwd is at/below them (git-root-down walk, stops at cwd, never searches above the git root). This means L2 is structurally asymmetric and must be authored twice, or authored once in a neutral path that both L0 files point to.",
      "config": "`<dir>/AGENTS.md` at e.g. `supabase/migrations/`, `functions/api/`, `src/pages/tech/`. Discovery per level: `AGENTS.override.md` → `AGENTS.md` → each `project_doc_fallback_filenames` entry. `project_root_markers` (default `[\".git\"]`) sets where the walk starts. Generate scaffolds with `/init` (runs in the current directory).",
      "layer": "L2"
    },
    {
      "capability": "`## Code Review Rules` section inside AGENTS.md — repo-declared review law Codex enforces at PR time",
      "tool": "codex",
      "why_it_matters": "Codex's reviewer scans AGENTS.md for a section literally headed `## Code Review Rules` and applies the root file PLUS the more-specific file covering each changed file (additive-by-path). This turns UPR's non-negotiables (worker-sole-writer, no cross-channel fallback, additive-only on live tables, least-privilege grants, consent gating) into a machine gate on `@codex review` / automatic PR review with zero extra config. Authoring shape per OpenAI: invariant + safe path + scoped context. Limit to record: Codex 'flags only P0 and P1 issues', so minor/stylistic rules placed there silently never surface — leave those to eslint/CI.",
      "config": "`## Code Review Rules` heading (with `###` sub-groups) in the root `AGENTS.md` and in nested `AGENTS.md` files; triggers `@codex review`, `@codex fix it`, and the every-PR toggle at chatgpt.com/codex/settings/code-review. Runs on Codex cloud, so it sees only committed files.",
      "layer": "L0"
    },
    {
      "capability": "Tracking the currently-untracked `.agents/` and `.codex/` trees",
      "tool": "codex",
      "why_it_matters": "A Codex cloud session (and therefore the Codex-cloud-hosted GitHub PR reviewer) 'creates a container and checks out your repo at the selected branch or commit SHA'. Untracked files are not in that checkout. The 51 Codex skills and 30 Codex subagents therefore do not exist for any cloud session or automatic PR review, and nothing reports their absence — local-Codex and cloud-Codex silently behave differently. Any single-source capability plan requires these trees committed. (The docs state the checkout semantics; 'untracked files are absent' is inference from that, not a quoted guarantee.)",
      "config": "`git add .agents/ .codex/`; repo-scoped skill root is the up-tree scan of `.agents/skills` (CWD → repo root); subagents at `.codex/agents/*.toml`; hooks at `.codex/hooks.json`; config at `.codex/config.toml`.",
      "layer": "L3"
    },
    {
      "capability": "`disable-model-invocation: true` (Claude) / `policy.allow_implicit_invocation: false` (Codex) on side-effect capabilities",
      "tool": "both",
      "why_it_matters": "Two wins in one field. (1) Context: a Claude skill with `disable-model-invocation: true` keeps its description OUT of the startup skill listing entirely — zero context cost until a human types `/name`. With 24 Claude skills that listing is real startup weight, and the listing budget is only 1% of the context window before descriptions are silently dropped. (2) Safety: it structurally enforces UPR's owner-authorization posture (migrations, sends, commits, publishes, the retained content/marketing set that must 'never auto-expand internal-app development') instead of restating it as prose in every doc. Anthropic's own guidance: 'Use `disable-model-invocation: true` for skills with side effects.'",
      "config": "Claude: `disable-model-invocation: true` in SKILL.md frontmatter (NOT `user-invocable: false`, which only hides the / menu and does not block Skill-tool access). Codex: `policy.allow_implicit_invocation: false` in `<skill>/agents/openai.yaml`; explicit `$skill` still works.",
      "layer": "L3"
    },
    {
      "capability": "Per-tool MCP gating: Claude `Tool(param:value)`/bare-name deny + `Skill(name)` rules; Codex `disabled_tools` / `tools.<tool>.approval_mode`",
      "tool": "both",
      "why_it_matters": "This converts database-standard.md §0 ('authoring is not applying') from prose into enforced config on the one shared production Supabase. Claude can deny an MCP tool by name (a bare-name deny removes it from context entirely) and can `ask` on a specific input parameter. Codex can deny or force approval per individual tool, and can additionally deny the Supabase/provider hosts at the network layer. Neither can distinguish a read from a write inside one tool, so a generic SQL tool must be denied outright, not half-gated.",
      "config": "Claude: `permissions.deny: [\"mcp__<server>__execute_sql\", \"mcp__<server>__apply_migration\"]`, `permissions.ask`, `Skill(name)` / `Skill(name *)`, `Agent(model:opus)`-style param rules. Codex: `mcp_servers.<id>.disabled_tools`, `mcp_servers.<id>.tools.<tool>.approval_mode = \"approve\"`, `default_tools_approval_mode`, plus `[features.network_proxy] domains` (only constrains traffic when `network_access = true`).",
      "layer": "L1"
    },
    {
      "capability": "`.codex/rules/*.rules` execpolicy with `decision = \"forbidden\"` and strictest-wins precedence",
      "tool": "codex",
      "why_it_matters": "This is the one Codex layer a repo can commit that a user CANNOT weaken: conflicts resolve `forbidden` > `prompt` > `allow`, so a repo `forbidden` beats the user layer — and the user layer self-mutates (TUI approvals append allow rules to `~/.codex/rules/default.rules`). Testable with `codex execpolicy check`. Critical bypass to close: scripts containing redirection, substitutions, env vars, wildcards or control flow are NOT split and are evaluated as one `[\"bash\",\"-lc\",\"<script>\"]` command, so `git push $BRANCH` never matches a `[\"git\",\"push\"]` rule unless you also carry a `bash -lc` rule.",
      "config": "`<repo>/.codex/rules/upr.rules`; `prefix_rule(pattern=[...], decision=\"allow\"|\"prompt\"|\"forbidden\", justification=\"...\", match=[...], not_match=[...])`; verify with `codex execpolicy check --pretty --rules <file> -- <cmd>` (CLI is in preview). Loads only when the project `.codex/` layer is trusted. Surfaced only if `approval_policy` is not `never`.",
      "layer": "L1"
    },
    {
      "capability": "`InstructionsLoaded` hook + `/context` + `/doctor` as the migration's verification instruments",
      "tool": "claude-code",
      "why_it_matters": "The L2 split is unverifiable by inspection: a mis-authored `paths:` glob (brace-budget overflow, or an unescaped `[`) makes a rule match nothing and load NEVER, silently. `InstructionsLoaded` fires on every CLAUDE.md / `.claude/rules/*.md` load with `{file_path, reason}` where reason ∈ session_start|nested_traversal|path_glob_match|include|compact — it is the only way to PROVE a rule went from unconditional to on-demand. `/context` reports what actually loaded under Memory files; `/doctor` (v2.1.206+) proposes CLAUDE.md trims; `claude plugin details` gives real always-on token counts. Codex has no documented equivalent, so the measurement is one-sided.",
      "config": "`hooks.InstructionsLoaded[].matcher` = the load REASON (not a path); cannot block, exit code ignored. Plus `/context`, `/memory`, `/doctor`, `claude plugin details`, `/usage` (attributes usage per skill/subagent/MCP server and flags long-context or cache-miss above 10%).",
      "layer": "L2"
    },
    {
      "capability": "Skill `context: fork` + `agent`, and subagent `skills:` preloading — one capability body, two execution shapes",
      "tool": "claude-code",
      "why_it_matters": "Removes the need to duplicate text between `.claude/skills/*` and `.claude/agents/*`. A skill can run in isolated context as a named subagent (`context: fork` + `agent:`), and conversely a subagent can preload full skill bodies (`skills:`). That is the concrete de-duplication lever for 24 skills vs 15 subagents. Two traps: a `skills:` entry naming a missing/disabled skill is SILENTLY skipped (debug-log warning only), and the `skills:` field is NOT applied when the same definition runs as an agent-team teammate.",
      "config": "SKILL.md: `context: fork`, `agent: <type>`, `background: true|false`. Subagent frontmatter: `skills: [a, b]`. Note Explore/Plan agents skip CLAUDE.md entirely, so shared L0 law does not reach them; and backgrounded fork edits bypass /rewind checkpoints.",
      "layer": "L3"
    },
    {
      "capability": "Skills-directory plugin: `.claude-plugin/plugin.json` inside a skills folder → `<name>@skills-dir`",
      "tool": "claude-code",
      "why_it_matters": "Bundles skills + agents + hooks + MCP config in ONE tracked directory with no marketplace and no install step, discovered IN PLACE rather than cache-copied (so edits are live and repo-relative reads still work). It also namespaces the bundle (`plugin:skill`), which immunises it against the counterintuitive skill precedence where a developer's personal `~/.claude/skills/<name>` silently shadows the repo copy. Directly addresses the current fragmentation across `.claude/skills`, `.claude/agents`, and hook blocks in `.claude/settings.json`.",
      "config": "`.claude/skills/<name>/.claude-plugin/plugin.json` (manifest optional; if present only `name` is required). Requires accepting the workspace trust dialog. Project scope loads only from the `.claude/skills/` of the launch directory — it does NOT walk up to the repo root. Changes to `hooks/`, `.mcp.json`, `agents/` need `/reload-plugins`. Omit `version` or cached copies go stale on every commit.",
      "layer": "L3"
    },
    {
      "capability": "`@AGENTS.md` import as the bridge — and the explicit instruction NOT to symlink on Windows",
      "tool": "claude-code",
      "why_it_matters": "Anthropic documents this verbatim in a dedicated '### AGENTS.md' section, confirming prior findings. Two things the prior findings did not carry: (a) Anthropic explicitly rules out the symlink on Windows ('requires Administrator privileges or Developer Mode, so use the `@AGENTS.md` import instead'), and a committed symlink is worse — Git for Windows sets `core.symlinks=false` and checks it out as a plain text file whose entire content is the string `AGENTS.md`, which fails silently as 'the rules stopped working'; (b) imports do NOT reduce context — 'imported files load at launch' — so converting the 209.8 KB into `@imports` would preserve the whole cost.",
      "config": "First line of `CLAUDE.md` = `@AGENTS.md`, Claude-only routing appended below. Relative paths resolve against the importing file. Max 4 hops of recursion. Imports inside code spans/fences are skipped. Repo-relative imports trigger no external-import approval dialog (a home-directory import does, and declining is permanent).",
      "layer": "L1"
    },
    {
      "capability": "Root-only survival: what actually persists across /compact",
      "tool": "claude-code",
      "why_it_matters": "The definitive table: system prompt unchanged; project-root CLAUDE.md and UNSCOPED rules re-injected from disk; auto memory re-injected; rules with `paths:` LOST until a matching file is re-read; nested subdirectory CLAUDE.md LOST; invoked skill bodies re-injected but capped at 5,000 tokens each / 25,000 total, oldest dropped first, truncation keeping the START of the file; the startup skill-DESCRIPTIONS listing is NOT re-injected at all (so after a compaction Claude no longer knows which skills exist unless it already used them — the repo's 'skills auto-load by description' assumption quietly stops holding). This is the hard constraint on the L0/L2 boundary.",
      "config": "No config — it is the mechanism. Consequence: safety-critical law (money, consent, shared-Supabase apply gate, never-push-main) must be UNSCOPED in root CLAUDE.md/AGENTS.md; only reference depth may be `paths:`-scoped. Put binding constraints at the TOP of every SKILL.md.",
      "layer": "L0"
    },
    {
      "capability": "`codex review --base <branch>` / `--uncommitted` and `codex exec --json --output-last-message --output-schema`",
      "tool": "codex",
      "why_it_matters": "Gives the close-out gauntlet a second, independent, fresh-context reviewer invocable identically by a human, by CI, or by a Claude session via Bash — Anthropic's own guidance is that 'a fresh context improves code review since Claude won't be biased toward code it just wrote', and cross-tool review is the strongest form of that. `codex exec --output-schema` additionally makes the Codex side emit a schema-validated machine-readable verdict, which is the natural carrier for a handoff record.",
      "config": "`codex review --uncommitted`, `codex review --base dev`, `review_model` in config.toml, `chatgpt.reviewDelivery = detached`. Non-interactive: `codex exec --json --output-last-message <path> --output-schema <path>`, plus `--ignore-user-config` / `--ignore-rules` for a reproducible run that ignores personal machine state.",
      "layer": "L4"
    },
    {
      "capability": "`/goal` as a mechanised close-out condition",
      "tool": "claude-code",
      "why_it_matters": "Wraps a session-scoped prompt-based Stop hook: after every turn a small fast model re-checks a stated completion condition and starts another turn if it does not hold. It can encode close-out-standard.md's checklist so a session cannot hand off until the condition is met. But its limits shape how the L4 contract must be WRITTEN: the evaluator 'doesn't run commands or read files independently', so every gate's real command output must be surfaced in-conversation — which is exactly UPR's existing 'Report the real result — never claim done unverified' rule, now enforceable. It grants no permissions, so it cannot self-authorize a commit or a migration apply.",
      "config": "`/goal <condition or stop after N turns>`; one goal per session; condition capped at 4,000 characters; `/goal clear`; blocked entirely when `disableAllHooks` is set at ANY settings level, when `allowManagedHooksOnly` is in managed settings, or when workspace trust is unaccepted. In `-p` with default text output nothing prints until the condition is met.",
      "layer": "L4"
    },
    {
      "capability": "HTML comments in CLAUDE.md are stripped before injection (zero-token provenance channel)",
      "tool": "claude-code",
      "why_it_matters": "Block-level `<!-- ... -->` in CLAUDE.md costs zero context tokens but stays visible to the Read tool. That is a free home for the provenance the repo currently carries inline at full token cost: last-verified stamps, which tool last edited a section, amendment history, why-this-rule-exists. Claude-only: nothing in the OpenAI docs says Codex strips comments, so assume the same comments in AGENTS.md are PAID by Codex — keep comment-heavy provenance below the import in CLAUDE.md, not in L0.",
      "config": "`<!-- ... -->` block comments in CLAUDE.md (preserved inside code blocks).",
      "layer": "L4"
    },
    {
      "capability": "`claudeMdExcludes` for staged migration and ancestor suppression",
      "tool": "claude-code",
      "why_it_matters": "Glob array matched against ABSOLUTE paths that skips 'every CLAUDE.md and rules file' under a pattern. Two uses: stage the rules conversion (exclude a rules subtree while converting it, without deleting files), and neutralise any ancestor CLAUDE.md above the repo — Claude walks UP the tree indefinitely while Codex never searches above the git root, so a parent-folder CLAUDE.md on this Windows box can inject law Codex cannot see.",
      "config": "`claudeMdExcludes: [\"**/…\"]` at any settings layer; arrays MERGE across layers; managed-policy CLAUDE.md cannot be excluded. Anthropic recommends `.claude/settings.local.json` to keep exclusions machine-local. No equivalent key exists for `.claude/rules/` alone.",
      "layer": "L1"
    },
    {
      "capability": "Codex `agents.<name>` + per-agent `sandbox_mode` in the agent TOML",
      "tool": "codex",
      "why_it_matters": "A Codex custom-agent file is a full config LAYER, not a manifest — it can carry `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `[[skills.config]]`. Pinning `sandbox_mode = \"read-only\"` per reviewer agent is a structural read-only guarantee Claude has no direct analogue for. Crucial default to close: when the agent file OMITS `sandbox_mode`/`mcp_servers`/`skills.config`, they INHERIT from the parent, and subagents also inherit the composer's permission mode — so a reviewer spawned from a write-enabled parent is write-enabled unless it pins otherwise.",
      "config": "`~/.codex/agents/*.toml` (personal) or `.codex/agents/*.toml` (project); required `name`, `description`, `developer_instructions`; identity is the `name` FIELD, not the filename; a name colliding with a built-in (`default`, `worker`, `explorer`) silently replaces it. Repo-wide defaults via `[agents]` (`enabled`, `max_concurrent_threads_per_session`, `default_subagent_model`, `default_subagent_reasoning_effort`). Note `model`/`model_reasoning_effort` in the FILE override an explicit spawn request.",
      "layer": "L1"
    },
    {
      "capability": "Prefer CLI over MCP where the choice exists; cap and front-load capability descriptions",
      "tool": "both",
      "why_it_matters": "Every MCP server pays its tool-listing cost at startup in every session; a CLI (`gh`, `supabase`, `wrangler`) costs nothing until invoked ('CLI tools are the most context-efficient way to interact with external services'). Separately, both tools silently truncate capability discovery lists: Claude's skill listing is 1% of the context window with per-entry description+when_to_use truncated at 1,536 chars, dropping least-used descriptions first; Codex's initial skill list is capped at 2% of context or 8,000 chars, shortening descriptions first then omitting skills with a warning. With 24 + 51 skills the repo is already in the truncation regime, so some capabilities are invisible to implicit matching today.",
      "config": "Claude: `skillListingBudgetFraction`, `SLASH_COMMAND_TOOL_CHAR_BUDGET`, `skillListingMaxDescChars`, `skillOverrides` (`on`/`name-only`/`user-invocable-only`/`off`) to down-rank vendor skills without forking them. Codex: no budget key documented; cap the roster instead. Both: front-load the trigger phrase in the first clause of every `description`. Claude tool responses are capped at 25,000 tokens by default — set pagination/limit defaults on `upr_sql`/`upr_select`/`upr_schema`.",
      "layer": "L3"
    }
  ],
  "corrections": [
    {
      "prior_claim": "Claude skills are `.claude/skills/*/SKILL.md` with frontmatter roughly limited to name, description, allowed-tools, disable-model-invocation, model.",
      "correct_version": "The documented frontmatter set is ~17 fields, ALL optional: name, description, when_to_use, argument-hint, arguments, disable-model-invocation, user-invocable, allowed-tools, disallowed-tools, model, effort, context, agent, background, hooks, paths, shell. The four omissions that change the design are `paths` (path-scoped auto-activation, 'same format as path-specific rules'), `context: fork` + `agent` + `background` (run the skill as a subagent), `hooks` (skill-scoped hooks), and `effort`. Also: `name` in a personal/project SKILL.md sets only the display label — the slash command comes from the DIRECTORY name, so routing docs pointing at /<frontmatter-name> silently fail to resolve.",
      "source": "https://code.claude.com/docs/en/skills.md (vendor)"
    },
    {
      "prior_claim": "`paths:` frontmatter is a `.claude/rules/*.md` feature for on-demand loading.",
      "correct_version": "True but incomplete in a way that matters: SKILL.md supports the same `paths` key with the same semantics, and — the load-bearing corollary the prior findings omitted — a rules file WITHOUT `paths:` loads unconditionally at launch 'with the same priority as .claude/CLAUDE.md'. That absence, not the file count, is why all 209.8 KB enters every session, and it makes the fix per-file frontmatter rather than reorganization.",
      "source": "https://code.claude.com/docs/en/skills.md and https://code.claude.com/docs/en/memory.md (vendor)"
    },
    {
      "prior_claim": "Precedence is broadly 'more specific wins' across Claude's extension points.",
      "correct_version": "Precedence differs PER FEATURE and one case is inverted. Skills: managed > user (personal) > PROJECT — 'enterprise overrides personal, and personal overrides project', so a developer's `~/.claude/skills/<name>` SILENTLY SHADOWS the repo-committed skill of the same name. Subagents: managed > CLI flag > project > user > plugin (project beats user — the opposite order). MCP: local > project > user. CLAUDE.md files: ADDITIVE, resolved by model judgment. Hooks: MERGE, all registered hooks fire regardless of source. A single-source capability plan must use repo-unique skill names or a namespaced plugin to be un-shadowable.",
      "source": "https://code.claude.com/docs/en/features-overview.md and skills.md (vendor)"
    },
    {
      "prior_claim": "Claude subagents live at `.claude/agents/*.md`.",
      "correct_version": "There are FIVE scopes with explicit precedence — managed settings `.claude/agents/`, the `--agents` CLI JSON (session-only), `.claude/agents/`, `~/.claude/agents/`, then a plugin's `agents/`. Both project and user directories are scanned RECURSIVELY, project discovery walks UP from cwd to the repo root (closest to cwd wins), and `--add-dir` directories are scanned too. Identity is the `name` FIELD, never the filename or path (plugins excepted, where a subfolder joins the identifier). Two files under the same directory declaring the same `name` load only one, 'chosen by filesystem read order rather than a documented precedence'.",
      "source": "https://code.claude.com/docs/en/sub-agents.md (vendor)"
    },
    {
      "prior_claim": "Codex config precedence is: managed/system, then ~/.codex/config.toml, then repo .codex/config.toml, then profiles, then CLI flags.",
      "correct_version": "Two errors. (a) Profiles sit BELOW project config, not above: defaults → system `/etc/codex/config.toml` → user `~/.codex/config.toml` → profile `$CODEX_HOME/<name>.config.toml` → project `.codex/config.toml` (root-down, closest wins) → CLI `-c`. (b) Managed/enterprise layers are HIGHEST, not lowest, and explicitly override CLI overrides: 'CLI `--config key=value` overrides apply to the base, but managed layers override them.' Any 'reproducible session pinned with -c flags' claim is false on a managed install. Also: a project `.codex/config.toml` may NOT override `profile`, `profiles`, `model_provider`, `model_providers`, `notify`, `otel`, or the auth/base-URL keys.",
      "source": "https://learn.chatgpt.com/docs/config-file/config-basic + config-advanced + https://learn.chatgpt.com/docs/enterprise/managed-configuration (vendor)"
    },
    {
      "prior_claim": "Codex has model_reasoning_effort with values low/medium/high/xhigh.",
      "correct_version": "The config reference lists FIVE — `minimal | low | medium | high | xhigh` — and `plan_mode_reasoning_effort` additionally accepts `none`. Separately the subagents page enumerates SIX levels including `ultra` and `max` above `xhigh`, and the 2026-07-09 changelog references 'Ultra reasoning'. Two vendor pages disagree on whether ultra/max exist as `model_reasoning_effort` values; do not hard-code them without checking the installed binary.",
      "source": "https://learn.chatgpt.com/docs/config-file/config-reference.md vs https://learn.chatgpt.com/docs/agent-configuration/subagents (both vendor, mutually inconsistent)"
    },
    {
      "prior_claim": "Codex subagents are `.codex/agents/*.toml`.",
      "correct_version": "Correct but incomplete: `~/.codex/agents/*.toml` is the personal-scope twin, and the config reference documents an INLINE registration path — `[agents.<name>]` with `description` (role guidance) plus `config_file` (a path to any TOML config layer) — as an alternative to a drop-in file. Also, an agent file is a full config layer (it may carry `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, `[[skills.config]]`), not a narrow manifest.",
      "source": "https://learn.chatgpt.com/docs/agent-configuration/subagents + config-reference.md (vendor)"
    },
    {
      "prior_claim": "Codex hooks live in `.codex/hooks.json` OR inline `[hooks]` in config.toml.",
      "correct_version": "There are FOUR locations (`~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`) plus plugin-bundled `hooks/hooks.json` and enterprise `requirements.toml` managed hooks. Layers are ADDITIVE, not override — 'Higher-precedence config layers don't replace lower-precedence hooks' — and multiple matching hooks run CONCURRENTLY, so a repo hook can never replace or disable a user hook. Three independent gates must all pass for a repo hook to run: `features.hooks` enabled, project trust, and persisted per-hash HOOK TRUST (a new or edited hook is skipped until a human re-trusts it via `/hooks`).",
      "source": "https://learn.chatgpt.com/docs/hooks.md (vendor)"
    },
    {
      "prior_claim": "Both tools share hook event names (PreToolUse/PostToolUse/SessionStart/Stop) and exit-code-2 + stderr blocking.",
      "correct_version": "The four names and the exit-2 convention are genuinely shared, but the overlap is small and the exit-code semantics have a trap. Claude Code documents 33 events; Codex documents 11 (a superset of the four, adding PermissionRequest, SessionEnd, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop). In BOTH tools exit 1 is a NON-blocking error and execution proceeds — only exit 2 blocks — so a shared guard script that dies via `set -e` silently permits the action. In Claude, 16 events cannot block at all regardless of exit code (including PostToolUse, SessionStart and InstructionsLoaded), and a `Stop` hook declared in subagent frontmatter is silently converted to `SubagentStop`. Codex adds its own trap: emitting `continue`/`stopReason`/`suppressOutput` from a PreToolUse or PermissionRequest hook FAILS the hook, and on failure 'Codex continues tool call' — a cosmetic extra key turns a block into an allow.",
      "source": "https://code.claude.com/docs/en/hooks.md and https://learn.chatgpt.com/docs/hooks.md (vendor)"
    },
    {
      "prior_claim": "Both tools share `mcp__<server>__<tool>` naming.",
      "correct_version": "Not established for Codex and not universal for Claude. No Codex page read in this sweep shows server-prefixed tool names — the Codex config surface uses server ids plus BARE tool names (`enabled_tools = [\"open\",\"screenshot\"]`, `[mcp_servers.<id>.tools.<tool>]`), and the config reference does not indicate namespacing. On the Claude side, a PLUGIN-bundled MCP server requires `mcp__plugin_<plugin-name>_<server-name>__<tool>` in matchers/`if` fields and `plugin:<plugin-name>:<server-name>` for an `mcp_tool` hook's `server` — 'A matcher written against the bare server key never fires', silently. Practical consequence: keep the UPR MCP server OUT of any plugin so existing permission entries keep matching, and do not assume one tool-name string is portable.",
      "source": "https://code.claude.com/docs/en/plugins-reference.md (vendor) and absence of any server-prefix statement in https://learn.chatgpt.com/docs/extend/mcp + config-reference.md (vendor)"
    },
    {
      "prior_claim": "Codex auto-loads an AGENTS.md chain from git root down to cwd.",
      "correct_version": "Correct for the project scope but missing a layer and softening one word. A GLOBAL layer is prepended first: `~/.codex/AGENTS.override.md` if present, else `~/.codex/AGENTS.md` — an un-reviewable, repo-invisible instruction source that can change Codex behaviour on this repo with no repo-side trace. And the vendor's user-facing wording for the chain is override, not merely concatenation: 'If there's a more specific file closer to your current directory, that guidance wins.' So a subdirectory AGENTS.md can read as relaxing a root non-negotiable; the root file must state that nested files are additive-only.",
      "source": "https://learn.chatgpt.com/docs/agent-configuration/agents-md.md and https://learn.chatgpt.com/guides/best-practices (vendor)"
    },
    {
      "prior_claim": "project_doc_max_bytes defaults to 32 KiB and past the cap later files are silently dropped.",
      "correct_version": "Confirmed as to the default (32768) and the silent drop, but the vendor docs CONTRADICT each other on whether the cap is per-file or combined. The dedicated AGENTS.md guide says combined ('stops adding files once the combined size reaches the limit'); config-advanced says per-file ('how much to read from each AGENTS.md file'); config-reference is ambiguous. Treat it as COMBINED (the stricter reading, and the one in the dedicated guide) and budget nested L2 AGENTS.md files against the same 32 KiB. Note also that the 'no warning anywhere in the TUI, /stats, exec, or VS Code extension' detail is USER-REPORTED (openai/codex#13386, still Open, no maintainer confirmation) — the cap itself is vendor-documented, the total absence of a warning is not.",
      "source": "https://learn.chatgpt.com/docs/agent-configuration/agents-md.md vs config-advanced.md (vendor, inconsistent); no-warning detail from openai/codex issue #13386 (user report, unconfirmed)"
    },
    {
      "prior_claim": "Claude commands (.claude/commands/) and skills are distinct systems.",
      "correct_version": "They have been merged. 'A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way'; commands files 'support the same frontmatter'; and on a name collision 'the skill takes precedence'. One namespace, not two. Existing `.claude/commands/` files keep working; converting to a skill directory is what unlocks `paths`, supporting files, and model-invocability.",
      "source": "https://code.claude.com/docs/en/skills.md (vendor)"
    },
    {
      "prior_claim": "project_doc_fallback_filenames adds alternate filenames only where AGENTS.md is ABSENT at that level.",
      "correct_version": "Confirmed verbatim ('Additional filenames to try when AGENTS.md is missing'), with the consequence spelled out: it CANNOT serve as a reverse bridge in this repo. With AGENTS.md present at the git root, `project_doc_fallback_filenames = [\"CLAUDE.md\"]` never fires — it is a migration/gradual-adoption aid only, and configuring it as a sync mechanism is a silent no-op. Separately, `model_instructions_file` (deprecating `experimental_instructions_file`) REPLACES the AGENTS.md path entirely rather than layering, so a stale value in any Codex config layer silently bypasses the whole L0 law.",
      "source": "https://learn.chatgpt.com/docs/config-file/config-reference.md + config-advanced.md (vendor)"
    },
    {
      "prior_claim": "A third-party claim circulating in blogs: Claude Code reads AGENTS.md as a fallback when no CLAUDE.md is present.",
      "correct_version": "False. Anthropic states plainly: 'Claude Code reads CLAUDE.md, not AGENTS.md.' The bridge must be an explicit `@AGENTS.md` import (or, on non-Windows, a symlink). The one exception is authoring-time only: `/init` reads AGENTS.md solely when `CLAUDE_CODE_NEW_INIT=1` is set, which is a migration aid and not a runtime bridge.",
      "source": "Vendor https://code.claude.com/docs/en/memory.md overrides the third-party claim, which the citing blog (codex.danielvaughan.com) itself flagged '[unverified]' and attributed to deployhq.com"
    }
  ],
  "recipe_additions": [
    {
      "layer": "L0",
      "change": "Cap the shared AGENTS.md core at roughly 8-12 KB and order it non-negotiables-FIRST, commands-second. Explicitly pin `project_doc_max_bytes = 65536` in a tracked `.codex/config.toml` as insurance, and add a CI byte-count check on the whole AGENTS.md chain.",
      "rationale": "Codex stops adding project-doc files once the combined size hits `project_doc_max_bytes` (default 32768) with no warning, dropping the TAIL. The current CLAUDE.md alone is 30.7 KB — a naive merge would sit on the cliff, and every nested L2 AGENTS.md consumes the SAME budget. Claude by contrast loads CLAUDE.md in full at any length (it only degrades adherence), so Codex is the stricter of the two and must set the size budget."
    },
    {
      "layer": "L0",
      "change": "Add a `## Code Review Rules` section to the root AGENTS.md, written in OpenAI's prescribed shape — invariant, then the safe path, then the scope — and restricted to consequential invariants only (money/QBO, TCPA consent and worker-sole-writer, additive-only on live tables, least-privilege grants and no `anon`, no cross-channel fallback). Leave eslint-shaped rules (no alert/confirm) to eslint/CI.",
      "rationale": "Codex's reviewer obeys that exact heading on `@codex review` and automatic PR review, applying root plus nearest-file guidance for each changed file — turning repo law into a machine gate at the exact moment UPR's close-out already opens a PR as a handoff. But Codex 'flags only P0 and P1 issues', so minor rules placed there silently never surface, and OpenAI's own guidance is to keep formatting/lint checks in CI."
    },
    {
      "layer": "L0",
      "change": "State in the root AGENTS.md that nested per-directory AGENTS.md files are ADDITIVE-ONLY and may never relax a root non-negotiable; and state the authority boundary verbatim — delegation is not authorization, no agent message counts as owner approval, and no agent message may change permission settings, AGENTS.md/CLAUDE.md, or configuration.",
      "rationale": "Codex's user-facing wording is override semantics ('the more specific file closer to your current directory wins'), so a subdirectory file can read as weakening L0. Separately, Codex subagents inherit the parent's sandbox policy and the composer's permission mode, and Claude subagents treat launcher messages as normal task direction — so the inheritance rules would otherwise quietly launder an approval granted for a different action on the one shared production Supabase."
    },
    {
      "layer": "L0",
      "change": "Put the literal `npm run lint` / `npm run build` / `npm test` commands and the definition of done near the TOP of AGENTS.md, not in an L2 depth file. Keep the `## Compact instructions` block in the shared core but duplicate its critical facts (which migrations already applied, modified files, real test results) into the L4 handoff file.",
      "rationale": "Codex cloud reads AGENTS.md specifically to find project lint and test commands, and both vendors list 'what done means and how to verify' as core AGENTS.md/CLAUDE.md content. The compaction directive is Claude-documented and Codex-UNVERIFIED (no OpenAI page documents an equivalent), so it cannot be the only carrier of state that must survive a context reset in either tool."
    },
    {
      "layer": "L1",
      "change": "CLAUDE.md becomes `@AGENTS.md` on line one plus a short Claude-only routing block. Do NOT symlink and do NOT commit a symlink. Track `.codex/config.toml` for the Codex half of routing. Forbid `model_instructions_file` anywhere in this repo, and gitignore both `AGENTS.override.md` and `CLAUDE.local.md`.",
      "rationale": "Anthropic documents the import as the bridge and explicitly tells Windows users to prefer it over a symlink; worse, Git for Windows sets core.symlinks=false so a committed symlink checks out as a text file containing the literal string 'AGENTS.md' — a silent 'the rules stopped working'. `model_instructions_file` REPLACES the AGENTS.md path rather than layering. `AGENTS.override.md` wins at its level, so committing one would silently outrank shared law for everyone."
    },
    {
      "layer": "L1",
      "change": "Record the Windows-specific and version-specific routing facts explicitly: Codex hook entries need a separate `commandWindows`; `features.unified_exec` defaults to true EXCEPT Windows; Claude's Bash sandbox does not run on native Windows at all; Claude skill `!`cmd`` injection defaults to bash (this box has Git Bash, so PowerShell syntax fails); `$N` argument substitution is ZERO-based ($0 is the first argument); Codex skills are invoked with `$name`, Claude skills with `/name`; and `claude -p --bare` skips hooks, skills, plugins, MCP, auto memory AND CLAUDE.md entirely.",
      "rationale": "Each of these is a silent divergence that would make a shared instruction read as broken rather than as unsupported. The `--bare` fact is the most dangerous: it is slated to become the default for `-p`, so any future CI gate written that way is bound by NO project law unless the core is passed explicitly via `--append-system-prompt-file`."
    },
    {
      "layer": "L2",
      "change": "Add `paths:` frontmatter to every one of the 23 `.claude/rules/*.md`, keeping globs brace-LIGHT (prefer `src/pages/tech/**/*.jsx` over `src/**/*.{js,jsx,ts,tsx}`), and verify each conversion with an `InstructionsLoaded` hook log plus `/context` before and after.",
      "rationale": "A rule with no `paths:` loads unconditionally at launch — that is the entire 209.8 KB problem. But an over-braced pattern that blows the 1,000-expanded-pattern / 4 MiB budget 'is used unexpanded, and its literal braces match no files', i.e. the rule silently never loads again; an unescaped `[` does the same. The failure mode is deletion of project law with no error, so the migration is only trustworthy if it is measured."
    },
    {
      "layer": "L2",
      "change": "Keep safety-critical law UNSCOPED in the root AGENTS.md/CLAUDE.md and move only reference depth behind `paths:`. Never place a non-negotiable in a nested CLAUDE.md.",
      "rationale": "The compaction table is explicit: project-root CLAUDE.md and unscoped rules are re-injected from disk after /compact, while `paths:`-scoped rules and nested CLAUDE.md files are LOST until a matching file is read again. Cheap-at-startup and survives-compaction are mutually exclusive in Claude Code; a mid-task compaction would otherwise silently remove the shared-Supabase apply gate."
    },
    {
      "layer": "L2",
      "change": "Mirror the depth layer for Codex as nested `AGENTS.md` files at `supabase/migrations/`, `functions/api/`, `src/pages/`, `src/pages/tech/`, and `ios/` — generated with `/init` in each directory and then reconciled against L0 so nothing is duplicated. Count their bytes against the same 32 KiB chain budget.",
      "rationale": "Codex has NO conditional-markdown-loading mechanism: `.codex/rules/*.rules` is Starlark command policy, not context, so the 23 rules cannot be mirrored there. Nested AGENTS.md (loaded only when cwd is at/below them) is Codex's only on-demand depth tier, which means L2 is structurally asymmetric and the plan must budget for authoring it twice."
    },
    {
      "layer": "L2",
      "change": "Restructure each depth unit as two tiers: a short navigator (SKILL.md under 500 lines, or a slim nested AGENTS.md) whose binding constraints appear at the TOP, plus heavy normative detail in sibling reference files loaded only on navigation.",
      "rationale": "Anthropic's three-level progressive-disclosure contract makes level-3 bundled context effectively unbounded, so depth becomes free once it is a referenced file. And re-injected skill bodies are capped at 5,000 tokens each / 25,000 total after compaction, with truncation keeping the START of the file — anything binding placed late in a long SKILL.md disappears post-compaction."
    },
    {
      "layer": "L3",
      "change": "Commit `.agents/` and `.codex/` to the repo, then de-duplicate: one canonical body per capability, registered to both tools. Prefer a symlinked skill folder (Codex documents following symlinks when scanning) with a build/copy fallback on Windows; register Codex skills by explicit path via `[[skills.config]]` where symlinks are impractical.",
      "rationale": "Codex cloud sessions and the Codex-cloud-hosted PR reviewer see only the committed checkout, so 51 untracked skills and 30 untracked subagents do not exist there and nothing reports it. Config cannot bridge the trees — no Codex key adds `.claude/skills` as a discovery root, and `[[skills.config]]` keys on an absolute machine-specific path so it toggles rather than registers. Symlinked skill folders are the only documented single-source mechanism."
    },
    {
      "layer": "L3",
      "change": "Cut the capability roster before porting anything. Apply the disambiguation test — if a human cannot say definitively which skill or subagent applies, consolidate or delete rather than writing precedence prose. Front-load trigger words in the first clause of every description, and use `skillOverrides: name-only` to down-rank vendor skills without forking them.",
      "rationale": "Both tools silently truncate discovery lists (Claude: 1% of context, per-entry description+when_to_use cut at 1,536 chars, least-used dropped first; Codex: 2% of context or 8,000 chars, descriptions shortened then whole skills omitted). With 24+51 skills the repo is already in that regime, so some capabilities are invisible to implicit matching today. Anthropic's own line: 'If a human engineer can't definitively say which tool should be used, an AI agent can't be expected to do better.'"
    },
    {
      "layer": "L3",
      "change": "Mark every side-effectful capability non-model-invocable: `disable-model-invocation: true` on the Claude skill, `policy.allow_implicit_invocation: false` in the Codex skill's `agents/openai.yaml`, and a matching `Skill(name)` deny rule where the capability must never self-trigger.",
      "rationale": "It is simultaneously the cheapest context saving (a disable-model-invocation skill's description is NOT in the startup listing at all) and a structural enforcement of UPR's owner-authorization posture for migrations, sends, commits and publishes — replacing prose that has to be restated in every doc. Note `user-invocable: false` is NOT a substitute: it hides the / menu only and does not block Skill-tool access."
    },
    {
      "layer": "L3",
      "change": "Add two required lines to every reviewer/checker definition in both trees: a return budget of roughly 1,000-2,000 tokens in the existing verdict + numbered-findings format, and an explicit instruction to flag only gaps affecting correctness or the stated requirements.",
      "rationale": "Anthropic states the subagent value proposition IS the condensed return, and warns that 'a reviewer prompted to find gaps will usually report some, even when the work is sound' leading to extra abstraction, defensive code and tests for impossible cases. With 15 Claude plus 30 Codex reviewers and a mandatory 3-agent gauntlet per UI change, an unscoped gauntlet manufactures work."
    },
    {
      "layer": "L3",
      "change": "Pin `sandbox_mode = \"read-only\"` explicitly in every Codex reviewer agent TOML, and pin `tools`/`disallowedTools` explicitly on every Claude read-only subagent. Do not rely on inheritance or on `permissionMode`.",
      "rationale": "Codex subagents inherit sandbox_mode, mcp_servers and skills.config from the parent whenever the agent file omits them, and inherit the composer's permission mode. Claude's `permissionMode` is not a guarantee at all — a parent in bypassPermissions or acceptEdits overrides it, and a parent in auto mode makes it ignored entirely. In both tools inheritance is the failure mode, and the fix is an explicit per-agent pin."
    },
    {
      "layer": "L4",
      "change": "Standardise ONE tracked handoff file per initiative (extending the existing docs/*-roadmap.md + registry practice), using the four headings both vendors already prescribe — Goal / Context / Constraints / Done when — plus the three fields Anthropic requires of a spec: the files and interfaces involved, what is explicitly out of scope, and an end-to-end verification step.",
      "rationale": "OpenAI's prompt schema and Anthropic's SPEC.md fields map 1:1, so one document reads natively to both tools. It is also the only viable carrier: neither tool can read the other's session state, Claude transcripts are session-scoped, 30-day-retained and in an internal format that 'changes between versions', Codex history is machine-local under CODEX_HOME, Codex plan mode persists no artifact, and both tools compact automatically."
    },
    {
      "layer": "L4",
      "change": "Write into the handoff contract that git is the ONLY reliable undo, and that a handoff must carry evidence (the command run and its real output) rather than assertions.",
      "rationale": "Claude checkpoints do not track file changes made by bash commands, do not restore subagent edits, and normally miss concurrent-session changes — and this repo dispatches heavily to subagents and applies migrations via MCP/CLI. On the evidence side, `/goal`'s evaluator 'doesn't run commands or read files independently', so a close-out gate can only check what was actually surfaced in the conversation; that makes UPR's existing 'report the real result, never claim done unverified' rule mechanically enforceable instead of aspirational."
    },
    {
      "layer": "L4",
      "change": "Add three operational warnings to the handoff contract: (1) editing CLAUDE.md or AGENTS.md mid-session does NOT apply until /clear, /compact or restart, so a session that amends the law layer must restart before acting on the amendment and must not report 'rule updated and followed' in one breath; (2) a Codex repo hook is skipped until a human re-trusts its hash via `/hooks`, and editing the hook re-arms the gate; (3) a fresh Codex session must confirm project trust first, because an untrusted `.codex/` layer silently supplies no config, no hooks and no rules.",
      "rationale": "All three are silent no-ops that would otherwise be reported as compliance. Anthropic states plainly that a mid-session CLAUDE.md edit 'does not invalidate the cache, but the edit also doesn't apply'; Codex documents both the per-hash hook trust gate and that 'Codex loads project .codex/ layers only when you trust the project'."
    },
    {
      "layer": "L4",
      "change": "Wire a two-part CI guard: assert the invariants of the layering (CLAUDE.md still begins with `@AGENTS.md`; the AGENTS.md chain is under the Codex byte cap; every `.claude/rules/*.md` carries `paths:`; every subagent `skills:` entry resolves; every `.claude/agents/*.md` name is unique), and add `codex review --base dev` plus `@codex review` on the handoff PR as an independent fresh-context reviewer.",
      "rationale": "Choosing the `@AGENTS.md` import over duplicate copies makes content drift structurally impossible, so the CI job's real job is asserting invariants rather than diffing files. The cross-tool review is the strongest form of Anthropic's own advice that 'a fresh context improves code review since Claude won't be biased toward code it just wrote', and it consumes the `## Code Review Rules` section the L0 change installs."
    }
  ],
  "hard_gates_available": [
    {
      "gate": "Block writes to `.env*` (secret files)",
      "claude_mechanism": "TWO layers. (a) `permissions.deny: [\"Read(.env)\", \"Read(**/.env*)\", \"Edit(**/.env*)\"]` — note a bare filename follows gitignore semantics so `Read(.env)` == `Read(**/.env*)`, and a `Read` deny also blocks `Edit` on the same path (v2.1.208+). CRITICAL: `Write(path)`, `NotebookEdit(path)` and `Glob(path)` rules are 'accepted but never matched' and only emit a startup warning — the correct spellings are `Edit(...)` and `Read(...)`. (b) The existing `.claude/hooks/block-secrets.sh` PreToolUse hook, exit 2 with a stderr reason, which stops the call BEFORE permission rules are evaluated and therefore beats even an allow rule.",
      "codex_mechanism": "Same script wired as a `PreToolUse` hook in `.codex/hooks.json` with matcher `apply_patch|Edit|Write` (there is no `MultiEdit` in Codex), exit 2 + stderr. Stronger config-level option: `[permissions.<name>].filesystem.<path> = \"deny\"` in a named permission profile, or exclude the path from `sandbox_workspace_write.writable_roots`.",
      "parity": "PARTIAL. The script itself is portable — both tools read the same stdin JSON fields (`cwd`, `tool_name`, `tool_input.command`) and both block on exit 2 with stderr — but it must NOT reference `$CLAUDE_PROJECT_DIR`, which Codex does not provide (only PLUGIN_ROOT/PLUGIN_DATA and their CLAUDE_* aliases); resolve the root inside the script from the process cwd. The asymmetry is enforcement strength: Claude's permission deny is harness-enforced unconditionally, whereas a Codex repo hook silently does nothing unless `features.hooks` is on, the project is trusted, AND the hook's current hash is trusted — and editing the hook re-arms that gate. In BOTH tools deny rules and hooks cover built-in file tools and recognised Bash file commands only, NOT 'arbitrary subprocesses that read or write files indirectly, like a Python or Node script that opens files itself'. Treat Claude as enforced, Codex as best-effort unless a filesystem permission profile is configured, and treat neither as protecting against a script that opens the file itself."
    },
    {
      "gate": "Block free-form/destructive SQL against the one shared production Supabase",
      "claude_mechanism": "`permissions.deny` on the MCP tool names (`mcp__<server>__execute_sql`, `mcp__<server>__upr_sql`) — a bare-name deny removes the tool from Claude's context entirely so it is never even offered. Deny/ask rules also accept `mcp__*` to remove all MCP tools, and `Tool(param:value)` ask rules can gate on a top-level input parameter. Deny beats ask beats allow, first match wins, and 'if a tool is denied at any level, no other level can allow it'.",
      "codex_mechanism": "`mcp_servers.<id>.disabled_tools = [\"execute_sql\", ...]`, or `mcp_servers.<id>.tools.<tool>.approval_mode = \"approve\"` / `default_tools_approval_mode`. Plus `.codex/rules/upr.rules` with `prefix_rule(pattern=[\"supabase\",\"db\"], decision=\"forbidden\")`-style entries for CLI paths, and `[features.network_proxy].domains` denying the Supabase host outright (only effective when `network_access = true`).",
      "parity": "ACHIEVABLE, and arguably stronger on the Codex side (per-tool approval_mode plus a network-layer deny; a repo `forbidden` rule cannot be overridden by a user `allow` because the strictest decision wins). Two caveats to write down: per-tool gating keys on the tool NAME only, so a single tool that can both read and write cannot be half-gated and must be denied outright; and Codex prefix rules do not split shell scripts containing redirection, substitutions, env vars, wildcards or control flow — those collapse to one `[\"bash\",\"-lc\",\"<script>\"]` command, so the rules file must also carry a `bash -lc` rule or the deny is trivially evadable."
    },
    {
      "gate": "Migration-apply gate (author freely; apply only on a fresh owner instruction)",
      "claude_mechanism": "`permissions.deny` or `ask` on `mcp__<server>__apply_migration` and the branch-mutating tools; `disable-model-invocation: true` on the db-migration skill so only a human can trigger it; a PreToolUse hook as belt-and-braces. Ancillary benefit: in auto mode the classifier BLOCKS 'Production deploys and migrations' by default, which happens to align with database-standard.md §0.",
      "codex_mechanism": "`mcp_servers.<id>.tools.apply_migration.approval_mode = \"approve\"` or list it in `disabled_tools`; `policy.allow_implicit_invocation: false` in the migration skill's `agents/openai.yaml`; `prefix_rule` with `decision = \"forbidden\"` for `supabase db push`-style CLI paths.",
      "parity": "TOOL-LEVEL PARITY IS ACHIEVABLE. The SEMANTIC part is not enforceable in either tool: no mechanism can verify that an authorization is fresh, task-specific, and from the owner rather than from an orchestrating agent. That check remains prose in L0 — and it must be prose that survives compaction, i.e. UNSCOPED in root AGENTS.md/CLAUDE.md, never in a `paths:`-scoped rule or a nested file, both of which are dropped at /compact until re-read. Also note Claude's auto-mode conversational boundaries are explicitly NOT stored as rules and 'can be lost if context compaction removes the message that stated it. For a hard guarantee, add a deny rule instead.'"
    },
    {
      "gate": "Never push `main` directly / publication gate (commit, push, PR, deploy)",
      "claude_mechanism": "Only a PreToolUse hook that parses the ref is robust. `permissions.deny: [\"Bash(git push * main)\", \"Bash(git push origin main)\"]` works only as enumerated literals, because a broad deny 'can't carry allowlist exceptions' — `Bash(git push *)` in deny blocks even a narrower allow, and rule specificity does not change the order. Deny/ask rules do match past leading env assignments; allow rules do not. Wrapper stripping does NOT cover `npx`, `devbox run`, `mise exec` or `docker exec`, so `Bash(npx *)` is effectively arbitrary execution.",
      "codex_mechanism": "`prefix_rule(pattern=[\"git\",\"push\"], decision=\"prompt\"|\"forbidden\")` with strictest-wins beating any user-layer allow, plus a companion `bash -lc` rule; and/or a `PreToolUse` hook exit 2 parsing `tool_input.command`.",
      "parity": "PARTIAL, and this is the gate most likely to be believed and not held. Claude's own docs state that in AUTO MODE, 'Pushing to any branch of the repository you're working in, including the default branch' is ALLOWED by default — so the prose rule 'never push main directly' is unenforced there and must become a deny rule. On the Codex side a bare `[\"git\",\"push\"]` prefix rule never matches `git push $BRANCH` or `git push origin HEAD > log` because of the no-split behaviour. In both tools the only robust implementation is a shared exit-2 hook that parses the actual ref out of the command; and note Claude's Stop hook (a tempting close-out gate) is overridden after 8 consecutive blocks and therefore cannot be the sole enforcement for anything safety-critical."
    },
    {
      "gate": "Prevent an agent from modifying its own permission/instruction/config layer",
      "claude_mechanism": "BUILT IN. `.claude` (except `.claude/worktrees`), `.git`, `.husky`, `.mcp.json`, `.claude.json`, shell rc files, `.envrc`, `.npmrc` and others are PROTECTED PATHS: writes are prompted in default/acceptEdits/plan, DENIED in dontAsk, and — critically — `permissions.allow` cannot pre-approve them, because 'the safety check runs before Claude Code evaluates allow rules from settings'. Only bypassPermissions allows them.",
      "codex_mechanism": "No documented protected-path equivalent was found in any Codex page read. It must be constructed: a `[permissions.<name>].filesystem` deny on `.codex/`, `.agents/` and `AGENTS.md`, or a PreToolUse hook — and the hook is itself subject to the trust gate it would be protecting.",
      "parity": "NOT AT PARITY OUT OF THE BOX. Claude has a built-in, allow-rule-proof gate on its own config surface; Codex has to be configured for it, and the natural configuration (a repo hook) can be silently untrusted or disabled by `[features] hooks = false`. Practical consequence for the recipe: expect prompts when legitimately editing `.claude/rules/` during the migration (that is correct behaviour, not a bug), do not attempt to grant `Edit(.claude/**)` because it will not work, and on the Codex side rely on code review of `.codex/` and `.agents/` diffs rather than assuming a mechanical gate exists."
    },
    {
      "gate": "No alert()/confirm(); toast only through src/lib/toast.js; index.css marker discipline; migration header format",
      "claude_mechanism": "eslint (already error-level for alert/confirm, warn-and-ratcheting for local errToast copies) plus the changed-files ratchet in eslint.config.js, run in CI and by the close-out checklist. Optionally a PostToolUse hook whose `hookSpecificOutput.additionalContext` feeds lint findings straight back.",
      "codex_mechanism": "Identical: the same eslint invocation, plus optionally a `PostToolUse` hook with matcher `apply_patch|Edit|Write`. A `## Code Review Rules` entry is available but is the WRONG home for these.",
      "parity": "TRUE PARITY, because the gate is CI and eslint rather than the agent. This is the cheapest way to shrink L0: Anthropic's own guidance is 'If Claude already does something correctly without the instruction, delete it or convert it to a hook', and mechanically checkable rules should leave the always-loaded layer entirely. Deliberately keep these OUT of the `## Code Review Rules` section — Codex flags only P0/P1 there, so a lint-shaped rule would silently never surface, and OpenAI explicitly says to 'leave formatting and lint checks in CI'."
    },
    {
      "gate": "OS-level enforcement (a sandbox that constrains every process, not just the agent's tool calls)",
      "claude_mechanism": "The built-in Bash sandbox — `sandbox.enabled`, `sandbox.filesystem.*`, `sandbox.network.*`, `sandbox.credentials.*`, `sandbox.failIfUnavailable` — merged with Read/Edit deny rules and WebFetch domain rules. BUT: 'Native Windows is not supported. On Windows, run Claude Code inside a WSL2 distribution.' And it FAILS OPEN by default: if the sandbox cannot start, Claude 'shows a warning and runs commands without sandboxing' unless `sandbox.failIfUnavailable: true`.",
      "codex_mechanism": "`sandbox_mode = \"read-only\" | \"workspace-write\" | \"danger-full-access\"` with a NATIVE Windows implementation (plus `windows.sandbox`, `windows.sandbox_private_desktop`), `[sandbox_workspace_write]` writable-root and network keys, `[permissions.<name>]` filesystem/network profiles, and `[features.network_proxy]` domain allow/deny.",
      "parity": "INVERTED ASYMMETRY, and this is the single most important platform fact for this repo. On the owner's current win32 machine Codex CAN sandbox natively while Claude CANNOT sandbox at all — so OS-level enforcement is available to Codex and unavailable to Claude unless work moves into WSL2. The recipe must therefore NOT list sandboxing as a Claude-side UPR control on the current platform; Claude's only OS-independent hard enforcement is permission deny rules plus PreToolUse hooks. Note also that a permissive Claude `Edit(...)` ALLOW rule silently WIDENS the sandbox write boundary where the sandbox does run, and that `sandbox.filesystem.*` uses a DIFFERENT path-prefix convention (`/abs`, `./project-relative`) from permission rules (`//abs`, `/settings-source-relative`) — mixing them up anchors a rule in the wrong place silently."
    }
  ],
  "remaining_gaps": [
    "Is Codex's `project_doc_max_bytes` a PER-FILE or a COMBINED cap? Two vendor pages contradict each other (the dedicated AGENTS.md guide says combined; config-advanced says 'each AGENTS.md file'). This directly determines how much headroom the nested L2 AGENTS.md chain has. Settle it empirically: create a root AGENTS.md near the cap plus a nested one, and observe whether the nested content reaches the model. Cannot be settled from the docs.",
    "Does Codex give ANY way to see which AGENTS.md files it actually loaded, or whether truncation occurred? No equivalent of Claude's `InstructionsLoaded` hook, `/context` or `/doctor` appears in any Codex page read. Until proven otherwise, the Codex half of the L2 split can only be verified by inspection and byte counting — which means the migration is measurable on the Claude side and merely plausible on the Codex side.",
    "Does LOCAL `codex review` / `codex review --base dev` honour the AGENTS.md `## Code Review Rules` section? The convention is documented ONLY on the GitHub-integration page; /docs/code-review contains no AGENTS.md mention at all. This must be tested by running it against a deliberately rule-violating diff. If it does not, the review gate exists only on the PR path.",
    "Is the `## Code Review Rules` section itself subject to `project_doc_max_bytes` truncation? Unstated. If it is, a rules section placed late in a long root AGENTS.md could be silently dropped from the reviewer's input — which is a strong argument for putting it early regardless, but needs a test to confirm the risk.",
    "Do UNSCOPED `.claude/rules/*.md` load into Claude SUBAGENTS? The docs enumerate a subagent's startup context exhaustively (own system prompt, the delegation message, the full CLAUDE.md hierarchy including CLAUDE.local.md and managed policy, git status, preloaded skills) but are SILENT on rules files. With 15 subagents and a mandatory 3-agent gauntlet per UI change, this multiplies or does not multiply the 209.8 KB cost by roughly 3-4x per task. Only answerable by running a subagent with an `InstructionsLoaded`-style probe or by inspecting a subagent transcript.",
    "What are the REAL startup token numbers, before and after? Every figure in this sweep is either vendor-illustrative (the simulator's 1,800 tokens for a project CLAUDE.md) or my own chars-per-token estimate. The actual measurement requires running `/context`, `claude plugin details` and `/usage` on this machine — nobody can supply it from documentation.",
    "Which keys are actually honoured in a repo-level `.codex/config.toml`? Vendor best-practices names it as a config location and shows `[agents]` and `[mcp_servers]` in project-config examples, and an explicit deny-list exists (profile, profiles, model_provider, notify, otel, auth/base-URL keys). But no page enumerates the honoured set, and community reports (openai/codex issue tracker, NON-AUTHORITATIVE) claim some keys are silently ignored at project scope. Verify per key with `codex --strict-config` and `/status` before the L1 Codex layer depends on any of them.",
    "Are managed/enterprise Codex settings in effect on the owner's machine? If they are, `-c` pins are silently overridden ('managed layers override them'), which invalidates any 'reproducible session' claim. Only the owner can answer, via `/status` or `codex doctor`.",
    "Is this repo marked trusted for Codex project layers on each machine that will run it? An untrusted `.codex/` layer silently supplies no config, no hooks and no rules, and there is no documented warning when a project `.codex/config.toml` exists without a trust setting (an open upstream request). Owner must confirm per machine, and a fresh clone or CI runner starts untrusted.",
    "Does `model_reasoning_effort` accept `ultra` and `max`? The config reference lists `minimal|low|medium|high|xhigh`; the subagents page lists `ultra|max|xhigh|high|medium|low`; the 2026-07-09 changelog mentions 'Ultra reasoning'. Two vendor pages disagree. Resolve against the installed binary (`codex --help`) rather than the docs.",
    "What are the ACCEPTED VALUES for Codex's `approval_policy = { granular = { ... } }` sub-keys (`sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval`)? The key NAMES are documented; the values are not, and the page that would carry them (learn.chatgpt.com/docs/agent-configuration/config.md) 404s. Also unverified from official docs: `sandbox_workspace_write.writable_roots`, `exclude_slash_tmp`, `exclude_tmpdir_env_var` — those key names came from a WebSearch summary of THIRD-PARTY write-ups, not a vendor page.",
    "Can a Codex plugin bundle SUBAGENTS, and does Codex read `.claude-plugin/plugin.json` (the plugin manifest, as opposed to the marketplace file)? Neither is documented either way. Only the MARKETPLACE file is documented as legacy-compatible ('legacy-compatible marketplace at $REPO_ROOT/.claude-plugin/marketplace.json'). Treat cross-reading of the plugin manifest as UNSUPPORTED until proven; get the authoritative Codex schema with `codex app-server generate-json-schema`.",
    "Does Codex follow a SYMLINKED AGENTS.md? Symlinked SKILL folders are explicitly followed, but nothing in agents.md, the openai/codex repo docs, or either learn.chatgpt.com page addresses a symlinked AGENTS.md. Since the recipe uses the `@AGENTS.md` import rather than a symlink, this only matters if someone later 'simplifies' — but it is genuinely undocumented, not merely unread.",
    "Does Codex strip HTML comments from AGENTS.md before injection, the way Claude does for CLAUDE.md? Unaddressed in every OpenAI page read. Assume Codex PAYS for those tokens; the zero-cost provenance channel is Claude-only until someone measures it.",
    "Does the global `~/.codex/AGENTS.md` count against the same `project_doc_max_bytes` budget as the project chain? Unstated. It also means a teammate can inject repo-invisible instructions with no code-review trace — the handoff contract should require disclosure when a Codex session's behaviour contradicts L0, because there is no mechanical way to detect it.",
    "Whether the owner is willing to run Claude Code inside WSL2. Until that is decided, Claude has NO OS-level sandbox on this machine and the recipe cannot claim OS-level enforcement parity for the Claude side. This is an owner decision, not a documentation question.",
    "The exact minimum Claude Code version the recipe should pin. This sweep surfaced version gates on nearly everything it relies on: v2.1.129 (${CLAUDE_SKILL_DIR} in allowed-tools), v2.1.196 (${CLAUDE_PROJECT_DIR}), v2.1.199 (skill stacking), v2.1.203-2.1.210-2.1.216 (worktree git-escape checks), v2.1.206 (/doctor CLAUDE.md trim), v2.1.207 and v2.1.211 and v2.1.217 (rules `paths:` bug fixes — pre-2.1.207 one invalid pattern broke Read for every evaluated file; pre-2.1.217 heavy brace groups could CRASH at startup), v2.1.208 and v2.1.210 (Read-deny-covers-Edit; Write/Glob rule warnings), v2.1.218 (boolean frontmatter aliases, background: false). The installed version on this machine was not checked."
  ],
  "headline": "The two tools' on-demand depth mechanisms are NOT the same shape — Claude gets `paths:`-scoped rules and skills, Codex has no conditional-markdown loading at all and only nested per-directory AGENTS.md — so L2 must be authored twice, while the compaction/truncation rules force every safety-critical non-negotiable to stay UNSCOPED at the root of a shared core kept small enough to survive Codex's silent 32 KiB tail-drop."
}
```
