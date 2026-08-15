/**
 * ════════════════════════════════════════════════
 * FILE: conversation-access-lease.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a private chat disappears after the app can no longer confirm
 *   the employee still belongs to it. On BOTH the phone and the desktop screen an
 *   expired-but-unproven chat hides its messages, keeps the saved draft and the
 *   open thread's address, and comes back once access is re-confirmed; the draft
 *   is erased only when access is actually denied.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  conversationAccessState.js (imported), plus source read as text:
 *              TechMessagesV2.jsx, accessRevocation.js, Conversations.jsx,
 *              useTechConversations.js, ConvoRow.jsx, ConvoList.jsx
 *   Data:      reads  → source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This models expiry and protects source wiring; real background/resume
 *     behavior still needs simulator or device verification.
 *   - Two kinds of proof, deliberately. The "sweep policy (executed)" block RUNS
 *     the real decision — which conversations expire, and that expiry never
 *     reaches the destroying callback — because that policy was lifted out of the
 *     page into conversationAccessState.js for exactly this reason. The remaining
 *     desktop cases match SOURCE TEXT and prove WIRING, not behavior.
 *   - The desktop behavior itself IS now executed, in
 *     src/pages/Conversations.resume.render.test.jsx, which mounts the page and
 *     runs a real hidden→visible cycle past the lease. That test exists because
 *     the source pins below all kept passing while resume still stranded a
 *     spinner and jumped the scroll — the tokens they look for were present the
 *     whole time. Add behavior there, not here.
 *   - Neither replaces the human minimize test against a signed-in session.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONVERSATION_ACCESS_LEASE_MS,
  conversationAccessLeaseIsFresh,
  expireStaleConversationAccessLeases,
  revokeConversationsOmittedFromProof,
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
    expect(nativeAccess).toContain('preserveComposerWork: true');
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

  // 2026-08-14, the other half of the same resume. A tech who lined up a PHOTO, was
  // pulled away for 35s and came back found the tray empty and the already-finished
  // upload orphaned — ThreadView remounts on the hide-and-re-prove cycle and the
  // composer hook revoked its object-URL previews on the way out.
  it('spares the staged photo tray on expiry as one decision with the draft', () => {
    // ONE flag covers both halves of the composer's own unfinished reply. Two
    // branches nearly shipped two flags for this on the same day; a second name
    // reappearing here means they drifted apart again.
    expect(nativeAccess).toContain('preserveComposerWork');
    expect(nativeAccess).not.toMatch(/\bpreserveDraft\b/);
    expect(nativeAccess).toMatch(
      /if \(!preserveComposerWork\) \{\s*clearDraft\(conversationId\);\s*discardStagedAttachments\(conversationId\);/,
    );

    // The tray is memory-only: a customer's photo under an active claim must never
    // reach disk. Comments are stripped first — the file states the rule in prose,
    // and this has to assert on the code rather than on the promise.
    const store = read('src/pages/tech/v2/messages/composerAttachmentStore.js');
    const storeCode = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(storeCode).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    // An account change still destroys every tray.
    expect(storeCode).toContain('registerTechQueryAccountGenerationListener');

    // The hook must not revoke on unmount — that cleanup IS the bug.
    const composerHook = read('src/pages/tech/v2/messages/useComposerAttachments.js');
    expect(composerHook).toContain('useSyncExternalStore');
    expect(composerHook).not.toMatch(/revokeObjectURL/);
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
  // EXECUTED, not matched. The reviewer finding on #645 slipped past a file that
  // only regex-matched source, so the desktop sweep policy was lifted out of the
  // page into conversationAccessState.js and is run here for real. These cases
  // fail if the two callbacks are ever collapsed back into one — which is exactly
  // how expiry became revocation in the first place.
  describe('the sweep policy itself (executed)', () => {
    const FRESH = 'fresh-id';
    const STALE = 'stale-id';
    const now = 10_000_000;
    const staleAt = now - CONVERSATION_ACCESS_LEASE_MS - 1;
    const freshAt = now - 1_000;

    it('hands ONLY stale leases to onExpire, and never touches a fresh one', () => {
      const expired = [];
      const returned = expireStaleConversationAccessLeases({
        cachedConversationIds: [FRESH, STALE],
        leases: new Map([[FRESH, freshAt], [STALE, staleAt]]),
        now,
        onExpire: (id) => expired.push(id),
      });
      expect(expired).toEqual([STALE]);
      expect(returned).toEqual([STALE]);
    });

    it('treats an id with no lease at all as expired, never as allowed', () => {
      const expired = [];
      expireStaleConversationAccessLeases({
        cachedConversationIds: ['orphan-draft-id'],
        leases: new Map(),
        now,
        onExpire: (id) => expired.push(id),
      });
      expect(expired).toEqual(['orphan-draft-id']);
    });

    it('expires an id exactly ON the boundary and de-duplicates repeats', () => {
      const expired = [];
      expireStaleConversationAccessLeases({
        // The same id reachable from both the row list and the lease map.
        cachedConversationIds: [STALE, STALE, null, undefined],
        leases: new Map([[STALE, now - CONVERSATION_ACCESS_LEASE_MS]]),
        now,
        onExpire: (id) => expired.push(id),
      });
      expect(expired).toEqual([STALE]);
    });

    // THE SECURITY BAR, both directions, on the same conversation. Expiry alone
    // must never reach the destroying callback; a successful refresh that omits
    // the row must reach it even though the row is already hidden.
    it('separates expiry from denial: a stale row hides, an omitted row revokes', () => {
      const expired = [];
      const revoked = [];
      const leases = new Map([[STALE, staleAt]]);

      expireStaleConversationAccessLeases({
        cachedConversationIds: [STALE],
        leases,
        now,
        onExpire: (id) => expired.push(id),
      });
      expect(expired).toEqual([STALE]);
      expect(revoked, 'a clock tick must not destroy anything').toEqual([]);

      // The page deliberately KEEPS the stale lease entry after hiding, which is
      // what leaves the parked draft reachable by a later real denial. If expiry
      // deleted it, this second sweep would find nothing and the draft would be
      // stranded forever.
      revokeConversationsOmittedFromProof({
        cachedConversations: [],
        authorizedConversations: [],
        leasedConversationIds: leases.keys(),
        onRevoke: (id) => revoked.push(id),
      });
      expect(revoked, 'a proven omission must still destroy').toEqual([STALE]);
    });

    it('a refresh that still lists the row revokes nothing', () => {
      const revoked = [];
      revokeConversationsOmittedFromProof({
        cachedConversations: [{ id: STALE }],
        authorizedConversations: [{ id: STALE }],
        leasedConversationIds: [STALE],
        onRevoke: (id) => revoked.push(id),
      });
      expect(revoked).toEqual([]);
    });
  });

  it('expiry hides and re-proves on desktop; only a denial destroys the draft and route', () => {
    // The two halves are separate functions so neither path can drift into the
    // other: hide = server-owned content, revoke = hide + destroy the user's work.
    expect(desktopInbox).toContain('const hideConversationAccess = useCallback(');
    expect(desktopInbox).toContain('const recordConversationAccessExpired = useCallback(');

    const hide = desktopInbox.slice(
      desktopInbox.indexOf('const hideConversationAccess = useCallback('),
      desktopInbox.indexOf('const recordConversationAccessExpired = useCallback('),
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
      desktopInbox.indexOf('const recordConversationAccessExpired = useCallback('),
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
    // 'warning' keeps it amber; every type except error/warning renders GREEN,
    // so 'info' would announce lost access under a success toast.
    expect(revoke).toContain("emitToast('You no longer have access to this chat', 'warning')");
    expect(desktopInbox).not.toContain("emitToast('You no longer have access to this chat', 'info')");

    // The resume/expiry sweep must call the hiding path, never the destroying one.
    const purge = desktopInbox.slice(
      desktopInbox.indexOf('const purgeExpiredConversationAccess = useCallback('),
      desktopInbox.indexOf('// ─── SECTION: Data fetching'),
    );
    expect(purge).toContain('onExpire: recordConversationAccessExpired');
    expect(purge).toContain('expireStaleConversationAccessLeases({');
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
      /if \(!conversationAccessLeaseIsFresh\(verifiedAt\)\) \{[\s\S]*?recordConversationAccessExpired\(activeId\);\s*\}\s*\}\s*loadConversations\(\{ silent: true \}\);/,
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
  // A revocation that unmounts the open thread and strips ?c= must say why.
  // The whole reason it is safe to speak is that EXPIRY no longer reaches
  // revokeConversationAccess — if that ever regresses, this announcement fires
  // on every app resume past the 30s lease, which is the noise the fix avoided.
  describe('a proven denial announces; expiry and self-leave stay silent', () => {
    const threadView = read('src/pages/tech/v2/messages/ThreadView.jsx');
    const leaveButton = read('src/components/conversations/LeaveConversationButton.jsx');

    it('announces through lib/toast, never a raw upr:toast dispatch', () => {
      expect(nativeInbox).toContain("import { toast } from '@/lib/toast'");
      expect(nativeInbox).toContain(
        "toast('You no longer have access to this chat', 'warning')",
      );
      // AGENTS.md Rule 2: lib/toast is the ONLY entry point.
      expect(nativeInbox).not.toMatch(/dispatchEvent\(\s*new CustomEvent\(\s*'upr:toast'/);
    });

    it("uses 'warning', because every other type renders as a GREEN success toast", () => {
      // Both containers: type === 'error' ? red : type === 'warning' ? amber : GREEN.
      // So 'info'/'success' here would show "you lost access" under a ✅.
      for (const shell of ['src/components/TechLayout.jsx', 'src/components/Layout.jsx']) {
        const source = read(shell);
        expect(source).toContain("toast.type==='error' ? '#fef2f2' : toast.type==='warning'");
      }
      expect(nativeInbox).not.toContain(
        "toast('You no longer have access to this chat', 'info')",
      );
      // Not 'error' either — that takes role="alert" and interrupts, and losing
      // access is a state change, not a failure the tech caused.
      expect(nativeInbox).not.toContain(
        "err('You no longer have access to this chat')",
      );
    });

    it('keeps expiry on the silent path, so resume never toasts', () => {
      // revalidateActiveAccess records EXPIRED; it must not revoke on expiry.
      expect(nativeInbox).toContain('recordConversationAccessExpired({');
      // The tombstone effect bails out before the revoke when the mark is set.
      expect(nativeInbox).toContain(
        'if (activeConversationQuery.data?.accessProofExpired) return undefined;',
      );
      // And the expired purge itself preserves the composer work rather than
      // routing through the denial path.
      expect(nativeAccess).toContain('preserveComposerWork: true');
    });

    it('stays silent when the tech leaves deliberately (no contradicting double toast)', () => {
      expect(leaveButton).toContain("ok('You left this chat')");
      expect(threadView).toContain('onAccessRevoked(conversationId, { announce: false })');
    });

    it('announces by default, so every denial caller speaks without opting in', () => {
      // useThread's send/mark-read/resume denials call onAccessRevoked(convId)
      // with one argument — they must inherit announce: true.
      expect(nativeInbox).toContain(
        'const revokeConversationAccess = useCallback((conversationId, { announce = true } = {}) => {',
      );
      const useThread = read('src/pages/tech/v2/messages/useThread.js');
      expect(useThread).toContain('onAccessRevoked?.(convId);');
      expect(useThread).not.toContain('onAccessRevoked?.(convId, { announce: false });');
    });
  });
});
