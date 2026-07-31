/**
 * ════════════════════════════════════════════════
 * FILE: ConversationMemberEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets an administrator decide which staff members can open one customer chat
 *   and which technicians should start in every chat. On phones it uses the
 *   app's native-style bottom sheet; on a computer it uses the same controls in
 *   a centered panel.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/messages and /conversations
 *   Rendered by:  ThreadView.jsx and Conversations.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/components/ui, @/hooks/useTwoClickConfirm,
 *              @/lib/nativeHaptics, @/lib/toast
 *   Data:      reads  → conversation_member_overrides, conversation_default_members,
 *                       employees, appointment_crew through get_conversation_members
 *              writes → conversation_member_overrides through
 *                       set_conversation_member_override; conversation_default_members
 *                       through set_default_conversation_member
 *
 * NOTES / GOTCHAS:
 *   - Only active internal administrators render or can call these controls.
 *     The database repeats that check; hiding this button is not the security gate.
 *   - The query key includes the authenticated employee id so an account switch
 *     cannot reuse another employee's participant directory in memory.
 *   - Removing access and turning off a global default both use the shared
 *     two-click confirmation pattern. Privileged office roles cannot be removed.
 *   - The shared Modal owns safe-area padding, focus trapping, reduced motion,
 *     and the iOS-style sheet transition.
 * ════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { ErrorState, Modal } from '@/components/ui';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { notify, selection } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';
import { conversationMembersQueryKey } from './memberEditorUtils';

const SOURCE_LABELS = {
  privileged: 'Office access',
  manual_add: 'Added to this chat',
  manual_remove: 'Removed from this chat',
  default: 'Default technician',
  appointment: 'Past appointment',
  none: 'Not included',
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

export default function ConversationMemberEditor({
  open,
  onClose,
  conversationId,
  conversationTitle,
}) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('chat');
  const [busyKey, setBusyKey] = useState(null);
  const { isArmed, arm, cancel } = useTwoClickConfirm(4000);
  const isAdmin = employee?.role === 'admin'
    && employee?.is_active !== false
    && employee?.is_external !== true;
  const queryKey = conversationMembersQueryKey(employee?.id, conversationId);

  const {
    data: members = [],
    error: loadError,
    isPending,
    refetch,
  } = useQuery({
    queryKey,
    enabled: Boolean(open && conversationId && isAdmin),
    queryFn: async () => {
      const data = await db.rpc('get_conversation_members', {
        p_conversation_id: conversationId,
      });
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15_000,
  });

  const technicians = useMemo(
    () => members.filter((member) => member.can_default),
    [members],
  );

  useEffect(() => {
    setBusyKey(null);
    cancel();
    if (!open) setTab('chat');
  }, [cancel, employee?.id, open]);

  if (!isAdmin) return null;

  const updateChatMember = async (member, included) => {
    const actionKey = `chat:${member.employee_id}`;
    setBusyKey(actionKey);
    cancel();
    try {
      const data = await db.rpc('set_conversation_member_override', {
        p_conversation_id: conversationId,
        p_employee_id: member.employee_id,
        p_included: included,
      });
      queryClient.setQueryData(queryKey, Array.isArray(data) ? data : members);
      notify('success');
      ok(included === null
        ? `${member.name} now follows automatic access`
        : included
          ? `${member.name} added to this chat`
          : `${member.name} removed from this chat`);
    } catch (error) {
      notify('error');
      err(error?.message || 'Could not update chat access');
    } finally {
      setBusyKey(null);
    }
  };

  const updateDefaultMember = async (member, included) => {
    const actionKey = `default:${member.employee_id}`;
    setBusyKey(actionKey);
    cancel();
    try {
      await db.rpc('set_default_conversation_member', {
        p_employee_id: member.employee_id,
        p_included: included,
      });
      await refetch();
      notify('success');
      ok(included
        ? `${member.name} will be included in every chat`
        : `${member.name} removed from chat defaults`);
    } catch (error) {
      notify('error');
      err(error?.message || 'Could not update default technicians');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemove = (member) => {
    const key = `chat:${member.employee_id}`;
    if (isArmed(key)) {
      updateChatMember(member, false);
      return;
    }
    selection();
    arm(key);
  };

  const handleDefaultOff = (member) => {
    const key = `default:${member.employee_id}`;
    if (isArmed(key)) {
      updateDefaultMember(member, false);
      return;
    }
    selection();
    arm(key);
  };

  const renderMember = (member) => {
    const actionKey = `chat:${member.employee_id}`;
    const busy = busyKey === actionKey;
    return (
      <li className="conversation-members__row" key={member.employee_id}>
        <span className="conversation-members__avatar" aria-hidden="true">
          {initials(member.name)}
        </span>
        <span className="conversation-members__identity">
          <span className="conversation-members__name">{member.name}</span>
          <span className="conversation-members__meta">
            {roleLabel(member.role)} · {SOURCE_LABELS[member.source] || 'Automatic'}
          </span>
        </span>
        <span className="conversation-members__actions">
          {member.can_edit ? (
            <>
              {member.has_override && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost conversation-members__text-action"
                  disabled={busy}
                  onClick={() => updateChatMember(member, null)}
                >
                  Automatic
                </button>
              )}
              {member.included ? (
                <button
                  type="button"
                  className={`btn btn-sm btn-secondary conversation-members__pill${isArmed(actionKey) ? ' is-armed' : ''}`}
                  disabled={busy}
                  onBlur={cancel}
                  onClick={() => handleRemove(member)}
                >
                  {busy ? 'Saving…' : isArmed(actionKey) ? 'Confirm' : 'Remove'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-primary conversation-members__pill"
                  disabled={busy}
                  onClick={() => updateChatMember(member, true)}
                >
                  {busy ? 'Saving…' : 'Add'}
                </button>
              )}
            </>
          ) : (
            <span className="conversation-members__locked">Always</span>
          )}
        </span>
      </li>
    );
  };

  const renderDefault = (member) => {
    const actionKey = `default:${member.employee_id}`;
    const busy = busyKey === actionKey;
    return (
      <li className="conversation-members__row" key={member.employee_id}>
        <span className="conversation-members__avatar" aria-hidden="true">
          {initials(member.name)}
        </span>
        <span className="conversation-members__identity">
          <span className="conversation-members__name">{member.name}</span>
          <span className="conversation-members__meta">
            {member.is_default ? 'Included in every chat' : 'Add only when needed'}
          </span>
        </span>
        {member.is_default ? (
          <button
            type="button"
            role="switch"
            aria-checked="true"
            className={`btn btn-sm btn-primary conversation-members__switch is-on${isArmed(actionKey) ? ' is-armed' : ''}`}
            disabled={busy}
            onBlur={cancel}
            onClick={() => handleDefaultOff(member)}
          >
            <span className="conversation-members__switch-label">
              {busy ? 'Saving…' : isArmed(actionKey) ? 'Confirm off' : 'On'}
            </span>
            <span className="conversation-members__switch-knob" />
          </button>
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked="false"
            className="btn btn-sm btn-secondary conversation-members__switch"
            disabled={busy}
            onClick={() => updateDefaultMember(member, true)}
          >
            <span className="conversation-members__switch-label">{busy ? 'Saving…' : 'Off'}</span>
            <span className="conversation-members__switch-knob" />
          </button>
        )}
      </li>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chat participants"
      size="lg"
      className="conversation-members"
    >
      <p className="conversation-members__intro">
        Choose who can open {conversationTitle ? `“${conversationTitle}”` : 'this chat'}.
        Office leaders always keep access.
      </p>

      <div className="conversation-members__tabs" role="tablist" aria-label="Participant settings">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`btn ${tab === 'chat' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { selection(); cancel(); setTab('chat'); }}
        >
          This chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'defaults'}
          className={`btn ${tab === 'defaults' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { selection(); cancel(); setTab('defaults'); }}
        >
          Chat defaults
        </button>
      </div>

      {isPending ? (
        <div className="conversation-members__loading" aria-label="Loading participants">
          {[0, 1, 2, 3].map((item) => (
            <span className="conversation-members__skeleton" key={item} />
          ))}
        </div>
      ) : loadError && members.length === 0 ? (
        <ErrorState
          message="Participant settings could not be loaded."
          onRetry={() => refetch()}
        />
      ) : tab === 'chat' ? (
        <ul className="conversation-members__list">{members.map(renderMember)}</ul>
      ) : (
        <>
          <p className="conversation-members__help">
            Default technicians join every existing and future chat unless you remove
            them from one specific chat.
          </p>
          <ul className="conversation-members__list">{technicians.map(renderDefault)}</ul>
        </>
      )}
    </Modal>
  );
}
