/**
 * ════════════════════════════════════════════════
 * FILE: conversation-participant-ui-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that chat participant controls keep their phone-first safety and
 *   design promises. It protects the native sheet, large touch targets, reduced
 *   motion, tactile feedback, and two-tap removal behavior from accidental drift.
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
const css = read('src/index.css');
const techThread = read('src/pages/tech/v2/messages/ThreadView.jsx');
const desktopInbox = read('src/pages/Conversations.jsx');

describe('conversation participant UI contract', () => {
  it('uses the shared native-style modal and RPC-only data boundary', () => {
    expect(editor).toContain("import { ErrorState, Modal } from '@/components/ui'");
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
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toMatch(/min-height:\s*48px/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('padding-bottom: env(safe-area-inset-bottom, 0px)');
    expect(css).toContain('animation: uiSheetUp');
  });

  it('exposes the shared controls on both the tech thread and desktop inbox', () => {
    expect(techThread).toContain('<ConversationMemberEditor');
    expect(techThread).toContain('<LeaveConversationButton');
    expect(desktopInbox).toContain('<ConversationMemberEditor');
    expect(desktopInbox).toContain('<LeaveConversationButton');
  });
});
