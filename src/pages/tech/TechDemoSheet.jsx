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


// ── Email HTML / Encircle note builders ──────────────────────────────────────
function buildEmailHTML(rooms, jobInfo, hasSketchDone) {
  const displayDate = jobInfo.date ? new Date(jobInfo.date+'T12:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }) : 'N/A';

  const mkCat = (label, color='#2563eb') => `
    <tr>
      <td colspan="3" style="padding:8px 10px 4px;background:${color}18;border-top:2px solid ${color};font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.08em;">
        ${label}
      </td>
    </tr>`;

  const mkRow = (label, val, unit) => {
    if (!val || val===0) return '';
    const display = typeof val==='number'?val.toLocaleString():val;
    return `<tr>
      <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${label}</td>
      <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;color:#111;">${display}</td>
      <td style="padding:5px 10px;color:#888;font-size:11px;white-space:nowrap;">${unit}</td>
    </tr>`;
  };

  const mkBoolRow = (label, show) => show?`<tr>
    <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${label}</td>
    <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;color:#111;">✓</td>
    <td style="padding:5px 10px;color:#888;font-size:11px;"></td>
  </tr>`:'';

  const roomsHTML = rooms.map((r,i) => {
    const dim = (r.lengthFt&&r.widthFt&&r.heightFt)?`${r.lengthFt}' × ${r.widthFt}' × ${r.heightFt}'`:'';

    const contentsRows = [
      mkCat('📦 Contents Move','#7C3AED'),
      mkRow('Hours',r.contentsMoveHrs,'hrs'),
      r.contentsMoveHrs>0?mkRow('Technicians',r.contentsTechs,'techs'):'',
    ].join('');
    const hasContents = r.contentsMoveHrs>0;

    const appRows = r.appliances===true&&r.appliancesList.length>0?[
      mkCat('🔌 Appliances — Disconnect & Move','#0891B2'),
      ...r.appliancesList.map(a=>`<tr><td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${a}</td><td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;">✓</td><td></td></tr>`),
    ].join(''):'';

    const fixtureRows = r.fixtures===true?[
      mkCat('🚿 Plumbing & Fixtures','#0369A1'),
      mkBoolRow('Toilet — Disconnect & Remove',r.toiletRemoved),
      mkRow('Registers — Remove',r.registers,'ea'),
      mkRow('Ceiling Fans — Remove',r.ceilingFans,'ea'),
      mkRow('Light Fixtures — Remove',r.lights,'ea'),
      mkRow('Outlet & Switch Covers — Remove',r.outletCoversCount,'ea'),
    ].join(''):'';

    const cabRows = r.cabinets===true?[
      mkCat('🍽️ Cabinetry & Countertops','#B45309'),
      ...r.cabinetsList.map(c=>mkRow(`${c.type} — Remove`, c.lf||0, 'LF')),
      r.countertopLF>0?mkRow(`Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:''} — Remove`,r.countertopLF,'LF'):'',
      r.countertopSF>0?mkRow(`Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:''} — Remove`,r.countertopSF,'SF'):'',
      r.backsplashLF>0?mkRow(`Backsplash${r.backsplashMaterial?` (${r.backsplashMaterial})`:''} — Remove`,r.backsplashLF,'LF'):'',
    ].join(''):'';

    const trimRows = [
      mkCat('📏 Carpentry & Trim','#2563eb'),
      mkRow('Baseboard — Remove & Reset',r.baseboardLF,'LF'),
      mkRow('Door Casing — Remove & Reset',r.casingLF,'LF'),
      mkRow('Quarter Round — Remove & Reset',r.quarterRoundLF,'LF'),
      ...(r.doors===true?r.doorsList.flatMap(d=>[
        d.detach>0?mkRow(`${d.type} Door — Detach & Reset`,d.detach,'ea'):'',
        d.tearOut>0?mkRow(`${d.type} Door — Tear Out`,d.tearOut,'ea'):'',
      ]):[]),
    ].join('');
    const hasTrim = r.baseboardLF>0||r.casingLF>0||r.quarterRoundLF>0||(r.doors===true&&r.doorsList.length>0);

    const floorRows = [
      mkCat('🪵 Flooring','#166534'),
      ...r.floors.filter(f=>f.sf>0).map(f=>mkRow(`${f.type==='Other'?(f.typeOther||'Other'):f.type||'—'} — Remove`,f.sf,'SF')),
      mkRow('Subfloor — Remove',r.subfloorSF,'SF'),
    ].join('');
    const hasFlooring = r.floors.some(f=>f.sf>0)||r.subfloorSF>0;

    const drywallRows = [
      mkCat('🧱 Drywall','#6B21A8'),
      ...(r.floodCuts===true?r.floodCutsList.map(c=>mkRow(`Flood Cut (${c.height})`,c.lf||0,c.height==='Full wall (SF)'?'SF':'LF')):[]),
      mkRow('Drywall Ceiling — Remove',r.drywallCeilingSF,'SF'),
      mkRow('Drywall Walls — Remove',r.drywallWallsSF,'SF'),
    ].join('');
    const hasDrywall = r.floodCuts===true||r.drywallCeilingSF>0||r.drywallWallsSF>0;

    const insulRows = r.insulation===true&&r.insulationSF>0?[
      mkCat('🌡️ Insulation','#0F766E'),
      mkRow(`${r.insulationTypes.join(', ')||'—'} — Remove`,r.insulationSF,'SF'),
    ].join(''):'';

    const eqRows = r.equipment===true&&r.equipmentList.length>0?[
      mkCat('💨 Drying Equipment','#1D4ED8'),
      ...r.equipmentList.map(e=>`<tr>
        <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${e.type}</td>
        <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;">${e.qty} ea × ${e.days} days</td>
        <td style="padding:5px 10px;color:#888;font-size:11px;"></td>
      </tr>`),
    ].join(''):'';

    const body = [
      hasContents?contentsRows:'',
      appRows,
      fixtureRows,
      cabRows,
      hasTrim?trimRows:'',
      hasFlooring?floorRows:'',
      hasDrywall?drywallRows:'',
      insulRows,
      eqRows,
    ].filter(Boolean).join('');

    if (!body) return '';

    return `
      <div style="margin-bottom:24px;">
        <div style="background:#2563eb;color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;">Room ${i+1}: ${r.name||'(Unnamed)'}</span>
          ${dim?`<span style="font-size:11px;opacity:0.85;">${dim}</span>`:''}
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-top:none;">
          <tbody>${body}</tbody>
        </table>
        ${r.notes?`<div style="padding:8px 12px;background:#fffbf0;border:1px solid #e8d5a0;border-top:none;border-radius:0 0 4px 4px;font-size:11px;color:#666;line-height:1.5;"><strong>⚠️ Notes:</strong> ${r.notes}</div>`:''}
      </div>`;
  }).join('');

  const t = rooms.reduce((a, r) => {
    const fcLF = r.floodCuts===true?r.floodCutsList.filter(c=>c.height!=='Full wall (SF)').reduce((s,c)=>s+(c.lf||0),0):0;
    const fcSF = r.floodCuts===true?r.floodCutsList.filter(c=>c.height==='Full wall (SF)').reduce((s,c)=>s+(c.lf||0),0):0;
    const cabLF = r.cabinets===true?r.cabinetsList.reduce((s,c)=>s+(c.lf||0),0):0;
    const floorSF = r.floors.reduce((s,f)=>s+(f.sf||0),0);
    const eqList = r.equipment===true?r.equipmentList:[];
    return {
      contentsMins:a.contentsMins+(r.contentsMoveHrs||0)*60,
      baseboardLF:a.baseboardLF+(r.baseboardLF||0),
      casingLF:a.casingLF+(r.casingLF||0),
      quarterRoundLF:a.quarterRoundLF+(r.quarterRoundLF||0),
      doorsDetach:a.doorsDetach+(r.doors===true?r.doorsList.reduce((s,d)=>s+(d.detach||0),0):0),
      doorsTearOut:a.doorsTearOut+(r.doors===true?r.doorsList.reduce((s,d)=>s+(d.tearOut||0),0):0),
      floorSF:a.floorSF+floorSF,
      subfloorSF:a.subfloorSF+(r.subfloorSF||0),
      fcLF:a.fcLF+fcLF, fcSF:a.fcSF+fcSF,
      drywallCeiling:a.drywallCeiling+(r.drywallCeilingSF||0),
      drywallWalls:a.drywallWalls+(r.drywallWallsSF||0),
      insulationSF:a.insulationSF+(r.insulation===true?(r.insulationSF||0):0),
      cabLF:a.cabLF+cabLF,
      countertopLF:a.countertopLF+(r.cabinets===true?(r.countertopLF||0):0),
      airMovers:a.airMovers+eqList.filter(e=>e.type==='Air Mover').reduce((s,e)=>s+(e.qty||0),0),
      dehus:a.dehus+eqList.filter(e=>e.type==='Dehumidifier').reduce((s,e)=>s+(e.qty||0),0),
      scrubbers:a.scrubbers+eqList.filter(e=>e.type==='Air Scrubber').reduce((s,e)=>s+(e.qty||0),0),
    };
  }, { contentsMins:0,baseboardLF:0,casingLF:0,quarterRoundLF:0,doorsDetach:0,doorsTearOut:0,floorSF:0,subfloorSF:0,fcLF:0,fcSF:0,drywallCeiling:0,drywallWalls:0,insulationSF:0,cabLF:0,countertopLF:0,airMovers:0,dehus:0,scrubbers:0 });

  const mkTotCat = (label, color) => `<tr><td colspan="3" style="padding:7px 10px 3px;background:${color}18;border-top:2px solid ${color};font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.08em;">${label}</td></tr>`;
  const mkTotRow = (label, val, unit) => val>0?`<tr><td style="padding:4px 10px 4px 18px;color:#444;font-size:12px;">${label}</td><td style="padding:4px 10px;text-align:right;font-weight:700;font-size:12px;">${typeof val==='number'?val.toLocaleString():val}</td><td style="padding:4px 10px;color:#888;font-size:11px;">${unit}</td></tr>`:'';

  const hrsTotal = t.contentsMins/60;
  const totalsHTML = [
    t.contentsMins>0?mkTotCat('📦 Contents Move','#7C3AED'):'',
    t.contentsMins>0?mkTotRow('Total Hours',hrsTotal%1===0?hrsTotal:hrsTotal.toFixed(1),'hrs'):'',
    (t.baseboardLF||t.casingLF||t.quarterRoundLF||t.doorsDetach||t.doorsTearOut)?mkTotCat('📏 Carpentry & Trim','#2563eb'):'',
    mkTotRow('Baseboard',t.baseboardLF,'LF'),
    mkTotRow('Door Casing',t.casingLF,'LF'),
    mkTotRow('Quarter Round',t.quarterRoundLF,'LF'),
    mkTotRow('Doors — Detach',t.doorsDetach,'ea'),
    mkTotRow('Doors — Tear Out',t.doorsTearOut,'ea'),
    (t.floorSF||t.subfloorSF)?mkTotCat('🪵 Flooring','#166534'):'',
    mkTotRow('Floor Covering',t.floorSF,'SF'),
    mkTotRow('Subfloor',t.subfloorSF,'SF'),
    (t.fcLF||t.fcSF||t.drywallCeiling||t.drywallWalls)?mkTotCat('🧱 Drywall','#6B21A8'):'',
    mkTotRow('Flood Cuts',t.fcLF,'LF'),
    mkTotRow('Flood Cuts (full wall)',t.fcSF,'SF'),
    mkTotRow('Drywall — Ceiling',t.drywallCeiling,'SF'),
    mkTotRow('Drywall — Walls',t.drywallWalls,'SF'),
    (t.drywallCeiling+t.drywallWalls)>0?mkTotRow('Drywall — TOTAL',t.drywallCeiling+t.drywallWalls,'SF'):'',
    t.insulationSF?mkTotCat('🌡️ Insulation','#0F766E'):'',
    mkTotRow('Insulation Removed',t.insulationSF,'SF'),
    (t.cabLF||t.countertopLF)?mkTotCat('🍽️ Cabinetry','#B45309'):'',
    mkTotRow('Cabinets',t.cabLF,'LF'),
    mkTotRow('Countertops',t.countertopLF,'LF'),
    (t.airMovers||t.dehus||t.scrubbers)?mkTotCat('💨 Drying Equipment','#1D4ED8'):'',
    mkTotRow('Air Movers',t.airMovers,'ea'),
    mkTotRow('Dehumidifiers',t.dehus,'ea'),
    mkTotRow('Air Scrubbers',t.scrubbers,'ea'),
  ].filter(Boolean).join('');

  return `<div style="font-family:system-ui,sans-serif;max-width:660px;margin:0 auto;padding:20px;">
    <div style="border-bottom:3px solid #2563eb;padding-bottom:14px;margin-bottom:20px;">
      <div style="font-size:20px;font-weight:800;color:#2563eb;">UTAH PROS RESTORATION</div>
      <div style="font-size:11px;font-weight:700;color:#444;letter-spacing:0.05em;margin-top:2px;">DEMOLITION SHEET</div>
      <div style="font-size:11px;color:#888;margin-top:4px;">Floor plan: ${hasSketchDone?'Encircle / DocuSketch ✓':'No sketch — dimensions recorded per room'}</div>
      <table style="width:100%;margin-top:10px;font-size:12px;">
        <tr><td style="color:#888;width:80px;">Date</td><td style="font-weight:600;">${displayDate}</td><td style="color:#888;width:90px;">Technician</td><td style="font-weight:600;">${jobInfo.techName||'—'}</td></tr>
        <tr><td style="color:#888;">Job #</td><td style="font-weight:600;">${jobInfo.jobNumber||'—'}</td><td style="color:#888;">Address</td><td style="font-weight:600;">${jobInfo.address||'—'}</td></tr>
        <tr><td style="color:#888;">Insured</td><td style="font-weight:600;" colspan="3">${jobInfo.insuredName||'—'}</td></tr>
      </table>
    </div>
    ${roomsHTML}

    <div style="margin-top:8px;border:2px solid #2563eb;border-radius:6px;overflow:hidden;">
      <div style="background:#2563eb;color:#fff;padding:8px 12px;">
        <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;">∑ Job Totals — All Rooms</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${totalsHTML}</tbody>
      </table>
    </div>
  </div>`;
}

function buildNoteText(rooms, jobInfo, hasSketchDone) {
  const line = (label, val, unit) => val>0?`  ${label}: ${typeof val==='number'?val.toLocaleString():val}${unit?' '+unit:''}\n`:'';
  const bool = (label, show) => show?`  ${label}: Yes\n`:'';
  const displayDate = jobInfo.date?new Date(jobInfo.date+'T12:00:00').toLocaleDateString('en-US',{ month:'long',day:'numeric',year:'numeric' }):'N/A';
  let out = '';
  out += `UTAH PROS RESTORATION — DEMOLITION SHEET\n`;
  out += `${'='.repeat(44)}\n`;
  out += `Date: ${displayDate}\n`;
  out += `Technician: ${jobInfo.techName||'—'}\n`;
  out += `Job #: ${jobInfo.jobNumber||'—'}\n`;
  out += `Address: ${jobInfo.address||'—'}\n`;
  out += `Floor Plan: ${hasSketchDone?'Encircle / DocuSketch':'No sketch — dimensions per room'}\n\n`;
  rooms.forEach((r,i) => {
    const dim = (r.lengthFt&&r.widthFt&&r.heightFt)?` (${r.lengthFt}x${r.widthFt}x${r.heightFt}ft)`:'';
    out += `ROOM ${i+1}: ${(r.name||'Unnamed').toUpperCase()}${dim}\n${'-'.repeat(32)}\n`;
    if (r.contentsMoveHrs>0) { out+=`Contents Move:\n`; out+=line('  Hours',r.contentsMoveHrs,'hrs'); out+=line('  Techs',r.contentsTechs,'techs'); }
    if (r.appliances===true&&r.appliancesList.length>0) { out+=`Appliances:\n`; r.appliancesList.forEach(a=>{out+=`  ${a}\n`;}); }
    if (r.fixtures===true) {
      const hasF = r.toiletRemoved||r.registers>0||r.ceilingFans>0||r.lights>0||r.outletCoversCount>0;
      if (hasF) { out+=`Plumbing & Fixtures:\n`; out+=bool('  Toilet — Remove',r.toiletRemoved); out+=line('  Registers',r.registers,'ea'); out+=line('  Ceiling Fans',r.ceilingFans,'ea'); out+=line('  Light Fixtures',r.lights,'ea'); out+=line('  Outlet Covers',r.outletCoversCount,'ea'); }
    }
    if (r.cabinets===true) {
      if (r.cabinetsList.length>0||r.countertopLF>0||r.countertopSF>0||r.backsplashLF>0) {
        out+=`Cabinetry & Countertops:\n`;
        r.cabinetsList.forEach(c=>{ if(c.lf>0)out+=`  ${c.type}: ${c.lf} LF\n`; });
        if (r.countertopLF>0) out+=`  Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:''}: ${r.countertopLF} LF\n`;
        if (r.countertopSF>0) out+=`  Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:''}: ${r.countertopSF} SF\n`;
        if (r.backsplashLF>0) out+=`  Backsplash${r.backsplashMaterial?` (${r.backsplashMaterial})`:''}: ${r.backsplashLF} LF\n`;
      }
    }
    const hasTrim = r.baseboardLF>0||r.casingLF>0||r.quarterRoundLF>0||(r.doors===true&&r.doorsList.length>0);
    if (hasTrim) {
      out += `Carpentry & Trim:\n`;
      out += line('  Baseboard',r.baseboardLF,'LF'); out += line('  Door Casing',r.casingLF,'LF'); out += line('  Quarter Round',r.quarterRoundLF,'LF');
      if (r.doors===true) r.doorsList.forEach(d=>{ if(d.detach>0)out+=`  ${d.type} Door — Detach: ${d.detach} ea\n`; if(d.tearOut>0)out+=`  ${d.type} Door — Tear Out: ${d.tearOut} ea\n`; });
    }
    const hasFloor = r.floors.some(f=>f.sf>0)||r.subfloorSF>0;
    if (hasFloor) {
      out += `Flooring:\n`;
      r.floors.filter(f=>f.sf>0).forEach(f=>{ const ft=f.type==='Other'?(f.typeOther||'Other'):f.type||'—'; out+=`  ${ft}: ${f.sf} SF\n`; });
      out += line('  Subfloor',r.subfloorSF,'SF');
    }
    const hasDW = r.floodCuts===true||r.drywallCeilingSF>0||r.drywallWallsSF>0;
    if (hasDW) {
      out += `Drywall:\n`;
      if (r.floodCuts===true) r.floodCutsList.forEach(c=>{ const u=c.height==='Full wall (SF)'?'SF':'LF'; out+=`  Flood Cut (${c.height}): ${c.lf||0} ${u}\n`; });
      out += line('  Ceiling',r.drywallCeilingSF,'SF'); out += line('  Walls',r.drywallWallsSF,'SF');
      if (r.drywallCeilingSF>0||r.drywallWallsSF>0) out+=`  Total: ${(r.drywallCeilingSF||0)+(r.drywallWallsSF||0)} SF\n`;
    }
    if (r.insulation===true&&r.insulationSF>0) out += `Insulation:\n  ${r.insulationTypes.join(', ')||'—'}: ${r.insulationSF} SF\n`;
    if (r.equipment===true&&r.equipmentList.length>0) { out+=`Drying Equipment:\n`; r.equipmentList.forEach(e=>{ out+=`  ${e.type}: ${e.qty} ea x ${e.days} days\n`; }); }
    if (r.notes) out += `Notes: ${r.notes}\n`;
    out += '\n';
  });
  return out.trim();
}

// Roll up rooms into the totals shape the demo_sheets VIEW exposes via summary
function computeSummary(rooms) {
  return rooms.reduce((a, r) => {
    const fcLF    = r.floodCuts===true ? r.floodCutsList.filter(c=>c.height!=='Full wall (SF)').reduce((s,c)=>s+(c.lf||0),0) : 0;
    const fcSF    = r.floodCuts===true ? r.floodCutsList.filter(c=>c.height==='Full wall (SF)').reduce((s,c)=>s+(c.lf||0),0) : 0;
    const cabLF   = r.cabinets===true  ? r.cabinetsList.reduce((s,c)=>s+(c.lf||0),0) : 0;
    const floorSF = r.floors.reduce((s,f)=>s+(f.sf||0),0);
    const eqList  = r.equipment===true ? r.equipmentList : [];
    return {
      baseboardLF:    a.baseboardLF    + (r.baseboardLF || 0),
      casingLF:       a.casingLF       + (r.casingLF || 0),
      quarterRoundLF: a.quarterRoundLF + (r.quarterRoundLF || 0),
      floorSF:        a.floorSF        + floorSF,
      subfloorSF:     a.subfloorSF     + (r.subfloorSF || 0),
      drywallSF:      a.drywallSF      + (r.drywallCeilingSF || 0) + (r.drywallWallsSF || 0),
      floodCutsLF:    a.floodCutsLF    + fcLF,
      floodCutsSF:    a.floodCutsSF    + fcSF,
      insulationSF:   a.insulationSF   + (r.insulation===true ? (r.insulationSF || 0) : 0),
      cabinetsLF:     a.cabinetsLF     + cabLF,
      countertopLF:   a.countertopLF   + (r.cabinets===true ? (r.countertopLF || 0) : 0),
      contentsHrs:    a.contentsHrs    + (r.contentsMoveHrs || 0),
      airMovers:      a.airMovers      + eqList.filter(e=>e.type==='Air Mover').reduce((s,e)=>s+(e.qty||0), 0),
      dehumidifiers:  a.dehumidifiers  + eqList.filter(e=>e.type==='Dehumidifier').reduce((s,e)=>s+(e.qty||0), 0),
      airScrubbers:   a.airScrubbers   + eqList.filter(e=>e.type==='Air Scrubber').reduce((s,e)=>s+(e.qty||0), 0),
    };
  }, {
    baseboardLF:0, casingLF:0, quarterRoundLF:0, floorSF:0, subfloorSF:0,
    drywallSF:0, floodCutsLF:0, floodCutsSF:0, insulationSF:0, cabinetsLF:0,
    countertopLF:0, contentsHrs:0, airMovers:0, dehumidifiers:0, airScrubbers:0,
  });
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
            setSheetId(row.id);
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
      try {
        const payload = {
          p_id: sheetId,
          p_data: { rooms, jobInfo, encircleLinked, encircleRooms, hasSketchDone },
          p_job_date: jobInfo.date || null,
          p_tech_id:  jobInfo.tech || null,
          p_job_number: jobInfo.jobNumber || null,
          p_address:    jobInfo.address || null,
          p_insured_name: jobInfo.insuredName || null,
          p_encircle_claim_id: encircleLinked?.id ? String(encircleLinked.id) : null,
          p_status: 'draft',
          p_job_id: jobId || null,
          p_summary: computeSummary(rooms),
          p_schema_id: schema?._id || null,
        };
        const newId = await db.rpc('save_demo_sheet', payload);
        if (!sheetId && newId) {
          setSheetId(newId);
          const next = new URLSearchParams(searchParams);
          next.set('id', newId);
          // Strip prefill params now that we have a draft id
          next.delete('jobNumber'); next.delete('address'); next.delete('insuredName'); next.delete('claimId'); next.delete('jobId');
          setSearchParams(next, { replace: true });
        }
      } catch {
        /* autosave is best-effort; surface only on submit */
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
    const newId = await db.rpc('save_demo_sheet', {
      p_id: sheetId,
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
      p_summary: computeSummary(rooms),
      p_email_sent: emailOk,
      p_schema_id: schema?._id || null,
    });
    if (!sheetId && newId) setSheetId(newId);
    return newId || sheetId;
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
    const html = buildEmailHTML(rooms, jobInfo, hasSketchDone);
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

    // ── 2. Best-effort email + Encircle (don't block submit success) ──
    let emailOk = false;
    let emailErr = null;
    let encircleOk = false;
    let encircleNoteId = null;
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
              text: buildNoteText(rooms, jobInfo, hasSketchDone),
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

      await Promise.all(tasks);

      // Update email_sent + encircle_note_id flags on the saved row (best effort).
      if (emailOk || encircleNoteId) {
        try {
          await flushSave({ status: 'submitted', emailOk, encircleNoteId });
        } catch { /* ignore — flags only */ }
      }
    }

    setSending(false);
    setSubmitResult({ saveOk, saveErr, emailOk, emailErr, encircleOk, encircleSkipped });
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
    setSheetId(null);
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
