// Encircle API layer for the MCP worker.
// Read-only access to Encircle property claims so reconciliation can recover the
// TRUE claim-filed date (created_at) that the UPR import never persisted
// (jobs.encircle_created_at is null on imported jobs). Auth reuses the SAME token
// the Cloudflare workers use: Bearer ENCIRCLE_API_KEY (set as an MCP worker
// secret). Base: https://api.encircleapp.com — see ENCIRCLE_API_REFERENCE.md.

const BASE = 'https://api.encircleapp.com';

async function encircleFetch(env, path) {
  if (!env.ENCIRCLE_API_KEY) {
    throw new Error('ENCIRCLE_API_KEY is not configured for the MCP worker — add it as a secret (wrangler secret put ENCIRCLE_API_KEY).');
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${env.ENCIRCLE_API_KEY}`,
      'Accept': 'application/json',
      'X-Encircle-Attribution': 'UtahProsRestorationApp',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data).slice(0, 300);
    throw new Error(`Encircle ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

// GET /v1/property_claims/{id} — full claim incl. created_at (the date the claim
// was filed in Encircle), date_of_loss, status, full_address, policyholder, etc.
export async function encircleGetClaim(env, claimId) {
  return encircleFetch(env, `/v1/property_claims/${encodeURIComponent(String(claimId))}`);
}

// GET /v1/property_claims — recent claims, newest first.
export async function encircleListClaims(env, { limit = 50, order = 'newest' } = {}) {
  const qs = new URLSearchParams({ limit: String(Math.min(Number(limit) || 50, 100)), order }).toString();
  const data = await encircleFetch(env, `/v1/property_claims?${qs}`);
  return Array.isArray(data) ? data : (data.list || data.property_claims || data.results || data.claims || data.data || []);
}
