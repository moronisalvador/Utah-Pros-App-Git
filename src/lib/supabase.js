// Supabase REST client for frontend
// Uses anon key — matches existing UPR pattern (no SDK for data ops)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function getHeaders(token) {
  const h = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  // Use user JWT if available, fall back to anon key
  h['Authorization'] = `Bearer ${token || SUPABASE_ANON_KEY}`;
  return h;
}

export function createSupabaseClient(token) {
  const headers = getHeaders(token);

  return {
    // Expose base URL and key for direct Storage API calls (file uploads)
    baseUrl: SUPABASE_URL,
    apiKey: token || SUPABASE_ANON_KEY,

    async select(table, query = '') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SELECT ${table}: ${res.status} ${text}`);
      }
      return res.json();
    },

    async insert(table, data) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`INSERT ${table}: ${res.status} ${text}`);
      }
      return res.json();
    },

    async update(table, filter, data) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`UPDATE ${table}: ${res.status} ${text}`);
      }
      return res.json();
    },

    async delete(table, filter) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DELETE ${table}: ${res.status} ${text}`);
      }
      return res.json();
    },

    async rpc(fn, params = {}) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`RPC ${fn}: ${res.status} ${text}`);
      }
      return res.json();
    },
  };
}

// Singleton for unauthenticated requests (bootstrapping, public reads)
export const db = createSupabaseClient();
