/**
 * ════════════════════════════════════════════════
 * FILE: MyAccount.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Your personal "My Account" settings — connect your own Google account once so
 *   you can attach files to jobs from your Drive and push the appointments you're
 *   assigned to into your Google Calendar. Your connection is private to you.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/my-account
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (getAuthHeader)
 *   Data:      reads  → get_google_drive_status / get_google_calendar_status (RPCs)
 *              writes → none directly (connect/disconnect/resync go through the
 *                       /api/google-drive-connect|disconnect and
 *                       /api/google-calendar-resync workers)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Settings.jsx "Google Drive" tab
 *     (Settings Overhaul Phase F).
 *   - Google OAuth returns as ?gdrive=<status>. The google-drive-callback worker
 *     still 302s to /settings?gdrive= until P4 retargets it; F's SettingsHome
 *     forwards that to /settings/my-account?gdrive=, which this page toasts + strips.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

function IconDrive(p){return(<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M7.71 3.5 1.15 15l3.43 5.94 6.56-11.37L7.71 3.5zM22.85 15 16.29 3.5H9.43l6.56 11.5h6.86zM4.93 16.06 8.36 22h11.49l-3.43-5.94H4.93z"/></svg>);}

export default function MyAccount() {
  const { db } = useAuth();

  // Google OAuth redirect lands back here as ?gdrive=<status>. Toast the result
  // and strip the param from the URL. (SettingsHome forwards /settings?gdrive= here.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gdrive = params.get('gdrive');
    if (!gdrive) return;
    if (gdrive === 'connected')     okToast('Google connected (Drive + Calendar)');
    else if (gdrive === 'badstate') errToast('Google connect failed: state mismatch — try again');
    else                            errToast('Google connect failed' + (params.get('msg') ? `: ${params.get('msg')}` : ''));
    params.delete('gdrive'); params.delete('msg');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
  }, []);

  return <GoogleDriveIntegrationPanel db={db} />;
}

/* ═══ GOOGLE INTEGRATION PANEL — per-user connect / disconnect (Drive + Calendar) ═══ */
function GoogleDriveIntegrationPanel({ db }) {
  const [status,     setStatus]     = useState(null);   // { connected, google_email, connected_at }
  const [cal,        setCal]        = useState(null);   // { connected, synced_count, error_count }
  const [loading,    setLoading]    = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [confirmDisc, setConfirmDisc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [drive, calendar] = await Promise.all([
        db.rpc('get_google_drive_status').catch(() => []),
        db.rpc('get_google_calendar_status').catch(() => []),
      ]);
      setStatus(Array.isArray(drive) ? (drive[0] || { connected: false }) : (drive || { connected: false }));
      setCal(Array.isArray(calendar) ? (calendar[0] || { connected: false }) : (calendar || { connected: false }));
    } finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setConnecting(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/google-drive-connect', { method: 'GET', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || res.statusText);
      window.location.href = data.url;
    } catch (e) {
      errToast('Could not start Google connect: ' + e.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!confirmDisc) { setConfirmDisc(true); return; }
    setConfirmDisc(false);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/google-drive-disconnect', { method: 'POST', headers: auth });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      okToast('Google disconnected');
      load();
    } catch (e) {
      errToast('Failed to disconnect: ' + e.message);
    }
  };

  // Push the signed-in user's upcoming appointments to Google Calendar now.
  const syncCalendar = async () => {
    setSyncing(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/google-calendar-resync', { method: 'POST', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      okToast(`Synced ${data.synced || 0} of ${data.appointments || 0} appointments to Google Calendar`);
      load();
    } catch (e) {
      errToast('Calendar sync failed: ' + e.message);
    } finally { setSyncing(false); }
  };

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  const connected    = status?.connected;
  const calConnected = cal?.connected;

  return (
    <div className="settings-panel">
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Google</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Connect your Google account once to attach files to jobs from your Drive and
          push the appointments you're assigned to into your Google Calendar.
          Your connection is private to you.
        </p>
      </div>

      {/* Account connection card */}
      <div style={{
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <IconDrive style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>
              {connected ? 'Connected' : 'Not connected'}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {connected
                ? `${status.google_email || 'Google account'}${status.connected_at ? ` · since ${new Date(status.connected_at).toLocaleDateString()}` : ''}`
                : 'No Google account linked yet.'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {connected && (
            <button
              className="btn btn-sm"
              onClick={disconnect}
              onBlur={() => setConfirmDisc(false)}
              style={{
                background: confirmDisc ? 'var(--status-needs-response-bg)' : 'var(--bg-tertiary)',
                color:      confirmDisc ? '#dc2626' : 'var(--text-secondary)',
                border:     `1px solid ${confirmDisc ? '#fecaca' : 'var(--border-light)'}`,
              }}
            >
              {confirmDisc ? 'Confirm Disconnect' : 'Disconnect'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting}>
            {connecting ? 'Opening Google…' : connected ? 'Reconnect' : 'Connect Google'}
          </button>
        </div>
      </div>

      {/* Calendar feature row */}
      <div style={{
        marginTop: 'var(--space-3)',
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Calendar sync</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {calConnected
              ? `Appointments you're assigned to sync to your Google Calendar · ${cal.synced_count || 0} synced${cal.error_count ? ` · ${cal.error_count} errored` : ''}`
              : connected
                ? 'Reconnect to grant calendar access.'
                : 'Connect Google above to enable.'}
          </div>
        </div>
        {calConnected && (
          <button className="btn btn-sm" onClick={syncCalendar} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync my appointments'}
          </button>
        )}
      </div>
    </div>
  );
}
