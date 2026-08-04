/**
 * ════════════════════════════════════════════════
 * FILE: ConversationNotificationToggle.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the signed-in staff member turn notifications for one conversation on
 *   or off. This never changes whether they can open or reply to the conversation.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/messages and /conversations
 *   Rendered by:  ThreadView.jsx and Conversations.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/lib/nativeHaptics, @/lib/toast,
 *              conversationNotificationQueryKeys.js
 *   Data:      reads  → conversation_notification_subscriptions through
 *                       get_my_conversation_notification_setting
 *              writes → conversation_notification_subscriptions through
 *                       set_my_conversation_notification_setting
 *
 * NOTES / GOTCHAS:
 *   - The database derives the employee from the session. The browser never
 *     chooses which employee it is changing.
 *   - An explicit mute wins over later opens, conversation creation retries,
 *     and successful sends.
 * ════════════════════════════════════════════════
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { notify, selection } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';
import {
  conversationNotificationMembersKey,
  conversationNotificationSettingKey,
} from './conversationNotificationQueryKeys';

export default function ConversationNotificationToggle({
  conversationId,
  className = '',
}) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = conversationNotificationSettingKey(employee?.id, conversationId);
  const eligible = Boolean(
    conversationId
    && employee?.id
    && employee?.is_active !== false
    && employee?.is_external !== true,
  );

  const {
    data: setting,
    error: loadError,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    queryKey,
    enabled: eligible,
    queryFn: () => db.rpc('get_my_conversation_notification_setting', {
      p_conversation_id: conversationId,
    }),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  if (!eligible) return null;

  const update = async () => {
    if (!setting || isFetching) return;
    const next = setting.subscribed !== true;
    try {
      const updated = await db.rpc(
        'set_my_conversation_notification_setting',
        {
          p_conversation_id: conversationId,
          p_subscribed: next,
        },
      );
      queryClient.setQueryData(queryKey, updated);
      queryClient.invalidateQueries({
        queryKey: conversationNotificationMembersKey(employee.id, conversationId),
      });
      notify('success');
      ok(next
        ? 'Notifications turned on for this conversation'
        : 'Notifications muted for this conversation');
    } catch (error) {
      notify('error');
      err(error?.message || 'Could not update conversation notifications');
    }
  };

  if (loadError && !setting) {
    return (
      <button
        type="button"
        className={`btn btn-secondary conversation-members__leave${className ? ` ${className}` : ''}`}
        onPointerUp={selection}
        onClick={() => refetch()}
      >
        Retry notification setting
      </button>
    );
  }

  const subscribed = setting?.subscribed === true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={subscribed}
      className={`btn ${subscribed ? 'btn-primary' : 'btn-secondary'} conversation-members__leave${className ? ` ${className}` : ''}`}
      disabled={isPending || isFetching || !setting}
      onPointerUp={selection}
      onClick={update}
    >
      {isPending || isFetching
        ? 'Loading notifications…'
        : subscribed
          ? 'Notifications on'
          : 'Notifications muted'}
    </button>
  );
}
