/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateEditor.jsx  (Admin Mobile — Estimate create + line-item builder, P4b)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The estimate builder inside the field-tech app, for admins. Opened without
 *   an estimate it's the "new estimate" form: pick (or add) a customer, choose
 *   the job type and estimate type, note the property address, and create it.
 *   Opened with an estimate it's the line-item builder: add lines, pick the
 *   QuickBooks item/class for each, type the scope, set quantity and rate, and
 *   watch the total build. Edits save as you go. When you're done you jump to
 *   the estimate screen to send or convert it.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/new  and  /tech/admin/estimate/:estimateId/edit
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/realtime (getAuthHeader),
 *              @/lib/toast, @/components/admin-mobile (AdminMobilePage, href helpers),
 *              @/components/TabLoading, ./estimate builder modules
 *              (estimateBuilder, EstimateCreateForm, LineItemCard)
 *   Data:      reads  → estimates, contacts, estimate_line_items;
 *                       QBO items/classes via /api/qbo-query (call-only)
 *              writes → estimate_line_items (add/edit/remove — safe columns only),
 *                       create_estimate_for_contact RPC (call-only, via the form)
 *
 * NOTES / GOTCHAS:
 *   - estimate_line_items.line_total is a GENERATED column — never written; every
 *     write goes through buildLineInsert/buildLineUpdate (pinned by the named P4b
 *     tests). A DB trigger rolls the lines up into estimates.subtotal/amount, so
 *     this screen never writes the estimates table at all.
 *   - /api/qbo-query is CALL-ONLY (item/class catalog). Pushing to QuickBooks,
 *     sending, and converting stay on the estimate screen (P4a) — the builder
 *     deliberately has no QBO write path.
 *   - A CONVERTED estimate is read-only (it became an invoice) — the builder
 *     bounces back to the estimate view.
 *   - No drag-reorder on mobile (gloved hands); lines keep creation order.
 *   - Access is gated to admins + the page:admin_mobile flag by AdminMobileRoute.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { toast } from '@/lib/toast';
import { AdminMobilePage, adminEstimateHref, adminEstimateEditorHref } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import { buildLineInsert, buildLineUpdate, parseQboCatalog, computeTotals } from '@/components/admin-mobile/estimate/estimateBuilder';
import EstimateCreateForm from '@/components/admin-mobile/estimate/EstimateCreateForm';
import LineItemCard from '@/components/admin-mobile/estimate/LineItemCard';

const fmt$ = (n) =>
  Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export default function AdminEstimateEditor() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  // dbRef keeps the latest client so load() runs once per estimate (not on every
  // token refresh), preserving in-progress edits.
  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: State & hooks ──────────────
  const [est, setEst] = useState(null);
  const [contact, setContact] = useState(null);
  const [lines, setLines] = useState([]);
  const [qboItems, setQboItems] = useState([]);
  const [qboClasses, setQboClasses] = useState([]);
  const [catalogMsg, setCatalogMsg] = useState('');
  const [loading, setLoading] = useState(!!estimateId);
  const [busy, setBusy] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    if (!estimateId) return;
    const d = dbRef.current;
    setLoading(true);
    try {
      const e = (await d.select('estimates', `id=eq.${estimateId}&limit=1`))?.[0];
      if (!e) { toast('Estimate not found', 'error'); navigate('/tech/admin/collections', { replace: true }); return; }
      // Converted = read-only; the builder has nothing to do here.
      if (e.converted_invoice_id) { navigate(adminEstimateHref(estimateId), { replace: true }); return; }
      setEst(e);
      setContact(e.contact_id ? (await d.select('contacts', `id=eq.${e.contact_id}&select=name,email&limit=1`))?.[0] || null : null);
      let ls = await d.select('estimate_line_items', `estimate_id=eq.${estimateId}&order=sort_order.asc.nullslast,created_at.asc`) || [];
      // Fresh draft: seed one blank line so the builder opens ready to type
      // (mirrors the desktop editor; non-fatal if it doesn't stick).
      if (ls.length === 0 && !e.qbo_estimate_id) {
        try {
          const created = await d.insert('estimate_line_items', buildLineInsert(estimateId, 0));
          const row = Array.isArray(created) ? created[0] : created;
          if (row) ls = [row];
        } catch { /* user can still + Add line */ }
      }
      setLines(ls);
    } catch (err) {
      toast('Failed to load estimate: ' + (err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }, [estimateId, navigate]);

  useEffect(() => { load(); }, [load]);

  // QBO item/class catalog for the pickers (/api/qbo-query is call-only).
  const loadCatalog = useCallback(async () => {
    try {
      const auth = await getAuthHeader();
      const run = async (query) => {
        const res = await fetch('/api/qbo-query', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || res.statusText);
        return d.queryResponse || {};
      };
      const [itemsR, classesR] = await Promise.all([
        run('SELECT Id, Name, Type FROM Item WHERE Active = true MAXRESULTS 200'),
        run('SELECT Id, Name FROM Class WHERE Active = true MAXRESULTS 200'),
      ]);
      const { items, classes } = parseQboCatalog(itemsR, classesR);
      setQboItems(items);
      setQboClasses(classes);
      setCatalogMsg('');
    } catch (e) {
      setCatalogMsg(/not connected/i.test(e.message || '')
        ? 'QuickBooks isn’t connected — item & class pickers are unavailable.'
        : 'QuickBooks catalog unavailable — you can still edit descriptions, quantities, and rates.');
    }
  }, []);
  useEffect(() => { if (estimateId) loadCatalog(); }, [estimateId, loadCatalog]);

  // ─── SECTION: Line handlers ──────────────
  const patchLine = (lineId, patch) => {
    // Nulling the stale DB line_total makes the display fall back to qty × rate
    // (lineAmount), so the amount updates live as the user types.
    const touchesMath = 'quantity' in patch || 'unit_price' in patch;
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch, ...(touchesMath ? { line_total: null } : {}) } : l)));
  };

  // Persist a line — writes ONLY the safe columns (never line_total, which is GENERATED).
  const commitLine = async (line, patch) => {
    const next = patch ? { ...line, ...patch } : line;
    if (patch) patchLine(line.id, patch);
    try {
      await db.update('estimate_line_items', `id=eq.${line.id}`, buildLineUpdate(next));
    } catch (e) {
      toast('Failed to save line: ' + (e.message || e), 'error');
    }
  };

  const addLine = async () => {
    setBusy(true);
    try {
      const created = await db.insert('estimate_line_items', buildLineInsert(estimateId, lines.length));
      const row = Array.isArray(created) ? created[0] : created;
      if (row) setLines((prev) => [...prev, row]);
    } catch (e) {
      toast('Failed to add line: ' + (e.message || e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeLine = async (line) => {
    setBusy(true);
    try {
      await db.delete('estimate_line_items', `id=eq.${line.id}`);
      setLines((prev) => prev.filter((l) => l.id !== line.id));
    } catch {
      toast('Failed to remove line', 'error');
    } finally {
      setBusy(false);
    }
  };

  // ─── SECTION: Render ──────────────

  // Create mode — no estimate yet: the contact-only create shell.
  if (!estimateId) {
    return (
      <AdminMobilePage title="New estimate" back={() => navigate(-1)}>
        <EstimateCreateForm
          db={db}
          employee={employee}
          onCreated={(row) => navigate(adminEstimateEditorHref(row.id), { replace: true })}
          onOpenExisting={(id) => navigate(adminEstimateHref(id))}
        />
      </AdminMobilePage>
    );
  }

  if (loading) return <AdminMobilePage title="Estimate builder" back={() => navigate(-1)}><TabLoading /></AdminMobilePage>;
  if (!est) return null;

  const { subtotal, total } = computeTotals(lines);
  const docNumber = est.qbo_doc_number || est.estimate_number || 'New estimate';

  return (
    <AdminMobilePage title="Estimate builder" subtitle={docNumber} back={adminEstimateHref(estimateId)}>
      {/* Who it's for */}
      <div className="am-est-card am-estb-summary">
        <div className="am-est-field-label">Prepared for</div>
        <div className="am-est-prepared-name">{contact?.name || '—'}</div>
        {contact?.email && <div className="am-est-prepared-email">{contact.email}</div>}
      </div>

      {catalogMsg && <div className="am-est-banner am-estb-banner--warn">{catalogMsg}</div>}

      {/* Line items */}
      {lines.length === 0 && <div className="am-est-lines-empty">No line items yet. Add a line to build the estimate.</div>}
      {lines.map((l, idx) => (
        <LineItemCard
          key={l.id}
          line={l}
          index={idx}
          items={qboItems}
          classes={qboClasses}
          busy={busy}
          onPatch={(patch) => patchLine(l.id, patch)}
          onCommit={(patch) => commitLine(l, patch)}
          onRemove={() => removeLine(l)}
        />
      ))}

      <button type="button" className="am-est-btn am-estb-add" onClick={addLine} disabled={busy}>
        + Add line
      </button>

      {/* Running total */}
      <div className="am-est-card">
        <div className="am-est-total-row">
          <span>Subtotal</span>
          <span className="am-est-total-val">{fmt$(subtotal)}</span>
        </div>
        <div className="am-est-total-row am-est-total-row--strong">
          <span>Total</span>
          <span className="am-est-total-val">{fmt$(total)}</span>
        </div>
      </div>

      <button type="button" className="am-est-btn am-est-btn--send" onClick={() => navigate(adminEstimateHref(estimateId))}>
        Done — review &amp; send
      </button>

      <div className="am-est-note">
        Line edits save as you go. Saving to QuickBooks, sending, and converting happen on the estimate screen.
      </div>
    </AdminMobilePage>
  );
}
