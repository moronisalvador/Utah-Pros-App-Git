/**
 * ════════════════════════════════════════════════
 * FILE: SignPage.submitError.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that when a customer taps Submit and the signature fails to save,
 *   they are told. The bug this guards: the page stored the failure message in a
 *   state that only the "Link Not Found" screen renders, so a failed submit
 *   dropped the customer back onto an unchanged form with no error at all — they
 *   would either give up or tap Submit forever. This page is public and outside
 *   both app shells, so it has no toast container; the message has to be inline.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server
 *   Internal:  ./SignPage.jsx (SubmitErrorNotice + the wiring it is rendered by),
 *              @/lib/signSubmit (submitEsign, submitErrorText)
 *   Data:      reads  → none (fetch is injected per case)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - renderToStaticMarkup, not a DOM render: the unit lane runs in plain node.
 *     Matches SessionExpiredBanner.render.test.jsx.
 *   - fetch is always injected, never global — the lane blocks real network.
 *   - The customer-visible string is asserted through the same two steps the
 *     page uses (submitEsign throws → submitErrorText formats), so a change to
 *     either one that reintroduces a raw "Load failed" is caught here.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { submitEsign, submitErrorText } from '@/lib/signSubmit';

import { SubmitErrorNotice } from './SignPage.jsx';

const source = readFileSync(join(import.meta.dirname, 'SignPage.jsx'), 'utf8');

const jsonReply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const nonJsonReply = (status) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"..."); },
});

/** Exactly what the page does with a failure: throw, then format for display. */
async function visibleFailureText(fetchImpl) {
  try {
    await submitEsign({ token: 'x' }, fetchImpl);
  } catch (err) {
    return submitErrorText(err);
  }
  throw new Error('submitEsign resolved — expected it to throw');
}

describe('submitEsign — every failure produces a message worth showing', () => {
  it('passes the worker error through when it refuses the request', async () => {
    // 409 from /api/submit-esign; its own sentence beats any generic wording.
    const text = await visibleFailureText(jsonReply(409, { error: 'Document already signed' }));
    expect(text).toBe('Document already signed.');
  });

  it('surfaces the 500 message the worker returns with its reference', async () => {
    const text = await visibleFailureText(
      jsonReply(500, { error: 'Unable to complete signing request', reference: 'abc' }),
    );
    expect(text).toBe('Unable to complete signing request.');
  });

  it('falls back to the status when the failure body carries no error', async () => {
    const text = await visibleFailureText(jsonReply(502, {}));
    expect(text).toBe('Submission failed (502).');
  });

  it('never shows a JSON parse error to the customer', async () => {
    // A gateway error page, or the native shell answering /api from its own
    // bundle: status 200, body HTML. Not success, and not "Unexpected token".
    const text = await visibleFailureText(nonJsonReply(200));
    expect(text).toBe('The server returned an unexpected response.');
    expect(text).not.toMatch(/unexpected token|DOCTYPE/i);
  });

  it('translates a dropped connection instead of repeating the browser wording', async () => {
    for (const raw of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      const text = await visibleFailureText(async () => { throw new TypeError(raw); });
      expect(text, raw).toBe('We could not reach the server.');
    }
  });

  it('resolves with the worker reply on a real success', async () => {
    const reply = { success: true, job_document_id: 'doc-1', job_id: 'job-1' };
    await expect(submitEsign({ token: 'x' }, jsonReply(200, reply))).resolves.toEqual(reply);
  });

  it('posts to the signing worker as JSON', async () => {
    let seen = null;
    await submitEsign({ token: 'abc', signer_name: 'Jane Doe' }, async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    expect(seen.url).toBe('/api/submit-esign');
    expect(seen.init.method).toBe('POST');
    expect(seen.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(seen.init.body)).toMatchObject({ token: 'abc', signer_name: 'Jane Doe' });
  });
});

describe('SubmitErrorNotice — the customer actually sees it', () => {
  it('announces the failure and carries the reason plus a way to reach us', () => {
    const out = renderToStaticMarkup(<SubmitErrorNotice message="We could not reach the server." />);
    expect(out).toContain('role="alert"');
    expect(out).toContain('We could not reach the server.');
    expect(out).toContain('submit your signature');
    expect(out).toContain('mailto:restoration@utah-pros.com');
  });

  it('does not claim anything about what the server saved', () => {
    // loading-error-states.md §1: never state an outcome we cannot verify — a
    // network failure after the write would make "nothing was saved" a lie.
    const out = renderToStaticMarkup(<SubmitErrorNotice message="We could not reach the server." />);
    expect(out).not.toMatch(/nothing was saved|was not saved|not submitted/i);
  });
});

describe('SignPage wiring — the state that renders is the state the catch sets', () => {
  it('renders the notice in the ready state, beside the Submit button', () => {
    expect(source).toContain('{submitError && <SubmitErrorNotice message={submitError} />}');
    const noticeAt = source.indexOf('{submitError && <SubmitErrorNotice');
    const buttonAt = source.indexOf('onClick={handleSubmit}');
    expect(noticeAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(noticeAt); // above the button the customer just tapped
  });

  it('sends the submit failure to submitError, not to the load-error screen', () => {
    expect(source).toContain('catch (err) { setSubmitError(submitErrorText(err)); setStatus(\'ready\'); }');
    // The regression: setErrorMsg here renders nowhere once status is 'ready'.
    const handlerStart = source.indexOf('const handleSubmit = async () => {');
    const handlerEnd = source.indexOf('const inAppBackBar', handlerStart);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(source.slice(handlerStart, handlerEnd)).not.toContain('setErrorMsg');
  });

  it('clears the previous failure when the customer tries again', () => {
    expect(source).toContain("setSubmitError(''); // a fresh attempt clears the previous failure");
  });
});
