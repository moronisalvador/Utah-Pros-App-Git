/**
 * ════════════════════════════════════════════════
 * FILE: conversation-access-lease.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a private chat disappears after the app can no longer confirm
 *   the employee still belongs to it. On the desktop screen an expired-but-
 *   unproven chat hides its messages, keeps the saved draft and the open thread's
 *   address, and comes back once access is re-confirmed; the draft is erased only
 *   when access is actually denied. The phone screen still erases both at expiry.
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
 *   - The desktop rules are pinned as SOURCE TEXT, not executed behavior, because
 *     the whole lease/purge/revoke path is inline in a 2,100-line component whose
 *     import graph builds a Supabase client at module scope — rendering it in a
 *     test needs a harness this file does not own. So these prove INTENT. The
 *     effect proof is the minimize test run by a human against a signed-in
 *     session; do not describe them as more than that.
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
    // The genuine failure path still revokes after the probe actually runs.
    expect(revalidate).toContain('await activeConversationQuery.refetch()');
    expect(revalidate).toMatch(
      /if \(!result\.isSuccess && !accessLeaseIsFresh\(result\.data\?\.actorAccessVerifiedAt\)\)\s*\{\s*revokeConversationAccess\(activeId\);/,
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

  // 2026-08-14 regression, the desktop twin of the tech-pane one fixed the same
  // day on claude/loving-allen-9a4dcb. Hiding the browser tab for 30s+ aged out
  // every conversation lease, and the resume sweep ran the DENIAL path on all of
  // them: clearDraft erased every half-typed reply, and the open thread lost its
  // ?c= and dumped the user back on the list. Nothing had been denied — a clock
  // had ticked. Violates page-lifecycle.md's minimize test (no route loss, no
  // lost form input) on a screen office staff keep open all day.
  it('expiry hides and re-proves on desktop; only a denial destroys the draft and route', () => {
    // The two halves are separate functions so neither path can drift into the
    // other: hide = server-owned content, revoke = hide + destroy the user's work.
    expect(desktopInbox).toContain('const hideConversationAccess = useCallback(');
    expect(desktopInbox).toContain('const expireConversationAccess = useCallback(');

    const hide = desktopInbox.slice(
      desktopInbox.indexOf('const hideConversationAccess = useCallback('),
      desktopInbox.indexOf('const expireConversationAccess = useCallback('),
    );
    expect(hide).toBeTruthy();
    // Protected server content still leaves the screen at expiry, exactly as before.
    expect(hide).toContain('setActiveAccessAuthorized(false)');
    expect(hide).toContain('setMessages([])');
    expect(hide).toContain("queryClient.removeQueries({ queryKey: ['message-author-directory'] })");
    expect(hide).toContain("query.queryKey?.[0] === 'conversation-members'");
    // …but the employee's own unsent work and the route survive it. These four are
    // the whole defect: each one, in the expiry path, is silent data loss.
    expect(hide).not.toContain('clearDraft(');
    expect(hide).not.toContain('setSearchParams(');
    expect(hide).not.toContain('clearAttachments()');
    expect(hide).not.toContain('setActiveId(null)');
    expect(hide).not.toContain('emitToast(');

    // Expiry is hide-only. A stale lease entry is deliberately NOT deleted here:
    // revokeConversationsOmittedFromProof enumerates lease keys, so dropping it
    // would strand the parked draft where no later denial could ever reach it.
    const expire = desktopInbox.slice(
      desktopInbox.indexOf('const expireConversationAccess = useCallback('),
      desktopInbox.indexOf('const revokeConversationAccess = useCallback('),
    );
    expect(expire).toContain('hideConversationAccess(conversationId)');
    expect(expire).not.toContain('conversationAccessLeasesRef.current.delete(');
    expect(expire).not.toContain('clearDraft(');

    // Denial is unchanged: it destroys the draft, the route and the open thread.
    const revoke = desktopInbox.slice(
      desktopInbox.indexOf('const revokeConversationAccess = useCallback('),
      desktopInbox.indexOf('const restoreAuthorizedDraft = useCallback('),
    );
    expect(revoke).toContain('clearDraft(conversationId)');
    expect(revoke).toContain('conversationAccessLeasesRef.current.delete(conversationId)');
    expect(revoke).toContain('hideConversationAccess(conversationId)');
    expect(revoke).toContain('setActiveId(null)');
    expect(revoke).toContain("if (next.get('c') === conversationId) next.delete('c')");
    expect(revoke).toContain("emitToast('You no longer have access to this chat', 'info')");

    // The resume/expiry sweep must call the hiding path, never the destroying one.
    const purge = desktopInbox.slice(
      desktopInbox.indexOf('const purgeExpiredConversationAccess = useCallback('),
      desktopInbox.indexOf('// ─── SECTION: Data fetching'),
    );
    expect(purge).toContain('expireConversationAccess(conversationId)');
    expect(purge).not.toContain('revokeConversationAccess(');
    // The exact call that erased every draft on a 30s tab-hide.
    expect(desktopInbox).not.toContain(
      'revokeConversationAccess(conversationId, { announce: false })',
    );
    // The sweep still runs synchronously before any resume I/O can be created.
    expect(desktopInbox).toContain('purgeExpired: purgeExpiredConversationAccess');

    // The 5s active-thread poll expires-and-re-proves on the same tick instead of
    // revoking and returning early.
    expect(desktopInbox).toMatch(
      /if \(!conversationAccessLeaseIsFresh\(verifiedAt\)\) \{[\s\S]*?expireConversationAccess\(activeId\);\s*\}\s*\}\s*loadConversations\(\{ silent: true \}\);/,
    );

    // Restoring the thread: a re-proof authorizes it and puts the draft back. The
    // post-commit effect is load-bearing — loadConversations' own restore call
    // runs while the composer is unmounted and composeRef is null.
    expect(desktopInbox).toContain('restoreAuthorizedDraft(openConversationId)');
    expect(desktopInbox).toMatch(
      /useEffect\(\(\) => \{\s*if \(!activeId \|\| !activeAccessAuthorized\) return;\s*restoreAuthorizedDraft\(activeId\);/,
    );
  });

  // The proven-denial paths are the reason expiry may be lenient: real
  // authorization loss still reaches revokeConversationAccess on every route.
  it('keeps every proven-denial path on desktop destroying exactly as before', () => {
    // A successful refresh that omits a cached/leased row is a server verdict.
    expect(desktopInbox).toContain('revokeConversationsOmittedFromProof({');
    expect(desktopInbox).toMatch(
      /onRevoke: \(conversationId\) => \{\s*revokeConversationAccess\(conversationId, \{\s*announce: conversationId === openBeforeRefresh,/,
    );
    // …as is a successful refresh that omits the OPEN thread.
    expect(desktopInbox).toMatch(
      /&& !hasConversationAccess\(data, openConversationId\)\s*\)\s*\{\s*revokeConversationAccess\(openConversationId\);/,
    );
    // 401/403 anywhere is immediate proof of loss, not a clock event. Count them
    // so a future refactor cannot quietly demote one to the expiry path.
    const deniedRevokes = desktopInbox.match(
      /status === 401[\s\S]{0,120}?revokeConversationAccess\(/g,
    ) || [];
    expect(deniedRevokes.length).toBeGreaterThanOrEqual(6);
    // Leaving a conversation deliberately still revokes.
    expect(desktopInbox).toContain('onLeft={(conversationId) => revokeConversationAccess(');
  });
});
