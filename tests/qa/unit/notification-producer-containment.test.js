/**
 * ════════════════════════════════════════════════
 * FILE: notification-producer-containment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the temporary notification containment exact: only the three appointment
 *   and two timesheet producer types are disabled, the migration refuses a partial
 *   or already-disabled catalog, and the paired rollback restores the same exact
 *   verified pre-apply state.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:url, vitest
 *   Internal:  the paired 20260731223000 migration and rollback
 *   Data:      reads → SQL source files; writes → none
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  'utf8',
).replace(/\r\n/g, '\n');

const migration = read('../../../supabase/migrations/20260731223000_notification_unsafe_producer_containment.sql');
const rollback = read('../../../supabase/rollbacks/20260731223000_notification_unsafe_producer_containment.rollback.sql');

const containedTypes = [
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
  'timesheet.change_requested',
  'timesheet.change_reviewed',
];

describe('notification unsafe-producer containment source', () => {
  it('disables the exact five catalog keys and refuses a partial or already-disabled catalog', () => {
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toContain('locked.enabled IS NOT TRUE');
    expect(migration).toContain('catalog keys already disabled');
    expect(migration).toContain('FOR UPDATE');
    expect(migration.indexOf('FOR UPDATE')).toBeLessThan(migration.indexOf('SET enabled = false'));
    expect(migration).toContain('SET enabled = false');
    for (const typeKey of containedTypes) {
      expect(migration.match(new RegExp(`'${typeKey.replace('.', '\\.')}'`, 'g'))).toHaveLength(1);
    }
  });

  it('does not touch provider, consent, message or producer tables', () => {
    const executable = migration.slice(migration.indexOf('DO $$'));
    expect(executable).not.toMatch(/\b(?:callrail|twilio|messages|appointments|appointment_crew|timesheets)\b/i);
    expect(executable).not.toContain('sms_sending_enabled');
    expect(executable).not.toContain('integration_config');
  });

  it('rolls back the same exact five catalog keys', () => {
    expect(rollback).toContain('SET enabled = true');
    for (const typeKey of containedTypes) {
      expect(rollback.match(new RegExp(`'${typeKey.replace('.', '\\.')}'`, 'g'))).toHaveLength(1);
    }
  });
});
