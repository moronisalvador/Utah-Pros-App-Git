<!--
FILE: docs/agent-alignment-l2-evidence.md

WHAT THIS DOES (plain language):
  The measured facts behind the L2 on-demand-depth work. Everything here was
  observed from the loader's own record, not inferred from documentation.
  Claims that are still UNMEASURED are listed as such on purpose — this file
  exists so the next session stops re-deriving, and stops believing.

DEPENDS ON:
  Internal: .claude/hooks/record-instructions-loaded.mjs (the recorder),
            scripts/instructions-loaded-report.mjs (the reader),
            docs/agent-alignment-roadmap.md, docs/agent-alignment-dispatch.md
  Data:     reads  → .claude/logs/instructions-loaded.jsonl (machine-local)
            writes → nothing

NOTES / GOTCHAS:
  - Re-measure before trusting. Every number here is dated.
  - An UNMEASURED row is not a soft pass. Do not promote one to a fact
    without running the probe.
-->

# L2 evidence — what is measured, and what is still believed

**Measured:** 2026-07-26 · **Instrument:** `.claude/hooks/record-instructions-loaded.mjs`
(`InstructionsLoaded` hook) → `scripts/instructions-loaded-report.mjs`.

## 1. The running build — the version gate, and why its recipe was wrong

| | |
|---|---|
| Running build | **2.1.219** (`CLAUDE_CODE_EXECPATH`, desktop-bundled), `CLAUDE_CODE_ENTRYPOINT=claude-desktop` |
| `AppData/Roaming/npm/claude` | 2.1.220 |
| `.local/bin/claude` | **2.1.85** — the present-but-unpatched build |
| Ledger #1 gate (≥ 2.1.217) | **MET** by the running build |

**Correction to the dispatch's assertion recipe.** It says to assert `claude --version`. On this
machine that is a **PATH lottery** across three different builds, and the one it resolves to is
*neither* the one running the session. It happens to answer 2.1.220 today; reorder `PATH` and it
answers 2.1.85 and fails a gate that is actually met. Worse, a headless `claude -p` invoked via
`.local/bin` genuinely runs the unpatched 2.1.85 while the interactive session is patched.

**Assert `CLAUDE_CODE_EXECPATH` (or `AI_AGENT`), never `claude --version`.**

## 2. The mechanism exists in the build

Confirmed as literal strings inside the running 2.1.219 binary before any hook was written against
them — guessing an event name would have produced a silently inert instrument:

`InstructionsLoaded` · `path_glob_match` · `nested_traversal` · `session_start` ·
`claudeMdExcludes` · `PreCompact` · `SessionStart` — all **present**.

## 3. MEASURED — the `@AGENTS.md` bridge resolves

Fresh headless session `6aee0f8e`, which had never read `AGENTS.md`:

```
LOADED       REASON     PARENT
AGENTS.md    include    CLAUDE.md
CLAUDE.md    session_start    —
```

`node scripts/instructions-loaded-report.mjs --assert-core` → **PASS**, exit 0.

This is the first evidence for the bridge that does **not** depend on a session reporting what it can
see. It supersedes the anchor-token quote as the primary proof for the session-start case. Note the
reason is `include`, not `session_start` — a `session_start`-only check would false-fail here, which
is exactly why the accepted set is `{session_start, include}` and must not be narrowed.

## 4. MEASURED — every rules file loads unconditionally

Same session: **23 of 23** `.claude/rules/*.md` loaded, reason `session_start`, **0 not loaded**.

This is L2's premise, previously asserted and now observed. The whole set enters every session at
`CLAUDE.md` priority regardless of relevance.

**Corrected byte figures** (the older numbers were measured inconsistently):

| | bytes |
|---|---|
| `cat .claude/rules/*.md \| wc -c` on this Windows checkout | 216,637 |
| …of which are CR bytes from `core.autocrlf` | 2,843 |
| **LF-normalised — the only comparable figure** | **213,794** |
| session-4 handoff | 213,576 |
| ownership §10.4 | 212,822 |

Real growth since the handoff is **218 B**, not 3,061. **The handoff's own command over-reports by
~2.8 KB on a Windows checkout.** Subtract CR bytes, or measure from `git show`.

## 4b. MEASURED — the import survives `/compact` (the P3 gate)

Session `1b85a217`, a long working session, compacted for real. All 25 events below are the
compaction reload — the hook was wired mid-session, so no session-start events exist for it:

```
LOADED       REASON     PARENT
AGENTS.md    include    CLAUDE.md
CLAUDE.md    compact    —
…23 rules    compact    —
```

`--assert-core` → **PASS**, exit 0. `CLAUDE.md` came back with `reason=compact` and pulled
`AGENTS.md` in behind it as an `include`. **The `@AGENTS.md` bridge is durable across compaction.**

Two consequences, both acted on the same day:

1. **P3 ran** (`89c9432a`) — the duplicated rules block and six other carried blocks left
   `CLAUDE.md`. `check-l0-bridge.mjs` 14/14 either side.
2. **Ledger #11 is now observed, not argued.** All 23 rules reloaded *because they are unscoped*. A
   `paths:`-scoped `database-standard.md` would have been absent from that list, taking the
   shared-production apply gate with it. That is the measurement behind "permanently unscoped".

The §6 caveat below was written expecting an empty log. It did not happen — the hook was live in
time. Keep the caveat anyway: it is the correct reading if a *future* mid-session wiring logs
nothing.

## 4c. MEASURED — `paths:` glob semantics, and one inherited claim refuted

Method: eight temporary untracked probe rules in `.claude/rules/`, each `paths:`-scoped by a
different glob form, **every one constructed so exactly one expansion equals the target**
`docs/glob-probe-target.tmp.md`. A headless session then read the target; the `InstructionsLoaded`
log says which probes fired. Constructing them that way matters — the first draft's over-braced
pattern expanded to `globprobetarget.tmp.md` (hyphens dropped), which would have produced a null
result from a *broken pattern* and been misread as a budget refusal.

**Run on both installed builds**, because the inherited claim was recorded on the old one:

| Glob form | Expansions | 2.1.219 | 2.1.85 |
|---|---|---|---|
| exact path, block-list YAML | 1 | loads | loads |
| `docs/**/*.md`, inline-array YAML | 1 | loads | loads |
| braces in filename | 16 | loads | loads |
| braces in filename | **512** | loads | loads |
| braces in filename | **1024** | **NO load** | loads |
| braces in filename | 2048 | **NO load** | loads |
| **`docs/**/*.{md,txt}`** — the disputed shape | 1 | **loads** | **loads** |
| `docs/*.{md,txt}` | 1 | **loads** | loads |
| `docs/…tmp.{md,txt}` (no star) | 1 | **loads** | loads |
| bracket class `docs/**/*.m[d]` | 1 | loads | loads |
| `docs/**` | 1 | loads | loads |

**Findings:**

1. **"Brace groups match nothing" does not reproduce on either build.** Our roadmap, dispatch and
   challenge report all state that `src/**/*.{js,jsx}` matches neither `Foo.jsx` nor `Foo.js`, cited
   as directly measured. The equivalent shape `docs/**/*.{md,txt}` **loads on 2.1.219 and on 2.1.85**.
   It is not a filename-versus-extension distinction either — braces work in both positions, with and
   without a preceding star. Whatever produced the original reading, it is not reproducible here, and
   **no `paths:` authoring rule should continue to rest on it.**
2. **The ~1,000-pattern budget is real, and is enforced only on the NEWER build.** 512 loads, 1024
   does not, on 2.1.219. On 2.1.85 all three over-budget patterns load. So the budget is an *added
   check*, not an old bug — the opposite of what the version history suggested. Either way the safe
   authoring rule is the strict one, because ledger #1 mandates ≥ 2.1.217.
3. **Bracket classes work** on both builds, confirming the inherited claim.
4. **Both YAML shapes work** — `paths:` as a block list and as an inline array.
5. **`path_glob_match` is real and exclusive.** Every probe fired with `reason=path_glob_match`, while
   the 25 non-probe events in the same run were all `session_start`/`include`. A scoped rule does
   **not** load at startup. This is the mechanism L2 depends on, now observed rather than assumed.

**Style rule this produces** (supersedes "prefer brace-free"): braces are permitted. What must never
ship is a pattern whose expansion count approaches 1,000 — nested groups multiply, so
`{a,b}{c,d}{e,f}…` is the hazard, and `{js,jsx}` is fine. Count the product of the group sizes, or
split into several patterns. **A glob is never assumed to work; it is proved with the P7 instrument
before it is relied on.**

### The instrument was wrong first, and that is the transferable lesson

Two defects surfaced only because the two-build comparison produced an impossible-looking result:

- **`CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_EXECPATH` are inherited by a headless child.** The
  2.1.85 run reported *my interactive session's* id and *the 2.1.219 path*. Grouping on either merged
  the two builds into one bucket, which read as "both builds behave identically" — a wrong conclusion
  that survived one round of analysis. Verified afterwards across the whole log: 36 rows where the
  env id disagrees with the payload id, all of them that one run.
- **`process.ppid` does not fix it.** Each hook invocation is spawned through its own shell, so it
  yields ~25 distinct pids per run. Tried, measured, rejected.

**The hook payload's own `session_id` is authoritative.** The recorder now stores it as `session_id`,
keeps the environment's under `env_session_id` as provenance, and also captures `transcript_path` and
`memory_type`. The reporter groups on the payload id and says so when it sees an inherited one.
Re-verified: the 2.1.85 run now stands alone as session `78917c5d` with 36 events, and all four
negative `--assert-core` fixtures still fail with exit 1.

**Generalise this, not just the glob numbers:** the instrument that proves a claim needs its own
adversarial check. A measurement tool inherited an environment variable and quietly attributed one
process's behaviour to another. It was caught only because the result contradicted a prediction —
which is an argument for predicting before measuring, every time.

## 5. NOT MEASURED — do not promote these without running the probe

| Claim | Status |
|---|---|
| ~~The import survives `/compact`~~ | **MEASURED 2026-07-26 — PASS.** §4b. |
| ~~`path_glob_match` fires only for matching paths~~ | **MEASURED 2026-07-26.** §4c. |
| ~~Brace groups match nothing~~ | **MEASURED 2026-07-26 — REFUTED.** §4c. |
| ~~Bracket classes work~~ | **MEASURED 2026-07-26 — CONFIRMED.** §4c. |
| `claudeMdExcludes` covers `.claude/rules/*.md` | **UNMEASURED, and deliberately deferred.** Testing it means writing an exclusion into `.claude/settings.json`. Three sessions share this checkout; a settings change is picked up by any of them that restarts or compacts inside the test window, and the exclusion under test would drop *all* rules from that session. The probe is cheap but the blast radius is another session's law loading. Run it when this checkout has one writer, not three. Nothing in P8/P9 depends on it — `paths:` scoping is the mechanism; `claudeMdExcludes` is only an alternative. |

## 6. Caveat on measuring the compaction case

The `InstructionsLoaded` hook was wired mid-session, and a settings change does not take effect until
`/clear`, `/compact` or restart. So at the first `/compact` after wiring, the hook may register
*after* the compaction's instruction reload has already happened.

**If the log shows no rows for that session, the result is AMBIGUOUS, not a failure.** Do not read it
as the import being dropped. Restart the session first (so the hook is live from the start), then
compact, then read.
