/**
 * ════════════════════════════════════════════════
 * FILE: notification-presentation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives active internal admins the typed notification presentation catalog,
 *   synthetic previews, audited saves/resets, and bounded history used by the
 *   desktop Settings editor.
 *
 * WHERE IT LIVES:
 *   Route:        GET/POST /api/notification-presentation
 *   Rendered by:  src/pages/settings/NotificationPresentation.jsx
 *
 * DEPENDS ON:
 *   Internal:  ../lib/{auth,cors,supabase,notificationPresentation}.js
 *   Data:      reads  → notification_types, notification_presentation_overrides,
 *                       notification_presentation_audit, employees
 *              writes → mutate_notification_presentation RPC only
 *
 * NOTES / GOTCHAS:
 *   - Authorization completes before any presentation configuration read/write.
 *   - Preview uses registry-owned synthetic values and never sends or queries
 *     customer/payment/message/provider data.
 *   - Browser roles cannot reach the underlying tables/RPC directly.
 * ════════════════════════════════════════════════
 */
import { requireRole } from '../lib/auth.js';
import { corsHeaders, handleOptions } from '../lib/cors.js';
import {
  getNotificationPresentationCatalog,
  previewNotificationPresentation,
  validateNotificationPresentationConfig,
} from '../lib/notificationPresentation.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';

const ADMIN_ROLES = ['admin'];
const MAX_REQUEST_BYTES = 20_000;
const HISTORY_LIMIT = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function requireActiveInternalAdmin(request, env, db, fetchImpl) {
  const auth = await requireRole(request, env, db, ADMIN_ROLES, fetchImpl);
  if (auth.error) return auth;
  if (auth.employee.is_external !== false) {
    return { error: 'Forbidden', status: 403 };
  }
  return auth;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set(fields);
  return Object.keys(value).every((key) => allowed.has(key));
}

async function readJson(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return { error: 'Request is too large', status: 413 };
  }
  let text;
  try {
    text = await request.text();
  } catch {
    return { error: 'Could not read request', status: 400 };
  }
  if (text.length > MAX_REQUEST_BYTES) return { error: 'Request is too large', status: 413 };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'Invalid JSON body', status: 400 };
  }
}

async function loadCatalog(db) {
  const [types, overrides] = await Promise.all([
    db.select(
      'notification_types',
      'select=type_key,label,description,category,audience,enabled,sort_order&order=sort_order.asc',
    ),
    db.select(
      'notification_presentation_overrides',
      'select=type_key,surface,enabled,title_template,body_template,route_id,contract_version,revision,updated_by,updated_at',
    ),
  ]);
  const typeByKey = new Map((types || []).map((row) => [row.type_key, row]));
  const overrideByKey = new Map(
    (overrides || []).map((row) => [`${row.type_key}:${row.surface}`, row]),
  );
  return getNotificationPresentationCatalog()
    .map((event) => {
      const type = typeByKey.get(event.type_key);
      if (!type) return null;
      return {
        ...event,
        label: type.label,
        description: type.description,
        category: type.category,
        audience: type.audience,
        enabled: type.enabled,
        sort_order: type.sort_order,
        surfaces: Object.fromEntries(
          Object.entries(event.surfaces).map(([surfaceKey, definition]) => [
            surfaceKey,
            {
              ...definition,
              override: overrideByKey.get(`${event.type_key}:${surfaceKey}`) || null,
            },
          ]),
        ),
      };
    })
    .filter(Boolean);
}

async function loadHistory(db, typeKey, surface) {
  const rows = await db.select(
    'notification_presentation_audit',
    `type_key=eq.${encodeURIComponent(typeKey)}`
      + `&surface=eq.${encodeURIComponent(surface)}`
      + '&select=id,revision,action,before_config,after_config,actor_employee_id,created_at'
      + `&order=created_at.desc&limit=${HISTORY_LIMIT}`,
  );
  const actorIds = Array.from(new Set((rows || []).map((row) => row.actor_employee_id).filter(Boolean)));
  let actorById = new Map();
  if (actorIds.length) {
    const actors = await db.select(
      'employees',
      `id=in.(${actorIds.join(',')})&select=id,full_name`,
    );
    actorById = new Map((actors || []).map((actor) => [actor.id, actor.full_name]));
  }
  return (rows || []).map((row) => ({
    id: row.id,
    revision: row.revision,
    action: row.action,
    before_config: row.before_config,
    after_config: row.after_config,
    actor_name: actorById.get(row.actor_employee_id) || 'Administrator',
    created_at: row.created_at,
  }));
}

function rpcError(error) {
  const message = String(error?.message || '');
  if (message.includes('REVISION_CONFLICT')) {
    return { status: 409, error: 'Another administrator saved a newer revision' };
  }
  if (message.includes('NOT_AUTHORIZED')) return { status: 403, error: 'Forbidden' };
  if (
    message.includes('INVALID_')
    || message.includes('UNKNOWN_NOTIFICATION_TYPE')
    || message.includes('REQUEST_ID_CONFLICT')
  ) {
    return { status: 400, error: 'Invalid presentation request' };
  }
  return { status: 503, error: 'Notification presentation settings are temporarily unavailable' };
}

export async function handleNotificationPresentation({
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
}) {
  const auth = await requireActiveInternalAdmin(request, env, db, fetchImpl);
  if (auth.error) return { status: auth.status, data: { error: auth.error } };

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'catalog';
    try {
      if (action === 'catalog') {
        return { status: 200, data: { events: await loadCatalog(db) } };
      }
      if (action === 'history') {
        const typeKey = url.searchParams.get('type_key') || '';
        const surface = url.searchParams.get('surface') || '';
        const event = getNotificationPresentationCatalog()
          .find((item) => item.type_key === typeKey);
        if (!event?.surfaces[surface]) {
          return { status: 400, data: { error: 'Unsupported event or surface' } };
        }
        return {
          status: 200,
          data: { history: await loadHistory(db, typeKey, surface) },
        };
      }
      return { status: 400, data: { error: 'Unsupported action' } };
    } catch {
      return {
        status: 503,
        data: { error: 'Notification presentation settings are temporarily unavailable' },
      };
    }
  }

  if (request.method !== 'POST') {
    return { status: 405, data: { error: 'Method not allowed' } };
  }

  const parsed = await readJson(request);
  if (parsed.error) return { status: parsed.status, data: { error: parsed.error } };
  const body = parsed.value;
  const action = body?.action;

  if (action === 'preview') {
    if (!exactFields(body, ['action', 'type_key', 'surface', 'config'])) {
      return { status: 400, data: { error: 'Unsupported preview field' } };
    }
    const preview = previewNotificationPresentation(body.type_key, body.surface, body.config);
    return preview.ok
      ? { status: 200, data: preview }
      : { status: 400, data: { error: preview.error } };
  }

  if (action !== 'save' && action !== 'reset') {
    return { status: 400, data: { error: 'Unsupported action' } };
  }
  const expectedFields = action === 'save'
    ? ['action', 'type_key', 'surface', 'config', 'expected_revision', 'request_id']
    : ['action', 'type_key', 'surface', 'expected_revision', 'request_id'];
  if (!exactFields(body, expectedFields)) {
    return { status: 400, data: { error: 'Unsupported mutation field' } };
  }
  if (
    !Number.isInteger(body.expected_revision)
    || body.expected_revision < 0
    || typeof body.request_id !== 'string'
    || !UUID_RE.test(body.request_id)
  ) {
    return { status: 400, data: { error: 'Invalid mutation identity' } };
  }
  if (action === 'save') {
    const checked = validateNotificationPresentationConfig(
      body.type_key,
      body.surface,
      body.config,
    );
    if (!checked.ok) return { status: 400, data: { error: checked.error } };
    body.config = checked.config;
  } else {
    const event = getNotificationPresentationCatalog()
      .find((item) => item.type_key === body.type_key);
    if (!event?.surfaces[body.surface]) {
      return { status: 400, data: { error: 'Unsupported event or surface' } };
    }
  }

  try {
    const result = await db.rpc('mutate_notification_presentation', {
      p_actor_id: auth.employee.id,
      p_type_key: body.type_key,
      p_surface: body.surface,
      p_action: action,
      p_config: action === 'save' ? body.config : null,
      p_expected_revision: body.expected_revision,
      p_request_id: body.request_id,
    });
    return { status: 200, data: { ok: true, result } };
  } catch (error) {
    const mapped = rpcError(error);
    return { status: mapped.status, data: { error: mapped.error } };
  }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequest(context) {
  const { request, env } = context;
  const result = await handleNotificationPresentation({
    request,
    env,
    db: supabase(env, fetchWithTimeout),
    fetchImpl: fetchWithTimeout,
  });
  return noStoreJson(result.data, result.status, request, env);
}
