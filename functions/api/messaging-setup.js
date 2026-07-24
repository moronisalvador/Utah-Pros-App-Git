/**
 * Admin-only, read-only messaging readiness and CallRail sender discovery.
 * Activation remains an owner-controlled Cloudflare deployment binding.
 */
import { handleOptions, corsHeaders } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireRole } from '../lib/auth.js';
import { resolveCallRailApiKey } from '../lib/callrail-messaging.js';
import {
  CallRailDiscoveryError,
  discoverCallRailMessagingOptions,
} from '../lib/callrail-api.js';
import { buildMessagingSetupStatus } from '../lib/messaging-setup.js';

const ADMIN_ROLES = ['admin'];

function noStoreJson(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

async function requireActiveInternalAdmin(request, env, db) {
  const auth = await requireRole(request, env, db, ADMIN_ROLES);
  if (auth.error) return auth;
  if (auth.employee.is_external === true) {
    return { error: 'External employees cannot manage integrations', status: 403 };
  }
  return auth;
}

async function loadHealth(db) {
  const [
    lastEvents,
    pendingEvents,
    failedEvents,
    attempts,
    notifications,
    deadLetterNotifications,
  ] = await Promise.all([
    db.select(
      'message_provider_events',
      'provider=eq.callrail&select=received_at&order=received_at.desc&limit=1',
    ),
    db.select(
      'message_provider_events',
      'provider=eq.callrail&processing_state=in.(received,claimed,retryable)&select=id&limit=101',
    ),
    db.select(
      'message_provider_events',
      'provider=eq.callrail&processing_state=eq.failed&select=id&limit=101',
    ),
    db.select(
      'message_send_attempts',
      'provider=eq.callrail&state=eq.ambiguous&select=id&limit=101',
    ),
    db.select(
      'message_notification_outbox',
      'delivery_state=in.(pending,processing,retryable)&select=id&limit=101',
    ),
    db.select(
      'message_notification_outbox',
      'delivery_state=eq.dead_letter&select=id&limit=101',
    ),
  ]);
  return {
    checked: true,
    scope: 'shared_database',
    lastTextWebhookAt: lastEvents?.[0]?.received_at || null,
    pendingEvents: (pendingEvents || []).length,
    failedEvents: (failedEvents || []).length,
    ambiguousAttempts: (attempts || []).length,
    pendingNotifications: (notifications || []).length,
    deadLetterNotifications: (deadLetterNotifications || []).length,
  };
}

function samePhone(left, right) {
  const normalize = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return digits.length === 10 ? digits : '';
  };
  const normalizedLeft = normalize(left);
  return normalizedLeft.length === 10 && normalizedLeft === normalize(right);
}

function markConfiguredSender(companies, env) {
  let configuredSenderVerified = false;
  const configuredCompany = String(env.CALLRAIL_COMPANY_ID || '').trim();
  const result = companies.map((company) => ({
    ...company,
    senders: company.senders.map((sender) => {
      const configured = company.id === configuredCompany
        && samePhone(sender.tracking_number, env.CALLRAIL_TRACKING_NUMBER);
      if (configured) configuredSenderVerified = true;
      return { ...sender, configured };
    }),
  }));
  return { companies: result, configuredSenderVerified };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await requireActiveInternalAdmin(request, env, db);
  if (auth.error) return noStoreJson({ error: auth.error }, auth.status, request, env);

  const action = new URL(request.url).searchParams.get('action');
  if (action && action !== 'callrail-options') {
    return noStoreJson({ error: 'Unsupported setup action' }, 400, request, env);
  }

  let apiKey;
  try {
    apiKey = await resolveCallRailApiKey(env, db);
  } catch {
    return noStoreJson({ error: 'Messaging setup is temporarily unavailable' }, 503, request, env);
  }

  if (action === 'callrail-options') {
    if (!apiKey) {
      return noStoreJson(
        { error: 'Connect CallRail before checking eligible numbers', code: 'CALLRAIL_CREDENTIAL_MISSING' },
        409,
        request,
        env,
      );
    }
    try {
      const [accountRow] = await db.select(
        'integration_config',
        'key=eq.callrail_account_id&select=value&limit=1',
      );
      const accountId = String(accountRow?.value || env.CALLRAIL_ACCOUNT_ID || '').trim();
      if (!accountId) {
        return noStoreJson({
          error: 'Resolve the CallRail account before checking eligible numbers',
          code: 'CALLRAIL_ACCOUNT_ID_MISSING',
        }, 409, request, env);
      }
      const discovered = await discoverCallRailMessagingOptions(apiKey, { accountId });
      const { companies, configuredSenderVerified } = markConfiguredSender(discovered, env);
      return noStoreJson({
        ok: true,
        checked_at: new Date().toISOString(),
        complete: true,
        configured_sender_verified: configuredSenderVerified,
        companies,
      }, 200, request, env);
    } catch (error) {
      const status = error instanceof CallRailDiscoveryError ? error.status : 503;
      const code = error instanceof CallRailDiscoveryError
        ? error.code
        : 'CALLRAIL_DISCOVERY_UNAVAILABLE';
      return noStoreJson({
        error: 'CallRail messaging options are temporarily unavailable',
        code,
      }, status, request, env);
    }
  }

  let accountResolved = Boolean(env.CALLRAIL_ACCOUNT_ID);
  let health = {};
  try {
    const [accountRows, loadedHealth] = await Promise.all([
      db.select('integration_config', 'key=eq.callrail_account_id&select=value&limit=1'),
      env.MESSAGING_SCHEMA_MODE === 'foundation' ? loadHealth(db) : Promise.resolve({}),
    ]);
    accountResolved = accountResolved || Boolean(accountRows?.[0]?.value);
    health = loadedHealth;
  } catch {
    return noStoreJson({ error: 'Messaging setup is temporarily unavailable' }, 503, request, env);
  }

  return noStoreJson(buildMessagingSetupStatus(env, {
    credentialConfigured: Boolean(apiKey),
    accountResolved,
    health,
  }), 200, request, env);
}
