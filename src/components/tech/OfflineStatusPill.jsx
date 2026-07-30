/**
 * ════════════════════════════════════════════════
 * FILE: OfflineStatusPill.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The local-offline-status badge in the field-app header. Automatic command
 *   admission/replay is disabled, so historical or ambiguous work is surfaced
 *   for review and local recovery without a resend action.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (header status component)
 *   Rendered by:  src/components/TechLayout.jsx (the field-app shell header)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/hooks/useOfflineQueue
 *   Data:      reads  → none (Supabase); reflects local IndexedDB state through
 *                        useOfflineQueue
 *              writes → local-only review/recovery actions; no server send
 *
 * NOTES / GOTCHAS:
 *   - Precedence: manual review/recovery wins over pending/synced.
 *   - The "Synced" flash only fires on a >0 → 0 transition with no errors,
 *     and auto-hides after 2s.
 *   - Injects its spin keyframes inline (stable id, dedup-safe) only while visible.
 * ════════════════════════════════════════════════
 */
import { useEffect, useRef, useState } from 'react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import OfflineReconciliationPanel from './OfflineReconciliationPanel';

// ─── SECTION: Icon helpers ──────────────
function SpinnerIcon({ size = 12 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'upr-spin 0.9s linear infinite' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── SECTION: Render ──────────────
export default function OfflineStatusPill() {
  const {
    pendingCount,
    errorCount,
    blockedCount,
    quarantinedCount,
    rolloutReady,
    legacyRecoveryRequired,
    unsupportedRecoveryRequired,
    inspectionUnavailable,
    storageState,
    loadBlocked,
    resolveBlocked,
    retryOfflineStorage,
    discardLegacyOfflineData,
  } = useOfflineQueue();
  const [showSynced, setShowSynced] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const prevPending = useRef(pendingCount);
  const showTimer = useRef(null);
  const fadeTimer = useRef(null);

  // Flash "Synced" for 2s after the queue goes from >0 to 0 with no errors.
  useEffect(() => {
    if (prevPending.current > 0 && pendingCount === 0 && errorCount === 0) {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      showTimer.current = setTimeout(() => {
        setShowSynced(true);
        fadeTimer.current = setTimeout(() => setShowSynced(false), 2000);
      }, 0);
    }
    prevPending.current = pendingCount;
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [pendingCount, errorCount]);

  const basePillStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 26,
    borderRadius: 'var(--radius-full)',
    padding: '2px 10px',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 600,
    lineHeight: 1,
    border: '1px solid transparent',
    cursor: 'default',
    userSelect: 'none',
  };
  const storageBlocked = [
    'blocked',
    'error',
    'version-changed',
  ].includes(storageState?.status);
  const recoveryRequired = rolloutReady === false
    || legacyRecoveryRequired
    || unsupportedRecoveryRequired
    || inspectionUnavailable;

  // This recovery surface never resends historical work.
  if (
    blockedCount > 0
    || quarantinedCount > 0
    || storageBlocked
    || recoveryRequired
  ) {
    return (
      <div style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {(
          blockedCount > 0
          || quarantinedCount > 0
          || storageBlocked
          || recoveryRequired
        ) && (
          <button
            type="button"
            onClick={() => setReviewOpen((open) => !open)}
            aria-expanded={reviewOpen}
            aria-label={storageBlocked
              ? 'Offline storage is blocked; open recovery guidance'
              : inspectionUnavailable
                ? 'Offline work could not be inspected; open recovery guidance'
              : recoveryRequired
                ? 'Legacy offline work requires a recovery decision'
                : blockedCount > 0
                  ? `${blockedCount} offline action${blockedCount === 1 ? '' : 's'} need review; ${quarantinedCount} quarantined local records`
                  : `${quarantinedCount} quarantined local record${quarantinedCount === 1 ? '' : 's'}`}
            title={storageBlocked
              ? storageState?.guidance
              : inspectionUnavailable
                ? 'Offline work could not be inspected. Close other UPR tabs, reload, and retry.'
              : recoveryRequired
                ? 'Unsynced legacy work is quarantined and blocks rollout.'
                : blockedCount > 0
                  ? 'This work may already be on the server. Review it online without resending.'
                  : 'Foreign, legacy, or unsupported local records remain quarantined and unchanged.'}
            style={{
              ...basePillStyle,
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              borderColor: 'var(--warning-border)',
              cursor: 'pointer',
            }}
          >
            <RetryIcon />
            <span>
              {storageBlocked
                ? 'Offline storage blocked'
                : inspectionUnavailable
                  ? 'Offline inspection blocked'
                : recoveryRequired
                  ? 'Legacy work blocked'
                  : blockedCount > 0
                    ? `${blockedCount} need review`
                    : `${quarantinedCount} quarantined`}
            </span>
          </button>
        )}
        {reviewOpen && (
          <OfflineReconciliationPanel
            loadBlocked={loadBlocked}
            resolveBlocked={resolveBlocked}
            storageState={storageState}
            retryOfflineStorage={retryOfflineStorage}
            discardLegacyOfflineData={discardLegacyOfflineData}
            onClose={() => setReviewOpen(false)}
          />
        )}
        <SpinKeyframes />
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <>
        <span
          style={{
            ...basePillStyle,
            background: 'var(--warning-bg)',
            color: 'var(--warning)',
            borderColor: 'var(--warning-border)',
          }}
        >
          <SpinnerIcon />
          <span>Syncing {pendingCount}</span>
        </span>
        <SpinKeyframes />
      </>
    );
  }

  if (showSynced) {
    return (
      <span
        style={{
          ...basePillStyle,
          background: 'var(--success-bg)',
          color: 'var(--success)',
          borderColor: 'var(--success-border)',
          transition: 'opacity 0.3s ease',
        }}
      >
        <CheckIcon />
        <span>Synced</span>
      </span>
    );
  }

  return null;
}

// Scoped keyframe definition — injected once by whichever pill instance is visible.
// Using a stable id prevents duplicates if multiple pills mount.
function SpinKeyframes() {
  return (
    <style>{`@keyframes upr-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
  );
}
