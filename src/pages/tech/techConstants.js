/* Shared color constants for tech pages — single source of truth */

export const APPT_STATUS_COLORS = {
  scheduled:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  confirmed:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  en_route:    { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  in_progress: { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' },
  paused:      { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  completed:   { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  cancelled:   { bg: '#f1f3f5', color: '#6b7280', border: '#e2e5e9' },
};

export const CLAIM_STATUS_COLORS = {
  open:       { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  active:     { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  closed:     { bg: '#f1f3f5', color: '#6b7280', border: '#e2e5e9' },
  pending:    { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
};

export const DIV_GRADIENTS = {
  water:          'linear-gradient(135deg, #1e40af, #3b82f6)',
  mold:           'linear-gradient(135deg, #831843, #ec4899)',
  reconstruction: 'linear-gradient(135deg, #78350f, #f59e0b)',
  fire:           'linear-gradient(135deg, #7f1d1d, #ef4444)',
  contents:       'linear-gradient(135deg, #064e3b, #10b981)',
};

export const DIV_PILL_COLORS = {
  water:          { bg: '#dbeafe', color: '#1e40af' },
  mold:           { bg: '#fce7f3', color: '#9d174d' },
  reconstruction: { bg: '#fef3c7', color: '#92400e' },
  fire:           { bg: '#fee2e2', color: '#b91c1c' },
  contents:       { bg: '#d1fae5', color: '#065f46' },
};

export const DIV_BORDER_COLORS = {
  water: '#3b82f6',
  mold: '#ec4899',
  reconstruction: '#f59e0b',
  fire: '#ef4444',
  contents: '#10b981',
};

export const TYPE_CONFIG = {
  monitoring:       { label: 'Monitoring',   color: '#3b82f6', bg: '#eff6ff',  icon: '\u{1F4E1}' },
  mitigation:       { label: 'Mitigation',   color: '#0ea5e9', bg: '#f0f9ff',  icon: '\u{1F4A7}' },
  inspection:       { label: 'Inspection',   color: '#8b5cf6', bg: '#f5f3ff',  icon: '\u{1F50D}' },
  reconstruction:   { label: 'Recon',        color: '#f59e0b', bg: '#fffbeb',  icon: '\u{1F528}' },
  estimate:         { label: 'Estimate',     color: '#10b981', bg: '#ecfdf5',  icon: '\u{1F4CB}' },
  mold_remediation: { label: 'Mold Remed.',  color: '#059669', bg: '#ecfdf5',  icon: '\u{1F33F}' },
  other:            { label: 'Other',        color: '#6b7280', bg: '#f3f4f6',  icon: '\u{1F4CC}' },
};

export const ROOM_TEMPLATES = [
  'Living Room',
  'Kitchen',
  'Dining Room',
  'Master Bedroom',
  'Bedroom 2',
  'Bedroom 3',
  'Master Bathroom',
  'Bathroom 2',
  'Hallway',
  'Stairs',
  'Basement',
  'Garage',
  'Laundry',
  'Mud Room',
  'Office',
  'Closet',
];
