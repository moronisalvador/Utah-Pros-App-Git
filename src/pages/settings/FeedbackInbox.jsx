/**
 * ════════════════════════════════════════════════
 * FILE: FeedbackInbox.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The owner's inbox for feedback that employees send in — bug reports and
 *   improvement ideas, now with photos AND videos attached. This screen lists
 *   every item, lets you filter by type and status, open one to read the full
 *   description, watch/enlarge its media, jot private admin notes (kept
 *   separate per item), and change its status. It also lets you permanently
 *   delete an item's media — either one item at a time or every eligible one at
 *   once — with a two-click confirm, since deleting stored files can't be undone.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/feedback  (AdminRoute — owner/admin only; the old
 *                  /tech-feedback URL permanently redirects here)
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), src/lib/mediaCompress.js
 *              (stripBucketPrefix, formatBytes, isVideo)
 *   Data:      reads  → tech_feedback (via get_tech_feedback RPC), storage
 *                       bucket job-files (feedback/ prefix, public URLs)
 *              writes → tech_feedback status/notes (update_tech_feedback RPC),
 *                       attachments_purged_at (mark_feedback_attachments_purged
 *                       RPC) + storage object DELETEs on manual purge
 *
 * NOTES / GOTCHAS:
 *   - Attachment paths in `attachments` are bucket-LESS; legacy `screenshots`
 *     carry the "job-files/" prefix. stripBucketPrefix normalizes both before
 *     building the public URL, so old and new rows render identically.
 *   - Manual purge deletes storage objects one-by-one with the anon-key DELETE
 *     pattern (mirrors JobPage.jsx), then stamps attachments_purged_at. The
 *     background worker (functions/api/purge-feedback-media.js) is the
 *     automatable path; this button is the day-1 trigger. Once purged, the
 *     files are gone for good — the "attachments purged" state shows even if the
 *     item is later reopened (attachments_purged_at is never cleared).
 *   - Admin notes are drafted per-row (drafts[id]); the previous shared-state
 *     version could save one row's note onto another. Do not reintroduce a
 *     single shared note string.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { stripBucketPrefix, formatBytes, isVideo } from '@/lib/mediaCompress';
import { api } from '@/lib/api';

const TYPE_BADGE = {
  bug:     { cls: 'fb-badge-bug', label: 'Bug' },
  feature: { cls: 'fb-badge-feature', label: 'Improvement' },
};

const STATUS_BADGE = {
  new:       { cls: 'fb-badge-new', label: 'New' },
  reviewed:  { cls: 'fb-badge-reviewed', label: 'Reviewed' },
  resolved:  { cls: 'fb-badge-resolved', label: 'Resolved' },
  dismissed: { cls: 'fb-badge-dismissed', label: 'Dismissed' },
};

const SOURCE_LABEL = { desktop: 'Desktop', tech: 'Tech app' };
const STATUSES = ['new', 'reviewed', 'resolved', 'dismissed'];
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)$/i;

function Badge({ map, value }) {
  const s = map[value] || map.new;
  return <span className={`fb-badge ${s.cls}`}>{s.label}</span>;
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const mins = Math.floor((now - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

export default function AdminFeedback() {
  const { db } = useAuth();
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');            // 'all' | 'bug' | 'feature'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | status value
  const [expanded, setExpanded] = useState(null);          // expanded row id
  const [updating, setUpdating] = useState(null);          // id being status/note-updated
  const [drafts, setDrafts] = useState({});                // per-row admin note drafts { [id]: text }
  const [confirmPurge, setConfirmPurge] = useState(null);  // two-click: id | 'all' | null
  const [purging, setPurging] = useState(null);            // id | 'all' | null (in flight)
  const [viewer, setViewer] = useState(null);              // { url, isVid, name } | null

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_tech_feedback');
      setFeedbacks(rows || []);
    } catch {
      errToast('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Helpers ──────────────
  const publicUrl = (bucketlessPath) => `${db.baseUrl}/storage/v1/object/public/job-files/${bucketlessPath}`;

  // Bucket-less storage paths for an item — attachments first, legacy screenshots as fallback.
  const rawPaths = (item) => {
    const atts = Array.isArray(item.attachments) ? item.attachments : [];
    const fromAtts = atts.map(a => stripBucketPrefix(a?.path || '')).filter(Boolean);
    if (fromAtts.length) return fromAtts;
    const shots = Array.isArray(item.screenshots) ? item.screenshots : [];
    return shots.map(s => stripBucketPrefix(String(s))).filter(Boolean);
  };

  // Renderable media (url + name/size/compression + video flag).
  const mediaItems = (item) => {
    const atts = Array.isArray(item.attachments) ? item.attachments : [];
    if (atts.length) {
      return atts.map((a, i) => {
        const path = stripBucketPrefix(a?.path || '');
        return {
          key: i, path, url: publicUrl(path),
          name: a?.name || path.split('/').pop() || 'file',
          size: a?.size, original_size: a?.original_size,
          isVid: isVideo(a?.mime) || VIDEO_EXT.test(path),
        };
      }).filter(m => m.path);
    }
    const shots = Array.isArray(item.screenshots) ? item.screenshots : [];
    return shots.map((s, i) => {
      const path = stripBucketPrefix(String(s));
      return { key: i, path, url: publicUrl(path), name: path.split('/').pop() || 'file', isVid: VIDEO_EXT.test(path) };
    }).filter(m => m.path);
  };

  const isPurgeEligible = (f) =>
    ['resolved', 'dismissed'].includes(f.status) && !f.attachments_purged_at && rawPaths(f).length > 0;

  const setDraft = (id, text) => setDrafts(prev => ({ ...prev, [id]: text }));
  const draftFor = (item) => (drafts[item.id] !== undefined ? drafts[item.id] : (item.admin_notes || ''));

  // ─── SECTION: Event handlers ──────────────
  const handleStatusChange = async (item, newStatus) => {
    setUpdating(item.id);
    try {
      await db.rpc('update_tech_feedback', {
        p_id: item.id,
        p_status: newStatus,
        p_admin_notes: draftFor(item).trim() || null,
      });
      okToast(`Marked as ${STATUS_BADGE[newStatus].label}`);
      // Let the submitting tech know their feedback was resolved (push + email).
      // Fire-and-forget — a notify hiccup must never fail the status change.
      if (newStatus === 'resolved') {
        api('feedback-resolved-notify', { body: { feedback_id: item.id } }).catch(() => {});
      }
      await load();
      setDrafts(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    } catch (e) {
      errToast('Failed to update: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  const handleSaveNote = async (item) => {
    setUpdating(item.id);
    try {
      await db.rpc('update_tech_feedback', {
        p_id: item.id,
        p_status: item.status,                 // unchanged status — just persist the note
        p_admin_notes: draftFor(item).trim() || null,
      });
      okToast('Note saved');
      await load();
      setDrafts(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    } catch (e) {
      errToast('Failed to save note: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  // Best-effort per-object DELETE (anon key) mirroring JobPage.jsx, then stamp purged.
  const deletePaths = async (paths) => {
    for (const p of paths) {
      await fetch(`${db.baseUrl}/storage/v1/object/job-files/${p}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${db.apiKey}`, apikey: db.apiKey },
      });
    }
  };

  const purgeItem = async (item) => {
    if (confirmPurge !== item.id) { setConfirmPurge(item.id); return; }
    setConfirmPurge(null);
    setPurging(item.id);
    try {
      await deletePaths(rawPaths(item));
      await db.rpc('mark_feedback_attachments_purged', { p_id: item.id });
      okToast('Attachments purged');
      setFeedbacks(prev => prev.map(f =>
        f.id === item.id ? { ...f, attachments_purged_at: new Date().toISOString() } : f));
    } catch (e) {
      errToast('Purge failed: ' + e.message);
    } finally {
      setPurging(null);
    }
  };

  const purgeAllEligible = async () => {
    if (confirmPurge !== 'all') { setConfirmPurge('all'); return; }
    setConfirmPurge(null);
    const eligible = feedbacks.filter(isPurgeEligible);
    if (!eligible.length) return;
    setPurging('all');
    try {
      for (const item of eligible) {
        await deletePaths(rawPaths(item));
        await db.rpc('mark_feedback_attachments_purged', { p_id: item.id });
      }
      okToast(`Purged media for ${eligible.length} item${eligible.length > 1 ? 's' : ''}`);
      await load();
    } catch (e) {
      errToast('Sweep failed: ' + e.message);
    } finally {
      setPurging(null);
    }
  };

  // ─── SECTION: Derived ──────────────
  const filtered = feedbacks.filter(f => {
    if (filter !== 'all' && f.type !== filter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    return true;
  });

  const counts = {
    all: feedbacks.length,
    bug: feedbacks.filter(f => f.type === 'bug').length,
    feature: feedbacks.filter(f => f.type === 'feature').length,
    new: feedbacks.filter(f => f.status === 'new').length,
  };
  const eligibleCount = feedbacks.filter(isPurgeEligible).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
        Loading feedback...
      </div>
    );
  }

  // ─── SECTION: Render ──────────────
  return (
    <div className="admin-page" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Feedback Inbox
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            Bug reports and improvement ideas from the team
          </p>
        </div>
        {eligibleCount > 0 && (
          <button
            onClick={purgeAllEligible}
            onBlur={() => setConfirmPurge(c => (c === 'all' ? null : c))}
            disabled={purging === 'all'}
            className="fb-purge-btn"
            data-armed={confirmPurge === 'all'}
          >
            {purging === 'all'
              ? 'Purging…'
              : confirmPurge === 'all'
                ? `Confirm — purge ${eligibleCount} eligible`
                : `Purge all eligible media (${eligibleCount})`}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-4)', alignItems: 'center' }}>
        {[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'bug', label: 'Bugs', count: counts.bug },
          { key: 'feature', label: 'Improvements', count: counts.feature },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              height: 32, padding: '0 12px', borderRadius: 'var(--radius-full)',
              border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border-color)'}`,
              background: filter === f.key ? 'var(--accent-light)' : 'var(--bg-primary)',
              color: filter === f.key ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {f.label}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-full)',
              background: filter === f.key ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: filter === f.key ? 'var(--accent-text)' : 'var(--text-tertiary)',
            }}>
              {f.count}
            </span>
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            height: 32, padding: '0 28px 0 10px', borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
            color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
            fontFamily: 'var(--font-sans)', cursor: 'pointer', appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235f6672' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
          }}
        >
          <option value="all">All statuses</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_BADGE[s].label}</option>
          ))}
        </select>

        {counts.new > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fb-badge-new-color)', marginLeft: 'auto' }}>
            {counts.new} new
          </span>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 16px', color: 'var(--text-tertiary)',
          fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        }}>
          No feedback items match the current filters.
        </div>
      ) : (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          {/* Desktop table header */}
          <div className="admin-feedback-header" style={{
            display: 'grid', gridTemplateColumns: '110px 1fr 120px 90px 100px',
            padding: '8px 16px', background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            <span>Type</span>
            <span>Title</span>
            <span>Submitted By</span>
            <span>Status</span>
            <span>When</span>
          </div>

          {/* Rows */}
          {filtered.map((item, idx) => {
            const isExpanded = expanded === item.id;
            const purged = !!item.attachments_purged_at;
            const media = purged ? [] : mediaItems(item);
            const hasMedia = rawPaths(item).length > 0;
            return (
              <div key={item.id}>
                {/* Row */}
                <div
                  className="fb-row"
                  onClick={() => setExpanded(isExpanded ? null : item.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '110px 1fr 120px 90px 100px',
                    alignItems: 'center', padding: '12px 16px',
                    borderBottom: (idx < filtered.length - 1 || isExpanded) ? '1px solid var(--border-light)' : 'none',
                    background: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                >
                  <span><Badge map={TYPE_BADGE} value={item.type} /></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', paddingRight: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    {hasMedia && (
                      <span title={purged ? 'Attachments purged' : 'Has attachments'} style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 700, color: purged ? 'var(--text-tertiary)' : 'var(--accent)',
                      }}>
                        {purged ? '⛌' : '❏'}
                      </span>
                    )}
                  </span>
                  <span className="fb-hide-mobile" style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.employee_name}
                  </span>
                  <span><Badge map={STATUS_BADGE} value={item.status} /></span>
                  <span className="fb-hide-mobile" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {timeAgo(item.created_at)}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{
                    padding: '16px 20px 20px', background: 'var(--bg-secondary)',
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}>
                    <div className="fb-detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>
                      {/* Left: details */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-light)',
                          }}>
                            via {SOURCE_LABEL[item.source] || SOURCE_LABEL.tech}
                          </span>
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                          Description
                        </div>
                        <div style={{
                          fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
                          padding: '10px 14px', background: 'var(--bg-primary)',
                          borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                          minHeight: 48, whiteSpace: 'pre-wrap',
                        }}>
                          {item.description || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No description provided</span>}
                        </div>

                        {/* Attachments */}
                        {purged ? (
                          <div style={{
                            marginTop: 16, display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic',
                            padding: '10px 14px', background: 'var(--bg-primary)',
                            border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)',
                          }}>
                            Attachments purged{item.attachments_purged_at ? ` on ${formatDate(item.attachments_purged_at)}` : ''} — the files are gone for good.
                          </div>
                        ) : media.length > 0 && (
                          <div style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                Attachments ({media.length})
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); purgeItem(item); }}
                                onBlur={() => setConfirmPurge(c => (c === item.id ? null : c))}
                                disabled={purging === item.id}
                                className="fb-purge-btn fb-purge-btn-sm"
                                data-armed={confirmPurge === item.id}
                              >
                                {purging === item.id ? 'Purging…' : confirmPurge === item.id ? 'Confirm purge' : 'Purge media'}
                              </button>
                            </div>
                            <div className="fb-media-grid">
                              {media.map((m) => (
                                <div key={m.key} className="fb-media-tile">
                                  {m.isVid ? (
                                    <video
                                      src={m.url}
                                      controls
                                      preload="metadata"
                                      className="fb-media-el"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setViewer({ url: m.url, isVid: false, name: m.name }); }}
                                      className="fb-media-imgbtn"
                                    >
                                      <img src={m.url} alt={m.name} className="fb-media-el" />
                                    </button>
                                  )}
                                  <div className="fb-media-meta">
                                    <span className="fb-media-name" title={m.name}>{m.name}</span>
                                    <span className="fb-media-size">
                                      {Number.isFinite(m.original_size) && Number.isFinite(m.size) && m.original_size > m.size
                                        ? `${formatBytes(m.original_size)} → ${formatBytes(m.size)}`
                                        : (Number.isFinite(m.size) ? formatBytes(m.size) : '')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>
                          Submitted {formatDate(item.created_at)} by {item.employee_name}
                        </div>
                      </div>

                      {/* Right: admin actions */}
                      <div style={{
                        padding: '14px 16px', background: 'var(--bg-primary)',
                        borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                        alignSelf: 'start',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                          Update Status
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                          {STATUSES.map(s => (
                            <button
                              key={s}
                              disabled={updating === item.id}
                              onClick={(e) => { e.stopPropagation(); handleStatusChange(item, s); }}
                              className={`fb-status-btn ${item.status === s ? STATUS_BADGE[s].cls : ''}`}
                              style={{ opacity: updating === item.id ? 0.5 : 1 }}
                            >
                              {STATUS_BADGE[s].label}
                            </button>
                          ))}
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                          Admin Notes
                        </div>
                        <textarea
                          value={draftFor(item)}
                          onChange={e => setDraft(item.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          placeholder="Add a note..."
                          rows={3}
                          style={{
                            width: '100%', padding: '8px 10px', fontSize: 12,
                            borderRadius: 'var(--radius-md)', resize: 'vertical',
                            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
                            outline: 'none', boxSizing: 'border-box', lineHeight: 1.5,
                          }}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSaveNote(item); }}
                          disabled={updating === item.id || draftFor(item).trim() === (item.admin_notes || '').trim()}
                          style={{
                            marginTop: 8, height: 30, padding: '0 14px', borderRadius: 'var(--radius-md)',
                            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)',
                            cursor: (updating === item.id || draftFor(item).trim() === (item.admin_notes || '').trim()) ? 'default' : 'pointer',
                            opacity: (updating === item.id || draftFor(item).trim() === (item.admin_notes || '').trim()) ? 0.5 : 1,
                          }}
                        >
                          Save note
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox viewer (own — not the tech-scoped Lightbox) */}
      {viewer && (
        <div
          className="fb-lightbox"
          onClick={() => setViewer(null)}
          role="dialog"
          aria-modal="true"
        >
          <button className="fb-lightbox-close" onClick={() => setViewer(null)} aria-label="Close">×</button>
          <img
            src={viewer.url}
            alt={viewer.name}
            className="fb-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
