/**
 * ════════════════════════════════════════════════
 * FILE: qbo-invoice.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Carries out one prepared QuickBooks invoice save, send, or delete. It keeps
 *   a private record before contacting QuickBooks so a lost response can be
 *   recovered without accidentally doing the accounting action twice.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors.js, http.js, qbo-auth.js, supabase.js, quickbooks.js,
 *              qbo-invoice-commands.js, qbo-reconciliation.js,
 *              qbo-invoice-email-mirror.js, intuit.js, qbo-provider-traffic.js
 *   Data:      reads  → invoices, invoice_line_items, contacts, jobs, claims,
 *                        estimates, integration_config, qbo_invoice_commands
 *              writes → invoices, worker_runs, qbo_invoice_commands;
 *                        record_invoice_activity (UNCERTAIN — RPC-owned table)
 *
 * NOTES / GOTCHAS:
 *   - The command record is the recovery source when a provider response is lost.
 *   - Invoice totals and payment status remain database-owned; this route does not write them directly.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { authorizeQboBrowserRequest } from '../lib/qbo-auth.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, divisionToQbo, ensureQboCustomer, findClassId, createInvoice, updateInvoice, deleteInvoice, sendInvoice, relinkQboCustomer, isStaleCustomerRef } from '../lib/quickbooks.js';
import { recordReconciliation } from '../lib/qbo-reconciliation.js';
import { mirrorQboInvoiceEmail } from '../lib/qbo-invoice-email-mirror.js';
import { sha256hex } from '../lib/intuit.js';
import { isQboProviderTrafficDisabled, QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE, requireQboProviderTraffic } from '../lib/qbo-provider-traffic.js';
import { QBO_COMMAND_ID_RE, getQboInvoiceCommand, isTerminalQboInvoiceCommand, prepareQboInvoiceCommand, qboCommandActor, qboCommandIdentityMatches, startQboInvoiceCommandAttempt, advanceQboInvoiceCommandAttempt, setQboInvoiceCommandState, stableJsonStringify } from '../lib/qbo-invoice-commands.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const qboLineAmount = (li) => round2(li.line_total != null ? li.line_total : Number(li.quantity || 0) * Number(li.unit_price || 0));
export const qboFallbackAmount = (inv) => round2(inv.adjusted_total ?? inv.total ?? 0);
const qboDate = (value) => {
  const date = String(value || '').split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};
export function qboInvoiceDateFields(inv = {}) {
  const txnDate = qboDate(inv.invoice_date);
  const dueDate = qboDate(inv.due_date) || txnDate;
  return {
    ...(txnDate ? { TxnDate: txnDate } : {}),
    ...(dueDate ? { DueDate: dueDate } : {}),
  };
}

// What the customer actually reads, and who else receives it.  Both are derived
// only from stored invoice columns so a rebuilt intent byte-matches the frozen
// attempt (currentMatchesStoredAttempt); anything non-deterministic here turns
// every retry into a false "invoice changed" conflict.
export function qboSendPresentation(inv = {}, derivedMemo = '') {
  const customerMemo = String(inv.customer_message ?? '').trim() || derivedMemo;
  const cc = String(inv.send_cc_email ?? '').trim();
  return {
    customerMemo,
    // Omitted entirely when empty: sending BillEmailCc with a blank Address
    // would clear a CC the customer's QuickBooks record may legitimately hold.
    billEmailCc: cc ? { BillEmailCc: { Address: cc } } : {},
  };
}

export async function qboInvoiceRequestId(action, invoiceId, clientRequestId, stage = 'primary') {
  const code = { create: 'c', update: 'u', send: 's', delete: 'd' }[action];
  if (!code) throw new Error('Unsupported QBO invoice request action');
  const digest = await sha256hex(JSON.stringify({ action, invoice_id: String(invoiceId), client_request_id: String(clientRequestId), stage: String(stage) }));
  return `upr-i-${code}-${digest.slice(0, 40)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const rpcObject = (value) => Array.isArray(value) ? value[0] : value;
const definitive = (e) => Number.isFinite(Number(e?.status)) && Number(e.status) >= 400 && Number(e.status) < 500;
const ambiguous = (e) => !Number.isFinite(Number(e?.status)) || Number(e.status) >= 500;
const connectionBoundary = (e) => ['qbo-connection-changed', 'qbo-realm-mismatch'].includes(e?.code);
const customerPrerequisiteBoundary = (e) => e?.customerPrerequisite === true;
const intuitTid = (e) => {
  const value = String(e?.intuitTid || '');
  return /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : null;
};
const providerError = (e) => ({
  error: connectionBoundary(e)
    ? 'QuickBooks connection changed; retry the unchanged request.'
    : definitive(e)
      ? 'QuickBooks rejected the invoice request. Review the invoice and try again.'
      : 'Unable to complete the QuickBooks invoice request. Retry the unchanged request.',
  code: connectionBoundary(e)
    ? e.code
    : definitive(e) ? 'qbo-provider-rejected' : 'qbo-provider-unavailable',
  intuit_tid: intuitTid(e),
  retry_same_request: ambiguous(e) || connectionBoundary(e),
});
const customerPrerequisiteError = (e) => ({
  error: e?.code === 'qbo_not_connected'
    ? 'QuickBooks is not connected. Reconnect before saving this invoice.'
    : e?.code === 'qbo-realm-mismatch'
      ? 'QuickBooks company changed during customer sync. Reload and review the invoice customer before starting a new save.'
    : connectionBoundary(e)
    ? 'QuickBooks connection changed during customer sync. Retry the unchanged request.'
    : e?.retrySameRequest === true
      ? 'QuickBooks customer sync could not be confirmed. Retry the unchanged request.'
      : 'QuickBooks customer sync requires review before saving this invoice.',
  code: ['qbo_customer_sync_rejected', 'qbo_not_connected'].includes(e?.code)
    ? e.code
    : connectionBoundary(e)
      ? e.code
      : 'qbo_customer_sync_failed',
  intuit_tid: intuitTid(e),
  ...(e?.retrySameRequest === true && e?.code !== 'qbo-realm-mismatch'
    ? { retry_same_request: true }
    : {}),
});
const safeIntentErrors = [
  ['Job not found for invoice', 'The invoice job could not be found.'],
  ['Invoice contact has no QuickBooks customer', 'The invoice customer is not linked to QuickBooks. Sync the customer and retry.'],
  ['No QuickBooks mapping for division', 'This invoice division is not mapped to QuickBooks.'],
  ['Invoice total is 0', 'Add a line item with an amount before saving to QuickBooks.'],
  ['Invoice has not been sent to QuickBooks yet', 'Save the invoice to QuickBooks before emailing it.'],
  ['No email address on file', 'Add a customer email address before sending the invoice.'],
  ['Customer email looks invalid', 'The customer email address is invalid.'],
];
function intentError(error) {
  const message = String(error?.message || '');
  const matched = safeIntentErrors.find(([prefix]) => message.startsWith(prefix));
  return matched
    ? { error: matched[1], code: 'qbo-invoice-validation', status: 400 }
    : { error: 'Unable to prepare the QuickBooks invoice request. Try again.', code: 'qbo-invoice-intent-unavailable', status: 500 };
}

// The activity record is evidence, never a gate.  A failure here must not change
// the money outcome the caller already received, so it is swallowed exactly the
// way worker_runs telemetry is -- the durable command ledger remains the source
// of truth for what actually happened.
async function recordActivity(db, { invoiceId, actor, eventType, recipient = null, cc = null, metadata = {} }) {
  try {
    await db.rpc('record_invoice_activity', {
      p_invoice_id: invoiceId,
      p_actor_employee_id: actor?.employeeId || null,
      p_event_type: eventType,
      p_recipient_email: recipient,
      p_cc_email: cc,
      p_safe_metadata: metadata,
    });
  } catch { /* evidence is best-effort; never fail a completed money action */ }
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try { await db.insert('worker_runs', { worker_name: 'qbo-invoice', status, records_processed: processed, error_message: errorMessage || null, started_at: startedAt, completed_at: new Date().toISOString() }); } catch { /* telemetry must not change money semantics */ }
}

async function reconcile(db, invoiceId, attempted, current, operation) {
  try { await recordReconciliation(db, { entity: 'InvoiceLinkConflict', qboId: `upr:${invoiceId}:operation:${operation}:attempted:${attempted}:current:${current || 'none'}`, reason: 'qbo-invoice-mismatch', context: { upr_invoice_id: invoiceId, operation, attempted_qbo_invoice_id: attempted, current_qbo_invoice_id: current || 'none' } }); } catch { /* durable command remains the source of truth */ }
}

const REPLAY_ERROR_MESSAGES = Object.freeze({
  'qbo-provider-rejected': 'QuickBooks rejected the invoice request. Review the invoice and try again.',
  'qbo-provider-unavailable': 'Unable to complete the QuickBooks invoice request. Retry the unchanged request.',
  qbo_provider_traffic_disabled: QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
  'qbo-invoice-mismatch': 'The QuickBooks invoice link requires reconciliation before retrying.',
  'command-source-mismatch': 'Invoice details changed after this QuickBooks command started. Reload and review before retrying.',
  'post-provider-finalization-failed': 'QuickBooks may have accepted this invoice request. Retry the unchanged request to finish recovery.',
  'missing-provider-invoice-id': 'QuickBooks accepted the request without an invoice ID. Reconciliation is required.',
});

function replayPayload(command) {
  const stored = command?.response_payload;
  if (command?.status === 'succeeded' && stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return stored;
  }

  const code = typeof stored?.code === 'string' && Object.hasOwn(REPLAY_ERROR_MESSAGES, stored.code)
    ? stored.code
    : 'qbo-invoice-command-failed';
  const payload = {
    error: REPLAY_ERROR_MESSAGES[code]
      || 'QuickBooks invoice command could not be completed. Reload and review before trying again.',
    code,
  };
  const tid = intuitTid({ intuitTid: stored?.intuit_tid });
  if (tid) payload.intuit_tid = tid;
  if (stored?.retry_same_request === true && code !== 'qbo-invoice-command-failed') {
    payload.retry_same_request = true;
  }
  if (code === 'qbo_provider_traffic_disabled') payload.reason = code;
  if (code === 'qbo-invoice-mismatch' && typeof stored?.current_qbo_invoice_id === 'string') {
    payload.current_qbo_invoice_id = stored.current_qbo_invoice_id;
  }
  return payload;
}

function replay(command, request, env) {
  const storedStatus = Number(command?.response_status);
  const responseStatus = Number.isInteger(storedStatus) && storedStatus >= 400 && storedStatus <= 599
    ? storedStatus
    : command?.status === 'succeeded' ? 200 : 500;
  return jsonResponse(replayPayload(command), responseStatus, request, env);
}

async function finalize(db, commandId, status, responseStatus, responsePayload, error = null, providerResult = null, intuitRequestId = null) {
  await setQboInvoiceCommandState(db, { commandId, status, providerResult, responseStatus, responsePayload, error, intuitRequestId });
}

async function needsReconciliation(db, command, request, env, message, current = null) {
  const payload = { error: message, code: 'qbo-invoice-mismatch', current_qbo_invoice_id: current || null };
  await finalize(db, command.id, 'needs_reconciliation', 409, payload, message);
  await reconcile(db, command.invoice_id, command.target_qbo_invoice_id || command.provider_result?.qbo_invoice_id || 'none', current, command.action);
  return jsonResponse(payload, 409, request, env);
}

// QBO has already accepted a side effect when this helper is used.  Never let
// a later ledger/CAS/finalization error make the browser retire its operation
// id: the stored provider request id is the only safe retry identity.
async function postProviderFailure(db, command, request, env) {
  const payload = {
    error: 'QuickBooks may have accepted this request, but local finalization did not complete. Retry the same request.',
    code: 'post-provider-finalization-failed',
    retry_same_request: true,
  };
  try {
    await setQboInvoiceCommandState(db, {
      commandId: command.id,
      status: 'ambiguous',
      responseStatus: 500,
      responsePayload: payload,
      error: payload.error,
    });
  } catch {
    // provider_started already durably holds the exact QBO request id; the
    // browser signal below preserves its matching client operation id too.
  }
  return jsonResponse(payload, 500, request, env);
}

// A timeout from QBO is already an unknown side-effect outcome.  The response
// must retain the client operation id even when recording that ambiguity fails.
async function ambiguousProviderFailure(db, command, error, request, env) {
  const maintenanceDenied = isQboProviderTrafficDisabled(error);
  const payload = maintenanceDenied
    ? {
        error: 'QuickBooks provider traffic is temporarily disabled.',
        code: 'qbo_provider_traffic_disabled',
        reason: 'qbo_provider_traffic_disabled',
        retry_same_request: true,
      }
    : providerError(error);
  try {
    await setQboInvoiceCommandState(db, {
      commandId: command.id,
      status: 'ambiguous',
      responseStatus: maintenanceDenied ? 503 : 500,
      responsePayload: payload,
      error: payload.error,
      intuitRequestId: intuitTid(error),
    });
  } catch {
    // The pre-provider_started row still freezes the QBO request id.  The
    // retry_same_request response keeps its matching browser operation id.
  }
  return jsonResponse(payload, maintenanceDenied ? 503 : 500, request, env);
}

async function buildSaveIntent(db, env, request, inv, expectedRealmId) {
  const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=division,job_number,claim_id,address,city,state,zip,date_of_loss&limit=1`))?.[0];
  if (!job) throw new Error('Job not found for invoice');
  let contact = inv.contact_id ? (await db.select('contacts', `id=eq.${inv.contact_id}&select=qbo_customer_id,name&limit=1`))?.[0] : null;
  if (!contact?.qbo_customer_id && inv.contact_id) {
    await ensureQboCustomer(request, env, inv.contact_id, { expectedRealmId });
    contact = (await db.select('contacts', `id=eq.${inv.contact_id}&select=qbo_customer_id,name&limit=1`))?.[0] || contact;
  }
  if (!contact?.qbo_customer_id) throw new Error('Invoice contact has no QuickBooks customer — sync the client first');
  const map = divisionToQbo(job.division);
  if (!map) throw new Error(`No QuickBooks mapping for division "${job.division}"`);
  const claim = job.claim_id ? (await db.select('claims', `id=eq.${job.claim_id}&select=claim_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip&limit=1`))?.[0] || null : null;
  const items = await db.select('invoice_line_items', `invoice_id=eq.${inv.id}&order=sort_order.asc.nullslast,created_at.asc`) || [];
  const lines = items.length ? items.map((li) => {
    const detail = { ItemRef: { value: String(li.qbo_item_id || map.itemId) } };
    if (li.qbo_class_id) detail.ClassRef = { value: String(li.qbo_class_id) };
    if (li.quantity != null) detail.Qty = Number(li.quantity); if (li.unit_price != null) detail.UnitPrice = Number(li.unit_price);
    return { DetailType: 'SalesItemLineDetail', Amount: qboLineAmount(li), ...(li.description ? { Description: li.description } : {}), SalesItemLineDetail: detail };
  }) : [{ DetailType: 'SalesItemLineDetail', Amount: qboFallbackAmount(inv), SalesItemLineDetail: { ItemRef: { value: String(map.itemId) } } }];
  if (!(lines.reduce((sum, line) => sum + Number(line.Amount || 0), 0) > 0)) throw new Error('Invoice total is 0 — add a line item with an amount before syncing');
  const fmt = (d) => { const p = String(d || '').split('T')[0].split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}/${p[0]}` : ''; };
  const address = [job.address || claim?.loss_address, job.city || claim?.loss_city, job.state || claim?.loss_state, job.zip || claim?.loss_zip].filter(Boolean).join(', ');
  const memo = `Date of loss: ${fmt(job.date_of_loss || claim?.date_of_loss)} · Job: ${job.job_number || ''} · Claim: ${inv.claim_number || claim?.claim_number || ''} · Service Address: ${address}`;
  let docNumber = inv.qbo_doc_number || null;
  if (!docNumber && job.job_number) { const siblings = await db.select('invoices', `job_id=eq.${inv.job_id}&select=id,created_at&order=created_at.asc,id.asc`) || []; const pos = siblings.findIndex((row) => row.id === inv.id); const suffix = pos > 0 ? `-${pos + 1}` : ''; docNumber = String(job.job_number).slice(0, 21 - suffix.length) + suffix; }
  const shipAddr = Object.fromEntries(Object.entries({ Line1: job.address || claim?.loss_address || null, City: job.city || claim?.loss_city || null, CountrySubDivisionCode: job.state || claim?.loss_state || null, PostalCode: job.zip || claim?.loss_zip || null }).filter(([, value]) => value));
  let linkedTxn = null;
  if (inv.estimate_id) { const estimate = (await db.select('estimates', `id=eq.${inv.estimate_id}&select=qbo_estimate_id&limit=1`))?.[0]; if (estimate?.qbo_estimate_id) linkedTxn = [{ TxnId: String(estimate.qbo_estimate_id), TxnType: 'Estimate' }]; }
  const payCfg = await db.select('integration_config', 'key=in.(accept_card,accept_ach)&select=key,value') || [];
  const onlinePay = Object.fromEntries([['AllowOnlineCreditCardPayment', 'accept_card'], ['AllowOnlineACHPayment', 'accept_ach']].filter(([, key]) => payCfg.find((row) => row.key === key)?.value === 'true').map(([field]) => [field, true]));
  // PrivateNote keeps the derived job/claim/loss context for internal QuickBooks
  // use; CustomerMemo is what the customer reads.  QuickBooks has no CC on its
  // send endpoint, so BillEmailCc must already be on the invoice when the send
  // fires -- the existing save-then-send pair carries it with no extra provider
  // effect per command.
  const { customerMemo, billEmailCc } = qboSendPresentation(inv, memo);
  const shared = { Line: lines, ...qboInvoiceDateFields(inv), PrivateNote: memo, CustomerMemo: { value: customerMemo }, ...billEmailCc, ...(docNumber ? { DocNumber: docNumber } : {}), ...(Object.keys(shipAddr).length ? { ShipAddr: shipAddr } : {}), ...(linkedTxn ? { LinkedTxn: linkedTxn } : {}), ...onlinePay };
  const action = inv.qbo_invoice_id ? 'update' : 'create';
  const payload = inv.qbo_invoice_id ? shared : { CustomerRef: { value: String(contact.qbo_customer_id) }, ...shared };
  // Fallback payloads are frozen now; they are selected only after a definitive 4xx.
  return { action: 'save', expected_qbo_invoice_id: inv.qbo_invoice_id == null ? null : String(inv.qbo_invoice_id), target_qbo_invoice_id: inv.qbo_invoice_id == null ? null : String(inv.qbo_invoice_id), provider_action: action, default_class_name: map.className || null, primary_payload: payload, without_online_pay_payload: Object.keys(onlinePay).length ? (() => { const { AllowOnlineCreditCardPayment, AllowOnlineACHPayment, ...rest } = payload; return rest; })() : null, without_doc_number_payload: docNumber ? (() => { const { DocNumber, ...rest } = payload; return rest; })() : null, customer_relink_contact_id: !inv.qbo_invoice_id ? inv.contact_id || null : null };
}

async function currentIntent(db, env, request, action, inv, body, expectedRealmId) {
  if (action === 'delete') return { action, expected_qbo_invoice_id: inv.qbo_invoice_id == null ? null : String(inv.qbo_invoice_id), target_qbo_invoice_id: inv.qbo_invoice_id == null ? null : String(inv.qbo_invoice_id), provider_action: 'delete', primary_payload: { missing_is_success: true } };
  if (action === 'send') {
    let recipient = String(body.send_to || '').trim();
    if (!recipient && inv.contact_id) recipient = String((await db.select('contacts', `id=eq.${inv.contact_id}&select=email&limit=1`))?.[0]?.email || '').trim();
    if (!inv.qbo_invoice_id) throw new Error('Invoice has not been sent to QuickBooks yet — push it first, then email.');
    if (!recipient) throw new Error('No email address on file for this customer — add one to the contact (or pass send_to) before emailing.');
    if (!emailOk(recipient)) throw new Error(`Customer email looks invalid: ${recipient}`);
    return { action, expected_qbo_invoice_id: String(inv.qbo_invoice_id), target_qbo_invoice_id: String(inv.qbo_invoice_id), recipient, provider_action: 'send', primary_payload: { recipient } };
  }
  return buildSaveIntent(db, env, request, inv, expectedRealmId);
}

function attemptFromIntent(intent, invoiceId, clientRequestId, stage = 'primary') {
  const providerAction = intent.provider_action;
  return qboInvoiceRequestId(providerAction, invoiceId, clientRequestId, stage).then((providerRequestId) => ({ stage, providerAction, providerTargetId: intent.target_qbo_invoice_id, providerRequestId, providerPayload: intent.primary_payload }));
}

async function executeProvider(env, attempt, expectedRealmId) {
  const options = { requestId: attempt.providerRequestId, expectedRealmId };
  if (attempt.providerAction === 'create') return createInvoice(env, attempt.providerPayload, options);
  if (attempt.providerAction === 'update') return updateInvoice(env, attempt.providerTargetId, attempt.providerPayload, options);
  if (attempt.providerAction === 'send') return sendInvoice(env, attempt.providerTargetId, attempt.providerPayload.recipient, options);
  return deleteInvoice(env, attempt.providerTargetId, { ...options, missingIsSuccess: true });
}

function stagedSavePayload(intent, command) {
  const stage = command.provider_stage || 'primary';
  let payload = intent.primary_payload;
  if (stage === 'without-online-pay') payload = intent.without_online_pay_payload;
  if (stage === 'without-doc-number') payload = intent.without_doc_number_payload;
  if (stage === 'customer-relinked') payload = { ...payload, CustomerRef: command.provider_payload?.CustomerRef };
  return payload;
}

function fillMissingClassRefs(payload, classId) {
  if (!classId || !Array.isArray(payload?.Line)) return payload;
  return {
    ...payload,
    Line: payload.Line.map((line) => {
      if (line?.DetailType !== 'SalesItemLineDetail' || line.SalesItemLineDetail?.ClassRef) return line;
      return { ...line, SalesItemLineDetail: { ...line.SalesItemLineDetail, ClassRef: { value: String(classId) } } };
    }),
  };
}

function alignLocalClassesWithStored(localPayload, storedPayload) {
  if (!Array.isArray(localPayload?.Line) || !Array.isArray(storedPayload?.Line)) return localPayload;
  return {
    ...localPayload,
    Line: localPayload.Line.map((line, index) => {
      const storedClass = storedPayload.Line[index]?.SalesItemLineDetail?.ClassRef;
      if (line?.SalesItemLineDetail?.ClassRef || !storedClass) return line;
      return { ...line, SalesItemLineDetail: { ...line.SalesItemLineDetail, ClassRef: storedClass } };
    }),
  };
}

async function currentMatchesStoredAttempt(db, env, request, command, inv, body) {
  if (command.action === 'delete') return inv.qbo_invoice_id == null || String(inv.qbo_invoice_id) === String(command.expected_qbo_invoice_id);
  if (command.action === 'send') {
    const current = await currentIntent(db, env, request, 'send', inv, body, command.realm_id);
    return String(inv.qbo_invoice_id || '') === String(command.target_qbo_invoice_id || '') && current.recipient === command.intent_payload.recipient;
  }
  // Freeze create/update selection to the command's pre-provider link.  A
  // successful CAS may have changed the live link from null to the created QBO
  // id; that is proof of completion, not an invoice edit.
  const frozen = { ...inv, qbo_invoice_id: command.expected_qbo_invoice_id, qbo_doc_number: command.intent_payload?.primary_payload?.DocNumber || null };
  const rebuilt = await buildSaveIntent(db, env, request, frozen, command.realm_id);
  const stored = command.provider_payload || stagedSavePayload(command.intent_payload, command);
  const local = alignLocalClassesWithStored(stagedSavePayload(rebuilt, command), stored);
  return stableJsonStringify(local) === stableJsonStringify(stored);
}

export async function onRequestOptions(context) { return handleOptions(context.request, context.env); }

export async function onRequestPost(context) {
  const { request, env } = context; const startedAt = new Date().toISOString(); const db = supabase(env, fetchWithTimeout);
  // Invoice writes are a human Save-to-QuickBooks action.  Unlike the
  // background-safe QBO workers, they never accept the shared webhook secret.
  const auth = await authorizeQboBrowserRequest(request, env, db); if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  const commandId = (request.headers.get('Idempotency-Key') || '').trim();
  if (!QBO_COMMAND_ID_RE.test(commandId)) return jsonResponse({ error: 'A UUIDv4 Idempotency-Key is required for QuickBooks invoice actions' }, 400, request, env);
  let body = {}; try { body = await request.json(); } catch { /* handled below */ }
  const invoiceId = body.invoice_id; if (!invoiceId) return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);
  if (!UUID_RE.test(String(invoiceId))) return jsonResponse({ error: 'invoice_id must be a UUID' }, 400, request, env);
  const action = ['send', 'delete'].includes(body.action) ? body.action : 'save';
  try {
    await requireQboProviderTraffic(env);
  } catch (error) {
    if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env);
    throw error;
  }
  const conn = await getConnection(env); if (!conn?.refresh_token || !conn.realm_id) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  const actor = qboCommandActor(auth); const realmId = String(conn.realm_id);
  const existing = await getQboInvoiceCommand(db, commandId);
  if (existing?.ok) {
    if (!qboCommandIdentityMatches(existing, { invoiceId, action, actor, realmId })) return jsonResponse({ error: 'Idempotency-Key belongs to a different invoice, action, account, or QuickBooks realm' }, 409, request, env);
    if (isTerminalQboInvoiceCommand(existing)) return replay(existing, request, env);
  }
  const inv = (await db.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0]; if (!inv) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);
  // A same-key retry after the request was started must never silently use a
  // newly edited invoice, recipient, or QBO link.  Keep the stored attempt
  // authoritative when unchanged; otherwise return a durable review response
  // before touching QBO.
  if (existing?.ok && ['provider_started', 'ambiguous', 'provider_succeeded'].includes(existing.status)) {
    let unchanged = false;
    try { unchanged = await currentMatchesStoredAttempt(db, env, request, existing, inv, body); } catch { unchanged = false; }
    if (!unchanged) {
      const payload = { error: 'Invoice changed after this QuickBooks command started; reload and review before retrying.', code: 'command-source-mismatch' };
      if (existing.status === 'provider_started') {
        await setQboInvoiceCommandState(db, { commandId: existing.id, status: 'ambiguous', responseStatus: 409, responsePayload: payload, error: payload.error });
        await setQboInvoiceCommandState(db, { commandId: existing.id, status: 'needs_reconciliation', responseStatus: 409, responsePayload: payload, error: payload.error });
      }
      else if (existing.status === 'ambiguous') await setQboInvoiceCommandState(db, { commandId: existing.id, status: 'needs_reconciliation', responseStatus: 409, responsePayload: payload, error: payload.error });
      else await setQboInvoiceCommandState(db, { commandId: existing.id, status: 'needs_reconciliation', responseStatus: 409, responsePayload: payload, error: payload.error });
      await reconcile(db, existing.invoice_id, existing.target_qbo_invoice_id || existing.provider_result?.qbo_invoice_id || 'none', inv.qbo_invoice_id || null, existing.action);
      return jsonResponse(payload, 409, request, env);
    }
  }
  let intent;
  try {
    intent = await currentIntent(db, env, request, action, inv, body, realmId);
  } catch (e) {
    if (customerPrerequisiteBoundary(e)) {
      if (isQboProviderTrafficDisabled(e)) {
        return jsonResponse({
          error: QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
          code: e.code,
          reason: e.reason,
          retry_same_request: true,
        }, 503, request, env);
      }
      const status = Number(e.status) === 409 ? 409 : Number(e.status) >= 500 ? Number(e.status) : 500;
      return jsonResponse(customerPrerequisiteError(e), status, request, env);
    }
    if (isQboProviderTrafficDisabled(e)) return qboProviderTrafficDisabledRouteResponse(request, env);
    if (connectionBoundary(e) || e?.intuitTid || e?.qboCode || Number.isFinite(Number(e?.status))) {
      return jsonResponse(
        providerError(e),
        connectionBoundary(e) ? 503 : definitive(e) ? 400 : 500,
        request,
        env,
      );
    }
    const payload = intentError(e);
    return jsonResponse({ error: payload.error, code: payload.code }, payload.status, request, env);
  }
  let command;
  // Once QBO has succeeded, the frozen command (not a source rebuilt after
  // CAS) owns finalization.  This is the post-CAS crash-recovery path.
  if (existing?.ok && existing.status === 'provider_succeeded') command = existing;
  else {
    const prepared = await prepareQboInvoiceCommand(db, { commandId, invoiceId, action, actor, realmId, expectedQboInvoiceId: intent.expected_qbo_invoice_id, targetQboInvoiceId: intent.target_qbo_invoice_id, intent });
    if (!prepared?.ok) return jsonResponse({ error: 'QuickBooks command requires review before retrying.', code: prepared?.reason || 'command-conflict' }, 409, request, env);
    command = await getQboInvoiceCommand(db, prepared.command_id || commandId);
  }
  if (!command?.ok || !qboCommandIdentityMatches(command, { invoiceId, action, actor, realmId })) return jsonResponse({ error: 'QuickBooks command identity could not be verified' }, 409, request, env);
  if (isTerminalQboInvoiceCommand(command)) return replay(command, request, env);
  if (command.status === 'needs_reconciliation') return replay(command, request, env);
  let providerResult = command.provider_result;
  // A delete of an already-unlinked invoice is a local idempotent completion.
  // It still flows through the ledger and CAS, but never manufactures a null
  // provider target or calls QBO.
  if (action === 'delete' && command.status === 'prepared' && command.expected_qbo_invoice_id == null) {
    await setQboInvoiceCommandState(db, { commandId: command.id, status: 'succeeded', responseStatus: 200, responsePayload: { deleted: null, idempotent: true } });
    return replay(await getQboInvoiceCommand(db, command.id), request, env);
  }
  if (command.status !== 'provider_succeeded') {
    let attempt;
    if (command.status === 'prepared') {
      let providerPayload = command.intent_payload.primary_payload;
      if (command.action === 'save' && command.intent_payload.default_class_name) {
        let defaultClassId;
        try {
          defaultClassId = await findClassId(env, command.intent_payload.default_class_name, { expectedRealmId: command.realm_id });
        } catch (error) {
          // Class resolution happens before the durable provider attempt.  It
          // cannot have caused an invoice side effect, so retain the prepared
          // command for a same-key retry rather than freezing a null attempt
          // as ambiguous.
          if (isQboProviderTrafficDisabled(error)) {
            return jsonResponse({
              error: QBO_PROVIDER_TRAFFIC_DISABLED_MESSAGE,
              code: 'qbo_provider_traffic_disabled',
              reason: 'qbo_provider_traffic_disabled',
              retry_same_request: true,
            }, 503, request, env);
          }
          const payload = providerError(error);
          return jsonResponse(payload, connectionBoundary(error) ? 503 : 500, request, env);
        }
        if (!defaultClassId) {
          const payload = { error: `QuickBooks class "${command.intent_payload.default_class_name}" is not available; sync the class catalog and retry.` };
          await finalize(db, command.id, 'rejected', 409, payload, payload.error);
          return jsonResponse(payload, 409, request, env);
        }
        providerPayload = fillMissingClassRefs(providerPayload, defaultClassId);
      }
      attempt = { ...(await attemptFromIntent(command.intent_payload, command.invoice_id, command.id)), providerPayload };
      const started = await startQboInvoiceCommandAttempt(db, { commandId: command.id, ...attempt });
      if (!started?.ok) return jsonResponse({ error: 'QuickBooks command attempt could not be started', code: started?.reason }, 409, request, env);
      attempt = { stage: started.provider_stage, providerAction: started.provider_action, providerTargetId: started.provider_target_id, providerRequestId: started.provider_request_id, providerPayload: started.provider_payload };
    } else {
      attempt = { stage: command.provider_stage, providerAction: command.provider_action, providerTargetId: command.provider_target_id, providerRequestId: command.provider_request_id, providerPayload: command.provider_payload };
    }
    try {
      providerResult = await executeProvider(env, attempt, command.realm_id);
    } catch (e) {
      if (ambiguous(e) || connectionBoundary(e)) return ambiguousProviderFailure(db, command, e, request, env);
      // A fallback is permitted only after a definitive 4xx and becomes a new frozen attempt.
      let fallback = null;
      if (action === 'save' && command.intent_payload.without_online_pay_payload && /payment|online|merchant/i.test(e.message || '')) {
        const { AllowOnlineCreditCardPayment, AllowOnlineACHPayment, ...payload } = attempt.providerPayload;
        fallback = { stage: 'without-online-pay', payload };
      }
      if (action === 'save' && !fallback && command.intent_payload.without_doc_number_payload && (e.qboCode === '6140' || /duplicate document number/i.test(e.message || ''))) {
        const { DocNumber, ...payload } = attempt.providerPayload;
        fallback = { stage: 'without-doc-number', payload };
      }
      if (action === 'save' && !fallback && command.intent_payload.customer_relink_contact_id && isStaleCustomerRef(e)) {
        try {
          const relink = await relinkQboCustomer(env, db, command.intent_payload.customer_relink_contact_id, { expectedRealmId: command.realm_id });
          const payload = { ...attempt.providerPayload, CustomerRef: { value: String(relink.id) } }; fallback = { stage: 'customer-relinked', payload, customerRelink: `QuickBooks customer was re-linked automatically (matched by ${relink.matchedBy}).` };
        } catch (relinkError) {
          if (ambiguous(relinkError) || connectionBoundary(relinkError)) return ambiguousProviderFailure(db, command, relinkError, request, env);
          const payload = providerError(relinkError);
          await finalize(db, command.id, 'rejected', 500, payload, payload.error, null, intuitTid(relinkError));
          return jsonResponse(payload, 500, request, env);
        }
      }
      if (!definitive(e) || !fallback) { const payload = providerError(e); await finalize(db, command.id, 'rejected', 500, payload, payload.error, null, intuitTid(e)); return jsonResponse(payload, 500, request, env); }
      const fallbackAttempt = { stage: fallback.stage, providerAction: attempt.providerAction, providerTargetId: attempt.providerTargetId, providerRequestId: await qboInvoiceRequestId(attempt.providerAction, command.invoice_id, command.id, fallback.stage), providerPayload: fallback.payload };
      const advanced = await advanceQboInvoiceCommandAttempt(db, { commandId: command.id, expectedStage: attempt.stage, ...fallbackAttempt });
      if (!advanced?.ok) return jsonResponse({ error: 'QuickBooks fallback requires review', code: advanced?.reason }, 409, request, env);
      const persistedFallback = { stage: advanced.provider_stage, providerAction: advanced.provider_action, providerTargetId: advanced.provider_target_id, providerRequestId: advanced.provider_request_id, providerPayload: advanced.provider_payload };
      try { providerResult = await executeProvider(env, persistedFallback, command.realm_id); } catch (fallbackError) { if (ambiguous(fallbackError) || connectionBoundary(fallbackError)) return ambiguousProviderFailure(db, command, fallbackError, request, env); const payload = providerError(fallbackError); await finalize(db, command.id, 'rejected', 500, payload, payload.error, null, intuitTid(fallbackError)); return jsonResponse(payload, 500, request, env); }
    }
    try {
    if (action !== 'delete' && !String(providerResult?.Id || '').trim()) {
      const payload = { error: 'QuickBooks accepted the request without an invoice Id; reconciliation is required.', code: 'missing-provider-invoice-id', retry_same_request: true };
      await setQboInvoiceCommandState(db, { commandId: command.id, status: 'ambiguous', responseStatus: 500, responsePayload: payload, error: payload.error });
      return jsonResponse(payload, 500, request, env);
    }
    // bill_email rides along with email_status so BOTH survive into the frozen
    // command. The raw QBO entity is gone on the provider_succeeded crash-recovery
    // path, and the email mirror below has to work there too.
    const result = action === 'delete' ? { local_target_qbo_invoice_id: null } : { qbo_invoice_id: String(providerResult.Id), id: String(providerResult.Id), doc_number: providerResult.DocNumber ?? null, email_status: providerResult.EmailStatus ?? null, bill_email: providerResult.BillEmail?.Address ?? null, total: providerResult.TotalAmt ?? null };
    await setQboInvoiceCommandState(db, { commandId: command.id, status: 'provider_succeeded', providerResult: result, intuitRequestId: intuitTid(providerResult) });
    command = await getQboInvoiceCommand(db, command.id); providerResult = command.provider_result;
    if (action !== 'delete' && command.target_qbo_invoice_id && String(providerResult?.qbo_invoice_id || providerResult?.id) !== String(command.target_qbo_invoice_id)) return needsReconciliation(db, command, request, env, 'QuickBooks returned a different invoice than the frozen command target.');
    } catch {
      return postProviderFailure(db, command, request, env);
    }
  }
  try {
  const fresh = (await db.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0];
  if (!fresh) return needsReconciliation(db, command, request, env, 'Invoice disappeared before QuickBooks finalization.');
  if (action === 'save' && !(await currentMatchesStoredAttempt(db, env, request, command, fresh, body))) return needsReconciliation(db, command, request, env, 'Invoice changed after QuickBooks accepted the frozen save; reload and reconcile before retrying.', fresh.qbo_invoice_id);
  if (action === 'send') {
    let currentSend;
    try { currentSend = await currentIntent(db, env, request, 'send', fresh, body, command.realm_id); } catch { return needsReconciliation(db, command, request, env, 'Invoice recipient changed after QuickBooks accepted the send; reload and reconcile before retrying.', fresh.qbo_invoice_id); }
    if (String(fresh.qbo_invoice_id || '') !== String(command.target_qbo_invoice_id || '') || currentSend.recipient !== command.intent_payload.recipient) return needsReconciliation(db, command, request, env, 'Invoice link or recipient changed after QuickBooks accepted the send; reload and reconcile before retrying.', fresh.qbo_invoice_id);
  }
  if (action === 'delete' && fresh.qbo_invoice_id != null && String(fresh.qbo_invoice_id) !== String(command.expected_qbo_invoice_id)) return needsReconciliation(db, command, request, env, 'Invoice link changed after QuickBooks accepted the delete; reload and reconcile before retrying.', fresh.qbo_invoice_id);
  const target = action === 'delete' ? null : String(providerResult.qbo_invoice_id || providerResult.id || command.target_qbo_invoice_id);
  const cas = rpcObject(await db.rpc('cas_qbo_invoice_link', { p_invoice_id: invoiceId, p_expected_qbo_invoice_id: command.expected_qbo_invoice_id, p_new_qbo_invoice_id: target, p_qbo_doc_number: action === 'delete' ? null : (providerResult.doc_number ?? null), ...(action === 'send' ? { p_qbo_emailed_at: new Date().toISOString(), p_qbo_email_status: providerResult.email_status || 'EmailSent', p_sent_to_email: command.intent_payload.recipient, p_write_email_metadata: true } : {}) }));
  if (!cas?.ok) return needsReconciliation(db, command, request, env, 'QuickBooks invoice link changed concurrently; reload and review before retrying.', cas?.current_qbo_invoice_id || null);
  if (action === 'save') {
    const now = new Date().toISOString();
    const patch = { qbo_synced_at: now, qbo_sync_error: null };
    if (!command.expected_qbo_invoice_id) {
      if (!fresh.sent_at) patch.sent_at = now;
      if (!fresh.due_date) patch.due_date = qboInvoiceDateFields(fresh).DueDate || now.slice(0, 10);
    }
    await db.update('invoices', `id=eq.${invoiceId}`, patch);
  }
  const response = action === 'delete' ? { deleted: command.expected_qbo_invoice_id } : action === 'send' ? { ok: true, emailed_to: command.intent_payload.recipient, email_status: providerResult.email_status || 'EmailSent' } : { ok: true, mode: command.expected_qbo_invoice_id ? 'updated' : 'created', qbo_invoice_id: target, doc_number: providerResult.doc_number, total: providerResult.total ?? null, online_pay_warning: command.provider_stage === 'without-online-pay' ? 'Invoice synced, but online card/ACH pay could not be turned on — enable QuickBooks Payments in QuickBooks first.' : null, customer_relink: command.provider_stage === 'customer-relinked' ? 'QuickBooks customer was re-linked automatically.' : null };
  await finalize(db, command.id, 'succeeded', 200, response);
  // Mirror what QuickBooks itself reports about emailing this invoice. Every
  // create/update/send response IS a full invoice entity, so this costs no extra
  // provider call. It writes ONLY the three observation columns: qbo_emailed_at
  // remains the send path's (stamped by the CAS above), because a trigger derives
  // invoice status and CRM lead value from it. Self-guarding -- a silent no-op
  // until migration 20260807190000 is applied.
  if (action !== 'delete') {
    await mirrorQboInvoiceEmail(db, [invoiceId], {
      EmailStatus: providerResult.email_status,
      BillEmail: providerResult.bill_email ? { Address: providerResult.bill_email } : undefined,
    });
  }
  if (action === 'send') {
    await recordActivity(db, {
      invoiceId, actor, eventType: 'invoice_sent',
      recipient: command.intent_payload.recipient,
      cc: (fresh.send_cc_email || '').trim() || null,
      metadata: { email_status: providerResult.email_status || 'EmailSent', resend: Boolean(fresh.qbo_emailed_at) },
    });
  } else if (action === 'save') {
    await recordActivity(db, {
      invoiceId, actor, eventType: 'invoice_saved_to_quickbooks',
      metadata: { mode: command.expected_qbo_invoice_id ? 'updated' : 'created' },
    });
  }
  await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse(response, 200, request, env);
  } catch {
    return postProviderFailure(db, command, request, env);
  }
}
