/**
 * ════════════════════════════════════════════════
 * FILE: invoice-activity-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the invoice activity migration's promises visible in the CI lane that
 *   runs without any database password. It reads the migration and its rollback
 *   as text and checks they say what they claim: the record is service-owned,
 *   logged-out users cannot reach it, and the undo exists.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  the paired 20260804210000 migration and rollback
 *   Data:      source inspection only; this never contacts Supabase.
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It reads strings. Behavioural proof lives
 *     in the disposable local stack, and a passing run here is not evidence that
 *     anything was applied anywhere.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NAME = '20260804210000_invoice_activity';
const migration = readFileSync(join(ROOT, `supabase/migrations/${NAME}.sql`), 'utf8');
const rollback = readFileSync(join(ROOT, `supabase/rollbacks/${NAME}.rollback.sql`), 'utf8');

const WRITER = 'public.record_invoice_activity(uuid,uuid,text,text,text,jsonb)';
const READER = 'public.get_invoice_activity(uuid,integer,integer)';

// Destructive-keyword checks must read SQL, not prose. The header comment says
// "no rename", and matching that would fail a migration for describing itself
// accurately. This mirrors stripComments() in scripts/check-migration-hygiene.mjs.
const sqlOnly = (text) => text.replace(/'[^']*'/g, "''").replace(/--[^\n]*/g, '');
const migrationSql = sqlOnly(migration);

describe('invoice activity migration is additive', () => {
  it('removes nothing from a live table', () => {
    // DROP POLICY IF EXISTS on the policy this same file creates is the one
    // permitted drop -- it makes the migration re-runnable. Nothing else.
    const drops = [...migrationSql.matchAll(/\bDROP\s+(\w+)/gi)].map((m) => m[1].toUpperCase());
    expect(drops).toEqual(['POLICY']);
    expect(migrationSql).not.toMatch(/\bRENAME\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    // The hygiene script's destructive detector is not anchored to ALTER TABLE,
    // so this phrase anywhere in real SQL would fail CI.
    expect(migrationSql).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
  });

  it('adds the two send-review columns without a default or a not-null tightening', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS customer_message text;');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS send_cc_email text;');
    // A DEFAULT or a NOT NULL on an existing live table would rewrite it.
    expect(migration).not.toMatch(/ADD COLUMN IF NOT EXISTS (customer_message|send_cc_email)[^;]*(DEFAULT|NOT NULL)/i);
  });
});

describe('invoice activity is service-owned', () => {
  it('forces row level security rather than merely enabling it', () => {
    expect(migration).toContain('ALTER TABLE public.invoice_activity ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('ALTER TABLE public.invoice_activity FORCE ROW LEVEL SECURITY;');
  });

  it('gives browser roles no table privilege at all', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.invoice_activity FROM PUBLIC, anon, authenticated;');
    // The only table grant is to service_role.
    const tableGrants = [...migration.matchAll(/GRANT [^;]*ON TABLE public\.invoice_activity TO ([^;]+);/g)]
      .map((m) => m[1].trim());
    expect(tableGrants).toEqual(['service_role']);
  });

  it('never names anon in a grant or policy', () => {
    // database-standard.md §2: anon outside the public allowlist is a failure.
    expect(migration).not.toMatch(/GRANT[^;]*\banon\b/i);
    expect(migration).not.toMatch(/CREATE\s+POLICY[\s\S]{0,400}?\bTO\b[^;]*\banon\b/i);
  });

  it('refuses to store a token, secret or message body in free-form metadata', () => {
    expect(migration).toMatch(/safe_metadata \?\| ARRAY\['token', 'secret', 'password', 'authorization', 'body', 'message'\]/);
  });
});

describe('invoice activity function privileges', () => {
  it.each([
    ['writer', WRITER],
    ['reader', READER],
  ])('revokes %s from PUBLIC before granting it', (_label, signature) => {
    const revoke = migration.indexOf(`REVOKE EXECUTE ON FUNCTION ${signature}`);
    const grant = migration.indexOf(`GRANT EXECUTE ON FUNCTION ${signature}`);
    expect(revoke, signature).toBeGreaterThan(-1);
    expect(grant, signature).toBeGreaterThan(revoke);
  });

  it('keeps the writer service-role-only', () => {
    expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION ${WRITER} FROM PUBLIC, anon, authenticated;`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${WRITER} TO service_role;`);
  });

  it('lets a signed-in employee read but never a logged-out visitor', () => {
    expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION ${READER} FROM PUBLIC, anon;`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${READER} TO authenticated, service_role;`);
  });

  it('pins search_path on every definer', () => {
    const definers = migration.match(/SECURITY DEFINER/g) || [];
    const pinned = migration.match(/SET search_path = pg_catalog, public/g) || [];
    expect(definers.length).toBe(2);
    expect(pinned.length).toBe(definers.length);
  });
});

describe('invoice activity fails closed', () => {
  it('resolves the reader from auth.uid() and rejects an unauthorised role', () => {
    expect(migration).toContain('WHERE e.auth_user_id = auth.uid() AND e.is_active IS TRUE AND e.is_external IS FALSE');
    // Every name here must be a real public.employee_role enum member. 'manager'
    // is NOT one, despite claimUtils BILLING_EDIT_ROLES naming it, so listing it
    // would be a dead branch that reads like working authorization.
    expect(migration).toMatch(/v_role NOT IN \('admin', 'office', 'project_manager'\)/);
    expect(migration).not.toMatch(/v_role NOT IN \([^)]*'manager'[^)]*\)/);
    expect(migration).toMatch(/RAISE EXCEPTION 'NOT_AUTHORIZED[^']*' USING errcode = '42501'/);
  });

  it('re-checks a caller-supplied actor against the employee roster', () => {
    // A Worker passes the actor id; without this the audit trail is forgeable.
    expect(migration).toContain('NOT_AUTHORIZED: actor is not an active internal employee');
    expect(migration).toContain('WHERE e.id = p_actor_employee_id AND e.is_active IS TRUE AND e.is_external IS FALSE');
  });

  it('bounds the page size so the timeline cannot be pulled unbounded', () => {
    expect(migration).toMatch(/p_limit < 1 OR p_limit > 100/);
  });
});

describe('invoice activity rollback', () => {
  it('drops exactly the functions the migration creates', () => {
    const created = [...migration.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(/g)].map((m) => m[1]).sort();
    const dropped = [...rollback.matchAll(/DROP FUNCTION IF EXISTS (public\.\w+)\(/g)].map((m) => m[1]).sort();
    expect(dropped).toEqual(created);
  });

  it('drops the table, its policy and its index', () => {
    expect(rollback).toContain('DROP TABLE IF EXISTS public.invoice_activity;');
    expect(rollback).toContain('DROP POLICY IF EXISTS invoice_activity_service_all ON public.invoice_activity;');
    expect(rollback).toContain('DROP INDEX IF EXISTS public.invoice_activity_invoice_occurred_idx;');
  });

  it('does not drop the invoices columns, which would discard staff-authored text', () => {
    // The DROP text is present but commented, for a later reviewed destructive
    // change. Assert no UNCOMMENTED drop of either column.
    const live = rollback
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(live).not.toMatch(/DROP COLUMN IF EXISTS (customer_message|send_cc_email)/);
  });
});
