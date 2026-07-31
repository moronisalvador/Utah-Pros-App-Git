import { describe, expect, it, vi } from 'vitest';
import { setMyConversationUnreadState } from './conversationUnread.js';

describe('setMyConversationUnreadState', () => {
  it('deduplicates ids and calls only the actor-derived RPC', async () => {
    const db = { rpc: vi.fn().mockResolvedValue(2) };

    await expect(setMyConversationUnreadState(
      db,
      ['conversation-a', 'conversation-a', 'conversation-b'],
      true,
    )).resolves.toBe(2);
    expect(db.rpc).toHaveBeenCalledWith('set_my_conversation_unread_state', {
      p_conversation_ids: ['conversation-a', 'conversation-b'],
      p_unread: true,
    });
  });

  it('uses null ids only for mark-all-read', async () => {
    const db = { rpc: vi.fn().mockResolvedValue(4) };
    await expect(setMyConversationUnreadState(db, null, false)).resolves.toBe(4);
    expect(db.rpc).toHaveBeenCalledWith('set_my_conversation_unread_state', {
      p_conversation_ids: null,
      p_unread: false,
    });
    await expect(setMyConversationUnreadState(db, null, true))
      .rejects.toThrow('Conversation ids are required');
  });

  it('propagates an offline failure without treating it as success', async () => {
    const offline = Object.assign(new Error('Network unavailable'), { status: 0 });
    const db = { rpc: vi.fn().mockRejectedValue(offline) };

    await expect(setMyConversationUnreadState(db, ['conversation-a'], false))
      .rejects.toBe(offline);
  });
});
