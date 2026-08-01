/**
 * ════════════════════════════════════════════════
 * FILE: conversation-participant-ui-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that chat participant controls keep their phone-first safety and
 *   design promises. It protects the native sheet, large touch targets, reduced
 *   motion, tactile feedback, two-tap removal, and shared sender readability.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  ConversationMemberEditor.jsx, LeaveConversationButton.jsx,
 *              ThreadView.jsx, Conversations.jsx, src/index.css
 *   Data:      reads  → source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source contract, not a screenshot or device test. Capacitor
 *     simulator/device verification remains a release step.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const editor = read('src/components/conversations/ConversationMemberEditor.jsx');
const leaveButton = read('src/components/conversations/LeaveConversationButton.jsx');
const globalCss = read('src/index.css');
const messageBubble = read('src/components/conversations/MessageBubble.jsx');
const techThread = read('src/pages/tech/v2/messages/ThreadView.jsx');
const desktopInbox = read('src/pages/Conversations.jsx');

describe('conversation participant UI contract', () => {
  it('uses the shared native-style modal and RPC-only data boundary', () => {
    expect(editor).toContain("import { EmptyState, ErrorState, Modal } from '@/components/ui'");
    expect(editor).toContain('<Modal');
    expect(editor).toContain("db.rpc('get_conversation_members'");
    expect(editor).toContain("db.rpc('set_conversation_member_override'");
    expect(editor).toContain("db.rpc('set_default_conversation_member'");
    expect(editor).not.toMatch(/\.from\(['"]conversation_(member_overrides|default_members)/);
    expect(`${editor}\n${leaveButton}`).not.toMatch(
      /const\s+\{\s*(?:data\s*,\s*)?error\s*\}\s*=\s*await\s+db\.rpc/,
    );
  });

  it('keeps destructive removal and self-leave behind two-click confirmation', () => {
    expect(editor).toContain('useTwoClickConfirm(4000)');
    expect(editor).toContain("isArmed(actionKey) ? 'Confirm' : 'Remove'");
    expect(leaveButton).toContain('useTwoClickConfirm(4000)');
    expect(leaveButton).toContain("db.rpc('leave_conversation'");
    expect(leaveButton).toContain("'Tap again to leave'");
  });

  it('keeps native feedback, 48px mobile targets, reduced motion, and safe-area sheet behavior', () => {
    expect(editor).toContain("from '@/lib/nativeHaptics'");
    expect(leaveButton).toContain("from '@/lib/nativeHaptics'");
    expect(globalCss).toContain('@media (max-width: 768px)');
    expect(globalCss).toMatch(/\.conversation-members[\s\S]*?min-height:\s*48px/);
    expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalCss).toContain('.tech-layout .conversation-members__leave');
    expect(globalCss).toContain('padding-bottom: env(safe-area-inset-bottom, 0px)');
    expect(globalCss).toContain('animation: uiSheetUp');
    expect(globalCss).toContain(
      '.tech-layout .tv2-msgs-thread__error .btn { min-height: var(--tech-min-tap);',
    );
    expect(globalCss).toContain(
      '.tech-layout :is(.conv-retry-btn, a.conv-media-file) { min-height: var(--tech-min-tap);',
    );
  });

  it('keeps participant tactile feedback on pointer activation, never keyboard click', () => {
    expect(editor).toContain('className="ui-seg conversation-members__tabs"');
    expect(editor).toContain('ui-seg-indicator conversation-members__tab-indicator');
    expect(editor).toContain('role="group"');
    expect(editor.match(/aria-pressed=\{tab ===/g)?.length).toBe(2);
    expect(editor).not.toContain('role="tablist"');
    expect(editor).not.toContain('role="tab"');
    expect(editor).toContain('const handleAutomatic = (member) => {');
    expect(editor).toContain('const handleAdd = (member) => {');
    expect(editor).toContain('const handleDefaultOn = (member) => {');
    expect(editor.match(/onPointerUp=\{selection\}/g)?.length).toBeGreaterThanOrEqual(7);
    expect(editor).not.toContain('selection();');
    expect(leaveButton).toContain('onPointerUp={selection}');
    expect(leaveButton).not.toContain('selection();');
    expect(techThread).toContain("onPointerUp={() => impact('light')}");
    expect(desktopInbox).toContain("onPointerUp={() => impact('light')}");
    expect(techThread).not.toContain('selection();');
    expect(desktopInbox).not.toContain('selection();');
    expect(desktopInbox).toContain('function HapticRetryButton({ onRetry })');
    expect(desktopInbox).toContain(
      'secondary={<HapticRetryButton onRetry={reloadActiveMessages} />}',
    );
  });

  it('honors reduced motion for inbox scrolling and shows explicit participant empty states', () => {
    expect(desktopInbox).toContain("import { scrollBehavior } from '@/lib/reducedMotion'");
    expect(desktopInbox).toContain(
      "behavior: scrollBehavior(smooth ? 'smooth' : 'instant')",
    );
    expect(editor).toContain('title="No participants available"');
    expect(editor).toContain('title="No default technicians available"');
  });

  it('uses shared sender labels and readable phone-sized message text', () => {
    expect(messageBubble).toContain('messageSenderName');
    expect(messageBubble).toContain('className="message-sender-name"');
    expect(globalCss).toContain('--text-xl: 18px');
    expect(globalCss).toContain('font-size: var(--text-xl)');
    expect(globalCss).toContain('.message-sender-name');
  });

  it('exposes the shared controls on both the tech thread and desktop inbox', () => {
    expect(techThread).toContain('<ConversationMemberEditor');
    expect(techThread).toContain('<LeaveConversationButton');
    expect(globalCss).toMatch(/\.tv2-msgs-info\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*52px;/);
    expect(desktopInbox).toContain('<ConversationMemberEditor');
    expect(desktopInbox).toContain('<LeaveConversationButton');
  });

  it('keeps participant detail navigation inside the SPA', () => {
    expect(desktopInbox).toContain("import { Link, useLocation, useSearchParams } from 'react-router-dom'");
    expect(desktopInbox).toContain('<Link to={`/contacts/${activeContact.id}`}');
    expect(desktopInbox).toContain('<Link to={`/jobs/${linkedJob.id}`}');
    expect(desktopInbox).not.toMatch(/<a href=\{?`?\/(?:contacts|jobs)\//);
  });
});
