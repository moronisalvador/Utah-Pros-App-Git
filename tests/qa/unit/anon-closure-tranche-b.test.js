/**
 * ════════════════════════════════════════════════
 * FILE: anon-closure-tranche-b.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the tranche (b) anon-closure migration as TEXT and checks it still says
 *   what it is supposed to say. No database required.
 *
 *   Same reason as tranche (a): keep an always-visible, credential-free source
 *   contract even though the JavaScript behavioral proof now runs in hosted CI
 *   against qa-staging. This catches a weakened migration before a database call;
 *   the hosted proof establishes effect.
 *
 *   The specific thing being guarded: this migration must close `anon` WITHOUT
 *   touching `authenticated`. Getting that wrong in either direction is bad —
 *   leaving anon open keeps the customer list on the public internet, while
 *   catching `authenticated` would lock every employee out of Customers,
 *   Conversations and the whole CRM.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260727143000_anon_closure_tranche_b.sql
 *              supabase/rollbacks/20260727143000_anon_closure_tranche_b.rollback.sql
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot tell you the revoke applied — only
 *     that the source still asks for it. Live verification is the apply-window step
 *     plus supabase/tests/anon_closure_tranche_b.test.js.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = join(ROOT, 'supabase/migrations/20260727143000_anon_closure_tranche_b.sql');
const ROLLBACK = join(ROOT, 'supabase/rollbacks/20260727143000_anon_closure_tranche_b.rollback.sql');

const read = (p) => readFileSync(p, 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();

/**
 * Statement-level assertions must read STATEMENTS, not comments. This migration's
 * header explains in prose that it "revokes table privileges from the anon role"
 * and "touches no `authenticated` policy" — and because comments contain no
 * semicolons, a naive /revoke[^;]*authenticated/ matches straight across that
 * sentence and fails on the documentation rather than the SQL. Strip `--` comments
 * first. (Caught by this very test on first run.)
 */
const stripComments = (s) => s.replace(/--[^\r\n]*/g, '');
const stmts = (s) => norm(stripComments(s));

const TABLES = ['contacts', 'conversations', 'conversation_participants'];
const ANON_POLICIES = [
  'allow_anon_read_contacts',
  'allow_anon_update_contacts',
  'allow_anon_insert_contacts',
  'allow_anon_read_conversations',
  'allow_anon_update_conversations',
  'allow_anon_insert_conversations',
  'allow_anon_read_conversation_participants',
  'allow_anon_insert_conversation_participants',
];

describe('anon closure tranche (b) — migration source contract', () => {
  const raw = read(MIGRATION);
  const sql = norm(raw);        // full text, header included — for prose assertions
  const code = stmts(raw);      // statements only — for behaviour assertions

  it('exists alongside a rollback (database-standard.md §6)', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it('drops every anon policy that was live on the three tables', () => {
    for (const policy of ANON_POLICIES) {
      expect(code).toContain(`drop policy if exists ${policy}`);
    }
  });

  it('revokes anon table access on all three tables', () => {
    for (const table of TABLES) {
      expect(code).toMatch(new RegExp(`revoke all on table public\\.${table}\\s+from anon`));
    }
  });

  it('never revokes from authenticated — that would lock out every employee', () => {
    // The 21 browser call sites all run as `authenticated`. Catching that role
    // here would break Customers, Conversations, the CRM and the tech screens.
    expect(code).not.toMatch(/revoke[^;]*from[^;]*authenticated/);
    expect(code).not.toMatch(/revoke[^;]*from[^;]*service_role/);
  });

  it('leaves the authenticated policies alone', () => {
    expect(code).not.toContain('drop policy if exists contacts_authenticated');
    expect(code).not.toContain('drop policy if exists allow_authenticated_conversations');
    expect(code).not.toContain('drop policy if exists allow_authenticated_conversation_participants');
  });

  it('creates and drops no table, column, index or function', () => {
    // Access change only — no schema, no data.
    expect(code).not.toMatch(/\bcreate table\b|\bdrop table\b|\balter table\b.*\b(add|drop) column\b/);
    expect(code).not.toMatch(/\bcreate (or replace )?function\b/);
    expect(code).not.toMatch(/\bcreate index\b|\bdrop index\b/);
  });

  it('changes no business data', () => {
    expect(code).not.toMatch(/\binsert into\b|\bupdate public\.|\bdelete from\b/);
  });

  it('declares its RED tier rather than claiming to be additive', () => {
    // A revoke that calls itself additive-only is how a reviewer gets misled.
    expect(sql).toContain('additive-only:');
    expect(sql).toContain('red tier');
  });

  it('records the deferred-bucket release it is relying on', () => {
    // db-foundation-wave-ownership.md §8 defers these tables; the release clause
    // requires committed backward-compat tests, so the migration must say so.
    expect(sql).toContain('deferred');
    expect(sql).toContain('§8');
  });
});

describe('anon closure tranche (b) — rollback source contract', () => {
  const raw = read(ROLLBACK);
  const sql = norm(raw);
  const code = stmts(raw);

  it('restores all eight anon policies', () => {
    for (const policy of ANON_POLICIES) {
      expect(code).toContain(`create policy ${policy}`);
    }
  });

  it('re-grants the anon table privileges that were revoked', () => {
    for (const table of TABLES) {
      expect(code).toMatch(new RegExp(`grant [^;]*on table public\\.${table}\\s+to anon`));
    }
  });

  it('warns what restoring actually re-opens', () => {
    // Whoever runs this at 3am should see the consequence before they do.
    expect(sql).toContain('every visitor');
  });
});
