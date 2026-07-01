/**
 * ════════════════════════════════════════════════
 * FILE: github-connect.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Saves (or removes) the GitHub access token that lets our internal MCP tools
 *   act on our GitHub repo — list and merge pull requests, make commits, and so
 *   on. It's just a token you copy from GitHub and paste into our admin API-keys
 *   page, so this is a simple save/status/delete endpoint (no OAuth redirect).
 *   The token is stored server-side and never sent back to the browser.
 *
 * ENDPOINT:
 *   GET    /api/github-connect   (authenticated — Supabase Bearer)
 *          → { connected: boolean, default_repo: string|null }
 *   POST   /api/github-connect   (authenticated — Supabase Bearer)
 *          body: { api_key: string, default_repo?: "owner/repo" }
 *          → { connected: true, login: string|null }
 *   DELETE /api/github-connect   (authenticated — Supabase Bearer)
 *          → { disconnected: true }
 *
 * DEPENDS ON:
 *   Packages:  none (platform fetch)
 *   Internal:  ../lib/cors.js, ../lib/supabase.js, ../lib/google-drive.js
 *              (reuses its generic getActorEmployee Bearer-token check)
 *   External:  GitHub REST API (only to validate the pasted token via /user)
 *   Data:      reads  → employees (auth), integration_credentials, integration_config
 *              writes → integration_credentials (provider='github'),
 *                        integration_config (key='github_default_repo')
 *
 * NOTES / GOTCHAS:
 *   - The token lands in integration_credentials.access_token (RLS-locked to the
 *     service role — never exposed to PostgREST or the browser). The MCP worker
 *     reads it from there (upr-mcp/src/github.js), the same way CallRail works.
 *   - POST validates the token against GitHub's /user endpoint: a 401 is rejected
 *     with a clear message; a transient/non-401 failure is tolerated (best-effort,
 *     like callrail-connect's account resolve) so a GitHub blip can't block a save.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';

const REPO_RE = /^[^/]+\/[^/]+$/;

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const [cred] = await db.select('integration_credentials', `provider=eq.github&select=access_token`);
  const [cfg] = await db.select('integration_config', `key=eq.github_default_repo&select=value`);
  return jsonResponse({ connected: !!cred?.access_token, default_repo: cfg?.value || null }, 200, request, env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const body = await request.json().catch(() => ({}));
  const apiKey = (body.api_key || '').trim();
  const defaultRepo = (body.default_repo || '').trim();

  if (defaultRepo && !REPO_RE.test(defaultRepo)) {
    return jsonResponse({ error: 'default_repo must be "owner/name"' }, 400, request, env);
  }

  // api_key is optional ONLY when a token is already saved (so the connected card
  // can change just the default repo without re-pasting the token).
  const [existing] = await db.select('integration_credentials', `provider=eq.github&select=access_token`);
  if (!apiKey && !existing?.access_token) {
    return jsonResponse({ error: 'api_key is required' }, 400, request, env);
  }
  if (!apiKey && !defaultRepo) {
    return jsonResponse({ error: 'Nothing to update' }, 400, request, env);
  }

  // Validate a newly-pasted token against GitHub. A 401 is a hard reject; other
  // failures are tolerated so a transient GitHub error can't block a good token.
  let login = null;
  if (apiKey) {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'upr-app',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (res.status === 401) return jsonResponse({ error: 'GitHub rejected that token (401). Check the token and its scopes.' }, 400, request, env);
      if (res.ok) { const u = await res.json().catch(() => ({})); login = u?.login || null; }
    } catch { /* network blip — save anyway (best-effort) */ }

    await db.upsert('integration_credentials', {
      provider: 'github',
      access_token: apiKey,
      environment: 'production',
      connected_by: employee.id,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  if (defaultRepo) {
    await db.upsert('integration_config', { key: 'github_default_repo', value: defaultRepo });
  }

  return jsonResponse({ connected: true, login }, 200, request, env);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  await db.delete('integration_credentials', `provider=eq.github`);
  return jsonResponse({ disconnected: true }, 200, request, env);
}
