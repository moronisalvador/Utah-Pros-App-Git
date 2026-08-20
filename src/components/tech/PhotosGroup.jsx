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
 *              @/hooks/useSignedUrls (useSignedUrls — mints a short-lived
 *              Storage link for each photo path)
 *   Data:      reads  → Supabase Storage sign endpoint (photos + notes
 *                        themselves arrive as props)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Props: job, photos (array), notes (array), isSingleJob (hides the
 *     mini-header when true), onOpenAlbum (jobId, index),
 *     onSeeAllForJob (jobId). Callers still pass a `db` prop; it is no longer
 *     read, because URLs come from useSignedUrls now.
 *   - The signing hook runs BEFORE the "nothing to show" early return. Moving
 *     it below that return would call a hook conditionally.
 *   - Renders nothing (returns null) when there are no photos AND no notes.
 *   - The caller decides whether the division-colored mini-header shows by
 *     passing isSingleJob.
 * ════════════════════════════════════════════════
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DIV_BORDER_COLORS } from '@/pages/tech/techConstants';
import { DivisionIcon } from '@/components/DivisionIcons';
import { useSignedUrls } from '@/hooks/useSignedUrls';

const MAX_PREVIEW = 3;

// ─── SECTION: Render ──────────────
export default function PhotosGroup({ job, photos, notes, isSingleJob, onOpenAlbum, onSeeAllForJob }) {
  const { t } = useTranslation('tech');
  // Only the tiles actually on screen are signed — the "+N more" tile opens the
  // album, which signs its own set.
  const previewPaths = useMemo(
    () => (photos || []).slice(0, MAX_PREVIEW).map((p) => p.file_path),
    [photos],
  );
  const { urls } = useSignedUrls(previewPaths);
  if (photos.length === 0 && notes.length === 0) return null;
  const divColor = DIV_BORDER_COLORS[job.division] || 'var(--neutral)';
  const maxPreview = MAX_PREVIEW;
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
            · {job.division ? t('division.' + job.division, { defaultValue: job.division }) : ''}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            {t('photos.photoCount', { count: photos.length })}
            {notes.length > 0 && ` · ${t('photos.noteCount', { count: notes.length })}`}
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
              {t('btn.seeAll')}
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
                src={urls.get(p.file_path)}
                alt={p.name || t('photos.photoAlt')}
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
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>{t('photos.more')}</span>
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
              {n.description || n.name || t('photos.noteFallback')}
            </div>
          ))}
          {notes.length > 3 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {t('photos.moreNotes', { count: notes.length - 3 })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
