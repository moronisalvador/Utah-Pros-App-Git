import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ── Checklist Definitions ─────────────────────────────────────────────────────

const WATER = [
  { id: 'v1', label: 'Visit 1 — First Response', icon: '🔍', items: [
    { id: 'w01', text: 'Photo water source + water at widest spread BEFORE any work' },
    { id: 'w02', text: 'Category: Cat 1 / 2 / 3 — note in Encircle diary' },
    { id: 'w03', text: 'Realsee Scan of entire affected level' },
    { id: 'w04', text: 'Moisture readings on every affected material' },
    { id: 'w05', text: 'Dry standard reading from unaffected area (same material)' },
    { id: 'w06', text: 'Psychrometric readings: temp, RH, GPP — inside + outside / affected + unaffected' },
    { id: 'w07', text: 'Before photos: wide shot each room, then floors, walls, trim, cabinets, contents' },
    { id: 'w08', text: 'Note + photo pre-existing damage (furniture, walls, baseboards, cabinets)' },
    { id: 'w09', text: 'Signed work authorization — photo and upload' },
    { id: 'w10', text: 'Encircle floor plan scan of entire level or levels' },
  ] },
  { id: 'demo', label: 'Demo', icon: '🔨', items: [
    { id: 'w11', text: 'Photo extraction in progress (wand on floor)' },
    { id: 'w12', text: 'Per room: what was removed + measurements', note: 'Done by demo sheet already' },
    { id: 'w13', text: 'Photo exposed framing after demo (every room)' },
    { id: 'w14', text: 'Photo bagged demo materials (double-bagged if Cat 2/3)' },
    { id: 'w15', text: 'Containment + PPE photos if Cat 2/3 (each tech, poly, NAFAN, signs)' },
  ] },
  { id: 'equip', label: 'Equipment Setup', icon: '💨', items: [
    { id: 'w16', text: 'Count + photo showing all units placed (air movers, dehus, NAFANs)' },
    { id: 'w17', text: 'Photo equipment running (confirm operational)' },
  ] },
  { id: 'daily', label: 'Daily Monitoring — Every Visit', icon: '📊', items: [
    { id: 'w18', text: 'Date, time in, time out, tech name', note: 'App does this automatically' },
    { id: 'w19', text: 'Moisture readings at same locations as Day 1' },
    { id: 'w20', text: 'Psychrometric readings: temp, RH, GPP — inside + outside + at dehu + affected + unaffected' },
    { id: 'w21', text: 'Photo of all equipment per visit' },
    { id: 'w22', text: 'Note equipment added, removed, or moved + why' },
  ] },
  { id: 'final', label: 'Final Visit — Equipment Pickup', icon: '✅', items: [
    { id: 'w23', text: 'Final moisture readings at all materials — compare to actual dry standard' },
    { id: 'w24', text: 'Final psychrometric readings inside + outside + affected + unaffected' },
    { id: 'w25', text: 'Photo of all equipment before removal — count must match placement' },
    { id: 'w26', text: 'Record total equipment days per unit type + total monitoring visits', note: 'Demo sheet does this already' },
    { id: 'w27', text: 'Post-completion photos of all areas' },
    { id: 'w28', text: 'Certificate of completion signed by homeowner' },
    { id: 'w29', text: 'Note what needs reconstruction + any mold found' },
    { id: 'w30', text: 'Final Realsee Scan' },
  ] },
];

const MOLD = [
  { id: 'm_v1', label: 'Assessment & Containment Setup', icon: '🔬', items: [
    { id: 'm01', text: 'Photo all visible mold per surface per room' },
    { id: 'm02', text: 'Measure affected SF per surface (walls, ceiling, floor)' },
    { id: 'm03', text: 'Note substrate: porous (drywall, wood) vs non-porous (concrete, tile)' },
    { id: 'm04', text: 'Identify + photo moisture source — note if corrected' },
    { id: 'm05', text: 'Moisture readings on affected + adjacent surfaces — photo meter on each' },
    { id: 'm06', text: 'Room dimensions (LxW) per room' },
    { id: 'm07', text: 'Photo + note HVAC openings in remediation area' },
    { id: 'm08', text: 'Upload IEP / environmental protocol if available' },
    { id: 'm09', text: 'Signed work auth + antimicrobial auth — photo and upload' },
    { id: 'm10', text: 'Note + photo pre-existing conditions' },
    { id: 'm11', text: 'Photo containment barriers installed (6 mil poly, sealed)' },
    { id: 'm12', text: 'Photo NAFAN with ducting' },
    { id: 'm13', text: 'Negative pressure reading (manometer or smoke test)' },
    { id: 'm14', text: 'Photo decon chamber / flap at entry + hazard signage' },
    { id: 'm15', text: 'Photo HVAC sealed off from work area' },
  ] },
  { id: 'm_work', label: 'Remediation Work', icon: '🛠️', items: [
    { id: 'm16', text: 'Photo each tech in full PPE before entering containment' },
    { id: 'm17', text: 'Per room: what was removed + measurements', note: 'Drywall SF + cut height · Baseboard/casing/shoe LF · Flooring SF by type · Insulation SF + type + location' },
    { id: 'm18', text: 'Photo each process: HEPA vac, antimicrobial, stud cleaning, subfloor, sanding, encapsulant' },
    { id: 'm19', text: 'Photo exposed framing after demo (every room)' },
    { id: 'm20', text: 'Photo double-bagged materials sealed' },
    { id: 'm21', text: 'Equipment count: NAFAN, dehu, air scrubber — with set dates' },
  ] },
  { id: 'm_final', label: 'Clearance & Completion', icon: '✅', items: [
    { id: 'm22', text: 'Photo cleaned surfaces BEFORE removing containment (Condition 1 proof)' },
    { id: 'm23', text: 'Final moisture readings on all remediated surfaces' },
    { id: 'm24', text: 'Photo containment still intact at time of clearance' },
    { id: 'm25', text: 'IEP post-remediation verification (if required by protocol)' },
    { id: 'm26', text: 'Record total equipment days per unit + total labor hours per tech' },
    { id: 'm27', text: 'Certificate of completion signed by homeowner' },
    { id: 'm28', text: 'Note areas needing reconstruction' },
    { id: 'm29', text: 'Export Encircle report' },
  ] },
];

const flat = (phases) => phases.flatMap(p => p.items);
const countDone = (phases, comp) => flat(phases).filter(i => comp[i.id]).length;

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocChecklist({ job, employees: empsProp }) {
  const { db, employee: currentUser } = useAuth();
  const [comp, setComp] = useState({});
  const [clId, setClId] = useState(null);
  const [openPh, setOpenPh] = useState(null);
  const [office, setOffice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const phases = job.division === 'water' ? WATER : MOLD;
  const allItems = useMemo(() => flat(phases), [phases]);
  const tot = allItems.length;
  const dn = useMemo(() => countDone(phases, comp), [phases, comp]);

  // Load or create checklist on mount
  useEffect(() => {
    if (!job?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const existing = await db.select('job_checklists', `job_id=eq.${job.id}&limit=1`);
        if (cancelled) return;
        if (existing?.[0]) {
          setClId(existing[0].id);
          setComp(existing[0].completions || {});
          // Open first incomplete phase
          const firstIncomplete = phases.find(p => p.items.some(i => !existing[0].completions?.[i.id]));
          setOpenPh(firstIncomplete?.id || phases[0].id);
        } else {
          // Create new checklist
          const name = job.division === 'water' ? 'Water Loss Documentation' : 'Mold Loss Documentation';
          const created = await db.insert('job_checklists', {
            job_id: job.id,
            name,
            division: job.division,
            completions: {},
            items_snapshot: phases,
          });
          if (cancelled) return;
          if (created?.[0]) setClId(created[0].id);
          setComp({});
          setOpenPh(phases[0].id);
        }
      } catch (err) {
        console.error('DocChecklist load:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [job?.id]);

  const toggle = useCallback(async (itemId) => {
    if (!currentUser) return;
    const next = { ...comp };
    if (next[itemId]) delete next[itemId];
    else next[itemId] = { at: new Date().toISOString(), by: currentUser.id };
    setComp(next);

    if (clId) {
      setSaving(true);
      try {
        const d = Object.keys(next).length;
        const patch = { completions: next, updated_at: new Date().toISOString() };
        if (d >= tot) {
          patch.completed_at = new Date().toISOString();
          patch.completed_by = currentUser.id;
        } else {
          patch.completed_at = null;
          patch.completed_by = null;
        }
        await db.update('job_checklists', `id=eq.${clId}`, patch);
      } catch (err) {
        console.error('DocChecklist save:', err);
        window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to save checklist', type: 'error' } }));
      } finally {
        setSaving(false);
      }
    }
  }, [comp, currentUser, clId, tot, db]);

  const empMap = useMemo(() => {
    const m = {};
    if (empsProp) for (const e of empsProp) m[e.id] = e;
    return m;
  }, [empsProp]);

  const pct = tot ? Math.round(dn / tot * 100) : 0;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="doc-checklist">
      {/* Warning banner */}
      <div className="doc-cl-warning">
        <span style={{ fontSize: 14 }}>⚠️</span>
        <span>No photo = no line item = no payment.</span>
      </div>

      {/* View toggle */}
      <div className="doc-cl-view-toggle">
        <button
          className={`doc-cl-view-btn ${!office ? 'active tech' : ''}`}
          onClick={() => setOffice(false)}
        >
          🔨 Tech
        </button>
        <button
          className={`doc-cl-view-btn ${office ? 'active office' : ''}`}
          onClick={() => setOffice(true)}
        >
          📋 Office
        </button>
      </div>

      {/* Progress */}
      <div className="doc-cl-progress">
        <div className="doc-cl-progress-labels">
          <span className="doc-cl-progress-count">{dn}/{tot} items</span>
          <span className={`doc-cl-progress-pct ${dn === tot && tot > 0 ? 'complete' : ''}`}>{pct}%</span>
        </div>
        <div className="doc-cl-progress-bar">
          <div
            className={`doc-cl-progress-fill ${dn === tot && tot > 0 ? 'complete' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {saving && <div className="doc-cl-saving">💾 Saving...</div>}

      {/* Phases */}
      {phases.map(phase => {
        const phaseDone = phase.items.filter(i => comp[i.id]).length;
        const phaseTotal = phase.items.length;
        const allDone = phaseDone === phaseTotal;
        const isOpen = office || openPh === phase.id;

        return (
          <div
            key={phase.id}
            className={`doc-cl-phase ${allDone ? 'done' : ''} ${isOpen && !office ? 'open' : ''}`}
          >
            {/* Phase header */}
            <button
              className="doc-cl-phase-header"
              onClick={() => !office && setOpenPh(openPh === phase.id ? null : phase.id)}
              style={office ? { cursor: 'default' } : undefined}
            >
              <span className="doc-cl-phase-icon">{phase.icon}</span>
              <span className="doc-cl-phase-label">{phase.label}</span>
              {office ? (
                <span className={`doc-cl-phase-status ${allDone ? 'complete' : 'missing'}`}>
                  {allDone ? '✓ Complete' : `${phaseTotal - phaseDone} missing`}
                </span>
              ) : (
                <span className={`doc-cl-phase-badge ${allDone ? 'complete' : ''}`}>
                  {allDone ? '✓ Done' : `${phaseDone}/${phaseTotal}`}
                </span>
              )}
              {!office && (
                <svg className={`doc-cl-chevron ${isOpen ? 'open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </button>

            {/* Phase items */}
            {isOpen && (
              <div className="doc-cl-phase-items">
                {phase.items.map(item => {
                  const checked = !!comp[item.id];
                  const meta = comp[item.id];
                  const emp = meta && empMap[meta.by];

                  return (
                    <button
                      key={item.id}
                      className={`doc-cl-item ${checked ? 'checked' : ''}`}
                      onClick={() => toggle(item.id)}
                    >
                      <div className={`doc-cl-checkbox ${checked ? 'checked' : ''}`}>
                        {checked && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="doc-cl-item-content">
                        <span className={`doc-cl-item-text ${checked ? 'checked' : ''}`}>{item.text}</span>
                        {item.note && <span className="doc-cl-item-note">→ {item.note}</span>}
                        {office && meta && (
                          <span className="doc-cl-item-meta">
                            {emp ? (emp.display_name || emp.full_name) : '—'} · {new Date(meta.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
