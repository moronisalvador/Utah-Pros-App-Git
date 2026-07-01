/**
 * ════════════════════════════════════════════════
 * FILE: github.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant read and (carefully) act on UPR's GitHub repository from a
 *   Claude chat — list pull requests and issues, look one up, search the code, or
 *   open a new issue. It uses a stored access token so the browser never sees it.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      none
 *   External API:  GitHub REST API (api.github.com)
 *   Config:        GITHUB_TOKEN (worker secret — a PAT), optional GITHUB_DEFAULT_REPO
 *                  ("owner/repo") so repo-scoped tools default to the UPR repo
 *
 * NOTES / GOTCHAS:
 *   - Returns a clean "not configured" error until GITHUB_TOKEN is set, so the
 *     tool is dormant-safe (mirrors resend.js / encircle.js).
 *   - repo() resolves owner/repo from an explicit arg, else GITHUB_DEFAULT_REPO —
 *     so the common case ("list our PRs") needs no repo argument.
 *   - Opening an issue is a guarded [WRITE] in tools.js (previews unless confirm).
 * ════════════════════════════════════════════════
 */

const BASE = 'https://api.github.com';

function requireToken(env) {
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not configured for the MCP worker — add it as a secret (wrangler secret put GITHUB_TOKEN).');
  }
  return env.GITHUB_TOKEN;
}

// Resolve "owner/repo" from an explicit value or GITHUB_DEFAULT_REPO.
export function repo(env, explicit) {
  const r = (explicit || env.GITHUB_DEFAULT_REPO || '').trim();
  if (!/^[^/]+\/[^/]+$/.test(r)) {
    throw new Error('No repository specified — pass repo as "owner/name" or set GITHUB_DEFAULT_REPO on the MCP worker.');
  }
  return r;
}

// Core fetch. `path` begins with '/'. Handles 204 + surfaces GitHub's error message.
async function ghFetch(env, path, options = {}) {
  const token = requireToken(env);
  const res = await fetch(`${BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'upr-mcp',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    throw new Error(`GitHub ${options.method || 'GET'} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

// ─── Generic power tools (reach any endpoint) ────────────────────────────────────
export function githubGet(env, path) {
  return ghFetch(env, path);
}
export function githubRequest(env, method, path, body) {
  return ghFetch(env, path, {
    method: String(method || 'POST').toUpperCase(),
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
}

// ─── Pull requests / issues (repo-scoped) ────────────────────────────────────────
export function listPulls(env, { repo: r, state = 'open', per_page = 20 } = {}) {
  const qp = new URLSearchParams({ state, per_page: String(Math.min(Number(per_page) || 20, 100)), sort: 'updated', direction: 'desc' });
  return ghFetch(env, `/repos/${repo(env, r)}/pulls?${qp.toString()}`);
}
export function getPull(env, { repo: r, number } = {}) {
  return ghFetch(env, `/repos/${repo(env, r)}/pulls/${encodeURIComponent(String(number))}`);
}
export function listIssues(env, { repo: r, state = 'open', per_page = 20 } = {}) {
  const qp = new URLSearchParams({ state, per_page: String(Math.min(Number(per_page) || 20, 100)), sort: 'updated', direction: 'desc' });
  return ghFetch(env, `/repos/${repo(env, r)}/issues?${qp.toString()}`);
}

// GET /search/code — scoped to the default repo unless the query already scopes it.
export function searchCode(env, { q, repo: r } = {}) {
  const scoped = /\brepo:/.test(q) ? q : `${q} repo:${repo(env, r)}`;
  return ghFetch(env, `/search/code?q=${encodeURIComponent(scoped)}&per_page=20`);
}

// POST /repos/{owner}/{repo}/issues — open an issue.
export function createIssue(env, { repo: r, title, body, labels }) {
  const payload = { title, ...(body ? { body } : {}), ...(Array.isArray(labels) && labels.length ? { labels } : {}) };
  return ghFetch(env, `/repos/${repo(env, r)}/issues`, { method: 'POST', body: JSON.stringify(payload) });
}
