/**
 * Protects the native-first conversation thread controls and readability contract.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const thread = read('src/pages/tech/v2/messages/ThreadView.jsx');
const globalCss = read('src/index.css');

describe('native-first conversation thread contract', () => {
  it('opens notification controls from the tappable conversation header', () => {
    expect(thread).toContain('tv2-msgs-thread__titlebtn');
    expect(thread).toContain('<ConversationNotificationEditor');
    expect(thread).toContain('<ConversationNotificationToggle');
    expect(thread).toContain('onAccessRevoked');
  });

  it('labels both system authors and multi-recipient customer messages', () => {
    expect(thread).toContain('participants={conv?.conversation_participants || []}');
    expect(thread).toContain('isMultiConversation={isMulti}');
    expect(globalCss).toContain('.message-sender-name');
    expect(globalCss).toContain('.message.outbound .message-sender-name');
  });

  it('keeps phone text readable and notification controls native-safe', () => {
    expect(globalCss).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.message-bubble \{[\s\S]*?font-size: var\(--text-xl\)/);
    expect(globalCss).toContain(
      '.conversation-members :is(.btn, .ui-seg-btn, .ui-modal-close) { min-height: 48px; }',
    );
    expect(globalCss).toContain('padding-bottom: env(safe-area-inset-bottom, 0px)');
    expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(thread).toContain("import TabLoading from '@/components/TabLoading'");
    expect(thread).toContain("import { ErrorState } from '@/components/ui'");
  });
});
