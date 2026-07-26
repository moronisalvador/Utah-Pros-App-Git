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

> **THIS IS THE CURRENT BATON.** `docs/handoff/agent-alignment-session-2-handoff.md` and
> `-session-3-handoff.md` are superseded — the routing glob
> `agent-alignment-session-*-handoff.md` matches all three, so check you opened this one.

**Written:** 2026-07-26 · **Base:** `origin/dev` at `1ac8914`, session-4 work starts at `6505402`.
Pushed to `dev`, no open branch. For the current tip (this file cannot cite a commit it precedes):

```bash
git log --oneline 1ac8914..origin/dev
```

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
| `9c4ac2e` | **P2 — the bridge.** `CLAUDE.md` line 1 is exactly `@AGENTS.md`, **not a symlink** (index mode `100644`). The `## ⚠️ NON-NEGOTIABLE RULES` block is **kept**, deliberately. Adds the Rule-N redirect note (load-bearing for the 170 tracked "Rule N" references) and the Claude-only mechanism notes. `.gitattributes` pins `CLAUDE.md`/`AGENTS.md` to **LF**. |

### Two findings worth keeping

**The byte budget was fictional.** The roadmap said 22 KB, the session brief said 8–12 KB. The owner
asked whether either limit was real. **Neither was.** The only hard mechanism is Codex's
`project_doc_max_bytes` — default 32,768, drops the chain's **tail silently** — and this phase raised
it to 65,536. Anthropic's "under 200 lines" is style advice with no enforcement. The real cost of a
long instruction file is **attention dilution**, which argues for density, not for compressing law
(which the constraints forbid). Landed at **25,325 B** with ~40 KB headroom. *Write the law complete;
let size be an outcome.*

**`core.autocrlf=true` was about to break the bridge silently.** Git stores LF but wrote
`@AGENTS.md\r` into the working copy — and the working copy is what Claude Code parses. An import
path with a trailing carriage return resolves to nothing: no error, no warning, the shared law simply
would not load. Same fail-open class as a CRLF guard script, which is why `*.sh` was already pinned.
**Caught by `cat -A`, not by any test.** Now pinned in `.gitattributes`. Check `head -1 CLAUDE.md | cat -A`
after any tooling touches these files.

## What is LEFT, in order

1. **P3 — delete the `CLAUDE.md` duplicate. BLOCKED on a canary only a fresh session can run.**
   In a Claude session with real work in it, run `/compact`, then require **the anchor token in
   `AGENTS.md` §Authority** to still be quotable with **zero file reads**. A session that wrote the
   import cannot self-certify — a mid-session edit does not take effect until `/clear`, `/compact` or
   restart. **The literal token appears in exactly one file on purpose.** Do not paste it into this
   handoff, the roadmap or the coverage doc: a session told to read the handoff first would then be
   able to quote it without the import ever loading, which silently turns a failing canary into a
   passing one. Session 4 made that mistake and reverted it.
   **If the import does not survive compaction, P3 does not proceed:** the non-negotiables stay in
   `CLAUDE.md` permanently, the core becomes Codex-only, and that is recorded rather than forced.
   `docs/agent-alignment-l0-coverage.md` §5 lists exactly which blocks P3 may delete **and which it
   must not** (Claude-only routing: `How we work` item 5, Local Dev, Specialist skills, DB Client
   API, File Structure, Workers, Patterns, Task File Protocol, CRM Phase Workflow).
   Also verify the Codex side by canary + `wc -c` only — **Codex exposes no loaded-doc introspection
   and no truncation warning, so any claim of verification parity between the tools is false.**

   **Run `node scripts/check-l0-bridge.mjs` before and after the deletion** — 14 checks, exits 1 on
   failure, passes in both the pre- and post-P3 shapes. It replaces every gate session 4 ran by hand.
   **Known trap it exists to catch:** `## ⚠️ NON-NEGOTIABLE RULES` appears **twice** in `CLAUDE.md`
   — once in the redirect prose, once as the real heading — so a naive find-and-delete removes the
   `### Claude-only mechanisms` block too. Anchor on `/^## ⚠️ NON-NEGOTIABLE RULES$/m`.
2. **L2 — on-demand depth.** All 23 `.claude/rules/*.md` still load unconditionally
   (**213,576 B**, `cat .claude/rules/*.md | wc -c`, measured 2026-07-26 — the roadmap and ownership
   §10.4 both say 212,822 B, which is the older "before" figure; the files have grown). Add `paths:`
   frontmatter — **brace-light** globs; an
   over-braced pattern is used unexpanded and silently matches nothing. Keep `database-standard.md`
   permanently **unscoped**: `paths:`-scoped rules are dropped at `/compact`, and that file carries
   the shared-production apply gate. Codex has **no** conditional-markdown mechanism — its depth is
   the `AGENTS.md` pointer table, already shipped. Prove every conversion with the
   `InstructionsLoaded` hook + `/context` in a **fresh** session.
3. **Extend coverage from 7 of 39 capabilities** to all (24 Claude skills + 15 subagents). **Cut the
   roster before porting** — both tools silently truncate discovery lists, so some capabilities are
   already invisible to implicit matching. **12 of 15** `.codex/agents/*.toml` remain ungoverned and
   inherit the parent sandbox. (Corrected 2026-07-26: the 30-of-33 figure predates the owner-run SEO
   deletion, which removed 18 `seo*.toml`. Verify with
   `ls .codex/agents/*.toml | wc -l` and `grep -l sandbox_mode .codex/agents/*.toml | wc -l`.)
4. **The remaining gates — mostly closed by `76a0dff` while session 4 was running.** `.env` denies
   and the MCP denies are in. `apply_migration` is **`permissions.ask`**, not deny: deny blocked an
   explicitly owner-authorized apply, which is stricter than `database-standard.md` §0 intends.
   Free-form SQL (`execute_sql`, `exec_read_sql`, `upr_sql`) **stays denied** — guarded path asks,
   unguarded paths deny. **This supersedes challenge finding S-4's "both or neither"**, which only
   applied while `apply_migration` was both pre-approved *and* unguarded; it is now neither.
   **Still open:** a ref-parsing `never-push-main` PreToolUse hook — the enumerated denies are belt
   only (they cannot carry exceptions, and a bare `["git","push"]` Codex prefix rule never matches
   `git push $BRANCH`).
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
- Do not renumber rules 1–12. They are now verbatim in **both** files. **The long-quoted "209 live
  references" is wrong** — re-measured 2026-07-26 as **170 across 56 tracked files**
  (`git grep -ohE '\bRules? [0-9]+\b' -- '*.md' | wc -l`). Earlier counts were inflated by full repo
  copies under `.claude/worktrees/`; use `git grep`, which respects the index, not `grep -r`.
- Rules changes are **disclosed amendments** — strike in place with `superseded-by:`.
- `CLAUDE.md` Rules 4 and 6 stay **as written**.
- Commit/push is authorized for this initiative's own docs/config on `dev`. Migration apply,
  credential changes, provider actions and flag flips are **not**.

## Owner decisions still open

**Read `docs/agent-alignment-ownership-DRAFT.md` §10 — it is now the live ledger.** A parallel session
(`76a0dff`) closed five gates on 2026-07-26; the session-3 baton's list is stale. **Closed:** #4 (SEO
trees **deleted**, not quarantined — 31 `.agents/skills/seo*` + 18 `.codex/agents/seo*.toml`,
recoverable via `ff76e01`); #5 (**do NOT commit the mirrors** — tracking ~345 stale hand-copies would
commit the drift problem; track renderer output only); #8 (CI ownership **dissolved** — `ci.yml`
already runs `validate:tooling`, so **do not edit `ci.yml`**; new invariants go inside
`scripts/validate-tooling-governance.mjs`); #15 (Rules 4/6 unchanged); #20 (no WSL2).

**Still blocking — CAP-SEC-001, repo half done, live half owner-gated.**
`.claude/settings.local.json` is now **untracked** (`b075007`), so the 121 pre-approvals and overnight
autonomy are intact on disk. The credential rotation needs **two gates in this order** — rotating
first is wrong because there is nowhere sanctioned to put the new key until the card renders:
1. apply `supabase/migrations/20260723_encircle_managed_credentials.sql` (reviewed, provenance clean
   `4799feb`, rollback present, verified **not** in the live ledger, and the hardened guard allows it);
2. flip `feature:encircle_managed_credentials` (seeded `false`; `Integrations.jsx:1074` gates the card).

Then rotate and paste. The validator's `secret-bearing-permission` warning clearing is the **only**
reliable signal the rotation took. Waiver expires **2026-08-06**. Owner-only.

**Owner/CLI-only empirical tests still uncaptured:** E1 byte-cap shape, E2 whether a local
`codex review` honours `## Code Review Rules`, E3 unscoped rules inside subagents, the Codex sandbox
effect test, and a `/context` token baseline. **No token-cost claim may be made until that capture
exists.** E2 now has something real to test against — this session shipped the section.

## Verification

```bash
git fetch && git log --oneline origin/dev -5     # the repo moves; rebase first
head -1 CLAUDE.md | cat -A                       # expect: @AGENTS.md$   (NO ^M)
test -L CLAUDE.md; git ls-files -s CLAUDE.md     # expect: not a symlink, mode 100644
git grep -c UPR-L0-CANARY -- "*.md"          # expect: AGENTS.md:1 and nothing else
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
- **SUPERSEDED 2026-07-26 (`76a0dff`), settled empirically:** the long-repeated claim that permission
  rules cannot reach the MCP tools is **wrong for the wildcard form**. **`mcp__*__<tool>` DOES match
  the hashed server id — it blocked a real call.** What remains true is that a rule naming a
  *literal* server (`mcp__UPR_MCP__*`, `mcp__Supabase__*`) matches nothing, because the live ids are
  hashed UUIDs. Write `mcp__*__<tool>`, never the literal server name. Any note still saying
  permission rules are useless against MCP tools is stale — fix it where you find it.

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

> Continue the agent-instruction alignment initiative on the UPR Platform.
>
> **Before you read anything, answer this from context alone: is there a token in your context
> matching `UPR-L0-CANARY-<something>`? Quote it, or say plainly that you cannot see one.**
> Do not open, read, grep or search `AGENTS.md` to answer — that destroys the test. This is the
> load-verification canary: it lives only in `AGENTS.md`, which `CLAUDE.md` pulls in via an
> `@AGENTS.md` import on line 1. If you can quote it, the import loaded at session start.
>
> Then read `docs/handoff/agent-alignment-session-4-handoff.md`, and
> `docs/agent-alignment-l0-coverage.md` §5. `git fetch` and check `origin/dev` first — the repo moves
> under you, and several parallel sessions are landing commits.
>
> **The gate for P3 is the SECOND half of that test.** Do real work first, run `/compact`, then try
> to quote the token again with zero file reads. Surviving `/compact` is what proves the import is
> durable, because `paths:`-scoped and nested instruction files are dropped at compaction.
> - **If it survives:** delete the duplicated non-negotiables from `CLAUDE.md` per coverage §5 —
>   only the blocks listed as safe, and anchor on `/^## ⚠️ NON-NEGOTIABLE RULES$/m` because that
>   string also appears in the redirect prose above it. Run `node scripts/check-l0-bridge.mjs`
>   before and after; it must stay 14/14.
> - **If it does not survive:** record that outcome and stop. The duplicate stays in `CLAUDE.md`
>   permanently and the shared core becomes Codex-only. Do not force it.
>
> Then move to L2: `paths:` frontmatter on `.claude/rules/*.md`, brace-light globs (an over-braced
> pattern silently matches nothing), and `database-standard.md` stays permanently unscoped.
>
> Docs and agent-configuration only — no `src/`, `functions/`, `supabase/`, `ios/`, no migration, no
> live or provider state. Stage by explicit path, never `git add -A`; another session shares this
> working tree and has ~48 uncommitted files in it.
