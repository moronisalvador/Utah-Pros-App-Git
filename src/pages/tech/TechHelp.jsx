/**
 * ════════════════════════════════════════════════
 * FILE: TechHelp.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The field-tech "Help & Guides" screen — a short, plain-language how-to for
 *   the phone app, written for someone who isn't tech-savvy. It walks through the
 *   things a tech actually does: the timer (On My Way → Start Work), snapping
 *   photos, the task checklist, moisture readings, the schedule, and claims. It's
 *   reached from the ? button on the dashboard (and the More menu). Static text
 *   only — it doesn't load anything from the database.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/help
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (useNavigate — for the Back button)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Big type and 48px+ tap targets on purpose — the persona is a 64-year-old
 *     tech in the field, gloves on, in the sun. Keep it skimmable, never dense.
 *   - Reached by PUSH from the dash, so it gets a Back button; the bottom nav is
 *     also always there (tap Dash) as a second way out.
 * ════════════════════════════════════════════════
 */
import { useNavigate } from 'react-router-dom';

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
function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// ─── SECTION: Content ──────────────
// Each card: an icon, a title, and a few short lines. <b> marks the buttons a
// tech taps so they pop. Keep every line one breath long.
const TOPICS = [
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
];

// ─── SECTION: Card ──────────────
function TopicCard({ topic }) {
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

// ─── SECTION: Render ──────────────
export default function TechHelp() {
  const navigate = useNavigate();

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-8)' }}>

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            minHeight: 44, padding: '8px 12px 8px 6px', marginBottom: 6, marginLeft: -6,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)',
            touchAction: 'manipulation',
          }}
        >
          <IconBack width={20} height={20} /> Back
        </button>

        {/* Header */}
        <div className="tech-page-header" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="tech-page-title">Help &amp; Guides</div>
          <div className="tech-page-subtitle">How to use the UPR app</div>
        </div>

        {/* Intro */}
        <div style={{
          background: 'var(--accent-light)', border: '1px solid var(--accent)',
          borderRadius: 'var(--tech-radius-card)', padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--tech-text-body, 15px)', lineHeight: 1.55, color: 'var(--text-primary)',
        }}>
          Your whole day lives in this app. Here’s everything you’ll use, in plain steps. Stuck on anything? Scroll to the bottom.
        </div>

        {TOPICS.map(t => <TopicCard key={t.key} topic={t} />)}

        {/* Stuck? */}
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--tech-radius-card)', padding: 'var(--space-4)', marginTop: 'var(--space-3)',
        }}>
          <div style={{ fontSize: 'var(--tech-text-heading, 22px)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            Stuck on something?
          </div>
          <div style={{ fontSize: 'var(--tech-text-body, 15px)', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            No problem. Tap the <b>⋮</b> menu in the top-right of the home screen and choose <b>Send Feedback</b>, or call the office. We’ve got you.
          </div>
        </div>

      </div>
    </div>
  );
}
