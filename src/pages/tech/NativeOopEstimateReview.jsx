/**
 * ════════════════════════════════════════════════
 * FILE: NativeOopEstimateReview.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reviews and corrects the official estimate created by the OOP calculator
 *   inside the iPhone field shell. Corrections save to UPR; QuickBooks estimate
 *   save and email are temporarily contained while their durable accounting
 *   boundary is completed.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/tools/oop-pricing/estimate/:estimateId
 *   Rendered by:  src/App.jsx (native build only)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  AuthContext, shared UI states, toasts, native haptics, OOP
 *              lazy-route styles
 *   Data:      reads  → estimates, estimate_line_items, jobs, claims, contacts,
 *                        oop_quotes
 *              writes → correct_oop_estimate RPC (safe existing-line and
 *                        service-address corrections only)
 *
 * NOTES / GOTCHAS:
 *   - App.jsx independently gates this route to literal admins and the
 *     tool:oop_pricing flag.
 *   - This is intentionally not Admin Mobile: no collections, invoice, payment,
 *     or estimate-to-invoice code enters the native bundle.
 *   - Customer identity stays owned by the linked job/contact; this page edits
 *     only the service address and existing estimate lines.
 *   - Historical QuickBooks status remains visible, but this route exposes no
 *     QuickBooks estimate mutation during the containment window.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import '@/components/oop/oop-pricing.css';
import { ErrorState, StatusPill } from '@/components/ui';
import { SkeletonList } from '@/components/tech/v2/skeletons';
import { jobHref } from '@/components/tech/v2/nav';
import { useAuth } from '@/contexts/AuthContext';
import useUnsavedNavigationGuard from '@/hooks/useUnsavedNavigationGuard';
import { impact, notify } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';

const money = (value) => Number(value || 0).toLocaleString(
  'en-US',
  { style: 'currency', currency: 'USD' },
);

const formatDate = (value) => {
  if (!value) return 'Not recorded';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
};

const unwrap = (value) => Array.isArray(value) ? value[0] : value;
const editSnapshot = (address, items) => JSON.stringify({
  address,
  lines: items.map((line) => ({
    id: line.id,
    description: line.description ?? '',
    quantity: line.quantity ?? '',
    unit_price: line.unit_price ?? '',
  })),
});

export default function NativeOopEstimateReview() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db } = useAuth();
  const dbRef = useRef(db);
  dbRef.current = db;
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const editBaselineRef = useRef('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [lines, setLines] = useState([]);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [quoteId, setQuoteId] = useState(null);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const [draftAddress, setDraftAddress] = useState({
    property_address: '',
    property_city: '',
    property_state: '',
    property_zip: '',
  });
  const editDirty = editing
    && editBaselineRef.current !== ''
    && editSnapshot(draftAddress, draftLines) !== editBaselineRef.current;
  const {
    pendingNavigation,
    stay: stayOnEstimate,
    confirmNavigation: confirmGuardedNavigation,
  } = useUnsavedNavigationGuard({ dirty: editDirty, navigate });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const requestVersion = requestRef.current + 1;
    requestRef.current = requestVersion;
    const current = () => mountedRef.current && requestRef.current === requestVersion;
    setLoading(true);
    try {
      const d = dbRef.current;
      const nextEstimate = unwrap(await d.select(
        'estimates',
        `id=eq.${estimateId}&select=id,estimate_number,status,updated_at,converted_invoice_id,intended_division,property_address,property_city,property_state,property_zip,contact_id,job_id,qbo_estimate_id,qbo_doc_number,qbo_emailed_at,qbo_sync_error,sent_to_email&limit=1`,
      ));
      if (!current()) return;
      if (!nextEstimate) {
        setEstimate(null);
        setLoadError('Estimate not found.');
        return;
      }
      const [nextLines, nextJob, nextContact, quoteRows] = await Promise.all([
        d.select(
          'estimate_line_items',
          `estimate_id=eq.${estimateId}&select=id,description,quantity,unit_price,line_total,sort_order&order=sort_order.asc.nullslast,created_at.asc`,
        ),
        nextEstimate.job_id
          ? d.select(
            'jobs',
            `id=eq.${nextEstimate.job_id}&select=id,job_number,claim_id,insured_name,address,city,state,zip&limit=1`,
          ).then(unwrap)
          : null,
        nextEstimate.contact_id
          ? d.select('contacts', `id=eq.${nextEstimate.contact_id}&select=id,name,email&limit=1`).then(unwrap)
          : null,
        d.select('oop_quotes', `converted_estimate_id=eq.${estimateId}&select=id&limit=1`),
      ]);
      if (!current()) return;
      const nextClaim = nextJob?.claim_id
        ? unwrap(await d.select(
          'claims',
          `id=eq.${nextJob.claim_id}&select=claim_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip&limit=1`,
        ))
        : null;
      if (!current()) return;
      const sourceQuoteId = unwrap(quoteRows)?.id || null;
      if (!sourceQuoteId) {
        setEstimate(null);
        setLoadError('This estimate was not created by the OOP calculator.');
        return;
      }
      const normalizedLines = Array.isArray(nextLines) ? nextLines : [];
      setEstimate(nextEstimate);
      setLines(normalizedLines);
      setDraftLines(normalizedLines);
      setDraftAddress({
        property_address: nextEstimate.property_address || '',
        property_city: nextEstimate.property_city || '',
        property_state: nextEstimate.property_state || '',
        property_zip: nextEstimate.property_zip || '',
      });
      setJob(nextJob || null);
      setClaim(nextClaim || null);
      setContact(nextContact || null);
      setQuoteId(sourceQuoteId);
      setLoadError('');
    } catch (error) {
      if (current()) setLoadError(error?.message || 'The estimate could not be loaded.');
    } finally {
      if (current()) {
        setLoading(false);
      }
    }
  }, [estimateId]);

  useEffect(() => {
    load();
  }, [load]);

  const beginEditing = () => {
    impact('light');
    const nextLines = lines.map((line) => ({ ...line }));
    const nextAddress = {
      property_address: estimate?.property_address || job?.address || claim?.loss_address || '',
      property_city: estimate?.property_city || job?.city || claim?.loss_city || '',
      property_state: estimate?.property_state || job?.state || claim?.loss_state || '',
      property_zip: estimate?.property_zip || job?.zip || claim?.loss_zip || '',
    };
    editBaselineRef.current = editSnapshot(nextAddress, nextLines);
    setDraftLines(nextLines);
    setDraftAddress(nextAddress);
    setEditing(true);
  };

  const cancelEditing = () => {
    impact('light');
    setEditing(false);
    editBaselineRef.current = '';
    setDraftLines(lines.map((line) => ({ ...line })));
  };

  const patchDraftLine = (lineId, field, value) => {
    setDraftLines((current) => current.map((line) => (
      line.id === lineId ? { ...line, [field]: value } : line
    )));
  };

  const patchDraftAddress = (field, value) => {
    setDraftAddress((current) => ({ ...current, [field]: value }));
  };

  const saveEstimateEdits = async () => {
    if (busy) return;
    impact('light');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      err('An internet connection is required to save estimate corrections.');
      return;
    }
    const normalizedLines = draftLines.map((line, index) => ({
      ...line,
      description: String(line.description || '').trim(),
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      sort_order: index,
    }));
    const normalizedAddress = {
      property_address: String(draftAddress.property_address || '').trim() || null,
      property_city: String(draftAddress.property_city || '').trim() || null,
      property_state: String(draftAddress.property_state || '').trim() || null,
      property_zip: String(draftAddress.property_zip || '').trim() || null,
    };
    const invalid = normalizedLines.some((line) => (
      !line.description
      || !Number.isFinite(line.quantity)
      || line.quantity <= 0
      || !Number.isFinite(line.unit_price)
      || line.unit_price < 0
    ));
    const nextTotal = normalizedLines.reduce(
      (sum, line) => sum + line.quantity * line.unit_price,
      0,
    );
    if (invalid || !(nextTotal > 0)) {
      err('Every line needs a description, a quantity above 0, and a valid rate. The estimate total must be above $0.');
      return;
    }

    setBusy('edit');
    try {
      const result = unwrap(await dbRef.current.rpc('correct_oop_estimate', {
        p_estimate_id: estimateId,
        p_expected_updated_at: estimate.updated_at,
        p_address: normalizedAddress,
        p_lines: normalizedLines.map((line) => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          sort_order: line.sort_order,
        })),
      }));
      const savedLines = Array.isArray(result?.lines)
        ? result.lines
        : normalizedLines.map((line) => ({ ...line, line_total: null }));
      if (!result?.ok) {
        throw new Error('The correction was not accepted.');
      }
      if (!mountedRef.current) return;
      setEstimate((current) => ({
        ...current,
        ...normalizedAddress,
        updated_at: result.updated_at || current.updated_at,
      }));
      setLines(savedLines);
      setDraftLines(savedLines);
      editBaselineRef.current = '';
      setEditing(false);
      notify('success');
      ok('Estimate corrections saved in UPR.');
    } catch (error) {
      if (!mountedRef.current) return;
      notify('error');
      const message = String(error?.message || error);
      if (message.includes('oop_estimate_correction_conflict')) {
        err('This estimate changed elsewhere. Your edits are still here; go back and reopen it before retrying.');
      } else if (message.includes('oop_estimate_already_converted')) {
        err('This estimate was converted to an invoice and can no longer be corrected.');
      } else {
        err(`Could not save the estimate corrections: ${message}. Your edits are still here so you can retry.`);
      }
    } finally {
      if (mountedRef.current) setBusy('');
    }
  };

  const backToQuote = () => {
    impact('light');
    navigate(quoteId
      ? `/tech/tools/oop-pricing?quoteId=${encodeURIComponent(quoteId)}`
      : '/tech/tools/oop-pricing');
  };

  if (loading) {
    return <div className="oop-native-estimate-state"><SkeletonList rows={6} /></div>;
  }
  if (loadError || !estimate) {
    return (
      <ErrorState
        className="oop-native-estimate-state"
        message={loadError || 'Estimate not found.'}
        onRetry={() => load()}
        secondary={<button type="button" className="btn btn-secondary" onClick={backToQuote}>Back to calculator</button>}
      />
    );
  }

  const totalLines = editing ? draftLines : lines;
  const total = totalLines.reduce(
    (sum, line) => sum + Number(
      editing
        ? Number(line.quantity || 0) * Number(line.unit_price || 0)
        : line.line_total ?? Number(line.quantity || 0) * Number(line.unit_price || 0),
    ),
    0,
  );
  const address = [
    estimate.property_address || job?.address || claim?.loss_address,
    estimate.property_city || job?.city || claim?.loss_city,
    estimate.property_state || job?.state || claim?.loss_state,
    estimate.property_zip || job?.zip || claim?.loss_zip,
  ].filter(Boolean).join(', ');
  const sent = Boolean(estimate.qbo_emailed_at);
  const qboSaved = Boolean(estimate.qbo_estimate_id);

  return (
    <div className="oop-native-estimate-page">
      <header className="oop-native-estimate-header">
        <Link
          className="btn btn-ghost oop-tech-action"
          aria-disabled={Boolean(busy)}
          to={quoteId
            ? `/tech/tools/oop-pricing?quoteId=${encodeURIComponent(quoteId)}`
            : '/tech/tools/oop-pricing'}
          onClick={(event) => {
            if (busy) {
              event.preventDefault();
              return;
            }
            impact('light');
          }}
        >
          ← Quote
        </Link>
        <div className="oop-native-estimate-heading">
          <div className="oop-native-estimate-kicker">Official estimate</div>
          <h1>{estimate.qbo_doc_number || estimate.estimate_number || 'Draft estimate'}</h1>
        </div>
        <StatusPill tone={sent ? 'success' : qboSaved ? 'info' : 'neutral'} label={sent ? 'Sent' : qboSaved ? 'In QuickBooks' : 'UPR draft'} />
      </header>

      <main className="oop-native-estimate-body">
        {pendingNavigation && (
          <div role="alert" className="oop-native-estimate-discard">
            <span>You have unsaved estimate corrections. Discard them and leave?</span>
            <div>
              <button type="button" className="btn btn-secondary" onClick={() => { impact('light'); stayOnEstimate(); }}>Stay</button>
              <button type="button" className="btn btn-danger" onClick={() => { impact('light'); confirmGuardedNavigation(); }}>Confirm discard</button>
            </div>
          </div>
        )}
        {estimate.qbo_sync_error && <div role="alert" className="oop-native-estimate-error">{estimate.qbo_sync_error}</div>}
        <div role="status" className="oop-native-estimate-handoff">
          <strong>QuickBooks estimate actions are temporarily unavailable</strong>
          <span>Continue correcting this estimate in UPR. QuickBooks save, update, and email will return after the durable accounting update is complete.</span>
        </div>

        <section className="oop-native-estimate-card" aria-label="Customer and job">
          <div className="oop-native-estimate-customer">{contact?.name || job?.insured_name || 'Customer'}</div>
          {contact?.email && <div className="oop-native-estimate-muted">{contact.email}</div>}
          {address && <div className="oop-native-estimate-address">{address}</div>}
          <div className="oop-native-estimate-meta">
            {claim?.claim_number && <span>Claim {claim.claim_number}</span>}
            {job?.job_number && <span>Job {job.job_number}</span>}
            <span>Loss {formatDate(claim?.date_of_loss)}</span>
          </div>
          {job?.id && (
            <Link
              className="btn btn-ghost oop-native-estimate-job"
              to={jobHref(job.id)}
              onClick={() => impact('light')}
            >
              Open job →
            </Link>
          )}
        </section>

        <section className="oop-native-estimate-card" aria-label="Estimate line items">
          <div className="oop-native-estimate-section-heading">
            <div className="oop-native-estimate-section-title">Estimate lines</div>
            {!editing && !estimate.converted_invoice_id && (
              <button type="button" className="btn btn-ghost oop-native-estimate-edit" disabled={Boolean(busy)} onClick={beginEditing}>
                Edit estimate
              </button>
            )}
          </div>
          {editing && (
            <div className="oop-native-estimate-address-fields">
              <label>
                <span>Service address</span>
                <input value={draftAddress.property_address} onChange={(event) => patchDraftAddress('property_address', event.target.value)} />
              </label>
              <div className="oop-native-estimate-address-grid">
                <label>
                  <span>City</span>
                  <input value={draftAddress.property_city} onChange={(event) => patchDraftAddress('property_city', event.target.value)} />
                </label>
                <label>
                  <span>State</span>
                  <input value={draftAddress.property_state} onChange={(event) => patchDraftAddress('property_state', event.target.value)} />
                </label>
                <label>
                  <span>ZIP</span>
                  <input inputMode="numeric" value={draftAddress.property_zip} onChange={(event) => patchDraftAddress('property_zip', event.target.value)} />
                </label>
              </div>
              <div className="oop-native-estimate-muted">Customer identity stays linked to this job. Use Open job to correct the customer.</div>
            </div>
          )}
          {(editing ? draftLines : lines).map((line) => (
            editing ? (
              <div className="oop-native-estimate-line-editor" key={line.id}>
                <label>
                  <span>Description</span>
                  <textarea value={line.description || ''} onChange={(event) => patchDraftLine(line.id, 'description', event.target.value)} />
                </label>
                <div className="oop-native-estimate-line-grid">
                  <label>
                    <span>Quantity</span>
                    <input inputMode="decimal" value={line.quantity ?? ''} onChange={(event) => patchDraftLine(line.id, 'quantity', event.target.value)} />
                  </label>
                  <label>
                    <span>Rate</span>
                    <input inputMode="decimal" value={line.unit_price ?? ''} onChange={(event) => patchDraftLine(line.id, 'unit_price', event.target.value)} />
                  </label>
                  <strong>{money(Number(line.quantity || 0) * Number(line.unit_price || 0))}</strong>
                </div>
              </div>
            ) : (
              <div className="oop-native-estimate-line" key={line.id}>
                <div>
                  <div className="oop-native-estimate-line-title">{line.description || 'OOP service'}</div>
                  {/* Grouped lines are a flat 1 × total, so "1 × $2,016.30" would
                      just repeat the amount beside it. Only show the maths when
                      the quantity actually carries information. */}
                  {Number(line.quantity || 0) !== 1 && (
                    <div className="oop-native-estimate-muted">{Number(line.quantity || 0)} × {money(line.unit_price)}</div>
                  )}
                </div>
                <strong>{money(line.line_total ?? Number(line.quantity || 0) * Number(line.unit_price || 0))}</strong>
              </div>
            )
          ))}
          <div className="oop-native-estimate-total"><span>Total</span><strong>{money(total)}</strong></div>
        </section>

        {estimate.converted_invoice_id ? (
          <div className="oop-native-estimate-handoff">
            <strong>Converted to invoice</strong>
            <span>This estimate is locked so its approved pricing stays consistent with the invoice.</span>
          </div>
        ) : editing ? (
          <div className="oop-native-estimate-actions">
            <button type="button" className="btn btn-secondary oop-native-estimate-action" disabled={Boolean(busy)} onClick={cancelEditing}>Cancel</button>
            <button type="button" className="btn btn-primary oop-native-estimate-action" disabled={Boolean(busy)} onClick={saveEstimateEdits}>
              {busy === 'edit' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
