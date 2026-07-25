import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260725060000_fixed_automation_claims.sql',
  import.meta.url,
)), 'utf8');
const rollback = readFileSync(fileURLToPath(new URL(
  '../rollbacks/20260725060000_fixed_automation_claims.rollback.sql',
  import.meta.url,
)), 'utf8');

const FUNCS = [
  'claim_fixed_automation',
  'release_fixed_automation_claim',
  'finalize_fixed_automation_claim',
];

describe('fixed_automation_claims migration', () => {
  it('creates the claim table with the uniqueness fence that makes the claim atomic', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.fixed_automation_claims');
    expect(migration).toContain('CONSTRAINT fixed_automation_claims_unique_entity');
    expect(migration).toMatch(/UNIQUE \(automation_key, entity_id\)/);
    // The claim wins/loses purely on the unique index — no read-then-write race.
    expect(migration).toContain('ON CONFLICT ON CONSTRAINT fixed_automation_claims_unique_entity DO NOTHING');
    expect(migration).toContain('GET DIAGNOSTICS v_claimed = ROW_COUNT');
  });

  it('is a deny-all, RPC-only table: RLS on, no policy, no browser grant', () => {
    expect(migration).toContain('ALTER TABLE public.fixed_automation_claims ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.fixed_automation_claims FROM PUBLIC, anon, authenticated;');
    expect(migration).not.toMatch(/CREATE POLICY/i);
  });

  it('never grants anon, PUBLIC or authenticated anywhere', () => {
    const grants = migration.match(/GRANT[\s\S]*?;/g) || [];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g).toMatch(/TO service_role;/);
      expect(g).not.toMatch(/\banon\b/);
      expect(g).not.toMatch(/\bauthenticated\b/);
      expect(g).not.toMatch(/\bPUBLIC\b/);
    }
  });

  it.each(FUNCS)('%s is service-role only, invoker, with a pinned search_path', (fn) => {
    expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    expect(migration).toContain(`IF auth.role() <> 'service_role' THEN`);
    expect(migration).toContain(`RAISE EXCEPTION '${fn} is service-role only'`);
    // Explicit REVOKE before the GRANT — managed Supabase re-applies
    // EXECUTE TO PUBLIC to every new function at ddl_command_end.
    const revokeIdx = migration.indexOf(`REVOKE ALL ON FUNCTION public.${fn}(`);
    const grantIdx = migration.indexOf(`GRANT EXECUTE ON FUNCTION public.${fn}(`);
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeGreaterThan(revokeIdx);
    expect(migration.slice(revokeIdx, grantIdx)).toContain('FROM PUBLIC, anon, authenticated, service_role;');
  });

  it('declares every function SECURITY INVOKER with an empty search_path', () => {
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(FUNCS.length);
    expect(migration.match(/SET search_path = ''/g)).toHaveLength(FUNCS.length);
    expect(migration).not.toMatch(/SECURITY DEFINER/);
  });

  it('refuses to re-open a finalized claim (a completed send can never be resent)', () => {
    expect(migration).toContain('AND c.finalized_at IS NULL');
  });

  it('is additive-only — no ALTER/DROP/RENAME of anything live', () => {
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|POLICY|CONSTRAINT)/i);
    expect(migration).not.toMatch(/RENAME/i);
    // The only ALTER is enabling RLS on the brand-new table.
    const alters = migration.match(/ALTER TABLE[^;]*;/g) || [];
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('uses timestamptz throughout (database-standard.md §7)', () => {
    expect(migration).toMatch(/claimed_at timestamptz/);
    expect(migration).toMatch(/finalized_at timestamptz/);
    expect(migration).not.toMatch(/\btimestamp\s+without\s+time\s+zone\b/i);
  });

  it('carries the required migration header sections', () => {
    expect(migration).toContain('WHAT THIS DOES');
    expect(migration).toContain('ADDITIVE-ONLY');
    expect(migration).toContain('ROLLBACK:');
    // The deliberate no-stale-recovery decision must stay disclosed.
    expect(migration).toContain('NO stale-recovery window');
  });
});

describe('fixed_automation_claims rollback', () => {
  it('drops exactly the three functions and the table', () => {
    for (const fn of FUNCS) {
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${fn}(`);
    }
    expect(rollback).toContain('DROP TABLE IF EXISTS public.fixed_automation_claims;');
  });

  it('never touches the terminal system_events history', () => {
    // system_events is the durable "already fired" record; dropping claim rows
    // must not let a completed automation re-fire.
    expect(rollback).not.toMatch(/DELETE\s+FROM\s+public\.system_events/i);
    expect(rollback).not.toMatch(/DROP\s+TABLE[^;]*system_events/i);
  });

  it('states the deploy-order precondition', () => {
    expect(rollback).toContain('PRECONDITION');
    expect(rollback).toMatch(/pre-claim run-automations\.js FIRST/);
  });
});
