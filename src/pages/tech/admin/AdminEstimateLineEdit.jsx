/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateLineEdit.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets an authorized office user add, change, remove, or move one charge on
 *   an estimate. It loads the estimate and its charges, then offers the current
 *   QuickBooks item and class choices when the estimate can still be changed.
 *   A save asks the protected company service to make the change; this screen
 *   does not change estimate charges directly.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId/line/:lineId
 *   Rendered by:  src/App.jsx (native build route) and
 *                 src/pages/tech/admin/AdminMobileRoutes.jsx (web subroute)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/lib/realtime,
 *              @/lib/qboEstimateWorker, @/lib/nativeHaptics, @/lib/toast,
 *              @/components/TabLoading, @/components/ui/ErrorState,
 *              @/components/admin-mobile/AdminMobilePage,
 *              @/components/admin-mobile/document/DocumentLineEditor,
 *              @/components/admin-mobile/estimate/estimateBuilder,
 *              @/components/admin-mobile/href,
 *              @/components/admin-mobile/invoice/invoiceLineEdit
 *   Data:      reads  → estimates, estimate_line_items
 *              writes → none directly; the protected estimate command handles
 *                        approved estimate and estimate-line changes
 *
 * NOTES / GOTCHAS:
 *   - Item and class choices come from the read-only /api/qbo-query worker.
 *   - callQboEstimateWorker sends save, remove, and reorder requests only to
 *     /api/qbo-estimate. That command boundary protects the QuickBooks change
 *     and keeps a rejected request from changing local estimate lines.
 *   - Finalized or converted estimates are read-only, and the billing feature
 *     switch prevents all loading and saving when it is off.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { callQboEstimateWorker } from '@/lib/qboEstimateWorker';
import { impact, notify } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import DocumentLineEditor from '@/components/admin-mobile/document/DocumentLineEditor';
import { parseQboCatalog, buildLineUpdate } from '@/components/admin-mobile/estimate/estimateBuilder';
import { adminEstimateHref } from '@/components/admin-mobile/href';
import { invoiceLineChangeValidationError } from '@/components/admin-mobile/invoice/invoiceLineEdit';

const blank = () => ({ description: '', quantity: 1, unit_price: 0 });
const patch = (line) => buildLineUpdate(line);
const validation = invoiceLineChangeValidationError;

export default function AdminEstimateLineEdit() {
  const { estimateId, lineId } = useParams();
  const navigate = useNavigate();
  const { db, isFeatureEnabled, isStrictFeatureEnabled, user } = useAuth();
  const billingEnabled = isFeatureEnabled('feature:billing');
  const documentCommandsEnabled = isStrictFeatureEnabled('feature:qbo_document_command_v2');
  const creating = lineId === 'new';
  const dbRef = useRef(db); dbRef.current = db;
  const requestRef = useRef(0); const catalogRef = useRef(0); const saveRef = useRef(false);
  const routeRef = useRef({ key: `${estimateId}:${lineId}`, epoch: 0, alive: true });
  const routeKey = `${estimateId}:${lineId}`;
  if (routeRef.current.key !== routeKey) { routeRef.current = { key: routeKey, epoch: routeRef.current.epoch + 1, alive: true }; saveRef.current = false; }
  const [estimate, setEstimate] = useState(null); const [line, setLine] = useState(null); const [allLines, setAllLines] = useState([]);
  const [items, setItems] = useState([]); const [classes, setClasses] = useState([]); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const [catalogMessage, setCatalogMessage] = useState(''); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  const back = adminEstimateHref(estimateId);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    if (!billingEnabled || !documentCommandsEnabled) { setLoading(false); return; }
    try {
      const activeDb = dbRef.current;
      const currentEstimate = (await activeDb.select('estimates', `id=eq.${estimateId}&select=id,status,qbo_estimate_id,qbo_doc_number,estimate_number,converted_invoice_id&limit=1`))?.[0];
      if (!currentEstimate) throw new Error('This estimate could not be found.');
      const lines = await activeDb.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc.nullslast,created_at.asc`) || [];
      const currentLine = creating ? blank() : lines.find((candidate) => candidate.id === lineId);
      if (!currentLine) throw new Error('This line item is unavailable for this estimate.');
      if (request !== requestRef.current) return;
      setEstimate(currentEstimate); setAllLines(lines); setLine(currentLine); setLoadError('');
    } catch (error) { if (request === requestRef.current) { setEstimate(null); setLine(null); setLoadError(error?.message || 'Could not load this line item.'); } }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [billingEnabled, creating, documentCommandsEnabled, estimateId, lineId]);
  const loadCatalog = useCallback(async () => {
    const request = ++catalogRef.current;
    const epoch = routeRef.current.epoch;
    try {
      const auth = await getAuthHeader();
      if (request !== catalogRef.current || !routeRef.current.alive || routeRef.current.epoch !== epoch) return;
      const run = async (query) => { const response = await fetch('/api/qbo-query', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText); return data.queryResponse || {}; };
      const [itemResponse, classResponse] = await Promise.all([run('SELECT Id, Name, Type FROM Item WHERE Active = true MAXRESULTS 200'), run('SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 200')]);
      if (request !== catalogRef.current || !routeRef.current.alive || routeRef.current.epoch !== epoch) return;
      const catalog = parseQboCatalog(itemResponse, classResponse); setItems(catalog.items); setClasses(catalog.classes); setCatalogMessage('');
    } catch { if (request === catalogRef.current && routeRef.current.alive && routeRef.current.epoch === epoch) setCatalogMessage('QuickBooks catalog unavailable — existing selections and other fields can still be edited.'); }
  }, []);
  useEffect(() => { routeRef.current.alive = true; requestRef.current += 1; catalogRef.current += 1; saveRef.current = false; setEstimate(null); setLine(null); setAllLines([]); setItems([]); setClasses([]); setCatalogMessage(''); setLoading(true); setLoadError(''); setConfirmDelete(false); setBusy(false); load(); return () => { requestRef.current += 1; catalogRef.current += 1; saveRef.current = false; routeRef.current = { ...routeRef.current, alive: false, epoch: routeRef.current.epoch + 1 }; }; }, [load]);
  const terminal = ['approved', 'denied', 'paid'].includes(String(estimate?.status || '').toLowerCase());
  useEffect(() => { if (documentCommandsEnabled && estimate && !estimate.converted_invoice_id && !terminal) loadCatalog(); }, [documentCommandsEnabled, estimate, loadCatalog, terminal]);
  const submit = async (change) => {
    if (!documentCommandsEnabled || !estimate || !line || saveRef.current || estimate.converted_invoice_id || terminal) return;
    if (change.kind !== 'delete' && change.kind !== 'reorder') { const message = validation(line, creating); if (message) { notify('error'); err(message); return; } }
    const epoch = routeRef.current.epoch; saveRef.current = true; setBusy(true); impact('light');
    try {
      const authHeaders = await getAuthHeader();
      if (!routeRef.current.alive || routeRef.current.key !== routeKey || routeRef.current.epoch !== epoch) return;
      await callQboEstimateWorker({ ownerId: user?.id, estimateId, authHeaders, body: { action: 'save', line_change: change } });
      if (!routeRef.current.alive || routeRef.current.key !== routeKey || routeRef.current.epoch !== epoch) return;
      notify('success'); ok(change.kind === 'delete' ? 'Line item removed.' : 'Estimate saved to QuickBooks.'); navigate(back, { replace: true });
    } catch (error) { if (routeRef.current.alive && routeRef.current.key === routeKey && routeRef.current.epoch === epoch) { notify('error'); err(`Couldn’t update QuickBooks: ${error?.message || error}`); } }
    finally { if (routeRef.current.alive && routeRef.current.key === routeKey && routeRef.current.epoch === epoch) { saveRef.current = false; setBusy(false); } }
  };
  const move = (direction) => {
    const index = allLines.findIndex((candidate) => candidate.id === line.id); const target = index + direction;
    if (index < 0 || target < 0 || target >= allLines.length) return;
    const ordered = [...allLines]; [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    submit({ kind: 'reorder', ordered_line_ids: ordered.map((candidate) => candidate.id) });
  };
  if (!billingEnabled) return <AdminMobilePage title="Edit line item" back={back}><div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div></AdminMobilePage>;
  if (!documentCommandsEnabled) return <AdminMobilePage title="Edit line item" back={back}><ErrorState message="Estimate line editing is temporarily unavailable during a QuickBooks update." /></AdminMobilePage>;
  if (loading) return <AdminMobilePage title="Edit line item" back={back}><TabLoading /></AdminMobilePage>;
  if (loadError || !estimate || !line) return <AdminMobilePage title="Edit line item" back={back}><ErrorState message={loadError || 'This line item is unavailable.'} onRetry={load} /></AdminMobilePage>;
  if (estimate.converted_invoice_id || terminal) return <AdminMobilePage title="Edit line item" back={back}><ErrorState message="This estimate is finalized and its line items are read-only." /></AdminMobilePage>;
  const lineIndex = allLines.findIndex((candidate) => candidate.id === line.id);
  return <AdminMobilePage title={creating ? 'Add line item' : 'Edit line item'} subtitle={estimate.qbo_doc_number || estimate.estimate_number} back={back}>
    {catalogMessage && <div className="am-alert am-alert--warning" role="status">{catalogMessage}</div>}
    <DocumentLineEditor line={line} items={items} classes={classes} busy={busy} saveLabel={estimate.qbo_estimate_id ? 'Update QuickBooks' : 'Save to QuickBooks'} onPatch={(next) => setLine((current) => ({ ...current, ...next }))} onSave={() => submit(creating ? { kind: 'create', patch: patch(line) } : { kind: 'update', line_id: line.id, patch: patch(line) })} />
    {!creating && <div className="am-line-tools"><div className="am-line-tools-row"><button type="button" className="am-line-tool" disabled={busy || lineIndex <= 0} onClick={() => move(-1)}>Move up</button><button type="button" className="am-line-tool" disabled={busy || lineIndex < 0 || lineIndex >= allLines.length - 1} onClick={() => move(1)}>Move down</button></div><button type="button" className={`am-line-tool am-line-tool--danger${confirmDelete ? ' am-line-tool--confirm' : ''}`} disabled={busy || allLines.length <= 1} title={allLines.length <= 1 ? 'Add another line before deleting the only line item.' : undefined} onBlur={() => setConfirmDelete(false)} onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } setConfirmDelete(false); submit({ kind: 'delete', line_id: line.id }); }}>{confirmDelete ? 'Tap again to delete' : 'Delete line item'}</button>{allLines.length <= 1 && <div className="am-document-note">An estimate must keep at least one line item.</div>}</div>}
  </AdminMobilePage>;
}
