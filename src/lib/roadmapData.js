/**
 * ════════════════════════════════════════════════
 * FILE: roadmapData.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Holds the list of big things the team is building right now — the mobile
 *   app, the desktop schedule improvements, the CRM, the settings overhaul,
 *   the security checks, and a few other efforts — along with how far along
 *   each one is. It is just a plain, hand-kept list written directly in this
 *   file. On purpose, it does NOT read from the UPR database and needs no
 *   login, so the roadmap page can be shown to anyone (even a logged-out
 *   visitor) without touching real business data or permissions.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data module, not a screen)
 *   Rendered by:  n/a — imported by src/pages/Roadmap.jsx (in-app, side-menu)
 *                 and src/pages/PublicRoadmap.jsx (public, no login), both via
 *                 the shared src/components/RoadmapView.jsx.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none (deliberately DB-free; see note below)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is intentionally the ONE and ONLY source of roadmap content. To
 *     update progress, edit this file — there is no admin screen, no Supabase
 *     table, no RPC. That is what keeps the public page safe to share.
 *   - Progress bars are computed from each initiative's `items` (done ÷ total),
 *     so you never hand-type a percentage — just tick items `done: true`.
 *   - `status` is one of 'planned' | 'in_progress' | 'shipped' and drives the
 *     coloured badge (reuses the existing .crm-roadmap-status-* styles).
 *   - Keep it honest but high-level — this is a "what are we working on" board
 *     for the team, not the per-phase build tracker (that lives at /crm/roadmap
 *     and is DB-backed).
 * ════════════════════════════════════════════════
 */

// Bump this whenever you meaningfully update the board below.
export const ROADMAP_UPDATED = 'July 3, 2026';

// status: 'planned' | 'in_progress' | 'shipped'
// items:  { title, done } — progress % is derived from these.
export const ROADMAP_INITIATIVES = [
  {
    key: 'tech-mobile',
    title: 'Mobile App — Field Technician App',
    summary: 'A faster, simpler phone app for techs in the field (iOS + web).',
    status: 'in_progress',
    items: [
      { title: 'New data foundation (offline-first, instant loads)', done: true },
      { title: 'Rebuilt Schedule screen', done: true },
      { title: 'Rebuilt Dashboard / “today” screen', done: true },
      { title: 'Combined Job Hub (job, photos, docs in one place)', done: false },
      { title: 'Retire the old screens & final cleanup', done: false },
      { title: 'iOS App Store polish & release', done: false },
    ],
  },
  {
    key: 'desktop-schedule',
    title: 'Desktop Schedule Page Improvements',
    summary: 'Making the office scheduling calendar faster and easier to run the day from.',
    status: 'in_progress',
    items: [
      { title: 'Schedule templates', done: true },
      { title: 'Faster calendar loading & rendering', done: true },
      { title: 'Drag-and-drop to reschedule appointments', done: false },
      { title: 'Crew availability at-a-glance', done: false },
      { title: 'Month view', done: false },
    ],
  },
  {
    key: 'crm',
    title: 'CRM — Sales & Marketing Platform',
    summary: 'Contacts, leads, conversations, automations and reporting in one place.',
    status: 'in_progress',
    items: [
      { title: 'Foundation & shared building blocks', done: true },
      { title: 'Contacts, segments & duplicate cleanup', done: true },
      { title: 'Leads & pipeline stages', done: true },
      { title: 'Tasks & reminders', done: true },
      { title: 'Follow-up sequences', done: true },
      { title: 'Automation recipes (missed-call text-back, etc.)', done: true },
      { title: 'Public lead-capture forms & website embeds', done: true },
      { title: 'Reports, forecasting & lead scoring', done: false },
      { title: 'Roll out to the full team', done: false },
    ],
  },
  {
    key: 'settings',
    title: 'Settings Page Overhaul',
    summary: 'One clean, organised home for all app, team and integration settings.',
    status: 'in_progress',
    items: [
      { title: 'Unified settings hub layout', done: true },
      { title: 'API keys / integrations panel', done: true },
      { title: 'Billing & payment settings', done: false },
      { title: 'Notification preferences', done: false },
      { title: 'Team & permissions management screen', done: false },
    ],
  },
  {
    key: 'security',
    title: 'Security & Compliance Checks',
    summary: 'Keeping customer data locked down and staying compliant (TCPA, etc.).',
    status: 'in_progress',
    items: [
      { title: 'Automated database migration safety checks', done: true },
      { title: 'Texting/email consent (TCPA) safeguards', done: true },
      { title: '2-factor authentication on billing actions', done: true },
      { title: 'Full row-level-security audit of every table', done: false },
      { title: 'Dependency & secret scanning in CI', done: false },
    ],
  },
  {
    key: 'other',
    title: 'Other Ongoing Work',
    summary: 'The steady stream of smaller improvements running alongside the big rocks.',
    status: 'in_progress',
    items: [
      { title: 'QuickBooks / billing sync improvements', done: false },
      { title: 'Photo & video bug reporting (feedback tools)', done: false },
      { title: 'Email deliverability hardening', done: true },
      { title: 'Homebuilding analysis tools', done: false },
    ],
  },
];

// Roll-up used for the overall progress bar at the top of the page.
export function roadmapOverall(initiatives = ROADMAP_INITIATIVES) {
  let done = 0;
  let total = 0;
  for (const init of initiatives) {
    for (const item of init.items) {
      total += 1;
      if (item.done) done += 1;
    }
  }
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}
