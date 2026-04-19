/**
 * MaterialIcon.jsx
 * Pure SVG icon per material type used in the Hydro reading flow.
 * Inline SVG, currentColor stroke/fill where appropriate so callers can
 * restyle with `color`. Kept legible from 18–28px.
 *
 * Props:
 *   type  — one of the MATERIAL_LABELS keys
 *   size  — pixel size (default 18)
 *   ...rest — any extra SVG attrs (title, aria-*, etc.)
 */

export const MATERIAL_LABELS = {
  drywall:          'Drywall',
  wood_subfloor:    'Wood Subfloor',
  wood_framing:     'Wood Framing',
  wood_hardwood:    'Hardwood',
  wood_engineered:  'Engineered Wood',
  concrete:         'Concrete',
  carpet:           'Carpet',
  carpet_pad:       'Carpet Pad',
  tile:             'Tile',
  laminate:         'Laminate',
  vinyl:            'Vinyl',
  insulation:       'Insulation',
  other:            'Other',
};

export default function MaterialIcon({ type, size = 18, style, ...rest }) {
  const s = {
    width: size,
    height: size,
    display: 'block',
    flexShrink: 0,
    ...style,
  };

  switch (type) {
    // ── Drywall ── a paneled sheet with a seam line
    case 'drywall':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="12" y1="4" x2="12" y2="12" />
        </svg>
      );

    // ── Wood (all 4 variants share one grain icon) ── horizontal plank with grain
    case 'wood_subfloor':
    case 'wood_framing':
    case 'wood_hardwood':
    case 'wood_engineered':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M3 10c3 0 3 -1.5 6 -1.5S12 10 15 10s3 -1.5 6 -1.5" />
          <path d="M3 14c3 0 3 -1.5 6 -1.5S12 14 15 14s3 -1.5 6 -1.5" />
        </svg>
      );

    // ── Concrete ── rectangular slab with scattered aggregate dots
    case 'concrete':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="6" width="18" height="12" rx="1.5" />
          <circle cx="8"  cy="10" r="0.9" fill="currentColor" />
          <circle cx="14" cy="11" r="0.7" fill="currentColor" />
          <circle cx="17" cy="14" r="0.9" fill="currentColor" />
          <circle cx="10" cy="15" r="0.7" fill="currentColor" />
          <circle cx="7"  cy="14" r="0.6" fill="currentColor" />
        </svg>
      );

    // ── Carpet / Pad ── surface with short fiber loops on top
    case 'carpet':
    case 'carpet_pad':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <path d="M3 14h18" />
          <path d="M3 14v5h18v-5" />
          <path d="M5 14c.5 -2 1 -3 1.5 -3s1 1 1.5 3" />
          <path d="M9 14c.5 -2 1 -3 1.5 -3s1 1 1.5 3" />
          <path d="M13 14c.5 -2 1 -3 1.5 -3s1 1 1.5 3" />
          <path d="M17 14c.5 -2 1 -3 1.5 -3s1 1 1.5 3" />
        </svg>
      );

    // ── Tile ── 2x2 grid of square tiles with grout lines
    case 'tile':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="3"  width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
        </svg>
      );

    // ── Laminate ── two stacked planks (click-together floating floor)
    case 'laminate':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="5"  width="18" height="6" rx="1" />
          <rect x="3" y="13" width="18" height="6" rx="1" />
          <line x1="10" y1="5"  x2="10" y2="11" />
          <line x1="15" y1="13" x2="15" y2="19" />
        </svg>
      );

    // ── Vinyl ── smooth rectangular sheet with subtle horizontal mark
    case 'vinyl':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <line x1="6"  y1="12" x2="10" y2="12" />
          <line x1="14" y1="12" x2="18" y2="12" />
        </svg>
      );

    // ── Insulation ── wavy batts stacked (classic fiberglass section)
    case 'insulation':
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M4 8c2 -2 4 2 6 0s4 2 6 0 3 1 4 0" />
          <path d="M4 13c2 -2 4 2 6 0s4 2 6 0 3 1 4 0" />
          <path d="M4 18c2 -2 4 2 6 0s4 2 6 0 3 1 4 0" />
        </svg>
      );

    // ── Other (generic) ── layered square stack
    case 'other':
    default:
      return (
        <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
          <rect x="4" y="4" width="14" height="14" rx="1.5" />
          <path d="M8 8h14v14" />
        </svg>
      );
  }
}
