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
 *   Packages:  react, react-i18next
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
import { useTranslation, Trans } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import {
  isPushSupported, getExistingSubscription, getVapidPublicKey,
  pushPermission, enablePush, disablePush,
} from '@/lib/webPushClient';

export default function NotificationsSection() {
  // ─── State & hooks ──────────────
  const { t } = useTranslation(['settings', 'common']);
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
      if (res.ok) { toast(t('notifications.toastEnabled'), 'success'); await refresh(); }
      else if (res.reason === 'denied') toast(t('notifications.toastBlocked'), 'error');
      else if (res.reason === 'unconfigured') toast(t('notifications.toastUnconfigured'), 'error');
      else if (res.reason === 'unsupported') toast(t('notifications.toastUnsupported'), 'error');
      else toast(t('notifications.toastGenericOn'), 'error');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (!confirmOff) { setConfirmOff(true); setTimeout(() => setConfirmOff(false), 3000); return; }
    setConfirmOff(false);
    setBusy(true);
    try {
      const res = await disablePush(db);
      if (res.ok) { toast(t('notifications.toastTurnedOff'), 'success'); await refresh(); }
      else toast(t('notifications.toastGenericOff'), 'error');
    } finally { setBusy(false); }
  };

  // ─── Render ──────────────
  return (
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">{t('notifications.title')}</div>
        <div className="tech-settings-card-sub">
          {t('notifications.sub')}
        </div>
      </div>

      {/* Enable/disable push row */}
      <div className="tech-settings-row">
        <div className="tech-settings-row-main">
          <div className="tech-settings-row-label">{t('notifications.rowLabel')}</div>
          <div className="tech-settings-row-value">
            {loading ? t('common:checking')
              : subscribed ? t('notifications.statusOn')
              : t('notifications.statusOff')}
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
            {confirmOff ? t('notifications.tapAgain') : busy ? t('common:working') : t('notifications.turnOff')}
          </button>
        )}
        {!loading && !subscribed && (
          <button
            type="button"
            className="tech-settings-btn tech-settings-btn--primary"
            onClick={enable}
            disabled={busy || !flagOn || !supported || !configured || permission === 'denied'}
          >
            {busy ? t('notifications.turningOn') : t('notifications.turnOn')}
          </button>
        )}
      </div>

      {/* Contextual guidance */}
      {!flagOn && (
        <div className="tech-settings-hint">
          {t('notifications.hintRollout')}
        </div>
      )}
      {flagOn && !supported && isIOS && !isStandalone && (
        <div className="tech-settings-note">
          <Trans t={t} i18nKey="notifications.iosGuide" components={{ b: <b /> }} />
        </div>
      )}
      {flagOn && !supported && !isIOS && (
        <div className="tech-settings-hint">{t('notifications.cantReceive')}</div>
      )}
      {flagOn && supported && !configured && (
        <div className="tech-settings-hint">{t('notifications.serverNotSet')}</div>
      )}
      {flagOn && supported && configured && permission === 'denied' && (
        <div className="tech-settings-hint">
          {t('notifications.blockedHint')}
        </div>
      )}
    </div>
  );
}
