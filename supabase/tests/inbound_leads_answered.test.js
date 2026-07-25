import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260725160000_inbound_leads_answered.sql',
  import.meta.url,
)), 'utf8');
const rollback = readFileSync(fileURLToPath(new URL(
  '../rollbacks/20260725160000_inbound_leads_answered.rollback.sql',
  import.meta.url,
)), 'utf8');

// The header deliberately DISCUSSES hazards it does not commit (the throwing
// cast in crm_call_is_answered, the rollback's DROP COLUMN). Assert executable
// SQL and prose separately, or the prose trips every "must not contain" check.
const sql = migration
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
// Comment prose with the leading dashes stripped and wrapping collapsed, so a
// phrase split across two comment lines still matches.
const prose = migration
  .split('\n')
  .filter((l) => l.trim().startsWith('--'))
  .map((l) => l.replace(/^\s*--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ');

// The generation expression, reimplemented exactly as the migration declares it.
// If the two ever diverge, the derivation cases below stop describing reality —
// so the first test pins the SQL text itself.
function derive(rawPayload) {
  const has = Object.prototype.hasOwnProperty.call(rawPayload, 'answered');
  if (!has) return null;
  const v = String(rawPayload.answered).toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

describe('inbound_leads.answered migration', () => {
  it('declares the column additively as a STORED generated boolean', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS answered boolean/);
    expect(migration).toMatch(/GENERATED ALWAYS AS \(/);
    expect(migration).toMatch(/\)\s*STORED;/);
    expect(migration).toContain('ALTER TABLE public.inbound_leads');
  });

  it('uses only IMMUTABLE operations, so the ALTER cannot fail on volatility', () => {
    const expr = migration.slice(migration.indexOf('GENERATED ALWAYS AS ('), migration.indexOf(') STORED;'));
    expect(expr).toContain("raw_payload ? 'answered'");
    expect(expr).toContain("lower(raw_payload->>'answered')");
    // No subquery, no now()/random(), no function call beyond lower().
    expect(expr).not.toMatch(/SELECT/i);
    expect(expr).not.toMatch(/now\(\)|random\(\)|current_/i);
  });

  it('string-compares and never casts — a malformed value must not throw', () => {
    // The executable SQL must carry no cast; the header may (and does) discuss
    // crm_call_is_answered's throwing cast as the hazard being avoided.
    expect(sql).not.toMatch(/->>'answered'\)::boolean/);
    expect(sql).toMatch(/lower\(raw_payload->>'answered'\) = 'true'/);
    expect(sql).toMatch(/lower\(raw_payload->>'answered'\) = 'false'/);
    expect(sql).toMatch(/ELSE NULL/);
  });

  it('derives true / false / unknown for every input shape', () => {
    expect(derive({ answered: 'true' })).toBe(true);
    expect(derive({ answered: 'True' })).toBe(true);   // case-insensitive
    expect(derive({ answered: 'false' })).toBe(false);
    expect(derive({ answered: 'FALSE' })).toBe(false);
    expect(derive({})).toBeNull();                      // key absent (call-started delivery)
    expect(derive({ answered: '' })).toBeNull();        // malformed
    expect(derive({ answered: 'maybe' })).toBeNull();   // malformed
    expect(derive({ answered: '0' })).toBeNull();       // deliberately NOT coerced to false
  });

  it('never coerces an unrecognized value toward "unanswered"', () => {
    // A wrong `false` texts a real person the wrong thing; a wrong NULL only
    // stays silent. Everything unrecognized must land on NULL.
    for (const v of ['0', '1', 'f', 't', 'no', 'yes', 'null', ' ']) {
      expect(derive({ answered: v })).not.toBe(false);
    }
  });

  it('does not repoint the countable-lead twins (reporting must not move)', () => {
    // The real guarantee: this migration defines/redefines no function at all,
    // so neither twin can move. (The COMMENT ON text does name
    // crm_call_is_answered() — as the pointer to where reporting still lives.)
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?FUNCTION\b/i);
    expect(prose).toContain('DELIBERATELY NOT CHANGED');
  });

  it('changes no policy, grant, or existing data', () => {
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|GRANT |REVOKE /);
    expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    // Only the ROLLBACK prose may mention DROP COLUMN; the migration must not do it.
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });

  it('carries the required header sections plus cited apply-window evidence', () => {
    expect(prose).toContain('WHAT THIS DOES');
    expect(prose).toContain('ADDITIVE-ONLY');
    expect(prose).toContain('APPLY WINDOW');
    expect(prose).toContain('ROLLBACK:');
    // The row count must be a measured figure, not an assertion.
    expect(prose).toMatch(/Measured live 2026-07-25[\s\S]*147 rows/);
    expect(prose).toMatch(/ACCESS EXCLUSIVE/);
    expect(prose).toMatch(/low-traffic window/);
  });
});

describe('inbound_leads.answered rollback', () => {
  it('drops exactly the one column and nothing else', () => {
    expect(rollback).toContain('ALTER TABLE public.inbound_leads DROP COLUMN IF EXISTS answered;');
    expect(rollback).not.toMatch(/DROP\s+TABLE/i);
    expect(rollback).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('states that removal is safe because the source of truth is raw_payload', () => {
    expect(rollback).toContain('PRECONDITION');
    expect(rollback).toMatch(/raw_payload\.answered/);
  });
});
