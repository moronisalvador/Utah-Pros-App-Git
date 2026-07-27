<!--
FILE: docs/audit/2026-07/evidence/agent-capability-floor.md

WHAT THIS DOES (plain language):
  The P0 "capability floor" measurement: what this machine's agent tooling
  actually ENFORCES, versus what is merely written down somewhere. Dated
  evidence, not project law — see AGENTS.md document precedence.

NOTES / GOTCHAS:
  - Provenance is marked per row. "Verified here" means run in the main session
    and the output read. "Subagent" means measured by a research agent and
    spot-checked. Do not promote a subagent row to fact without re-running it;
    one research agent in this same batch fabricated a file path.
  - Re-measure before trusting. Every number is dated.
-->

# P0 — Agent capability floor (measured 2026-07-26)

The roadmap's P0 phase had never been run; its four named deliverables did not exist. This is the
measurement. Two of its instructions were already stale when read, because P1/P2/P3 shipped ahead of
it — `.codex/config.toml` now exists (P0 says to record its absence), and the version figure it
carries is wrong.

## 1. The headline: what is genuinely enforced

| Control | Status | Provenance |
|---|---|---|
| **Push to `main` blocked** | **ENFORCED, proven live.** `git push origin main --dry-run` was refused by the hook; the command never ran. | subagent, and the guard + its 33-case test were written in this session |
| Secrets blocked in `.env*` writes | ENFORCED — exit 2, fails closed on unparseable input | subagent |
| Destructive SQL via MCP blocked | ENFORCED — exit 2, fails closed on empty/garbage payload | subagent |
| All 5 hook wirings point at files that exist | ENFORCED — no fail-open from a dangling path | subagent |
| Shared law core loads, survives `/compact` | **MEASURED** — see `agent-alignment-l2-evidence.md` §4b | verified here |
| **impeccable PostToolUse hook** | **ADVISORY ONLY — cannot block** | **verified here** |
| **8 of 11 MCP permission denies** | **DEAD — cannot fire** | **verified here** |
| Claude Code sandbox on win32 | Not in effect (no `sandbox` key at any scope) | subagent |

**`roadmap §8`'s row "Push-to-`main` enforcement: none (only `--force`/`-f` denied)" is now stale** —
`cb592638` landed the guard after that table was written.

## 2. FINDING — three money-deleting QuickBooks tools have no gate at all

**Verified here.** The highest-consequence item in this measurement.

`.claude/settings.json` `permissions.deny` has 11 MCP entries. Three use a `mcp__*__<tool>` wildcard
and **do** fire. The other eight name servers by literal alias — `UPR_MCP`, `github`, `Gusto`,
`Supabase` — and **no live server bears those names.** Live servers are hashed UUIDs
(`mcp__c6f3f344-…`, `mcp__1cd66b34-…`), so the literal entries match nothing.

That is mostly harmless overlap, because the destructive-SQL hook regex independently covers
`upr_sql`, `upr_delete`, `upr_update`, `upr_insert`, `upr_upsert`, `execute_sql`, `exec_read_sql`
and `apply_migration`. **Three tools fall through both layers:**

```
mcp__c6f3f344-…__qbo_delete_invoice     denied only as mcp__UPR_MCP__…  (dead)   · not in the hook regex
mcp__c6f3f344-…__qbo_delete_entity      denied only as mcp__UPR_MCP__…  (dead)   · not in the hook regex
mcp__c6f3f344-…__qbo_delete_payment     denied only as mcp__UPR_MCP__…  (dead)   · not in the hook regex
```

All three are live and callable in this session's tool inventory. They delete QuickBooks invoices,
entities and payments — real accounting records. `mcp__github__merge_pull_request` is dead the same
way, which matters because CLAUDE.md Rule 4 reserves merges for the owner.

The counter-intuitive part, and the reason this survived: **the wildcards are the healthy spelling
and the specific-looking literal aliases are the dead ones.** The deny list reads as more protective
than the wildcards, and is less.

**This is an owner action.** A permissions change is Red-tier (roadmap §3) and `AGENTS.md` is
explicit that no agent message can authorize one. Not fixed here. The fix is to re-spell the eight
literals as `mcp__*__<tool>`, or to add the three `qbo_delete_*` names to the hook regex — but the
posture question (should an agent be able to delete a QuickBooks payment at all?) is the owner's.

## 3. FINDING — the impeccable hook enforces nothing

**Verified here.** `CLAUDE.md` calls it "the one *deterministic* layer". It runs deterministically;
it cannot block. `hook-lib.mjs` returns `exitCode: 0` at all 7 return sites and its own header says
"Never throws. All errors are converted to `exitCode: 0`". `hook.mjs:44` is
`process.exit(result.exitCode || 0)`.

Exit 0 permits. Exit 1 would also permit — **exit 1 is non-blocking in both tools**; only exit 2
blocks. So its findings can be ignored with no mechanical consequence. It belongs in the advisory
column, and the CLAUDE.md wording is corrected accordingly.

## 4. Version — ledger #1 is already satisfied

The roadmap records `claude --version` = **2.1.85** and gates P8/P9/P18/P20 on ≥ 2.1.217. That
measurement is stale:

| | |
|---|---|
| PATH (`npm` global) | **2.1.220** |
| Running harness (`CLAUDE_CODE_EXECPATH`) | **2.1.219** |
| `~/.local/bin/claude` | 2.1.85 — the stale one the roadmap measured |

**The version gate is met; the `paths:` retrofit lane is unblocked.** But three builds are reachable
from one machine, so a version assertion must resolve the binary explicitly rather than trusting
`claude --version`, which is a PATH lottery. And `CLAUDE_CODE_EXECPATH` is **inherited by a headless
child**, so it identifies the parent, never a subprocess — measured this session
(`agent-alignment-l2-evidence.md` §4c).

## 5. Still not measured

- `claudeMdExcludes` behaviour — deliberately deferred while several sessions share this checkout;
  the probe would drop all rules from any session that restarts inside the test window.
- P8 close-out criterion (c), "a declared near-miss does not match" — there is no declaration
  mechanism, so `verify-rule-globs.mjs` has no instrument for it. Its other three checks are live.
- The Codex side generally. Codex exposes no loaded-document introspection and no truncation
  warning; its verification is canary-and-byte-count only. **Any claim of parity between the two
  tools is false**, and P7 widened the gap.

## 6. P0 artifacts still outstanding

`scripts/qa/capability-floor.mjs` and its test do not exist — this document is the measurement, not
a re-runnable check. Converting it into one is worthwhile precisely because the two sharpest
findings here (dead permission aliases, a hook that cannot block) are both *silent* and both drifted
in without anyone noticing.
