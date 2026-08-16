/**
 * ════════════════════════════════════════════════
 * FILE: TechJobDocuments.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Documents" screen for a single job, as a field technician sees it. It
 *   lists the job's e-signature requests grouped by state — awaiting signature,
 *   signed, and cancelled — and lets the tech open a signed PDF, resend or copy
 *   a pending link, or cancel a request. A big "New document" button at the
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
 *              @/components/tech/EsignRequestSheet, @/lib/publicSigningUrl,
 *              @/lib/backNav, @/components/tech/v2/nav (jobHref),
 *              @/hooks/useResumeRefetch, @/components/ui (StatusPill)
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
 *   - Reloads sign requests on a hidden→visible resume so a freshly collected
 *     signature (signed on /sign/:token, then Back) shows up without a manual
 *     refresh. That goes through the shared useResumeRefetch hook, never a
 *     hand-rolled visibilitychange listener (page-lifecycle.md §2).
 *   - The sheet sends two primary doc types plus six fixed-wording situational
 *     authorizations; the label map here is complete for ALL types, because this
 *     list also shows requests the office sent from the desktop modal. Unknown
 *     types still render via a titleCased fallback.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { toast } from '@/lib/toast';
import { DIV_GRADIENTS } from './techConstants';
import EsignRequestSheet from '@/components/tech/EsignRequestSheet';
import { publicSigningUrl } from '@/lib/publicSigningUrl';
import { goBackOr } from '@/lib/backNav';
import { jobHref } from '@/components/tech/v2/nav';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import { StatusPill } from '@/components/ui';
import { nativeDocPreviewAvailable, previewNativeDoc } from '@/lib/nativeDocPreview';
import { hasRealEmail } from '@/lib/signerEmail';
import { TextIcon, EmailIcon, DocumentIcon } from '@/components/ActionIcons';

// ─── SECTION: Helpers ──────────────
// Complete on purpose, even though this sheet can only SEND a subset: the list
// below shows every sign_request on the job, including ones the office sent from
// the desktop modal. A missing key here fell through to the titleCase fallback,
// which renders 'direction_pay' as "Direction pay". Pinned by
// tests/qa/unit/esign-doc-type-label-parity.test.js.
const DOC_TYPE_LABELS = {
  work_auth:               'Work Authorization',
  coc:                     'Certificate of Completion',
  direction_pay:           'Direction of Pay',
  change_order:            'Change Order',
  recon_agreement:         'Reconstruction Agreement',
  cat3_removal:            'Emergency Removal Authorization',
  emergency_demo:          'Emergency Demolition Authorization',
  coverage_unconfirmed:    'Coverage Not Confirmed Acknowledgment',
  service_declined:        'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release:          'Property Access Authorization',
  other:                   'Custom Authorization',
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

// Tone + label are explicit: toneForStatus() would classify 'signed' as neutral
// and 'cancelled' as danger, and the label is curated ("Awaiting signature").
const STATUS_PILL = {
  signed:    { label: 'Signed',             tone: 'success' },
  pending:   { label: 'Awaiting signature', tone: 'warning' },
  cancelled: { label: 'Cancelled',          tone: 'neutral' },
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
  // LES-01 (loading-error-states.md §1): this used to end in `.catch(() => [])`.
  // `db.select` THROWS on any non-OK response, so that swallow turned a real
  // outage into `setRequests([])` — and this one function backs the cold load,
  // the return-to-tab refresh, and three post-mutation refreshes. A blip while
  // the tab was backgrounded therefore ERASED already-visible pending and
  // signed e-signature rows and rendered the success empty state in their
  // place. It now rejects; each caller decides what that means.
  const loadRequests = useCallback(async () => {
    const rows = await db.select('sign_requests', `job_id=eq.${jobId}&order=sent_at.desc`);
    setRequests(rows || []);
    return rows || [];
  }, [db, jobId]);

  // The standalone callers — resume and the three post-mutation refreshes —
  // each already reported their own outcome, and none of them may blank the
  // list or leak an unhandled rejection. Keep the rows on screen, log only.
  const refreshRequests = useCallback(async () => {
    try {
      await loadRequests();
    } catch (e) {
      console.error('TechJobDocuments request refresh failed:', e?.message || e);
    }
  }, [loadRequests]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await db.select('jobs', `id=eq.${jobId}&select=id,job_number,division,insured_name,client_email,address,city,state`);
      const j = rows?.[0];
      if (!j) { setLoadError('Job not found'); return; }

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

      // LES-01: the requests read runs BEFORE `job` is committed, so a cold
      // load that fails here lands on the `!job` error screen below instead of
      // rendering "No signature requests yet" over an outage.
      await loadRequests();
      setJob(j);
      setContact(primary);
    } catch (e) {
      // Raw failures stay in the console for diagnosis and never reach the screen:
      // a tech in a flooded basement must not be shown PostgREST JSON.
      console.error('TechJobDocuments load failed:', e?.message || e);
      setLoadError('Failed to load documents');
      toast('Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, jobId, loadRequests]);

  useEffect(() => { load(); }, [load]);

  // Refresh when returning to the tab (e.g. back from the signing page), through
  // the shared hook rather than a hand-rolled listener (page-lifecycle.md §2).
  // onResume is refreshRequests, NOT loadRequests: loadRequests now rejects on a
  // failed read by design (LES-01), and an unhandled rejection from a resume
  // callback would be invisible. refreshRequests keeps the rendered rows on
  // screen and logs instead.
  useResumeRefetch({ onResume: refreshRequests });

  // ─── SECTION: Event handlers ──────────────
  const pdfUrl = (path) => `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/job-files/${path}`;

  // ESIGN-01: window.location.origin is capacitor://localhost inside the app,
  // so this copied a link no customer could open. publicSigningUrl pins the
  // origin to a real UPR host.
  const copyLink = (token) => {
    navigator.clipboard.writeText(publicSigningUrl(token))
      .then(() => { setCopiedToken(token); setTimeout(() => setCopiedToken(null), 2000); })
      .catch(() => toast('Could not copy link', 'error'));
  };

  // `channels` is ['sms'] or ['email']; the worker defaults to ['email'] when a
  // caller omits it, which is what keeps the office JobPage button unchanged.
  const resend = async (sr, channels = ['email']) => {
    setResending(`${sr.id}:${channels[0]}`);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/resend-esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ sign_request_id: sr.id, channels }),
      });
      // ESIGN-03: `.catch(() => ({}))` turns ANY non-JSON body into an empty
      // object, and `res.ok` alone then gated the success toast — so a 200
      // carrying something that is not this worker's reply reported "Reminder
      // sent" for an email nobody sent. That is exactly what happened while the
      // native app answered /api from its own bundle. The worker returns
      // `success: true` on both its happy path and its email-failure path, so
      // require it rather than inferring success from a status code.
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to resend');
      if (json.success !== true) throw new Error(json.error || 'Resend did not complete');
      // `success: true` means the REQUEST was handled, never that a message went
      // out — that distinction is ESIGN-03. With two channels, `delivered` is the
      // one that answers "did anything actually leave".
      if (json.delivered === false) {
        const why = json.results?.sms?.reason || json.results?.email?.reason || 'unknown error';
        throw new Error(why === 'no_email_on_file' ? 'No email address on file for this contact' : `Not sent (${why})`);
      }
      toast(json.email_error ? `Email failed: ${json.email_error_detail || 'unknown error'}` : `Reminder ${channels[0] === 'sms' ? 'texted' : `sent to ${sr.signer_email}`}`, json.email_error ? 'error' : 'success');
      refreshRequests();
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
      refreshRequests();
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
            <button className="btn btn-secondary" onClick={() => goBackOr(navigate, jobHref(jobId))}>Back</button>
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
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: `var(--${pill.tone})`, flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
            {docTypeLabel(sr.doc_type)}
          </span>
          <StatusPill tone={pill.tone} label={pill.label} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {sr.signer_name}{hasRealEmail(sr.signer_email) ? ` · ${sr.signer_email}` : ''}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>{dateLine}</div>

        {sr.status === 'pending' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {/* Two buttons, not a picker: a tech chasing a signature on site wants
                one tap, and the sheet above already uses this Text/Email idiom.
                Email is disabled when the row has no real address — older texted
                requests carry a synthetic `@noemail.local` placeholder, which is
                why this checks the same thing the name line above it does. */}
            <button
              type="button"
              style={actionBtn}
              onClick={() => resend(sr, ['sms'])}
              disabled={resending === `${sr.id}:sms`}
            >
              {resending === `${sr.id}:sms` ? 'Texting…' : <><TextIcon /> Text again</>}
            </button>
            <button
              type="button"
              style={{ ...actionBtn, opacity: hasRealEmail(sr.signer_email) ? 1 : 0.45 }}
              onClick={() => resend(sr, ['email'])}
              disabled={resending === `${sr.id}:email` || !hasRealEmail(sr.signer_email)}
              title={hasRealEmail(sr.signer_email) ? undefined : 'No email address on file'}
            >
              {resending === `${sr.id}:email` ? 'Sending…' : <><EmailIcon /> Email again</>}
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
                background: confirmCancel === sr.id ? 'var(--danger-bg)' : 'var(--bg-tertiary)',
                color: confirmCancel === sr.id ? 'var(--danger)' : 'var(--text-tertiary)',
                border: `1px solid ${confirmCancel === sr.id ? 'var(--danger-border)' : 'var(--border-light)'}`,
              }}
            >
              {confirmCancel === sr.id ? 'Confirm cancel' : 'Cancel'}
            </button>
          </div>
        )}

        {sr.status === 'signed' && sr.signed_file_path && (
          <div style={{ marginTop: 10 }}>
            {/* Stays an <a> so the web keeps its semantics and its fallback.
                Inside the installed app we intercept it for Quick Look —
                target="_blank" there punts to Safari and leaves the app. */}
            <a
              href={pdfUrl(sr.signed_file_path)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (!nativeDocPreviewAvailable()) return;
                e.preventDefault();
                previewNativeDoc({
                  url: pdfUrl(sr.signed_file_path),
                  title: 'Work authorization',
                }).catch(() => {});
              }}
              style={{ ...actionBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}
            >
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
          onClick={() => goBackOr(navigate, jobHref(jobId))}
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
            <div style={{ opacity: 0.35, marginBottom: 10, color: 'var(--text-tertiary)' }}>
              <DocumentIcon size={44} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              No documents yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              Tap "New document" to create one and send it for signature.
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

      {/* Pinned "New document". It reads NEW DOCUMENT, not "Request signature":
          the sheet behind it generates EIGHT document types, and a tech hunting
          a Certificate of Completion does not read "Request signature" as the
          way to get one. The signature step is still explicit inside the sheet —
          the label describes the machinery, which is wider than one of its
          steps. */}
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          New document
        </button>
      </div>

      <EsignRequestSheet
        open={esignOpen}
        onClose={() => setEsignOpen(false)}
        job={job}
        signerPrefill={signerPrefill}
        employeeId={employee?.id || null}
        employeeRole={employee?.role || null}
        initialDocType={esignDocType}
        onSent={refreshRequests}
      />
    </div>
  );
}
