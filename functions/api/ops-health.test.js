import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(async () => undefined),
}));
vi.mock('./notify.js', () => ({ dispatchEvent: vi.fn(async () => ({ recipients: 2 })) }));

import { onRequestPost, runOpsHealth } from './ops-health.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const NOW = new Date('2026-07-25T18:00:00.000Z');
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();

const CRON_SECRET = 'cron-secret';

/**
 * A fake PostgREST client. `tables` maps table name → rows; every select is
 * filtered only by the bits these tests actually depend on.
 */
function makeDb({ tables = {}, secret = CRON_SECRET, failTable = null, opsRecipients = null } = {}) {
  const inserts = [];
  return {
    inserts,
    select: vi.fn(async (table, query = '') => {
      if (table === 'integration_config') {
        // Key-aware: the worker reads BOTH the cron secret and the ops recipient
        // list from this table. A blanket return hands the secret back as a
        // recipient id, which would silently reduce the audience to nobody.
        if (/key=eq\.ops_health_recipient_ids/.test(query)) {
          return opsRecipients === null ? [] : [{ value: opsRecipients }];
        }
        return secret ? [{ value: secret }] : [];
      }
      if (table === failTable) throw new Error('probe exploded');
      if (table === 'message_provider_events') {
        const state = /processing_state=eq\.(\w+)/.exec(query)?.[1];
        return (tables.message_provider_events || []).filter((r) => r.processing_state === state);
      }
      return tables[table] || [];
    }),
    insert: vi.fn(async (table, row) => { inserts.push({ table, row }); return [row]; }),
  };
}

const headers = (secret) => ({ get: (name) => (name === 'x-webhook-secret' ? secret : null) });

beforeEach(() => {
  vi.clearAllMocks();
  h.db = makeDb();
});

describe('ops-health route — authorization', () => {
  it('rejects a caller with no cron secret', async () => {
    const res = await onRequestPost({ request: { headers: headers(null) }, env: {} });
    expect(res.status).toBe(401);
    expect(h.db.insert).not.toHaveBeenCalled();
  });

  it('rejects a caller presenting the wrong cron secret', async () => {
    const res = await onRequestPost({ request: { headers: headers('wrong') }, env: {} });
    expect(res.status).toBe(401);
  });

  it('runs once the cron secret matches', async () => {
    const res = await onRequestPost({ request: { headers: headers(CRON_SECRET) }, env: {} });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
  });
});

describe('ops-health run — quiet system', () => {
  it('raises nothing and still records telemetry when all is well', async () => {
    const result = await runOpsHealth(h.db, {}, { now: NOW });
    expect(result.conditions).toBe(0);
    expect(result.raised).toEqual([]);
    expect(recordWorkerRun).toHaveBeenCalledWith(h.db, expect.objectContaining({
      workerName: 'ops-health',
      status: 'completed',
    }));
  });

  it('writes no dedupe marker when there is nothing to report', async () => {
    await runOpsHealth(h.db, {}, { now: NOW });
    expect(h.db.inserts.filter((i) => i.table === 'system_events')).toHaveLength(0);
  });
});

describe('ops-health run — alerting', () => {
  const failedEvent = {
    id: 'e1',
    processing_state: 'failed',
    direction: 'inbound',
    message_type: 'mms',
    error_code: 'CALLRAIL_MMS_URL_REFRESH_FAILED',
    sender_address: '385-314-5700',
    recipient_address: '385-360-4121',
    media_count: 1,
    owned_media: [],
  };

  it('dispatches an alert that names the sender', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 2 }));
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(result.raised).toEqual([{ condition: 'provider_events_failed', recipients: 2 }]);
    const body = dispatchImpl.mock.calls[0][0].body;
    expect(body.body).toContain('385-314-5700');
    expect(body.title).toContain('Ops alert');
  });

  it('emits through the internal notification type, never a customer channel', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });

    await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(dispatchImpl.mock.calls[0][0].typeKey).toBe('ops.health');
  });

  it('sends ops alerts only to the configured recipients', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    const OWNER = 'd1d37f3c-2de5-4d8c-b5a8-f7b87e93d2da';
    h.db = makeDb({
      tables: { message_provider_events: [failedEvent] },
      opsRecipients: `["${OWNER}"]`,
    });

    await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(dispatchImpl.mock.calls[0][0].body.recipient_ids).toEqual([OWNER]);
  });

  it('accepts a comma-separated recipient list and de-duplicates it', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({
      tables: { message_provider_events: [failedEvent] },
      opsRecipients: ' aaa , bbb ,aaa ',
    });

    await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(dispatchImpl.mock.calls[0][0].body.recipient_ids).toEqual(['aaa', 'bbb']);
  });

  it('omits recipient_ids entirely when unconfigured, keeping the role audience', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });

    await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    // Absent, not empty — an empty array would fall through resolveAudience's
    // length check anyway, but omitting is the unambiguous contract.
    expect('recipient_ids' in dispatchImpl.mock.calls[0][0].body).toBe(false);
  });

  it('never treats the cron secret as a recipient id', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });

    await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(dispatchImpl.mock.calls[0][0].body.recipient_ids).toBeUndefined();
  });

  it('records a dedupe marker after a successful dispatch', async () => {
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });
    await runOpsHealth(h.db, {}, { now: NOW });

    const markers = h.db.inserts.filter((i) => i.table === 'system_events');
    expect(markers).toHaveLength(1);
    // condition:denverDate:fingerprint — the fingerprint keys suppression to the
    // distinct failure classes, so a NEW failure later the same day still rings.
    expect(markers[0].row.payload.dedupe_key)
      .toMatch(/^provider_events_failed:2026-07-25:[0-9a-f]{8}$/);
  });

  it('suppresses a condition already alerted today', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));

    // Take the key from a real recording run rather than hardcoding it, so this
    // test proves the reader and the writer agree on the key shape.
    const seeding = makeDb({ tables: { message_provider_events: [failedEvent] } });
    await runOpsHealth(seeding, {}, { now: NOW });
    const recordedKey = seeding.inserts
      .find((i) => i.table === 'system_events').row.payload.dedupe_key;

    h.db = makeDb({
      tables: {
        message_provider_events: [failedEvent],
        system_events: [{ payload: { dedupe_key: recordedKey } }],
      },
    });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(dispatchImpl).not.toHaveBeenCalled();
    expect(result.suppressed).toContain('provider_events_failed');
    expect(result.raised).toEqual([]);
  });

  it('does NOT burn the dedupe slot when the notification type is disabled', async () => {
    const dispatchImpl = vi.fn(async () => ({ skipped: true, reason: 'type_disabled' }));
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(result.raised).toEqual([]);
    expect(result.suppressed).toContain('provider_events_failed:type_disabled');
    expect(h.db.inserts.filter((i) => i.table === 'system_events')).toHaveLength(0);
  });

  it('survives a dispatch that throws, without claiming the dedupe slot', async () => {
    const dispatchImpl = vi.fn(async () => { throw new Error('notify down'); });
    h.db = makeDb({ tables: { message_provider_events: [failedEvent] } });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });

    expect(result.raised).toEqual([]);
    expect(h.db.inserts.filter((i) => i.table === 'system_events')).toHaveLength(0);
  });

  it('alerts on a stuck retryable event past its next attempt', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({
      tables: {
        message_provider_events: [{
          id: 'r1',
          processing_state: 'retryable',
          direction: 'inbound',
          sender_address: '385-314-5700',
          processing_attempts: 4,
          next_attempt_at: minutesAgo(45),
        }],
      },
    });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });
    expect(result.raised.map((r) => r.condition)).toContain('provider_events_stuck');
  });

  it('alerts on recent worker errors grouped by worker', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({
      tables: {
        worker_runs: [
          { worker_name: 'callrail-text-webhook', status: 'error', started_at: minutesAgo(10), error_message: 'INVALID_CALLRAIL_SIGNATURE' },
          { worker_name: 'callrail-text-webhook', status: 'error', started_at: minutesAgo(20), error_message: 'INVALID_CALLRAIL_SIGNATURE' },
        ],
      },
    });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });
    expect(result.raised.map((r) => r.condition)).toContain('worker_errors');
    expect(dispatchImpl.mock.calls[0][0].body.body).toContain('callrail-text-webhook ×2');
  });

  it('alerts on an automation claim that was never finalized', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({
      tables: {
        fixed_automation_claims: [{
          id: 'c1',
          automation_key: 'missed_call_textback',
          entity_type: 'call',
          entity_id: 'abc',
          claimed_at: minutesAgo(120),
          finalized_at: null,
        }],
      },
    });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });
    expect(result.raised.map((r) => r.condition)).toContain('unfinalized_claims');
  });
});

describe('ops-health run — probe resilience', () => {
  it('reports a failed probe as an error run rather than a clean bill of health', async () => {
    h.db = makeDb({ failTable: 'worker_runs' });
    const result = await runOpsHealth(h.db, {}, { now: NOW });

    expect(result.success).toBe(false);
    expect(result.probeErrors).toContain('worker_runs');
    expect(recordWorkerRun).toHaveBeenCalledWith(h.db, expect.objectContaining({ status: 'error' }));
  });

  it('still evaluates the probes that did succeed', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({
      failTable: 'worker_runs',
      tables: {
        fixed_automation_claims: [{
          id: 'c1', automation_key: 'k', entity_type: 'call', entity_id: 'a',
          claimed_at: minutesAgo(120), finalized_at: null,
        }],
      },
    });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });
    expect(result.raised.map((r) => r.condition)).toContain('unfinalized_claims');
  });

  it('alerts rather than staying silent when the dedupe lookup itself fails', async () => {
    const dispatchImpl = vi.fn(async () => ({ recipients: 1 }));
    h.db = makeDb({
      failTable: 'system_events',
      tables: {
        message_provider_events: [{
          id: 'e1', processing_state: 'failed', error_code: 'X', sender_address: '1',
        }],
      },
    });

    const result = await runOpsHealth(h.db, {}, { now: NOW, dispatchImpl });
    expect(result.raised.map((r) => r.condition)).toContain('provider_events_failed');
  });
});
