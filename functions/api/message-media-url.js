/**
 * Signs one UPR-owned private attachment only after messaging authorization and
 * binding the requested index to a canonical message row.
 */

import { supabase } from '../lib/supabase.js';
import { corsHeaders, handleOptions } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { requireMessagingAccess } from '../lib/messaging-auth.js';
import {
  outboundMessageMediaPath,
  ownedMessageMediaPath,
} from '../lib/message-media.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPIRES_IN = 600;

// `cors` is threaded in rather than computed here because a Worker handles
// concurrent requests — a module-level origin would be a cross-request leak.
function response(body, status, cors = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}

// Without this the browser's preflight for a cross-origin POST gets no
// Allow-Origin and the request never leaves the app. The installed iOS app is
// cross-origin by construction (capacitor://localhost), so these two Workers
// were unreachable from it even after cors.js allowed the origin.
export function onRequestOptions({ request, env }) {
  return handleOptions(request, env);
}

function parseMedia(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

function isMissingAuthorizedMediaRpc(error) {
  const message = String(error?.message || '');
  return message.includes('Supabase RPC messaging_get_authorized_message_media: 404')
    && message.includes('PGRST202');
}

async function readAuthorizedMessageMedia(db, employeeId, messageId) {
  try {
    const rows = await db.rpc('messaging_get_authorized_message_media', {
      p_employee_id: employeeId,
      p_message_id: messageId,
    });
    return rows?.[0] || null;
  } catch (error) {
    // Production promotion may briefly precede the serialized participant
    // enforcement window. Fall back only for PostgREST's exact "function is
    // absent" response; timeouts, catalog errors, and permission failures stay
    // closed. The service-role row is never returned until the already-live
    // conversation-access RPC independently authorizes this employee.
    if (!isMissingAuthorizedMediaRpc(error)) throw error;
  }

  const rows = await db.select(
    'messages',
    `id=eq.${messageId}&select=id,conversation_id,media_urls&limit=1`,
  );
  const message = rows?.[0] || null;
  if (!message?.conversation_id) return null;
  const allowed = await db.rpc('messaging_employee_can_view_conversation', {
    p_employee_id: employeeId,
    p_conversation_id: message.conversation_id,
  });
  return allowed === true ? message : null;
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env, fetchWithTimeout);
  const cors = corsHeaders(request, env);
  const auth = await requireMessagingAccess(
    request,
    env,
    db,
    fetchWithTimeout,
  );
  if (auth.error) return response({ error: auth.error, code: auth.code }, auth.status || 403, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return response({ error: 'Invalid request body' }, 400, cors);
  }
  const index = Number(body?.index);
  if (!UUID_PATTERN.test(body?.message_id || '') || !Number.isSafeInteger(index) || index < 0) {
    return response({ error: 'A valid message_id and attachment index are required' }, 400, cors);
  }

  let message;
  try {
    message = await readAuthorizedMessageMedia(
      db,
      auth.employee.id,
      body.message_id,
    );
  } catch {
    return response({ error: 'Attachment is temporarily unavailable' }, 503, cors);
  }
  if (!message) return response({ error: 'Attachment not found' }, 404, cors);

  const reference = parseMedia(message.media_urls)[index];
  const path = ownedMessageMediaPath(reference);
  if (
    !path
    || (
      path.startsWith('outbound/')
      && !outboundMessageMediaPath(reference, message.conversation_id)
    )
  ) {
    return response({ error: 'Attachment not found' }, 404, cors);
  }

  try {
    const url = await db.signStorage('message-attachments', path, EXPIRES_IN);
    return response({ url, expires_in: EXPIRES_IN }, 200, cors);
  } catch {
    return response({ error: 'Attachment is temporarily unavailable' }, 503, cors);
  }
}
