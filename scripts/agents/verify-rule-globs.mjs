// ════════════════════════════════════════════════
// FILE: scripts/agents/verify-rule-globs.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Checks the `paths:` globs on the rules files for the ways a glob can fail
//   SILENTLY — where the rule simply never loads and nothing tells you. There
//   is no error message for any of these; the only symptom is law that quietly
//   stopped applying.
//
//   The three silent failures it catches:
//     1. A glob whose brace groups multiply past the loader's expansion budget.
//        Measured 2026-07-26 on build 2.1.219: 512 expansions load, 1024 do
//        not. Past the budget the pattern is used unexpanded and matches
//        nothing, forever, with no warning.
//     2. A `paths:` list that reduces to nothing but `**` once the loader
//        strips a trailing `/**`. That does not scope the rule — it leaves it
//        UNCONDITIONAL, so a conversion that does this appears to have worked
//        and changed nothing.
//     3. A glob that matches no tracked file at all — a dead pattern, usually
//        a typo or a path that moved.
//
// WHY IT DOES NOT CHECK FOR BRACES:
//   An earlier spec required this linter to prove that `src/**/*.{js,jsx}`
//   matches nothing, and CI invariant (4) asserted every glob was brace-free.
//   Both were wrong. Braces were probed on both installed builds and load on
//   both, in filename and extension position. A brace-freedom check would pass
//   unsafe patterns (a 2000-expansion monster is not brace-free... it IS
//   braces, but so is the harmless `{js,jsx}`) and fail safe ones. The real
//   axis is the expansion count. Evidence: docs/agent-alignment-l2-evidence.md
//   §4c.
//
// DEPENDS ON:
//   Packages:  none. Matching uses git's own pathspec engine via
//              `git ls-files -- ':(glob)…'`, deliberately NOT a node glob
//              library — the roadmap notes the gitignore-semantics package is
//              present only as a hoisted transitive dependency, and a linter
//              whose matcher fails to resolve would pass every glob it saw.
//              git cannot be silently absent in a git repo.
//   Internal:  reads .claude/rules/*.md frontmatter
//   Data:      reads → .claude/rules/*.md, the git index. Writes nothing.
//
// USAGE:
//   node scripts/agents/verify-rule-globs.mjs              # lint every rule
//   node scripts/agents/verify-rule-globs.mjs --self-test  # prove the checker
//   node scripts/agents/verify-rule-globs.mjs --json
//   Exit 1 on any error-level finding, 0 otherwise.
//
// NOTES / GOTCHAS:
//   - git's `:(glob)` semantics are CLOSE to the loader's but not proven
//     identical. This tool narrows the space of mistakes; it does not replace
//     an empirical check. Prove a new glob really fires with
//     scripts/instructions-loaded-report.mjs before relying on it.
//   - A rule with NO `paths:` is reported as unscoped and is NOT an error.
//     Unscoped is correct for anything carrying money, consent/TCPA,
//     server-authorization or shared-production-apply law, because
//     `paths:`-scoped rules are DROPPED AT /compact.
// ════════════════════════════════════════════════

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..', '..')
const RULES_DIR = path.join(REPO, '.claude', 'rules')

// Measured boundary is 512 ok / 1024 dead. Fail well below it: a pattern in the
// hundreds is already pathological for a hand-written path list, and the margin
// covers a loader that counts slightly differently than we do.
const FAIL_AT = 512
const WARN_AT = 32

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)

// ─── SECTION: Helpers ──────────────

/** Expand brace groups. Returns null once the count would exceed `cap`. */
export function expandBraces(pattern, cap = 4096) {
  let out = [pattern]
  for (;;) {
    const next = []
    let expandedAny = false
    for (const p of out) {
      const open = findTopLevelGroup(p)
      if (!open) { next.push(p); continue }
      expandedAny = true
      for (const alt of open.alts) next.push(p.slice(0, open.start) + alt + p.slice(open.end + 1))
      if (next.length > cap) return null
    }
    out = next
    if (!expandedAny) return out
    if (out.length > cap) return null
  }
}

/** Locate the first top-level {a,b} group, respecting nesting. */
function findTopLevelGroup(s) {
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  const alts = []
  let cur = ''
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') { depth++; if (depth === 1) continue }
    if (c === '}') { depth--; if (depth === 0) { alts.push(cur); return { start, end: i, alts } } }
    if (c === ',' && depth === 1) { alts.push(cur); cur = ''; continue }
    cur += c
  }
  return null // unbalanced brace — treated as literal
}

export function expansionCount(pattern) {
  const e = expandBraces(pattern)
  return e === null ? Infinity : e.length
}

/** The loader strips ONE trailing `/**`, then drops empties. */
export function stripTrailing(entry) {
  return entry.endsWith('/**') ? entry.slice(0, -3) : entry
}

/** A list that survives as nothing but `**` does not scope anything. */
export function reducesToUnconditional(entries) {
  const survivors = entries.map(stripTrailing).filter((s) => s.length > 0)
  return survivors.length > 0 && survivors.every((s) => s === '**')
}

function gitMatches(pattern) {
  try {
    const out = execFileSync('git', ['-C', REPO, 'ls-files', '-z', '--', `:(glob)${pattern}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    return out.split('\0').filter(Boolean)
  } catch {
    return []
  }
}

/** Union of matches across every brace expansion, capped for sanity. */
function matchesFor(entry) {
  const expansions = expandBraces(entry, FAIL_AT)
  if (expansions === null) return null // over budget; not worth matching
  const seen = new Set()
  for (const e of expansions.slice(0, 64)) for (const f of gitMatches(e)) seen.add(f)
  return [...seen]
}

/**
 * Split a YAML inline array on separators only, never inside a quoted item.
 *
 * A naive `.split(',')` shreds brace groups: `["a{b,c}d"]` becomes `a{b` and
 * `c}d`. That is not cosmetic — it silently disarms the expansion-budget check,
 * because the over-budget pattern never survives parsing as one glob. Caught by
 * the deliberate-breakage run, which is why that run exists.
 */
export function splitInlineArray(body) {
  const out = []
  let cur = ''
  let quote = null
  for (const ch of body) {
    if (quote) {
      if (ch === quote) { quote = null; continue }
      cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  out.push(cur.trim())
  return out.filter(Boolean)
}

/** Minimal frontmatter reader — only the `paths:` key, block or inline form. */
export function readPaths(text) {
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  const fm = text.slice(3, end)
  const inline = fm.match(/^\s*paths:\s*\[(.*)\]\s*$/m)
  if (inline) return splitInlineArray(inline[1])
  const block = fm.match(/^\s*paths:\s*\n((?:\s*-\s*.+\n?)+)/m)
  if (block) {
    return block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }
  if (/^\s*paths:\s*$/m.test(fm)) return []
  return null
}

// ─── SECTION: Self-test ──────────────

function selfTest() {
  const checks = []
  const eq = (name, actual, expected) =>
    checks.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })

  eq('no braces → 1', expansionCount('src/pages/**'), 1)
  eq('one group → 2', expansionCount('src/**/*.{js,jsx}'), 2)
  eq('two groups multiply', expansionCount('a{b,c}{d,e}'), 4)
  eq('nested groups', expansionCount('a{b,c{d,e}}'), 3)
  eq('10 binary groups = 1024', expansionCount('{a,b}'.repeat(10)), 1024)
  eq('9 binary groups = 512', expansionCount('{a,b}'.repeat(9)), 512)
  eq('unbalanced brace is literal', expansionCount('a{b,c'), 1)
  eq('expansion content', expandBraces('x{1,2}y'), ['x1y', 'x2y'])

  eq('strip one trailing /**', stripTrailing('src/pages/**'), 'src/pages')
  eq('no strip without /**', stripTrailing('src/pages'), 'src/pages')
  eq('all-** is unconditional', reducesToUnconditional(['**']), true)
  eq('bare /** reduces to empty, not unconditional', reducesToUnconditional(['/**']), false)
  eq('a real path is not unconditional', reducesToUnconditional(['src/pages/**']), false)
  eq('mixed list is not unconditional', reducesToUnconditional(['**', 'src/x']), false)

  eq('frontmatter inline', readPaths('---\npaths: ["a/**", "b.md"]\n---\nbody'), ['a/**', 'b.md'])
  // Regression: a naive comma split shreds brace groups and silently disarms
  // the budget check. Found by the deliberate-breakage run, not by review.
  eq('inline array keeps a brace group intact', readPaths('---\npaths: ["a{b,c}d"]\n---\n'), ['a{b,c}d'])
  eq('inline array, two items with braces', readPaths('---\npaths: ["x/*.{js,jsx}", "y/**"]\n---\n'), ['x/*.{js,jsx}', 'y/**'])
  eq('unquoted inline items still split', splitInlineArray('a/**, b.md'), ['a/**', 'b.md'])
  eq('block list keeps a brace group intact', readPaths('---\npaths:\n  - "a{b,c}d"\n---\n'), ['a{b,c}d'])
  eq('frontmatter block', readPaths('---\npaths:\n  - "a/**"\n  - b.md\n---\nbody'), ['a/**', 'b.md'])
  eq('no frontmatter → null', readPaths('# just a doc'), null)
  eq('frontmatter without paths → null', readPaths('---\nname: x\n---\n'), null)

  // The matcher must actually resolve. A linter whose matcher is broken passes
  // everything, which is the failure this whole file exists to prevent.
  const docsMd = gitMatches('docs/**/*.md')
  checks.push({ name: 'git matcher resolves and finds docs/**/*.md', ok: docsMd.length > 0, actual: `${docsMd.length} files`, expected: '>0' })
  const nonsense = gitMatches('this/path/does/not/exist/**')
  checks.push({ name: 'matcher rejects a nonexistent path', ok: nonsense.length === 0, actual: `${nonsense.length} files`, expected: '0' })
  // Ties the linter to the empirical result: the disputed shape matches here too.
  const disputed = matchesFor('docs/**/*.{md,txt}')
  checks.push({ name: 'disputed **/*.{md,txt} shape matches (as measured on both builds)', ok: (disputed || []).length > 0, actual: `${(disputed || []).length} files`, expected: '>0' })

  const failed = checks.filter((c) => !c.ok)
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n        got ${JSON.stringify(c.actual)}, want ${JSON.stringify(c.expected)}`}`)
  console.log(`\nself-test: ${checks.length - failed.length}/${checks.length} passed.`)
  return failed.length === 0 ? 0 : 1
}

// ─── SECTION: Lint ──────────────

function lint() {
  if (!existsSync(RULES_DIR)) { console.error(`no ${RULES_DIR}`); return 1 }
  const files = readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).sort()
  const findings = []
  let scoped = 0, unscoped = 0

  for (const f of files) {
    const rel = `.claude/rules/${f}`
    const entries = readPaths(readFileSync(path.join(RULES_DIR, f), 'utf8'))
    if (entries === null) { unscoped++; continue }
    scoped++

    if (entries.length === 0) {
      findings.push({ level: 'error', file: rel, glob: '(empty)', msg: 'paths: is present but empty — the rule loads for nothing. Remove the key or give it globs.' })
      continue
    }
    if (reducesToUnconditional(entries)) {
      findings.push({ level: 'error', file: rel, glob: entries.join(' '), msg: 'after trailing-/** stripping every entry is "**" — this rule is still UNCONDITIONAL. The conversion did nothing.' })
    }
    for (const e of entries) {
      const n = expansionCount(e)
      if (n >= FAIL_AT) {
        findings.push({ level: 'error', file: rel, glob: e, msg: `${n === Infinity ? '>4096' : n} brace expansions — at or past the loader's budget. Measured: 512 loads, 1024 never does. This rule would silently never load.` })
        continue
      }
      if (n >= WARN_AT) {
        findings.push({ level: 'warn', file: rel, glob: e, msg: `${n} brace expansions — well above a hand-written path list. Split it before it drifts past the budget.` })
      }
      const m = matchesFor(e)
      if (m && m.length === 0) {
        findings.push({ level: 'error', file: rel, glob: e, msg: 'matches no tracked file — dead glob (typo, or the path moved).' })
      }
    }
  }

  if (has('--json')) { console.log(JSON.stringify({ scoped, unscoped, findings }, null, 2)); return findings.some((x) => x.level === 'error') ? 1 : 0 }

  console.log(`.claude/rules: ${files.length} file(s) — ${scoped} scoped, ${unscoped} unscoped.`)
  console.log('')
  if (!findings.length) {
    console.log('No glob findings.')
    if (scoped === 0) {
      console.log('')
      console.log('NOTE: nothing is scoped yet, so this run proves only that the checker works.')
      console.log('It is not evidence that a future conversion is correct — re-run after P8/P9.')
    }
    return 0
  }
  for (const x of findings) console.log(`${x.level.toUpperCase().padEnd(5)} ${x.file}\n      glob: ${x.glob}\n      ${x.msg}`)
  const errors = findings.filter((x) => x.level === 'error').length
  console.log(`\n${errors} error(s), ${findings.length - errors} warning(s).`)
  return errors ? 1 : 0
}

process.exit(has('--self-test') ? selfTest() : lint())
