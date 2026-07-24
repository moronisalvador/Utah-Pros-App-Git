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
    async upsert(table, data) {
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
      // 204 No Content is a valid success response — no body to parse
      if (res.status === 204) return null;
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

    // Raw bytes upload to Storage (e.g. a generated PDF) — the REST helpers
    // above only cover JSON bodies. Throws with a clear message if the
    // service-role key isn't configured, rather than silently no-oping.
    async uploadStorage(bucket, path, bytes, contentType) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'apikey':        key,
          'Content-Type':  contentType,
          'x-upsert':      'true',
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`Supabase STORAGE upload ${bucket}/${path}: ${res.status} ${await res.text()}`);
      return true;
    },

    async downloadStorage(bucket, path, maxBytes = 5_000_000) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${path}`, {
        headers: {
          'Authorization': `Bearer ${key}`,
          'apikey': key,
        },
      });
      if (!res.ok) {
        throw new Error(`Supabase STORAGE download ${bucket}/${path}: ${res.status}`);
      }
      const declared = Number(res.headers.get('Content-Length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new Error(`Supabase STORAGE download ${bucket}/${path}: object too large`);
      }
      if (!res.body?.getReader) throw new Error('Supabase STORAGE download returned no body');
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`Supabase STORAGE download ${bucket}/${path}: object too large`);
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        bytes,
        contentType: res.headers.get('Content-Type') || '',
      };
    },

    async signStorage(bucket, path, expiresIn = 600) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) {
        throw new Error(`Supabase STORAGE sign ${bucket}/${path}: ${res.status} ${await res.text()}`);
      }
      const data = await res.json();
      const signedPath = data.signedURL || data.signedUrl;
      if (!signedPath) throw new Error('Supabase STORAGE sign returned no URL');
      return signedPath.startsWith('http')
        ? signedPath
        : `${url}/storage/v1${signedPath.startsWith('/') ? '' : '/'}${signedPath}`;
    },
  };
}
