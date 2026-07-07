/**
 * ════════════════════════════════════════════════
 * FILE: icons.jsx  (admin-mobile icon set)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small set of simple line-drawing icons used only by the admin screens
 *   inside the field-tech app (dashboard, collections, invoices, estimates,
 *   leads, and small UI bits like the back chevron). They live here on purpose,
 *   away from the app's other shared icon files, so the admin-mobile work never
 *   has to touch those.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared presentational icons)
 *   Rendered by:  the admin-mobile primitives and stub pages
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Admin-mobile icons MUST live here, never in src/components/Icons.jsx or the
 *     frozen src/lib/crmIcons.jsx (both are frozen for this wave).
 *   - Every icon takes standard SVG props (width/height/style) and inherits
 *     color via currentColor, so callers set color with CSS.
 * ════════════════════════════════════════════════
 */

// Shared base props keep every icon visually consistent (stroke weight, caps).
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconGauge(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M12 10V6" />
      <path d="M4.5 19a9 9 0 1 1 15 0" />
    </svg>
  );
}

export function IconMoney(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

export function IconInvoice(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

export function IconEstimate(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="12" y2="16" />
    </svg>
  );
}

export function IconLeads(props) {
  return (
    <svg {...base} {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  );
}

export function IconPhone(props) {
  return (
    <svg {...base} {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function IconChevronRight(props) {
  return (
    <svg {...base} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function IconChevronLeft(props) {
  return (
    <svg {...base} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
