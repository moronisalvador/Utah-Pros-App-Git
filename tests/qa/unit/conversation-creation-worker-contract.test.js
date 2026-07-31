/**
 * ════════════════════════════════════════════════
 * FILE: conversation-creation-worker-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps desktop inbox creation on the capability-checked, atomic Worker path.
 *   Creating the conversation and its recipient in separate browser writes can
 *   leave a partial thread if the second request fails.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  src/pages/Conversations.jsx, src/lib/openInAppThread.js
 *   Data:      reads → source files; writes → none
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(path.join(ROOT, 'src/pages/Conversations.jsx'), 'utf8');

describe('desktop conversation creation worker contract', () => {
  it('uses the atomic worker helper and never browser-inserts conversations or recipients', () => {
    expect(source).toContain("import { resolveConversationId } from '@/lib/openInAppThread'");
    expect(source).toContain('await resolveConversationId(targetContactId)');
    expect(source).toContain('await resolveConversationId(contact.id)');
    expect(source).toContain('await loadConversations({ silent: true })');
    expect(source).toContain('Created conversation was not returned by the inbox refresh');
    expect(source).not.toMatch(/db\.insert\(\s*['"]conversations['"]/);
    expect(source).not.toMatch(/db\.insert\(\s*['"]conversation_participants['"]/);
  });

  it('uses the bounded Worker picker instead of downloading the contact directory', () => {
    expect(source).toContain('`/api/message-conversations?q=${encodeURIComponent(query)}`');
    expect(source).toContain('query.length < 2');
    expect(source).toContain('setContacts([])');
    expect(source).toContain('setContactSearchRetry((current) => current + 1)');
    expect(source).not.toMatch(/db\.select\(\s*['"]contacts['"]/);
    expect(source).not.toContain('select=id,name,phone,email,company,role');
  });
});
