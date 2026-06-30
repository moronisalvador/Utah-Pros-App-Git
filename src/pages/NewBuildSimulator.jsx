/**
 * ════════════════════════════════════════════════
 * FILE: NewBuildSimulator.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A powerful planner for a specific home build. You describe the home (size, region,
 *   finish, beds/baths, lot, features); it builds a full itemized budget by trade, a
 *   week-by-week schedule, a construction-loan draw schedule, and the financing/returns
 *   math — all editable. You can let the AI tune the numbers to your market, estimate the
 *   sale value, save the plan, and export it to PDF. Moroni-only.
 *
 * WHERE IT LIVES:
 *   Route:        /homebuilding/build  (Moroni-only — App.jsx MoroniRoute)
 *   Rendered by:  src/App.jsx (inside the office Layout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (getAuthHeader), @/lib/buildTemplate
 *   Data:      reads  → homebuilding_build_projects (via RPC)
 *              writes → homebuilding_build_projects (via RPC)
 *
 * NOTES / GOTCHAS:
 *   - Persistence + AI tuning + ARV + PDF are gated to moroni@utah-pros.com server-side too.
 *   - Derived numbers (hard total, draws, months, financing) are computed from the stored
 *     lineItems/schedule/arv on every render — only those three are persisted in `plan`.
 *   - AI workers are non-streaming behind Cloudflare's ~100s timeout; calls carry a 95s abort.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import {
  REGIONS, SUBMARKETS, FINISH_LEVELS, FEATURES as FEATURE_DEFS, defaultSpec, buildPlanFromSpec,
  computeSchedule, computeDraws, computeFinancing, computeArvBaseline,
  lineItemsTotal, scheduleWeeks, scheduleMonths, round2,
  ROOM_TYPES, roomDef, floorplanTotals, floorplanLevels, LEVEL_DEFS,
} from '@/lib/buildTemplate';

const C = {
  paper: '#E8EAED', card: '#FFFFFF', ink: '#15202C', muted: '#5B6775', faint: '#8A95A1',
  steel: '#1E3A5C', amber: '#C2741C', up: '#2C7A5B', down: '#B14A30', line: '#D6DADF', lineSoft: '#E6E9ED',
};
const SANS = "'Inter', system-ui, sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', monospace";

const round0 = (n) => Math.round(Number(n) || 0);
const fmt$ = (n) => (Number.isFinite(Number(n)) ? '$' + round0(n).toLocaleString('en-US') : '—');
const fmtPct = (n) => (Number.isFinite(Number(n)) ? (n * 100).toFixed(1) + '%' : '—');
const FEATURE_NAMES = FEATURE_DEFS.map(([n]) => n);
let customSeq = 0; // monotonic id so rapidly-added custom lines never collide on key
const TABS = ['Spec', 'Floor Plan', 'Budget', 'Schedule', 'Draws', 'Financing', 'Summary'];

// ─── SECTION: small inputs ───
function NumIn({ value, onChange, step = 1, min, max, width = 90, prefix }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {prefix && <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>{prefix}</span>}
      <input type="number" value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onBlur={() => { if (min === undefined && max === undefined) return; const n = Number(value) || 0; const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)); if (c !== n) onChange(c); }}
        style={{ width, height: 30, padding: '0 8px', fontFamily: MONO, fontSize: 13, color: C.ink,
          background: C.card, border: `1px solid ${C.line}`, borderRadius: 6, outline: 'none' }} />
    </span>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.5, color: C.muted, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function KV({ k, v, strong, big, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontSize: strong ? 13 : 12.5, color: strong ? C.ink : C.muted }}>{k}</span>
      <span style={{ fontFamily: MONO, fontSize: big ? 18 : 13, fontWeight: strong || big ? 600 : 500, color: color || C.ink }}>{v}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function NewBuildSimulator() {
  const navigate = useNavigate();
  const { db } = useAuth();

  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [label, setLabel] = useState('Untitled build');
  const [spec, setSpec] = useState(() => defaultSpec('wasatch'));
  const [plan, setPlan] = useState(() => ({ ...buildPlanFromSpec(defaultSpec('wasatch')), floorplan: { rooms: [] } }));
  const [tab, setTab] = useState('Spec');
  const [busy, setBusy] = useState('');            // '', 'save', 'tune', 'arv', 'pdf'
  const [error, setError] = useState('');
  const [tuneNotes, setTuneNotes] = useState(null);
  const [arvRange, setArvRange] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const savedSnap = useRef('');

  const snap = useCallback((l, s, p) => JSON.stringify({ l, s, p }), []);
  const dirty = snap(label, spec, plan) !== savedSnap.current;

  const setSpecField = (patch) => setSpec((s) => ({ ...s, ...patch }));

  const loadProjects = useCallback(async () => {
    try { return (await db.rpc('list_homebuilding_build_projects')) || []; } catch { return []; }
  }, [db]);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await loadProjects();
      if (!alive) return;
      setProjects(rows);
      if (rows.length) openProject(rows[0]);
      else savedSnap.current = ''; // fresh unsaved
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProjects]);

  const openProject = (row) => {
    const s = { ...defaultSpec(row.region), ...(row.spec || {}) };
    const rawFp = row.plan && row.plan.floorplan;
    const fp = (rawFp && (Array.isArray(rawFp.levels) || Array.isArray(rawFp.rooms))) ? rawFp : { rooms: [] };
    const p = (row.plan && Array.isArray(row.plan.lineItems) && row.plan.lineItems.length)
      ? { lineItems: row.plan.lineItems, schedule: row.plan.schedule || computeSchedule(s), arv: row.plan.arv || 0, floorplan: fp }
      : { lineItems: buildPlanFromSpec(s).lineItems, schedule: computeSchedule(s), arv: 0, floorplan: fp };
    setActiveId(row.id); setLabel(row.label || 'Untitled build'); setSpec(s); setPlan(p);
    setTuneNotes(null); setArvRange(null); setError(''); setConfirmDel(null);
    savedSnap.current = snap(row.label || 'Untitled build', s, p);
  };

  const newProject = () => {
    const s = defaultSpec(spec.region);
    const fresh = buildPlanFromSpec(s);
    const p = { lineItems: fresh.lineItems, schedule: fresh.schedule, arv: 0, floorplan: { rooms: [] } };
    setActiveId(null); setLabel('Untitled build'); setSpec(s); setPlan(p);
    setTab('Spec'); setTuneNotes(null); setArvRange(null); setError(''); setConfirmDel(null);
    savedSnap.current = ''; // unsaved
  };

  // ── derived numbers (computed every render from stored lineItems/schedule/arv) ──
  const hardTotal = useMemo(() => lineItemsTotal(plan.lineItems), [plan.lineItems]);
  const costPerSf = useMemo(() => round0(hardTotal / (Number(spec.sqft) || 1)), [hardTotal, spec.sqft]);
  const months = useMemo(() => Math.max(6, Math.round(scheduleMonths(plan.schedule))), [plan.schedule]);
  const weeks = useMemo(() => scheduleWeeks(plan.schedule), [plan.schedule]);
  const draws = useMemo(() => computeDraws(plan.lineItems, hardTotal), [plan.lineItems, hardTotal]);
  const fin = useMemo(() => computeFinancing({
    land: spec.lot, hard: hardTotal, softPct: spec.softPct, contingencyPct: spec.contingencyPct,
    arv: plan.arv, ltc: spec.ltc, rate: spec.rate, months, sellPct: spec.sellPct,
  }), [spec, hardTotal, plan.arv, months]);

  // ── actions ──
  const generateFromTemplate = () => {
    const fresh = buildPlanFromSpec(spec);
    setPlan((p) => ({ ...p, lineItems: fresh.lineItems, schedule: fresh.schedule }));
    setTuneNotes(null);
  };

  const setFloorplan = (updater) => setPlan((p) => ({ ...p, floorplan: typeof updater === 'function' ? updater(p.floorplan || { rooms: [] }) : updater }));

  // "Sync to spec" — push the floor plan's totals into the spec AND recompute costs.
  const syncToSpec = () => {
    const t = floorplanTotals(plan.floorplan);
    if (!t.sqft) return;
    const nextSpec = { ...spec, sqft: t.sqft, bedrooms: t.bedrooms, bathrooms: t.bathrooms };
    setSpec(nextSpec);
    const fresh = buildPlanFromSpec(nextSpec);
    setPlan((p) => ({ ...p, lineItems: fresh.lineItems, schedule: fresh.schedule }));
    setTuneNotes(null);
    setTab('Budget');
  };

  const setLine = (i, patch) => setPlan((p) => {
    const lineItems = p.lineItems.map((l, idx) => {
      if (idx !== i) return l;
      const m = { ...l, ...patch };
      m.total = m.per === 'sf' ? round0((Number(m.qty) || 0) * (Number(m.unit_price) || 0)) : round0(Number(m.unit_price) || 0);
      return m;
    });
    return { ...p, lineItems };
  });
  const addLine = () => setPlan((p) => ({
    ...p,
    lineItems: [...p.lineItems, { key: `custom:${Date.now()}-${customSeq++}`, phaseKey: 'final', phase: 'Custom', label: 'New line item', per: 'ls', qty: 1, unit: 'lump', unit_price: 0, total: 0, custom: true }],
  }));
  const removeLine = (i) => setPlan((p) => ({ ...p, lineItems: p.lineItems.filter((_, idx) => idx !== i) }));

  const setPhase = (i, patch) => setPlan((p) => ({
    ...p, schedule: p.schedule.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
  }));

  const callJSON = async (url, payload) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 95000);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    } finally { clearTimeout(timer); }
  };

  const aiTune = async () => {
    setBusy('tune'); setError('');
    try {
      const data = await callJSON('/api/homebuilding-plan-tune', {
        spec,
        lineItems: plan.lineItems.map((l) => ({ key: l.key, label: l.label, total: l.total })),
        schedule: plan.schedule.map((s) => ({ key: s.key, name: s.name, weeks: s.weeks })),
      });
      const t = data.tuning || {};
      const adj = Object.fromEntries((t.line_adjustments || []).map((a) => [a.key, Number(a.total)]));
      const sadj = Object.fromEntries((t.schedule_adjustments || []).map((a) => [a.key, Number(a.weeks)]));
      setPlan((p) => ({
        ...p,
        lineItems: p.lineItems.map((l) => {
          if (!(l.key in adj) || !Number.isFinite(adj[l.key])) return l;
          const total = round0(adj[l.key]);
          return { ...l, total, unit_price: l.per === 'sf' ? round2(total / (Number(l.qty) || 1)) : total };
        }),
        schedule: p.schedule.map((s) => (s.key in sadj && Number.isFinite(sadj[s.key]) ? { ...s, weeks: round2(sadj[s.key]) } : s)),
      }));
      if (Number.isFinite(Number(t.soft_pct))) setSpecField({ softPct: round2(t.soft_pct) });
      if (Number.isFinite(Number(t.contingency_pct))) setSpecField({ contingencyPct: round2(t.contingency_pct) });
      setTuneNotes({ rationale: t.rationale || [], confidence: t.confidence });
    } catch (e) {
      setError(e.name === 'AbortError' ? 'AI tune took too long — try again.' : (e.message || 'AI tune failed.'));
    } finally { setBusy(''); }
  };

  const estimateARV = async () => {
    setBusy('arv'); setError('');
    try {
      const data = await callJSON('/api/homebuilding-estimate', {
        inputs: {
          region: spec.region, submarket: spec.submarket, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, sqft: spec.sqft,
          stories: spec.stories, finish: spec.finish, landAcres: 0.25, features: spec.features,
        },
      });
      const arv = data.estimate?.arv;
      if (arv) { setPlan((p) => ({ ...p, arv: round0(arv.expected) })); setArvRange(arv); }
    } catch (e) {
      setError(e.name === 'AbortError' ? 'ARV estimate took too long — try again.' : (e.message || 'ARV estimate failed.'));
    } finally { setBusy(''); }
  };

  const save = async () => {
    setBusy('save'); setError('');
    try {
      const row = await db.rpc('save_homebuilding_build_project', {
        p_id: activeId, p_label: label, p_region: spec.region, p_spec: spec, p_plan: plan,
      });
      if (row?.id) setActiveId(row.id);
      savedSnap.current = snap(label, spec, plan);
      setProjects(await loadProjects());
    } catch (e) { setError(e.message || 'Save failed.'); }
    finally { setBusy(''); }
  };

  const exportPDF = async () => {
    setBusy('pdf'); setError('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 95000);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/homebuilding-build-plan-pdf', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ label, region: spec.region, spec, plan: { lineItems: plan.lineItems, schedule: plan.schedule, draws, hardTotal, costPerSf, months, arv: plan.arv }, financing: fin }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.statusText); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(label || 'build-plan').replace(/[^\w.-]+/g, '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.name === 'AbortError' ? 'PDF took too long — try again.' : (e.message || 'PDF export failed.'));
    } finally { clearTimeout(timer); setBusy(''); }
  };

  // project sidebar ops
  const renameProject = async () => {
    const t = renameDraft.trim(); const id = renameId; setRenameId(null);
    if (!id || !t) return;
    try { await db.rpc('rename_homebuilding_build_project', { p_id: id, p_label: t }); } catch { /* non-fatal */ }
    if (id === activeId) { setLabel(t); savedSnap.current = snap(t, spec, plan); }
    setProjects(await loadProjects());
  };
  const duplicateProject = async (id) => {
    try { const row = await db.rpc('duplicate_homebuilding_build_project', { p_id: id }); setProjects(await loadProjects()); if (row) openProject(row); }
    catch { /* non-fatal */ }
  };
  const deleteProject = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    setConfirmDel(null);
    try { await db.rpc('delete_homebuilding_build_project', { p_id: id }); } catch { /* non-fatal */ }
    const rows = await loadProjects(); setProjects(rows);
    if (id === activeId) { if (rows.length) openProject(rows[0]); else newProject(); }
  };

  const btn = (kind, extra) => ({
    height: 36, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontFamily: SANS, fontWeight: 700, fontSize: 13,
    background: kind === 'primary' ? C.amber : kind === 'steel' ? C.steel : C.card,
    color: kind === 'card' ? C.muted : '#fff',
    ...(kind === 'card' ? { border: `1px solid ${C.line}` } : {}), ...extra,
  });

  return (
    <div style={{ background: C.paper, minHeight: '100%', fontFamily: SANS, color: C.ink }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px 48px' }}>

        {/* ── header bar ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => navigate('/homebuilding')} style={btn('card', { fontWeight: 600 })}>← Analysis</button>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            style={{ flex: 1, minWidth: 180, height: 40, padding: '0 12px', fontFamily: SANS, fontWeight: 800, fontSize: 18, color: C.ink, background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, outline: 'none' }} />
          <button onClick={save} disabled={busy === 'save'} style={btn('steel', busy === 'save' ? { opacity: 0.6 } : {})}>
            {busy === 'save' ? 'Saving…' : dirty ? 'Save *' : 'Saved'}
          </button>
          <button onClick={exportPDF} disabled={!!busy} style={btn('primary', busy ? { opacity: 0.6 } : {})}>
            {busy === 'pdf' ? 'Building PDF…' : 'Export PDF'}
          </button>
        </div>

        {/* ── summary strip ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1, background: C.line, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          {[
            ['Total project cost', fmt$(fin.total), C.ink],
            ['Hard cost', `${fmt$(hardTotal)} · ${fmt$(costPerSf)}/sf`, C.ink],
            ['Build time', `${weeks} wks · ~${months} mo`, C.ink],
            ['Sale value (ARV)', plan.arv ? fmt$(plan.arv) : '— estimate', C.steel],
            ['Projected profit', fmt$(fin.profit), fin.profit >= 0 ? C.up : C.down],
            ['Margin', fmtPct(fin.margin), fin.margin >= 0 ? C.up : C.down],
          ].map(([k, v, col]) => (
            <div key={k} style={{ background: C.card, padding: '10px 14px' }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase' }}>{k}</div>
              <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: col, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 16 }} className="nbs-grid">
          {/* main editor */}
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
            {/* tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}`, overflowX: 'auto' }}>
              {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ flex: '0 0 auto', padding: '12px 18px', border: 'none', cursor: 'pointer', background: 'transparent',
                    fontFamily: SANS, fontWeight: 700, fontSize: 13, color: tab === t ? C.ink : C.faint,
                    borderBottom: `2px solid ${tab === t ? C.amber : 'transparent'}` }}>
                  {t}
                </button>
              ))}
            </div>

            <div style={{ padding: 20 }}>
              {error && <div style={{ marginBottom: 12, fontFamily: MONO, fontSize: 13, color: C.down }}>{error}</div>}

              {tab === 'Spec' && (
                <SpecTab spec={spec} setSpecField={setSpecField} onGenerate={generateFromTemplate} />
              )}

              {tab === 'Floor Plan' && (
                <FloorPlanTab floorplan={plan.floorplan} setFloorplan={setFloorplan} onSync={syncToSpec} />
              )}

              {tab === 'Budget' && (
                <BudgetTab plan={plan} setLine={setLine} addLine={addLine} removeLine={removeLine}
                  hardTotal={hardTotal} costPerSf={costPerSf} spec={spec} setSpecField={setSpecField}
                  onGenerate={generateFromTemplate} onTune={aiTune} busy={busy} tuneNotes={tuneNotes} fin={fin} />
              )}

              {tab === 'Schedule' && (
                <ScheduleTab plan={plan} setPhase={setPhase} weeks={weeks} months={months} />
              )}

              {tab === 'Draws' && (
                <DrawsTab draws={draws} hardTotal={hardTotal} />
              )}

              {tab === 'Financing' && (
                <FinancingTab spec={spec} setSpecField={setSpecField} fin={fin} plan={plan}
                  onArv={(v) => setPlan((p) => ({ ...p, arv: round0(v) }))}
                  onEstimateARV={estimateARV} busy={busy} arvRange={arvRange} hardTotal={hardTotal} months={months} />
              )}

              {tab === 'Summary' && (
                <SummaryTab label={label} spec={spec} plan={plan} fin={fin} hardTotal={hardTotal}
                  costPerSf={costPerSf} weeks={weeks} months={months} draws={draws} onExport={exportPDF} busy={busy} />
              )}
            </div>
          </div>

          {/* projects sidebar */}
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, alignSelf: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: C.faint, textTransform: 'uppercase' }}>Build projects</span>
              <button onClick={newProject} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.paper, color: C.steel, fontFamily: MONO, fontSize: 12, cursor: 'pointer' }}>+ New</button>
            </div>
            {projects.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>No saved builds yet. Fill the spec, then Save.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.map((pr) => (
                <div key={pr.id} style={{ borderRadius: 10, padding: 10, background: pr.id === activeId ? '#eef4f8' : C.paper, border: `1px solid ${pr.id === activeId ? C.steel : C.line}` }}>
                  {renameId === pr.id ? (
                    <input value={renameDraft} autoFocus onChange={(e) => setRenameDraft(e.target.value)} onBlur={renameProject}
                      onKeyDown={(e) => { if (e.key === 'Enter') renameProject(); if (e.key === 'Escape') setRenameId(null); }}
                      style={{ width: '100%', height: 28, padding: '0 8px', fontFamily: SANS, fontSize: 13, border: `1px solid ${C.amber}`, borderRadius: 6, outline: 'none' }} />
                  ) : (
                    <button onClick={() => openProject(pr)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{pr.label}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted, marginTop: 2 }}>{REGIONS[pr.region] || pr.region}</div>
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button onClick={() => { setRenameDraft(pr.label); setRenameId(pr.id); }} style={miniBtn()}>Rename</button>
                    <button onClick={() => duplicateProject(pr.id)} style={miniBtn()}>Duplicate</button>
                    <button onClick={() => deleteProject(pr.id)} onBlur={() => setConfirmDel(null)}
                      style={miniBtn(confirmDel === pr.id ? { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' } : {})}>
                      {confirmDel === pr.id ? 'Confirm' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p style={{ marginTop: 16, fontFamily: MONO, fontSize: 11, color: C.faint }}>
          Planning estimates from a standard Utah build template + your edits — validate against local subs and recent comps before committing.
        </p>
      </div>

      <style>{`
        @media (min-width: 1040px) {
          .nbs-grid { grid-template-columns: 1fr 300px !important; }
          .nbs-grid > div:last-child { order: 2; }
        }
        .fp-grid { grid-template-columns: 1fr; }
        @media (min-width: 980px) { .fp-grid { grid-template-columns: auto 1fr; } }
      `}</style>
    </div>
  );
}

const miniBtn = (extra) => ({
  flex: 1, height: 28, borderRadius: 6, border: `1px solid ${C.line}`, background: C.card, color: C.muted,
  fontFamily: MONO, fontSize: 11, cursor: 'pointer', ...extra,
});

// ─── SECTION: Spec tab ───
function SpecTab({ spec, setSpecField, onGenerate }) {
  const toggleFeature = (f) => setSpecField({ features: spec.features.includes(f) ? spec.features.filter((x) => x !== f) : [...spec.features, f] });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        <Field label="Market">
          <select value={spec.region} onChange={(e) => { const r = e.target.value; const d = defaultSpec(r); setSpecField({ region: r, submarket: d.submarket, lot: d.lot }); }}
            style={selStyle}>{Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Submarket / city">
          <select value={spec.submarket}
            onChange={(e) => { const c = (SUBMARKETS[spec.region] || []).find((x) => x.name === e.target.value); setSpecField({ submarket: e.target.value, ...(c ? { lot: c.lot } : {}) }); }}
            style={selStyle}>
            <option value="">— Region average —</option>
            {(SUBMARKETS[spec.region] || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Square footage"><NumIn value={spec.sqft} step={50} min={400} max={20000} width={110} onChange={(v) => setSpecField({ sqft: v })} /></Field>
        <Field label="Stories">
          <select value={spec.stories} onChange={(e) => setSpecField({ stories: Number(e.target.value) })} style={selStyle}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select>
        </Field>
        <Field label="Bedrooms"><NumIn value={spec.bedrooms} min={1} max={10} onChange={(v) => setSpecField({ bedrooms: v })} /></Field>
        <Field label="Bathrooms"><NumIn value={spec.bathrooms} step={0.5} min={1} max={10} onChange={(v) => setSpecField({ bathrooms: v })} /></Field>
        <Field label="Finish level">
          <select value={spec.finish} onChange={(e) => setSpecField({ finish: e.target.value })} style={selStyle}>
            {FINISH_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <Field label="Lot / land cost"><NumIn value={spec.lot} step={5000} min={0} width={120} prefix="$" onChange={(v) => setSpecField({ lot: v })} /></Field>
        <Field label="Finished basement (sf)"><NumIn value={spec.basementSf} step={50} min={0} max={8000} onChange={(v) => setSpecField({ basementSf: v })} /></Field>
      </div>

      <div>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.5, color: C.muted, marginBottom: 8 }}>Features & upgrades</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FEATURE_NAMES.map((f) => {
            const on = spec.features.includes(f);
            return (
              <button key={f} onClick={() => toggleFeature(f)}
                style={{ fontFamily: MONO, fontSize: 12, padding: '7px 12px', borderRadius: 9999, cursor: 'pointer',
                  background: on ? C.steel : C.paper, color: on ? '#fff' : C.muted, border: `1px solid ${on ? C.steel : C.line}` }}>
                {f}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
        <button onClick={onGenerate} style={{ height: 38, padding: '0 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: C.amber, color: '#fff', fontFamily: SANS, fontWeight: 700, fontSize: 13 }}>
          Generate budget &amp; schedule from template
        </button>
        <span style={{ fontSize: 12.5, color: C.muted }}>Builds an itemized budget + schedule from these inputs. Then refine on the Budget tab.</span>
      </div>
    </div>
  );
}
const selStyle = { width: '100%', height: 34, padding: '0 8px', fontFamily: SANS, fontSize: 13, color: C.ink, background: C.card, border: `1px solid ${C.line}`, borderRadius: 6 };

// ─── SECTION: Budget tab ───
function BudgetTab({ plan, setLine, addLine, removeLine, hardTotal, costPerSf, spec, onGenerate, onTune, busy, tuneNotes, fin }) {
  const [confirmDel, setConfirmDel] = useState(null);
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <button onClick={onTune} disabled={!!busy} style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: busy ? C.lineSoft : C.steel, color: busy ? C.faint : '#fff', fontFamily: SANS, fontWeight: 700, fontSize: 13 }}>
          {busy === 'tune' ? 'AI tuning…' : 'AI Tune to market'}
        </button>
        <button onClick={onGenerate} style={{ height: 36, padding: '0 16px', borderRadius: 8, border: `1px solid ${C.line}`, cursor: 'pointer', background: C.card, color: C.muted, fontFamily: SANS, fontWeight: 600, fontSize: 13 }}>
          Reset to template
        </button>
        <button onClick={addLine} style={{ height: 36, padding: '0 16px', borderRadius: 8, border: `1px solid ${C.line}`, cursor: 'pointer', background: C.card, color: C.steel, fontFamily: SANS, fontWeight: 600, fontSize: 13 }}>
          + Add line
        </button>
      </div>

      {tuneNotes && (
        <div style={{ marginBottom: 14, borderRadius: 10, padding: 12, background: '#eef4f8', border: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.steel, marginBottom: 6 }}>AI tuned — confidence: {tuneNotes.confidence}</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: C.muted, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {tuneNotes.rationale.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {/* header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 110px 70px', gap: 8, padding: '0 4px 8px', fontFamily: MONO, fontSize: 10, letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase', borderBottom: `1px solid ${C.line}` }}>
        <span>Line item</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Unit $</span><span style={{ textAlign: 'right' }}>Total</span><span />
      </div>
      <div>
        {plan.lineItems.map((l, i) => (
          <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 110px 70px', gap: 8, alignItems: 'center', padding: '8px 4px', borderBottom: `1px solid ${C.lineSoft}` }}>
            <div style={{ minWidth: 0 }}>
              <input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })}
                style={{ width: '100%', height: 30, padding: '0 6px', fontFamily: SANS, fontSize: 13, color: C.ink, background: 'transparent', border: '1px solid transparent', borderRadius: 6, outline: 'none' }}
                onFocus={(e) => { e.target.style.border = `1px solid ${C.line}`; e.target.style.background = C.card; }}
                onBlur={(e) => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }} />
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, paddingLeft: 6 }}>{l.phase}{l.feature ? ' · upgrade' : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {l.per === 'sf'
                ? <NumIn value={l.qty} step={10} min={0} width={80} onChange={(v) => setLine(i, { qty: v })} />
                : <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>lump</span>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <NumIn value={l.unit_price} step={l.per === 'sf' ? 1 : 500} min={0} width={100} onChange={(v) => setLine(i, { unit_price: v })} />
            </div>
            <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{fmt$(l.total)}</div>
            <div style={{ textAlign: 'right' }}>
              <button onClick={() => { if (confirmDel !== i) { setConfirmDel(i); return; } setConfirmDel(null); removeLine(i); }}
                onBlur={() => setConfirmDel(null)}
                style={{ height: 28, padding: '0 8px', borderRadius: 6, fontFamily: MONO, fontSize: 11, cursor: 'pointer',
                  background: confirmDel === i ? '#fef2f2' : C.card, color: confirmDel === i ? '#dc2626' : C.faint, border: `1px solid ${confirmDel === i ? '#fecaca' : C.line}` }}>
                {confirmDel === i ? 'Sure?' : '✕'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, borderTop: `2px solid ${C.steel}`, paddingTop: 12 }}>
        <KV k="Hard cost total" v={`${fmt$(hardTotal)}  ·  ${fmt$(costPerSf)}/sf`} strong big color={C.amber} />
        <KV k={`Soft costs (${spec.softPct}% — permits, plans, financing)`} v={fmt$(fin.soft)} />
        <KV k={`Contingency (${spec.contingencyPct}%)`} v={fmt$(fin.contingency)} />
        <KV k="Land / lot" v={fmt$(spec.lot)} />
        <KV k="Total project cost" v={fmt$(fin.total)} strong color={C.ink} />
      </div>
    </div>
  );
}

// ─── SECTION: Schedule tab (editable Gantt) ───
function ScheduleTab({ plan, setPhase, weeks, months }) {
  const max = Math.max(weeks, 1);
  return (
    <div>
      <div style={{ marginBottom: 14, fontSize: 13, color: C.muted }}>
        Total build time: <b style={{ fontFamily: MONO, color: C.ink }}>{weeks} weeks</b> (~{months} months). Edit start week + duration per phase; overlaps are allowed.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 70px 70px 1fr', gap: 8, padding: '0 0 8px', fontFamily: MONO, fontSize: 10, letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase', borderBottom: `1px solid ${C.line}` }}>
        <span>Phase</span><span>Start wk</span><span>Weeks</span><span>Timeline</span>
      </div>
      {plan.schedule.map((s, i) => (
        <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '180px 70px 70px 1fr', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
          <span style={{ fontSize: 12.5, color: C.ink }}>{s.name}</span>
          <NumIn value={s.startWeek} step={0.5} min={0} width={60} onChange={(v) => setPhase(i, { startWeek: v })} />
          <NumIn value={s.weeks} step={0.5} min={0} width={60} onChange={(v) => setPhase(i, { weeks: v })} />
          <div style={{ position: 'relative', height: 18, background: C.paper, borderRadius: 4 }}>
            <div title={`wk ${s.startWeek}–${round2(Number(s.startWeek) + Number(s.weeks))}`}
              style={{ position: 'absolute', top: 2, height: 14, borderRadius: 4,
                left: `${(Number(s.startWeek) / max) * 100}%`, width: `${Math.max(1, (Number(s.weeks) / max) * 100)}%`, background: s.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SECTION: Draws tab ───
function DrawsTab({ draws, hardTotal }) {
  return (
    <div>
      <div style={{ marginBottom: 14, fontSize: 13, color: C.muted }}>
        Construction-loan draws fund the hard cost as milestones complete. Cumulative reaches {fmt$(hardTotal)} (100%) at certificate of occupancy.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 170px', gap: 8, padding: '0 0 8px', fontFamily: MONO, fontSize: 10, letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase', borderBottom: `1px solid ${C.line}` }}>
        <span>Milestone</span><span style={{ textAlign: 'right' }}>Draw</span><span style={{ textAlign: 'right' }}>Cumulative</span>
      </div>
      {draws.map((d) => (
        <div key={d.draw} style={{ padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 170px', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: C.ink }}><b style={{ fontFamily: MONO, color: C.steel }}>{d.draw}.</b> {d.label}</span>
            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{fmt$(d.amount)} <span style={{ color: C.faint, fontWeight: 400 }}>({d.pct}%)</span></span>
            <span style={{ textAlign: 'right', fontFamily: MONO, fontSize: 13 }}>{fmt$(d.cumulative)} <span style={{ color: C.faint }}>({d.cumulativePct}%)</span></span>
          </div>
          <div style={{ height: 6, marginTop: 6, borderRadius: 9999, background: C.lineSoft }}>
            <div style={{ height: 6, borderRadius: 9999, width: `${Math.min(100, d.cumulativePct)}%`, background: C.steel }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SECTION: Financing tab ───
function FinancingTab({ spec, setSpecField, fin, plan, onArv, onEstimateARV, busy, arvRange, hardTotal, months }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        <Field label="Loan-to-cost %"><NumIn value={spec.ltc} step={1} min={50} max={95} onChange={(v) => setSpecField({ ltc: v })} /></Field>
        <Field label="Interest rate %"><NumIn value={spec.rate} step={0.25} min={5} max={18} onChange={(v) => setSpecField({ rate: v })} /></Field>
        <Field label="Soft costs % of hard"><NumIn value={spec.softPct} step={1} min={0} max={30} onChange={(v) => setSpecField({ softPct: v })} /></Field>
        <Field label="Contingency % of hard"><NumIn value={spec.contingencyPct} step={1} min={0} max={20} onChange={(v) => setSpecField({ contingencyPct: v })} /></Field>
        <Field label="Selling cost %"><NumIn value={spec.sellPct} step={0.5} min={0} max={10} onChange={(v) => setSpecField({ sellPct: v })} /></Field>
        <Field label="Months to sell"><span style={{ fontFamily: MONO, fontSize: 13, color: C.muted }}>~{months} (from schedule)</span></Field>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <Field label="Expected sale value (ARV)"><NumIn value={plan.arv} step={5000} min={0} width={140} prefix="$" onChange={(v) => onArv(v)} /></Field>
        <button onClick={() => onArv(computeArvBaseline(spec))} style={{ height: 36, padding: '0 14px', borderRadius: 8, border: `1px solid ${C.line}`, cursor: 'pointer', background: C.card, color: C.steel, fontFamily: SANS, fontWeight: 600, fontSize: 13, alignSelf: 'end' }}>
          City comp ARV
        </button>
        <button onClick={onEstimateARV} disabled={!!busy} style={{ height: 36, padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: busy ? C.lineSoft : C.steel, color: busy ? C.faint : '#fff', fontFamily: SANS, fontWeight: 700, fontSize: 13, alignSelf: 'end' }}>
          {busy === 'arv' ? 'Estimating…' : 'AI estimate ARV'}
        </button>
        {arvRange && <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted, alignSelf: 'end' }}>range {fmt$(arvRange.low)}–{fmt$(arvRange.high)}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        <div>
          <KV k="Land / lot" v={fmt$(spec.lot)} />
          <KV k="Hard cost" v={fmt$(hardTotal)} />
          <KV k="Soft costs" v={fmt$(fin.soft)} />
          <KV k="Contingency" v={fmt$(fin.contingency)} />
          <KV k="Total project cost" v={fmt$(fin.total)} strong />
          <KV k="Loan" v={fmt$(fin.loan)} />
          <KV k="Down payment (equity in)" v={fmt$(fin.down)} />
          <KV k="Cash needed (down + reserves)" v={fmt$(fin.cashNeeded)} />
        </div>
        <div>
          <KV k="Sale value (ARV)" v={fmt$(plan.arv)} />
          <KV k="Interest carry" v={fmt$(fin.carry)} />
          <KV k="Selling cost" v={fmt$(fin.sellCost)} />
          <KV k="Projected profit" v={fmt$(fin.profit)} strong big color={fin.profit >= 0 ? C.up : C.down} />
          <KV k="Margin on sale" v={fmtPct(fin.margin)} color={fin.margin >= 0 ? C.up : C.down} />
          <KV k="Cash-on-cash return" v={fmtPct(fin.coc)} strong color={fin.coc >= 0 ? C.up : C.down} />
        </div>
      </div>
    </div>
  );
}

// ─── SECTION: Summary tab ───
function SummaryTab({ label, spec, plan, fin, hardTotal, costPerSf, weeks, months, draws, onExport, busy }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 20 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>The build</div>
          <KV k="Market" v={`${REGIONS[spec.region]}${spec.submarket ? ' · ' + spec.submarket : ''}`} />
          <KV k="Size" v={`${Number(spec.sqft).toLocaleString('en-US')} sf · ${spec.stories}-story`} />
          <KV k="Bed / bath" v={`${spec.bedrooms} bd / ${spec.bathrooms} ba`} />
          <KV k="Finish" v={String(spec.finish)} />
          <KV k="Hard cost" v={`${fmt$(hardTotal)} · ${fmt$(costPerSf)}/sf`} strong />
          <KV k="Build time" v={`${weeks} wks · ~${months} mo`} />
        </div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>The money</div>
          <KV k="Total project cost" v={fmt$(fin.total)} strong />
          <KV k="Cash needed" v={fmt$(fin.cashNeeded)} />
          <KV k="Sale value (ARV)" v={fmt$(plan.arv)} />
          <KV k="Projected profit" v={fmt$(fin.profit)} strong big color={fin.profit >= 0 ? C.up : C.down} />
          <KV k="Margin" v={fmtPct(fin.margin)} color={fin.margin >= 0 ? C.up : C.down} />
          <KV k="Cash-on-cash" v={fmtPct(fin.coc)} color={fin.coc >= 0 ? C.up : C.down} />
        </div>
      </div>
      <div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, textTransform: 'uppercase', marginBottom: 6 }}>Draw schedule</div>
        {draws.map((d) => <KV key={d.draw} k={`${d.draw}. ${d.label}`} v={`${fmt$(d.amount)} (cum ${d.cumulativePct}%)`} />)}
      </div>
      <button onClick={onExport} disabled={!!busy} style={{ alignSelf: 'start', height: 40, padding: '0 22px', borderRadius: 8, border: 'none', cursor: 'pointer', background: busy ? C.lineSoft : C.amber, color: busy ? C.faint : '#fff', fontFamily: SANS, fontWeight: 700, fontSize: 14 }}>
        {busy === 'pdf' ? 'Building PDF…' : 'Export Build Plan PDF'}
      </button>
    </div>
  );
}


// ─── SECTION: Floor Plan v2 (multi-level CAD-style editor) ───
let fpSeq = 0;
const fpId = (p) => `${p}-${Date.now().toString(36)}-${++fpSeq}`;

// Fixtures are purely visual symbols (no cost effect) — default sizes in feet.
const FIXTURE_TYPES = [
  { key: 'door',    name: 'Door',      w: 3,   h: 0.5 },
  { key: 'window',  name: 'Window',    w: 4,   h: 0.5 },
  { key: 'toilet',  name: 'Toilet',    w: 1.6, h: 2.4 },
  { key: 'sink',    name: 'Sink',      w: 2,   h: 1.8 },
  { key: 'vanity',  name: 'Vanity',    w: 4,   h: 2 },
  { key: 'cabinet', name: 'Cabinetry', w: 6,   h: 2 },
  { key: 'island',  name: 'Island',    w: 6,   h: 3 },
  { key: 'tub',     name: 'Bathtub',   w: 5,   h: 2.6 },
  { key: 'shower',  name: 'Shower',    w: 3,   h: 3 },
  { key: 'range',   name: 'Range',     w: 2.5, h: 2.2 },
  { key: 'fridge',  name: 'Fridge',    w: 3,   h: 2.6 },
];
const FIX_MAP = Object.fromEntries(FIXTURE_TYPES.map((f) => [f.key, f]));

const CANVAS_W_FT = 72;    // drawable area width  (ft)
const CANVAS_H_FT = 60;    // drawable area height (ft)
const GRID_FT = 0.5;       // snap granularity (ft)
const SNAP_THR = 0.75;     // wall-magnet threshold (ft)
const MIN_ROOM = 4;        // minimum room dimension (ft)

const snapG = (v) => Math.round(v / GRID_FT) * GRID_FT;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pretty feet → feet-inches, e.g. 12.5 → 12'6"
function ftIn(ft) {
  const totalIn = Math.round((Number(ft) || 0) * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return i ? `${f}'${i}"` : `${f}'`;
}

// Snap one moving edge to the grid, then to the nearest neighbor wall within threshold.
function snapEdge(v, edges) {
  const s = snapG(v);
  let best = null, bestD = SNAP_THR + 1;
  for (const e of edges) { const d = Math.abs(e - s); if (d <= SNAP_THR && d < bestD) { best = e; bestD = d; } }
  return best !== null ? best : s;
}
// Snap a whole moving room along one axis: either its near or far edge can grab a neighbor wall.
function snapMoveAxis(pos, size, edges) {
  const s = snapG(pos);
  let best = null, bestD = SNAP_THR + 1;
  for (const e of edges) {
    const dNear = Math.abs(e - s);
    if (dNear <= SNAP_THR && dNear < bestD) { best = e; bestD = dNear; }
    const dFar = Math.abs(e - (s + size));
    if (dFar <= SNAP_THR && dFar < bestD) { best = e - size; bestD = dFar; }
  }
  return best !== null ? best : s;
}

// Guarantee all three levels exist, in Basement → Level 1 → Level 2 order, preserving content.
function ensureLevels(levels) {
  return LEVEL_DEFS.map((def) => {
    const found = (levels || []).find((l) => l.key === def.key);
    return { key: def.key, name: def.name, rooms: (found && found.rooms) || [], fixtures: (found && found.fixtures) || [] };
  });
}

const HANDLES = [
  { h: 'nw', cur: 'nwse-resize', fx: 0,   fy: 0 },
  { h: 'n',  cur: 'ns-resize',   fx: 0.5, fy: 0 },
  { h: 'ne', cur: 'nesw-resize', fx: 1,   fy: 0 },
  { h: 'e',  cur: 'ew-resize',   fx: 1,   fy: 0.5 },
  { h: 'se', cur: 'nwse-resize', fx: 1,   fy: 1 },
  { h: 's',  cur: 'ns-resize',   fx: 0.5, fy: 1 },
  { h: 'sw', cur: 'nesw-resize', fx: 0,   fy: 1 },
  { h: 'w',  cur: 'ew-resize',   fx: 0,   fy: 0.5 },
];

// Simple architectural line-art for each fixture symbol. preserveAspectRatio="none" → fills the box.
function FixtureArt({ type, color }) {
  const p = { stroke: color, strokeWidth: 3.5, fill: 'none', vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round', strokeLinecap: 'round' };
  let body = null;
  switch (type) {
    case 'door':    body = (<g {...p}><path d="M6,94 L6,6" /><path d="M6,6 A88,88 0 0 1 94,94" /><line x1="6" y1="94" x2="94" y2="94" /></g>); break;
    case 'window':  body = (<g {...p}><line x1="3" y1="18" x2="3" y2="82" /><line x1="97" y1="18" x2="97" y2="82" /><line x1="3" y1="38" x2="97" y2="38" /><line x1="3" y1="62" x2="97" y2="62" /></g>); break;
    case 'toilet':  body = (<g {...p}><rect x="26" y="4" width="48" height="20" /><ellipse cx="50" cy="60" rx="32" ry="34" /></g>); break;
    case 'sink':    body = (<g {...p}><rect x="6" y="8" width="88" height="84" rx="6" /><circle cx="50" cy="56" r="26" /><circle cx="50" cy="22" r="5" /></g>); break;
    case 'vanity':  body = (<g {...p}><rect x="3" y="6" width="94" height="88" /><ellipse cx="50" cy="54" rx="28" ry="20" /><circle cx="50" cy="22" r="4" /></g>); break;
    case 'cabinet': body = (<g {...p}><rect x="3" y="6" width="94" height="88" /><path d="M3,6 L50,52 M97,6 L50,52" /></g>); break;
    case 'island':  body = (<g {...p}><rect x="5" y="12" width="90" height="76" rx="5" /></g>); break;
    case 'tub':     body = (<g {...p}><rect x="3" y="6" width="94" height="88" rx="14" /><ellipse cx="50" cy="52" rx="34" ry="32" /><circle cx="50" cy="22" r="3" /></g>); break;
    case 'shower':  body = (<g {...p}><rect x="4" y="4" width="92" height="92" /><path d="M4,4 L96,96 M96,4 L4,96" /><circle cx="50" cy="50" r="5" /></g>); break;
    case 'range':   body = (<g {...p}><rect x="4" y="4" width="92" height="92" rx="4" /><circle cx="31" cy="31" r="12" /><circle cx="69" cy="31" r="12" /><circle cx="31" cy="69" r="12" /><circle cx="69" cy="69" r="12" /></g>); break;
    case 'fridge':  body = (<g {...p}><rect x="6" y="4" width="88" height="92" rx="4" /><line x1="6" y1="58" x2="94" y2="58" /><line x1="18" y1="16" x2="18" y2="48" /><line x1="18" y1="68" x2="18" y2="88" /></g>); break;
    default:        body = (<g {...p}><rect x="4" y="4" width="92" height="92" /></g>);
  }
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>{body}</svg>;
}

function FloorPlanTab({ floorplan, setFloorplan, onSync }) {
  const [activeKey, setActiveKey] = useState(() => (
    floorplan && LEVEL_DEFS.some((d) => d.key === floorplan.active) ? floorplan.active : 'level1'
  ));
  const [sel, setSel] = useState(null);          // { kind:'room'|'fixture', id }
  const [pxft, setPxft] = useState(9);            // zoom (px per ft)
  const [confirmDel, setConfirmDel] = useState(false);
  const canvasRef = useRef(null);
  const dragNewRef = useRef(false);               // guards palette drag vs click double-add
  const pxftRef = useRef(pxft);
  useEffect(() => { pxftRef.current = pxft; }, [pxft]);

  const levels = useMemo(() => ensureLevels(floorplanLevels(floorplan)), [floorplan]);
  const active = levels.find((l) => l.key === activeKey) || levels[1];
  const rooms = active.rooms;
  const fixtures = active.fixtures;
  const totals = useMemo(() => floorplanTotals(floorplan), [floorplan]);

  // Write back the full multi-level structure on every edit (active level switched on edit too).
  const writeLevel = useCallback((key, fn) => setFloorplan((f) => {
    const lv = ensureLevels(floorplanLevels(f));
    return { levels: lv.map((l) => (l.key === key ? fn(l) : l)), active: key };
  }), [setFloorplan]);
  const setRooms = useCallback((upd) => writeLevel(activeKey, (l) => ({ ...l, rooms: typeof upd === 'function' ? upd(l.rooms) : upd })), [writeLevel, activeKey]);
  const setFixtures = useCallback((upd) => writeLevel(activeKey, (l) => ({ ...l, fixtures: typeof upd === 'function' ? upd(l.fixtures) : upd })), [writeLevel, activeKey]);

  const selRoom = sel && sel.kind === 'room' ? rooms.find((r) => r.id === sel.id) : null;
  const selFix = sel && sel.kind === 'fixture' ? fixtures.find((f) => f.id === sel.id) : null;

  // ── add / mutate ──
  const addRoom = (key, cx, cy) => {
    const d = roomDef(key); if (!d) return;
    const w = d.w, h = d.h;
    const x = clampN(snapG((cx == null ? 8 : cx) - w / 2), 0, CANVAS_W_FT - w);
    const y = clampN(snapG((cy == null ? 8 : cy) - h / 2), 0, CANVAS_H_FT - h);
    const id = fpId('r');
    setRooms((rs) => [...rs, { id, type: key, name: d.name, x, y, w, h }]);
    setSel({ kind: 'room', id }); setConfirmDel(false);
  };
  const addFixture = (key, cx, cy) => {
    const d = FIX_MAP[key]; if (!d) return;
    const w = d.w, h = d.h;
    const x = clampN(snapG((cx == null ? 6 : cx) - w / 2), 0, CANVAS_W_FT - w);
    const y = clampN(snapG((cy == null ? 6 : cy) - h / 2), 0, CANVAS_H_FT - h);
    const id = fpId('f');
    setFixtures((fs) => [...fs, { id, type: key, x, y, w, h, rot: 0 }]);
    setSel({ kind: 'fixture', id }); setConfirmDel(false);
  };
  const updRoom = (id, patch) => setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updFix = (id, patch) => setFixtures((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const delSel = () => {
    if (!sel) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    if (sel.kind === 'room') setRooms((rs) => rs.filter((r) => r.id !== sel.id));
    else setFixtures((fs) => fs.filter((f) => f.id !== sel.id));
    setSel(null); setConfirmDel(false);
  };

  // ── pointer drag: move / resize a room ──
  const onRoomDown = (e, room, handle) => {
    e.preventDefault(); e.stopPropagation();
    setSel({ kind: 'room', id: room.id }); setConfirmDel(false);
    const sx = e.clientX, sy = e.clientY;
    const orig = { x: room.x, y: room.y, w: room.w, h: room.h };
    const ppf = pxftRef.current;
    const others = rooms.filter((r) => r.id !== room.id);
    const vEdges = others.flatMap((r) => [r.x, r.x + r.w]);
    const hEdges = others.flatMap((r) => [r.y, r.y + r.h]);
    const move = (ev) => {
      const dx = (ev.clientX - sx) / ppf, dy = (ev.clientY - sy) / ppf;
      let next;
      if (handle === 'body') {
        const nx = clampN(snapMoveAxis(orig.x + dx, orig.w, vEdges), 0, CANVAS_W_FT - orig.w);
        const ny = clampN(snapMoveAxis(orig.y + dy, orig.h, hEdges), 0, CANVAS_H_FT - orig.h);
        next = { x: nx, y: ny, w: orig.w, h: orig.h };
      } else {
        let L = orig.x, R = orig.x + orig.w, T = orig.y, B = orig.y + orig.h;
        if (handle.includes('w')) L = clampN(snapEdge(orig.x + dx, vEdges), 0, R - MIN_ROOM);
        if (handle.includes('e')) R = clampN(snapEdge(orig.x + orig.w + dx, vEdges), L + MIN_ROOM, CANVAS_W_FT);
        if (handle.includes('n')) T = clampN(snapEdge(orig.y + dy, hEdges), 0, B - MIN_ROOM);
        if (handle.includes('s')) B = clampN(snapEdge(orig.y + orig.h + dy, hEdges), T + MIN_ROOM, CANVAS_H_FT);
        next = { x: L, y: T, w: R - L, h: B - T };
      }
      setRooms((rs) => rs.map((r) => (r.id === room.id ? { ...r, ...next } : r)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };

  // ── pointer drag: move a fixture (grid snap only, free placement) ──
  const onFixDown = (e, fix) => {
    e.preventDefault(); e.stopPropagation();
    setSel({ kind: 'fixture', id: fix.id }); setConfirmDel(false);
    const sx = e.clientX, sy = e.clientY, orig = { x: fix.x, y: fix.y };
    const ppf = pxftRef.current;
    const move = (ev) => {
      const dx = (ev.clientX - sx) / ppf, dy = (ev.clientY - sy) / ppf;
      const nx = clampN(snapG(orig.x + dx), 0, CANVAS_W_FT - fix.w);
      const ny = clampN(snapG(orig.y + dy), 0, CANVAS_H_FT - fix.h);
      setFixtures((fs) => fs.map((f) => (f.id === fix.id ? { ...f, x: nx, y: ny } : f)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };

  // ── palette drag-and-drop onto the canvas ──
  const onCanvasDrop = (e) => {
    e.preventDefault(); dragNewRef.current = false;
    const data = e.dataTransfer.getData('text/plain'); if (!data) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / pxft, fy = (e.clientY - rect.top) / pxft;
    const [kind, key] = data.split(':');
    if (kind === 'room') addRoom(key, fx, fy);
    else if (kind === 'fix') addFixture(key, fx, fy);
  };
  const onPaletteDragStart = (e, payload) => { dragNewRef.current = true; e.dataTransfer.setData('text/plain', payload); e.dataTransfer.effectAllowed = 'copy'; };
  const onPaletteClick = (kind, key) => { if (dragNewRef.current) return; if (kind === 'room') addRoom(key); else addFixture(key); };

  const gridBg = {
    backgroundColor: '#fff',
    backgroundImage: `linear-gradient(${C.lineSoft} 1px, transparent 1px), linear-gradient(90deg, ${C.lineSoft} 1px, transparent 1px), linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
    backgroundSize: `${pxft}px ${pxft}px, ${pxft}px ${pxft}px, ${pxft * 5}px ${pxft * 5}px, ${pxft * 5}px ${pxft * 5}px`,
  };

  const tileStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.line}`, background: C.card, cursor: 'grab', fontFamily: SANS, fontSize: 12.5, color: C.ink, userSelect: 'none' };

  return (
    <div className="fp-grid" style={{ display: 'grid', gap: 16 }}>
      {/* ── left rail: palettes + selection ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 220 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, textTransform: 'uppercase', marginBottom: 7 }}>Rooms — drag or click</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {ROOM_TYPES.map((r) => (
              <div key={r.key} draggable onDragStart={(e) => onPaletteDragStart(e, `room:${r.key}`)} onDragEnd={() => { dragNewRef.current = false; }} onClick={() => onPaletteClick('room', r.key)} style={tileStyle} title={`${r.name} · ${r.w}×${r.h} ft`}>
                <span style={{ width: 10, height: 10, borderRadius: 2, border: `1.5px solid ${C.muted}`, background: r.conditioned === false ? C.lineSoft : '#fff', flex: '0 0 auto' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, textTransform: 'uppercase', marginBottom: 7 }}>Fixtures</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {FIXTURE_TYPES.map((f) => (
              <div key={f.key} draggable onDragStart={(e) => onPaletteDragStart(e, `fix:${f.key}`)} onDragEnd={() => { dragNewRef.current = false; }} onClick={() => onPaletteClick('fix', f.key)} style={tileStyle} title={f.name}>
                <span style={{ width: 18, height: 14, flex: '0 0 auto' }}><FixtureArt type={f.key} color={C.muted} /></span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* selection panel */}
        {(selRoom || selFix) && (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, background: C.paper }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, textTransform: 'uppercase', marginBottom: 8 }}>{selRoom ? 'Room' : 'Fixture'}</div>
            {selRoom && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Field label="Type">
                  <select value={selRoom.type} onChange={(e) => { const d = roomDef(e.target.value); updRoom(selRoom.id, { type: e.target.value, name: d ? d.name : selRoom.name }); }} style={selStyle}>
                    {ROOM_TYPES.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                  </select>
                </Field>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Field label="Width (ft)"><NumIn value={selRoom.w} min={MIN_ROOM} max={CANVAS_W_FT} step={0.5} width={76} onChange={(v) => updRoom(selRoom.id, { w: clampN(snapG(v), MIN_ROOM, CANVAS_W_FT - selRoom.x) })} /></Field>
                  <Field label="Height (ft)"><NumIn value={selRoom.h} min={MIN_ROOM} max={CANVAS_H_FT} step={0.5} width={76} onChange={(v) => updRoom(selRoom.id, { h: clampN(snapG(v), MIN_ROOM, CANVAS_H_FT - selRoom.y) })} /></Field>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.muted }}>{ftIn(selRoom.w)} × {ftIn(selRoom.h)} · {round0(selRoom.w * selRoom.h)} sf</div>
              </div>
            )}
            {selFix && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: SANS, fontSize: 13, color: C.ink }}>{FIX_MAP[selFix.type] ? FIX_MAP[selFix.type].name : selFix.type}</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Field label="Width (ft)"><NumIn value={selFix.w} min={0.5} max={CANVAS_W_FT} step={0.5} width={76} onChange={(v) => updFix(selFix.id, { w: clampN(snapG(v), 0.5, CANVAS_W_FT - selFix.x) })} /></Field>
                  <Field label="Depth (ft)"><NumIn value={selFix.h} min={0.5} max={CANVAS_H_FT} step={0.5} width={76} onChange={(v) => updFix(selFix.id, { h: clampN(snapG(v), 0.5, CANVAS_H_FT - selFix.y) })} /></Field>
                </div>
                <button onClick={() => updFix(selFix.id, { rot: ((selFix.rot || 0) + 90) % 360 })} style={{ height: 32, borderRadius: 7, border: `1px solid ${C.line}`, background: C.card, cursor: 'pointer', fontFamily: SANS, fontSize: 12.5, color: C.ink }}>↻ Rotate ({selFix.rot || 0}°)</button>
              </div>
            )}
            <button onClick={delSel} onBlur={() => setConfirmDel(false)} style={{ marginTop: 10, width: '100%', height: 32, borderRadius: 7, cursor: 'pointer', fontFamily: SANS, fontSize: 12.5, fontWeight: 600, background: confirmDel ? '#fef2f2' : C.card, color: confirmDel ? '#dc2626' : C.muted, border: `1px solid ${confirmDel ? '#fecaca' : C.line}` }}>
              {confirmDel ? 'Confirm delete' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {/* ── right: toolbar + canvas ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {/* level switcher + zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: 8, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
            {levels.map((lv) => (
              <button key={lv.key} onClick={() => { setActiveKey(lv.key); setSel(null); }} style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', fontFamily: SANS, fontSize: 13, fontWeight: activeKey === lv.key ? 700 : 500, background: activeKey === lv.key ? C.steel : C.card, color: activeKey === lv.key ? '#fff' : C.muted }}>
                {lv.name}<span style={{ marginLeft: 6, fontFamily: MONO, fontSize: 11, opacity: 0.8 }}>{lv.rooms.length}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <button onClick={() => setPxft((z) => clampN(z - 1, 6, 16))} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${C.line}`, background: C.card, cursor: 'pointer', fontSize: 16, color: C.ink }}>−</button>
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted, width: 48, textAlign: 'center' }}>{pxft}px/ft</span>
            <button onClick={() => setPxft((z) => clampN(z + 1, 6, 16))} style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${C.line}`, background: C.card, cursor: 'pointer', fontSize: 16, color: C.ink }}>+</button>
          </div>
        </div>

        {/* canvas */}
        <div style={{ overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 8, maxHeight: 560, background: C.paper }}>
          <div ref={canvasRef} onPointerDown={() => { setSel(null); setConfirmDel(false); }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onCanvasDrop}
            style={{ position: 'relative', width: CANVAS_W_FT * pxft, height: CANVAS_H_FT * pxft, ...gridBg, touchAction: 'none' }}>
            {/* fixtures under rooms' handles but above room bodies are drawn after rooms */}
            {rooms.map((r) => {
              const isSel = selRoom && selRoom.id === r.id;
              const cond = roomDef(r.type) && roomDef(r.type).conditioned === false;
              const wpx = r.w * pxft, hpx = r.h * pxft;
              return (
                <div key={r.id} onPointerDown={(e) => onRoomDown(e, r, 'body')}
                  style={{ position: 'absolute', left: r.x * pxft, top: r.y * pxft, width: wpx, height: hpx, boxSizing: 'border-box',
                    background: cond ? 'rgba(214,218,223,0.35)' : 'rgba(255,255,255,0.65)',
                    border: `${isSel ? 2 : 1.5}px ${cond ? 'dashed' : 'solid'} ${isSel ? C.amber : C.steel}`,
                    cursor: 'move', touchAction: 'none', zIndex: isSel ? 5 : 2 }}>
                  {/* wall dimension labels: width on top, height on left */}
                  {wpx > 34 && <span style={{ position: 'absolute', top: 1, left: 0, right: 0, textAlign: 'center', fontFamily: MONO, fontSize: 9.5, color: isSel ? C.amber : C.muted, pointerEvents: 'none' }}>{ftIn(r.w)}</span>}
                  {hpx > 34 && <span style={{ position: 'absolute', left: 1, top: '50%', transform: 'translateY(-50%)', fontFamily: MONO, fontSize: 9.5, color: isSel ? C.amber : C.muted, pointerEvents: 'none' }}>{ftIn(r.h)}</span>}
                  {/* name */}
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS, fontSize: Math.min(12, Math.max(8, wpx / 8)), color: C.ink, textAlign: 'center', padding: 4, pointerEvents: 'none', lineHeight: 1.15 }}>{r.name}</span>
                  {/* resize handles */}
                  {isSel && HANDLES.map((H) => (
                    <span key={H.h} onPointerDown={(e) => onRoomDown(e, r, H.h)}
                      style={{ position: 'absolute', left: H.fx * wpx, top: H.fy * hpx, width: 11, height: 11, marginLeft: -6, marginTop: -6, background: '#fff', border: `2px solid ${C.amber}`, borderRadius: 2, cursor: H.cur, touchAction: 'none', zIndex: 6 }} />
                  ))}
                </div>
              );
            })}
            {fixtures.map((f) => {
              const isSel = selFix && selFix.id === f.id;
              return (
                <div key={f.id} onPointerDown={(e) => onFixDown(e, f)}
                  style={{ position: 'absolute', left: f.x * pxft, top: f.y * pxft, width: f.w * pxft, height: f.h * pxft,
                    transform: `rotate(${f.rot || 0}deg)`, transformOrigin: 'center', cursor: 'move', touchAction: 'none',
                    outline: isSel ? `2px solid ${C.amber}` : 'none', outlineOffset: 1, zIndex: isSel ? 7 : 4 }}>
                  <FixtureArt type={f.type} color={isSel ? C.amber : '#3A4654'} />
                </div>
              );
            })}
          </div>
        </div>

        {/* totals + sync */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', padding: '10px 14px', border: `1px solid ${C.line}`, borderRadius: 8, background: C.paper }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>Conditioned <strong style={{ color: C.ink, fontSize: 14 }}>{totals.sqft.toLocaleString('en-US')}</strong> sf</span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>Beds <strong style={{ color: C.ink, fontSize: 14 }}>{totals.bedrooms}</strong></span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>Baths <strong style={{ color: C.ink, fontSize: 14 }}>{totals.bathrooms}</strong></span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>Rooms <strong style={{ color: C.ink, fontSize: 14 }}>{totals.rooms}</strong></span>
          <button onClick={onSync} disabled={!totals.sqft} style={{ marginLeft: 'auto', height: 38, padding: '0 20px', borderRadius: 8, border: 'none', cursor: totals.sqft ? 'pointer' : 'not-allowed', background: totals.sqft ? C.amber : C.lineSoft, color: totals.sqft ? '#fff' : C.faint, fontFamily: SANS, fontWeight: 700, fontSize: 13.5 }}>Sync to spec →</button>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: C.faint, lineHeight: 1.5 }}>
          Drag rooms from the palette onto the grid, then drag the body to move or any edge/corner handle to resize. Rooms snap to the grid and to each other&rsquo;s walls. All conditioned area across Basement, Level 1 and Level 2 counts toward finished sqft. <strong style={{ color: C.muted }}>Sync to spec</strong> pushes sqft + bed/bath into the budget.
        </div>
      </div>
    </div>
  );
}
