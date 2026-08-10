/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceLineEdit.jsx  (Admin Mobile — edit one invoice line)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads one invoice and one line constrained to that invoice. Its one submit
 *   sends only the safe source-field patch with the idempotent human
 *   Save-to-QuickBooks command. The Worker reserves the invoice and freezes the
 *   patch without changing local data, then uses a service-only finalizer only
 *   after QuickBooks accepts the exact frozen invoice update.
 *
 * DEPENDS ON: AuthContext db, QBO catalog call-only seam, AdminMobilePage.
 * DATA: reads invoices/invoice_line_items; writes only through the QBO Worker.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { callQboInvoiceWorker } from '@/lib/qboInvoiceWorker';
import { impact, notify } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import { adminInvoiceHref } from '@/components/admin-mobile/href';
import { parseQboCatalog } from '@/components/admin-mobile/estimate/estimateBuilder';
import InvoiceLineEditor from '@/components/admin-mobile/invoice/InvoiceLineEditor';
import {
  buildInvoiceLineUpdate,
  invoiceLineValidationError,
} from '@/components/admin-mobile/invoice/invoiceLineEdit';

export default function AdminInvoiceLineEdit() {
  const { invoiceId, lineId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, user } = useAuth();
  const billingEnabled = isFeatureEnabled('feature:billing');
  const dbRef = useRef(db);
  const savingRef = useRef(false);
  const loadRequestRef = useRef(0);
  const catalogRequestRef = useRef(0);
  const saveRouteRef = useRef({ routeKey: `${invoiceId}:${lineId}`, epoch: 0, token: 0, activeToken: null });
  const routeKey = `${invoiceId}:${lineId}`;
  if (saveRouteRef.current.routeKey !== routeKey) {
    saveRouteRef.current = {
      ...saveRouteRef.current,
      routeKey,
      epoch: saveRouteRef.current.epoch + 1,
      activeToken: null,
    };
    savingRef.current = false;
  }
  dbRef.current = db;
  const [invoice, setInvoice] = useState(null);
  const [line, setLine] = useState(null);
  const [items, setItems] = useState([]);
  const [classes, setClasses] = useState([]);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const back = adminInvoiceHref(invoiceId);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const requestedInvoiceId = invoiceId;
    const requestedLineId = lineId;
    if (!billingEnabled) {
      if (requestId === loadRequestRef.current) setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const activeDb = dbRef.current;
      const currentInvoice = (await activeDb.select('invoices', `id=eq.${requestedInvoiceId}&select=id,locked,qbo_invoice_id,status,qbo_doc_number,invoice_number&limit=1`))?.[0];
      if (requestId !== loadRequestRef.current) return;
      if (!currentInvoice) throw new Error('This invoice could not be found.');
      const currentLine = (await activeDb.select('invoice_line_items', `id=eq.${requestedLineId}&invoice_id=eq.${requestedInvoiceId}&limit=1`))?.[0];
      if (requestId !== loadRequestRef.current) return;
      if (!currentLine) throw new Error('This line item is unavailable for this invoice.');
      setInvoice(currentInvoice);
      setLine(currentLine);
      setLoadError('');
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      const message = error?.message || 'Could not load this line item.';
      err(message);
      setInvoice(null);
      setLine(null);
      setLoadError(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [billingEnabled, invoiceId, lineId]);

  const loadCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current;
    try {
      const auth = await getAuthHeader();
      if (requestId !== catalogRequestRef.current) return;
      const run = async (query) => {
        const response = await fetch('/api/qbo-query', {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || response.statusText);
        return data.queryResponse || {};
      };
      const [itemResponse, classResponse] = await Promise.all([
        run('SELECT Id, Name, Type FROM Item WHERE Active = true MAXRESULTS 200'),
        run('SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 200'),
      ]);
      if (requestId !== catalogRequestRef.current) return;
      const catalog = parseQboCatalog(itemResponse, classResponse);
      setItems(catalog.items); setClasses(catalog.classes); setCatalogMessage('');
    } catch (error) {
      if (requestId !== catalogRequestRef.current) return;
      setCatalogMessage(/not connected/i.test(error?.message || '')
        ? 'QuickBooks isn’t connected — item and class pickers are unavailable.'
        : 'QuickBooks catalog unavailable — existing selections and other fields can still be edited.');
    }
  }, []);

  useEffect(() => {
    // Route-owned state must never briefly show the previous invoice or line
    // while this route's request is still in flight.
    loadRequestRef.current += 1;
    catalogRequestRef.current += 1;
    setInvoice(null);
    setLine(null);
    setItems([]);
    setClasses([]);
    setCatalogMessage('');
    setLoadError('');
    setLoading(true);
    setBusy(false);
    load();
    return () => {
      loadRequestRef.current += 1;
      catalogRequestRef.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (billingEnabled && invoice && !invoice.locked) loadCatalog();
  }, [billingEnabled, invoice, loadCatalog]);

  const save = async () => {
    if (!billingEnabled || savingRef.current || !line || !invoice || invoice.locked) return;
    const validationError = invoiceLineValidationError(line);
    if (validationError) { notify('error'); err(validationError); return; }
    const route = saveRouteRef.current;
    const token = ++route.token;
    const routeEpoch = route.epoch;
    const isCurrentRoute = () => {
      const current = saveRouteRef.current;
      return current.routeKey === routeKey && current.epoch === routeEpoch && current.activeToken === token;
    };
    savingRef.current = true;
    route.activeToken = token;
    impact('light');
    setBusy(true);
    try {
      const update = buildInvoiceLineUpdate(line);
      const authHeaders = await getAuthHeader();
      // Auth can resolve after a route transition. Never issue the QBO save
      // for the old line in that case.
      if (!isCurrentRoute()) return;
      await callQboInvoiceWorker({
        ownerId: user?.id,
        invoiceId: invoice.id,
        authHeaders,
        body: { action: 'save', line_update: { line_id: line.id, ...update } },
      });
      if (!isCurrentRoute()) return;
      notify('success');
      ok('Invoice saved to QuickBooks.');
      navigate(back, { replace: true });
    } catch (error) {
      if (!isCurrentRoute()) return;
      notify('error');
      const message = error?.message || String(error);
      const locked = /invoice is locked/i.test(message);
      if (locked) setInvoice((current) => (current ? { ...current, locked: true } : current));
      let feedback;
      if (locked) {
        feedback = 'This invoice was locked before the line item could be saved.';
      } else {
        feedback = `Couldn’t update QuickBooks: ${message}`;
      }
      err(feedback);
    } finally {
      if (isCurrentRoute()) {
        savingRef.current = false;
        saveRouteRef.current.activeToken = null;
        setBusy(false);
      }
    }
  };

  if (!billingEnabled) return <AdminMobilePage title="Edit line item" back={back}><div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div></AdminMobilePage>;
  if (loading) return <AdminMobilePage title="Edit line item" back={back}><TabLoading /></AdminMobilePage>;
  if (loadError || !invoice || !line) return <AdminMobilePage title="Edit line item" back={back}><ErrorState message={loadError || 'This line item is unavailable.'} onRetry={load} /></AdminMobilePage>;
  if (invoice.locked) return <AdminMobilePage title="Edit line item" subtitle={invoice.qbo_doc_number || invoice.invoice_number} back={back}><ErrorState icon="🔒" message="This invoice is locked and its line items are read-only." /></AdminMobilePage>;

  return (
    <AdminMobilePage title="Edit line item" subtitle={invoice.qbo_doc_number || invoice.invoice_number} back={back}>
      {catalogMessage && <div className="am-alert am-alert--warning" role="status">{catalogMessage}</div>}
      <InvoiceLineEditor line={line} items={items} classes={classes} qboInvoiceId={invoice.qbo_invoice_id} busy={busy} onPatch={(patch) => setLine((current) => ({ ...current, ...patch }))} onSave={save} />
    </AdminMobilePage>
  );
}
