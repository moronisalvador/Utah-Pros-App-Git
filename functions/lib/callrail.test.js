/**
 * ════════════════════════════════════════════════
 * FILE: callrail.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pure CallRail helpers turn a REAL webhook delivery into the
 *   right database fields. This fixture is the actual payload CallRail POSTed
 *   for a live call (captured from inbound_leads.raw_payload) — the exact thing
 *   that was missing when the webhook mapping was first written by guesswork.
 *   It locks in the two facts a live delivery taught us: CallRail's webhook is
 *   FORM-ENCODED (so every value is a string) and the call id lives under
 *   `resource_id` (there is no top-level `id`).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./callrail.js (the pure helpers under test)
 *
 * NOTES / GOTCHAS:
 *   - Because the body is form-encoded, `spam` arrives as the STRING "false" —
 *     a naive `!!body.spam` would be truthy and wrongly flag the call as spam.
 *     The mapper must coerce boolean-ish strings; this test guards that.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  pickCallId,
  mapCallPayload,
  isAllowedRecordingUrl,
  boolish,
  extractCallId,
  callrailApiRecordingUrl,
} from './callrail.js';

// The real, form-decoded payload for a live inbound call (subset of the ~110
// keys CallRail sends — the ones the mapper reads). Every value is a string
// because the body was `application/x-www-form-urlencoded`.
const REAL_WEBHOOK_CALL = {
  resource_id: 'CAL019f1f8307a974abb2d5698dbb3b2eb5',
  customer_phone_number: '+13853145700',
  tracking_phone_number: '+13854557025',
  duration: '20',
  start_time: '2026-07-01T15:08:28.637-06:00',
  recording:
    'https://app.callrail.com/calls/CAL019f1f8307a974abb2d5698dbb3b2eb5/recording/redirect?access_key=08abe68183326850345e',
  source: 'Google Ads',
  medium: 'CPC',
  campaign: '',
  direction: 'inbound',
  lead_status: '',
  value: '',
  spam: 'false',
  transcription: '',
};

describe('pickCallId', () => {
  it('uses resource_id when there is no top-level id (real CallRail webhook)', () => {
    expect(pickCallId(REAL_WEBHOOK_CALL)).toBe('CAL019f1f8307a974abb2d5698dbb3b2eb5');
  });

  it('prefers an explicit id when present', () => {
    expect(pickCallId({ id: 'CAL_top', resource_id: 'CAL_res' })).toBe('CAL_top');
  });

  it('returns null when no id-like field exists', () => {
    expect(pickCallId({ customer_phone_number: '+1555' })).toBeNull();
  });
});

describe('boolish', () => {
  it('treats the string "false" as false (the form-encoded trap)', () => {
    expect(boolish('false')).toBe(false);
  });
  it('treats "true"/"1"/true as true', () => {
    expect(boolish('true')).toBe(true);
    expect(boolish('1')).toBe(true);
    expect(boolish(true)).toBe(true);
  });
  it('treats empty/absent as false', () => {
    expect(boolish('')).toBe(false);
    expect(boolish(undefined)).toBe(false);
    expect(boolish(null)).toBe(false);
    expect(boolish('0')).toBe(false);
  });
});

describe('mapCallPayload (real webhook fixture)', () => {
  const p = mapCallPayload(REAL_WEBHOOK_CALL);

  it('extracts the call id from resource_id', () => {
    expect(p.p_callrail_id).toBe('CAL019f1f8307a974abb2d5698dbb3b2eb5');
  });
  it('maps caller and tracking numbers', () => {
    expect(p.p_caller_number).toBe('+13853145700');
    expect(p.p_tracking_number).toBe('+13854557025');
  });
  it('coerces duration to a number', () => {
    expect(p.p_duration_sec).toBe(20);
  });
  it('does NOT flag a "false" spam string as spam', () => {
    expect(p.p_spam_flag).toBe(false);
  });
  it('maps source and medium', () => {
    expect(p.p_source).toBe('Google Ads');
    expect(p.p_medium).toBe('CPC');
  });
  it('nulls empty campaign / value / transcription and defaults lead_status', () => {
    expect(p.p_campaign).toBeNull();
    expect(p.p_value).toBeNull();
    expect(p.p_transcription).toBeNull();
    expect(p.p_lead_status).toBe('new');
  });
  it('carries the recording URL and occurred_at through', () => {
    expect(p.p_recording_url).toBe(REAL_WEBHOOK_CALL.recording);
    expect(p.p_occurred_at).toBe('2026-07-01T15:08:28.637-06:00');
    expect(p.p_source_type).toBe('call');
  });
});

describe('isAllowedRecordingUrl', () => {
  it('accepts the api.callrail.com form (backfill)', () => {
    expect(
      isAllowedRecordingUrl(
        'https://api.callrail.com/v3/a/123/calls/CAL1/recording.json'
      )
    ).toBe(true);
  });
  it('accepts the app.callrail.com recording redirect (live webhook)', () => {
    expect(
      isAllowedRecordingUrl(
        'https://app.callrail.com/calls/CAL019f1f8307a974abb2d5698dbb3b2eb5/recording/redirect?access_key=08abe68183326850345e'
      )
    ).toBe(true);
  });
  it('rejects any other host (SSRF guard)', () => {
    expect(isAllowedRecordingUrl('https://evil.example.com/x')).toBe(false);
    expect(isAllowedRecordingUrl('https://app.callrail.com/settings')).toBe(false);
    expect(isAllowedRecordingUrl(null)).toBe(false);
    expect(isAllowedRecordingUrl('')).toBe(false);
  });
});

describe('extractCallId', () => {
  it('pulls the CAL… id from the app.callrail.com redirect form (webhook)', () => {
    expect(
      extractCallId(
        'https://app.callrail.com/calls/CAL019f1fd045e3797bb2a297bea5ae4315/recording/redirect?access_key=abc123'
      )
    ).toBe('CAL019f1fd045e3797bb2a297bea5ae4315');
  });
  it('pulls the CAL… id from the api.callrail.com form (backfill)', () => {
    expect(
      extractCallId(
        'https://api.callrail.com/v3/a/ACCac74130ee99242f0a8c4bde6a74272dc/calls/CAL019e83c0ac867525a348f3ee7a687905/recording.json'
      )
    ).toBe('CAL019e83c0ac867525a348f3ee7a687905');
  });
  it('returns null when there is no call id / bad input', () => {
    expect(extractCallId('https://app.callrail.com/settings')).toBeNull();
    expect(extractCallId(null)).toBeNull();
    expect(extractCallId('')).toBeNull();
  });
});

describe('callrailApiRecordingUrl', () => {
  it('builds the api.callrail.com recording URL that the backfill (proven working) form uses', () => {
    expect(
      callrailApiRecordingUrl('635117922', 'CAL019f1fd045e3797bb2a297bea5ae4315')
    ).toBe(
      'https://api.callrail.com/v3/a/635117922/calls/CAL019f1fd045e3797bb2a297bea5ae4315/recording.json'
    );
  });
  it('returns null when account id or call id is missing', () => {
    expect(callrailApiRecordingUrl(null, 'CAL1')).toBeNull();
    expect(callrailApiRecordingUrl('635117922', null)).toBeNull();
  });
});
