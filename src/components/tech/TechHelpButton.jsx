/**
 * ════════════════════════════════════════════════
 * FILE: TechHelpButton.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little "?" a tech can tap on a screen to get help for what they're
 *   doing right now. Tapping it slides up the help drawer (TechHelpSheet) over
 *   the screen — it never leaves the page, so nothing they were typing is lost.
 *   Drop it anywhere with one line: <TechHelpButton topicKey="newjob" />.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a reusable button)
 *   Rendered by:  any tech screen — TechNewJob, TechAppointment, TechClaims, …
 *
 * DEPENDS ON:
 *   Packages:  react (useState)
 *   Internal:  @/components/tech/TechHelpSheet
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Self-contained: it owns the open/closed state and renders the sheet, so a
 *      drop-in is one line.
 *   - Styled to match the dashboard's existing help button (TechDash) so the
 *      "?" looks the same everywhere.
 *   - topicKey picks which help card shows first; pass `style` to position it.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import TechHelpSheet from '@/components/tech/TechHelpSheet';

export default function TechHelpButton({ topicKey, style }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Help"
        style={{
          width: 40, height: 40, flexShrink: 0,
          borderRadius: 'var(--tech-radius-button)',
          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
          border: '1px solid var(--border-light)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'manipulation',
          ...style,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      <TechHelpSheet open={open} onClose={() => setOpen(false)} topicKey={topicKey} />
    </>
  );
}
