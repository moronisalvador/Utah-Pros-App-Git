/**
 * ════════════════════════════════════════════════
 * FILE: tech-onboarding-state-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the tech-onboarding migration as TEXT and checks it still says what
 *   it is supposed to say. No database required.
 *
 *   This is the CI-visible contract for an authored-but-not-applied migration
 *   (close-out-standard.md §2b): it proves INTENT, not live effect. Behavioral
 *   verification belongs to the apply window.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260729220000_tech_onboarding_state.sql
 *              supabase/rollbacks/20260729220000_tech_onboarding_state.rollback.sql
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Assertions are whitespace/case-normalized substring checks, matching the
 *     anon-closure-tranche-a.test.js precedent.
 *   - The REVOKE-before-GRANT order checks are load-bearing: this managed
 *     project re-applies EXECUTE TO PUBLIC on every new function, so a grant
 *     that precedes its revoke would silently re-open the function.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260729220000_tech_onboarding_state.sql',
);
const ROLLBACK = path.join(
  ROOT,
  'supabase/rollbacks/20260729220000_tech_onboarding_state.rollback.sql',
);

const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const stripComments = (s) => s.replace(/--[^\n]*/g, '');
const read = (p) => readFileSync(p, 'utf8');

describe('tech onboarding state migration — source contract', () => {
  const raw = read(MIGRATION);
  // Statement-level assertions run against comment-stripped SQL so header
  // prose (e.g. the quoted ROLLBACK plan) cannot satisfy or trip them.
  const code = stripComments(raw);
  const sql = norm(code);

  it('creates the table with a composite primary key and bounded version', () => {
    expect(sql).toContain('create table public.employee_onboarding_state');
    expect(sql).toContain('primary key (employee_id, surface)');
    expect(sql).toContain(
      'references public.employees(id) on delete cascade',
    );
    expect(sql).toContain('check (version_seen >= 0 and version_seen <= 10000)');
  });

  it('is additive-only — no destructive DDL on live objects', () => {
    expect(sql).not.toContain('drop table public.');
    expect(sql).not.toContain('drop column');
    expect(sql).not.toContain('rename ');
    expect(sql).not.toMatch(/alter table public\.(?!employee_onboarding_state)/);
  });

  it('does not own the transaction (governed executor does)', () => {
    expect(sql).not.toMatch(/(^|[^a-z])begin\s*;/);
    expect(sql).not.toMatch(/commit\s*;/);
  });

  it('locks the table down: RLS enabled + forced, no browser-role grants', () => {
    expect(sql).toContain(
      'alter table public.employee_onboarding_state enable row level security',
    );
    expect(sql).toContain(
      'alter table public.employee_onboarding_state force row level security',
    );
    expect(sql).toContain(
      'revoke all privileges on table public.employee_onboarding_state from public, anon, authenticated',
    );
  });

  it('never grants anon anywhere', () => {
    // "anon" may appear only inside REVOKE statements.
    const grants = code.match(/GRANT[^;]+;/g) || [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(norm(grant)).not.toContain('anon');
      expect(norm(grant)).not.toContain('to public');
    }
  });

  for (const fn of [
    'get_my_onboarding_version_seen(text)',
    'ack_my_onboarding_seen(text, integer)',
  ]) {
    const name = fn.split('(')[0];

    it(`${name}: SECURITY DEFINER with pinned empty search_path`, () => {
      const body = sql.slice(sql.indexOf(`create function public.${name}`));
      const end = body.indexOf('$function$;');
      const fnSql = body.slice(0, end);
      expect(fnSql).toContain('security definer');
      expect(fnSql).toContain("set search_path to ''");
    });

    it(`${name}: validates the caller as an active internal employee`, () => {
      const body = sql.slice(sql.indexOf(`create function public.${name}`));
      const fnSql = body.slice(0, body.indexOf('$function$;'));
      expect(fnSql).toContain('auth.uid()');
      expect(fnSql).toContain('employee.is_active is true');
      expect(fnSql).toContain('employee.is_external is false');
      expect(fnSql).toContain('not_authorized: active internal employee required');
    });

    it(`${name}: validates the surface allowlist`, () => {
      const body = sql.slice(sql.indexOf(`create function public.${name}`));
      const fnSql = body.slice(0, body.indexOf('$function$;'));
      expect(fnSql).toContain("not in ('tech')");
    });

    it(`${name}: revokes PUBLIC/anon BEFORE granting`, () => {
      const revokeAt = sql.indexOf(
        `revoke execute on function public.${fn} from public, anon, authenticated, service_role`,
      );
      const grantAt = sql.indexOf(
        `grant execute on function public.${fn} to authenticated, service_role`,
      );
      expect(revokeAt).toBeGreaterThan(-1);
      expect(grantAt).toBeGreaterThan(-1);
      expect(revokeAt).toBeLessThan(grantAt);
    });
  }

  it('acknowledgement is monotonic (GREATEST upsert — replays cannot re-arm)', () => {
    expect(sql).toContain('on conflict (employee_id, surface)');
    expect(sql).toContain('greatest(');
  });

  it('carries a postcondition that fails the apply on a leaked grant', () => {
    expect(sql).toContain('postcondition');
    expect(sql).toContain('browser-role table grant leaked');
  });

  it('ships the documentation-standard header', () => {
    expect(raw).toContain('WHAT THIS DOES');
    expect(raw).toContain('ADDITIVE-ONLY');
    expect(raw).toContain('ROLLBACK:');
  });
});

describe('tech onboarding state migration — paired rollback', () => {
  it('exists and undoes exactly the three objects', () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const sql = norm(read(ROLLBACK));
    expect(sql).toContain(
      'drop function if exists public.get_my_onboarding_version_seen(text)',
    );
    expect(sql).toContain(
      'drop function if exists public.ack_my_onboarding_seen(text, integer)',
    );
    expect(sql).toContain(
      'drop table if exists public.employee_onboarding_state',
    );
  });
});
