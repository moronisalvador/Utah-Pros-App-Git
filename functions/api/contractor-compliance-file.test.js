/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-file.test.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES (plain language): Checks private document links are only made for authorized staff.
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: contractor-compliance-file.js
 *   Data: reads → mocked requests; writes → none
 * NOTES / GOTCHAS: All database calls are mocked.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ db: null, auth: null, supabase: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: (...args) => h.supabase(...args) }));
vi.mock('../lib/auth.js', () => ({ requireRole: (...args) => h.auth(...args) }));
import { onRequestPost } from './contractor-compliance-file.js';
const ID = '11111111-1111-4111-8111-111111111111';
const ENV = { CONTRACTOR_COMPLIANCE_ENABLED: 'true' };
function request(document_id = ID, disposition = 'inline') { return { json: async () => ({ document_id, disposition }), headers: new Headers() }; }
beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: ID, role: 'office' } }));
  h.db = { rpc: vi.fn(async () => [{ storage_bucket: 'contractor-compliance-private', storage_object_path: 'contractors/x.pdf', original_filename: 'certificate.pdf' }]), signStorage: vi.fn(async () => 'https://signed.test/file') };
  h.supabase = vi.fn(() => h.db);
});
describe('contractor compliance file URL', () => {
  it('uses POST body ID only and never signs before role/row authorization', async () => {
    expect((await onRequestPost({ request: request(), env: {} })).status).toBe(404);
    h.auth.mockResolvedValueOnce({ error: 'Insufficient role', status: 403 });
    expect((await onRequestPost({ request: request(), env: ENV })).status).toBe(403);
    expect(h.db.signStorage).not.toHaveBeenCalled();
    h.db.rpc.mockResolvedValueOnce([]);
    expect((await onRequestPost({ request: request(), env: ENV })).status).toBe(404);
    expect(h.db.signStorage).not.toHaveBeenCalled();
    const res = await onRequestPost({ request: request(), env: ENV });
    expect(res.status).toBe(200);
    expect(h.db.signStorage).toHaveBeenCalledWith('contractor-compliance-private', 'contractors/x.pdf', 300, { download: false });
    expect((await onRequestPost({ request: request(ID, 'attachment'), env: ENV })).status).toBe(200);
    expect(h.db.signStorage).toHaveBeenLastCalledWith('contractor-compliance-private', 'contractors/x.pdf', 300, { download: 'certificate.pdf' });
  });
});
