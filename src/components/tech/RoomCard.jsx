/**
 * ════════════════════════════════════════════════
 * FILE: RoomCard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One square tile in the claim's "Rooms" grid. It shows the room's cover
 *   photo (the most recent photo tagged to that room) with the room's name
 *   across the bottom. If the room has no photos yet, it shows a colored
 *   gradient instead. Tapping the tile opens that room.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable tile, not a routed page)
 *   Rendered by:  src/pages/tech/TechClaimDetail.jsx (the claim Rooms grid)
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  @/contexts/AuthContext (for db.baseUrl, to build the image URL)
 *   Data:      reads  → none (the cover photo path is resolved by the parent;
 *                        this only builds a public Storage URL from it)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Props: room { id, name, photo_count }, coverFilePath (string | null,
 *     pre-resolved by the parent), divisionGradient (empty-state fallback),
 *     onClick (tap handler).
 *   - The cover image points at the PUBLIC job-files Storage path; on a load
 *     error the <img> hides itself so the gradient + name show through.
 * ════════════════════════════════════════════════
 */
import { useAuth } from '@/contexts/AuthContext';
export default function RoomCard({ room, coverFilePath = null, divisionGradient, onClick }) {
  // ─── SECTION: State & hooks ──────────────
  const { db } = useAuth();
  const coverUrl =
    coverFilePath && db?.baseUrl
      ? `${db.baseUrl}/storage/v1/object/public/${coverFilePath}`
      : null;

  // ─── SECTION: Render ──────────────
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
