/**
 * ════════════════════════════════════════════════
 * FILE: MyAccount.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Your personal "My Account" settings. Two things live here: (1) connect your own
 *   Google account once so you can attach files to jobs from your Drive and push the
 *   appointments you're assigned to into your Google Calendar (private to you); and
 *   (2) request that your account be deleted — this files a request an administrator
 *   then acts on, since your job/claim records are a shared company record and can't
 *   be erased by one person on their own.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/my-account
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (getAuthHeader),
 *              @/lib/toast (toast), @/components/settings/AccountDeletionPanel
 *   Data:      reads  → get_google_drive_status / get_google_calendar_status /
 *                       account-deletion status via the shared panel
 *              writes → account-deletion request via the shared panel. Google
 *                       connect/disconnect/resync go through the
 *                       /api/google-drive-connect|disconnect and
 *                       /api/google-calendar-resync workers.
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Settings.jsx "Google Drive" tab
 *     (Settings Overhaul Phase F). Account-deletion section added for Apple App
 *     Store Guideline 5.1.1(v) — App Store Readiness Phase B.
 *   - Google OAuth returns as ?gdrive=<status>. The google-drive-callback worker
 *     still 302s to /settings?gdrive= until P4 retargets it; F's SettingsHome
 *     forwards that to /settings/my-account?gdrive=, which this page toasts + strips.
 *   - Deletion is request-and-confirm, NOT an immediate self-service hard-delete:
 *     the RPC records a pending request and drops an admin bell notification; an
 *     admin actions the actual access deactivation + data retention.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { toast } from '@/lib/toast';
import AccountDeletionPanel from '@/components/settings/AccountDeletionPanel';

function IconDrive(p){return(<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M7.71 3.5 1.15 15l3.43 5.94 6.56-11.37L7.71 3.5zM22.85 15 16.29 3.5H9.43l6.56 11.5h6.86zM4.93 16.06 8.36 22h11.49l-3.43-5.94H4.93z"/></svg>);}

export default function MyAccount() {
  const { db } = useAuth();

  // Google OAuth redirect lands back here as ?gdrive=<status>. Toast the result
  // and strip the param from the URL. (SettingsHome forwards /settings?gdrive= here.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gdrive = params.get('gdrive');
    if (!gdrive) return;
    if (gdrive === 'connected')     toast('Google connected (Drive + Calendar)');
    else if (gdrive === 'badstate') toast('Google connect failed: state mismatch — try again', 'error');
    else                            toast('Google connect failed' + (params.get('msg') ? `: ${params.get('msg')}` : ''), 'error');
    params.delete('gdrive'); params.delete('msg');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
  }, []);

  return (
    <>
      <GoogleDriveIntegrationPanel db={db} />
      <AccountDeletionPanel />
    </>
  );
}

/* ═══ GOOGLE INTEGRATION PANEL — per-user connect / disconnect (Drive + Calendar) ═══ */
function GoogleDriveIntegrationPanel({ db }) {
  const [status,     setStatus]     = useState(null);   // { connected, google_email, connected_at }
  const [cal,        setCal]        = useState(null);   // { connected, synced_count, error_count }
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [confirmDisc, setConfirmDisc] = useState(false);

  // LES-01 (loading-error-states.md §1): both status reads used to carry an
  // inline `.catch(() => [])`. `db.rpc` THROWS on any non-OK response, so that
  // swallow collapsed a failed read into `{ connected: false }` — telling a
  // user whose Google account IS connected that it is NOT, and inviting them to
  // re-run the OAuth grant against a service that is merely unreachable. The
  // reads now reject, and the panel says it could not check.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [drive, calendar] = await Promise.all([
        db.rpc('get_google_drive_status'),
        db.rpc('get_google_calendar_status'),
      ]);
      setStatus(Array.isArray(drive) ? (drive[0] || { connected: false }) : (drive || { connected: false }));
      setCal(Array.isArray(calendar) ? (calendar[0] || { connected: false }) : (calendar || { connected: false }));
    } catch (e) {
      console.error('Google integration status load failed:', e?.message || e);
      setLoadError('Could not check your Google connection');
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
      toast('Could not start Google connect: ' + e.message, 'error');
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
      toast('Google disconnected');
      load();
    } catch (e) {
      toast('Failed to disconnect: ' + e.message, 'error');
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
      toast(`Synced ${data.synced || 0} of ${data.appointments || 0} appointments to Google Calendar`);
      load();
    } catch (e) {
      toast('Calendar sync failed: ' + e.message, 'error');
    } finally { setSyncing(false); }
  };

  if (loading) return <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>;

  // LES-01 (loading-error-states.md §1): a failed status read renders an ERROR,
  // never the "Not connected" success state — the two are indistinguishable to
  // the user but mean opposite things.
  if (loadError) {
    return (
      <div className="settings-panel">
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Google</h2>
        </div>
        <div style={{
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-5)', textAlign: 'center',
        }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: 4 }}>{loadError}</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            This does not mean you are disconnected — we could not reach the service to check.
          </div>
          <button className="btn btn-sm btn-primary" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

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
                background: confirmDisc ? 'var(--danger-bg)' : 'var(--bg-tertiary)',
                color:      confirmDisc ? 'var(--danger)' : 'var(--text-secondary)',
                border:     `1px solid ${confirmDisc ? 'var(--danger-border)' : 'var(--border-light)'}`,
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
