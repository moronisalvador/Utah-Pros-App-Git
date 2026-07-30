/**
 * ════════════════════════════════════════════════
 * FILE: provider-event-ops.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the owner a safe list of message-provider failures and two narrow
 *   actions: retry one exact failed event or acknowledge one exact failed event.
 *   It never sends a message and never contacts a provider.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/auth.js, ../lib/cors.js, ../lib/supabase.js
 *   Data:      reads  → employees, message_provider_events
 *              writes → message_provider_events through the existing service-only
 *                       rearm_callrail_provider_event / resolve_provider_event RPCs
 *
 * NOTES / GOTCHAS:
 *   - The response deliberately excludes content, raw hashes, media references,
 *     and provider payloads. The owner needs failure identity, not message content.
 *   - Retry only re-arms the retained event. The existing scheduled recovery
 *     worker performs projection; this route cannot call CallRail or send SMS/MMS.
 * ════════════════════════════════════════════════
 */

import { requireOwner } from '../lib/auth.js';
import { corsHeaders, handleOptions } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

const PAGE_SIZE = 50;
const MAX_OFFSET = 5_000;
const MAX_BODY_BYTES = 4_096;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_COLUMNS = [
  'id',
  'provider',
  'direction',
  'message_type',
  'error_code',
  'processing_state',
  'processing_attempts',
  'sender_address',
  'recipient_address',
  'provider_message_id',
  'received_at',
  'next_attempt_at',
  'resolved_at',
  'outcome',
].join(',');

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

function safeEvent(row) {
  return Object.fromEntries(
    EVENT_COLUMNS.split(',').map((key) => [key, row?.[key] ?? null]),
  );
}

async function requireActiveInternalOwner(request, env, db) {
  const auth = await requireOwner(request, env, db);
  if (auth.error) return auth;
  if (auth.employee.is_external === true) {
    return {
      error: 'External employees cannot manage provider events',
      status: 403,
    };
  }
  return auth;
}

async function readJson(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { error: 'Request body is too large', status: 413 };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { error: 'Request body is too large', status: 413 };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'Request body must be valid JSON', status: 400 };
  }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet({ request, env }) {
  const db = supabase(env);
  const auth = await requireActiveInternalOwner(request, env, db);
  if (auth.error) return json({ error: auth.error }, auth.status, request, env);

  const offsetRaw = new URL(request.url).searchParams.get('offset') || '0';
  const offset = Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    return json({ error: 'Invalid offset' }, 400, request, env);
  }

  try {
    const rows = await db.select(
      'message_provider_events',
      `processing_state=in.(failed,retryable)&resolved_at=is.null`
      + `&select=${EVENT_COLUMNS}&order=received_at.asc`
      + `&limit=${PAGE_SIZE + 1}&offset=${offset}`,
    );
    const page = (rows || []).slice(0, PAGE_SIZE).map(safeEvent);
    return json({
      ok: true,
      events: page,
      next_offset: (rows || []).length > PAGE_SIZE ? offset + PAGE_SIZE : null,
    }, 200, request, env);
  } catch (error) {
    console.error('provider-event-ops GET:', error);
    return json({
      error: 'Provider events are temporarily unavailable',
    }, 503, request, env);
  }
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  const auth = await requireActiveInternalOwner(request, env, db);
  if (auth.error) return json({ error: auth.error }, auth.status, request, env);

  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, request, env);

  const action = parsed.value?.action;
  const eventId = String(parsed.value?.event_id || '').trim();
  if (!['retry', 'resolve'].includes(action)) {
    return json({ error: 'Action must be retry or resolve' }, 400, request, env);
  }
  if (!UUID_RE.test(eventId)) {
    return json({ error: 'A valid event_id is required' }, 400, request, env);
  }

  try {
    const [event] = await db.select(
      'message_provider_events',
      `id=eq.${eventId}&select=${EVENT_COLUMNS}&limit=1`,
    );
    if (!event) return json({ error: 'Provider event not found' }, 404, request, env);
    if (event.processing_state !== 'failed' || event.resolved_at) {
      return json({
        error: 'Provider event is no longer an unresolved failure',
      }, 409, request, env);
    }

    let changedRows;
    if (action === 'retry') {
      if (
        event.provider !== 'callrail'
        || !['sms', 'mms'].includes(event.message_type)
        || !event.error_code
      ) {
        return json({ error: 'Provider event cannot be retried' }, 409, request, env);
      }
      changedRows = await db.rpc('rearm_callrail_provider_event', {
        p_event_id: event.id,
        // The browser never supplies the compare-and-set guard. It comes from
        // the row read after authorization, so a stale UI cannot broaden retry.
        p_expect_error_code: event.error_code,
      });
    } else {
      changedRows = await db.rpc('resolve_provider_event', {
        p_event_id: event.id,
        p_resolved_by: auth.employee.id,
      });
    }

    const changed = Array.isArray(changedRows) && changedRows.length > 0;
    return json({
      ok: true,
      action,
      event_id: event.id,
      changed,
      ...(action === 'retry' ? { queued_for_recovery: changed } : {}),
    }, 200, request, env);
  } catch (error) {
    console.error('provider-event-ops POST:', error);
    return json({ error: 'Provider event action failed' }, 503, request, env);
  }
}
