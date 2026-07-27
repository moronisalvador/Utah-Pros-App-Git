/**
 * ════════════════════════════════════════════════
 * FILE: AccountDeletionPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows whether the signed-in person already asked for their account to be deleted.
 *   If they have not, it provides the same two-step request action in both desktop
 *   My Account settings and the field app's Settings screen.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/my-account and /tech/settings
 *   Rendered by:  src/pages/settings/MyAccount.jsx and src/pages/tech/TechSettings.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/hooks/useTwoClickConfirm,
 *              @/lib/toast, @/components/ui
 *   Data:      reads  → get_my_account_deletion_request (RPC)
 *              writes → request_account_deletion (RPC)
 *
 * NOTES / GOTCHAS:
 *   - This files an administrator-reviewed request; it does not immediately erase
 *     shared jobs, claims, time entries, photos, or other business records.
 *   - The first click only arms the action. A second click within the shared hook's
 *     timeout submits it, and moving focus away cancels the armed state.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { toast } from '@/lib/toast';

const DELETE_ACCOUNT_KEY = 'delete-account';

function normalizeAccountDeletionRequest(row) {
  const request = Array.isArray(row) ? (row[0] || null) : (row || null);
  return request && request.id ? request : null;
}

export default function AccountDeletionPanel({ variant = 'settings' }) {
  const { db, employee, pwaOwnerLease } = useAuth();
  const isTech = variant === 'tech';
  const accountKey = `${employee?.id || 'no-employee'}:${
    pwaOwnerLease?.epoch || 'no-lease'
  }`;
  const accountKeyRef = useRef(accountKey);
  accountKeyRef.current = accountKey;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [request, setRequest] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const operationGenerationRef = useRef(0);
  const { isArmed, arm, cancel } = useTwoClickConfirm();

  const load = useCallback(async () => {
    const requestedAccountKey = accountKey;
    const generation = ++operationGenerationRef.current;
    if (!employee?.id || !pwaOwnerLease?.epoch) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    try {
      const row = await db.rpc('get_my_account_deletion_request');
      if (
        generation !== operationGenerationRef.current
        || requestedAccountKey !== accountKeyRef.current
      ) return;
      setRequest(normalizeAccountDeletionRequest(row));
      setLoadError(false);
    } catch {
      // Do not turn a status-read failure into the actionable "no request" state.
      if (
        generation === operationGenerationRef.current
        && requestedAccountKey === accountKeyRef.current
      ) setLoadError(true);
    } finally {
      if (
        generation === operationGenerationRef.current
        && requestedAccountKey === accountKeyRef.current
      ) setLoading(false);
    }
  }, [accountKey, db, employee?.id, pwaOwnerLease?.epoch]);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    setRequest(null);
    setSubmitting(false);
    cancel();
    load();
    return () => {
      operationGenerationRef.current += 1;
    };
  }, [cancel, load]);

  const submit = async () => {
    cancel();
    setSubmitting(true);
    const requestedAccountKey = accountKey;
    const generation = ++operationGenerationRef.current;
    try {
      const row = await db.rpc('request_account_deletion', { p_notes: null });
      if (
        generation !== operationGenerationRef.current
        || requestedAccountKey !== accountKeyRef.current
      ) return;
      setRequest(normalizeAccountDeletionRequest(row));
      toast('Request submitted — an administrator will process this');
    } catch {
      if (
        generation === operationGenerationRef.current
        && requestedAccountKey === accountKeyRef.current
      ) {
        toast('Could not submit your request. Please try again.', 'error');
      }
    } finally {
      if (
        generation === operationGenerationRef.current
        && requestedAccountKey === accountKeyRef.current
      ) setSubmitting(false);
    }
  };

  const armed = isArmed(DELETE_ACCOUNT_KEY);
  const panelClassName = isTech ? 'tech-settings-card' : 'settings-panel';
  const headerClassName = isTech ? 'tech-settings-card-head' : undefined;
  const titleClassName = isTech ? 'tech-settings-card-title' : undefined;
  const subtitleClassName = isTech ? 'tech-settings-card-sub' : undefined;

  return (
    <section
      className={panelClassName}
      style={isTech ? undefined : { marginTop: 'var(--space-5)' }}
      aria-labelledby="account-deletion-title"
    >
      <div
        className={headerClassName}
        style={isTech ? undefined : { marginBottom: 'var(--space-5)' }}
      >
        <h2
          id="account-deletion-title"
          className={titleClassName}
          style={isTech ? { margin: 0 } : { fontSize: 18, fontWeight: 600, margin: 0 }}
        >
          Delete my account
        </h2>
        <p
          className={subtitleClassName}
          style={isTech ? { margin: 0 } : {
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            margin: '4px 0 0',
          }}
        >
          Request that your account be deleted. Your personal login and app access will be
          deactivated by an administrator. Business and job records you worked on — jobs,
          claims, time entries, and photos — are a shared company record kept for legal and
          accounting reasons, so they are retained rather than erased.
        </p>
      </div>

      {loading ? (
        <div
          aria-label="Loading account deletion status"
          style={{ padding: 'var(--space-5)', display: 'flex', justifyContent: 'center' }}
        >
          <div className="spinner" />
        </div>
      ) : loadError ? (
        <ErrorState message="Could not load your account status." onRetry={load} />
      ) : request ? (
        <div
          className={isTech ? 'tech-settings-note' : undefined}
          style={isTech ? undefined : {
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            background: 'var(--bg-tertiary)',
          }}
        >
          <div
            className={isTech ? 'tech-settings-row-label' : undefined}
            style={isTech ? undefined : {
              fontWeight: 600,
              fontSize: 'var(--text-base)',
            }}
          >
            Deletion requested
          </div>
          <div
            className={isTech ? 'tech-settings-row-value' : undefined}
            style={isTech ? undefined : {
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              marginTop: 4,
            }}
          >
            An administrator will process this
            {request.requested_at
              ? ` · requested ${new Date(request.requested_at).toLocaleDateString()}`
              : ''}.
            Contact your administrator if you need to cancel it.
          </div>
        </div>
      ) : (
        <div
          className={isTech ? 'tech-settings-row' : undefined}
          style={isTech ? undefined : {
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
          }}
        >
          <div
            className={isTech ? 'tech-settings-row-main tech-settings-row-value' : undefined}
            style={isTech ? undefined : {
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              maxWidth: '48ch',
            }}
          >
            This sends a deletion request to your administrator. You can’t undo it yourself —
            reach out to your administrator to cancel.
          </div>
          <button
            type="button"
            className={isTech ? 'tech-settings-btn' : 'btn btn-sm'}
            data-confirm={isTech && armed ? 'true' : undefined}
            onClick={() => (armed ? submit() : arm(DELETE_ACCOUNT_KEY))}
            onBlur={cancel}
            disabled={submitting}
            style={isTech ? undefined : {
              minHeight: 44,
              background: armed ? 'var(--danger-bg)' : 'var(--bg-tertiary)',
              color: armed ? 'var(--danger)' : 'var(--text-secondary)',
              border: `1px solid ${armed ? 'var(--danger-border)' : 'var(--border-light)'}`,
            }}
          >
            {submitting
              ? 'Submitting…'
              : armed
                ? 'Confirm — request deletion'
                : 'Request account deletion'}
          </button>
        </div>
      )}
    </section>
  );
}
