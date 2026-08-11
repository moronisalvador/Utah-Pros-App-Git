/**
 * ════════════════════════════════════════════════
 * FILE: supabase.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the owner-only MCP worker its protected database connection. Callers
 *   can supply a time-limited network function for sensitive provider work.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads/writes → caller-selected Supabase resources
 *
 * NOTES / GOTCHAS:
 *   - The service-role key bypasses row security; OAuth, audit, and the worker
 *     kill switch must gate every caller.
 * ════════════════════════════════════════════════
 */

export function supabase(env, fetchImpl = fetch) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  return {
    async select(table, query = '') {
      const res = await fetchImpl(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`Supabase SELECT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async insert(table, data) {
      const res = await fetchImpl(`${url}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify(data) });
      if (!res.ok) throw new Error(`Supabase INSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async update(table, filter, data) {
      const res = await fetchImpl(`${url}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers, body: JSON.stringify(data) });
      if (!res.ok) throw new Error(`Supabase UPDATE ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async upsert(table, data) {
      const res = await fetchImpl(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Supabase UPSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async delete(table, filter) {
      const res = await fetchImpl(`${url}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(`Supabase DELETE ${table}: ${res.status} ${await res.text()}`);
      if (res.status === 204) return null;
      return res.json();
    },
    async rpc(fn, params = {}) {
      const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(params) });
      if (!res.ok) throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
      if (res.status === 204) return null;
      return res.json();
    },
    // PostgREST OpenAPI root — enumerates every exposed table and RPC. Lets the
    // MCP self-describe the UPR database from a fresh chat (no external context).
    async openapi() {
      const res = await fetchImpl(`${url}/rest/v1/`, { headers });
      if (!res.ok) throw new Error(`Supabase OpenAPI: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}
