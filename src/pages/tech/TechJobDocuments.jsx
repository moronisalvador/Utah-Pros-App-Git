/**
 * ════════════════════════════════════════════════
 * FILE: TechJobDocuments.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Documents" screen for a single job, as a field technician sees it. It
 *   lists the job's e-signature requests grouped by state — awaiting signature,
 *   signed, and cancelled — and lets the tech open a signed PDF, resend or copy
 *   a pending link, or cancel a request. A big "Request signature" button at the
 *   bottom opens a panel to send a new Work Authorization or Certificate of
 *   Completion for signing, either on the spot or by email.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/jobs/:jobId/documents
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/lib/realtime (getAuthHeader),
 *              @/lib/toast, ./techConstants,
 *              @/components/tech/EsignRequestSheet
 *   Data:      All access goes through the db client from useAuth.
 *              reads  → jobs, contact_jobs, contacts, sign_requests (direct db.select)
 *              writes → sign_requests (db.update — cancel; and indirectly via the
 *                        send/resend e-sign workers)
 *
 * NOTES / GOTCHAS:
 *   - Backend is shared with desktop: POST /api/send-esign (new request),
 *     POST /api/resend-esign (reminder). Nothing here changes the schema.
 *   - Navigating in with history state { startEsign: 'work_auth' } (from the
 *     job page's "no signed Work Auth" banner) auto-opens the request sheet on
 *     that doc type.
 *   - Reloads sign requests on tab re-focus so a freshly collected signature
 *     (signed on /sign/:token, then Back) shows up without a manual refresh.
 *   - Curated to two doc types; legacy rows of other types still render via a
 *     titleCased fallback label.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { toast } from '@/lib/toast';
import { DIV_GRADIENTS } from './techConstants';
import EsignRequestSheet from '@/components/tech/EsignRequestSheet';

// ─── SECTION: Helpers ──────────────
const DOC_TYPE_LABELS = {
  work_auth: 'Work Authorization',
  coc: 'Certificate of Completion',
};

function docTypeLabel(t) {
  if (DOC_TYPE_LABELS[t]) return DOC_TYPE_LABELS[t];
  if (!t) return 'Document';
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ');
}

function fmtDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const STATUS_PILL = {
  signed:    { label: 'Signed',            bg: '#ecfdf5', color: '#059669', border: '#a7f3d0', dot: '#059669' },
  pending:   { label: 'Awaiting signature', bg: '#fffbeb', color: '#d97706', border: '#fde68a', dot: '#d97706' },
  cancelled: { label: 'Cancelled',          bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb', dot: '#9ca3af' },
};

export default function TechJobDocuments() {
  // ─── SECTION: State & hooks ──────────────
  const { jobId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { db, employee } = useAuth();

  const [job, setJob] = useState(null);
  const [contact, setContact] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Inline action state
  const [copiedToken, setCopiedToken] = useState(null);
  const [resending, setResending] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);

  // Request sheet — auto-open on the doc type passed via history state (banner)
  const [esignOpen, setEsignOpen] = useState(() => !!location.state?.startEsign);
  const [esignDocType] = useState(() => location.state?.startEsign || 'work_auth');

  // ─── SECTION: Data fetching ──────────────
  const loadRequests = useCallback(async () => {
    const rows = await db.select('sign_requests', `job_id=eq.${jobId}&order=sent_at.desc`).catch(() => []);
    setRequests(rows || []);
    return rows || [];
  }, [db, jobId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await db.select('jobs', `id=eq.${jobId}&select=id,job_number,division,insured_name,client_email,address,city,state`);
      const j = rows?.[0];
      if (!j) { setLoadError('Job not found'); return; }
      setJob(j);

      // Primary contact for signer pre-fill (mirrors SendEsignModal)
      let primary = null;
      try {
        let cid = null;
        for (const filter of ['is_primary=eq.true&', '']) {
          const cj = await db.select('contact_jobs', `job_id=eq.${jobId}&${filter}limit=1&select=contact_id`);
          cid = cj?.[0]?.contact_id;
          if (cid) break;
        }
        if (cid) {
          const cs = await db.select('contacts', `id=eq.${cid}&select=id,name,email`);
          primary = cs?.[0] || null;
        }
      } catch { /* fall back to job fields below */ }
      setContact(primary);

      await loadRequests();
    } catch (e) {
      setLoadError(e.message || 'Failed to load documents');
      toast('Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobId, loadRequests]);

  useEffect(() => { load(); }, [load]);

  // Refresh when returning to the tab (e.g. back from the signing page)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadRequests(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadRequests]);

  // ─── SECTION: Event handlers ──────────────
  const pdfUrl = (path) => `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/job-files/${path}`;

  const copyLink = (token) => {
    navigator.clipboard.writeText(`${window.location.origin}/sign/${token}`)
      .then(() => { setCopiedToken(token); setTimeout(() => setCopiedToken(null), 2000); })
      .catch(() => toast('Could not copy link', 'error'));
  };

  const resend = async (sr) => {
    setResending(sr.id);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/resend-esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ sign_request_id: sr.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to resend');
      toast(json.email_error ? `Email failed: ${json.email_error_detail || 'unknown error'}` : `Reminder sent to ${sr.signer_email}`, json.email_error ? 'error' : 'success');
      loadRequests();
    } catch (e) {
      toast('Resend failed: ' + e.message, 'error');
    } finally {
      setResending(null);
    }
  };

  const cancelReq = async (sr) => {
    if (confirmCancel !== sr.id) { setConfirmCancel(sr.id); return; }
    setConfirmCancel(null);
    try {
      await db.update('sign_requests', `id=eq.${sr.id}`, { status: 'cancelled', updated_at: new Date().toISOString() });
      toast('Request cancelled');
      loadRequests();
    } catch (e) {
      toast('Failed to cancel: ' + e.message, 'error');
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (!job) {
    return (
      <div className="tech-page">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {loadError || 'Documents not available'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate(`/tech/jobs/${jobId}`)}>Back</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const division = job.division || 'water';
  const tint = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const insuredName = job.insured_name || 'Unknown';

  const signed = requests.filter(r => r.status === 'signed');
  const pending = requests.filter(r => r.status === 'pending');
  const cancelled = requests.filter(r => r.status === 'cancelled' || r.status === 'expired');

  const signerPrefill = {
    name: contact?.name || job.insured_name || '',
    email: contact?.email || job.client_email || '',
    contactId: contact?.id || null,
  };

  const groupLabel = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
    textTransform: 'uppercase', letterSpacing: '0.06em', margin: '18px 0 8px',
  };

  const actionBtn = {
    minHeight: 44, padding: '0 12px', borderRadius: 10,
    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
    border: '1px solid var(--border-light)', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    WebkitTapHighlightColor: 'transparent', textDecoration: 'none',
  };

  const renderRow = (sr) => {
    const pill = STATUS_PILL[sr.status] || STATUS_PILL.cancelled;
    const dateLine = sr.status === 'signed'
      ? `Signed ${fmtDate(sr.signed_at)}`
      : sr.status === 'pending'
        ? `Sent ${fmtDate(sr.sent_at)}`
        : fmtDate(sr.sent_at);
    return (
      <div key={sr.id} style={{
        padding: '12px 14px', background: 'var(--bg-primary)',
        border: '1px solid var(--border-light)', borderRadius: 14, marginBottom: 8,
        boxShadow: 'var(--tech-shadow-card, 0 1px 3px rgba(0,0,0,0.06))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: pill.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
            {docTypeLabel(sr.doc_type)}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
            background: pill.bg, color: pill.color, border: `1px solid ${pill.border}`, whiteSpace: 'nowrap',
          }}>
            {pill.label}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {sr.signer_name}{sr.signer_email && !sr.signer_email.endsWith('@noemail.local') ? ` · ${sr.signer_email}` : ''}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>{dateLine}</div>

        {sr.status === 'pending' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <button type="button" style={actionBtn} onClick={() => resend(sr)} disabled={resending === sr.id}>
              {resending === sr.id ? 'Sending…' : 'Resend'}
            </button>
            <button type="button" style={actionBtn} onClick={() => copyLink(sr.token)}>
              {copiedToken === sr.token ? 'Copied!' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={() => cancelReq(sr)}
              onBlur={() => setConfirmCancel(null)}
              style={{
                ...actionBtn,
                background: confirmCancel === sr.id ? '#fef2f2' : 'var(--bg-tertiary)',
                color: confirmCancel === sr.id ? '#dc2626' : 'var(--text-tertiary)',
                border: `1px solid ${confirmCancel === sr.id ? '#fecaca' : 'var(--border-light)'}`,
              }}
            >
              {confirmCancel === sr.id ? 'Confirm cancel' : 'Cancel'}
            </button>
          </div>
        )}

        {sr.status === 'signed' && sr.signed_file_path && (
          <div style={{ marginTop: 10 }}>
            <a href={pdfUrl(sr.signed_file_path)} target="_blank" rel="noopener noreferrer" style={{ ...actionBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
              View PDF
            </a>
          </div>
        )}
      </div>
    );
  };

  const isEmpty = requests.length === 0;

  return (
    <div className="tech-page tech-page-enter" style={{ padding: 0 }}>
      {/* Slim top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px var(--space-4)',
        borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(`/tech/jobs/${jobId}`)}
          aria-label="Back to job"
          style={{
            background: 'none', border: 'none', color: 'var(--text-primary)',
            cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
            minWidth: 48, minHeight: 44, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            Documents
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {job.job_number} · {insuredName}
          </div>
        </div>
        {!isEmpty && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 'var(--radius-full)',
            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
          }}>
            {requests.length}
          </span>
        )}
      </div>

      <div style={{ height: 4, background: tint }} />

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '4px var(--space-4) calc(132px + env(safe-area-inset-bottom, 0px))',
      }}>
        {isEmpty ? (
          <div style={{ textAlign: 'center', padding: '64px 16px', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 44, opacity: 0.4, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              No documents yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              Tap "Request signature" to send one.
            </div>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <div style={groupLabel}>Awaiting signature</div>
                {pending.map(renderRow)}
              </>
            )}
            {signed.length > 0 && (
              <>
                <div style={groupLabel}>Signed</div>
                {signed.map(renderRow)}
              </>
            )}
            {cancelled.length > 0 && (
              <>
                <div style={groupLabel}>Cancelled</div>
                <div style={{ opacity: 0.6 }}>{cancelled.map(renderRow)}</div>
              </>
            )}
          </>
        )}
      </div>

      {/* Pinned Request signature */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))',
        padding: '10px var(--space-4)',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, var(--bg-primary) 40%)',
        pointerEvents: 'none',
      }}>
        <button
          onClick={() => setEsignOpen(true)}
          style={{
            pointerEvents: 'auto', width: '100%', minHeight: 52,
            borderRadius: 14, background: 'var(--accent)', color: '#fff',
            border: 'none', cursor: 'pointer',
            fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
            boxShadow: '0 6px 20px rgba(37, 99, 235, 0.35)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Request signature
        </button>
      </div>

      <EsignRequestSheet
        open={esignOpen}
        onClose={() => setEsignOpen(false)}
        job={job}
        signerPrefill={signerPrefill}
        employeeId={employee?.id || null}
        initialDocType={esignDocType}
        onSent={loadRequests}
      />
    </div>
  );
}
