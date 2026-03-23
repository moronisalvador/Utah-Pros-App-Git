// ─────────────────────────────────────────────────────────────
// UPR shared formatting utilities
// Single source of truth — import these everywhere instead of
// defining local fmtDate / fmt / fmtPhone in each component.
// ─────────────────────────────────────────────────────────────

/**
 * Format a date string or Date object.
 * @param {string|Date} v
 * @param {'short'|'long'|'datetime'|'relative'|'time'} style
 */
export function fmtDate(v, style = 'short') {
  if (!v) return '—';
  const d = typeof v === 'string'
    ? new Date(v.includes('T') ? v : v + 'T00:00:00')
    : v;
  if (isNaN(d)) return '—';

  switch (style) {
    case 'long':
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    case 'datetime':
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    case 'time':
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    case 'relative': {
      const diff = Math.floor((Date.now() - d) / 86400000);
      if (diff === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      if (diff === 1) return 'Yesterday';
      if (diff < 7)  return d.toLocaleDateString('en-US', { weekday: 'short' });
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    case 'short':
    default:
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Format a dollar value.
 * @param {number|string|null} v
 * @param {boolean} cents  — include cents (default false)
 */
export function fmtMoney(v, cents = false) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/**
 * Format a phone number to (xxx) xxx-xxxx.
 * Handles +1 prefix and raw 10-digit strings.
 */
export function fmtPhone(phone) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  const n = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return phone; // return as-is if unrecognised format
}

/**
 * Format decimal hours to "Xh Ym".
 */
export function fmtHours(h) {
  if (h == null || h === '') return '—';
  const n = Number(h);
  if (isNaN(n)) return '—';
  const hrs  = Math.floor(n);
  const mins = Math.round((n - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/**
 * Normalise a phone input to E.164 (+1xxxxxxxxxx) or null.
 * Use before saving to DB.
 */
export function normalisePhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return digits.length > 0 ? '+' + digits : null;
}
