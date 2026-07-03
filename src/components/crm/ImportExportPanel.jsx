/**
 * ════════════════════════════════════════════════
 * FILE: ImportExportPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Contacts tool for bringing customers in from a spreadsheet and sending
 *   them back out. On import it reads a CSV, lets you line up each spreadsheet
 *   column with a contact field, optionally stamps every imported person with a
 *   default owner and lifecycle stage, then hands the rows to the database which
 *   de-duplicates them (a matching phone or email updates the existing person
 *   instead of making a second copy) and records an audit row of what happened.
 *   Export downloads all contacts as a CSV.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads  → contacts (export), crm_import_batches (recent imports),
 *                       employees (owner picker, via get_all_employees) ·
 *              writes → contacts + crm_import_batches (via import_contacts RPC)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6b (.claude/rules/crm-wave-ownership.md). All mutation goes
 *     through the SECURITY DEFINER import_contacts RPC — dedupe + the audit-batch
 *     write happen server-side so a partial/re-run import can never double-insert.
 *   - CSV is parsed in the browser with a small quote-aware parser (no library) —
 *     handles commas inside quotes and doubled "" escapes.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

// Target contact fields a CSV column can map to. `ignore` drops the column.
const TARGET_FIELDS = [
  { key: 'ignore',           label: '— Ignore —' },
  { key: 'name',             label: 'Name' },
  { key: 'email',            label: 'Email' },
  { key: 'phone',            label: 'Phone' },
  { key: 'phone_secondary',  label: 'Secondary phone' },
  { key: 'company',          label: 'Company' },
  { key: 'role',             label: 'Role' },
  { key: 'referral_source',  label: 'Referral source' },
  { key: 'notes',            label: 'Notes' },
  { key: 'billing_address',  label: 'Address' },
  { key: 'billing_city',     label: 'City' },
  { key: 'billing_state',    label: 'State' },
  { key: 'billing_zip',      label: 'ZIP' },
  { key: 'lifecycle_status', label: 'Lifecycle status' },
];

const LIFECYCLE_OPTIONS = ['lead', 'prospect', 'customer', 'past_customer', 'archived'];

// Export column order (also the header row written out).
const EXPORT_COLUMNS = [
  'name', 'email', 'phone', 'phone_secondary', 'company', 'role',
  'referral_source', 'lifecycle_status', 'billing_address', 'billing_city',
  'billing_state', 'billing_zip', 'notes',
];

// ─── SECTION: Helpers ──────────────
// Minimal quote-aware CSV parser → array of string[] rows. Handles "" escapes,
// commas/newlines inside quotes, and trailing CR.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += ch; }
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += ch; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully-empty trailing rows.
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// Guess a target field from a spreadsheet header name.
function guessField(header) {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = {
    name: 'name', fullname: 'name', contact: 'name', customer: 'name',
    email: 'email', emailaddress: 'email',
    phone: 'phone', phonenumber: 'phone', mobile: 'phone', cell: 'phone', primaryphone: 'phone',
    phone2: 'phone_secondary', secondaryphone: 'phone_secondary', altphone: 'phone_secondary',
    company: 'company', business: 'company', organization: 'company',
    role: 'role', title: 'role',
    referralsource: 'referral_source', referral: 'referral_source', source: 'referral_source', leadsource: 'referral_source',
    notes: 'notes', note: 'notes', comments: 'notes',
    address: 'billing_address', street: 'billing_address', billingaddress: 'billing_address',
    city: 'billing_city', state: 'billing_state', province: 'billing_state',
    zip: 'billing_zip', zipcode: 'billing_zip', postalcode: 'billing_zip',
    lifecycle: 'lifecycle_status', lifecyclestatus: 'lifecycle_status', stage: 'lifecycle_status',
  };
  return map[h] || 'ignore';
}

function toCsvValue(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ImportExportPanel() {
  const { db } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [mapping, setMapping] = useState({}); // colIndex → target field
  const [filename, setFilename] = useState('');
  const [defaultOwner, setDefaultOwner] = useState('');
  const [defaultLifecycle, setDefaultLifecycle] = useState('');
  const [employees, setEmployees] = useState([]);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState(null); // batch row
  const [batches, setBatches] = useState([]);
  const fileRef = useRef(null);

  // ─── SECTION: Data fetching ──────────────
  const loadBatches = useCallback(async () => {
    try {
      const rows = await db.select('crm_import_batches', 'select=*&order=created_at.desc&limit=5');
      setBatches(rows || []);
    } catch { /* non-fatal — the panel still imports/exports without history */ }
  }, [db]);

  const loadEmployees = useCallback(async () => {
    try {
      const rows = await db.rpc('get_all_employees');
      setEmployees((rows || []).filter(e => e.is_active !== false));
    } catch { /* owner picker just stays empty */ }
  }, [db]);

  useEffect(() => { loadBatches(); loadEmployees(); }, [loadBatches, loadEmployees]);

  // ─── SECTION: Event handlers ──────────────
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) { toast('That CSV has no data rows', 'error'); return; }
      const hdr = rows[0].map(h => h.trim());
      setHeaders(hdr);
      setDataRows(rows.slice(1));
      setFilename(file.name);
      const guessed = {};
      hdr.forEach((h, i) => { guessed[i] = guessField(h); });
      setMapping(guessed);
    } catch {
      toast('Could not read that file', 'error');
    }
  };

  const reset = () => {
    setHeaders([]); setDataRows([]); setMapping({}); setFilename('');
    setResult(null); setDefaultOwner(''); setDefaultLifecycle('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const mappedCount = Object.values(mapping).filter(v => v && v !== 'ignore').length;

  const buildRows = () => dataRows.map((cells) => {
    const obj = {};
    headers.forEach((_, i) => {
      const target = mapping[i];
      if (!target || target === 'ignore') return;
      const val = (cells[i] ?? '').trim();
      if (val) obj[target] = val;
    });
    if (defaultOwner) obj.owner_id = defaultOwner;
    if (defaultLifecycle && !obj.lifecycle_status) obj.lifecycle_status = defaultLifecycle;
    return obj;
  });

  const doImport = async () => {
    const rows = buildRows();
    if (!rows.length) { toast('Nothing to import', 'error'); return; }
    setImporting(true);
    try {
      const batch = await db.rpc('import_contacts', { p_rows: rows, p_filename: filename || null });
      setResult(batch);
      toast(`Imported: ${batch.created_count} new, ${batch.updated_count} updated`);
      loadBatches();
    } catch {
      toast('Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const rows = await db.select('contacts', `select=${EXPORT_COLUMNS.join(',')}&order=name.asc`);
      const lines = [EXPORT_COLUMNS.map(toCsvValue).join(',')];
      for (const r of rows || []) lines.push(EXPORT_COLUMNS.map(c => toCsvValue(r[c])).join(','));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${(rows || []).length} contacts`);
    } catch {
      toast('Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="crm-card crm-impexp">
      <div className="crm-impexp-head">
        <div>
          <div className="crm-panel-title">Import / Export contacts</div>
          <p className="crm-impexp-sub">
            Import de-duplicates on phone &amp; email — a match updates the existing contact, it never creates a copy.
          </p>
        </div>
        <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={doExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* File chooser */}
      {headers.length === 0 && (
        <label className="crm-impexp-drop">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="crm-impexp-file" />
          <span className="crm-impexp-drop-title">Choose a CSV file</span>
          <span className="crm-impexp-drop-hint">First row is treated as column headers.</span>
        </label>
      )}

      {/* Column mapping */}
      {headers.length > 0 && !result && (
        <>
          <div className="crm-impexp-meta">
            <span><strong>{filename}</strong> · {dataRows.length} rows · {mappedCount} columns mapped</span>
            <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={reset}>Choose a different file</button>
          </div>

          <div className="crm-impexp-map">
            {headers.map((h, i) => (
              <div key={i} className="crm-impexp-map-row">
                <div className="crm-impexp-map-col" title={h}>{h || <em>(unnamed)</em>}</div>
                <span className="crm-impexp-map-arrow">→</span>
                <select
                  className="crm-input crm-impexp-map-select"
                  value={mapping[i] || 'ignore'}
                  onChange={(e) => setMapping(m => ({ ...m, [i]: e.target.value }))}
                >
                  {TARGET_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="crm-impexp-defaults">
            <label className="crm-impexp-default">
              <span className="crm-panel-label">Assign owner to all</span>
              <select className="crm-input" value={defaultOwner} onChange={e => setDefaultOwner(e.target.value)}>
                <option value="">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.display_name || e.email}</option>)}
              </select>
            </label>
            <label className="crm-impexp-default">
              <span className="crm-panel-label">Default lifecycle</span>
              <select className="crm-input" value={defaultLifecycle} onChange={e => setDefaultLifecycle(e.target.value)}>
                <option value="">— None —</option>
                {LIFECYCLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>

          <div className="crm-panel-actions crm-impexp-actions">
            <button className="crm-btn crm-btn-primary" onClick={doImport} disabled={importing || mappedCount === 0}>
              {importing ? 'Importing…' : `Import ${dataRows.length} rows`}
            </button>
            <button className="crm-btn crm-btn-ghost" onClick={reset} disabled={importing}>Cancel</button>
          </div>
        </>
      )}

      {/* Result summary */}
      {result && (
        <div className="crm-impexp-result">
          <div className="crm-impexp-result-title">Import complete</div>
          <div className="crm-impexp-stats">
            <span className="crm-impexp-stat"><strong>{result.created_count}</strong> created</span>
            <span className="crm-impexp-stat"><strong>{result.updated_count}</strong> updated</span>
            <span className="crm-impexp-stat"><strong>{result.skipped_count}</strong> skipped</span>
            <span className="crm-impexp-stat"><strong>{result.error_count}</strong> errors</span>
          </div>
          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <ul className="crm-impexp-errors">
              {result.errors.slice(0, 8).map((e, i) => (
                <li key={i}>Row {e.row}: {e.reason}</li>
              ))}
            </ul>
          )}
          <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={reset}>Import another file</button>
        </div>
      )}

      {/* Recent imports (audit) */}
      {batches.length > 0 && (
        <div className="crm-impexp-history">
          <div className="crm-panel-section-title">Recent imports</div>
          {batches.map(b => (
            <div key={b.id} className="crm-impexp-history-row">
              <span className="crm-impexp-history-name">{b.filename || 'Untitled import'}</span>
              <span className="crm-impexp-history-counts">
                {b.created_count} new · {b.updated_count} updated · {b.skipped_count} skipped
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
