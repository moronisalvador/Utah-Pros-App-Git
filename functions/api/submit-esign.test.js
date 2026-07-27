/**
 * ════════════════════════════════════════════════
 * FILE: submit-esign.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the e-sign worker recognizes only the pinned Work Authorization SMS
 *   disclosure, uses the atomic consent-aware completion RPC when available,
 *   fails closed to the legacy completion path during code-first rollout, and
 *   preserves the best-effort esign.signed notification contract.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./submit-esign.js — RPC/dispatcher dependencies injected as fakes.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const workerMocks = vi.hoisted(() => ({
  dispatchEvent: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('../lib/email.js', () => ({
  sendEmail: workerMocks.sendEmail,
}));
vi.mock('./notify.js', () => ({
  dispatchEvent: workerMocks.dispatchEvent,
}));

import {
  WORK_AUTH_SMS_DISCLOSURE_SHA256,
  WORK_AUTH_SMS_DISCLOSURE_VERSION,
  completeSignRequest,
  getApprovedWorkAuthSmsDisclosure,
  getTrustedSignerIp,
  notifyEsignSigned,
  onRequestPost,
} from './submit-esign.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
};
const JOB = { id: 'job-1', job_number: 'J-1001', address: '123 Main', city: 'Provo', state: 'UT' };
const VALID_TOKEN = '11111111-1111-4111-8111-111111111111';
const APPROVED_SMS_TEXT =
  'By signing this Agreement, I consent to receive text messages (SMS/MMS) from Utah Pros Restoration at the mobile number provided in connection with this Agreement. Messages may include appointment reminders, project status updates, scheduling notifications, and other communications related to my restoration project. Message and data rates may apply. Message frequency varies. Reply STOP to opt out at any time. Reply HELP for assistance. Carriers are not liable for delayed or undelivered messages.';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function signingRequest(overrides = {}) {
  return {
    status: 'pending',
    expires_at: '2099-01-01T00:00:00.000Z',
    doc_type: 'work_auth',
    signer_email: 'customer@example.invalid',
    divisions: [],
    job: {
      id: 'job-1',
      insured_name: 'Jane Homeowner',
      division: 'water',
    },
    ...overrides,
  };
}

function rpcResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function postRequest(token = VALID_TOKEN) {
  return new Request('https://app.test/api/submit-esign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      signer_name: 'Jane Homeowner',
      signature_png: 'data:image/png;base64,AA==',
    }),
  });
}

function expectNoSigningSideEffects(fetchMock) {
  const urls = fetchMock.mock.calls.map(([url]) => String(url));
  expect(urls.some((url) => url.includes(
    '/rpc/complete_sign_request_with_work_authorization_sms_consent',
  ))).toBe(false);
  expect(urls.some((url) => url.includes('/storage/v1/object/'))).toBe(false);
  expect(urls.some((url) => url.includes('/rest/v1/job_notes'))).toBe(false);
  expect(workerMocks.sendEmail).not.toHaveBeenCalled();
  expect(workerMocks.dispatchEvent).not.toHaveBeenCalled();
}

describe('Work Authorization SMS disclosure bridge', () => {
  it('recognizes only the exact approved rendered disclosure', () => {
    expect(createHash('sha256').update(APPROVED_SMS_TEXT).digest('hex'))
      .toBe(WORK_AUTH_SMS_DISCLOSURE_SHA256);
    expect(getApprovedWorkAuthSmsDisclosure([
      { heading: 'SMS COMMUNICATIONS', blocks: [APPROVED_SMS_TEXT] },
    ])).toEqual({
      version: WORK_AUTH_SMS_DISCLOSURE_VERSION,
      sha256: WORK_AUTH_SMS_DISCLOSURE_SHA256,
    });

    expect(getApprovedWorkAuthSmsDisclosure([
      { heading: 'SMS COMMUNICATIONS', blocks: [`${APPROVED_SMS_TEXT} Marketing offers may follow.`] },
    ])).toBeNull();
    expect(getApprovedWorkAuthSmsDisclosure([])).toBeNull();
  });

  it('uses only Cloudflare connection IP as automatic consent evidence', () => {
    const trusted = new Request('https://app.test', {
      headers: {
        'CF-Connecting-IP': ' 192.0.2.40 ',
        'X-Forwarded-For': '198.51.100.99',
      },
    });
    const forwardedOnly = new Request('https://app.test', {
      headers: { 'X-Forwarded-For': '198.51.100.99' },
    });

    expect(getTrustedSignerIp(trusted)).toBe('192.0.2.40');
    expect(getTrustedSignerIp(forwardedOnly)).toBeNull();
  });

  it('uses the atomic wrapper and passes the pinned evidence identity', async () => {
    const calls = [];
    const rpc = async (name, params) => {
      calls.push({ name, params });
      return { success: true, sms_consent_recorded: true };
    };
    const params = { p_token: 'token-1', p_signer_name: 'Jane Homeowner' };

    const completion = await completeSignRequest({
      rpc,
      params,
      smsDisclosure: {
        version: WORK_AUTH_SMS_DISCLOSURE_VERSION,
        sha256: WORK_AUTH_SMS_DISCLOSURE_SHA256,
      },
    });

    expect(completion.bridgeAvailable).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('complete_sign_request_with_work_authorization_sms_consent');
    expect(calls[0].params).toMatchObject({
      ...params,
      p_sms_disclosure_version: WORK_AUTH_SMS_DISCLOSURE_VERSION,
      p_sms_disclosure_sha256: WORK_AUTH_SMS_DISCLOSURE_SHA256,
    });
  });

  it('falls back only when the additive wrapper is missing', async () => {
    const calls = [];
    const rpc = async (name, params) => {
      calls.push({ name, params });
      if (name === 'complete_sign_request_with_work_authorization_sms_consent') {
        throw new Error(
          'PGRST202 Could not find the function public.complete_sign_request_with_work_authorization_sms_consent in the schema cache',
        );
      }
      return { success: true, job_document_id: 'doc-1' };
    };
    const params = { p_token: 'token-1', p_signer_name: 'Jane Homeowner' };

    const completion = await completeSignRequest({ rpc, params });

    expect(completion.bridgeAvailable).toBe(false);
    expect(calls.map((call) => call.name)).toEqual([
      'complete_sign_request_with_work_authorization_sms_consent',
      'complete_sign_request',
    ]);
    expect(calls[1].params).toEqual(params);
  });

  it('passes null evidence when the disclosure is missing or changed', async () => {
    const calls = [];
    await completeSignRequest({
      rpc: async (name, params) => {
        calls.push({ name, params });
        return { success: true, sms_consent_recorded: false };
      },
      params: { p_token: VALID_TOKEN },
      smsDisclosure: null,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'complete_sign_request_with_work_authorization_sms_consent',
      params: {
        p_sms_disclosure_version: null,
        p_sms_disclosure_sha256: null,
      },
    });
  });

  it('does not bypass an installed wrapper failure', async () => {
    const rpc = async () => {
      throw new Error('RPC complete_sign_request_with_work_authorization_sms_consent: 500 database failure');
    };
    await expect(
      completeSignRequest({ rpc, params: { p_token: 'token-1' } }),
    ).rejects.toThrow('database failure');
  });
});

describe('submit-esign public token gate', () => {
  it('rejects a malformed token before any privileged request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      request: postRequest('not-a-uuid'),
      env: ENV,
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSigningSideEffects(fetchMock);
  });

  it.each([
    ['unknown', null, 404],
    ['already signed', signingRequest({ status: 'signed' }), 409],
    ['revoked', signingRequest({ status: 'revoked' }), 410],
    ['expired', signingRequest({ expires_at: '2020-01-01T00:00:00.000Z' }), 410],
  ])('refuses an %s token before signing side effects', async (_label, signReq, status) => {
    const fetchMock = vi.fn(async () => rpcResponse(signReq));
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      request: postRequest(),
      env: ENV,
    });

    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0]))
      .toContain('/rest/v1/rpc/get_sign_request_by_token');
    expectNoSigningSideEffects(fetchMock);
  });

  it('returns a stable public error without upstream SQL or storage details', async () => {
    const upstreamSecret =
      'postgres failure: relation private_table contains secret-value';
    const fetchMock = vi.fn(async () => rpcResponse(
      { message: upstreamSecret },
      500,
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      request: postRequest(),
      env: ENV,
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: 'Unable to complete signing request',
    });
    expect(body.reference).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(upstreamSecret);
    expectNoSigningSideEffects(fetchMock);
  });
});

describe('notifyEsignSigned (esign.signed rewire)', () => {
  it('emits esign.signed with job link + doc payload', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyEsignSigned({
      db: {}, env: ENV, job: JOB, docLabel: 'Work Authorization',
      docType: 'work_auth', signerName: 'Jane Homeowner', jobDocumentId: 'doc-9', dispatchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].typeKey).toBe('esign.signed');
    expect(calls[0].body.link).toBe('/jobs/job-1');
    expect(calls[0].body.entity_type).toBe('job');
    expect(calls[0].body.job_id).toBe('job-1');
    expect(calls[0].body.title).toContain('Jane Homeowner');
    expect(calls[0].body.title).toContain('Work Authorization');
    expect(calls[0].body.payload.doc_type).toBe('work_auth');
    expect(calls[0].body.payload.job_document_id).toBe('doc-9');
  });

  it('never throws when the dispatcher fails (signing already stored)', async () => {
    const dispatchImpl = async () => { throw new Error('down'); };
    await expect(
      notifyEsignSigned({ db: {}, env: ENV, job: JOB, docLabel: 'CoC', docType: 'coc', signerName: 'X', dispatchImpl }),
    ).resolves.toBeUndefined();
  });
});
