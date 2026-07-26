/**
 * ════════════════════════════════════════════════
 * FILE: encircle-credential.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks a proposed Encircle key with a harmless organization lookup before
 *   anything saves it. Failure messages are deliberately generic so neither the
 *   key nor Encircle's response body can leak into the browser or logs.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./http.js
 *   Data:      reads → Encircle organizations
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This helper validates only. The caller must authorize the employee and
 *     save the candidate atomically after this returns successfully.
 * ════════════════════════════════════════════════
 */
import { fetchWithTimeout } from './http.js';

// MEASURED against the live Encircle API 2026-07-26, with a known-good key:
//   GET /v1/organizations           -> 200 {"list":[{"id":"<uuid>"}]}
//   GET /v1/organizations?limit=1   -> 400 Unknown query parameter: `limit`
// `?limit=1` was here until 2026-07-26 and made this validator reject EVERY
// candidate, valid or not, reported to the user as "Encircle rejected the
// candidate credential". Do not add a query parameter back without probing the
// live endpoint first — this one is not documented as accepting any.
const VALIDATION_URL = 'https://api.encircleapp.com/v1/organizations';

export async function validateEncircleCredential(candidate, fetcher = fetchWithTimeout) {
  const token = String(candidate || '').trim();
  if (!token) throw new Error('Encircle credential is required');

  let response;
  try {
    response = await fetcher(VALIDATION_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Encircle-Attribution': 'UtahProsRestorationApp',
      },
    });
  } catch {
    throw new Error('Encircle credential validation is temporarily unavailable');
  }

  // A 400 means WE sent something Encircle does not accept — a contract break on
  // our side, not a bad key. Reporting it as a rejected credential is what made
  // the `?limit=1` bug look like the owner's key was wrong for as long as it
  // shipped. Still generic enough that no response body or key can leak.
  if (response.status === 400) {
    throw new Error('Encircle could not process the validation request');
  }

  if (!response.ok) {
    throw new Error('Encircle rejected the candidate credential');
  }

  const data = await response.json().catch(() => ({}));
  const first = Array.isArray(data?.list) ? data.list[0] : null;
  // The live endpoint returns ONLY `id` today (measured 2026-07-26), so this is
  // null in practice and the Connections card shows no organisation name. That
  // is deliberate: a validated key with no display name beats inventing one.
  // Do not "fix" this by assuming `name` exists — it does not.
  return { organizationName: first?.name || null };
}
