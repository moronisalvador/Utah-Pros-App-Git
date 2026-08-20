/**
 * ════════════════════════════════════════════════
 * FILE: ContractorDetail.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows one subcontractor's readiness, their document history, and safe ways for authorized
 *   office staff to request, upload, review, or revoke paperwork. Managers see readiness without
 *   tax-document details.
 *
 * WHERE IT LIVES:
 *   Route:        /contractors/:contractorId
 *   Rendered by:  src/App.jsx after the Contractor Compliance route is wired
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query, react-router-dom
 *   Internal:  AuthContext, UI primitives, contractor-compliance API, toast helpers
 *   Data:      reads  → get_contractor_compliance_detail RPC
 *              writes → Contractor Compliance Worker endpoints
 *
 * NOTES / GOTCHAS:
 *   - The Worker still checks every document and request action; hiding a button is never access control.
 * ════════════════════════════════════════════════
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorState, PageHeader, StatusPill } from '@/components/ui';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { formatCompanyDate } from '@/lib/companyDate';
import { err, ok } from '@/lib/toast';
import DatePicker from '@/components/DatePicker';
import ComplianceStatus from '@/components/contractor-compliance/ComplianceStatus';
import { complianceAction, openDocument, uploadInternalDocument } from '@/components/contractor-compliance/api';
import './ContractorCompliance.css';

const TYPE_LABELS = { w9: 'W-9', workers_comp: 'Workers’ compensation', workers_comp_waiver: 'Utah workers’ comp waiver', general_liability: 'General liability' };
function canSeeDocument(document, permissions) { return document.document_type !== 'w9' || permissions?.can_manage; }
function denverYear() { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric' }).format(new Date()); }

function DocumentCard({ document, canManage, canViewFiles, busy, onAction, onOpen, reason, onReason, coverage, onCoverage }) {
  const state = document.state || document.review_state || 'pending_review';
  // A contractor may now send a certificate with no coverage dates on it, so the
  // reviewer supplies them here. Pre-filled from the row when the contractor did
  // provide them, so the common case is still one click.
  const isW9 = document.document_type === 'w9';
  const start = coverage?.start ?? (document.effective_on || document.coverage_start_date || '');
  const end = coverage?.end ?? (document.expiration_on || document.coverage_end_date || '');
  const datesOk = Boolean(start && end) && end >= start;
  const needsDates = !isW9 && state === 'pending_review';
  return <article className="contractor-document" key={document.id}>
    <div><strong>{TYPE_LABELS[document.document_type] || document.document_type}</strong><small>{state.replace(/_/g, ' ')} • Received {formatCompanyDate(document.received_at || document.created_at)}</small>{document.effective_on || document.expiration_on || document.coverage_start_date || document.coverage_end_date ? <small>Coverage: {formatCompanyDate(document.effective_on || document.coverage_start_date)} – {formatCompanyDate(document.expiration_on || document.coverage_end_date)}</small> : null}{document.rejection_reason ? <small className="contractor-danger">Rejected: {document.rejection_reason}</small> : null}</div>
    <div className="contractor-document-actions"><StatusPill status={state} tone={state === 'accepted' ? 'success' : state === 'rejected' ? 'danger' : 'warning'} />{canViewFiles ? <><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onOpen(document.id, 'inline')}>Preview</button><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onOpen(document.id, 'attachment')}>Download</button></> : null}{canManage && needsDates ? <span className="contractor-review-dates">
      {/* DatePicker, not a native date input: a <label> cannot name a composite
          widget, so the visible text is the accessible name via ariaLabelledBy. */}
      <span className="contractor-review-date">
        <span id={`cov-start-${document.id}`}>Coverage start</span>
        <DatePicker value={start} onChange={(next) => onCoverage({ start: next || '', end })} ariaLabelledBy={`cov-start-${document.id}`} />
      </span>
      <span className="contractor-review-date">
        <span id={`cov-end-${document.id}`}>Coverage end</span>
        <DatePicker value={end} min={start || undefined} onChange={(next) => onCoverage({ start, end: next || '' })} ariaLabelledBy={`cov-end-${document.id}`} />
      </span>
    </span> : null}{canManage && state === 'pending_review' ? <><button type="button" className="btn btn-primary btn-sm" disabled={busy || (needsDates && !datesOk)} title={needsDates && !datesOk ? 'Add both coverage dates to accept this document' : undefined} onClick={() => onAction('review_document', { document_id: document.id, state: 'accepted', ...(needsDates ? { coverage_start_date: start, coverage_end_date: end } : {}) })}>Accept</button><input className="input contractor-rejection-reason" value={reason} placeholder="Rejection reason" onChange={(event) => onReason(event.target.value)} /><button type="button" className="btn btn-danger btn-sm" disabled={busy || !reason.trim()} onClick={() => onAction('review_document', { document_id: document.id, state: 'rejected', rejection_reason: reason.trim() })}>Reject</button></> : null}</div>
  </article>;
}

export default function ContractorDetail() {
  const { contractorId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auditStart = searchParams.get('audit_start');
  const auditEnd = searchParams.get('audit_end');
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef(null);
  const operationIds = useRef(new Map());
  const { isArmed, arm, cancel } = useTwoClickConfirm();
  const [uploadType, setUploadType] = useState('general_liability');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [taxYear, setTaxYear] = useState(denverYear());
  const [pauseReason, setPauseReason] = useState('');
  const [activeReason, setActiveReason] = useState('');
  const [rejectionReasons, setRejectionReasons] = useState({});
  const [reviewCoverage, setReviewCoverage] = useState({});
  const [note, setNote] = useState('');
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const detail = useQuery({ queryKey: ['contractor-compliance', 'detail', contractorId, auditStart, auditEnd], queryFn: () => db.rpc('get_contractor_compliance_detail', { p_contact_id: contractorId, p_audit_start: auditStart || null, p_audit_end: auditEnd || null }), retry: false, refetchOnWindowFocus: false });
  const data = detail.data || {};
  const permissions = data.permissions || {
    can_manage: ['admin', 'office'].includes(employee?.role),
    can_view_files: ['admin', 'office'].includes(employee?.role),
  };
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['contractor-compliance'] });
  const operationFor = (key) => {
    if (!operationIds.current.has(key)) operationIds.current.set(key, crypto.randomUUID());
    return operationIds.current.get(key);
  };
  const action = useMutation({
    mutationFn: async ({ name, payload, operationKey }) => ({
      result: await complianceAction(name, { contractor_id: contractorId, ...payload }),
      operationKey,
    }),
    onSuccess: async ({ result, operationKey }) => {
      if (operationKey) operationIds.current.delete(operationKey);
      await refresh();
      ok(result.message || 'Contractor compliance updated.');
    },
    onError: (error) => err(error.message || 'Could not update contractor compliance.'),
  });
  const upload = useMutation({ mutationFn: ({ file, documentType }) => uploadInternalDocument({ contractorId, documentType, file, effectiveDate, expirationDate, taxYear: documentType === 'w9' ? taxYear : null }), onSuccess: async () => { await refresh(); ok('Document uploaded for review.'); }, onError: (error) => err(error.message || 'Could not upload that document.') });
  const contractor = data.contractor || data.contact || {};
  const documents = (Array.isArray(data.documents) ? data.documents : []).filter((document) => canSeeDocument(document, permissions));
  const requests = Array.isArray(data.requests) ? data.requests : [];
  const activity = Array.isArray(data.activity) ? data.activity : [];
  const requestableStatuses = new Set(['missing', 'expired', 'gap', 'expiring']);
  const requestTypes = (Array.isArray(data.requirements) ? data.requirements : []).flatMap((requirement) => {
    if (!requestableStatuses.has(requirement.status)) return [];
    if (requirement.key === 'workers_comp') return ['workers_comp', 'workers_comp_waiver'];
    return requirement.key ? [requirement.key] : [];
  });
  const returnTo = location.state?.contractorReturnTo || '/contractors';
  const backControl = (label) => (location.state?.contractorReturnTo
    ? <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>{label}</button>
    : <Link className="btn btn-secondary" to={returnTo}>{label}</Link>);
  const handleOpenDocument = async (documentId, disposition) => {
    setOpeningDocumentId(documentId);
    try {
      await openDocument(documentId, disposition);
    } catch (error) {
      err(error.message || 'Could not open that document.');
    } finally {
      setOpeningDocumentId('');
    }
  };
  if (detail.isPending) return <div className="loading-page"><div className="spinner" /><span>Loading contractor compliance…</span></div>;
  if (detail.error) return <main className="contractor-compliance-page"><ErrorState message={detail.error.message} onRetry={detail.refetch} secondary={backControl('Back')} /></main>;
  const submitNote = () => { const body = note.trim(); if (!body) return; action.mutate({ name: 'add_note', payload: { note: body } }); setNote(''); };
  return <main className="contractor-compliance-page contractor-detail-page">
    {location.state?.contractorReturnTo ? <button type="button" className="btn btn-ghost contractor-back" onClick={() => navigate(-1)}>← Back</button> : <Link className="contractor-back" to={returnTo}>← Back</Link>}
    <PageHeader title={contractor.name || 'Contractor'} subtitle={`${contractor.trade || contractor.trade_specialty || 'No trade recorded'} • ${contractor.email || contractor.phone || 'No contact method recorded'}`} actions={<ComplianceStatus status={contractor.overall_status || data.readiness?.current_status} />} />
    <section className="contractor-detail-grid">
      <article className="contractor-panel card"><h2>Current readiness</h2>{(data.requirements || []).length ? data.requirements.map((requirement) => <div className="contractor-requirement" key={requirement.key || requirement.type}><span>{requirement.label || TYPE_LABELS[requirement.key] || requirement.key}</span><ComplianceStatus status={requirement.status} /><small>{requirement.expires_on ? `Expires ${formatCompanyDate(requirement.expires_on)}` : requirement.detail || 'No accepted current evidence'}</small></div>) : <div className="contractor-requirement"><span>Overall readiness</span><ComplianceStatus status={data.readiness?.current_status} /><small>Requirement detail is available after the compliance schema update.</small></div>}</article>
      <article className="contractor-panel card"><h2>Contact and ownership</h2><dl className="contractor-facts"><div><dt>Trade</dt><dd>{contractor.trade || contractor.trade_specialty || '—'}</dd></div><div><dt>Assigned owner</dt><dd>{contractor.assigned_owner_name || 'Unassigned'}</dd></div><div><dt>Last request</dt><dd>{contractor.last_request_at ? formatCompanyDate(contractor.last_request_at) : 'Not sent'}</dd></div><div><dt>Audit period</dt><dd>{data.audit?.label || data.readiness?.audit_start || 'Current readiness'}</dd></div></dl></article>
    </section>
    {permissions.can_manage ? <section className="contractor-panel contractor-action-panel card"><h2>Upload document</h2><div className="contractor-upload-row"><label>Document type<select className="input" value={uploadType} onChange={(event) => setUploadType(event.target.value)}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{uploadType === 'w9' ? <label>Tax year<input className="input" type="number" min="2000" max="2100" value={taxYear} onChange={(event) => setTaxYear(event.target.value)} required /></label> : <><label>Effective date<input className="input" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required /></label><label>Expiration date<input className="input" type="date" min={effectiveDate || undefined} value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} required /></label></>}<input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(event) => { const file = event.target.files?.[0]; const datesValid = uploadType === 'w9' ? !!taxYear : !!effectiveDate && !!expirationDate && effectiveDate <= expirationDate; if (file && datesValid) upload.mutate({ file, documentType: uploadType }); else if (file) err('Enter the required document dates before uploading.'); event.target.value = ''; }} /><button type="button" className="btn btn-primary" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>{upload.isPending ? 'Uploading…' : 'Choose file'}</button></div><p>PDF, JPG, or PNG only. Uploads always require review before they count.</p></section> : null}
    {permissions.can_manage ? <section className="contractor-panel contractor-action-panel card"><h2>Automatic reminders</h2>{contractor.reminders_paused_at || contractor.reminders_paused ? <><p>Automatic reminders are paused{contractor.reminders_pause_reason ? `: ${contractor.reminders_pause_reason}` : '.'}</p><button type="button" className="btn btn-secondary" disabled={action.isPending} onClick={() => action.mutate({ name: 'resume_reminders', payload: {} })}>Resume automatic reminders</button></> : <><p>Pause only when follow-up must be handled outside the normal renewal schedule.</p><div className="contractor-upload-row"><label>Pause reason<input className="input" value={pauseReason} maxLength="500" onChange={(event) => setPauseReason(event.target.value)} placeholder="Required internal reason" /></label><button type="button" className="btn btn-secondary" disabled={action.isPending || !pauseReason.trim()} onClick={() => action.mutate({ name: 'pause_reminders', payload: { pause_reason: pauseReason.trim() } })}>Pause automatic reminders</button></div></>}</section> : null}
    {permissions.can_manage ? <section className="contractor-panel contractor-action-panel card"><h2>Contractor status</h2><p>{contractor.is_active === false ? 'This contractor is inactive. Historical compliance remains visible.' : 'Inactive contractors remain in the dashboard but stop annual and renewal reminders.'}</p><div className="contractor-upload-row"><label>Change reason<input className="input" value={activeReason} maxLength="500" onChange={(event) => setActiveReason(event.target.value)} placeholder="Required audit reason" /></label><button type="button" className="btn btn-secondary" disabled={action.isPending || !activeReason.trim()} onClick={() => action.mutate({ name: 'set_active', payload: { is_active: contractor.is_active === false, reason: activeReason.trim() } })}>{contractor.is_active === false ? 'Mark active' : 'Mark inactive'}</button></div></section> : null}
      <section className="contractor-panel card"><h2>Document history</h2>{documents.length ? <div className="contractor-document-list">{documents.map((document) => <DocumentCard key={document.id} document={document} canManage={permissions.can_manage} canViewFiles={permissions.can_view_files} busy={action.isPending || openingDocumentId === document.id} reason={rejectionReasons[document.id] || ''} onReason={(value) => setRejectionReasons((current) => ({ ...current, [document.id]: value }))} coverage={reviewCoverage[document.id]} onCoverage={(next) => setReviewCoverage((current) => ({ ...current, [document.id]: next }))} onOpen={handleOpenDocument} onAction={(name, payload) => action.mutate({ name, payload })} />)}</div> : <EmptyState icon="▣" title="No authorized document history" sub={permissions.can_manage ? 'Upload a document or send a request to begin review.' : 'Your role can view readiness but not contractor files.'} />}</section>
    <section className="contractor-detail-grid"><article className="contractor-panel card"><h2>Coverage timeline</h2>{Array.isArray(data.coverage_timeline) && data.coverage_timeline.length ? <ol className="contractor-timeline">{data.coverage_timeline.map((entry) => <li key={entry.id || `${entry.start_on}-${entry.document_type}`}><strong>{TYPE_LABELS[entry.document_type] || entry.document_type}</strong><span>{formatCompanyDate(entry.start_on || entry.effective_on)} – {formatCompanyDate(entry.end_on || entry.expiration_on)}</span><ComplianceStatus status={entry.status || entry.state} /></li>)}</ol> : <p className="contractor-muted">No coverage intervals are available.</p>}</article><article className="contractor-panel card"><h2>Requests</h2>{requests.length ? <div className="contractor-request-list">{requests.map((request) => <div key={request.id} className="contractor-request"><div><strong>{(request.requested_types || request.requested_document_types || request.document_types)?.map((type) => TYPE_LABELS[type] || type).join(', ') || 'Document request'}</strong><small>{request.state?.replace(/_/g, ' ') || 'Open'} • {request.sent_at ? `Last sent ${formatCompanyDate(request.sent_at)}` : 'Not sent'}</small></div>{permissions.can_manage ? <div className="contractor-inline-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={action.isPending} onClick={() => { const operationKey = `resend:${request.id}`; action.mutate({ name: 'send_request', payload: { request_id: request.id, operation_id: operationFor(operationKey) }, operationKey }); }}>Resend</button><button type="button" className="btn btn-secondary btn-sm" disabled={action.isPending} onClick={() => action.mutate({ name: request.paused_at ? 'resume_request' : 'pause_request', payload: { request_id: request.id } })}>{request.paused_at ? 'Resume' : 'Pause'}</button><button type="button" className={isArmed(`revoke:${request.id}`) ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'} onBlur={cancel} disabled={action.isPending} onClick={() => { if (!isArmed(`revoke:${request.id}`)) { arm(`revoke:${request.id}`); return; } action.mutate({ name: 'revoke_request', payload: { request_id: request.id } }); cancel(); }}>{isArmed(`revoke:${request.id}`) ? 'Confirm revoke' : 'Revoke link'}</button></div> : null}</div>)}</div> : <p className="contractor-muted">No requests have been sent.</p>}{permissions.can_manage ? <button type="button" className="btn btn-primary btn-sm" disabled={action.isPending || !requestTypes.length} onClick={() => { const operationKey = 'create-request'; action.mutate({ name: 'create_request', payload: { requested_types: requestTypes, operation_id: operationFor(operationKey), send_now: true }, operationKey }); }}>{requestTypes.length ? 'Send request now' : 'No missing documents to request'}</button> : null}</article></section>
    <section className="contractor-panel card"><h2>Notes and activity</h2>{permissions.can_manage ? <div className="contractor-note-form"><textarea className="input" rows="3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add an internal compliance note (do not include tax identifiers)." /><button type="button" className="btn btn-secondary" disabled={action.isPending || !note.trim()} onClick={submitNote}>Add note</button></div> : null}{activity.length ? <ol className="contractor-activity">{activity.map((entry) => <li key={entry.id}><strong>{entry.label || entry.event_type?.replace(/_/g, ' ') || 'Activity'}</strong><span>{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>{entry.note ? <p>{entry.note}</p> : null}</li>)}</ol> : <p className="contractor-muted">No activity yet.</p>}</section>
  </main>;
}
