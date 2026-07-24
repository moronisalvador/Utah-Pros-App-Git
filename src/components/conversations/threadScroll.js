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

/**
 * Merge a refreshed newest page into an already-rendered ascending thread without
 * discarding older loaded history or unresolved optimistic bubbles.
 */
export function mergeNewestMessages(currentMessages, newestMessages) {
  const current = Array.isArray(currentMessages) ? currentMessages : [];
  const newest = Array.isArray(newestMessages) ? newestMessages : [];
  const newestById = new Map(newest.filter((message) => message?.id).map((message) => [message.id, message]));
  const newestBodies = new Set(newest.map((message) => `${message.type}::${message.body || ''}`));

  const retained = current
    .filter((message) => {
      if (message?.id && newestById.has(message.id)) return true;
      return !((message?._pending || message?._failed)
        && newestBodies.has(`${message.type}::${message.body || ''}`));
    })
    .map((message) => newestById.get(message?.id) || message);
  const currentIds = new Set(retained.map((message) => message?.id).filter(Boolean));
  const additions = newest.filter((message) => !message?.id || !currentIds.has(message.id));

  return [...retained, ...additions].sort((a, b) => {
    const aTime = new Date(a?.created_at || 0).getTime();
    const bTime = new Date(b?.created_at || 0).getTime();
    return aTime - bTime;
  });
}
