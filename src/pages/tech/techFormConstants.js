import { APPT_TYPES } from '@/lib/scheduleUtils';

export const inputStyle = {
  width: '100%', height: 48, padding: '0 14px',
  fontSize: 16, borderRadius: 'var(--tech-radius-button)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};

export const labelStyle = {
  fontSize: 'var(--tech-text-label)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6,
};

export const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 6; h <= 20; h++) for (let m = 0; m < 60; m += 30) {
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const hr = h % 12 || 12;
    opts.push({ val, label: `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` });
  }
  return opts;
})();

export const MOBILE_TYPES = APPT_TYPES.filter(t =>
  ['reconstruction', 'inspection', 'monitoring', 'mitigation', 'estimate', 'other'].includes(t.value)
);

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
}
