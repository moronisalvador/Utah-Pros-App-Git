/**
 * Pure readiness helpers for the admin Messaging Setup screen.
 * Provider mode remains a server binding and is never accepted from the browser.
 */
import {
  resolveMessagingSchemaMode,
  resolveMessagingSendMode,
} from './messaging-transport.js';

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function lastFour(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

export function buildMessagingSetupStatus(env, {
  credentialConfigured = false,
  accountResolved = false,
  health = {},
} = {}) {
  const schemaMode = resolveMessagingSchemaMode(env);
  const sendMode = resolveMessagingSendMode(env);
  const companyConfigured = configured(env?.CALLRAIL_COMPANY_ID);
  const trackingNumberConfigured = configured(env?.CALLRAIL_TRACKING_NUMBER);
  const signingKeyConfigured = configured(env?.CALLRAIL_SIGNING_KEY);
  const pendingEvents = Number(health.pendingEvents) || 0;
  const failedEvents = Number(health.failedEvents) || 0;
  const ambiguousAttempts = Number(health.ambiguousAttempts) || 0;
  const pendingNotifications = Number(health.pendingNotifications) || 0;
  const deadLetterNotifications = Number(health.deadLetterNotifications) || 0;
  const healthChecked = health.checked === true;
  const blockers = [];

  if (schemaMode !== 'foundation') blockers.push({ code: 'MESSAGING_SCHEMA_NOT_FOUNDATION', scope: 'schema' });
  if (!credentialConfigured) blockers.push({ code: 'CALLRAIL_CREDENTIAL_MISSING', scope: 'configuration' });
  if (!accountResolved) blockers.push({ code: 'CALLRAIL_ACCOUNT_MISSING', scope: 'configuration' });
  if (!companyConfigured) blockers.push({ code: 'CALLRAIL_COMPANY_MISSING', scope: 'configuration' });
  if (!trackingNumberConfigured) blockers.push({ code: 'CALLRAIL_TRACKING_NUMBER_MISSING', scope: 'configuration' });
  if (!signingKeyConfigured) blockers.push({ code: 'CALLRAIL_SIGNING_KEY_MISSING', scope: 'inbound' });
  if (schemaMode === 'foundation' && !healthChecked) blockers.push({ code: 'MESSAGING_HEALTH_NOT_CHECKED', scope: 'health' });
  if (healthChecked && pendingEvents > 0) blockers.push({ code: 'CALLRAIL_EVENTS_PENDING', scope: 'health' });
  if (healthChecked && ambiguousAttempts > 0) blockers.push({ code: 'CALLRAIL_ATTEMPTS_AMBIGUOUS', scope: 'health' });
  if (healthChecked && pendingNotifications > 0) blockers.push({ code: 'MESSAGE_NOTIFICATIONS_PENDING', scope: 'health' });
  const bindingPresenceComplete = (
    credentialConfigured
    && accountResolved
    && companyConfigured
    && trackingNumberConfigured
    && signingKeyConfigured
  );
  if (bindingPresenceComplete) {
    blockers.push({ code: 'CALLRAIL_SENDER_DISCOVERY_REQUIRED', scope: 'verification' });
  }
  if (sendMode === 'disabled') blockers.push({ code: 'MESSAGING_SEND_DISABLED', scope: 'activation' });
  if (sendMode === 'twilio') blockers.push({ code: 'TWILIO_IS_ACTIVE_PROVIDER', scope: 'activation' });

  const readyForActivation = false;
  const outboundEnabled = sendMode === 'callrail' && blockers.length === 0;

  return {
    ok: true,
    environment: env?.CF_PAGES_BRANCH === 'main' ? 'production' : 'preview',
    transport: {
      schema_mode: schemaMode,
      send_mode: sendMode,
      mode_source: 'server_binding',
      mode_mutable_in_app: false,
      outbound_enabled: outboundEnabled,
    },
    callrail: {
      credential_configured: credentialConfigured,
      account_resolved: accountResolved,
      company_configured: companyConfigured,
      tracking_number_configured: trackingNumberConfigured,
      selected_sender_last4: lastFour(env?.CALLRAIL_TRACKING_NUMBER),
      signing_key_configured: signingKeyConfigured,
      text_webhook: {
        path: '/api/callrail-text-webhook',
        configured: signingKeyConfigured && companyConfigured,
      },
      binding_presence_complete: bindingPresenceComplete,
      ready_for_activation: readyForActivation,
    },
    health: {
      checked: healthChecked,
      scope: 'shared_database',
      last_text_webhook_at: health.lastTextWebhookAt || null,
      pending_events: pendingEvents,
      failed_events: failedEvents,
      ambiguous_attempts: ambiguousAttempts,
      pending_notifications: pendingNotifications,
      dead_letter_notifications: deadLetterNotifications,
    },
    capabilities: {
      callrail: ['sms', 'mms'],
      twilio: ['sms', 'mms'],
      rcs: 'planned_disabled',
      cross_channel_fallback: false,
    },
    blockers,
  };
}
