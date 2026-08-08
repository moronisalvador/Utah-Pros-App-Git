/**
 * ════════════════════════════════════════════════
 * FILE: send-esign-custom-doc.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks who is allowed to send a one-off "Custom Authorization" for a client
 *   to sign, and that badly-written ones are refused. It proves that a
 *   technician, estimator, supervisor, outside collaborator or deactivated
 *   employee is turned away BEFORE any signing link is created — and, just as
 *   importantly, that adding this permission did not quietly restrict who can
 *   send the ordinary documents.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/send-esign.js, functions/lib/esign-custom-doc.js,
 *              functions/lib/auth.js (REAL — not mocked, so the role list itself
 *              is exercised rather than assumed)
 *   Data:      reads  → none (fetch is stubbed)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - auth.js is deliberately NOT mocked. Mocking requireRole would stub out the
 *     very comparison under test and prove nothing about CUSTOM_DOC_ROLES. Only
 *     the transport is faked, the same shape qbo-worker-authorization.test.js
 *     uses.
 *   - A 403 alone is not a pass. Every refusal case also asserts that no
 *     create_sign_request call was made, because the damage this gate prevents
 *     is a signing token existing at all.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => ({ status, ok: status < 400, json: async () => body }),
}));
const sendEmail = vi.fn(async () => ({ ok: true }));
vi.mock('../lib/email.js', () => ({ sendEmail: (...a) => sendEmail(...a) }));

const { onRequestPost } = await import('./send-esign.js');

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_ANON_KEY: 'anon-key',
  RESEND_API_KEY: 'resend-key',
  APP_URL: 'https://dev.utahpros.app',
};

const JOB = {
  id: 'job-1', job_number: 'J-1001', insured_name: 'Dorothy Killian',
  address: '1295 Oquirrh Dr', city: 'Provo', state: 'UT', division: 'water',
};

const GOOD_TEXT = {
  custom_heading: 'Authorization to Remove Damaged Cabinetry',
  custom_body: '## WHAT I AM AUTHORIZING\nI authorize {{company_name}} to remove the damaged cabinetry at {{address}}.',
  custom_snippet_key: 'irreversible_work',
};

function req(body) {
  return {
    url: 'https://dev.utahpros.app/api/send-esign',
    headers: { get: (k) => (k === 'Authorization' ? 'Bearer jwt' : null) },
    json: async () => body,
  };
}

/** Fakes GoTrue, the employees lookup, the job read and the RPC. */
function installFetch(employee) {
  const calls = { createSignRequest: [], patch: [], employees: 0 };
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: 'auth-1' }) };
    }
    if (u.includes('/rest/v1/employees')) {
      calls.employees += 1;
      return { ok: true, json: async () => (employee ? [employee] : []) };
    }
    if (u.includes('/rest/v1/jobs')) return { ok: true, json: async () => [JOB] };
    if (u.includes('/rpc/create_sign_request')) {
      calls.createSignRequest.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'sr-1', token: 'tok-abc' }) };
    }
    if (u.includes('/rest/v1/sign_requests')) {
      calls.patch.push(JSON.parse(init.body));
      return { ok: true, text: async () => '' };
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  return calls;
}

const emp = (over = {}) => ({
  id: 'e-1', full_name: 'Test', email: 't@utah-pros.com',
  role: 'admin', is_active: true, is_external: false, ...over,
});

const customBody = (over = {}) => ({
  job_id: 'job-1', signer_name: 'Dorothy Killian', sent_by: 'e-1',
  doc_type: 'other', mode: 'collect', ...GOOD_TEXT, ...over,
});

beforeEach(() => { vi.clearAllMocks(); sendEmail.mockResolvedValue({ ok: true }); });
afterEach(() => { delete globalThis.fetch; });

describe('who may send a Custom Authorization', () => {
  it.each([
    ['field technician',      { role: 'field_tech' }],
    ['estimator',             { role: 'estimator' }],
    ['supervisor',            { role: 'supervisor' }],
    ['CRM partner',           { role: 'crm_partner' }],
    ['inactive admin',        { is_active: false }],
    ['external admin',        { is_external: true }],
    ['external office',       { role: 'office', is_external: true }],
    ['inactive office',       { role: 'office', is_active: false }],
  ])('refuses a %s before any signing token exists', async (_label, over) => {
    const calls = installFetch(emp(over));
    const res = await onRequestPost({ request: req(customBody()), env: ENV });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    // The point of the gate: no token was minted and no row was touched.
    expect(calls.createSignRequest).toHaveLength(0);
    expect(calls.patch).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses when the session maps to no employee at all', async () => {
    const calls = installFetch(null);
    const res = await onRequestPost({ request: req(customBody()), env: ENV });
    expect(res.status).toBe(403);
    expect(calls.createSignRequest).toHaveLength(0);
  });

  it.each([['admin'], ['office'], ['project_manager']])(
    'allows an active internal %s through to creation',
    async (role) => {
      const calls = installFetch(emp({ role }));
      const res = await onRequestPost({ request: req(customBody()), env: ENV });

      expect(res.status).toBe(200);
      expect(calls.createSignRequest).toHaveLength(1);
      expect(calls.createSignRequest[0].p_doc_type).toBe('other');
      // Snapshot written by a follow-up PATCH, never as RPC parameters.
      expect(calls.patch).toHaveLength(1);
      expect(calls.patch[0]).toEqual({
        custom_heading: GOOD_TEXT.custom_heading,
        custom_body: GOOD_TEXT.custom_body,
        custom_snippet_key: 'irreversible_work',
      });
    },
  );
});

describe('the gate does not narrow the ordinary document types', () => {
  it.each([['work_auth'], ['coc'], ['cat3_removal'], ['access_release']])(
    'still lets a field technician send %s',
    async (doc_type) => {
      const calls = installFetch(emp({ role: 'field_tech' }));
      const res = await onRequestPost({
        request: req({ job_id: 'job-1', signer_name: 'Dorothy Killian', sent_by: 'e-1', doc_type, mode: 'collect' }),
        env: ENV,
      });

      expect(res.status).toBe(200);
      expect(calls.createSignRequest).toHaveLength(1);
      // No snapshot for a template-backed type.
      expect(calls.patch).toHaveLength(0);
      // The employees table is not even read — these types keep requireUser only.
      expect(calls.employees).toBe(0);
    },
  );
});

describe('custom text validation', () => {
  const refuses = async (over, fragment) => {
    const calls = installFetch(emp());
    const res = await onRequestPost({ request: req(customBody(over)), env: ENV });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(fragment);
    expect(calls.createSignRequest, 'must refuse before minting a token').toHaveLength(0);
    return error;
  };

  it('refuses a missing title', () => refuses({ custom_heading: '   ' }, /title is required/i));
  it('refuses missing text', () => refuses({ custom_body: '\n \n' }, /text is required/i));
  it('refuses an over-long title', () => refuses({ custom_heading: 'x'.repeat(81) }, /80 characters/));
  it('refuses a multi-line title', () => refuses({ custom_heading: 'Line one\nLine two' }, /single line/i));
  it('refuses an over-long body', () => refuses({ custom_body: 'x'.repeat(8001) }, /8000 characters/));

  it('refuses {{insurance_section}} by name', async () => {
    // It expands to a full irrevocable assignment of insurance benefits — and to
    // DIFFERENT text on the signing page than in the PDF.
    const error = await refuses(
      { custom_body: 'Please sign.\n\n{{insurance_section}}' },
      /insurance_section/,
    );
    expect(error).toMatch(/Direction to Pay/);
  });

  it('refuses a token neither renderer resolves', () =>
    refuses({ custom_body: 'Hello {{customer_nickname}}' }, /not a recognized field/));

  it('refuses a malformed snippet reference', () =>
    refuses({ custom_snippet_key: '../../etc/passwd' }, /Invalid snippet/));

  it('accepts every documented token', async () => {
    const all = '{{client_name}} {{job_number}} {{address}} {{city}} {{state}} {{zip}} '
      + '{{date_of_loss}} {{insurance_company}} {{claim_number}} {{policy_number}} '
      + '{{adjuster_name}} {{company_name}} {{date}}';
    const calls = installFetch(emp());
    const res = await onRequestPost({ request: req(customBody({ custom_body: all })), env: ENV });
    expect(res.status).toBe(200);
    expect(calls.createSignRequest).toHaveLength(1);
  });

  it('stores the text trimmed, and a blank snippet key as null', async () => {
    const calls = installFetch(emp());
    await onRequestPost({
      request: req(customBody({ custom_heading: '  Padded Title  ', custom_body: '  Body text.  ', custom_snippet_key: '' })),
      env: ENV,
    });
    expect(calls.patch[0].custom_heading).toBe('Padded Title');
    expect(calls.patch[0].custom_body).toBe('Body text.');
    expect(calls.patch[0].custom_snippet_key).toBeNull();
  });
});

describe('a snapshot that cannot be stored never leaves a signable request', () => {
  it('cancels the request and fails the send', async () => {
    // This is also the code-deployed-before-migration path: PATCHing a column
    // that does not exist yet lands here, so the feature refuses cleanly instead
    // of minting a document with no text in it.
    const patched = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'auth-1' }) };
      if (u.includes('/rest/v1/employees')) return { ok: true, json: async () => [emp()] };
      if (u.includes('/rest/v1/jobs')) return { ok: true, json: async () => [JOB] };
      if (u.includes('/rpc/create_sign_request')) return { ok: true, json: async () => ({ id: 'sr-1', token: 'tok-abc' }) };
      if (u.includes('/rest/v1/sign_requests')) {
        const body = JSON.parse(init.body);
        patched.push(body);
        if ('custom_body' in body) {
          return { ok: false, text: async () => 'PGRST204 column custom_body does not exist' };
        }
        return { ok: true, text: async () => '' };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const res = await onRequestPost({ request: req(customBody()), env: ENV });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: 'ESIGN_CUSTOM_TEXT_NOT_STORED' });
    // Snapshot attempted, then the request cancelled so it cannot be opened.
    expect(patched).toHaveLength(2);
    expect(patched[1]).toEqual({ status: 'cancelled' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
