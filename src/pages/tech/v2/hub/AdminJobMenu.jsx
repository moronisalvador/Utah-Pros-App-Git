/**
 * ════════════════════════════════════════════════
 * FILE: AdminJobMenu.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The admin/manager "•••" menu for a job in the Job Hub. It slides up from the
 *   bottom with two actions: merge this job into another, or delete (archive) it.
 *   Deleting asks the admin to type the word DELETE first, then soft-deletes the
 *   job (it's archived and restorable, not truly gone) and returns to the claim.
 *   Only admins and managers ever see this; everyone else never gets the menu.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/components/MergeModal, @/lib/toast
 *   Data:      writes → jobs (direct db.update — status='deleted' soft delete);
 *              merging is handled inside MergeModal
 *
 * NOTES / GOTCHAS:
 *   - Delete is a SOFT delete (status='deleted'), gated behind a typed "DELETE"
 *     confirmation — ported verbatim from the legacy TechJobDetail so the guard
 *     is unchanged through the merge.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import MergeModal from '@/components/MergeModal';
import { toast } from '@/lib/toast';

export default function AdminJobMenu({ open, onClose, job, claim, onMerged }) {
  const { t } = useTranslation('hub');
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const [showMerge, setShowMerge] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSoftDelete = async () => {
    setDeleting(true);
    try {
      await db.update('jobs', `id=eq.${job.id}`, { status: 'deleted', updated_by: employee?.id || null });
      toast(t('admin.archived', { number: job?.job_number || '' }));
      navigate(claim ? `/tech/claims/${claim.id}` : '/tech/claims', { replace: true });
    } catch (err) {
      toast(t('admin.deleteFailed', { message: err.message }), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-primary)', width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -4px 20px rgba(0,0,0,0.12)' }}
          >
            <div style={{ width: 36, height: 4, background: 'var(--border-color)', borderRadius: 2, margin: '0 auto 12px' }} />
            <button
              onClick={() => { onClose(); setShowMerge(true); }}
              style={{ width: '100%', minHeight: 56, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid var(--border-light)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'var(--font-sans)', WebkitTapHighlightColor: 'transparent', textAlign: 'left' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7 17 17 7" /><polyline points="7 7 17 17" /><circle cx="12" cy="12" r="10" />
              </svg>
              {t('admin.mergeJob')}
            </button>
            <button
              onClick={() => { onClose(); setDeleteOpen(true); setDeleteInput(''); }}
              style={{ width: '100%', minHeight: 56, padding: '14px 16px', borderRadius: 12, background: 'var(--status-paused-bg)', border: '1px solid var(--status-paused-border)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, color: 'var(--status-paused-color)', cursor: 'pointer', fontFamily: 'var(--font-sans)', WebkitTapHighlightColor: 'transparent', textAlign: 'left' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              </svg>
              {t('admin.deleteJob')}
            </button>
            <button
              onClick={onClose}
              style={{ marginTop: 14, width: '100%', minHeight: 44, borderRadius: 10, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)' }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {showMerge && (
        <MergeModal
          type="job"
          keepRecord={job}
          onClose={() => setShowMerge(false)}
          onMerged={() => { setShowMerge(false); onMerged?.(); }}
        />
      )}

      {deleteOpen && (
        <div
          onClick={() => { if (!deleting) { setDeleteOpen(false); setDeleteInput(''); } }}
          style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-primary)', width: '100%', maxWidth: 420, borderRadius: 16, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)' }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--status-paused-color)', marginBottom: 10 }}>{t('admin.deleteTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{job.job_number}</strong> — {t('admin.archiveBody')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {t('admin.typeConfirm', { word: 'DELETE' })}
            </div>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              autoFocus
              placeholder="DELETE"
              style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-mono)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => { setDeleteOpen(false); setDeleteInput(''); }}
                disabled={deleting}
                style={{ padding: '10px 18px', minHeight: 44, borderRadius: 10, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', cursor: deleting ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSoftDelete}
                disabled={deleteInput !== 'DELETE' || deleting}
                style={{ padding: '10px 18px', minHeight: 44, borderRadius: 10, background: deleteInput === 'DELETE' ? 'var(--status-paused-color)' : 'var(--bg-tertiary)', color: deleteInput === 'DELETE' ? '#fff' : 'var(--text-tertiary)', border: 'none', cursor: deleteInput === 'DELETE' && !deleting ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting ? t('admin.deleting') : t('admin.deleteTitle')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
