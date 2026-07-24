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

// GSM 03.38 basic charset (each counts as 1 unit). Includes \n and \r.
const GSM_BASIC = new Set(
  ('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split('')
);
// GSM extension charset (each counts as 2 units — an escape + the char).
const GSM_EXT = new Set('^{}\\[~]|€'.split(''));

const GSM_SINGLE = 160, GSM_MULTI = 153;
const UCS2_SINGLE = 70, UCS2_MULTI = 67;

/**
 * Count characters and SMS segments for `text`, picking GSM-7 or UCS-2 the same way
 * a carrier would. Returns { encoding, units, chars, segments, remaining }.
 *   - units: billable units (GSM extension chars cost 2; UCS-2 counts code points)
 *   - chars: visible character count (code points)
 *   - segments: how many SMS parts this becomes
 *   - remaining: characters left before the count tips into the next segment
 */
export function computeSmsSegments(text = '') {
  const chars = [...text].length;
  let isGsm = true;
  let gsmUnits = 0;
  for (const ch of text) {
    if (GSM_EXT.has(ch)) gsmUnits += 2;
    else if (GSM_BASIC.has(ch)) gsmUnits += 1;
    else { isGsm = false; break; }
  }

  if (isGsm) {
    const units = gsmUnits;
    const segments = units === 0 ? 0 : units <= GSM_SINGLE ? 1 : Math.ceil(units / GSM_MULTI);
    const cap = segments <= 1 ? GSM_SINGLE : GSM_MULTI * segments;
    return { encoding: 'GSM-7', units, chars, segments, remaining: Math.max(0, cap - units) };
  }

  const units = chars;
  const segments = units === 0 ? 0 : units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_MULTI);
  const cap = segments <= 1 ? UCS2_SINGLE : UCS2_MULTI * segments;
  return { encoding: 'UCS-2', units, chars, segments, remaining: Math.max(0, cap - units) };
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
 */
export function getServiceConsentUiState({ status = {}, contact = null } = {}) {
  const matches = !!contact
    && status.contactId === contact.id
    && status.phone === (contact.phone || null);
  const checking = (
    !matches
    || status.loading
    || (!status.checked && !status.error)
  );
  const canAttest = (
    matches
    && status.checked
    && !status.allowed
    && status.code === 'NO_CONSENT'
    && !status.source
  );

  let suppressionCopy = null;
  if (matches && !checking) {
    if (status.source === 'pending_stop') {
      suppressionCopy = {
        title: 'SMS STOP request is still processing',
        detail: 'Wait for the inbound opt-out to finish processing. Prior permission cannot override STOP.',
      };
    } else if (status.source === 'explicit_opt_out') {
      suppressionCopy = {
        title: 'This phone number opted out of SMS',
        detail: 'They must text START before staff can send another message.',
      };
    } else if (status.code === 'DND_ACTIVE') {
      suppressionCopy = {
        title: 'SMS is blocked by Do Not Disturb',
        detail: 'Another contact with this phone number has Do Not Disturb enabled.',
      };
    } else if (!canAttest && !status.allowed && !status.error) {
      suppressionCopy = {
        title: 'SMS permission cannot be recorded',
        detail: 'Confirm the contact and phone number before trying again.',
      };
    }
  }

  return Object.freeze({ matches, checking, canAttest, suppressionCopy });
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
