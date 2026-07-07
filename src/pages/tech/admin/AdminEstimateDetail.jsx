/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateDetail.jsx  (Admin Mobile — Estimate view + send + convert, P4a)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single-estimate screen inside the field-tech app, for admins. You open
 *   an estimate to read it (its details and line items), email it to the
 *   customer through QuickBooks, or turn it into an invoice in one flow. Building
 *   or changing the line items happens on a separate builder screen, reached from
 *   the "Edit / add line items" and "New estimate" links here.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId  (inside AdminMobileRoutes)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/realtime (getAuthHeader),
 *              @/components/admin-mobile (AdminMobilePage, href helpers),
 *              ./estimate/{estimateActions, EstimateHeader, EstimateLines}
 *   Data:      reads  → estimates, estimate_line_items, jobs, claims, contacts
 *              writes → estimates + QBO estimate via /api/qbo-estimate (send);
 *                       on convert: invoices via convert_estimate_to_invoice RPC
 *                       + /api/qbo-invoice
 *
 * NOTES / GOTCHAS:
 *   - The QBO workers (/api/qbo-estimate, /api/qbo-invoice) and the
 *     convert_estimate_to_invoice RPC are CALL-ONLY — never edited here.
 *   - Line items are READ-ONLY on this screen; editing lives in the builder
 *     (P4b) at adminEstimateEditorHref(). That route is Foundation-frozen; the
 *     builder page itself lands with P4b (verification tail once P4b merges).
 *   - Send emails the customer, and Convert can append to an existing invoice —
 *     both use an inline two-click confirm (no modal, no window.confirm), per the
 *     UPR non-negotiable feedback rules.
 *   - Access is already gated to admins + the page:admin_mobile flag by
 *     AdminMobileRoute; there is no extra financial gate on this screen.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { AdminMobilePage, adminEstimateEditorHref, adminInvoiceHref } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import { buildEstimateSendPayload, interpretConvertResult, deriveEstimateView } from '@/components/admin-mobile/estimate/estimateActions';
import EstimateHeader from '@/components/admin-mobile/estimate/EstimateHeader';
import EstimateLines from '@/components/admin-mobile/estimate/EstimateLines';

const toast = (m, t = 'success') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

const divLabel = (d) => {
  if (!d) return 'Estimate';
  return String(d).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

export default function AdminEstimateDetail() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db } = useAuth();

  // dbRef keeps the latest client so load() runs once per estimate, not on every token refresh.
  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: State & hooks ──────────────
  const [est, setEst] = useState(null);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    const d = dbRef.current;
    setLoading(true);
    try {
      const e = (await d.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
      if (!e) { toast('Estimate not found', 'error'); navigate('/tech/admin/collections', { replace: true }); return; }
      setEst(e);
      const j = e.job_id
        ? (await d.select('jobs', `id=eq.${e.job_id}&select=id,division,job_number,claim_id,primary_contact_id&limit=1`))?.[0]
        : null;
      setJob(j || null);
      setClaim(j?.claim_id ? (await d.select('claims', `id=eq.${j.claim_id}&select=claim_number,insurance_carrier,date_of_loss&limit=1`))?.[0] || null : null);
      const cid = e.contact_id || j?.primary_contact_id;
      setContact(cid ? (await d.select('contacts', `id=eq.${cid}&select=name,email&limit=1`))?.[0] || null : null);
      setLines(await d.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc.nullslast,created_at.asc`) || []);
    } catch (err) {
      toast('Failed to load estimate: ' + (err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }, [estimateId, navigate]);

  useEffect(() => { load(); }, [load]);

  // Derived view-model (safe on a null estimate → zeros/Draft) so the action
  // handlers below can read it without depending on render order.
  const view = deriveEstimateView(est, lines);

  // ─── SECTION: QBO actions (call-only workers) ──────────────
  const callEstimateWorker = async (body) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/qbo-estimate', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  // Email the estimate to the customer via QuickBooks. Two-click confirm because
  // it sends outward. Push it to QBO first if it isn't there yet (send needs it).
  const sendEstimate = async () => {
    if (!confirmSend) { setConfirmSend(true); return; }
    setConfirmSend(false); setBusy(true);
    try {
      if (!est.qbo_estimate_id) { await callEstimateWorker({ estimate_id: estimateId }); }
      const data = await callEstimateWorker(buildEstimateSendPayload(estimateId, contact?.email));
      toast(`Estimate sent to ${data.emailed_to || 'customer'}`);
      await load();
    } catch (err) {
      toast('Couldn’t send estimate: ' + (err.message || err), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Turn an accepted estimate into the job's invoice (and link it in QuickBooks).
  // Honors the RPC's needs_confirm two-click "append to existing invoice" return.
  const convertToInvoice = async () => {
    const force = confirmConvert;
    setBusy(true);
    try {
      // Best-effort: make sure it's in QBO so the invoice can be linked. QBO may be
      // off — convert in UPR regardless (mirrors the desktop editor).
      if (!est.qbo_estimate_id && view.total > 0) {
        try { await callEstimateWorker({ estimate_id: estimateId }); await load(); } catch { /* QBO off — continue */ }
      }
      const res = await db.rpc('convert_estimate_to_invoice', { p_estimate_id: estimateId, p_force: force });
      const { needsConfirm, existingLineCount, invoiceId } = interpretConvertResult(res);
      if (needsConfirm) {
        setConfirmConvert(true);
        toast(`That job’s invoice already has ${existingLineCount} line(s) — tap Convert again to append.`, 'error');
        setBusy(false);
        return;
      }
      if (!invoiceId) throw new Error('Convert did not return an invoice');
      setConfirmConvert(false);
      try {
        const auth = await getAuthHeader();
        const pr = await fetch('/api/qbo-invoice', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: invoiceId }) });
        if (!pr.ok) { const d = await pr.json().catch(() => ({})); throw new Error(d.error || pr.statusText); }
        toast('Estimate converted to invoice & linked in QuickBooks');
      } catch (err) {
        toast('Converted to invoice — finish the QuickBooks push from the invoice: ' + err.message, 'error');
      }
      navigate(adminInvoiceHref(invoiceId));
    } catch (err) {
      toast('Convert failed: ' + (err.message || err), 'error');
      setBusy(false);
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) return <AdminMobilePage title="Estimate" back={() => navigate(-1)}><TabLoading /></AdminMobilePage>;
  if (!est) return null;

  const division = divLabel(est.intended_division || job?.division);
  const canConvert = !view.converted && view.total > 0;
  const sendLabel = confirmSend ? 'Tap again to send' : est.qbo_emailed_at ? 'Resend to customer' : 'Send to customer';

  return (
    <AdminMobilePage title="Estimate" subtitle={view.docNumber} back={() => navigate(-1)}>
      {/* Banners */}
      {est.qbo_sync_error && (
        <div className="am-est-banner am-est-banner--danger">Couldn’t save to QuickBooks: {est.qbo_sync_error}</div>
      )}
      {view.converted && (
        <div className="am-est-banner am-est-banner--success">
          Converted to an invoice.{' '}
          <button type="button" className="am-est-banner-link" onClick={() => navigate(adminInvoiceHref(est.converted_invoice_id))}>
            View invoice →
          </button>
        </div>
      )}

      <EstimateHeader est={est} view={view} job={job} claim={claim} contact={contact} division={division} />

      <EstimateLines lines={lines} subtotal={view.subtotal} total={view.total} />

      {/* Actions */}
      <div className="am-est-actions">
        {!view.converted && (
          <button
            type="button"
            className={`am-est-btn am-est-btn--send${confirmSend ? ' am-est-btn--confirm' : ''}`}
            onClick={sendEstimate}
            onBlur={() => setConfirmSend(false)}
            disabled={busy}
            title={contact?.email ? `Send to ${contact.email}` : 'No email on file — add one to the contact first'}
          >
            {busy ? 'Working…' : sendLabel}
          </button>
        )}

        {canConvert && (
          <button
            type="button"
            className={`am-est-btn am-est-btn--convert${confirmConvert ? ' am-est-btn--confirm' : ''}`}
            onClick={convertToInvoice}
            onBlur={() => setConfirmConvert(false)}
            disabled={busy}
            title="Turn this accepted estimate into an invoice"
          >
            {busy ? 'Working…' : confirmConvert ? 'Tap again to append to invoice' : 'Convert to invoice'}
          </button>
        )}

        {!view.converted && (
          <button type="button" className="am-est-btn am-est-btn--link" onClick={() => navigate(adminEstimateEditorHref(estimateId))}>
            Edit / add line items
          </button>
        )}
        <button type="button" className="am-est-btn am-est-btn--link" onClick={() => navigate(adminEstimateEditorHref())}>
          New estimate
        </button>
      </div>

      <div className="am-est-note">
        Sending emails the estimate to the customer through QuickBooks. Editing line items opens the estimate builder.
      </div>
    </AdminMobilePage>
  );
}
