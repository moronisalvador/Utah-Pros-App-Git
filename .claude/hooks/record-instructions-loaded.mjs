// ════════════════════════════════════════════════
// FILE: .claude/hooks/record-instructions-loaded.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Writes down which instruction files Claude Code actually loaded this
//   session, and why. Every claim in the alignment initiative about what
//   loads — the shared law core, a rule scoped to certain paths, whether
//   anything survives compaction — is currently believed rather than
//   measured. This is the thing that measures it.
//
// DEPENDS ON:
//   Packages:  none (node built-ins only)
//   Internal:  wired as the `InstructionsLoaded` hook in .claude/settings.json;
//              read back by scripts/instructions-loaded-report.mjs
//   Data:      reads  → the hook payload on stdin
//              writes → .claude/logs/instructions-loaded.jsonl (gitignored)
//
// NOTES / GOTCHAS:
//   - THIS OBSERVER MUST NEVER BLOCK. It always exits 0, even on total
//     failure. A guard exits 2 to refuse; an instrument that refused would
//     take the session down and teach everyone to delete it. Every path is
//     wrapped, and a write failure is swallowed on purpose.
//   - It stores the RAW payload verbatim alongside the parsed view. The
//     field names for this event are not documented anywhere we control, so
//     the parsed view is a convenience that may be wrong while `raw` stays
//     authoritative. Interpret later; never discard the evidence now.
//   - `load_reason` is the whole point. The bundle's enum (confirmed present
//     as strings in the running 2.1.219 build) is roughly
//     session_start | include | nested_traversal | path_glob_match | compact.
//     `include` is how an @-import arrives, which is why a session_start-only
//     check would false-fail on the CLAUDE.md → AGENTS.md bridge.
// ════════════════════════════════════════════════

import { appendFileSync, mkdirSync, statSync, renameSync, readFileSync } from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024

function main() {
  let raw = ''
  try { raw = readFileSync(0, 'utf8') } catch { raw = '' }
  if (!raw.trim()) return

  let parsed = null
  try { parsed = JSON.parse(raw) } catch { parsed = null }

  // Candidate key names, widest-first. The payload shape is not contractual,
  // so we probe rather than assume, and record what we found under `_matched`.
  const pick = (obj, keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), obj)
      if (typeof v === 'string' && v) return v
    }
    return null
  }

  const filePath = pick(parsed, ['file_path', 'filePath', 'path', 'instruction_file', 'source_path'])
  const reason = pick(parsed, ['load_reason', 'loadReason', 'reason', 'trigger'])
  const parent = pick(parsed, ['parent_file_path', 'parentFilePath', 'parent', 'included_by'])

  const row = {
    ts: new Date().toISOString(),
    session_id: process.env.CLAUDE_CODE_SESSION_ID || null,
    exec: process.env.CLAUDE_CODE_EXECPATH || null,
    agent: process.env.AI_AGENT || null,
    cwd: process.cwd(),
    event: pick(parsed, ['hook_event_name', 'hookEventName', 'event']) || 'InstructionsLoaded',
    file_path: filePath,
    load_reason: reason,
    parent_file_path: parent,
    _matched: { file_path: !!filePath, load_reason: !!reason, parent_file_path: !!parent },
    raw: parsed ?? raw,
  }

  const dir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'logs')
  const log = path.join(dir, 'instructions-loaded.jsonl')

  mkdirSync(dir, { recursive: true })
  try {
    if (statSync(log).size > MAX_BYTES) renameSync(log, `${log}.1`)
  } catch { /* no log yet, or rotation lost a race — either is fine */ }

  appendFileSync(log, JSON.stringify(row) + '\n', 'utf8')
}

try { main() } catch { /* an observer never blocks the session */ }
process.exit(0)
