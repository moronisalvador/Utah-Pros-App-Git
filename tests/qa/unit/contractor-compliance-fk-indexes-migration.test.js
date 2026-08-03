// ═════════════════════════════════════════════════════════════════════════════
// FILE: contractor-compliance-fk-indexes-migration.test.js
// WHAT: Keeps every new contractor-compliance foreign key covered by a leading
//       index and proves the index-only migration has a paired rollback.
// ═════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260803220100_contractor_compliance_fk_indexes.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../../supabase/rollbacks/20260803220100_contractor_compliance_fk_indexes.rollback.sql', import.meta.url),
  'utf8',
);

const expectedColumns = [
  'actor_employee_id',
  'document_id',
  'request_id',
  'profile_id',
  'created_by',
  'locked_by',
  'materialized_by',
  'delivery_id',
  'superseded_by_document_id',
  'verified_by',
  'assigned_owner_id',
  'requests_paused_by',
  'paused_by',
  'revoked_by',
  'supersedes_request_id',
  'updated_by',
];

describe('contractor compliance foreign-key index migration', () => {
  it('is index-only and covers all advisor-reported foreign-key columns', () => {
    expect(migration.match(/CREATE INDEX/g)).toHaveLength(22);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER TABLE|DROP)\b/);
    for (const column of expectedColumns) {
      expect(migration).toContain(`(${column})`);
    }
  });

  it('rolls back exactly the indexes it creates', () => {
    const created = [...migration.matchAll(/CREATE INDEX ([a-z0-9_]+)/g)].map((match) => match[1]);
    const dropped = [...rollback.matchAll(/DROP INDEX IF EXISTS public\.([a-z0-9_]+)/g)]
      .map((match) => match[1]);
    expect(dropped).toEqual(created);
  });
});
