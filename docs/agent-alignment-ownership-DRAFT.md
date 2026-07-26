<!--
════════════════════════════════════════════════
FILE: agent-alignment-ownership-DRAFT.md
════════════════════════════════════════════════

WHAT THIS DOES (plain language):
  This says who is allowed to change which file during the agent-instruction
  alignment work, so that two sessions working at the same time cannot edit the
  same thing and break each other. It also lists the files nobody in this work
  may touch at all.

WHERE IT LIVES:
  Deliberately under docs/, NOT in .claude/rules/. Two reasons: .claude/rules/
  is project law that auto-loads into every session, and .claude is a protected
  path. A draft must not read as law. The owner promotes this file after review.

DEPENDS ON:
  Internal:  docs/agent-alignment-roadmap.md (plan of record),
             docs/agent-alignment-dispatch.md (launch blocks),
             docs/tooling-governance.md, .claude/rules/close-out-standard.md,
             .claude/rules/documentation-standard.md
  Data:      reads → none · writes → none

NOTES / GOTCHAS:
  - DRAFT. Binding on nobody until the owner explicitly adopts it. It grants no
    authority to edit code, apply migrations, change live systems, commit, push,
    deploy, or open a PR.
  - Where the roadmap prose and this file disagree on a NAME or a PATH, this file
    is intended to be authoritative once adopted. The roadmap remains
    authoritative on intent.
════════════════════════════════════════════════
-->

# Agent Instruction Alignment — File & Contract Ownership Manifest (**DRAFT**)

> **⚠️ DRAFT FOR OWNER REVIEW.** This is a planning artifact, not binding project law. It grants no authority to edit code, apply migrations, change live systems, commit, push, deploy, or open a PR. **It deliberately sits under `docs/` rather than `.claude/rules/`** — see the header note. On promotion, the owner moves it to `.claude/rules/agent-alignment-wave-ownership.md` and it becomes binding from that commit forward.

**Created / last verified:** 2026-07-26 · **Slug:** `agent-alignment`
**Plan of record:** `docs/agent-alignment-roadmap.md` · **Dispatch:** `docs/agent-alignment-dispatch.md` · **Challenge report:** `docs/agent-alignment-challenge-report.md`
**Each session's read scope:** `AGENTS.md` + `CLAUDE.md` + its phase block in the roadmap + **this file** + `.claude/rules/close-out-standard.md` + `.claude/rules/documentation-standard.md` + `docs/tooling-governance.md`. **Not** all 23 rules files — that would reproduce the problem this initiative exists to fix.

**Once adopted: where the roadmap prose and this manifest disagree on a name or a path, this manifest is authoritative.** The roadmap stays authoritative on intent and on acceptance criteria.

---

## §0 Isolation statement

**Isolation in this initiative is not the branch.** It is (a) the file-ownership split in §2 and (b) the deferred-hardening bucket in §8, keyed to in-flight merges rather than to dates.

**There is no feature flag.** The instruction layer has no runtime gate — a rules file either loads or it does not, and there is no `page:` flag to hide a half-migrated law layer behind. So the insurance is threefold: `git revert` (never a Claude checkpoint — see §7); the ordering discipline that **every phase leaves the law layer complete at every commit boundary**; and the reviewer gauntlet.

**That ordering discipline is the whole safety argument and it inverts the intuitive plan.** Safety-critical law may never be transiently unenforced. Therefore the L0 core is authored **additively** while all 23 rules stay unconditional (P1); the `CLAUDE.md` duplicate is deleted only after the import is proved to survive `/compact` (P3); and mixed-content rules files are scoped **one at a time**, each only after its own safety fragment demonstrably loads from the shared core (P9). **Batching is forbidden, and there is no way to make a batched conversion of a mixed file safe.**

**Rollback fails toward duplication, never toward absence.** Reverting P1 leaves law in `CLAUDE.md`; reverting P3 puts it in both places; reverting a `paths:` block returns a rule to unconditional loading. The one sequence that would leave law unenforced is reverting an L0 fragment while a depth file is still scoped — so **the rollback order is fixed: un-scope first, and only then consider touching L0.**

---

## §1 Frozen — grouped by why

### Group A — Plan-of-record docs: CONSUMED, never re-authored

`docs/agent-alignment-roadmap.md`, `docs/agent-alignment-dispatch.md`, this file, `docs/agent-alignment-challenge-report.md`, `.claude/rules/close-out-standard.md`, `.claude/rules/documentation-standard.md`, `docs/tooling-governance.md`.

A session updates **only its own phase's checkboxes or status line** in the roadmap, and nothing else in these files — except where §2 assigns it a specific amendment (P15/P17 on `close-out-standard.md`, P6/P12 on `tooling-governance.md`, P8 on `documentation-standard.md`'s one dangling pointer).

**If any Group A file is not on disk, your base is wrong.** Re-sync from `origin/dev` per the dispatch Base Preflight. **Do NOT recreate them** and do not run a branch-reset recipe. This clause exists because a prior initiative's Foundation phase branched from `main`, never saw its plan, and re-authored divergent copies of its roadmap, manifest and rulebook. This initiative's blast radius is the same law layer.

### Group B — Held by live writers (the deferred-hardening set — see §8)

`.claude/rules/messaging-transport-wave-ownership.md`, `.claude/rules/tech-messages-v2-wave-ownership.md`, `.claude/rules/omni-inbox-wave-ownership.md`, and `.github/workflows/ci.yml` + `package.json` pending owner decision #8.

### Group C — Every ACTIVE ownership manifest's ownership matrix — frozen absolutely

No phase in this initiative edits the §2 matrix of any other manifest. Several initiatives are mid-flight and those matrices are live contracts between concurrent sessions. **This is the hardest freeze in the initiative.** Adding `paths:` frontmatter to a manifest changes *when the file loads*, not *what it says*, and is therefore not a matrix edit — but the distinction must be visible in the diff (`git diff` showing only frontmatter, a stamp line and HTML comments).

### Group D — Code and schema: entirely out of scope

`src/**`, `functions/**`, `supabase/**`, `ios/**`, `email-worker/**`, `upr-mcp/**`, `db/**`, and every file under `supabase/migrations/`. **This initiative ships ZERO migrations** (§4). `package-lock.json` is frozen — this plan adds only `package.json` script keys and no dependency, so no lockfile change is required or permitted.

### Group E — `CLAUDE.md` rule numbering, and Rules 4 and 6 as written

Rules **1–12** and their numbering are frozen (209 live tracked references). New references use the stable `[rule:<slug>]` tokens P1 adds; the numbers remain the compatibility surface forever, and the slug set is append-only.

**Rules 4 and 6 are mirrored verbatim.** Both were explicit owner decisions with recorded rationale. Any change is a **proposal with the original rationale attached** (roadmap ledger #15), never planned as decided. P6's publish gate enforces a clause **Rule 4 already states** and does not narrow it — which is why the non-blocking proof for `git push origin dev` is a named acceptance criterion rather than an assumption.

### Group F — Shared surface consumed, never edited in-wave

`.claude/settings.local.json` (owner decision #6 — an existing gate; **read and report, never edit**), `src/lib/*`, `functions/lib/*`, `.claude/rules/database-standard.md`'s **body** (P9 adds no frontmatter to it and changes no text), `src/index.css`, `UPR-Web-Context.md` except its Rule 9 session entry.

---

## §2 Ownership matrix

One writer per file, per commit. The `Live state` column reads `none` in every row, by design.

| Session | Phase | Owns exclusively (edit only these) | Live state |
|---|---|---|---|
| **P0** | Capability floor | `docs/audit/2026-07/evidence/agent-capability-floor.md`; `scripts/qa/capability-floor.mjs` + `.node-test.mjs`; `docs/handoff/tooling-upgrade-decision.md`; one `package.json` script key | none |
| **P1** | L0 core | **`AGENTS.md`** (sole owner of its content for the whole initiative) | none |
| **P2** | Bridge | **`CLAUDE.md`** line 1 + the redirect line + the Claude-only mechanism notes; the `AGENTS.md` canary token only | none |
| **P3** | Duplicate deletion | **`CLAUDE.md`** deletions only, block-by-block against P1's coverage table | none |
| **P4** | Routing + permissions | **`.codex/config.toml`** (net-new, sole owner); **all `.claude/settings.json` `permissions` edits** for this initiative; two `.gitignore` lines | none |
| **P5** | Guard single-sourcing | `.claude/hooks/block-secrets.sh`, `.claude/hooks/block-destructive-sql.sh`, **`.codex/hooks.json`**, `.codex/hooks/**`, `.gitattributes`, the `hooks` block of `.claude/settings.json`, `scripts/agent-hooks/{run-gate-probes,check-codex-hook-trust}.mjs` + fixtures | none |
| **P6** | Publish/apply gates | `.claude/hooks/block-branch-publish.sh` (**the only publish gate**); `scripts/agent-hooks/block-branch-publish.node-test.mjs`; **`.codex/rules/upr.rules`** (net-new); the enumerated push-to-main denies; `docs/tooling-governance.md` **§8 addendum only** | none |
| **P7** | Instrumentation | the `InstructionsLoaded` block in `.claude/settings.json`; `scripts/agents/{log-instructions-loaded.sh,verify-rule-globs.mjs,check-memory-ancestors.sh}`; `docs/agent-alignment-l2-evidence.md`; one `.gitignore` line; the temporary `.claude/rules/zz-probe.md` (**deleted before handoff**) | none |
| **P8** | Reference-depth scoping | `paths:` frontmatter + stamps on **ten** rules files (motion-standard, page-lifecycle, perf-budget, documentation-standard, tech-v2, app-store-readiness, ux-alignment, settings-overhaul, db-foundation + the `documentation-standard.md` rule-12 pointer fix); the two evictions; `docs/archive/rules/README.md` (new); `.claude/tooling-governance.json` `rules` 23→21 | none |
| **P9** | Mixed-rule splitting | `paths:` frontmatter + stamps on **seven** rules files (close-out-standard, crm-wave, sms-experience, workers-standard, upr-agent-qa-access, tech-mobile-ux, loading-error-states) + `scope-sheet-rollback.md` | none |
| **P10** | Codex depth | `docs/agent-depth-map.md`; **seven** nested `AGENTS.md` (`supabase/migrations/`, `functions/`, `src/`, `src/pages/`, `src/pages/tech/`, `src/pages/crm/`, `ios/`); `scripts/agents/check-agents-chain-bytes.mjs`. **Supplies** the condensed pointer rows to P1; does not write them | none |
| **P11** | Claude roster cut | `.claude/skills/*/SKILL.md` frontmatter **except the four dispatchers**; `.claude/agents/*.md`; the `skillOverrides` block of `.claude/settings.json`; `scripts/validate-tooling-governance.mjs` + its node-test | none |
| **P12** | Codex divergences | `.agents/skills/**` bodies; `.codex/agents/*.toml`; the 31 `.Codex/` path fixes; `docs/tooling-governance.md` **§1 amendment only** | none |
| **P13** | Adapters + tracking | `scripts/render-capability-adapters.mjs`; all **generated** `.agents/skills/*/SKILL.md`, `agents/openai.yaml`, `.codex/agents/*.toml`; the 3 ported reviewer twins; the `git add` of both trees (**separately authorized**) | none |
| **P14** | Dispatcher conformance | `.claude/skills/{masterplan,db-migration,new-feature,new-crm-module}/**` (**sole owner**); the shadow-detection check; `docs/tooling-governance.md` §2 dispatcher names; the conditional `admin-mobile-phase-reviewer` deletion + `.claude/tooling-governance.json` agents 15→14 | none |
| **P15** | Close-out mechanisation | `.claude/rules/close-out-standard.md` (**first of three writers**); `scripts/qa/{closeout-evidence,lastverified-stamps}.mjs` + node-tests; `.claude/skills/closeout/**` (new) | none |
| **P16** | Gauntlet trigger | `scripts/qa/{required-reviewers,check-review-evidence}.mjs` + node-tests; `.claude/skills/gauntlet/**` (new); `docs/qa/subagent-context-probe.md`; one CI step | none |
| **P17** | Handoff schema | `docs/handoff/{README,_TEMPLATE,agent-alignment-handoff,l0-pointer-text}.md`; `scripts/qa/validate-handoff-docs.mjs` + node-test; `.claude/rules/close-out-standard.md` **second writer, its dated handoff section only** | none |
| **P18** | Isolation model | `.claude/rules/initiative-isolation.md` (new); `docs/initiative-isolation-model.md`; `scripts/check-frozen-contracts.mjs` + node-test; `docs/generated/rpc-contract-snapshot.json`; `docs/apply-window-register.md`; **one line** in `masterplan/SKILL.md` | none |
| **P19** | CI invariant guard | `scripts/validate-agent-instruction-layer.mjs` + node-test; `scripts/agent-instruction-layer.allowlist.json`; two `package.json` script keys; **one** CI job block | none |
| **P20** | Deferred release | `paths:` frontmatter + stamps on the **three** Group B rules files, once each holder merges | none |

**Single-writer notes that are load-bearing rather than tidy.**
- **The root pair (`AGENTS.md` + `CLAUDE.md`) has exactly one owner per file per phase, never two concurrently.** P1 owns `AGENTS.md`; P2 and P3 own `CLAUDE.md` serially. P10 and P17 both *want* to add content to the root pair and are explicitly forbidden from doing so — they **supply text** for P1/P3 to install. This is the L0 analogue of the app-store manifest naming a sole owner for `project.pbxproj`, and for the same reason: co-editing it is the collision this manifest exists to prevent.
- **`.claude/settings.json` is split by key, not by file.** P4 owns `permissions`; P5 owns `hooks`; P11 owns `skillOverrides`. No phase touches another's key.
- **`.claude/rules/close-out-standard.md` has three writers in a fixed order:** P15 (item classification + Stop-hook rejection + stamp), then P17 (the dated handoff section), then P9 (frontmatter). Reordering makes each phase's diff-purity criterion unevaluable against a moving base.
- **`.claude/tooling-governance.json` `trackedInventory` has one owner per change**, sequenced per the roadmap §4 arithmetic ledger. This is the **mechanically enforced** counter; `docs/tooling-governance.md` §1's prose stamp is the human-readable twin and both change in the same commit.
- **`docs/tooling-governance.md` is split by section:** P6 owns the new §8 addendum; P12 owns the §1 amendment; P14 owns §2's dispatcher names. §§3–7 are untouched by everyone.

---

## §3 Frozen contracts — the strings a mechanical guard asserts

Change the **body** within the owning phase; never re-define these.

1. **`CLAUDE.md` line 1 is exactly `@AGENTS.md`.** Never a symlink and never a committed symlink: Git for Windows sets `core.symlinks=false`, so a committed symlink checks out as a plain text file whose entire content is the literal string `AGENTS.md`. The guard checks `fs.lstat` **and** that the file's content is not that string.
2. **Rule numbers 1–12, their order, and their headings.** Plus the `[rule:<slug>]` token set, which is append-only and must be unique.
3. **The literal heading `## Code Review Rules`** — Codex's reviewer keys on it. Placed **before** the depth map in `AGENTS.md`, and containing no lint-shaped rule (Codex surfaces only P0/P1 there, so a formatting rule placed inside would silently never fire).
4. **The `**Last verified:**` stamp spelling** — one canonical form. Three are in use today (6× `**Last verified:**`, 1× `**Last-verified:**`, 1× bare `Last-verified:`); the majority form wins.
5. **`model_instructions_file` and `experimental_instructions_file` appear NOWHERE in this repository.** They *replace* the `AGENTS.md` path rather than layering, so a stale value in any Codex config layer silently bypasses the entire L0 law.
6. **`AGENTS.override.md` and `CLAUDE.local.md` are gitignored and never tracked.** `AGENTS.override.md` wins at its own level in Codex's discovery order, so a committed one would silently outrank shared law for everyone.
7. **The guard-wrapper contract:** resolve `$CLAUDE_PROJECT_DIR` (the installed 2.1.85 bundle **does** inject it), fall back to `git rev-parse --show-toplevel`, and if the guard file is still unresolvable **print a reason to stderr and exit 2**. No `set -e`. **Exit 1 and exit 127 are NON-blocking in both tools**, so a guard that dies silently *permits* the action — and `cd src && bash ./.claude/hooks/block-secrets.sh` returns 127 today. Never emit `continue`/`stopReason`/`suppressOutput` from a Codex PreToolUse hook: those *fail* the hook and Codex then continues the tool call.
8. **`.claude/tooling-governance.json` `trackedInventory` is the file of record for capability counts**, compared by exact equality against `git ls-files`.
9. **The `sendAutomatedMessage` reason vocabulary** — `'sms_disabled'` and `'quiet_hours'` are load-bearing **cross-initiative** contracts. This initiative does not touch them; it lifts the *statement* of their fragility to L0, because the file documenting the constraint is scoped to one worker while the file that would break it is owned by a different initiative.
10. **`src/index.css` reserved-marker format.** Untouched by this initiative and named here only so no phase invents a competing convention.

---

## §4 Migration rule

**This initiative ships ZERO migrations and performs no live, provider, credential, or external action.** If a phase believes it needs one: **STOP and flag** for a separate reviewed change. `migration-safety-checker` and `anon-grant-auditor` are therefore declared **NOT APPLICABLE** at every close-out, **with the reason stated** rather than the line omitted.

The section number is retained so this manifest reads isomorphically to its siblings.

---

## §5 Reserved-region rule (the `index.css` marker convention, transplanted)

The house convention for one shared large file is a reserved comment marker so two phases never co-edit the same region. The direct analogue here:

- **Each phase writes only inside its reserved section of `AGENTS.md`/`CLAUDE.md`**, delimited by an HTML-comment marker. In practice §2's single-writer rule makes this belt-and-braces, but the markers make a violation visible in a diff.
- **The byte budget rides here too.** The whole `AGENTS.md` chain stays under the pinned `project_doc_max_bytes`, and **every nested `AGENTS.md` counts against the SAME budget** (treated as COMBINED — the stricter of two contradicting vendor readings — until experiment E1 settles it). Codex drops the **tail** silently, so the budget check leaves deliberate slack.
- **Provenance goes in HTML block comments**, which the Claude loader strips before injection at zero token cost. **Do not put comment-heavy provenance in `AGENTS.md`** — nothing establishes that Codex strips them, so assume Codex pays for them.

---

## §6 Artifacts the later phases consume as frozen contracts

- **From P1:** the `AGENTS.md` section order and markers; the byte budget; the `## Code Review Rules` block; the depth-map anchor P10 fills; the canary token (kept deliberately — it is load-bearing for future re-verification and its uniqueness is an asserted invariant).
- **From P4:** `.codex/config.toml`'s pinned keys, and the fact that `[features] hooks = true` is the **precondition** for every Codex hook probe. A probe run before this exists measures a switched-off layer.
- **From P5:** the fail-closed wrapper contract (§3.7) and the hook-trust check script.
- **From P7:** the `InstructionsLoaded` JSONL baseline (23 `session_start` entries + `CLAUDE.md`), the glob linter's normalise-then-match emulation, and the first `/context` capture. **Every later token claim traces to one of the three `/context` captures or is withdrawn.**
- **From P11:** the pinned description-extraction rule, so before/after budget numbers are comparable across phases.
- **From P15:** the 11-item classification tags, which P16 and P19 assert against rather than restate.

---

## §7 Close-out deltas

Per `.claude/rules/close-out-standard.md`, scoped honestly to a docs-and-config diff. **Deltas only** — this manifest does not restate that file.

1. **`npm run validate:tooling` + `npm run test:tooling` are the substantive gate** (named by `tooling-governance.md` §6), plus `validate:agent-layer` once P19 lands.
2. **`npm run build` + `npm test` still run every phase** — they gate nothing in these diffs and are run to prove **no application code was touched.**
3. **`npx eslint` is declared n/a WITH THE REASON on docs-only phases**, and **is** run and must be clean on the phases that add JavaScript (P0, P7, P11, P13, P15, P16, P17, P18, P19). Fabricating a green lint run is itself a close-out failure under the contract P15 writes.
4. **The `InstructionsLoaded` reason-flip artifact** is pasted for every L2 conversion. **A conversion producing neither a `session_start` nor a `path_glob_match` entry is a FAILED conversion — revert its frontmatter, do not ship it with a note.**
5. **`.claude/tooling-governance.json` + the `docs/tooling-governance.md` §1 prose stamp** change in the same commit as any deliberate entrypoint change, with the expected 4-tuple stated. A phase that changes nothing says so explicitly.
6. **The mid-session no-op rule.** A `CLAUDE.md`/`AGENTS.md`/`SKILL.md`/settings edit does not apply until `/clear`, `/compact` or restart. Verify in a session started **after** the edit; never report "rule updated and followed" from one session.
7. **The Codex hook-trust re-arm warning.** A repo hook is skipped until a human re-trusts its hash via `/hooks`, and **editing it re-arms the gate.** A rollback verified before re-trust proves nothing.
8. **Git is the only reliable undo.** Claude checkpoints do not track bash-made edits, do not restore subagent edits, and normally miss concurrent-session changes — and this repo dispatches heavily to subagents, applies migrations out of band, and has **23 live worktrees**. A phase's rollback is a git ref, never a checkpoint. **For the untracked `.agents/`/`.codex/` trees, git is not an undo either — the out-of-repo backup (P5 step 0) is.**
9. **Declared NOT APPLICABLE, with reasons rather than omissions:** the minimize/resume test, the 390px viewport check, the perf delta, and the motion Playwright harness — this initiative touches no page, component, or motion. `migration-safety-checker` and `anon-grant-auditor` — zero migrations, zero grant changes.
10. **Reviewer gauntlet actually used:** `upr-pattern-checker` on any `.claude` change (unconditional per §2 of the standard); `consent-path-auditor` + `worker-security-reviewer` on P9 (it moves send-path and money law); `design-consistency-checker` + `page-behavior-checker` n/a with the reason.
11. **Publish only when requested.** Every phase ends with the diff, the verification report, and its named owner gates. **No commit, push, PR, deploy, migration apply, credential change, or provider action** without a separate owner instruction — and a provider approval, a flag prerequisite, or a persistent tool permission is **not** that instruction.

---

## §8 Deferred-hardening bucket — keyed to merges, not dates

| File | Holder | Release condition |
|---|---|---|
| `.claude/rules/messaging-transport-wave-ownership.md` (15,250 B) | live writer, `codex/messaging-transport-build`, **61 uncommitted files** | that branch merges. **Convert LAST of the three** — it carries the highest-consequence law in the set (send-path invariants where a load miss can cost money and create legal exposure in the same action) and it is the busiest amender of `.claude/rules/*` in the repo |
| `.claude/rules/tech-messages-v2-wave-ownership.md` (8,766 B) | the owner-approved 2026-07-26 conversation-participant-scoping work, which names this manifest as an amendment target in its own prompt | that work merges |
| `.claude/rules/omni-inbox-wave-ownership.md` (10,573 B) | same as above | that work merges |
| `.github/workflows/ci.yml`, `package.json` | released by `upr-agent-qa-access` at its P1 close-out but reserved for a future P6, with the standing instruction "If a phase needs an unlisted file, stop and obtain ownership. Do not self-expand the phase." | owner decision #8 |

**Their globs are pre-authored and pre-linted in `docs/agent-alignment-l2-evidence.md`**, so P20 is mechanical rather than a fresh design.

**Everything else is uncontested and proceeds immediately:** 18 of the 21 surviving rules files, both root instruction files, `.claude/settings.json`, `.claude/hooks/**`, the whole `.codex/*` layer, `.claude/skills/**`, `.claude/agents/**`, `scripts/**`, and this initiative's own docs.

**A deferred file is not a forgotten file.** Every phase that skips one states the reason in prose in its report, so a held item stays visibly open.

---

## §9 Amendment transparency

Amendments are **appended as dated, numbered addenda** that quote the original rule, state the amendment, give the rationale, and record the owner approval. Never an in-place rewrite — the same discipline `documentation-standard.md` states as *"A superseded rule is struck in place with a `superseded-by:` pointer, never silently rewritten (preserves history)."*

### 9.1 — Adjudication against lane G (required before P2/P4/P7/P11 run)

**The original provision, quoted.** `.claude/rules/upr-engineering-foundation-wave-ownership.md` §3 assigns a lane **G — Governance** owning "F5a secret/permissions; F5b adapters/paths; F5c triggers/plugins; **exact `.claude` paths and evaluation tests**", and its §5 marks `Q ∥ G` and `S1 ∥ G` CONDITIONAL pending "exact CI/config/fixture/checker paths must be assigned first."

**Why this must be written down rather than assumed.** That is the pre-existing nominal owner of this initiative's entire surface. The adjudication is *cheap* — that manifest self-declares "DRAFT FOR OWNER REVIEW … not binding project law until the owner explicitly adopts it. It grants no authority", and its own §1 reports F1 and F2 complete with no active writer lease. But **skipping it is precisely how two sessions end up each believing they own `.claude/`.** Roadmap ledger #2.

**Recorded separately as a finding, not actioned here:** that 8,302 B draft **auto-loads into every Claude session today** and, by sitting in the law directory, reads as law regardless of its disclaimer — the exact inverse of this initiative's goal. Its disposition is ledger #10 and P8's second eviction.

### 9.2 — Amendment sought against `ux-alignment-wave-ownership.md` §1 (required before P11/P15/P17, and P8/P9's frontmatter on five files)

**The original provision, quoted.** §1: *"**Plan-of-record docs** (`docs/ux-quality-roadmap.md`, `docs/ux-quality-dispatch.md`, this manifest, **the five `.claude/rules/` standards docs, the checker agents**). A session updates its OWN phase's checkboxes/status; it never re-authors these."*

**What is sought:** one dated addendum authorizing (i) **frontmatter-only** `paths:` additions to the five standards docs, (ii) the two additive lines on the checker agents, and (iii) the `close-out-standard.md` dated amendment. **This manifest is an ACTIVE one** (W1–W5 planned/unstarted), so this is not a formality.

**Disclosure that made this necessary.** The adversarial pass established that **four** phases across two design lanes edit files this manifest freezes, and only one lane surfaced the freeze at all — for one file. Roadmap ledger #9. Separately worth the owner's attention: ux-alignment W1–W5 have no commits since 2026-07-18 while F-S1 (which authored these five standards) has shipped, so whether that initiative is stalled or live changes whether this addendum is a coordination note or a handover.

### 9.3 — Amendment sought against `tooling-governance.md` §1 (required before P5's Codex half, all of P12, and P13)

**The original provision, quoted.** §1: *"The tracked `.claude/` tree is the temporary canonical source … The untracked `.agents/` and `.codex/` candidate ports are not authoritative. They are not copied, promoted, deleted, edited, or validated by this initiative."*

**What is sought:** a narrow amendment permitting exactly three operations — safety-parity repair, path-contamination repair, and generated adapters — leaving "not authoritative" intact, struck in place with a `superseded-by:` pointer.

**A fourth operation is needed if P5's deletion is wanted.** As worded, the amendment covers repair and adapters; **a deletion is neither.** Either add "removal of a superseded duplicate hook body, with the original content captured in the deprecation record", or use the wrapper-in-place alternative and delete nothing. Roadmap ledger #3.

**Sequencing is part of the amendment, not an afterthought: FIX, then TRACK.** Tracking is *necessary* — a Codex cloud container checks out only committed files, so 81 capability entrypoints do not exist there and nothing reports it. But tracking as-is would publish the **unpatched vendor `supabase` skill** (which instructs the agent to iterate freely with `execute_sql` against the one shared production database), the two probably-inert hook matchers, and 30 unpinned subagents to every clone and CI runner in one commit.

### 9.4 — Ownership claim sought against `upr-agent-qa-access-ownership.md` (required before P13/P16/P18/P19's CI steps)

**The original provision, quoted.** §1 records P1 as having delivered **and released** ownership of `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `vitest.config.js` and `playwright.config.js`; §3 reserves "assigned CI/release/native QA files" for a future P6; and §3 states verbatim: *"If a phase needs an unlisted file, stop and obtain ownership. Do not self-expand the phase."*

**What is sought:** a dated addendum naming the exact additive job blocks and script keys. **This plan adds only `package.json` script keys and no dependency, so `package-lock.json` is untouched.** If declined, every guard still runs via `validate:tooling`/`test:tooling` and the close-out **says the invariant is not CI-enforced** rather than describing it as enforced. Roadmap ledger #8.

### 9.5 — Deliberate divergence from `tooling-governance.md` §7, recorded rather than hidden

**The original provision, quoted.** §7, owner-approved 2026-07-23, prefers *"one neutral instruction body using repository-root symbolic references rather than runtime-specific `.claude`/`.codex` paths."*

**Where this initiative follows it:** P13's capability adapters are exactly §7's model — thin pointers, generated, canonical body in one place.

**Where it deliberately does not, and why:** the **executable guard scripts** stay canonical in `.claude/hooks/`. `.claude` (except `.claude/worktrees`) is a Claude **protected path** where writes are prompted, denied in `dontAsk`, and — critically — **cannot be pre-approved by `permissions.allow`**, because the safety check runs before allow rules are evaluated. Moving the guard bodies to a neutral directory would let a Claude session silently edit its own secret-blocking guard. The cross-tree reference is already precedented in `.codex/hooks.json`, whose PostToolUse impeccable hook already reaches into `.claude/skills/`. Roadmap ledger #18. **For non-executable instruction bodies, §7's preference stands unchanged.**

### 9.6 — Deferred and recorded, not proposed

Collapsing the **five** initiative phase-reviewers (crm, settings, sms-experience, tech, db-foundation) into one parameterized reviewer is the largest remaining consolidation in the repository. **It is out of scope here** because each is named in its **active** ownership manifest's close-out section, so the collapse would edit live inter-session contracts — barred by Group C. Revisit as each initiative tombstones; `admin-mobile-phase-reviewer` (zero law references, manifest archived 2026-07-13) is the worked example and the one deletion this plan recommends (ledger #14).

### 9.7 — Standing rule for future amendments to this manifest

An amendment adds a numbered §9.x entry with: the quoted original, the amendment, the rationale, the owner approval, and the date. It never edits §§1–8 in place except to add a `superseded-by:` pointer beside a struck line. **If a session finds this manifest's frozen list no longer truthful, the correct action is an addendum saying so — not a silent correction.**

---

*This DRAFT binds nobody. On promotion to `.claude/rules/agent-alignment-wave-ownership.md`, it becomes binding from that commit forward, and its §§1–8 become the authority on names and paths for every session in this initiative.*

---

## §10 — Resolutions and amendments landed 2026-07-26 (owner-supervised)

Recorded so this manifest stops describing decisions as open. `origin/dev` carried 16 commits for this
initiative on 2026-07-26; the state below is what a session inherits.

### 10.1 Owner gates closed

| Gate | Resolution |
|---|---|
| **#4** SEO trees | **Deleted.** 31 `.agents/skills/seo*` bundles + 18 `.codex/agents/seo*.toml`. Amendment in `docs/tooling-governance.md` §5. Executed by the owner — the repo's `Bash(rm -rf:*)` deny correctly refused the agent. 93 SEO `SKILL.md` remain recoverable via `ff76e01`. |
| **#5** Commit `.agents`/`.codex` | **NO.** Committing ~345 stale hand-copied mirrors would commit the drift problem this initiative exists to remove. Track renderer output only; coverage grows through `tooling/`. |
| **#8** CI ownership | **Dissolved.** `ci.yml` already runs `validate:tooling`, which blocks adapter drift by itself (verified: `ERROR [generated-adapter-drift]`, exit 1). New invariants go inside `scripts/validate-tooling-governance.mjs`. **Do not edit `ci.yml`.** |
| **#15** Rules 4 and 6 | **Unchanged, verbatim.** The owner declined to re-litigate. Their internal tensions remain surfaced, not resolved. |
| **#20** WSL2 | **No.** Every gap found on 2026-07-26 was inside the tool layer, which `permissions.deny` + PreToolUse hooks cover on native Windows. Codex sandboxes natively here. The standing rule holds: never list sandboxing as a Claude-side control on win32. |

### 10.2 Permission-surface correction — `deny` was wrong for `apply_migration`

The 2026-07-26 hardening put `mcp__*__apply_migration` in `permissions.deny`. That **blocked an
explicitly owner-authorized apply**, which is stricter than `database-standard.md` §0 intends — §0
requires fresh task-specific authorization for an apply, it does not forbid one. Corrected to
`permissions.ask`.

Free-form SQL (`execute_sql`, `exec_read_sql`, `upr_sql`) **stays denied**: `upr_select` / `upr_schema`
cover legitimate reads, and `apply_migration` is the guarded path — the PreToolUse guard requires a
`ROLLBACK` section on it and refuses destructive patterns, and it produces a ledger entry. Making the
guarded path `ask` while the unguarded paths stay `deny` is the intended shape. This supersedes
challenge finding **S-4**'s "both or neither", which applied when `apply_migration` was both
pre-approved *and* unguarded.

The wildcard question is now settled empirically: **`mcp__*__<tool>` DOES match the hashed server id.**
It blocked a real call. Earlier notes recording it as unverified are superseded.

### 10.3 CAP-SEC-001 — repo half done, live half owner-gated

`.claude/settings.local.json` is **untracked** (`b075007`); it stays on disk, so the owner's 121
pre-approvals and overnight autonomy are unaffected. `.env` denies and the MCP denies above are the
shared backstop.

The credential rotation is blocked on **two** gates, in this order, and rotating first was wrong
because there is nowhere sanctioned to put the new key until the card renders:

1. Apply `supabase/migrations/20260723_encircle_managed_credentials.sql` — reviewed, provenance clean
   (`4799feb`), rollback present at `supabase/rollbacks/`, and the hardened guard **allows** it.
   Verified NOT in the live ledger.
2. Flip `feature:encircle_managed_credentials` — the migration seeds it `false`, and
   `Integrations.jsx:1074` gates the card on it. The Pages-side resolver is deployed on `dev`
   (`0a06a21`).

Then rotate, paste, and the validator's `secret-bearing-permission` warning clears. That warning
clearing is the only reliable signal the rotation took.

### 10.4 Still open, and who can close it

- **L0/L1** shared core — in flight by another session; `CLAUDE.md` already opens with `@AGENTS.md`.
- **L2** depth — unblocked (Claude Code 2.1.220). Still 212,822 B always-loaded.
- **L3** coverage 7 → 39, which sweeps up the **12 of 15** ungoverned Codex agents that still inherit
  the parent sandbox.
- **Gates** — a ref-parsing `never-push-main` hook is the only robust form; the enumerated denies are
  belt only.
- **L4** — decision log with durable IDs; cross-tool behavioural fixture.
- **Open choice** — the renderer emits full copies; `tooling-governance.md` §7 prefers thin pointers.
- **Owner/CLI only** — the three empirical tests (E1 byte-cap shape, E2 local `codex review` honouring
  `## Code Review Rules`, E3 unscoped rules in subagents), the Codex sandbox effect test, and a
  `/context` token baseline. No token claim may be made until that capture exists.
