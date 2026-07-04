/**
 * ════════════════════════════════════════════════
 * FILE: Commissions.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Commissions" settings screen — set each salesperson's commission rate,
 *   either a percent of the job's invoice or a flat dollar amount per sale. Leave
 *   it "None" for anyone who isn't a salesperson. Loads everyone's current rate
 *   and saves changes one person at a time.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/commissions
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db)
 *   Data:      reads  → get_employee_commissions (RPC)
 *              writes → upsert_employee_commission (RPC)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Settings.jsx "Commissions" tab
 *     (Settings Overhaul Phase F). Flat wins over percent (matches get_commissions).
 *   - This screen exposes payroll rates — the /settings route is gated
 *     (AccessRoute('settings')) so only Settings-permitted users reach it.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

const ROLE_LABELS = { admin: 'Admin', project_manager: 'Project Manager', supervisor: 'Supervisor', field_tech: 'Field Tech', office: 'Office' };

function rowFromEmployee(e) {
  // Derive the editable shape: flat wins over percent (matches get_commissions).
  const type = e.commission_flat != null ? 'flat' : e.commission_percent != null ? 'percent' : 'none';
  const value = type === 'flat' ? String(e.commission_flat) : type === 'percent' ? String(e.commission_percent) : '';
  return { type, value };
}

export default function Commissions() {
  const { db } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [draft, setDraft] = useState({});        // { [id]: { type, value } }
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_employee_commissions');
      setEmployees(rows || []);
      setDraft(Object.fromEntries((rows || []).map(e => [e.id, rowFromEmployee(e)])));
    } catch (err) { errToast('Failed to load commissions: ' + (err.message || err)); }
    finally { setLoading(false); }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  const isDirty = (e) => {
    const o = rowFromEmployee(e), d = draft[e.id] || o;
    return d.type !== o.type || (d.type !== 'none' && d.value.trim() !== o.value);
  };
  const setRow = (id, patch) => setDraft(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async (e) => {
    const d = draft[e.id];
    const num = d.type === 'none' ? null : Number(d.value);
    if (d.type !== 'none' && (!Number.isFinite(num) || num < 0)) { errToast('Enter a valid rate (0 or more)'); return; }
    setSavingId(e.id);
    try {
      await db.rpc('upsert_employee_commission', {
        p_employee_id: e.id,
        p_percent: d.type === 'percent' ? num : null,
        p_flat:    d.type === 'flat'    ? num : null,
      });
      okToast(`Saved ${e.full_name}'s commission`);
      await load();
    } catch (err) { errToast('Failed to save: ' + (err.message || err)); }
    finally { setSavingId(null); }
  };

  if (loading) return <div className="settings-panel"><div className="spinner" /></div>;

  const visible = employees.filter(e => showInactive || e.is_active !== false);
  const earners = employees.filter(e => e.commission_percent != null || e.commission_flat != null).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>Commissions</h2>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {earners} {earners === 1 ? 'person earns' : 'people earn'} commission · paid first payroll of the month, for everything sold the previous month
          </p>
        </div>
      </div>

      <div style={{
        background: 'var(--accent-light)', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)',
        padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-primary)', margin: '12px 0 16px',
      }}>
        Set a <b>Percent</b> of the job’s invoice (e.g. 8 = 8%) <b>or</b> a <b>Flat</b> amount per sale (e.g. 250). A flat amount
        wins if both could apply. Leave it <b>None</b> for anyone who isn’t a salesperson. Full details in
        <b> Help → Estimates, Jobs, Sales &amp; Commissions</b>.
      </div>

      {/* Header row */}
      <div className="commissions-header-row" style={{
        padding: '8px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
        border: '1px solid var(--border-color)', borderBottom: 'none',
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        <span>Employee</span><span>Role</span><span>Type</span><span>Rate</span><span />
      </div>

      <div style={{ border: '1px solid var(--border-color)', borderRadius: '0 0 var(--radius-md) var(--radius-md)', overflow: 'hidden' }}>
        {visible.map((e, i) => {
          const d = draft[e.id] || { type: 'none', value: '' };
          const dirty = isDirty(e);
          const inactive = e.is_active === false;
          return (
            <div key={e.id} className="commissions-row" style={{
              padding: '9px 14px', background: 'var(--bg-primary)',
              borderBottom: i < visible.length - 1 ? '1px solid var(--border-light)' : 'none',
              opacity: inactive ? 0.55 : 1,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                {e.full_name}{inactive ? ' (inactive)' : ''}
              </span>
              <div>
                <span className="commissions-mlabel">Role</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{ROLE_LABELS[e.role] || e.role || '—'}</span>
              </div>
              <div>
                <span className="commissions-mlabel">Type</span>
                <select
                  value={d.type}
                  onChange={ev => setRow(e.id, { type: ev.target.value, value: ev.target.value === 'none' ? '' : d.value })}
                  style={{
                    width: '100%', fontSize: 'var(--text-sm)', padding: '6px 8px', borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                  }}
                >
                  <option value="none">None</option>
                  <option value="percent">Percent %</option>
                  <option value="flat">Flat $</option>
                </select>
              </div>
              <div>
                <span className="commissions-mlabel">Rate</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {d.type === 'flat' && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>$</span>}
                  <input
                    type="number" min="0" step="any" inputMode="decimal"
                    disabled={d.type === 'none'}
                    value={d.type === 'none' ? '' : d.value}
                    placeholder={d.type === 'none' ? '—' : d.type === 'flat' ? '250' : '8'}
                    onChange={ev => setRow(e.id, { value: ev.target.value })}
                    style={{
                      width: 90, fontSize: 'var(--text-sm)', padding: '6px 8px', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)', background: d.type === 'none' ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  {d.type === 'percent' && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>%</span>}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={!dirty || savingId === e.id}
                onClick={() => save(e)}
                style={{ opacity: dirty ? 1 : 0.4, cursor: dirty ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
              >
                {savingId === e.id ? 'Saving…' : 'Save'}
              </button>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="lookup-empty">No employees yet. They'll show up here once added under Team.</div>
        )}
      </div>

      <button
        onClick={() => setShowInactive(v => !v)}
        style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', padding: 0 }}
      >
        {showInactive ? 'Hide inactive employees' : 'Show inactive employees'}
      </button>
    </div>
  );
}
