/**
 * ════════════════════════════════════════════════
 * FILE: CrmIntegrations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Where the CRM's outside data sources get connected — CallRail (paste an
 *   API key) plus Google Ads and Meta Ads (both "Connect" buttons that send
 *   you to that service's own sign-in screen, then bring you back here).
 *   Shows whether each is currently connected and lets you disconnect.
 *   CallRail also shows the webhook URL + secret to paste into CallRail's
 *   own webhook settings so it knows where to send call/form data.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/integrations
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/realtime
 *              (getAuthHeader, for the authenticated worker calls)
 *   Data:      reads  → integration_credentials (via get_integration_status
 *                       RPC — read-only, never exposes tokens themselves),
 *                       integration_config's CallRail webhook secret (via
 *                       the callrail-connect worker's GET, service-role —
 *                       the frontend never selects that table directly,
 *                       since it's RLS-enabled with no anon/authenticated
 *                       policy)
 *              writes → integration_credentials, integration_config (via
 *                       the callrail-connect / google-ads-connect /
 *                       meta-ads-connect workers, service-role — never
 *                       directly from the frontend)
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

function ok(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } })); }
function err(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } })); }

function WebhookUrlBlock({ secret }) {
  if (!secret) return null;
  const webhookUrl = `${window.location.origin}/api/callrail-webhook?secret=${secret}`;

  const copy = () => {
    navigator.clipboard.writeText(webhookUrl);
    ok('Webhook URL copied');
  };

  return (
    <div className="crm-integration-webhook">
      <label className="crm-integration-label">Webhook URL — paste into CallRail's webhook settings for each event type</label>
      <div className="crm-integration-connect-row">
        <input className="crm-integration-input" type="text" readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
        <button className="crm-btn crm-btn-ghost" onClick={copy}>Copy</button>
      </div>
    </div>
  );
}

function CallRailCard({ status, onConnected, onDisconnected, readOnly }) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [secret, setSecret] = useState(null);
  const connected = !!status?.connected;

  const loadSecret = useCallback(async () => {
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/callrail-connect', { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      setSecret(data.secret || null);
    } catch { /* non-fatal — webhook URL block just stays hidden */ }
  }, []);

  useEffect(() => { if (connected && !readOnly) loadSecret(); }, [connected, readOnly, loadSecret]);

  const connect = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/callrail-connect', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok('CallRail connected');
      setApiKey('');
      setSecret(data.secret || null);
      onConnected();
    } catch (e) {
      err('Could not connect CallRail: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirmingDisconnect) { setConfirmingDisconnect(true); return; }
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/callrail-connect', { method: 'DELETE', headers: auth });
      if (!res.ok) throw new Error(res.statusText);
      ok('CallRail disconnected');
      setConfirmingDisconnect(false);
      onDisconnected();
    } catch (e) {
      err('Could not disconnect: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="crm-integration-card">
      <div className="crm-integration-card-head">
        <div className="crm-integration-card-title">
          <span className="crm-integration-badge crm-integration-badge-callrail">CR</span>
          CallRail
        </div>
        <span className={`crm-integration-status${connected ? ' connected' : ''}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {connected ? (
        <div className="crm-integration-card-body">
          <p className="crm-integration-meta">Connected {status.connected_at ? new Date(status.connected_at).toLocaleDateString() : ''}</p>
          {!readOnly && <WebhookUrlBlock secret={secret} />}
          {!readOnly && (
            <button
              className={`crm-btn${confirmingDisconnect ? ' crm-btn-danger' : ' crm-btn-ghost'}`}
              onClick={disconnect}
              onBlur={() => setConfirmingDisconnect(false)}
              disabled={saving}
            >
              {confirmingDisconnect ? 'Confirm disconnect?' : 'Disconnect'}
            </button>
          )}
        </div>
      ) : readOnly ? (
        <div className="crm-integration-card-body">
          <p className="crm-integration-meta">Not connected</p>
        </div>
      ) : (
        <div className="crm-integration-card-body">
          <label className="crm-integration-label" htmlFor="callrail-api-key">API key (from CallRail → Settings → API Access)</label>
          <div className="crm-integration-connect-row">
            <input
              id="callrail-api-key"
              className="crm-integration-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste CallRail API key"
            />
            <button className="crm-btn crm-btn-primary" onClick={connect} disabled={saving || !apiKey.trim()}>
              {saving ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Google Ads and Meta Ads both connect via a redirect to that service's own
// OAuth screen, then land back here — a lighter card than CallRail's (no
// paste-a-key form, no webhook URL block), shared by both providers.
function OAuthProviderCard({ label, badgeClass, badgeText, connectPath, status, connecting, onConnect, onDisconnected, readOnly }) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const connected = !!status?.connected;

  const disconnect = async () => {
    if (!confirmingDisconnect) { setConfirmingDisconnect(true); return; }
    setDisconnecting(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(connectPath, { method: 'DELETE', headers: auth });
      if (!res.ok) throw new Error(res.statusText);
      ok(`${label} disconnected`);
      setConfirmingDisconnect(false);
      onDisconnected();
    } catch (e) {
      err(`Could not disconnect ${label}: ` + e.message);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="crm-integration-card">
      <div className="crm-integration-card-head">
        <div className="crm-integration-card-title">
          <span className={`crm-integration-badge ${badgeClass}`}>{badgeText}</span>
          {label}
        </div>
        <span className={`crm-integration-status${connected ? ' connected' : ''}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="crm-integration-card-body">
        {connected ? (
          <>
            <p className="crm-integration-meta">Connected {status.connected_at ? new Date(status.connected_at).toLocaleDateString() : ''}</p>
            {!readOnly && (
              <div className="crm-integration-actions-row">
                <button className="crm-btn crm-btn-ghost" onClick={() => onConnect(connectPath)} disabled={connecting}>
                  {connecting ? 'Opening…' : 'Reconnect'}
                </button>
                <button
                  className={`crm-btn${confirmingDisconnect ? ' crm-btn-danger' : ' crm-btn-ghost'}`}
                  onClick={disconnect}
                  onBlur={() => setConfirmingDisconnect(false)}
                  disabled={disconnecting}
                >
                  {confirmingDisconnect ? 'Confirm disconnect?' : 'Disconnect'}
                </button>
              </div>
            )}
          </>
        ) : readOnly ? (
          <p className="crm-integration-meta">Not connected</p>
        ) : (
          <button className="crm-btn crm-btn-primary" onClick={() => onConnect(connectPath)} disabled={connecting}>
            {connecting ? 'Opening…' : `Connect ${label}`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CrmIntegrations() {
  const { db, employee } = useAuth();
  // Shared platform OAuth credentials, not per-user data — a CRM partner sees
  // connection status only, never the connect/disconnect/webhook-secret controls.
  const readOnly = employee?.role === 'crm_partner';
  const [callrailStatus, setCallrailStatus] = useState(null);
  const [googleAdsStatus, setGoogleAdsStatus] = useState(null);
  const [metaAdsStatus, setMetaAdsStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cr, ga, ma] = await Promise.all([
        db.rpc('get_integration_status', { p_provider: 'callrail' }),
        db.rpc('get_integration_status', { p_provider: 'google_ads' }),
        db.rpc('get_integration_status', { p_provider: 'meta_ads' }),
      ]);
      setCallrailStatus(Array.isArray(cr) ? cr[0] : cr);
      setGoogleAdsStatus(Array.isArray(ga) ? ga[0] : ga);
      setMetaAdsStatus(Array.isArray(ma) ? ma[0] : ma);
    } catch {
      err('Failed to load integration status');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // Surface the OAuth redirect result (?google_ads=connected|error|badstate
  // or ?meta_ads=...) then clean the URL, same pattern as DevTools' QBO card.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    for (const [provider, label] of [['google_ads', 'Google Ads'], ['meta_ads', 'Meta Ads']]) {
      const result = params.get(provider);
      if (!result) continue;
      changed = true;
      if (result === 'connected')      ok(`${label} connected`);
      else if (result === 'badstate')  err(`${label} connect failed: state mismatch — try again`);
      else                             err(`${label} connect failed` + (params.get('msg') ? `: ${params.get('msg')}` : ''));
      params.delete(provider);
    }
    if (!changed) return;
    params.delete('msg');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
    load();
  }, [load]);

  const startConnect = async (connectPath) => {
    setConnecting(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(connectPath, { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || res.statusText);
      window.location.href = data.url;
    } catch (e) {
      err('Could not start connect: ' + e.message);
      setConnecting(false);
    }
  };

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Integrations</h1>
        <p className="crm-page-subtitle">Connect the outside services the CRM pulls data from.</p>
      </div>

      <div className="crm-integration-grid">
        <CallRailCard status={callrailStatus} onConnected={load} onDisconnected={load} readOnly={readOnly} />
        <OAuthProviderCard
          label="Google Ads" badgeClass="crm-integration-badge-google" badgeText="G"
          connectPath="/api/google-ads-connect" status={googleAdsStatus}
          connecting={connecting} onConnect={startConnect} onDisconnected={load} readOnly={readOnly}
        />
        <OAuthProviderCard
          label="Meta Ads" badgeClass="crm-integration-badge-meta" badgeText="M"
          connectPath="/api/meta-ads-connect" status={metaAdsStatus}
          connecting={connecting} onConnect={startConnect} onDisconnected={load} readOnly={readOnly}
        />
      </div>
    </div>
  );
}
