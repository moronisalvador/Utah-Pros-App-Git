/**
 * ════════════════════════════════════════════════
 * FILE: RoomChip.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small tappable "chip" button showing a room's name (and an optional
 *   photo count). When selected it gets a checkmark and an accent border.
 *   Used in lists where a tech picks which room something belongs to.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable chip component)
 *   Rendered by:  PhotoNoteSheet.jsx, EquipmentPlacementSheet.jsx,
 *                 ReadingEntrySheet.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Props: room { id, name, photo_count? }, selected, onClick, style.
 *   - Min height honors --tech-min-tap (48px) for gloved-hand taps.
 * ════════════════════════════════════════════════
 */
export default function RoomChip({ room, selected = false, onClick, style }) {
  const hasCount = typeof room?.photo_count === 'number' && room.photo_count > 0;

  // ─── SECTION: Render ──────────────
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
