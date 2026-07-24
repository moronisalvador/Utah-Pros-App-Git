/**
 * Signs one UPR-owned private attachment only after messaging authorization and
 * binding the requested index to a canonical message row.
 */

import { supabase } from '../lib/supabase.js';
import { requireMessagingAccess } from '../lib/messaging-auth.js';
import {
  outboundMessageMediaPath,
  ownedMessageMediaPath,
} from '../lib/message-media.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPIRES_IN = 600;

function response(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
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

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  const auth = await requireMessagingAccess(request, env, db);
  if (auth.error) return response({ error: auth.error, code: auth.code }, auth.status || 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return response({ error: 'Invalid request body' }, 400);
  }
  const index = Number(body?.index);
  if (!UUID_PATTERN.test(body?.message_id || '') || !Number.isSafeInteger(index) || index < 0) {
    return response({ error: 'A valid message_id and attachment index are required' }, 400);
  }

  const [message] = await db.select(
    'messages',
    `id=eq.${body.message_id}&select=id,conversation_id,media_urls&limit=1`,
  );
  if (!message) return response({ error: 'Attachment not found' }, 404);
  const reference = parseMedia(message.media_urls)[index];
  const path = ownedMessageMediaPath(reference);
  if (
    !path
    || (
      path.startsWith('outbound/')
      && !outboundMessageMediaPath(reference, message.conversation_id)
    )
  ) {
    return response({ error: 'Attachment not found' }, 404);
  }

  try {
    const url = await db.signStorage('message-attachments', path, EXPIRES_IN);
    return response({ url, expires_in: EXPIRES_IN }, 200);
  } catch {
    return response({ error: 'Attachment is temporarily unavailable' }, 503);
  }
}
