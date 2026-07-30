// CORS headers for Pages Functions
// Only needed for send-message (called from frontend)
// Twilio webhooks don't need CORS

const ALLOWED_ORIGINS = [
  'http://localhost:5173',        // Vite dev server
  'http://localhost:4173',        // Vite preview
  'https://dev.utahpros.app',     // Production domain
  'https://utah-pros-app-git.pages.dev', // Cloudflare Pages direct URL
  // The installed iOS app. Capacitor serves the bundled web layer from this
  // custom-scheme origin (no server.url / iosScheme is set), so every Worker
  // call from the app is CROSS-origin and needs an explicit entry. One value
  // covers both builds: the origin is a property of Capacitor, not of which
  // API host the build targets.
  //
  // NEVER add 'null' or '*' here. An opaque origin serialises as the literal
  // string "null" and any sandboxed iframe or data: document can produce it,
  // so allowlisting it would hand every hostile page the same access the app
  // has. This entry is a specific scheme+host, which a web page cannot forge.
  'capacitor://localhost',        // installed iOS app (see src/lib/nativeApiFetch.js)
];

export function corsHeaders(request, env) {
  // Optional-chained deliberately. This helper is now called by Workers that
  // build EVERY response through it, so throwing here would turn a missing
  // header into a 500 for the whole endpoint. A request with no Origin is a
  // same-origin or non-browser caller, which is exactly the "not allowed"
  // branch below — no header, and no crash.
  const origin = request?.headers?.get?.('Origin') || '';
  // Allow explicit list only — never wildcard *.pages.dev
  // PAGES_URL env var can add one more origin via Cloudflare dashboard
  const pagesUrl = env.PAGES_URL || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || (pagesUrl && origin === pagesUrl);

  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    // The body is the same per origin but this HEADER is not, so a shared cache
    // must key on Origin — otherwise a response cached for one origin can be
    // replayed to another carrying the wrong Allow-Origin.
    Vary: 'Origin',
  };
}

export function handleOptions(request, env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env),
  });
}

export function jsonResponse(data, status = 200, request = null, env = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (request && env) {
    Object.assign(headers, corsHeaders(request, env));
  }
  return new Response(JSON.stringify(data), { status, headers });
}
