// Bearer-token auth for the public read-only API (/api/v1/*).
// Compares Authorization: Bearer <token> against env.API_KEY.
//
// Returns null on success, or a Response (401) on failure — caller pattern:
//   const fail = requireApiKey(request, env);
//   if (fail) return fail;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function requireApiKey(request, env) {
  const expected = env.API_KEY;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: 'API not configured: API_KEY env var is missing' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const provided = match ? match[1].trim() : '';

  if (!provided || !timingSafeEqual(provided, expected)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: provide Authorization: Bearer <API_KEY>' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }
  return null;
}

export function apiJson(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function apiError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}
