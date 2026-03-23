// ═══════════════════════════════════════════════════════════════
// SCHEDULE UTILS — shared constants and formatters
// ═══════════════════════════════════════════════════════════════

export const DIV_COLORS = {
  water:          { bg: '#dbeafe', text: '#1e40af', label: 'Water' },
  mold:           { bg: '#fce7f3', text: '#9d174d', label: 'Mold' },
  reconstruction: { bg: '#fef3c7', text: '#92400e', label: 'Recon' },
  fire:           { bg: '#fee2e2', text: '#991b1b', label: 'Fire' },
  contents:       { bg: '#d1fae5', text: '#065f46', label: 'Contents' },
};

export const TYPE_COLORS = {
  monitoring: '#3b82f6', mitigation: '#0ea5e9', inspection: '#8b5cf6',
  reconstruction: '#f59e0b', estimate: '#10b981', delivery: '#6b7280',
  mold_remediation: '#059669', content_cleaning: '#8b5cf6', other: '#6b7280',
};

export const APPT_TYPES = [
  { value: 'reconstruction', label: 'Reconstruction' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'mitigation', label: 'Mitigation' },
  { value: 'other', label: 'Other' },
];

export const STATUS_LABELS = {
  scheduled:   { label: 'Scheduled', color: '#3b82f6' },
  en_route:    { label: 'En Route',  color: '#f59e0b' },
  in_progress: { label: 'Active',    color: '#10b981' },
  paused:      { label: 'Paused',    color: '#ef4444' },
  completed:   { label: 'Done',      color: '#6b7280' },
  cancelled:   { label: 'Cancelled', color: '#9ca3af' },
};

// Phase classification for panel groups
const ACTIVE_PHASES = [
  'emergency_response', 'mitigation_in_progress', 'drying', 'monitoring',
  'mold_remediation', 'content_packout', 'content_cleaning', 'content_storage',
  'demo_in_progress', 'reconstruction_in_progress', 'reconstruction_punch_list',
  'supplement_in_progress',
];
const READY_PHASES = ['job_received', 'estimate_submitted', 'estimate_approved', 'work_authorized'];
const WAITING_PHASES = [
  'pending_inspection', 'waiting_on_insurance', 'waiting_on_payment',
  'waiting_on_client', 'waiting_on_adjuster', 'on_hold',
  'supplement_submitted', 'supplement_review',
];
const LEAD_PHASES = ['lead'];

export function classifyPhase(phase) {
  if (ACTIVE_PHASES.includes(phase)) return 'active';
  if (READY_PHASES.includes(phase)) return 'ready';
  if (WAITING_PHASES.includes(phase)) return 'waiting';
  if (LEAD_PHASES.includes(phase)) return 'leads';
  return 'other';
}

export const MITIGATION_DIVS = ['water', 'mold', 'fire', 'contents'];
export const RECON_DIVS = ['reconstruction'];
export const WEEKDAYS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Formatters ──

export function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return date;
}

export function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtShort(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m}${hr >= 12 ? 'p' : 'a'}`;
}

export function fmtShortDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
