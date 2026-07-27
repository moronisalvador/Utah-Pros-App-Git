// ════════════════════════════════════════════════
// FILE: scripts/instructions-loaded-report.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Reads the record of which instruction files Claude Code loaded, and turns
//   it into a straight answer to two questions the alignment work keeps
//   having to guess at: did the shared law core actually load, and which rule
//   files are still loading on every single session whether they are relevant
//   or not.
//
//   `--assert-core` is the important one. It is the MECHANICAL version of the
//   anchor-token canary: instead of a session reporting that it can see the
//   core, the tool checks the loader's own record. A session cannot talk its
//   way past this.
//
// DEPENDS ON:
//   Packages:  none (node built-ins only)
//   Internal:  .claude/hooks/record-instructions-loaded.mjs writes the log
//   Data:      reads  → .claude/logs/instructions-loaded.jsonl, .claude/rules/*.md
//              writes → nothing
//
// USAGE:
//   node scripts/instructions-loaded-report.mjs                 # newest session
//   node scripts/instructions-loaded-report.mjs --all           # everything
//   node scripts/instructions-loaded-report.mjs --session <id>
//   node scripts/instructions-loaded-report.mjs --assert-core   # exit 1 if the core did not load
//
// NOTES / GOTCHAS:
//   - An EMPTY log is reported as "no evidence", never as a pass. The whole
//     point is to stop unverified claims, so absence of data must not read as
//     a good result — that is the failure this instrument exists to prevent.
//   - The accepted reason set for the core is {session_start, include} and
//     loosening it is forbidden. The core arrives via an @-import, which the
//     bundle records as `include` with parent CLAUDE.md; a session_start-only
//     check would false-fail every time and tempt someone to relax it.
//   - Field names for this event are not contractual. The recorder stores the
//     raw payload, so if `_matched` shows a field was not found, fix the key
//     list in the recorder rather than trusting a hopeful parse.
//   - GROUP ON THE PAYLOAD's session_id, never the environment's. Measured
//     2026-07-26: a headless `claude -p` child inherits CLAUDE_CODE_SESSION_ID
//     *and* CLAUDE_CODE_EXECPATH from the interactive parent, so the env var
//     does not identify a run and exec does not identify the binary. A
//     two-build comparison merged into one bucket and briefly read as "both
//     builds behave identically". For --assert-core the same merge is a
//     false-PASS route: the parent's bridge event gets credited to a child that
//     never loaded it. `process.ppid` does NOT fix this — each hook invocation
//     is spawned through its own shell, giving ~25 distinct pids per run.
// ════════════════════════════════════════════════

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const RULES_DIR = path.join(REPO, '.claude', 'rules')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }

// `--log` exists so the reader can be exercised against a fixture instead of
// only against whatever the live session happened to produce. An instrument
// that can only be tested by using it is not tested.
const LOG = val('--log') || path.join(REPO, '.claude', 'logs', 'instructions-loaded.jsonl')

const ACCEPTED_CORE_REASONS = new Set(['session_start', 'include'])
const base = (p) => (p ? p.replace(/\\/g, '/').split('/').pop() : '')

function loadRows() {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

const rows = loadRows()

if (rows.length === 0) {
  console.log('NO EVIDENCE — .claude/logs/instructions-loaded.jsonl is empty or absent.')
  console.log('')
  console.log('This is NOT a pass. The InstructionsLoaded hook has not fired yet, which')
  console.log('means either it is not wired in .claude/settings.json, or no session has')
  console.log('started since it was wired. A settings change does not take effect until')
  console.log('/clear, /compact or a restart — start a fresh session, then re-run.')
  process.exit(has('--assert-core') ? 1 : 0)
}

// The run's TRUE id comes from the hook payload. The env var is inherited by a
// headless child from its interactive parent, so grouping on it merges a
// subprocess into the parent — measured 2026-07-26 on 36 rows. Old rows that
// predate the fix keep the env value in `session_id`; `raw.session_id` is
// authoritative wherever it exists, so read it first for both.
const sid = (r) => (r.raw && typeof r.raw === 'object' && r.raw.session_id) || r.session_id || null

let scope = rows
if (!has('--all')) {
  const want = val('--session') || sid(rows[rows.length - 1])
  scope = rows.filter((r) => sid(r) === want)
  console.log(`Session: ${want || '(unknown)'}   ·   ${scope.length} load event(s)`)
  // Flag the inheritance when it actually happened, so nobody re-derives it.
  const mislabelled = scope.filter((r) => r.env_session_id && r.env_session_id !== sid(r)).length
  if (mislabelled) {
    console.log(`ℹ  ${mislabelled} event(s) here carry an inherited CLAUDE_CODE_SESSION_ID from a parent`)
    console.log('   session. Grouped by the payload id, which is the correct one.')
  }
} else {
  console.log(`All sessions   ·   ${scope.length} load event(s)`)
}
console.log('')

// ── What loaded, and why ──
const width = Math.min(52, Math.max(20, ...scope.map((r) => base(r.file_path).length || 10)))
console.log('LOADED'.padEnd(width) + '  REASON'.padEnd(20) + '  PARENT')
console.log('─'.repeat(width) + '  ' + '─'.repeat(18) + '  ' + '─'.repeat(20))
for (const r of scope) {
  console.log(
    (base(r.file_path) || '(unparsed)').padEnd(width) +
    '  ' + (r.load_reason || '(unknown)').padEnd(18) +
    '  ' + (base(r.parent_file_path) || '—')
  )
}

// ── Field-shape honesty: say so if the parse missed ──
const unparsed = scope.filter((r) => !r._matched?.file_path).length
if (unparsed) {
  console.log('')
  console.log(`⚠  ${unparsed} event(s) had no recognisable file-path field.`)
  console.log('   The payload shape differs from the recorder\'s key list. Inspect `raw` in')
  console.log('   the log and extend the key list — do not trust the table above for those.')
}

// ── Which rules files are still unconditional ──
if (existsSync(RULES_DIR)) {
  const ruleFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md'))
  const loaded = new Set(scope.map((r) => base(r.file_path)))
  const seen = ruleFiles.filter((f) => loaded.has(f))
  const notSeen = ruleFiles.filter((f) => !loaded.has(f))
  console.log('')
  console.log(`.claude/rules: ${seen.length} loaded this session, ${notSeen.length} not loaded (of ${ruleFiles.length}).`)
  if (notSeen.length) console.log(`  not loaded: ${notSeen.join(', ')}`)
}

// ── The mechanical canary ──
if (has('--assert-core')) {
  console.log('')
  const core = scope.filter((r) => base(r.file_path) === 'AGENTS.md')
  const ok = core.find((r) => {
    if (!ACCEPTED_CORE_REASONS.has(r.load_reason)) return false
    if (r.load_reason === 'include') return base(r.parent_file_path) === 'CLAUDE.md'
    return true
  })
  if (ok) {
    console.log(`PASS — the shared law core loaded (reason=${ok.load_reason}` +
      `${ok.parent_file_path ? `, parent=${base(ok.parent_file_path)}` : ''}).`)
    process.exit(0)
  }
  console.log('FAIL — no AGENTS.md load event with an accepted reason in this session.')
  if (core.length) {
    console.log(`  AGENTS.md was seen ${core.length} time(s), with reason(s): ` +
      `${[...new Set(core.map((r) => r.load_reason || '(unknown)'))].join(', ')}.`)
    console.log('  Accepted: session_start, or include with parent CLAUDE.md.')
  } else {
    console.log('  AGENTS.md did not appear at all. The @AGENTS.md bridge is not loading.')
  }
  process.exit(1)
}
