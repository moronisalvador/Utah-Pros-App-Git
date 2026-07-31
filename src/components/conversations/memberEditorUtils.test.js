/**
 * Verifies that participant-directory cache identities are owned by the active
 * employee, so an in-app account switch cannot reuse another account's rows.
 */
import { describe, expect, it } from 'vitest';
import { conversationMembersQueryKey } from './memberEditorUtils.js';

describe('conversationMembersQueryKey', () => {
  it('separates the same conversation across employee accounts', () => {
    expect(conversationMembersQueryKey('employee-a', 'conversation-1'))
      .not.toEqual(conversationMembersQueryKey('employee-b', 'conversation-1'));
  });

  it('keeps signed-out and incomplete identities isolated', () => {
    expect(conversationMembersQueryKey(null, null)).toEqual([
      'conversation-members',
      'signed-out',
      null,
    ]);
  });
});
