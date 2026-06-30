/**
 * ════════════════════════════════════════════════
 * FILE: techHelpContent.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared content for the field-tech help — the list of "how-to" topics
 *   (the timer, photos, tasks, readings, schedule, claims, starting a job) and
 *   the little card that draws one. It lives on its own so both the full Help
 *   page AND the pop-up help sheet show the exact same wording (they can never
 *   drift apart).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain content + component module, not a screen)
 *   Rendered by:  src/pages/tech/TechHelp.jsx (the full page) and
 *                  src/components/tech/TechHelpSheet.jsx (the contextual sheet)
 *
 * DEPENDS ON:
 *   Packages:  react (JSX only)
 *   Internal:  none
 *   Data:      reads → none · writes → none (static content)
 *
 * EXPORTS:
 *   TOPICS      — array of { key, Icon, title, lines[], accent? }
 *   TopicCard   — <TopicCard topic={...} /> renders one topic
 *
 * NOTES / GOTCHAS:
 *   - `lines` contain <b> tags for the buttons a tech taps; rendered via
 *      dangerouslySetInnerHTML. Keep every line one breath long (field persona).
 * ════════════════════════════════════════════════
 */
/* eslint-disable react-refresh/only-export-components --
   This is a shared content module on purpose: it exports the TOPICS data AND
   the TopicCard that renders it, so the page and the sheet never drift. Fast
   refresh on static help content isn't a concern. */

// ─── SECTION: Icons ──────────────
function IconClock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
function IconCamera(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function IconChecklist(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function IconDroplet(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}
function IconCalendar(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconFolder(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconHome(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function IconNewJob(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

// ─── SECTION: Content ──────────────
// Each card: an icon, a title, and a few short lines. <b> marks the buttons a
// tech taps so they pop. Keep every line one breath long.
export const TOPICS = [
  {
    key: 'day', Icon: IconHome, title: 'Your day',
    lines: [
      'The first screen shows <b>today’s jobs</b>. Tap a job to open it.',
      'Nothing today? You’ll see what’s coming up next so you can get ready.',
    ],
  },
  {
    key: 'timer', Icon: IconClock, title: 'The timer — clocking in & out', accent: true,
    lines: [
      'Tap <b>On My Way</b> when you leave for the job — that starts your drive time.',
      'Tap <b>Start Work</b> when you get there — that starts your on-site time.',
      '<b>Pause</b> for a break, <b>Finish</b> when you’re done. The app adds up the hours for you — you never have to.',
    ],
  },
  {
    key: 'photos', Icon: IconCamera, title: 'Taking photos',
    lines: [
      'Tap the camera and take the shot — it <b>saves on its own</b>, right away.',
      'Want to label it? Tap <b>Add note</b> on the little popup. That part’s optional — never hold up the next photo for it.',
    ],
  },
  {
    key: 'tasks', Icon: IconChecklist, title: 'Your task list',
    lines: [
      'Each job has a checklist. <b>Tap a task</b> (or swipe it) to mark it done.',
      'The ring at the top shows how many are left.',
    ],
  },
  {
    key: 'readings', Icon: IconDroplet, title: 'Moisture readings',
    lines: [
      'On water jobs, tap <b>Readings</b> on the job and type in the numbers from your meter.',
    ],
  },
  {
    key: 'schedule', Icon: IconCalendar, title: 'Your schedule',
    lines: [
      '<b>Schedule</b> (bottom of the screen) shows your next two weeks.',
      'Tap the <b>today</b> button to jump straight back to today.',
    ],
  },
  {
    key: 'claims', Icon: IconFolder, title: 'Claims & photo albums',
    lines: [
      '<b>Claims</b> lists your jobs. Open one to see the details and the full <b>photo album</b>.',
    ],
  },
  {
    key: 'newjob', Icon: IconNewJob, title: 'Starting a new job',
    lines: [
      'Tap the <b>+</b> button (bottom-right of the Dash) and choose <b>New Job</b>.',
      '<b>Find the customer</b> — search by name or phone. New to us? Tap <b>+ Create New Customer</b> and add their name and phone.',
      '<b>New or existing claim</b> — a brand-new loss stays on <b>New claim</b>. More work on a loss they already have? Tap <b>Existing claim</b> and pick it, so it files in the right place.',
      'Pick the <b>division</b> (the trade), the <b>referral source</b>, and the <b>insurance carrier</b> — or <b>Out of pocket</b> for cash. Add the address.',
      'Tap <b>Create Job</b> — it opens the new job and lists you as the lead tech.',
    ],
  },
];

// ─── SECTION: Card ──────────────
export function TopicCard({ topic }) {
  const { title, lines, accent } = topic;
  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-color)'}`,
      borderRadius: 'var(--tech-radius-card)',
      boxShadow: 'var(--tech-shadow-card)',
      padding: 'var(--space-4)',
      marginBottom: 'var(--space-3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: accent ? 'var(--accent)' : 'var(--accent-light)',
          color: accent ? '#fff' : 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <topic.Icon width={24} height={24} />
        </div>
        <div style={{ fontSize: 'var(--tech-text-heading, 22px)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.15 }}>
          {title}
        </div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((t, i) => (
          <li key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 800, lineHeight: 1.4, flexShrink: 0 }}>•</span>
            <span style={{ fontSize: 'var(--tech-text-body, 15px)', lineHeight: 1.5, color: 'var(--text-secondary)' }}
                  dangerouslySetInnerHTML={{ __html: t }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
