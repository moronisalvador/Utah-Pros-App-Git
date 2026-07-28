/**
 * MSG-05 — the Message button opens the customer's thread, not the picker.
 *
 * Owner report: "When I click message from the appointment page, instead of
 * immediately creating a new conversation draft with that client, it just takes
 * me to the conversations list with the search bar clicked."
 *
 * The appointment and Job Hub screens know a job_id but no contact id
 * (get_appointment_detail returns none), so both hard-navigated to the picker.
 * openJobThread resolves the job's contact on tap instead.
 *
 * The safety property under test is NEGATIVE: it must fall back to the picker
 * rather than open the WRONG thread. A message in a stranger's thread is worse
 * than an extra tap.
 */
import { describe, it, expect, vi } from 'vitest';
import { openJobThread, primaryJobContactId, pickerHref, threadHref } from './openInAppThread';

const CONTACT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CONVO = '33333333-3333-4333-8333-333333333333';

/** A db whose get_job_contacts resolves to `contacts`. */
const dbWith = (contacts) => ({ rpc: vi.fn().mockResolvedValue(contacts) });

/** fetch stub for the /api/message-conversations call openInAppThread makes. */
const okFetch = () => vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ conversation: { id: CONVO } }),
});

describe('primaryJobContactId', () => {
  it('prefers the flagged primary contact', () => {
    expect(primaryJobContactId([
      { contact_id: OTHER, is_primary: false },
      { contact_id: CONTACT, is_primary: true },
    ])).toBe(CONTACT);
  });

  it('takes the only contact when there is exactly one', () => {
    expect(primaryJobContactId([{ contact_id: CONTACT }])).toBe(CONTACT);
  });

  it('refuses to choose between several unflagged contacts', () => {
    // The tech picks. Guessing here is how a message reaches the wrong person.
    expect(primaryJobContactId([
      { contact_id: CONTACT }, { contact_id: OTHER },
    ])).toBeNull();
  });

  it('accepts either id shape the RPC may return', () => {
    expect(primaryJobContactId([{ id: CONTACT }])).toBe(CONTACT);
  });

  it('is null-safe for every non-list input', () => {
    for (const input of [null, undefined, [], 'nope', 0, {}]) {
      expect(primaryJobContactId(input)).toBeNull();
    }
  });
});

describe('openJobThread', () => {
  it('opens the resolved thread directly', async () => {
    const navigate = vi.fn();
    await openJobThread(navigate, 'job-1', dbWith([{ contact_id: CONTACT, is_primary: true }]), {
      fetchFn: okFetch(),
    });
    expect(navigate).toHaveBeenCalledWith(threadHref(CONVO));
  });

  it('asks for the contacts of the job it was given', async () => {
    const db = dbWith([{ contact_id: CONTACT }]);
    await openJobThread(vi.fn(), 'job-9', db, { fetchFn: okFetch() });
    expect(db.rpc).toHaveBeenCalledWith('get_job_contacts', { p_job_id: 'job-9' });
  });

  it('falls back to the picker when the job has no contacts', async () => {
    const navigate = vi.fn();
    await openJobThread(navigate, 'job-1', dbWith([]), { fetchFn: okFetch() });
    expect(navigate).toHaveBeenCalledWith(pickerHref());
  });

  it('falls back to the picker when the contact is ambiguous', async () => {
    const navigate = vi.fn();
    const fetchFn = okFetch();
    await openJobThread(navigate, 'job-1', dbWith([
      { contact_id: CONTACT }, { contact_id: OTHER },
    ]), { fetchFn });
    expect(navigate).toHaveBeenCalledWith(pickerHref());
    // And critically: it did not resolve a conversation for either candidate.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back to the picker when the lookup throws', async () => {
    const navigate = vi.fn();
    const db = { rpc: vi.fn().mockRejectedValue(new Error('offline')) };
    await openJobThread(navigate, 'job-1', db, { fetchFn: okFetch() });
    expect(navigate).toHaveBeenCalledWith(pickerHref());
  });

  it('falls back to the picker with no job id and never calls the RPC', async () => {
    const navigate = vi.fn();
    const db = dbWith([{ contact_id: CONTACT }]);
    await openJobThread(navigate, null, db);
    expect(navigate).toHaveBeenCalledWith(pickerHref());
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('falls back to the picker with no db client', async () => {
    const navigate = vi.fn();
    await openJobThread(navigate, 'job-1', null);
    expect(navigate).toHaveBeenCalledWith(pickerHref());
  });

  it('lands in the picker when conversation resolution fails', async () => {
    // The contact was unambiguous but the Worker refused. Still no dead end, and
    // still no guess at a different contact.
    const navigate = vi.fn();
    const onError = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: 'nope' }),
    });
    await openJobThread(navigate, 'job-1', dbWith([{ contact_id: CONTACT }]), { fetchFn, onError });
    expect(navigate).toHaveBeenCalledWith(pickerHref());
    expect(onError).toHaveBeenCalled();
  });

  it('never sends anything — resolution is navigation only', async () => {
    // Opening a thread must not touch the send path or consent state.
    const fetchFn = okFetch();
    await openJobThread(vi.fn(), 'job-1', dbWith([{ contact_id: CONTACT }]), { fetchFn });
    const urls = fetchFn.mock.calls.map(c => c[0]);
    expect(urls).toEqual(['/api/message-conversations']);
    expect(urls).not.toContain('/api/send-message');
  });
});
