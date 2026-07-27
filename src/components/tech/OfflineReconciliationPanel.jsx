/**
 * ════════════════════════════════════════════════
 * FILE: OfflineReconciliationPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows sanitized local reminders whose server outcome cannot be retried
 *   safely. A technician can confirm evidence already visible on the server or
 *   deliberately remove the local reminder, using the standard two-click guard.
 *
 * WHERE IT LIVES:
 *   Rendered by:  OfflineStatusPill in the field-app header
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  useTwoClickConfirm, toast
 *   Data:      owner-scoped sanitized IndexedDB projections only
 *
 * NOTES / GOTCHAS:
 *   - This panel never sends or retries an operation.
 *   - Raw queue payloads, photo blobs, and foreign-owner rows are never passed in.
 *   - Legacy recovery is payload-free: preserve/close, retry an IndexedDB open,
 *     or explicitly two-click discard every local offline store.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useState } from 'react';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { toast } from '@/lib/toast';

const TYPE_LABELS = {
  'photo.upload': 'Photo upload',
  'reading.insert': 'Moisture reading',
  'equipment.place': 'Equipment placement',
  'equipment.remove': 'Equipment removal',
};

const CONTEXT_LABELS = {
  jobId: 'Job',
  appointmentId: 'Visit',
  roomId: 'Room',
  name: 'File',
  material: 'Material',
  location: 'Location',
  takenAt: 'Captured',
  equipmentType: 'Equipment',
  nickname: 'Nickname',
  serialNumber: 'Serial',
  equipmentId: 'Equipment ID',
};

function formatTime(value) {
  if (!Number.isFinite(value)) return 'Time unavailable';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'Time unavailable';
  }
}

function Context({ values }) {
  const entries = Object.entries(values || {}).filter(([, value]) => (
    value !== null && value !== undefined && value !== ''
  ));
  if (entries.length === 0) return null;
  return (
    <dl style={{
      display: 'grid',
      gridTemplateColumns: 'max-content minmax(0, 1fr)',
      gap: '3px 8px',
      margin: '8px 0 0',
      fontSize: 11,
    }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--text-tertiary)' }}>
            {CONTEXT_LABELS[key] || key}
          </dt>
          <dd style={{
            margin: 0,
            color: 'var(--text-secondary)',
            overflowWrap: 'anywhere',
          }}>
            {String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function OfflineReconciliationPanel({
  loadBlocked,
  resolveBlocked,
  storageState,
  retryOfflineStorage,
  discardLegacyOfflineData,
  onClose,
}) {
  const [result, setResult] = useState({
    items: [],
    quarantined: {
      foreign: 0,
      legacy: 0,
      unsupported: 0,
      orphanPhotos: 0,
      total: 0,
    },
    rollout: {
      ready: true,
      legacyRecoveryRequired: false,
      unsupportedRecoveryRequired: false,
      gate: null,
    },
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const { isArmed, arm, cancel } = useTwoClickConfirm(5000);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setResult(await loadBlocked());
    } catch (error) {
      setLoadError(error?.message || 'unknown');
      toast(`Could not inspect offline work: ${error?.message || 'unknown'}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [loadBlocked]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (item, resolution) => {
    const key = `${resolution}:${item.operationId}`;
    if (!isArmed(key)) {
      arm(key);
      return;
    }
    cancel();
    setBusyKey(key);
    try {
      const resolved = await resolveBlocked(
        item.operationId,
        resolution,
        {
          confirmedVisibleOnServer: resolution === 'accepted',
        },
      );
      if (!resolved) {
        toast('That offline reminder is no longer available', 'error');
      } else {
        toast(
          resolution === 'accepted'
            ? 'Marked as confirmed on the server'
            : 'Local offline reminder removed',
          'success',
        );
      }
      await reload();
    } catch (error) {
      toast(`Could not resolve offline work: ${error?.message || 'unknown'}`, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const retryStorage = async () => {
    if (typeof retryOfflineStorage !== 'function') return;
    setBusyKey('retry-storage');
    try {
      await retryOfflineStorage();
      toast('Offline storage reopened', 'success');
      await reload();
    } catch (error) {
      toast(
        `Offline storage is still unavailable: ${error?.message || 'unknown'}`,
        'error',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const discardAll = async () => {
    const key = 'discard-all-offline-data';
    if (!isArmed(key)) {
      arm(key);
      return;
    }
    cancel();
    setBusyKey(key);
    try {
      await discardLegacyOfflineData();
      toast('All local offline data was discarded', 'success');
      await reload();
    } catch (error) {
      toast(
        `Could not discard local offline data: ${error?.message || 'unknown'}`,
        'error',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const storageBlocked = [
    'blocked',
    'error',
    'version-changed',
  ].includes(storageState?.status);
  const legacyDecisionRequired = result.rollout?.ready === false
    || result.quarantined.legacy > 0
    || result.quarantined.unsupported > 0;

  return (
    <section
      aria-label="Offline work review"
      style={{
        position: 'absolute',
        zIndex: 1200,
        top: 'calc(100% + 8px)',
        right: 0,
        width: 'min(360px, calc(100vw - 24px))',
        maxHeight: 'min(520px, calc(100dvh - 90px))',
        overflowY: 'auto',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        padding: 12,
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        background: 'var(--bg-primary)',
        boxShadow: 'var(--shadow-lg)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            Review offline work
          </div>
          <p style={{
            margin: '4px 0 0',
            color: 'var(--text-secondary)',
            fontSize: 11,
            lineHeight: 1.4,
          }}>
            Do not resend these. First verify the matching record while online.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close offline work review"
          style={{
            border: 0,
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 20,
            lineHeight: 1,
            minWidth: 44,
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 2,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      {storageBlocked && (
        <div
          role="alert"
          style={{
            margin: '10px 0',
            padding: 10,
            border: '1px solid #fed7aa',
            borderRadius: 8,
            background: '#fff7ed',
            color: '#9a3412',
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 3 }}>
            Offline storage needs attention
          </strong>
          {storageState?.message || 'Offline storage could not be opened.'}
          {' '}
          {storageState?.guidance
            || 'Close other UPR tabs, then reload this page and retry offline storage.'}
          <button
            type="button"
            disabled={!!busyKey}
            onClick={() => { void retryStorage(); }}
            style={{
              display: 'block',
              minHeight: 44,
              marginTop: 8,
              border: '1px solid #fdba74',
              borderRadius: 8,
              background: '#fff',
              color: '#9a3412',
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {busyKey === 'retry-storage'
              ? 'Retrying…'
              : 'Retry offline storage'}
          </button>
        </div>
      )}

      {result.quarantined.total > 0 && (
        <p
          role="status"
          style={{
            margin: '10px 0',
            padding: '7px 8px',
            borderRadius: 8,
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {result.quarantined.total} quarantined local record
          {result.quarantined.total === 1 ? '' : 's'} hidden (
          {result.quarantined.foreign} from another account,{' '}
          {result.quarantined.legacy} unowned legacy,{' '}
          {result.quarantined.unsupported || 0} unsupported, including{' '}
          {result.quarantined.orphanPhotos || 0} local photo file
          {result.quarantined.orphanPhotos === 1 ? '' : 's'}). They were not
          {' '}adopted or changed.
        </p>
      )}

      {legacyDecisionRequired && (
        <div
          role="alert"
          style={{
            margin: '10px 0',
            padding: 10,
            border: '1px solid #fecaca',
            borderRadius: 8,
            background: '#fef2f2',
            color: '#991b1b',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>
            Unsynced legacy work may be discarded
          </strong>
          UPR cannot safely assign this legacy work to the signed-in account.
          To preserve it, stop now, close every other UPR tab, reload, and use
          the staged recovery rollout. Discarding removes all local offline
          work on this device, including another account&apos;s work, without
          sending anything.
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 8,
          }}>
            <button
              type="button"
              disabled={!!busyKey}
              onClick={onClose}
              style={{
                minHeight: 44,
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                padding: '7px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Keep data and close
            </button>
            <button
              type="button"
              disabled={!!busyKey}
              onClick={() => { void discardAll(); }}
              onBlur={cancel}
              style={{
                minHeight: 44,
                border: '1px solid #fecaca',
                borderRadius: 8,
                background: isArmed('discard-all-offline-data')
                  ? '#991b1b'
                  : '#fff',
                color: isArmed('discard-all-offline-data')
                  ? '#fff'
                  : '#991b1b',
                padding: '7px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {busyKey === 'discard-all-offline-data'
                ? 'Discarding…'
                : isArmed('discard-all-offline-data')
                  ? 'Confirm discard all'
                  : 'Discard local offline data'}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          Checking local reminders…
        </p>
      )}
      {!loading && loadError && (
        <p role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>
          Offline work could not be inspected. Close other UPR tabs, reload,
          and retry.
        </p>
      )}
      {!loading && !loadError && result.items.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          No blocked reminders for this account.
        </p>
      )}

      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {result.items.map((item) => {
          const acceptKey = `accepted:${item.operationId}`;
          const cancelKey = `cancelled:${item.operationId}`;
          return (
            <article
              key={item.operationId}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 10,
                padding: 10,
                background: 'var(--bg-secondary)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                {TYPE_LABELS[item.type] || 'Offline action'}
              </div>
              <div style={{
                marginTop: 2,
                color: item.state === 'server-outcome-unknown'
                  ? '#b45309'
                  : '#b91c1c',
                fontSize: 11,
              }}>
                {item.state === 'server-outcome-unknown'
                  ? 'Server outcome unknown'
                  : 'Server rejected this action'}
                {' · '}
                {formatTime(item.updatedAt || item.createdAt)}
              </div>
              <Context values={item.context} />
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 10,
              }}>
                {item.canConfirmAccepted && (
                  <button
                    type="button"
                    disabled={!!busyKey}
                    onClick={() => { void act(item, 'accepted'); }}
                    onBlur={cancel}
                    style={{
                      minHeight: 44,
                      border: '1px solid #86efac',
                      borderRadius: 8,
                      background: isArmed(acceptKey) ? '#166534' : '#f0fdf4',
                      color: isArmed(acceptKey) ? '#fff' : '#166534',
                      padding: '5px 9px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {busyKey === acceptKey
                      ? 'Saving…'
                      : isArmed(acceptKey)
                        ? 'Confirm found'
                        : 'I found it online'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!!busyKey}
                  onClick={() => { void act(item, 'cancelled'); }}
                  onBlur={cancel}
                  style={{
                    minHeight: 44,
                    border: '1px solid #fecaca',
                    borderRadius: 8,
                    background: isArmed(cancelKey) ? '#b91c1c' : '#fff',
                    color: isArmed(cancelKey) ? '#fff' : '#b91c1c',
                    padding: '5px 9px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {busyKey === cancelKey
                    ? 'Removing…'
                    : isArmed(cancelKey)
                      ? 'Confirm remove'
                      : 'Remove reminder'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
