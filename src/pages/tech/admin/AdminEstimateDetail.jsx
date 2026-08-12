/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateDetail.jsx  (Admin Mobile — Estimate view + local convert, P4a)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single-estimate screen inside the field-tech app, for admins. You open
 *   an estimate to read it (its details and line items), or turn it into an
 *   invoice in one flow. QuickBooks estimate send is temporarily contained while
 *   its durable accounting boundary is completed. Building or changing the line
 *   items happens on a separate builder screen, reached from the "Edit / add line
 *   items" and "New estimate" links here.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId  (inside AdminMobileRoutes)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/components/admin-mobile (AdminMobilePage, href helpers),
 *              ./estimate/{estimateActions, EstimateHeader, EstimateLines}
 *   Data:      reads  → estimates, estimate_line_items, jobs, claims, contacts
 *              writes → on convert: invoices via convert_estimate_to_invoice RPC
 *
 * NOTES / GOTCHAS:
 *   - Conversion only creates the local invoice. Review it and use the human
 *     Save to QuickBooks action in InvoiceEditor; this page never calls the
 *     QBO invoice worker automatically.
 *   - Line items are READ-ONLY on this screen; editing lives in the builder
 *     (P4b) at adminEstimateEditorHref(). That route is Foundation-frozen; the
 *     builder page itself lands with P4b (verification tail once P4b merges).
 *   - Convert can append to an existing invoice and uses an inline two-click
 *     confirm (no modal, no window.confirm), per the UPR non-negotiable feedback
 *     rules.
 *   - Access is already gated to admins + the page:admin_mobile flag by
 *     AdminMobileRoute; there is no extra financial gate on this screen.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
// Concrete modules, not the '@/components/admin-mobile' barrel — the native build
// aliases that barrel to a denying shim, and it would drag AdminMobileRoute plus the
// dash/collections primitives into the native graph.
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import { adminEstimateEditorHref, adminInvoiceHref } from '@/components/admin-mobile/href';
import { IS_NATIVE_BUILD } from '@/routes/buildTargetPages';
import TabLoading from '@/components/TabLoading';
import { interpretConvertResult, deriveEstimateView } from '@/components/admin-mobile/estimate/estimateActions';
import EstimateHeader from '@/components/admin-mobile/estimate/EstimateHeader';
import EstimateLines from '@/components/admin-mobile/estimate/EstimateLines';

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

  // Turn an accepted estimate into the job's invoice. The estimate stays an
  // internal document during the temporary QBO-estimate containment window.
  // Honors the RPC's needs_confirm two-click "append to existing invoice" return.
  const convertToInvoice = async () => {
    const force = confirmConvert;
    setBusy(true);
    try {
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
      toast('Estimate converted to an invoice. Review it and save to QuickBooks from the invoice page.');
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
  // Convert-to-invoice is WEB-ONLY. It ends by navigating to the invoice detail
  // screen, which is deliberately not in the native bundle (bringing it over would
  // also drag the record-payment write path, which still has no idempotency key —
  // see recordPayment.js). The native slice is view/correct only; turning one into
  // an invoice stays on the desktop until the invoice screen is ported.
  const canConvert = !IS_NATIVE_BUILD && !view.converted && view.total > 0;

  return (
    <AdminMobilePage title="Estimate" subtitle={view.docNumber} back={() => navigate(-1)}>
      {/* Banners */}
      <div role="status" className="am-est-banner" style={{ background: 'var(--status-waiting-bg)', color: 'var(--status-waiting)', border: '1px solid var(--status-waiting)' }}>
        QuickBooks estimate save, send, resend, and revert are temporarily unavailable while we complete a durable accounting update. You can continue editing in UPR and convert to an invoice on the web.
      </div>
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
        Editing line items opens the estimate builder. QuickBooks estimate delivery is temporarily unavailable.
      </div>
    </AdminMobilePage>
  );
}
