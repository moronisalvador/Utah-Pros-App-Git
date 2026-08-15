import { describe, it, expect } from 'vitest';
import {
  OPS_HEALTH_CONDITIONS,
  DEFAULT_OPS_HEALTH_THRESHOLDS,
  describeParty,
  summarizeWorkerError,
  evaluateOpsHealth,
  buildDedupeKey,
} from './ops-health.js';

// Anchor every fixture to a fixed instant — no wall-clock reads in assertions.
const NOW = '2026-07-25T18:00:00.000Z';
const minutesAgo = (n) => new Date(Date.parse(NOW) - n * 60_000).toISOString();
const minutesAhead = (n) => new Date(Date.parse(NOW) + n * 60_000).toISOString();

const keyOf = (result, key) => result.conditions.find((c) => c.key === key);

describe('describeParty', () => {
  it('renders an inbound identity with the direction arrow', () => {
    expect(describeParty({
      direction: 'inbound',
      sender_address: '385-314-5700',
      recipient_address: '385-360-4121',
    })).toBe('385-314-5700 ← 385-360-4121');
  });

  it('renders an outbound identity with the direction arrow', () => {
    expect(describeParty({
      direction: 'outbound',
      sender_address: '385-360-4121',
      recipient_address: '385-314-5700',
    })).toBe('385-360-4121 → 385-314-5700');
  });

  it('falls back to the provider message id rather than an anonymous count', () => {
    expect(describeParty({ provider_message_id: 'SCI019f9432' })).toBe('SCI019f9432');
  });

  it('never returns an empty description', () => {
    expect(describeParty({})).toBe('unknown party');
    expect(describeParty()).toBe('unknown party');
  });
});

describe('evaluateOpsHealth — all clear', () => {
  it('returns zero conditions when nothing is wrong', () => {
    const result = evaluateOpsHealth({ now: NOW });
    expect(result.conditions).toEqual([]);
    expect(result.checkedAt).toBe(NOW);
  });
});

describe('condition 1 — failed provider events', () => {
  // Shaped from the five real rows found in production on 2026-07-24.
  const failed = [{
    id: 'e69e002f',
    direction: 'inbound',
    message_type: 'mms',
    error_code: 'CALLRAIL_MMS_URL_REFRESH_FAILED',
    sender_address: '385-314-5700',
    recipient_address: '385-360-4121',
    media_count: 1,
    owned_media: [],
  }];

  it('fires and names the sender so triage does not need a query', () => {
    const c = keyOf(evaluateOpsHealth({ now: NOW, failedEvents: failed }),
      OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED);
    expect(c.count).toBe(1);
    expect(c.body).toContain('385-314-5700');
    expect(c.body).toContain('CALLRAIL_MMS_URL_REFRESH_FAILED');
  });

  it('flags media that was counted but never captured', () => {
    const c = keyOf(evaluateOpsHealth({ now: NOW, failedEvents: failed }),
      OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED);
    expect(c.body).toContain('[media LOST]');
  });

  it('does not flag media loss when media was captured', () => {
    const c = keyOf(evaluateOpsHealth({
      now: NOW,
      failedEvents: [{ ...failed[0], owned_media: ['upr-storage://x'] }],
    }), OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED);
    expect(c.body).not.toContain('[media LOST]');
  });

  it('caps the detail list and reports the remainder', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...failed[0], id: `e${i}` }));
    const c = keyOf(evaluateOpsHealth({ now: NOW, failedEvents: many }),
      OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED);
    expect(c.count).toBe(9);
    expect(c.details).toHaveLength(6); // 5 shown + 1 summary line
    expect(c.details.at(-1)).toBe('…and 4 more');
  });
});

describe('condition 2 — stuck retryable events (the STOP signature)', () => {
  const stuck = (nextAttemptAt) => ([{
    id: 'stuck-1',
    direction: 'inbound',
    sender_address: '385-314-5700',
    recipient_address: '385-360-4121',
    processing_attempts: 3,
    next_attempt_at: nextAttemptAt,
  }]);

  it('fires once an event is overdue past the threshold', () => {
    const c = keyOf(evaluateOpsHealth({ now: NOW, retryableEvents: stuck(minutesAgo(45)) }),
      OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK);
    expect(c.count).toBe(1);
    expect(c.severity).toBe('critical');
    expect(c.body).toContain('45 min overdue');
    expect(c.body).toContain('385-314-5700');
  });

  it('stays quiet for an event that is merely due, not overdue', () => {
    const result = evaluateOpsHealth({ now: NOW, retryableEvents: stuck(minutesAgo(5)) });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK)).toBeUndefined();
  });

  it('stays quiet for an event whose retry is still in the future', () => {
    const result = evaluateOpsHealth({ now: NOW, retryableEvents: stuck(minutesAhead(10)) });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK)).toBeUndefined();
  });

  it('ignores a row with no scheduled next attempt', () => {
    const result = evaluateOpsHealth({ now: NOW, retryableEvents: stuck(null) });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK)).toBeUndefined();
  });

  it('honours an overridden threshold', () => {
    const result = evaluateOpsHealth({
      now: NOW,
      retryableEvents: stuck(minutesAgo(20)),
      thresholds: { stuckRetryableMinutes: 60 },
    });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK)).toBeUndefined();
  });
});

describe('condition 3 — worker errors grouped by worker', () => {
  const errors = [
    { worker_name: 'callrail-text-webhook', started_at: minutesAgo(5), error_message: 'INVALID_CALLRAIL_SIGNATURE' },
    { worker_name: 'callrail-text-webhook', started_at: minutesAgo(20), error_message: 'INVALID_CALLRAIL_SIGNATURE' },
    { worker_name: 'transcribe-call', started_at: minutesAgo(30), error_message: 'empty transcript' },
  ];

  it('groups by worker and orders by frequency', () => {
    const c = keyOf(evaluateOpsHealth({ now: NOW, workerErrors: errors }),
      OPS_HEALTH_CONDITIONS.WORKER_ERRORS);
    expect(c.count).toBe(3);
    expect(c.details[0]).toContain('callrail-text-webhook ×2');
    expect(c.meta.workers).toEqual({ 'callrail-text-webhook': 2, 'transcribe-call': 1 });
  });

  it('excludes errors older than the window', () => {
    const c = keyOf(evaluateOpsHealth({
      now: NOW,
      workerErrors: [...errors, { worker_name: 'old', started_at: minutesAgo(240) }],
    }), OPS_HEALTH_CONDITIONS.WORKER_ERRORS);
    expect(c.count).toBe(3);
    expect(c.meta.workers.old).toBeUndefined();
  });

  it('stays quiet when the window is empty', () => {
    const result = evaluateOpsHealth({
      now: NOW,
      workerErrors: [{ worker_name: 'old', started_at: minutesAgo(600) }],
    });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.WORKER_ERRORS)).toBeUndefined();
  });

  it('includes a truncated sample error for context', () => {
    const c = keyOf(evaluateOpsHealth({ now: NOW, workerErrors: errors }),
      OPS_HEALTH_CONDITIONS.WORKER_ERRORS);
    expect(c.details[0]).toContain('INVALID_CALLRAIL_SIGNATURE');
  });
});

describe('condition 4 — unfinalized automation claims', () => {
  const claim = (over) => ([{
    id: 'claim-1',
    automation_key: 'missed_call_textback',
    entity_type: 'call',
    entity_id: 'abc',
    claimed_at: minutesAgo(over),
    finalized_at: null,
  }]);

  it('fires for a claim left unfinalized past the threshold', () => {
    const c = keyOf(evaluateOpsHealth({ now: NOW, claims: claim(90) }),
      OPS_HEALTH_CONDITIONS.UNFINALIZED_CLAIMS);
    expect(c.count).toBe(1);
    expect(c.body).toContain('missed_call_textback');
    expect(c.body).toContain('90 min unfinalized');
  });

  it('ignores a finalized claim regardless of age', () => {
    const rows = claim(600);
    rows[0].finalized_at = minutesAgo(599);
    const result = evaluateOpsHealth({ now: NOW, claims: rows });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.UNFINALIZED_CLAIMS)).toBeUndefined();
  });

  it('ignores a fresh unfinalized claim still within its run', () => {
    const result = evaluateOpsHealth({ now: NOW, claims: claim(2) });
    expect(keyOf(result, OPS_HEALTH_CONDITIONS.UNFINALIZED_CLAIMS)).toBeUndefined();
  });
});

describe('conditions 5–7 — the QBO payment pipeline (qbo-payments-sync runs)', () => {
  const run = (over = {}) => ({
    worker_name: 'qbo-payments-sync',
    status: 'completed',
    started_at: minutesAgo(30),
    error_message: null,
    meta: { webhook_missed: 0 },
    ...over,
  });
  const errorRun = (minutes, message = 'QBO query 500') => run({
    status: 'error', started_at: minutesAgo(minutes), error_message: message,
  });

  describe('sync error streak', () => {
    it('fires at the threshold with plain-language copy and the latest error', () => {
      const c = keyOf(evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [errorRun(30, 'QBO query 401 (cdc: HTTP 401)'), errorRun(90)],
      }), OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING);
      expect(c.count).toBe(2);
      expect(c.severity).toBe('high');
      expect(c.body).toContain('QuickBooks payments may not be syncing');
      expect(c.body).toContain('failed 2 runs in a row');
      expect(c.body).toContain('QBO query 401');
    });

    it('stays quiet below the threshold — one failed sweep is a blip', () => {
      const r = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [errorRun(30), run({ started_at: minutesAgo(90) })],
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeUndefined();
    });

    it('a successful newest run ends the streak, whatever came before', () => {
      const r = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [run({ started_at: minutesAgo(30) }), errorRun(90), errorRun(150)],
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeUndefined();
    });

    it('counts only the CONSECUTIVE newest errors', () => {
      const c = keyOf(evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [errorRun(30), errorRun(90), run({ started_at: minutesAgo(150) }), errorRun(210)],
      }), OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING);
      expect(c.count).toBe(2);
    });

    it('extracts the useful part of a JSON error envelope, not the UUID', () => {
      const raw = JSON.stringify([{ id: 'aaaa-bbbb', error: 'QuickBooks refused the connection' }]);
      const c = keyOf(evaluateOpsHealth({
        now: NOW, qboSyncRuns: [errorRun(30, raw), errorRun(90, raw)],
      }), OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING);
      expect(c.body).toContain('QuickBooks refused the connection');
      expect(c.body).not.toContain('aaaa-bbbb');
    });

    it('honours an overridden streak threshold', () => {
      const r = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [errorRun(30), errorRun(90)],
        thresholds: { qboSyncErrorStreakRuns: 3 },
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeUndefined();
    });

    it('is not fooled by input order — the streak reads run TIME, not array position', () => {
      // Oldest-first input: positionally the first two entries are errors, but
      // the NEWEST run completed fine, so there is no current streak.
      const r = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [errorRun(150), errorRun(90), run({ started_at: minutesAgo(30) })],
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeUndefined();
    });
  });

  describe('webhook missed payments', () => {
    it('fires when the latest completed sweep caught webhook-missed payments', () => {
      const c = keyOf(evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [run({ meta: { webhook_missed: 3 } })],
      }), OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN);
      expect(c.count).toBe(3);
      expect(c.severity).toBe('high');
      expect(c.body).toContain('caught 3 QuickBooks payments the webhook never delivered');
    });

    it('uses singular copy for a single missed payment', () => {
      const c = keyOf(evaluateOpsHealth({
        now: NOW, qboSyncRuns: [run({ meta: { webhook_missed: 1 } })],
      }), OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN);
      expect(c.body).toContain('caught 1 QuickBooks payment the webhook never delivered');
    });

    it('stays quiet when the webhook delivered everything', () => {
      const r = evaluateOpsHealth({ now: NOW, qboSyncRuns: [run()] });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN)).toBeUndefined();
    });

    it('stays quiet when the run carries no meta at all', () => {
      const r = evaluateOpsHealth({ now: NOW, qboSyncRuns: [run({ meta: null })] });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN)).toBeUndefined();
    });

    it('reads the MOST RECENT completed run — a clean sweep clears the signal', () => {
      const r = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [
          run({ started_at: minutesAgo(30), meta: { webhook_missed: 0 } }),
          run({ started_at: minutesAgo(90), meta: { webhook_missed: 4 } }),
        ],
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN)).toBeUndefined();
    });

    it('looks past newer error runs to the last completed sweep', () => {
      const result = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [errorRun(30), run({ started_at: minutesAgo(90), meta: { webhook_missed: 2 } })],
      });
      expect(keyOf(result, OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN).count).toBe(2);
      // One error is below the streak threshold, so ONLY the webhook signal fires.
      expect(keyOf(result, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeUndefined();
    });
  });

  describe('sweep gone quiet (the cron died)', () => {
    it('stays quiet while the last run is within the stale window', () => {
      const r = evaluateOpsHealth({
        now: NOW, qboSyncRuns: [run({ started_at: minutesAgo(179) })],
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE)).toBeUndefined();
    });

    it('fires once the hourly sweep has been silent past the threshold', () => {
      const c = keyOf(evaluateOpsHealth({
        now: NOW, qboSyncRuns: [run({ started_at: minutesAgo(200) })],
      }), OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE);
      expect(c.severity).toBe('critical');
      expect(c.body).toContain('last ran about 3 hours ago');
      expect(c.body).toContain('will go unnoticed');
    });

    it('fires when the sweep has no run on record at all', () => {
      const c = keyOf(evaluateOpsHealth({ now: NOW, qboSyncRuns: [] }),
        OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE);
      expect(c.body).toContain('no run on record');
    });

    it('skips every pipeline check when no runs feed is supplied (probe failed)', () => {
      // null ≠ [] — a failed probe must degrade to silence-plus-probeError in
      // the worker, never to a false "the cron died" alert.
      const withNull = evaluateOpsHealth({ now: NOW, qboSyncRuns: null });
      const omitted = evaluateOpsHealth({ now: NOW });
      for (const r of [withNull, omitted]) {
        expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE)).toBeUndefined();
        expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeUndefined();
        expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN)).toBeUndefined();
      }
    });

    it('honours an overridden stale threshold', () => {
      const r = evaluateOpsHealth({
        now: NOW,
        qboSyncRuns: [run({ started_at: minutesAgo(200) })],
        thresholds: { qboSyncStaleMinutes: 300 },
      });
      expect(keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE)).toBeUndefined();
    });

    it('reports staleness and the error streak together when the cron died mid-outage', () => {
      const result = evaluateOpsHealth({
        now: NOW, qboSyncRuns: [errorRun(200), errorRun(260)],
      });
      expect(keyOf(result, OPS_HEALTH_CONDITIONS.QBO_SYNC_STALE)).toBeDefined();
      expect(keyOf(result, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING)).toBeDefined();
    });
  });
});

describe('combined evaluation', () => {
  it('reports every tripped condition independently', () => {
    const result = evaluateOpsHealth({
      now: NOW,
      failedEvents: [{ id: 'a', error_code: 'X', sender_address: '1' }],
      retryableEvents: [{ id: 'b', next_attempt_at: minutesAgo(60) }],
      workerErrors: [{ worker_name: 'w', started_at: minutesAgo(5) }],
      claims: [{ id: 'c', claimed_at: minutesAgo(120), finalized_at: null }],
    });
    expect(result.conditions.map((c) => c.key).sort()).toEqual([
      OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED,
      OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_STUCK,
      OPS_HEALTH_CONDITIONS.UNFINALIZED_CLAIMS,
      OPS_HEALTH_CONDITIONS.WORKER_ERRORS,
    ].sort());
  });

  it('tolerates entirely missing input arrays', () => {
    expect(() => evaluateOpsHealth({ now: NOW, failedEvents: null, claims: undefined }))
      .not.toThrow();
  });
});

describe('failed-backlog escalation', () => {
  const failedAt = (iso) => ({
    id: `e-${iso}`, error_code: 'CALLRAIL_MMS_URL_INVALID', message_type: 'mms',
    direction: 'inbound', received_at: iso, media_count: 1, owned_media: [],
  });
  const daysAgo = (n) => new Date(Date.parse(NOW) - n * 1440 * 60_000).toISOString();
  const failed = (r) => keyOf(r, OPS_HEALTH_CONDITIONS.PROVIDER_EVENTS_FAILED);

  it('stays high while the backlog is fresh', () => {
    const r = evaluateOpsHealth({ now: NOW, failedEvents: [failedAt(daysAgo(1))] });
    expect(failed(r).severity).toBe('high');
    expect(failed(r).meta.escalated).toBe(false);
  });

  it('escalates to critical once it has been ignored past the threshold', () => {
    // Ignoring an unresolved data-loss backlog must get LOUDER, not quieter.
    const r = evaluateOpsHealth({ now: NOW, failedEvents: [failedAt(daysAgo(5))] });
    expect(failed(r).severity).toBe('critical');
    expect(failed(r).meta.oldest_days).toBe(5);
    expect(failed(r).title).toContain('unresolved for 5 days');
  });

  it('keys escalation off the OLDEST row, not the newest', () => {
    const r = evaluateOpsHealth({
      now: NOW,
      failedEvents: [failedAt(daysAgo(0)), failedAt(daysAgo(9))],
    });
    expect(failed(r).severity).toBe('critical');
    expect(failed(r).meta.oldest_days).toBe(9);
  });

  it('re-alerts when it crosses the threshold instead of being suppressed', () => {
    // Crossing into critical is genuinely new information, so the fingerprint
    // must change even though the underlying error codes have not.
    const fresh = evaluateOpsHealth({ now: NOW, failedEvents: [failedAt(daysAgo(1))] });
    const stale = evaluateOpsHealth({ now: NOW, failedEvents: [failedAt(daysAgo(6))] });
    expect(failed(stale).fingerprint).not.toBe(failed(fresh).fingerprint);
  });

  it('honours a caller-supplied threshold', () => {
    const r = evaluateOpsHealth({
      now: NOW,
      failedEvents: [failedAt(daysAgo(2))],
      thresholds: { failedBacklogEscalateDays: 1 },
    });
    expect(failed(r).severity).toBe('critical');
  });

  it('does not escalate on a missing or unparseable received_at', () => {
    const r = evaluateOpsHealth({
      now: NOW,
      failedEvents: [{ id: 'x', error_code: 'E', received_at: null }],
    });
    expect(failed(r).severity).toBe('high');
    expect(failed(r).meta.oldest_days).toBe(0);
  });
});

describe('summarizeWorkerError', () => {
  it('pulls the message out of a JSON array instead of slicing the envelope', () => {
    // The exact live 2026-07-26 shape: the first 80 chars were spent on a UUID,
    // so the old slice produced "…returned an empt".
    const raw = JSON.stringify([
      { id: '0f3a5b2c-1d4e-4f6a-8b9c-0d1e2f3a4b5c', error: 'transcribe-call returned an empty transcript' },
    ]);
    expect(summarizeWorkerError(raw)).toBe('transcribe-call returned an empty transcript');
  });

  it('counts the remaining entries when several failed', () => {
    const raw = JSON.stringify([
      { error: 'first failure' },
      { error: 'second failure' },
      { error: 'third failure' },
    ]);
    expect(summarizeWorkerError(raw)).toBe('first failure (+2 more)');
  });

  it('handles a bare JSON object and the message alias', () => {
    expect(summarizeWorkerError(JSON.stringify({ message: 'timeout talking to CallRail' })))
      .toBe('timeout talking to CallRail');
  });

  it('falls back to the raw text when the payload is not JSON', () => {
    expect(summarizeWorkerError('plain old failure text')).toBe('plain old failure text');
  });

  it('falls back rather than throwing on malformed JSON', () => {
    const raw = '[{"error": "truncated';
    expect(summarizeWorkerError(raw)).toBe(raw);
  });

  it('returns null for empty input', () => {
    expect(summarizeWorkerError(null)).toBeNull();
    expect(summarizeWorkerError('   ')).toBeNull();
  });

  it('truncates AFTER extraction, not before', () => {
    const long = 'x'.repeat(400);
    const out = summarizeWorkerError(JSON.stringify([{ error: long }]));
    expect(out.length).toBe(120);
    expect(out.startsWith('xxxx')).toBe(true);
  });
});

describe('buildDedupeKey', () => {
  it('is stable per condition per Denver day', () => {
    expect(buildDedupeKey(OPS_HEALTH_CONDITIONS.WORKER_ERRORS, '2026-07-25'))
      .toBe('worker_errors:2026-07-25');
  });

  it('changes when the day rolls over', () => {
    expect(buildDedupeKey('worker_errors', '2026-07-25'))
      .not.toBe(buildDedupeKey('worker_errors', '2026-07-26'));
  });

  it('keeps the original shape when no fingerprint is supplied', () => {
    expect(buildDedupeKey('worker_errors', '2026-07-25', undefined))
      .toBe('worker_errors:2026-07-25');
  });

  it('separates two distinct failure sets on the same day', () => {
    expect(buildDedupeKey('worker_errors', '2026-07-25', 'aaaa1111'))
      .not.toBe(buildDedupeKey('worker_errors', '2026-07-25', 'bbbb2222'));
  });
});

describe('condition fingerprints', () => {
  const errorAt = (worker, minutes) => ({
    worker_name: worker, status: 'error', error_message: 'boom', started_at: minutesAgo(minutes),
  });

  it('suppresses a repeat of the same worker set but re-alerts on a new worker', () => {
    const first = evaluateOpsHealth({ now: NOW, workerErrors: [errorAt('sync-encircle', 10)] });
    const repeat = evaluateOpsHealth({ now: NOW, workerErrors: [errorAt('sync-encircle', 5)] });
    const novel = evaluateOpsHealth({
      now: NOW,
      workerErrors: [errorAt('sync-encircle', 10), errorAt('transcribe-call', 5)],
    });

    const fp = (r) => keyOf(r, OPS_HEALTH_CONDITIONS.WORKER_ERRORS).fingerprint;
    expect(fp(repeat)).toBe(fp(first));
    expect(fp(novel)).not.toBe(fp(first));
  });

  it('is order-independent', () => {
    const a = evaluateOpsHealth({
      now: NOW, workerErrors: [errorAt('alpha', 5), errorAt('beta', 6)],
    });
    const b = evaluateOpsHealth({
      now: NOW, workerErrors: [errorAt('beta', 6), errorAt('alpha', 5)],
    });
    expect(keyOf(a, OPS_HEALTH_CONDITIONS.WORKER_ERRORS).fingerprint)
      .toBe(keyOf(b, OPS_HEALTH_CONDITIONS.WORKER_ERRORS).fingerprint);
  });

  it('does not shift when only the raw error text changes (UUIDs must not leak in)', () => {
    const withUuid = (uuid) => evaluateOpsHealth({
      now: NOW,
      workerErrors: [{
        worker_name: 'sync-encircle',
        status: 'error',
        error_message: JSON.stringify([{ id: uuid, error: 'boom' }]),
        started_at: minutesAgo(5),
      }],
    });
    expect(keyOf(withUuid('aaa'), OPS_HEALTH_CONDITIONS.WORKER_ERRORS).fingerprint)
      .toBe(keyOf(withUuid('zzz'), OPS_HEALTH_CONDITIONS.WORKER_ERRORS).fingerprint);
  });

  it('re-alerts a LONGER qbo error streak as a new incident, ignoring error wording', () => {
    // Fixtures sit outside the generic worker_errors 60-minute window so only
    // the pipeline condition is in play.
    const qboError = (minutes, message) => ({
      worker_name: 'qbo-payments-sync', status: 'error',
      error_message: message, started_at: minutesAgo(minutes),
    });
    const streakOf = (n, message) => evaluateOpsHealth({
      now: NOW,
      qboSyncRuns: Array.from({ length: n }, (_, i) => qboError(90 + i * 60, message)),
    });
    const fp = (r) => keyOf(r, OPS_HEALTH_CONDITIONS.QBO_SYNC_FAILING).fingerprint;

    // Same streak, different wording → same incident (no re-page on copy).
    expect(fp(streakOf(2, 'timeout'))).toBe(fp(streakOf(2, 'ALLOCATION_INVOICE_MISMATCH')));
    // Longer streak → genuinely new incident, must re-page same-day.
    expect(fp(streakOf(3, 'timeout'))).not.toBe(fp(streakOf(2, 'timeout')));
  });

  it('re-alerts a different qbo webhook_missed count as a new incident', () => {
    const missedRun = (missed) => evaluateOpsHealth({
      now: NOW,
      qboSyncRuns: [{
        worker_name: 'qbo-payments-sync', status: 'completed',
        meta: { webhook_missed: missed }, started_at: minutesAgo(90),
      }],
    });
    const fp = (r) => keyOf(r, OPS_HEALTH_CONDITIONS.QBO_WEBHOOK_DOWN).fingerprint;
    expect(fp(missedRun(1))).toBe(fp(missedRun(1)));
    expect(fp(missedRun(5))).not.toBe(fp(missedRun(1)));
  });
});

describe('thresholds contract', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_OPS_HEALTH_THRESHOLDS).toEqual({
      stuckRetryableMinutes: 15,
      workerErrorWindowMinutes: 60,
      workerErrorMinCount: 1,
      claimUnfinalizedMinutes: 30,
      failedBacklogEscalateDays: 3,
      qboSyncErrorStreakRuns: 2,
      qboSyncStaleMinutes: 180,
    });
  });
});
