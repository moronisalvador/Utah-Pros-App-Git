/**
 * ════════════════════════════════════════════════
 * FILE: composerAttachmentStore.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Remembers the photos a technician has lined up under the reply box, one set per
 *   conversation, for as long as the app is open. The messages screen closes and
 *   re-opens a thread on its own — for example after the phone has been put down for
 *   half a minute and the app has to re-check that the tech is still allowed in — and
 *   without this the lined-up photos would vanish even though they had usually already
 *   finished uploading. The set is thrown away the moment it is sent, the moment the
 *   tech genuinely loses access to that conversation, and whenever a different person
 *   signs in.
 *
 * WHERE IT LIVES:
 *   Exports:      readStagedAttachments, writeStagedAttachments, discardStagedAttachments,
 *                 discardAllStagedAttachments, subscribeStagedAttachments,
 *                 nextStagedAttachmentId, MAX_STAGED_CONVERSATIONS
 *   Consumed by:  ./useComposerAttachments (the tray itself),
 *                 ./accessRevocation (discards on genuine access denial)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/techQuery (account-generation listener only)
 *   Data:      reads  → none
 *              writes → none (memory only — never localStorage, never the network)
 *
 * NOTES / GOTCHAS:
 *   - MEMORY ONLY, deliberately. A staged photo is a customer's property under an
 *     active claim; its uploaded reference must never be written to disk where it
 *     would outlive the session or a sign-out. Nothing here touches localStorage.
 *   - This module is the SINGLE owner of every staged blob: object URLs are revoked
 *     here and nowhere else, exactly when a preview leaves a tray, so a preview can
 *     never be revoked twice and can never be revoked while its tile is still on
 *     screen. The hook deliberately does NOT revoke on unmount — that unmount is the
 *     very thing this store exists to survive.
 *   - Expired is not denied. A lease that merely aged out (the app was backgrounded)
 *     keeps the tray; only a proven denial or an account change destroys it. The tray
 *     is never rendered without a fresh access proof regardless, because the thread
 *     itself does not mount until access is re-proven.
 *   - Import direction is one-way: accessRevocation imports this file, never the
 *     reverse. Keep it that way — this module must stay free of React and of any
 *     messages-pane import so it cannot form a cycle.
 *   - IDs come from one module-level sequence, not a per-mount counter: a restored
 *     tray and a freshly picked photo would otherwise collide on the same React key.
 * ════════════════════════════════════════════════
 */
import { registerTechQueryAccountGenerationListener } from '@/lib/techQuery';

// A tray is at most MAX_MESSAGE_ATTACHMENTS photos, so this caps retained blobs at a
// handful. Without a bound, a tech who stages a photo in many threads without sending
// would hold every one of those images in memory for the life of the session.
export const MAX_STAGED_CONVERSATIONS = 8;

// Returned for every conversation with no tray. It must be one shared frozen value:
// useSyncExternalStore compares snapshots by identity and a fresh [] each call would
// spin forever.
const EMPTY = Object.freeze([]);

// convId → attachments array. Map iteration order is insertion order, which gives
// least-recently-written eviction for free (a write re-inserts at the end).
const trays = new Map();
const listeners = new Map(); // convId → Set<callback>

let attachmentSequence = 0;

export function nextStagedAttachmentId() {
  attachmentSequence += 1;
  return `att-${attachmentSequence}`;
}

function revokePreview(attachment) {
  const preview = attachment?.localPreview;
  if (!preview) return;
  try {
    URL.revokeObjectURL(preview);
  } catch {
    // A shell without object-URL support must not break staging.
  }
}

function notify(conversationId) {
  listeners.get(conversationId)?.forEach((callback) => {
    try {
      callback();
    } catch {
      // One stale subscriber must not strand the rest of the cleanup.
    }
  });
}

export function subscribeStagedAttachments(conversationId, callback) {
  if (!conversationId || typeof callback !== 'function') return () => {};
  let subscribers = listeners.get(conversationId);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(conversationId, subscribers);
  }
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) listeners.delete(conversationId);
  };
}

export function readStagedAttachments(conversationId) {
  if (!conversationId) return EMPTY;
  return trays.get(conversationId) || EMPTY;
}

// Evict least-recently-written trays beyond the cap. `keep` is the conversation just
// written; it was re-inserted last, so front-to-back eviction never reaches it.
function evictOverflow(keep) {
  while (trays.size > MAX_STAGED_CONVERSATIONS) {
    const oldest = trays.keys().next().value;
    if (oldest === undefined || oldest === keep) return;
    // Evict the whole tray rather than only its previews: a tile whose blob preview
    // was revoked renders broken, because the uploaded url is an opaque
    // upr-storage:// reference that no <img> can load.
    writeStagedAttachments(oldest, EMPTY);
  }
}

/**
 * Replace one conversation's tray. Any preview present before and absent after is
 * revoked here — this is the only revocation site in the app.
 */
export function writeStagedAttachments(conversationId, next) {
  if (!conversationId) return EMPTY;
  const previous = trays.get(conversationId) || EMPTY;
  const attachments = Array.isArray(next) ? next : EMPTY;

  const survivingPreviews = new Set(
    attachments.map((attachment) => attachment?.localPreview).filter(Boolean),
  );
  previous.forEach((attachment) => {
    if (attachment?.localPreview && !survivingPreviews.has(attachment.localPreview)) {
      revokePreview(attachment);
    }
  });

  trays.delete(conversationId);
  if (attachments.length > 0) {
    trays.set(conversationId, attachments);
    evictOverflow(conversationId);
  }
  notify(conversationId);
  return readStagedAttachments(conversationId);
}

/**
 * Destroy one conversation's staged work. Called when access is genuinely denied —
 * never on a lease that merely expired while the app was backgrounded.
 */
export function discardStagedAttachments(conversationId) {
  if (!conversationId || !trays.has(conversationId)) return;
  writeStagedAttachments(conversationId, EMPTY);
}

/** Destroy every staged tray — an account or sign-out boundary. */
export function discardAllStagedAttachments() {
  [...trays.keys()].forEach(discardStagedAttachments);
}

// A different employee must never inherit the previous one's staged photos, and the
// blobs of an ended session must not survive it. techQuery bumps its generation on
// every account transition; accessRevocation registers against the same signal.
registerTechQueryAccountGenerationListener(() => {
  discardAllStagedAttachments();
});
