/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Saves, emails, or removes one estimate in QuickBooks after a person asks
 *   for that exact action. It records the request first, safely resumes an
 *   interrupted attempt, and updates UPR only after QuickBooks succeeds.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  CORS, QBO auth, QuickBooks, hashing, Supabase, estimate commands,
 *              qbo-description (long-description segmentation)
 *   Data:      reads  → estimates, estimate_line_items, jobs, contacts, claims,
 *                       integration_credentials, qbo_estimate_commands
 *              writes → qbo_estimate_commands, qbo_estimate_command_reservations,
 *                       estimates, estimate_line_items, contacts, worker_runs
 *
 * NOTES / GOTCHAS:
 *   - A QuickBooks provider call is allowed only after the database proves this
 *     command owns a fresh attempt; unknown outcomes keep the same retry key.
 *   - Estimate totals and line totals remain database-trigger-owned.
 *   - A description longer than one QuickBooks line allows (4,000 chars) is not
 *     an error: it continues on DescriptionOnly rows under the priced line.
 * ════════════════════════════════════════════════
 */
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { authorizeQboBrowserRequest } from '../lib/qbo-auth.js';
import { supabase } from '../lib/supabase.js';
import {
  createEstimate, customerCreateRequestId, deleteEstimate, divisionToQbo,
  ensureQboCustomer, getConnection, sendEstimate, updateEstimate,
} from '../lib/quickbooks.js';
import { sha256hex } from '../lib/intuit.js';
import { QBO_MAX_LINE_DESCRIPTION, qboDescriptionOnlyLine, qboDescriptionSegments } from '../lib/qbo-description.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { qboProviderTrafficDisabledRouteResponse, requireQboDocumentCommandV2 } from './qbo-document-command-gate.js';
import {
  QBO_ESTIMATE_COMMAND_ID_RE, finalizeQboEstimateCommand,
  getQboEstimateCommand, hashEstimateCommand, isTerminalQboEstimateCommand,
  prepareQboEstimateCommand, qboEstimateActor,
  qboEstimateCommandIdentityMatches, releaseQboEstimateCommandReservation,
  reserveQboEstimateCommand, setQboEstimateCommandState,
  startQboEstimateCommandAttempt,
} from '../lib/qbo-estimate-commands.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROOT_KEYS = new Set(['estimate_id', 'action', 'send_to', 'line_change']);
const PATCH_KEYS = new Set(['description', 'qbo_item_id', 'qbo_item_name', 'qbo_class_id', 'qbo_class_name', 'quantity', 'unit_price']);
const LINE_KEYS = Object.freeze({
  create: new Set(['kind', 'patch']),
  update: new Set(['kind', 'line_id', 'patch']),
  delete: new Set(['kind', 'line_id']),
  reorder: new Set(['kind', 'ordered_line_ids']),
});
const TERMINAL_ESTIMATE_STATUSES = new Set(['approved', 'denied', 'paid']);
const MAX_DECIMAL_SOURCE_LENGTH = 128;
const MAX_DECIMAL_EXPONENT = 1_000;
// Realm IDs are a frozen accounting contract in UPR-QBO-SYNC-PROTOCOL.md. A
// catalog lookup here would itself be a provider call before the command ledger
// authorizes a fresh attempt, so the write payload uses the reviewed IDs.
const DEFAULT_CLASS_IDS = Object.freeze({ Reconstruction: '1000000003', Mitigation: '1000000005' });
const definitive = (error) => Number.isFinite(Number(error?.status)) && Number(error.status) >= 400 && Number(error.status) < 500;

function providerFailureResponse(error, maintenanceDenied) {
  if (maintenanceDenied) return {
    error: 'QuickBooks provider traffic is temporarily disabled.',
    code: 'qbo_provider_traffic_disabled',
    reason: 'qbo_provider_traffic_disabled',
    retry_same_request: true,
  };
  if (definitive(error)) return {
    error: 'QuickBooks rejected the estimate command.',
    code: 'qbo_estimate_rejected',
    intuit_tid: error?.intuitTid || null,
    retry_same_request: false,
  };
  return {
    error: 'QuickBooks estimate outcome is uncertain. Retry the same request.',
    code: 'qbo_estimate_outcome_uncertain',
    intuit_tid: error?.intuitTid || null,
    retry_same_request: true,
  };
}

function bad(message, code = 'invalid-request') {
  const error = new Error(message); error.status = 400; error.code = code; return error;
}
function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(`${label} must be an object.`);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw bad(`${label} includes unsupported field "${extra}".`);
}
function optionalText(value, label, max = 255) {
  if (value == null) return null;
  if (typeof value !== 'string') throw bad(`${label} must be text.`);
  const text = value.trim();
  if (text.length > max) throw bad(`${label} is too long.`);
  return text || null;
}
function safePatch(value) {
  exactKeys(value, PATCH_KEYS, 'line_change.patch');
  if (typeof value.description !== 'string' || !value.description.trim()) throw bad('Line item description is required.');
  const description = value.description.trim();
  if (description.length > QBO_MAX_LINE_DESCRIPTION) throw bad(`Line item description is ${description.length.toLocaleString('en-US')} characters — the limit is ${QBO_MAX_LINE_DESCRIPTION.toLocaleString('en-US')}.`);
  if (typeof value.quantity !== 'number' || typeof value.unit_price !== 'number') throw bad('Line item quantity and unit price must be numbers.');
  const quantity = value.quantity; const unitPrice = value.unit_price;
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) throw bad('Line item quantity must be greater than 0 and no more than 1,000,000.');
  if (!Number.isFinite(unitPrice) || Math.abs(unitPrice) > 100_000_000) throw bad('Line item unit price must be finite and within the supported range.');
  return {
    description,
    qbo_item_id: optionalText(value.qbo_item_id, 'qbo_item_id'),
    qbo_item_name: optionalText(value.qbo_item_name, 'qbo_item_name'),
    qbo_class_id: optionalText(value.qbo_class_id, 'qbo_class_id'),
    qbo_class_name: optionalText(value.qbo_class_name, 'qbo_class_name'),
    quantity, unit_price: unitPrice,
  };
}
export function validateEstimateCommandBody(value) {
  exactKeys(value, ROOT_KEYS, 'Request body');
  if (!UUID_RE.test(String(value.estimate_id || ''))) throw bad('estimate_id must be a UUID.');
  const action = value.action == null ? 'save' : value.action;
  if (!['save', 'send', 'delete'].includes(action)) throw bad('action must be save, send, or delete.');
  if (value.send_to != null && action !== 'send') throw bad('send_to is only valid for send.');
  if (value.line_change != null && action !== 'save') throw bad('line_change is only valid for save.');
  let lineChange = null;
  if (value.line_change != null) {
    const kind = value.line_change.kind;
    if (!['create', 'update', 'delete', 'reorder'].includes(kind)) throw bad('line_change.kind is invalid.');
    exactKeys(value.line_change, LINE_KEYS[kind], 'line_change');
    if (kind === 'create' || kind === 'update') lineChange = { kind, ...(kind === 'update' ? { line_id: String(value.line_change.line_id || '') } : {}), patch: safePatch(value.line_change.patch) };
    else if (kind === 'delete') lineChange = { kind, line_id: String(value.line_change.line_id || '') };
    else {
      if (!Array.isArray(value.line_change.ordered_line_ids)) throw bad('ordered_line_ids must be an array.');
      lineChange = { kind, ordered_line_ids: value.line_change.ordered_line_ids.map(String) };
    }
    if (['update', 'delete'].includes(kind) && !UUID_RE.test(lineChange.line_id)) throw bad('line_change.line_id must be a UUID.');
  }
  return { estimateId: String(value.estimate_id), action, sendTo: optionalText(value.send_to, 'send_to', 320), lineChange };
}

const normalizedLine = (line) => ({
  id: String(line.id), description: String(line.description || '').trim(),
  qbo_item_id: line.qbo_item_id || null, qbo_item_name: line.qbo_item_name || null,
  qbo_class_id: line.qbo_class_id || null, qbo_class_name: line.qbo_class_name || null,
  // Preserve a PostgREST numeric string until cent rounding. Number() is used
  // only for validation and the QBO Qty/UnitPrice fields below.
  quantity: line.quantity, unit_price: line.unit_price,
  sort_order: line.sort_order == null ? null : Number(line.sort_order),
});
const linePreimage = (line) => ({ ...line, quantity: Number(line.quantity), unit_price: Number(line.unit_price) });
export function stageEstimateLineChange(lines, change) {
  const source = lines.map(normalizedLine);
  const documentPreimage = source.map(linePreimage);
  if (!change) return { lines: source, preimage: null, documentPreimage };
  if (change.kind === 'create') return { lines: [...source, { ...change.patch, id: '00000000-0000-4000-8000-000000000000', sort_order: source.length }], preimage: null, documentPreimage };
  if (change.kind === 'reorder') {
    const ids = change.ordered_line_ids;
    if (!Array.isArray(ids) || ids.some((id) => !UUID_RE.test(String(id))) || ids.length !== source.length || new Set(ids.map(String)).size !== source.length) throw bad('ordered_line_ids must contain every current line exactly once.');
    const byId = new Map(source.map((line) => [line.id, line]));
    if (ids.some((id) => !byId.has(String(id)))) throw bad('ordered_line_ids does not match this estimate.');
    return { lines: ids.map((id, index) => ({ ...byId.get(String(id)), sort_order: index })), preimage: documentPreimage, documentPreimage };
  }
  const index = source.findIndex((line) => line.id === change.line_id);
  if (index < 0) throw bad('line_change line_id does not belong to this estimate.');
  const preimage = linePreimage(source[index]);
  if (change.kind === 'delete') return { lines: source.filter((_, position) => position !== index), preimage, documentPreimage };
  const candidate = [...source]; candidate[index] = { ...candidate[index], ...change.patch };
  return { lines: candidate, preimage, documentPreimage };
}
function decimalParts(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).length > MAX_DECIMAL_SOURCE_LENGTH) {
    throw bad('Line item quantity and unit price must be finite decimals.');
  }
  const match = String(value).trim().toLowerCase().match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (!match) throw bad('Line item quantity and unit price must be finite decimals.');
  const negative = match[1] === '-';
  const fraction = match[3] || '';
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) {
    throw bad('Line item decimal exponent is outside the supported range.');
  }
  let digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/, '');
  let scale = fraction.length - exponent;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  const units = BigInt(`${negative ? '-' : ''}${digits || '0'}`);
  return { units, scale };
}

// QBO consumes two-decimal line amounts. Convert the decimal intent to minor
// units before rounding so binary floating point never turns 1.005 into 1.00.
function qboEstimateLineCents(line) {
  const quantity = decimalParts(line.quantity);
  const rate = decimalParts(line.unit_price);
  const product = quantity.units * rate.units;
  const denominator = 10n ** BigInt(quantity.scale + rate.scale);
  const scaled = (product < 0n ? -product : product) * 100n;
  let cents = scaled / denominator;
  if ((scaled % denominator) * 2n >= denominator) cents += 1n;
  if (product < 0n) cents = -cents;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw bad('Line item amount is outside the supported range.');
  }
  return cents;
}
export function qboEstimateLineAmount(line) { return Number(qboEstimateLineCents(line)) / 100; }

// Name the exact line and the exact problem. The pre-durable-boundary worker
// (through 2026-08-08) sent descriptions to QuickBooks with no validation at
// all — any length, empty allowed. The 2026-08-12 rewrite refused both with
// one conflated message ("Every line item needs a valid description."), which
// read as nonsense to a user staring at a fully written scope of work
// (2026-08-14 field report, owner-confirmed regression). Restored: a long
// description flows onto DescriptionOnly continuation rows below, an empty
// one is simply omitted from the provider payload (as the invoice path always
// did) — only a runaway paste past the ceiling or a bad number refuses.
function validateCandidateLines(lines) {
  lines.forEach((line, index) => {
    const quantity = Number(line.quantity); const unitPrice = Number(line.unit_price);
    if (String(line.description || '').length > QBO_MAX_LINE_DESCRIPTION) throw bad(`Line ${index + 1}'s description is ${String(line.description).length.toLocaleString('en-US')} characters — the limit is ${QBO_MAX_LINE_DESCRIPTION.toLocaleString('en-US')}. Shorten it and save again.`);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) throw bad(`Line ${index + 1} needs a quantity greater than 0 and no more than 1,000,000.`);
    if (!Number.isFinite(unitPrice) || Math.abs(unitPrice) > 100_000_000) throw bad(`Line ${index + 1} needs a unit price within the supported range.`);
  });
}

async function estimateRequestId(action, estimateId, commandId, stage = 'primary') {
  const digest = await sha256hex(JSON.stringify({ action, estimate_id: estimateId, command_id: commandId, stage }));
  return `upr-e-${action[0]}-${digest.slice(0, 40)}`;
}
function responseFor(command) {
  if (command.response_payload) return { status: command.response_status || (command.status === 'succeeded' ? 200 : 409), payload: command.response_payload };
  if (command.status === 'ambiguous' || command.status === 'provider_started') return { status: 503, payload: { error: 'QuickBooks outcome is unknown. Reconciliation is required before another attempt.', code: 'ambiguous-provider-outcome', retry_same_request: true } };
  return { status: 409, payload: { error: 'QuickBooks command requires reconciliation before retrying.', code: 'needs-reconciliation', retry_same_request: true } };
}
function successfulResponse(command) {
  const result = command.provider_result || {};
  if (command.action === 'send') return { ok: true, emailed_to: result.send_to, email_status: result.email_status || 'EmailSent' };
  if (command.action === 'delete') return { deleted: command.expected_qbo_estimate_id || null };
  return { ok: true, mode: command.expected_qbo_estimate_id ? 'updated' : 'created', qbo_estimate_id: result.qbo_estimate_id, doc_number: result.doc_number ?? null, total: result.total ?? null };
}
function formatDateOfLoss(value) {
  if (!value) return '';
  const parts = String(value).split('T')[0].split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}/${parts[0]}` : String(value);
}

function snapshotFailure(message, status = 400, code = 'invalid-estimate-state') {
  const error = new Error(message); error.status = status; error.code = code; return error;
}

async function loadEstimateSnapshot(db, estimateId) {
  const est = (await db.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
  if (!est) return null;
  const sourceLines = await db.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc.nullslast,created_at.asc,id.asc`) || [];
  const job = est.job_id ? (await db.select('jobs', `id=eq.${est.job_id}&select=id,division,job_number,claim_id,address,city,state,zip,date_of_loss,primary_contact_id&limit=1`))?.[0] || null : null;
  const contactId = est.contact_id || job?.primary_contact_id;
  const contact = contactId ? (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id,name,email&limit=1`))?.[0] || null : null;
  const claim = job?.claim_id ? (await db.select('claims', `id=eq.${job.claim_id}&select=id,claim_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip&limit=1`))?.[0] || null : null;
  return { est, sourceLines, job, contactId, contact, claim };
}

const valueOrNull = (value) => value == null ? null : value;
function providerSourcePreimage({ est, job, contactId, contact, claim }) {
  return {
    estimate: {
      id: String(est.id), job_id: valueOrNull(est.job_id), contact_id: valueOrNull(est.contact_id),
      status: valueOrNull(est.status), converted_invoice_id: valueOrNull(est.converted_invoice_id),
      qbo_estimate_id: valueOrNull(est.qbo_estimate_id), intended_division: valueOrNull(est.intended_division),
      estimate_number: valueOrNull(est.estimate_number), expiration_date: valueOrNull(est.expiration_date),
      property_address: valueOrNull(est.property_address), property_city: valueOrNull(est.property_city),
      property_state: valueOrNull(est.property_state), property_zip: valueOrNull(est.property_zip),
    },
    job: job ? {
      id: String(job.id), division: valueOrNull(job.division), job_number: valueOrNull(job.job_number),
      claim_id: valueOrNull(job.claim_id), address: valueOrNull(job.address), city: valueOrNull(job.city),
      state: valueOrNull(job.state), zip: valueOrNull(job.zip), date_of_loss: valueOrNull(job.date_of_loss),
      primary_contact_id: valueOrNull(job.primary_contact_id),
    } : null,
    contact: contact ? {
      id: String(contactId), qbo_customer_id: valueOrNull(contact.qbo_customer_id),
      name: valueOrNull(contact.name), email: valueOrNull(contact.email),
    } : null,
    claim: claim ? {
      id: String(claim.id), claim_number: valueOrNull(claim.claim_number),
      date_of_loss: valueOrNull(claim.date_of_loss), loss_address: valueOrNull(claim.loss_address),
      loss_city: valueOrNull(claim.loss_city), loss_state: valueOrNull(claim.loss_state),
      loss_zip: valueOrNull(claim.loss_zip),
    } : null,
  };
}

function buildEstimateCandidate(snapshot, input) {
  const { est, sourceLines, job, contactId, contact, claim } = snapshot;
  const { action, lineChange } = input;
  if (est.converted_invoice_id || TERMINAL_ESTIMATE_STATUSES.has(est.status)) throw snapshotFailure('Estimate can no longer be changed', 409, 'estimate-terminal');
  if ((action === 'send' || action === 'delete') && !est.qbo_estimate_id) throw snapshotFailure(action === 'send' ? 'Save this estimate to QuickBooks before emailing it.' : 'No QuickBooks estimate exists to delete.');
  const staged = stageEstimateLineChange(sourceLines, lineChange);
  let sendTo = input.sendTo;
  if (action === 'send') {
    sendTo ||= optionalText(contact?.email, 'contact email', 320);
    if (!sendTo || !EMAIL_RE.test(sendTo)) throw snapshotFailure(!sendTo ? 'No customer email is available.' : `Customer email looks invalid: ${sendTo}`);
  }
  const divisionVal = est.intended_division || job?.division || null;
  const map = divisionToQbo(divisionVal);
  if (action === 'save' && !map) throw snapshotFailure(`No QuickBooks mapping for division "${divisionVal || ''}"`);
  if (action === 'save' && (!contactId || !contact)) throw snapshotFailure('Estimate contact could not be found.');
  const defaultClassId = action === 'save' && map.className ? DEFAULT_CLASS_IDS[map.className] || null : null;
  let lines = [];
  if (action === 'save') {
    validateCandidateLines(staged.lines);
    // QuickBooks caps one Description at 4,000 characters. A longer scope of
    // work keeps its first segment on the priced line and continues on
    // amount-free DescriptionOnly rows, so the document keeps the whole text
    // and the total is untouched.
    lines = staged.lines.flatMap((line) => {
      const [description, ...overflow] = qboDescriptionSegments(line.description);
      return [{
        DetailType: 'SalesItemLineDetail', Amount: qboEstimateLineAmount(line),
        ...(description ? { Description: description } : {}),
        SalesItemLineDetail: {
          ItemRef: { value: String(line.qbo_item_id || map.itemId) },
          ...(line.qbo_class_id || defaultClassId ? { ClassRef: { value: String(line.qbo_class_id || defaultClassId) } } : {}),
          Qty: Number(line.quantity), UnitPrice: Number(line.unit_price),
        },
      }, ...overflow.map(qboDescriptionOnlyLine)];
    });
    const totalCents = staged.lines.reduce((sum, line) => sum + qboEstimateLineCents(line), 0n);
    if (!lines.length || totalCents <= 0n) throw snapshotFailure('Estimate total is 0 — add a line item with an amount before saving');
  }
  const claimNo = est.claim_number || claim?.claim_number || null;
  const address = { Line1: est.property_address || job?.address || claim?.loss_address || null, City: est.property_city || job?.city || claim?.loss_city || null, CountrySubDivisionCode: est.property_state || job?.state || claim?.loss_state || null, PostalCode: est.property_zip || job?.zip || claim?.loss_zip || null };
  const shipAddr = Object.fromEntries(Object.entries(address).filter(([, value]) => value));
  const dateOfLoss = formatDateOfLoss(job?.date_of_loss || claim?.date_of_loss);
  const serviceAddress = [address.Line1, address.City, address.CountrySubDivisionCode, address.PostalCode].filter(Boolean).join(', ');
  const memo = [dateOfLoss ? `Date of loss: ${dateOfLoss}` : null, job?.job_number ? `Job: ${job.job_number}` : null, claimNo ? `Claim: ${claimNo}` : null, serviceAddress ? `Service Address: ${serviceAddress}` : null].filter(Boolean).join(' · ') || `Estimate ${est.estimate_number || ''}`.trim();
  const docNumber = est.estimate_number ? String(est.estimate_number).slice(0, 21) : null;
  const expDate = /^\d{4}-\d{2}-\d{2}/.test(String(est.expiration_date || '')) ? String(est.expiration_date).slice(0, 10) : null;
  return { est, staged, contactId, contact, sendTo, lines, shipAddr, memo, docNumber, expDate, snapshot, providerAction: action === 'save' ? (est.qbo_estimate_id ? 'update' : 'create') : action };
}

async function releaseAfterLocalFailure(db, { commandId, estimateId }) {
  try {
    const released = await releaseQboEstimateCommandReservation(db, { commandId, estimateId });
    return released?.ok === true;
  } catch { return false; }
}

async function executeFrozenEstimateCommand({ db, env, request, commandId, action, realmId, providerAction, providerTargetId, providerRequestId, providerPayload, startedAt }) {
  try {
    let result;
    const providerOptions = { requestId: providerRequestId, expectedRealmId: realmId };
    if (providerAction === 'create') result = await createEstimate(env, providerPayload, providerOptions);
    else if (providerAction === 'update') result = await updateEstimate(env, providerTargetId, providerPayload, providerOptions);
    else if (providerAction === 'send') result = await sendEstimate(env, providerTargetId, providerPayload.send_to, providerOptions);
    else result = await deleteEstimate(env, providerTargetId, { ...providerOptions, missingIsSuccess: true });
    if ((action === 'save' || action === 'send') && !result?.Id) throw new Error('QuickBooks response omitted the estimate Id; its outcome requires reconciliation.');
    if ((providerAction === 'update' || providerAction === 'send') && String(result.Id) !== String(providerTargetId)) {
      throw new Error('QuickBooks returned a different estimate than the frozen command target; reconciliation is required.');
    }
    const success = action === 'save'
      ? { ok: true, mode: providerAction === 'create' ? 'created' : 'updated', qbo_estimate_id: String(result.Id), doc_number: result.DocNumber ?? null, total: result.TotalAmt ?? null }
      : action === 'send' ? { ok: true, emailed_to: providerPayload.send_to, email_status: result?.EmailStatus || 'EmailSent' }
        : { deleted: providerTargetId };
    const providerResult = action === 'save'
      ? { qbo_estimate_id: String(result.Id), doc_number: result.DocNumber ?? null, total: result.TotalAmt ?? null }
      : action === 'send' ? { qbo_estimate_id: String(providerTargetId), email_status: result?.EmailStatus || 'EmailSent', send_to: providerPayload.send_to }
        : { qbo_estimate_id: null };
    const marked = await setQboEstimateCommandState(db, { commandId, status: 'provider_succeeded', providerResult });
    if (!marked?.ok) return jsonResponse({ error: 'QuickBooks succeeded, but its durable result requires reconciliation.', code: marked?.reason || 'provider-result-not-recorded', retry_same_request: true }, 409, request, env);
    const finalized = await finalizeQboEstimateCommand(db, { commandId, responseStatus: 200, responsePayload: success });
    if (!finalized?.ok) {
      const reconciliation = { error: 'QuickBooks succeeded, but local estimate finalization requires reconciliation.', code: finalized?.reason || 'finalize-failed', retry_same_request: true };
      const markedReconciliation = await setQboEstimateCommandState(db, { commandId, status: 'needs_reconciliation', responseStatus: 409, responsePayload: reconciliation, error: finalized?.reason || 'finalize-failed' });
      if (!markedReconciliation?.ok) reconciliation.state_error = markedReconciliation?.reason || 'reconciliation-state-not-recorded';
      return jsonResponse(reconciliation, 409, request, env);
    }
    await recordWorkerRun(db, { workerName: 'qbo-estimate', status: 'completed', recordsProcessed: 1, startedAt });
    return jsonResponse(success, 200, request, env);
  } catch (error) {
    // A late maintenance close occurs before the next Intuit request, but this
    // command already owns a frozen request identity. Keep its ambiguity fence
    // and make the retry instruction unambiguous to native/browser callers.
    const maintenanceDenied = isQboProviderTrafficDisabled(error);
    const payload = providerFailureResponse(error, maintenanceDenied);
    const diagnosticError = error?.message || String(error);
    const marked = await setQboEstimateCommandState(db, { commandId, status: maintenanceDenied || !definitive(error) ? 'ambiguous' : 'rejected', responseStatus: maintenanceDenied ? 503 : (definitive(error) ? 422 : 503), responsePayload: payload, error: diagnosticError, intuitRequestId: error?.intuitTid || null });
    if (!marked?.ok) {
      payload.code = marked?.reason || 'command-state-not-recorded';
      payload.retry_same_request = true;
    }
    await recordWorkerRun(db, { workerName: 'qbo-estimate', status: 'error', recordsProcessed: 0, errorMessage: payload.code, startedAt });
    return jsonResponse(payload, maintenanceDenied ? 503 : (definitive(error) ? 422 : 503), request, env);
  }
}

async function startFailureResponse(db, commandId, started, request, env) {
  if (started?.reason === 'invalid-attempt') {
    const payload = { error: 'QuickBooks command contains an invalid provider attempt.', code: 'invalid-attempt', retry_same_request: false };
    const rejected = await setQboEstimateCommandState(db, { commandId, status: 'rejected', responseStatus: 400, responsePayload: payload, error: payload.error });
    if (rejected?.ok) return jsonResponse(payload, 400, request, env);
    return jsonResponse({ ...payload, code: rejected?.reason || 'rejection-state-not-recorded', retry_same_request: true }, 409, request, env);
  }
  return jsonResponse({ error: 'QuickBooks command did not acquire a fresh provider attempt.', code: started?.reason || 'attempt-not-fresh', retry_same_request: true }, 409, request, env);
}
export async function onRequestOptions(context) { return handleOptions(context.request, context.env); }

export async function onRequestPost({ request, env }) {
  const startedAt = new Date().toISOString(); const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboBrowserRequest(request, env, db);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  let raw;
  try { raw = await request.json(); } catch { return jsonResponse({ error: 'Provide estimate_id' }, 400, request, env); }
  let input;
  try { input = validateEstimateCommandBody(raw); } catch (error) { return jsonResponse({ error: error.message, code: error.code }, 400, request, env); }
  const commandId = (request.headers.get('Idempotency-Key') || '').trim();
  if (!QBO_ESTIMATE_COMMAND_ID_RE.test(commandId)) return jsonResponse({ error: 'A UUIDv4 Idempotency-Key is required for QuickBooks estimate actions' }, 400, request, env);
  if (!(await requireQboDocumentCommandV2(db))) return jsonResponse({ error: 'QuickBooks document commands are temporarily unavailable.', code: 'qbo_document_command_v2_disabled' }, 503, request, env);
  try { await requireQboProviderTraffic(env); } catch (error) {
    if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env);
    throw error;
  }
  const requestHash = await hashEstimateCommand({ send_to: input.sendTo, line_change: input.lineChange });
  const { estimateId, action, lineChange } = input; const actor = qboEstimateActor(auth);
  const existing = await getQboEstimateCommand(db, commandId);
  if (existing?.ok) {
    if (!qboEstimateCommandIdentityMatches(existing, { estimateId, action, actor, realmId: existing.realm_id, requestHash })) return jsonResponse({ error: 'Idempotency-Key belongs to a different estimate command or request body' }, 409, request, env);
    if (isTerminalQboEstimateCommand(existing)) { const replay = responseFor(existing); return jsonResponse(replay.payload, replay.status, request, env); }
    if (existing.status === 'provider_succeeded') {
      const saved = successfulResponse(existing);
      const finalized = await finalizeQboEstimateCommand(db, { commandId, responseStatus: 200, responsePayload: saved });
      if (!finalized?.ok) {
        const reconciliation = { error: 'Local estimate finalization requires reconciliation.', code: finalized?.reason || 'finalize-failed', retry_same_request: true };
        const marked = await setQboEstimateCommandState(db, { commandId, status: 'needs_reconciliation', responseStatus: 409, responsePayload: reconciliation, error: reconciliation.code });
        if (!marked?.ok) reconciliation.state_error = marked?.reason || 'reconciliation-state-not-recorded';
        return jsonResponse(reconciliation, 409, request, env);
      }
      const complete = await getQboEstimateCommand(db, commandId);
      if (!complete?.ok || !isTerminalQboEstimateCommand(complete)) return jsonResponse({ error: 'Finalized command replay could not be loaded.', code: complete?.reason || 'replay-load-failed', retry_same_request: true }, 409, request, env);
      const replay = responseFor(complete); return jsonResponse(replay.payload, replay.status, request, env);
    }
    if (existing.status === 'prepared') {
      const conn = await getConnection(env);
      if (!conn?.refresh_token || !conn.realm_id) return jsonResponse({ error: 'QuickBooks connection is unavailable. Restore it before retrying this exact command.', code: 'qbo-connection-unavailable', retry_same_request: true }, 503, request, env);
      if (String(conn.realm_id) !== String(existing.realm_id)) return jsonResponse({ error: 'This command belongs to a different QuickBooks company and requires reconciliation.', code: 'qbo-realm-mismatch', retry_same_request: true }, 409, request, env);
      const frozen = existing.intent_payload || {};
      const started = await startQboEstimateCommandAttempt(db, {
        commandId, stage: 'primary', providerAction: frozen.provider_action,
        providerTargetId: existing.target_qbo_estimate_id || null,
        providerRequestId: frozen.provider_request_id, providerPayload: frozen.provider_payload,
      });
      if (!started?.ok || started.started !== true) return startFailureResponse(db, commandId, started, request, env);
      return executeFrozenEstimateCommand({ db, env, request, commandId, action, realmId: existing.realm_id, providerAction: frozen.provider_action, providerTargetId: existing.target_qbo_estimate_id || null, providerRequestId: frozen.provider_request_id, providerPayload: frozen.provider_payload, startedAt });
    }
    const replay = responseFor(existing); return jsonResponse(replay.payload, replay.status, request, env);
  }

  const conn = await getConnection(env);
  // This may be an exact retry of a reservation-only customer prerequisite:
  // no command row exists until preparation, but the durable reservation is
  // already bound to this UUID. Keep that identity while credentials recover.
  if (!conn?.refresh_token || !conn.realm_id) return jsonResponse({
    error: 'QuickBooks connection is unavailable. Restore it before retrying this exact command.',
    code: 'qbo-connection-unavailable',
    retry_same_request: true,
  }, 503, request, env);
  const realmId = String(conn.realm_id);

  // Validate known-local failures before reserving. This is only a preflight:
  // every mutable provider input is loaded again after the reservation commits.
  let preflight;
  try {
    const snapshot = await loadEstimateSnapshot(db, estimateId);
    if (!snapshot) return jsonResponse({ error: 'Estimate not found' }, 404, request, env);
    preflight = buildEstimateCandidate(snapshot, input);
  } catch (error) {
    return jsonResponse({ error: error.message, code: error.code }, error.status || 400, request, env);
  }
  // Customer sync is a separate, stable-idempotent prerequisite. Its primary
  // Accounting request id is deterministic from realm + contact and is bound
  // into the durable reservation even when the mapping already exists.
  const customerPrerequisite = action === 'save' ? {
    kind: 'customer_sync', contact_id: String(preflight.contactId),
    primary_request_id: await customerCreateRequestId(realmId, preflight.contactId, 'primary'),
  } : {};
  const reservation = await reserveQboEstimateCommand(db, { commandId, estimateId, action, actor, realmId, requestHash, prerequisite: customerPrerequisite });
  if (!reservation?.ok) return jsonResponse({ error: 'QuickBooks estimate command is already active.', code: reservation?.reason || 'command-conflict', retry_same_request: reservation?.reason === 'active-command-conflict' }, 409, request, env);

  // The committed reservation now fences line writes and terminal/conversion
  // transitions. Discard every preflight value and freeze this fresh snapshot.
  let candidate;
  try {
    const snapshot = await loadEstimateSnapshot(db, estimateId);
    if (!snapshot) throw snapshotFailure('Estimate not found', 404, 'estimate-not-found');
    candidate = buildEstimateCandidate(snapshot, input);
    if (action === 'save' && String(candidate.contactId) !== customerPrerequisite.contact_id) {
      throw snapshotFailure('Estimate contact changed while the QuickBooks command was being reserved.', 409, 'prerequisite-source-mismatch');
    }
  } catch (error) {
    const released = await releaseAfterLocalFailure(db, { commandId, estimateId });
    if (!released) return jsonResponse({ error: 'QuickBooks command cleanup did not complete. Retry the same request.', code: 'reservation-release-failed', retry_same_request: true }, 503, request, env);
    return jsonResponse({ error: error.message, code: error.code }, error.status || 400, request, env);
  }

  const { est, staged, contactId, sendTo, lines, shipAddr, memo, docNumber, expDate, providerAction, snapshot } = candidate;
  let { contact } = candidate;
  if (action === 'save') {
    if (!contact.qbo_customer_id) {
      // ensureQboCustomer may have committed in QBO even if its HTTP response
      // was lost. Never release this fence on false/throw; an exact retry uses
      // the same customer provider identity and may safely converge the mapping.
      try { await ensureQboCustomer(request, env, contactId, { expectedRealmId: realmId }); } catch { /* outcome remains unknown */ }
    }
    try { contact = (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id,name,email&limit=1`))?.[0] || null; } catch { contact = null; }
    if (!contact?.qbo_customer_id) return jsonResponse({ error: 'QuickBooks customer sync outcome is not yet known. Retry this exact estimate save.', code: 'customer-prerequisite-unknown', retry_same_request: true }, 503, request, env);
  }

  const providerPayload = action === 'save' ? {
    ...(est.qbo_estimate_id ? {} : { CustomerRef: { value: String(contact.qbo_customer_id) }, TxnStatus: 'Pending' }), Line: lines,
    PrivateNote: memo, CustomerMemo: { value: memo }, ...(docNumber ? { DocNumber: docNumber } : {}), ...(expDate ? { ExpirationDate: expDate } : {}), ...(Object.keys(shipAddr).length ? { ShipAddr: shipAddr } : {}),
  } : action === 'send' ? { id: String(est.qbo_estimate_id), send_to: sendTo } : { id: String(est.qbo_estimate_id) };
  const providerRequestId = await estimateRequestId(providerAction, estimateId, commandId);
  const intent = {
    action, provider_action: providerAction, provider_payload: providerPayload,
    provider_request_id: providerRequestId, customer_prerequisite: customerPrerequisite,
    estimate_preimage: { id: est.id, status: est.status, converted_invoice_id: est.converted_invoice_id || null, qbo_estimate_id: est.qbo_estimate_id || null },
    provider_source_preimage: providerSourcePreimage({ ...snapshot, contact }),
    document_line_preimage: staged.documentPreimage,
    document_line_preimage_hash: await hashEstimateCommand(staged.documentPreimage),
    line_change: lineChange, line_preimage: staged.preimage,
  };
  const prepared = await prepareQboEstimateCommand(db, { commandId, estimateId, action, actor, realmId, requestHash, expectedQboEstimateId: est.qbo_estimate_id || null, targetQboEstimateId: est.qbo_estimate_id || null, intent });
  if (!prepared?.ok) {
    const released = await releaseAfterLocalFailure(db, { commandId, estimateId });
    if (!released) return jsonResponse({ error: 'QuickBooks command cleanup did not complete. Retry the same request.', code: 'reservation-release-failed', retry_same_request: true }, 503, request, env);
    return jsonResponse({ error: 'QuickBooks command could not be prepared.', code: prepared?.reason || 'prepare-failed' }, 409, request, env);
  }
  const started = await startQboEstimateCommandAttempt(db, { commandId, stage: 'primary', providerAction, providerTargetId: est.qbo_estimate_id || null, providerRequestId, providerPayload });
  if (!started?.ok || started.started !== true) return startFailureResponse(db, commandId, started, request, env);
  return executeFrozenEstimateCommand({ db, env, request, commandId, action, realmId, providerAction, providerTargetId: est.qbo_estimate_id || null, providerRequestId, providerPayload, startedAt });
}
