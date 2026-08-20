/**
 * ════════════════════════════════════════════════
 * FILE: supabase.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Provides the server-only REST, RPC, Auth and private Storage operations
 *   Cloudflare Pages Functions use with the Supabase service-role credential.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads/writes → caller-selected Supabase resources
 *
 * NOTES / GOTCHAS:
 *   - No SDK: every operation uses fetch and throws on a non-success response.
 *   - Routes may inject fetchWithTimeout; existing callers default to the
 *     platform fetch implementation.
 *   - Never import this service-role helper into browser code.
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
    // SELECT — returns array of rows
    async select(table, query = '') {
      const res = await fetchImpl(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`Supabase SELECT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // INSERT — returns inserted row(s)
    async insert(table, data) {
      const res = await fetchImpl(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Supabase INSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // UPDATE — filter is PostgREST query string, e.g. "id=eq.abc-123"
    async update(table, filter, data) {
      const res = await fetchImpl(`${url}/rest/v1/${table}?${filter}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Supabase UPDATE ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    // UPSERT — insert or update on conflict
    async upsert(table, data) {
      const res = await fetchImpl(`${url}/rest/v1/${table}`, {
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
      const res = await fetchImpl(`${url}/rest/v1/${table}?${filter}`, {
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
      const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
      // A `RETURNS void` function answers 204 No Content with an EMPTY body and
      // res.json() throws on that — AFTER the function has already committed. The
      // caller's catch then reports failure for work that actually succeeded: on
      // 2026-08-20 the owner paused a contractor's request, the row was written,
      // and the dashboard showed a 503. Five worker-called RPCs return void
      // (contractor_compliance_mutate_request, _mutate_profile_requests,
      // _set_profile_active, _append_activity, record_email_campaign_send), so
      // Pause, Resume, Revoke link, Add note and Set active all did this.
      // `delete` above already carried this guard; it was never generalized.
      // Minimal on purpose: 204 only, exactly matching `delete` above. This is a
      // shared client behind every worker, and anything wider would change the
      // contract for ~122 RPC call sites to fix a bug that is specifically 204.
      if (res.status === 204) return null;
      return res.json();
    },

    // Raw bytes upload to Storage (e.g. a generated PDF) — the REST helpers
    // above only cover JSON bodies. Throws with a clear message if the
    // service-role key isn't configured, rather than silently no-oping.
    async uploadStorage(bucket, path, bytes, contentType, { upsert = true } = {}) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const res = await fetchImpl(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'apikey':        key,
          'Content-Type':  contentType,
          'x-upsert':      String(upsert),
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`Supabase STORAGE upload ${bucket}/${path}: ${res.status} ${await res.text()}`);
      return true;
    },

    // Best-effort compensation for a metadata failure after a new private
    // upload. Callers must pass a server-generated, already-authorized path;
    // this is intentionally not exposed to browser code.
    async deleteStorage(bucket, path) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const res = await fetchImpl(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${key}`, apikey: key },
      });
      if (!res.ok) throw new Error(`Supabase STORAGE delete ${bucket}: ${res.status}`);
      return true;
    },

    async downloadStorage(bucket, path, maxBytes = 5_000_000) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const res = await fetchImpl(`${url}/storage/v1/object/authenticated/${bucket}/${path}`, {
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

    async signStorage(bucket, path, expiresIn = 600, { download = false } = {}) {
      if (!key) throw new Error('Supabase service-role key not configured');
      const signBody = download ? { expiresIn, download } : { expiresIn };
      const res = await fetchImpl(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(signBody),
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
