/**
 * ════════════════════════════════════════════════
 * FILE: MessagingSetupPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives admins one safe, read-only view of customer messaging: which
 *   deployment mode is active, whether CallRail is ready, which tracking
 *   numbers can text, and the dedicated text-webhook URL.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/integrations
 *   Rendered by:  src/pages/settings/Integrations.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/realtime, @/lib/toast, @/components/TabLoading,
 *              @/components/ui
 *   Data:      reads → GET /api/messaging-setup and the read-only
 *                       ?action=callrail-options variant
 *
 * NOTES / GOTCHAS:
 *   - This panel cannot change MESSAGING_SEND_MODE or provider bindings.
 *   - It never displays the CallRail API key or company signing key.
 *   - Selecting a number is a local activation handoff, not a live mutation.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import TabLoading from '@/components/TabLoading';
import { ErrorState, StatusPill } from '@/components/ui';
import { getAuthHeader } from '@/lib/realtime';
import { err, ok } from '@/lib/toast';

const BLOCKER_LABELS = Object.freeze({
  MESSAGING_SCHEMA_NOT_FOUNDATION: 'Messaging foundation is not enabled in this deployment.',
  CALLRAIL_CREDENTIAL_MISSING: 'Connect the CallRail account.',
  CALLRAIL_ACCOUNT_MISSING: 'The CallRail account could not be resolved from the saved credential.',
  CALLRAIL_COMPANY_MISSING: 'Choose a CallRail company for the deployment configuration.',
  CALLRAIL_TRACKING_NUMBER_MISSING: 'Choose an active CallRail tracking number with texting enabled.',
  CALLRAIL_SIGNING_KEY_MISSING: 'Add the CallRail company signing key to the deployment configuration.',
  MESSAGING_HEALTH_NOT_CHECKED: 'Shared messaging recovery health has not been checked.',
  CALLRAIL_EVENTS_PENDING: 'CallRail text events are still waiting to be processed.',
  CALLRAIL_ATTEMPTS_AMBIGUOUS: 'One or more CallRail sends require reconciliation.',
  MESSAGE_NOTIFICATIONS_PENDING: 'Message notifications are still waiting to be delivered.',
  CALLRAIL_SENDER_DISCOVERY_REQUIRED: 'Verify the configured company and sender against live CallRail inventory.',
  MESSAGING_SEND_DISABLED: 'Outbound staff messaging is disabled at the deployment level.',
  TWILIO_IS_ACTIVE_PROVIDER: 'Twilio is the active staff-messaging provider in this deployment.',
});

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return value || 'Unknown number';
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function humanizeCode(code) {
  return String(code || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function blockerLabel(blocker) {
  return BLOCKER_LABELS[blocker?.code] || humanizeCode(blocker?.code);
}

function eligibleSenderOptions(companies = []) {
  return companies.flatMap((company) => (company.senders || [])
    .filter((sender) => sender.sms_supported === true && sender.sms_enabled === true)
    .map((sender) => ({
      ...sender,
      company_id: company.id,
      company_name: company.name,
      option_id: `${company.id}:${sender.tracker_id}:${sender.tracking_number}`,
    })));
}

function modePresentation(mode) {
  if (mode === 'callrail') return { label: 'CallRail active', tone: 'success' };
  if (mode === 'twilio') return { label: 'Twilio active', tone: 'success' };
  return { label: 'Sending disabled', tone: 'warning' };
}

function webhookUrl(path) {
  if (!path) return '/api/callrail-text-webhook';
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).href;
}

// Exported for contract tests: setup reads stay GET-only and uncached.
// eslint-disable-next-line react-refresh/only-export-components
export async function requestMessagingSetup(action, {
  fetcher = fetch,
  authHeader = getAuthHeader,
} = {}) {
  const auth = await authHeader();
  const suffix = action ? `?action=${encodeURIComponent(action)}` : '';
  const response = await fetcher(`/api/messaging-setup${suffix}`, {
    method: 'GET',
    headers: auth,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

// eslint-disable-next-line react-refresh/only-export-components
export function messagingLoadFailure({ cold, hasStatus }) {
  return cold || !hasStatus
    ? { loadError: 'Messaging setup status is unavailable.', refreshError: '' }
    : { loadError: '', refreshError: 'Messaging setup status could not be refreshed.' };
}

function ReadinessItem({ ready, children }) {
  return (
    <li className="settings-msg-check">
      <span
        className={`settings-msg-checkmark${ready ? ' settings-msg-checkmark--ready' : ''}`}
        aria-hidden="true"
      >
        {ready ? '✓' : '—'}
      </span>
      <span>
        <span className="settings-msg-sr-only">{ready ? 'Ready: ' : 'Not ready: '}</span>
        {children}
      </span>
    </li>
  );
}

export function MessagingSetupView({
  status,
  options,
  optionsState,
  selectedOptionId,
  onSelectOption,
  onLoadOptions,
  onCopyWebhook,
  onCopyHandoff,
  onRefresh,
  refreshing = false,
  refreshError = '',
}) {
  const transport = status?.transport || {};
  const callrail = status?.callrail || {};
  const health = status?.health || {};
  const mode = modePresentation(transport.send_mode);
  const senders = eligibleSenderOptions(options?.companies);
  const selectedSender = senders.find((sender) => sender.option_id === selectedOptionId) || null;
  const textWebhookUrl = webhookUrl(callrail.text_webhook?.path);
  const healthReady = (
    transport.schema_mode === 'foundation'
    && health.checked === true
    && Number(health.pending_events || 0) === 0
    && Number(health.ambiguous_attempts || 0) === 0
    && Number(health.pending_notifications || 0) === 0
  );
  const senderVerified = options?.configured_sender_verified === true;
  const effectiveBlockers = (status?.blockers || []).filter((blocker) => (
    blocker.code !== 'CALLRAIL_SENDER_DISCOVERY_REQUIRED' || !senderVerified
  ));

  return (
    <section className="card settings-msg-panel" aria-labelledby="messaging-setup-title">
      <div className="settings-msg-head">
        <div>
          <div className="settings-msg-eyebrow">Customer messaging</div>
          <h2 id="messaging-setup-title" className="settings-msg-title">Messaging setup</h2>
          <p className="settings-msg-sub">
            CallRail for staff-to-customer texts now, with the inbox and consent model ready for a future Twilio cutover.
          </p>
        </div>
        <div className="settings-msg-head-status">
          <StatusPill tone="neutral" label={status?.environment === 'production' ? 'Production' : 'Preview'} />
          <StatusPill tone={mode.tone} label={mode.label} dot />
        </div>
      </div>

      {refreshError && (
        <div className="settings-msg-inline-error" role="alert">
          Couldn&apos;t refresh messaging status. The last loaded status is still shown.
        </div>
      )}

      <div className="settings-msg-grid">
        <div className="settings-msg-section">
          <div className="settings-msg-section-head">
            <div>
              <h3>Readiness</h3>
              <p>Deployment and CallRail checks required before a controlled test.</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <ul className="settings-msg-checklist">
            <ReadinessItem ready={transport.schema_mode === 'foundation'}>Messaging foundation enabled</ReadinessItem>
            <ReadinessItem ready={callrail.credential_configured}>CallRail account connected</ReadinessItem>
            <ReadinessItem ready={callrail.account_resolved}>CallRail account resolved</ReadinessItem>
            <ReadinessItem ready={callrail.company_configured}>CallRail company configured</ReadinessItem>
            <ReadinessItem ready={callrail.tracking_number_configured}>Text-capable tracking number configured</ReadinessItem>
            <ReadinessItem ready={callrail.signing_key_configured}>Webhook signing key stored server-side</ReadinessItem>
            <ReadinessItem ready={healthReady}>No shared messaging recovery backlog</ReadinessItem>
            <ReadinessItem ready={senderVerified}>Configured sender verified in live CallRail inventory</ReadinessItem>
          </ul>

          {effectiveBlockers.length > 0 ? (
            <div className="settings-msg-blockers">
              <div className="settings-msg-blockers-title">Still needed</div>
              <ul>
                {effectiveBlockers.map((blocker) => (
                  <li key={`${blocker.scope || 'setup'}:${blocker.code}`}>{blockerLabel(blocker)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="settings-msg-ready" role="status">
              Configuration checks passed. A real test still requires an owner-approved test number and send window.
            </div>
          )}
        </div>

        <div className="settings-msg-section">
          <div className="settings-msg-section-head">
            <div>
              <h3>CallRail sender</h3>
              <p>Discover active tracking numbers that already have texting enabled.</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onLoadOptions}
              disabled={optionsState === 'loading' || !callrail.credential_configured}
            >
              {optionsState === 'loading' ? 'Checking…' : options ? 'Check again' : 'Find numbers'}
            </button>
          </div>

          {!callrail.credential_configured && (
            <div className="settings-msg-note">
              Connect CallRail from the CRM Channels card below before checking available texting numbers.
            </div>
          )}

          {optionsState === 'error' && (
            <div className="settings-msg-inline-error" role="alert">
              Couldn&apos;t load CallRail texting numbers. Check the saved credential and try again.
            </div>
          )}

          {options && senders.length === 0 && (
            <div className="settings-msg-empty">
              No active CallRail tracking numbers have both texting support and texting enabled.
            </div>
          )}

          {senders.length > 0 && (
            <fieldset className="settings-msg-senders">
              <legend>Choose for the activation handoff</legend>
              {senders.map((sender) => (
                <label key={sender.option_id} className="settings-msg-sender">
                  <input
                    type="radio"
                    name="callrail-messaging-sender"
                    value={sender.option_id}
                    checked={selectedOptionId === sender.option_id}
                    onChange={() => onSelectOption(sender.option_id)}
                  />
                  <span className="settings-msg-sender-copy">
                    <strong>{sender.tracker_name || formatPhone(sender.tracking_number)}</strong>
                    <span>
                      {formatPhone(sender.tracking_number)} · {sender.company_name}
                      {sender.tracker_type ? ` · ${humanizeCode(sender.tracker_type)}` : ''}
                    </span>
                  </span>
                  <StatusPill tone="success" label="Texting enabled" />
                </label>
              ))}
            </fieldset>
          )}

          {selectedSender && (
            <div className="settings-msg-note settings-msg-note--selected" role="status">
              <div>
                Selected for operator handoff: <strong>{selectedSender.tracker_name || formatPhone(selectedSender.tracking_number)}</strong>.
                This does not activate sending or change a server binding.
              </div>
              <div className="settings-msg-handoff-values">
                <code>CALLRAIL_COMPANY_ID={selectedSender.company_id}</code>
                <code>CALLRAIL_TRACKING_NUMBER={selectedSender.tracking_number}</code>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onCopyHandoff(
                  `CALLRAIL_COMPANY_ID=${selectedSender.company_id}\nCALLRAIL_TRACKING_NUMBER=${selectedSender.tracking_number}`,
                )}
              >
                Copy activation handoff
              </button>
            </div>
          )}
        </div>

        <div className="settings-msg-section">
          <div className="settings-msg-section-head">
            <div>
              <h3>Dedicated text webhook</h3>
              <p>Use this route for both CallRail Text Message Received and Text Message Sent events.</p>
            </div>
          </div>
          <label className="label" htmlFor="callrail-text-webhook-url">Webhook URL</label>
          <div className="settings-msg-copy-row">
            <input
              id="callrail-text-webhook-url"
              className="input settings-msg-webhook-input"
              value={textWebhookUrl}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className="btn btn-secondary" onClick={() => onCopyWebhook(textWebhookUrl)}>
              Copy
            </button>
          </div>
          <div className="settings-msg-note">
            Do not point text events at <code>/api/callrail-webhook</code>; that route is only for calls and forms.
            CallRail&apos;s company signing key stays in server configuration and is never shown here.
          </div>
        </div>

        <div className="settings-msg-section">
          <div className="settings-msg-section-head">
            <div>
              <h3>Activation and rollback</h3>
              <p>The browser cannot choose a provider or turn messaging on.</p>
            </div>
          </div>
          <div className="settings-msg-mode">
            <span>Current deployment mode</span>
            <StatusPill tone={mode.tone} label={mode.label} />
          </div>
          <div className="settings-msg-note">
            Activation is controlled by the server-only <code>MESSAGING_SEND_MODE</code> deployment binding.
            The safe rollback is <code>disabled</code>, followed by a redeploy and reconciliation of unresolved sends.
          </div>
          <div className="settings-msg-guardrail">
            <strong>Twilio RCS readiness</strong>
            <span>
              Twilio can automatically fall back from RCS to SMS/MMS for incapable recipients.
              RCS stays disabled and separate until a channel-locked sender and explicit no-fallback behavior are verified.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function MessagingSetupPanel() {
  const [status, setStatus] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [options, setOptions] = useState(null);
  const [optionsState, setOptionsState] = useState('idle');
  const [selectedOptionId, setSelectedOptionId] = useState('');

  const requestSetup = useCallback((action) => requestMessagingSetup(action), []);

  const load = useCallback(async ({ cold = false } = {}) => {
    if (!cold) setRefreshing(true);
    setRefreshError('');
    try {
      const data = await requestSetup();
      setStatus(data);
      setLoadError('');
    } catch {
      const failure = messagingLoadFailure({ cold, hasStatus: Boolean(status) });
      setLoadError(failure.loadError);
      setRefreshError(failure.refreshError);
    } finally {
      if (cold) setInitialLoading(false);
      else setRefreshing(false);
    }
  }, [requestSetup, status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await requestSetup();
        if (!cancelled) {
          setStatus(data);
          setLoadError('');
        }
      } catch {
        if (!cancelled) setLoadError('Messaging setup status is unavailable.');
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requestSetup]);

  const loadOptions = useCallback(async () => {
    setOptionsState('loading');
    try {
      const data = await requestSetup('callrail-options');
      setOptions(data);
      setSelectedOptionId('');
      setOptionsState('ready');
    } catch {
      setOptionsState('error');
      err('Could not load CallRail texting numbers');
    }
  }, [requestSetup]);

  const copyValue = useCallback(async (value, successMessage, errorMessage) => {
    try {
      await navigator.clipboard.writeText(value);
      ok(successMessage);
    } catch {
      err(errorMessage);
    }
  }, []);

  const viewProps = useMemo(() => ({
    status,
    options,
    optionsState,
    selectedOptionId,
    onSelectOption: setSelectedOptionId,
    onLoadOptions: loadOptions,
    onCopyWebhook: (value) => copyValue(
      value,
      'Text webhook URL copied',
      'Could not copy the text webhook URL',
    ),
    onCopyHandoff: (value) => copyValue(
      value,
      'Activation handoff copied',
      'Could not copy the activation handoff',
    ),
    onRefresh: () => load(),
    refreshing,
    refreshError,
  }), [
    status,
    options,
    optionsState,
    selectedOptionId,
    loadOptions,
    copyValue,
    load,
    refreshing,
    refreshError,
  ]);

  if (initialLoading) return <TabLoading label="Loading messaging setup…" />;
  if (loadError && !status) {
    return (
      <ErrorState
        message={loadError}
        retryLabel="Try again"
        onRetry={() => {
          setInitialLoading(true);
          load({ cold: true });
        }}
      />
    );
  }
  return <MessagingSetupView {...viewProps} />;
}
