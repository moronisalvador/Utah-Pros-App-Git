/**
 * ════════════════════════════════════════════════
 * FILE: sendResult.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that after a message only partly reaches the customer, the app says
 *   so — with the right numbers, the right nouns (photos vs recipients), and as
 *   an ERROR when nothing got through at all. The send worker answers "OK" for
 *   a partly-delivered send, so this is the only thing standing between the
 *   user and a failure they never hear about.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./sendResult.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { partialSendNotice, summarizeSendResult } from './sendResult';

const sentPart = (partIndex) => ({ part_index: partIndex, sid: `SM-${partIndex}` });
const failedPart = (partIndex) => ({
  part_index: partIndex,
  error: 'nope',
  error_code: 'CALLRAIL_REJECTED',
});

describe('summarizeSendResult', () => {
  it('tallies sent / blocked / failed from the twilio[] array', () => {
    const twilio = [
      { sid: 'SM-1' },
      { skipped: true, code: 'DND_ACTIVE' },
      { skipped: true, code: 'NO_CONSENT' },
      { error: 'boom', error_code: 'X' },
    ];
    expect(summarizeSendResult(twilio)).toEqual({ total: 4, sent: 1, blocked: 2, failed: 1 });
    expect(summarizeSendResult([])).toEqual({ total: 0, sent: 0, blocked: 0, failed: 0 });
    expect(summarizeSendResult(undefined)).toEqual({ total: 0, sent: 0, blocked: 0, failed: 0 });
  });
});

describe('partialSendNotice', () => {
  it('says nothing for a single send or a fully successful multi-part send', () => {
    // A blocked direct send already returns 403 with its own reason — a second
    // toast here would double-report it.
    expect(partialSendNotice([{ sid: 'SM-1' }])).toBeNull();
    expect(partialSendNotice([{ error: 'boom', error_code: 'X' }])).toBeNull();
    expect(partialSendNotice([sentPart(1), sentPart(2), sentPart(3)])).toBeNull();
    expect(partialSendNotice([])).toBeNull();
    expect(partialSendNotice(undefined)).toBeNull();
  });

  it('counts PHOTOS for a split send — every entry carries a part index', () => {
    expect(partialSendNotice([sentPart(1), sentPart(2), failedPart(3)])).toEqual({
      message: '2 of 3 photos sent — 1 failed',
      type: 'info',
    });
  });

  it('counts RECIPIENTS for a group send — no entry carries a part index', () => {
    expect(partialSendNotice([
      { sid: 'SM-1' },
      { sid: 'SM-2' },
      { skipped: true, code: 'DND_ACTIVE' },
      { skipped: true, code: 'NO_CONSENT' },
    ])).toEqual({
      message: 'Sent to 2 of 4 — 2 not reached',
      type: 'info',
    });
  });

  it('escalates to an ERROR when nothing reached the customer', () => {
    // "0 of 3 sent" is a failed send and is announced as one — the error toast
    // carries role="alert", so it is not silently missed either.
    expect(partialSendNotice([failedPart(1), failedPart(2), failedPart(3)])).toEqual({
      message: '0 of 3 photos sent — 3 failed',
      type: 'error',
    });
    expect(partialSendNotice([
      { skipped: true, code: 'DND_ACTIVE' },
      { skipped: true, code: 'NO_CONSENT' },
    ])).toEqual({
      message: 'Sent to 0 of 2 — 2 not reached',
      type: 'error',
    });
  });

  it('does not call a mixed array a photo split', () => {
    // Defensive: a partly-tagged array is not a split, so it must not claim
    // photo counts. Only an all-tagged array is.
    expect(partialSendNotice([sentPart(1), { error: 'boom', error_code: 'X' }]).message)
      .toBe('Sent to 1 of 2 — 1 not reached');
  });
});
