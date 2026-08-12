/**
 * ════════════════════════════════════════════════
 * FILE: payments-qbo-realm-scoping.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the change that records WHICH QuickBooks company a payment came from.
 *   QuickBooks gives each payment a small number, and every company restarts that
 *   numbering from 1 — so company A's payment #482 and company B's payment #482
 *   look the same to us. When QuickBooks says a payment was voided or deleted,
 *   our cleanup used to find rows by that number alone and delete them, which
 *   could silently delete a leftover row from an older QuickBooks connection.
 *   These checks read the files and prove, without needing any database
 *   password, that the company id is now written everywhere a payment number is
 *   written, and that destructive cleanup filters on an exact current company.
 *   Rows with no recorded company are preserved for explicit reconciliation.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  the realm-scoping migration and its rollback, the receipt repair
 *              it replaces bodies from, and the four Worker files that write or
 *              clear a QBO payment id
 *   Data:      reads  → repository SQL and JS source
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These prove SOURCE INTENT, not that the migration was applied and not that
 *     a real void succeeds. Behavioral proof belongs to the db lane against an
 *     isolated database, which does not run in the credential-free lanes.
 *     Worker-level behavior is proven in functions/lib/qbo-payment-sync.test.js.
 *   - The trap this guards: treating a NULL realm as "still ours" lets a terminal
 *     event delete an unattributed row whose company cannot be proven. NULL rows
 *     must remain for explicit reconciliation.
 *   - The second trap: the cleanup predicate does not filter on receipt_id, so it
 *     reaches receipt PROJECTIONS too. That is why both receipt RPCs have to
 *     stamp the realm — scoping the query alone would not have covered them.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const MIGRATION = 'supabase/migrations/20260808070000_payments_qbo_realm_scoping.sql';
const ROLLBACK = 'supabase/rollbacks/20260808070000_payments_qbo_realm_scoping.rollback.sql';
const PREDECESSOR = 'supabase/migrations/20260805010000_qbo_receipt_service_role_check_repair.sql';

const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const predecessor = read(PREDECESSOR);
const sync = read('functions/lib/qbo-payment-sync.js');

// The two SECURITY DEFINER routines that write per-invoice payment projections.
const PROJECTION_FUNCTIONS = [
  { name: 'finalize_qbo_payment_receipt', signature: 'public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb)' },
  { name: 'reconcile_qbo_payment_receipt', signature: 'public.reconcile_qbo_payment_receipt(jsonb, jsonb, text, text)' },
];

/** Every `INSERT INTO public.payments (...)` column list in a SQL source. */
const paymentsInsertColumnLists = (sql) => [...sql.matchAll(
  /INSERT INTO public\.payments\s*\(([^)]*)\)/g,
)].map((match) => match[1].replace(/\s+/g, ' ').trim());

/**
 * Executable SQL only — `--` comment lines stripped.
 *
 * The destructive-DDL checks below MUST run on this, not on the raw file: these
 * migrations explain themselves at length, and a header that says "no ALTER
 * COLUMN, no DROP" would otherwise fail the very check asserting it does none.
 * A test that a truthful comment can break teaches people to delete comments.
 */
const sqlOnly = (sql) => sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');

describe('payments.qbo_realm_id — the column', () => {
  it('is added additively and nullable, with no backfill', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.payments\s+ADD COLUMN IF NOT EXISTS qbo_realm_id text;/,
    );
    // Nullable is the whole design: NOT NULL on a live table is forbidden
    // (database-standard.md §3) and a DEFAULT would fabricate attribution.
    expect(migration).not.toMatch(/qbo_realm_id text[^;]*NOT NULL/);
    expect(migration).not.toMatch(/qbo_realm_id text[^;]*DEFAULT/);
    expect(migration).not.toMatch(/UPDATE public\.payments/);
  });

  it('is additive-only — no destructive DDL anywhere in the migration', () => {
    const sql = sqlOnly(migration);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|POLICY|INDEX|TRIGGER)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE[^;]*\bRENAME\b/i);
    expect(sql).not.toMatch(/\bALTER\s+COLUMN\b/i);
    // No owner-reviewed destructive marker means none was needed.
    expect(migration).not.toMatch(/--\s*destructive-approved:/i);
  });

  it('ships a paired rollback that deliberately does NOT drop the column', () => {
    expect(rollback.length).toBeGreaterThan(0);
    // Dropping a live column is the contract removal database-standard.md §3
    // forbids. The DROP is present only as a commented, separately-reviewed note.
    expect(rollback).toMatch(/--\s*ALTER TABLE public\.payments DROP COLUMN qbo_realm_id;/);
    expect(rollback).not.toMatch(/^\s*ALTER TABLE public\.payments DROP COLUMN/m);
  });
});

describe('payments.qbo_realm_id — the receipt projections carry it', () => {
  it.each(PROJECTION_FUNCTIONS)('$name is replaced body-only, signature intact', ({ signature }) => {
    expect(migration).toContain(`CREATE OR REPLACE FUNCTION ${signature.replace(/\(.*/, '')}(`);
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
  });

  it('stamps qbo_realm_id on every payments projection insert', () => {
    const lists = paymentsInsertColumnLists(migration);
    expect(lists).toHaveLength(2); // finalize + reconcile
    for (const columns of lists) {
      expect(columns).toContain('qbo_payment_id');
      expect(columns).toContain('qbo_realm_id');
    }
    // The value written is the validated realm, not a literal or a guess.
    expect(migration.match(/v_qbo_payment_id, v_qbo_realm_id, now\(\), NULL\)/g)).toHaveLength(2);
    // And a re-reconcile refreshes it, which is what lets historical rows heal.
    expect(migration.match(/qbo_realm_id = EXCLUDED\.qbo_realm_id,/g)).toHaveLength(2);
  });

  it('preserves the 2026-08-06 service-role gate verbatim in both bodies', () => {
    // The repaired predicate. current_user is the trap: these are SECURITY
    // DEFINER, so it resolves to the OWNER, not the caller.
    expect(migration.match(/IF auth\.role\(\) <> 'service_role' THEN RAISE EXCEPTION 'NOT_AUTHORIZED'/g))
      .toHaveLength(2);
    expect(migration).not.toContain('request.jwt.claim.role');
    expect(migration).not.toMatch(/IF current_user/);
  });

  it('re-asserts REVOKE before GRANT for both replaced functions', () => {
    for (const { signature } of PROJECTION_FUNCTIONS) {
      const revoke = migration.indexOf(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
      const grant = migration.indexOf(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
      expect(revoke).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(revoke); // revoke must precede grant
    }
    // Never widened beyond the service role.
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION[^;]*TO (anon|authenticated|PUBLIC)/);
  });

  it('changes the two bodies ONLY by the realm tokens (fidelity vs the predecessor)', () => {
    // Anything else that moved would be an unreviewed change riding along in a
    // body replace of two live money RPCs.
    const bodyOf = (sql, name) => {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      return sql.slice(start, sql.indexOf('$function$;', start));
    };
    for (const { name } of PROJECTION_FUNCTIONS) {
      const before = bodyOf(predecessor, name);
      const after = bodyOf(migration, name);
      expect(before.length).toBeGreaterThan(0);
      // Strip exactly the three added tokens; the result must be identical.
      const normalized = after
        .replace(', qbo_payment_id, qbo_realm_id, qbo_synced_at', ', qbo_payment_id, qbo_synced_at')
        .replace('v_qbo_payment_id, v_qbo_realm_id, now()', 'v_qbo_payment_id, now()')
        .replace(/\n\s*qbo_realm_id = EXCLUDED\.qbo_realm_id,/, '');
      expect(normalized).toBe(before);
    }
  });

  it('rollback restores both predecessor bodies byte-for-byte', () => {
    const bodyOf = (sql, name) => {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      return sql.slice(start, sql.indexOf('$function$;', start));
    };
    for (const { name } of PROJECTION_FUNCTIONS) {
      expect(bodyOf(rollback, name)).toBe(bodyOf(predecessor, name));
    }
    // And it refuses to run against bodies it was not written to undo.
    expect(rollback).toMatch(/ROLLBACK REFUSED/);
  });
});

describe('payments.qbo_realm_id — the cleanup predicate', () => {
  it('scopes the removal by realm', () => {
    expect(sync).toContain('qbo_payment_id=eq.${qboPaymentId}&source=eq.qbo${qboRealmScopeFilter(realmId)}&select=id');
  });

  it('requires an exact current realm and never selects an unattributed row', () => {
    expect(sync).toContain('&qbo_realm_id=eq.${encodeURIComponent(realm)}');
    expect(sync).not.toContain('qbo_realm_id.is.null');
  });

  it('only interpolates a constrained realm into the PostgREST predicate', () => {
    // Punctuation must never reshape a destructive filter.
    expect(sync).toMatch(/if \(!\/\^\[A-Za-z0-9_-\]\+\$\/\.test\(realm\)\) return '';/);
  });

  it('scopes the snapshot read that drives the retraction, not just the delete', () => {
    const removal = sync.slice(sync.indexOf('export async function removeQboPaymentFromUpr'));
    const snapshot = removal.slice(0, removal.indexOf('let removedReceipt'));
    expect(snapshot).toContain('qboRealmScopeFilter(realmId)');
  });
});

describe('payments.qbo_realm_id — every writer of qbo_payment_id stamps it', () => {
  // If a writer sets the payment id without the realm, it silently manufactures
  // another unattributed row and the fix erodes from the day it ships.
  it.each([
    ['functions/lib/qbo-payment-sync.js', 'legacy importer insert'],
    ['functions/api/qbo-payment.js', 'UPR payment pushed to QBO'],
  ])('%s stamps the realm (%s)', (file) => {
    expect(read(file)).toMatch(/qbo_realm_id:/);
  });

  it('keeps the source-disabled legacy delete route from clearing either QBO id field', () => {
    const file = 'functions/api/qbo-payment.js';
    const source = read(file);
    const clears = [...source.matchAll(/qbo_payment_id:\s*null/g)];
    expect(clears).toHaveLength(0);
  });
});
