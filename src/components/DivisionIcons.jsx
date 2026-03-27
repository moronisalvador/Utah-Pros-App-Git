/**
 * DivisionIcons.jsx
 * Single source of truth for all division + loss type icons, colors, and labels.
 * Import from here — never define these locally in a page/component.
 *
 * Exports:
 *   DIVISION_CONFIG   — color/bg/label per division
 *   LOSS_CONFIG       — color/bg/label per loss type
 *   DivisionIcon      — SVG icon for a job division
 *   LossIcon          — SVG icon for a claim loss type
 */

// ── Division config ───────────────────────────────────────────────────────────
export const DIVISION_CONFIG = {
  water:          { color: '#1d4ed8', bg: '#dbeafe', label: 'Water' },
  mold:           { color: '#7e22ce', bg: '#f3e8ff', label: 'Mold' },
  reconstruction: { color: '#b45309', bg: '#fef3c7', label: 'Reconstruction' },
  fire:           { color: '#b91c1c', bg: '#fee2e2', label: 'Fire' },
  contents:       { color: '#047857', bg: '#d1fae5', label: 'Contents' },
  general:        { color: '#475569', bg: '#f1f5f9', label: 'General' },
};

// ── Loss type config ──────────────────────────────────────────────────────────
export const LOSS_CONFIG = {
  water:     { color: '#1d4ed8', bg: '#dbeafe', label: 'Water' },
  fire:      { color: '#b91c1c', bg: '#fee2e2', label: 'Fire' },
  mold:      { color: '#7e22ce', bg: '#f3e8ff', label: 'Mold' },
  storm:     { color: '#a16207', bg: '#fef9c3', label: 'Storm' },
  sewer:     { color: '#065f46', bg: '#d1fae5', label: 'Sewer' },
  vandalism: { color: '#be123c', bg: '#ffe4e6', label: 'Vandalism' },
  other:     { color: '#475569', bg: '#f1f5f9', label: 'Other' },
};

// ── Convenience color lookups (drop-in for old DIVISION_COLORS / DIV_COLOR maps) ──
export const DIVISION_COLORS = {
  water:          DIVISION_CONFIG.water.color,
  mold:           DIVISION_CONFIG.mold.color,
  reconstruction: DIVISION_CONFIG.reconstruction.color,
  fire:           DIVISION_CONFIG.fire.color,
  contents:       DIVISION_CONFIG.contents.color,
  general:        DIVISION_CONFIG.general.color,
};

// ── DivisionIcon ──────────────────────────────────────────────────────────────
// Renders an SVG icon for a job division.
// Props:
//   type  — division key ('water' | 'mold' | 'reconstruction' | 'fire' | 'contents' | 'general')
//   size  — pixel size (default 20)
//   color — override stroke/fill color (default: DIVISION_CONFIG[type].color)
export function DivisionIcon({ type, size = 20, color: colorOverride, style, ...rest }) {
  const cfg   = DIVISION_CONFIG[type] || DIVISION_CONFIG.general;
  const color = colorOverride || cfg.color;
  const s     = { width: size, height: size, display: 'block', flexShrink: 0, ...style };

  switch (type) {
    case 'water':
      return (
        <svg style={s} viewBox="0 0 24 24" fill={color} {...rest}>
          <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2z"/>
          <path d="M9 16a3 3 0 0 0 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5"/>
        </svg>
      );

    case 'mold':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" {...rest}>
          <circle cx="12" cy="12" r="2.5" fill={color} opacity="0.3"/>
          <circle cx="12" cy="5"  r="1.8"/>
          <circle cx="12" cy="19" r="1.8"/>
          <circle cx="5"  cy="12" r="1.8"/>
          <circle cx="19" cy="12" r="1.8"/>
          <circle cx="7"  cy="7"  r="1.4"/>
          <circle cx="17" cy="7"  r="1.4"/>
          <circle cx="7"  cy="17" r="1.4"/>
          <circle cx="17" cy="17" r="1.4"/>
        </svg>
      );

    case 'reconstruction':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <polyline points="3 10 12 3 21 10"/>
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1v-9" fill={color} fillOpacity="0.12"/>
          <line x1="15" y1="3" x2="15" y2="7"/>
          <line x1="13" y1="3" x2="17" y2="3"/>
        </svg>
      );

    case 'fire':
      return (
        <svg style={s} viewBox="0 0 24 24" fill={color} {...rest}>
          <path d="M12 2c0 0-1 3-3 5C7 9.5 6 11 6 13a6 6 0 0 0 12 0c0-4-4-7-4-9-1 1.5-1 3-1 3s-1-1-1-5z"/>
          <path d="M12 15a2 2 0 0 1-2-2c0-1.5 2-4 2-4s2 2.5 2 4a2 2 0 0 1-2 2z" fill="white" opacity="0.45"/>
        </svg>
      );

    case 'contents':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <polyline points="21 8 21 21 3 21 3 8"/>
          <rect x="1" y="3" width="22" height="5" rx="1" fill={color} fillOpacity="0.15"/>
          <line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
      );

    default: // general / fallback
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="13" y2="17"/>
        </svg>
      );
  }
}

// ── LossIcon ──────────────────────────────────────────────────────────────────
// Renders an SVG icon for a claim loss type.
// Props: type, size, color (override)
export function LossIcon({ type, size = 20, color: colorOverride, style, ...rest }) {
  const cfg   = LOSS_CONFIG[type] || LOSS_CONFIG.other;
  const color = colorOverride || cfg.color;
  const s     = { width: size, height: size, display: 'block', flexShrink: 0, ...style };

  // Water + mold + fire share the same SVG as DivisionIcon
  if (type === 'water' || type === 'mold' || type === 'fire') {
    return <DivisionIcon type={type} size={size} color={color} style={style} {...rest} />;
  }

  switch (type) {
    case 'storm':
      return (
        <svg style={s} viewBox="0 0 24 24" fill={color} {...rest}>
          <path d="M13 2L4 14h7l-2 8 11-12h-7l2-8z"/>
        </svg>
      );

    case 'sewer':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="5" width="18" height="4" rx="1" fill={color} fillOpacity="0.2"/>
          <path d="M7 9v3M12 9v5M17 9v3"/>
          <path d="M5 12h14"/>
          <path d="M7 15v4M17 15v4"/>
          <ellipse cx="12" cy="18" rx="2" ry="1.5" fill={color} opacity="0.3"/>
        </svg>
      );

    case 'vandalism':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <path d="M3 21l9-9"/>
          <path d="M12.5 7.5l2-2a2.12 2.12 0 0 1 3 3l-2 2"/>
          <path d="M3 21h4l9.5-9.5-4-4L3 21z" fill={color} fillOpacity="0.2"/>
        </svg>
      );

    default: // other
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
          <line x1="9" y1="17" x2="13" y2="17"/>
        </svg>
      );
  }
}
