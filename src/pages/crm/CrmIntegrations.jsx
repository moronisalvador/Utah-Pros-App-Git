/**
 * ════════════════════════════════════════════════
 * FILE: CrmIntegrations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Where CallRail gets connected to the app — paste in the API key from
 *   CallRail's dashboard, see whether it's currently connected, and
 *   disconnect it if needed. Also shows the webhook URL + secret to paste
 *   into CallRail's own webhook settings so it knows where to send call/form
 *   data. Google Ads and Meta Ads cards are placeholders until Phase 2.
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
 *   Data:      reads  → integration_credentials, integration_config
 *                       (via get_integration_status RPC + a direct select
 *                       of the webhook secret — both read-only, no secrets
 *                       exposed by get_integration_status itself)
 *              writes → integration_credentials, integration_config (via
 *                       the callrail-connect worker, service-role — never
 *                       directly from the frontend)
 *
 * NOTES / GOTCHAS:
 *   - The webhook secret is fetched via a plain `db.select` on
 *     integration_config, which is RLS-enabled with NO anon/authenticated
 *     policy (service-role only) — same as integration_credentials. That
 *     select will simply return an empty array for a non-service-role
 *     caller; the UI treats a missing secret as "connect CallRail first."
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

function ok(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } })); }
function err(message) { window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } })); }

function CallRailCard({ status, onConnected, onDisconnected }) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const connected = !!status?.connected;

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
          <button
            className={`crm-btn${confirmingDisconnect ? ' crm-btn-danger' : ' crm-btn-ghost'}`}
            onClick={disconnect}
            onBlur={() => setConfirmingDisconnect(false)}
            disabled={saving}
          >
            {confirmingDisconnect ? 'Confirm disconnect?' : 'Disconnect'}
          </button>
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

function ComingSoonCard({ label, phase }) {
  return (
    <div className="crm-integration-card crm-integration-card-disabled">
      <div className="crm-integration-card-head">
        <div className="crm-integration-card-title">{label}</div>
        <span className="crm-integration-status">Coming in Phase {phase}</span>
      </div>
    </div>
  );
}

export default function CrmIntegrations() {
  const { db } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_integration_status', { p_provider: 'callrail' });
      setStatus(Array.isArray(rows) ? rows[0] : rows);
    } catch {
      err('Failed to load integration status');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Integrations</h1>
        <p className="crm-page-subtitle">Connect the outside services the CRM pulls data from.</p>
      </div>

      <div className="crm-integration-grid">
        <CallRailCard status={status} onConnected={load} onDisconnected={load} />
        <ComingSoonCard label="Google Ads" phase="2" />
        <ComingSoonCard label="Meta Ads" phase="2" />
      </div>
    </div>
  );
}
