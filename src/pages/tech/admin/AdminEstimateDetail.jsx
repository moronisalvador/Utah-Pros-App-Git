/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateDetail.jsx  (Admin Mobile — estimate financial document)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: The native estimate counterpart to the invoice document:
 * always-open customer, details, lines, and totals. An exact strict capability
 * gates the durable QuickBooks estimate send command; conversion remains a
 * local UPR operation and never auto-saves the resulting invoice.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { impact, notify, selection } from '@/lib/nativeHaptics';
import { getAuthHeader } from '@/lib/realtime';
import { callQboEstimateWorker } from '@/lib/qboEstimateWorker';
import { err, ok } from '@/lib/toast';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import StatusPill from '@/components/ui/StatusPill';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import DocumentLineList from '@/components/admin-mobile/document/DocumentLineList';
import { formatDocumentMoney } from '@/components/admin-mobile/document/documentMath';
import { adminEstimateEditorHref, adminInvoiceHref } from '@/components/admin-mobile/href';
import { deriveEstimateView, interpretConvertResult } from '@/components/admin-mobile/estimate/estimateActions';

const COLLECTIONS = '/tech/admin/collections?tab=estimates';
const date = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function AdminEstimateDetail() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, isStrictFeatureEnabled, user } = useAuth();
  const billingEnabled = isFeatureEnabled('feature:billing');
  const documentCommandsEnabled = isStrictFeatureEnabled('feature:qbo_document_command_v2');
  const dbRef = useRef(db);
  const loadRef = useRef(0);
  const actionRef = useRef({ key: estimateId, epoch: 0, busy: false, alive: true });
  const documentCommandsEnabledRef = useRef(documentCommandsEnabled);
  documentCommandsEnabledRef.current = documentCommandsEnabled;
  if (actionRef.current.key !== estimateId) actionRef.current = { key: estimateId, epoch: actionRef.current.epoch + 1, busy: false, alive: true };
  dbRef.current = db;
  const [estimate, setEstimate] = useState(null);
  const [job, setJob] = useState(null);
  const [claim, setClaim] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const { isArmed, arm, cancel } = useTwoClickConfirm();

  const back = useCallback(() => navigate(COLLECTIONS), [navigate]);
  const load = useCallback(async () => {
    const request = ++loadRef.current;
    if (!billingEnabled) { setLoading(false); return; }
    const activeDb = dbRef.current;
    try {
      const row = (await activeDb.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
      if (request !== loadRef.current) return;
      if (!row) throw new Error('This estimate could not be found.');
      const estimateJob = row.job_id ? (await activeDb.select('jobs', `id=eq.${row.job_id}&select=id,division,job_number,claim_id,primary_contact_id&limit=1`))?.[0] : null;
      const contactId = row.contact_id || estimateJob?.primary_contact_id;
      const [claimRows, contactRows, lineRows] = await Promise.all([
        estimateJob?.claim_id ? activeDb.select('claims', `id=eq.${estimateJob.claim_id}&select=id,claim_number,insurance_carrier,date_of_loss&limit=1`) : Promise.resolve([]),
        contactId ? activeDb.select('contacts', `id=eq.${contactId}&select=id,name,email&limit=1`) : Promise.resolve([]),
        activeDb.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc.nullslast,created_at.asc`),
      ]);
      if (request !== loadRef.current) return;
      setEstimate(row); setJob(estimateJob || null); setClaim(claimRows?.[0] || null); setContact(contactRows?.[0] || null); setLines(lineRows || []); setLoadError('');
    } catch (error) {
      if (request !== loadRef.current) return;
      setEstimate(null); setLoadError(error?.message || 'Could not load this estimate.'); err(`Failed to load estimate: ${error?.message || error}`);
    } finally { if (request === loadRef.current) setLoading(false); }
  }, [billingEnabled, estimateId]);

  useEffect(() => {
    actionRef.current.alive = true;
    loadRef.current += 1; setEstimate(null); setJob(null); setClaim(null); setContact(null); setLines([]); setLoadError(''); setLoading(true); setBusy(false); load();
    return () => { loadRef.current += 1; actionRef.current = { ...actionRef.current, alive: false, busy: false, epoch: actionRef.current.epoch + 1 }; };
  }, [load]);

  const convert = async () => {
    if (!estimate || actionRef.current.busy) return;
    const epoch = actionRef.current.epoch;
    actionRef.current.busy = true; setBusy(true); impact('light');
    const current = () => actionRef.current.alive && actionRef.current.key === estimateId && actionRef.current.epoch === epoch;
    try {
      const result = await db.rpc('convert_estimate_to_invoice', {
        p_estimate_id: estimateId,
        p_force: confirmConvert,
      });
      if (!current()) return;
      const parsed = interpretConvertResult(result);
      if (parsed.needsConfirm) {
        notify('warning');
        setConfirmConvert(true);
        err(`That job’s invoice already has ${parsed.existingLineCount} line(s) — tap Convert again to append.`);
        return;
      }
      if (!parsed.invoiceId) throw new Error('Convert did not return an invoice.');
      setConfirmConvert(false);
      notify('success');
      ok('Estimate converted to an invoice. Review and save to QuickBooks from the invoice page.');
      navigate(adminInvoiceHref(parsed.invoiceId));
    } catch (error) {
      if (current()) {
        notify('error');
        err(`Convert failed: ${error?.message || error}`);
      }
    }
    finally { if (actionRef.current.alive && actionRef.current.key === estimateId && actionRef.current.epoch === epoch) { actionRef.current.busy = false; setBusy(false); } }
  };

  const send = async () => {
    if (!estimate || actionRef.current.busy || !documentCommandsEnabledRef.current) return;
    if (!isArmed('send-estimate')) { arm('send-estimate'); return; }
    cancel();
    const epoch = actionRef.current.epoch;
    const current = () => actionRef.current.alive
      && actionRef.current.key === estimateId
      && actionRef.current.epoch === epoch;
    actionRef.current.busy = true;
    setBusy(true);
    impact('light');
    try {
      const authHeaders = await getAuthHeader();
      // Token refresh can resolve after a route change or capability closure.
      // In either case, do not let an old UI interaction send an estimate.
      if (!current() || !documentCommandsEnabledRef.current) return;
      const result = await callQboEstimateWorker({
        ownerId: user?.id,
        estimateId,
        authHeaders,
        body: { action: 'send' },
      });
      if (!current()) return;
      notify('success');
      ok(`Estimate sent to ${result.emailed_to || contact?.email || 'the customer'}.`);
      await load(); // silent refresh: load never re-opens the page loading gate
    } catch (error) {
      if (current()) {
        notify('error');
        err(`Couldn’t send estimate: ${error?.message || error}`);
      }
    } finally {
      if (current()) { actionRef.current.busy = false; setBusy(false); }
    }
  };

  if (!billingEnabled) return <AdminMobilePage title="Estimate" back={back}><div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div></AdminMobilePage>;
  if (loading) return <AdminMobilePage title="Estimate" back={back}><TabLoading /></AdminMobilePage>;
  if (!estimate) return <AdminMobilePage title="Estimate" back={back}><ErrorState message={loadError || 'This estimate is unavailable.'} onRetry={load} /></AdminMobilePage>;
  const view = deriveEstimateView(estimate, lines);
  const address = [estimate.property_address, estimate.property_city, estimate.property_state, estimate.property_zip].filter(Boolean).join(', ');
  const terminal = ['approved', 'denied', 'paid'].includes(String(estimate.status || '').toLowerCase());
  const canConvert = !view.converted && !terminal && view.total > 0;
  return (
    <AdminMobilePage title="Estimate" subtitle={view.docNumber} back={back}>
      {estimate.qbo_sync_error && <div className="am-alert am-alert--danger" role="status"><strong>QuickBooks sync error</strong><span>{estimate.qbo_sync_error}</span></div>}
      {view.converted && <div className="am-alert am-alert--warning" role="status"><strong>Converted to an invoice</strong><Link to={adminInvoiceHref(estimate.converted_invoice_id)}>View invoice</Link></div>}
      <section className="am-section am-invoice-context" aria-labelledby="estimate-customer-title"><div className="am-section-heading"><h2 id="estimate-customer-title" className="am-section-label">Customer</h2><StatusPill status={view.statusKind} label={view.statusLabel} /></div><div className="am-invoice-customer-name">{contact?.name || 'Customer not assigned'}</div><div className="am-invoice-context-meta">{contact?.email && <span>{contact.email}</span>}</div></section>
      <section className="am-section am-money" aria-labelledby="estimate-total-title"><h2 id="estimate-total-title" className="am-section-label">Estimate total</h2><div className="am-money-hero">{formatDocumentMoney(view.total)}</div><div className="am-money-pair"><div><span>Subtotal</span><strong>{formatDocumentMoney(view.subtotal)}</strong></div><div><span>QuickBooks</span><strong>{view.synced ? 'Synced' : 'Draft'}</strong></div></div></section>
      {!view.converted && !terminal && !documentCommandsEnabled && <div className="am-section-note">QuickBooks estimate actions are temporarily unavailable during an update.</div>}
      <section className="am-section" aria-labelledby="estimate-details-title"><div className="am-section-heading"><h2 id="estimate-details-title" className="am-section-label">Estimate details</h2></div><div className="am-detail-list"><Detail label="Customer email" value={contact?.email || '—'} /><Detail label="Type" value={estimate.estimate_type?.replaceAll('_', ' ') || 'Estimate'} /><Detail label="Expires" value={date(estimate.expiration_date || estimate.expiry_date)} /><Detail label="Sent" value={estimate.qbo_emailed_at ? date(estimate.qbo_emailed_at) : 'Not sent'} /><Detail label="Carrier" value={claim?.insurance_carrier || '—'} /><Detail label="Claim" value={claim?.claim_number || '—'} /><Detail label="Job" value={job?.job_number || 'Not assigned'} />{address && <Detail label="Address" value={address} multiline />}</div></section>
      <DocumentLineList lines={lines} editable={false}><div className="am-total-list"><Detail label="Subtotal" value={formatDocumentMoney(view.subtotal)} /><Detail label="Total" value={formatDocumentMoney(view.total)} strong /></div></DocumentLineList>
      <section className="am-section am-document-actions" aria-label="Estimate actions">
        {documentCommandsEnabled && view.synced && !view.converted && !terminal && <button type="button" className={`am-inv-btn${isArmed('send-estimate') ? ' am-inv-btn--confirm' : ''}`} disabled={busy || !contact?.email} onClick={send} onBlur={cancel}>{busy ? 'Sending…' : isArmed('send-estimate') ? `Tap again to send to ${contact.email}` : estimate.qbo_emailed_at ? 'Resend to customer' : 'Send to customer'}</button>}
        {canConvert && <button type="button" className={`am-inv-btn${confirmConvert ? ' am-inv-btn--confirm' : ''}`} disabled={busy} onClick={convert} onBlur={() => setConfirmConvert(false)}>{busy ? 'Working…' : confirmConvert ? 'Tap again to append to invoice' : 'Convert to invoice'}</button>}
        <button type="button" className="am-inv-btn" onClick={() => { selection(); navigate(adminEstimateEditorHref()); }}>New estimate</button>
      </section>
    </AdminMobilePage>
  );
}

function Detail({ label, value, multiline = false, strong = false }) { return <div className={`am-detail-row${multiline ? ' am-detail-row--multiline' : ''}`}><span>{label}</span><strong className={strong ? 'am-detail-row-strong' : ''}>{value}</strong></div>; }
