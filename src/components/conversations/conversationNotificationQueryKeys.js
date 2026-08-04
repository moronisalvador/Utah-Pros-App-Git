/**
 * ════════════════════════════════════════════════
 * FILE: conversationNotificationQueryKeys.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds account-bound cache labels for conversation notification settings.
 *   Keeping the employee id in every label prevents one login from reusing
 *   another employee's cached notification state.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ConversationNotificationEditor.jsx,
 *              ConversationNotificationToggle.jsx
 *   Data:      reads  → none
 *              writes → none
 * ════════════════════════════════════════════════
 */

export const conversationNotificationSettingKey = (
  employeeId,
  conversationId,
) => ['conversation-notification-setting', employeeId || null, conversationId || null];

export const conversationNotificationMembersKey = (
  employeeId,
  conversationId,
) => ['conversation-notification-members', employeeId || null, conversationId || null];
