/**
 * ════════════════════════════════════════════════
 * FILE: collTokens.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The colors and the number/date helpers for the redesigned "My Money /
 *   Collections" page. It holds the palette (the UPR design-system colors:
 *   teal/purple/coral/pink divisions + blue/green/amber/red status), the dollar
 *   and date formatters, the time-period date math, and the small rules that
 *   decide an invoice's status word. The visual building blocks that USE these
 *   live next door in collKit.jsx.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (constants + helper module)
 *   Rendered by:  collKit.jsx + the collections tab components
 *
 * DEPENDS ON:
 *   Packages:  none · Internal: none · Data: none
 *
 * NOTES / GOTCHAS:
 *   - Page-scoped palette (same approach as the Overview dashboard's tokens.js).
 *     Don't import these into unrelated pages until the app-wide rollout decision.
 *   - COLOR SEMANTICS (deliberate): red is reserved for past-due / escalation —
 *     a current/outstanding balance is neutral ink, not red. Green = collected /
 *     current; amber = aging / attention.
 *   - Kept separate from the JSX components so the file exports only plain
 *     values (satisfies react-refresh/only-export-components).
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Palette ──────────────
export const C = {
  pageBg:     '#f4f5f7',
  cardBg:     '#ffffff',
  cardBorder: '#e7e9ee',
  hairline:   '#f0f1f4',
  headFill:   '#fafbfc',
  track:      '#eef0f3',
  inputBg:    '#f4f5f7',
  inputBorder:'#eceef2',
  rowHover:   '#f8f9fb',
  ink:        '#101828',
  title:      '#344054',
  body:       '#475467',
  muted:      '#667085',
  faint:      '#98a2b3',
  faint2:     '#c2c7d0',
  faintSub:   '#aeb4be',
};

export const STATUS = {
  info:    { solid: '#2f6bf2', text: '#2456c9', tint: '#eef2fb', border: '#d8e4fb' },
  success: { solid: '#1f9d55', text: '#1f8a4c', tint: '#e9f7ef', border: '#cdeeda' },
  warning: { solid: '#e8920c', text: '#b76e00', tint: '#fdf3e3', border: '#f6e2bf' },
  danger:  { solid: '#df3b34', text: '#c0322c', tint: '#fdecea', border: '#f7d2cf' },
  neutral: { solid: '#667085', text: '#667085', tint: '#f0f1f4', border: '#e7e9ee' },
};

// The four design-system divisions + a graceful mapping for the app's other live
// divisions (fire/contents/general) per the Phase-4 plan, so every real row gets
// a stable color square.
const DIV_COLOR = {
  water: '#0e9384', mitigation: '#0e9384', mit: '#0e9384',
  reconstruction: '#8a5cf6', recon: '#8a5cf6',
  remodeling: '#f2664a', remodel: '#f2664a',
  mold: '#ec4899',
  fire: '#b91c1c', contents: '#047857', general: '#475569',
};
export function divColor(division) {
  return DIV_COLOR[String(division || '').toLowerCase()] || C.faint;
}
export function divLabel(division) {
  const d = String(division || '').replace(/_/g, ' ').trim();
  if (!d) return '';
  if (d.toLowerCase() === 'water') return 'Water';
  return d.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const PERIODS = ['All', 'MTD', 'Last 30', 'QTD', 'YTD'];

// Shared inline text styles: job/claim codes in mono; metrics in tabular figures.
export const mono = { fontFamily: 'var(--font-mono)' };
export const tnum = { fontVariantNumeric: 'tabular-nums' };

// ─── SECTION: Formatters + date helpers ──────────────
export const fmt$  = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const fmt$2 = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function fmtK(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}
export const fmtDate = (v) =>
  v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

export const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function parseTs(v) {
  if (!v) return null;
  const t = new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).getTime();
  return Number.isNaN(t) ? null : t;
}

// daysPastDue: positive = overdue by N, 0 = due today, negative = due in N, null = no due date.
export function daysPastDue(dueDate, today = midnight()) {
  if (!dueDate) return null;
  const t = parseTs(dueDate);
  return t == null ? null : Math.floor((today.getTime() - t) / 86400000);
}

// Invoice status word from balances/dates — shared by the A/R and Invoices tabs so
// they always agree. paid → overdue → draft (unsent) → partial → sent.
export function invoiceStatusKind(r, today = midnight()) {
  const total = Number(r.total || 0), paid = Number(r.amount_paid || 0), bal = Number(r.balance || 0);
  if (total > 0 && bal <= 0.005) return 'paid';
  const d = daysPastDue(r.due_date, today);
  if (bal > 0 && d != null && d > 0) return 'overdue';
  const sent = !!r.sent_at || !!r.qbo_invoice_id;
  if (!sent || r.status === 'draft') return 'draft';
  if (paid > 0) return 'partial';
  return 'sent';
}

// periodRange: turns a period choice into {start,end} Dates (null = unbounded).
export function periodRange(period) {
  if (!period || period === 'All') return { start: null, end: null };
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  let start;
  if (period === 'QTD') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else if (period === 'YTD') start = new Date(now.getFullYear(), 0, 1);
  else if (period === 'Last 30') { start = new Date(now); start.setDate(start.getDate() - 29); }
  else start = new Date(now.getFullYear(), now.getMonth(), 1); // MTD (default)
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// inPeriod: is a row's date inside the window? Undated rows (drafts) always pass.
export function inPeriod(dateVal, range) {
  if (!range || (!range.start && !range.end)) return true;
  if (!dateVal) return true;
  const t = parseTs(dateVal);
  if (t == null) return true;
  if (range.start && t < range.start.getTime()) return false;
  if (range.end && t > range.end.getTime()) return false;
  return true;
}

// Client-side CSV download for the "Export →" footer links.
export function downloadCsv(filename, header, rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
