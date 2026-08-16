/**
 * Unit coverage for the private QBO invoice command-ledger adapter.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  advanceQboInvoiceCommandAttempt,
  finalizeQboInvoiceLineUpdate,
  finalizeQboInvoiceLineChange,
  hashQboCommandPayload,
  prepareQboInvoiceCommand,
  qboCommandActor,
  qboCommandIdentityMatches,
  releaseQboInvoiceCommandReservation,
  reserveQboInvoiceCommand,
  stageQboInvoiceLineUpdate,
  stageQboInvoiceLineChange,
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

  it('reserves before intent work and releases only an explicitly safe local rejection', async () => {
    const db = { rpc: vi.fn(async (name) => ({ ok: true, name })) };
    await reserveQboInvoiceCommand(db, {
      commandId: COMMAND_ID,
      invoiceId: INVOICE_ID,
      action: 'save',
      actor: { initiator: 'browser', authUserId: 'u1', employeeId: 'e1' },
      realmId: 'realm-1',
    });
    await releaseQboInvoiceCommandReservation(db, {
      commandId: COMMAND_ID,
      invoiceId: INVOICE_ID,
    });
    expect(db.rpc.mock.calls).toEqual([
      ['reserve_qbo_invoice_command', {
        p_command_id: COMMAND_ID, p_invoice_id: INVOICE_ID, p_action: 'save',
        p_actor_auth_user_id: 'u1', p_actor_employee_id: 'e1',
        p_initiator: 'browser', p_realm_id: 'realm-1',
      }],
      ['release_qbo_invoice_command_reservation', {
        p_command_id: COMMAND_ID, p_invoice_id: INVOICE_ID,
      }],
    ]);
  });

  it('passes the same authorized safe patch to service-only staging and finalization RPCs', async () => {
    const db = { rpc: vi.fn(async (name) => ({ ok: true, name })) };
    const actor = { initiator: 'browser', authUserId: 'u1', employeeId: 'e1' };
    const lineUpdate = {
      line_id: '33333333-3333-4333-8333-333333333333', description: 'Labor',
      qbo_item_id: 'item-1', qbo_item_name: 'Labor', qbo_class_id: null,
      qbo_class_name: null, quantity: 2, unit_price: 125.5,
    };
    const args = { commandId: COMMAND_ID, invoiceId: INVOICE_ID, actor, realmId: 'realm-1', lineUpdate };
    await stageQboInvoiceLineUpdate(db, args);
    await finalizeQboInvoiceLineUpdate(db, args);
    const expectedParams = {
      p_command_id: COMMAND_ID, p_invoice_id: INVOICE_ID, p_line_id: lineUpdate.line_id,
      p_actor_auth_user_id: 'u1', p_actor_employee_id: 'e1', p_initiator: 'browser', p_realm_id: 'realm-1',
      p_description: 'Labor', p_qbo_item_id: 'item-1', p_qbo_item_name: 'Labor',
      p_qbo_class_id: null, p_qbo_class_name: null, p_quantity: 2, p_unit_price: 125.5,
    };
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'stage_qbo_invoice_line_update', expectedParams);
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'finalize_qbo_invoice_line_update', expectedParams);
  });

  it('keeps create/delete/reorder inside one service-only document operation contract', async () => {
    const db = { rpc: vi.fn(async () => ({ ok: true })) };
    const actor = { initiator: 'browser', authUserId: 'u1', employeeId: 'e1' };
    const lineChange = { kind: 'create', patch: { description: 'Labor', qbo_item_id: 'item-1', qbo_item_name: 'Labor', qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 100 } };
    const args = { commandId: COMMAND_ID, invoiceId: INVOICE_ID, actor, realmId: 'realm-1', lineChange };
    await stageQboInvoiceLineChange(db, args);
    await finalizeQboInvoiceLineChange(db, args);
    const expected = { p_command_id: COMMAND_ID, p_invoice_id: INVOICE_ID, p_actor_auth_user_id: 'u1', p_actor_employee_id: 'e1', p_initiator: 'browser', p_realm_id: 'realm-1', p_line_change: lineChange };
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'stage_qbo_invoice_line_change', expected);
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'finalize_qbo_invoice_line_change', expected);
  });
});
