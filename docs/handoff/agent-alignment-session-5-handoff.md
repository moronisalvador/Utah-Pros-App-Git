<!--
FILE: docs/handoff/agent-alignment-session-5-handoff.md
Baton for session 6 of the agent-instruction alignment initiative.
Plan of record: docs/agent-alignment-roadmap.md.
-->

# Agent alignment — session 5 handoff (2026-07-26)

**Branch:** `dev`, pushed through `c23cdd29`. Working tree carries ~48 files belonging to other
sessions — untouched, and none of them mine. Every commit staged by explicit path.

**Scope kept:** docs and agent-configuration only. No `src/`, `functions/`, `supabase/`, `ios/`, no
migration, no live or provider state, no permission change.

---

## 1. What landed

| | |
|---|---|
| **P3 — the duplicate is gone** | `CLAUDE.md` no longer carries rules 1–12. `AGENTS.md` is sole carrier. `89c9432a` |
| **P7 — instrument** | `InstructionsLoaded` recorder + `instructions-loaded-report.mjs --assert-core` |
| **Glob semantics measured** | The inherited brace claim refuted on both builds. `1da9632c` |
| **Glob linter** | `scripts/agents/verify-rule-globs.mjs`, 30/30 self-test. `893ebb8e`, `275eef53` |
| **P0 capability floor** | First run ever. `docs/audit/2026-07/evidence/agent-capability-floor.md` |
| **never-push-main guard** | `cb592638` — and it is proven to fire live |

`node scripts/check-l0-bridge.mjs` → **14/14**. `npm run validate:tooling` → 0 errors, 2 dated
waivers. `verify-rule-globs.mjs` → clean.

## 2. The three things that were believed and turned out false

Recorded because the pattern matters more than the individual facts.

1. **"Brace groups in `paths:` match nothing."** Written in the roadmap, the dispatch, the challenge
   report and CLAUDE.md, cited as measured. Probed on both installed builds: braces load on both,
   including the exact `**/*.{js,jsx}` shape it was claimed for. The real limit is the ~1,000
   expansion budget — 512 loads, 1024 does not — and **only the newer build enforces it**. Two
   places would have hardened the false claim into code: the glob-linter self-test spec demanded the
   linter *prove* braces match nothing, and CI invariant (4) asserted brace-freedom.
2. **"P8's ten files carry zero shared-database content."** Two of them carry anon-grant law,
   apply-window serialization and a RED-tier owner gate. Scoped rules are dropped at `/compact`.
3. **"`claude --version` is 2.1.85, so P8/P9/P18/P20 are gated."** PATH is 2.1.220, running harness
   2.1.219. **The gate is already satisfied.**

**The instrument was wrong first, too.** `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_EXECPATH` are
inherited by headless children, so a two-build comparison merged into one bucket and read as "both
builds behave identical" for a full round of analysis. Fixed — group on the payload's `session_id`.
Same defect was a false-PASS route for `--assert-core`.

**Method that caught all of it:** predict, then measure, then let something adversarial attack the
result. The deliberate-breakage run found a bug in the linter within a minute of it being written.
One research agent in this session fabricated a file path while hunting for fabricated file paths.
Do not skip the adversarial pass.

## 2b. DECISIONS TAKEN (owner delegated, 2026-07-26)

The owner released DB-1 — all 8 migrations applied — and delegated the rest, with a standing steer:
**safety measures must earn their friction.** Resolved in `agent-alignment-roadmap.md` §10:

- **Ledger #1** closed, no action — the version gate was already satisfied.
- **Ledger #10: both evictions REJECTED.** The DRAFT holds a live promotion hold; the tombstone is
  358 B serving ~18 inbound references. Evicting either costs more than it saves. The *defects*
  underneath were fixed instead — the DRAFT's §6 now binds despite the file's disclaimer, the
  archived manifest no longer claims to be binding in present tense, and a reviewer agent's pointer
  was retargeted off the tombstone.
- **Ledger #11** measured, not argued: all 23 rules reload at `/compact` *because* unscoped.
- **Ledger #12:** all three held. Two carry amendments from two days ago; `omni-inbox` is dormant
  and is P20's first candidate, but dormant is not merged.
- **P8 scope: 7 files, not 9.**
- **Permissions rebuilt** (`4eb0c2f0`) — every deny/ask entry is now live where 8 of 11 were dead.
  Deliberately not maximal: deny only irreversible financial deletes; PR merge, Stripe payout and
  Twilio SMS merely *ask*.

## 3. ⚠️ WHAT I NEED FROM YOU

**Most of this section is now DONE — see §2b. Two items genuinely remain: the machine-local allow
list (§A) and the `claudeMdExcludes` probe (§E). Everything else below is history, kept because it
explains why the decisions went the way they did.**

### A. LOW PRIORITY — 22 dead `permissions.allow` entries *(owner deprioritized 2026-07-26)*

Every MCP entry in `permissions.allow` names a server alias that no live server bears, so none of
them pre-approve anything and read-only Supabase / UPR / GitHub calls prompt every time.

I flagged this as the biggest remaining friction win. **The owner corrected me: they rarely use
those MCP servers, so the prompts cost almost nothing in practice.** Recorded because the analysis
was right about the mechanism and wrong about the impact — a dead config entry is only friction if
somebody actually hits it. Don't spend a session on this.

If it ever does start biting: it cannot be fixed in this repo. Allow rules reject wildcards (the
validator requires a literal `mcp__<server>__` prefix) and the live servers are install-specific
UUIDs, so the fix belongs in machine-local settings. The deny/ask side is already fixed and
committed, because those *do* accept wildcards — and that side was worth doing regardless, since it
covers irreversible deletes rather than convenience.

### A-hist. Security — three QuickBooks delete tools had no gate *(FIXED in `4eb0c2f0`)*

`permissions.deny` has 11 MCP entries. The three `mcp__*__<tool>` wildcards fire. The other eight
name servers by literal alias (`UPR_MCP`, `github`, `Gusto`, `Supabase`) and **no live server bears
those names** — live servers are hashed UUIDs, so those entries match nothing.

Most of that is harmless overlap, because the destructive-SQL hook covers the `upr_*` and SQL tools
independently. **Three fall through both layers and are live right now:**

- `qbo_delete_invoice` · `qbo_delete_entity` · `qbo_delete_payment` — they delete real accounting
  records
- `github merge_pull_request` also — which matters because Rule 4 reserves merges for you

I did not fix it: a permissions change is Red-tier and `AGENTS.md` says no agent message authorizes
one. The mechanical fix is to re-spell the dead literals as `mcp__*__<tool>`. **The real question is
yours: should an agent be able to delete a QuickBooks payment at all?** My recommendation is no —
deny the three outright rather than re-spelling.

### B. Ledger #10 — re-opened, do not run P8's eviction as written

The file P8 would evict now contains a **live promotion hold and a DB lease** over 8 unapplied
migrations, while still saying "DRAFT … not binding … grants no authority" twice. Evicting it moves
live coordination state out of the always-loaded set; leaving it preserves a document that
contradicts itself. **Neither listed option is right.** Sequence instead: promote the register into
something that binds (or retire it if those leases have closed), *then* evict the remainder.

→ **Have the DB-1 lease and the promotion hold closed?** That answer decides this.

### C. Ledger #12 — the three held files

`messaging-transport`, `tech-messages-v2`, `omni-inbox` wave manifests. Release is merge-keyed, not
date-keyed. A subagent gathered evidence but I have **not** verified it to the depth I verified the
rest, so I am not reporting a verdict. Worth one focused pass before P20.

### D. P8 scope — 9 files or 7?

Drop `db-foundation-wave-ownership.md` and `app-store-readiness-wave-ownership.md` from the
conversion set, or route them through P9's split-then-scope. Evidence is in the roadmap's P8 block.
The other seven were **not** audited to that depth — assume the "zero safety content" premise is
unverified for them too.

### E. Two small ones

- **`claudeMdExcludes` probe** — needs a checkout with one writer. The test writes an exclusion into
  `settings.json`, and any session restarting inside the window would lose all 23 rules.
- **Wire the linter into CI?** `package.json` is outside the scope I was given. Suggested:
  `"validate:rule-globs": "node scripts/agents/verify-rule-globs.mjs"` plus a self-test step.

## 4. ⭐ SCOPE DECISION 2026-07-26 — Codex is real, and it is the RISKIER mode

Asked whether Codex was actually used or just theoretical, the owner said: **"I do use Codex,
usually every time I run out of token budget on my Anthropic account and have to wait until next
week."** So Codex is not a parity nicety — it is where the work happens for days at a stretch,
on a schedule nobody controls.

**This inverts the risk model the initiative has been assuming.** Every mechanical control built so
far is Claude-only:

| Control | Claude Code | Codex |
|---|---|---|
| `InstructionsLoaded` instrument / `--assert-core` | ✅ | ❌ none |
| PreToolUse hooks (push-to-main, secrets, destructive SQL) | ✅ exit 2 blocks | ❌ different model |
| Loaded-document introspection | ✅ | ❌ none documented |
| Byte-cap truncation warning | n/a | ❌ **silent tail drop** |
| Native sandbox | ❌ on win32 | ✅ |

So during a budget lockout the owner works in the mode with **fewer verifiable guardrails and a
silent failure mode** (`project_doc_max_bytes` drops the tail of `AGENTS.md` with no warning). The
byte cap is currently 65,536 against a 25,657 B file — fine today, and it must be *checked*, not
assumed, because nothing will say so when it stops being fine. `scripts/check-l0-bridge.mjs`
assertion 13 is that check; keep it green.

**Consequence for the roadmap:** P10, P12, P13 and P14 (the Codex depth layer, the safety
divergences, the generated adapters, dispatcher conformance) are **NOT cuttable**. I had provisionally
recommended cutting them; that recommendation is withdrawn.

## 4b. Revised remaining scope — what to do and what to drop

**DO, in this order:**

1. **P8/P9 — scope the rules files.** The direct payoff: ~214 KB of rules enter every session
   regardless of relevance (`motion-standard.md` is 26.6 KB of animation law loading while you edit
   a Cloudflare worker). Scoped correctly this cuts 40–60 KB per session. Everything needed is
   built: `scripts/agents/verify-rule-globs.mjs` and the `InstructionsLoaded` instrument. Scope is
   **7 files, not 9** (§2b), and the other 7 still need a body-level safety audit first.
2. **P12 — close the Codex safety divergences.** Highest value per the §4 table: it hardens the mode
   with the fewest guardrails, during the weeks the owner is stuck in it.
3. **P19 — one CI invariant guard.** This session found stale derive-commands and 8 dead permission
   entries; both drifted in silently. One check stops the recurrence. Note its invariant (4) is
   already corrected in the roadmap — assert the expansion budget, never brace-freedom.
   **Smaller than the roadmap implies — the precedent already exists (added 2026-07-27):**
   `scripts/check-migration-provenance.mjs` is wired into `.github/workflows/ci.yml` via
   `npm run validate:provenance` and `npm run test:provenance`. Copy that shape. Note that
   `check-l0-bridge.mjs` and `verify-rule-globs.mjs` are **not** in CI today, so every guard this
   initiative built only runs when a human remembers to — which is the exact failure mode P19 exists
   to close.
4. **P10 / P13 / P14** — Codex depth layer and single-sourced adapters, if appetite remains.

**DROP unless something changes:** most of Wave 2 (P4/P5/P6 add gates; the owner's standing steer is
that safety must earn its friction) and most of Wave 5 (P15–P18 process ceremony).

**Smaller, genuinely unblocked:**

- Turn `docs/audit/2026-07/evidence/agent-capability-floor.md` into `scripts/qa/capability-floor.mjs`.
  Both P0 findings were silent and drifted in unnoticed — that is the argument for automating it.
- P8 close-out criterion (c), "a declared near-miss does not match", has **no instrument**. There is
  no declaration mechanism, so the linter cannot check it.

**Do not** trust a byte figure, a checkbox or a "measured" claim in the roadmap without re-deriving
it. This session found stale numbers in `CLAUDE.md`, `AGENTS.md`, the roadmap and the dispatch,
including two derive-commands that returned the wrong answer (`ls functions/api/*.js` counts 51 test
files as workers; a bare git pathspec `*` crosses `/`).

## 4c. Hazards specific to the next session's work

- **A wrong `paths:` glob fails silently.** No error, no warning — the rule just never loads again.
  Never claim a conversion works; prove it. `node scripts/agents/verify-rule-globs.mjs` catches
  budget/dead/unconditional errors, then confirm the rule actually fires with
  `node scripts/instructions-loaded-report.mjs`.
- **The linter's matcher is close to the loader's, not identical.** It says so itself. Treat exit 0
  as necessary, never sufficient.
- **Scoped rules are dropped at `/compact`.** Anything carrying money, consent/TCPA,
  server-authorization or shared-production-apply law stays unscoped, permanently. Two P8 candidates
  already failed this test; assume the others are unaudited.
- **Group log events by the PAYLOAD's `session_id`.** `CLAUDE_CODE_SESSION_ID` and
  `CLAUDE_CODE_EXECPATH` are inherited by headless children — that produced a confidently wrong
  two-build comparison before it was caught.

## 5. Shared-checkout hazard

Three sessions were live on this tree. **A push from any of them publishes every commit on `dev`,
including another session's unpublished work** — that happened to me this session. "Committed but
unpushed" is not a holding state here; use a branch if something must wait for review.

---

## 6. Opening prompt for session 6

Self-contained; references no prior conversation. Paste as-is.

```text
Continue the agent-instruction alignment initiative on the UPR Platform.

FIRST, three commands, before reading anything. Report the real output of each.

  git fetch origin && git status --short --branch
  node scripts/check-l0-bridge.mjs                          # must be 14/14
  node scripts/instructions-loaded-report.mjs --assert-core  # must PASS

The third is the mechanical proof that the shared law core (AGENTS.md, imported by
CLAUDE.md line 1) actually loaded. It replaced an older token-quoting canary, which
turned out to be unrunnable — a compaction summary can carry the token forward, so a
session quoting it proves nothing. Do not reintroduce that test. If --assert-core says
NO EVIDENCE, the hook has not fired yet this session; that is ambiguous, not a failure.

Then read, in order:
  docs/handoff/agent-alignment-session-5-handoff.md   (the baton — start at §4)
  docs/agent-alignment-roadmap.md                     (§10's DECISIONS TAKEN block, then P8 and P9)
  docs/agent-alignment-l2-evidence.md                 (what is measured vs still believed)

Note there is a SECOND, unrelated prompt in that folder —
docs/handoff/production-promotion-and-followups-prompt.md — from a different session,
covering the security-batch promotion. That promotion is DONE (main and dev are both at
98786f52). It is not your job; do not start from it.

YOUR JOB: P8/P9 — scope the .claude/rules files with `paths:` frontmatter.

Why it is worth doing: ~214 KB of rules load into EVERY session regardless of relevance.
motion-standard.md alone is 26.6 KB of animation law that loads while you edit a
Cloudflare worker. Correct scoping cuts 40-60 KB per session.

Work in this order, and do not skip step 1:

1. AUDIT BEFORE CONVERTING. Scoped rules are DROPPED AT /compact. Any file carrying
   money, consent/TCPA, server-authorization or shared-production-apply law must stay
   unscoped forever. Two candidates already failed this — db-foundation and
   app-store-readiness were removed from the set for exactly that reason. Read each
   remaining candidate's BODY, not its title. Report what you find before editing.
2. Convert one file at a time. After each: `node scripts/agents/verify-rule-globs.mjs`
   (budget / dead-glob / silently-unconditional), then PROVE the rule actually fires by
   touching a matching file and checking
   `node scripts/instructions-loaded-report.mjs`. A wrong glob fails SILENTLY — no
   error, the rule simply never loads again. Never report a conversion as working
   without that second check.
3. database-standard.md stays unscoped permanently. Owner-confirmed and measured.

CONSTRAINTS
- Agent-configuration and docs only: .claude/, .codex/, .agents/, docs/, scripts/agents/.
  No src/, functions/, supabase/, ios/. No migration, no live or provider state.
- Permissions changes are owner-gated. Do not edit permissions.allow/deny/ask.
- Stage by explicit path. NEVER `git add -A`. Other sessions share this working tree and
  keep dozens of files uncommitted; leave every one of them alone.
- A push from any session publishes all of dev, so unpushed is not a holding state.
- Verify before claiming. This repo's docs have repeatedly carried confident numbers that
  were wrong — including two derive-commands that counted the wrong thing. Re-derive.

CONTEXT THAT CHANGES PRIORITIES: the owner uses Codex for days at a time whenever the
Anthropic token budget runs out. Codex has no InstructionsLoaded instrument, no PreToolUse
hooks and no truncation warning — its byte cap drops the tail of AGENTS.md silently. So
Codex is the higher-risk mode, and P12 (closing the Codex safety divergences) is the next
priority after P8/P9. It is not optional parity work.

The owner's standing steer: safety measures must earn their friction. A gate that blocks a
real dev loop needs a real failure mode behind it. Prefer removing dead controls over
adding new ones.

IF P8/P9 FINISHES EARLY, the next-best item is small and well-precedented: neither
scripts/check-l0-bridge.mjs nor scripts/agents/verify-rule-globs.mjs runs in CI, so every
guard this initiative built only fires when a human remembers to. Wire them the way
scripts/check-migration-provenance.mjs already is — npm run validate:provenance and
npm run test:provenance in .github/workflows/ci.yml. That needs a package.json edit, which
is outside the constraint list above, so ask the owner before doing it.
```
