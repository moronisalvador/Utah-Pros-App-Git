/**
 * ════════════════════════════════════════════════
 * FILE: github.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant read and act on UPR's GitHub repository from a Claude chat
 *   — list/open/merge pull requests, create branches, read and commit files (the
 *   REST equivalent of "pull" and "push"), read commits, and comment. It uses a
 *   stored access token so the browser never sees it.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ./supabase.js (reads the stored token from the DB)
 *   External API:  GitHub REST API (api.github.com)
 *   Data:          reads → integration_credentials (provider='github'),
 *                          integration_config (key='github_default_repo')
 *   Config:        token comes from integration_credentials first (set via the
 *                  admin API-keys page), else the GITHUB_TOKEN worker secret.
 *                  Default repo from integration_config → GITHUB_DEFAULT_REPO.
 *
 * NOTES / GOTCHAS:
 *   - Token is read from the DB (provider='github') like callrail.js, so it can be
 *     managed from the app's admin API-keys page; falls back to env.GITHUB_TOKEN.
 *     Returns a clear "not connected" error until one is present (dormant-safe).
 *   - A Cloudflare Worker has no git binary — "push"/"pull" here are the Contents
 *     API (commitFile / getFile) and Git-data API (createBranch), not raw git.
 *   - commitFile base64-encodes content via ghEncodeContent (UTF-8-safe); updating
 *     an existing file needs its blob `sha` (GitHub rejects a blind overwrite).
 *   - Every mutating op is a guarded [WRITE] in tools.js (previews unless confirm).
 *   - The PAT needs Contents R/W, Pull requests R/W, and Issues R/W (fine-grained),
 *     or classic `repo`.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const BASE = 'https://api.github.com';

// ─── Pure helpers (unit-tested in github.test.js) ────────────────────────────────
// UTF-8-safe base64 for the Contents API. A naive btoa() corrupts multi-byte
// characters (accents, emoji); encode to bytes first, then base64.
export function ghEncodeContent(content) {
  const bytes = new TextEncoder().encode(String(content == null ? '' : content));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return bin ? btoa(bin) : '';
}

// Validate + normalize an "owner/repo" reference. Returns the trimmed value or null.
export function parseRepoRef(value) {
  const r = (value == null ? '' : String(value)).trim();
  return /^[^/]+\/[^/]+$/.test(r) ? r : null;
}

// ─── Credential + repo resolution ────────────────────────────────────────────────
// Prefer the DB-stored token (managed on the admin API-keys page) like callrail.js;
// fall back to the worker secret. Throws a message pointing at the admin page.
async function requireToken(env) {
  try {
    const rows = await supabase(env).select('integration_credentials', 'provider=eq.github&select=access_token&limit=1');
    const dbToken = rows && rows[0] && rows[0].access_token;
    if (dbToken) return dbToken;
  } catch { /* DB unreachable — fall through to the env fallback */ }
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  throw new Error('GitHub is not connected — add a token on the admin API-keys page (/admin/integrations), or set GITHUB_TOKEN on the worker.');
}

// Resolve "owner/repo": explicit arg → integration_config('github_default_repo') → env.
async function resolveRepo(env, explicit) {
  const fromExplicit = parseRepoRef(explicit);
  if (fromExplicit) return fromExplicit;
  try {
    const rows = await supabase(env).select('integration_config', 'key=eq.github_default_repo&select=value&limit=1');
    const fromCfg = parseRepoRef(rows && rows[0] && rows[0].value);
    if (fromCfg) return fromCfg;
  } catch { /* fall through to env */ }
  const fromEnv = parseRepoRef(env.GITHUB_DEFAULT_REPO);
  if (fromEnv) return fromEnv;
  throw new Error('No repository specified — pass repo as "owner/name", or set a default on the admin API-keys page / GITHUB_DEFAULT_REPO.');
}

// Core fetch. `path` begins with '/'. Handles 204 + surfaces GitHub's error message.
async function ghFetch(env, path, options = {}) {
  const token = await requireToken(env);
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
export async function listPulls(env, { repo: r, state = 'open', per_page = 20 } = {}) {
  const qp = new URLSearchParams({ state, per_page: String(Math.min(Number(per_page) || 20, 100)), sort: 'updated', direction: 'desc' });
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/pulls?${qp.toString()}`);
}
export async function getPull(env, { repo: r, number } = {}) {
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/pulls/${encodeURIComponent(String(number))}`);
}
export async function listIssues(env, { repo: r, state = 'open', per_page = 20 } = {}) {
  const qp = new URLSearchParams({ state, per_page: String(Math.min(Number(per_page) || 20, 100)), sort: 'updated', direction: 'desc' });
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/issues?${qp.toString()}`);
}

// GET /search/code — scoped to the default repo unless the query already scopes it.
export async function searchCode(env, { q, repo: r } = {}) {
  const scoped = /\brepo:/.test(q) ? q : `${q} repo:${await resolveRepo(env, r)}`;
  return ghFetch(env, `/search/code?q=${encodeURIComponent(scoped)}&per_page=20`);
}

// POST /repos/{owner}/{repo}/issues — open an issue.
export async function createIssue(env, { repo: r, title, body, labels }) {
  const payload = { title, ...(body ? { body } : {}), ...(Array.isArray(labels) && labels.length ? { labels } : {}) };
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/issues`, { method: 'POST', body: JSON.stringify(payload) });
}

// ─── Pull-request writes ─────────────────────────────────────────────────────────
// PUT …/pulls/{n}/merge — merge a PR. merge_method: merge | squash | rebase.
export async function mergePull(env, { repo: r, number, merge_method = 'squash', commit_title, commit_message }) {
  const body = { merge_method, ...(commit_title ? { commit_title } : {}), ...(commit_message ? { commit_message } : {}) };
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/pulls/${encodeURIComponent(String(number))}/merge`, { method: 'PUT', body: JSON.stringify(body) });
}
// POST …/pulls — open a PR (head → base).
export async function createPull(env, { repo: r, title, head, base, body, draft }) {
  const payload = { title, head, base, ...(body ? { body } : {}), ...(draft != null ? { draft: !!draft } : {}) };
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/pulls`, { method: 'POST', body: JSON.stringify(payload) });
}
// PATCH …/pulls/{n} — edit a PR (title/body/base) or close/reopen (state).
export async function updatePull(env, { repo: r, number, title, body, state, base }) {
  const payload = {
    ...(title != null ? { title } : {}), ...(body != null ? { body } : {}),
    ...(state ? { state } : {}), ...(base ? { base } : {}),
  };
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/pulls/${encodeURIComponent(String(number))}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

// ─── Branches / files / commits ──────────────────────────────────────────────────
// Create a branch `branch` pointing at the tip of `from` (default the default branch's tip).
export async function createBranch(env, { repo: r, branch, from }) {
  const rr = await resolveRepo(env, r);
  const fromRef = from || 'HEAD';
  // Resolve the base sha (accepts a branch name or a full/short sha via /commits).
  const commit = await ghFetch(env, `/repos/${rr}/commits/${encodeURIComponent(fromRef)}`);
  const sha = commit && commit.sha;
  if (!sha) throw new Error(`Could not resolve a base sha for "${fromRef}".`);
  return ghFetch(env, `/repos/${rr}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
}
// GET …/contents/{path} — read a file (the "pull"). Returns GitHub's content object
// (includes base64 `content` + the blob `sha` needed to update it via commitFile).
export async function getFile(env, { repo: r, path, ref }) {
  const qp = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/contents/${path.split('/').map(encodeURIComponent).join('/')}${qp}`);
}
// PUT …/contents/{path} — create or update a file (the "push"). Pass the existing
// blob `sha` to update; omit it to create. `content` is plain text (base64 here).
export async function commitFile(env, { repo: r, path, content, message, branch, sha }) {
  const payload = {
    message: message || `Update ${path}`,
    content: ghEncodeContent(content),
    ...(branch ? { branch } : {}), ...(sha ? { sha } : {}),
  };
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function listCommits(env, { repo: r, sha, path, per_page = 20 } = {}) {
  const qp = new URLSearchParams({ per_page: String(Math.min(Number(per_page) || 20, 100)) });
  if (sha) qp.set('sha', sha);
  if (path) qp.set('path', path);
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/commits?${qp.toString()}`);
}
export async function getCommit(env, { repo: r, ref } = {}) {
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/commits/${encodeURIComponent(String(ref))}`);
}
export async function listBranches(env, { repo: r, per_page = 50 } = {}) {
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/branches?per_page=${Math.min(Number(per_page) || 50, 100)}`);
}
// POST …/issues/{n}/comments — comment on a PR or issue (PRs are issues for comments).
export async function addComment(env, { repo: r, number, body }) {
  return ghFetch(env, `/repos/${await resolveRepo(env, r)}/issues/${encodeURIComponent(String(number))}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}
