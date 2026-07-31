/**
 * ════════════════════════════════════════════════
 * FILE: qbo-invoice-commands.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Wraps the private, service-role-only database ledger that freezes every
 *   QuickBooks invoice command before the provider call. Retries therefore use
 *   the original target, recipient, payload, and Accounting request id even
 *   after a browser tab or native iOS process is restarted.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./intuit.js
 *   Data:      reads/writes → qbo_invoice_commands through service-only RPCs
 *
 * NOTES / GOTCHAS:
 *   - Browser identity is audit context only. Authorization remains in the
 *     Worker before any ledger or provider access.
 *   - JSON is sorted recursively before hashing so a Postgres jsonb readback
 *     cannot change an operation fingerprint merely by reordering keys.
 * ════════════════════════════════════════════════
 */

import { sha256hex } from './intuit.js';

export const QBO_COMMAND_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_STATUSES = new Set(['succeeded', 'rejected']);

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function stableJsonStringify(value) {
  return JSON.stringify(sortJson(value));
}

export function qboCommandActor(auth) {
  if (auth?.via === 'bearer' || auth?.user?.id) {
    return {
      initiator: 'browser',
      authUserId: auth?.user?.id || null,
      employeeId: auth?.employee?.id || null,
    };
  }
  return { initiator: 'webhook', authUserId: null, employeeId: null };
}

function rpcObject(value) {
  return Array.isArray(value) ? value[0] : value;
}

export async function hashQboCommandPayload(payload) {
  return sha256hex(stableJsonStringify(payload));
}

export async function getQboInvoiceCommand(db, commandId) {
  return rpcObject(await db.rpc('get_qbo_invoice_command', {
    p_command_id: commandId,
  }));
}

export function qboCommandIdentityMatches(command, {
  invoiceId,
  action,
  actor,
  realmId,
}) {
  if (!command?.ok) return false;
  return String(command.invoice_id) === String(invoiceId)
    && command.action === action
    && command.initiator === actor.initiator
    && (command.actor_auth_user_id || null) === (actor.authUserId || null)
    && (command.actor_employee_id || null) === (actor.employeeId || null)
    && String(command.realm_id) === String(realmId);
}

export async function prepareQboInvoiceCommand(db, {
  commandId,
  invoiceId,
  action,
  actor,
  realmId,
  expectedQboInvoiceId,
  targetQboInvoiceId,
  intent,
}) {
  const intentHash = await hashQboCommandPayload(intent);
  const result = rpcObject(await db.rpc('prepare_qbo_invoice_command', {
    p_command_id: commandId,
    p_invoice_id: invoiceId,
    p_action: action,
    p_actor_auth_user_id: actor.authUserId,
    p_actor_employee_id: actor.employeeId,
    p_initiator: actor.initiator,
    p_realm_id: String(realmId),
    p_expected_qbo_invoice_id: expectedQboInvoiceId,
    p_target_qbo_invoice_id: targetQboInvoiceId,
    p_intent_hash: intentHash,
    p_intent_payload: intent,
  }));
  return { ...result, intentHash };
}

export async function startQboInvoiceCommandAttempt(db, {
  commandId,
  stage,
  providerAction,
  providerTargetId,
  providerRequestId,
  providerPayload,
}) {
  const providerPayloadHash = await hashQboCommandPayload(providerPayload);
  return rpcObject(await db.rpc('start_qbo_invoice_command_attempt', {
    p_command_id: commandId,
    p_provider_stage: stage,
    p_provider_action: providerAction,
    p_provider_target_id: providerTargetId,
    p_provider_request_id: providerRequestId,
    p_provider_payload: providerPayload,
    p_provider_payload_hash: providerPayloadHash,
  }));
}

export async function advanceQboInvoiceCommandAttempt(db, {
  commandId,
  expectedStage,
  stage,
  providerAction,
  providerTargetId,
  providerRequestId,
  providerPayload,
}) {
  const providerPayloadHash = await hashQboCommandPayload(providerPayload);
  return rpcObject(await db.rpc('advance_qbo_invoice_command_attempt', {
    p_command_id: commandId,
    p_expected_provider_stage: expectedStage,
    p_provider_stage: stage,
    p_provider_action: providerAction,
    p_provider_target_id: providerTargetId,
    p_provider_request_id: providerRequestId,
    p_provider_payload: providerPayload,
    p_provider_payload_hash: providerPayloadHash,
  }));
}

export async function setQboInvoiceCommandState(db, {
  commandId,
  status,
  providerResult = null,
  responseStatus = null,
  responsePayload = null,
  error = null,
  intuitRequestId = null,
}) {
  return rpcObject(await db.rpc('set_qbo_invoice_command_state', {
    p_command_id: commandId,
    p_status: status,
    p_provider_result: providerResult,
    p_response_status: responseStatus,
    p_response_payload: responsePayload,
    p_error: error,
    p_intuit_request_id: intuitRequestId,
  }));
}

export function isTerminalQboInvoiceCommand(command) {
  return TERMINAL_STATUSES.has(command?.status);
}
