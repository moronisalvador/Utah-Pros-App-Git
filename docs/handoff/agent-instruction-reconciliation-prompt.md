<!--
FILE: docs/handoff/agent-instruction-reconciliation-prompt.md

WHAT THIS DOES (plain language):
  A ready-to-paste prompt for a fresh session whose only job is to make Claude Code and
  OpenAI Codex work from the same rules on this repo, so the two tools stop drifting
  apart and both update the right files when they finish work.

DEPENDS ON:
  Internal: CLAUDE.md, AGENTS.md, README.md, .claude/rules/**, docs/upr-build-fix-backlog.md
  Data:     reads → documentation, source, Git metadata
            writes → documentation only

NOTES / GOTCHAS:
  - Findings in §"Verified findings" were checked live on 2026-07-26. Re-verify, don't re-derive.
  - This is a DOCS-ONLY task. It changes no application code, schema, or live state.
-->

# Handoff prompt — Agent-instruction reconciliation (Claude Code ⇄ Codex)

**Created:** 2026-07-26 · **Backlog ref:** `docs/upr-build-fix-backlog.md` item 1.6 · **Size:** S–M

Paste everything from `You are reconciling…` onward into a fresh session.

---

You are reconciling the **agent-instruction layer** of the UPR Platform repo
(`moronisalvador/Utah-Pros-App-Git`) so that **Claude Code and OpenAI Codex work from the same
rules, don't conflict, and both update the correct files when work is finished.**

Both tools are actively used on this repo, often concurrently, on the same shared Supabase project.
Today their instruction files are integrated **one-directionally**, and the numbered-rule system they
both cite has measurable drift.

**This is a documentation and governance task. It changes no application code, no schema, and no
live state.**

## Verified findings — checked live 2026-07-26; re-verify, don't re-derive

1. **The integration is one-directional.**
   - `AGENTS.md:10` instructs Codex: *"Read `CLAUDE.md` completely. Its non-negotiable rules and
     workflow apply to Codex too."*
   - `CLAUDE.md` mentions `AGENTS.md` **zero times** and does not auto-load it.
   - Net: Codex reads both files. Claude reads one.

2. **`AGENTS.md` holds a document-precedence ladder that `CLAUDE.md` lacks.**
   `AGENTS.md:19-27` defines: current user instruction → `CLAUDE.md` non-negotiables +
   `.claude/rules/` → current initiative roadmap/ownership manifest → canonical `docs/*.md` +
   `UPR-Web-Context.md` → focused domain handoffs → older plans/archived audits.
   `CLAUDE.md`'s only precedence section (`:213`) governs **skills** (vendor vs UPR-native), not
   documents. The ladder is what resolves "the roadmap says X but the ownership manifest says Y" —
   a conflict that recurred across the 2026-07 sessions.

3. **Numbered-rule drift is real and large.** `CLAUDE.md` defines non-negotiable rules **1–12**.
   The repo contains **~1,178 cross-references** to rules by number, including references to rules
   that no longer exist: **19× "rule 14"**, **10× "rule 13"**, and one each of **15, 16, 17**.
   Confirmed example: `.claude/rules/documentation-standard.md:1` says *"Linked from `CLAUDE.md`
   rule 14"*; the Documentation Standard is actually **rule 12** today.
   Reference density: rule 2 (217×), rule 7 (204×), rule 9 (199×), rule 4 (187×).

4. **Rule-loading is asymmetric.** Every `.claude/rules/*.md` is auto-loaded into a Claude session.
   `AGENTS.md:11` tells Codex to read *"the `.claude/rules/` documents relevant to the files and
   behavior in scope"* — i.e. selectively, on demand. Claude always has all of them; Codex may have
   a subset. Decide whether that asymmetry is intended, and make it explicit either way.

5. **Three orientation pointers exist only in `README.md`**, absent from `CLAUDE.md`:
   `.dev.vars.example` (worker-side local secrets; `CLAUDE.md` documents only `.env.example`),
   `docs/database/` (three plain-English guides: `how-the-data-model-works.md`, `glossary.md`,
   `adding-a-table-rpc-or-policy.md`), and `db/baseline/` + `scripts/db-drift-check.mjs`.
   All three verified present on disk.

6. **A "derive it, don't trust memory" command derives the wrong number.** `CLAUDE.md` gives
   `ls functions/api/*.js | wc -l` for the worker count. It returns **141** because it counts
   `.test.js` files. The real count is **91**. `README.md` separately says "58+", also wrong.

7. **Four govern-layer docs are unreferenced from `CLAUDE.md`** and aren't tied to an initiative, so
   the task-table's generic `docs/*-roadmap.md` pattern doesn't reach them:
   `docs/tooling-governance.md`, `docs/upr-figma-governance-and-handoff.md`,
   `docs/upr-engineering-foundation-roadmap.md` + `-dispatch.md`.
   (`docs/upr-unfinished-work-registry.md` **is** reachable — via
   `.claude/rules/upr-engineering-foundation-wave-ownership.md`, which auto-loads. Leave that path
   intact.)

8. **Five `AGENTS.md` sections have NOT been diffed against `CLAUDE.md`** and may contain
   Codex-only law: `Security review checklist`, `Testing and verification`, `Definition of done`,
   `Conversation boundaries`, `Areas requiring extra caution`. A definition-of-done or security
   checklist binding one tool and not the other is the highest-value thing you may find.

## Your tasks

**Task 1 — Section-by-section diff (do first, report before changing anything).**
Diff all 13 `AGENTS.md` sections against `CLAUDE.md` + `.claude/rules/**`. For each, classify:
`duplicate` / `Codex-only` / `Claude-only` / `conflicting`. **Stop and share this table before
editing.** Conflicts are the finding that matters; do not silently resolve one by deleting the other.

**Task 2 — Decide and document the ownership model.** Propose one, with reasoning:
- (a) `CLAUDE.md` is the single source of law; `AGENTS.md` shrinks to a Codex-specific routing shim
  that points at it (closest to today's stated intent), or
- (b) a shared neutral core both files include by reference, each keeping only tool-specific routing.

Recommend one. Do not implement until the owner picks.

**Task 3 — Close the one-directional gap.** Add an `AGENTS.md` pointer to `CLAUDE.md` and fold in
the document-precedence ladder (finding 2), so both tools resolve document conflicts identically.

**Task 4 — Fix the numbered-rule drift.**
- **Do NOT renumber rules 1–12.** ~1,100 live references depend on the current numbers; renumbering
  would silently invalidate them repo-wide.
- Find every dangling reference (13–17) and repoint it to the correct current rule. Verify each
  target by reading the rule, not by assuming `14 → 12`.
- Propose a convention that prevents recurrence (e.g. stable slugs alongside numbers). Recommend;
  don't unilaterally restructure.

**Task 5 — One shared "definition of done".** The owner's explicit requirement: *both tools must
update the correct files after work is done.* Today `CLAUDE.md` Rule 9 (update `UPR-Web-Context.md`),
`.claude/rules/close-out-standard.md`, and `AGENTS.md`'s `Documentation duties` + `Definition of
done` all describe this separately. Produce **one** close-out contract both tools cite, covering:
which docs get updated for which change type, `Last-verified` stamp bumps, migration provenance
mapping, and roadmap/registry checkbox reconciliation in both directions. Prefer extending
`close-out-standard.md` (already law, already auto-loaded) over inventing a new file.

**Task 6 — Orientation pointers.** Add findings 5 and 7 to `CLAUDE.md`. Fix the worker-count command
(finding 6) in `CLAUDE.md`, and the stale "58+" in `README.md`. Keep `README.md` human-facing — do
**not** turn it into a second mandatory agent read; anything an agent must know belongs in the
auto-loaded file.

## Constraints

- **Docs only.** No changes to `src/`, `functions/`, `supabase/`, or any live/external state.
- **`.claude/rules/*.md` are project law.** You may fix a broken cross-reference and bump a
  `Last-verified` stamp. Any substantive change to a rule is a **disclosed amendment** — strike the
  old text in place with a `superseded-by:` pointer per `documentation-standard.md`; never silently
  rewrite. Preserve history.
- **Do not weaken any non-negotiable or standard** while "harmonizing." If the two tools genuinely
  disagree on a rule, surface it for the owner — the stricter one is the default, not the average.
- **Do not touch active ownership manifests' scope assignments.** Several initiatives are mid-flight;
  a manifest's file-ownership matrix is a live contract between sessions.
- **Do not commit, push, or open a PR** unless the owner explicitly asks. Finish with the diff and
  the report.
- No secrets in chat or commits; don't spell the service-role env-var name in prose (a hook blocks it).

## Read first

`CLAUDE.md` · `AGENTS.md` · `README.md` · `.claude/rules/documentation-standard.md` ·
`.claude/rules/close-out-standard.md` · `docs/tooling-governance.md` ·
`docs/upr-build-fix-backlog.md` (§0 lists five registry rows already known stale — don't re-derive
those)

## Close-out

Report the Task-1 diff table, the Task-2 recommendation, every file changed and why, and every
dangling rule reference found and repointed. Per repo law: report **actual** results, never
expected; say plainly what you skipped and why. `npx eslint` is not meaningful for a docs-only
change — say so rather than fabricating a green run.
