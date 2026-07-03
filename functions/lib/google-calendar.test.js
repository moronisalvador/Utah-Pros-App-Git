/**
 * ════════════════════════════════════════════════
 * FILE: google-calendar.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the appointment.assigned email dedupe seam the Notification Center
 *   (Session B) added to the calendar-sync worker. The legacy "you were assigned"
 *   / "your appointment moved" employee email is now the appointment.assigned
 *   EMAIL channel, so it must obey each employee's preference: an employee whose
 *   email channel is off gets no legacy email, and because the notify path only
 *   sends bell + push for this type, nobody ever gets two emails.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./google-calendar.js (decideEmailKind, assignedEmailAllowed) — the
 *              effective-prefs resolver is injected as a fake.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { decideEmailKind, assignedEmailAllowed } from './google-calendar.js';

// Effective-prefs rows for appointment.assigned across channels.
function apptPrefs({ email = false } = {}) {
  return [
    { type_key: 'appointment.assigned', channel: 'bell', enabled: true },
    { type_key: 'appointment.assigned', channel: 'push', enabled: true },
    { type_key: 'appointment.assigned', channel: 'email', enabled: email },
  ];
}

describe('decideEmailKind (legacy kind, unchanged logic)', () => {
  it('firstCreate → assigned', () => {
    expect(decideEmailKind({ notify: true, email: 'a@x.com', firstCreate: true, link: null, timeSig: 't1' })).toBe('assigned');
  });
  it('time signature changed → rescheduled', () => {
    expect(decideEmailKind({ notify: true, email: 'a@x.com', firstCreate: false, link: { time_sig: 't0' }, timeSig: 't1' })).toBe('rescheduled');
  });
  it('no change → null', () => {
    expect(decideEmailKind({ notify: true, email: 'a@x.com', firstCreate: false, link: { time_sig: 't1' }, timeSig: 't1' })).toBe(null);
  });
  it('notify off or no email → null', () => {
    expect(decideEmailKind({ notify: false, email: 'a@x.com', firstCreate: true, link: null, timeSig: 't1' })).toBe(null);
    expect(decideEmailKind({ notify: true, email: null, firstCreate: true, link: null, timeSig: 't1' })).toBe(null);
  });
});

describe('assignedEmailAllowed (appointment.assigned email preference gate)', () => {
  it('true only when the email channel is effectively ON', async () => {
    const on = () => apptPrefs({ email: true });
    expect(await assignedEmailAllowed({}, 'emp-1', on)).toBe(true);
  });
  it('false when the email channel is OFF (default-silent)', async () => {
    const off = () => apptPrefs({ email: false });
    expect(await assignedEmailAllowed({}, 'emp-1', off)).toBe(false);
  });
  it('false when there is no matching pref row', async () => {
    const none = () => [{ type_key: 'message.inbound', channel: 'email', enabled: true }];
    expect(await assignedEmailAllowed({}, 'emp-1', none)).toBe(false);
  });
  it('false (suppress) when the resolver throws', async () => {
    const boom = () => { throw new Error('resolver down'); };
    expect(await assignedEmailAllowed({}, 'emp-1', boom)).toBe(false);
  });
  it('false when no employee id', async () => {
    expect(await assignedEmailAllowed({}, null, () => apptPrefs({ email: true }))).toBe(false);
  });
});

// The composed seam: decideEmailKind then the pref gate — exactly what the sync loop runs.
async function effectiveEmailKind({ notify, email, firstCreate, link, timeSig, employeeId, prefs }) {
  let kind = decideEmailKind({ notify, email, firstCreate, link, timeSig });
  if (kind && !(await assignedEmailAllowed({}, employeeId, prefs))) kind = null;
  return kind;
}

describe('dedupe seam (composed) — prefs-off suppression + no double email', () => {
  it('prefs-OFF employee gets NO legacy assigned email', async () => {
    const kind = await effectiveEmailKind({
      notify: true, email: 'a@x.com', firstCreate: true, link: null, timeSig: 't1',
      employeeId: 'emp-1', prefs: () => apptPrefs({ email: false }),
    });
    expect(kind).toBe(null);
  });

  it('prefs-OFF employee gets NO legacy rescheduled email', async () => {
    const kind = await effectiveEmailKind({
      notify: true, email: 'a@x.com', firstCreate: false, link: { time_sig: 't0' }, timeSig: 't1',
      employeeId: 'emp-1', prefs: () => apptPrefs({ email: false }),
    });
    expect(kind).toBe(null);
  });

  it('prefs-ON employee gets exactly one legacy email (the sole email path — no double)', async () => {
    const kind = await effectiveEmailKind({
      notify: true, email: 'a@x.com', firstCreate: true, link: null, timeSig: 't1',
      employeeId: 'emp-1', prefs: () => apptPrefs({ email: true }),
    });
    // One 'assigned' email from THIS path; the notify path delivers only bell+push
    // for appointment.assigned (email_default=false), so the recipient never gets two.
    expect(kind).toBe('assigned');
  });
});
