/**
 * ════════════════════════════════════════════════
 * FILE: collections-nav-project-manager-grant.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the migration which gives project managers the sidebar
 *   "Collections" link says what it claims to say, and that the undo file removes
 *   exactly the one row it added — no more.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  supabase/migrations/20260808200000_collections_nav_project_manager_grant.sql,
 *              its paired rollback, src/App.jsx, src/lib/navItems.jsx
 *   Data:      reads  → source text only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. The behavioural proof is
 *     supabase/tests/collections_nav_project_manager_grant.test.sql, which runs
 *     only through npm run test:db:collections-nav-grant:local — the db lane is
 *     not part of the three credential-free lanes, so never present it as CI
 *     coverage (close-out-standard.md §2b).
 *   - The last two cases are the load-bearing ones. They pin the claim in the
 *     migration header that this grants no new capability, by asserting the two
 *     facts that make it true: the /collections route has no role guard, and no
 *     canAccess('collections') call exists anywhere in src/. If either changes,
 *     this row stops being cosmetic and the header becomes a lie.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20260808200000_collections_nav_project_manager_grant.sql';
const ROLLBACK = 'supabase/rollbacks/20260808200000_collections_nav_project_manager_grant.rollback.sql';

/** Source with `--` comment lines stripped, so prose cannot satisfy a code assertion. */
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('collections nav grant for project_manager', () => {
  it('inserts exactly one row, for exactly that nav_key and role', () => {
    const sql = code(MIGRATION);
    const values = [...sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/g)];
    // Two matches: the INSERT itself. (The proof's re-apply block lives in the
    // test file, not here.) Guard against a second row sneaking in.
    expect(values).toHaveLength(1);
    const [, navKey, role, canView, canEdit] = values[0];
    expect(navKey).toBe('collections');
    expect(role).toBe('project_manager');
    expect(canView).toBe('true');
    expect(canEdit).toBe('false');
  });

  it('is idempotent, so a repeat apply cannot overwrite a hand-tuned row', () => {
    expect(code(MIGRATION)).toContain('ON CONFLICT (nav_key, role) DO NOTHING');
  });

  it('is additive only — it creates, alters and drops nothing', () => {
    const sql = code(MIGRATION);
    for (const forbidden of ['DROP ', 'ALTER TABLE', 'CREATE TABLE', 'CREATE POLICY', 'GRANT ', 'REVOKE ', 'DELETE ', 'UPDATE ']) {
      expect(sql, `migration must not contain ${forbidden.trim()}`).not.toContain(forbidden);
    }
    // database-standard.md §5 — the executor owns the transaction.
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/m);
  });

  it('leaves the dead `manager` row alone rather than opportunistically cleaning it', () => {
    // manager is not in employee_role, so that row grants nobody anything.
    // Removing it would be a destructive change for zero behavioural gain.
    expect(code(MIGRATION)).not.toContain("'manager'");
    expect(code(ROLLBACK)).not.toContain("'manager'");
  });

  it('the rollback removes exactly one row, keyed on BOTH halves of the pair', () => {
    const sql = code(ROLLBACK);
    expect(sql).toContain("nav_key = 'collections'");
    expect(sql).toContain("role = 'project_manager'");
    // Losing either predicate is silently catastrophic in a different direction:
    // without the role half, admin/manager/office lose the link; without the
    // nav_key half, project_manager loses every permission it holds.
    expect(sql).toMatch(/DELETE FROM public\.nav_permissions\s+WHERE nav_key = 'collections'\s+AND role = 'project_manager';/);
    expect(sql).not.toContain('IN (');
    expect(read(ROLLBACK)).toContain('-- destructive-approved:');
  });

  it('the /collections route carries NO role guard — so this grants no access', () => {
    // The migration header claims this row is nav visibility only. That claim
    // rests on the route being flag-gated and nothing more; a RoleRoute appearing
    // here would mean the row now gates real access and the header is wrong.
    const app = read('src/App.jsx');
    const at = app.indexOf('<Route path="collections" element={');
    expect(at, '/collections route not found').toBeGreaterThan(-1);
    const route = app.slice(at, app.indexOf('} />', at));
    expect(route).toContain('FeatureRoute flag="page:collections"');
    expect(route).not.toContain('RoleRoute');
  });

  it('nothing in src/ calls canAccess("collections") — the key drives the sidebar only', () => {
    const offenders = walk(join(ROOT, 'src'))
      .filter((file) => /canAccess\(\s*['"]collections['"]\s*\)/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length + 1));
    expect(
      offenders,
      'a canAccess("collections") call would make this row gate real behaviour, not just the sidebar link',
    ).toEqual([]);
  });
});
