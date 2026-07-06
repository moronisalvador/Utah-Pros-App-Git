/**
 * ════════════════════════════════════════════════
 * FILE: Notifications.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Your personal notification settings — turn push notifications on or off for
 *   the device you're using, see which of your devices are registered, and choose
 *   how you want to hear about each kind of notification (in-app bell, push, or
 *   email).
 *
 * WHERE IT LIVES:
 *   Route:        /settings/notifications
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db, isFeatureEnabled, employee),
 *              @/lib/webPushClient, @/components/settings/NotificationPrefsMatrix,
 *              @/components/settings/PushDevicesList
 *   Data:      reads/writes → web push subscriptions + per-type notification
 *              preferences (via the matrix + device components)
 *
 * NOTES / GOTCHAS:
 *   - Verbatim extraction of the old Settings.jsx "Notifications" tab (Settings
 *     Overhaul Phase F). Enable behind feature:web_push; inline two-click confirm
 *     for turn-off; feedback via toasts (CLAUDE.md rule 2), no modals.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  isPushSupported, getVapidPublicKey, pushPermission,
  getExistingSubscription, enablePush, disablePush,
} from '@/lib/webPushClient';
import NotificationPrefsMatrix from '@/components/settings/NotificationPrefsMatrix';
import PushDevicesList from '@/components/settings/PushDevicesList';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

function IconBell(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>);}

export default function Notifications() {
  const { db, isFeatureEnabled, employee } = useAuth();
  const flagOn    = isFeatureEnabled('feature:web_push');
  const supported = isPushSupported();

  const [loading, setLoading]   = useState(true);
  const [configured, setConfigured] = useState(false); // server has a VAPID key
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [busy, setBusy]         = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPermission(pushPermission());
      const [sub, key] = await Promise.all([getExistingSubscription(), getVapidPublicKey()]);
      setSubscribed(!!sub);
      setConfigured(!!key);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // iOS exposes Push only inside an installed PWA. Detect "iOS Safari, not
  // installed" so we can show the Add-to-Home-Screen guidance instead of a
  // dead Enable button.
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true);

  const enable = async () => {
    setBusy(true);
    try {
      const res = await enablePush(db);
      if (res.ok) { okToast('Push enabled on this device'); await refresh(); }
      else if (res.reason === 'denied') errToast('Notifications are blocked. Enable them in your browser/OS settings, then try again.');
      else if (res.reason === 'unconfigured') errToast('Push isn’t configured yet on the server.');
      else if (res.reason === 'unsupported') errToast('This device/browser can’t receive web push.');
      else errToast('Could not enable push — please try again.');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!confirmOff) { setConfirmOff(true); return; }
    setConfirmOff(false);
    setBusy(true);
    try {
      const res = await disablePush(db);
      if (res.ok) { okToast('Push disabled on this device'); await refresh(); }
      else errToast('Could not fully disable push — please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Notifications</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Turn device push on or off below, then choose how you want to hear about
          each kind of notification.
        </p>
      </div>

      {/* Enable-push row */}
      <div style={{
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <IconBell style={{ width: 24, height: 24, color: 'var(--text-secondary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Push on this device</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {loading ? 'Checking…'
                : subscribed ? 'Enabled — this device will receive push notifications.'
                : 'Not enabled on this device yet.'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {!loading && subscribed && (
            <button
              className="btn btn-sm"
              onClick={disable}
              onBlur={() => setConfirmOff(false)}
              disabled={busy}
              style={{
                background: confirmOff ? '#fef2f2' : 'var(--bg-tertiary)',
                color:      confirmOff ? '#dc2626' : 'var(--text-secondary)',
                border:     `1px solid ${confirmOff ? '#fecaca' : 'var(--border-light)'}`,
              }}
            >
              {confirmOff ? 'Confirm turn off' : busy ? 'Working…' : 'Turn off'}
            </button>
          )}
          {!loading && !subscribed && (
            <button
              className="btn btn-primary btn-sm"
              onClick={enable}
              disabled={busy || !flagOn || !supported || !configured || permission === 'denied'}
            >
              {busy ? 'Enabling…' : 'Enable push on this device'}
            </button>
          )}
        </div>
      </div>

      {/* Contextual guidance */}
      {!flagOn && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Web push is being rolled out and isn’t enabled for your account yet.
        </p>
      )}
      {flagOn && !supported && isIOS && !isStandalone && (
        <div style={{
          marginTop: 12, padding: '12px 16px', background: 'var(--bg-secondary)',
          border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)',
          fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)',
        }}>
          To get push on your iPhone, add this app to your Home Screen first:
          tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from the Home
          Screen and enable push here.
        </div>
      )}
      {flagOn && !supported && !isIOS && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          This browser can’t receive web push notifications.
        </p>
      )}
      {flagOn && supported && !configured && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Push isn’t configured on the server yet — check back soon.
        </p>
      )}
      {flagOn && supported && configured && permission === 'denied' && (
        <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Notifications are blocked for this site. Re-allow them in your
          browser/OS settings, then reload this page.
        </p>
      )}

      {/* Registered devices (this device is removable with a two-click confirm). */}
      <PushDevicesList db={db} employeeId={employee?.id} />

      {/* Per-type × channel preferences matrix (LIVE types only, from the resolver). */}
      <div className="notif-prefs-section">
        <div className="notif-prefs-section-head">
          <h3 className="notif-prefs-section-title">Notify me about…</h3>
          <p className="notif-prefs-section-sub">
            Choose a channel per notification. The bell is always in the app; push
            needs a device turned on above; email goes to your work address.
          </p>
        </div>
        <NotificationPrefsMatrix db={db} employeeId={employee?.id} variant="office" />
      </div>
    </div>
  );
}
