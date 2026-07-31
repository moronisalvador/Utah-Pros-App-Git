/**
 * ════════════════════════════════════════════════
 * FILE: memberEditorUtils.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that each person's list of conversation participants stays separate
 *   when someone changes accounts in the app. It also keeps signed-out and
 *   incomplete account details from sharing a saved list.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./memberEditorUtils.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This checks names used for in-memory saved results; it never reads a live database.
 * ════════════════════════════════════════════════
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
