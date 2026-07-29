// ════════════════════════════════════════════════
// FILE: scripts/check-client-compat-migrations.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Before a migration takes away a table's permissions, this asks the one
//   question that actually matters: is there an app already installed on
//   somebody's phone that still reads that table directly? If yes, applying the
//   migration breaks that app, and no server deploy can fix it.
//
// WHY IT EXISTS:
//   On 2026-07-27 a migration revoked privileges on `employees`. Everything
//   looked clean — src/ had zero direct reads, because a refactor had already
//   moved them to RPCs. Login broke anyway. The INSTALLED Capacitor app ships
//   its bundle inside the binary (webDir: dist, no server.url), so it never
//   gets a server deploy; that bundle predated the refactor and still called
//   db.select('employees', ...). Capgo OTA was paused, so the only remedy was a
//   native rebuild.
//
//   The obvious check — "grep src/ for direct reads of RPC-only tables" — WOULD
//   HAVE PASSED. That is the whole point of this file. The question is not what
//   the source says today, it is what the shipped binary says. So this greps the
//   code AS OF each shipped build's commit, from ios/shipped-builds.json.
//
// DELIBERATELY NOT STRICT:
//   - No shipped commits recorded → WARN and exit 0. A check that blocks all
//     work until someone fills in a JSON file is the kind of gate people rip out.
//   - Only fires on migrations that actually revoke/restrict table privileges.
//   - A migration can acknowledge a known break with the marker below, for the
//     legitimate case of shipping a client rebuild alongside the migration:
//         -- client-compat: acknowledged — <reason>
//
// DEPENDS ON:
//   Packages:  none (node built-ins + git)
//   Internal:  ios/shipped-builds.json
//   Data:      reads → migration SQL, git history. Writes nothing.
//
// USAGE:
//   node scripts/check-client-compat-migrations.mjs                  # migrations not on origin/main
//   node scripts/check-client-compat-migrations.mjs --migration <p>  # one file
//   node scripts/check-client-compat-migrations.mjs --shipped <sha>  # override, for testing
// ════════════════════════════════════════════════

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const REGISTRY = path.join(REPO, 'ios', 'shipped-builds.json')

const argv = process.argv.slice(2)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }

const git = (args, opts = {}) => {
  try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }) }
  catch { return '' }
}

// ─── SECTION: Which migrations to check ──────────────
function targetMigrations() {
  const one = val('--migration')
  if (one) return [one.replace(/\\/g, '/')]
  // Default: migrations present here but not on origin/main — i.e. not yet released.
  const base = git(['rev-parse', '--verify', 'origin/main']).trim() ? 'origin/main' : 'HEAD~1'
  const out = git(['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', 'supabase/migrations'])
  return out.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.sql'))
}

// ─── SECTION: What does the migration take away? ──────────────
// Matches REVOKE ... ON [TABLE] [public.]<name> FROM ... <browser role>.
// A column-scoped GRANT after a blanket REVOKE still counts: a client doing
// select=* dies at the column-privilege layer, which is exactly what happened.
const BROWSER_ROLES = /\b(PUBLIC|ANON|AUTHENTICATED)\b/i
function restrictedTables(sql) {
  const found = new Set()
  const re = /REVOKE\s+[\s\S]*?\s+ON\s+(?:TABLE\s+)?(?:public\.)?("?[A-Za-z0-9_]+"?)\s+FROM\s+([^;]+);/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].replace(/"/g, '')
    // Skip function revokes — `ON FUNCTION` never reaches this group, but be safe.
    if (/^(EXECUTE|ALL)$/i.test(table)) continue
    if (BROWSER_ROLES.test(m[2])) found.add(table)
  }
  return [...found]
}

const ACK = /--\s*client-compat:\s*acknowledged/i

// ─── SECTION: Does a shipped build read that table directly? ──────────────
function directReadsAt(commit, table) {
  // The two shapes browser code uses. Deliberately narrow: an RPC call naming
  // the table in a string is not a direct read and must not trip this.
  const patterns = [
    `db\\.select\\(\\s*['"\`]${table}['"\`]`,
    `\\.from\\(\\s*['"\`]${table}['"\`]`,
  ]
  const hits = []
  for (const p of patterns) {
    const out = git(['grep', '-n', '-E', p, commit, '--', 'src'])
    for (const line of out.split('\n').filter(Boolean)) hits.push(line.replace(`${commit}:`, ''))
  }
  return hits
}

// ─── SECTION: Run ──────────────
const migrations = targetMigrations().filter((f) => existsSync(path.join(REPO, f)))
if (!migrations.length) {
  console.log('client-compat: no candidate migrations to check.')
  process.exit(0)
}

let registry = { builds: [] }
if (existsSync(REGISTRY)) {
  try { registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) } catch { /* fall through */ }
}
const override = val('--shipped')
const builds = override
  ? [{ version: 'override', build: override, commit: override }]
  : (registry.builds || []).filter((b) => b && b.commit)

const problems = []
let checkedAny = false

for (const rel of migrations) {
  const sql = readFileSync(path.join(REPO, rel), 'utf8')
  const tables = restrictedTables(sql)
  if (!tables.length) continue
  const acknowledged = ACK.test(sql)

  console.log(`\n${rel}`)
  console.log(`  restricts for browser roles: ${tables.join(', ')}`)

  if (!builds.length) {
    console.log('  ⚠  no shipped native build commit recorded in ios/shipped-builds.json —')
    console.log('     cannot tell whether an installed app still reads these. Record the')
    console.log('     commit of the last shipped build to make this check real.')
    continue
  }

  let anyHits = false
  for (const b of builds) {
    checkedAny = true
    const label = `${b.version || '?'} (build ${b.build || '?'}, ${String(b.commit).slice(0, 8)})`
    for (const t of tables) {
      const hits = directReadsAt(b.commit, t)
      if (!hits.length) continue
      anyHits = true
      console.log(`  ✗ shipped ${label} reads "${t}" directly:`)
      for (const h of hits.slice(0, 5)) console.log(`      ${h}`)
      if (hits.length > 5) console.log(`      …and ${hits.length - 5} more`)
      if (acknowledged) console.log('    (acknowledged in the migration — not failing)')
      else problems.push({ rel, table: t, build: label, hits: hits.length })
    }
  }
  // Say what actually happened. Printing a tick when reads WERE found and merely
  // waived would be the same species of lie this whole check exists to prevent.
  if (!anyHits) console.log('  ✓ no shipped build reads these directly')
  else if (acknowledged) console.log('  ! reads found, acknowledged by the migration — ship the client')
}

console.log('')
if (problems.length) {
  console.log(`client-compat: ${problems.length} shipped-client break(s).`)
  console.log('')
  console.log('An installed native app ships its bundle inside the binary, so a server')
  console.log('deploy does NOT reach it. Applying this migration breaks that app until a')
  console.log('native rebuild is released. Either ship the client first, or add')
  console.log('"-- client-compat: acknowledged — <reason>" to the migration if the rebuild')
  console.log('goes out alongside it.')
  process.exit(1)
}
console.log(checkedAny
  ? 'client-compat: no shipped build reads a table these migrations restrict.'
  : 'client-compat: nothing to verify (no restricting migrations, or no recorded builds).')
process.exit(0)
