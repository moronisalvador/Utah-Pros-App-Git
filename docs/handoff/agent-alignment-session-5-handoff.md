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

## 4. Next session — start here

P8/P9 are unblocked on *evidence* but gated on **B and D above**. Until those land, the highest-value
unblocked work is:

1. Turn the P0 evidence doc into `scripts/qa/capability-floor.mjs` — a re-runnable check. Both P0
   findings were silent and both drifted in unnoticed, which is the argument for automating it.
2. Implement P8 close-out criterion (c) — "a declared near-miss does not match". There is no
   declaration mechanism, so that criterion has no instrument today.
3. Audit the remaining seven P8 candidates' bodies for safety content, the way §3D describes.

**Do not** trust a byte figure, a checkbox or a "measured" claim in the roadmap without re-deriving
it. This session found stale numbers in `CLAUDE.md`, `AGENTS.md`, the roadmap and the dispatch,
including two derive-commands that returned the wrong answer (`ls functions/api/*.js` counts 51 test
files as workers; a bare git pathspec `*` crosses `/`).

## 5. Shared-checkout hazard

Three sessions were live on this tree. **A push from any of them publishes every commit on `dev`,
including another session's unpublished work** — that happened to me this session. "Committed but
unpushed" is not a holding state here; use a branch if something must wait for review.
