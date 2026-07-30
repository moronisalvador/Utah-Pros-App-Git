/**
 * ════════════════════════════════════════════════
 * FILE: techConstants.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A shared lookup sheet of colors and labels for the field-tech screens.
 *   It holds the color sets for appointment and claim status badges, the
 *   background gradients, pill colors, and border colors for each division
 *   (water, fire, mold, etc.), the label/color/icon for each appointment
 *   type, and a starter list of common room names. Keeping these in one place
 *   means every tech screen shows the same colors and wording.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (static constants only)
 *
 * EXPORTS:
 *   APPT_STATUS_COLORS, CLAIM_STATUS_COLORS, DIV_GRADIENTS, DIV_PILL_COLORS,
 *   DIV_BORDER_COLORS, TYPE_CONFIG, ROOM_TEMPLATES
 *
 * NOTES / GOTCHAS:
 *   - Single source of truth for tech-screen colors — change a color here and
 *     every tech screen updates. Components that need the same colors import
 *     from here (e.g. Hero, PhotosGroup) rather than hardcoding their own.
 *   - TWO DELIBERATELY DIFFERENT KINDS OF COLOR live in this file:
 *     · APPT_STATUS_COLORS / CLAIM_STATUS_COLORS are STATUS, so they read the
 *       semantic var(--success|danger|warning|info|neutral) tokens and follow the
 *       tech dark theme automatically. Reasoning is inline above each map.
 *     · DIV_* and TYPE_CONFIG are a CATEGORICAL brand palette (water=blue,
 *       fire=red, mold=pink, …). The hue IS the meaning, so they are NOT status
 *       tokens and stay raw hex on purpose. The gradients and DIV_BORDER_COLORS
 *       are theme-invariant (saturated fills carrying white text). The light
 *       tints in DIV_PILL_COLORS and TYPE_CONFIG.bg are the one KNOWN dark-theme
 *       gap left on this surface — closing it needs its own reviewed division
 *       token family in index.css, which is a CSS change, not a swap.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Constants ──────────────
// Status colors read the SEMANTIC tokens, not raw hex, so `[data-theme="dark"]
// .tech-layout` re-tones them instead of leaving frozen light patches
// (UPR-Design-System.md → Dark-theme contract). The {bg,color,border} shape is
// unchanged, so every consumer keeps working untouched.
//
// Why the semantic family and NOT the tech `--status-*` family: the dark block
// re-points only `--status-*-bg`, so those pills would keep a LIGHT border on a
// dark fill, and `--status-completed-*` is gray where an appointment's
// "completed" is green. The semantic family re-tones bg AND border, and is what
// the shared StatusPill reads. In light mode this is a near-exact no-op —
// scheduled/confirmed/en_route/paused/completed match their token triplet
// byte-for-byte; only in_progress (#059669 → #16a34a) and the two `cancelled`/
// `closed` borders (#e2e5e9 → #e5e7eb) shift, all imperceptibly.
export const APPT_STATUS_COLORS = {
  scheduled:   { bg: 'var(--info-bg)',    color: 'var(--info)',    border: 'var(--info-border)' },
  confirmed:   { bg: 'var(--info-bg)',    color: 'var(--info)',    border: 'var(--info-border)' },
  en_route:    { bg: 'var(--warning-bg)', color: 'var(--warning)', border: 'var(--warning-border)' },
  in_progress: { bg: 'var(--success-bg)', color: 'var(--success)', border: 'var(--success-border)' },
  paused:      { bg: 'var(--danger-bg)',  color: 'var(--danger)',  border: 'var(--danger-border)' },
  completed:   { bg: 'var(--success-bg)', color: 'var(--success)', border: 'var(--success-border)' },
  cancelled:   { bg: 'var(--neutral-bg)', color: 'var(--neutral)', border: 'var(--neutral-border)' },
};

export const CLAIM_STATUS_COLORS = {
  open:       { bg: 'var(--info-bg)',    color: 'var(--info)',    border: 'var(--info-border)' },
  active:     { bg: 'var(--info-bg)',    color: 'var(--info)',    border: 'var(--info-border)' },
  closed:     { bg: 'var(--neutral-bg)', color: 'var(--neutral)', border: 'var(--neutral-border)' },
  pending:    { bg: 'var(--warning-bg)', color: 'var(--warning)', border: 'var(--warning-border)' },
};

export const DIV_GRADIENTS = {
  water:          'linear-gradient(135deg, #1e40af, #3b82f6)',
  mold:           'linear-gradient(135deg, #831843, #ec4899)',
  reconstruction: 'linear-gradient(135deg, #78350f, #f59e0b)',
  remodeling:     'linear-gradient(135deg, #c0432a, #f2664a)',
  fire:           'linear-gradient(135deg, #7f1d1d, #ef4444)',
  contents:       'linear-gradient(135deg, #064e3b, #10b981)',
};

export const DIV_PILL_COLORS = {
  water:          { bg: '#dbeafe', color: '#1e40af' },
  mold:           { bg: '#fce7f3', color: '#9d174d' },
  reconstruction: { bg: '#fef3c7', color: '#92400e' },
  remodeling:     { bg: '#fdece8', color: '#c0432a' },
  fire:           { bg: '#fee2e2', color: '#b91c1c' },
  contents:       { bg: '#d1fae5', color: '#065f46' },
};

export const DIV_BORDER_COLORS = {
  water: '#3b82f6',
  mold: '#ec4899',
  reconstruction: '#f59e0b',
  remodeling: '#f2664a',
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
