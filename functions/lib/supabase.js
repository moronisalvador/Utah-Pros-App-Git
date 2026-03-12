// Supabase REST helper for Cloudflare Workers
// No SDK — pure fetch(), works in V8 isolates

export function supabase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  return {
    // SELECT — returns array of rows
    async select(table, query = '') {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`Supabase SELECT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // INSERT — returns inserted row(s)
    async insert(table, data) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Supabase INSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // UPDATE — filter is PostgREST query string, e.g. "id=eq.abc-123"
    async update(table, filter, data) {
      const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Supabase UPDATE ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // UPSERT — insert or update on conflict
    async upsert(table, data, onConflict) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Prefer': 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Supabase UPSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // DELETE
    async delete(table, filter) {
      const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error(`Supabase DELETE ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // RPC — call a Postgres function
    async rpc(fn, params = {}) {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}
