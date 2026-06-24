// Shared schema-driven renderer for the Demo Sheet — used by both the
// field-tech page (TechDemoSheet.jsx) and the desktop builder's live
// preview (AdminDemoSheetBuilder.jsx). Everything here is presentation +
// schema interpretation; data fetching, save, submit, and email building
// stay on the page that owns the sheet.

import { useState, useRef } from 'react';

// ── Palette pinned to UPR design tokens (single-light theme) ────────────────
export const C = {
  bg:        '#f8f9fb',
  card:      '#ffffff',
  cardAlt:   '#f1f3f5',
  border:    '#e2e5e9',
  borderLt:  '#f0f1f3',
  text:      '#111318',
  muted:     '#5f6672',
  mutedLt:   '#8b929e',
  accent:    '#2563eb',
  accentDim: '#eff6ff',
  green:     '#16a34a',
  greenDim:  '#f0fdf4',
  greenBd:   '#bbf7d0',
  red:       '#dc2626',
  redDim:    '#fef2f2',
  redBd:     '#fecaca',
  input:     '#ffffff',
  headerBg:  '#ffffff',
};

export const sLabel = { fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:700, marginBottom:5, display:'block' };
export const sInput = { background:C.input, border:`1.5px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:16, padding:'12px 13px', width:'100%', outline:'none', WebkitAppearance:'none', boxSizing:'border-box', fontFamily:'var(--font-sans)' };
export const sCard  = { background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'16px 14px', marginBottom:12 };

// ── Schema-driven helpers ────────────────────────────────────────────────────
export const today = () => new Date().toISOString().split('T')[0];
export const newRowId = () => Date.now() + Math.random();

export function walkFields(fields, fn, parent = null) {
  for (const f of fields || []) {
    if (f.type === 'row') {
      walkFields(f.fields, fn, parent);
    } else {
      fn(f, parent);
    }
  }
}

export function flattenLeafFields(fields) {
  const out = [];
  walkFields(fields, (f) => out.push(f));
  return out;
}

export function defaultFieldValue(field) {
  switch (field.type) {
    case 'stepper':    return 0;
    case 'single-chip':return '';
    case 'multi-chip': return [];
    case 'text':       return '';
    case 'textarea':   return '';
    case 'checkbox':   return false;
    case 'select':     return '';
    case 'list':       return field.defaultItem ? [{ id: newRowId(), ...field.defaultItem }] : [];
    case 'computed':   return 0; // derived (see computeFieldValue); seeded so shapes stay stable
    default:           return null;
  }
}

export function makeDefaultRoom(schema) {
  const room = {
    id: newRowId(),
    name: '',
    lengthFt: '',
    widthFt: '',
    heightFt: '',
  };
  const sections = schema?.sections || [];
  for (const section of sections) {
    if (section.gateField) room[section.gateField] = null;
    if (section.doneFlag)  room[section.doneFlag]  = false;
    for (const f of flattenLeafFields(section.fields || [])) {
      if (f.key && room[f.key] === undefined) {
        room[f.key] = defaultFieldValue(f);
      }
    }
  }
  room.openSection = sections[0]?.key || null;
  return room;
}

// Build the default job-level data object from a schema's `jobSections`.
// Mirrors makeDefaultRoom but for the (newer) job-level sections concept, and
// omits the room scaffold (no name/dimensions). Job sections answer once per
// sheet — loss details, floor protection, tests/Itel, etc.
export function makeDefaultJobData(schema) {
  const jobData = {};
  const sections = schema?.jobSections || [];
  for (const section of sections) {
    if (section.gateField) jobData[section.gateField] = null;
    if (section.doneFlag)  jobData[section.doneFlag]  = false;
    for (const f of flattenLeafFields(section.fields || [])) {
      if (f.key && jobData[f.key] === undefined) {
        jobData[f.key] = defaultFieldValue(f);
      }
    }
  }
  jobData.openSection = sections[0]?.key || null;
  return jobData;
}

export function fieldShouldShow(field, ctx) {
  if (!field.showWhen) return true;
  const sw = field.showWhen;
  const v = ctx?.[sw.field];
  if (sw.equals !== undefined)   return v === sw.equals;
  if (sw.includes !== undefined) return Array.isArray(v) && v.includes(sw.includes);
  return true;
}

export function resolveUnitAndLabel(field, ctx) {
  let label = field.label;
  let unit = field.unit;
  if (field.unitWhen) {
    const uw = field.unitWhen;
    if (ctx?.[uw.field] === uw.equals) {
      if (uw.thenLabel) label = uw.thenLabel;
      if (uw.thenUnit)  unit  = uw.thenUnit;
    }
  }
  return { label, unit };
}

// ── Computed fields ──────────────────────────────────────────────────────────
// A `computed` field derives its value from two sibling fields in the same
// context (e.g. tension posts × days = total post-days). It is display-only —
// never stored as the source of truth — so every consumer (renderer, summary,
// review/email/PDF) MUST route through this helper rather than reading
// ctx[field.key] directly (which only holds the seeded default of 0).
export function computeFieldValue(field, ctx) {
  const f = field?.formula;
  if (!f) return 0;
  const a = Number(ctx?.[f.a] || 0);
  const b = Number(ctx?.[f.b] || 0);
  if (f.op === 'multiply') {
    const v = a * b;
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

// ── Section status helpers ───────────────────────────────────────────────────
export function getStatus(room, section) {
  if (section.alwaysOn) {
    return section.doneFlag && room[section.doneFlag] ? 'done-yes' : 'open';
  }
  const v = room[section.gateField];
  if (v === null || v === undefined) return 'unanswered';
  if (v === false) return 'done-no';
  return 'done-yes';
}
export function isAnswered(room, section) {
  const st = getStatus(room, section);
  return st === 'done-yes' || st === 'done-no';
}
export function buildUnlocked(room, sections) {
  const unlocked = new Set();
  for (const s of sections || []) {
    unlocked.add(s.key);
    if (!isAnswered(room, s)) break;
  }
  return unlocked;
}

// ── Required-field enforcement ───────────────────────────────────────────────
// A field marked `required: true` must have an acceptable value before its
// section's "Done → Next" unlocks. Measurements (stepper) and checkboxes are
// ALWAYS acceptable — 0 / unchecked are valid answers — so they never block;
// only choice/text fields must be non-empty.
export function fieldHasValue(field, ctx) {
  const v = ctx?.[field?.key];
  switch (field?.type) {
    case 'single-chip':
    case 'select':
    case 'text':
    case 'textarea':
      return typeof v === 'string' ? v.trim().length > 0 : (v !== null && v !== undefined && v !== '');
    case 'multi-chip':
      return Array.isArray(v) && v.length > 0;
    default:
      return true; // stepper / checkbox / computed / list → 0/unchecked/derived are valid
  }
}

// True iff every *visible* required leaf field in the section has a value.
// Respects showWhen + row nesting; list-item requireds are not enforced (yet).
export function sectionRequiredMet(section, ctx) {
  let met = true;
  const visit = (fields) => {
    for (const f of fields || []) {
      if (f.type === 'row') { visit(f.fields); continue; }
      if (f.type === 'list') continue;
      if (!fieldShouldShow(f, ctx)) continue;
      if (f.required && !fieldHasValue(f, ctx)) met = false;
    }
  };
  visit(section.fields || []);
  return met;
}

// ── Schema-driven aggregation + review/email helpers ─────────────────────────
//
// computeSummary walks every field across every room, honoring section
// gating. Fields with `summaryKey` get summed into that bucket (default
// aggregate). Fields with `summaryAggregate: 'tally'` look up their value in
// `summaryTallyKeys` and add `summaryQtyField`'s value to that bucket — used
// by the Equipment list (Air Mover / Dehumidifier / Air Scrubber).
//
// Returns a flat object like { drywallSF: 240, airMovers: 4, contentsHrs: 2 }.
//
// `jobData` carries the job-level section answers (floor protection SF, etc.);
// its fields aggregate into the same flat summary as the per-room ones.
export function computeSummary(rooms, jobData, schema) {
  const summary = {};
  const sections = schema?.sections || [];
  const jobSections = schema?.jobSections || [];

  const aggregateLeaf = (field, ctx, listItem) => {
    if (field.summaryAggregate === 'tally' && field.summaryTallyKeys && field.summaryQtyField && listItem) {
      const tallyKey = field.summaryTallyKeys[ctx?.[field.key]];
      if (tallyKey) {
        const qty = Number(listItem[field.summaryQtyField] || 0);
        summary[tallyKey] = (summary[tallyKey] || 0) + qty;
      }
      return;
    }
    if (field.type === 'computed' && field.summaryKey) {
      const v = computeFieldValue(field, ctx);
      if (v) summary[field.summaryKey] = (summary[field.summaryKey] || 0) + v;
      return;
    }
    if (field.summaryKey) {
      const v = Number(ctx?.[field.key] || 0);
      if (!Number.isNaN(v) && v) {
        summary[field.summaryKey] = (summary[field.summaryKey] || 0) + v;
      }
    }
  };

  const visit = (fields, ctx, listItem) => {
    for (const f of fields || []) {
      if (f.type === 'row') { visit(f.fields, ctx, listItem); continue; }
      if (!fieldShouldShow(f, listItem || ctx)) continue;
      if (f.type === 'list') {
        const items = Array.isArray(ctx?.[f.key]) ? ctx[f.key] : [];
        for (const item of items) visit(f.itemFields || [], item, item);
        continue;
      }
      aggregateLeaf(f, listItem || ctx, listItem);
    }
  };

  for (const room of rooms || []) {
    for (const section of sections) {
      if (!section.alwaysOn && room[section.gateField] !== true) continue;
      visit(section.fields || [], room, null);
    }
  }
  // Job-level sections aggregate once over the single jobData context.
  if (jobData) {
    for (const section of jobSections) {
      if (!section.alwaysOn && jobData[section.gateField] !== true) continue;
      visit(section.fields || [], jobData, null);
    }
  }
  return summary;
}

// Format one leaf field's value for a review/email row. Returns
// { label, value, isYes } or null when the field is empty / N/A.
export function formatFieldForReview(field, value, ctx) {
  const { label } = resolveUnitAndLabel(field, ctx || {});
  switch (field.type) {
    case 'stepper': {
      const v = Number(value || 0);
      if (!v) return null;
      const { unit } = resolveUnitAndLabel(field, ctx || {});
      return { label: label || field.key, value: `${v.toLocaleString()}${unit ? ' ' + unit : ''}` };
    }
    case 'single-chip':
    case 'select': {
      if (!value) return null;
      return { label: label || field.key, value: String(value) };
    }
    case 'multi-chip': {
      if (!Array.isArray(value) || value.length === 0) return null;
      return { label: label || field.key, value: value.join(', ') };
    }
    case 'text':
    case 'textarea': {
      if (!value) return null;
      return { label: label || field.key, value: String(value) };
    }
    case 'checkbox':
      return value === true ? { label: label || field.key, value: 'Yes', isYes: true } : null;
    case 'computed': {
      const v = computeFieldValue(field, ctx);
      if (!v) return null;
      const { unit } = resolveUnitAndLabel(field, ctx || {});
      return { label: label || field.key, value: `${v.toLocaleString()}${unit ? ' ' + unit : ''}` };
    }
    default:
      return null;
  }
}

// Walk a section's fields and produce a flat list of review entries.
// List fields produce one "header" entry per item (using itemLabel) followed
// by the item's leaf fields. Used by ReviewScreen + email/note builders so
// they all stay consistent and schema-driven.
//
// Returns: [{ kind:'group', label } | { kind:'row', label, value, isYes }].
export function collectSectionEntries(section, room) {
  const entries = [];

  const visit = (fields, ctx, listItem) => {
    for (const f of fields || []) {
      if (f.type === 'row') { visit(f.fields, ctx, listItem); continue; }
      if (!fieldShouldShow(f, listItem || ctx)) continue;
      if (f.type === 'list') {
        const items = Array.isArray(ctx?.[f.key]) ? ctx[f.key] : [];
        items.forEach((item, idx) => {
          if ((f.itemFields || []).some(sub => formatFieldForReview(sub, item[sub.key], item) !== null)) {
            entries.push({ kind: 'group', label: `${f.itemLabel || 'Item'}${items.length > 1 ? ` ${idx + 1}` : ''}` });
            visit(f.itemFields || [], item, item);
          }
        });
        continue;
      }
      const value = (listItem || ctx)?.[f.key];
      const formatted = formatFieldForReview(f, value, listItem || ctx);
      if (formatted) entries.push({ kind: 'row', ...formatted });
    }
  };

  visit(section.fields || [], room, null);
  return entries;
}

// True iff this room has any populated entries in the section (or the gate
// is "Yes" with no fields under it). Used by ReviewScreen / email to skip
// empty sections.
export function sectionHasContent(section, room) {
  if (!section.alwaysOn) {
    if (room[section.gateField] === true) {
      // Even if no fields filled, count as "yes"
      return true;
    }
    return false;
  }
  return collectSectionEntries(section, room).length > 0;
}

// ── UI primitives ────────────────────────────────────────────────────────────
export function Stepper({ value, onChange, step=1, unit, small }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const ref = useRef();
  const sz = small ? 42 : 50;
  const start = () => { setRaw(value===0?'':String(value)); setEditing(true); setTimeout(()=>ref.current?.select(),40); };
  const finish = () => { const p=parseFloat(raw); onChange(isNaN(p)||p<0?0:p); setEditing(false); };
  return (
    <div style={{ display:'flex', alignItems:'center', borderRadius:8, overflow:'hidden', border:`1.5px solid ${C.border}`, background:C.input }}>
      <button onClick={()=>onChange(Math.max(0,value-step))} style={{ width:sz, height:sz, background:'transparent', border:'none', color:C.muted, fontSize:small?20:22, cursor:'pointer', flexShrink:0 }}>−</button>
      <div style={{ flex:1, textAlign:'center' }}>
        {editing
          ? <input ref={ref} type="number" inputMode="decimal" value={raw} onChange={e=>setRaw(e.target.value)} onBlur={finish} onKeyDown={e=>e.key==='Enter'&&finish()} style={{ background:'transparent', border:'none', color:C.text, fontSize:small?15:17, fontWeight:700, width:'100%', textAlign:'center', outline:'none', padding:'0 4px', fontFamily:'var(--font-sans)' }} autoFocus />
          : <div onClick={start} style={{ fontSize:small?15:17, fontWeight:700, color:value>0?C.text:C.muted, padding:`${small?10:13}px 0`, cursor:'pointer', userSelect:'none' }}>
              {value>0?value.toLocaleString():'0'}{unit&&<span style={{ fontSize:10, color:C.muted, fontWeight:400, marginLeft:3 }}>{unit}</span>}
            </div>}
      </div>
      <button onClick={()=>onChange(value+step)} style={{ width:sz, height:sz, background:'transparent', border:'none', color:C.accent, fontSize:small?20:22, cursor:'pointer', flexShrink:0 }}>+</button>
    </div>
  );
}

export function Chip({ label, selected, onToggle }) {
  return (
    <button onClick={onToggle} style={{ background:selected?C.accentDim:C.input, border:`1.5px solid ${selected?C.accent:C.border}`, borderRadius:8, color:selected?C.accent:C.muted, fontSize:12, fontWeight:selected?700:400, padding:'10px 6px', cursor:'pointer', textAlign:'center', fontFamily:'var(--font-sans)' }}>
      {label}
    </button>
  );
}
export function MultiChips({ options, selected, onChange }) {
  const toggle = o => onChange(selected.includes(o)?selected.filter(x=>x!==o):[...selected,o]);
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>{options.map(o=><Chip key={o} label={o} selected={selected.includes(o)} onToggle={()=>toggle(o)} />)}</div>;
}
export function SingleChips({ options, value, onChange, cols=2 }) {
  return <div style={{ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gap:6 }}>{options.map(o=><Chip key={o} label={o} selected={value===o} onToggle={()=>onChange(value===o?'':o)} />)}</div>;
}
export function CheckRow({ label, checked, onChange }) {
  return (
    <button onClick={()=>onChange(!checked)} style={{ display:'flex', alignItems:'center', gap:10, background:checked?C.accentDim:C.input, border:`1.5px solid ${checked?C.accent:C.border}`, borderRadius:8, padding:'12px 13px', cursor:'pointer', width:'100%', marginBottom:6, fontFamily:'var(--font-sans)' }}>
      <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${checked?C.accent:C.border}`, background:checked?C.accent:'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        {checked && <span style={{ color:'#fff', fontSize:12, fontWeight:800 }}>✓</span>}
      </div>
      <span style={{ fontSize:14, color:checked?C.accent:C.muted, fontWeight:checked?700:400 }}>{label}</span>
    </button>
  );
}
export function AddBtn({ label, onClick }) {
  return <button onClick={onClick} style={{ width:'100%', background:'transparent', border:`1.5px dashed ${C.border}`, borderRadius:8, color:C.muted, padding:10, fontSize:13, cursor:'pointer', marginTop:4, fontFamily:'var(--font-sans)' }}>+ {label}</button>;
}
export function NextBtn({ onClick, label='Done → Next', disabled=false, hint }) {
  return (
    <>
      {disabled && hint && <div style={{ fontSize:11, color:C.red, textAlign:'center', marginTop:14, marginBottom:-4 }}>{hint}</div>}
      <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ width:'100%', marginTop:14, background:disabled?C.cardAlt:C.accent, border:'none', borderRadius:8, color:disabled?C.muted:'#fff', fontSize:14, fontWeight:700, padding:13, cursor:disabled?'default':'pointer', opacity:disabled?0.75:1, fontFamily:'var(--font-sans)' }}>{label} →</button>
    </>
  );
}
export function YesNo({ onNo, onYes }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, paddingTop:12 }}>
      <button onClick={onNo} style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, fontSize:15, fontWeight:600, padding:14, cursor:'pointer', fontFamily:'var(--font-sans)' }}>✗ No</button>
      <button onClick={onYes} style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, fontSize:15, fontWeight:600, padding:14, cursor:'pointer', fontFamily:'var(--font-sans)' }}>✓ Yes</button>
    </div>
  );
}
export function ChangeBtn({ onClick }) {
  return <button onClick={onClick} style={{ fontSize:11, color:C.muted, background:'transparent', border:`1px solid ${C.border}`, borderRadius:6, padding:'4px 10px', cursor:'pointer', marginBottom:10, fontFamily:'var(--font-sans)' }}>↩ Change answer</button>;
}

export function Section({ icon, label, status, open, onToggle, locked, children }) {
  let borderColor=C.border, headerBg=C.card;
  if (status==='done-yes') { borderColor=C.greenBd; headerBg=C.greenDim; }
  if (open)                { borderColor=C.accent;  headerBg=C.accentDim; }
  return (
    <div style={{ border:`1.5px solid ${borderColor}`, borderRadius:10, marginBottom:8, overflow:'hidden', opacity:locked?0.38:1, transition:'opacity 0.2s, border-color 0.2s' }}>
      <button onClick={()=>!locked&&onToggle()} disabled={locked} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, background:headerBg, border:'none', padding:'13px 14px', cursor:locked?'default':'pointer', textAlign:'left', fontFamily:'var(--font-sans)' }}>
        <span style={{ fontSize:16 }}>{icon}</span>
        <span style={{ flex:1, fontSize:13, fontWeight:700, color:locked?C.muted:C.text }}>{label}</span>
        {status==='done-no'  && <span style={{ fontSize:11, color:C.muted, fontWeight:700, background:C.cardAlt, padding:'3px 8px', borderRadius:20 }}>N/A</span>}
        {status==='done-yes' && <span style={{ fontSize:11, color:C.green, fontWeight:700, background:C.greenDim, padding:'3px 8px', borderRadius:20 }}>✓ Done</span>}
        {!locked && <span style={{ fontSize:11, color:open?C.accent:C.muted, marginLeft:4 }}>{open?'▲':'▼'}</span>}
      </button>
      {open && <div style={{ padding:'0 14px 14px', background:C.card }}>{children}</div>}
    </div>
  );
}

export function RoomProgress({ answeredCount, total }) {
  const pct = total > 0 ? Math.round((answeredCount/total)*100) : 0;
  const color = pct===100?C.green:pct>50?C.accent:C.muted;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
      <div style={{ flex:1, height:3, background:C.border, borderRadius:2, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:2, transition:'width 0.3s' }} />
      </div>
      <span style={{ fontSize:10, color, fontWeight:700, flexShrink:0, minWidth:32 }}>{pct}%</span>
    </div>
  );
}

// ── Field / list / row renderers (schema-driven) ─────────────────────────────
export function FieldRenderer({ field, ctx, onChange }) {
  if (!fieldShouldShow(field, ctx)) return null;

  if (field.type === 'row') {
    return (
      <div style={{ display:'grid', gridTemplateColumns:`repeat(${field.cols||2}, 1fr)`, gap:8, marginBottom:8 }}>
        {(field.fields || []).map((sub, i) => (
          <div key={sub.key || i}>
            <FieldRenderer field={sub} ctx={ctx} onChange={onChange} />
          </div>
        ))}
      </div>
    );
  }

  const value = ctx?.[field.key];
  const setValue = (v) => onChange({ [field.key]: v });

  switch (field.type) {
    case 'stepper': {
      const { label, unit } = resolveUnitAndLabel(field, ctx);
      return (
        <div>
          {label && <label style={sLabel}>{label}</label>}
          <Stepper value={value || 0} onChange={setValue} step={field.step || 1} unit={unit} small={!!field.small} />
        </div>
      );
    }
    case 'single-chip':
      return (
        <div>
          {field.label && <label style={sLabel}>{field.label}</label>}
          <SingleChips options={field.options || []} value={value || ''} onChange={setValue} cols={field.cols || 2} />
        </div>
      );
    case 'multi-chip':
      return (
        <div>
          {field.label && <label style={sLabel}>{field.label}</label>}
          <MultiChips options={field.options || []} selected={value || []} onChange={setValue} />
        </div>
      );
    case 'text':
      return (
        <div>
          {field.label && <label style={sLabel}>{field.label}</label>}
          <input value={value || ''} onChange={e => setValue(e.target.value)} placeholder={field.placeholder || ''} style={sInput} />
        </div>
      );
    case 'textarea':
      return (
        <div>
          {field.label && <label style={sLabel}>{field.label}</label>}
          <textarea value={value || ''} onChange={e => setValue(e.target.value)} placeholder={field.placeholder || ''} rows={field.rows || 3} style={{ ...sInput, resize:'vertical', fontFamily:'var(--font-sans)' }} />
        </div>
      );
    case 'checkbox':
      return <CheckRow label={field.label || ''} checked={value === true} onChange={setValue} />;
    case 'select':
      return (
        <div>
          {field.label && <label style={sLabel}>{field.label}</label>}
          <select value={value || ''} onChange={e => setValue(e.target.value)} style={{ ...sInput, fontSize:14 }}>
            {(field.options || []).map(o => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </div>
      );
    case 'list':
      return <ListField field={field} value={Array.isArray(value) ? value : []} onChange={setValue} />;
    case 'computed': {
      const { label, unit } = resolveUnitAndLabel(field, ctx);
      const computed = computeFieldValue(field, ctx);
      return (
        <div>
          {label && <label style={sLabel}>{label}</label>}
          <div style={{ background:C.cardAlt, border:`1.5px solid ${C.border}`, borderRadius:8, padding:'12px 13px', display:'flex', alignItems:'baseline', justifyContent:'center', gap:4 }}>
            <span style={{ fontSize:17, fontWeight:700, color:computed>0?C.text:C.muted }}>{computed.toLocaleString()}</span>
            {unit && <span style={{ fontSize:11, color:C.muted, fontWeight:400 }}>{unit}</span>}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

export function ListField({ field, value, onChange }) {
  const items = value;
  const updateItem = (i, patch) =>
    onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it));
  const removeItem = (i) =>
    onChange(items.filter((_, j) => j !== i));
  const addItem = () =>
    onChange([...items, { id: newRowId(), ...(field.defaultItem || {}) }]);

  return (
    <div>
      {field.label && <label style={sLabel}>{field.label}</label>}
      {items.map((item, i) => (
        <div key={item.id ?? i} style={{ background:C.cardAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 12px', marginBottom:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:11, color:C.accent, fontWeight:700 }}>{field.itemLabel || 'Item'}</span>
            {(items.length > 1 || field.itemRemovable !== false) && (
              <button onClick={() => removeItem(i)} style={{ background:'transparent', border:'none', color:C.muted, cursor:'pointer', fontSize:16 }}>×</button>
            )}
          </div>
          {(field.itemFields || []).map((sub, j) => (
            <div key={sub.key || j} style={{ marginBottom: 8 }}>
              <FieldRenderer field={sub} ctx={item} onChange={patch => updateItem(i, patch)} />
            </div>
          ))}
        </div>
      ))}
      <AddBtn label={field.addLabel || 'Add'} onClick={addItem} />
    </div>
  );
}

// ── RoomCard — renders a single room. Used by both the tech page and the
//    desktop builder's live preview. ──────────────────────────────────────────
export function RoomCard({ room, index, onChange, onRemove, onDuplicate, totalRooms, needsDimensions, encircleRooms, encircleRoomsLoading, schema }) {
  const sections = schema?.sections || [];
  const roomPresets = schema?.roomPresets || [];

  const up = (patch) => onChange({ ...room, ...patch });
  const upField = (f, v) => up({ [f]: v });

  const calcSF = (room.lengthFt && room.widthFt) ? Math.round(parseFloat(room.lengthFt) * parseFloat(room.widthFt)) : null;
  const unlocked = buildUnlocked(room, sections);

  const sectionIndex = (key) => sections.findIndex(s => s.key === key);
  const nextSectionKey = (currentKey) => {
    const idx = sectionIndex(currentKey);
    return idx >= 0 && idx < sections.length - 1 ? sections[idx + 1].key : null;
  };

  const handleToggle = (key) => {
    if (!unlocked.has(key)) return;
    up({ openSection: room.openSection === key ? null : key });
  };
  const advance     = (key) => up({ openSection: nextSectionKey(key) });
  const markDone    = (doneFlag, key) => up({ [doneFlag]: true, openSection: nextSectionKey(key) });
  const markNo      = (gateField, key) => up({ [gateField]: false, openSection: nextSectionKey(key) });
  const markYes     = (gateField, key) => up({ [gateField]: true, openSection: key });
  const resetGate   = (gateField, key) => up({ [gateField]: null, openSection: key });

  const answeredCount = sections.filter(s => isAnswered(room, s)).length;
  const lastSection = sections[sections.length - 1];
  const isComplete = !!(lastSection?.doneFlag && room[lastSection.doneFlag]);

  return (
    <div style={{ ...sCard, border: `1px solid ${isComplete ? C.greenBd : C.border}` }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:8 }}>
        <div style={{ background:isComplete?C.green:C.accent, color:'#fff', fontWeight:900, fontSize:12, width:30, height:30, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {isComplete ? '✓' : index + 1}
        </div>
        <div style={{ flex:1 }}>
          <input value={room.name} onChange={e => upField('name', e.target.value)} placeholder="Room name…" style={{ ...sInput, fontWeight:600, padding:'10px 12px' }} />
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {onDuplicate && <button onClick={onDuplicate} title="Duplicate" style={{ background:'transparent', border:`1.5px solid ${C.border}`, color:C.muted, width:34, height:34, borderRadius:7, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>⎘</button>}
          {onRemove && totalRooms > 1 && <button onClick={onRemove} style={{ background:'transparent', border:`1.5px solid ${C.border}`, color:C.muted, width:34, height:34, borderRadius:7, cursor:'pointer', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>}
        </div>
      </div>

      {(roomPresets.length > 0 || encircleRoomsLoading || encircleRooms?.length) && (
        <div style={{ marginBottom:10, overflowX:'auto', whiteSpace:'nowrap', paddingBottom:4 }}>
          {encircleRoomsLoading ? (
            <div style={{ fontSize:11, color:C.muted, padding:'6px 2px' }}>⏳ Loading rooms from Encircle…</div>
          ) : (
            <div style={{ display:'inline-flex', gap:6 }}>
              {(encircleRooms && encircleRooms.length > 0 ? encircleRooms : roomPresets).map(p => (
                <button key={p} onClick={() => upField('name', p)} style={{ background:room.name===p?C.accentDim:C.cardAlt, border:`1px solid ${room.name===p?C.accent:encircleRooms?.length>0?C.greenBd:C.border}`, borderRadius:20, color:room.name===p?C.accent:encircleRooms?.length>0?C.green:C.muted, fontSize:11, fontWeight:room.name===p?700:400, padding:'5px 10px', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, fontFamily:'var(--font-sans)' }}>
                  {p}
                </button>
              ))}
              {encircleRooms?.length > 0 && (
                <span style={{ fontSize:10, color:C.green, padding:'5px 8px', whiteSpace:'nowrap', opacity:0.7, flexShrink:0 }}>from Encircle ⛓</span>
              )}
            </div>
          )}
        </div>
      )}

      {needsDimensions && (
        <div style={{ background:C.cardAlt, border:`1.5px solid ${C.redBd}`, borderRadius:8, padding:12, marginBottom:10 }}>
          <div style={{ fontSize:10, color:C.red, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>📐 Room Dimensions (required)</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            {[['lengthFt','L (ft)'],['widthFt','W (ft)'],['heightFt','H (ft)']].map(([f, l]) => (
              <div key={f}>
                <label style={sLabel}>{l}</label>
                <input type="number" inputMode="decimal" value={room[f]} onChange={e => upField(f, e.target.value)} placeholder="0" style={{ ...sInput, textAlign:'center', borderColor: !room[f] ? C.redBd : C.border }} />
              </div>
            ))}
          </div>
          {calcSF && <div style={{ marginTop:6, fontSize:11, color:C.muted, textAlign:'center' }}>≈ <strong style={{ color:C.accent }}>{calcSF.toLocaleString()} SF</strong></div>}
        </div>
      )}

      <RoomProgress answeredCount={answeredCount} total={sections.length} />

      {sections.map(sec => {
        const locked = !unlocked.has(sec.key);
        const status = locked ? null : getStatus(room, sec);
        const displayStatus = locked ? null : (status === 'open' || status === 'unanswered') ? null : status;
        const isOpen = room.openSection === sec.key && !locked;

        let body = null;
        if (isOpen) {
          const isGated = !sec.alwaysOn && !!sec.gateField;
          const gateValue = isGated ? room[sec.gateField] : null;

          if (isGated && gateValue === null) {
            body = <YesNo onNo={() => markNo(sec.gateField, sec.key)} onYes={() => markYes(sec.gateField, sec.key)} />;
          } else if (isGated && gateValue === false) {
            body = (
              <div style={{ marginTop: 8 }}>
                <ChangeBtn onClick={() => resetGate(sec.gateField, sec.key)} />
              </div>
            );
          } else {
            body = (
              <>
                {isGated && <div style={{ marginTop: 8 }}><ChangeBtn onClick={() => resetGate(sec.gateField, sec.key)} /></div>}
                <div style={{ height: 12 }} />
                {(sec.fields || []).map((field, i) => (
                  <div key={field.key || `f${i}`} style={{ marginBottom: field.type === 'row' ? 0 : 8 }}>
                    <FieldRenderer field={field} ctx={room} onChange={up} />
                  </div>
                ))}
                <NextBtn
                  onClick={() => sec.alwaysOn
                    ? markDone(sec.doneFlag, sec.key)
                    : advance(sec.key)
                  }
                  label={sec.nextLabel || 'Done → Next'}
                  disabled={!sectionRequiredMet(sec, room)}
                  hint="Answer the required question(s) to continue"
                />
              </>
            );
          }
        }

        return (
          <Section
            key={sec.key}
            icon={sec.icon}
            label={sec.label}
            status={displayStatus}
            open={isOpen}
            onToggle={() => handleToggle(sec.key)}
            locked={locked}
          >
            {body}
          </Section>
        );
      })}
    </div>
  );
}

// ── JobSections — renders the schema's JOB-LEVEL sections against a single
//    jobData context (loss details, floor protection, tests/Itel, etc.). Same
//    guided/sequential flow as RoomCard, but answered once per sheet. Kept as a
//    separate component (rather than refactoring RoomCard) so the live RoomCard
//    stays untouched. ───────────────────────────────────────────────────────
export function JobSections({ jobData, onChange, schema }) {
  const sections = schema?.jobSections || [];
  if (!jobData || sections.length === 0) return null;

  const up = (patch) => onChange({ ...jobData, ...patch });
  const unlocked = buildUnlocked(jobData, sections);

  const sectionIndex = (key) => sections.findIndex(s => s.key === key);
  const nextSectionKey = (currentKey) => {
    const idx = sectionIndex(currentKey);
    return idx >= 0 && idx < sections.length - 1 ? sections[idx + 1].key : null;
  };

  const handleToggle = (key) => {
    if (!unlocked.has(key)) return;
    up({ openSection: jobData.openSection === key ? null : key });
  };
  const advance   = (key) => up({ openSection: nextSectionKey(key) });
  const markDone  = (doneFlag, key) => up({ [doneFlag]: true, openSection: nextSectionKey(key) });
  const markNo    = (gateField, key) => up({ [gateField]: false, openSection: nextSectionKey(key) });
  const markYes   = (gateField, key) => up({ [gateField]: true, openSection: key });
  const resetGate = (gateField, key) => up({ [gateField]: null, openSection: key });

  return (
    <div style={sCard}>
      <div style={{ fontSize:9, color:C.accent, textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:800, marginBottom:14 }}>
        Loss &amp; Site Details
      </div>

      {sections.map(sec => {
        const locked = !unlocked.has(sec.key);
        const status = locked ? null : getStatus(jobData, sec);
        const displayStatus = locked ? null : (status === 'open' || status === 'unanswered') ? null : status;
        const isOpen = jobData.openSection === sec.key && !locked;

        let body = null;
        if (isOpen) {
          const isGated = !sec.alwaysOn && !!sec.gateField;
          const gateValue = isGated ? jobData[sec.gateField] : null;

          if (isGated && gateValue === null) {
            body = <YesNo onNo={() => markNo(sec.gateField, sec.key)} onYes={() => markYes(sec.gateField, sec.key)} />;
          } else if (isGated && gateValue === false) {
            body = (
              <div style={{ marginTop: 8 }}>
                <ChangeBtn onClick={() => resetGate(sec.gateField, sec.key)} />
              </div>
            );
          } else {
            body = (
              <>
                {isGated && <div style={{ marginTop: 8 }}><ChangeBtn onClick={() => resetGate(sec.gateField, sec.key)} /></div>}
                <div style={{ height: 12 }} />
                {(sec.fields || []).map((field, i) => (
                  <div key={field.key || `f${i}`} style={{ marginBottom: field.type === 'row' ? 0 : 8 }}>
                    <FieldRenderer field={field} ctx={jobData} onChange={up} />
                  </div>
                ))}
                <NextBtn
                  onClick={() => sec.alwaysOn
                    ? markDone(sec.doneFlag, sec.key)
                    : advance(sec.key)
                  }
                  label={sec.nextLabel || 'Done → Next'}
                  disabled={!sectionRequiredMet(sec, jobData)}
                  hint="Answer the required question(s) to continue"
                />
              </>
            );
          }
        }

        return (
          <Section
            key={sec.key}
            icon={sec.icon}
            label={sec.label}
            status={displayStatus}
            open={isOpen}
            onToggle={() => handleToggle(sec.key)}
            locked={locked}
          >
            {body}
          </Section>
        );
      })}
    </div>
  );
}
