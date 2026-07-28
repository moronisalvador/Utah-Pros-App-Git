// ════════════════════════════════════════════════
// FILE: scripts/block-destructive-sql.node-test.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Proves the database safety guard actually refuses dangerous work, by
//   feeding it real request payloads and checking it says no. A guard that
//   has only ever run on a healthy tree has not been tested — so most of
//   these cases are deliberately bad on purpose.
//
// DEPENDS ON:
//   Internal: .claude/hooks/block-destructive-sql.sh (the canonical guard body)
//   Data:     reads  → nothing
//             writes → nothing (the guard never touches the database)
//
// NOTES / GOTCHAS:
//   - Exit 2 means BLOCK. Exit 0 means allow. Exit 1 is non-blocking in both
//     Claude Code and Codex, so exit 1 from this guard would be a defect: a
//     crash must never read as permission. Cases assert the exact code.
//   - Requires bash and node on PATH. The guard parses payloads with node, NOT
//     jq: jq is absent from the owner's machine and from most CI images, and
//     depending on it made the tool-aware layers (rollback requirement,
//     unfiltered-write refusal, fail-closed-on-unreadable-SQL) silently INERT
//     while the suite still reported success.
// ════════════════════════════════════════════════

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const GUARD = path.join(REPO, '.claude', 'hooks', 'block-destructive-sql.sh')

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0
const hasNode = spawnSync('bash', ['-c', 'command -v node']).status === 0

function run(payload) {
  const res = spawnSync('bash', [GUARD], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
  })
  return { code: res.status, stderr: res.stderr || '' }
}

const sqlCall = (tool, query) => ({ tool_name: tool, tool_input: { query } })

// Each case: [label, payload, expected exit code, needsNode]
const CASES = [
  // ── fail-closed behaviour ──
  ['empty payload is refused, not permitted', '', 2, false],
  ['whitespace-only payload is refused', '   \n  ', 2, false],

  // ── data-destroying DDL ──
  ['DROP TABLE', sqlCall('mcp__x__execute_sql', 'DROP TABLE contacts;'), 2, false],
  ['TRUNCATE', sqlCall('mcp__x__execute_sql', 'TRUNCATE messages;'), 2, false],

  // ── TRUNCATE: statement vs privilege NAME (2026-07-27) ──
  // TRUNCATE is a GRANT-able privilege as well as a statement. The guard used a
  // bare substring match, which refused all four mobile-security migrations and
  // all four of their rollbacks — every one a false positive, because they only
  // ever name the privilege. These cases pin BOTH directions so the narrowing
  // cannot silently widen back, and the statement forms cannot regress to allow.
  ['TRUNCATE TABLE form still blocked', sqlCall('mcp__x__execute_sql', 'TRUNCATE TABLE employees;'), 2, false],
  ['TRUNCATE ONLY form still blocked', sqlCall('mcp__x__execute_sql', 'TRUNCATE ONLY employees;'), 2, false],
  ['TRUNCATE multi-table still blocked', sqlCall('mcp__x__execute_sql', 'TRUNCATE jobs, claims;'), 2, false],
  ['TRUNCATE RESTART IDENTITY still blocked', sqlCall('mcp__x__execute_sql', 'TRUNCATE public.jobs RESTART IDENTITY;'), 2, false],
  ['TRUNCATE CASCADE still blocked', sqlCall('mcp__x__execute_sql', 'TRUNCATE jobs CASCADE;'), 2, false],
  ['TRUNCATE quoted identifier still blocked', sqlCall('mcp__x__execute_sql', 'TRUNCATE "employees";'), 2, false],
  ['TRUNCATE after a semicolon still blocked', sqlCall('mcp__x__execute_sql', 'SELECT 1; TRUNCATE jobs;'), 2, false],
  ['TRUNCATE inside DO $$ still blocked', sqlCall('mcp__x__execute_sql', 'DO $$ BEGIN TRUNCATE employees; END $$;'), 2, false],
  ['DROP COLUMN', sqlCall('mcp__x__execute_sql', 'ALTER TABLE jobs DROP COLUMN notes;'), 2, false],
  ['DROP CONSTRAINT', sqlCall('mcp__x__execute_sql', 'ALTER TABLE jobs DROP CONSTRAINT jobs_pkey;'), 2, false],
  ['RENAME COLUMN', sqlCall('mcp__x__execute_sql', 'ALTER TABLE jobs RENAME COLUMN a TO b;'), 2, false],
  ['DISABLE RLS', sqlCall('mcp__x__execute_sql', 'ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;'), 2, false],
  ['ALTER COLUMN TYPE', sqlCall('mcp__x__execute_sql', 'ALTER TABLE jobs ALTER COLUMN total TYPE numeric;'), 2, false],

  // ── rules that were prose-only until now ──
  ['SET NOT NULL tightens a live column', sqlCall('mcp__x__execute_sql', 'ALTER TABLE jobs ALTER COLUMN owner_id SET NOT NULL;'), 2, false],
  ['GRANT TO anon is refused', sqlCall('mcp__x__execute_sql', 'GRANT EXECUTE ON FUNCTION f() TO anon;'), 2, false],

  // ── mass data mutation ──
  ['DELETE without WHERE', sqlCall('mcp__x__execute_sql', 'DELETE FROM messages;'), 2, false],
  ['UPDATE without WHERE', sqlCall('mcp__x__execute_sql', 'UPDATE contacts SET opt_in_status = true;'), 2, false],

  // ── comment-based evasion the previous guard missed ──
  ['block-comment evasion DROP/**/TABLE', sqlCall('mcp__x__execute_sql', 'DROP/**/TABLE contacts;'), 2, false],

  // ── the free-form SQL tool that had zero coverage before today ──
  ['upr_sql reaching DROP TABLE', sqlCall('mcp__x__upr_sql', 'drop table contacts;'), 2, false],
  ['upr_sql with no readable SQL parameter', { tool_name: 'mcp__x__upr_sql', tool_input: { foo: 'bar' } }, 2, true],

  // ── row-scoped write tools ──
  ['upr_delete with no filter is a mass delete', { tool_name: 'mcp__x__upr_delete', tool_input: { table: 'contacts' } }, 2, true],
  ['upr_update with no filter is a mass update', { tool_name: 'mcp__x__upr_update', tool_input: { table: 'contacts', data: {} } }, 2, true],

  // ── the rollback requirement: irreversible becomes recoverable ──
  ['apply_migration with no ROLLBACK section', { tool_name: 'mcp__x__apply_migration', tool_input: { name: 'm', query: 'CREATE TABLE t (id uuid);' } }, 2, true],

  // ── legitimate work must still pass ──
  ['additive CREATE TABLE', sqlCall('mcp__x__execute_sql', 'CREATE TABLE t (id uuid primary key);'), 0, false],
  ['recoverable DROP FUNCTION', sqlCall('mcp__x__execute_sql', 'DROP FUNCTION IF EXISTS f();'), 0, false],
  ['DROP POLICY for an idempotent migration', sqlCall('mcp__x__execute_sql', 'DROP POLICY IF EXISTS p ON t;'), 0, false],
  ['UPDATE with WHERE', sqlCall('mcp__x__execute_sql', "UPDATE contacts SET opt_in_status = true WHERE id = '1';"), 0, false],
  ['ENABLE RLS', sqlCall('mcp__x__execute_sql', 'ALTER TABLE t ENABLE ROW LEVEL SECURITY;'), 0, false],
  ['apply_migration WITH a ROLLBACK section', { tool_name: 'mcp__x__apply_migration', tool_input: { name: 'm', query: '-- ROLLBACK: DROP TABLE t;\nCREATE TABLE t (id uuid);' } }, 0, true],
  ['upr_delete WITH a filter', { tool_name: 'mcp__x__upr_delete', tool_input: { table: 'contacts', filter: 'id=eq.1' } }, 0, true],

  // ── the three legitimate TRUNCATE-as-privilege-NAME forms must PASS ──
  // Each is taken from the shape the real mobile-security migrations use.
  ['quoted TRUNCATE privilege literal passes', sqlCall('mcp__x__execute_sql', "SELECT ARRAY['SELECT','TRUNCATE','UPDATE']::text[];"), 0, false],
  ['quoted comma-joined privilege list passes', sqlCall('mcp__x__execute_sql', "SELECT 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN';"), 0, false],
  ['REVOKE naming TRUNCATE as a privilege passes', sqlCall('mcp__x__execute_sql', 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLE t FROM authenticated;'), 0, false],
  ['GRANT naming TRUNCATE as a privilege passes', sqlCall('mcp__x__execute_sql', 'GRANT SELECT, INSERT, TRUNCATE, TRIGGER ON TABLE t TO service_role;'), 0, false],
]

test('database guard: blocks what it must, permits legitimate work, never exits 1', (t) => {
  if (!hasBash) {
    t.skip('bash unavailable on this machine')
    return
  }
  assert.ok(existsSync(GUARD), `canonical guard body missing at ${GUARD}`)

  const failures = []
  for (const [label, payload, expected, needsNode] of CASES) {
    if (needsNode && !hasNode) continue
    const { code, stderr } = run(payload)
    if (code === 1) {
      failures.push(`${label}: exited 1, which is NON-BLOCKING in both tools — a crash must not read as permission`)
      continue
    }
    if (code !== expected) {
      failures.push(`${label}: expected exit ${expected}, got ${code}${stderr ? ` (stderr: ${stderr.split('\n')[0]})` : ''}`)
      continue
    }
    if (expected === 2 && !/^BLOCKED — /m.test(stderr)) {
      failures.push(`${label}: blocked but gave no "BLOCKED — <reason>" line on stderr`)
    }
  }

  assert.deepEqual(failures, [], `\n  - ${failures.join('\n  - ')}\n`)
})
