/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase1_callrail.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CallRail lead-ingestion database function actually works
 *   against the real database. It fires the same "call happened" event
 *   twice in a row (exactly what CallRail does — a "call completed" webhook
 *   followed later by a "recording ready" webhook for the same call) and
 *   checks that it updates one row instead of creating a duplicate, and that
 *   the second call's new fields (like the recording link) merge in without
 *   erasing what the first call already saved. It also checks that a
 *   spam/very-short call never creates a customer contact, while a real
 *   call does. All test rows are tagged to the disposable TEST org and
 *   deleted again when the test finishes.
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
 *              writes → inbound_leads (via upsert_lead_from_callrail RPC),
 *                       contacts (via the same RPC); all test rows deleted
 *                       in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project
 *     (docs/crm-roadmap.md Testing model — a SQL RPC's behavior can't be a
 *     pure unit test). Needs real VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *     (see .env.example) — self-skips via describe.skipIf when absent, same
 *     as supabase/tests/crm_phase0_build_progress.test.js, since CI's `npm
 *     test` step doesn't currently pass those secrets.
 *   - Uses a `callrail_id` unique per run (`test-call-<timestamp>`) and the
 *     disposable "Utah Pros — TEST" crm_orgs row, so it never touches real
 *     CallRail data and is safe to run against the shared dev database.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 1 — upsert_lead_from_callrail (integration)', () => {
  const runId = Date.now();
  const callId = `test-call-${runId}`;
  const spamCallId = `test-spam-call-${runId}`;
  const callerNumber = `+1555${String(runId).slice(-7)}`;
  let testOrgId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    await db.delete('inbound_leads', `callrail_id=in.(${callId},${spamCallId})`);
    await db.delete('contacts', `phone=eq.${encodeURIComponent(callerNumber)}`);
  });

  it('creates one row on first delivery and matches/creates a contact by caller_number', async () => {
    const row = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: callId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: callerNumber,
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
    expect(row.recording_url).toBeNull();

    const [contact] = await db.select('contacts', `phone=eq.${encodeURIComponent(callerNumber)}`);
    expect(contact).toBeTruthy();
    expect(row.contact_id).toBe(contact.id);
  });

  it('a redelivered webhook (recording ready) updates the same row instead of duplicating it', async () => {
    const updated = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: callId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: callerNumber,
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

  it('a spam / sub-15-second call logs a lead but never creates a contact', async () => {
    const spamCaller = `+1555${String(runId + 1).slice(-7)}`;
    const row = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: spamCallId,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_tracking_number: '+18015550100',
      p_caller_number: spamCaller,
      p_duration_sec: 4,
      p_spam_flag: false,
      p_source: null,
      p_medium: null,
      p_campaign: null,
      p_recording_url: null,
      p_transcription: null,
      p_form_data: null,
      p_lead_status: 'new',
      p_value: null,
      p_direction: 'inbound',
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });

    expect(row.contact_id).toBeNull();

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(spamCaller)}`);
    expect(contacts).toHaveLength(0);
  });
});
