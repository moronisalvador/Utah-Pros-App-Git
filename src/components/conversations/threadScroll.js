/**
 * Keep a conversation pinned after delayed content (normally an attachment image)
 * changes the thread height. The caller owns the user's near-bottom state and the
 * load-earlier anchor; this helper deliberately refuses to override either signal.
 */
export function repinThreadAfterLayout({ scrollElement, wasAtBottom, isPrepending }) {
  if (!scrollElement || !wasAtBottom || isPrepending) return false;
  scrollElement.scrollTop = scrollElement.scrollHeight;
  return true;
}

/**
 * Remember the first message that currently intersects the scroller. Holding the
 * element itself is intentional: keyed message rows survive a history prepend, so
 * the same visual item can be restored without deriving or escaping a message id.
 */
export function captureVisibleMessageAnchor(scrollElement) {
  if (!scrollElement?.querySelectorAll || !scrollElement?.getBoundingClientRect) return null;
  const scrollerTop = scrollElement.getBoundingClientRect().top;
  const messages = scrollElement.querySelectorAll('[data-msg-id]');
  for (const element of messages) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom > scrollerTop) return { element, offset: rect.top - scrollerTop };
  }
  return null;
}

/**
 * Restore a previously captured message to its prior viewport offset. A layout
 * change below the anchor produces a zero delta; a delayed image above it adjusts
 * scrollTop by exactly the added height.
 */
export function restoreVisibleMessageAnchor(scrollElement, anchor) {
  if (
    !scrollElement?.getBoundingClientRect
    || !anchor?.element?.getBoundingClientRect
    || (scrollElement.contains && !scrollElement.contains(anchor.element))
  ) return false;

  const scrollerTop = scrollElement.getBoundingClientRect().top;
  const nextOffset = anchor.element.getBoundingClientRect().top - scrollerTop;
  const delta = nextOffset - anchor.offset;
  if (Math.abs(delta) > 0.5) scrollElement.scrollTop += delta;
  return true;
}

const RECONCILE_WINDOW_MS = 10 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 1000;

function normalizedMedia(mediaUrls) {
  let values = mediaUrls;
  if (typeof values === 'string') {
    try { values = JSON.parse(values); } catch { values = [values]; }
  }
  if (!Array.isArray(values)) values = values ? [values] : [];
  return values.map(String).sort();
}

function messageContentKey(message) {
  return `${message?.type}::${message?.body || ''}::${JSON.stringify(normalizedMedia(message?.media_urls))}`;
}

function isBoundedFallbackMatch(confirmed, optimistic) {
  if (messageContentKey(confirmed) !== messageContentKey(optimistic)) return false;
  const confirmedTime = new Date(confirmed?.created_at || '').getTime();
  const optimisticTime = new Date(optimistic?.created_at || '').getTime();
  return Number.isFinite(confirmedTime)
    && Number.isFinite(optimisticTime)
    && confirmedTime >= optimisticTime - CLOCK_SKEW_TOLERANCE_MS
    && confirmedTime - optimisticTime <= RECONCILE_WINDOW_MS;
}

/** Find the one optimistic row confirmed by a canonical message. */
export function findOptimisticMessageMatchIndex(messages, confirmed, excluded = new Set()) {
  const rows = Array.isArray(messages) ? messages : [];
  const eligible = (message, index) =>
    !excluded.has(index) && (message?._pending || message?._failed);
  const exactId = rows.findIndex((message, index) =>
    eligible(message, index) && message?.id === confirmed?.id);
  if (exactId >= 0) return exactId;
  if (confirmed?.client_request_id) {
    return rows.findIndex((message, index) =>
      eligible(message, index) && message?._clientId === confirmed.client_request_id);
  }
  return rows.findIndex((message, index) =>
    eligible(message, index) && isBoundedFallbackMatch(confirmed, message));
}

/**
 * Merge a refreshed newest page into an already-rendered ascending thread without
 * discarding older loaded history or unresolved optimistic bubbles.
 */
export function mergeNewestMessages(currentMessages, newestMessages) {
  const current = Array.isArray(currentMessages) ? currentMessages : [];
  const newest = Array.isArray(newestMessages) ? newestMessages : [];
  const newestById = new Map(newest.filter((message) => message?.id).map((message) => [message.id, message]));
  const currentCanonicalIds = new Set(current
    .filter((message) => !message?._pending && !message?._failed)
    .map((message) => message?.id)
    .filter(Boolean));
  const confirmations = newest.filter((message) =>
    !message?.id || !currentCanonicalIds.has(message.id));
  const matchedCurrentIndexes = new Set();

  // Reserve all durable matches first so an out-of-order confirmation for send B
  // cannot be consumed by identical send A's legacy content fallback.
  confirmations
    .filter((message) => message?.client_request_id)
    .forEach((message) => {
      const index = findOptimisticMessageMatchIndex(current, message, matchedCurrentIndexes);
      if (index >= 0) matchedCurrentIndexes.add(index);
    });
  confirmations
    .filter((message) => !message?.client_request_id)
    .forEach((message) => {
      const index = findOptimisticMessageMatchIndex(current, message, matchedCurrentIndexes);
      if (index >= 0) matchedCurrentIndexes.add(index);
    });

  const retained = current
    .filter((_, index) => !matchedCurrentIndexes.has(index))
    .map((message) => newestById.get(message?.id) || message);
  const currentIds = new Set(retained.map((message) => message?.id).filter(Boolean));
  const additions = newest.filter((message) => !message?.id || !currentIds.has(message.id));

  return [...retained, ...additions].sort((a, b) => {
    const aTime = new Date(a?.created_at || 0).getTime();
    const bTime = new Date(b?.created_at || 0).getTime();
    return aTime - bTime;
  });
}

/**
 * Count canonical messages appended after the previously rendered tail. If that
 * tail is no longer present (for example after a bounded resume refresh), return
 * one so the UI still advertises new activity without inventing a larger count.
 */
export function countNewCanonicalMessages(messages, previousLastId) {
  const rows = Array.isArray(messages) ? messages : [];
  const previousIndex = rows.findIndex((message) => message?.id === previousLastId);
  if (!previousLastId || previousIndex < 0) return 1;
  const count = rows
    .slice(previousIndex + 1)
    .filter((message) => message?.id && !message?._pending && !message?._failed)
    .length;
  return Math.max(1, count);
}
