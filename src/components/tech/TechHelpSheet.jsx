/**
 * ════════════════════════════════════════════════
 * FILE: TechHelpSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A pop-up help drawer that slides up from the bottom of a field-tech screen.
 *   Tapping a "?" opens it; it shows the help for whatever the tech is doing
 *   right now (e.g. "Starting a new job") at the top, with the rest of the
 *   guide below. It floats ON TOP of the screen — it never navigates away — so
 *   a half-filled form is never lost. Closes by tapping outside, the ✕, or the
 *   grabber.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (an overlay, opened by TechHelpButton)
 *   Rendered by:  src/components/tech/TechHelpButton.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (JSX only)
 *   Internal:  @/pages/tech/techHelpContent (TOPICS + TopicCard)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Matches the app's other tech sheets (PhotoNoteSheet, ClockSupersedeSheet):
 *      backdrop + slide-up panel, the tech-fade-in / tech-slide-up keyframes,
 *      and bottom safe-area padding (Capacitor iOS home indicator).
 *   - NO navigation and NO target="_blank" — both break under Capacitor's
 *      capacitor://localhost origin. The whole point is to stay on the screen.
 *   - Returns null when closed (cheap; nothing mounted until opened).
 * ════════════════════════════════════════════════
 */
import { TOPICS, TopicCard } from '@/pages/tech/techHelpContent';

export default function TechHelpSheet({ open, onClose, topicKey }) {
  if (!open) return null;

  // Show the screen's relevant topic first, then the rest of the guide.
  const requested = TOPICS.find(t => t.key === topicKey);
  const ordered = requested ? [requested, ...TOPICS.filter(t => t.key !== topicKey)] : TOPICS;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          maxHeight: '80dvh',
          display: 'flex', flexDirection: 'column',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        {/* Grabber + close */}
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 2 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-color)' }} />
          <button
            onClick={onClose}
            aria-label="Close help"
            style={{
              position: 'absolute', top: 4, right: 8, width: 40, height: 40,
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-tertiary)', fontSize: 20, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'manipulation',
            }}
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <div style={{ padding: '2px var(--space-4) var(--space-3)' }}>
          <div style={{ fontSize: 'var(--tech-text-heading, 22px)', fontWeight: 800, color: 'var(--text-primary)' }}>Help</div>
        </div>

        {/* Cards (relevant topic first) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-4)' }}>
          {ordered.map(t => <TopicCard key={t.key} topic={t} />)}
        </div>
      </div>
    </div>
  );
}
