/**
 * Guards the same-account authorization-revocation boundary for conversation caches.
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { techKeys } from '@/lib/techQuery';
import {
  isConversationAccessDenied,
  isConversationSendAccessDenied,
  pruneConversationFromInbox,
  purgeConversationAccess,
} from './accessRevocation';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('conversation access denial classification', () => {
  it('treats only database authentication/authorization failures as access loss', () => {
    expect(isConversationAccessDenied({ status: 401 })).toBe(true);
    expect(isConversationAccessDenied({ status: 403 })).toBe(true);
    expect(isConversationAccessDenied({ status: 500 })).toBe(false);
    expect(isConversationAccessDenied(new Error('offline'))).toBe(false);
  });

  it('does not mistake consent or recipient 403 responses for membership removal', () => {
    expect(isConversationSendAccessDenied(403, 'CONVERSATION_NOT_AUTHORIZED')).toBe(true);
    expect(isConversationSendAccessDenied(401, 'SESSION_EXPIRED')).toBe(true);
    expect(isConversationSendAccessDenied(403, 'DND_ACTIVE')).toBe(false);
    expect(isConversationSendAccessDenied(403, 'NO_CONSENT')).toBe(false);
  });
});

describe('pruneConversationFromInbox', () => {
  it('removes the row and reconciles unread and status totals without going negative', () => {
    expect(pruneConversationFromInbox({
      conversations: [
        { id: 'conversation-1', status: 'active', unread_count: 3 },
        { id: 'conversation-2', status: 'active', unread_count: 0 },
      ],
      unread_total: 2,
      status_counts: { active: 2 },
    }, 'conversation-1')).toEqual({
      conversations: [
        { id: 'conversation-2', status: 'active', unread_count: 0 },
      ],
      unread_total: 0,
      status_counts: { active: 1 },
    });
  });
});

describe('purgeConversationAccess', () => {
  it('erases only the revoked thread plus every sensitive directory and its draft', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    const inbox = {
      conversations: [
        { id: 'conversation-1', status: 'active', unread_count: 1 },
        { id: 'conversation-2', status: 'active', unread_count: 0 },
      ],
      unread_total: 1,
      status_counts: { active: 2 },
    };

    client.setQueryData(techKeys.thread('conversation-1'), { pages: [[{ body: 'private' }]] });
    client.setQueryData(techKeys.thread('conversation-2'), { pages: [[{ body: 'keep' }]] });
    client.setQueryData(techKeys.conversationAccess('employee-1', 'conversation-1'), true);
    client.setQueryData(['conversation-members', 'employee-1', 'conversation-1'], [{ id: 'private' }]);
    client.setQueryData(['message-author-directory', 'employee-1', ['message-1']], [{ id: 'private' }]);
    client.setQueryData(techKeys.convos(), inbox);
    client.setQueryData(techKeys.convos('unread'), inbox);

    purgeConversationAccess(client, 'conversation-1');

    expect(client.getQueryData(techKeys.thread('conversation-1'))).toBeUndefined();
    expect(client.getQueryData(techKeys.thread('conversation-2'))).toEqual({
      pages: [[{ body: 'keep' }]],
    });
    expect(client.getQueryData(techKeys.conversationAccess('employee-1', 'conversation-1')))
      .toBeUndefined();
    expect(client.getQueryData(['conversation-members', 'employee-1', 'conversation-1']))
      .toBeUndefined();
    expect(client.getQueryData(['message-author-directory', 'employee-1', ['message-1']]))
      .toBeUndefined();
    expect(client.getQueryData(techKeys.convos()).conversations.map(({ id }) => id))
      .toEqual(['conversation-2']);
    expect(client.getQueryData(techKeys.convos('unread')).unread_total).toBe(0);
    expect(removeItem).toHaveBeenCalledWith('upr:conv-draft:conversation-1');
  });
});
