/**
 * ════════════════════════════════════════════════
 * FILE: Integrations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Settings → Connections page. This is the ONE place to find every
 *   outside service the whole company connects to. Some are managed right here
 *   (GitHub, QuickBooks Online, Deepgram — paste a key / sign in and you're
 *   connected). Others live on their own page but show a live status here with
 *   a link out to where they're managed (the CRM ad/call channels, Stripe
 *   payments, and each person's Google Drive & Calendar). It also shows whether
 *   text messaging is in live or dry-run mode. Keys are stored securely on the
 *   server and never shown back to the browser.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/integrations   (admin-only — see AdminRoute in App.jsx)
 *   Rendered by:  src/App.jsx (inside the Settings hub)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (Link — cross-links to the pages that
 *              own the "managed elsewhere" connections)
 *   Internal:  @/contexts/AuthContext (useAuth → db.rpc for status/stats +
 *              isFeatureEnabled for the Twilio send-mode flag),
 *              @/lib/realtime (getAuthHeader — authenticated worker calls),
 *              @/components/settings/SettingsPageHeader
 *   Data:      reads/writes → integration_credentials + integration_config, but
 *              only via workers (/api/github-connect, /api/deepgram-connect,
 *              /api/quickbooks-connect, /api/qbo-sync-customer) and SECURITY
 *              DEFINER RPCs (get_integration_status, get_qbo_sync_stats) — the
 *              frontend never touches those RLS-locked tables directly.
 *
 * NOTES / GOTCHAS:
 *   - After Intuit authorizes, /api/quickbooks-callback redirects the browser
 *     back HERE with ?qbo=connected|error|badstate (retargeted from the retired
 *     /dev-tools tab in the same PR). qboReturnToast() maps that param to a
 *     toast; the URL is then cleaned so a refresh doesn't re-fire it.
 *   - GitHub / Deepgram disconnect is an inline two-click confirm (no modal, no
 *     confirm()).
 *   - "Managed elsewhere" cards are READ-ONLY status + a cross-link — they never
 *     move a connection out of its home (Stripe stays on Payments, Google Drive
 *     & Calendar stays per-user on My Account, the CRM channels stay in the CRM).
 *   - Google Drive & Calendar is a PER-USER OAuth connection (user_google_accounts,
 *     not integration_credentials), so it deliberately shows no company-wide
 *     "connected" pill — that would misreport one person's link as everyone's.
 *   - De-CRM'd: this page uses design-system classes (.card / .btn / .input)
 *     plus .settings-int-* polish classes (index.css §P2 + §P8), not the crm-* set.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

function ok(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } })); }
function err(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } })); }

// ─── Helpers ──────────────

// Maps the QuickBooks OAuth return param (?qbo=…) to a toast. Pure + exported so
// the round-trip contract is unit-tested alongside the worker's redirect target.
// Returns null when there's no qbo param to surface.
// eslint-disable-next-line react-refresh/only-export-components
export function qboReturnToast(search) {
  const params = new URLSearchParams(search || '');
  const qbo = params.get('qbo');
  if (!qbo) return null;
  if (qbo === 'connected') return { type: 'success', message: 'QuickBooks connected' };
  if (qbo === 'badstate')  return { type: 'error', message: 'QuickBooks connect failed: state mismatch — try again' };
  return { type: 'error', message: 'QuickBooks connect failed' + (params.get('msg') ? `: ${params.get('msg')}` : '') };
}

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—';

// ─── GitHub card ──────────────
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
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className="settings-int-badge settings-int-badge--github">GH</span>
          <div>
            <div className="settings-int-name">GitHub</div>
            <div className="settings-int-sub">Code automation — list, merge &amp; comment</div>
          </div>
        </div>
        <span className={`settings-int-pill${connected ? ' settings-int-pill--on' : ''}`}>
          {loading ? '…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="settings-int-body">
        {connected ? (
          <>
            <label className="label" htmlFor="github-default-repo">Default repository</label>
            <div className="settings-int-row">
              <input
                id="github-default-repo"
                className="input"
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo"
              />
              <button className="btn btn-secondary" onClick={() => save({ withToken: false })} disabled={saving || !repo.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="settings-int-meta">A token is saved. Paste a new one below to replace it.</p>
            <label className="label" htmlFor="github-token-replace">Replace token</label>
            <div className="settings-int-row">
              <input
                id="github-token-replace"
                className="input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste a new GitHub token"
              />
              <button className="btn btn-primary" onClick={() => save({ withToken: true })} disabled={saving || !token.trim()}>
                {saving ? 'Saving…' : 'Replace'}
              </button>
            </div>
            <button
              className={`btn btn-sm settings-int-disconnect${confirmingDisconnect ? ' settings-int-disconnect--armed' : ''}`}
              onClick={disconnect}
              onBlur={() => setConfirmingDisconnect(false)}
              disabled={saving}
            >
              {confirmingDisconnect ? 'Confirm disconnect?' : 'Disconnect'}
            </button>
          </>
        ) : (
          <>
            <label className="label" htmlFor="github-token">
              Personal access token (needs Contents R/W, Pull requests R/W, Issues R/W)
            </label>
            <div className="settings-int-row">
              <input
                id="github-token"
                className="input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste GitHub token"
              />
              <button className="btn btn-primary" onClick={() => save({ withToken: true })} disabled={saving || !token.trim()}>
                {saving ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <label className="label" htmlFor="github-repo-initial">Default repository (optional)</label>
            <input
              id="github-repo-initial"
              className="input"
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

// ─── QuickBooks card ──────────────
// Behavior-identical port of the retired DevTools → Integrations tab: same RPCs
// (get_integration_status / get_qbo_sync_stats), same workers
// (/api/quickbooks-connect, /api/qbo-sync-customer), same ?qbo= return handling.
function QuickBooksCard() {
  const { db } = useAuth();
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, sx] = await Promise.all([
        db.rpc('get_integration_status', { p_provider: 'quickbooks' }),
        db.rpc('get_qbo_sync_stats'),
      ]);
      setStatus(Array.isArray(st) ? st[0] : st);
      setStats(Array.isArray(sx) ? sx[0] : sx);
    } catch {
      err('Failed to load integration status');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // Surface the OAuth result (?qbo=connected|error|badstate) then clean the URL.
  useEffect(() => {
    const toast = qboReturnToast(window.location.search);
    if (!toast) return;
    (toast.type === 'success' ? ok : err)(toast.message);
    const params = new URLSearchParams(window.location.search);
    params.delete('qbo'); params.delete('msg');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
    load();
  }, [load]);

  const connect = async () => {
    setConnecting(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/quickbooks-connect', { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || res.statusText);
      window.location.href = data.url;
    } catch (e) {
      err('Could not start QuickBooks connect: ' + e.message);
      setConnecting(false);
    }
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/qbo-sync-customer', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ backfill: true, dry_run: true, limit: 100 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPreviewResult(data);
      ok(`Preview: would create ${data.would_create ?? 0}, link ${data.would_link ?? 0}`);
    } catch (e) {
      err('Preview failed: ' + e.message);
    } finally {
      setPreviewing(false);
    }
  };

  const backfill = async () => {
    setSyncing(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/qbo-sync-customer', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ backfill: true, limit: 100 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      const created = data.created ?? 0, linked = data.linked ?? 0;
      ok(`Synced ${data.synced ?? 0} (${created} created, ${linked} linked)` + (data.errored ? ` · ${data.errored} failed` : ''));
      setPreviewResult(null);
      load();
    } catch (e) {
      err('Backfill failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const connected = !!status?.connected;

  // ─── SECTION: Render ──────────────
  return (
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className="settings-int-badge settings-int-badge--qb">qb</span>
          <div>
            <div className="settings-int-name">
              QuickBooks Online
              {connected && status.environment === 'sandbox' && (
                <span className="settings-int-sandbox">SANDBOX</span>
              )}
            </div>
            <div className="settings-int-sub">
              {loading ? 'Loading…' : connected ? (status.company_name || 'Connected') : 'Sync new contacts to QBO as customers'}
            </div>
          </div>
        </div>
        <span className={`settings-int-pill${connected ? ' settings-int-pill--on' : ''}`}>
          {loading ? '…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="settings-int-body">
        <div className="settings-int-stats">
          <div className="settings-int-stat">
            <div className="settings-int-stat-value settings-int-stat-value--ok">{stats?.synced ?? 0}</div>
            <div className="settings-int-stat-label">Synced</div>
          </div>
          <div className="settings-int-stat">
            <div className="settings-int-stat-value settings-int-stat-value--warn">{stats?.pending ?? 0}</div>
            <div className="settings-int-stat-label">Pending</div>
          </div>
          <div className="settings-int-stat">
            <div className={`settings-int-stat-value${Number(stats?.errored) > 0 ? ' settings-int-stat-value--err' : ''}`}>{stats?.errored ?? 0}</div>
            <div className="settings-int-stat-label">Errors</div>
          </div>
        </div>

        {connected && (
          <p className="settings-int-meta">Connected {fmtDate(status.connected_at)} · token refreshes automatically</p>
        )}

        <div className="settings-int-actions">
          <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
            {connecting ? 'Opening QuickBooks…' : connected ? 'Reconnect' : 'Connect QuickBooks'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={preview} disabled={!connected || previewing}>
            {previewing ? 'Previewing…' : 'Preview sync'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={backfill} disabled={!connected || syncing}>
            {syncing ? 'Syncing…' : 'Sync existing customers'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => load()} disabled={loading}>Refresh</button>
        </div>

        {previewResult && (
          <div className="settings-int-preview">
            <div className="settings-int-preview-head">
              <div className="settings-int-preview-title">
                Dry run · would <span className="settings-int-t-warn">create {previewResult.would_create ?? 0}</span> · <span className="settings-int-t-ok">link {previewResult.would_link ?? 0}</span>
              </div>
              <button className="settings-int-preview-dismiss" onClick={() => setPreviewResult(null)}>Dismiss</button>
            </div>
            <div className="settings-int-preview-list">
              {(previewResult.results || []).filter(r => !r.skipped).map((r, i) => (
                <div key={r.id || i} className="settings-int-preview-row">
                  <span className="settings-int-preview-name">{r.name || r.id}</span>
                  {r.error ? (
                    <span className="settings-int-tag settings-int-tag--err">error</span>
                  ) : r.action === 'link' ? (
                    <span className="settings-int-tag settings-int-tag--ok">link · {r.matched_by}</span>
                  ) : (
                    <span className="settings-int-tag settings-int-tag--warn">create</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!connected && !loading && (
          <div className="settings-int-note">
            Needs Cloudflare env vars (<code>QBO_CLIENT_ID</code>, <code>QBO_CLIENT_SECRET</code>, <code>QBO_REDIRECT_URI</code>, <code>QBO_WEBHOOK_SECRET</code>) and the Intuit app redirect URI pointing at <code>/api/quickbooks-callback</code>. Setup steps are in UPR-Web-Context.md.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Deepgram card ──────────────
// App-managed API key (integration_credentials, provider='deepgram') read by the
// transcribe workers (transcribe-call.js / callrail-webhook.js). Same
// connect/status/disconnect shape as GitHubCard — a pasted key, no OAuth flow.
function DeepgramCard() {
  const [status, setStatus] = useState(null); // { connected, connected_at }
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const connected = !!status?.connected;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/deepgram-connect', { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setStatus(data);
    } catch (e) {
      err('Failed to load Deepgram status: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/deepgram-connect', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: token.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok(connected ? 'Deepgram key replaced' : 'Deepgram connected');
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
      const res = await fetch('/api/deepgram-connect', { method: 'DELETE', headers: auth });
      if (!res.ok) throw new Error(res.statusText);
      ok('Deepgram disconnected');
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
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className="settings-int-badge settings-int-badge--deepgram">dg</span>
          <div>
            <div className="settings-int-name">Deepgram</div>
            <div className="settings-int-sub">Call transcription &amp; speaker labels</div>
          </div>
        </div>
        <span className={`settings-int-pill${connected ? ' settings-int-pill--on' : ''}`}>
          {loading ? '…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="settings-int-body">
        {connected ? (
          <>
            <p className="settings-int-meta">
              {status.connected_at ? `Connected ${fmtDate(status.connected_at)} · ` : ''}
              A key is saved. Paste a new one below to replace it.
            </p>
            <label className="label" htmlFor="deepgram-token-replace">Replace API key</label>
            <div className="settings-int-row">
              <input
                id="deepgram-token-replace"
                className="input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste a new Deepgram API key"
              />
              <button className="btn btn-primary" onClick={save} disabled={saving || !token.trim()}>
                {saving ? 'Saving…' : 'Replace'}
              </button>
            </div>
            <button
              className={`btn btn-sm settings-int-disconnect${confirmingDisconnect ? ' settings-int-disconnect--armed' : ''}`}
              onClick={disconnect}
              onBlur={() => setConfirmingDisconnect(false)}
              disabled={saving}
            >
              {confirmingDisconnect ? 'Confirm disconnect?' : 'Disconnect'}
            </button>
          </>
        ) : (
          <>
            <label className="label" htmlFor="deepgram-token">Deepgram API key</label>
            <div className="settings-int-row">
              <input
                id="deepgram-token"
                className="input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste Deepgram API key"
              />
              <button className="btn btn-primary" onClick={save} disabled={saving || !token.trim()}>
                {saving ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <p className="settings-int-meta">Powers automatic transcripts on the CRM Call Log. Create a key in the Deepgram console.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Status + cross-link card ──────────────
// Read-only. Reads get_integration_status for one or more providers and links
// OUT to the page that actually manages the connection — it never moves a
// connection out of its home. `providers` is [{ key, label }].
function StatusLinkCard({ badge, badgeClass, name, sub, providers, linkTo, linkLabel }) {
  const { db } = useAuth();
  const [statuses, setStatuses] = useState(null); // key → connected boolean
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await Promise.all(
        providers.map((p) => db.rpc('get_integration_status', { p_provider: p.key })),
      );
      const map = {};
      providers.forEach((p, i) => {
        const st = Array.isArray(rows[i]) ? rows[i][0] : rows[i];
        map[p.key] = !!st?.connected;
      });
      setStatuses(map);
    } catch {
      setStatuses(null);
    } finally {
      setLoading(false);
    }
  }, [db, providers]);

  useEffect(() => { load(); }, [load]);

  const connectedCount = statuses ? providers.filter((p) => statuses[p.key]).length : 0;
  const allConnected = connectedCount === providers.length;
  const pillText = loading
    ? '…'
    : providers.length > 1
      ? `${connectedCount} of ${providers.length}`
      : (allConnected ? 'Connected' : 'Not connected');

  return (
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className={`settings-int-badge ${badgeClass}`}>{badge}</span>
          <div>
            <div className="settings-int-name">{name}</div>
            <div className="settings-int-sub">{sub}</div>
          </div>
        </div>
        <span className={`settings-int-pill${!loading && connectedCount > 0 ? ' settings-int-pill--on' : ''}`}>
          {pillText}
        </span>
      </div>

      <div className="settings-int-body">
        <ul className="settings-int-statuslist">
          {providers.map((p) => (
            <li key={p.key} className="settings-int-statusrow">
              <span className="settings-int-statusname">{p.label}</span>
              <span className={`settings-int-dot${!loading && statuses?.[p.key] ? ' settings-int-dot--on' : ''}`} aria-hidden="true" />
              <span className="settings-int-statusval">
                {loading ? '…' : statuses?.[p.key] ? 'Connected' : 'Not connected'}
              </span>
            </li>
          ))}
        </ul>
        <Link to={linkTo} className="btn btn-secondary btn-sm settings-int-crosslink">
          {linkLabel} →
        </Link>
      </div>
    </div>
  );
}

// ─── Google Drive & Calendar card (per-user cross-link) ──────────────
// Per-user OAuth (user_google_accounts / google_calendar_links), NOT a
// company-wide integration_credentials row — so it deliberately shows NO
// "connected" pill (that would misreport one person's link as everyone's).
// It exists here purely for discoverability; managed on My Account.
function GoogleCard() {
  return (
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className="settings-int-badge settings-int-badge--google">G</span>
          <div>
            <div className="settings-int-name">Google Drive &amp; Calendar</div>
            <div className="settings-int-sub">Per-user file &amp; calendar sync</div>
          </div>
        </div>
        <span className="settings-int-pill">Per-user</span>
      </div>
      <div className="settings-int-body">
        <p className="settings-int-meta">
          Each person connects their own Google account — it isn&apos;t a single company-wide
          connection, so it&apos;s managed on your personal account page.
        </p>
        <Link to="/settings/my-account" className="btn btn-secondary btn-sm settings-int-crosslink">
          Manage on My Account →
        </Link>
      </div>
    </div>
  );
}

// ─── Twilio card (send-mode status) ──────────────
// Status only. Surfaces the feature:twilio_live flag (today buried in
// DevTools → Flags): OFF = dry-run (messages logged, not sent), ON = live.
// Managing the Twilio SECRET itself is a later phase (P9) — not here.
function TwilioCard() {
  const { isFeatureEnabled } = useAuth();
  const live = isFeatureEnabled('feature:twilio_live');

  return (
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className="settings-int-badge settings-int-badge--twilio">T</span>
          <div>
            <div className="settings-int-name">Twilio SMS</div>
            <div className="settings-int-sub">Text messaging to customers</div>
          </div>
        </div>
        <span className={`settings-int-pill${live ? ' settings-int-pill--on' : ' settings-int-pill--warn'}`}>
          {live ? 'Live' : 'Dry-run'}
        </span>
      </div>
      <div className="settings-int-body">
        <p className="settings-int-meta">
          {live
            ? 'Live mode — text messages are really sent to customers.'
            : 'Dry-run mode — messages are logged but not actually sent. Flip feature:twilio_live in DevTools → Flags to go live.'}
        </p>
        <p className="settings-int-meta">
          Credentials (Account SID, Auth Token) are managed by the platform today; in-app key
          management is coming in a later phase.
        </p>
      </div>
    </div>
  );
}

// ─── Page ──────────────
export default function Integrations() {
  return (
    <div className="settings-int-page">
      <SettingsPageHeader
        title="Connections"
        subtitle="Every outside service the company connects to, in one place. Keys are stored securely on the server and never shown again."
      />

      <h2 className="settings-int-grouphead">Managed here</h2>
      <div className="settings-int-grid">
        <GitHubCard />
        <QuickBooksCard />
        <DeepgramCard />
      </div>

      <h2 className="settings-int-grouphead">Managed elsewhere</h2>
      <p className="settings-int-groupsub">
        Live status for connections that live on their own page — follow the link to manage them.
      </p>
      <div className="settings-int-grid">
        <StatusLinkCard
          badge="CH"
          badgeClass="settings-int-badge--channels"
          name="CRM Channels"
          sub="CallRail, Google Ads & Meta Ads"
          providers={CRM_CHANNEL_PROVIDERS}
          linkTo="/crm/integrations"
          linkLabel="Manage in CRM"
        />
        <StatusLinkCard
          badge="S"
          badgeClass="settings-int-badge--stripe"
          name="Stripe"
          sub="Card payments &amp; payouts"
          providers={STRIPE_PROVIDERS}
          linkTo="/settings/payments"
          linkLabel="Manage on Payments"
        />
        <GoogleCard />
        <TwilioCard />
      </div>
    </div>
  );
}

// Stable module-scope arrays so StatusLinkCard's load() callback (which depends
// on `providers`) doesn't re-fire every render from a fresh literal.
const CRM_CHANNEL_PROVIDERS = [
  { key: 'callrail', label: 'CallRail' },
  { key: 'google_ads', label: 'Google Ads' },
  { key: 'meta_ads', label: 'Meta Ads' },
];
const STRIPE_PROVIDERS = [{ key: 'stripe', label: 'Stripe' }];
