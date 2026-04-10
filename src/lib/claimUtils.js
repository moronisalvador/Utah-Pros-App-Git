// ── Shared Claim Utilities ───────────────────────────────────────────────────
// Used by ClaimPage (operational) and ClaimCollectionPage (financial)

// ── Toasts ────────────────────────────────────────────────────────────────────
export const toast  = (msg, type = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));
export const errToast = (msg) => toast(msg, 'error');

// ── Constants ─────────────────────────────────────────────────────────────────
export const DIV_LABEL  = { water: 'Water', mold: 'Mold', reconstruction: 'Reconstruction', fire: 'Fire', contents: 'Contents', general: 'General' };
export const DIV_EMOJI  = { water: '\u{1F4A7}', mold: '\u{1F344}', reconstruction: '\u{1F528}', fire: '\u{1F525}', contents: '\u{1F4E6}', general: '\u{1F4C1}' };
export const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'sewer', 'vandalism', 'other'];
export const CLAIM_STATUSES = ['open', 'in_progress', 'closed', 'denied', 'settled', 'supplementing'];
export const AR_STATUSES = [
  { value: 'open',        label: 'Open',        color: '#6b7280', bg: '#f9fafb' },
  { value: 'invoiced',    label: 'Invoiced',    color: '#2563eb', bg: '#eff6ff' },
  { value: 'partial',     label: 'Partial',     color: '#d97706', bg: '#fffbeb' },
  { value: 'paid',        label: 'Paid',        color: '#059669', bg: '#ecfdf5' },
  { value: 'disputed',    label: 'Disputed',    color: '#dc2626', bg: '#fef2f2' },
  { value: 'written_off', label: 'Written Off', color: '#9ca3af', bg: '#f3f4f6' },
];

// ── Formatters ────────────────────────────────────────────────────────────────
export const fmt$  = (v) => v == null ? '\u2014' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtK  = (v) => { if (v == null) return '\u2014'; const n = Number(v); if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(0) + 'k'; return '$' + Math.round(n); };
export const fmtPh = (ph) => { if (!ph) return null; const d = ph.replace(/\D/g,''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}` : ph; };
export const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014';
export const fmtDateShort = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '\u2014';

export function getBalances(job) {
  const invoiced   = Number(job.invoiced_value  || 0);
  const collected  = Number(job.collected_value || 0);
  const deductible = Number(job.deductible      || 0);
  const balance    = Math.max(0, invoiced - collected);
  const ded_owed   = (job.insurance_company && deductible > 0 && !job.deductible_collected)
    ? Math.min(deductible, balance) : 0;
  return { balance, ded_owed, ins_balance: Math.max(0, balance - ded_owed), invoiced, collected, deductible };
}
