/**
 * ════════════════════════════════════════════════
 * FILE: message-conversations.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the mobile messaging inbox a bounded contact picker and a safe way to
 *   open one direct conversation. The browser never calls the privileged
 *   find-or-create database helper directly.
 *
 * WHERE IT LIVES:
 *   Route:        GET/POST /api/message-conversations
 *   Rendered by:  Tech Messages v2 new-conversation flow
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/cors.js, functions/lib/messaging-auth.js,
 *              functions/lib/supabase.js
 *   Data:      reads  → contacts, messaging authorization tables
 *              writes → conversations, conversation_participants through the
 *                       service-only find_or_create_conversation RPC
 *
 * NOTES / GOTCHAS:
 *   - Search requires two characters, is capped at 80 characters/25 results,
 *     and returns only fields the picker renders.
 *   - Creating a conversation never sends a message or changes SMS consent.
 *   - The RPC is intentionally service-role-only; this worker is its trusted
 *     authorization boundary.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireMessagingAccess } from '../lib/messaging-auth.js';
import { supabase } from '../lib/supabase.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_LENGTH = 80;
const RESULT_LIMIT = 25;
const SEARCH_INPUT_PATTERN = /^[\p{L}\p{N}\s+.'-]+$/u;

function noStoreResponse(data, status, request, env) {
  const response = jsonResponse(data, status, request, env);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function normalizedSearch(request) {
  return (new URL(request.url).searchParams.get('q') || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function isValidSearch(search) {
  const significantCharacters = search.match(/[\p{L}\p{N}]/gu)?.length || 0;
  return significantCharacters >= MIN_SEARCH_LENGTH
    && SEARCH_INPUT_PATTERN.test(search);
}

export function buildContactSearchQuery(search) {
  const pattern = encodeURIComponent(`*${search}*`);
  return [
    'phone=not.is.null',
    `or=(name.ilike.${pattern},phone.ilike.${pattern},company.ilike.${pattern})`,
    'select=id,name,phone,company',
    'order=name.asc.nullslast',
    `limit=${RESULT_LIMIT}`,
  ].join('&');
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await requireMessagingAccess(request, env, db);
  if (auth.error) {
    return noStoreResponse({
      error: auth.error,
      code: auth.code,
    }, auth.status, request, env);
  }

  const search = normalizedSearch(request);
  if (search.length < MIN_SEARCH_LENGTH) {
    return noStoreResponse({
      error: `Search must be at least ${MIN_SEARCH_LENGTH} characters`,
      code: 'CONTACT_SEARCH_TOO_SHORT',
    }, 400, request, env);
  }
  if (search.length > MAX_SEARCH_LENGTH) {
    return noStoreResponse({
      error: `Search must be ${MAX_SEARCH_LENGTH} characters or fewer`,
      code: 'CONTACT_SEARCH_TOO_LONG',
    }, 400, request, env);
  }
  if (!isValidSearch(search)) {
    return noStoreResponse({
      error: 'Search contains unsupported characters',
      code: 'CONTACT_SEARCH_INVALID',
    }, 400, request, env);
  }

  try {
    const contacts = await db.select('contacts', buildContactSearchQuery(search));
    const eligibleContacts = contacts
      .filter((contact) => (
        typeof contact.phone === 'string' && contact.phone.trim().length > 0
      ))
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        company: contact.company,
      }));
    return noStoreResponse({ ok: true, contacts: eligibleContacts }, 200, request, env);
  } catch (error) {
    console.error('message-conversations search:', error);
    return noStoreResponse({
      error: 'Could not search contacts',
      code: 'CONTACT_SEARCH_FAILED',
    }, 500, request, env);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await requireMessagingAccess(request, env, db);
  if (auth.error) {
    return noStoreResponse({
      error: auth.error,
      code: auth.code,
    }, auth.status, request, env);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return noStoreResponse({
      error: 'Request body must be valid JSON',
      code: 'INVALID_REQUEST',
    }, 400, request, env);
  }

  const contactId = String(input?.contact_id || '');
  if (!UUID_PATTERN.test(contactId)) {
    return noStoreResponse({
      error: 'contact_id must be a UUID',
      code: 'INVALID_CONTACT_ID',
    }, 400, request, env);
  }

  try {
    const conversation = await db.rpc('find_or_create_conversation', {
      p_contact_id: contactId,
    });
    if (!conversation?.id) {
      throw new Error('find_or_create_conversation returned no conversation');
    }
    return noStoreResponse({ ok: true, conversation }, 200, request, env);
  } catch (error) {
    console.error('message-conversations create:', error);
    return noStoreResponse({
      error: 'Could not start this conversation',
      code: 'CONVERSATION_CREATE_FAILED',
    }, 500, request, env);
  }
}
