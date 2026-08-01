/**
 * ════════════════════════════════════════════════
 * FILE: LeaveConversationButton.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets an eligible technician remove themselves from a customer chat. It asks
 *   for a second tap before acting, then returns them to the conversation list.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/messages and /conversations
 *   Rendered by:  ThreadView.jsx and Conversations.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/hooks/useTwoClickConfirm,
 *              @/lib/nativeHaptics, @/lib/toast
 *   Data:      writes → conversation_member_overrides through leave_conversation
 *
 * NOTES / GOTCHAS:
 *   - The database verifies identity, current access, and role. Privileged office
 *     roles never see this control and cannot use its RPC directly.
 *   - Leaving creates a manual removal, so defaults and past appointments do not
 *     immediately put the technician back into the same chat.
 *   - A failed/offline RPC leaves the current sheet and thread in place; online
 *     mutations are never queued or optimistically treated as authorization.
 * ════════════════════════════════════════════════
 */

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { notify, selection } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';

const NON_REMOVABLE_ROLES = new Set([
  'admin',
  'office',
  'project_manager',
  'supervisor',
  'crm_partner',
]);

export default function LeaveConversationButton({
  conversationId,
  onLeft,
  className = '',
}) {
  const { db, employee } = useAuth();
  const [busy, setBusy] = useState(false);
  const { isArmed, arm, cancel } = useTwoClickConfirm(4000);
  const eligible = Boolean(
    conversationId
    && employee?.role
    && employee?.is_active !== false
    && employee?.is_external !== true
    && !NON_REMOVABLE_ROLES.has(employee?.role),
  );

  if (!eligible) return null;

  const leave = async () => {
    setBusy(true);
    cancel();
    try {
      await db.rpc('leave_conversation', {
        p_conversation_id: conversationId,
      });
      notify('success');
      ok('You left this chat');
      onLeft?.(conversationId);
    } catch (error) {
      notify('error');
      err(error?.message || 'Could not leave this chat');
      setBusy(false);
    }
  };

  const handleClick = () => {
    if (isArmed(conversationId)) {
      leave();
      return;
    }
    arm(conversationId);
  };

  return (
    <button
      type="button"
      className={`btn btn-secondary conversation-members__leave${isArmed(conversationId) ? ' is-armed' : ''}${className ? ` ${className}` : ''}`}
      disabled={busy}
      onBlur={cancel}
      onPointerUp={selection}
      onClick={handleClick}
    >
      {busy ? 'Leaving…' : isArmed(conversationId) ? 'Tap again to leave' : 'Leave this chat'}
    </button>
  );
}
