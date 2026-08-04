/**
 * ════════════════════════════════════════════════
 * FILE: ConversationNotificationEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows administrators who will be notified about one conversation and lets
 *   them notify, mute, or restore the normal role default for each staff member.
 *   These controls do not grant or remove conversation access.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/messages and /conversations
 *   Rendered by:  ThreadView.jsx and Conversations.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/components/ui, @/contexts/AuthContext,
 *              @/lib/nativeHaptics, @/lib/toast,
 *              conversationNotificationQueryKeys.js
 *   Data:      reads  → employees and conversation_notification_subscriptions
 *                       through get_conversation_notification_members
 *              writes → conversation_notification_subscriptions through
 *                       set_conversation_notification_override
 *
 * NOTES / GOTCHAS:
 *   - Only active internal administrators render the panel, and the database
 *     repeats that authorization check.
 *   - Restoring "Automatic" deletes only the explicit per-thread choice.
 *     Office leadership defaults on; technicians and estimators default off.
 * ════════════════════════════════════════════════
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, Modal } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { notify, selection } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';
import {
  conversationNotificationMembersKey,
  conversationNotificationSettingKey,
} from './conversationNotificationQueryKeys';

const SOURCE_LABELS = {
  role_default: 'Role default',
  not_subscribed: 'Not subscribed',
  manual_self: 'Chosen by employee',
  manual_admin: 'Chosen by admin',
  conversation_created: 'Started conversation',
  message_persisted: 'Sent a message or note',
};

const roleLabel = (role) => ({
  admin: 'Admin',
  office: 'Office',
  project_manager: 'Project manager',
  supervisor: 'Supervisor',
  field_tech: 'Technician',
  estimator: 'Estimator',
}[role] || role?.replaceAll('_', ' ') || 'Team member');

const initials = (name) => String(name || '?')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join('')
  .toUpperCase();

export default function ConversationNotificationEditor({
  open,
  onClose,
  conversationId,
  conversationTitle,
}) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const [busyEmployeeId, setBusyEmployeeId] = useState(null);
  const isAdmin = employee?.role === 'admin'
    && employee?.is_active !== false
    && employee?.is_external !== true;
  const queryKey = conversationNotificationMembersKey(
    employee?.id,
    conversationId,
  );

  const {
    data: members = [],
    error: loadError,
    isPending,
    refetch,
  } = useQuery({
    queryKey,
    enabled: Boolean(open && conversationId && isAdmin),
    queryFn: async () => {
      const data = await db.rpc('get_conversation_notification_members', {
        p_conversation_id: conversationId,
      });
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setBusyEmployeeId(null);
  }, [employee?.id, open]);

  if (!isAdmin) return null;

  const update = async (member, subscribed) => {
    setBusyEmployeeId(member.employee_id);
    try {
      const data = await db.rpc('set_conversation_notification_override', {
        p_conversation_id: conversationId,
        p_employee_id: member.employee_id,
        p_subscribed: subscribed,
      });
      queryClient.setQueryData(queryKey, Array.isArray(data) ? data : members);
      queryClient.invalidateQueries({
        queryKey: conversationNotificationSettingKey(
          member.employee_id,
          conversationId,
        ),
      });
      notify('success');
      ok(subscribed === null
        ? `${member.name} now follows the role default`
        : subscribed
          ? `${member.name} will be notified`
          : `${member.name} will not be notified`);
    } catch (error) {
      notify('error');
      err(error?.message || 'Could not update conversation notifications');
    } finally {
      setBusyEmployeeId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Conversation notifications"
      size="lg"
      className="conversation-members"
    >
      <p className="conversation-members__intro">
        Choose who is notified about {conversationTitle
          ? `“${conversationTitle}”`
          : 'this conversation'}.
        Everyone with Messages access can still open and reply.
      </p>

      {isPending ? (
        <div className="conversation-members__loading" aria-label="Loading notification settings">
          {[0, 1, 2, 3].map((item) => (
            <span className="conversation-members__skeleton" key={item} />
          ))}
        </div>
      ) : loadError && members.length === 0 ? (
        <ErrorState
          message="Notification settings could not be loaded."
          onRetry={() => refetch()}
        />
      ) : members.length > 0 ? (
        <ul className="conversation-members__list">
          {members.map((member) => {
            const busy = busyEmployeeId === member.employee_id;
            return (
              <li className="conversation-members__row" key={member.employee_id}>
                <span className="conversation-members__avatar" aria-hidden="true">
                  {initials(member.name)}
                </span>
                <span className="conversation-members__identity">
                  <span className="conversation-members__name">{member.name}</span>
                  <span className="conversation-members__meta">
                    {roleLabel(member.role)} · {member.can_view
                      ? SOURCE_LABELS[member.source] || 'Automatic'
                      : 'No conversation access'}
                  </span>
                </span>
                <span className="conversation-members__actions">
                  {member.can_view ? (
                    <>
                      {member.has_explicit && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost conversation-members__text-action"
                          disabled={busy}
                          onPointerUp={selection}
                          onClick={() => update(member, null)}
                        >
                          Automatic
                        </button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={member.subscribed === true}
                        className={`btn btn-sm ${member.subscribed ? 'btn-primary' : 'btn-secondary'} conversation-members__switch${member.subscribed ? ' is-on' : ''}`}
                        disabled={busy}
                        onPointerUp={selection}
                        onClick={() => update(member, !member.subscribed)}
                      >
                        <span className="conversation-members__switch-label">
                          {busy
                            ? 'Saving…'
                            : member.subscribed
                              ? 'Notify'
                              : 'Muted'}
                        </span>
                        <span className="conversation-members__switch-knob" />
                      </button>
                    </>
                  ) : (
                    <span className="conversation-members__locked">Unavailable</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          className="conversation-members__empty"
          title="No team members available"
          sub="Active internal staff with Messages access will appear here."
        />
      )}
    </Modal>
  );
}
