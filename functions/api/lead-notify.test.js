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
import {
  notifyNewLeadFromForm,
  buildLeadNotificationContent,
  leadNotificationRows,
} from './form-submit.js';

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
    expect(calls[0].body.link).toBe('/crm/leads?lead=lead-1');
    expect(calls[0].body.data.route).toBe('/crm/leads?lead=lead-1');
    expect(calls[0].body.body).toContain('+15551234567');
    expect(calls[0].body.body).toContain('Google');
  });

  it('falls back to the plain board link when the lead has no id yet', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyNewLead({
      db: {}, env: ENV, dispatchImpl,
      lead: { callrail_id: 'CR1', caller_number: '+15551234567', spam_flag: false },
    });
    expect(calls[0].body.link).toBe('/crm/leads');
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
    expect(calls[0].body.link).toBe('/crm/leads?lead=lead-9');
    expect(calls[0].body.data.route).toBe('/crm/leads?lead=lead-9');
    expect(calls[0].body.body).toContain('Water Damage Quote');
    expect(calls[0].body.payload.source_type).toBe('form');
  });

  it('carries the full submission into the alert (bell/push body + email html)', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    const schema = {
      name: 'Water Damage Quote',
      fields: [
        { key: 'name', label: 'Full name', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'service', label: 'Service needed', type: 'select', options: ['Water damage', 'Mold'] },
        { key: 'message', label: 'How can we help?', type: 'textarea' },
        { key: 'consent', label: 'I agree to be contacted', type: 'consent' },
      ],
    };
    const data = {
      name: 'Jane Doe',
      phone: '801-555-1234',
      email: 'jane@example.com',
      service: 'Water damage',
      message: 'Basement flooded overnight',
      consent: true,
    };
    await notifyNewLeadFromForm({
      db: {}, env: ENV, dispatchImpl, formName: 'Water Damage Quote', schema, data,
      lead: { id: 'lead-42', callrail_id: 'form:tok', spam_flag: false },
    });
    expect(calls).toHaveLength(1);
    const { title, body, html } = calls[0].body;
    // Title carries the lead's name.
    expect(title).toBe('New lead · Jane Doe');
    // Plain-text body (bell + push) lists every answered field...
    expect(body).toContain('Full name: Jane Doe');
    expect(body).toContain('Phone: 801-555-1234');
    expect(body).toContain('Service needed: Water damage');
    expect(body).toContain('Basement flooded overnight');
    // ...but never the consent bookkeeping.
    expect(body).not.toContain('I agree to be contacted');
    // Email HTML is present, branded, and the "View lead" button deep-links
    // straight to this lead's panel, not just the unfiltered board.
    expect(html).toContain('New website lead');
    expect(html).toContain('/crm/leads?lead=lead-42');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('/crm/leads');
    // Design pass: hidden inbox-preview text so a scanning inbox shows who
    // and what before the email opens (first non-name field — here, phone)...
    expect(html).toContain('Jane Doe — Phone: 801-555-1234');
    // ...forces light rendering so dark-mode clients don't invert the brand...
    expect(html).toContain('name="color-scheme" content="light"');
    // ...and the phone number is a tap-to-call link, not just display text.
    expect(html).toContain('href="tel:+18015551234"');
  });

  it('escapes untrusted submission values in the email HTML', () => {
    const { html, body } = buildLeadNotificationContent({
      formName: 'Contact',
      schema: { fields: [{ key: 'name', label: 'Name', type: 'text' }] },
      data: { name: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // Plain text keeps the raw value (no HTML context to break out of).
    expect(body).toContain('<script>');
  });

  it('degrades to a generic line when no schema/data is available', () => {
    const { title, body } = buildLeadNotificationContent({ formName: 'Web Form' });
    expect(title).toBe('New lead');
    expect(body).toContain('Web form submission');
    expect(body).toContain('Web Form');
  });

  it('leadNotificationRows skips consent/honeypot and empty answers, joins multi-select', () => {
    const rows = leadNotificationRows(
      {
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'services', label: 'Services', type: 'checkbox', options: ['a', 'b', 'c'] },
          { key: 'notes', label: 'Notes', type: 'textarea' },
          { key: 'consent', label: 'Consent', type: 'consent' },
          { key: 'hp', label: 'Leave blank', type: 'text' },
        ],
      },
      { name: 'Bob', services: ['a', 'c'], notes: '', consent: true, hp: 'bot-filled' },
    );
    expect(rows).toEqual([
      { key: 'name', label: 'Name', value: 'Bob', type: 'text' },
      { key: 'services', label: 'Services', value: 'a, c', type: 'checkbox' },
    ]);
  });

  it('leadNotificationRows renders a boolean checkbox as Yes/No, not raw true/false', () => {
    const rows = leadNotificationRows(
      { fields: [{ key: 'mold', label: 'Mold', type: 'checkbox' }, { key: 'fire', label: 'Fire', type: 'checkbox' }] },
      { mold: true, fire: false },
    );
    expect(rows).toEqual([
      { key: 'mold', label: 'Mold', value: 'Yes', type: 'checkbox' },
      { key: 'fire', label: 'Fire', value: 'No', type: 'checkbox' },
    ]);
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
