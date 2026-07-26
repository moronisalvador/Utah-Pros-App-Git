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
});

describe('thresholds contract', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_OPS_HEALTH_THRESHOLDS).toEqual({
      stuckRetryableMinutes: 15,
      workerErrorWindowMinutes: 60,
      workerErrorMinCount: 1,
      claimUnfinalizedMinutes: 30,
    });
  });
});
