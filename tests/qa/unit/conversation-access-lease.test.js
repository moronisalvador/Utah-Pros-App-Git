/**
 * ════════════════════════════════════════════════
 * FILE: conversation-access-lease.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a private chat disappears after the app can no longer confirm
 *   the employee still belongs to it. It also checks that the phone and desktop
 *   screens both erase the open messages and saved draft after that short window.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  conversationAccessState.js, TechMessagesV2.jsx, Conversations.jsx
 *   Data:      reads  → source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This models expiry and protects source wiring; real background/resume
 *     behavior still needs simulator or device verification.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONVERSATION_ACCESS_LEASE_MS,
  conversationAccessLeaseIsFresh,
} from '../../../src/components/conversations/conversationAccessState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

const nativeInbox = read('src/pages/tech/v2/TechMessagesV2.jsx');
const nativeAccess = read('src/pages/tech/v2/messages/accessRevocation.js');
const desktopInbox = read('src/pages/Conversations.jsx');

describe('conversation access lease', () => {
  it('models authorized open → offline/removal → expiry/resume as no remaining authorization', () => {
    const authorizedAt = 1_000_000;
    expect(conversationAccessLeaseIsFresh(authorizedAt, authorizedAt + 1)).toBe(true);
    // An offline probe cannot renew a lease: only a successful membership response can.
    expect(conversationAccessLeaseIsFresh(
      authorizedAt,
      authorizedAt + CONVERSATION_ACCESS_LEASE_MS,
    )).toBe(false);
  });

  it('requires a current actor-scoped mobile probe before rendering and purges expired drafts', () => {
    expect(nativeAccess).toContain("db.rpc('get_tech_conversations'");
    expect(nativeAccess).toContain("db.rpc('get_my_conversation_access_snapshot'");
    expect(nativeAccess).toContain('runConversationAccessProbe');
    expect(nativeAccess).toContain('p_conversation_id: conversationId');
    expect(nativeAccess).toContain('revalidateAllCachedAccess');
    expect(nativeAccess).toContain('recordConversationAccessDenied');
    expect(nativeAccess).toContain('accessProofExpired: true');
    expect(nativeAccess).toContain('reconcileAccessibleConversations');
    expect(nativeAccess).not.toContain(
      "cachedTechConversationIds(queryClient)\n    .filter((conversationId) => !authorizedIds.has(conversationId))",
    );
    expect(nativeInbox).toContain('loadTechConversationAccess');
    expect(nativeInbox).toContain('actorAccessVerifiedAt');
    expect(nativeInbox).toContain('hasActiveAccessLease');
    expect(nativeInbox).toContain('purgeConversationAccess(queryClient, conversationId)');
    expect(nativeInbox).toContain('pollMs: 5_000');
  });

  it('fails closed for cached tech inbox rows after their 30s actor-scoped lease', () => {
    const techInbox = read('src/pages/tech/v2/messages/useTechConversations.js');
    const techRow = read('src/pages/tech/v2/messages/ConvoRow.jsx');

    expect(techInbox).toContain('REFETCH_MS = 15_000');
    expect(techInbox).toContain('loadTechConversationInboxAccess');
    expect(techInbox).toContain('scheduleConversationAccessExpiry');
    expect(techInbox).toContain('purgeExpiredConversationInboxAccess(queryClient, {');
    expect(techInbox).toContain('revalidateConversationAccessAfterResume');
    expect(techInbox).toContain('revalidateAllCachedAccess: filterKey === null');
    expect(techInbox).toContain('techConversationInboxAccessError(query.data, query.error)');
    expect(techInbox).toContain('enabled,');
    expect(techRow).toContain('conversationAccessLeaseIsFresh(conv?.accessLeaseVerifiedAt)');
  });

  it('covers desktop thread/realtime work until current access succeeds and purges on expiry', () => {
    expect(desktopInbox).toContain('setActiveAccessAuthorized(hasFreshAccessLease)');
    expect(desktopInbox).toContain('if (!activeId || !activeAccessAuthorized)');
    expect(desktopInbox).toContain('clearDraft(conversationId)');
    expect(desktopInbox).toContain('conversationAccessLeaseIsFresh(verifiedAt)');
    expect(desktopInbox).toContain('runConversationAccessProbe');
    expect(desktopInbox).toContain('createConversationAccessRequestGuard');
    expect(desktopInbox).toContain('if (proof.superseded)');
    expect(desktopInbox).toContain('revalidateConversationAccessAfterResume');
    expect(desktopInbox).toContain('purgeExpired: purgeExpiredConversationAccess');
    expect(desktopInbox).toContain('!activeAccessAuthorized || !activeConv');
    expect(desktopInbox).toContain('restoreAuthorizedDraft(openConversationId)');
    expect(desktopInbox).toContain('accessProofUnverified && loadError');
    expect(desktopInbox).toContain('setAccessProofUnverified(false)');
    expect(desktopInbox).toContain('conversationInboxAccessVerifiedAtRef');
    expect(desktopInbox.indexOf('accessProofUnverified && loadError'))
      .toBeLessThan(desktopInbox.indexOf('filtered.length === 0'));
  });
});
