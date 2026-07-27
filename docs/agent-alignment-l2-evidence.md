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

## 5. NOT MEASURED — do not promote these without running the probe

| Claim | Status |
|---|---|
| ~~The import survives `/compact`~~ | **MEASURED 2026-07-26 — PASS.** Promoted to §4b below. |
| A `paths:`-scoped rule loads only for matching paths (`path_glob_match`) | **UNMEASURED.** No scoped rule exists on disk yet. |
| Brace groups in a `paths:` glob match nothing | **UNMEASURED here.** Inherited claim; the dispatch calls for it to be recorded as a tested refutation, and it has not been tested. |
| Bracket classes *do* work in `paths:` globs | **UNMEASURED here.** Same. |
| `claudeMdExcludes` covers `.claude/rules/*.md` | **UNMEASURED here.** Same. |

## 6. Caveat on measuring the compaction case

The `InstructionsLoaded` hook was wired mid-session, and a settings change does not take effect until
`/clear`, `/compact` or restart. So at the first `/compact` after wiring, the hook may register
*after* the compaction's instruction reload has already happened.

**If the log shows no rows for that session, the result is AMBIGUOUS, not a failure.** Do not read it
as the import being dropped. Restart the session first (so the hook is live from the start), then
compact, then read.
