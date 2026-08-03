/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-upload.test.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES (plain language): Checks staff document uploads are checked and cleaned up safely.
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: contractor-compliance-upload.js
 *   Data: reads → mocked requests; writes → none
 * NOTES / GOTCHAS: All database calls are mocked.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null, supabase: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: (...args) => h.supabase(...args) }));
vi.mock('../lib/auth.js', () => ({ requireRole: (...args) => h.auth(...args) }));
import { onRequestPost } from './contractor-compliance-upload.js';

const ID = '11111111-1111-4111-8111-111111111111';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
function env() { return { CONTRACTOR_COMPLIANCE_ENABLED: 'true' }; }
function request(file) {
  const form = new FormData();
  form.append('contractor_id', ID); form.append('document_type', 'w9'); form.append('tax_year', '2026'); form.append('file', file);
  return { formData: async () => form, headers: new Headers() };
}
beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: ID, role: 'office' } }));
  h.db = { uploadStorage: vi.fn(async () => true), deleteStorage: vi.fn(async () => true), rpc: vi.fn(async () => [{ id: ID }]) };
  h.supabase = vi.fn(() => h.db);
});

describe('internal contractor compliance upload', () => {
  it('does no DB work while disabled or denied', async () => {
    expect((await onRequestPost({ request: request(new File([PDF], 'w9.pdf', { type: 'application/pdf' })), env: {} })).status).toBe(404);
    expect(h.supabase).not.toHaveBeenCalled();
    const res = await onRequestPost({ request: request(new File([PDF], 'w9.pdf', { type: 'application/pdf' })), env: env() });
    expect(res.status).toBe(201);
    h.auth.mockResolvedValueOnce({ error: 'Insufficient role', status: 403 });
    expect((await onRequestPost({ request: request(new File([PDF], 'w9.pdf', { type: 'application/pdf' })), env: env() })).status).toBe(403);
  });

  it('never stores mismatched bytes and cleans an orphan if metadata fails', async () => {
    const bad = await onRequestPost({ request: request(new File(['html'], 'w9.pdf', { type: 'application/pdf' })), env: env() });
    expect(bad.status).toBe(400); expect(h.db.uploadStorage).not.toHaveBeenCalled();
    h.db.rpc.mockRejectedValueOnce(new Error('metadata down'));
    const failed = await onRequestPost({ request: request(new File([PDF], 'w9.pdf', { type: 'application/pdf' })), env: env() });
    expect(failed.status).toBe(503); expect(h.db.deleteStorage).toHaveBeenCalledWith('contractor-compliance-private', expect.stringMatching(/^contractors\//));
  });
});
