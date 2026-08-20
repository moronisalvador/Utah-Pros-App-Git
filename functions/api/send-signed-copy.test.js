/**
 * ════════════════════════════════════════════════
 * FILE: send-signed-copy.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tests the endpoint that emails a customer another copy of a document they
 *   already signed. Most of these are REFUSALS — who may not call it, and what
 *   it must not send — because that is where the risk lives: the thing being
 *   emailed carries the customer's signature, address, claim number and policy
 *   number.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn(async () => ({ ok: true, status: 200, id: 'em_1' })));
const requireEmployee = vi.hoisted(() => vi.fn());
const dbState = vi.hoisted(() => ({ rows: {}, download: null, inserted: [] }));

vi.mock('../lib/email.js', () => ({ sendEmail }));
vi.mock('../lib/auth.js', () => ({ requireEmployee }));
vi.mock('../lib/cors.js', () => ({
  handleOptions: () => new Response(null, { status: 204 }),
  jsonResponse: (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }),
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    select: async (table) => dbState.rows[table] ?? [],
    insert: async (table, row) => { dbState.inserted.push({ table, row }); return [row]; },
    downloadStorage: async (bucket, key) => {
      if (dbState.download instanceof Error) throw dbState.download;
      dbState.lastDownload = { bucket, key };
      return dbState.download;
    },
  }),
}));

const { onRequestPost, hasRealEmail, toBase64 } = await import('./send-signed-copy.js');

const post = (body) =>
  onRequestPost({
    request: new Request('https://x/api/send-signed-copy', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env: {},
  });

const SIGNED_DOC = {
  id: 'doc-1', job_id: 'job-1', name: 'Work Authorization',
  file_path: 'job-1/esign/work_auth-signed-1.pdf',
  storage_bucket: 'job-documents-private', sign_request_id: 'sr-1',
};
const SIGN_REQ = {
  id: 'sr-1', doc_type: 'work_auth', status: 'signed',
  signer_name: 'Dana Reyes', signer_email: 'dana@example.com',
  signed_at: '2026-05-04T18:00:00Z',
  job: { id: 'job-1', job_number: 'W-2605-011', address: '9 Elm', city: 'Provo', state: 'UT' },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rows = { job_documents: [SIGNED_DOC], sign_requests: [SIGN_REQ] };
  dbState.download = { bytes: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' };
  dbState.inserted = [];
  requireEmployee.mockResolvedValue({
    user: { id: 'u1' },
    employee: { id: 'e1', full_name: 'Sam Office', role: 'office', is_active: true, is_external: false },
  });
});

describe('send-signed-copy — who may call it', () => {
  it('refuses an unauthenticated caller', async () => {
    requireEmployee.mockResolvedValue({ error: 'Missing Authorization header', status: 401 });
    expect((await post({ job_document_id: 'doc-1' })).status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a valid session that is not an employee', async () => {
    requireEmployee.mockResolvedValue({ error: 'Not an employee', status: 403 });
    expect((await post({ job_document_id: 'doc-1' })).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an EXTERNAL employee even though they are active', async () => {
    // requireEmployee checks is_active but NOT is_external. The private bucket's
    // own RLS policy requires both, and mailing the file must not be easier than
    // reading it.
    requireEmployee.mockResolvedValue({
      user: { id: 'u2' },
      employee: { id: 'e2', full_name: 'Ext', role: 'admin', is_active: true, is_external: true },
    });
    const res = await post({ job_document_id: 'doc-1' });
    expect(res.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('send-signed-copy — what it refuses to send', () => {
  it('refuses a document that is not a signed document', async () => {
    dbState.rows.job_documents = [{ ...SIGNED_DOC, sign_request_id: null }];
    const res = await post({ job_document_id: 'doc-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That document is not a signed document' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a request that has not been signed yet', async () => {
    dbState.rows.sign_requests = [{ ...SIGN_REQ, status: 'pending' }];
    const res = await post({ job_document_id: 'doc-1' });
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a typed address that is not an address', async () => {
    const res = await post({ job_document_id: 'doc-1', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports no_email_on_file for the @noemail.local placeholder, and sends nothing', async () => {
    // The trap: a non-null synthetic address. A plain `!email` guard sails past
    // it and hands Resend a bogus TLD, costing sender reputation.
    dbState.rows.sign_requests = [{ ...SIGN_REQ, signer_email: 'collect-1712@noemail.local' }];
    const res = await post({ job_document_id: 'doc-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, success: true, delivered: false, reason: 'no_email_on_file' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send when the stored file cannot be read', async () => {
    dbState.download = new Error('404');
    expect((await post({ job_document_id: 'doc-1' })).status).toBe(502);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send an empty file', async () => {
    dbState.download = { bytes: new Uint8Array([]), contentType: 'application/pdf' };
    expect((await post({ job_document_id: 'doc-1' })).status).toBe(502);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('send-signed-copy — the send itself', () => {
  it('returns BOTH ok and success — workers-standard §5 and the e-sign contract', async () => {
    const body = await (await post({ job_document_id: 'doc-1' })).json();
    expect(body.ok).toBe(true);
    expect(body.success).toBe(true);
  });

  it('emails the address on file with the PDF ATTACHED, never a link', async () => {
    const res = await post({ job_document_id: 'doc-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, success: true, delivered: true, to: 'dana@example.com' });

    const [, msg] = sendEmail.mock.calls[0];
    expect(msg.to.email).toBe('dana@example.com');
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].contentType).toBe('application/pdf');
    expect(msg.attachments[0].content).toBe(toBase64(new Uint8Array([37, 80, 68, 70])));
    // No bucket URL anywhere in the message — that is the whole design.
    expect(JSON.stringify(msg)).not.toMatch(/storage\/v1|job-files|job-documents-private/);
  });

  it('reads from the bucket the ROW names, not a hardcoded one', async () => {
    await post({ job_document_id: 'doc-1' });
    expect(dbState.lastDownload).toEqual({
      bucket: 'job-documents-private', key: 'job-1/esign/work_auth-signed-1.pdf',
    });
  });

  it('falls back to job-files for a row whose bucket is still NULL', async () => {
    dbState.rows.job_documents = [{ ...SIGNED_DOC, storage_bucket: null }];
    await post({ job_document_id: 'doc-1' });
    expect(dbState.lastDownload.bucket).toBe('job-files');
  });

  it('strips a legacy job-files/ path prefix', async () => {
    dbState.rows.job_documents = [{ ...SIGNED_DOC, file_path: 'job-files/job-1/esign/a.pdf' }];
    await post({ job_document_id: 'doc-1' });
    expect(dbState.lastDownload.key).toBe('job-1/esign/a.pdf');
  });

  it('honours a staff-typed address over the one on file', async () => {
    const res = await post({ job_document_id: 'doc-1', email: 'new@example.com' });
    expect((await res.json()).to).toBe('new@example.com');
    expect(sendEmail.mock.calls[0][1].to.email).toBe('new@example.com');
  });

  it('reports delivered:false rather than throwing when the provider fails', async () => {
    // ESIGN-03: `success` means the request was handled; `delivered` is the one
    // that answers whether anything actually left.
    sendEmail.mockResolvedValue({ ok: false, status: 422, error: 'domain not verified' });
    const res = await post({ job_document_id: 'doc-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, delivered: false, reason: 'send_failed' });
  });

  it('works for EVERY doc type, including one it has never heard of', async () => {
    for (const [type, label] of [
      ['coc', 'Certificate of Completion'],
      ['work_auth', 'Work Authorization'],
      ['change_order', 'Change Order'],
      ['cat3_removal', 'Emergency Removal Authorization'],
      ['access_release', 'Property Access Authorization'],
      ['some_future_type', 'Some Future Type'], // degrades, never throws
    ]) {
      vi.clearAllMocks();
      sendEmail.mockResolvedValue({ ok: true, status: 200, id: 'e' });
      dbState.rows.sign_requests = [{ ...SIGN_REQ, doc_type: type }];
      const res = await post({ job_document_id: 'doc-1' });
      expect(res.status, type).toBe(200);
      expect(sendEmail.mock.calls[0][1].subject, type).toContain(label);
    }
  });
});

describe('send-signed-copy — the audit trail', () => {
  it('records who sent what, and where, on the job timeline', async () => {
    await post({ job_document_id: 'doc-1' });
    const note = dbState.inserted.find((i) => i.table === 'job_notes');
    expect(note).toBeTruthy();
    expect(note.row.job_id).toBe('job-1');
    expect(note.row.body).toContain('Sam Office');
    expect(note.row.body).toContain('dana@example.com');
    expect(note.row.body).toContain('Work Authorization');
  });

  it('flags a staff-typed address in the audit line', async () => {
    // The one that matters on review: mailing a countersigned authorization to
    // an address someone typed should not look identical to mailing it to the
    // address on file.
    await post({ job_document_id: 'doc-1', email: 'new@example.com' });
    const note = dbState.inserted.find((i) => i.table === 'job_notes');
    expect(note.row.body).toContain('typed by staff');
  });

  it('still reports success when the audit note fails to write', async () => {
    // The email is already gone; failing the request would report a send that
    // did happen as a failure.
    const res = await post({ job_document_id: 'doc-1' });
    expect((await res.json()).delivered).toBe(true);
  });
});

describe('hasRealEmail', () => {
  it.each([
    ['dana@example.com', true],
    ['DANA@EXAMPLE.COM', true],
    ['collect-1712@noemail.local', false],
    ['COLLECT-1@NOEMAIL.LOCAL', false],
    ['', false],
    [null, false],
    ['no-at-sign', false],
    ['a@b', false],
  ])('%s → %s', (input, expected) => {
    expect(hasRealEmail(input)).toBe(expected);
  });
});

describe('toBase64', () => {
  it('encodes without blowing the stack on a large buffer', () => {
    // btoa(String.fromCharCode(...bytes)) dies around 100KB; a signed PDF with
    // photo evidence is past that.
    const big = new Uint8Array(300_000).fill(65);
    expect(() => toBase64(big)).not.toThrow();
    expect(toBase64(new Uint8Array([37, 80, 68, 70]))).toBe(btoa('%PDF'));
  });
});
