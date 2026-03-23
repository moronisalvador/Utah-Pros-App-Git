// Supabase REST client for frontend
// Uses anon key — matches existing UPR pattern (no SDK for data ops)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const TIMEOUT_MS = 30000; // 30 seconds — field techs on weak signal need time, but not forever

function getHeaders(token) {
  const h = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
  h['Authorization'] = `Bearer ${token || SUPABASE_ANON_KEY}`;
  return h;
}

// Wraps fetch with an AbortController timeout.
// Throws a clear "Request timed out" error instead of hanging forever.
function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .then(res => { clearTimeout(timer); return res; })
    .catch(err => {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out. Check your connection and try again.');
      throw err;
    });
}

export function createSupabaseClient(token) {
  const headers = getHeaders(token);

  return {
    async select(table, query = '') {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SELECT ${table}: ${res.status} ${text}`);
      }
      return res.json();
    },

    async insert(table, data) {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, {
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
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
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
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DELETE ${table}: ${res.status} ${text}`);
      }
      // 204 No Content is a valid success response — no body to parse
      if (res.status === 204) return null;
      return res.json();
    },

    async rpc(fn, params = {}) {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
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

    // Expose for direct storage fetches (file upload/delete in JobPage)
    baseUrl: SUPABASE_URL,
    apiKey: token || SUPABASE_ANON_KEY,
  };
}

// Singleton for unauthenticated requests (bootstrapping, public reads)
export const db = createSupabaseClient();
