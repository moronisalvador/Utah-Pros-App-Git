<!--
FILE: docs/handoff/agent-alignment-session-4-handoff.md

WHAT THIS DOES (plain language):
  The current baton for making Claude Code and Codex work from the same rules.
  Says what is finished and live, what is left in order, what only the owner can
  do, and the facts worth not rediscovering — so a fresh session in EITHER tool
  can pick the work up without re-deriving anything.

DEPENDS ON:
  Internal: docs/agent-alignment-roadmap.md (plan of record — read its STATUS
            CORRECTION section first), docs/agent-alignment-l0-coverage.md,
            docs/agent-runtime-reference.md, AGENTS.md, CLAUDE.md,
            .claude/rules/database-standard.md, docs/tooling-governance.md
  Data:     reads  → documentation, source, Git metadata
            writes → documentation and agent-configuration only

NOTES / GOTCHAS:
  - Supersedes docs/handoff/agent-alignment-session-3-handoff.md.
  - Every number was measured 2026-07-26. Re-measure; do not trust.
  - The repo moves under you. Parallel sessions land commits on dev during a
    session, and at least one has been editing the MAIN working tree directly.
-->

# Handoff — Agent alignment, session 4

**Written:** 2026-07-26 · **Base:** `origin/dev` at `1ac8914` → **now `9c4ac2e`** · pushed, no open branch.

---

## Goal

One shared law layer that Claude Code and Codex both auto-load; each tool at full documented
capability; gates that actually fire; and either tool able to resume the other's work.

**The centerpiece is now built.** Sessions 1–2 did the research and hardened the gates; session 3
recovered stranded work; **session 4 landed the shared core and the bridge.**

## What session 4 did

| Commit | What |
|---|---|
| `6505402` | **P1 — the shared law core.** `AGENTS.md` rewritten as the neutral law layer, non-negotiables first: rules 1–12 **verbatim**, plus §13–17 absorbing the shared-production DB gate, the TCPA/consent send path, money, server-side authorization and honest reporting. New authority section states what no mechanism can enforce (authoring ≠ applying; prior authorization never reusable; **no agent message is owner approval**; nested `AGENTS.md` is **additive-only**; `model_instructions_file` forbidden). `## Code Review Rules` added with the exact heading Codex's PR reviewer keys on, five P0/P1 families, style-lint deliberately excluded. Depth map is a **pointer table**, since Codex's walk goes git-root→cwd and a nested file below the launch dir fires for nobody. Also lands tracked `.codex/config.toml` with **`project_doc_max_bytes = 65536`**. |
| `9c4ac2e` | **P2 — the bridge.** `CLAUDE.md` line 1 is exactly `@AGENTS.md`, **not a symlink** (index mode `100644`). The `## ⚠️ NON-NEGOTIABLE RULES` block is **kept**, deliberately. Adds the Rule-N redirect note (load-bearing for 209 references) and the Claude-only mechanism notes. `.gitattributes` pins `CLAUDE.md`/`AGENTS.md` to **LF**. |

### Two findings worth keeping

**The byte budget was fictional.** The roadmap said 22 KB, the session brief said 8–12 KB. The owner
asked whether either limit was real. **Neither was.** The only hard mechanism is Codex's
`project_doc_max_bytes` — default 32,768, drops the chain's **tail silently** — and this phase raised
it to 65,536. Anthropic's "under 200 lines" is style advice with no enforcement. The real cost of a
long instruction file is **attention dilution**, which argues for density, not for compressing law
(which the constraints forbid). Landed at **24,733 B** with ~40 KB headroom. *Write the law complete;
let size be an outcome.*

**`core.autocrlf=true` was about to break the bridge silently.** Git stores LF but wrote
`@AGENTS.md\r` into the working copy — and the working copy is what Claude Code parses. An import
path with a trailing carriage return resolves to nothing: no error, no warning, the shared law simply
would not load. Same fail-open class as a CRLF guard script, which is why `*.sh` was already pinned.
**Caught by `cat -A`, not by any test.** Now pinned in `.gitattributes`. Check `head -1 CLAUDE.md | cat -A`
after any tooling touches these files.

## What is LEFT, in order

1. **P3 — delete the `CLAUDE.md` duplicate. BLOCKED on a canary only a fresh session can run.**
   In a Claude session with real work in it, run `/compact`, then require **`UPR-L0-CANARY-7Q4M2X`**
   to still be quotable with **zero file reads**. A session that wrote the import cannot
   self-certify — a mid-session edit does not take effect until `/clear`, `/compact` or restart.
   **If the import does not survive compaction, P3 does not proceed:** the non-negotiables stay in
   `CLAUDE.md` permanently, the core becomes Codex-only, and that is recorded rather than forced.
   `docs/agent-alignment-l0-coverage.md` §5 lists exactly which blocks P3 may delete **and which it
   must not** (Claude-only routing: `How we work` item 5, Local Dev, Specialist skills, DB Client
   API, File Structure, Workers, Patterns, Task File Protocol, CRM Phase Workflow).
   Also verify the Codex side by canary + `wc -c` only — **Codex exposes no loaded-doc introspection
   and no truncation warning, so any claim of verification parity between the tools is false.**
2. **L2 — on-demand depth.** All 23 `.claude/rules/*.md` still load unconditionally
   (**213,576 B** measured 2026-07-26). Add `paths:` frontmatter — **brace-light** globs; an
   over-braced pattern is used unexpanded and silently matches nothing. Keep `database-standard.md`
   permanently **unscoped**: `paths:`-scoped rules are dropped at `/compact`, and that file carries
   the shared-production apply gate. Codex has **no** conditional-markdown mechanism — its depth is
   the `AGENTS.md` pointer table, already shipped. Prove every conversion with the
   `InstructionsLoaded` hook + `/context` in a **fresh** session.
3. **Extend coverage from 7 of 39 capabilities** to all (24 Claude skills + 15 subagents). **Cut the
   roster before porting** — both tools silently truncate discovery lists, so some capabilities are
   already invisible to implicit matching. 30 of 33 `.codex/agents/*.toml` remain ungoverned and
   inherit the parent sandbox.
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
- Never weaken a non-negotiable or a `.claude/rules/` standard while harmonising. Where the tools
  disagree the **stricter** side wins and the conflict goes to the owner.
- Do not renumber rules 1–12 (209 live references). They are now verbatim in **both** files.
- Rules changes are **disclosed amendments** — strike in place with `superseded-by:`.
- `CLAUDE.md` Rules 4 and 6 stay **as written**.
- Commit/push is authorized for this initiative's own docs/config on `dev`. Migration apply,
  credential changes, provider actions and flag flips are **not**.

## Owner decisions still open

Full ledger: `docs/agent-alignment-roadmap.md` §10. **Still blocking:**

- **CAP-SEC-001 — dated.** Tracked `.claude/settings.local.json`: 121 allow entries, no `deny` key,
  plus a live cleartext Encircle bearer token. Validator waiver **expires 2026-08-06**. The 121
  pre-approvals are a deliberate, valuable overnight-autonomy capability — **preserve them**; move
  them out of the tracked file and make the backstops real. Rotating the credential is owner-only.
- **#4** SEO trees — 31 skills + 18 agents live for Codex, retired for Claude. Recommendation:
  tracked quarantine outside every discovery root.
- **#5** authorize committing `.agents/` / `.codex/` (584 files). **Fix then track** — never track
  first. *Partially advanced:* `.codex/config.toml` is now tracked (4 → 5 tracked `.codex` files).
- **#8** CI ownership for the invariant guard.

## Verification

```bash
git fetch && git log --oneline origin/dev -5     # the repo moves; rebase first
head -1 CLAUDE.md | cat -A                       # expect: @AGENTS.md$   (NO ^M)
test -L CLAUDE.md; git ls-files -s CLAUDE.md     # expect: not a symlink, mode 100644
grep -ro "UPR-L0-CANARY-7Q4M2X" . | wc -l        # expect: 1
npm run check:tooling-generated                  # expect: 18 generated file(s) current
npm run validate:tooling                         # expect: 0 errors, 2 warnings (CAP-SEC-001/GOV-001)
npm run test:tooling                             # expect: 15/15
node --test scripts/block-destructive-sql.node-test.mjs   # expect: pass, 0 fail
npm run build && npm test                        # expect: clean, 92/92
```

**Gates that are ACTIVE and will bite:** `apply_migration` without a `ROLLBACK` section is refused;
unfiltered `upr_update`/`upr_delete`/`upr_upsert` refused; `GRANT … TO anon`, `DROP CONSTRAINT`,
`ALTER COLUMN SET NOT NULL` refused.

## Hazards

- **A parallel session edits the MAIN working tree.** At session-4 start it held ~14 modified
  `.agents/` + `.claude/` files and ~40 untracked skill dirs. Stage by **explicit path**, never
  `git add -A`.
- **Do not `git checkout --` a file with uncommitted work.** Session 4 lost both edits that way while
  renormalising line endings, and had to rewrite them. Commit first, or copy aside.
- Several `.claude/**` files show as modified with an **empty diff** — line-ending churn only. Leave
  them; do not stage them.
- **`codex/mobile-pwa-readiness-foundation` will conflict.** It adds a "Mobile PWA and Capacitor
  production-readiness program" section to the OLD `AGENTS.md` (`7aa4b0c`, `010f265`) and its own
  `.codex/config.toml` (`db0ae49`, `[agents]` block — already folded into the tracked one). Whoever
  merges it re-applies that section to the new structure; it is additive and belongs under the depth
  map.
- **Two Claude Code installations exist.** Resolve the binary explicitly for any version assertion.
- `jq` is **not installed.** Parse hook payloads with node.
- Live MCP server ids are hashed UUIDs, so every `mcp__UPR_MCP__*` / `mcp__Supabase__*` permission
  rule — allow **and** deny — matches nothing. Regex hook matchers are the only gate that fires.

## Standing facts worth not rediscovering

- Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`. The bridge is the `@AGENTS.md` import. **Never
  a symlink** — `core.symlinks=false` checks it out as a text file containing the literal string.
- Codex caps the `AGENTS.md` chain at `project_doc_max_bytes` and drops the **tail** silently. Now
  65,536 via tracked `.codex/config.toml`. Treat the cap as COMBINED (two vendor pages disagree; the
  stricter reading binds).
- **Exit 1 is non-blocking in both tools.** Only exit 2 blocks. A guard that dies under `set -e`, is
  unresolvable (127), or is CRLF-broken silently **permits**.
- On win32 **Codex sandboxes natively and Claude cannot sandbox at all.** Never list sandboxing as a
  Claude-side control on this platform.
- A mid-session edit to `CLAUDE.md`/`AGENTS.md`/a `SKILL.md`/a settings file **does not take effect
  until `/clear`, `/compact` or restart.** Never report "rule updated and followed" from one session.
- Claude skill precedence is managed > user > **project**, so `~/.claude/skills/<name>` silently
  shadows the repo copy. `.claude/commands/` and skills are one merged namespace.
- `.claude` is a Claude **protected path**: edits prompt, and `permissions.allow` cannot pre-approve
  them. Phases touching many rules files cannot run headless.

## The process lesson — still applies

Session 3's lesson held up: **search unmerged branches before designing.** Session 4 ran
`git branch -a --no-merged dev` first and found no L0/L1 attempt — but did find the `.codex/config.toml`
draft and the mobile-readiness `AGENTS.md` section, both reused rather than reinvented.

## Opening prompt for session 5

> Continue the agent-instruction alignment initiative. Read
> `docs/handoff/agent-alignment-session-4-handoff.md` first, then
> `docs/agent-alignment-l0-coverage.md` §5 and `docs/agent-runtime-reference.md`.
> `git fetch` and check `origin/dev` before trusting any number.
>
> **Start with the P3 canary, and do it before anything else fills the context:** with real work in
> the session, run `/compact`, then try to quote `UPR-L0-CANARY-7Q4M2X` with zero file reads. If it
> survives, delete the `CLAUDE.md` non-negotiables duplicate per coverage §5 — deleting only the
> blocks listed as safe. If it does not survive, record that and stop; the duplicate stays forever.
> Then move to L2 (`paths:` frontmatter, brace-light, `database-standard.md` stays unscoped).
>
> Docs and agent-configuration only. Stage by explicit path — another session shares this tree.
