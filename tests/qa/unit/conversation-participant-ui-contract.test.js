/**
 * ════════════════════════════════════════════════
 * FILE: conversation-participant-ui-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Protects the replacement conversation-notification controls. It proves the
 *   UI no longer presents notification choices as access or participant removal.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  ConversationNotificationEditor.jsx,
 *              ConversationNotificationToggle.jsx, ThreadView.jsx,
 *              Conversations.jsx, src/index.css
 *   Data:      reads  → source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source contract, not a screenshot or device test.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const editor = read('src/components/conversations/ConversationNotificationEditor.jsx');
const toggle = read('src/components/conversations/ConversationNotificationToggle.jsx');
const queryKeys = read(
  'src/components/conversations/conversationNotificationQueryKeys.js',
);
const techQuery = read('src/lib/techQuery.js');
const globalCss = read('src/index.css');
const messageBubble = read('src/components/conversations/MessageBubble.jsx');
const techThread = read('src/pages/tech/v2/messages/ThreadView.jsx');
const desktopInbox = read('src/pages/Conversations.jsx');

describe('conversation notification UI contract', () => {
  it('uses actor-derived RPCs and never writes subscription tables directly', () => {
    expect(editor).toContain("import { EmptyState, ErrorState, Modal } from '@/components/ui'");
    expect(editor).toContain("db.rpc('get_conversation_notification_members'");
    expect(editor).toContain("db.rpc('set_conversation_notification_override'");
    expect(toggle).toContain("db.rpc('get_my_conversation_notification_setting'");
    expect(toggle).toContain("'set_my_conversation_notification_setting'");
    expect(`${editor}\n${toggle}`).not.toMatch(
      /\.from\(['"]conversation_notification_subscriptions/,
    );
  });

  it('states that notification settings do not change access', () => {
    expect(editor).toContain('Everyone with Messages access can still open and reply.');
    expect(editor).toContain('title="Conversation notifications"');
    expect(toggle).toContain('Notifications muted');
    expect(techThread).not.toContain('<ConversationMemberEditor');
    expect(techThread).not.toContain('<LeaveConversationButton');
    expect(desktopInbox).not.toContain('<ConversationMemberEditor');
    expect(desktopInbox).not.toContain('<LeaveConversationButton');
  });

  it('keeps account-bound cache keys, explicit error states, and session-derived self writes', () => {
    expect(queryKeys).toContain(
      "['conversation-notification-setting', employeeId || null, conversationId || null]",
    );
    expect(queryKeys).toContain(
      "['conversation-notification-members', employeeId || null, conversationId || null]",
    );
    expect(techQuery).toContain("root === 'conversation-notification-setting'");
    expect(techQuery).toContain("root === 'conversation-notification-members'");
    expect(editor).toContain('<ErrorState');
    expect(editor).toContain('<EmptyState');
    expect(editor).toContain('refetchOnWindowFocus: false');
    expect(toggle).toContain('refetchOnWindowFocus: false');
    expect(toggle).not.toContain('p_employee_id');
  });

  it('keeps native feedback, 48px technician targets, and safe-area sheet behavior', () => {
    expect(editor).toContain("from '@/lib/nativeHaptics'");
    expect(toggle).toContain("from '@/lib/nativeHaptics'");
    expect(editor).toContain('onPointerUp={selection}');
    expect(toggle).toContain('onPointerUp={selection}');
    expect(globalCss).toContain('@media (max-width: 768px)');
    expect(globalCss).toContain('.tech-layout .conversation-members__leave { min-height: 48px; }');
    expect(globalCss).toContain(
      '.conversation-members :is(.btn, .ui-seg-btn, .ui-modal-close) { min-height: 48px; }',
    );
    expect(editor).toContain('conversation-members__switch');
    expect(editor).toContain('conversation-members__switch-knob');
    expect(globalCss).toContain('padding-bottom: env(safe-area-inset-bottom, 0px)');
  });

  it('uses shared sender labels and readable phone-sized message text', () => {
    expect(messageBubble).toContain('messageSenderName');
    expect(messageBubble).toContain('className="message-sender-name"');
    expect(globalCss).toContain('--text-xl: 18px');
    expect(globalCss).toContain('font-size: var(--text-xl)');
    expect(globalCss).toContain('.message-sender-name');
  });

  it('exposes the same notification controls on tech and desktop', () => {
    expect(techThread).toContain('<ConversationNotificationEditor');
    expect(techThread).toContain('<ConversationNotificationToggle');
    expect(desktopInbox).toContain('<ConversationNotificationEditor');
    expect(desktopInbox).toContain('<ConversationNotificationToggle');
    expect(techThread).toContain("onPointerUp={() => impact('light')}");
    expect(desktopInbox).toContain("onPointerUp={() => impact('light')}");
  });

  it('keeps conversation detail navigation inside the SPA', () => {
    expect(desktopInbox).toContain(
      "import { Link, useLocation, useSearchParams } from 'react-router-dom'",
    );
    expect(desktopInbox).toContain('<Link to={`/contacts/${activeContact.id}`}');
    expect(desktopInbox).toContain('<Link to={`/jobs/${linkedJob.id}`}');
    expect(desktopInbox).not.toMatch(/<a href=\{?`?\/(?:contacts|jobs)\//);
  });
});
