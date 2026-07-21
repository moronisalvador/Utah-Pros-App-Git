/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase1_callrail.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CallRail lead-ingestion database function works against the real
 *   database. Every call is logged as a lead, but a call from an UNKNOWN number
 *   never creates a customer contact (most calls are spam / wrong numbers) — it
 *   only LINKS to a contact that already exists for that number. It also checks
 *   that a redelivered "recording ready" webhook updates the same lead instead
 *   of duplicating it. All test rows are tagged to the disposable TEST org and
 *   deleted when the test finishes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → inbound_leads, contacts, crm_orgs
 *              writes → inbound_leads (via upsert_lead_from_callrail RPC); a
 *                       seeded contact for the link case; all test rows deleted
 *                       in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project (a SQL RPC's
 *     behavior can't be a pure unit test). Needs real VITE_SUPABASE_URL /
 *     VITE_SUPABASE_ANON_KEY — self-skips via describe.skipIf when absent, same
 *     as the Phase 0 suite, since CI's `npm test` doesn't pass those secrets.
 *   - As of the "no auto-create contact" intake change, ingestion NEVER creates
 *     a contact — a contact is created only when a lead is qualified (it books,
 *     or staff run promote_lead_to_contact). This test asserts that new rule.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 1 — upsert_lead_from_callrail (integration)', () => {
  const runId = Date.now();
  const callId = `test-call-${runId}`;
  const knownCallId = `test-known-${runId}`;
  const unknownNumber = `+1555${String(runId).slice(-7)}`;
  const knownNumber = `+1556${String(runId).slice(-7)}`;
  let testOrgId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    await db.delete('inbound_leads', `callrail_id=in.(${callId},${knownCallId})`);
    await db.delete('contacts', `phone=in.(${encodeURIComponent(unknownNumber)},${encodeURIComponent(knownNumber)})`);
  });

  it('logs a lead from an unknown number but creates NO contact', async () => {
    const row = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: callId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: unknownNumber,
      p_duration_sec: 42,
      p_spam_flag: false,
      p_source: 'google',
      p_medium: 'cpc',
      p_campaign: 'test-campaign',
      p_recording_url: null,
      p_transcription: null,
      p_form_data: null,
      p_lead_status: 'new',
      p_value: null,
      p_direction: 'inbound',
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true, stage: 'completed' },
    });

    expect(row.callrail_id).toBe(callId);
    expect(row.contact_id).toBeNull();

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(unknownNumber)}`);
    expect(contacts).toHaveLength(0);
  });

  it('LINKS to an existing contact when the caller number already has one', async () => {
    const [seeded] = await db.insert('contacts', { phone: knownNumber, name: 'Known Person' });

    const row = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: knownCallId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: knownNumber,
      p_duration_sec: 88,
      p_spam_flag: false,
      p_source: 'google',
      p_medium: 'cpc',
      p_campaign: 'test-campaign',
      p_recording_url: null,
      p_transcription: null,
      p_form_data: null,
      p_lead_status: 'new',
      p_value: null,
      p_direction: 'inbound',
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });

    expect(row.contact_id).toBe(seeded.id);

    // Still exactly one contact — linking must never create a second.
    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(knownNumber)}`);
    expect(contacts).toHaveLength(1);
  });

  it('LINKS to an existing contact even when its phone is stored in a different format', async () => {
    // Regression test — upsert_lead_from_callrail used a bare `phone = p_caller_number`
    // string match. A contact whose phone was saved without the leading "+1" (or with
    // punctuation) never matched CallRail's E.164 caller_number, so the lead's
    // contact_id silently stayed null forever (verified live on 2026-07-21: several
    // real customers' calls never linked despite an exact-matching contact existing).
    const rawDigits = `801${String(runId).slice(-7)}`; // no +1, no punctuation
    const e164 = `+1${rawDigits}`;
    const formatCallId = `test-format-${runId}`;

    const [seeded] = await db.insert('contacts', { phone: rawDigits, name: 'Differently Formatted Person' });

    const row = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: formatCallId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: e164,
      p_duration_sec: 60,
      p_spam_flag: false,
      p_source: 'google',
      p_medium: 'cpc',
      p_campaign: 'test-campaign',
      p_recording_url: null,
      p_transcription: null,
      p_form_data: null,
      p_lead_status: 'new',
      p_value: null,
      p_direction: 'inbound',
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });

    expect(row.contact_id).toBe(seeded.id);

    await db.delete('inbound_leads', `callrail_id=eq.${formatCallId}`);
    await db.delete('contacts', `id=eq.${seeded.id}`);
  });

  it('a redelivered webhook (recording ready) updates the same row instead of duplicating it', async () => {
    const updated = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: callId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: unknownNumber,
      p_duration_sec: 42,
      p_spam_flag: false,
      p_source: 'google',
      p_medium: 'cpc',
      p_campaign: 'test-campaign',
      p_recording_url: 'https://app.callrail.com/recordings/test.mp3',
      p_transcription: 'Hello, I have a water leak.',
      p_form_data: null,
      p_lead_status: 'new',
      p_value: null,
      p_direction: 'inbound',
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true, stage: 'recording_ready' },
    });

    // Merged in from the second delivery
    expect(updated.recording_url).toBe('https://app.callrail.com/recordings/test.mp3');
    expect(updated.transcription).toBe('Hello, I have a water leak.');
    // Preserved from the first delivery, not clobbered
    expect(updated.campaign).toBe('test-campaign');
    expect(updated.duration_sec).toBe(42);

    const rows = await db.select('inbound_leads', `callrail_id=eq.${callId}`);
    expect(rows).toHaveLength(1);
  });
});
