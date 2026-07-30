/**
 * ════════════════════════════════════════════════
 * FILE: signSubmit.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends a customer's finished signature to the server, and turns whatever goes
 *   wrong into a sentence that customer can actually act on. The signing page is
 *   a public page with no error toast of its own, so if a submission fails the
 *   only thing standing between the customer and silence is the message these
 *   two functions produce.
 *
 * Exports:
 *   submitEsign(body, fetchImpl?)  POST the signature; throws on every failure
 *   submitErrorText(err)           the failure sentence to render
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (callers: src/pages/SignPage.jsx)
 *   Data:      reads  → none
 *              writes → none directly; POSTs to /api/submit-esign, which owns
 *                       the signature/document/audit writes
 *
 * NOTES / GOTCHAS:
 *   - Throws on ALL failures so a caller has exactly one path to surface. It
 *     never resolves on a response it could not parse: a status-200 HTML body
 *     (gateway error page, or the native shell answering /api from its own
 *     bundle) is a failure, not a silent success. That false-success class is
 *     the one the ESIGN audit found three times — see
 *     tests/qa/unit/esign-resend-truthfulness.test.js.
 *   - `fetchImpl` exists so the failure shapes are testable; production callers
 *     pass nothing. The default is read at call time, so a test that stubs the
 *     global still works.
 *   - Deliberately says nothing about what the server stored. A connection that
 *     drops after the write means "we don't know", so no message here may claim
 *     the signature was or wasn't saved.
 * ════════════════════════════════════════════════
 */

/**
 * POST a completed signature to the signing worker.
 * @param {object} body the /api/submit-esign request body
 * @param {typeof fetch} [fetchImpl] injectable fetch (tests only)
 * @returns {Promise<object>} the worker's parsed reply
 * @throws {Error} with a message intended for display, on any failure
 */
export async function submitEsign(body, fetchImpl = fetch) {
  const res = await fetchImpl('/api/submit-esign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Submission failed (${res.status}).`);
  if (!json)   throw new Error('The server returned an unexpected response.');
  return json;
}

/**
 * The customer-facing sentence for a failed submit. A rejected fetch carries
 * only "Failed to fetch" (Chromium) or "Load failed" (WebKit) — meaningless to
 * the person holding the phone. Worker messages are real sentences and pass
 * through as-is.
 * @param {unknown} err
 * @returns {string}
 */
export function submitErrorText(err) {
  const raw = String(err?.message || '').trim();
  if (!raw || /failed to fetch|load failed|networkerror|network request failed/i.test(raw)) {
    return 'We could not reach the server.';
  }
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}
