/**
 * @file dorothy-killian-downstairs-reconstruction-repair.test.js
 * @description Static contract for the bounded Dorothy Killian A/R repair.
 * @responsibility Prove exact identity targeting, trigger-owned money safety,
 * duplicate avoidance, fail-closed behavior, and rollback coverage.
 * @dependencies Node fs/path, Vitest.
 * @touchpoints Paired Dorothy repair and rollback SQL files.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  'supabase/migrations/20260727222000_dorothy_killian_downstairs_reconstruction_repair.sql',
), 'utf8');
const rollback = readFileSync(resolve(
  'supabase/rollbacks/20260727222000_dorothy_killian_downstairs_reconstruction_repair.rollback.sql',
), 'utf8');
const executable = migration
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .toLowerCase();

describe('Dorothy Killian downstairs reconstruction repair', () => {
  it('anchors every reviewed identity', () => {
    [
      'd1271af5-205d-42c2-872b-fd46137eac3a',
      '5aea2cee-84ee-42dd-848d-284ad65e7ecf',
      '25b844f0-ddb8-4a99-b9f6-44bdde342b00',
      'd7e8f211-8945-4e70-b63f-52bad5e9735b',
      '52bcab09-ae03-4dd9-ba3a-8c9707b73265',
      'd0195bdf-6913-4066-aadd-1b07897daacb',
      '743f73d3-60ed-475d-a8cd-1ddc1edd7f9b',
      '4bd87290-1037-45e6-b573-c72a9b3d29b9',
      '4283', '4284', '4390121', '4760844',
    ].forEach((anchor) => expect(migration).toContain(anchor));
  });

  it('restores the exact QuickBooks line and A/R amounts', () => {
    expect(migration).toContain(
      'Reconstruction / Remodeling Services (recon portion split from combined invoice 1227, 1295 Oquirrh Dr).',
    );
    expect(migration).toContain('Reconstruction:Reconstruction/ Remodeling Services');
    expect(migration).toContain('1010000201');
    expect(migration).toContain('10611.51');
    expect(migration).toContain('7672.87');
    expect(migration).toContain('2938.64');
  });

  it('updates existing financial records without making duplicates', () => {
    expect(executable).not.toMatch(/\binsert\s+into\s+(jobs|invoices|invoice_line_items|payments)\b/);
    expect(executable).not.toMatch(/\bdelete\s+from\s+(jobs|invoices|invoice_line_items|payments)\b/);
    expect(executable).toMatch(/\bupdate\s+invoice_line_items\b/);
    expect(executable).toMatch(/\binsert\s+into\s+contact_jobs\b/);
    expect(migration).toContain("count(*) FROM invoices WHERE qbo_invoice_id = '4283'");
    expect(migration).toContain("count(*) FROM jobs WHERE job_number = 'R-2604-062'");
  });

  it('never directly sets generated or payment-trigger-owned money fields', () => {
    const setClauses = [...executable.matchAll(
      /\bupdate\s+\w+\s+set\s+([\s\S]*?)\s+where\b/g,
    )].map((match) => match[1]);

    for (const clause of setClauses) {
      expect(clause).not.toMatch(
        /\b(line_total|subtotal|total|amount_paid|balance_due|status|paid_at|invoiced_value|collected_value|ar_status)\s*=/,
      );
    }
  });

  it('fails closed and contains no DDL or permission changes', () => {
    expect((migration.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(9);
    expect(executable).not.toMatch(
      /\b(create|alter|drop|truncate|grant|revoke)\s+(table|policy|function|index|type|schema|role|sequence|execute|usage)\b/,
    );
    expect(executable).not.toContain('security definer');
    expect(executable).not.toMatch(/\b(public|anon)\b/);
  });

  it('serializes the repair and fully guards rollback-mutated fields', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(rollback).toContain('pg_advisory_xact_lock');
    expect((migration.match(/FOR UPDATE/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect((rollback.match(/FOR UPDATE/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(migration).toContain('ON CONFLICT (contact_id, job_id, role) DO NOTHING');
    [
      "address = '1295 Oquirrh Dr, Provo, UT, 84604'",
      "due_date = DATE '2026-04-23'",
      "description = 'Reconstruction / Remodeling Services",
      "qbo_item_name = 'Reconstruction:Reconstruction/ Remodeling Services'",
      "internal_notes = 'QBO backfill invoice 4283 already exists in QuickBooks",
    ].forEach((guard) => expect(rollback).toContain(guard));
  });
  it('ships an emergency rollback that preserves the payment', () => {
    expect(rollback).toContain('EMERGENCY ONLY');
    expect(rollback).toContain('UPDATE invoice_line_items');
    expect(rollback).toContain('DELETE FROM contact_jobs');
    expect(rollback).toContain('UPDATE jobs');
    expect(rollback).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO\s+|FROM\s+)?payments\b/);
    expect(rollback).toContain("qbo_payment_id = '4284'");
  });
});
