/**
 * ════════════════════════════════════════════════
 * FILE: NotificationsSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Notifications" block on the tech Settings screen. It lets a technician
 *   turn phone push notifications on or off for THIS device, and tells them what
 *   to do if their phone can't do it yet (like adding the app to the Home Screen
 *   on an iPhone). It reuses the exact same push machinery the office Settings
 *   page uses, so there's one shared way to turn push on.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/settings
 *   Rendered by:  src/pages/tech/TechSettings.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db, isFeatureEnabled), @/lib/webPushClient
 *              (enablePush/disablePush/isPushSupported/…), @/lib/toast
 *   Data:      via webPushClient → upsert_push_subscription / delete_push_subscription
 *              RPCs and GET /api/vapid-public-key (no direct DB access here)
 *
 * NOTES / GOTCHAS:
 *   - This is the device-push on/off only. The full per-type notification
 *     preferences matrix is a later phase (notify Session C) that fills the
 *     <NotificationsSection> slot with more rows.
 *   - iOS only exposes web push inside an installed (Home-Screen) PWA — the
 *     guidance box shows the Add-to-Home-Screen steps when that's the blocker.
 *   - Two-click confirm on "Turn off" (no confirm() dialog — house rule).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import {
  isPushSupported, getExistingSubscription, getVapidPublicKey,
  pushPermission, enablePush, disablePush,
} from '@/lib/webPushClient';

export default function NotificationsSection() {
  // ─── State & hooks ──────────────
  const { db, isFeatureEnabled } = useAuth();
  const flagOn = isFeatureEnabled('feature:web_push');
  const supported = isPushSupported();

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false); // server has a VAPID key
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [busy, setBusy] = useState(false);
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

  // iOS exposes Push only inside an installed PWA.
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true);

  // ─── Event handlers ──────────────
  const enable = async () => {
    setBusy(true);
    try {
      const res = await enablePush(db);
      if (res.ok) { toast('Push enabled on this device', 'success'); await refresh(); }
      else if (res.reason === 'denied') toast('Notifications are blocked. Turn them on in your phone settings, then try again.', 'error');
      else if (res.reason === 'unconfigured') toast('Push isn’t set up on the server yet.', 'error');
      else if (res.reason === 'unsupported') toast('This device can’t receive push notifications.', 'error');
      else toast('Could not turn on push — please try again.', 'error');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!confirmOff) { setConfirmOff(true); setTimeout(() => setConfirmOff(false), 3000); return; }
    setConfirmOff(false);
    setBusy(true);
    try {
      const res = await disablePush(db);
      if (res.ok) { toast('Push turned off on this device', 'success'); await refresh(); }
      else toast('Could not fully turn off push — please try again.', 'error');
    } finally { setBusy(false); }
  };

  // ─── Render ──────────────
  return (
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">Notifications</div>
        <div className="tech-settings-card-sub">
          Get alerts on this phone — even when the app is closed.
        </div>
      </div>

      {/* Enable/disable push row */}
      <div className="tech-settings-row">
        <div className="tech-settings-row-main">
          <div className="tech-settings-row-label">Push on this device</div>
          <div className="tech-settings-row-value">
            {loading ? 'Checking…'
              : subscribed ? 'On — this phone will get push alerts.'
              : 'Not on yet for this phone.'}
          </div>
        </div>
        {!loading && subscribed && (
          <button
            type="button"
            className="tech-settings-btn"
            data-confirm={confirmOff ? 'true' : 'false'}
            onClick={disable}
            onBlur={() => setConfirmOff(false)}
            disabled={busy}
          >
            {confirmOff ? 'Tap again to turn off' : busy ? 'Working…' : 'Turn off'}
          </button>
        )}
        {!loading && !subscribed && (
          <button
            type="button"
            className="tech-settings-btn tech-settings-btn--primary"
            onClick={enable}
            disabled={busy || !flagOn || !supported || !configured || permission === 'denied'}
          >
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        )}
      </div>

      {/* Contextual guidance */}
      {!flagOn && (
        <div className="tech-settings-hint">
          Push is still rolling out and isn’t on for your account yet.
        </div>
      )}
      {flagOn && !supported && isIOS && !isStandalone && (
        <div className="tech-settings-note">
          To get push on your iPhone, add this app to your Home Screen first:
          tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from the Home
          Screen and turn push on here.
        </div>
      )}
      {flagOn && !supported && !isIOS && (
        <div className="tech-settings-hint">This device can’t receive push notifications.</div>
      )}
      {flagOn && supported && !configured && (
        <div className="tech-settings-hint">Push isn’t set up on the server yet — check back soon.</div>
      )}
      {flagOn && supported && configured && permission === 'denied' && (
        <div className="tech-settings-hint">
          Notifications are blocked for this app. Turn them back on in your phone
          settings, then reopen the app.
        </div>
      )}
    </div>
  );
}
