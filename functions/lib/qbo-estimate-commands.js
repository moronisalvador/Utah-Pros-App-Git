/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-commands.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the estimate worker one consistent way to record and resume a
 *   QuickBooks action. It also checks that a retry still belongs to the same
 *   person, estimate, company, action, and request contents.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  intuit.js
 *   Data:      reads  → qbo_estimate_commands (through private functions)
 *              writes → qbo_estimate_commands,
 *                       qbo_estimate_command_reservations (through private functions)
 *
 * NOTES / GOTCHAS:
 *   - Only a verified employee browser request may supply the audit identity.
 * ════════════════════════════════════════════════
 */
import { sha256hex } from './intuit.js';

export const QBO_ESTIMATE_COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = new Set(['succeeded', 'rejected']);
const first = (value) => Array.isArray(value) ? value[0] : value;
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
export const stableEstimateJson = (value) => JSON.stringify(sorted(value));
export const hashEstimateCommand = (value) => sha256hex(stableEstimateJson(value));

export function qboEstimateActor(auth) {
  if (auth?.via !== 'bearer' || !auth.user?.id || !auth.employee?.id) {
    throw new Error('A verified browser employee is required for a QBO estimate command');
  }
  return { initiator: 'browser', authUserId: auth.user.id, employeeId: auth.employee.id };
}
export const isTerminalQboEstimateCommand = (command) => terminal.has(command?.status);
export async function getQboEstimateCommand(db, commandId) { return first(await db.rpc('get_qbo_estimate_command', { p_command_id: commandId })); }
export async function reserveQboEstimateCommand(db, { commandId, estimateId, action, actor, realmId, requestHash, prerequisite = {} }) {
  return first(await db.rpc('reserve_qbo_estimate_command', { p_command_id: commandId, p_estimate_id: estimateId, p_action: action, p_actor_auth_user_id: actor.authUserId, p_actor_employee_id: actor.employeeId, p_initiator: actor.initiator, p_realm_id: String(realmId), p_request_hash: requestHash, p_prerequisite: prerequisite }));
}
export async function releaseQboEstimateCommandReservation(db, { commandId, estimateId }) { return first(await db.rpc('release_qbo_estimate_command_reservation', { p_command_id: commandId, p_estimate_id: estimateId })); }
export async function prepareQboEstimateCommand(db, { commandId, estimateId, action, actor, realmId, requestHash, expectedQboEstimateId, targetQboEstimateId, intent }) {
  const intentHash = await hashEstimateCommand(intent);
  return { ...first(await db.rpc('prepare_qbo_estimate_command', { p_command_id: commandId, p_estimate_id: estimateId, p_action: action, p_actor_auth_user_id: actor.authUserId, p_actor_employee_id: actor.employeeId, p_initiator: actor.initiator, p_realm_id: String(realmId), p_request_hash: requestHash, p_expected_qbo_estimate_id: expectedQboEstimateId, p_target_qbo_estimate_id: targetQboEstimateId, p_intent_hash: intentHash, p_intent_payload: intent })), intentHash };
}
export async function startQboEstimateCommandAttempt(db, { commandId, stage, providerAction, providerTargetId, providerRequestId, providerPayload }) {
  return first(await db.rpc('start_qbo_estimate_command_attempt', { p_command_id: commandId, p_provider_stage: stage, p_provider_action: providerAction, p_provider_target_id: providerTargetId, p_provider_request_id: providerRequestId, p_provider_payload: providerPayload, p_provider_payload_hash: await hashEstimateCommand(providerPayload) }));
}
export async function setQboEstimateCommandState(db, { commandId, status, providerResult = null, responseStatus = null, responsePayload = null, error = null, intuitRequestId = null }) {
  return first(await db.rpc('set_qbo_estimate_command_state', { p_command_id: commandId, p_status: status, p_provider_result: providerResult, p_response_status: responseStatus, p_response_payload: responsePayload, p_error: error, p_intuit_request_id: intuitRequestId }));
}
export async function finalizeQboEstimateCommand(db, { commandId, responseStatus, responsePayload }) {
  return first(await db.rpc('finalize_qbo_estimate_command', { p_command_id: commandId, p_response_status: responseStatus, p_response_payload: responsePayload }));
}
export function qboEstimateCommandIdentityMatches(command, { estimateId, action, actor, realmId, requestHash }) {
  return !!command?.ok && String(command.estimate_id) === String(estimateId) && command.action === action && command.initiator === actor.initiator && (command.actor_auth_user_id || null) === (actor.authUserId || null) && (command.actor_employee_id || null) === (actor.employeeId || null) && String(command.realm_id) === String(realmId) && command.request_hash === requestHash;
}
