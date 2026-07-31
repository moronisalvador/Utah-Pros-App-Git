/**
 * QBO invoice command ledger (qa-staging integration).
 *
 * Uses only tagged disposable rows on the committed isolated branch, never
 * contacts QuickBooks, and proves service-only ACLs plus durable retry/CAS
 * behavior after the estimate-concurrency migration is already present.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { supabase } from '../../functions/lib/supabase.js';
import { signInFixture } from './helpers/qaFixtures.mjs';
import {
  QA_BRANCH_PROJECT_REF,
  QA_BRANCH_SENTINEL,
  assertQaBranchTarget,
} from '../../tests/qa/lib/target-policy.mjs';

const env = globalThis.process?.env || {};
const serviceKeyName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const url = env.SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || '';
const serviceKey = env[serviceKeyName] || '';
const confirmed = env.UPR_QA_CONFIRMED_QA_BRANCH === QA_BRANCH_SENTINEL;
const projectRef = (() => {
  try { return new URL(url).hostname.split('.')[0]; } catch { return ''; }
})();
const hasCreds = !!(confirmed && anonKey && serviceKey && (() => {
  try {
    assertQaBranchTarget({ mode: 'qa-branch', projectRef, supabaseUrl: url });
    return true;
  } catch {
    return false;
  }
})());

if ((url || anonKey || serviceKey || confirmed) && !hasCreds) {
  throw new Error('QBO command-ledger test refused: exact qa-staging credentials are required; production is never a test target');
}

const db = hasCreds
  ? supabase({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey })
  : null;
const digest = (value) => createHash('sha256').update(value).digest('hex');

describe.skipIf(!hasCreds)('QBO invoice command ledger (qa-staging)', () => {
  const runId = randomUUID();
  const tag = `qa-qbo-command-${runId}`;
  let admin;
  let adminAuthUserId;
  let contactId;
  let jobId;
  let invoiceId;
  const commandIds = [];

  const params = ({
    commandId,
    action = 'save',
    expected = null,
    target = 'qa-ledger-target',
    intent = { action: 'save', run: runId },
  }) => ({
    p_command_id: commandId,
    p_invoice_id: invoiceId,
    p_action: action,
    p_actor_auth_user_id: adminAuthUserId,
    p_actor_employee_id: admin.fixture.employeeId,
    p_initiator: 'browser',
    p_realm_id: 'qa-realm',
    p_expected_qbo_invoice_id: expected,
    p_target_qbo_invoice_id: target,
    p_intent_hash: digest(JSON.stringify(intent)),
    p_intent_payload: intent,
  });

  beforeAll(async () => {
    expect(projectRef).toBe(QA_BRANCH_PROJECT_REF);
    admin = await signInFixture('admin');
    adminAuthUserId = JSON.parse(
      Buffer.from(admin.token.split('.')[1], 'base64url').toString('utf8'),
    ).sub;
    expect(adminAuthUserId).toMatch(/^[0-9a-f-]{36}$/i);
    const [contact] = await db.insert('contacts', {
      name: `${tag} contact`,
      phone: `+1801${String(Date.now()).slice(-7)}`,
    });
    contactId = contact.id;
    const [job] = await db.insert('jobs', {
      job_number: `${tag}-job`,
      primary_contact_id: contactId,
      division: 'water',
      phase: 'job_received',
    });
    jobId = job.id;
    const invoice = await db.rpc('create_invoice_for_job', {
      p_job_id: jobId,
      p_created_by: null,
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    if (commandIds.length) {
      await db.delete(
        'qbo_invoice_commands',
        `id=in.(${commandIds.join(',')})`,
      ).catch(() => {});
    }
    if (invoiceId) {
      await db.delete('invoice_line_items', `invoice_id=eq.${invoiceId}`).catch(() => {});
      await db.delete('invoices', `id=eq.${invoiceId}`).catch(() => {});
    }
    if (jobId) await db.delete('system_events', `job_id=eq.${jobId}`).catch(() => {});
    if (jobId) await db.delete('jobs', `id=eq.${jobId}`).catch(() => {});
    if (contactId) await db.delete('contacts', `id=eq.${contactId}`).catch(() => {});
  });

  it('denies browser RPC execution and serializes concurrent same-intent keys', async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const intent = { action: 'delete', run: runId, case: 'already-unlinked' };
    const terminalParams = (commandId) => params({
      commandId,
      action: 'delete',
      expected: null,
      target: null,
      intent,
    });
    expect(await db.rpc('prepare_qbo_invoice_command', {
      ...terminalParams(firstId),
      p_actor_auth_user_id: null,
    })).toMatchObject({ ok: false, reason: 'invalid-command' });
    await expect(
      admin.rpc('prepare_qbo_invoice_command', terminalParams(firstId)),
    ).rejects.toMatchObject({ status: 403 });

    const results = await Promise.all([
      db.rpc('prepare_qbo_invoice_command', terminalParams(firstId)),
      db.rpc('prepare_qbo_invoice_command', terminalParams(secondId)),
    ]);
    const prepared = results.find((result) => result.prepared);
    const resumed = results.find((result) => result.resumed);
    expect(prepared).toMatchObject({ ok: true, prepared: true, status: 'prepared' });
    expect(resumed).toMatchObject({
      ok: true,
      resumed: true,
      command_id: prepared.command_id,
      status: 'prepared',
    });
    commandIds.push(prepared.command_id);

    expect(await db.rpc(
      'prepare_qbo_invoice_command',
      terminalParams(prepared.command_id),
    )).toMatchObject({
      ok: true,
      replay: true,
      command_id: prepared.command_id,
    });
    expect(await db.rpc('prepare_qbo_invoice_command', {
      ...terminalParams(prepared.command_id),
      p_intent_hash: digest(`${tag}:mismatch`),
    })).toMatchObject({ ok: false, reason: 'idempotency-key-mismatch' });
    expect(await db.rpc(
      'prepare_qbo_invoice_command',
      params({
        commandId: randomUUID(),
        intent: { action: 'send', run: runId, case: 'conflict' },
      }),
    )).toMatchObject({ ok: false, reason: 'active-command-conflict' });

    expect(await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: prepared.command_id,
      p_status: 'succeeded',
    })).toMatchObject({ ok: false, reason: 'terminal-response-required' });
    expect(await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: prepared.command_id,
      p_status: 'succeeded',
      p_response_status: 200,
      p_response_payload: { ok: true, already_unlinked: true },
    })).toMatchObject({
      ok: true,
      status: 'succeeded',
      response_status: 200,
      response_payload: { ok: true, already_unlinked: true },
    });

    const webhookId = randomUUID();
    commandIds.push(webhookId);
    expect(await db.rpc('prepare_qbo_invoice_command', {
      ...params({
        commandId: webhookId,
        intent: { action: 'save', run: runId, case: 'webhook-system' },
      }),
      p_actor_auth_user_id: null,
      p_actor_employee_id: null,
      p_initiator: 'webhook',
    })).toMatchObject({
      ok: true,
      prepared: true,
      command_id: webhookId,
    });
    await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: webhookId,
      p_status: 'rejected',
      p_error: 'qa webhook cleanup',
    });
  });

  it('replays immutable attempts, advances one definitive fallback, and persists ambiguity', async () => {
    const commandId = randomUUID();
    const intent = { action: 'save', run: runId, case: 'attempt' };
    commandIds.push(commandId);
    await db.rpc(
      'prepare_qbo_invoice_command',
      params({ commandId, intent, target: 'qa-attempt-target' }),
    );
    const providerPayload = { operation: 'Invoice', mode: 'create' };
    const started = {
      p_command_id: commandId,
      p_provider_stage: 'create',
      p_provider_action: 'create',
      p_provider_target_id: null,
      p_provider_request_id: `${tag}-create`,
      p_provider_payload: providerPayload,
      p_provider_payload_hash: digest(JSON.stringify(providerPayload)),
    };
    expect(await db.rpc(
      'start_qbo_invoice_command_attempt',
      started,
    )).toMatchObject({ ok: true, started: true, provider_target_id: null });
    expect(await db.rpc(
      'start_qbo_invoice_command_attempt',
      started,
    )).toMatchObject({ ok: true, replay: true, provider_payload: providerPayload });

    const fallbackPayload = { operation: 'Invoice', without_doc_number: true };
    const advanced = {
      p_command_id: commandId,
      p_expected_provider_stage: 'create',
      p_provider_stage: 'without-doc-number',
      p_provider_action: 'create',
      p_provider_target_id: null,
      p_provider_request_id: `${tag}-fallback`,
      p_provider_payload: fallbackPayload,
      p_provider_payload_hash: digest(JSON.stringify(fallbackPayload)),
    };
    expect(await db.rpc(
      'advance_qbo_invoice_command_attempt',
      advanced,
    )).toMatchObject({ ok: true, advanced: true, provider_stage: 'without-doc-number' });
    expect(await db.rpc(
      'advance_qbo_invoice_command_attempt',
      advanced,
    )).toMatchObject({ ok: true, replay: true, provider_payload: fallbackPayload });
    expect(await db.rpc('advance_qbo_invoice_command_attempt', {
      ...advanced,
      p_provider_stage: 'customer-relinked',
    })).toMatchObject({ ok: false, reason: 'attempt-mismatch' });

    expect(await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: commandId,
      p_status: 'ambiguous',
      p_provider_result: { timeout: true },
    })).toMatchObject({ ok: true, status: 'ambiguous' });
    expect(await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: commandId,
      p_status: 'needs_reconciliation',
      p_response_status: 202,
      p_response_payload: { queued: true },
    })).toMatchObject({ ok: true, status: 'needs_reconciliation' });
    const stored = await db.rpc('get_qbo_invoice_command', {
      p_command_id: commandId,
    });
    expect(stored).toMatchObject({
      ok: true,
      status: 'needs_reconciliation',
      provider_payload: fallbackPayload,
      provider_result: { timeout: true },
      response_status: 202,
    });
    await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: commandId,
      p_status: 'rejected',
      p_error: 'qa cleanup',
    });
  });

  it('resumes provider success before and after CAS and rejects a third local link', async () => {
    const commandId = randomUUID();
    const intent = { action: 'save', run: runId, case: 'cas-recovery' };
    const target = `${tag}-qbo-1`;
    commandIds.push(commandId);
    await db.rpc(
      'prepare_qbo_invoice_command',
      params({ commandId, intent, expected: null, target }),
    );
    const payload = { operation: 'Invoice', mode: 'create' };
    await db.rpc('start_qbo_invoice_command_attempt', {
      p_command_id: commandId,
      p_provider_stage: 'create',
      p_provider_action: 'create',
      p_provider_target_id: null,
      p_provider_request_id: `${tag}-cas`,
      p_provider_payload: payload,
      p_provider_payload_hash: digest(JSON.stringify(payload)),
    });
    await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: commandId,
      p_status: 'provider_succeeded',
      p_provider_result: { local_target_qbo_invoice_id: target },
    });
    expect(await db.rpc(
      'prepare_qbo_invoice_command',
      params({ commandId: randomUUID(), intent, expected: null, target }),
    )).toMatchObject({ ok: true, resumed: true, command_id: commandId });

    const linked = await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: null,
      p_new_qbo_invoice_id: target,
      p_qbo_doc_number: `${tag}-DOC`,
    });
    expect(linked).toMatchObject({ ok: true, qbo_invoice_id: target });
    expect(await db.rpc(
      'prepare_qbo_invoice_command',
      params({ commandId: randomUUID(), intent, expected: null, target }),
    )).toMatchObject({ ok: true, resumed: true, command_id: commandId });
    expect(await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: null,
      p_new_qbo_invoice_id: target,
    })).toMatchObject({ ok: true, qbo_invoice_id: target, idempotent: true });

    await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: target,
      p_new_qbo_invoice_id: `${tag}-third`,
    });
    expect(await db.rpc(
      'prepare_qbo_invoice_command',
      params({ commandId: randomUUID(), intent, expected: null, target }),
    )).toMatchObject({
      ok: false,
      reason: 'provider-result-link-mismatch',
      command_id: commandId,
    });
    await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: commandId,
      p_status: 'needs_reconciliation',
    });
    await db.rpc('set_qbo_invoice_command_state', {
      p_command_id: commandId,
      p_status: 'rejected',
      p_error: 'qa third-link cleanup',
    });
    await db.rpc('cas_qbo_invoice_link', {
      p_invoice_id: invoiceId,
      p_expected_qbo_invoice_id: `${tag}-third`,
      p_new_qbo_invoice_id: null,
    });
  });
});
