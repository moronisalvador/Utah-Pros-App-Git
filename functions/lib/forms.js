/**
 * ════════════════════════════════════════════════
 * FILE: forms.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The safe, shared brains behind the embeddable lead-capture forms. It has no
 *   database or network calls — just pure functions used in three places: the
 *   form builder's live preview, the hosted form page, and the submit handler.
 *   It does the security-sensitive bits: turning the restricted [text](url)
 *   link markup into safe HTML (and refusing anything that could inject a
 *   script), checking a submission against the form's field rules, and catching
 *   the two cheapest spam tells (a filled honeypot, an impossibly fast fill).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (pure helper module — no I/O)
 *   Rendered by:  n/a
 *
 * DEPENDS ON:
 *   Packages:  none — pure functions, safe in both the browser (Vite) and a
 *              Cloudflare Worker (V8 isolate).
 *   Internal:  imported by functions/api/form-submit.js,
 *              functions/f/[public_id].js, and src/pages/crm/CrmForms.jsx.
 *   Exports:   escapeHtml, sanitizeLinkMarkup, FIELD_TYPES, validateSubmission,
 *              checkSpam, consentValue, isTruthy, MIN_FILL_MS
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 10 (.claude/rules/crm-wave-ownership.md). Created new; it
 *     does not edit any frozen functions/lib file.
 *   - sanitizeLinkMarkup is allow-list only: everything is HTML-escaped first,
 *     then ONLY [label](url) with an http(s)/mailto url becomes an <a>. A
 *     javascript:/data:/relative url is left as escaped literal text — never an
 *     anchor. This is the load-bearing XSS defense; see forms.test.js.
 * ════════════════════════════════════════════════
 */

// The two spam thresholds. A real person cannot complete a form in under 3s.
export const MIN_FILL_MS = 3000;

// Every field type the builder can produce. Kept in sync with CrmForms.jsx.
export const FIELD_TYPES = ['text', 'email', 'phone', 'select', 'radio', 'checkbox', 'textarea', 'date', 'consent'];

// Values that count as "checked"/"true" coming off an HTML form (strings) or JSON.
export function isTruthy(v) {
  if (v === true) return true;
  if (typeof v === 'string') return ['true', 'on', '1', 'yes', 'checked'].includes(v.trim().toLowerCase());
  return false;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only these URL schemes may become a real link. Everything else stays text.
function safeLinkUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (/\s/.test(url)) return null; // no whitespace/control chars in a url
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url;
  if (/^mailto:[^\s]+$/i.test(url)) return url;
  return null; // javascript:, data:, relative, protocol-relative, etc. → not a link
}

/**
 * Render restricted markdown-style links inside otherwise-plain text as safe
 * HTML. The whole string is HTML-escaped first (so no raw tag can survive),
 * then `[label](url)` spans are replaced with an anchor ONLY when the url is
 * an allow-listed scheme. The label is also escaped and stripped of any
 * bracket that could break out of the anchor.
 */
export function sanitizeLinkMarkup(text) {
  const escaped = escapeHtml(text);
  // Operate on the ESCAPED string, so a url like data:text/html,<script> has
  // already had its angle brackets neutralized before we ever inspect it.
  return escaped.replace(/\[([^\]]*?)\]\(([^)]*?)\)/g, (whole, label, url) => {
    const safe = safeLinkUrl(url);
    if (!safe) return whole; // leave the literal (already-escaped) [label](url) as text
    const cleanLabel = String(label).replace(/[<>]/g, '');
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer nofollow">${cleanLabel}</a>`;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digits(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

// Validate a single field's value. Returns an error string, or null if ok.
function validateField(field, value) {
  const type = field.type;
  const has = value != null && String(value).trim() !== '';
  const required = !!field.required;

  if (type === 'consent') {
    if (required && !isTruthy(value)) return 'This box must be checked.';
    return null;
  }
  if (type === 'checkbox') {
    if (required && !isTruthy(value)) return 'This box is required.';
    return null;
  }
  if (required && !has) return `${field.label || 'This field'} is required.`;
  if (!has) return null; // optional + empty is fine

  switch (type) {
    case 'email':
      return EMAIL_RE.test(String(value).trim()) ? null : 'Enter a valid email address.';
    case 'phone':
      return digits(value).length >= 10 ? null : 'Enter a valid phone number.';
    case 'select':
    case 'radio': {
      const options = Array.isArray(field.options) ? field.options : [];
      return options.includes(String(value)) ? null : 'Choose one of the listed options.';
    }
    case 'date': {
      const s = String(value).trim();
      // Accept ISO-ish dates only; reject free text like "yesterday".
      if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return 'Enter a valid date.';
      const t = Date.parse(s);
      return Number.isNaN(t) ? 'Enter a valid date.' : null;
    }
    default:
      return null; // text / textarea — any non-empty string is acceptable
  }
}

/**
 * Validate a whole submission against a published schema.
 * @returns {{ valid: boolean, errors: Record<string,string> }}
 */
export function validateSubmission(schema, data) {
  const fields = (schema && Array.isArray(schema.fields)) ? schema.fields : [];
  const errors = {};
  const d = data || {};
  for (const field of fields) {
    if (!field || !field.key) continue;
    const msg = validateField(field, d[field.key]);
    if (msg) errors[field.key] = msg;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Cheap first-line spam gate. Server-side only (the real IP rate-limit and the
 * optional Turnstile check live in form-submit.js, which also uses this).
 * @returns {{ spam: boolean, reason: string|null }}
 */
export function checkSpam({ honeypot, elapsedMs, minFillMs = MIN_FILL_MS }) {
  if (honeypot != null && String(honeypot).trim() !== '') return { spam: true, reason: 'honeypot' };
  if (typeof elapsedMs === 'number' && elapsedMs < minFillMs) return { spam: true, reason: 'too_fast' };
  return { spam: false, reason: null };
}

/** Did the person tick the (first) consent box? */
export function consentValue(schema, data) {
  const fields = (schema && Array.isArray(schema.fields)) ? schema.fields : [];
  const field = fields.find((f) => f && f.type === 'consent');
  if (!field) return false;
  return isTruthy((data || {})[field.key]);
}
