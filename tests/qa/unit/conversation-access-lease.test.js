/**
 * ════════════════════════════════════════════════
 * FILE: conversation-access-lease.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a private chat disappears after the app can no longer confirm
 *   the employee still belongs to it. On the phone screen an expired-but-
 *   unproven chat hides its messages, keeps the saved draft, and comes back
 *   once access is re-confirmed; the draft is erased only when access is
 *   actually denied. The desktop screen still erases both at expiry.
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

  it('requires a current actor-scoped mobile probe before rendering a thread', () => {
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

  // 2026-08-04 regression. Tapping a message push opened the conversation LIST,
  // never the thread. Cause: revalidateActiveAccess treated "not proven yet" as
  // "proof expired". A deep link arrives with a brand-new activeId and no lease,
  // and resuming from the background fires the same tick, so it revoked and
  // deleted ?c= before the probe could ever run. Reproduced for an admin with
  // full access, which is why this is a lease-timing bug, not authorization.
  it('never revokes a deep link that has no lease YET — only one that expired', () => {
    const start = nativeInbox.indexOf('const revalidateActiveAccess');
    expect(start).toBeGreaterThan(-1);
    // End at the callback's own dependency array, not at `useResumeRefetch`
    // (which also appears earlier in the import list).
    const revalidate = nativeInbox.slice(
      start,
      nativeInbox.indexOf('}, [accessLeaseIsFresh,', start),
    );
    expect(revalidate).toBeTruthy();

    // The early offline purge must be conditional on a lease having existed.
    expect(revalidate).toMatch(
      /const provenAt = activeConversationQuery\.data\?\.actorAccessVerifiedAt;/,
    );
    expect(revalidate).toMatch(
      /if \(provenAt && !accessLeaseIsFresh\(provenAt\)\)\s*\{/,
    );
    // The unconditional form is what caused the bug — it must not come back.
    expect(revalidate).not.toMatch(/if \(!accessLeaseIsFresh\(\)\)\s*\{/);

    // Nothing sensitive leaks by waiting: the thread only renders behind a
    // fresh lease, so with no lease there is nothing on screen to purge.
    expect(nativeInbox).toMatch(
      /const threadOpen = newConversationOpen \|\| Boolean\(activeId && activeConv && hasActiveAccessLease\)/,
    );
    // The genuine denial path still revokes after the probe actually runs —
    // but ONLY on a proven denial (401/403); a network failure keeps the
    // hidden thread parked behind ?c= for the interval to re-prove.
    expect(revalidate).toContain('await activeConversationQuery.refetch()');
    expect(revalidate).toMatch(
      /if \(!result\.isSuccess && isConversationAccessDenied\(result\.error\)\)\s*\{\s*revokeConversationAccess\(activeId\);/,
    );
  });

  // 2026-08-14 regression. Backgrounding the app past the 30s lease, then
  // resuming, exited the open thread to the LIST and destroyed the localStorage
  // draft (reproduced twice on the iOS 26.3 simulator; deterministic from the
  // code). Two destroyers, both clock-driven: the suspended lease timer fired
  // the DENIAL purge on resume, and revalidateActiveAccess revoked — stripping
  // ?c= — without ever re-probing. Expiry must hide-and-re-prove; only a proven
  // denial may destroy the draft or the route.
  it('resume after lease expiry re-proves and restores instead of destroying', () => {
    // The lease timer, the resume sweep, and the slow-probe path all record
    // EXPIRED (draft preserved, tombstone marked), never DENIED.
    expect(nativeAccess).toContain('export function recordConversationAccessExpired');
    expect(nativeAccess).toContain('preserveDraft: true');
    expect(nativeAccess).toMatch(
      /onExpire: \(\) => \{[\s\S]*?recordConversationAccessExpired\(\{/,
    );
    // The genuine denial paths (snapshot omission / no-row probe) still destroy.
    expect(nativeAccess).toMatch(
      /if \(!snapshotAuthorizedIds\.has\(conversationId\)\) \{\s*recordConversationAccessDenied\(\{/,
    );
    // The resume revalidator hides expired content without revoking the route…
    const start = nativeInbox.indexOf('const revalidateActiveAccess');
    const revalidate = nativeInbox.slice(
      start,
      nativeInbox.indexOf('}, [accessLeaseIsFresh,', start),
    );
    expect(revalidate).toMatch(
      /if \(provenAt && !accessLeaseIsFresh\(provenAt\)\)\s*\{[\s\S]*?recordConversationAccessExpired\(\{/,
    );
    expect(revalidate).not.toMatch(
      /if \(provenAt && !accessLeaseIsFresh\(provenAt\)\)\s*\{(\s*\/\/[^\n]*\n)*\s*revokeConversationAccess/,
    );
    // …and the pane treats an expired tombstone as "re-prove", never "denied".
    expect(nativeInbox).toContain(
      'if (activeConversationQuery.data?.accessProofExpired) return undefined;',
    );
  });

  it('treats a missing verifiedAt as not-fresh, which is why the guard above matters', () => {
    // conversationAccessLeaseIsFresh(undefined) === false is correct on its own;
    // the defect was calling it with no argument on a brand-new deep link.
    expect(conversationAccessLeaseIsFresh(undefined)).toBe(false);
    expect(conversationAccessLeaseIsFresh(null)).toBe(false);
    const now = 5_000_000;
    expect(conversationAccessLeaseIsFresh(now, now)).toBe(true);
    expect(conversationAccessLeaseIsFresh(now - CONVERSATION_ACCESS_LEASE_MS, now)).toBe(false);
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

  // 2026-08-04 regression. Backing out of a thread showed the ⚠️ "Couldn't load
  // conversations" failure state with a Retry button for several seconds before
  // the list appeared. Reading a thread for longer than the 30s lease expires the
  // INBOX proof, which purges the cached rows; ConvoList renders its error branch
  // on `error && conversations.length === 0`, and the purge waited out the 15s
  // poll before re-proving. Nothing had failed — the lease had simply aged out.
  it('reports an expiring inbox lease as loading, not as a failed load', () => {
    const techInbox = read('src/pages/tech/v2/messages/useTechConversations.js');

    // Expiry must re-prove immediately, not wait for the next scheduled poll.
    expect(techInbox).toMatch(
      /onExpire: \(\) => \{\s*purgeExpiredInbox\(\);[\s\S]*?refetchInbox\(\);/,
    );

    // While that revalidation is in flight the list reports loading, and the
    // synthetic access error is withheld — a real query error is not.
    expect(techInbox).toContain(
      'const reProvingAccess = !hasFreshInboxAccessLease && query.isFetching && !query.error;',
    );
    expect(techInbox).toContain('isColdStart: query.isPending || reProvingAccess');
    expect(techInbox).toContain(
      'error: reProvingAccess ? null : techConversationInboxAccessError(query.data, query.error)',
    );

    // Fail-closed is unchanged: rows still require a fresh lease.
    expect(techInbox).toContain(
      'const data = hasFreshInboxAccessLease ? (query.data || EMPTY) : EMPTY;',
    );

    // The error branch it feeds still keys on an empty list, so suppressing the
    // synthetic error is what stops the false failure UI.
    const convoList = read('src/pages/tech/v2/messages/ConvoList.jsx');
    expect(convoList).toContain('error && conversations.length === 0');
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
