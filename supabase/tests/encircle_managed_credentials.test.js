/**
 * ════════════════════════════════════════════════
 * FILE: encircle_managed_credentials.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Verifies the replacement credential-status RPC through real authenticated
 *   admin and non-admin sessions during the controlled database apply window.
 *   It confirms legacy providers keep their safe response fields, Encircle
 *   adds only safe status metadata, and non-admin callers remain denied.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   External:  the shared Supabase project after the Encircle migration
 *
 * NOTES / GOTCHAS:
 *   - Read-only. It never creates an identity or writes a credential.
 *   - The release operator supplies short-lived access tokens through
 *     UPR_TEST_ADMIN_ACCESS_TOKEN and UPR_TEST_NON_ADMIN_ACCESS_TOKEN.
 *   - The suite self-skips outside an explicitly prepared apply window.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const adminToken = globalThis.process?.env?.UPR_TEST_ADMIN_ACCESS_TOKEN;
const nonAdminToken = globalThis.process?.env?.UPR_TEST_NON_ADMIN_ACCESS_TOKEN;
const ready = !!url && !!anonKey && !!adminToken && !!nonAdminToken;

async function callStatus(token) {
  return fetch(`${url}/rest/v1/rpc/get_managed_credentials_status`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
}

describe.skipIf(!ready)('Encircle managed credentials — authenticated RPC contract', () => {
  it('preserves legacy provider rows and adds only safe Encircle metadata for an admin', async () => {
    const response = await callStatus(adminToken);
    expect(response.status).toBe(200);

    const rows = await response.json();
    expect(rows.map((row) => row.provider).sort()).toEqual([
      'encircle',
      'resend',
      'stripe',
      'twilio',
    ]);

    for (const provider of ['stripe', 'twilio', 'resend']) {
      expect(rows.find((row) => row.provider === provider)).toEqual(expect.objectContaining({
        connected: expect.any(Boolean),
      }));
    }

    const encircle = rows.find((row) => row.provider === 'encircle');
    expect(encircle).toEqual(expect.objectContaining({
      managed_status: expect.stringMatching(/^(fallback|active|disabled)$/),
    }));
    expect(JSON.stringify(rows)).not.toMatch(/access_token|refresh_token|ENCIRCLE_API_KEY/i);
  });

  it('denies an authenticated non-admin', async () => {
    const response = await callStatus(nonAdminToken);
    expect(response.status).toBe(403);
  });
});
