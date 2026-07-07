/**
 * ════════════════════════════════════════════════
 * FILE: tech_v2_h1_job_hub.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the Job Hub v2 (H1) migration's promise: get_job_hub gained ONE new
 *   key, contacts[], and every key the old Job Hub relied on is still there. Two
 *   layers: a static contract check that reads the committed migration SQL and
 *   asserts each v1 key (and every appointment sub-key) is still built plus the
 *   new contacts key — this always runs in CI, no database. Then an integration
 *   check that calls the live function and confirms the same shape — self-skips
 *   without Supabase creds, like the CRM suites.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  src/lib/supabase.js (unauthenticated REST client, integration only)
 *   Data:      reads → get_job_hub (integration only) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The static check is the real backward-compat guard: it fails loudly if a
 *     later edit drops a v1 key from the migration, without needing a database.
 *   - Integration part picks any existing job and only asserts SHAPE (keys +
 *     types), never row values — safe on the shared prod DB.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../../src/lib/supabase.js';

const MIGRATION = fileURLToPath(
  new URL('../migrations/20260704_tech_v2_h1_job_hub_contacts.sql', import.meta.url),
);

// The keys the pre-v2 Job Hub (M1) depended on — none may disappear.
const V1_TOP_KEYS = ['job', 'claim', 'work_auth_signed', 'appointments'];
const V1_APPT_KEYS = [
  'id', 'job_id', 'job_number', 'division', 'title', 'date', 'time_start',
  'time_end', 'type', 'status', 'notes', 'duration_days', 'is_milestone',
  'color', 'crew', 'task_total', 'task_completed',
];

describe('get_job_hub v2 — migration backward-compat contract (static)', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('still builds every v1 top-level key', () => {
    for (const key of V1_TOP_KEYS) {
      expect(sql, `missing v1 key '${key}'`).toContain(`'${key}',`);
    }
  });

  it('still builds every v1 appointment sub-key', () => {
    for (const key of V1_APPT_KEYS) {
      expect(sql, `missing v1 appointment key '${key}'`).toContain(`'${key}',`);
    }
  });

  it('adds exactly the new contacts key, delegating to get_job_contacts', () => {
    expect(sql).toContain("'contacts', public.get_job_contacts(j.id)");
  });

  it('drift-captures get_job_contacts with GRANT EXECUTE', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_job_contacts(p_job_id uuid)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_job_contacts(uuid) TO anon, authenticated');
  });

  it('is additive only — no destructive DDL', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|FUNCTION|COLUMN|POLICY)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('get_job_hub v2 — live shape (integration)', () => {
  let hub = null;

  beforeAll(async () => {
    const rows = await db.select('jobs', 'select=id&limit=1');
    if (!rows?.length) return;
    hub = await db.rpc('get_job_hub', { p_job_id: rows[0].id });
  });

  it('returns all v1 top-level keys plus contacts', () => {
    if (!hub) return; // no jobs in this DB — nothing to assert
    for (const key of V1_TOP_KEYS) expect(hub).toHaveProperty(key);
    expect(hub).toHaveProperty('contacts');
  });

  it('contacts and appointments are arrays', () => {
    if (!hub) return;
    expect(Array.isArray(hub.contacts)).toBe(true);
    expect(Array.isArray(hub.appointments)).toBe(true);
  });
});
