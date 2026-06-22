// Default handler — the OAuth "login" side of the MCP server.
// Federates the MCP-client authorization to Google, then hard-checks that the
// signed-in Google account matches ALLOWED_EMAIL before issuing any grant.
// (This is layer 1: you -> the MCP server. Layer 2, the server -> QBO, reuses
// UPR's existing connection and needs no login here.)

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

const b64urlEncode = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));

const page = (title, body, status = 200) =>
  new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#111"><h1 style="font-size:1.25rem">${title}</h1>${body}</body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export const authHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const redirectUri = new URL('/callback', url.origin).toString();

    // ── /authorize : begin the flow, bounce the user to Google ──────────────
    if (url.pathname === '/authorize') {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const g = new URL(GOOGLE_AUTH);
      g.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      g.searchParams.set('redirect_uri', redirectUri);
      g.searchParams.set('response_type', 'code');
      g.searchParams.set('scope', 'openid email profile');
      g.searchParams.set('state', b64urlEncode(oauthReqInfo));
      g.searchParams.set('access_type', 'online');
      g.searchParams.set('prompt', 'select_account');
      return Response.redirect(g.toString(), 302);
    }

    // ── /callback : verify the Google identity, then complete authorization ──
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) return page('Sign-in error', '<p>Missing authorization code.</p>', 400);

      let oauthReqInfo;
      try { oauthReqInfo = b64urlDecode(state); }
      catch { return page('Sign-in error', '<p>Invalid state.</p>', 400); }

      const tokenRes = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri, grant_type: 'authorization_code',
        }).toString(),
      });
      if (!tokenRes.ok) return page('Sign-in error', '<p>Google token exchange failed.</p>', 502);
      const tok = await tokenRes.json();

      const uiRes = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (!uiRes.ok) return page('Sign-in error', '<p>Could not read Google profile.</p>', 502);
      const ui = await uiRes.json();

      const email = String(ui.email || '').toLowerCase();
      const allowed = String(env.ALLOWED_EMAIL || '').toLowerCase();
      if (!ui.email_verified || !allowed || email !== allowed) {
        return page('Access denied', `<p>This connector is private. <code>${email || 'that account'}</code> is not authorized.</p>`, 403);
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: email,
        scope: oauthReqInfo.scope,
        metadata: { label: email },
        props: { email },
      });
      return Response.redirect(redirectTo, 302);
    }

    // ── / : info page ───────────────────────────────────────────────────────
    return page('UPR MCP', '<p>Private MCP server for UPR (QuickBooks Online + the UPR database). Add it as a custom connector in Claude; access is locked to the owner account.</p>');
  },
};
