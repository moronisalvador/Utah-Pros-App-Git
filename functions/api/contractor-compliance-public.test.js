/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-public.test.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES (plain language): Checks anonymous upload safety without real files or data.
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: contractor-compliance-public.js
 *   Data: reads → mocked requests; writes → none
 * NOTES / GOTCHAS: All storage and database calls are mocked.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, supabase: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: (...args) => h.supabase(...args) }));
import { onRequestGet, onRequestPost } from './contractor-compliance-public.js';

const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'x'.repeat(40);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
function env() { return { CONTRACTOR_COMPLIANCE_ENABLED: 'true', CONTRACTOR_COMPLIANCE_RATE_LIMIT_SALT: 'test-salt-at-least-16' }; }
function postRequest(form) { return { url: 'https://app.test/api/contractor-compliance-public', formData: async () => form, headers: new Headers({ 'X-Contractor-Upload-Token': TOKEN }) }; }

beforeEach(() => {
  h.db = {
    rpc: vi.fn(async (name) => {
      if (name === 'contractor_compliance_public_request') return [{ request_id: ID, contractor_id: ID, requested_document_types: ['w9'], expires_at: '2030-01-01T00:00:00Z' }];
      if (name === 'contractor_compliance_record_public_attempt') return { allowed: true };
      return [{ id: ID }];
    }),
    uploadStorage: vi.fn(async () => true),
  };
  h.supabase = vi.fn(() => h.db);
});

describe('contractor public upload boundary', () => {
  it('does not enumerate an invalid token', async () => {
    const res = await onRequestGet({ request: { url: 'https://app.test/api/contractor-compliance-public', headers: new Headers({ 'X-Contractor-Upload-Token': 'short' }) }, env: env() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'This upload link is unavailable.' });
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('records a bounded attempt, validates bytes, and writes pending-review metadata through SQL', async () => {
    const form = new FormData();
    form.append('document_type', 'w9');
    form.append('tax_year', '2026');
    form.append('file', new File([PDF], 'w9.pdf', { type: 'application/pdf' }));
    const res = await onRequestPost({ request: postRequest(form), env: env() });
    expect(res.status).toBe(201);
    expect(h.db.uploadStorage).toHaveBeenCalledWith('contractor-compliance-private', expect.stringMatching(/^contractors\//), expect.any(Uint8Array), 'application/pdf', { upsert: false });
    expect(h.db.rpc).toHaveBeenCalledWith('contractor_compliance_ingest_document', expect.objectContaining({ p_source: 'public_upload', p_document_type: 'w9' }));
  });

  it('does not store a wrong-type document', async () => {
    const form = new FormData();
    form.append('document_type', 'w9');
    form.append('tax_year', '2026');
    form.append('file', new File(['not a PDF'], 'w9.pdf', { type: 'application/pdf' }));
    const res = await onRequestPost({ request: postRequest(form), env: env() });
    expect(res.status).toBe(400);
    expect(h.db.uploadStorage).not.toHaveBeenCalled();
  });

  it('compensates a newly stored private object when metadata persistence fails', async () => {
    h.db.deleteStorage = vi.fn(async () => true);
    h.db.rpc.mockImplementation(async (name) => {
      if (name === 'contractor_compliance_public_request') return [{ request_id: ID, contractor_id: ID, requested_document_types: ['w9'], expires_at: '2030-01-01T00:00:00Z' }];
      if (name === 'contractor_compliance_record_public_attempt') return { allowed: true };
      throw new Error('metadata failed');
    });
    const form = new FormData();
    form.append('document_type', 'w9');
    form.append('tax_year', '2026');
    form.append('file', new File([PDF], 'w9.pdf', { type: 'application/pdf' }));
    const res = await onRequestPost({ request: postRequest(form), env: env() });
    expect(res.status).toBe(503);
    expect(h.db.deleteStorage).toHaveBeenCalledWith('contractor-compliance-private', expect.stringMatching(/^contractors\//));
  });
});
