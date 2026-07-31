/**
 * ════════════════════════════════════════════════
 * FILE: memberEditorUtils.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the cache identity for one administrator's participant editor.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  consumed by ConversationMemberEditor.jsx
 *   Data:      reads/writes → none
 *
 * NOTES / GOTCHAS:
 *   - Employee ownership is part of the key. Removing it can expose a prior
 *     account's participant directory during an in-app account switch.
 * ════════════════════════════════════════════════
 */

export const conversationMembersQueryKey = (employeeId, conversationId) => [
  'conversation-members',
  employeeId || 'signed-out',
  conversationId || null,
];
