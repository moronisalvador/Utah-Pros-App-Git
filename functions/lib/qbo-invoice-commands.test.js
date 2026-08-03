/**
 * Unit coverage for the private QBO invoice command-ledger adapter.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  advanceQboInvoiceCommandAttempt,
  hashQboCommandPayload,
  prepareQboInvoiceCommand,
  qboCommandActor,
  qboCommandIdentityMatches,
  stableJsonStringify,
  startQboInvoiceCommandAttempt,
} from './qbo-invoice-commands.js';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = '22222222-2222-4222-8222-222222222222';

describe('QBO invoice command ledger adapter', () => {
  it('canonicalizes nested JSON before hashing', async () => {
    const a = { z: [{ b: 2, a: 1 }], a: true };
    const b = { a: true, z: [{ a: 1, b: 2 }] };
    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b));
    await expect(hashQboCommandPayload(a)).resolves.toBe(
      await hashQboCommandPayload(b),
    );
  });

  it('derives audit identity from the trusted authorization result', () => {
    const browser = qboCommandActor({
      via: 'bearer',
      user: { id: 'user-1' },
      employee: { id: 'employee-1' },
    });
    expect(browser).toEqual({
      initiator: 'browser',
      authUserId: 'user-1',
      employeeId: 'employee-1',
    });
    expect(qboCommandActor({ via: 'webhook' })).toEqual({
      initiator: 'webhook',
      authUserId: null,
      employeeId: null,
    });
  });

  it('rejects a command row from another actor, invoice, action, or realm', () => {
    const actor = { initiator: 'browser', authUserId: 'u1', employeeId: 'e1' };
    const row = {
      ok: true,
      invoice_id: INVOICE_ID,
      action: 'save',
      initiator: 'browser',
      actor_auth_user_id: 'u1',
      actor_employee_id: 'e1',
      realm_id: 'realm-1',
    };
    expect(qboCommandIdentityMatches(row, {
      invoiceId: INVOICE_ID,
      action: 'save',
      actor,
      realmId: 'realm-1',
    })).toBe(true);
    expect(qboCommandIdentityMatches({ ...row, actor_auth_user_id: 'u2' }, {
      invoiceId: INVOICE_ID,
      action: 'save',
      actor,
      realmId: 'realm-1',
    })).toBe(false);
  });

  it('passes immutable intent and attempt hashes to the service-only RPCs', async () => {
    const db = { rpc: vi.fn(async (name) => ({ ok: true, name })) };
    const actor = { initiator: 'browser', authUserId: 'u1', employeeId: 'e1' };
    const intent = { action: 'save', payload: { Line: [{ Amount: 100 }] } };

    await prepareQboInvoiceCommand(db, {
      commandId: COMMAND_ID,
      invoiceId: INVOICE_ID,
      action: 'save',
      actor,
      realmId: 'realm-1',
      expectedQboInvoiceId: null,
      targetQboInvoiceId: null,
      intent,
    });
    const prepare = db.rpc.mock.calls[0];
    expect(prepare[0]).toBe('prepare_qbo_invoice_command');
    expect(prepare[1]).toMatchObject({
      p_command_id: COMMAND_ID,
      p_invoice_id: INVOICE_ID,
      p_intent_payload: intent,
      p_intent_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await startQboInvoiceCommandAttempt(db, {
      commandId: COMMAND_ID,
      stage: 'primary',
      providerAction: 'create',
      providerTargetId: null,
      providerRequestId: 'upr-i-c-safe',
      providerPayload: intent.payload,
    });
    expect(db.rpc.mock.calls[1][0]).toBe('start_qbo_invoice_command_attempt');
    expect(db.rpc.mock.calls[1][1]).toMatchObject({
      p_provider_target_id: null,
      p_provider_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await advanceQboInvoiceCommandAttempt(db, {
      commandId: COMMAND_ID,
      expectedStage: 'primary',
      stage: 'without-online-pay',
      providerAction: 'create',
      providerTargetId: null,
      providerRequestId: 'upr-i-c-safe-fallback',
      providerPayload: { Line: [] },
    });
    expect(db.rpc.mock.calls[2][0]).toBe('advance_qbo_invoice_command_attempt');
    expect(db.rpc.mock.calls[2][1].p_expected_provider_stage).toBe('primary');
  });
});
