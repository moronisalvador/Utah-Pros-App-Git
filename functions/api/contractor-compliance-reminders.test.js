/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-reminders.test.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES (plain language): Checks daily reminders reserve safe work before email is attempted.
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: contractor-compliance-reminders.js
 *   Data: reads → mocked requests; writes → none
 * NOTES / GOTCHAS: All database and email work is mocked.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ deliver: null, db: null, supabase: null, checkCron: null, withRun: null }));
vi.mock('../lib/contractor-compliance-delivery.js', () => ({
  deliverClaimedComplianceRequest: (...args) => h.deliver(...args),
}));
vi.mock('../lib/supabase.js', () => ({ supabase: (...args) => h.supabase(...args) }));
vi.mock('../lib/auth.js', () => ({ checkCronSecret: (...args) => h.checkCron(...args) }));
vi.mock('../lib/worker-runs.js', () => ({ withRunRecording: (...args) => h.withRun(...args) }));
import { onRequestPost, runContractorComplianceReminders } from './contractor-compliance-reminders.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ENV = { CONTRACTOR_COMPLIANCE_TOKEN_SECRET: 's'.repeat(32) };
beforeEach(() => {
  h.deliver = vi.fn(async () => ({ outcome: 'sent', recordsProcessed: 1 }));
  h.db = { rpc: vi.fn(async () => []) };
  h.supabase = vi.fn(() => h.db);
  h.checkCron = vi.fn(async () => true);
  h.withRun = vi.fn(async (_db, _name, callback) => callback());
});

describe('contractor compliance reminders', () => {
  it('advances Denver W-9 year, creates an idempotent request, claims, then delivers', async () => {
    const db = { rpc: vi.fn(async (name) => {
      if (name === 'contractor_compliance_advance_w9_year') return 1;
      if (name === 'contractor_compliance_reminder_candidates') return [{ request_identity: `contractor:${ID}:w9:2026`, contractor_id: ID, document_types: ['w9'], recipient_email: 'x@example.test', stage: 'w9:2026:annual', requirement_label: 'current-year W-9', due_label: 'annual requirement' }];
      if (name === 'contractor_compliance_create_request') return [{ request_id: ID }];
      if (name === 'contractor_compliance_claim_delivery') return [{ delivery_id: ID, contact_id: ID, provider_idempotency_key: 'stable' }];
      return null;
    }) };
    const result = await runContractorComplianceReminders(ENV, db);
    expect(result).toMatchObject({ recordsProcessed: 1, meta: { sent: 1 } });
    expect(db.rpc).toHaveBeenCalledWith('contractor_compliance_advance_w9_year');
    expect(db.rpc).toHaveBeenCalledWith('contractor_compliance_create_request', expect.objectContaining({ p_source: 'automated_reminder', p_document_types: ['w9'], p_request_identity: `contractor:${ID}:w9:2026`, p_token_digest: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(h.deliver).toHaveBeenCalledWith(db, ENV, expect.objectContaining({ delivery_id: ID }), expect.objectContaining({ uploadToken: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  it('does not deliver when the database returns no new claim', async () => {
    const db = { rpc: vi.fn(async (name) => {
      if (name === 'contractor_compliance_advance_w9_year') return 0;
      if (name === 'contractor_compliance_reminder_candidates') return [{ request_identity: `contractor:${ID}:7d`, contractor_id: ID, document_types: ['general_liability'], stage: '7d' }];
      if (name === 'contractor_compliance_create_request') return [{ request_id: ID }];
      if (name === 'contractor_compliance_claim_delivery') return null;
      return null;
    }) };
    const result = await runContractorComplianceReminders(ENV, db);
    expect(result.recordsProcessed).toBe(0);
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid cron secret before run recording or database work', async () => {
    h.checkCron.mockResolvedValueOnce(false);
    const res = await onRequestPost({
      request: { headers: new Headers() },
      env: {
        ...ENV,
        CONTRACTOR_COMPLIANCE_ENABLED: 'true',
        CONTRACTOR_COMPLIANCE_REMINDERS_ENABLED: 'true',
      },
    });
    expect(res.status).toBe(401);
    expect(h.withRun).not.toHaveBeenCalled();
    expect(h.db.rpc).not.toHaveBeenCalled();
  });
});
