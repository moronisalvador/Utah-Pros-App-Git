import { useEffect, useRef, useState } from 'react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

// Small status pill for the TechLayout header. Three visual states:
//   - pending > 0  → amber "Syncing N" with spinner
//   - error   > 0  → red "N failed" (tap retries)
//   - idle         → briefly flashes "Synced" for 2s after the last item lands, then hides

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

export default function OfflineStatusPill() {
  const { pendingCount, errorCount, retryAll } = useOfflineQueue();
  const [showSynced, setShowSynced] = useState(false);
  const prevPending = useRef(pendingCount);
  const fadeTimer = useRef(null);

  // Flash "Synced" for 2s after the queue goes from >0 to 0 with no errors.
  useEffect(() => {
    if (prevPending.current > 0 && pendingCount === 0 && errorCount === 0) {
      setShowSynced(true);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setShowSynced(false), 2000);
    }
    prevPending.current = pendingCount;
    return () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); };
  }, [pendingCount, errorCount]);

  const handleRetry = async () => {
    try {
      await retryAll();
      window.dispatchEvent(new CustomEvent('upr:toast', {
        detail: { message: 'Retrying queued uploads', type: 'success' },
      }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('upr:toast', {
        detail: { message: 'Retry failed: ' + (err?.message || 'unknown'), type: 'error' },
      }));
    }
  };

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

  // Error pill takes precedence — something the tech needs to act on.
  if (errorCount > 0) {
    return (
      <>
        <button
          type="button"
          onClick={handleRetry}
          style={{
            ...basePillStyle,
            background: '#fef2f2',
            color: '#dc2626',
            borderColor: '#fecaca',
            cursor: 'pointer',
          }}
          aria-label={`${errorCount} upload${errorCount === 1 ? '' : 's'} failed — tap to retry`}
        >
          <RetryIcon />
          <span>{errorCount} failed</span>
        </button>
        <SpinKeyframes />
      </>
    );
  }

  if (pendingCount > 0) {
    return (
      <>
        <span
          style={{
            ...basePillStyle,
            background: '#fffbeb',
            color: '#d97706',
            borderColor: '#fde68a',
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
          background: '#f0fdf4',
          color: '#16a34a',
          borderColor: '#bbf7d0',
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
