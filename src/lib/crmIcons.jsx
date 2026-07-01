/**
 * ════════════════════════════════════════════════
 * FILE: crmIcons.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small set of icons just for the CRM section's own left sidebar
 *   (Overview, Leads, Call Log, Tasks, Attribution, Reports, Integrations,
 *   Settings). Kept in their own file, separate from the app-wide icon set
 *   in src/lib/navItems.jsx, because a couple of names (Leads, Settings)
 *   would otherwise collide with icons that already exist there for
 *   unrelated nav items.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Same signature as every other icon in the app (24x24 viewBox,
 *     stroke="currentColor", 2px rounded stroke) — see
 *     src/lib/navItems.jsx's IconXxx(p) convention.
 * ════════════════════════════════════════════════
 */

export function IconOverview(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 13a9 9 0 0 1 18 0" />
      <path d="M3 13a9 9 0 0 0 9 9" />
      <path d="M12 13l4-4" />
      <circle cx="12" cy="13" r="1" />
    </svg>
  );
}

export function IconLeads(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="8" cy="8" r="4" />
      <path d="M2 21v-2a6 6 0 0 1 6-6h0a6 6 0 0 1 6 6v2" />
      <path d="M17 8h4" />
      <path d="M19 6v4" />
    </svg>
  );
}

export function IconCallLog(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function IconTasks(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="M5 8l1 1 2-2" />
      <path d="M12 6h9" />
      <path d="M12 12h9" />
      <path d="M12 18h9" />
      <path d="M3 15h6" />
      <path d="M3 19h6" />
    </svg>
  );
}

export function IconAttribution(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
      <path d="M12 3v3" />
    </svg>
  );
}

export function IconReports(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 19V9" />
      <path d="M10 19V5" />
      <path d="M16 19v-7" />
      <path d="M22 19H2" />
    </svg>
  );
}

export function IconIntegrations(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="9" width="6" height="6" rx="1" />
      <rect x="16" y="9" width="6" height="6" rx="1" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IconCrmSettings(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
