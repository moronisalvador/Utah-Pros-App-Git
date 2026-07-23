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

const VALIDATION_URL = 'https://api.encircleapp.com/v1/organizations?limit=1';

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

  if (!response.ok) {
    throw new Error('Encircle rejected the candidate credential');
  }

  const data = await response.json().catch(() => ({}));
  const first = Array.isArray(data?.list) ? data.list[0] : null;
  return { organizationName: first?.name || null };
}
