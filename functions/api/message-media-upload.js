/**
 * Authenticated private upload/delete boundary for outbound message images.
 */

import { supabase } from '../lib/supabase.js';
import { requireMessagingAccess } from '../lib/messaging-auth.js';
import {
  MESSAGE_MEDIA_BUCKET,
  MESSAGE_MEDIA_MAX_BYTES,
  MESSAGE_MEDIA_PREFIX,
  validateMessageImage,
} from '../lib/message-media.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function requireConversation(db, conversationId) {
  if (!UUID_PATTERN.test(conversationId || '')) {
    return response({ error: 'A valid conversation_id is required' }, 400);
  }
  const [conversation] = await db.select(
    'conversations',
    `id=eq.${conversationId}&select=id&limit=1`,
  );
  return conversation ? null : response({ error: 'Conversation not found' }, 404);
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  const auth = await requireMessagingAccess(request, env, db);
  if (auth.error) return response({ error: auth.error, code: auth.code }, auth.status || 403);
  let form;
  try {
    form = await request.formData();
  } catch {
    return response({ error: 'Invalid multipart request' }, 400);
  }
  const conversationId = String(form.get('conversation_id') || '');
  const conversationError = await requireConversation(db, conversationId);
  if (conversationError) return conversationError;

  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return response({ error: 'One image file is required' }, 400);
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MESSAGE_MEDIA_MAX_BYTES) {
    return response({
      error: 'Message images must be no larger than 5 MB.',
      code: 'MESSAGE_MEDIA_SIZE_UNSUPPORTED',
    }, 400);
  }

  let checked;
  try {
    checked = validateMessageImage(await file.arrayBuffer(), file.type);
  } catch (error) {
    return response({ error: error.message, code: error.code }, error.status || 400);
  }

  const storagePath = `outbound/${conversationId}/${crypto.randomUUID()}.${checked.extension}`;
  try {
    await db.uploadStorage(
      MESSAGE_MEDIA_BUCKET,
      storagePath,
      checked.bytes,
      checked.mimeType,
    );
  } catch {
    return response({ error: 'The image could not be stored', code: 'MESSAGE_MEDIA_UPLOAD_FAILED' }, 503);
  }

  return response({
    reference: `${MESSAGE_MEDIA_PREFIX}${storagePath}`,
    mime_type: checked.mimeType,
    byte_size: checked.byteSize,
  }, 201);
}
