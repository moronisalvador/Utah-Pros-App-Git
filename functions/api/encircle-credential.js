/**
 * ════════════════════════════════════════════════
 * FILE: encircle-credential.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets an active administrator validate, activate, re-check, or disable the
 *   company's Encircle key from Settings. The browser sends a candidate once;
 *   the server validates it before saving and never returns it.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/auth.js, ../lib/cors.js, ../lib/credentials.js,
 *              ../lib/encircle-credential.js, ../lib/supabase.js
 *   Data:      reads  → employees, feature_flags, integration_credentials
 *              writes → integration_credentials
 *
 * NOTES / GOTCHAS:
 *   - The feature flag is fail-closed: a missing row is OFF.
 *   - Failed candidates are never persisted.
 *   - "disabled" suppresses the old environment fallback immediately.
 * ════════════════════════════════════════════════
 */
import { requireRole } from '../lib/auth.js';
import { jsonResponse } from '../lib/cors.js';
import { clearCredentialCache, resolveCredential } from '../lib/credentials.js';
import { validateEncircleCredential } from '../lib/encircle-credential.js';
import { supabase } from '../lib/supabase.js';

const FLAG = 'feature:encircle_managed_credentials';

function safeValidationError(error) {
  const message = error?.message || '';
  if (message.includes('required')) return { message, status: 400 };
  if (message.includes('rejected')) return { message, status: 422 };
  return { message: 'Encircle credential validation is temporarily unavailable', status: 502 };
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  const auth = await requireRole(request, env, db, ['admin']);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const flags = await db.select(
    'feature_flags',
    `key=eq.${FLAG}&select=enabled,dev_only_user_id&limit=1`,
  ).catch(() => []);
  const flag = flags?.[0];
  const allowed = !!flag && (
    flag.enabled === true || flag.dev_only_user_id === auth.employee.id
  );
  if (!allowed) return jsonResponse({ error: 'Not found' }, 404, request, env);

  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'disable') {
    await db.update('integration_credentials', 'provider=eq.encircle', {
      access_token: null,
      managed_status: 'disabled',
      last_verification_status: 'disabled',
      updated_at: new Date().toISOString(),
    });
    clearCredentialCache();
    return jsonResponse({ ok: true, status: 'disabled' }, 200, request, env);
  }

  let candidate;
  if (action === 'activate') {
    candidate = String(body?.candidate || '').trim();
  } else if (action === 'verify') {
    const resolved = await resolveCredential(env, db, 'encircle');
    candidate = resolved.apiKey;
  } else {
    return jsonResponse({ error: 'Unsupported action' }, 400, request, env);
  }

  let verification;
  try {
    verification = await validateEncircleCredential(candidate);
  } catch (error) {
    if (action === 'verify') {
      await db.update('integration_credentials', 'provider=eq.encircle', {
        last_verified_at: new Date().toISOString(),
        last_verification_status: 'failed',
        updated_at: new Date().toISOString(),
      }).catch(() => null);
    }
    const safe = safeValidationError(error);
    return jsonResponse({ error: safe.message }, safe.status, request, env);
  }

  const now = new Date().toISOString();
  if (action === 'activate') {
    await db.upsert('integration_credentials', {
      provider: 'encircle',
      access_token: candidate,
      environment: 'production',
      company_name: verification.organizationName,
      connected_by: auth.employee.id,
      connected_at: now,
      updated_at: now,
      managed_status: 'active',
      last_verified_at: now,
      last_verification_status: 'verified',
    }, 'provider');
  } else {
    await db.update('integration_credentials', 'provider=eq.encircle', {
      company_name: verification.organizationName,
      last_verified_at: now,
      last_verification_status: 'verified',
      updated_at: now,
    });
  }
  clearCredentialCache();

  return jsonResponse({
    ok: true,
    status: 'verified',
    verified_at: now,
    organization_name: verification.organizationName,
  }, 200, request, env);
}
