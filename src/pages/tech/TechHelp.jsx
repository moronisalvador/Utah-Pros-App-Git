/**
 * ════════════════════════════════════════════════
 * FILE: TechHelp.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The field-tech "Help & Guides" screen — a short, plain-language how-to for
 *   the phone app, written for someone who isn't tech-savvy. It walks through the
 *   things a tech actually does: the timer (On My Way → Start Work), snapping
 *   photos, the task checklist, moisture readings, the schedule, claims, and
 *   starting a job. Reached from the ? button on the dashboard (and the More
 *   menu). Static text only — it doesn't load anything from the database.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/help
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (useNavigate — for the Back button)
 *   Internal:  @/pages/tech/techHelpContent (TOPICS + TopicCard — shared with
 *              the contextual TechHelpSheet so the wording never drifts)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Big type and 48px+ tap targets on purpose — the persona is a 64-year-old
 *     tech in the field, gloves on, in the sun. Keep it skimmable, never dense.
 *   - Reached by PUSH from the dash, so it gets a Back button; the bottom nav is
 *     also always there (tap Dash) as a second way out.
 *   - The card content lives in techHelpContent.jsx; this file is just the page
 *     shell (back / header / intro / cards / "Stuck?" footer).
 * ════════════════════════════════════════════════
 */
import { useNavigate } from 'react-router-dom';
import { TOPICS, TopicCard } from '@/pages/tech/techHelpContent';

function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
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
