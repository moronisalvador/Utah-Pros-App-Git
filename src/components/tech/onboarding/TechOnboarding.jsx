/**
 * ════════════════════════════════════════════════
 * FILE: TechOnboarding.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one-time welcome tour a technician sees the very first time they open
 *   the app: what the app is, what it does for their day, and — after
 *   explaining WHY — one button that asks the phone for notification
 *   permission. Allowing and declining both finish the tour the same way,
 *   with a polished hand-off into the dashboard underneath. It never shows
 *   again once finished.
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
 *   - Owner spec (2026-07-29): three full-screen steps, FORWARD-ONLY — no X,
 *     no skip, no dismiss. Screen 3 has exactly ONE button; the iOS system
 *     prompt fires only from that press, and Allow/Deny both continue into
 *     the same exit transition (no nagging — Settings → Notifications is the
 *     recovery path). If permission was already decided on this install, the
 *     press proceeds gracefully (enrolls when granted, continues when
 *     denied) because both chokepoints resolve immediately in that case.
 *   - Push enrollment goes ONLY through enableNativePushForEmployee /
 *     enablePush — never the Capacitor plugin directly. When this
 *     build/device can't enroll at all (web-push flag off, unsupported
 *     browser, native enrollment env off), the button simply continues.
 *   - CONTENT vs MECHANISM (owner-confirmed What's-New intent): everything a
 *     future version would change lives in the TOUR_STEPS descriptor list
 *     below (art, copy keys, layout kind, which step primes notifications).
 *     A future "What's New" bumps TECH_ONBOARDING_VERSION in
 *     src/lib/techOnboarding.js and swaps TOUR_STEPS — the shell (gating,
 *     state machine, focus trap, exit choreography) stays untouched.
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
} from '@/lib/webPushClient';
import { runDevicePushAction } from '@/components/tech/settings/nativePushPresentation';
// Component-scoped stylesheet: rides this lazy chunk instead of index.css
// (which sits at its blocking CI size budget); precedent: claim-page.css.
import './TechOnboarding.css';

// Mirrors the toast exit safety net in TechLayout: reduced-motion collapses
// animations to none, so animationend never fires — a timer must finish the
// unmount instead. Covers the two-phase finale (content out, then cover out).
const EXIT_FALLBACK_MS = 800;
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

/* ── CONTENT LAYER (v1) — the only thing a future What's New replaces.
      key      → i18n prefix under tech.json `onboarding.*` ({key}Title etc.)
      kind     → 'info' (title + body) | 'rows' (title + icon rows) |
                 'notify' (title + body + the one permission button)
      ring     → one-shot bell-wiggle accent on the art (notify priming) ── */
const TOUR_STEPS = [
  { key: 'welcome', kind: 'info', Art: ArtWelcome },
  {
    key: 'value',
    kind: 'rows',
    Art: ArtValue,
    rows: [
      { Icon: RowIconCalendar, textKey: 'valueRow1' },
      { Icon: RowIconCamera, textKey: 'valueRow2' },
      { Icon: RowIconChat, textKey: 'valueRow3' },
    ],
  },
  { key: 'notify', kind: 'notify', Art: ArtBell, ring: true },
];

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
  // Which enrollment ACTION the one button on screen 3 performs. The step
  // itself always shows (owner: three steps, period); when this build/device
  // can't enroll, the press just continues into the exit.
  const pushMode = useMemo(() => {
    if (isNativeApp) {
      return isNativePushEnrollmentEnabled() ? 'native' : 'none';
    }
    if (!isFeatureEnabled('feature:web_push')) return 'none';
    return isPushSupported() ? 'web' : 'none';
  }, [isNativeApp, isFeatureEnabled]);

  const [stepIndex, setStepIndex] = useState(0);
  const [leavingIndex, setLeavingIndex] = useState(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const completedRef = useRef(false);
  const rootRef = useRef(null);

  // Focus trap (Modal.jsx idiom): focus enters on mount and Tab cycles inside
  // the dialog. No Escape handler — the flow is deliberately forward-only
  // (owner spec: no dismiss affordance until it completes).
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
    // A step still mid-leave would have its fade REPLACED by the finale's
    // content animation (a brightness pop of stale content) — drop it now.
    setLeavingIndex(null);
    setClosing(true);
  };

  const advance = () => {
    if (closing) return;
    impact('light');
    if (stepIndex < TOUR_STEPS.length - 1) {
      setLeavingIndex(stepIndex);
      setStepIndex(stepIndex + 1);
    } else {
      beginClose();
    }
  };

  // The one button on screen 3. The system permission prompt fires only from
  // this press (both chokepoints request permission inside the action, and
  // both resolve immediately when iOS has already decided for this install).
  // Allow, deny, and can't-enroll all continue into the SAME exit — the only
  // difference is a success haptic. Settings → Notifications is the recovery
  // path; there is no retry loop here.
  const primeNotifications = async () => {
    if (busy || closing) return;
    impact('light');
    if (pushMode === 'none') {
      beginClose();
      return;
    }
    setBusy(true);
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
      if (res?.ok) notify('success');
    } catch {
      // Deliberately quiet: a refusal is a valid outcome of the one-press
      // contract, and the tour must complete either way.
    } finally {
      // `busy` deliberately stays true: flipping it here would re-enable the
      // button (label + opacity flicker) in the same commit that starts the
      // finale. A stuck-busy state is unreachable — `closing` guards
      // re-entry and the exit timer guarantees unmount.
      beginClose();
    }
  };

  const step = TOUR_STEPS[stepIndex];

  // ─── Render ──────────────
  const renderStep = (descriptor, index) => {
    const { key, kind, Art, rows, ring } = descriptor;
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
            className="tech-onb-icon"
            data-ring={ring ? 'true' : undefined}
          >
            <Art width={64} height={64} />
          </span>
        </div>

        <h2 className="tech-onb-title">{t(`onboarding.${key}Title`)}</h2>

        {kind === 'rows' ? (
          <div className="tech-onb-rows">
            {rows.map((row, i) => (
              <div className="tech-onb-row" key={row.textKey} style={{ '--onb-i': i }}>
                <span className="tech-onb-row-icon"><row.Icon width={20} height={20} /></span>
                <span>{t(`onboarding.${row.textKey}`)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="tech-onb-body">{t(`onboarding.${key}Body`)}</p>
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
        {leavingIndex !== null
          && renderStep(TOUR_STEPS[leavingIndex], leavingIndex)}
        {renderStep(step, stepIndex)}
      </div>

      <div className="tech-onb-footer">
        <div
          className="tech-onb-dots"
          style={{ '--onb-step': stepIndex, '--onb-total': TOUR_STEPS.length }}
          aria-hidden="true"
        >
          {TOUR_STEPS.map(({ key }) => (
            <span className="tech-onb-dot" key={key} />
          ))}
          <span className="tech-onb-dot-pill" />
        </div>
        <span className="tech-onb-sr" aria-live="polite">
          {t('onboarding.stepOf', {
            n: stepIndex + 1,
            total: TOUR_STEPS.length,
          })}
        </span>

        {step.kind !== 'notify' ? (
          <button
            type="button"
            className="tech-onb-btn tech-onb-btn--primary"
            onClick={advance}
          >
            {t('onboarding.next')}
          </button>
        ) : (
          <button
            type="button"
            className="tech-onb-btn tech-onb-btn--primary"
            onClick={primeNotifications}
            disabled={busy}
          >
            {busy ? t('onboarding.enabling') : t('onboarding.enableBtn')}
          </button>
        )}
      </div>
    </div>
  );
}
