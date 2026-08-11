/** Focused ledger/retry contract tests for /api/qbo-invoice. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/cors.js', () => ({ handleOptions: vi.fn(), jsonResponse: vi.fn((body, status) => ({ body, status })) }));
const state = vi.hoisted(() => ({ commands: new Map(), provider: vi.fn(), ensureCustomer: vi.fn(), findClass: vi.fn(), defaultClassName: null, qboCustomerId: 'customer-1', relink: vi.fn(async () => ({ id: 'new-customer', matchedBy: 'email' })), rpcs: [], updates: [], reservationCalls: [], reservationReleases: [], releaseResult: { ok: true, released: true }, releaseFailure: null, prepareResult: null, lineStageCalls: [], lineFinalizeCalls: [], lineChangeStageCalls: [], lineChangeFinalizeCalls: [], lineChangeStageError: null, lineStageResult: null, lineFinalizeResult: { ok: true, applied: true }, events: [], invoice: null, lines: [], recipient: 'billing@example.test', cas: { ok: true }, rpcFailure: null, ledgerFailure: null, providerTrafficEnabled: true, documentCommandsEnabled: true, auth: { ok: true, via: 'bearer', user: { id: '00000000-0000-4000-8000-0000000000a1' }, employee: { id: '00000000-0000-4000-8000-0000000000a2' } } }));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboBrowserRequest: vi.fn(async () => state.auth) }));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(async () => ({ refresh_token: 'r', realm_id: 'realm-1' })), divisionToQbo: vi.fn(() => ({ itemId: 'item-1', className: state.defaultClassName })),
  createInvoice: (...args) => state.provider(...args), updateInvoice: (...args) => state.provider(...args), sendInvoice: (...args) => state.provider(...args), deleteInvoice: (...args) => state.provider(...args),
  ensureQboCustomer: state.ensureCustomer, findClassId: state.findClass, relinkQboCustomer: state.relink, isStaleCustomerRef: (e) => /stale/i.test(e.message),
}));
vi.mock('../lib/qbo-reconciliation.js', () => ({ recordReconciliation: vi.fn() }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => ({
  select: async (table) => {
    if (table === 'integration_config') return state.providerTrafficEnabled ? [{ value: 'true' }] : [];
    if (table === 'feature_flags') return state.documentCommandsEnabled ? [{ key: 'feature:qbo_document_command_v2', enabled: true, force_disabled: false }] : [];
    if (table === 'invoices') return [state.invoice]; if (table === 'jobs') return [{ division: 'water', job_number: 'W-1' }];
    if (table === 'contacts') return [{ qbo_customer_id: state.qboCustomerId, email: state.recipient }]; if (table === 'invoice_line_items') return state.lines;
    if (table === 'integration_config' || table === 'claims' || table === 'estimates') return []; return [];
  }, update: async (...args) => { state.updates.push(args); }, insert: vi.fn(),
  rpc: async (fn, params) => { state.rpcs.push({ fn, params }); if (state.rpcFailure) { const failure = state.rpcFailure; state.rpcFailure = null; throw failure; } if (fn === 'cas_qbo_invoice_link') return state.cas; return { ok: true }; },
}) }));
vi.mock('../lib/qbo-invoice-commands.js', async () => {
  const identity = (c, x) => c?.ok && c.invoice_id === x.invoiceId && c.action === x.action && c.realm_id === x.realmId && c.initiator === x.actor.initiator && c.actor_auth_user_id === x.actor.authUserId && c.actor_employee_id === x.actor.employeeId;
  const canon = (value) => JSON.stringify((function sort(v) { if (Array.isArray(v)) return v.map(sort); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((key) => [key, sort(v[key])])); return v; }(value)));
  return {
    QBO_COMMAND_ID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    stableJsonStringify: canon, qboCommandActor: (a) => ({ initiator: a.via === 'bearer' ? 'browser' : 'webhook', authUserId: a.user?.id || null, employeeId: a.employee?.id || null }), qboCommandIdentityMatches: identity,
    isTerminalQboInvoiceCommand: (c) => ['succeeded', 'rejected'].includes(c?.status), getQboInvoiceCommand: vi.fn(async (_db, id) => state.commands.get(id) || { ok: false }),
    stageQboInvoiceLineUpdate: vi.fn(async (_db, args) => {
      state.events.push('stage');
      state.lineStageCalls.push(args);
      if (state.lineStageResult) return state.lineStageResult;
      const source = state.lines.find((line) => line.id === args.lineUpdate.line_id) || {};
      const fields = ['description', 'qbo_item_id', 'qbo_item_name', 'qbo_class_id', 'qbo_class_name', 'quantity', 'unit_price'];
      const preimage = Object.fromEntries(fields.map((field) => [field, source[field] ?? null]));
      const patch = Object.fromEntries(fields.map((field) => [field, args.lineUpdate[field] ?? null]));
      return { ok: true, line_update: { line_id: args.lineUpdate.line_id, preimage, patch } };
    }),
    finalizeQboInvoiceLineUpdate: vi.fn(async (_db, args) => {
      state.events.push('finalize');
      state.lineFinalizeCalls.push(args);
      return state.lineFinalizeResult;
    }),
    stageQboInvoiceLineChange: vi.fn(async (_db, args) => {
      state.events.push('stage-change'); state.lineChangeStageCalls.push(args);
      if (state.lineChangeStageError) throw state.lineChangeStageError;
      const change = args.lineChange;
      const stored = state.commands.get(args.commandId)?.intent_payload?.line_change;
      if (stored) return { ok: true, line_change: stored };
      const line = state.lines.find((item) => item.id === change.line_id);
      const preimage = line ? { ...line } : null;
      return { ok: true, line_change: { request: change, kind: change.kind, line_id: change.line_id || '00000000-0000-4000-8000-000000000099', ...(change.patch ? { patch: change.patch } : {}), ...(change.kind === 'create' ? { sort_order: change.sort_order ?? state.lines.length } : {}), ...(preimage ? { preimage } : {}), ...(change.ordered_line_ids ? { ordered_line_ids: change.ordered_line_ids } : {}) } };
    }),
    finalizeQboInvoiceLineChange: vi.fn(async (_db, args) => { state.events.push('finalize-change'); state.lineChangeFinalizeCalls.push(args); return { ok: true, applied: true }; }),
    reserveQboInvoiceCommand: vi.fn(async (_db, args) => {
      state.events.push('reserve');
      state.reservationCalls.push(args);
      if (state.invoice?.locked) return { ok: false, reason: 'invoice-locked' };
      return { ok: true, replay: state.commands.has(args.commandId) };
    }),
    releaseQboInvoiceCommandReservation: vi.fn(async (_db, args) => { state.reservationReleases.push(args); if (state.releaseFailure) throw state.releaseFailure; return state.releaseResult; }),
    prepareQboInvoiceCommand: vi.fn(async (_db, args) => { if (state.prepareResult) return state.prepareResult; const old = state.commands.get(args.commandId); if (old) return old.intent_payload && canon(old.intent_payload) === canon(args.intent) ? { ok: true, replay: true, command_id: old.id } : { ok: false, reason: 'idempotency-key-mismatch' }; const active = [...state.commands.values()].find((c) => c.status !== 'succeeded' && c.status !== 'rejected' && c.invoice_id === args.invoiceId); if (active) return canon(active.intent_payload) === canon(args.intent) && active.action === args.action && active.actor_auth_user_id === args.actor.authUserId ? { ok: true, resumed: true, command_id: active.id } : { ok: false, reason: 'active-command-conflict' }; state.commands.set(args.commandId, { ok: true, id: args.commandId, invoice_id: args.invoiceId, action: args.action, initiator: args.actor.initiator, actor_auth_user_id: args.actor.authUserId, actor_employee_id: args.actor.employeeId, realm_id: args.realmId, expected_qbo_invoice_id: args.expectedQboInvoiceId, target_qbo_invoice_id: args.targetQboInvoiceId, intent_payload: args.intent, status: 'prepared' }); return { ok: true, command_id: args.commandId }; }),
    startQboInvoiceCommandAttempt: vi.fn(async (_db, x) => { const c = state.commands.get(x.commandId); Object.assign(c, { status: 'provider_started', provider_stage: x.stage, provider_action: x.providerAction, provider_target_id: x.providerTargetId, provider_request_id: x.providerRequestId, provider_payload: x.providerPayload }); return { ok: true, provider_stage: c.provider_stage, provider_action: c.provider_action, provider_target_id: c.provider_target_id, provider_request_id: c.provider_request_id, provider_payload: c.provider_payload }; }),
    advanceQboInvoiceCommandAttempt: vi.fn(async (_db, x) => { const c = state.commands.get(x.commandId); Object.assign(c, { provider_stage: x.stage, provider_action: x.providerAction, provider_target_id: x.providerTargetId, provider_request_id: x.providerRequestId, provider_payload: x.providerPayload }); return { ok: true, provider_stage: c.provider_stage, provider_action: c.provider_action, provider_target_id: c.provider_target_id, provider_request_id: c.provider_request_id, provider_payload: c.provider_payload }; }),
    setQboInvoiceCommandState: vi.fn(async (_db, x) => { if (state.ledgerFailure) { const failure = state.ledgerFailure; state.ledgerFailure = null; throw failure; } const c = state.commands.get(x.commandId); Object.assign(c, { status: x.status, provider_result: x.providerResult ?? c.provider_result, response_status: x.responseStatus ?? c.response_status, response_payload: x.responsePayload ?? c.response_payload, error: x.error ?? c.error }); return { ok: true }; }),
  };
});

const { onRequestPost } = await import('./qbo-invoice.js');
const invoiceId = '00000000-0000-4000-8000-000000000011'; const commandId = '00000000-0000-4000-8000-000000000012';
const lineId = '00000000-0000-4000-8000-000000000021';
const sourceLine = { id: lineId, description: 'Original labor', qbo_item_id: 'item-old', qbo_item_name: 'Old labor', qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 100, line_total: 100 };
const lineUpdate = { line_id: lineId, description: 'Labor', qbo_item_id: 'item-1', qbo_item_name: 'Labor', qbo_class_id: null, qbo_class_name: null, quantity: 2, unit_price: 50 };
const frozenLineUpdate = () => ({
  line_id: lineId,
  preimage: Object.fromEntries(['description', 'qbo_item_id', 'qbo_item_name', 'qbo_class_id', 'qbo_class_name', 'quantity', 'unit_price'].map((field) => [field, sourceLine[field] ?? null])),
  patch: Object.fromEntries(['description', 'qbo_item_id', 'qbo_item_name', 'qbo_class_id', 'qbo_class_name', 'quantity', 'unit_price'].map((field) => [field, lineUpdate[field] ?? null])),
});
const request = (body = { invoice_id: invoiceId }, key = commandId) => ({ headers: new Headers({ 'Idempotency-Key': key }), json: async () => body });
const frozenCreateIntent = () => {
  const memo = 'Date of loss:  · Job: W-1 · Claim:  · Service Address: ';
  const primary = { CustomerRef: { value: 'customer-1' }, Line: [{ DetailType: 'SalesItemLineDetail', Amount: 100, SalesItemLineDetail: { ItemRef: { value: 'item-1' } } }], PrivateNote: memo, CustomerMemo: { value: memo }, DocNumber: 'W-1' };
  const { DocNumber, ...withoutDoc } = primary;
  return { action: 'save', expected_qbo_invoice_id: null, target_qbo_invoice_id: null, provider_action: 'create', primary_payload: primary, without_online_pay_payload: null, without_doc_number_payload: withoutDoc, customer_relink_contact_id: 'contact-1' };
};
const providerSucceededCreate = () => { const intent = frozenCreateIntent(); return { ok: true, id: commandId, invoice_id: invoiceId, action: 'save', initiator: 'browser', actor_auth_user_id: state.auth.user.id, actor_employee_id: state.auth.employee.id, realm_id: 'realm-1', expected_qbo_invoice_id: null, target_qbo_invoice_id: null, intent_payload: intent, provider_stage: 'primary', provider_action: 'create', provider_payload: intent.primary_payload, status: 'provider_succeeded', provider_result: { qbo_invoice_id: 'qbo-1', id: 'qbo-1', doc_number: 'W-1', total: 100 } }; };
beforeEach(() => { state.commands.clear(); state.rpcs.length = 0; state.updates.length = 0; state.reservationCalls.length = 0; state.reservationReleases.length = 0; state.releaseResult = { ok: true, released: true }; state.releaseFailure = null; state.prepareResult = null; state.lineStageCalls.length = 0; state.lineFinalizeCalls.length = 0; state.lineChangeStageCalls.length = 0; state.lineChangeFinalizeCalls.length = 0; state.lineChangeStageError = null; state.lineStageResult = null; state.lineFinalizeResult = { ok: true, applied: true }; state.events.length = 0; state.lines = []; state.defaultClassName = null; state.qboCustomerId = 'customer-1'; state.recipient = 'billing@example.test'; state.cas = { ok: true }; state.rpcFailure = null; state.ledgerFailure = null; state.providerTrafficEnabled = true; state.documentCommandsEnabled = true; state.auth = { ok: true, via: 'bearer', user: { id: '00000000-0000-4000-8000-0000000000a1' }, employee: { id: '00000000-0000-4000-8000-0000000000a2' } }; state.invoice = { id: invoiceId, job_id: 'job-1', contact_id: 'contact-1', total: 100, qbo_invoice_id: null, qbo_doc_number: null }; state.ensureCustomer.mockReset(); state.findClass.mockReset(); state.relink.mockReset().mockResolvedValue({ id: 'new-customer', matchedBy: 'email' }); state.provider.mockReset().mockImplementation(async () => { state.events.push('provider'); return { Id: 'qbo-1', DocNumber: 'W-1', TotalAmt: 100 }; }); });

describe('qbo invoice command ledger', () => {
  it('keeps legacy save available when document commands are off', async () => {
    state.documentCommandsEnabled = false;
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(state.reservationCalls).toHaveLength(1);
    expect(state.provider).toHaveBeenCalledOnce();
  });
  it.each([
    ['line_update', () => ({ line_update: lineUpdate })],
    ['line_change', () => ({ line_change: { kind: 'create', patch: { description: 'Labor', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 1 } } })],
  ])('denies %s before a command reservation or provider access when document commands are off', async (_kind, body) => {
    state.documentCommandsEnabled = false;
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', ...body() }), env: {} });
    expect(res.status).toBe(503);
    expect(state.reservationCalls).toEqual([]);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it('requires UUIDv4 keys and authorizes before ledger/provider access', async () => { state.auth = { ok: false, status: 403, error: 'Forbidden' }; expect((await onRequestPost({ request: request({}, commandId), env: {} })).status).toBe(403); state.auth = { ok: true, via: 'webhook' }; expect((await onRequestPost({ request: request({ invoice_id: invoiceId }, 'not-a-uuid'), env: {} })).status).toBe(400); });
  it('replays a terminal response without QBO or CAS after confirming reservation cleanup', async () => { state.commands.set(commandId, { ok: true, id: commandId, invoice_id: invoiceId, action: 'save', initiator: 'browser', actor_auth_user_id: state.auth.user.id, actor_employee_id: state.auth.employee.id, realm_id: 'realm-1', status: 'succeeded', response_status: 200, response_payload: { ok: true, qbo_invoice_id: 'qbo-1' } }); const res = await onRequestPost({ request: request(), env: {} }); expect(res.body).toEqual({ ok: true, qbo_invoice_id: 'qbo-1' }); expect(state.provider).not.toHaveBeenCalled(); expect(state.rpcs).toHaveLength(0); expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]); });
  it('binds the pre-command reservation to the authorized actor and realm', async () => { await onRequestPost({ request: request(), env: {} }); expect(state.reservationCalls[0]).toMatchObject({ commandId, invoiceId, action: 'save', realmId: 'realm-1', actor: { authUserId: state.auth.user.id, employeeId: state.auth.employee.id, initiator: 'browser' } }); });
  it('threads the ledger-frozen realm into the provider adapter', async () => {
    await onRequestPost({ request: request(), env: {} });
    expect(state.provider).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ expectedRealmId: 'realm-1' }));
  });
  it('stops a realm-switched class lookup before the invoice provider call', async () => {
    state.defaultClassName = 'Mitigation';
    const switched = new Error('realm switched'); switched.status = 409; switched.code = 'qbo-realm-mismatch';
    state.findClass.mockRejectedValueOnce(switched);
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res).toMatchObject({ status: 409, body: { code: 'qbo-realm-mismatch' } });
    expect(state.provider).not.toHaveBeenCalled();
  });
  it('does not expose a sensitive upstream provider error in the browser response', async () => {
    const upstream = new Error('Customer Jane Doe account 123456 rejected private note secret-value');
    upstream.status = 400; upstream.qboCode = '6000'; upstream.intuitTid = 'tid-safe';
    state.provider.mockRejectedValueOnce(upstream);
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res).toMatchObject({ status: 500, body: { error: 'QuickBooks rejected the invoice request. Review the invoice and try again.', code: 'qbo-provider-rejected', intuit_tid: 'tid-safe' } });
    expect(JSON.stringify(res.body)).not.toContain('Jane Doe');
    expect(JSON.stringify(res.body)).not.toContain('secret-value');
  });
  it('stages a line patch after reservation and finalizes it only after provider success', async () => {
    state.lines = [{ ...sourceLine }];
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res.status).toBe(200);
    expect(state.lineStageCalls).toEqual([expect.objectContaining({ commandId, invoiceId, realmId: 'realm-1', lineUpdate })]);
    expect(state.lineFinalizeCalls).toEqual([expect.objectContaining({ commandId, invoiceId, realmId: 'realm-1', lineUpdate })]);
    expect(state.events).toEqual(['reserve', 'stage', 'provider', 'finalize']);
    expect(state.commands.get(commandId).intent_payload.line_update).toEqual(frozenLineUpdate());
    expect(state.provider.mock.calls[0][1].Line[0]).toMatchObject({
      Amount: 100,
      Description: 'Labor',
      SalesItemLineDetail: { ItemRef: { value: 'item-1' }, Qty: 2, UnitPrice: 50 },
    });
  });
  it('builds the frozen QBO amount from patched quantity and unit price, never a stale generated line_total', async () => {
    state.lines = [{ ...sourceLine, line_total: 9999 }];
    const patched = { ...lineUpdate, quantity: 3, unit_price: 33.335 };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: patched }), env: {} });
    expect(res.status).toBe(200);
    expect(state.provider.mock.calls[0][1].Line[0]).toMatchObject({
      Amount: 100.01,
      SalesItemLineDetail: { Qty: 3, UnitPrice: 33.335 },
    });
  });
  it('stages a native line create, uses its frozen candidate for QBO, then finalizes only after success', async () => {
    const lineChange = { kind: 'create', patch: { description: 'New labor', qbo_item_id: 'item-1', qbo_item_name: 'Labor', qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 100 } };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_change: lineChange }), env: {} });
    expect(res.status).toBe(200);
    expect(state.lineChangeStageCalls).toEqual([expect.objectContaining({ commandId, invoiceId, lineChange })]);
    expect(state.lineChangeFinalizeCalls).toEqual([expect.objectContaining({ commandId, invoiceId, lineChange })]);
    expect(state.events).toEqual(['reserve', 'stage-change', 'provider', 'finalize-change']);
    expect(state.provider.mock.calls[0][1].Line[0]).toMatchObject({ Description: 'New labor', Amount: 100 });
  });
  it('retains a native line-create command and performs no local finalization after an ambiguous provider outcome', async () => {
    const lineChange = { kind: 'create', patch: { description: 'New labor', qbo_item_id: 'item-1', qbo_item_name: 'Labor', qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 100 } };
    state.provider.mockRejectedValueOnce(new Error('timeout'));
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_change: lineChange }), env: {} });
    expect(res).toMatchObject({ status: 500, body: { retry_same_request: true } });
    expect(state.commands.get(commandId).status).toBe('ambiguous');
    expect(state.lineChangeFinalizeCalls).toEqual([]);
    expect(state.reservationReleases).toEqual([]);
  });
  it('recovers a provider-succeeded line create after local apply without duplicating its frozen line or calling QBO again', async () => {
    const lineChange = { kind: 'create', patch: { description: 'Crash-safe labor', qbo_item_id: 'item-1', qbo_item_name: 'Labor', qbo_class_id: null, qbo_class_name: null, quantity: 2, unit_price: 50 } };
    const first = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_change: lineChange }), env: {} });
    expect(first.status).toBe(200);
    const command = state.commands.get(commandId);
    const frozen = command.intent_payload.line_change;
    Object.assign(command, { status: 'provider_succeeded', response_status: null, response_payload: null });
    state.invoice.qbo_invoice_id = 'qbo-1'; state.invoice.qbo_doc_number = 'W-1';
    state.lines = [{ id: frozen.line_id, invoice_id: invoiceId, ...frozen.patch, sort_order: frozen.sort_order, line_total: 100 }];
    state.provider.mockClear(); state.events.length = 0; state.lineChangeFinalizeCalls.length = 0;
    const replayed = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_change: lineChange }), env: {} });
    expect(replayed).toMatchObject({ status: 200, body: { qbo_invoice_id: 'qbo-1' } });
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.lineChangeFinalizeCalls).toHaveLength(1);
    expect(command.intent_payload.primary_payload.Line).toHaveLength(1);
  });
  it('releases a new reservation when generic staging throws before a command or provider attempt exists', async () => {
    state.lineChangeStageError = new Error('numeric cast failed');
    const lineChange = { kind: 'create', patch: { description: 'Labor', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 1 }, sort_order: 2147483647 };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_change: lineChange }), env: {} });
    expect(res).toMatchObject({ status: 400, body: { code: 'line-change-staging-failed' } });
    expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]);
    expect(state.commands.has(commandId)).toBe(false);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it('rejects a create sort order above PostgreSQL integer range before reserving', async () => {
    const lineChange = { kind: 'create', patch: { description: 'Labor', quantity: 1, unit_price: 1 }, sort_order: 2147483648 };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_change: lineChange }), env: {} });
    expect(res.status).toBe(400);
    expect(state.reservationCalls).toEqual([]);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it('releases a new pre-command reservation after a known staging rejection', async () => {
    state.lineStageResult = { ok: false, reason: 'invalid-line-update' };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res.status).toBe(400);
    expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]);
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.lineFinalizeCalls).toEqual([]);
  });
  it.each(['false-result', 'throw'])('preserves retry identity when staging rejection reservation release returns %s', async (mode) => {
    state.lineStageResult = { ok: false, reason: 'invalid-line-update' };
    if (mode === 'throw') state.releaseFailure = new Error('release unavailable');
    else state.releaseResult = { ok: false, reason: 'reservation-mismatch' };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res).toMatchObject({ status: 503, body: { code: 'reservation-release-failed', retry_same_request: true } });
    expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it.each(['false-result', 'throw'])('preserves retry identity when intent rejection reservation release returns %s', async (mode) => {
    state.invoice.total = 0;
    if (mode === 'throw') state.releaseFailure = new Error('release unavailable');
    else state.releaseResult = { ok: false, reason: 'reservation-mismatch' };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res).toMatchObject({ status: 503, body: { code: 'reservation-release-failed', retry_same_request: true } });
    expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it.each(['false-result', 'throw'])('preserves retry identity when prepare rejection reservation release returns %s', async (mode) => {
    state.prepareResult = { ok: false, reason: 'active-command-conflict' };
    if (mode === 'throw') state.releaseFailure = new Error('release unavailable');
    else state.releaseResult = { ok: false, reason: 'reservation-mismatch' };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res).toMatchObject({ status: 503, body: { code: 'reservation-release-failed', retry_same_request: true } });
    expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]);
    expect(state.provider).not.toHaveBeenCalled();
  });
  it('leaves the local line untouched after a deterministic provider rejection', async () => {
    state.lines = [{ ...sourceLine }];
    const rejected = new Error('QBO validation rejected the invoice'); rejected.status = 400;
    state.provider.mockRejectedValueOnce(rejected);
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res.status).toBe(500);
    expect(state.commands.get(commandId).status).toBe('rejected');
    expect(state.lineFinalizeCalls).toEqual([]);
    expect(state.lines[0]).toEqual(sourceLine);
  });
  it('retains the staged command without local mutation after an ambiguous provider outcome', async () => {
    state.lines = [{ ...sourceLine }];
    state.provider.mockRejectedValueOnce(new Error('timeout'));
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res.body.retry_same_request).toBe(true);
    expect(state.commands.get(commandId).status).toBe('ambiguous');
    expect(state.lineFinalizeCalls).toEqual([]);
    expect(state.lines[0]).toEqual(sourceLine);
    expect(state.reservationReleases).toEqual([]);
  });
  it('turns a post-provider line mismatch into reconciliation without CAS', async () => {
    state.lines = [{ ...sourceLine }];
    state.lineFinalizeResult = { ok: false, reason: 'source-mismatch' };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res.status).toBe(409);
    expect(state.commands.get(commandId).status).toBe('needs_reconciliation');
    expect(state.lineFinalizeCalls).toHaveLength(1);
    expect(state.rpcs.some((entry) => entry.fn === 'cas_qbo_invoice_link')).toBe(false);
    expect(state.reservationReleases).toEqual([]);
  });
  it('never replays a successful patched command for a missing or different patch', async () => {
    const terminal = { ok: true, id: commandId, invoice_id: invoiceId, action: 'save', initiator: 'browser', actor_auth_user_id: state.auth.user.id, actor_employee_id: state.auth.employee.id, realm_id: 'realm-1', status: 'succeeded', intent_payload: { line_update: frozenLineUpdate() }, response_status: 200, response_payload: { ok: true } };
    state.commands.set(commandId, terminal);
    expect((await onRequestPost({ request: request(), env: {} })).status).toBe(409);
    expect((await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: { ...lineUpdate, description: 'Different' } }), env: {} })).status).toBe(409);
    state.lines = [{ ...sourceLine }];
    const exact = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(exact).toEqual({ status: 200, body: { ok: true } });
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.lineStageCalls).toHaveLength(1);
  });
  it.each(['false-result', 'throw'])('preserves exact terminal patch identity when replay release returns %s', async (mode) => {
    state.commands.set(commandId, { ok: true, id: commandId, invoice_id: invoiceId, action: 'save', initiator: 'browser', actor_auth_user_id: state.auth.user.id, actor_employee_id: state.auth.employee.id, realm_id: 'realm-1', status: 'succeeded', intent_payload: { line_update: frozenLineUpdate() }, response_status: 200, response_payload: { ok: true } });
    state.lines = [{ ...sourceLine }];
    if (mode === 'throw') state.releaseFailure = new Error('release unavailable');
    else state.releaseResult = { ok: false, reason: 'reservation-mismatch' };
    const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'save', line_update: lineUpdate }), env: {} });
    expect(res).toMatchObject({ status: 503, body: { code: 'reservation-release-failed', retry_same_request: true } });
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.reservationReleases).toEqual([{ commandId, invoiceId }]);
  });
  it('refuses a locked invoice before intent customer sync, command preparation, or a provider call', async () => {
    state.invoice.locked = true;
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res).toEqual({ status: 423, body: { error: 'Invoice is locked' } });
    expect(state.ensureCustomer).not.toHaveBeenCalled();
    expect(state.findClass).not.toHaveBeenCalled();
    expect(state.provider).not.toHaveBeenCalled();
    expect(state.rpcs).toHaveLength(0);
  });
  it('blocks account mismatch before provider', async () => { state.commands.set(commandId, { ok: true, id: commandId, invoice_id: invoiceId, action: 'save', initiator: 'browser', actor_auth_user_id: '00000000-0000-4000-8000-0000000000ff', actor_employee_id: state.auth.employee.id, realm_id: 'realm-1', status: 'prepared' }); expect((await onRequestPost({ request: request(), env: {} })).status).toBe(409); expect(state.provider).not.toHaveBeenCalled(); });
  it('recovers a provider-succeeded create before CAS without another provider call', async () => { state.commands.set(commandId, providerSucceededCreate()); const res = await onRequestPost({ request: request(), env: {} }); expect(res).toMatchObject({ status: 200, body: { qbo_invoice_id: 'qbo-1' } }); expect(state.provider).not.toHaveBeenCalled(); expect(state.rpcs.filter((x) => x.fn === 'cas_qbo_invoice_link')).toHaveLength(1); });
  it('recovers a provider-succeeded create after CAS without another provider call', async () => { state.invoice.qbo_invoice_id = 'qbo-1'; state.invoice.qbo_doc_number = 'W-1'; state.commands.set(commandId, providerSucceededCreate()); const res = await onRequestPost({ request: request(), env: {} }); expect(res).toMatchObject({ status: 200, body: { qbo_invoice_id: 'qbo-1' } }); expect(state.provider).not.toHaveBeenCalled(); });
  it('marks an ambiguous provider outcome retry-same-request and never falls back or releases its reservation', async () => { state.provider.mockRejectedValueOnce(new Error('timeout')); const res = await onRequestPost({ request: request(), env: {} }); expect(res.body.retry_same_request).toBe(true); expect(state.commands.get(commandId).status).toBe('ambiguous'); expect(state.provider).toHaveBeenCalledTimes(1); expect(state.reservationReleases).toEqual([]); });
  it('keeps the frozen invoice command but returns the stable 503 when maintenance closes immediately before QBO', async () => {
    const closed = new Error('QuickBooks provider traffic is temporarily disabled.'); closed.code = 'qbo_provider_traffic_disabled'; closed.reason = 'qbo_provider_traffic_disabled'; closed.status = 503;
    state.provider.mockRejectedValueOnce(closed);
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res).toMatchObject({ status: 503, body: { code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled', retry_same_request: true } });
    expect(state.commands.get(commandId)).toMatchObject({ status: 'ambiguous', response_status: 503 });
    expect(state.provider).toHaveBeenCalledTimes(1);
    expect(state.reservationReleases).toEqual([]);
  });
  it('preserves retry identity when an ambiguous-provider ledger update fails', async () => { state.ledgerFailure = new Error('ledger temporarily unavailable'); state.provider.mockRejectedValueOnce(new Error('QBO timeout')).mockResolvedValueOnce({ Id: 'qbo-1', DocNumber: 'W-1', TotalAmt: 100 }); const first = await onRequestPost({ request: request(), env: {} }); expect(first).toMatchObject({ status: 500, body: { retry_same_request: true } }); expect(state.commands.get(commandId).status).toBe('provider_started'); const firstRequestId = state.provider.mock.calls[0][2].requestId; const second = await onRequestPost({ request: request(), env: {} }); expect(second.status).toBe(200); expect(state.provider.mock.calls[1][2].requestId).toBe(firstRequestId); });
  it('keeps the exact provider request identity after a post-provider CAS failure', async () => { state.rpcFailure = new Error('CAS connection dropped after QBO accepted'); const first = await onRequestPost({ request: request(), env: {} }); expect(first).toMatchObject({ status: 500, body: { retry_same_request: true, code: 'post-provider-finalization-failed' } }); expect(state.commands.get(commandId).status).toBe('ambiguous'); const firstRequestId = state.provider.mock.calls[0][2].requestId; const second = await onRequestPost({ request: request(), env: {} }); expect(second.status).toBe(200); expect(state.provider).toHaveBeenCalledTimes(2); expect(state.provider.mock.calls[1][2].requestId).toBe(firstRequestId); });
  it('relinks a stale create once through the persisted fallback attempt', async () => { const stale = new Error('stale customer'); stale.status = 400; state.provider.mockRejectedValueOnce(stale).mockResolvedValueOnce({ Id: 'qbo-1', DocNumber: 'W-1', TotalAmt: 100 }); const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(200); expect(state.relink).toHaveBeenCalledTimes(1); expect(state.provider).toHaveBeenCalledTimes(2); expect(state.provider.mock.calls[1][1].CustomerRef.value).toBe('new-customer'); expect(state.commands.get(commandId).provider_stage).toBe('customer-relinked'); });
  it('creates or safely links a missing QBO customer during the human invoice save', async () => {
    state.qboCustomerId = null;
    state.ensureCustomer.mockImplementationOnce(async () => {
      state.qboCustomerId = 'customer-created';
      return true;
    });
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(state.ensureCustomer).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'contact-1', { expectedRealmId: 'realm-1' });
    expect(state.provider.mock.calls[0][1].CustomerRef.value).toBe('customer-created');
  });
  it('sends UPR invoice and due dates in the frozen QuickBooks payload', async () => {
    state.invoice.invoice_date = '2026-07-17';
    state.invoice.due_date = '2026-07-17';
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(state.provider.mock.calls[0][1]).toMatchObject({
      TxnDate: '2026-07-17',
      DueDate: '2026-07-17',
    });
  });
  it('does not relink an update after a stale rejection', async () => { state.invoice.qbo_invoice_id = 'qbo-1'; const stale = new Error('stale customer'); stale.status = 400; state.provider.mockRejectedValueOnce(stale); const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(500); expect(state.relink).not.toHaveBeenCalled(); });
  it('rejects a provider response whose Id differs from the frozen update target', async () => { state.invoice.qbo_invoice_id = 'qbo-A'; state.provider.mockResolvedValueOnce({ Id: 'qbo-B' }); const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(409); expect(state.commands.get(commandId).status).toBe('needs_reconciliation'); expect(state.rpcs.some((x) => x.fn === 'cas_qbo_invoice_link')).toBe(false); });
  it('blocks a changed recipient before send CAS', async () => { state.invoice.qbo_invoice_id = 'qbo-A'; state.provider.mockImplementationOnce(async () => { state.recipient = 'two@example.test'; return { Id: 'qbo-A', EmailStatus: 'EmailSent' }; }); const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'send' }), env: {} }); expect(res.status).toBe(409); expect(state.rpcs.some((x) => x.fn === 'cas_qbo_invoice_link')).toBe(false); });
  it('records first-create timing metadata without writing trigger-owned status', async () => { const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(200); const patch = state.updates.at(-1)[2]; expect(patch.sent_at).toBeTruthy(); expect(patch.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(patch).not.toHaveProperty('status'); expect(res.body).toMatchObject({ total: 100, online_pay_warning: null, customer_relink: null }); });
  it('does not turn a missing provider Id into the string undefined', async () => { state.provider.mockResolvedValueOnce({ DocNumber: 'W-1' }); const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(500); expect(state.commands.get(commandId).status).toBe('ambiguous'); expect(state.rpcs.some((x) => x.fn === 'cas_qbo_invoice_link')).toBe(false); });
  it('makes already-unlinked delete succeeded and replays it without QBO', async () => { const body = { invoice_id: invoiceId, action: 'delete' }; const first = await onRequestPost({ request: request(body), env: {} }); const second = await onRequestPost({ request: request(body), env: {} }); expect(first).toMatchObject({ status: 200, body: { deleted: null, idempotent: true } }); expect(second).toMatchObject({ status: 200, body: { deleted: null, idempotent: true } }); expect(state.commands.get(commandId).status).toBe('succeeded'); expect(state.provider).not.toHaveBeenCalled(); });
  it('deletes through the frozen target and CAS without writing status', async () => { state.invoice.qbo_invoice_id = 'qbo-delete'; const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'delete' }), env: {} }); expect(res.status).toBe(200); expect(state.provider.mock.calls[0][1]).toBe('qbo-delete'); expect(state.rpcs.find((x) => x.fn === 'cas_qbo_invoice_link').params).toMatchObject({ p_expected_qbo_invoice_id: 'qbo-delete', p_new_qbo_invoice_id: null }); expect(state.updates.some(([, , patch]) => Object.hasOwn(patch, 'status'))).toBe(false); });
  it('stores QBO send metadata only through the send CAS', async () => { state.invoice.qbo_invoice_id = 'qbo-send'; state.provider.mockResolvedValueOnce({ Id: 'qbo-send', DocNumber: 'W-1', EmailStatus: 'EmailSent' }); const res = await onRequestPost({ request: request({ invoice_id: invoiceId, action: 'send', send_to: 'to@example.test' }), env: {} }); expect(res.status).toBe(200); expect(state.rpcs.find((x) => x.fn === 'cas_qbo_invoice_link').params).toMatchObject({ p_expected_qbo_invoice_id: 'qbo-send', p_new_qbo_invoice_id: 'qbo-send', p_sent_to_email: 'to@example.test', p_write_email_metadata: true }); });
  it('returns a reconciliation conflict when the final CAS loses the frozen link', async () => { state.cas = { ok: false, current_qbo_invoice_id: 'qbo-other' }; const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(409); expect(state.commands.get(commandId).status).toBe('needs_reconciliation'); });
  it('blocks changed save lines on an exact ambiguous retry before any QBO work', async () => { const intent = { action: 'save', expected_qbo_invoice_id: null, target_qbo_invoice_id: null, provider_action: 'create', primary_payload: { CustomerRef: { value: 'customer-1' }, Line: [{ Amount: 100 }], PrivateNote: 'old' } }; state.commands.set(commandId, { ok: true, id: commandId, invoice_id: invoiceId, action: 'save', initiator: 'browser', actor_auth_user_id: state.auth.user.id, actor_employee_id: state.auth.employee.id, realm_id: 'realm-1', expected_qbo_invoice_id: null, target_qbo_invoice_id: null, intent_payload: intent, provider_payload: intent.primary_payload, provider_stage: 'primary', status: 'ambiguous' }); state.lines = [{ line_total: 200 }]; const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(409); expect(state.ensureCustomer).not.toHaveBeenCalled(); expect(state.findClass).not.toHaveBeenCalled(); expect(state.provider).not.toHaveBeenCalled(); expect(state.rpcs.some((x) => x.fn === 'cas_qbo_invoice_link')).toBe(false); });
  it('resolves a division class once and persists it before provider execution', async () => { state.defaultClassName = 'Mitigation'; state.findClass.mockResolvedValue('class-default'); const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(200); expect(state.findClass).toHaveBeenCalledTimes(1); expect(state.commands.get(commandId).provider_payload.Line[0].SalesItemLineDetail.ClassRef.value).toBe('class-default'); expect(state.provider.mock.calls[0][1].Line[0].SalesItemLineDetail.ClassRef.value).toBe('class-default'); });
  it('preserves explicit per-line classes when resolving the division fallback', async () => { state.defaultClassName = 'Mitigation'; state.findClass.mockResolvedValue('class-default'); state.lines = [{ quantity: 1, unit_price: 100, line_total: 100, qbo_class_id: 'class-explicit' }]; const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(200); expect(state.commands.get(commandId).provider_payload.Line[0].SalesItemLineDetail.ClassRef.value).toBe('class-explicit'); expect(state.provider.mock.calls[0][1].Line[0].SalesItemLineDetail.ClassRef.value).toBe('class-explicit'); });
  it('retries an ambiguous classed attempt from stored payload without another lookup', async () => { state.defaultClassName = 'Mitigation'; const intent = { ...frozenCreateIntent(), default_class_name: 'Mitigation' }; const stored = { ...intent.primary_payload, Line: intent.primary_payload.Line.map((line) => ({ ...line, SalesItemLineDetail: { ...line.SalesItemLineDetail, ClassRef: { value: 'class-frozen' } } })) }; state.commands.set(commandId, { ...providerSucceededCreate(), intent_payload: intent, provider_payload: stored, provider_stage: 'primary', provider_action: 'create', provider_request_id: 'frozen-request', status: 'ambiguous', provider_result: null }); const res = await onRequestPost({ request: request(), env: {} }); expect(res.status).toBe(200); expect(state.findClass).not.toHaveBeenCalled(); expect(state.provider).toHaveBeenCalledTimes(1); expect(state.provider.mock.calls[0][1]).toEqual(stored); });
});
