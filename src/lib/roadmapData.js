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
// Statuses reconciled against docs/*-roadmap.md + what has actually merged on
// the dev branch (July 3, 2026). Keep them honest, not aspirational.
export const ROADMAP_INITIATIVES = [
  {
    key: 'tech-mobile',
    title: 'Mobile App — Field Technician App',
    summary: 'Rebuilding the field techs’ phone app to feel as smooth as Apple/Google Calendar.',
    status: 'in_progress',
    items: [
      { title: 'New data foundation (offline-first, instant loads)', done: true },
      { title: 'Rebuilt Schedule screen (agenda, day timeline, week pager)', done: true },
      { title: 'Rebuilt Dashboard / “today” screen', done: true },
      { title: 'Travel + on-site + total time on the board & dashboard', done: true },
      { title: 'Retire the old screens & final cleanup', done: false },
      { title: 'Combined Job Hub (job, photos, docs in one screen)', done: false },
      { title: 'Switch all links over to the new Job Hub', done: false },
    ],
  },
  {
    key: 'desktop-schedule',
    title: 'Desktop Schedule Page Improvements',
    summary: 'Book a job from the office calendar in one pass while a client is on the phone.',
    status: 'in_progress',
    items: [
      { title: 'Plan & design locked in (with owner amendments)', done: true },
      { title: 'Book customer + job + appointment in a single flow', done: false },
      { title: 'Remove old, unused schedule views', done: false },
      { title: 'Fix the remodeling-division filter', done: false },
      { title: 'Month view: drag-to-reschedule & richer event cards', done: false },
    ],
  },
  {
    key: 'crm',
    title: 'CRM — Sales & Marketing Platform',
    summary: 'Lead tracking, call tracking, pipeline, and campaigns brought into UPR itself.',
    status: 'in_progress',
    items: [
      { title: 'Call & ad tracking (CallRail, ad spend, attribution)', done: true },
      { title: 'Sales pipeline & stages', done: true },
      { title: 'Contacts, segments & duplicate cleanup', done: true },
      { title: 'Tasks, follow-up sequences & automations', done: true },
      { title: 'Email campaigns', done: true },
      { title: 'Reports, forecasting & lead scoring', done: true },
      { title: 'Public lead-capture forms & website embeds', done: true },
      { title: 'SMS text-blast campaigns (awaiting carrier approval)', done: false },
      { title: 'Automation recipe builder', done: false },
      { title: 'Roll out to the full team', done: false },
    ],
  },
  {
    key: 'notifications',
    title: 'Notification Center',
    summary: 'Real notifications — phone push, email, and the in-app bell, with per-person preferences.',
    status: 'planned',
    items: [
      { title: 'Plan & design locked in', done: true },
      { title: 'Web push to iPhone & desktop (delivery spike)', done: false },
      { title: 'Notification data foundation & in-app bell', done: false },
      { title: 'Wire up events (messages, payments, leads, e-sign, appointments)', done: false },
      { title: 'Per-person notification preferences', done: false },
      { title: 'Admin default settings', done: false },
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
    key: 'feedback-media',
    title: 'Feedback Tools — Photo & Video Bug Reports',
    summary: 'Let everyone attach photos and videos to bug reports, with an owner triage inbox.',
    status: 'in_progress',
    items: [
      { title: 'Photo & video attachments on bug reports', done: true },
      { title: 'Image compression & video size caps', done: true },
      { title: 'Owner triage inbox (video player, lightbox, notes)', done: true },
      { title: '90-day auto-purge of old media', done: true },
      { title: 'Turn on push delivery (needs Apple setup)', done: false },
      { title: 'Point the scheduler at auto-purge', done: false },
    ],
  },
  {
    key: 'other',
    title: 'Other Ongoing Work',
    summary: 'The steady stream of smaller improvements running alongside the big rocks.',
    status: 'in_progress',
    items: [
      { title: 'Email deliverability hardening', done: true },
      { title: 'QuickBooks / billing sync improvements', done: false },
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
