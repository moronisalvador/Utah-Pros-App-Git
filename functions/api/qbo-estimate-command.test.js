/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-command.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that estimate saves, emails, deletes, and retries follow the safe
 *   order. Every outside service and database response is replaced with a
 *   local test double, so these checks never contact QuickBooks or Supabase.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-estimate.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Call-order assertions are part of the money-safety contract.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existing: null,
  conn: { refresh_token: 'refresh', realm_id: 'realm-1' },
  estimate: null,
  lines: [],
  job: null,
  claim: null,
  contact: null,
  reserve: vi.fn(async () => ({ ok: true, reserved: true })),
  release: vi.fn(async () => ({ ok: true, released: true })),
  prepare: vi.fn(async () => ({ ok: true, prepared: true })),
  start: vi.fn(async () => ({ ok: true, started: true })),
  setState: vi.fn(async () => ({ ok: true })),
  finalize: vi.fn(async () => ({ ok: true })),
  ensure: vi.fn(async () => true),
  create: vi.fn(async () => ({ Id: 'qbo-estimate-1', DocNumber: 'EST-1001', TotalAmt: 100 })),
  update: vi.fn(),
  send: vi.fn(),
  remove: vi.fn(),
  db: null,
  boundedFetch: vi.fn(),
  supabaseFetch: null,
  providerTrafficEnabled: true,
  documentCommandsEnabled: true,
  recordRun: vi.fn(async () => undefined),
}));

vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboBrowserRequest: vi.fn(async () => ({ ok: true, via: 'bearer', user: { id: '00000000-0000-4000-8000-000000000010' }, employee: { id: '00000000-0000-4000-8000-000000000011' } })),
}));
vi.mock('../lib/http.js', () => ({ fetchWithTimeout: state.boundedFetch }));
vi.mock('../lib/supabase.js', () => ({ supabase: (_env, fetchImpl) => {
  state.supabaseFetch = fetchImpl;
  return state.db;
} }));
vi.mock('../lib/intuit.js', () => ({ sha256hex: vi.fn(async () => 'a'.repeat(64)) }));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(async () => state.conn),
  divisionToQbo: vi.fn(() => ({ itemId: 'item-water', className: 'Mitigation' })),
  customerCreateRequestId: vi.fn(async () => 'upr-c-stable-customer-request'),
  ensureQboCustomer: (...args) => state.ensure(...args),
  createEstimate: (...args) => state.create(...args),
  updateEstimate: (...args) => state.update(...args),
  sendEstimate: (...args) => state.send(...args),
  deleteEstimate: (...args) => state.remove(...args),
}));
vi.mock('../lib/qbo-estimate-commands.js', () => ({
  QBO_ESTIMATE_COMMAND_ID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  hashEstimateCommand: vi.fn(async (value) => JSON.stringify(value)),
  qboEstimateActor: (auth) => ({ initiator: 'browser', authUserId: auth.user.id, employeeId: auth.employee.id }),
  getQboEstimateCommand: vi.fn(async () => state.existing || { ok: false, reason: 'command-not-found' }),
  qboEstimateCommandIdentityMatches: vi.fn((command, identity) => command.request_hash === identity.requestHash),
  isTerminalQboEstimateCommand: (command) => ['succeeded', 'rejected'].includes(command?.status),
  reserveQboEstimateCommand: (...args) => state.reserve(...args),
  releaseQboEstimateCommandReservation: (...args) => state.release(...args),
  prepareQboEstimateCommand: (...args) => state.prepare(...args),
  startQboEstimateCommandAttempt: (...args) => state.start(...args),
  setQboEstimateCommandState: (...args) => state.setState(...args),
  finalizeQboEstimateCommand: (...args) => state.finalize(...args),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: (...args) => state.recordRun(...args),
}));

import { onRequestPost, qboEstimateLineAmount, validateEstimateCommandBody } from './qbo-estimate.js';

const ESTIMATE_ID = '00000000-0000-4000-8000-000000000001';
const LINE_ID = '00000000-0000-4000-8000-000000000002';
const COMMAND_ID = '00000000-0000-4000-8000-000000000003';
const requestHash = ({ sendTo = null, lineChange = null } = {}) => JSON.stringify({ send_to: sendTo, line_change: lineChange });

function request(body = { estimate_id: ESTIMATE_ID, action: 'save' }) {
  return new Request('https://app.test/api/qbo-estimate', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json', 'Idempotency-Key': COMMAND_ID },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.existing = null;
  state.supabaseFetch = null;
  state.providerTrafficEnabled = true;
  state.documentCommandsEnabled = true;
  state.recordRun.mockResolvedValue(undefined);
  state.conn = { refresh_token: 'refresh', realm_id: 'realm-1' };
  state.estimate = {
    id: ESTIMATE_ID, status: 'draft', converted_invoice_id: null,
    contact_id: '00000000-0000-4000-8000-000000000020', job_id: '00000000-0000-4000-8000-000000000021',
    intended_division: 'water', estimate_number: 'EST-1001', expiration_date: '2026-09-01',
    property_address: '1 Main St', property_city: 'Salt Lake City', property_state: 'UT', property_zip: '84101',
    qbo_estimate_id: null,
  };
  state.lines = [{ id: LINE_ID, description: 'Water mitigation', quantity: 2, unit_price: 50, line_total: 999999, sort_order: 0 }];
  state.job = { id: state.estimate.job_id, job_number: 'W-100', claim_id: '00000000-0000-4000-8000-000000000022', date_of_loss: '2026-08-09', division: 'water' };
  state.claim = { id: state.job.claim_id, claim_number: 'CLM-1', date_of_loss: '2026-08-08' };
  state.contact = { id: state.estimate.contact_id, name: 'Customer', email: 'customer@example.test', qbo_customer_id: 'customer-qbo-1' };
  state.reserve.mockResolvedValue({ ok: true, reserved: true });
  state.release.mockResolvedValue({ ok: true, released: true });
  state.prepare.mockResolvedValue({ ok: true, prepared: true });
  state.start.mockResolvedValue({ ok: true, started: true });
  state.setState.mockResolvedValue({ ok: true });
  state.finalize.mockResolvedValue({ ok: true });
  state.ensure.mockResolvedValue(true);
  state.create.mockResolvedValue({ Id: 'qbo-estimate-1', DocNumber: 'EST-1001', TotalAmt: 100 });
  state.update.mockResolvedValue({ Id: 'qbo-estimate-1', DocNumber: 'EST-1001', TotalAmt: 100 });
  state.send.mockResolvedValue({ Id: 'qbo-estimate-1', EmailStatus: 'EmailSent' });
  state.remove.mockResolvedValue(true);
  state.db = {
    select: vi.fn(async (table) => {
      if (table === 'integration_config') return state.providerTrafficEnabled ? [{ value: 'true' }] : [];
      if (table === 'feature_flags') return state.documentCommandsEnabled
        ? [{ key: 'feature:qbo_document_command_v2', enabled: true, force_disabled: false }]
        : [];
      if (table === 'estimates') return state.estimate ? [state.estimate] : [];
      if (table === 'estimate_line_items') return state.lines;
      if (table === 'jobs') return state.job ? [state.job] : [];
      if (table === 'claims') return state.claim ? [state.claim] : [];
      if (table === 'contacts') return state.contact ? [state.contact] : [];
      return [];
    }),
    insert: vi.fn(async () => []),
  };
});

describe('QBO estimate command endpoint', () => {
  it.each(['save', 'send', 'delete'])('denies %s before command lookup, reservation, or provider work when document commands are off', async (action) => {
    state.documentCommandsEnabled = false;
    const res = await onRequestPost({ request: request({ estimate_id: ESTIMATE_ID, action }), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'qbo_document_command_v2_disabled' });
    expect(state.reserve).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it('denies before document command work when provider traffic is closed', async () => {
    state.providerTrafficEnabled = false;
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    expect(state.reserve).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('retains the started estimate command and returns the stable 503 when maintenance closes at provider dispatch', async () => {
    const closed = new Error('QuickBooks provider traffic is temporarily disabled.');
    closed.code = 'qbo_provider_traffic_disabled'; closed.reason = 'qbo_provider_traffic_disabled'; closed.status = 503;
    state.create.mockRejectedValueOnce(closed);
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled', retry_same_request: true });
    expect(state.setState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'ambiguous', responseStatus: 503 }));
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it('accepts only a closed, numeric line-change shape and never accepts line_total', () => {
    const patch = { description: ' Labor ', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 2, unit_price: 12.5 };
    expect(validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', patch } }).lineChange.patch.description).toBe('Labor');
    expect(() => validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', patch: { ...patch, line_total: 25 } } })).toThrow(/unsupported field "line_total"/);
    expect(() => validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', line_id: LINE_ID, patch } })).toThrow(/unsupported field "line_id"/);
    expect(() => validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', patch: { ...patch, description: ' ' } } })).toThrow(/description is required/);
    expect(() => validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', patch: { ...patch, quantity: '2' } } })).toThrow(/must be numbers/);
    expect(qboEstimateLineAmount({ quantity: 3, unit_price: 10.125, line_total: 5000 })).toBe(30.38);
    expect(qboEstimateLineAmount({ quantity: 1, unit_price: 1.005 })).toBe(1.01);
    expect(qboEstimateLineAmount({ quantity: 1, unit_price: 10.075 })).toBe(10.08);
    expect(qboEstimateLineAmount({ quantity: '1.000000000000000000', unit_price: '1.005000000000000000' })).toBe(1.01);
    expect(qboEstimateLineAmount({ quantity: '1', unit_price: '-10.075' })).toBe(-10.08);
  });

  it('uses exact minor units when deciding whether the whole estimate is positive', async () => {
    state.lines = [
      { ...state.lines[0], id: LINE_ID, quantity: 1, unit_price: 0.1, sort_order: 0 },
      { ...state.lines[0], id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', quantity: 1, unit_price: 0.2, sort_order: 1 },
      { ...state.lines[0], id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', quantity: 1, unit_price: -0.3, sort_order: 2 },
    ];
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/total is 0/) });
    expect(state.reserve).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('freezes full accounting context and computes provider Amount from quantity times rate', async () => {
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    const [, payload, options] = state.create.mock.calls[0];
    expect(payload.Line[0].Amount).toBe(100);
    expect(payload.Line[0].SalesItemLineDetail.ClassRef.value).toBe('1000000005');
    expect(payload.PrivateNote).toContain('Date of loss: 8/9/2026');
    expect(payload.PrivateNote).toContain('Job: W-100');
    expect(payload.PrivateNote).toContain('Claim: CLM-1');
    expect(payload.ShipAddr).toEqual({ Line1: '1 Main St', City: 'Salt Lake City', CountrySubDivisionCode: 'UT', PostalCode: '84101' });
    expect(payload.DocNumber).toBe('EST-1001');
    expect(payload.ExpirationDate).toBe('2026-09-01');
    expect(options.requestId).toMatch(/^upr-e-c-/);
    expect(options.expectedRealmId).toBe('realm-1');
    expect(state.start.mock.invocationCallOrder[0]).toBeLessThan(state.create.mock.invocationCallOrder[0]);
    expect(state.reserve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ prerequisite: { kind: 'customer_sync', contact_id: state.contact.id, primary_request_id: 'upr-c-stable-customer-request' } }));
    expect(state.prepare.mock.calls[0][1].intent.provider_source_preimage).toMatchObject({
      estimate: { id: ESTIMATE_ID, intended_division: 'water', property_address: '1 Main St' },
      job: { id: state.job.id, job_number: 'W-100' },
      contact: { id: state.contact.id, qbo_customer_id: 'customer-qbo-1' },
      claim: { id: state.claim.id, claim_number: 'CLM-1' },
    });
  });

  it('flows a scope of work past the 4,000-character QuickBooks cap onto DescriptionOnly rows', async () => {
    // The 2026-08-14 field report: a full Category 3 scope narrative on one
    // line was refused with "Every line item needs a valid description."
    const scope = `Scope of Work – Water Damage Mitigation\nCategory 3 Water Loss | Storm/Flood Intrusion\n${'All affected drywall will be removed via flood cut per IICRC S500 and disposed of under Category 3 protocols. '.repeat(80)}Carpet will be pulled back, pad removed, and carpet reset.`;
    expect(scope.length).toBeGreaterThan(4000);
    state.lines = [{ id: LINE_ID, description: scope, quantity: 1, unit_price: 7779.5, sort_order: 0 }];

    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    const [, payload] = state.create.mock.calls[0];
    expect(payload.Line.length).toBeGreaterThan(1);
    // The priced line keeps the amount, item, class, and the first segment.
    expect(payload.Line[0]).toMatchObject({
      DetailType: 'SalesItemLineDetail', Amount: 7779.5,
      SalesItemLineDetail: { ItemRef: { value: 'item-water' }, ClassRef: { value: '1000000005' }, Qty: 1, UnitPrice: 7779.5 },
    });
    // Every continuation row is text-only — no Amount, no item, no class.
    for (const row of payload.Line.slice(1)) {
      expect(row).toEqual({ DetailType: 'DescriptionOnly', Description: expect.any(String), DescriptionLineDetail: {} });
    }
    // The whole narrative survives, in order, and each row fits the cap.
    expect(payload.Line.map((row) => row.Description).join('')).toBe(scope);
    expect(payload.Line.every((row) => row.Description.length <= 4000)).toBe(true);
  });

  it('names the exact line when a description is missing, before any reservation', async () => {
    state.lines = [
      { ...state.lines[0], sort_order: 0 },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', description: '', quantity: 1, unit_price: 0, sort_order: 1 },
    ];
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Line 2 has no description — add one or remove that line.' });
    expect(state.reserve).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('names the exact line and both lengths when a description exceeds the ceiling', async () => {
    state.lines = [{ ...state.lines[0], description: 'x'.repeat(20001) }];
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Line 1's description is 20,001 characters — the limit is 20,000. Shorten it and save again.",
    });
    expect(state.reserve).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('accepts a 4,000-plus-character description in a line patch but refuses one past the ceiling', () => {
    const patch = { description: 'd'.repeat(4001), qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 10 };
    expect(validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', patch } }).lineChange.patch.description.length).toBe(4001);
    expect(() => validateEstimateCommandBody({ estimate_id: ESTIMATE_ID, action: 'save', line_change: { kind: 'create', patch: { ...patch, description: 'd'.repeat(20001) } } }))
      .toThrow(/20,001 characters — the limit is 20,000/);
  });

  it('discards a stale preflight and freezes the authoritative post-reservation line snapshot', async () => {
    const events = [];
    let lineReads = 0;
    const originalSelect = state.db.select;
    state.reserve.mockImplementationOnce(async () => { events.push('reserve'); return { ok: true, reserved: true }; });
    state.db.select = vi.fn(async (table, query) => {
      if (table === 'estimate_line_items') {
        lineReads += 1; events.push(`lines-${lineReads}`);
        return lineReads === 1 ? state.lines : [{ ...state.lines[0], quantity: '3', unit_price: '10.075' }];
      }
      return originalSelect(table, query);
    });

    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(events).toEqual(['lines-1', 'reserve', 'lines-2']);
    expect(state.create.mock.calls[0][1].Line[0].Amount).toBe(30.23);
    const intent = state.prepare.mock.calls[0][1].intent;
    expect(intent.document_line_preimage).toEqual([
      expect.objectContaining({ id: LINE_ID, quantity: 3, unit_price: 10.075 }),
    ]);
    expect(intent.document_line_preimage_hash).toBeTruthy();
  });

  it('retains the reservation when customer sync is unknown, then converges on exact retry', async () => {
    state.contact = { ...state.contact, qbo_customer_id: null };
    state.ensure
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => { state.contact = { ...state.contact, qbo_customer_id: 'customer-qbo-1' }; return true; });

    const first = await onRequestPost({ request: request(), env: {} });
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({ code: 'customer-prerequisite-unknown', retry_same_request: true });
    expect(state.release).not.toHaveBeenCalled();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();

    const second = await onRequestPost({ request: request(), env: {} });
    expect(second.status).toBe(200);
    expect(state.ensure).toHaveBeenCalledTimes(2);
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.reserve).toHaveBeenCalledTimes(2);
  });

  it('retains a reservation-only UUID when the QBO connection disappears before retry', async () => {
    state.contact = { ...state.contact, qbo_customer_id: null };
    state.ensure.mockResolvedValue(false);

    const first = await onRequestPost({ request: request(), env: {} });
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      code: 'customer-prerequisite-unknown',
      retry_same_request: true,
    });
    expect(state.reserve).toHaveBeenCalledOnce();
    expect(state.prepare).not.toHaveBeenCalled();

    state.conn = null;
    const retry = await onRequestPost({ request: request(), env: {} });
    expect(retry.status).toBe(503);
    await expect(retry.json()).resolves.toMatchObject({
      code: 'qbo-connection-unavailable',
      retry_same_request: true,
    });
    expect(state.reserve).toHaveBeenCalledOnce();
    expect(state.ensure).toHaveBeenCalledOnce();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('releases a reservation when the authoritative post-reservation snapshot is deterministically invalid', async () => {
    let lineReads = 0;
    const originalSelect = state.db.select;
    state.db.select = vi.fn(async (table, query) => {
      if (table === 'estimate_line_items') {
        lineReads += 1;
        return lineReads === 1 ? state.lines : [{ ...state.lines[0], description: '   ' }];
      }
      return originalSelect(table, query);
    });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(400);
    expect(state.release).toHaveBeenCalledWith(expect.anything(), { commandId: COMMAND_ID, estimateId: ESTIMATE_ID });
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('retains the same request when prepare cleanup cannot be proven', async () => {
    state.prepare.mockResolvedValue({ ok: false, reason: 'prepare-failed' });
    state.release.mockResolvedValue({ ok: false, reason: 'release-failed' });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'reservation-release-failed', retry_same_request: true });
    expect(state.create).not.toHaveBeenCalled();
  });

  it('never calls a provider when the start RPC does not prove a fresh attempt', async () => {
    state.start.mockResolvedValue({ ok: false, reason: 'attempt-not-fresh', status: 'provider_started' });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ retry_same_request: true });
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each(['provider_started', 'ambiguous', 'needs_reconciliation'])('never repeats the provider for an existing %s command', async (status) => {
    state.existing = { ok: true, status, action: 'save', request_hash: requestHash() };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(status === 'needs_reconciliation' ? 409 : 503);
    expect(state.start).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('starts a recovered prepared command once from its frozen payload', async () => {
    state.existing = {
      ok: true, status: 'prepared', action: 'save', target_qbo_estimate_id: null,
      realm_id: 'realm-1', request_hash: requestHash(),
      intent_payload: { provider_action: 'create', provider_request_id: 'frozen-request', provider_payload: { CustomerRef: { value: 'frozen-customer' }, Line: [] } },
    };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(state.start).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerRequestId: 'frozen-request' }));
    expect(state.create).toHaveBeenCalledWith(expect.anything(), state.existing.intent_payload.provider_payload, {
      requestId: 'frozen-request',
      expectedRealmId: 'realm-1',
    });
    expect(state.db.select).not.toHaveBeenCalledWith('estimates', expect.anything());
  });

  it('finalizes provider_succeeded recovery without another provider call', async () => {
    state.existing = { ok: true, status: 'provider_succeeded', action: 'save', request_hash: requestHash(), expected_qbo_estimate_id: null, provider_result: { qbo_estimate_id: 'qbo-estimate-1', doc_number: 'EST-1001', total: 100 } };
    state.finalize.mockImplementationOnce(async () => { state.existing = { ...state.existing, status: 'succeeded', response_status: 200, response_payload: { ok: true, mode: 'created', qbo_estimate_id: 'qbo-estimate-1', doc_number: 'EST-1001', total: 100 } }; return { ok: true }; });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(state.finalize).toHaveBeenCalledOnce();
    expect(state.start).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('replays a stored terminal response exactly without local or provider work', async () => {
    state.existing = { ok: true, status: 'succeeded', action: 'send', request_hash: requestHash(), response_status: 200, response_payload: { ok: true, emailed_to: 'frozen@example.test' } };
    const res = await onRequestPost({ request: request({ estimate_id: ESTIMATE_ID, action: 'send' }), env: {} });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, emailed_to: 'frozen@example.test' });
    expect(state.finalize).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it.each([
    ['succeeded', 200, { response_status: 200, response_payload: { ok: true, mode: 'created', qbo_estimate_id: 'qbo-estimate-1' } }],
    ['ambiguous', 503, {}],
  ])('recovers an existing %s command before requiring current QBO credentials', async (status, expectedStatus, extra) => {
    state.conn = null;
    state.existing = { ok: true, status, action: 'save', realm_id: 'realm-1', request_hash: requestHash(), ...extra };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(expectedStatus);
    if (status === 'ambiguous') await expect(res.json()).resolves.toMatchObject({ retry_same_request: true });
    expect(state.start).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('keeps a recovered prepared command when its original QBO connection is unavailable', async () => {
    state.conn = null;
    state.existing = {
      ok: true, status: 'prepared', action: 'save', realm_id: 'realm-1', request_hash: requestHash(),
      intent_payload: { provider_action: 'create', provider_request_id: 'frozen-request', provider_payload: { Line: [] } },
    };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'qbo-connection-unavailable', retry_same_request: true });
    expect(state.start).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('rejects a direct HTTP same-key body change before replay or provider access', async () => {
    state.existing = {
      ok: true, status: 'succeeded', action: 'send',
      request_hash: requestHash({ sendTo: 'original@example.test' }),
      response_status: 200, response_payload: { ok: true, emailed_to: 'original@example.test' },
    };
    const res = await onRequestPost({ request: request({ estimate_id: ESTIMATE_ID, action: 'send', send_to: 'changed@example.test' }), env: {} });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/different estimate command or request body/) });
    expect(state.send).not.toHaveBeenCalled();
    // Route gates read only their own fail-closed switches before rejecting;
    // no estimate/command source may be loaded for the mismatched retry.
    expect(state.db.select.mock.calls.map(([table]) => table)).toEqual([
      'feature_flags', 'integration_config',
    ]);
  });

  it.each([
    ['send', { estimate_id: ESTIMATE_ID, action: 'send', send_to: 'customer@example.test' }, 'send', { ok: true, emailed_to: 'customer@example.test', email_status: 'EmailSent' }],
    ['delete', { estimate_id: ESTIMATE_ID, action: 'delete' }, 'remove', { deleted: 'qbo-estimate-1' }],
  ])('finalizes %s once and replays its stored response without repeating QBO', async (action, body, providerKey, expected) => {
    state.estimate = { ...state.estimate, qbo_estimate_id: 'qbo-estimate-1', status: 'submitted' };
    const first = await onRequestPost({ request: request(body), env: {} });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual(expected);
    expect(state[providerKey]).toHaveBeenCalledOnce();
    expect(state[providerKey].mock.calls[0].at(-1)).toEqual(expect.objectContaining({ requestId: expect.stringMatching(/^upr-e-/) }));

    state.existing = { ok: true, status: 'succeeded', action, request_hash: requestHash({ sendTo: action === 'send' ? 'customer@example.test' : null }), response_status: 200, response_payload: expected };
    const replay = await onRequestPost({ request: request(body), env: {} });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(expected);
    expect(state[providerKey]).toHaveBeenCalledOnce();
  });

  it('terminalizes a definitive provider rejection so its reservation is released by the RPC', async () => {
    const rejection = Object.assign(new Error('provider sensitive detail must not escape'), { status: 400, intuitTid: 'tid-400' });
    state.create.mockRejectedValue(rejection);
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'QuickBooks rejected the estimate command.', code: 'qbo_estimate_rejected', intuit_tid: 'tid-400', retry_same_request: false });
    expect(JSON.stringify(body)).not.toContain('provider sensitive detail must not escape');
    expect(state.setState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      commandId: COMMAND_ID,
      status: 'rejected',
      error: 'provider sensitive detail must not escape',
      responsePayload: expect.not.objectContaining({ error: 'provider sensitive detail must not escape' }),
    }));
    expect(state.recordRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workerName: 'qbo-estimate',
      status: 'error',
      errorMessage: 'qbo_estimate_rejected',
    }));
    expect(JSON.stringify(state.recordRun.mock.calls)).not.toContain('provider sensitive detail must not escape');
    expect(state.release).not.toHaveBeenCalled();
  });

  it('terminalizes a definitive delete rejection instead of retaining an ambiguous fence', async () => {
    state.estimate = { ...state.estimate, qbo_estimate_id: 'qbo-estimate-1', status: 'submitted' };
    state.remove.mockRejectedValue(Object.assign(new Error('delete rejected'), { status: 400, intuitTid: 'delete-tid' }));
    const res = await onRequestPost({ request: request({ estimate_id: ESTIMATE_ID, action: 'delete' }), env: {} });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: 'QuickBooks rejected the estimate command.', code: 'qbo_estimate_rejected', retry_same_request: false });
    expect(state.setState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'rejected', intuitRequestId: 'delete-tid' }));
    expect(state.release).not.toHaveBeenCalled();
  });

  it('keeps the exact command identity when a definitive rejection cannot be recorded', async () => {
    state.create.mockRejectedValue(Object.assign(new Error('invalid estimate'), { status: 400 }));
    state.setState.mockResolvedValue({ ok: false, reason: 'state-write-failed' });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'state-write-failed', retry_same_request: true });
  });

  it('retains an update with a mismatched provider estimate identity for reconciliation', async () => {
    state.estimate = { ...state.estimate, qbo_estimate_id: 'qbo-estimate-1', status: 'submitted' };
    state.update.mockResolvedValue({ Id: 'different-estimate', DocNumber: 'EST-OTHER', TotalAmt: 100 });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ retry_same_request: true });
    expect(state.setState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'ambiguous' }));
  });

  it('retains provider success as needs_reconciliation when local finalization fails', async () => {
    state.finalize.mockResolvedValue({ ok: false, reason: 'line-source-mismatch' });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'line-source-mismatch', retry_same_request: true });
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.setState).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ status: 'provider_succeeded' }));
    expect(state.setState).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ status: 'needs_reconciliation' }));
    expect(state.release).not.toHaveBeenCalled();
  });
});
