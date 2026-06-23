import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import AddressAutocomplete from '@/components/AddressAutocomplete';

// Schema-driven renderer + design tokens are shared with the desktop builder.
import {
  C, sLabel, sInput, sCard,
  today, newRowId,
  makeDefaultRoom,
  RoomCard,
  computeSummary,
  collectSectionEntries,
  sectionHasContent,
} from '@/components/demo-sheet/DemoSheetRenderer';

// ── Encircle Job Search Sheet ────────────────────────────────────────────────
function EncircleSearchModal({ onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('policyholder_name');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef();

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ [searchType]: q });
      const res = await fetch(`/api/encircle-search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setResults(data.list || []);
      setSearched(true);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [searchType]);

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 500);
  };

  const searchTypes = [
    { key:'policyholder_name',     label:'Name' },
    { key:'contractor_identifier', label:'Job #' },
    { key:'assignment_identifier', label:'Assignment #' },
  ];

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', flexDirection:'column', background:C.bg }}>
      <div style={{ background:C.headerBg, borderBottom:`1px solid ${C.border}`, padding:'14px 16px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <button onClick={onClose} style={{ background:'transparent', border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, padding:'8px 14px', fontSize:13, cursor:'pointer', fontFamily:'var(--font-sans)' }}>← Back</button>
        <div>
          <div style={{ fontSize:9, color:C.accent, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em' }}>Encircle</div>
          <div style={{ fontSize:15, fontWeight:800, color:C.text }}>Find Job</div>
        </div>
      </div>

      <div style={{ padding:'14px 13px', flexShrink:0 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:10 }}>
          {searchTypes.map(t => (
            <button key={t.key} onClick={() => { setSearchType(t.key); setResults([]); setSearched(false); setQuery(''); }}
              style={{ background:searchType===t.key?C.accentDim:C.card, border:`1.5px solid ${searchType===t.key?C.accent:C.border}`, borderRadius:8, color:searchType===t.key?C.accent:C.muted, fontSize:12, fontWeight:searchType===t.key?700:400, padding:'10px 4px', cursor:'pointer', fontFamily:'var(--font-sans)' }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ position:'relative' }}>
          <input
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder={searchType==='policyholder_name' ? 'e.g. Chris Smith…' : searchType==='contractor_identifier' ? 'e.g. UPR-0042…' : 'Assignment #…'}
            style={{ ...sInput, paddingRight:44 }}
            autoFocus
          />
          <div style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', color:C.muted, fontSize:18, pointerEvents:'none' }}>
            {loading ? '⏳' : '🔍'}
          </div>
        </div>

        {error && <div style={{ marginTop:8, fontSize:12, color:C.red, textAlign:'center' }}>{error}</div>}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'0 13px 20px' }}>
        {searched && results.length === 0 && !loading && (
          <div style={{ textAlign:'center', color:C.muted, fontSize:13, paddingTop:40 }}>No jobs found</div>
        )}
        {results.map(claim => (
          <button key={claim.id} onClick={() => onSelect(claim)}
            style={{ width:'100%', background:C.card, border:`1.5px solid ${C.border}`, borderRadius:10, padding:14, marginBottom:8, cursor:'pointer', textAlign:'left', display:'block', fontFamily:'var(--font-sans)' }}>
            <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:4 }}>
              {claim.policyholder_name || '—'}
            </div>
            <div style={{ fontSize:12, color:C.accent, marginBottom:4 }}>
              {claim.full_address || 'No address'}
            </div>
            <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
              {claim.contractor_identifier && (
                <span style={{ fontSize:11, color:C.muted }}>Job #: <span style={{ color:C.text, fontWeight:600 }}>{claim.contractor_identifier}</span></span>
              )}
              {claim.policy_number && (
                <span style={{ fontSize:11, color:C.muted }}>Policy: <span style={{ color:C.text, fontWeight:600 }}>{claim.policy_number}</span></span>
              )}
              {claim.date_of_loss && (
                <span style={{ fontSize:11, color:C.muted }}>DOL: <span style={{ color:C.text, fontWeight:600 }}>{claim.date_of_loss}</span></span>
              )}
            </div>
            {claim.insurance_company_name && (
              <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>{claim.insurance_company_name}</div>
            )}
          </button>
        ))}

        {!searched && !loading && (
          <div style={{ textAlign:'center', paddingTop:40 }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
            <div style={{ fontSize:13, color:C.muted }}>Search by policyholder name,{'\n'}job number, or assignment #</div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Email HTML / Encircle note builders (schema-driven) ──────────────────────
//
// Walks the active schema's sections per room, listing only fields that have
// a value. Section colors come from `section.emailColor` if set, else accent.
// Same content drives both the HTML email body and the plain-text Encircle
// note via collectSectionEntries() from the renderer module.

const SECTION_PALETTE = ['#2563eb', '#166534', '#6B21A8', '#0F766E', '#B45309', '#0369A1', '#0891B2', '#7C3AED', '#1D4ED8', '#D97706'];
const sectionColor = (section, idx) => section?.emailColor || SECTION_PALETTE[idx % SECTION_PALETTE.length];

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function buildEmailHTML(rooms, jobInfo, hasSketchDone, schema) {
  const sections = schema?.sections || [];
  const displayDate = jobInfo.date
    ? new Date(jobInfo.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';

  const mkCat = (label, color) => `
    <tr>
      <td colspan="3" style="padding:8px 10px 4px;background:${color}18;border-top:2px solid ${color};font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.08em;">
        ${escHtml(label)}
      </td>
    </tr>`;
  const mkRow = (label, value) => `<tr>
      <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${escHtml(label)}</td>
      <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;color:#111;" colspan="2">${escHtml(value)}</td>
    </tr>`;

  const roomsHTML = rooms.map((r, i) => {
    const dim = (r.lengthFt && r.widthFt && r.heightFt)
      ? `${r.lengthFt}' × ${r.widthFt}' × ${r.heightFt}'`
      : '';

    const sectionsHTML = sections.map((sec, sIdx) => {
      if (!sectionHasContent(sec, r)) return '';
      const entries = collectSectionEntries(sec, r);
      if (entries.length === 0) {
        // Gated section answered Yes but no fields populated — still show header.
        return mkCat(`${sec.icon || ''} ${sec.label}`, sectionColor(sec, sIdx));
      }
      return [
        mkCat(`${sec.icon || ''} ${sec.label}`, sectionColor(sec, sIdx)),
        ...entries.map(e => e.kind === 'group'
          ? `<tr><td colspan="3" style="padding:4px 10px 2px 18px;font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escHtml(e.label)}</td></tr>`
          : mkRow(e.label, e.value)
        ),
      ].join('');
    }).join('');

    if (!sectionsHTML) return '';
    const headerColor = sectionColor(sections[0], 0);
    return `
      <div style="margin-bottom:24px;">
        <div style="background:${headerColor};color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;">Room ${i+1}: ${escHtml(r.name || '(Unnamed)')}</span>
          ${dim ? `<span style="font-size:11px;opacity:0.85;">${escHtml(dim)}</span>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-top:none;">
          <tbody>${sectionsHTML}</tbody>
        </table>
      </div>`;
  }).filter(Boolean).join('');

  // Job-totals card (schema-driven via summaryKey aggregation).
  const totals = computeSummary(rooms, schema);
  const totalsRows = Object.entries(totals)
    .filter(([, v]) => v && v !== 0)
    .map(([k, v]) => mkRow(prettySummaryKey(k), typeof v === 'number' ? v.toLocaleString() : v))
    .join('');
  const headerColor = sectionColor(sections[0], 0);

  return `<div style="font-family:system-ui,sans-serif;max-width:660px;margin:0 auto;padding:20px;">
    <div style="border-bottom:3px solid ${headerColor};padding-bottom:14px;margin-bottom:20px;">
      <div style="font-size:20px;font-weight:800;color:${headerColor};">UTAH PROS RESTORATION</div>
      <div style="font-size:11px;font-weight:700;color:#444;letter-spacing:0.05em;margin-top:2px;">DEMOLITION SHEET</div>
      <div style="font-size:11px;color:#888;margin-top:4px;">Floor plan: ${hasSketchDone ? 'Encircle / DocuSketch ✓' : 'No sketch — dimensions recorded per room'}</div>
      <table style="width:100%;margin-top:10px;font-size:12px;">
        <tr><td style="color:#888;width:80px;">Date</td><td style="font-weight:600;">${escHtml(displayDate)}</td><td style="color:#888;width:90px;">Technician</td><td style="font-weight:600;">${escHtml(jobInfo.techName || '—')}</td></tr>
        <tr><td style="color:#888;">Job #</td><td style="font-weight:600;">${escHtml(jobInfo.jobNumber || '—')}</td><td style="color:#888;">Address</td><td style="font-weight:600;">${escHtml(jobInfo.address || '—')}</td></tr>
        <tr><td style="color:#888;">Insured</td><td style="font-weight:600;" colspan="3">${escHtml(jobInfo.insuredName || '—')}</td></tr>
      </table>
    </div>
    ${roomsHTML}

    ${totalsRows ? `
    <div style="margin-top:8px;border:2px solid ${headerColor};border-radius:6px;overflow:hidden;">
      <div style="background:${headerColor};color:#fff;padding:8px 12px;">
        <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;">∑ Job Totals — All Rooms</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${totalsRows}</tbody>
      </table>
    </div>` : ''}
  </div>`;
}

function buildNoteText(rooms, jobInfo, hasSketchDone, schema) {
  const sections = schema?.sections || [];
  const displayDate = jobInfo.date
    ? new Date(jobInfo.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';
  let out = '';
  out += `UTAH PROS RESTORATION — DEMOLITION SHEET\n`;
  out += `${'='.repeat(44)}\n`;
  out += `Date: ${displayDate}\n`;
  out += `Technician: ${jobInfo.techName || '—'}\n`;
  out += `Job #: ${jobInfo.jobNumber || '—'}\n`;
  out += `Address: ${jobInfo.address || '—'}\n`;
  out += `Floor Plan: ${hasSketchDone ? 'Encircle / DocuSketch' : 'No sketch — dimensions per room'}\n\n`;

  rooms.forEach((r, i) => {
    const dim = (r.lengthFt && r.widthFt && r.heightFt) ? ` (${r.lengthFt}x${r.widthFt}x${r.heightFt}ft)` : '';
    const populatedSections = sections
      .map(sec => ({ sec, entries: sectionHasContent(sec, r) ? collectSectionEntries(sec, r) : null }))
      .filter(x => x.entries !== null);
    if (populatedSections.length === 0) return;

    out += `ROOM ${i+1}: ${(r.name || 'Unnamed').toUpperCase()}${dim}\n${'-'.repeat(32)}\n`;
    populatedSections.forEach(({ sec, entries }) => {
      out += `${sec.label}:\n`;
      entries.forEach(e => {
        if (e.kind === 'group') out += `  [${e.label}]\n`;
        else                    out += `  ${e.label}: ${e.value}\n`;
      });
    });
    out += '\n';
  });

  const totals = computeSummary(rooms, schema);
  const totalRows = Object.entries(totals).filter(([, v]) => v && v !== 0);
  if (totalRows.length > 0) {
    out += `JOB TOTALS\n${'='.repeat(44)}\n`;
    totalRows.forEach(([k, v]) => {
      out += `  ${prettySummaryKey(k)}: ${typeof v === 'number' ? v.toLocaleString() : v}\n`;
    });
  }
  return out.trim();
}

// Structured render model handed to the /api/demo-sheet-pdf worker. All the
// schema-walking lives here (client-side) so the worker stays a dumb layout
// engine. Mirrors the content of buildEmailHTML / buildNoteText.
function buildPdfModel(rooms, jobInfo, hasSketchDone, schema) {
  const sections = schema?.sections || [];
  const displayDate = jobInfo.date
    ? new Date(jobInfo.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';

  const roomModels = rooms.map((r, i) => {
    const dim = (r.lengthFt && r.widthFt && r.heightFt) ? `${r.lengthFt}' × ${r.widthFt}' × ${r.heightFt}'` : '';
    const secModels = sections.map(sec => {
      if (!sectionHasContent(sec, r)) return null;
      const entries = collectSectionEntries(sec, r);
      return {
        label: `${sec.icon || ''} ${sec.label}`.trim(),
        entries: entries.map(e => e.kind === 'group'
          ? { kind: 'group', label: e.label }
          : { kind: 'row', label: e.label, value: e.value == null ? '' : String(e.value) }),
      };
    }).filter(Boolean);
    if (secModels.length === 0) return null;
    return { index: i + 1, name: r.name || `Room ${i + 1}`, dim, sections: secModels };
  }).filter(Boolean);

  const totals = computeSummary(rooms, schema);
  const totalRows = Object.entries(totals)
    .filter(([, v]) => v && v !== 0)
    .map(([k, v]) => ({ label: prettySummaryKey(k), value: typeof v === 'number' ? v.toLocaleString() : String(v) }));

  return {
    jobInfo: {
      date: displayDate,
      techName: jobInfo.techName || '',
      jobNumber: jobInfo.jobNumber || '',
      address: jobInfo.address || '',
      insuredName: jobInfo.insuredName || '',
    },
    floorPlan: hasSketchDone ? 'Encircle / DocuSketch' : 'No sketch — dimensions recorded per room',
    rooms: roomModels,
    totals: totalRows,
  };
}

// Cosmetic conversion of a summary key (e.g. drywallSF) to a label (e.g.
// "Drywall SF"). Camel/snake split + first-letter capitalize.
function prettySummaryKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^([a-z])/, (_, c) => c.toUpperCase());
}



// ── Review Screen (schema-driven) ────────────────────────────────────────────
//
// Iterates schema.sections per room, using collectSectionEntries from the
// shared renderer. Sections that aren't populated for a given room are
// skipped; gated sections answered "No" show as N/A pills. Job totals come
// from computeSummary.
function ReviewScreen({ rooms, jobInfo, hasSketchDone, onBack, onSubmit, sending, encircleLinked, schema }) {
  const sections = schema?.sections || [];
  const [expandedRooms, setExpandedRooms] = useState(new Set([rooms[0]?.id]));
  const toggleRoom = id => setExpandedRooms(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const displayDate = jobInfo.date
    ? new Date(jobInfo.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '—';

  const totals = computeSummary(rooms, schema);
  const totalRows = Object.entries(totals).filter(([, v]) => v && v !== 0);

  const lastDoneFlag = (() => {
    for (let i = sections.length - 1; i >= 0; i--) if (sections[i].doneFlag) return sections[i].doneFlag;
    return null;
  })();

  return (
    <div style={{ position:'fixed', inset:0, background:C.bg, zIndex:50, overflowY:'auto', paddingBottom:'calc(120px + var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ background:C.headerBg, borderBottom:`1px solid ${C.border}`, padding:'14px 16px', position:'sticky', top:0, zIndex:10, display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={onBack} style={{ background:'transparent', border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, padding:'8px 14px', fontSize:13, cursor:'pointer', flexShrink:0, fontFamily:'var(--font-sans)' }}>← Edit</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:C.accent, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em' }}>Review Before Sending</div>
          <div style={{ fontSize:14, fontWeight:800, color:C.text }}>
            {rooms.length} Room{rooms.length !== 1 ? 's' : ''} · {jobInfo.jobNumber || 'No Job #'}
          </div>
        </div>
      </div>

      <div style={{ padding:'14px 13px 0' }}>
        {/* Job info card */}
        <div style={{ ...sCard, border:`1px solid ${C.accent}` }}>
          <div style={{ fontSize:9, color:C.accent, textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:800, marginBottom:12 }}>Job Info</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[['Date', displayDate], ['Tech', jobInfo.techName || '—'], ['Job #', jobInfo.jobNumber || '—'], ['Insured', jobInfo.insuredName || '—'], ['Floor Plan', hasSketchDone ? 'Encircle/DocuSketch ✓' : 'No sketch']].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2 }}>{l}</div>
                <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{v}</div>
              </div>
            ))}
          </div>
          {jobInfo.address && <div style={{ marginTop:10, fontSize:12, color:C.muted }}>📍 {jobInfo.address}</div>}
        </div>

        {/* Per-room summary cards */}
        {rooms.map((r, i) => {
          const isOpen = expandedRooms.has(r.id);
          const dim = (r.lengthFt && r.widthFt && r.heightFt) ? `${r.lengthFt}×${r.widthFt}×${r.heightFt}ft` : '';
          const isComplete = !!(lastDoneFlag && r[lastDoneFlag]);

          // Quick "headline" summary line: pick the first 2-3 stepper-summed things.
          const populatedSections = sections
            .map(sec => ({ sec, entries: sectionHasContent(sec, r) ? collectSectionEntries(sec, r) : null }))
            .filter(x => x.entries !== null);
          const naSections = sections.filter(s => !s.alwaysOn && s.gateField && r[s.gateField] === false);

          return (
            <div key={r.id} style={{ ...sCard, border:`1px solid ${isComplete ? C.greenBd : C.accent}` }}>
              <button onClick={() => toggleRoom(r.id)} style={{ width:'100%', background:'transparent', border:'none', padding:0, cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:10, fontFamily:'var(--font-sans)' }}>
                <div style={{ background:isComplete ? C.green : C.accent, color:'#fff', fontWeight:900, fontSize:11, width:28, height:28, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  {isComplete ? '✓' : i + 1}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{r.name || `Room ${i + 1}`}</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:1 }}>
                    {[dim, populatedSections.length > 0 ? `${populatedSections.length} section${populatedSections.length === 1 ? '' : 's'} populated` : 'No quantities entered'].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span style={{ fontSize:12, color:C.muted }}>{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div style={{ marginTop:14, borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
                  {populatedSections.map(({ sec, entries }) => (
                    <div key={sec.key} style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, color:C.accent, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>
                        {sec.icon || ''} {sec.label}
                      </div>
                      {entries.length === 0 && (
                        <div style={{ fontSize:12, color:C.muted, padding:'6px 0' }}>Marked Yes — no details entered.</div>
                      )}
                      {entries.map((e, ei) => e.kind === 'group' ? (
                        <div key={ei} style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', padding:'8px 0 2px' }}>{e.label}</div>
                      ) : (
                        <div key={ei} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:`1px solid ${C.borderLt}` }}>
                          <span style={{ fontSize:13, color:C.muted }}>{e.label}</span>
                          <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{e.value}</span>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* N/A pills for "No" answers on gated sections */}
                  {naSections.length > 0 && (
                    <div style={{ marginTop:8, flexWrap:'wrap', display:'flex', gap:4 }}>
                      {naSections.map(s => (
                        <span key={s.key} style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:12, display:'inline-block', background:C.cardAlt, color:C.muted, border:`1px solid ${C.border}` }}>
                          — {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Job totals */}
        {totalRows.length > 0 && (
          <div style={{ ...sCard, border:`1px solid ${C.accent}`, marginBottom:16 }}>
            <div style={{ fontSize:9, color:C.accent, textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:800, marginBottom:12 }}>∑ Job Totals</div>
            {totalRows.map(([k, v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:`1px solid ${C.borderLt}` }}>
                <span style={{ fontSize:13, color:C.text }}>{prettySummaryKey(k)}</span>
                <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{typeof v === 'number' ? v.toLocaleString() : v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ position:'fixed', bottom:'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))', left:0, right:0, background:C.headerBg, borderTop:`1px solid ${C.border}`, padding:'12px 13px 12px', zIndex:60 }}>
        <div style={{ fontSize:11, color:C.muted, textAlign:'center', marginBottom:8 }}>
          {encircleLinked ? '⛓ Will email + post note to Encircle' : 'Will email to restoration@utah-pros.com'}
        </div>
        <button onClick={onSubmit} disabled={sending} style={{ width:'100%', background:sending ? C.cardAlt : C.green, border:'none', borderRadius:10, color:sending ? C.muted : '#fff', fontSize:17, fontWeight:800, padding:17, cursor:sending ? 'default' : 'pointer', opacity:sending ? 0.8 : 1, fontFamily:'var(--font-sans)' }}>
          {sending ? <span>⏳ Submitting…</span> : <span>✓ Submit Demo Sheet</span>}
        </button>
      </div>
    </div>
  );
}

function ResultScreen({ result, onStartNew, onBack, onClose }) {
  const saveOk = result.saveOk;

  return (
    <div style={{ position:'fixed', inset:0, background:C.bg, zIndex:50, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
      <div style={{ fontSize:72, marginBottom:20, lineHeight:1 }}>{saveOk ? '✅' : '❌'}</div>
      <div style={{ fontSize:22, fontWeight:800, color:saveOk ? C.green : C.red, marginBottom:8 }}>
        {saveOk ? 'Demo Sheet Saved!' : 'Save Failed'}
      </div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:32, lineHeight:1.5 }}>
        {saveOk
          ? 'Stored in UPR and visible from this claim.'
          : (result.saveErr || 'Could not save — check connection.')
        }
      </div>

      {saveOk && (
        <div style={{ width:'100%', maxWidth:360, marginBottom:32 }}>
          {/* Email — best effort, secondary status */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, background:result.emailOk ? C.greenDim : C.cardAlt, border:`1.5px solid ${result.emailOk ? C.greenBd : C.border}`, borderRadius:10, padding:'12px 14px', marginBottom:10 }}>
            <span style={{ fontSize:20, flexShrink:0 }}>📧</span>
            <div style={{ textAlign:'left', minWidth:0, flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, color:result.emailOk ? C.green : C.muted }}>
                {result.emailOk ? 'Email sent' : 'Email skipped'}
              </div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2, wordBreak:'break-word' }}>
                {result.emailOk
                  ? 'restoration@utah-pros.com'
                  : (result.emailErr || 'Could not send — sheet saved anyway')
                }
              </div>
            </div>
          </div>

          {/* Encircle — only show if there was an attempt */}
          {!result.encircleSkipped && (
            <div style={{ display:'flex', alignItems:'flex-start', gap:12, background:result.encircleOk ? C.greenDim : C.cardAlt, border:`1.5px solid ${result.encircleOk ? C.greenBd : C.border}`, borderRadius:10, padding:'12px 14px', marginBottom:10 }}>
              <span style={{ fontSize:20, flexShrink:0 }}>⛓</span>
              <div style={{ textAlign:'left' }}>
                <div style={{ fontSize:12, fontWeight:700, color:result.encircleOk ? C.green : C.muted }}>
                  {result.encircleOk ? 'Posted to Encircle' : 'Encircle skipped'}
                </div>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                  {result.encircleOk ? 'General note saved to job' : 'Could not post note — sheet saved anyway'}
                </div>
              </div>
            </div>
          )}

          {/* PDF — attached to the job's Files section (+ customer page) */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, background:result.pdfAttached ? C.greenDim : C.cardAlt, border:`1.5px solid ${result.pdfAttached ? C.greenBd : C.border}`, borderRadius:10, padding:'12px 14px' }}>
            <span style={{ fontSize:20, flexShrink:0 }}>📄</span>
            <div style={{ textAlign:'left', minWidth:0, flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, color:result.pdfAttached ? C.green : C.muted }}>
                {result.pdfAttached ? 'PDF saved to job files' : 'PDF not attached'}
              </div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2, wordBreak:'break-word' }}>
                {result.pdfAttached
                  ? 'Visible under the job + customer Files'
                  : (result.pdfErr || 'Sheet isn’t linked to a job — saved anyway')}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ width:'100%', maxWidth:360, display:'flex', flexDirection:'column', gap:10 }}>
        {saveOk ? (
          <>
            <button onClick={onClose} style={{ background:C.green, border:'none', borderRadius:10, color:'#fff', fontSize:15, fontWeight:800, padding:15, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
              ✓ Done
            </button>
            <button onClick={onStartNew} style={{ background:'transparent', border:`1.5px solid ${C.border}`, borderRadius:10, color:C.muted, fontSize:13, fontWeight:600, padding:13, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
              + Start New Demo Sheet
            </button>
            <button onClick={onBack} style={{ background:'transparent', border:'none', color:C.muted, fontSize:12, fontWeight:600, padding:8, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
              ← Back to Sheet
            </button>
          </>
        ) : (
          <button onClick={onBack} style={{ background:C.accent, border:'none', borderRadius:10, color:'#fff', fontSize:15, fontWeight:800, padding:15, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
            ← Go Back & Retry
          </button>
        )}
      </div>
    </div>
  );
}


// ── Main page ────────────────────────────────────────────────────────────────
export default function TechDemoSheet() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { db, employee } = useAuth();

  const [techs, setTechs] = useState([]);
  const [sheetId, setSheetId] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [jobInfo, setJobInfo] = useState({ date:today(), tech:'', techName:'', jobNumber:'', address:'', insuredName:'' });
  const [hasSketchDone, setHasSketchDone] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [showEncircle, setShowEncircle] = useState(false);
  const [encircleLinked, setEncircleLinked] = useState(null);
  const [encircleRooms, setEncircleRooms] = useState([]);
  const [encircleRoomsLoading, setEncircleRoomsLoading] = useState(false);

  const [jobId, setJobIdState] = useState(null);
  const saveTimerRef = useRef(null);
  // The first save has no id yet (INSERT). On slow connections a second save
  // can fire before the first returns, inserting a duplicate draft. These refs
  // let in-flight saves share the row id instead of racing.
  const sheetIdRef = useRef(null);
  const createInFlightRef = useRef(null);
  const applySheetId = (id) => { sheetIdRef.current = id; setSheetId(id); };
  const setJob = (k, v) => setJobInfo(p => ({ ...p, [k]:v }));

  // Active techs dropdown — replaces the original hardcoded list
  useEffect(() => {
    db.rpc('get_active_techs').then(rows => setTechs(rows || [])).catch(() => setTechs([]));
  }, [db]);

  // Load the schema. If we're loading an existing draft (?id=…), use THAT
  // sheet's snapshotted schema_id so old drafts render with their original
  // fields. Otherwise use the currently-active schema.
  useEffect(() => {
    let cancelled = false;
    const id = searchParams.get('id');
    const loadSchemaById = async (schemaId) => {
      const rows = await db.rpc('get_demo_schema', { p_id: schemaId });
      const row = Array.isArray(rows) ? rows[0] : rows;
      return row?.definition ? { ...row.definition, _id: row.id, _version: row.version } : null;
    };
    const loadActiveSchema = async () => {
      const rows = await db.rpc('get_active_demo_schema');
      const row = Array.isArray(rows) ? rows[0] : rows;
      return row?.definition ? { ...row.definition, _id: row.id, _version: row.version } : null;
    };
    (async () => {
      try {
        let schemaToUse = null;
        if (id) {
          const sheetRows = await db.rpc('get_demo_sheet', { p_id: id });
          const sheetRow = Array.isArray(sheetRows) ? sheetRows[0] : sheetRows;
          if (sheetRow?.schema_id) {
            schemaToUse = await loadSchemaById(sheetRow.schema_id);
          }
        }
        if (!schemaToUse) schemaToUse = await loadActiveSchema();
        if (!cancelled) {
          if (schemaToUse) setSchema(schemaToUse);
          else setSchemaError('No active demo sheet schema found.');
        }
      } catch (e) {
        if (!cancelled) setSchemaError(e?.message || 'Failed to load schema');
      }
    })();
    return () => { cancelled = true; };
  }, [db, searchParams]);

  // Bootstrap: prefer ?id=<draft>; otherwise prefill from appointment context.
  // Waits for schema to be ready before building default rooms.
  useEffect(() => {
    if (!schema) return;
    const defaultRoom = () => makeDefaultRoom(schema);
    const id = searchParams.get('id');
    if (id) {
      db.rpc('get_demo_sheet', { p_id: id })
        .then(rows => {
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (row && row.form_data) {
            applySheetId(row.id);
            if (row.job_id) setJobIdState(row.job_id);
            const d = row.form_data;
            setRooms((d.rooms || [defaultRoom()]).map(r => ({ ...defaultRoom(), ...r })));
            setJobInfo(d.jobInfo || { date:today(), tech:'', techName:'', jobNumber:'', address:'', insuredName:'' });
            setHasSketchDone(d.hasSketchDone ?? null);
            if (d.encircleLinked) setEncircleLinked(d.encircleLinked);
            if (Array.isArray(d.encircleRooms)) setEncircleRooms(d.encircleRooms);
          } else {
            setRooms([defaultRoom()]);
          }
          setHydrated(true);
        })
        .catch(() => { setRooms([defaultRoom()]); setHydrated(true); });
    } else {
      // Optional appt prefill via query params
      const apptJobId     = searchParams.get('jobId')      || '';
      const apptJobNumber = searchParams.get('jobNumber')  || '';
      const apptAddress   = searchParams.get('address')    || '';
      const apptInsured   = searchParams.get('insuredName')|| '';
      const apptClaim     = searchParams.get('claimId')    || '';
      if (apptJobId) setJobIdState(apptJobId);
      if (apptJobNumber || apptAddress || apptInsured) {
        setJobInfo(p => ({
          ...p,
          jobNumber: apptJobNumber || p.jobNumber,
          address:   apptAddress   || p.address,
          insuredName: apptInsured || p.insuredName,
        }));
      }
      if (apptClaim) {
        setEncircleLinked({ id: apptClaim, policyholder_name: apptInsured });
      }
      setRooms([defaultRoom()]);
      setHydrated(true);
    }
    db.rpc('get_demo_sheet_drafts').then(d => setDrafts(d || [])).catch(() => {});
  }, [db, searchParams, schema]);

  // Default tech to current employee once techs are loaded
  useEffect(() => {
    if (techs.length && employee?.id && !jobInfo.tech) {
      const me = techs.find(t => t.id === employee.id);
      if (me) setJobInfo(p => ({ ...p, tech: me.id, techName: me.name }));
    }
  }, [techs, employee, jobInfo.tech]);

  // Debounced autosave on any meaningful change
  useEffect(() => {
    if (!hydrated) return;
    if (showResult) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      // First INSERT still in flight — saving again without an id would
      // create a duplicate draft. The next change re-arms the timer.
      if (!sheetIdRef.current && createInFlightRef.current) return;
      try {
        const payload = {
          p_id: sheetIdRef.current,
          p_data: { rooms, jobInfo, encircleLinked, encircleRooms, hasSketchDone },
          p_job_date: jobInfo.date || null,
          p_tech_id:  jobInfo.tech || null,
          p_job_number: jobInfo.jobNumber || null,
          p_address:    jobInfo.address || null,
          p_insured_name: jobInfo.insuredName || null,
          p_encircle_claim_id: encircleLinked?.id ? String(encircleLinked.id) : null,
          p_status: 'draft',
          p_job_id: jobId || null,
          p_summary: computeSummary(rooms, schema),
          p_schema_id: schema?._id || null,
        };
        const savePromise = db.rpc('save_demo_sheet', payload);
        if (!sheetIdRef.current) createInFlightRef.current = savePromise;
        const newId = await savePromise;
        if (!sheetIdRef.current && newId) {
          applySheetId(newId);
          const next = new URLSearchParams(searchParams);
          next.set('id', newId);
          // Strip prefill params now that we have a draft id
          next.delete('jobNumber'); next.delete('address'); next.delete('insuredName'); next.delete('claimId'); next.delete('jobId');
          setSearchParams(next, { replace: true });
        }
      } catch {
        /* autosave is best-effort; surface only on submit */
      } finally {
        createInFlightRef.current = null;
      }
    }, 2000);
    return () => clearTimeout(saveTimerRef.current);
  }, [hydrated, rooms, jobInfo, encircleLinked, encircleRooms, hasSketchDone, sheetId, jobId, db, searchParams, setSearchParams, showResult]);

  const handleEncircleSelect = async (claim) => {
    setJobInfo(p => ({
      ...p,
      jobNumber: claim.contractor_identifier || claim.policy_number || String(claim.id) || p.jobNumber,
      address: claim.full_address || p.address,
      insuredName: claim.policyholder_name || p.insuredName,
    }));
    setEncircleLinked(claim);
    setShowEncircle(false);
    setEncircleRoomsLoading(true);
    try {
      const res = await fetch(`/api/encircle-rooms?claim_id=${claim.id}`);
      const data = await res.json();
      if (res.ok && data.rooms?.length) {
        setEncircleRooms(data.rooms.map(r => r.name));
      } else {
        setEncircleRooms([]);
      }
    } catch {
      setEncircleRooms([]);
    }
    setEncircleRoomsLoading(false);
  };

  const needsDimensions = hasSketchDone === false;
  const addRoom = () => setRooms(p => [...p, makeDefaultRoom(schema)]);
  const updateRoom = (id, u) => setRooms(p => p.map(r => r.id===id?u:r));
  const removeRoom = id => setRooms(p => p.filter(r => r.id !== id));
  const duplicateRoom = id => {
    const room = rooms.find(r => r.id===id);
    const firstSectionKey = schema?.sections?.[0]?.key || null;
    const copy = { ...room, id:newRowId(), name:room.name?room.name+' (copy)':'', openSection:firstSectionKey };
    const idx = rooms.findIndex(r => r.id===id);
    setRooms(p => [...p.slice(0, idx+1), copy, ...p.slice(idx+1)]);
  };

  // A room is "complete" when the last section's doneFlag is set (e.g.
  // notesDone in v1). Schema-driven so future schemas with a different
  // final section keep working.
  const lastDoneFlag = (() => {
    const secs = schema?.sections || [];
    for (let i = secs.length - 1; i >= 0; i--) {
      if (secs[i].doneFlag) return secs[i].doneFlag;
    }
    return null;
  })();
  const isRoomComplete = (r) => !!(lastDoneFlag && r[lastDoneFlag]);
  const allComplete = rooms.length > 0 && rooms.every(isRoomComplete);

  // Flush any pending autosave then save the current state synchronously.
  // Returns the final sheet id, or throws.
  const flushSave = async ({ status = 'draft', emailOk = null, encircleNoteId = null } = {}) => {
    clearTimeout(saveTimerRef.current);
    // If the first INSERT is still in flight, wait for its id so this save
    // UPDATEs that row instead of inserting a duplicate draft.
    if (!sheetIdRef.current && createInFlightRef.current) {
      try {
        const id = await createInFlightRef.current;
        if (id) applySheetId(id);
      } catch { /* fall through — save below will insert */ }
    }
    const newId = await db.rpc('save_demo_sheet', {
      p_id: sheetIdRef.current,
      p_data: { rooms, jobInfo, encircleLinked, encircleRooms, hasSketchDone },
      p_job_date: jobInfo.date || null,
      p_tech_id:  jobInfo.tech || null,
      p_job_number: jobInfo.jobNumber || null,
      p_address:    jobInfo.address || null,
      p_insured_name: jobInfo.insuredName || null,
      p_encircle_claim_id: encircleLinked?.id ? String(encircleLinked.id) : null,
      p_status: status,
      p_encircle_note_id: encircleNoteId,
      p_job_id: jobId || null,
      p_summary: computeSummary(rooms, schema),
      p_email_sent: emailOk,
      p_schema_id: schema?._id || null,
    });
    if (!sheetIdRef.current && newId) applySheetId(newId);
    return newId || sheetIdRef.current;
  };

  const handleSaveAndClose = async () => {
    if (sending) return;
    setSending(true);
    try {
      await flushSave({ status: 'draft' });
      toast('Draft saved', 'success');
      navigate(-1);
    } catch (e) {
      toast(`Save failed: ${e.message || 'unknown'}`, 'error');
      setSending(false);
    }
  };

  const doSubmit = async () => {
    setSending(true);
    setSubmitResult(null);
    const html = buildEmailHTML(rooms, jobInfo, hasSketchDone, schema);
    const subject = `Demo Sheet — ${jobInfo.jobNumber||'No Job #'} | ${jobInfo.techName||'?'} | ${jobInfo.address||'No Address'}`;

    // ── 1. Persist to UPR first — this is the source of truth ──
    let saveOk = false;
    let saveErr = null;
    try {
      await flushSave({ status: 'submitted' });
      saveOk = true;
    } catch (e) {
      saveErr = e?.message || 'Failed to save';
    }

    // ── 2. Best-effort email + Encircle + job-file PDF (don't block submit) ──
    let emailOk = false;
    let emailErr = null;
    let encircleOk = false;
    let encircleNoteId = null;
    let pdfAttached = false;
    let pdfErr = null;
    const encircleSkipped = !encircleLinked?.id;

    if (saveOk) {
      const tasks = [
        fetch('/api/send-demo-sheet', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ subject, message: html }),
        })
          .then(async r => {
            let parsed = null;
            try { parsed = await r.json(); } catch { /* not JSON */ }
            if (parsed && typeof parsed === 'object') {
              emailOk = parsed.ok === true;
              if (!emailOk) {
                const sg = parsed.sendgrid_error ? ` — ${String(parsed.sendgrid_error).slice(0, 200)}` : '';
                const det = parsed.detail ? ` — ${parsed.detail}` : '';
                emailErr = (parsed.error || `HTTP ${r.status}`) + sg + det;
                console.error('[demo-sheet] send-demo-sheet failed:', emailErr, parsed);
              }
            } else {
              emailErr = `HTTP ${r.status} (no body)`;
              console.error('[demo-sheet] send-demo-sheet non-JSON response, status', r.status);
            }
          })
          .catch(e => {
            emailErr = e?.message || 'network error';
            console.error('[demo-sheet] send-demo-sheet network error:', e);
          }),
      ];

      if (!encircleSkipped) {
        tasks.push(
          fetch('/api/encircle-upload', {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({
              claim_id: encircleLinked.id,
              title: `Demo Sheet — ${jobInfo.jobNumber||'No Job #'} | ${jobInfo.techName||'?'}`,
              text: buildNoteText(rooms, jobInfo, hasSketchDone, schema),
            }),
          })
            .then(async r => {
              encircleOk = r.ok;
              if (r.ok) {
                try { const d = await r.json(); encircleNoteId = d?.id || null; } catch { /* ignore */ }
              }
            })
            .catch(() => { /* ignore — best-effort */ }),
        );
      }

      // Render the sheet to a PDF and attach it to the job's Files section.
      // The worker resolves the job from jobId (or job_number) and is a no-op
      // when the sheet isn't linked to a UPR job.
      tasks.push(
        fetch('/api/demo-sheet-pdf', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${db.apiKey}` },
          body: JSON.stringify({
            p_job_id: jobId || null,
            job_number: jobInfo.jobNumber || null,
            sheet_id: sheetIdRef.current || null,
            requested_by: employee?.id || null,
            model: buildPdfModel(rooms, jobInfo, hasSketchDone, schema),
          }),
        })
          .then(async r => {
            let parsed = null;
            try { parsed = await r.json(); } catch { /* not JSON */ }
            if (r.ok && parsed?.success) {
              pdfAttached = parsed.attached === true;
              if (!pdfAttached && parsed.reason !== 'no_matching_job') {
                pdfErr = parsed.reason || 'not attached';
              }
            } else {
              pdfErr = parsed?.error || `HTTP ${r.status}`;
              console.error('[demo-sheet] demo-sheet-pdf failed:', pdfErr, parsed);
            }
          })
          .catch(e => {
            pdfErr = e?.message || 'network error';
            console.error('[demo-sheet] demo-sheet-pdf network error:', e);
          }),
      );

      await Promise.all(tasks);

      // Update email_sent + encircle_note_id flags on the saved row (best effort).
      if (emailOk || encircleNoteId) {
        try {
          await flushSave({ status: 'submitted', emailOk, encircleNoteId });
        } catch { /* ignore — flags only */ }
      }
    }

    setSending(false);
    setSubmitResult({ saveOk, saveErr, emailOk, emailErr, encircleOk, encircleSkipped, pdfAttached, pdfErr });
    setShowReview(false);
    setShowResult(true);
    if (saveOk) toast('Demo sheet saved', 'success');
    else        toast(`Save failed: ${saveErr}`, 'error');
  };

  const startNew = () => {
    setRooms([makeDefaultRoom(schema)]);
    setJobInfo({ date:today(), tech:'', techName:'', jobNumber:'', address:'', insuredName:'' });
    setHasSketchDone(null);
    setEncircleLinked(null);
    setEncircleRooms([]);
    setSubmitResult(null);
    setShowResult(false);
    applySheetId(null);
    setSearchParams({}, { replace: true });
  };

  const resumeDraft = (d) => {
    setSearchParams({ id: d.id }, { replace: false });
    // The bootstrap effect will re-hydrate. Simpler: reload to fully reset state.
    window.location.reload();
  };

  const visibleDrafts = drafts.filter(d => d.id !== sheetId);

  // Block render until the schema is loaded — otherwise rooms / sections
  // can't be built.
  if (!schema) {
    return (
      <div style={{ background:C.bg, minHeight:'100dvh', color:C.text, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, fontFamily:'var(--font-sans)' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
        <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:6 }}>
          {schemaError ? 'Could not load demo sheet' : 'Loading demo sheet…'}
        </div>
        {schemaError && (
          <div style={{ fontSize:12, color:C.muted, marginBottom:16, textAlign:'center', maxWidth:320 }}>
            {schemaError}
          </div>
        )}
        <button onClick={() => navigate(-1)} style={{ background:'transparent', border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, padding:'8px 14px', fontSize:13, cursor:'pointer', fontFamily:'var(--font-sans)' }}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ background:C.bg, minHeight:'100dvh', color:C.text, paddingBottom:'calc(180px + env(safe-area-inset-bottom, 0px))', fontFamily:'var(--font-sans)' }}>
      <style>{`
        .demo-sheet input, .demo-sheet select, .demo-sheet textarea { -webkit-appearance: none; appearance: none; }
        .demo-sheet input:focus, .demo-sheet select:focus, .demo-sheet textarea:focus { border-color: ${C.accent} !important; outline: none; }
        .demo-sheet button:active { opacity: 0.7; transform: scale(0.97); }
      `}</style>

      <div className="demo-sheet">
        {/* Header */}
        <div style={{ background:C.headerBg, borderBottom:`1px solid ${C.border}`, padding:'14px 16px 12px', position:'sticky', top:0, zIndex:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button
              onClick={() => navigate(-1)}
              style={{ background:'transparent', border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, padding:'8px 12px', fontSize:13, cursor:'pointer', fontFamily:'var(--font-sans)' }}
              aria-label="Back"
            >
              ←
            </button>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9, color:C.accent, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:1 }}>Utah Pros Restoration</div>
              <div style={{ fontSize:18, fontWeight:800, letterSpacing:'-0.02em', color:C.text }}>Demo Sheet</div>
            </div>
            {rooms.length>0 && (
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:10, color:C.muted }}>Rooms</div>
                <div style={{ fontSize:20, fontWeight:800, color:allComplete?C.green:C.accent }}>
                  {rooms.filter(isRoomComplete).length}<span style={{ fontSize:13, color:C.muted, fontWeight:400 }}>/{rooms.length}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Drafts banner */}
        {visibleDrafts.length>0 && !sheetId && (
          <div style={{ padding:'10px 13px 0' }}>
            <div style={{ background:C.accentDim, border:`1px solid ${C.accent}`, borderRadius:10, padding:'10px 12px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.accent, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>
                Resume draft
              </div>
              {visibleDrafts.slice(0, 2).map(d => (
                <button
                  key={d.id}
                  onClick={() => resumeDraft(d)}
                  style={{ display:'block', width:'100%', textAlign:'left', background:'transparent', border:'none', padding:'4px 0', cursor:'pointer', fontFamily:'var(--font-sans)' }}
                >
                  <div style={{ fontSize:13, color:C.text, fontWeight:600 }}>
                    {d.job_number || d.address || d.insured_name || 'Untitled draft'}
                  </div>
                  <div style={{ fontSize:11, color:C.muted }}>
                    Edited {new Date(d.updated_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding:'14px 13px 0' }}>
          {/* Job Info */}
          <div style={sCard}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontSize:9, color:C.accent, textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:800 }}>Job Info</div>
              {encircleLinked
                ? <button onClick={() => { setEncircleLinked(null); setEncircleRooms([]); }} style={{ fontSize:11, color:C.green, background:C.greenDim, border:`1px solid ${C.greenBd}`, borderRadius:20, padding:'4px 10px', cursor:'pointer', fontWeight:700, fontFamily:'var(--font-sans)' }}>⛓ Encircle linked ✕</button>
                : <button onClick={() => setShowEncircle(true)} style={{ fontSize:11, color:C.muted, background:C.cardAlt, border:`1px solid ${C.border}`, borderRadius:20, padding:'4px 10px', cursor:'pointer', fontWeight:600, fontFamily:'var(--font-sans)' }}>🔗 Link Encircle job</button>
              }
            </div>

            {encircleLinked && (
              <div style={{ background:C.greenDim, border:`1.5px solid ${C.greenBd}`, borderRadius:8, padding:'10px 12px', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:18 }}>✅</span>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:C.green }}>Encircle job linked</div>
                  <div style={{ fontSize:11, color:C.muted }}>{encircleLinked.policyholder_name || `Claim ${encircleLinked.id}`}</div>
                </div>
              </div>
            )}

            <label style={sLabel}>Date</label>
            <input type="date" value={jobInfo.date} onChange={e=>setJob('date',e.target.value)} style={{ ...sInput, marginBottom:12 }} />

            <label style={sLabel}>Technician</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:7, marginBottom:12 }}>
              {techs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setJobInfo(p => p.tech===t.id ? { ...p, tech:'', techName:'' } : { ...p, tech:t.id, techName:t.name })}
                  style={{ background:jobInfo.tech===t.id?C.accentDim:C.input, border:`1.5px solid ${jobInfo.tech===t.id?C.accent:C.border}`, borderRadius:8, color:jobInfo.tech===t.id?C.accent:C.muted, fontSize:13, fontWeight:jobInfo.tech===t.id?700:400, padding:'13px 4px', cursor:'pointer', fontFamily:'var(--font-sans)' }}
                >
                  {t.name?.split(' ')[0] || t.name}
                </button>
              ))}
            </div>

            <label style={sLabel}>Insured Name</label>
            <input value={jobInfo.insuredName} onChange={e=>setJob('insuredName',e.target.value)} placeholder="e.g. Chris and Michael Smith" style={{ ...sInput, marginBottom:12 }} />

            <label style={sLabel}>Job #</label>
            <div style={{ display:'flex', gap:7, marginBottom:12 }}>
              <input value={jobInfo.jobNumber} onChange={e=>setJob('jobNumber',e.target.value)} placeholder="e.g. UPR-0042" style={{ ...sInput, flex:1 }} />
              <button onClick={() => setShowEncircle(true)} title="Search Encircle jobs" style={{ background:encircleLinked?C.greenDim:C.cardAlt, border:`1.5px solid ${encircleLinked?C.green:C.border}`, borderRadius:8, color:encircleLinked?C.green:C.muted, fontSize:20, width:50, height:50, cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                🔗
              </button>
            </div>

            <label style={sLabel}>Job Address</label>
            <div style={{ marginBottom:16 }}>
              <AddressAutocomplete
                value={jobInfo.address}
                onChange={v => setJob('address', v)}
                onSelect={p => setJob('address', [p.address, p.city, p.state, p.zip].filter(Boolean).join(', '))}
                placeholder="Street address…"
                style={sInput}
              />
            </div>

            <div style={{ background:C.cardAlt, border:`1.5px solid ${hasSketchDone===null?C.redBd:hasSketchDone?C.greenBd:C.accent}`, borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, color:C.text, fontWeight:700, marginBottom:10, lineHeight:1.4 }}>Was an Encircle floor plan or DocuSketch sketch completed for this property?</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <button onClick={() => setHasSketchDone(false)} style={{ background:hasSketchDone===false?C.accentDim:C.input, border:`1.5px solid ${hasSketchDone===false?C.accent:C.border}`, borderRadius:8, color:hasSketchDone===false?C.accent:C.muted, fontSize:13, fontWeight:hasSketchDone===false?700:400, padding:13, cursor:'pointer', fontFamily:'var(--font-sans)' }}>✗ No — enter dimensions</button>
                <button onClick={() => setHasSketchDone(true)} style={{ background:hasSketchDone===true?C.greenDim:C.input, border:`1.5px solid ${hasSketchDone===true?C.green:C.border}`, borderRadius:8, color:hasSketchDone===true?C.green:C.muted, fontSize:13, fontWeight:hasSketchDone===true?700:400, padding:13, cursor:'pointer', fontFamily:'var(--font-sans)' }}>✓ Yes — skip dimensions</button>
              </div>
              {hasSketchDone===null && <div style={{ fontSize:10, color:C.red, marginTop:6, textAlign:'center' }}>Answer required to continue</div>}
            </div>
          </div>

          {hasSketchDone!==null && (
            <>
              {rooms.map((room, i) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  index={i}
                  onChange={u => updateRoom(room.id, u)}
                  onRemove={() => removeRoom(room.id)}
                  onDuplicate={() => duplicateRoom(room.id)}
                  totalRooms={rooms.length}
                  needsDimensions={needsDimensions}
                  encircleRooms={encircleRooms}
                  encircleRoomsLoading={encircleRoomsLoading}
                  schema={schema}
                />
              ))}
            </>
          )}
        </div>

        {/* Bottom bar — sits above the bottom nav */}
        <div style={{
          position:'fixed',
          bottom:'calc(var(--tech-nav-height, 64px) + env(safe-area-inset-bottom, 0px))',
          left:0, right:0,
          background:C.headerBg,
          borderTop:`1px solid ${C.border}`,
          padding:'11px 13px 11px',
          zIndex:30,
        }}>
          <div style={{ display:'flex', gap:9, marginBottom:8 }}>
            <button onClick={addRoom} disabled={hasSketchDone===null}
              style={{ flex:1, background:C.card, border:`1.5px solid ${C.border}`, borderRadius:10, color:hasSketchDone===null?C.muted:C.text, fontSize:14, fontWeight:600, padding:14, cursor:hasSketchDone===null?'default':'pointer', opacity:hasSketchDone===null?0.4:1, fontFamily:'var(--font-sans)' }}>
              + Room
            </button>
            <button onClick={() => setShowReview(true)} disabled={hasSketchDone===null || sending}
              style={{ flex:3, background:hasSketchDone===null?C.cardAlt:allComplete?C.green:C.accent, border:'none', borderRadius:10, color:hasSketchDone===null?C.muted:'#fff', fontSize:15, fontWeight:800, padding:14, cursor:hasSketchDone===null?'default':'pointer', fontFamily:'var(--font-sans)', opacity:sending?0.6:1 }}>
              {allComplete?'✓ Review & Submit':'📋 Review & Submit'}
            </button>
          </div>
          <button onClick={handleSaveAndClose} disabled={sending}
            style={{ width:'100%', background:'transparent', border:`1.5px solid ${C.border}`, borderRadius:10, color:C.muted, fontSize:13, fontWeight:600, padding:'11px', cursor:sending?'default':'pointer', fontFamily:'var(--font-sans)', opacity:sending?0.6:1 }}>
            💾 Save Draft & Close
          </button>
        </div>

        {showReview && (
          <ReviewScreen rooms={rooms} jobInfo={jobInfo} hasSketchDone={hasSketchDone} onBack={() => setShowReview(false)} onSubmit={doSubmit} sending={sending} encircleLinked={encircleLinked} schema={schema} />
        )}
        {showResult && submitResult && (
          <ResultScreen
            result={submitResult}
            onBack={() => { setShowResult(false); setShowReview(true); }}
            onStartNew={startNew}
            onClose={() => navigate(-1)}
          />
        )}
        {showEncircle && (
          <EncircleSearchModal onSelect={handleEncircleSelect} onClose={() => setShowEncircle(false)} />
        )}
      </div>
    </div>
  );
}
