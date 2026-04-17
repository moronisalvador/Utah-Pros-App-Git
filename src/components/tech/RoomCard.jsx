import { useAuth } from '@/contexts/AuthContext';

/**
 * RoomCard — tile in the claim-level Rooms grid.
 *
 * Shows a cover photo (most recent photo tagged to this room across all
 * jobs on the claim) with the room name overlay at the bottom. Falls back
 * to a gradient empty state when no photos have been tagged yet.
 *
 * Props:
 *   room             — { id, name, photo_count }
 *   coverFilePath    — string | null (already resolved by parent)
 *   divisionGradient — optional gradient for the empty-state fallback
 *   onClick          — tap handler
 */
export default function RoomCard({ room, coverFilePath = null, divisionGradient, onClick }) {
  const { db } = useAuth();
  const coverUrl =
    coverFilePath && db?.baseUrl
      ? `${db.baseUrl}/storage/v1/object/public/${coverFilePath}`
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        aspectRatio: '1 / 1',
        padding: 0,
        overflow: 'hidden',
        borderRadius: 14,
        border: '1px solid var(--border-light)',
        background: coverUrl
          ? 'var(--bg-tertiary)'
          : (divisionGradient || 'linear-gradient(135deg, #cbd5e1, #94a3b8)'),
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        boxShadow: 'var(--tech-shadow-card)',
        WebkitTapHighlightColor: 'transparent',
      }}
      aria-label={`Open ${room?.name || 'room'}`}
    >
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}

      {/* Bottom gradient scrim so the room name is always readable */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          height: '55%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 12, right: 12, bottom: 10,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 6,
          textAlign: 'left',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: '#ffffff',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flex: 1,
          }}
        >
          {room?.name || 'Untitled room'}
        </div>
        {typeof room?.photo_count === 'number' && room.photo_count > 0 && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#ffffff',
              background: 'rgba(0,0,0,0.35)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              flexShrink: 0,
              backdropFilter: 'blur(4px)',
            }}
          >
            {room.photo_count}
          </div>
        )}
      </div>
    </button>
  );
}
