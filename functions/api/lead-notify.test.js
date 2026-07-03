/**
 * ════════════════════════════════════════════════
 * FILE: lead-notify.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the lead.new notification hooks the Notification Center (Session B)
 *   added to the two lead entry points — CallRail calls (callrail-webhook.js) and
 *   web forms (form-submit.js). It checks each hook builds the correct event,
 *   skips flagged spam, and never throws. It also locks in the rule that the
 *   CallRail BACKFILL worker can never fire lead.new (the hook lives only in the
 *   live webhook, not in the shared upsert RPC the backfill reuses).
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs (to assert the backfill source stays hook-free)
 *   Internal:  ./callrail-webhook.js, ./form-submit.js (the exported hooks) —
 *              the dispatcher is injected as a fake.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { notifyNewLead } from './callrail-webhook.js';
import { notifyNewLeadFromForm } from './form-submit.js';

const ENV = { SUPABASE_URL: 'https://db.test' };

describe('notifyNewLead (callrail lead.new)', () => {
  it('emits lead.new with the caller + lead id', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyNewLead({
      db: {}, env: ENV, dispatchImpl,
      lead: { id: 'lead-1', callrail_id: 'CR1', caller_number: '+15551234567', source: 'Google', source_type: 'call', spam_flag: false },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].typeKey).toBe('lead.new');
    expect(calls[0].body.entity_id).toBe('lead-1');
    expect(calls[0].body.link).toBe('/leads');
    expect(calls[0].body.body).toContain('+15551234567');
    expect(calls[0].body.body).toContain('Google');
  });

  it('skips flagged spam (no alert)', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyNewLead({ db: {}, env: ENV, dispatchImpl, lead: { id: 'l2', spam_flag: true } });
    expect(calls).toHaveLength(0);
  });

  it('never throws when the dispatcher fails', async () => {
    const dispatchImpl = async () => { throw new Error('down'); };
    await expect(
      notifyNewLead({ db: {}, env: ENV, dispatchImpl, lead: { id: 'l3', spam_flag: false } }),
    ).resolves.toBeUndefined();
  });
});

describe('notifyNewLeadFromForm (form lead.new)', () => {
  it('emits lead.new tagged as a form submission', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyNewLeadFromForm({
      db: {}, env: ENV, dispatchImpl, formName: 'Water Damage Quote',
      lead: { id: 'lead-9', callrail_id: 'form:tok', spam_flag: false },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].typeKey).toBe('lead.new');
    expect(calls[0].body.entity_id).toBe('lead-9');
    expect(calls[0].body.body).toContain('Water Damage Quote');
    expect(calls[0].body.payload.source_type).toBe('form');
  });

  it('never throws when the dispatcher fails', async () => {
    const dispatchImpl = async () => { throw new Error('down'); };
    await expect(
      notifyNewLeadFromForm({ db: {}, env: ENV, dispatchImpl, lead: { id: 'x', spam_flag: false } }),
    ).resolves.toBeUndefined();
  });
});

describe('callrail-backfill never fires lead.new', () => {
  it('the backfill worker source imports/calls no notify path', () => {
    const src = readFileSync(fileURLToPath(new URL('./callrail-backfill.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/dispatchEvent/);
    expect(src).not.toMatch(/notifyNewLead/);
    expect(src).not.toMatch(/lead\.new/);
  });
});
