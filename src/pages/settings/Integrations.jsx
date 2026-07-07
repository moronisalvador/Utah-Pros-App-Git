/**
 * ════════════════════════════════════════════════
 * FILE: Integrations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Settings → Integrations page. This is where an admin connects the
 *   outside services the platform talks to. GitHub (paste an access key so the
 *   assistant can list, merge and comment on our code), QuickBooks Online
 *   (connect our accounting so new customer contacts sync over), and — added in
 *   P9 — the Twilio (texting), Resend (email) and Stripe (card payments) keys,
 *   which an admin can now paste here instead of editing server settings. Every
 *   key is stored locked-down on the server and NEVER shown back to the browser;
 *   the page only ever learns whether each service is connected (yes/no).
 *
 * WHERE IT LIVES:
 *   Route:        /settings/integrations   (admin-only — see AdminRoute in App.jsx)
 *   Rendered by:  src/App.jsx (inside the Settings hub)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db.rpc for QBO status/stats),
 *              @/lib/realtime (getAuthHeader — authenticated worker calls),
 *              @/components/settings/SettingsPageHeader
 *   Data:      reads/writes → integration_credentials + integration_config, but
 *              only via workers (/api/github-connect, /api/quickbooks-connect,
 *              /api/qbo-sync-customer) and SECURITY DEFINER RPCs
 *              (get_integration_status, get_qbo_sync_stats, and the P9 set —
 *              get_managed_credentials_status, set_integration_secret,
 *              set_twilio_config, disconnect_integration) — the frontend NEVER
 *              touches those RLS-locked tables directly, and the secret is never
 *              returned to it.
 *
 * NOTES / GOTCHAS:
 *   - After Intuit authorizes, /api/quickbooks-callback redirects the browser
 *     back HERE with ?qbo=connected|error|badstate (retargeted from the retired
 *     /dev-tools tab in the same PR). qboReturnToast() maps that param to a
 *     toast; the URL is then cleaned so a refresh doesn't re-fire it.
 *   - Disconnect everywhere is an inline two-click confirm (no modal, no confirm()).
 *   - P9 credential cards (Twilio/Resend/Stripe): status comes from
 *     get_managed_credentials_status() (booleans + public bits only); writes go
 *     through admin-gated RPCs (server re-checks admin via auth.uid(), so a direct
 *     API call can't bypass this admin-only route). The pasted key is write-only —
 *     the status RPC never returns it, so a connected card shows "Connected", not
 *     the value. The server reads DB-first, env-fallback (functions/lib/
 *     credentials.js), so keys stay live through the cutover.
 *   - De-CRM'd: this page uses design-system classes (.card / .btn / .input)
 *     plus .settings-int-* polish classes (index.css §P2) and .settings-cred-*
 *     (index.css §P9), not the crm-* set.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
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

// ─── Managed credential cards (P9) ──────────────
// Turn a thrown db.rpc error into a short, human message. The admin gate raises
// NOT_AUTHORIZED (PostgREST → 403); everything else is a generic retry.
function credError(e) {
  const m = e?.message || '';
  if (m.includes('NOT_AUTHORIZED')) return 'admin only';
  if (m.includes('EMPTY_SECRET')) return 'the key was empty';
  if (m.includes('INVALID_PROVIDER')) return 'unknown provider';
  return 'please try again';
}

// Generic single-secret card (Resend, Stripe). The secret is write-only: we show
// "Connected" (a boolean from the status RPC), never the value. Paste replaces it.
function SecretCard({ db, provider, name, badge, badgeClass, sub, keyLabel, keyPlaceholder, note, status, loading, reload }) {
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const connected = !!status?.connected;

  const save = async () => {
    if (!secret.trim()) return;
    setSaving(true);
    try {
      await db.rpc('set_integration_secret', { p_provider: provider, p_secret: secret.trim() });
      ok(`${name} ${connected ? 'key replaced' : 'connected'}`);
      setSecret('');
      await reload();
    } catch (e) { err(`Could not save: ${credError(e)}`); }
    finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      await db.rpc('disconnect_integration', { p_provider: provider });
      ok(`${name} disconnected`);
      setConfirming(false);
      await reload();
    } catch (e) { err(`Could not disconnect: ${credError(e)}`); }
    finally { setSaving(false); }
  };

  // ─── SECTION: Render ──────────────
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
        <span className={`settings-int-pill${connected ? ' settings-int-pill--on' : ''}`}>
          {loading ? '…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="settings-int-body">
        {connected && (
          <p className="settings-int-meta">A key is saved and in use. Paste a new one to replace it.</p>
        )}
        <label className="label" htmlFor={`cred-${provider}`}>{keyLabel}</label>
        <div className="settings-int-row">
          <input
            id={`cred-${provider}`}
            className="input"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={keyPlaceholder}
          />
          <button className="btn btn-primary" onClick={save} disabled={saving || !secret.trim()}>
            {saving ? 'Saving…' : connected ? 'Replace' : 'Connect'}
          </button>
        </div>
        {note && <div className="settings-cred-note">{note}</div>}
        {connected && (
          <button
            className={`btn btn-sm settings-int-disconnect${confirming ? ' settings-int-disconnect--armed' : ''}`}
            onClick={disconnect}
            onBlur={() => setConfirming(false)}
            disabled={saving}
          >
            {confirming ? 'Confirm disconnect?' : 'Disconnect'}
          </button>
        )}
      </div>
    </div>
  );
}

// Twilio needs four fields: the auth token (the only SECRET) plus three non-secret
// identifiers (Account SID, Messaging Service SID, phone number). The token is
// write-only; the SIDs are shown as "configured ✓" booleans, the phone in full.
function TwilioCard({ db, status, loading, reload }) {
  const [authToken, setAuthToken] = useState('');
  const [accountSid, setAccountSid] = useState('');
  const [messagingSid, setMessagingSid] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const connected = !!status?.connected;

  // Prefill the editable non-secret fields from status (phone is public; the SIDs
  // are shown as booleans, so their inputs start blank and only overwrite when typed).
  useEffect(() => { setPhone(status?.phone_number || ''); }, [status?.phone_number]);

  const save = async () => {
    setSaving(true);
    try {
      if (authToken.trim()) {
        await db.rpc('set_integration_secret', { p_provider: 'twilio', p_secret: authToken.trim() });
      }
      await db.rpc('set_twilio_config', {
        // Only overwrite a SID when the admin typed one; blank leaves it unchanged
        // by resending the current value (booleans mean we don't have the raw SID).
        p_account_sid: accountSid.trim() || (status?.has_account_sid ? undefined : ''),
        p_messaging_service_sid: messagingSid.trim() || (status?.has_messaging_service ? undefined : ''),
        p_phone_number: phone.trim(),
      });
      ok('Twilio saved');
      setAuthToken(''); setAccountSid(''); setMessagingSid('');
      await reload();
    } catch (e) { err(`Could not save: ${credError(e)}`); }
    finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSaving(true);
    try {
      await db.rpc('disconnect_integration', { p_provider: 'twilio' });
      ok('Twilio disconnected');
      setConfirming(false);
      await reload();
    } catch (e) { err(`Could not disconnect: ${credError(e)}`); }
    finally { setSaving(false); }
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="card settings-int-card">
      <div className="settings-int-head">
        <div className="settings-int-provider">
          <span className="settings-int-badge settings-cred-badge--twilio">Tw</span>
          <div>
            <div className="settings-int-name">Twilio</div>
            <div className="settings-int-sub">Text messaging (SMS / MMS)</div>
          </div>
        </div>
        <span className={`settings-int-pill${connected ? ' settings-int-pill--on' : ''}`}>
          {loading ? '…' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="settings-int-body">
        {connected && (
          <p className="settings-int-meta">
            Auth token saved · Account SID {status?.has_account_sid ? 'configured ✓' : 'not set'} ·
            Messaging Service {status?.has_messaging_service ? 'configured ✓' : 'not set'}
          </p>
        )}
        <label className="label" htmlFor="cred-twilio-token">Auth token {connected && '(paste to replace)'}</label>
        <input
          id="cred-twilio-token"
          className="input"
          type="password"
          autoComplete="off"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          placeholder={connected ? 'Paste a new auth token' : 'Twilio Auth Token'}
        />
        <div className="settings-cred-grid">
          <div>
            <label className="label" htmlFor="cred-twilio-account">Account SID</label>
            <input
              id="cred-twilio-account"
              className="input"
              type="text"
              autoComplete="off"
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder={status?.has_account_sid ? 'configured — type to replace' : 'ACxxxxxxxx'}
            />
          </div>
          <div>
            <label className="label" htmlFor="cred-twilio-messaging">Messaging Service SID</label>
            <input
              id="cred-twilio-messaging"
              className="input"
              type="text"
              autoComplete="off"
              value={messagingSid}
              onChange={(e) => setMessagingSid(e.target.value)}
              placeholder={status?.has_messaging_service ? 'configured — type to replace' : 'MGxxxxxxxx (optional)'}
            />
          </div>
        </div>
        <label className="label" htmlFor="cred-twilio-phone">Sending phone number</label>
        <input
          id="cred-twilio-phone"
          className="input"
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1801…"
        />
        <div className="settings-cred-note">
          Used only if no Messaging Service SID is set. The auth token is stored write-only and never shown again.
        </div>
        <div className="settings-int-row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {connected && (
          <button
            className={`btn btn-sm settings-int-disconnect${confirming ? ' settings-int-disconnect--armed' : ''}`}
            onClick={disconnect}
            onBlur={() => setConfirming(false)}
            disabled={saving}
          >
            {confirming ? 'Confirm disconnect?' : 'Disconnect'}
          </button>
        )}
      </div>
    </div>
  );
}

// Loads the status for all three managed providers in one RPC and renders the cards.
function CredentialCards() {
  const { db } = useAuth();
  const [byProvider, setByProvider] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_managed_credentials_status');
      const map = {};
      for (const r of (rows || [])) map[r.provider] = r;
      setByProvider(map);
    } catch { err('Failed to load credential status'); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <TwilioCard db={db} status={byProvider?.twilio} loading={loading} reload={load} />
      <SecretCard
        db={db} provider="resend" name="Resend" badge="Re" badgeClass="settings-cred-badge--resend"
        sub="Transactional email (signing links, reports)"
        keyLabel="API key" keyPlaceholder="re_…"
        status={byProvider?.resend} loading={loading} reload={load}
      />
      <SecretCard
        db={db} provider="stripe" name="Stripe" badge="St" badgeClass="settings-cred-badge--stripe"
        sub="Card payments & instant payouts"
        keyLabel="Secret key" keyPlaceholder="sk_…"
        note="Stripe's webhook-signing secret stays a server setting; this key powers charges and payouts."
        status={byProvider?.stripe} loading={loading} reload={load}
      />
    </>
  );
}

// ─── Page ──────────────
export default function Integrations() {
  return (
    <div className="settings-int-page">
      <SettingsPageHeader
        title="Integrations"
        subtitle="Connect the outside services the platform talks to. Keys are stored securely on the server and never shown again."
      />
      <div className="settings-int-grid">
        <GitHubCard />
        <QuickBooksCard />
        <CredentialCards />
      </div>
    </div>
  );
}
