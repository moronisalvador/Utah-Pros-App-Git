/**
 * ════════════════════════════════════════════════
 * FILE: ActionBar.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A row of three big buttons — Call, Navigate, and Message — that sits at
 *   the top of a claim or job screen. Tapping Call opens the phone dialer,
 *   Navigate opens the maps app pointed at the address, and Message opens the
 *   phone's text-message app. If there is no phone number or address, the
 *   matching button is shown greyed out and can't be tapped.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable button bar, not a routed page)
 *   Rendered by:  src/pages/tech/TechClaimDetail.jsx,
 *                 src/pages/tech/TechJobDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  @/lib/techDateUtils (openMap — opens the maps app)
 *   Data:      reads  → none (phone + address arrive as props)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Props: phone, address.
 *   - TechAppointment has its own 5-button variant — this one was NOT
 *     refactored to cover it.
 *   - Message button uses the native sms:{phone} link. TODO: switch to
 *     in-app SMS when available.
 * ════════════════════════════════════════════════
 */
import { openMap } from '@/lib/techDateUtils';

// ─── SECTION: Render ──────────────
export default function ActionBar({ phone, address }) {
  const btnBase = {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 4, padding: '6px 0', minWidth: 64, minHeight: 56,
    fontFamily: 'var(--font-sans)',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
  };
  const enabledStyle = { color: 'var(--text-secondary)', cursor: 'pointer' };
  const disabledStyle = { color: 'var(--text-tertiary)', opacity: 0.45, cursor: 'not-allowed' };

  return (
    <div style={{
      display: 'flex', background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-light)', padding: '8px 0',
    }}>
      {/* Call */}
      {phone ? (
        <a href={`tel:${phone}`} style={{ ...btnBase, ...enabledStyle, textDecoration: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
        </a>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
        </button>
      )}

      {/* Navigate */}
      {address ? (
        <button onClick={() => openMap(address)} style={{ ...btnBase, ...enabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Navigate</span>
        </button>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Navigate</span>
        </button>
      )}

      {/* Message — TODO: switch to in-app SMS when available */}
      {phone ? (
        <a href={`sms:${phone}`} style={{ ...btnBase, ...enabledStyle, textDecoration: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
        </a>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
        </button>
      )}
    </div>
  );
}
