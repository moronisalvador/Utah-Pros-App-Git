/**
 * ════════════════════════════════════════════════
 * FILE: submit-esign.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the esign.signed notification hook the Notification Center (Session B)
 *   rewired into the e-sign submission worker. It checks the hook builds the
 *   correct event (type, job link, doc-type payload) and never throws — a signing
 *   is already stored by the time this runs, so a notify hiccup must not surface.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./submit-esign.js (notifyEsignSigned) — dispatcher injected as a fake.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { notifyEsignSigned } from './submit-esign.js';

const ENV = { SUPABASE_URL: 'https://db.test' };
const JOB = { id: 'job-1', job_number: 'J-1001', address: '123 Main', city: 'Provo', state: 'UT' };

describe('notifyEsignSigned (esign.signed rewire)', () => {
  it('emits esign.signed with job link + doc payload', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyEsignSigned({
      db: {}, env: ENV, job: JOB, docLabel: 'Work Authorization',
      docType: 'work_auth', signerName: 'Jane Homeowner', jobDocumentId: 'doc-9', dispatchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].typeKey).toBe('esign.signed');
    expect(calls[0].body.link).toBe('/jobs/job-1');
    expect(calls[0].body.entity_type).toBe('job');
    expect(calls[0].body.job_id).toBe('job-1');
    expect(calls[0].body.title).toContain('Jane Homeowner');
    expect(calls[0].body.title).toContain('Work Authorization');
    expect(calls[0].body.payload.doc_type).toBe('work_auth');
    expect(calls[0].body.payload.job_document_id).toBe('doc-9');
  });

  it('never throws when the dispatcher fails (signing already stored)', async () => {
    const dispatchImpl = async () => { throw new Error('down'); };
    await expect(
      notifyEsignSigned({ db: {}, env: ENV, job: JOB, docLabel: 'CoC', docType: 'coc', signerName: 'X', dispatchImpl }),
    ).resolves.toBeUndefined();
  });
});
