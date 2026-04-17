import { openMap } from '@/lib/techDateUtils';

// 3-button action bar: Call · Navigate · Message.
// Used by TechClaimDetail and TechJobDetail.
// TechAppointment has its own (5-button) variant — not refactored here.
//
// Message button → native sms:{phone}. TODO: switch to in-app SMS when available.
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
