/**
 * ════════════════════════════════════════════════
 * FILE: scheduled-message-rpc-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the scheduled-message screens ask the database to make or
 *   cancel a message on behalf of the signed-in person. It keeps those checks
 *   in one protected place instead of letting a browser change the records.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  Conversations.jsx, DevTools.jsx
 *   Data:      reads  → source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source contract. Database authorization and idempotency are
 *     covered by the paired RPC migration tests.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const conversations = read('src/pages/Conversations.jsx');
const devTools = read('src/pages/DevTools.jsx');

describe('scheduled-message browser boundary', () => {
  it('creates a scheduled message through the actor-derived RPC with one stable operation id', () => {
    expect(conversations).toContain('const scheduledOperation = getScheduledMessageOperation(');
    expect(conversations).toContain('scheduledMessageOperationsRef.current,');
    expect(conversations).toContain('{ ownerLease: pwaOwnerLease },');
    expect(conversations).toContain("db.rpc('create_scheduled_message', {");
    expect(conversations).toContain('p_id: scheduledOperation.id,');
    expect(conversations).toContain('p_conversation_id: activeId,');
    expect(conversations).toContain('p_body: text,');
    expect(conversations).toContain('p_send_at: sendAt,');
    expect(conversations.indexOf('const scheduledOperation = getScheduledMessageOperation('))
      .toBeLessThan(conversations.indexOf("db.rpc('create_scheduled_message'"));
    expect(conversations).toContain('clearScheduledMessageOperation(');
    expect(conversations).toContain('if (scheduleSendingRef.current) return;');
  });

  it('cancels only through the actor-derived RPC and recognizes explicit success', () => {
    expect(devTools).toContain("db.rpc('cancel_scheduled_message', { p_id: item.id })");
    expect(devTools).toContain('if (cancelled === true) {');
    expect(devTools).toContain("toast('Message was not cancelled. The queue has been refreshed.', 'warning');");
    expect(devTools).toContain('await load({ silent: true });');
    expect(devTools).toContain('const silent = options?.silent === true;');
    expect(devTools).toContain('if (!silent) setLoading(true);');
  });

  it('contains no browser-side scheduled-message table insert or update', () => {
    const source = `${conversations}\n${devTools}`;
    expect(source).not.toMatch(/(?:db\.)?(?:insert|update)\(\s*['"]scheduled_messages['"]/);
  });
});
