/**
 * ════════════════════════════════════════════════
 * FILE: PhotosGroup.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the photos and notes for one job, grouped together on a claim or
 *   job screen. It displays up to three photo thumbnails in a row, plus a
 *   "+N more" tile if there are extras, and lists up to three notes
 *   underneath. When a claim has more than one job, it also shows a small
 *   division-colored header with the job number and counts. Tapping a
 *   thumbnail opens the full-screen photo viewer.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable group block, not a routed page)
 *   Rendered by:  src/pages/tech/TechClaimDetail.jsx,
 *                 src/pages/tech/TechJobDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  @/pages/tech/techConstants (DIV_BORDER_COLORS — division
 *              header color), @/components/DivisionIcons (DivisionIcon),
 *              @/lib/techDateUtils (fileUrl — builds a public Storage URL
 *              from a stored file path)
 *   Data:      reads  → none (photos + notes arrive as props; only builds
 *                        public Storage URLs from the paths)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Props: job, photos (array), notes (array), isSingleJob (hides the
 *     mini-header when true), db (used by fileUrl), onOpenAlbum (jobId, index),
 *     onSeeAllForJob (jobId).
 *   - Renders nothing (returns null) when there are no photos AND no notes.
 *   - The caller decides whether the division-colored mini-header shows by
 *     passing isSingleJob.
 * ════════════════════════════════════════════════
 */
import { DIV_BORDER_COLORS } from '@/pages/tech/techConstants';
import { DivisionIcon } from '@/components/DivisionIcons';
import { fileUrl } from '@/lib/techDateUtils';

// ─── SECTION: Render ──────────────
export default function PhotosGroup({ job, photos, notes, isSingleJob, db, onOpenAlbum, onSeeAllForJob }) {
  if (photos.length === 0 && notes.length === 0) return null;
  const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
  const maxPreview = 3;
  const visible = photos.slice(0, maxPreview);
  const remaining = Math.max(0, photos.length - maxPreview);

  return (
    <div style={{ marginTop: 14 }}>
      {!isSingleJob && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingBottom: 6, marginBottom: 8,
          borderBottom: `2px solid ${divColor}`,
        }}>
          <DivisionIcon type={job.division} size={16} />
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {job.job_number}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
            · {job.division}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
            {notes.length > 0 && ` · ${notes.length} note${notes.length !== 1 ? 's' : ''}`}
          </span>
          {photos.length > 0 && onSeeAllForJob && (
            <button
              onClick={() => onSeeAllForJob(job.id)}
              style={{
                background: 'none', border: 'none', padding: '4px 0 4px 8px',
                color: 'var(--accent)', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              See all →
            </button>
          )}
        </div>
      )}

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {visible.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onOpenAlbum(job.id, i)}
              style={{
                padding: 0, border: '1px solid var(--border-light)', borderRadius: 10,
                aspectRatio: '1', background: 'var(--bg-tertiary)', overflow: 'hidden',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <img
                src={fileUrl(db, p.file_path)}
                alt={p.name || 'Photo'}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </button>
          ))}
          {remaining > 0 ? (
            <button
              onClick={() => onOpenAlbum(job.id, maxPreview)}
              style={{
                padding: 0, border: '1px solid var(--border-light)', borderRadius: 10,
                aspectRatio: '1', background: 'var(--bg-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 2,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>+{remaining}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>more</span>
            </button>
          ) : (
            Array.from({ length: Math.max(0, 4 - visible.length) }).map((_, i) => (
              <div key={`pad-${i}`} style={{ aspectRatio: '1' }} />
            ))
          )}
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.slice(0, 3).map(n => (
            <div key={n.id} style={{
              padding: '8px 12px', borderRadius: 10,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
              fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4,
            }}>
              {n.description || n.name || 'Note'}
            </div>
          ))}
          {notes.length > 3 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              +{notes.length - 3} more note{notes.length - 3 !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
