import { describe, expect, it } from 'vitest';
import {
  hasConversationAccess,
  reconcileAccessibleConversations,
} from './conversationAccessState';

describe('reconcileAccessibleConversations', () => {
  it('drops rows absent from a successful actor-scoped refresh', () => {
    const previous = [
      { id: 'revoked', title: 'Private thread' },
      { id: 'allowed', title: 'Old title', optimistic: true },
    ];
    const fresh = [{ id: 'allowed', title: 'Fresh title' }];

    expect(reconcileAccessibleConversations(previous, fresh, true)).toEqual([
      { id: 'allowed', title: 'Fresh title', optimistic: true },
    ]);
  });

  it('keeps the current list unchanged when no authoritative array is supplied', () => {
    const previous = [{ id: 'allowed' }];
    expect(reconcileAccessibleConversations(previous, null, true)).toBe(previous);
  });
});

describe('hasConversationAccess', () => {
  it('requires the exact conversation in an authoritative actor-scoped list', () => {
    expect(hasConversationAccess([{ id: 'allowed' }], 'allowed')).toBe(true);
    expect(hasConversationAccess([{ id: 'allowed' }], 'revoked')).toBe(false);
    expect(hasConversationAccess(null, 'allowed')).toBe(false);
  });
});
