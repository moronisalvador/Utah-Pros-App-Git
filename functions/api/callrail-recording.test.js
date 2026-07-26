/**
 * ════════════════════════════════════════════════
 * FILE: callrail-recording.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the CallRail recording proxy behind an active internal admin or the
 *   existing crm_call_log capability, binds the requested lead to its stored
 *   CallRail call id, and proves rejected requests never reach credentials or
 *   provider helpers. It also preserves the deployed audio proxy/error shapes.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./callrail-recording.js
 *
 * NOTES / GOTCHAS:
 *   - Pure Worker tests. All database, Auth, CallRail and signed-audio calls are
 *     fakes; no credential value, customer content or provider is contacted.
 * ════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCallrailRecording } from './callrail-recording.js';

const LEAD_ID = '11111111-1111-4111-8111-111111111111';
const CALL_ID = 'CALabc123';
const API_RECORDING_URL = `https://api.callrail.com/v3/a/acc-1/calls/${CALL_ID}/recording.json`;
const APP_RECORDING_URL = `https://app.callrail.com/calls/${CALL_ID}/recording/redirect?access_key=fake`;
const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
};

function recordingRequest({
  leadId = LEAD_ID,
  auth = 'Bearer token',
} = {}) {
  const headers = auth ? { Authorization: auth } : {};
  const query = leadId === null ? '' : `?lead_id=${encodeURIComponent(leadId)}`;
  return new Request(`https://app.test/api/callrail-recording${query}`, { headers });
}

function employee(overrides = {}) {
  return {
    id: 'employee-1',
    role: 'admin',
    is_active: true,
    is_external: false,
    ...overrides,
  };
}

function lead(overrides = {}) {
  return {
    id: LEAD_ID,
    source_type: 'call',
    callrail_id: CALL_ID,
    recording_url: API_RECORDING_URL,
    ...overrides,
  };
}

function makeDb({
  actor = employee(),
  override = null,
  permission = null,
  leadRow = lead(),
  credential = { access_token: 'not-a-real-key' },
  throwTable = null,
} = {}) {
  const calls = [];
  return {
    calls,
    async select(table, query) {
      calls.push({ table, query });
      if (table === throwTable) throw new Error('read failed');
      if (table === 'employees') return actor ? [actor] : [];
      if (table === 'employee_page_access') return override ? [override] : [];
      if (table === 'nav_permissions') return permission ? [permission] : [];
      if (table === 'inbound_leads') return leadRow ? [leadRow] : [];
      if (table === 'integration_credentials') return credential ? [credential] : [];
      return [];
    },
  };
}

function mockAuthUser({ status = 200, user = { id: 'user-1' } } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(status === 200 ? JSON.stringify(user) : '', { status }),
  );
}

function downstream() {
  return {
    resolveRecordingImpl: vi.fn(),
    resolveAccountIdImpl: vi.fn(),
    fetchSignedAudioImpl: vi.fn(),
  };
}

async function invoke({
  request = recordingRequest(),
  env = ENV,
  db = makeDb(),
  deps = downstream(),
} = {}) {
  return {
    response: await handleCallrailRecording({ request, env, db, ...deps }),
    db,
    deps,
  };
}

async function expectJson(response, status, body) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual(body);
}

function expectNoProvider(deps) {
  expect(deps.resolveAccountIdImpl).not.toHaveBeenCalled();
  expect(deps.resolveRecordingImpl).not.toHaveBeenCalled();
  expect(deps.fetchSignedAudioImpl).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CallRail recording identity containment', () => {
  it('preserves exact 401 Unauthorized when the session is missing', async () => {
    const deps = downstream();
    const db = makeDb();
    const { response } = await invoke({
      request: recordingRequest({ auth: null }),
      db,
      deps,
    });

    await expectJson(response, 401, { error: 'Unauthorized' });
    expect(db.calls).toEqual([]);
    expectNoProvider(deps);
  });

  it('preserves exact 401 Unauthorized for an invalid session', async () => {
    const fetchSpy = mockAuthUser({ status: 401 });
    const deps = downstream();
    const db = makeDb();
    const { response } = await invoke({ db, deps });

    await expectJson(response, 401, { error: 'Unauthorized' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(db.calls).toEqual([]);
    expectNoProvider(deps);
  });

  it('fails closed when Auth configuration is absent', async () => {
    const deps = downstream();
    const db = makeDb();
    const { response } = await invoke({ env: {}, db, deps });

    await expectJson(response, 500, { error: 'Authorization check failed' });
    expect(db.calls).toEqual([]);
    expectNoProvider(deps);
  });

  it('fails closed when the Auth service is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const deps = downstream();
    const db = makeDb();
    const { response } = await invoke({ db, deps });

    await expectJson(response, 502, { error: 'Authorization check failed' });
    expect(db.calls).toEqual([]);
    expectNoProvider(deps);
  });

  it.each([
    ['missing employee', null],
    ['inactive employee', employee({ is_active: false })],
    ['external admin', employee({ is_external: true })],
  ])('denies a %s before lead, credential or provider access', async (_label, actor) => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({ actor });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 403, { error: 'Forbidden' });
    expect(db.calls.map((call) => call.table)).toEqual(['employees']);
    expectNoProvider(deps);
  });

  it('denies an internal role without crm_call_log access', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({ actor: employee({ role: 'office' }) });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 403, { error: 'Forbidden' });
    expect(db.calls.map((call) => call.table)).toEqual([
      'employees',
      'employee_page_access',
      'nav_permissions',
    ]);
    expectNoProvider(deps);
  });

  it('allows an active internal employee with an explicit crm_call_log capability', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'stream',
      response: new Response('audio'),
      contentType: 'audio/mpeg',
    });
    const db = makeDb({
      actor: employee({ role: 'office' }),
      override: { can_view: true },
    });
    const { response } = await invoke({ db, deps });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(db.calls.map((call) => call.table)).toEqual([
      'employees',
      'employee_page_access',
      'inbound_leads',
      'integration_credentials',
    ]);
  });

  it('allows an active internal employee through the crm_call_log role capability', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'stream',
      response: new Response('audio'),
      contentType: 'audio/mpeg',
    });
    const db = makeDb({
      actor: employee({ role: 'office' }),
      permission: { can_view: true },
    });
    const { response } = await invoke({ db, deps });

    expect(response.status).toBe(200);
    expect(db.calls.map((call) => call.table)).toEqual([
      'employees',
      'employee_page_access',
      'nav_permissions',
      'inbound_leads',
      'integration_credentials',
    ]);
  });

  it('lets an explicit employee denial override a non-admin role capability', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({
      actor: employee({ role: 'office' }),
      override: { can_view: false },
      permission: { can_view: true },
    });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 403, { error: 'Forbidden' });
    expect(db.calls.map((call) => call.table)).toEqual([
      'employees',
      'employee_page_access',
    ]);
    expectNoProvider(deps);
  });

  it('fails closed when the capability lookup fails', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({
      actor: employee({ role: 'office' }),
      throwTable: 'employee_page_access',
    });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 500, { error: 'Authorization check failed' });
    expectNoProvider(deps);
  });
});

describe('CallRail recording object and configuration scope', () => {
  it.each([
    ['malformed lead id', 'not-a-uuid', makeDb()],
    ['missing lead', LEAD_ID, makeDb({ leadRow: null })],
    ['non-call lead', LEAD_ID, makeDb({ leadRow: lead({ source_type: 'form' }) })],
    ['mismatched provider call id', LEAD_ID, makeDb({ leadRow: lead({ callrail_id: 'CALdifferent' }) })],
  ])('returns 404 for a %s before credentials or providers', async (_label, leadId, db) => {
    mockAuthUser();
    const deps = downstream();
    const { response } = await invoke({
      request: recordingRequest({ leadId }),
      db,
      deps,
    });

    await expectJson(response, 404, { error: 'No recording for this lead' });
    expect(db.calls.some((call) => call.table === 'integration_credentials')).toBe(false);
    expectNoProvider(deps);
  });

  it('preserves the unsupported recording URL contract before credential access', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({
      leadRow: lead({ recording_url: `https://example.test/calls/${CALL_ID}/recording.json` }),
    });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 400, { error: 'Unsupported recording URL' });
    expect(db.calls.some((call) => call.table === 'integration_credentials')).toBe(false);
    expectNoProvider(deps);
  });

  it('preserves the missing credential response and never calls CallRail', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({ credential: null });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 400, { error: 'CallRail not connected' });
    expectNoProvider(deps);
  });

  it('fails closed on a lead lookup error before credential access', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({ throwTable: 'inbound_leads' });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 500, { error: 'Lead lookup failed' });
    expect(db.calls.some((call) => call.table === 'integration_credentials')).toBe(false);
    expectNoProvider(deps);
  });

  it('fails closed on a credential lookup error before calling CallRail', async () => {
    mockAuthUser();
    const deps = downstream();
    const db = makeDb({ throwTable: 'integration_credentials' });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 500, { error: 'CallRail configuration lookup failed' });
    expectNoProvider(deps);
  });
});

describe('CallRail recording proxy contracts', () => {
  it('preserves direct audio streaming headers and does not forward Range', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'stream',
      response: new Response('audio'),
      contentType: 'audio/mpeg',
    });
    const { response } = await invoke({
      request: new Request(
        `https://app.test/api/callrail-recording?lead_id=${LEAD_ID}`,
        { headers: { Authorization: 'Bearer token', Range: 'bytes=0-99' } },
      ),
      deps,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(deps.resolveRecordingImpl).toHaveBeenCalledWith('not-a-real-key', API_RECORDING_URL);
    expect(deps.resolveAccountIdImpl).not.toHaveBeenCalled();
  });

  it('preserves app-to-api rewriting before the recording fetch', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveAccountIdImpl.mockResolvedValue('account-9');
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'stream',
      response: new Response('audio'),
      contentType: 'audio/wav',
    });
    const db = makeDb({ leadRow: lead({ recording_url: APP_RECORDING_URL }) });
    const { response } = await invoke({ db, deps });

    expect(response.status).toBe(200);
    expect(deps.resolveRecordingImpl).toHaveBeenCalledWith(
      'not-a-real-key',
      `https://api.callrail.com/v3/a/account-9/calls/${CALL_ID}/recording.json`,
    );
  });

  it('streams a signed audio URL without attaching provider authorization', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'url',
      url: 'https://signed-audio.test/object',
    });
    deps.fetchSignedAudioImpl.mockResolvedValue(new Response('audio', {
      status: 200,
      headers: { 'Content-Type': 'audio/ogg' },
    }));
    const { response } = await invoke({ deps });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/ogg');
    expect(deps.fetchSignedAudioImpl).toHaveBeenCalledWith('https://signed-audio.test/object');
  });

  it('returns clean 502 JSON when the timed signed-audio fetch rejects', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'url',
      url: 'https://signed-audio.test/object',
    });
    deps.fetchSignedAudioImpl.mockRejectedValue(new Error('timeout'));
    const { response } = await invoke({ deps });

    await expectJson(response, 502, { error: 'Signed audio fetch failed (0)' });
  });

  it('returns clean 502 JSON when CallRail account resolution fails', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveAccountIdImpl.mockRejectedValue(new Error('account lookup failed'));
    const db = makeDb({ leadRow: lead({ recording_url: APP_RECORDING_URL }) });
    const { response } = await invoke({ db, deps });

    await expectJson(response, 502, { error: 'CallRail recording fetch failed (0)' });
    expect(deps.resolveRecordingImpl).not.toHaveBeenCalled();
    expect(deps.fetchSignedAudioImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['non-OK', new Response('upstream failed', { status: 503 }), 503],
    ['bodyless', new Response(null, { status: 200 }), 200],
  ])('preserves the signed-audio %s failure contract', async (_label, signedResponse, status) => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'url',
      url: 'https://signed-audio.test/object',
    });
    deps.fetchSignedAudioImpl.mockResolvedValue(signedResponse);
    const { response } = await invoke({ deps });

    await expectJson(response, 502, { error: `Signed audio fetch failed (${status})` });
  });

  it('preserves the provider fetch failure response shape', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'error',
      reason: 'fetch-failed',
      status: 0,
    });
    const { response } = await invoke({ deps });

    await expectJson(response, 502, { error: 'CallRail recording fetch failed (0)' });
  });

  it('preserves the JSON-without-audio response shape', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'error',
      reason: 'json-no-url',
      detail: 'missing recording_url',
    });
    const { response } = await invoke({ deps });

    await expectJson(response, 502, {
      error: 'CallRail returned JSON with no audio URL',
      detail: 'missing recording_url',
    });
  });

  it('preserves the unexpected provider response shape', async () => {
    mockAuthUser();
    const deps = downstream();
    deps.resolveRecordingImpl.mockResolvedValue({
      kind: 'error',
      reason: 'unexpected',
      status: 200,
      contentType: 'text/html',
      snippet: 'not audio',
    });
    const { response } = await invoke({ deps });

    await expectJson(response, 502, {
      error: 'Unexpected recording response (200, text/html)',
      snippet: 'not audio',
    });
  });
});
