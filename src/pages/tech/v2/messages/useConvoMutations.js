/**
 * ════════════════════════════════════════════════
 * FILE: useConvoMutations.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small set of one-tap actions the tech takes on a conversation from the list or
 *   the thread header: mark a conversation unread (bring back the red dot), mark it read,
 *   mark every unread conversation read at once, and turn ON Do Not Disturb for a contact
 *   who asks the tech in person to stop texting them. Turning DND back OFF is NOT here —
 *   that is office/admin-only (re-opening texting without consent evidence is the real
 *   risk), so techs simply never get that switch.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  src/pages/tech/v2/TechMessagesV2.jsx (wires it into the list + thread)
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query
 *   Internal:  @/contexts/AuthContext (db, employee), @/lib/techQuery (invalidateTech),
 *              ./msgsSelectors (setConvoUnreadInData)
 *   Data:      writes → conversations (unread_count), contacts (dnd/dnd_at),
 *                       sms_consent_log (the DND audit row — copied verbatim from legacy)
 *
 * NOTES / GOTCHAS:
 *   - Unread edits patch every cached convos view (and the badge's unread_total) instantly
 *     via setConvoUnreadInData, then persist; a failure re-invalidates to resync.
 *   - read-all is SERVER-count-driven, not loaded-page-driven: it updates conversations
 *     where unread_count > 0 (a filter, not an id list), so unread threads off the current
 *     page are cleared too. It then invalidates so ordering/counts come back honest.
 *   - DND ON writes the SAME two rows legacy writes (Conversations.jsx:641-653): the
 *     contact flag + the `sms_consent_log` audit row with performed_by = this employee.
 *     consent-path-auditor weights this — the log write is not optional.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { invalidateTech } from '@/lib/techQuery';
import { setConvoUnreadInData } from './msgsSelectors';

function emitToast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
}

const CONVOS_PREFIX = ['tech', 'convos'];

export function useConvoMutations() {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();

  // Patch one conversation's unread across every cached convos view + the badge.
  const patchUnread = useCallback((convId, newCount) => {
    queryClient.setQueriesData({ queryKey: CONVOS_PREFIX }, (data) => setConvoUnreadInData(data, convId, newCount));
  }, [queryClient]);

  const setUnread = useCallback(async (convId, unread) => {
    if (!convId) return;
    const newCount = unread ? 1 : 0;
    patchUnread(convId, newCount);
    try {
      await db.update('conversations', `id=eq.${convId}`, { unread_count: newCount });
    } catch (err) {
      console.error('Set unread error:', err);
      invalidateTech(queryClient, 'message');   // resync on failure
      emitToast('Could not update', 'error');
    }
  }, [db, patchUnread, queryClient]);

  const markAllRead = useCallback(async () => {
    try {
      // Server-count-driven: clears EVERY unread conversation, not just the loaded page.
      await db.update('conversations', 'unread_count=gt.0', { unread_count: 0 });
      invalidateTech(queryClient, 'message');
    } catch (err) {
      console.error('Mark all read error:', err);
      emitToast('Could not mark all read', 'error');
    }
  }, [db, queryClient]);

  // One-tap DND ON (techs only turn it ON; OFF is office/admin-only — never rendered here).
  const enableDnd = useCallback(async (contactId, phone) => {
    if (!contactId) return;
    const now = new Date().toISOString();
    try {
      await db.update('contacts', `id=eq.${contactId}`, { dnd: true, dnd_at: now, updated_at: now });
      await db.insert('sms_consent_log', {
        contact_id: contactId,
        phone: phone || '',
        event_type: 'dnd_on',
        source: 'manual',
        details: 'DND enabled by team member via conversations UI.',
        performed_by: employee?.id || null,
      });
      // Reflect DND immediately across cached views (banner + info-header state).
      queryClient.setQueriesData({ queryKey: CONVOS_PREFIX }, (data) => {
        if (!data || !Array.isArray(data.conversations)) return data;
        const conversations = data.conversations.map((c) => ({
          ...c,
          conversation_participants: (c.conversation_participants || []).map((p) => (
            p.contact_id === contactId && p.contacts
              ? { ...p, contacts: { ...p.contacts, dnd: true, dnd_at: now } }
              : p
          )),
        }));
        return { ...data, conversations };
      });
      emitToast('Do Not Disturb on — texting blocked', 'info');
    } catch (err) {
      console.error('Enable DND error:', err);
      invalidateTech(queryClient, 'message');
      emitToast('Could not update Do Not Disturb', 'error');
    }
  }, [db, employee, queryClient]);

  return { setUnread, markAllRead, enableDnd };
}

export default useConvoMutations;
