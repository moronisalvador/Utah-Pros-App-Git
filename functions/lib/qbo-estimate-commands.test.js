/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-commands.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that estimate request records use stable content and exact database
 *   argument names. It also proves that an unverified caller cannot become the
 *   employee recorded for a QuickBooks action.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-estimate-commands.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Database calls are local test doubles; no Supabase project is contacted.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

import {
  finalizeQboEstimateCommand,
  hashEstimateCommand,
  isTerminalQboEstimateCommand,
  prepareQboEstimateCommand,
  qboEstimateActor,
  qboEstimateCommandIdentityMatches,
  reserveQboEstimateCommand,
  setQboEstimateCommandState,
  stableEstimateJson,
  startQboEstimateCommandAttempt,
} from './qbo-estimate-commands.js';

const COMMAND = '11111111-1111-4111-8111-111111111111';
const ESTIMATE = '22222222-2222-4222-8222-222222222222';
const actor = { initiator: 'browser', authUserId: 'user-1', employeeId: 'employee-1' };

describe('QBO estimate command adapter', () => {
  it('canonicalizes nested payload keys before hashing', async () => {
    const a = { z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, z: [{ a: 1, b: 2 }] };
    expect(stableEstimateJson(a)).toBe(stableEstimateJson(b));
    await expect(hashEstimateCommand(a)).resolves.toBe(await hashEstimateCommand(b));
  });

  it('accepts only a verified browser employee as the audit actor', () => {
    expect(qboEstimateActor({ via: 'bearer', user: { id: 'user-1' }, employee: { id: 'employee-1' } })).toEqual(actor);
    expect(() => qboEstimateActor({ via: 'webhook' })).toThrow(/verified browser employee/);
    expect(() => qboEstimateActor({ via: 'bearer', user: { id: 'user-1' } })).toThrow(/verified browser employee/);
  });

  it('treats only succeeded and rejected commands as terminal', () => {
    expect(isTerminalQboEstimateCommand({ status: 'succeeded' })).toBe(true);
    expect(isTerminalQboEstimateCommand({ status: 'rejected' })).toBe(true);
    for (const status of ['prepared', 'provider_started', 'ambiguous', 'provider_succeeded', 'needs_reconciliation']) {
      expect(isTerminalQboEstimateCommand({ status })).toBe(false);
    }
  });

  it('rejects identity changes across estimate, action, actor, realm, or sanitized request content', () => {
    const identity = { estimateId: ESTIMATE, action: 'save', actor, realmId: 'realm-1', requestHash: 'a'.repeat(64) };
    const row = { ok: true, estimate_id: ESTIMATE, action: 'save', initiator: 'browser', actor_auth_user_id: 'user-1', actor_employee_id: 'employee-1', realm_id: 'realm-1', request_hash: identity.requestHash };
    expect(qboEstimateCommandIdentityMatches(row, identity)).toBe(true);
    expect(qboEstimateCommandIdentityMatches({ ...row, estimate_id: 'other' }, identity)).toBe(false);
    expect(qboEstimateCommandIdentityMatches({ ...row, actor_employee_id: 'employee-2' }, identity)).toBe(false);
    expect(qboEstimateCommandIdentityMatches({ ...row, realm_id: 'realm-2' }, identity)).toBe(false);
    expect(qboEstimateCommandIdentityMatches({ ...row, request_hash: 'b'.repeat(64) }, identity)).toBe(false);
  });

  it('maps the durable customer prerequisite exactly into reservation RPC params', async () => {
    const db = { rpc: vi.fn(async () => ({ ok: true })) };
    const prerequisite = { kind: 'customer_sync', contact_id: 'contact-1', primary_request_id: 'upr-c-safe' };
    const requestHash = 'a'.repeat(64);
    await reserveQboEstimateCommand(db, { commandId: COMMAND, estimateId: ESTIMATE, action: 'save', actor, realmId: 'realm-1', requestHash, prerequisite });
    expect(db.rpc).toHaveBeenCalledWith('reserve_qbo_estimate_command', {
      p_command_id: COMMAND, p_estimate_id: ESTIMATE, p_action: 'save',
      p_actor_auth_user_id: 'user-1', p_actor_employee_id: 'employee-1',
      p_initiator: 'browser', p_realm_id: 'realm-1', p_request_hash: requestHash,
      p_prerequisite: prerequisite,
    });
  });

  it('hashes and maps the exact frozen intent and provider attempt', async () => {
    const db = { rpc: vi.fn(async () => ({ ok: true })) };
    const intent = { action: 'save', provider_payload: { Line: [{ Amount: 100 }] } };
    const requestHash = 'a'.repeat(64);
    await prepareQboEstimateCommand(db, { commandId: COMMAND, estimateId: ESTIMATE, action: 'save', actor, realmId: 'realm-1', requestHash, expectedQboEstimateId: null, targetQboEstimateId: null, intent });
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'prepare_qbo_estimate_command', expect.objectContaining({
      p_command_id: COMMAND, p_estimate_id: ESTIMATE, p_request_hash: requestHash,
      p_intent_payload: intent,
      p_intent_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    await startQboEstimateCommandAttempt(db, { commandId: COMMAND, stage: 'primary', providerAction: 'create', providerTargetId: null, providerRequestId: 'upr-e-safe', providerPayload: intent.provider_payload });
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'start_qbo_estimate_command_attempt', expect.objectContaining({
      p_command_id: COMMAND, p_provider_request_id: 'upr-e-safe',
      p_provider_payload: intent.provider_payload,
      p_provider_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('maps provider state and exact terminal response into service-only RPCs', async () => {
    const db = { rpc: vi.fn(async () => [{ ok: true }]) };
    await setQboEstimateCommandState(db, { commandId: COMMAND, status: 'provider_succeeded', providerResult: { qbo_estimate_id: 'qbo-1' } });
    await finalizeQboEstimateCommand(db, { commandId: COMMAND, responseStatus: 200, responsePayload: { ok: true, qbo_estimate_id: 'qbo-1' } });
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'set_qbo_estimate_command_state', expect.objectContaining({ p_command_id: COMMAND, p_status: 'provider_succeeded', p_provider_result: { qbo_estimate_id: 'qbo-1' } }));
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'finalize_qbo_estimate_command', { p_command_id: COMMAND, p_response_status: 200, p_response_payload: { ok: true, qbo_estimate_id: 'qbo-1' } });
  });
});
