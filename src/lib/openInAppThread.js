/**
 * ════════════════════════════════════════════════
 * FILE: openInAppThread.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens a customer's text conversation INSIDE the UPR app instead of handing the
 *   tech off to their phone's own messaging app. Given a contact, it asks the server
 *   for that contact's conversation (creating one if there isn't one yet) and then
 *   goes to that thread in the field messaging screen.
 *
 *   Before this existed, the Message buttons on the job, claim and appointment
 *   screens were plain `sms:` links. Tapping one left UPR entirely: the text was
 *   sent from the tech's personal number, so it never appeared in the customer's
 *   UPR thread, no office staff could see it, and it bypassed consent logging.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  src/lib/realtime.js (getAuthHeader), src/lib/toast.js (err)
 *   Data:      reads  → none directly
 *              writes → conversations / conversation_participants, but only through
 *                       POST /api/message-conversations (the browser never calls the
 *                       privileged find_or_create_conversation RPC itself)
 *
 * NOTES / GOTCHAS:
 *   - Opening a thread NEVER sends a message and never changes SMS consent. The
 *     send path and its consent gate are untouched; this only navigates.
 *   - It degrades instead of dead-ending: with no contact id, or if the lookup
 *     fails, it lands on the contact picker (`?new=1`) rather than leaving the tech
 *     with a button that does nothing.
 *   - Deliberately does NOT fall back to `sms:`. Silently reverting to the personal
 *     dialer is the behaviour being removed — an off-platform text is worse than an
 *     extra tap, because nobody else can see it.
 */

import { getAuthHeader } from '@/lib/realtime';
import { err } from '@/lib/toast';

export const THREAD_ROUTE = '/tech/conversations';

/** Where to land when we cannot resolve a specific thread: the contact picker. */
export function pickerHref() {
  return `${THREAD_ROUTE}?new=1`;
}

export function threadHref(conversationId) {
  return `${THREAD_ROUTE}?c=${encodeURIComponent(conversationId)}`;
}

/**
 * Resolve a contact's conversation id via the capability-checked Worker.
 * Returns null rather than throwing, so callers can fall back to the picker.
 */
export async function resolveConversationId(contactId, fetchFn = (...a) => fetch(...a)) {
  if (!contactId) return null;
  const authHeader = await getAuthHeader();
  const response = await fetchFn('/api/message-conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ contact_id: contactId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not open this conversation');
  return data.conversation?.id || null;
}

/**
 * Navigate to the in-app thread for a contact.
 *
 * @param navigate  react-router navigate function
 * @param contactId the contact whose thread to open (may be missing)
 */
export async function openInAppThread(navigate, contactId, deps = {}) {
  const { fetchFn, onError = err } = deps;
  if (!contactId) {
    navigate(pickerHref());
    return;
  }
  try {
    const conversationId = await resolveConversationId(contactId, fetchFn);
    navigate(conversationId ? threadHref(conversationId) : pickerHref());
  } catch (error) {
    // Still land in the app — the picker can resolve it manually.
    onError(error.message || 'Could not open this conversation');
    navigate(pickerHref());
  }
}
