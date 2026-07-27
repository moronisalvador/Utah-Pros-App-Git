/**
 * ════════════════════════════════════════════════
 * FILE: messageUtils.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A grab-bag of small, self-contained helpers the Messages screen leans on: it
 *   figures out how many text-message "segments" (and therefore how much) a draft
 *   will cost, turns raw links in a message into safe clickable links, reads the
 *   list of photo/file attachments off a message, and remembers a half-written
 *   draft per conversation so it survives switching threads or refreshing. None of
 *   these touch the network or the database — they are pure text/number helpers.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module imported by Conversations.jsx + MessageBubble)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../../../functions/lib/twilio-errors.js (classifyTwilioError — the
 *              frozen error-code → uiClass map; import-only per sms-experience §9.5)
 *   Data:      reads/writes → none (localStorage for drafts only; no Supabase)
 *
 * EXPORTS:
 *   computeSmsSegments(text) — GSM-7 vs UCS-2 char + segment counter.
 *   linkifyTokens(text)      — tokenises a string into text/link parts (no raw HTML).
 *   parseMediaUrls(raw)      — normalises the jsonb media_urls column into a string[].
 *   isLikelyImageUrl(url)    — extension-based guess for <img> vs file-link render.
 *   uiClassForMessage(msg)   — 'blocked'|'carrier'|'unreachable'|'config'|'error'.
 *   failureReason(msg)       — human-readable reason for a failed message.
 *   mergeRefreshedMessages   — patch a newest-page refresh without losing older history.
 *   getServiceConsentUiState — fail-closed consent banner/action presentation.
 *   draft get/set/clear      — per-conversation composer persistence.
 *
 * NOTES / GOTCHAS:
 *   - media_urls is a jsonb column that current writers fill via JSON.stringify(array),
 *     so it reads back as a JSON *string* (not a parsed array). parseMediaUrls copes
 *     with either shape, plus a bare single-URL string, and never throws.
 *   - linkify only ever emits https:/mailto: hrefs (built by us), so a javascript:
 *     or data: scheme in the source text can never become a live link.
 * ════════════════════════════════════════════════
 */

import { classifyTwilioError } from '../../../functions/lib/twilio-errors.js';

// ─── SECTION: Helpers — SMS segment counting ──────────────

// Moved to functions/lib/sms-segments.js on 2026-07-26 so the composer and the send
// path share ONE implementation — the send path now enforces a segment cap, and two
// copies of this math drifting apart would let a message pass the composer and be
// refused by the worker. Re-exported here: this module's export surface is unchanged
// (tech-messages-v2 imports `computeSmsSegments` from here as a frozen contract).
export { computeSmsSegments, maxCharsForSegments } from '../../../functions/lib/sms-segments.js';

// ─── SECTION: Helpers — superseded failures ──────────────

const OUTBOUND_TYPES = new Set(['sms_outbound', 'email_outbound']);
// 'queued' counts: the worker only writes it once the provider accepted the send.
const DELIVERED_ENOUGH = new Set(['queued', 'sent', 'delivered', 'read']);

/**
 * Drop failed outbound rows that a later successful send has already replaced.
 *
 * Retrying does NOT update the failed row — the worker is the sole writer and it
 * inserts a NEW row per attempt (omni §7.1). So a successful retry leaves the
 * thread holding both: the original, `failed` forever, and the new one, `sent`.
 * Shown as-is that is two bubbles for one message, and the dead one keeps a live
 * Retry button whose next tap sends the customer a third copy.
 *
 * Every chat people actually use — iMessage, WhatsApp, Google Messages — treats a
 * retry as the SAME message: one bubble whose status changes. So the replaced row
 * is removed from the thread entirely, not merely de-emphasized. The failure is
 * still on the row in the database for audit; the chat shows the conversation,
 * not the plumbing.
 *
 * Limitation, deliberate: matching is on identical body text, so a staff member
 * who genuinely sends the same words twice will have the earlier failure hidden
 * once the later one succeeds. That is the safe direction to be wrong in — the
 * text did reach the customer, and the row is still in the database.
 */
export function withoutSupersededFailures(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  // Earliest index at which each body text was successfully sent outbound.
  const firstSuccessAt = new Map();
  messages.forEach((m, i) => {
    if (!OUTBOUND_TYPES.has(m?.type)) return;
    if (!DELIVERED_ENOUGH.has(m?.status)) return;
    const key = (m.body || '').trim();
    if (!key) return;
    if (!firstSuccessAt.has(key)) firstSuccessAt.set(key, i);
  });
  if (firstSuccessAt.size === 0) return messages;

  const out = messages.filter((m, i) => {
    const failed = m?._failed || m?.status === 'failed' || m?.status === 'undelivered';
    if (!failed || !OUTBOUND_TYPES.has(m?.type)) return true;
    const at = firstSuccessAt.get((m.body || '').trim());
    return at === undefined || at <= i;
  });
  // Preserve identity when nothing was dropped so React sees no spurious change.
  return out.length === messages.length ? messages : out;
}

// ─── SECTION: Helpers — linkify (scheme-whitelisted, no raw HTML) ──────────────

// Matches an http(s) URL, a bare www. URL, or an email address. Trailing sentence
// punctuation is deliberately excluded from the URL capture.
const LINK_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,!?):;'"]|[\w.+-]+@[\w-]+\.[\w.-]+[\w-])/gi;

/**
 * Split `text` into an array of tokens: { type:'text', value } and
 * { type:'link', value, href }. Callers render these as plain text nodes and
 * <a> elements — nothing is ever inserted as HTML, so this is XSS-safe.
 * href is only ever an https: or mailto: URL we construct ourselves.
 */
export function linkifyTokens(text = '') {
  const out = [];
  let last = 0;
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    const raw = m[0];
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    let href;
    if (raw.includes('@') && !/^https?:\/\//i.test(raw) && !/^www\./i.test(raw)) {
      href = `mailto:${raw}`;
    } else if (/^www\./i.test(raw)) {
      href = `https://${raw}`;
    } else {
      // http:// or https:// — force https for http to avoid mixed-content warnings.
      href = raw.replace(/^http:\/\//i, 'https://');
    }
    out.push({ type: 'link', value: raw, href });
    last = m.index + raw.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

// ─── SECTION: Helpers — media attachments ──────────────

/** Normalise the jsonb media_urls column (array | JSON-string | single URL) → string[]. */
export function parseMediaUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
      } catch { return []; }
    }
    return [s];
  }
  return [];
}

/** Best-effort guess: does this URL point at an image (render <img>) or a file (render a link)? */
export function isLikelyImageUrl(url = '') {
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp|svg|avif)(\?|#|$)/i.test(url)) return true;
  // Twilio media URLs carry no extension; treat them as images (they are almost
  // always photos) and let the <img> onError fall back to a file link.
  if (/api\.twilio\.com\/.+\/Media\//i.test(url)) return true;
  return false;
}

/** Media references that can safely be replayed through the canonical send worker. */
export function isRetryableMediaReference(value = '') {
  if (value.startsWith('upr-storage://message-attachments/outbound/')) {
    const path = value.slice('upr-storage://message-attachments/outbound/'.length);
    return !!path
      && !path.includes('..')
      && !path.includes('\\')
      && /^[A-Za-z0-9_./-]+$/.test(path);
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && /^\/storage\/v1\/object\/public\/job-files\/conversations\/[^/]+\//.test(
        decodeURIComponent(parsed.pathname),
      );
  } catch {
    return false;
  }
}

// ─── SECTION: Helpers — failure classification (mirrors twilio-errors uiClass) ──────────────

/** Style token for a message's delivery state: 'blocked'|'carrier'|'unreachable'|'config'|'error'. */
export function uiClassForMessage(msg) {
  return classifyTwilioError(msg?.error_code).uiClass;
}

/** Human-readable reason for a failed/undelivered message (prefers Twilio's own text). */
export function failureReason(msg) {
  if (msg?.error_message) return msg.error_message;
  const c = classifyTwilioError(msg?.error_code);
  return c.code ? c.label : 'Message failed to send';
}

/** True when provider acceptance is unresolved and resubmission could duplicate a text. */
export function isAmbiguousSend(msg) {
  return typeof msg?.error_code === 'string'
    && msg.error_code.endsWith('_SEND_AMBIGUOUS');
}

// ─── SECTION: Helpers — thread refresh and consent presentation ──────────────

/** Patch a newest-page refresh into existing ascending history without losing older pages. */
export function mergeRefreshedMessages(previous = [], refreshed = []) {
  const refreshedById = new Map(refreshed.map(message => [message.id, message]));
  const refreshedBodies = new Set(refreshed.map(message => `${message.type}::${message.body}`));
  const retained = previous
    .filter(message =>
      !(message._pending || message._failed)
      || !refreshedBodies.has(`${message.type}::${message.body}`))
    .map(message => refreshedById.has(message.id)
      ? { ...message, ...refreshedById.get(message.id) }
      : message);
  const retainedIds = new Set(retained.map(message => message.id));
  return [...retained, ...refreshed.filter(message => !retainedIds.has(message.id))];
}

/**
 * Turn the server's scoped consent decision into fail-closed UI state. Actions stay hidden until
 * the decision belongs to the active contact and current phone and confirms ordinary NO_CONSENT.
 * A contact's already-recorded global opt-in is authoritative local state and does not wait on a
 * redundant service-consent lookup; the send Worker still performs the final consent/DND check.
 */
export function getServiceConsentUiState({ status = {}, contact = null } = {}) {
  const matches = !!contact
    && status.contactId === contact.id
    && status.phone === (contact.phone || null);
  const hasRecordedGlobalOptIn = contact?.opt_in_status === true;
  const checking = (
    !matches
    || status.loading
    || (!status.checked && !status.error && !hasRecordedGlobalOptIn)
  );
  const canAttest = (
    matches
    && !checking
    && status.checked
    && !status.allowed
    && status.code === 'NO_CONSENT'
    && !status.source
  );

  let suppressionCopy = null;
  let suppressionKey = null;
  if (matches && !checking) {
    if (status.source === 'pending_stop') {
      suppressionKey = 'pendingStop';
      suppressionCopy = {
        title: 'SMS STOP request is still processing',
        detail: 'Wait for the inbound opt-out to finish processing. Prior permission cannot override STOP.',
      };
    } else if (status.source === 'explicit_opt_out') {
      suppressionKey = 'optedOut';
      suppressionCopy = {
        title: 'This phone number opted out of SMS',
        detail: 'They must text START before staff can send another message.',
      };
    } else if (status.code === 'DND_ACTIVE') {
      suppressionKey = 'dnd';
      suppressionCopy = {
        title: 'SMS is blocked by Do Not Disturb',
        detail: 'Another contact with this phone number has Do Not Disturb enabled.',
      };
    } else if (!hasRecordedGlobalOptIn && !canAttest && !status.allowed && !status.error) {
      suppressionKey = 'unavailable';
      suppressionCopy = {
        title: 'SMS permission cannot be recorded',
        detail: 'Confirm the contact and phone number before trying again.',
      };
    }
  }

  return Object.freeze({
    matches,
    checking,
    canAttest,
    suppressionKey,
    suppressionCopy,
  });
}

// ─── SECTION: Helpers — per-conversation draft persistence ──────────────

const DRAFT_PREFIX = 'upr:conv-draft:';

export function getDraft(convId) {
  if (!convId || typeof localStorage === 'undefined') return '';
  try { return localStorage.getItem(DRAFT_PREFIX + convId) || ''; } catch { return ''; }
}
export function setDraft(convId, text) {
  if (!convId || typeof localStorage === 'undefined') return;
  try {
    if (text && text.trim()) localStorage.setItem(DRAFT_PREFIX + convId, text);
    else localStorage.removeItem(DRAFT_PREFIX + convId);
  } catch { /* quota / disabled — non-fatal */ }
}
export function clearDraft(convId) {
  if (!convId || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(DRAFT_PREFIX + convId); } catch { /* non-fatal */ }
}
