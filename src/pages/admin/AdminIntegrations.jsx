/**
 * ════════════════════════════════════════════════
 * FILE: AdminIntegrations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The admin "API Keys" page. This is where an admin pastes the access keys
 *   that power our internal automation tools — starting with GitHub, so the
 *   assistant can list, merge, and comment on our code without anyone touching
 *   the command line. You paste a key, it's saved securely on the server, and
 *   the page shows whether each service is connected. Keys are never shown back
 *   to the browser.
 *
 * WHERE IT LIVES:
 *   Route:        /admin/integrations   (admin-only — see AdminRoute in App.jsx)
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/realtime (getAuthHeader — authenticated worker calls)
 *   Data:      reads/writes → integration_credentials + integration_config, but
 *              only via the /api/github-connect worker (service-role) — the
 *              frontend never touches those RLS-locked tables directly.
 *
 * NOTES / GOTCHAS:
 *   - Built as a list of provider cards so more services (Stripe, Twilio, …) can
 *     be added later. GitHub is the only card today.
 *   - The GitHub token needs Contents R/W, Pull requests R/W, and Issues R/W
 *     (fine-grained), or classic `repo`, to cover merge/commit/comment.
 *   - Disconnect is an inline two-click confirm (no modal, no confirm()).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { getAuthHeader } from '@/lib/realtime';

function ok(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } })); }
function err(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } })); }

// ─── SECTION: GitHub card ──────────────
function GitHubCard() {
  const [status, setStatus] = useState(null); // { connected, default_repo }
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const connected = !!status?.connected;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/github-connect', { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setStatus(data);
      setRepo(data.default_repo || '');
    } catch (e) {
      err('Failed to load GitHub status: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // POST the token (and/or default repo). When already connected, a token-less
  // POST updates only the default repo.
  const save = async ({ withToken }) => {
    const body = {};
    if (withToken) body.api_key = token.trim();
    if (repo.trim()) body.default_repo = repo.trim();
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/github-connect', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok(withToken ? `GitHub connected${data.login ? ' as ' + data.login : ''}` : 'Default repo saved');
      setToken('');
      await load();
    } catch (e) {
      err('Could not save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirmingDisconnect) { setConfirmingDisconnect(true); return; }
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/github-connect', { method: 'DELETE', headers: auth });
      if (!res.ok) throw new Error(res.statusText);
      ok('GitHub disconnected');
      setConfirmingDisconnect(false);
      await load();
    } catch (e) {
      err('Could not disconnect: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="crm-integration-card">
      <div className="crm-integration-card-head">
        <div className="crm-integration-card-title">
          <span className="crm-integration-badge">GH</span>
          GitHub
        </div>
        <span className={`crm-integration-status${connected ? ' connected' : ''}`}>
          {loading ? '…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="crm-integration-card-body">
        {connected ? (
          <>
            <label className="crm-integration-label" htmlFor="github-default-repo">Default repository</label>
            <div className="crm-integration-connect-row">
              <input
                id="github-default-repo"
                className="crm-integration-input"
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo"
              />
              <button className="crm-btn crm-btn-ghost" onClick={() => save({ withToken: false })} disabled={saving || !repo.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="crm-integration-meta">A token is saved. Paste a new one below to replace it.</p>
            <label className="crm-integration-label" htmlFor="github-token-replace">Replace token</label>
            <div className="crm-integration-connect-row">
              <input
                id="github-token-replace"
                className="crm-integration-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste a new GitHub token"
              />
              <button className="crm-btn crm-btn-primary" onClick={() => save({ withToken: true })} disabled={saving || !token.trim()}>
                {saving ? 'Saving…' : 'Replace'}
              </button>
            </div>
            <button
              className={`crm-btn${confirmingDisconnect ? ' crm-btn-danger' : ' crm-btn-ghost'}`}
              onClick={disconnect}
              onBlur={() => setConfirmingDisconnect(false)}
              disabled={saving}
            >
              {confirmingDisconnect ? 'Confirm disconnect?' : 'Disconnect'}
            </button>
          </>
        ) : (
          <>
            <label className="crm-integration-label" htmlFor="github-token">
              Personal access token (needs Contents R/W, Pull requests R/W, Issues R/W)
            </label>
            <div className="crm-integration-connect-row">
              <input
                id="github-token"
                className="crm-integration-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste GitHub token"
              />
              <button className="crm-btn crm-btn-primary" onClick={() => save({ withToken: true })} disabled={saving || !token.trim()}>
                {saving ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <label className="crm-integration-label" htmlFor="github-repo-initial">Default repository (optional)</label>
            <input
              id="github-repo-initial"
              className="crm-integration-input"
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── SECTION: Page ──────────────
export default function AdminIntegrations() {
  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">API Keys</h1>
        <p className="crm-page-subtitle">Connect the services our internal automation tools use. Keys are stored securely and never shown again.</p>
      </div>

      <div className="crm-integration-grid">
        <GitHubCard />
      </div>
    </div>
  );
}
