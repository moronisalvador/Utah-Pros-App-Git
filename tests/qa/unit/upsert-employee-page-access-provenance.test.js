/**
 * ════════════════════════════════════════════════
 * FILE: upsert-employee-page-access-provenance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves fresh database replay and the captured live database converge on the
 *   same exact upsert_employee_page_access catalog body before mobile S1h.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  permission_write_gates, the forward provenance reconciliation,
 *              its rollback, and the downstream S1h migration
 *   Data:      reads → repository source only
 *              writes → none
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const source = {
  original: read(
    'supabase/migrations/20260726220000_permission_write_gates.sql',
  ),
  forward: read(
    'supabase/migrations/20260727020000_upsert_employee_page_access_provenance_reconciliation.sql',
  ),
  rollback: read(
    'supabase/rollbacks/20260727020000_upsert_employee_page_access_provenance_reconciliation.rollback.sql',
  ),
  s1h: read(
    'supabase/migrations/20260727022920_mobile_personal_ownership_boundary.sql',
  ),
};

function body(sql) {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.upsert_employee_page_access\([\s\S]*?AS \$function\$(?<body>[\s\S]*?)\$function\$;/i,
  );
  expect(match).not.toBeNull();
  return match.groups.body;
}

function md5(value) {
  return createHash('md5').update(value).digest('hex');
}

function semantic(value) {
  return value
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('upsert_employee_page_access provenance reconciliation', () => {
  it('pins the exact source and live raw bodies while preserving semantics', () => {
    const originalBody = body(source.original);
    const forwardBody = body(source.forward);
    const rollbackBody = body(source.rollback);

    expect(md5(originalBody)).toBe('79d6b7e2f231cfa2d0038af1d0464ca0');
    expect(md5(forwardBody)).toBe('16e440632831b52155d5a9c6ba7b21a3');
    expect(md5(rollbackBody)).toBe('79d6b7e2f231cfa2d0038af1d0464ca0');
    expect(semantic(forwardBody)).toBe(semantic(originalBody));
    expect(semantic(rollbackBody)).toBe(semantic(originalBody));
  });

  it('accepts only the exact source/live input and converges on the live hash', () => {
    expect(source.forward).toContain(
      "migration.version IN ('20260726220000', '20260727012825')",
    );
    expect(source.forward).toContain(
      "'79d6b7e2f231cfa2d0038af1d0464ca0'",
    );
    expect(source.forward).toContain(
      "'16e440632831b52155d5a9c6ba7b21a3'",
    );
    expect(source.forward).toContain(
      "md5(procedure.prosrc) =\n               '16e440632831b52155d5a9c6ba7b21a3'",
    );
    const outsideFunctionBody = source.forward.replace(
      /AS \$function\$[\s\S]*?\$function\$;/i,
      'AS $function$<preserved function body>$function$;',
    );
    expect(outsideFunctionBody.toLowerCase()).not.toMatch(
      /\b(?:insert into|update|delete from)\s+(?:public\.)?[a-z_]/,
    );
  });

  it('keeps execution least-privileged and the rollback downstream-guarded', () => {
    for (const sql of [source.forward, source.rollback]) {
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      expect(normalized).toContain(
        'revoke execute on function public.upsert_employee_page_access(uuid, text, boolean, uuid) from public, anon, authenticated, service_role',
      );
      expect(normalized).toContain(
        'grant execute on function public.upsert_employee_page_access(uuid, text, boolean, uuid) to authenticated, service_role',
      );
    }

    expect(source.rollback).toContain(
      'upr.allow_employee_page_access_provenance_rollback',
    );
    expect(source.rollback).toContain(
      'public.is_current_active_internal_employee(uuid)',
    );

    const normalizedRollback = source.rollback
      .replace(/\s+/g, ' ')
      .toLowerCase();
    expect(normalizedRollback).toContain(
      "procedure.proname = 'upsert_employee_page_access'",
    );
    expect(normalizedRollback).toContain("procedure.prokind = 'f'");
    expect(normalizedRollback).toContain(
      'and not procedure.proisstrict and not procedure.proleakproof',
    );
    expect(normalizedRollback).toContain("procedure.proparallel = 'u'");
    expect(normalizedRollback).toContain(
      "pg_get_function_arguments(procedure.oid) = 'p_employee_id uuid, p_nav_key text, p_can_view boolean, p_updated_by uuid default null::uuid'",
    );
    expect(normalizedRollback).toContain(
      "pg_get_function_result(procedure.oid) = 'employee_page_access'",
    );
    expect(normalizedRollback).toContain(
      "'postgres>authenticated:execute:not_grantable'",
    );
    expect(normalizedRollback).toContain(
      "'postgres>postgres:execute:not_grantable'",
    );
    expect(normalizedRollback).toContain(
      "'postgres>service_role:execute:not_grantable'",
    );
    expect(normalizedRollback).toContain(
      "and md5(procedure.prosrc) = '79d6b7e2f231cfa2d0038af1d0464ca0'",
    );
  });

  it('orders the forward reconciliation before S1h and makes it a dependency', () => {
    const normalizedS1h = source.s1h.replace(/\s+/g, ' ');

    expect(
      '20260727020000'.localeCompare('20260727022920'),
    ).toBeLessThan(0);
    expect(normalizedS1h).toContain(
      "name = 'upsert_employee_page_access_provenance_reconciliation'",
    );
    expect(normalizedS1h).toContain(
      "md5(p.prosrc) = '16e440632831b52155d5a9c6ba7b21a3'",
    );
  });
});
