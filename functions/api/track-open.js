// GET /api/track-open?t=<token>
// Called when the email client loads the tracking pixel.
// Updates sign_requests: records first open timestamp + increments open count.
// Returns a 1x1 transparent PNG — must respond fast and never error visibly.

// 1x1 transparent PNG (base64) — smallest valid PNG
const PIXEL_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PIXEL_BUF = Uint8Array.from(atob(PIXEL_B64), c => c.charCodeAt(0));

export async function onRequestGet(context) {
  const { request, env } = context;

  // Always return the pixel — even on errors, so image tags don't break
  const pixelResponse = () => new Response(PIXEL_BUF, {
    status: 200,
    headers: {
      'Content-Type':  'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma':        'no-cache',
      'Expires':       '0',
      // Allow cross-origin (email clients load from different origins)
      'Access-Control-Allow-Origin': '*',
    },
  });

  try {
    const url   = new URL(request.url);
    const token = url.searchParams.get('t');
    if (!token) return pixelResponse();

    const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return pixelResponse();

    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    };

    // Fetch sign request by token to get its ID
    const srRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sign_requests?token=eq.${encodeURIComponent(token)}&select=id,email_opened_at&limit=1`,
      { headers }
    );
    if (!srRes.ok) return pixelResponse();
    const rows = await srRes.json();
    if (!rows?.length) return pixelResponse();

    const sr  = rows[0];
    const now = new Date().toISOString();

    // Update: set first-open timestamp (only if not already set) + always increment count
    const patch = {
      email_open_count: sr.email_open_count + 1, // raw increment safe here — single row
      updated_at: now,
    };
    if (!sr.email_opened_at) {
      patch.email_opened_at = now;
    }

    // Fire-and-forget style — don't await to keep response fast
    fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${sr.id}`, {
      method:  'PATCH',
      headers,
      body:    JSON.stringify(patch),
    }).catch(() => {});

  } catch (e) {
    console.error('track-open error:', e.message);
  }

  return pixelResponse();
}
