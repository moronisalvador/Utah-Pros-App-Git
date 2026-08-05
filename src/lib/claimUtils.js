// ── Shared Claim Utilities ───────────────────────────────────────────────────
// Used by ClaimPage (operational) and ClaimCollectionPage (financial)

// ── Toasts ────────────────────────────────────────────────────────────────────
// Re-exported from the single upr:toast entry point (AGENTS.md Rule 2) rather than
// dispatching the event again here. The `toast` signature is identical, so every
// existing `import { toast, errToast } from '@/lib/claimUtils'` caller is unaffected.
import { toast } from '@/lib/toast';

export { toast };
export const errToast = (msg) => toast(msg, 'error');

// ── Constants ─────────────────────────────────────────────────────────────────
export const DIV_LABEL  = { water: 'Water', mold: 'Mold', reconstruction: 'Reconstruction', remodeling: 'Remodeling', fire: 'Fire', contents: 'Contents', general: 'General' };
export const DIV_EMOJI  = { water: '\u{1F4A7}', mold: '\u{1F344}', reconstruction: '\u{1F528}', remodeling: '\u{1F528}', fire: '\u{1F525}', contents: '\u{1F4E6}', general: '\u{1F4C1}' };
export const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'sewer', 'vandalism', 'other'];
export const CLAIM_STATUSES = ['open', 'in_progress', 'closed', 'denied', 'settled', 'supplementing'];
// Who may edit billing / A/R (invoices, estimates, recorded payments — QuickBooks-affecting
// actions). Deliberately narrower than general claim editing. Widened 2026-08-04 (owner-directed)
// from the admin-effective ['admin','manager'] to include office + project_manager, so the office
// staff who actually field customer payments can record them.
//
// The old 'manager' literal was DEAD: the employee_role enum is
// (admin, office, project_manager, field_tech, estimator, supervisor, crm_partner) — it has no
// 'manager' value, so that entry never matched anyone. Dropped rather than carried forward.
//
// Server-side parity is NOT optional (AGENTS.md §16): this list is mirrored by the SQL predicate
// public.billing_edit_access(), which gates the payments / invoices / invoice_line_items /
// estimates / estimate_line_items write policies and the invoice-creation RPCs. Changing this
// list without changing that function re-opens a UI-only gate.
export const BILLING_EDIT_ROLES = ['admin', 'office', 'project_manager'];
export const canEditBilling = (role) => BILLING_EDIT_ROLES.includes(role);

// Payout authority is a STRICTLY narrower capability than billing editing, and is deliberately
// NOT widened alongside it: /settings/payments holds the Stripe/payout configuration and
// POST /api/stripe-payout triggers a Stripe Instant Payout that moves real money OUT to the
// company debit card. Recording a customer payment and wiring money out are different jobs.
// Mirrored server-side by functions/api/stripe-payout.js (PAYOUT_MANAGE_ROLES).
export const PAYOUT_MANAGE_ROLES = ['admin'];
export const canManagePayouts = (role) => PAYOUT_MANAGE_ROLES.includes(role);
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

// ── Balances ────────────────────────────────────────────────────────────────
// Invoice-aware: when a job carries an invoice rollup (job._fin, attached by
// withJobFinancials) and has >=1 pushed invoice, the invoices table is the source
// of truth. Otherwise we fall back to the legacy hand-entered jobs fields, so a
// job that has never been invoiced behaves exactly as before. collected only
// moves to invoices once it's > 0 (QBO payment sync, phase 2c); until then the
// hand-logged jobs.collected_value stays authoritative.
export function getBalances(job) {
  const f = (job._fin && Number(job._fin.invoice_count) > 0) ? job._fin : null;
  const invoiced   = f                              ? Number(f.invoiced  || 0) : Number(job.invoiced_value  || 0);
  const collected  = (f && Number(f.collected)  > 0) ? Number(f.collected)     : Number(job.collected_value || 0);
  const deductible = (f && Number(f.deductible) > 0) ? Number(f.deductible)    : Number(job.deductible      || 0);
  const balance    = Math.max(0, invoiced - collected);
  const ded_owed   = (job.insurance_company && deductible > 0 && !job.deductible_collected)
    ? Math.min(deductible, balance) : 0;
  return { balance, ded_owed, ins_balance: Math.max(0, balance - ded_owed), invoiced, collected, deductible };
}

// ── Invoice-sourced financials ───────────────────────────────────────────────
// The invoices table is the source of truth for billing. These helpers overlay
// per-job invoice rollups (get_job_financials RPC) onto job objects with a
// COALESCE-style fallback to the legacy jobs.invoiced_value/collected_value, so a
// job with no pushed invoices renders identically to before. "Invoiced" = pushed
// to QuickBooks, matching the AR-sync trigger. Failures degrade silently to legacy
// values (the rollup is an overlay, never a hard dependency).
export async function fetchJobFinancials(db, jobIds) {
  try {
    const ids = (jobIds || []).filter(Boolean);
    const rows = await db.rpc('get_job_financials', ids.length ? { p_job_ids: ids } : {});
    const map = new Map();
    (rows || []).forEach(r => map.set(r.job_id, r));
    return map;
  } catch {
    return new Map();
  }
}

export function applyJobFinancials(job, finOrMap) {
  if (!job) return job;
  const f = finOrMap instanceof Map ? finOrMap.get(job.id) : finOrMap;
  if (!f || !(Number(f.invoice_count) > 0)) return job;
  return {
    ...job,
    invoiced_value:  Number(f.invoiced) || 0,
    collected_value: Number(f.collected) > 0 ? Number(f.collected) : job.collected_value,
    invoiced_date:   job.invoiced_date || f.invoiced_date || null,
    _fin: f,
  };
}

export async function withJobFinancials(db, jobs) {
  const list = jobs || [];
  if (list.length === 0) return list;
  const map = await fetchJobFinancials(db, list.map(j => j.id));
  if (map.size === 0) return list;
  return list.map(j => applyJobFinancials(j, map));
}
