/**
 * ════════════════════════════════════════════════
 * FILE: FeedbackAttachments.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared photo/video picker used by every feedback form (desktop today,
 *   the tech and admin rebuilds next). Tap Add, pick photos or one short
 *   video, and each file starts uploading immediately — big photos are
 *   shrunk first so they upload fast on weak signal. Each file shows as a
 *   small tile with its progress; a failed one gets a Retry button, and
 *   removing a tile also deletes the already-uploaded file from storage so
 *   nothing is left behind.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared component, not a screen)
 *   Rendered by:  src/pages/Feedback.jsx (desktop) — Sessions B/C will render
 *                 it from the TechFeedback/AdminFeedback rebuilds
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/lib/toast, @/lib/mediaCompress
 *   Data:      reads  → none
 *              writes → job-files storage bucket (direct REST upload/delete
 *                        under feedback/{employeeId}/…) — no tables; the
 *                        parent form owns the insert_tech_feedback call
 *
 * NOTES / GOTCHAS:
 *   - ⚠️ FROZEN for the Feedback Media wave (Phase F owns it — see
 *     docs/feedback-media-roadmap.md ownership matrix). Sessions B and C
 *     consume it as-is; contract changes need a Phase F follow-up.
 *   - Contract: value (array of attachment records — read ONCE on mount to
 *     seed the tiles), onChange(records), onBusyChange(bool — any upload OR
 *     removal still in flight), disabled, caps ({ maxFiles, maxVideos,
 *     maxVideoSeconds } overrides).
 *   - ⚠️ To CLEAR/reset the composer (e.g. after a successful submit),
 *     REMOUNT it with a new `key` — the composer deliberately does not watch
 *     `value` after mount. (A live value-sync effect was removed: its stale
 *     prop closure raced parallel upload completions and silently dropped
 *     freshly-finished tiles while their records stayed in the parent state.)
 *   - Record shape: { path, name, mime, size, original_size, width?, height?,
 *     duration? } — path is bucket-LESS (see mediaCompress.buildStoragePath);
 *     pass records straight to insert_tech_feedback p_attachments.
 *   - Snap-first (tech-mobile-ux rule): upload starts the moment a file is
 *     picked; nothing blocks the pick→save flow. Parents should disable
 *     submit while onBusyChange reports true.
 *   - Removing a DONE tile best-effort-DELETEs the storage object BEFORE
 *     onChange — the old TechFeedback removed the tile but left the uploaded
 *     file orphaned in the bucket forever (live bug this component fixes).
 *     Deliberately single-tap (matches the existing composer UX; the record
 *     isn't submitted yet, so nothing persisted is lost).
 *   - No admin gallery/viewer in here — Session C owns that surface.
 *   - All hit areas ≥ 48px (gloved hands): the ✕ is a 48px transparent
 *     button with a smaller visual disc inside.
 * ════════════════════════════════════════════════
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import {
  MAX_FILES, MAX_VIDEOS, MAX_VIDEO_SECONDS,
  isVideo, buildStoragePath, stripBucketPrefix, formatDuration,
  validateSelection, checkVideoDuration, compressImage, probeVideo,
} from '@/lib/mediaCompress';

// ─── SECTION: Helpers ──────────────

// 'removing' is in-flight on purpose: while the storage DELETE runs, the
// record is still in the parent's value, so submit must stay blocked.
const IN_FLIGHT = ['picked', 'compressing', 'probing', 'uploading', 'removing'];

const STATUS_LABEL = {
  picked: 'Preparing…',
  compressing: 'Shrinking…',
  probing: 'Checking…',
  uploading: 'Uploading…',
  removing: 'Removing…',
};

const publicUrl = (db, path) =>
  `${db.baseUrl}/storage/v1/object/public/job-files/${stripBucketPrefix(path)}`;

const doneRecords = (tiles) =>
  tiles.filter(t => t.status === 'done' && t.record).map(t => t.record);

export default function FeedbackAttachments({ value = [], onChange, onBusyChange, disabled = false, caps = {} }) {
  const { db, employee } = useAuth();
  const fileRef = useRef(null);
  const idRef = useRef(0);
  const tilesRef = useRef(null);

  const maxFiles = caps.maxFiles ?? MAX_FILES;
  const maxVideos = caps.maxVideos ?? MAX_VIDEOS;
  const maxVideoSeconds = caps.maxVideoSeconds ?? MAX_VIDEO_SECONDS;

  // ─── SECTION: State & hooks ──────────────
  // Tiles are the render model: records passed in via `value` seed as done
  // tiles (previewed from the public bucket URL); session picks carry their
  // File + a local object-URL preview through the state machine.
  const [tiles, setTiles] = useState(() => (value || []).map((record, i) => ({
    id: `seed-${i}`,
    status: 'done',
    kind: isVideo(record.mime) ? 'video' : 'image',
    record,
    previewUrl: publicUrl(db, record.path),
    isObjectUrl: false,
    duration: record.duration ?? null,
  })));
  if (tilesRef.current === null) tilesRef.current = tiles;

  // Single mutation door: keeps tilesRef (source of truth for async flows)
  // and the rendered state in lockstep. Only called from handlers/async
  // continuations, never during render.
  const mutate = (fn) => {
    tilesRef.current = fn(tilesRef.current);
    setTiles(tilesRef.current);
  };
  const updateTile = (id, patch) =>
    mutate(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const busy = tiles.some(t => IN_FLIGHT.includes(t.status));
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  // NOTE: there is deliberately NO effect watching `value` — parents reset
  // the composer by remounting it with a new `key` (see header). A prop-sync
  // effect here raced parallel upload completions (stale closure `value` vs
  // live tilesRef) and dropped just-finished tiles.

  // Revoke any leftover object URLs on unmount.
  useEffect(() => () => {
    (tilesRef.current || [])
      .filter(t => t.isObjectUrl && t.previewUrl)
      .forEach(t => URL.revokeObjectURL(t.previewUrl));
  }, []);

  // ─── SECTION: Event handlers ──────────────

  // picked → compressing|probing → uploading → done|failed. A fresh
  // buildStoragePath timestamp on every attempt keeps retries from 409-ing
  // on the object created by a half-finished earlier try.
  const processTile = async (tile) => {
    const { file } = tile;
    try {
      let blob = file;
      let width = null, height = null, duration = null;

      if (tile.kind === 'image') {
        updateTile(tile.id, { status: 'compressing' });
        const out = await compressImage(file);
        blob = out.blob; width = out.width; height = out.height;
      } else {
        updateTile(tile.id, { status: 'probing' });
        const meta = await probeVideo(file);
        duration = meta.duration; width = meta.width; height = meta.height;
        const check = checkVideoDuration(duration, maxVideoSeconds);
        if (!check.ok) throw new Error(check.reason);
      }

      updateTile(tile.id, { status: 'uploading', duration });
      const uploadName = blob !== file
        ? file.name.replace(/\.[^.]*$/, '') + '.jpg' // compressed output is JPEG
        : file.name;
      const path = buildStoragePath(employee.id, uploadName);
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${db.apiKey}`,
          'Content-Type': blob.type || 'application/octet-stream',
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);

      const record = {
        path,
        name: file.name,
        mime: blob.type || file.type,
        size: blob.size,
        original_size: file.size,
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
        ...(duration != null ? { duration: Math.round(duration * 10) / 10 } : {}),
      };
      updateTile(tile.id, { status: 'done', record });
      onChange?.(doneRecords(tilesRef.current));
    } catch (err) {
      updateTile(tile.id, { status: 'failed', error: err.message || 'Upload failed' });
      toast(err.message || 'Upload failed', 'error');
    }
  };

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const existing = tilesRef.current
      .filter(t => t.status !== 'failed')
      .map(t => ({ mime: t.record?.mime || t.file?.type }));
    const { accepted, rejected } = validateSelection(existing, files, { maxFiles, maxVideos });
    rejected.forEach(r => toast(r.reason, 'warning'));

    for (const file of accepted) {
      const tile = {
        id: `t-${++idRef.current}`,
        file,
        kind: isVideo(file.type) ? 'video' : 'image',
        previewUrl: URL.createObjectURL(file),
        isObjectUrl: true,
        status: 'picked',
        record: null,
        error: null,
        duration: null,
      };
      mutate(ts => [...ts, tile]);
      processTile(tile); // snap-first: fire immediately, uploads run in parallel
    }
  };

  const retryTile = (tile) => {
    if (!tile.file) return;
    // Re-earn the slot: failed tiles don't count toward the caps (so users
    // can pick a replacement while one is failed), which means an unchecked
    // retry could push past MAX_FILES/MAX_VIDEOS after a replacement landed.
    const others = tilesRef.current
      .filter(t => t.id !== tile.id && t.status !== 'failed')
      .map(t => ({ mime: t.record?.mime || t.file?.type }));
    const { rejected } = validateSelection(others, [tile.file], { maxFiles, maxVideos });
    if (rejected.length) {
      toast(rejected[0].reason, 'warning');
      return;
    }
    updateTile(tile.id, { status: 'picked', error: null });
    processTile(tile);
  };

  const removeTile = async (tile) => {
    const wasDone = tile.status === 'done';
    if (wasDone && tile.record?.path) {
      // Best-effort storage DELETE BEFORE the record leaves the parent's
      // value — fixes the old composer's orphaned-upload bug. The tile shows
      // 'Removing…' and counts as busy so the form can't submit the
      // half-removed record; the 8s abort keeps weak signal from wedging it.
      // A DELETE failure is accepted on purpose: the purge RPCs are the
      // retention backstop.
      updateTile(tile.id, { status: 'removing' });
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        await fetch(`${db.baseUrl}/storage/v1/object/job-files/${stripBucketPrefix(tile.record.path)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${db.apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timer);
      } catch { /* best-effort */ }
    }
    if (tile.isObjectUrl && tile.previewUrl) URL.revokeObjectURL(tile.previewUrl);
    mutate(ts => ts.filter(t => t.id !== tile.id));
    if (wasDone) onChange?.(doneRecords(tilesRef.current));
  };

  const activeCount = tiles.filter(t => t.status !== 'failed').length;
  const canAdd = !disabled && activeCount < maxFiles;

  // ─── SECTION: Render ──────────────
  return (
    <div className="fbm-attachments">
      <div className="fbm-tiles">
        {tiles.map(tile => (
          <div key={tile.id} className={`fbm-tile fbm-tile-${tile.status}`}>
            {tile.kind === 'video' ? (
              <video className="fbm-tile-media" src={tile.previewUrl || undefined} muted playsInline preload="metadata" />
            ) : (
              <img className="fbm-tile-media" src={tile.previewUrl || undefined} alt={tile.record?.name || tile.file?.name || 'Attachment'} />
            )}

            {IN_FLIGHT.includes(tile.status) && (
              <div className="fbm-tile-overlay">
                <div className="fbm-spinner" />
                <span className="fbm-tile-status">{STATUS_LABEL[tile.status]}</span>
              </div>
            )}

            {tile.status === 'failed' && (
              /* the whole tile is the Retry hit area (104px ≥ 48px) */
              tile.file ? (
                <button type="button" className="fbm-tile-overlay fbm-tile-overlay-failed fbm-retry-btn" onClick={() => retryTile(tile)}>
                  <span className="fbm-tile-status">{tile.error || 'Failed'}</span>
                  <span className="fbm-retry-label">Tap to retry</span>
                </button>
              ) : (
                <div className="fbm-tile-overlay fbm-tile-overlay-failed">
                  <span className="fbm-tile-status">{tile.error || 'Failed'}</span>
                </div>
              )
            )}

            {tile.kind === 'video' && formatDuration(tile.duration ?? tile.record?.duration) && (
              <span className="fbm-duration-chip">{formatDuration(tile.duration ?? tile.record?.duration)}</span>
            )}

            {(tile.status === 'done' || tile.status === 'failed') && !disabled && (
              <button
                type="button"
                className="fbm-remove-btn"
                aria-label={`Remove ${tile.record?.name || tile.file?.name || 'attachment'}`}
                onClick={() => removeTile(tile)}
              >
                <span className="fbm-remove-disc">{'✕'}</span>
              </button>
            )}
          </div>
        ))}

        {canAdd && (
          <button
            type="button"
            className="fbm-add-tile"
            onClick={() => fileRef.current?.click()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>Add photo<br />or video</span>
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
    </div>
  );
}
