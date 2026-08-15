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
 *   Internal:  conversationAccessState.js (imported), plus source read as text:
 *              TechMessagesV2.jsx, accessRevocation.js, Conversations.jsx,
 *              useTechConversations.js, ConvoRow.jsx, ConvoList.jsx
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
