// GET /api/track-open?t={token}
// Called by the 1x1 tracking pixel embedded in esign emails.
// Updates email_opened_at + email_open_count on sign_requests.
// Returns a 1x1 transparent GIF — must respond quickly so email clients don't time out.

const TRANSPARENT_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url   = new URL(request.url);
  const token = url.searchParams.get('t');

  // Always return the pixel regardless of whether the update succeeds
  const gif = () => new Response(
    Uint8Array.from(atob(TRANSPARENT_GIF), c => c.charCodeAt(0)),
    {
      status: 200,
      headers: {
        'Content-Type':  'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma':        'no-cache',
      },
    }
  );

  if (!token) return gif();

  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) return gif();

  try {
    // Increment open count and set first-open timestamp atomically via RPC
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_email_open`, {
      method:  'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });
  } catch (err) {
    // Silent fail — never block the pixel response
    console.error('track-open error:', err);
  }

  return gif();
}
