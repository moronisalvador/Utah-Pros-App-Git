/**
 * ════════════════════════════════════════════════
 * FILE: ContractorUpload.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets a contractor safely send only the documents named in their Utah Pros Restoration request.
 *   It does not show any other contractor data or give the browser direct access to file storage.
 *
 * WHERE IT LIVES:
 *   Route:        /contractor-upload (capability arrives in a URL fragment)
 *   Rendered by:  public route wiring in src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query, react-router-dom
 *   Internal:  UI primitives, contractor-compliance API, toast helpers
 *   Data:      reads  → public Contractor Compliance Worker projection
 *              writes → public Contractor Compliance upload Worker
 *
 * NOTES / GOTCHAS:
 *   - The raw token stays in the URL/form only and is never retained in browser storage.
 * ════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, StatusPill } from '@/components/ui';
import { err, ok } from '@/lib/toast';
import { getPublicRequest, uploadPublicDocument } from '@/components/contractor-compliance/api';
import './ContractorCompliance.css';

export default function ContractorUpload() {
  const [token] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return fragment.get('token') || '';
  });
  const [dates, setDates] = useState({});
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);
  const request = useQuery({ queryKey: ['contractor-upload'], queryFn: () => getPublicRequest(token), enabled: !!token, retry: false, refetchOnWindowFocus: false });
  const upload = useMutation({ mutationFn: ({ file, documentType }) => uploadPublicDocument({ token, documentType, file, effectiveDate: dates[documentType]?.effectiveDate, expirationDate: dates[documentType]?.expirationDate, taxYear: dates[documentType]?.taxYear }), onSuccess: () => { ok('Your document was received for review.'); request.refetch(); }, onError: (error) => err(error.message || 'That document could not be uploaded.') });
  if (!token || request.error) return <main className="contractor-upload-page"><ErrorState message="This secure upload link is unavailable. Ask Utah Pros Restoration for a new request." onRetry={token ? request.refetch : undefined} retryLabel="Try link again" /></main>;
  if (request.isPending) return <main className="contractor-upload-page"><div className="loading-page"><div className="spinner" /><span>Opening secure upload…</span></div></main>;
  const data = request.data || {};
  const types = Array.isArray(data.requested_types) ? data.requested_types : [];
  return <main className="contractor-upload-page"><section className="card contractor-upload-card"><p className="contractor-upload-brand">Utah Pros Restoration</p><h1>Secure contractor document upload</h1><p>Use this link only to send the requested documents. Files are reviewed by Utah Pros Restoration before they count toward compliance.</p>{data.expires_at ? <p className="contractor-muted">This request expires {new Date(data.expires_at).toLocaleDateString()}.</p> : null}{types.length ? <div className="contractor-public-types">{types.map((type) => { const value = dates[type] || {}; const w9 = type === 'w9'; const valid = w9 ? !!value.taxYear : !!value.effectiveDate && !!value.expirationDate && value.effectiveDate <= value.expirationDate; return <label key={type} className="contractor-public-upload"><span>{String(type).replace(/_/g, ' ')}</span><StatusPill status="requested" label="Requested" tone="info" />{w9 ? <input className="input" type="number" min="2000" max="2100" placeholder="Tax year" value={value.taxYear || ''} onChange={(event) => setDates((current) => ({ ...current, [type]: { ...value, taxYear: event.target.value } }))} /> : <><input className="input" type="date" aria-label={`${type} effective date`} value={value.effectiveDate || ''} onChange={(event) => setDates((current) => ({ ...current, [type]: { ...value, effectiveDate: event.target.value } }))} /><input className="input" type="date" aria-label={`${type} expiration date`} min={value.effectiveDate || undefined} value={value.expirationDate || ''} onChange={(event) => setDates((current) => ({ ...current, [type]: { ...value, expirationDate: event.target.value } }))} /></>}<input type="file" accept="application/pdf,image/jpeg,image/png" disabled={upload.isPending || data.closed} onChange={(event) => { const file = event.target.files?.[0]; if (file && valid) upload.mutate({ file, documentType: type }); else if (file) err('Enter the required document dates before uploading.'); event.target.value = ''; }} /><small>PDF, JPG, or PNG • up to 6 MB</small></label>; })}</div> : <EmptyState icon="✓" title="No documents remain in this request" sub="Nothing is available to upload. Ask Utah Pros Restoration for a new request if more paperwork is needed." />}{data.closed ? <p className="contractor-inline-notice" role="status">This request is no longer accepting uploads.</p> : null}<p className="contractor-upload-privacy">Please do not email sensitive tax documents. This page sends files through a private upload channel.</p></section></main>;
}
