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
  REGIONS, FINISH_LEVELS, FEATURES as FEATURE_DEFS, defaultSpec, buildPlanFromSpec,
  computeSchedule, computeDraws, computeFinancing,
  lineItemsTotal, scheduleWeeks, scheduleMonths, round2,
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
const TABS = ['Spec', 'Budget', 'Schedule', 'Draws', 'Financing', 'Summary'];

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
  const [plan, setPlan] = useState(() => buildPlanFromSpec(defaultSpec('wasatch')));
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
    const p = (row.plan && Array.isArray(row.plan.lineItems) && row.plan.lineItems.length)
      ? { lineItems: row.plan.lineItems, schedule: row.plan.schedule || computeSchedule(s), arv: row.plan.arv || 0 }
      : { lineItems: buildPlanFromSpec(s).lineItems, schedule: computeSchedule(s), arv: 0 };
    setActiveId(row.id); setLabel(row.label || 'Untitled build'); setSpec(s); setPlan(p);
    setTuneNotes(null); setArvRange(null); setError(''); setConfirmDel(null);
    savedSnap.current = snap(row.label || 'Untitled build', s, p);
  };

  const newProject = () => {
    const s = defaultSpec(spec.region);
    const fresh = buildPlanFromSpec(s);
    const p = { lineItems: fresh.lineItems, schedule: fresh.schedule, arv: 0 };
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
          region: spec.region, bedrooms: spec.bedrooms, bathrooms: spec.bathrooms, sqft: spec.sqft,
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
          <select value={spec.region} onChange={(e) => setSpecField({ region: e.target.value, lot: e.target.value === 'southern' ? 160000 : 250000 })}
            style={selStyle}>{Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Submarket / city (optional)">
          <input value={spec.submarket} placeholder="e.g. Hurricane, Ivins…" onChange={(e) => setSpecField({ submarket: e.target.value })} style={txtStyle} />
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
const txtStyle = { width: '100%', height: 34, padding: '0 10px', fontFamily: SANS, fontSize: 13, color: C.ink, background: C.card, border: `1px solid ${C.line}`, borderRadius: 6, outline: 'none' };

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
