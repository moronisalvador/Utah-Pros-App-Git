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
 *   Internal:  @/contexts/AuthContext, @/hooks/useResumeRefetch,
 *              @/hooks/useTwoClickConfirm, @/lib/webPushClient,
 *              @/lib/pushNotifications, @/lib/nativeHaptics,
 *              @/lib/toast, ErrorState
 *   Data:      PWA → upsert_push_subscription/delete_push_subscription + VAPID
 *              Native → upsert_my_native_device_token/
 *                       delete_my_native_device_token through APNs helpers
 *
 * NOTES / GOTCHAS:
 *   - Two cards: the device-push on/off, then the per-type × channel preferences
 *     matrix (notify Session C). The matrix reads LIVE types only via the resolver.
 *     Admins see the full catalog (they're the audience for every category);
 *     non-admin roles see only the appointment + messaging categories they can
 *     actually receive.
 *   - iOS only exposes web push inside an installed (Home-Screen) PWA — the
 *     guidance box shows the Add-to-Home-Screen steps when that's the blocker.
 *   - Both the PWA and native app expose device-local on/off controls. Native
 *     uses APNs helpers; PWA uses Web Push. They never cross channels.
 *   - Two-click confirm on "Turn off" (no confirm() dialog — house rule).
 * ════════════════════════════════════════════════
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useTranslation, Trans } from 'react-i18next';
import ErrorState from '@/components/ui/ErrorState';
import { useAuth } from '@/contexts/AuthContext';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { impact } from '@/lib/nativeHaptics';
import { err, toast } from '@/lib/toast';
import {
  isPushSupported, getExistingSubscription, getVapidPublicKey,
  pushPermission, enablePush, disablePush,
} from '@/lib/webPushClient';
import {
  canRegisterPush,
  disableNativePushForDevice,
  enableNativePushForEmployee,
  getNativePushStatus,
  hasNativePushDeviceBinding,
  isNativePushEnrollmentEnabled,
  isNativePushUserEnabled,
} from '@/lib/pushNotifications';
import NotificationPrefsMatrix from '@/components/settings/NotificationPrefsMatrix';
import {
  getNativePushPresentation,
  runDevicePushAction,
} from './nativePushPresentation';

// Non-admin roles (field techs, office, supervisors) are the audience only for
// the appointment + messaging categories; the admin / billing / sales categories
// are Admin-audience types, so we keep those roles' matrix focused on what they
// can actually receive. Admins ARE the audience for every category, so they see
// the full catalog here — same as the office Settings page. (Visibility only;
// notification_role_defaults still governs the defaults + which cells are locked.)
const TECH_CATEGORIES = ['appointments', 'messaging'];
// Plus a few individual types from otherwise-admin categories that DO reach the
// employee themselves: the outcome of a timesheet-change request they filed, and
// the "you may have forgotten to clock out" nudge for their own open clock,
// and the resolution of feedback they personally submitted.
const TECH_EXTRA_TYPES = [
  'timesheet.change_reviewed',
  'clock.abandoned',
  'feedback.resolved',
];
const PUSH_OFF_CONFIRM_KEY = 'device-push-off';

export default function NotificationsSection() {
  // ─── State & hooks ──────────────
  const { t } = useTranslation(['settings', 'common']);
  const {
    db,
    employee,
    isFeatureEnabled,
    pwaOwnerLease,
  } = useAuth();
  const flagOn = isFeatureEnabled('feature:web_push');
  const supported = isPushSupported();
  const isNativeApp = canRegisterPush();
  const nativeEnrollmentOn = isNativePushEnrollmentEnabled();

  const [loading, setLoading] = useState(!isNativeApp);
  const [configured, setConfigured] = useState(
    isNativeApp && nativeEnrollmentOn,
  ); // server has VAPID (web) or the native build is activation-ready
  const [subscribed, setSubscribed] = useState(() => (
    isNativeApp
    && nativeEnrollmentOn
    && isNativePushUserEnabled(undefined, pwaOwnerLease?.owner)
    && hasNativePushDeviceBinding()
  ));
  const [permission, setPermission] = useState('default');
  const [nativeDeliveryEnabled, setNativeDeliveryEnabled] = useState(false);
  const [nativePending, setNativePending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshGenerationRef = useRef(0);
  const {
    isArmed,
    arm,
    cancel,
  } = useTwoClickConfirm(3000);
  const confirmOff = isArmed(PUSH_OFF_CONFIRM_KEY);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    const generation = ++refreshGenerationRef.current;
    if (!silent) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      if (isNativeApp) {
        const status = await getNativePushStatus({
          ownerKey: pwaOwnerLease?.owner,
        });
        if (generation !== refreshGenerationRef.current) {
          return { ok: false, stale: true };
        }
        setSubscribed(status.intentEnabled && status.bound);
        setConfigured(status.available);
        setPermission(status.permission);
        setNativeDeliveryEnabled(status.enabled);
        setNativePending(status.pending);
        setLoadError(false);
        return { ok: true };
      }
      setPermission(pushPermission());
      const [sub, key] = await Promise.all([getExistingSubscription(), getVapidPublicKey()]);
      if (generation !== refreshGenerationRef.current) {
        return { ok: false, stale: true };
      }
      setSubscribed(!!sub);
      setConfigured(!!key);
      setLoadError(false);
      return { ok: true };
    } catch {
      if (generation === refreshGenerationRef.current && !silent) {
        setLoadError(true);
      }
      return { ok: false };
    } finally {
      if (
        generation === refreshGenerationRef.current
        && !silent
      ) setLoading(false);
    }
  }, [isNativeApp, pwaOwnerLease?.owner]);
  useEffect(() => {
    void refresh();
    return () => {
      refreshGenerationRef.current += 1;
    };
  }, [refresh]);
  useResumeRefetch({
    enabled: isNativeApp,
    onResume: () => refresh({ silent: true }),
  });

  // iOS exposes Push only inside an installed PWA.
  const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
  const isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true);
  const nativePresentation = getNativePushPresentation({
    activationReady: nativeEnrollmentOn,
    bound: subscribed,
    effectiveEnabled: nativeDeliveryEnabled,
    intentEnabled: subscribed,
    pending: nativePending,
    permission,
  });

  // SET-01: inside the Capacitor app none of the Web Push machinery applies.
  // WKWebView exposes no PushManager, so `supported` is false and the iOS
  // userAgent regex above still matches — which previously rendered the
  // Add-to-Home-Screen guide to someone already using the installed app, next
  // to a disabled Turn On button. Native push rides APNs, not Web Push, so the
  // native branches below own this surface entirely.
  // ─── Event handlers ──────────────
  const enable = async () => {
    if (isNativeApp) impact('light');
    refreshGenerationRef.current += 1;
    setBusy(true);
    try {
      const res = await runDevicePushAction({
        isNativeApp,
        nativeAction: () => enableNativePushForEmployee(
          db,
          employee?.id,
          {
            ownerKey: pwaOwnerLease?.owner,
          },
        ),
        webAction: () => enablePush(db),
      });
      if (res.ok) {
        setSubscribed(true);
        setPermission('granted');
        if (isNativeApp) {
          setNativeDeliveryEnabled(true);
          setNativePending(false);
        }
        toast(t('notifications.toastEnabled'), 'success');
        await refresh({ silent: true });
      }
      else if (res.reason === 'denied' || res.reason === 'permission_denied') {
        toast(t('notifications.toastBlocked'), 'error');
      }
      else if (res.reason === 'unconfigured') toast(t('notifications.toastUnconfigured'), 'error');
      else if (res.reason === 'unsupported') toast(t('notifications.toastUnsupported'), 'error');
      else if (res.reason === 'cleanup_pending') {
        toast(t('notifications.toastCleanupPending'), 'warning');
      }
      else toast(t('notifications.toastGenericOn'), 'error');
    } catch {
      err(t('notifications.toastGenericOn'));
    } finally { setBusy(false); }
  };

  const disable = async () => {
    if (isNativeApp) impact('light');
    if (!confirmOff) {
      arm(PUSH_OFF_CONFIRM_KEY);
      return;
    }
    cancel();
    refreshGenerationRef.current += 1;
    setBusy(true);
    try {
      const res = await runDevicePushAction({
        isNativeApp,
        nativeAction: () => disableNativePushForDevice(db, {
          ownerKey: pwaOwnerLease?.owner,
        }),
        webAction: () => disablePush(db),
      });
      if (res.ok) {
        setSubscribed(false);
        if (isNativeApp) {
          setNativeDeliveryEnabled(false);
          setNativePending(false);
        }
        toast(t('notifications.toastTurnedOff'), 'success');
        await refresh({ silent: true });
      }
      else if (
        isNativeApp
        && res.preferenceStored
        && res.localDetached
        && res.localStateCleared
      ) {
        setSubscribed(false);
        setNativeDeliveryEnabled(false);
        setNativePending(true);
        toast(t('notifications.toastOffCleanupPending'), 'warning');
        await refresh({ silent: true });
      }
      else toast(t('notifications.toastGenericOff'), 'error');
    } catch {
      err(t('notifications.toastGenericOff'));
    } finally { setBusy(false); }
  };

  // ─── Render ──────────────
  return (
    <>
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">{t('notifications.title')}</div>
        <div className="tech-settings-card-sub">
          {t('notifications.sub')}
        </div>
      </div>

      {loadError && !loading ? (
        <ErrorState
          message={t('notifications.loadError')}
          onRetry={() => refresh()}
          retryLabel={t('notifications.retry')}
        />
      ) : (
        <>
        {/* Enable/disable push row */}
        <div className="tech-settings-row">
        <div className="tech-settings-row-main">
          <div className="tech-settings-row-label">{t('notifications.rowLabel')}</div>
          <div className="tech-settings-row-value">
            {loading
              ? t('common:checking')
              : isNativeApp ? t(nativePresentation.statusKey)
              : subscribed ? t('notifications.statusOn')
              : t('notifications.statusOff')}
          </div>
        </div>
        {!loading && subscribed && (!isNativeApp || nativeEnrollmentOn) && (
          <button
            type="button"
            className="tech-settings-btn"
            data-confirm={confirmOff ? 'true' : 'false'}
            onClick={disable}
            onBlur={cancel}
            disabled={busy}
          >
            {confirmOff ? t('notifications.tapAgain') : busy ? t('common:working') : t('notifications.turnOff')}
          </button>
        )}
        {!loading && !subscribed && (!isNativeApp || nativeEnrollmentOn) && (
          <button
            type="button"
            className="tech-settings-btn tech-settings-btn--primary"
            onClick={enable}
            disabled={
              busy
              || !configured
              || (!isNativeApp && (
                !flagOn
                || !supported
                || permission === 'denied'
              ))
            }
          >
            {busy ? t('notifications.turningOn') : t('notifications.turnOn')}
          </button>
        )}
        </div>

        {/* Contextual guidance — native first, so no web-only copy can leak
            into the installed app. Every branch below is web/PWA. */}
        {isNativeApp && (
          <div className="tech-settings-hint">
            {t(nativePresentation.hintKey)}
          </div>
        )}
        {!isNativeApp && !flagOn && (
          <div className="tech-settings-hint">
            {t('notifications.hintRollout')}
          </div>
        )}
        {!isNativeApp && flagOn && !supported && isIOS && !isStandalone && (
          <div className="tech-settings-note">
            <Trans t={t} i18nKey="notifications.iosGuide" components={{ b: <b /> }} />
          </div>
        )}
        {!isNativeApp && flagOn && !supported && !isIOS && (
          <div className="tech-settings-hint">{t('notifications.cantReceive')}</div>
        )}
        {!isNativeApp && flagOn && supported && !configured && (
          <div className="tech-settings-hint">{t('notifications.serverNotSet')}</div>
        )}
        {!isNativeApp && flagOn && supported && configured && permission === 'denied' && (
          <div className="tech-settings-hint">
            {t('notifications.blockedHint')}
          </div>
        )}
        </>
      )}
    </div>

    {/* Per-type × channel preferences (tech-visible types only, ≥48px targets). */}
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">{t('notifications.prefsTitle')}</div>
        <div className="tech-settings-card-sub">{t('notifications.prefsSub')}</div>
      </div>
      <NotificationPrefsMatrix
        db={db}
        employeeId={employee?.id}
        variant="tech"
        categoryFilter={employee?.role === 'admin' ? null : TECH_CATEGORIES}
        typeFilter={employee?.role === 'admin' ? null : TECH_EXTRA_TYPES}
        labels={{
          channelBell:  t('notifications.chBell'),
          channelPush:  t('notifications.chPush'),
          channelEmail: t('notifications.chEmail'),
          empty:        t('notifications.prefsEmpty'),
          locked:       t('notifications.prefsLocked'),
        }}
      />
    </div>
    </>
  );
}
