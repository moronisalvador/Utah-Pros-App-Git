/**
 * RoomChip.jsx
 * Reusable chip for a single room — used in PhotoNoteSheet's room list
 * and later by moisture/equipment sheets in Phase 2.
 *
 * Props:
 *   room      — { id, name, photo_count? }
 *   selected  — boolean (shows check + accent border)
 *   onClick   — click handler
 *   style     — optional style overrides
 */
export default function RoomChip({ room, selected = false, onClick, style }) {
  const hasCount = typeof room?.photo_count === 'number' && room.photo_count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 'var(--tech-min-tap, 48px)',
        padding: '0 14px',
        borderRadius: 'var(--radius-full, 9999px)',
        background: selected ? 'var(--accent-light)' : 'var(--bg-tertiary)',
        color: selected ? 'var(--accent)' : 'var(--text-primary)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-light)'}`,
        fontSize: 14,
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        flexShrink: 0,
        ...style,
      }}
    >
      {selected && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      <span>{room?.name || 'Untitled room'}</span>
      {hasCount && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: selected ? 'var(--accent)' : 'var(--text-tertiary)',
            opacity: selected ? 0.9 : 1,
          }}
        >
          {room.photo_count}
        </span>
      )}
    </button>
  );
}
