/**
 * ════════════════════════════════════════════════
 * FILE: TechOnboarding.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one-time welcome tour a technician sees the very first time they open
 *   the app: what the app is, what it does for their day, and — after
 *   explaining WHY — an invitation to turn on notifications. Saying "Not now"
 *   finishes the tour just the same; Settings remains the way to turn
 *   notifications on later. It never shows again once finished.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (full-screen overlay inside the tech shell)
 *   Rendered by:  src/components/TechLayout.jsx (lazy, only when the
 *                 useTechOnboarding gate says the tour is unseen)
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  @/contexts/AuthContext, @/lib/pushNotifications,
 *              @/lib/webPushClient, @/lib/nativeHaptics,
 *              @/components/tech/settings/nativePushPresentation
 *   Data:      writes → device_tokens via upsert_my_native_device_token
 *                       (native) or push_subscriptions via
 *                       upsert_push_subscription (web) — both only through
 *                       the existing fail-closed enrollment chokepoints
 *
 * NOTES / GOTCHAS:
 *   - Push enrollment goes ONLY through enableNativePushForEmployee /
 *     enablePush — never the Capacitor plugin directly. Every failure reason
 *     (denied, unconfigured, owner lease missing…) lands on the same gentle
 *     "you can turn these on in Settings" path; the tour always completes.
 *   - The notifications step is skipped entirely when this build/device can't
 *     enroll (web push flag off, unsupported browser, permission already
 *     denied, native enrollment env off).
 *   - Exit/step-out animations have JS timer fallbacks so reduced-motion
 *     (animation: none → no animationend) can never strand the overlay.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { impact, notify } from '@/lib/nativeHaptics';
import {
  canRegisterPush,
  enableNativePushForEmployee,
  isNativePushEnrollmentEnabled,
} from '@/lib/pushNotifications';
import {
  enablePush,
  isPushSupported,
  pushPermission,
} from '@/lib/webPushClient';
import { runDevicePushAction } from '@/components/tech/settings/nativePushPresentation';
// Component-scoped stylesheet: rides this lazy chunk instead of index.css
// (which sits at its blocking CI size budget); precedent: claim-page.css.
import './TechOnboarding.css';

// Mirrors the toast exit safety net in TechLayout: reduced-motion collapses
// animations to none, so animationend never fires — a timer must finish the
// unmount instead.
const EXIT_FALLBACK_MS = 400;
const STEP_LEAVE_FALLBACK_MS = 300;

/* ── Step artwork (module scope so remounts can't restart animations
      mid-render — motion-standard.md §5) ── */

function ArtWelcome(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 13 15 13 15 22" />
    </svg>
  );
}

function ArtValue(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  );
}

function ArtBell(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function ArtCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function RowIconCalendar(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function RowIconCamera(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function RowIconChat(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const STEP_ART = {
  welcome: ArtWelcome,
  value: ArtValue,
  notify: ArtBell,
};

export default function TechOnboarding({ onComplete }) {
  // ─── State & hooks ──────────────
  const { t } = useTranslation('tech');
  const {
    db,
    employee,
    isFeatureEnabled,
    pwaOwnerLease,
  } = useAuth();

  const isNativeApp = canRegisterPush();
  // 'native' | 'web' | 'none' — decided once at mount. 'none' drops the
  // notifications step entirely (grace over a dead-end prompt); Settings →
  // Notifications remains the recovery path either way.
  const pushMode = useMemo(() => {
    if (isNativeApp) {
      return isNativePushEnrollmentEnabled() ? 'native' : 'none';
    }
    if (!isFeatureEnabled('feature:web_push')) return 'none';
    if (!isPushSupported()) return 'none';
    return pushPermission() === 'denied' ? 'none' : 'web';
  }, [isNativeApp, isFeatureEnabled]);

  const steps = useMemo(() => (
    pushMode === 'none'
      ? ['welcome', 'value']
      : ['welcome', 'value', 'notify']
  ), [pushMode]);

  const [stepIndex, setStepIndex] = useState(0);
  const [leavingIndex, setLeavingIndex] = useState(null);
  const [closing, setClosing] = useState(false);
  // 'idle' | 'busy' | 'granted' | 'declined'
  const [enroll, setEnroll] = useState('idle');
  const completedRef = useRef(false);
  const rootRef = useRef(null);

  // Focus trap (Modal.jsx idiom): focus enters on mount and Tab cycles inside
  // the dialog. No Escape handler — finishing the tour is the only way out,
  // and "Not now" / "Done" are always present.
  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
    const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKeyDown = (e) => {
      if (e.key !== 'Tab' || !root) return;
      const items = root.querySelectorAll(FOCUSABLE);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const finishOverlay = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  // Reduced-motion safety net: with animations collapsed, neither the overlay
  // exit nor a step exit fires animationend — timers finish the job.
  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(finishOverlay, EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [closing, finishOverlay]);

  useEffect(() => {
    if (leavingIndex === null) return undefined;
    const timer = setTimeout(
      () => setLeavingIndex(null),
      STEP_LEAVE_FALLBACK_MS,
    );
    return () => clearTimeout(timer);
  }, [leavingIndex]);

  // ─── Event handlers ──────────────
  const beginClose = () => {
    if (closing) return;
    setClosing(true);
  };

  const advance = () => {
    if (closing) return;
    impact('light');
    if (stepIndex < steps.length - 1) {
      setLeavingIndex(stepIndex);
      setStepIndex(stepIndex + 1);
    } else {
      beginClose();
    }
  };

  const enableNotifications = async () => {
    if (enroll === 'busy' || closing) return;
    impact('light');
    setEnroll('busy');
    try {
      // The two existing fail-closed chokepoints — never the plugin directly.
      const res = await runDevicePushAction({
        isNativeApp,
        nativeAction: () => enableNativePushForEmployee(
          db,
          employee?.id,
          { ownerKey: pwaOwnerLease?.owner },
        ),
        webAction: () => enablePush(db),
      });
      if (res?.ok) {
        notify('success');
        setEnroll('granted');
      } else {
        // Every refusal (denied, unconfigured, lease missing, timeout…) lands
        // here: no nagging, no retry loop — Settings is the recovery path.
        setEnroll('declined');
      }
    } catch {
      setEnroll('declined');
    }
  };

  const isLast = stepIndex === steps.length - 1;
  const currentKey = steps[stepIndex];
  const notifySettled = enroll === 'granted' || enroll === 'declined';

  // ─── Render ──────────────
  const renderStep = (key, index) => {
    const Art = key === 'notify' && enroll === 'granted'
      ? ArtCheck
      : STEP_ART[key];
    const leaving = index === leavingIndex;
    // Keyed by step name alone (names are unique per tour) so the leaving
    // step keeps its DOM node — children frozen mid-rise by the CSS pause
    // instead of snapping to their end state before the fade.
    return (
      <div
        key={key}
        className={`tech-onb-step${leaving ? ' tech-onb-step--leaving' : ''}`}
        aria-hidden={leaving || undefined}
        onAnimationEnd={(e) => {
          if (leaving && e.animationName === 'techOnbStepOut') {
            setLeavingIndex(null);
          }
        }}
      >
        <div className="tech-onb-art" data-step={key}>
          <span className="tech-onb-halo" aria-hidden="true" />
          <span
            key={key === 'notify' && enroll === 'granted' ? 'success' : 'art'}
            className={`tech-onb-icon${key === 'notify' && enroll === 'granted' ? ' tech-onb-icon--success' : ''}`}
            data-ring={
              key === 'notify' && (enroll === 'idle' || enroll === 'busy')
                ? 'true'
                : undefined
            }
          >
            <Art width={64} height={64} />
          </span>
        </div>

        <h2 className="tech-onb-title">
          {key === 'notify' && enroll === 'granted'
            ? t('onboarding.notifyGrantedTitle')
            : t(`onboarding.${key}Title`)}
        </h2>

        {key === 'value' ? (
          <div className="tech-onb-rows">
            {[
              { Icon: RowIconCalendar, text: t('onboarding.valueRow1') },
              { Icon: RowIconCamera, text: t('onboarding.valueRow2') },
              { Icon: RowIconChat, text: t('onboarding.valueRow3') },
            ].map((row, i) => (
              <div className="tech-onb-row" key={i} style={{ '--onb-i': i }}>
                <span className="tech-onb-row-icon"><row.Icon width={20} height={20} /></span>
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="tech-onb-body">
            {key === 'notify' && enroll === 'granted'
              ? t('onboarding.notifyGrantedBody')
              : key === 'notify' && enroll === 'declined'
                ? t('onboarding.notifyDeclinedBody')
                : t(`onboarding.${key}Body`)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={`tech-onb${closing ? ' tech-onb--closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.a11yTitle')}
      tabIndex={-1}
      onAnimationEnd={(e) => {
        if (
          closing
          && e.target === e.currentTarget
          && e.animationName === 'techOnbOut'
        ) finishOverlay();
      }}
    >
      <div className="tech-onb-scene">
        {leavingIndex !== null && renderStep(steps[leavingIndex], leavingIndex)}
        {renderStep(currentKey, stepIndex)}
      </div>

      <div className="tech-onb-footer">
        <div
          className="tech-onb-dots"
          style={{ '--onb-step': stepIndex, '--onb-total': steps.length }}
          aria-hidden="true"
        >
          {steps.map((key) => <span className="tech-onb-dot" key={key} />)}
          <span className="tech-onb-dot-pill" />
        </div>
        <span className="tech-onb-sr" aria-live="polite">
          {t('onboarding.stepOf', {
            n: stepIndex + 1,
            total: steps.length,
          })}
        </span>

        {currentKey !== 'notify' && (
          <button
            type="button"
            className="tech-onb-btn tech-onb-btn--primary"
            onClick={advance}
          >
            {isLast ? t('onboarding.done') : t('onboarding.next')}
          </button>
        )}

        {currentKey === 'notify' && !notifySettled && (
          <>
            <button
              type="button"
              className="tech-onb-btn tech-onb-btn--primary"
              onClick={enableNotifications}
              disabled={enroll === 'busy'}
            >
              {enroll === 'busy'
                ? t('onboarding.enabling')
                : t('onboarding.enableBtn')}
            </button>
            <button
              type="button"
              className="tech-onb-btn tech-onb-btn--ghost"
              onClick={beginClose}
              disabled={enroll === 'busy'}
            >
              {t('onboarding.notNow')}
            </button>
          </>
        )}

        {currentKey === 'notify' && notifySettled && (
          <button
            type="button"
            className="tech-onb-btn tech-onb-btn--primary"
            onClick={beginClose}
          >
            {t('onboarding.done')}
          </button>
        )}
      </div>
    </div>
  );
}
