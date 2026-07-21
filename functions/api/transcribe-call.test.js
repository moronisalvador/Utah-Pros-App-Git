/**
 * ════════════════════════════════════════════════
 * FILE: transcribe-call.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves two fixes made after reviewing real production data (2026-06-26,
 *   lead 6587d3de-b581-4d0b-b5bc-df100cac35f6): (1) the AI system prompts used
 *   to name speakers and clean up a transcript explicitly warn against
 *   attributing a name mentioned while a caller is ASKING FOR someone ("Is
 *   this Ben?") as that caller's own identity, and (2) reclassifyLead() nulls
 *   out a freshly-extracted customer_full_name that conflicts with (doesn't
 *   extend) the lead's already-established caller_name before it's stored —
 *   rather than blindly trusting a role-confused AI guess — and best-effort
 *   calls the new crm_auto_qualify_contact RPC.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./transcribe-call.js (reclassifyLead + the exported system
 *              prompts) — a fake `db` (rpc only) and a stubbed global fetch
 *              stand in for the real Supabase client and the Anthropic API.
 *
 * NOTES / GOTCHAS:
 *   - Only reclassifyLead() is exercised here (not transcribeLead()) — it
 *     needs no CallRail/Deepgram calls, just already-stored turns, so the
 *     fetch stub only has to answer the two Anthropic calls (naming, cleanup).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { reclassifyLead, NAMING_SYSTEM, RESEGMENT_SYSTEM, CLEANUP_SYSTEM } from './transcribe-call.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function anthropicResponse(json) {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) };
}

describe('system prompts warn against attributing an "asking for X" name to the speaker', () => {
  it('NAMING_SYSTEM', () => {
    expect(NAMING_SYSTEM).toMatch(/Is this <name>/);
    expect(NAMING_SYSTEM).toMatch(/belongs to the person being asked for/);
    expect(NAMING_SYSTEM).toMatch(/never attribute that name to the asking speaker/);
  });
  it('RESEGMENT_SYSTEM', () => {
    expect(RESEGMENT_SYSTEM).toMatch(/Is this <name>/);
    expect(RESEGMENT_SYSTEM).toMatch(/belongs to the person being asked for/);
  });
  it('CLEANUP_SYSTEM', () => {
    expect(CLEANUP_SYSTEM).toMatch(/asking FOR someone else/);
    expect(CLEANUP_SYSTEM).toMatch(/never extract it into customer_full_name/);
  });
});

describe('reclassifyLead — cross-validates customer_full_name against the established caller_name', () => {
  const baseLead = {
    id: 'lead-1',
    caller_name: 'Jake Nelson',
    transcription: 'Hi. This is Utah. Is this Ben?',
    transcript_analysis: {
      model: 'nova-3',
      turns: [
        { speaker: 'Speaker 1', text: 'Hi. This is Utah. Can I help you?' },
        { speaker: 'Speaker 2', text: 'Is this Ben?' },
      ],
    },
  };
  const env = { ANTHROPIC_API_KEY: 'test-key' };

  it('nulls a conflicting customer_full_name before it is stored, and never calls set_lead_caller_name with it', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // nameSpeakers() — role assignment, no confident customer name yet.
        return anthropicResponse({
          speakers: { 'Speaker 1': { role: 'agent', name: 'Utah' }, 'Speaker 2': { role: 'customer', name: null } },
          caller_name: null,
        });
      }
      // cleanAndSummarize() — mis-attributes "Ben" (the agent from an earlier
      // call) as the customer's own name, per the real 2026-06-26 incident.
      return anthropicResponse({
        turns: ['Hi. This is Utah. Can I help you?', 'Is this Ben?'],
        summary: 'Customer Ben asked to be connected.',
        customer_full_name: 'Ben',
        is_customer_inquiry: true,
        service_match: 'in_scope',
      });
    }));

    const rpcCalls = [];
    const db = { rpc: async (name, params) => { rpcCalls.push({ name, params }); return {}; } };

    const result = await reclassifyLead(db, env, baseLead);

    // The conflicting name never reaches transcript_analysis.
    expect(result.analysis.customer_full_name).toBeNull();
    const stored = rpcCalls.find((c) => c.name === 'set_lead_transcription');
    expect(stored.params.p_analysis.customer_full_name).toBeNull();

    // With no confident name from either pass, set_lead_caller_name is never called
    // — the established "Jake Nelson" is left exactly as it was.
    expect(rpcCalls.find((c) => c.name === 'set_lead_caller_name')).toBeUndefined();

    // The auto-qualify best-effort call still fires for every reclassify.
    expect(rpcCalls.find((c) => c.name === 'crm_auto_qualify_contact')?.params).toEqual({ p_lead_id: 'lead-1' });
  });

  it('keeps a customer_full_name that genuinely extends the established caller_name', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return anthropicResponse({
          speakers: { 'Speaker 1': { role: 'agent', name: 'Utah' }, 'Speaker 2': { role: 'customer', name: 'Jake' } },
          caller_name: 'Jake',
        });
      }
      return anthropicResponse({
        turns: ['Hi. This is Utah. Can I help you?', 'This is Jake Nelson calling back.'],
        summary: 'Jake Nelson called back about his mold quote.',
        customer_full_name: 'Jake Nelson',
        is_customer_inquiry: true,
        service_match: 'in_scope',
      });
    }));

    const rpcCalls = [];
    const db = { rpc: async (name, params) => { rpcCalls.push({ name, params }); return {}; } };
    const lead = { ...baseLead, caller_name: 'Jake' };

    const result = await reclassifyLead(db, env, lead);

    expect(result.analysis.customer_full_name).toBe('Jake Nelson');
    const named = rpcCalls.find((c) => c.name === 'set_lead_caller_name');
    expect(named.params).toEqual({ p_lead_id: 'lead-1', p_name: 'Jake Nelson', p_allow_upgrade: true });
  });

  it('has nothing to conflict with on a first-time name (no established caller_name)', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return anthropicResponse({
          speakers: { 'Speaker 1': { role: 'agent', name: 'Utah' }, 'Speaker 2': { role: 'customer', name: null } },
          caller_name: null,
        });
      }
      return anthropicResponse({
        turns: ['Hi. This is Utah. Can I help you?', 'This is Colton Reyes, I have a water leak.'],
        summary: 'Colton Reyes reports a water leak.',
        customer_full_name: 'Colton Reyes',
        is_customer_inquiry: true,
        service_match: 'in_scope',
      });
    }));

    const rpcCalls = [];
    const db = { rpc: async (name, params) => { rpcCalls.push({ name, params }); return {}; } };
    const lead = { ...baseLead, caller_name: null };

    const result = await reclassifyLead(db, env, lead);

    expect(result.analysis.customer_full_name).toBe('Colton Reyes');
    const named = rpcCalls.find((c) => c.name === 'set_lead_caller_name');
    expect(named.params).toEqual({ p_lead_id: 'lead-1', p_name: 'Colton Reyes', p_allow_upgrade: true });
  });
});
