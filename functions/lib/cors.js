// CORS headers for Pages Functions
// Only needed for send-message (called from frontend)
// Twilio webhooks don't need CORS

const ALLOWED_ORIGINS = [
  'http://localhost:5173',        // Vite dev server
  'http://localhost:4173',        // Vite preview
  'https://dev.utahpros.app',     // Production domain
  'https://utah-pros-app-git.pages.dev', // Cloudflare Pages direct URL
];

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  // Allow explicit list only — never wildcard *.pages.dev
  // PAGES_URL env var can add one more origin via Cloudflare dashboard
  const pagesUrl = env.PAGES_URL || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || (pagesUrl && origin === pagesUrl);

  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
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
