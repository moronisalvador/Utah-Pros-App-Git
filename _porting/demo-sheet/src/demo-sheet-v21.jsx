import { useState, useRef, useEffect, useCallback } from "react";

// ── API Keys ──────────────────────────────────────────────────────────────────
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// ── Constants ─────────────────────────────────────────────────────────────────
const TECHS = ["Matheus", "Nano", "Juani", "Ben", "Moroni", "Marcelo"];
const ROOM_PRESETS = ["Living Room","Kitchen","Master Bedroom","Bedroom","Bathroom","Master Bath","Hallway","Laundry","Garage","Basement","Office","Dining Room"];
const FLOOR_TYPES = ["Carpet","Pad","Hardwood","Laminate / Pergo","LVP / LVT","Vinyl Sheet","Vinyl Tile","Ceramic / Porcelain Tile","Concrete","Other"];
const INSULATION_TYPES = ["Batt (Fiberglass)","Blown-in / Loose Fill","Rigid Foam Board","Spray Foam"];
const FLOOD_CUT_HEIGHTS = ["4 inches","2 ft","4 ft","Full wall (SF)"];
const DOOR_TYPES = ["Interior","Exterior","Bi-fold"];
const APPLIANCE_LIST = ["Refrigerator","Stove (Gas)","Stove (Electric)","Dishwasher","Washer","Dryer","Sink","Microwave","Other"];
const EQUIP_TYPES = ["Air Mover","Dehumidifier","Air Scrubber","Other"];
const COUNTERTOP_MATERIALS = ["Formica","Tile","Marble","Granite","Quartz","Other"];
const CABINET_TYPES = ["Base Cabinets","Upper Cabinets","Full Height","Vanity"];

const SECTIONS = [
  { key:"trim",       label:"Baseboard & Trim",         icon:"📏", alwaysOn:true  },
  { key:"flooring",   label:"Flooring",                 icon:"🪵", alwaysOn:true  },
  { key:"floodCuts",  label:"Flood Cuts?",              icon:"✂️",  alwaysOn:false },
  { key:"drywall",    label:"Drywall",                  icon:"🧱", alwaysOn:true  },
  { key:"insulation", label:"Insulation Removed?",      icon:"🌡️", alwaysOn:false },
  { key:"cabinets",   label:"Cabinets / Countertops?",  icon:"🍽️", alwaysOn:false },
  { key:"doors",      label:"Doors Removed?",           icon:"🚪", alwaysOn:false },
  { key:"fixtures",   label:"Fixtures / Electrical?",   icon:"🚿", alwaysOn:false },
  { key:"appliances", label:"Appliances Moved?",        icon:"🔌", alwaysOn:false },
  { key:"equipment",  label:"Equipment Left in Room?",  icon:"💨", alwaysOn:false },
  { key:"contents",   label:"Contents Move",            icon:"📦", alwaysOn:true  },
  { key:"notes",      label:"Notes",                    icon:"📝", alwaysOn:true  },
];

const today = () => new Date().toISOString().split("T")[0];
const newId = () => Date.now() + Math.random();
const defaultFloor = () => ({ id:newId(), type:"", typeOther:"", sf:0 });
const defaultRoom = () => ({
  id:newId(), name:"",
  lengthFt:"", widthFt:"", heightFt:"",
  trimDone:false, baseboardLF:0, casingLF:0, quarterRoundLF:0,
  flooringDone:false, floors:[defaultFloor()], subfloorSF:0,
  drywallDone:false, drywallCeilingSF:0, drywallWallsSF:0,
  contentsDone:false, contentsMoveHrs:0, contentsTechs:1,
  notesDone:false, notes:"",
  floodCuts:null, floodCutsList:[],
  insulation:null, insulationTypes:[], insulationSF:0,
  cabinets:null, cabinetsList:[], countertopSF:0, countertopLF:0, countertopMaterial:"", backsplashLF:0, backsplashMaterial:"",
  doors:null, doorsList:[],
  fixtures:null, outletCoversCount:0, ceilingFans:0, registers:0, lights:0, toiletRemoved:false,
  appliances:null, appliancesList:[], applianceOther:"",
  equipment:null, equipmentList:[],
  openSection:"trim",
});

const THEMES = {
  light: {
    bg:"#f0f2f5", card:"#ffffff", cardAlt:"#f7f8fa",
    border:"#dde2ea", text:"#1a2030", muted:"#7a8a9a",
    accent:"#e07b20", accentDim:"#e07b2015",
    green:"#1a7a34", greenDim:"#1a7a3415",
    red:"#c0392b", redDim:"#c0392b15",
    input:"#ffffff", headerBg:"#ffffff",
  },
  dark: {
    bg:"#0b0f14", card:"#141920", cardAlt:"#1a2030",
    border:"#252d3a", text:"#dde4f0", muted:"#5a6a80",
    accent:"#e07b20", accentDim:"#e07b2015",
    green:"#2ea043", greenDim:"#2ea04315",
    red:"#e74c3c", redDim:"#e74c3c15",
    input:"#0b0f14", headerBg:"#080c10",
  },
};
// C is set dynamically in the main component — components receive it as a prop
// These fallbacks are used by components that reference C at module level
let C = THEMES.light;
const sLabel = { fontSize:10, color:"#7a8a9a", textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700, marginBottom:5, display:"block" };
const mkInput = (C) => ({ background:C.input, border:`1.5px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:16, padding:"12px 13px", width:"100%", outline:"none", WebkitAppearance:"none", boxSizing:"border-box" });
const mkCard  = (C) => ({ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 14px", marginBottom:12 });
// Keep sInput/sCard as getters for backward compat within render — override per component
let sInput = mkInput(C);
let sCard  = mkCard(C);

// ── Google Maps loader ────────────────────────────────────────────────────────
let gmapsLoaded = false;
let gmapsCallbacks = [];
function loadGoogleMaps(cb) {
  if (window.google?.maps?.places) { cb(); return; }
  gmapsCallbacks.push(cb);
  if (gmapsLoaded) return;
  gmapsLoaded = true;
  window.__gmapsReady = () => { gmapsCallbacks.forEach(f=>f()); gmapsCallbacks=[]; };
  const s = document.createElement("script");
  s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places&v=beta&callback=__gmapsReady&loading=async`;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

// ── Address Autocomplete — custom dropdown using AutocompleteSuggestion API ───
function AddressAutocomplete({ value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [mapsReady, setMapsReady] = useState(false);
  const debounceRef = useRef();
  const sessionTokenRef = useRef(null);

  useEffect(() => {
    loadGoogleMaps(() => setMapsReady(true));
  }, []);

  const fetchSuggestions = useCallback(async (input) => {
    if (!input || input.length < 3 || !mapsReady) { setSuggestions([]); return; }
    try {
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
      }
      const { suggestions: raw } = await window.google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        includedRegionCodes: ["us"],
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      });
      setSuggestions(raw?.map(s => s.placePrediction) || []);
      setOpen(true);
    } catch {
      // Fallback: clear suggestions silently
      setSuggestions([]);
    }
  }, [mapsReady]);

  const handleInput = (val) => {
    onChange(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 250);
  };

  const handleSelect = async (prediction) => {
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress"] });
      onChange(place.formattedAddress || prediction.text?.text || "");
      sessionTokenRef.current = null; // reset token after selection
    } catch {
      onChange(prediction.text?.text || "");
    }
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div style={{ flex:1, minWidth:0, position:"relative" }}>
      <input
        value={value}
        onChange={e => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="Street address…"
        style={{ ...sInput }}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:C.card, border:`1.5px solid ${C.accent}`, borderRadius:8, zIndex:100, overflow:"hidden", boxShadow:"0 8px 24px #00000066" }}>
          {suggestions.map((s, i) => (
            <button key={i} onMouseDown={() => handleSelect(s)}
              style={{ width:"100%", background:"transparent", border:"none", borderBottom:i<suggestions.length-1?`1px solid ${C.border}`:"none", padding:"11px 13px", cursor:"pointer", textAlign:"left", color:C.text, fontSize:13, display:"block" }}>
              <span style={{ color:C.accent, marginRight:6 }}>📍</span>
              {s.text?.text || ""}
            </button>
          ))}
          <div style={{ padding:"4px 10px 6px", textAlign:"right" }}>
            <img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-non-white.png" alt="Powered by Google" style={{ height:14, opacity:0.5 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Encircle Job Search Modal ─────────────────────────────────────────────────
function EncircleSearchModal({ onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState("policyholder_name");
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
      const res = await fetch(`/.netlify/functions/encircle-search?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.list || []);
      setSearched(true);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [searchType]);

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 500);
  };

  const searchTypes = [
    { key: "policyholder_name", label: "Name" },
    { key: "contractor_identifier", label: "Job #" },
    { key: "assignment_identifier", label: "Assignment #" },
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", flexDirection:"column", background:C.bg }}>
      {/* Header */}
      <div style={{ background:C.headerBg, borderBottom:`1px solid ${C.border}`, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
        <button onClick={onClose} style={{ background:"transparent", border:`1.5px solid ${C.border}`, borderRadius:8, color:C.muted, padding:"8px 14px", fontSize:13, cursor:"pointer" }}>← Back</button>
        <div>
          <div style={{ fontSize:9, color:C.accent, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.14em" }}>Encircle</div>
          <div style={{ fontSize:15, fontWeight:800 }}>Find Job</div>
        </div>
      </div>

      <div style={{ padding:"14px 13px", flexShrink:0 }}>
        {/* Search type tabs */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:10 }}>
          {searchTypes.map(t => (
            <button key={t.key} onClick={() => { setSearchType(t.key); setResults([]); setSearched(false); setQuery(""); }}
              style={{ background:searchType===t.key?C.accentDim:C.card, border:`1.5px solid ${searchType===t.key?C.accent:C.border}`, borderRadius:8, color:searchType===t.key?C.accent:C.muted, fontSize:12, fontWeight:searchType===t.key?700:400, padding:"10px 4px", cursor:"pointer" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div style={{ position:"relative" }}>
          <input
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder={searchType==="policyholder_name" ? "e.g. Chris Smith…" : searchType==="contractor_identifier" ? "e.g. UPR-0042…" : "Assignment #…"}
            style={{ ...sInput, paddingRight:44 }}
            autoFocus
          />
          <div style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:C.muted, fontSize:18, pointerEvents:"none" }}>
            {loading ? "⏳" : "🔍"}
          </div>
        </div>

        {error && <div style={{ marginTop:8, fontSize:12, color:C.red, textAlign:"center" }}>{error}</div>}
      </div>

      {/* Results */}
      <div style={{ flex:1, overflowY:"auto", padding:"0 13px 20px" }}>
        {searched && results.length === 0 && !loading && (
          <div style={{ textAlign:"center", color:C.muted, fontSize:13, paddingTop:40 }}>No jobs found</div>
        )}
        {results.map(claim => (
          <button key={claim.id} onClick={() => onSelect(claim)}
            style={{ width:"100%", background:C.card, border:`1.5px solid ${C.border}`, borderRadius:10, padding:"14px", marginBottom:8, cursor:"pointer", textAlign:"left", display:"block" }}>
            <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:4 }}>
              {claim.policyholder_name || "—"}
            </div>
            <div style={{ fontSize:12, color:C.accent, marginBottom:4 }}>
              {claim.full_address || "No address"}
            </div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
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
          <div style={{ textAlign:"center", paddingTop:40 }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
            <div style={{ fontSize:13, color:C.muted }}>Search by policyholder name,{"\n"}job number, or assignment #</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────
function Stepper({ value, onChange, step=1, unit, small }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const ref = useRef();
  const sz = small ? 42 : 50;
  const start = () => { setRaw(value===0?"":String(value)); setEditing(true); setTimeout(()=>ref.current?.select(),40); };
  const finish = () => { const p=parseFloat(raw); onChange(isNaN(p)||p<0?0:p); setEditing(false); };
  return (
    <div style={{display:"flex",alignItems:"center",borderRadius:8,overflow:"hidden",border:`1.5px solid ${C.border}`,background:C.input}}>
      <button onClick={()=>onChange(Math.max(0,value-step))} style={{width:sz,height:sz,background:"transparent",border:"none",color:C.muted,fontSize:small?20:22,cursor:"pointer",flexShrink:0}}>−</button>
      <div style={{flex:1,textAlign:"center"}}>
        {editing
          ? <input ref={ref} type="number" inputMode="decimal" value={raw} onChange={e=>setRaw(e.target.value)} onBlur={finish} onKeyDown={e=>e.key==="Enter"&&finish()} style={{background:"transparent",border:"none",color:C.text,fontSize:small?15:17,fontWeight:700,width:"100%",textAlign:"center",outline:"none",padding:"0 4px"}} autoFocus />
          : <div onClick={start} style={{fontSize:small?15:17,fontWeight:700,color:value>0?C.text:C.muted,padding:`${small?10:13}px 0`,cursor:"pointer",userSelect:"none"}}>
              {value>0?value.toLocaleString():"0"}{unit&&<span style={{fontSize:10,color:C.muted,fontWeight:400,marginLeft:3}}>{unit}</span>}
            </div>}
      </div>
      <button onClick={()=>onChange(value+step)} style={{width:sz,height:sz,background:"transparent",border:"none",color:C.accent,fontSize:small?20:22,cursor:"pointer",flexShrink:0}}>+</button>
    </div>
  );
}

function Chip({ label, selected, onToggle }) {
  return (
    <button onClick={onToggle} style={{background:selected?C.accentDim:C.input,border:`1.5px solid ${selected?C.accent:C.border}`,borderRadius:8,color:selected?C.accent:C.muted,fontSize:12,fontWeight:selected?700:400,padding:"10px 6px",cursor:"pointer",textAlign:"center",transition:"all 0.1s"}}>
      {label}
    </button>
  );
}
function MultiChips({ options, selected, onChange }) {
  const toggle = o => onChange(selected.includes(o)?selected.filter(x=>x!==o):[...selected,o]);
  return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>{options.map(o=><Chip key={o} label={o} selected={selected.includes(o)} onToggle={()=>toggle(o)} />)}</div>;
}
function SingleChips({ options, value, onChange, cols=2 }) {
  return <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:6}}>{options.map(o=><Chip key={o} label={o} selected={value===o} onToggle={()=>onChange(value===o?"":o)} />)}</div>;
}
function CheckRow({ label, checked, onChange }) {
  return (
    <button onClick={()=>onChange(!checked)} style={{display:"flex",alignItems:"center",gap:10,background:checked?C.accentDim:C.input,border:`1.5px solid ${checked?C.accent:C.border}`,borderRadius:8,padding:"12px 13px",cursor:"pointer",width:"100%",marginBottom:6}}>
      <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${checked?C.accent:C.border}`,background:checked?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {checked&&<span style={{color:"#000",fontSize:12,fontWeight:800}}>✓</span>}
      </div>
      <span style={{fontSize:14,color:checked?C.accent:C.muted,fontWeight:checked?700:400}}>{label}</span>
    </button>
  );
}
function AddBtn({ label, onClick }) {
  return <button onClick={onClick} style={{width:"100%",background:"transparent",border:`1.5px dashed ${C.border}`,borderRadius:8,color:C.muted,padding:"10px",fontSize:13,cursor:"pointer",marginTop:4}}>+ {label}</button>;
}
function NextBtn({ onClick, label="Done → Next" }) {
  return <button onClick={onClick} style={{width:"100%",marginTop:14,background:C.accent,border:"none",borderRadius:8,color:"#000",fontSize:14,fontWeight:800,padding:"13px",cursor:"pointer"}}>{label} →</button>;
}
function YesNo({ onNo, onYes }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,paddingTop:12}}>
      <button onClick={onNo} style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:15,fontWeight:600,padding:"14px",cursor:"pointer"}}>✗ No</button>
      <button onClick={onYes} style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:15,fontWeight:600,padding:"14px",cursor:"pointer"}}>✓ Yes</button>
    </div>
  );
}
function ChangeBtn({ onClick }) {
  return <button onClick={onClick} style={{fontSize:11,color:C.muted,background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",marginBottom:10}}>↩ Change answer</button>;
}

function Section({ icon, label, status, open, onToggle, locked, children }) {
  let borderColor=C.border, headerBg=C.card;
  if (status==="done-yes") { borderColor=C.green+"55"; headerBg=C.greenDim; }
  if (open)                { borderColor=C.accent;     headerBg=C.accentDim; }
  return (
    <div style={{border:`1.5px solid ${borderColor}`,borderRadius:10,marginBottom:8,overflow:"hidden",opacity:locked?0.38:1,transition:"opacity 0.2s,border-color 0.2s"}}>
      <button onClick={()=>!locked&&onToggle()} disabled={locked} style={{width:"100%",display:"flex",alignItems:"center",gap:10,background:headerBg,border:"none",padding:"13px 14px",cursor:locked?"default":"pointer",textAlign:"left"}}>
        <span style={{fontSize:16}}>{icon}</span>
        <span style={{flex:1,fontSize:13,fontWeight:700,color:locked?C.muted:C.text}}>{label}</span>
        {status==="done-no"  && <span style={{fontSize:11,color:C.muted,fontWeight:700,background:C.cardAlt,padding:"3px 8px",borderRadius:20}}>N/A</span>}
        {status==="done-yes" && <span style={{fontSize:11,color:C.green,fontWeight:700,background:C.greenDim,padding:"3px 8px",borderRadius:20}}>✓ Done</span>}
        {!locked && <span style={{fontSize:11,color:open?C.accent:C.muted,marginLeft:4}}>{open?"▲":"▼"}</span>}
      </button>
      {open && <div style={{padding:"0 14px 14px",background:C.card}}>{children}</div>}
    </div>
  );
}

function RoomProgress({ answeredCount, total }) {
  const pct = Math.round((answeredCount/total)*100);
  const color = pct===100?C.green:pct>50?C.accent:C.muted;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
      <div style={{flex:1,height:3,background:C.border,borderRadius:2,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2,transition:"width 0.3s"}} />
      </div>
      <span style={{fontSize:10,color,fontWeight:700,flexShrink:0,minWidth:32}}>{pct}%</span>
    </div>
  );
}

// ── Sub-item editors ──────────────────────────────────────────────────────────
function FloorEntry({ floor, onChange, onRemove, showRemove }) {
  return (
    <div style={{background:C.cardAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Floor Type</span>
        {showRemove&&<button onClick={onRemove} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>}
      </div>
      <SingleChips options={FLOOR_TYPES} value={floor.type} onChange={v=>onChange({...floor,type:v})} />
      {floor.type==="Other"&&<div style={{marginTop:8}}><input value={floor.typeOther} onChange={e=>onChange({...floor,typeOther:e.target.value})} placeholder="Describe…" style={sInput} /></div>}
      <div style={{height:10}}/>
      <label style={sLabel}>Square Feet (SF)</label>
      <Stepper value={floor.sf} onChange={v=>onChange({...floor,sf:v})} step={10} unit="SF" />
    </div>
  );
}
function FloodCutEntry({ cut, onChange, onRemove }) {
  return (
    <div style={{background:C.cardAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Flood Cut</span>
        <button onClick={onRemove} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>
      </div>
      <label style={sLabel}>Height</label>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
        {FLOOD_CUT_HEIGHTS.map(h=><Chip key={h} label={h} selected={cut.height===h} onToggle={()=>onChange({...cut,height:h})} />)}
      </div>
      <label style={sLabel}>{cut.height==="Full wall (SF)"?"SF":"LF"}</label>
      <Stepper value={cut.lf||0} onChange={v=>onChange({...cut,lf:v})} step={1} unit={cut.height==="Full wall (SF)"?"SF":"LF"} small />
    </div>
  );
}
function DoorEntry({ door, onChange, onRemove }) {
  return (
    <div style={{background:C.cardAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Door</span>
        <button onClick={onRemove} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:8}}>
        {DOOR_TYPES.map(t=><Chip key={t} label={t} selected={door.type===t} onToggle={()=>onChange({...door,type:t})} />)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><label style={sLabel}>Detach Only</label><Stepper value={door.detach||0} onChange={v=>onChange({...door,detach:v})} step={1} unit="ea" small /></div>
        <div><label style={sLabel}>Tear Out</label><Stepper value={door.tearOut||0} onChange={v=>onChange({...door,tearOut:v})} step={1} unit="ea" small /></div>
      </div>
    </div>
  );
}
function CabinetEntry({ cab, onChange, onRemove }) {
  return (
    <div style={{background:C.cardAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Cabinet Set</span>
        <button onClick={onRemove} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
        {CABINET_TYPES.map(t=><Chip key={t} label={t} selected={cab.type===t} onToggle={()=>onChange({...cab,type:t})} />)}
      </div>
      <label style={sLabel}>Linear Feet (LF)</label>
      <Stepper value={cab.lf||0} onChange={v=>onChange({...cab,lf:v})} step={1} unit="LF" small />
    </div>
  );
}
function EquipEntry({ eq, onChange, onRemove }) {
  return (
    <div style={{background:C.cardAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,color:C.accent,fontWeight:700}}>Equipment</span>
        <button onClick={onRemove} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:8}}>
        {EQUIP_TYPES.map(t=><Chip key={t} label={t} selected={eq.type===t} onToggle={()=>onChange({...eq,type:t})} />)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><label style={sLabel}>Qty</label><Stepper value={eq.qty||0} onChange={v=>onChange({...eq,qty:v})} step={1} unit="ea" small /></div>
        <div><label style={sLabel}>Days</label><Stepper value={eq.days||0} onChange={v=>onChange({...eq,days:v})} step={1} unit="days" small /></div>
      </div>
    </div>
  );
}

// ── Section status helpers ────────────────────────────────────────────────────
function getStatus(room, key) {
  if (key==="trim")     return room.trimDone     ? "done-yes" : "open";
  if (key==="flooring") return room.flooringDone ? "done-yes" : "open";
  if (key==="drywall")  return room.drywallDone  ? "done-yes" : "open";
  if (key==="contents") return room.contentsDone ? "done-yes" : "open";
  if (key==="notes")    return room.notesDone    ? "done-yes" : "open";
  const v = room[key];
  if (v===null) return "unanswered";
  if (v===false) return "done-no";
  return "done-yes";
}
function isAnswered(room, key) {
  const st = getStatus(room, key);
  return st==="done-yes"||st==="done-no";
}
function buildUnlocked(room) {
  const unlocked = new Set();
  for (let i=0;i<SECTIONS.length;i++) {
    const s=SECTIONS[i];
    unlocked.add(s.key);
    if (!isAnswered(room,s.key)) break;
  }
  return unlocked;
}

// ── Review Screen ─────────────────────────────────────────────────────────────
function ReviewScreen({ rooms, jobInfo, hasSketchDone, onBack, onSubmit, sending, encircleLinked, C, theme }) {
  const [expandedRooms, setExpandedRooms] = useState(new Set([rooms[0]?.id]));
  const toggleRoom = id => setExpandedRooms(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });

  const displayDate = jobInfo.date ? new Date(jobInfo.date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}) : "—";

  const ReviewRow = ({label, val, unit}) => val>0||val===-1 ? (
    <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}22`}}>
      <span style={{fontSize:13,color:C.muted}}>{label}</span>
      <span style={{fontSize:13,fontWeight:700,color:C.text}}>{val===-1?"Yes":`${typeof val==="number"?val.toLocaleString():val}${unit?" "+unit:""}`}</span>
    </div>
  ) : null;

  const SectionTag = ({label, isNA}) => (
    <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:12,marginRight:4,marginBottom:4,display:"inline-block",background:isNA?C.cardAlt:C.greenDim,color:isNA?C.muted:C.green,border:`1px solid ${isNA?C.border:C.green+"44"}`}}>
      {isNA?"—":"✓"} {label}
    </span>
  );

  // Totals across all rooms
  const t = rooms.reduce((a,r)=>{
    const fcLF=r.floodCutsList.filter(c=>c.height!=="Full wall (SF)").reduce((s,c)=>s+(c.lf||0),0);
    const fcSF=r.floodCutsList.filter(c=>c.height==="Full wall (SF)").reduce((s,c)=>s+(c.lf||0),0);
    const cabLF=r.cabinetsList.reduce((s,c)=>s+(c.lf||0),0);
    const floorSF=r.floors.reduce((s,f)=>s+(f.sf||0),0);
    const eqList=r.equipment===true?r.equipmentList:[];
    return {
      baseboardLF:a.baseboardLF+(r.baseboardLF||0), casingLF:a.casingLF+(r.casingLF||0), quarterRoundLF:a.quarterRoundLF+(r.quarterRoundLF||0),
      floorSF:a.floorSF+floorSF, subfloorSF:a.subfloorSF+(r.subfloorSF||0),
      fcLF:a.fcLF+fcLF, fcSF:a.fcSF+fcSF,
      drywallCeiling:a.drywallCeiling+(r.drywallCeilingSF||0), drywallWalls:a.drywallWalls+(r.drywallWallsSF||0),
      insulationSF:a.insulationSF+(r.insulation===true?(r.insulationSF||0):0),
      cabLF:a.cabLF+(r.cabinets===true?cabLF:0), countertopLF:a.countertopLF+(r.cabinets===true?(r.countertopLF||0):0),
      contentsMins:a.contentsMins+((r.contentsMoveHrs||0)*60),
      airMovers:a.airMovers+eqList.filter(e=>e.type==="Air Mover").reduce((s,e)=>s+(e.qty||0),0),
      dehus:a.dehus+eqList.filter(e=>e.type==="Dehumidifier").reduce((s,e)=>s+(e.qty||0),0),
    };
  },{baseboardLF:0,casingLF:0,quarterRoundLF:0,floorSF:0,subfloorSF:0,fcLF:0,fcSF:0,drywallCeiling:0,drywallWalls:0,insulationSF:0,cabLF:0,countertopLF:0,contentsMins:0,airMovers:0,dehus:0});

  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:50,overflowY:"auto",paddingBottom:100}}>
      {/* Header */}
      <div style={{background:C.headerBg,borderBottom:`1px solid ${C.border}`,padding:"14px 16px",position:"sticky",top:0,zIndex:10,display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"transparent",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.muted,padding:"8px 14px",fontSize:13,cursor:"pointer",flexShrink:0}}>← Edit</button>
        <div style={{flex:1}}>
          <div style={{fontSize:9,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.14em"}}>Review Before Sending</div>
          <div style={{fontSize:14,fontWeight:800}}>{rooms.length} Room{rooms.length!==1?"s":""} · {jobInfo.jobNumber||"No Job #"}</div>
        </div>
      </div>

      <div style={{padding:"14px 13px 0"}}>
        {/* Job Info summary */}
        <div style={{...sCard,border:`1px solid ${C.accent}44`}}>
          <div style={{fontSize:9,color:C.accent,textTransform:"uppercase",letterSpacing:"0.14em",fontWeight:800,marginBottom:12}}>Job Info</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[["Date",displayDate],["Tech",jobInfo.tech||"—"],["Job #",jobInfo.jobNumber||"—"],["Insured",jobInfo.insuredName||"—"],["Floor Plan",hasSketchDone?"Encircle/DocuSketch ✓":"No sketch"]].map(([l,v])=>(
              <div key={l}>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>{l}</div>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{v}</div>
              </div>
            ))}
          </div>
          {jobInfo.address&&<div style={{marginTop:10,fontSize:12,color:C.muted}}>📍 {jobInfo.address}</div>}
        </div>

        {/* Rooms */}
        {rooms.map((r,i)=>{
          const isOpen = expandedRooms.has(r.id);
          const floorSF = r.floors.reduce((s,f)=>s+(f.sf||0),0);
          const dim = (r.lengthFt&&r.widthFt&&r.heightFt)?`${r.lengthFt}×${r.widthFt}×${r.heightFt}ft`:"";
          const isComplete = r.notesDone;

          return (
            <div key={r.id} style={{...sCard,border:`1px solid ${isComplete?C.green+"55":C.accent+"44"}`}}>
              {/* Room header — tap to expand/collapse */}
              <button onClick={()=>toggleRoom(r.id)} style={{width:"100%",background:"transparent",border:"none",padding:0,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                <div style={{background:isComplete?C.green:C.accent,color:"#000",fontWeight:900,fontSize:11,width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {isComplete?"✓":i+1}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,color:C.text}}>{r.name||`Room ${i+1}`}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:1}}>
                    {[dim, floorSF>0&&`${floorSF.toLocaleString()} SF floor`, r.drywallCeilingSF+r.drywallWallsSF>0&&`${(r.drywallCeilingSF+r.drywallWallsSF).toLocaleString()} SF drywall`].filter(Boolean).join(" · ")||"No quantities entered"}
                  </div>
                </div>
                <span style={{fontSize:12,color:C.muted}}>{isOpen?"▲":"▼"}</span>
              </button>

              {isOpen&&(
                <div style={{marginTop:14,borderTop:`1px solid ${C.border}`,paddingTop:14}}>
                  {/* Trim */}
                  {(r.baseboardLF>0||r.casingLF>0||r.quarterRoundLF>0)&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>📏 Baseboard & Trim</div>
                    <ReviewRow label="Baseboard" val={r.baseboardLF} unit="LF" />
                    <ReviewRow label="Casing" val={r.casingLF} unit="LF" />
                    <ReviewRow label="Quarter Round" val={r.quarterRoundLF} unit="LF" />
                    <div style={{height:10}}/>
                  </>}
                  {/* Flooring */}
                  {(floorSF>0||r.subfloorSF>0)&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🪵 Flooring</div>
                    {r.floors.filter(f=>f.sf>0).map((f,fi)=><ReviewRow key={fi} label={f.type==="Other"?(f.typeOther||"Other"):f.type||"—"} val={f.sf} unit="SF" />)}
                    <ReviewRow label="Subfloor" val={r.subfloorSF} unit="SF" />
                    <div style={{height:10}}/>
                  </>}
                  {/* Flood cuts */}
                  {r.floodCuts===true&&r.floodCutsList.length>0&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>✂️ Flood Cuts</div>
                    {r.floodCutsList.map((c,ci)=><ReviewRow key={ci} label={`Cut (${c.height})`} val={c.lf||0} unit={c.height==="Full wall (SF)"?"SF":"LF"} />)}
                    <div style={{height:10}}/>
                  </>}
                  {/* Drywall */}
                  {(r.drywallCeilingSF>0||r.drywallWallsSF>0)&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🧱 Drywall</div>
                    <ReviewRow label="Ceiling" val={r.drywallCeilingSF} unit="SF" />
                    <ReviewRow label="Walls" val={r.drywallWallsSF} unit="SF" />
                    <ReviewRow label="Total" val={r.drywallCeilingSF+r.drywallWallsSF} unit="SF" />
                    <div style={{height:10}}/>
                  </>}
                  {/* Insulation */}
                  {r.insulation===true&&r.insulationSF>0&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🌡️ Insulation</div>
                    <ReviewRow label={r.insulationTypes.join(", ")||"—"} val={r.insulationSF} unit="SF" />
                    <div style={{height:10}}/>
                  </>}
                  {/* Cabinets */}
                  {r.cabinets===true&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🍽️ Cabinets & Countertops</div>
                    {r.cabinetsList.map((c,ci)=><ReviewRow key={ci} label={c.type} val={c.lf||0} unit="LF" />)}
                    <ReviewRow label={`Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:""}`} val={r.countertopSF} unit="SF" />
                    <ReviewRow label={`Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:""}`} val={r.countertopLF} unit="LF" />
                    <ReviewRow label={`Backsplash${r.backsplashMaterial?` (${r.backsplashMaterial})`:""}`} val={r.backsplashLF} unit="LF" />
                    <div style={{height:10}}/>
                  </>}
                  {/* Doors */}
                  {r.doors===true&&r.doorsList.length>0&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🚪 Doors</div>
                    {r.doorsList.map((d,di)=><div key={di}>
                      {d.detach>0&&<ReviewRow label={`${d.type} — Detach`} val={d.detach} unit="ea" />}
                      {d.tearOut>0&&<ReviewRow label={`${d.type} — Tear Out`} val={d.tearOut} unit="ea" />}
                    </div>)}
                    <div style={{height:10}}/>
                  </>}
                  {/* Fixtures */}
                  {r.fixtures===true&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🚿 Fixtures & Electrical</div>
                    <ReviewRow label="Outlet Covers" val={r.outletCoversCount} unit="ea" />
                    <ReviewRow label="Ceiling Fans" val={r.ceilingFans} unit="ea" />
                    <ReviewRow label="Registers" val={r.registers} unit="ea" />
                    <ReviewRow label="Lights" val={r.lights} unit="ea" />
                    {r.toiletRemoved&&<ReviewRow label="Toilet Removed" val={-1} />}
                    <div style={{height:10}}/>
                  </>}
                  {/* Appliances */}
                  {r.appliances===true&&r.appliancesList.length>0&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>🔌 Appliances</div>
                    <div style={{fontSize:13,color:C.text,padding:"6px 0"}}>{r.appliancesList.join(", ")}</div>
                    <div style={{height:10}}/>
                  </>}
                  {/* Equipment */}
                  {r.equipment===true&&r.equipmentList.length>0&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>💨 Equipment</div>
                    {r.equipmentList.map((e,ei)=><ReviewRow key={ei} label={e.type} val={`${e.qty} ea`} unit={`× ${e.days} days`} />)}
                    <div style={{height:10}}/>
                  </>}
                  {/* Contents */}
                  {r.contentsMoveHrs>0&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>📦 Contents Move</div>
                    <ReviewRow label="Hours" val={r.contentsMoveHrs} unit="hrs" />
                    <ReviewRow label="Technicians" val={r.contentsTechs} unit="techs" />
                    <div style={{height:10}}/>
                  </>}
                  {/* Notes */}
                  {r.notes&&<>
                    <div style={{fontSize:10,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>📝 Notes</div>
                    <div style={{fontSize:13,color:C.text,background:C.cardAlt,padding:"10px 12px",borderRadius:8,lineHeight:1.5}}>{r.notes}</div>
                  </>}

                  {/* N/A sections */}
                  <div style={{marginTop:12,flexWrap:"wrap",display:"flex"}}>
                    {SECTIONS.filter(s=>!s.alwaysOn&&r[s.key]===false).map(s=><SectionTag key={s.key} label={s.label} isNA />)}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Job totals */}
        <div style={{...sCard,border:`1px solid ${C.accent}44`,marginBottom:16}}>
          <div style={{fontSize:9,color:C.accent,textTransform:"uppercase",letterSpacing:"0.14em",fontWeight:800,marginBottom:12}}>∑ Job Totals</div>
          {[
            ["Baseboard",t.baseboardLF,"LF"],["Casing",t.casingLF,"LF"],["Quarter Round",t.quarterRoundLF,"LF"],
            ["Floor Covering",t.floorSF,"SF"],["Subfloor",t.subfloorSF,"SF"],
            ["Flood Cuts",t.fcLF,"LF"],["Flood Cuts (full wall)",t.fcSF,"SF"],
            ["Drywall Ceiling",t.drywallCeiling,"SF"],["Drywall Walls",t.drywallWalls,"SF"],
            ["Drywall Total",t.drywallCeiling+t.drywallWalls,"SF"],
            ["Insulation",t.insulationSF,"SF"],["Cabinets",t.cabLF,"LF"],["Countertops",t.countertopLF,"LF"],
            ["Air Movers",t.airMovers,"ea"],["Dehumidifiers",t.dehus,"ea"],
          ].filter(([,v])=>v>0).map(([l,v,u])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}22`}}>
              <span style={{fontSize:13,color:C.text}}>{l}</span>
              <span style={{fontSize:13,fontWeight:700,color:l==="Drywall Total"?C.accent:C.text}}>{v.toLocaleString()} <span style={{fontSize:10,color:C.muted,fontWeight:400}}>{u}</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Send bar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.headerBg,borderTop:`1px solid ${C.border}`,padding:"12px 13px 16px",zIndex:60}}>
        {encircleLinked && (
          <div style={{fontSize:11,color:"#4db8ff",textAlign:"center",marginBottom:8,opacity:0.8}}>
            ⛓ Will email + upload PDF to Encircle job
          </div>
        )}
        {!encircleLinked && (
          <div style={{fontSize:11,color:C.muted,textAlign:"center",marginBottom:8}}>
            Will send email to Moroni & restoration@utah-pros.com
          </div>
        )}
        <button onClick={onSubmit} disabled={sending} style={{width:"100%",background:sending?"#1a2a1a":C.green,border:"none",borderRadius:10,color:"#000",fontSize:17,fontWeight:800,padding:"17px",cursor:sending?"default":"pointer",opacity:sending?0.8:1,transition:"all 0.2s"}}>
          {sending ? (
            <span>⏳ Submitting…</span>
          ) : (
            <span>✓ Submit Demo Sheet</span>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Room Card ─────────────────────────────────────────────────────────────────
function RoomCard({ room, index, onChange, onRemove, onDuplicate, totalRooms, needsDimensions, encircleRooms, encircleRoomsLoading }) {
  const up = (fields) => onChange({...room,...fields});
  const upField = (f,v) => up({[f]:v});
  const upListItem = (f,i,val) => up({[f]:room[f].map((x,j)=>j===i?val:x)});
  const addItem = (f,def) => up({[f]:[...room[f],def]});
  const removeItem = (f,i) => up({[f]:room[f].filter((_,j)=>j!==i)});

  const calcSF = (room.lengthFt&&room.widthFt)?Math.round(parseFloat(room.lengthFt)*parseFloat(room.widthFt)):null;
  const unlocked = buildUnlocked(room);

  const handleToggle = (key) => {
    if (!unlocked.has(key)) return;
    up({openSection: room.openSection===key?null:key});
  };

  const advance = (currentKey) => {
    const idx=SECTIONS.findIndex(s=>s.key===currentKey);
    for (let i=idx+1;i<SECTIONS.length;i++) { up({openSection:SECTIONS[i].key}); return; }
    up({openSection:null});
  };

  const markDone = (doneFlag, currentKey) => {
    const idx=SECTIONS.findIndex(s=>s.key===currentKey);
    let next=null;
    for (let i=idx+1;i<SECTIONS.length;i++){next=SECTIONS[i].key;break;}
    up({[doneFlag]:true, openSection:next});
  };

  const markNo = (key) => {
    const idx=SECTIONS.findIndex(s=>s.key===key);
    let next=null;
    for (let i=idx+1;i<SECTIONS.length;i++){next=SECTIONS[i].key;break;}
    up({[key]:false, openSection:next});
  };

  const markYes = (key) => up({[key]:true, openSection:key});
  const resetGate = (key) => up({[key]:null, openSection:key});

  const answeredCount = SECTIONS.filter(s=>isAnswered(room,s.key)).length;
  const isComplete = room.notesDone;

  const bodies = {
    trim:(
      <>
        <div style={{height:12}}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
          <div><label style={sLabel}>Baseboard (LF)</label><Stepper value={room.baseboardLF} onChange={v=>upField("baseboardLF",v)} step={1} unit="LF" small /></div>
          <div><label style={sLabel}>Casing (LF)</label><Stepper value={room.casingLF} onChange={v=>upField("casingLF",v)} step={1} unit="LF" small /></div>
          <div><label style={sLabel}>Qtr Round (LF)</label><Stepper value={room.quarterRoundLF} onChange={v=>upField("quarterRoundLF",v)} step={1} unit="LF" small /></div>
        </div>
        <NextBtn onClick={()=>markDone("trimDone","trim")} />
      </>
    ),
    flooring:(
      <>
        <div style={{height:12}}/>
        {room.floors.map((fl,i)=>(
          <FloorEntry key={fl.id} floor={fl} onChange={v=>upListItem("floors",i,v)} onRemove={()=>removeItem("floors",i)} showRemove={room.floors.length>1} />
        ))}
        <AddBtn label="Add another floor type" onClick={()=>addItem("floors",defaultFloor())} />
        <div style={{height:10}}/>
        <label style={sLabel}>Subfloor (SF)</label>
        <Stepper value={room.subfloorSF} onChange={v=>upField("subfloorSF",v)} step={10} unit="SF" />
        <NextBtn onClick={()=>markDone("flooringDone","flooring")} />
      </>
    ),
    floodCuts:(
      <>
        {room.floodCuts===null&&<YesNo onNo={()=>markNo("floodCuts")} onYes={()=>markYes("floodCuts")} />}
        {room.floodCuts!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("floodCuts")} />
            {room.floodCuts===true&&(
              <>
                {room.floodCutsList.map((c,i)=>(
                  <FloodCutEntry key={i} cut={c} onChange={v=>upListItem("floodCutsList",i,v)} onRemove={()=>removeItem("floodCutsList",i)} />
                ))}
                <AddBtn label="Add flood cut" onClick={()=>addItem("floodCutsList",{height:"2 ft",lf:0})} />
                <NextBtn onClick={()=>advance("floodCuts")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    drywall:(
      <>
        <div style={{height:12}}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div><label style={sLabel}>Ceiling (SF)</label><Stepper value={room.drywallCeilingSF} onChange={v=>upField("drywallCeilingSF",v)} step={10} unit="SF" /></div>
          <div><label style={sLabel}>Walls (SF)</label><Stepper value={room.drywallWallsSF} onChange={v=>upField("drywallWallsSF",v)} step={10} unit="SF" /></div>
        </div>
        <NextBtn onClick={()=>markDone("drywallDone","drywall")} />
      </>
    ),
    insulation:(
      <>
        {room.insulation===null&&<YesNo onNo={()=>markNo("insulation")} onYes={()=>markYes("insulation")} />}
        {room.insulation!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("insulation")} />
            {room.insulation===true&&(
              <>
                <label style={sLabel}>Type (select all)</label>
                <MultiChips options={INSULATION_TYPES} selected={room.insulationTypes} onChange={v=>upField("insulationTypes",v)} />
                <div style={{height:10}}/>
                <label style={sLabel}>Quantity (SF)</label>
                <Stepper value={room.insulationSF} onChange={v=>upField("insulationSF",v)} step={10} unit="SF" />
                <NextBtn onClick={()=>advance("insulation")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    cabinets:(
      <>
        {room.cabinets===null&&<YesNo onNo={()=>markNo("cabinets")} onYes={()=>markYes("cabinets")} />}
        {room.cabinets!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("cabinets")} />
            {room.cabinets===true&&(
              <>
                {room.cabinetsList.map((c,i)=>(
                  <CabinetEntry key={i} cab={c} onChange={v=>upListItem("cabinetsList",i,v)} onRemove={()=>removeItem("cabinetsList",i)} />
                ))}
                <AddBtn label="Add cabinet set" onClick={()=>addItem("cabinetsList",{type:"Base Cabinets",lf:0})} />
                <div style={{height:12}}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div><label style={sLabel}>Countertop (SF)</label><Stepper value={room.countertopSF} onChange={v=>upField("countertopSF",v)} step={1} unit="SF" small /></div>
                  <div><label style={sLabel}>Countertop (LF)</label><Stepper value={room.countertopLF} onChange={v=>upField("countertopLF",v)} step={1} unit="LF" small /></div>
                </div>
                <label style={sLabel}>Countertop Material</label>
                <SingleChips options={COUNTERTOP_MATERIALS} value={room.countertopMaterial} onChange={v=>upField("countertopMaterial",v)} />
                <div style={{height:10}}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div><label style={sLabel}>Backsplash (LF)</label><Stepper value={room.backsplashLF} onChange={v=>upField("backsplashLF",v)} step={1} unit="LF" small /></div>
                  <div>
                    <label style={sLabel}>Backsplash Material</label>
                    <select value={room.backsplashMaterial} onChange={e=>upField("backsplashMaterial",e.target.value)} style={{...sInput,fontSize:14}}>
                      <option value="">—</option>
                      {["Tile","Formica","Marble","Granite","Other"].map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <NextBtn onClick={()=>advance("cabinets")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    doors:(
      <>
        {room.doors===null&&<YesNo onNo={()=>markNo("doors")} onYes={()=>markYes("doors")} />}
        {room.doors!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("doors")} />
            {room.doors===true&&(
              <>
                {room.doorsList.map((d,i)=>(
                  <DoorEntry key={i} door={d} onChange={v=>upListItem("doorsList",i,v)} onRemove={()=>removeItem("doorsList",i)} />
                ))}
                <AddBtn label="Add door" onClick={()=>addItem("doorsList",{type:"Interior",detach:0,tearOut:0})} />
                <NextBtn onClick={()=>advance("doors")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    fixtures:(
      <>
        {room.fixtures===null&&<YesNo onNo={()=>markNo("fixtures")} onYes={()=>markYes("fixtures")} />}
        {room.fixtures!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("fixtures")} />
            {room.fixtures===true&&(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div><label style={sLabel}>Outlet Covers</label><Stepper value={room.outletCoversCount} onChange={v=>upField("outletCoversCount",v)} step={1} unit="ea" small /></div>
                  <div><label style={sLabel}>Ceiling Fans</label><Stepper value={room.ceilingFans} onChange={v=>upField("ceilingFans",v)} step={1} unit="ea" small /></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div><label style={sLabel}>Registers</label><Stepper value={room.registers} onChange={v=>upField("registers",v)} step={1} unit="ea" small /></div>
                  <div><label style={sLabel}>Lights</label><Stepper value={room.lights} onChange={v=>upField("lights",v)} step={1} unit="ea" small /></div>
                </div>
                <CheckRow label="Toilet removed / disconnected" checked={room.toiletRemoved} onChange={v=>upField("toiletRemoved",v)} />
                <NextBtn onClick={()=>advance("fixtures")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    appliances:(
      <>
        {room.appliances===null&&<YesNo onNo={()=>markNo("appliances")} onYes={()=>markYes("appliances")} />}
        {room.appliances!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("appliances")} />
            {room.appliances===true&&(
              <>
                <MultiChips options={APPLIANCE_LIST} selected={room.appliancesList} onChange={v=>upField("appliancesList",v)} />
                {room.appliancesList.includes("Other")&&<div style={{marginTop:8}}><input value={room.applianceOther} onChange={e=>upField("applianceOther",e.target.value)} placeholder="Describe…" style={sInput} /></div>}
                <NextBtn onClick={()=>advance("appliances")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    equipment:(
      <>
        {room.equipment===null&&<YesNo onNo={()=>markNo("equipment")} onYes={()=>markYes("equipment")} />}
        {room.equipment!==null&&(
          <div style={{marginTop:8}}>
            <ChangeBtn onClick={()=>resetGate("equipment")} />
            {room.equipment===true&&(
              <>
                {room.equipmentList.map((e,i)=>(
                  <EquipEntry key={i} eq={e} onChange={v=>upListItem("equipmentList",i,v)} onRemove={()=>removeItem("equipmentList",i)} />
                ))}
                <AddBtn label="Add equipment" onClick={()=>addItem("equipmentList",{type:"Air Mover",qty:0,days:0})} />
                <NextBtn onClick={()=>advance("equipment")} />
              </>
            )}
          </div>
        )}
      </>
    ),
    contents:(
      <>
        <div style={{height:12}}/>
        <label style={sLabel}>Contents move in this room</label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          <div><label style={sLabel}>Hours</label><Stepper value={room.contentsMoveHrs} onChange={v=>upField("contentsMoveHrs",v)} step={0.5} unit="hrs" small /></div>
          <div><label style={sLabel}>Technicians</label><Stepper value={room.contentsTechs} onChange={v=>upField("contentsTechs",v)} step={1} unit="techs" small /></div>
        </div>
        <NextBtn onClick={()=>markDone("contentsDone","contents")} />
      </>
    ),
    notes:(
      <>
        <div style={{height:12}}/>
        <textarea value={room.notes} onChange={e=>upField("notes",e.target.value)} placeholder="Hazards, access issues, special conditions, sketch notes…" rows={3} style={{...sInput,resize:"vertical"}} />
        <NextBtn onClick={()=>markDone("notesDone","notes")} label="✓ Room Complete" />
      </>
    ),
  };

  return (
    <div style={{...sCard,border:`1px solid ${isComplete?C.green+"66":C.border}`}}>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
        <div style={{background:isComplete?C.green:C.accent,color:"#000",fontWeight:900,fontSize:12,width:30,height:30,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          {isComplete?"✓":index+1}
        </div>
        <div style={{flex:1}}>
          <input value={room.name} onChange={e=>upField("name",e.target.value)} placeholder="Room name…" style={{...sInput,fontWeight:600,padding:"10px 12px"}} />
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={onDuplicate} title="Duplicate" style={{background:"transparent",border:`1.5px solid ${C.border}`,color:C.muted,width:34,height:34,borderRadius:7,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>⎘</button>
          {totalRooms>1&&<button onClick={onRemove} style={{background:"transparent",border:`1.5px solid ${C.border}`,color:C.muted,width:34,height:34,borderRadius:7,cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>}
        </div>
      </div>

      <div style={{marginBottom:10,overflowX:"auto",whiteSpace:"nowrap",paddingBottom:4}}>
        {encircleRoomsLoading ? (
          <div style={{fontSize:11,color:C.muted,padding:"6px 2px"}}>⏳ Loading rooms from Encircle…</div>
        ) : (
          <div style={{display:"inline-flex",gap:6}}>
            {/* Show Encircle rooms if available, otherwise fall back to presets */}
            {(encircleRooms && encircleRooms.length > 0 ? encircleRooms : ROOM_PRESETS).map(p=>(
              <button key={p} onClick={()=>upField("name",p)} style={{background:room.name===p?C.accentDim:C.cardAlt,border:`1px solid ${room.name===p?C.accent:encircleRooms?.length>0?C.green+"44":C.border}`,borderRadius:20,color:room.name===p?C.accent:encircleRooms?.length>0?C.green:C.muted,fontSize:11,fontWeight:room.name===p?700:400,padding:"5px 10px",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {p}
              </button>
            ))}
            {encircleRooms?.length > 0 && (
              <span style={{fontSize:10,color:C.green,padding:"5px 8px",whiteSpace:"nowrap",opacity:0.7,flexShrink:0}}>from Encircle ⛓</span>
            )}
          </div>
        )}
      </div>

      {needsDimensions&&(
        <div style={{background:C.cardAlt,border:`1.5px solid ${C.red}55`,borderRadius:8,padding:"12px",marginBottom:10}}>
          <div style={{fontSize:10,color:C.red,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>📐 Room Dimensions (required)</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[["lengthFt","L (ft)"],["widthFt","W (ft)"],["heightFt","H (ft)"]].map(([f,l])=>(
              <div key={f}>
                <label style={sLabel}>{l}</label>
                <input type="number" inputMode="decimal" value={room[f]} onChange={e=>upField(f,e.target.value)} placeholder="0" style={{...sInput,textAlign:"center",borderColor:!room[f]?C.red+"88":C.border}} />
              </div>
            ))}
          </div>
          {calcSF&&<div style={{marginTop:6,fontSize:11,color:C.muted,textAlign:"center"}}>≈ <strong style={{color:C.accent}}>{calcSF.toLocaleString()} SF</strong></div>}
        </div>
      )}

      <RoomProgress answeredCount={answeredCount} total={SECTIONS.length} />

      {SECTIONS.map(sec=>{
        const locked=!unlocked.has(sec.key);
        const status=locked?null:getStatus(room,sec.key);
        const displayStatus=locked?null:(status==="open"||status==="unanswered")?null:status;
        return (
          <Section key={sec.key} icon={sec.icon} label={sec.label} status={displayStatus} open={room.openSection===sec.key&&!locked} onToggle={()=>handleToggle(sec.key)} locked={locked}>
            {bodies[sec.key]}
          </Section>
        );
      })}
    </div>
  );
}


// ── Result Screen ─────────────────────────────────────────────────────────────
function ResultScreen({ result, encircleLinked, onStartNew, onBack }) {
  const allOk = result.emailOk && (result.encircleSkipped || result.encircleOk);
  const partialOk = result.emailOk || result.encircleOk;

  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:50,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px",textAlign:"center"}}>
      {/* Icon */}
      <div style={{fontSize:72,marginBottom:20,lineHeight:1}}>
        {allOk ? "✅" : partialOk ? "⚠️" : "❌"}
      </div>

      {/* Title */}
      <div style={{fontSize:22,fontWeight:800,color:allOk?C.green:partialOk?C.accent:C.red,marginBottom:8}}>
        {allOk ? "Demo Sheet Submitted!" : partialOk ? "Partially Submitted" : "Submission Failed"}
      </div>

      {/* Subtitle */}
      <div style={{fontSize:13,color:C.muted,marginBottom:32,lineHeight:1.5}}>
        {allOk ? "Everything was sent successfully." : "Some actions failed — see details below."}
      </div>

      {/* Status cards */}
      <div style={{width:"100%",maxWidth:360,marginBottom:32}}>
        {/* Email status */}
        <div style={{display:"flex",alignItems:"center",gap:12,background:result.emailOk?C.greenDim:C.redDim,border:`1.5px solid ${result.emailOk?C.green:C.red}44`,borderRadius:10,padding:"14px 16px",marginBottom:10}}>
          <span style={{fontSize:24,flexShrink:0}}>{result.emailOk?"📧":"📧"}</span>
          <div style={{textAlign:"left"}}>
            <div style={{fontSize:13,fontWeight:700,color:result.emailOk?C.green:C.red}}>
              {result.emailOk ? "Email Sent ✓" : "Email Failed ✗"}
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>
              {result.emailOk ? "moroni.s@ & restoration@utah-pros.com" : "Could not send email — check connection"}
            </div>
          </div>
        </div>

        {/* Encircle status */}
        {!result.encircleSkipped && (
          <div style={{display:"flex",alignItems:"center",gap:12,background:result.encircleOk?C.greenDim:C.redDim,border:`1.5px solid ${result.encircleOk?C.green:C.red}44`,borderRadius:10,padding:"14px 16px",marginBottom:10}}>
            <span style={{fontSize:24,flexShrink:0}}>⛓</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:13,fontWeight:700,color:result.encircleOk?C.green:C.red}}>
                {result.encircleOk ? "Uploaded to Encircle ✓" : "Encircle Note Failed ✗"}
              </div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>
                {result.encircleOk ? "General note saved to job" : "Could not save Encircle note — try again"}
              </div>
            </div>
          </div>
        )}

        {result.encircleSkipped && (
          <div style={{display:"flex",alignItems:"center",gap:12,background:C.cardAlt,border:`1.5px solid ${C.border}`,borderRadius:10,padding:"14px 16px",marginBottom:10,opacity:0.6}}>
            <span style={{fontSize:24,flexShrink:0}}>⛓</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.muted}}>Encircle — Skipped</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>No job was linked</div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{width:"100%",maxWidth:360,display:"flex",flexDirection:"column",gap:10}}>
        {allOk && (
          <button onClick={onStartNew} style={{background:C.green,border:"none",borderRadius:10,color:"#000",fontSize:15,fontWeight:800,padding:"15px",cursor:"pointer"}}>
            + Start New Demo Sheet
          </button>
        )}
        {!allOk && (
          <button onClick={onBack} style={{background:C.accent,border:"none",borderRadius:10,color:"#000",fontSize:15,fontWeight:800,padding:"15px",cursor:"pointer"}}>
            ← Go Back & Retry
          </button>
        )}
        {allOk && (
          <button onClick={onBack} style={{background:"transparent",border:`1.5px solid ${C.border}`,borderRadius:10,color:C.muted,fontSize:13,fontWeight:600,padding:"13px",cursor:"pointer"}}>
            ← Back to Sheet
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function DemoSheet() {
  const [theme, setTheme] = useState("light");
  C = THEMES[theme];
  sInput = mkInput(C);
  sCard  = mkCard(C);
  const [rooms, setRooms] = useState([defaultRoom()]);
  const [gpsStatus, setGpsStatus] = useState(null);
  const [jobInfo, setJobInfo] = useState({date:today(),tech:"",jobNumber:"",address:"",insuredName:""});
  const [hasSketchDone, setHasSketchDone] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [showEncircle, setShowEncircle] = useState(false);
  const [encircleLinked, setEncircleLinked] = useState(null);
  const [encircleRooms, setEncircleRooms] = useState([]); // rooms fetched from Encircle
  const [encircleRoomsLoading, setEncircleRoomsLoading] = useState(false);

  const setJob=(k,v)=>setJobInfo(p=>({...p,[k]:v}));

  const handleEncircleSelect = async (claim) => {
    setJobInfo(p => ({
      ...p,
      jobNumber: claim.contractor_identifier || claim.policy_number || String(claim.id) || p.jobNumber,
      address: claim.full_address || p.address,
      insuredName: claim.policyholder_name || p.insuredName,
    }));
    setEncircleLinked(claim);
    setShowEncircle(false);
    // Fetch rooms from Encircle for this job
    setEncircleRoomsLoading(true);
    try {
      const res = await fetch(`/.netlify/functions/encircle-rooms?claim_id=${claim.id}`);
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

  const needsDimensions=hasSketchDone===false;
  const addRoom=()=>setRooms(p=>[...p,defaultRoom()]);
  const updateRoom=(id,u)=>setRooms(p=>p.map(r=>r.id===id?u:r));
  const removeRoom=id=>setRooms(p=>p.filter(r=>r.id!==id));
  const duplicateRoom=id=>{
    const room=rooms.find(r=>r.id===id);
    const copy={...room,id:newId(),name:room.name?room.name+" (copy)":"",openSection:"trim"};
    const idx=rooms.findIndex(r=>r.id===id);
    setRooms(p=>[...p.slice(0,idx+1),copy,...p.slice(idx+1)]);
  };

  const hasData=rooms.some(r=>r.drywallCeilingSF||r.drywallWallsSF||r.floors.some(f=>f.sf>0)||r.baseboardLF);
  const allComplete=rooms.every(r=>r.notesDone);

  const getGPS=()=>{
    if (!navigator.geolocation){setGpsStatus("error");return;}
    setGpsStatus("loading");
    navigator.geolocation.getCurrentPosition(async pos=>{
      try{
        const{latitude:lat,longitude:lng}=pos.coords;
        const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const d=await res.json();const a=d.address;
        setJob("address",[a.house_number,a.road,a.city||a.town||a.village,a.state,a.postcode].filter(Boolean).join(", "));
        setGpsStatus("done");
      }catch{setGpsStatus("error");}
    },()=>setGpsStatus("error"),{enableHighAccuracy:true,timeout:10000});
  };

  const buildEmailHTML=()=>{
    const displayDate=jobInfo.date?new Date(jobInfo.date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"N/A";

    // Category header row
    const mkCat=(label,color="#D97706")=>`
      <tr>
        <td colspan="3" style="padding:8px 10px 4px;background:${color}18;border-top:2px solid ${color};font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.08em;">
          ${label}
        </td>
      </tr>`;

    // Data row — only renders if val > 0
    const mkRow=(label,val,unit)=>{
      if(!val||val===0) return "";
      const display=typeof val==="number"?val.toLocaleString():val;
      return `<tr>
        <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${label}</td>
        <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;color:#111;">${display}</td>
        <td style="padding:5px 10px;color:#888;font-size:11px;white-space:nowrap;">${unit}</td>
      </tr>`;
    };

    const mkBoolRow=(label,show)=>show?`<tr>
        <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${label}</td>
        <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;color:#111;">✓</td>
        <td style="padding:5px 10px;color:#888;font-size:11px;"></td>
      </tr>`:"";

    const roomsHTML=rooms.map((r,i)=>{
      const dim=(r.lengthFt&&r.widthFt&&r.heightFt)?`${r.lengthFt}' × ${r.widthFt}' × ${r.heightFt}'`:"";

      // ── 1. CONTENTS MOVE (first — move stuff out before any demo) ──────────
      const contentsRows=[
        mkCat("📦 Contents Move","#7C3AED"),
        mkRow("Hours",r.contentsMoveHrs,"hrs"),
        r.contentsMoveHrs>0?mkRow("Technicians",r.contentsTechs,"techs"):"",
      ].join("");
      const hasContents=r.contentsMoveHrs>0;

      // ── 2. APPLIANCES (disconnect & move before demo) ──────────────────────
      const appRows=r.appliances===true&&r.appliancesList.length>0?[
        mkCat("🔌 Appliances — Disconnect & Move","#0891B2"),
        ...r.appliancesList.map(a=>`<tr><td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${a}</td><td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;">✓</td><td></td></tr>`),
      ].join(""):"";

      // ── 3. PLUMBING / FIXTURES (disconnect before touching walls) ──────────
      const fixtureRows=r.fixtures===true?[
        mkCat("🚿 Plumbing & Fixtures","#0369A1"),
        mkBoolRow("Toilet — Disconnect & Remove",r.toiletRemoved),
        mkRow("Registers — Remove",r.registers,"ea"),
        mkRow("Ceiling Fans — Remove",r.ceilingFans,"ea"),
        mkRow("Light Fixtures — Remove",r.lights,"ea"),
        mkRow("Outlet & Switch Covers — Remove",r.outletCoversCount,"ea"),
      ].join(""):"";

      // ── 4. CABINETRY (remove cabinets before flooring & drywall) ──────────
      const cabRows=r.cabinets===true?[
        mkCat("🍽️ Cabinetry & Countertops","#B45309"),
        ...r.cabinetsList.map(c=>mkRow(`${c.type} — Remove`,c.lf||0,"LF")),
        r.countertopLF>0?mkRow(`Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:""}  — Remove`,r.countertopLF,"LF"):"",
        r.countertopSF>0?mkRow(`Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:""}  — Remove`,r.countertopSF,"SF"):"",
        r.backsplashLF>0?mkRow(`Backsplash${r.backsplashMaterial?` (${r.backsplashMaterial})`:""}  — Remove`,r.backsplashLF,"LF"):"",
      ].join(""):"";

      // ── 5. CARPENTRY / TRIM (remove before drywall & flooring) ────────────
      const trimRows=[
        mkCat("📏 Carpentry & Trim","#D97706"),
        mkRow("Baseboard — Remove & Reset",r.baseboardLF,"LF"),
        mkRow("Door Casing — Remove & Reset",r.casingLF,"LF"),
        mkRow("Quarter Round — Remove & Reset",r.quarterRoundLF,"LF"),
        ...(r.doors===true?r.doorsList.flatMap(d=>[
          d.detach>0?mkRow(`${d.type} Door — Detach & Reset`,d.detach,"ea"):"",
          d.tearOut>0?mkRow(`${d.type} Door — Tear Out`,d.tearOut,"ea"):"",
        ]):[]),
      ].join("");
      const hasTrim=r.baseboardLF>0||r.casingLF>0||r.quarterRoundLF>0||(r.doors===true&&r.doorsList.length>0);

      // ── 6. FLOORING (remove after trim, before drywall flood cuts) ────────
      const floorRows=[
        mkCat("🪵 Flooring","#166534"),
        ...r.floors.filter(f=>f.sf>0).map(f=>mkRow(`${f.type==="Other"?(f.typeOther||"Other"):f.type||"—"} — Remove`,f.sf,"SF")),
        mkRow("Subfloor — Remove",r.subfloorSF,"SF"),
      ].join("");
      const hasFlooring=r.floors.some(f=>f.sf>0)||r.subfloorSF>0;

      // ── 7. DRYWALL & FLOOD CUTS ────────────────────────────────────────────
      const drywallRows=[
        mkCat("🧱 Drywall","#6B21A8"),
        ...(r.floodCuts===true?r.floodCutsList.map(c=>mkRow(
          `Flood Cut (${c.height})`,c.lf||0,c.height==="Full wall (SF)"?"SF":"LF"
        )):[]),
        mkRow("Drywall Ceiling — Remove",r.drywallCeilingSF,"SF"),
        mkRow("Drywall Walls — Remove",r.drywallWallsSF,"SF"),
      ].join("");
      const hasDrywall=r.floodCuts===true||r.drywallCeilingSF>0||r.drywallWallsSF>0;

      // ── 8. INSULATION (exposed after drywall removed) ──────────────────────
      const insulRows=r.insulation===true&&r.insulationSF>0?[
        mkCat("🌡️ Insulation","#0F766E"),
        mkRow(`${r.insulationTypes.join(", ")||"—"} — Remove`,r.insulationSF,"SF"),
      ].join(""):"";

      // ── 9. EQUIPMENT LEFT IN ROOM ──────────────────────────────────────────
      const eqRows=r.equipment===true&&r.equipmentList.length>0?[
        mkCat("💨 Drying Equipment","#1D4ED8"),
        ...r.equipmentList.map(e=>`<tr>
          <td style="padding:5px 10px 5px 18px;color:#444;font-size:12px;">${e.type}</td>
          <td style="padding:5px 10px;text-align:right;font-weight:700;font-size:12px;">${e.qty} ea × ${e.days} days</td>
          <td style="padding:5px 10px;color:#888;font-size:11px;"></td>
        </tr>`),
      ].join(""):"";

      // Only render categories that have data
      const body=[
        hasContents?contentsRows:"",
        appRows,
        fixtureRows,
        cabRows,
        hasTrim?trimRows:"",
        hasFlooring?floorRows:"",
        hasDrywall?drywallRows:"",
        insulRows,
        eqRows,
      ].filter(Boolean).join("");

      if(!body) return "";

      return `
        <div style="margin-bottom:24px;">
          <div style="background:#D97706;color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;">Room ${i+1}: ${r.name||"(Unnamed)"}</span>
            ${dim?`<span style="font-size:11px;opacity:0.85;">${dim}</span>`:""}
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-top:none;">
            <tbody>${body}</tbody>
          </table>
          ${r.notes?`<div style="padding:8px 12px;background:#fffbf0;border:1px solid #e8d5a0;border-top:none;border-radius:0 0 4px 4px;font-size:11px;color:#666;line-height:1.5;"><strong>⚠️ Notes:</strong> ${r.notes}</div>`:""}
        </div>`;
    }).join("");

    return `<div style="font-family:system-ui,sans-serif;max-width:660px;margin:0 auto;padding:20px;">
      <div style="border-bottom:3px solid #D97706;padding-bottom:14px;margin-bottom:20px;">
        <div style="font-size:20px;font-weight:800;color:#D97706;">UTAH PROS RESTORATION</div>
        <div style="font-size:11px;font-weight:700;color:#444;letter-spacing:0.05em;margin-top:2px;">DEMOLITION SHEET</div>
        <div style="font-size:11px;color:#888;margin-top:4px;">Floor plan: ${hasSketchDone?"Encircle / DocuSketch ✓":"No sketch — dimensions recorded per room"}</div>
        <table style="width:100%;margin-top:10px;font-size:12px;">
          <tr><td style="color:#888;width:80px;">Date</td><td style="font-weight:600;">${displayDate}</td><td style="color:#888;width:90px;">Technician</td><td style="font-weight:600;">${jobInfo.tech||"—"}</td></tr>
          <tr><td style="color:#888;">Job #</td><td style="font-weight:600;">${jobInfo.jobNumber||"—"}</td><td style="color:#888;">Address</td><td style="font-weight:600;">${jobInfo.address||"—"}</td></tr>
          <tr><td style="color:#888;">Insured</td><td style="font-weight:600;" colspan="3">${jobInfo.insuredName||"—"}</td></tr>
        </table>
      </div>
      ${roomsHTML}

      <!-- Job Totals -->
      <div style="margin-top:8px;border:2px solid #D97706;border-radius:6px;overflow:hidden;">
        <div style="background:#D97706;color:#fff;padding:8px 12px;">
          <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;">∑ Job Totals — All Rooms</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>
            ${(()=>{
              const t=rooms.reduce((a,r)=>{
                const fcLF=r.floodCuts===true?r.floodCutsList.filter(c=>c.height!=="Full wall (SF)").reduce((s,c)=>s+(c.lf||0),0):0;
                const fcSF=r.floodCuts===true?r.floodCutsList.filter(c=>c.height==="Full wall (SF)").reduce((s,c)=>s+(c.lf||0),0):0;
                const cabLF=r.cabinets===true?r.cabinetsList.reduce((s,c)=>s+(c.lf||0),0):0;
                const floorSF=r.floors.reduce((s,f)=>s+(f.sf||0),0);
                const eqList=r.equipment===true?r.equipmentList:[];
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
                  airMovers:a.airMovers+eqList.filter(e=>e.type==="Air Mover").reduce((s,e)=>s+(e.qty||0),0),
                  dehus:a.dehus+eqList.filter(e=>e.type==="Dehumidifier").reduce((s,e)=>s+(e.qty||0),0),
                  scrubbers:a.scrubbers+eqList.filter(e=>e.type==="Air Scrubber").reduce((s,e)=>s+(e.qty||0),0),
                };
              },{contentsMins:0,baseboardLF:0,casingLF:0,quarterRoundLF:0,doorsDetach:0,doorsTearOut:0,floorSF:0,subfloorSF:0,fcLF:0,fcSF:0,drywallCeiling:0,drywallWalls:0,insulationSF:0,cabLF:0,countertopLF:0,airMovers:0,dehus:0,scrubbers:0});

              const mkTotCat=(label,color)=>`<tr><td colspan="3" style="padding:7px 10px 3px;background:${color}18;border-top:2px solid ${color};font-size:10px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:0.08em;">${label}</td></tr>`;
              const mkTotRow=(label,val,unit)=>val>0?`<tr><td style="padding:4px 10px 4px 18px;color:#444;font-size:12px;">${label}</td><td style="padding:4px 10px;text-align:right;font-weight:700;font-size:12px;">${typeof val==="number"?val.toLocaleString():val}</td><td style="padding:4px 10px;color:#888;font-size:11px;">${unit}</td></tr>`:"";

              const hrsTotal=t.contentsMins/60;
              return [
                t.contentsMins>0?mkTotCat("📦 Contents Move","#7C3AED"):"",
                t.contentsMins>0?mkTotRow("Total Hours",hrsTotal%1===0?hrsTotal:hrsTotal.toFixed(1),"hrs"):"",
                (t.baseboardLF||t.casingLF||t.quarterRoundLF||t.doorsDetach||t.doorsTearOut)?mkTotCat("📏 Carpentry & Trim","#D97706"):"",
                mkTotRow("Baseboard",t.baseboardLF,"LF"),
                mkTotRow("Door Casing",t.casingLF,"LF"),
                mkTotRow("Quarter Round",t.quarterRoundLF,"LF"),
                mkTotRow("Doors — Detach",t.doorsDetach,"ea"),
                mkTotRow("Doors — Tear Out",t.doorsTearOut,"ea"),
                (t.floorSF||t.subfloorSF)?mkTotCat("🪵 Flooring","#166534"):"",
                mkTotRow("Floor Covering",t.floorSF,"SF"),
                mkTotRow("Subfloor",t.subfloorSF,"SF"),
                (t.fcLF||t.fcSF||t.drywallCeiling||t.drywallWalls)?mkTotCat("🧱 Drywall","#6B21A8"):"",
                mkTotRow("Flood Cuts",t.fcLF,"LF"),
                mkTotRow("Flood Cuts (full wall)",t.fcSF,"SF"),
                mkTotRow("Drywall — Ceiling",t.drywallCeiling,"SF"),
                mkTotRow("Drywall — Walls",t.drywallWalls,"SF"),
                (t.drywallCeiling+t.drywallWalls)>0?mkTotRow("Drywall — TOTAL",t.drywallCeiling+t.drywallWalls,"SF"):"",
                t.insulationSF?mkTotCat("🌡️ Insulation","#0F766E"):"",
                mkTotRow("Insulation Removed",t.insulationSF,"SF"),
                (t.cabLF||t.countertopLF)?mkTotCat("🍽️ Cabinetry","#B45309"):"",
                mkTotRow("Cabinets",t.cabLF,"LF"),
                mkTotRow("Countertops",t.countertopLF,"LF"),
                (t.airMovers||t.dehus||t.scrubbers)?mkTotCat("💨 Drying Equipment","#1D4ED8"):"",
                mkTotRow("Air Movers",t.airMovers,"ea"),
                mkTotRow("Dehumidifiers",t.dehus,"ea"),
                mkTotRow("Air Scrubbers",t.scrubbers,"ea"),
              ].filter(Boolean).join("");
            })()}
          </tbody>
        </table>
      </div>
    </div>`;
  };

  const buildNoteText=()=>{
    const line=(label,val,unit)=>val>0?`  ${label}: ${typeof val==="number"?val.toLocaleString():val}${unit?" "+unit:""}\n`:"";
    const bool=(label,show)=>show?`  ${label}: Yes\n`:"";
    const displayDate=jobInfo.date?new Date(jobInfo.date+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"N/A";
    let out="";
    out+=`UTAH PROS RESTORATION — DEMOLITION SHEET\n`;
    out+=`${"=".repeat(44)}\n`;
    out+=`Date: ${displayDate}\n`;
    out+=`Technician: ${jobInfo.tech||"—"}\n`;
    out+=`Job #: ${jobInfo.jobNumber||"—"}\n`;
    out+=`Address: ${jobInfo.address||"—"}\n`;
    out+=`Floor Plan: ${hasSketchDone?"Encircle / DocuSketch":"No sketch — dimensions per room"}\n\n`;
    rooms.forEach((r,i)=>{
      const dim=(r.lengthFt&&r.widthFt&&r.heightFt)?` (${r.lengthFt}x${r.widthFt}x${r.heightFt}ft)`:"";
      out+=`ROOM ${i+1}: ${(r.name||"Unnamed").toUpperCase()}${dim}\n${"-".repeat(32)}\n`;
      if(r.contentsMoveHrs>0){out+=`Contents Move:\n`;out+=line("  Hours",r.contentsMoveHrs,"hrs");out+=line("  Techs",r.contentsTechs,"techs");}
      if(r.appliances===true&&r.appliancesList.length>0){out+=`Appliances:\n`;r.appliancesList.forEach(a=>{out+=`  ${a}\n`;});}
      if(r.fixtures===true){
        const hasF=r.toiletRemoved||r.registers>0||r.ceilingFans>0||r.lights>0||r.outletCoversCount>0;
        if(hasF){out+=`Plumbing & Fixtures:\n`;out+=bool("  Toilet — Remove",r.toiletRemoved);out+=line("  Registers",r.registers,"ea");out+=line("  Ceiling Fans",r.ceilingFans,"ea");out+=line("  Light Fixtures",r.lights,"ea");out+=line("  Outlet Covers",r.outletCoversCount,"ea");}
      }
      if(r.cabinets===true){
        if(r.cabinetsList.length>0||r.countertopLF>0||r.countertopSF>0||r.backsplashLF>0){
          out+=`Cabinetry & Countertops:\n`;
          r.cabinetsList.forEach(c=>{if(c.lf>0)out+=`  ${c.type}: ${c.lf} LF\n`;});
          if(r.countertopLF>0)out+=`  Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:""}: ${r.countertopLF} LF\n`;
          if(r.countertopSF>0)out+=`  Countertop${r.countertopMaterial?` (${r.countertopMaterial})`:""}: ${r.countertopSF} SF\n`;
          if(r.backsplashLF>0)out+=`  Backsplash${r.backsplashMaterial?` (${r.backsplashMaterial})`:""}: ${r.backsplashLF} LF\n`;
        }
      }
      const hasTrim=r.baseboardLF>0||r.casingLF>0||r.quarterRoundLF>0||(r.doors===true&&r.doorsList.length>0);
      if(hasTrim){
        out+=`Carpentry & Trim:\n`;
        out+=line("  Baseboard",r.baseboardLF,"LF");out+=line("  Door Casing",r.casingLF,"LF");out+=line("  Quarter Round",r.quarterRoundLF,"LF");
        if(r.doors===true)r.doorsList.forEach(d=>{if(d.detach>0)out+=`  ${d.type} Door — Detach: ${d.detach} ea\n`;if(d.tearOut>0)out+=`  ${d.type} Door — Tear Out: ${d.tearOut} ea\n`;});
      }
      const hasFloor=r.floors.some(f=>f.sf>0)||r.subfloorSF>0;
      if(hasFloor){
        out+=`Flooring:\n`;
        r.floors.filter(f=>f.sf>0).forEach(f=>{const t=f.type==="Other"?(f.typeOther||"Other"):f.type||"—";out+=`  ${t}: ${f.sf} SF\n`;});
        out+=line("  Subfloor",r.subfloorSF,"SF");
      }
      const hasDW=r.floodCuts===true||r.drywallCeilingSF>0||r.drywallWallsSF>0;
      if(hasDW){
        out+=`Drywall:\n`;
        if(r.floodCuts===true)r.floodCutsList.forEach(c=>{const u=c.height==="Full wall (SF)"?"SF":"LF";out+=`  Flood Cut (${c.height}): ${c.lf||0} ${u}\n`;});
        out+=line("  Ceiling",r.drywallCeilingSF,"SF");out+=line("  Walls",r.drywallWallsSF,"SF");
        if(r.drywallCeilingSF>0||r.drywallWallsSF>0)out+=`  Total: ${(r.drywallCeilingSF||0)+(r.drywallWallsSF||0)} SF\n`;
      }
      if(r.insulation===true&&r.insulationSF>0){out+=`Insulation:\n  ${r.insulationTypes.join(", ")||"—"}: ${r.insulationSF} SF\n`;}
      if(r.equipment===true&&r.equipmentList.length>0){out+=`Drying Equipment:\n`;r.equipmentList.forEach(e=>{out+=`  ${e.type}: ${e.qty} ea x ${e.days} days\n`;});}
      if(r.notes)out+=`Notes: ${r.notes}\n`;
      out+="\n";
    });
    const t=rooms.reduce((a,r)=>{
      const fcLF=r.floodCuts===true?r.floodCutsList.filter(c=>c.height!=="Full wall (SF)").reduce((s,c)=>s+(c.lf||0),0):0;
      const fcSF=r.floodCuts===true?r.floodCutsList.filter(c=>c.height==="Full wall (SF)").reduce((s,c)=>s+(c.lf||0),0):0;
      const cabLF=r.cabinets===true?r.cabinetsList.reduce((s,c)=>s+(c.lf||0),0):0;
      const floorSF=r.floors.reduce((s,f)=>s+(f.sf||0),0);
      const eqList=r.equipment===true?r.equipmentList:[];
      return {baseboardLF:a.baseboardLF+(r.baseboardLF||0),casingLF:a.casingLF+(r.casingLF||0),quarterRoundLF:a.quarterRoundLF+(r.quarterRoundLF||0),floorSF:a.floorSF+floorSF,subfloorSF:a.subfloorSF+(r.subfloorSF||0),fcLF:a.fcLF+fcLF,fcSF:a.fcSF+fcSF,drywallCeiling:a.drywallCeiling+(r.drywallCeilingSF||0),drywallWalls:a.drywallWalls+(r.drywallWallsSF||0),insulationSF:a.insulationSF+(r.insulation===true?(r.insulationSF||0):0),cabLF:a.cabLF+cabLF,countertopLF:a.countertopLF+(r.cabinets===true?(r.countertopLF||0):0),airMovers:a.airMovers+eqList.filter(e=>e.type==="Air Mover").reduce((s,e)=>s+(e.qty||0),0),dehus:a.dehus+eqList.filter(e=>e.type==="Dehumidifier").reduce((s,e)=>s+(e.qty||0),0),scrubbers:a.scrubbers+eqList.filter(e=>e.type==="Air Scrubber").reduce((s,e)=>s+(e.qty||0),0)};
    },{baseboardLF:0,casingLF:0,quarterRoundLF:0,floorSF:0,subfloorSF:0,fcLF:0,fcSF:0,drywallCeiling:0,drywallWalls:0,insulationSF:0,cabLF:0,countertopLF:0,airMovers:0,dehus:0,scrubbers:0});
    const tline=(l,v,u)=>v>0?`  ${l}: ${v.toLocaleString()} ${u}\n`:"";
    out+=`JOB TOTALS\n${"=".repeat(44)}\n`;
    out+=tline("Baseboard",t.baseboardLF,"LF");out+=tline("Door Casing",t.casingLF,"LF");out+=tline("Quarter Round",t.quarterRoundLF,"LF");
    out+=tline("Floor Covering",t.floorSF,"SF");out+=tline("Subfloor",t.subfloorSF,"SF");
    out+=tline("Flood Cuts",t.fcLF,"LF");out+=tline("Flood Cuts (full wall)",t.fcSF,"SF");
    out+=tline("Drywall Ceiling",t.drywallCeiling,"SF");out+=tline("Drywall Walls",t.drywallWalls,"SF");
    if(t.drywallCeiling+t.drywallWalls>0)out+=`  Drywall TOTAL: ${(t.drywallCeiling+t.drywallWalls).toLocaleString()} SF\n`;
    out+=tline("Insulation",t.insulationSF,"SF");out+=tline("Cabinets",t.cabLF,"LF");out+=tline("Countertops",t.countertopLF,"LF");
    out+=tline("Air Movers",t.airMovers,"ea");out+=tline("Dehumidifiers",t.dehus,"ea");out+=tline("Air Scrubbers",t.scrubbers,"ea");
    return out.trim();
  };

    const doSubmit=async()=>{
    setSending(true);
    setSubmitResult(null);
    const html = buildEmailHTML();
    const subject = `Demo Sheet — ${jobInfo.jobNumber||"No Job #"} | ${jobInfo.tech||"?"} | ${jobInfo.address||"No Address"}`;
    const fname = `Demo-Sheet-${jobInfo.jobNumber||"Job"}-${jobInfo.date||new Date().toISOString().split("T")[0]}.png`;
    let emailOk = false;
    let encircleOk = false;
    let encircleSkipped = !encircleLinked?.id;
    let errors = [];

    // Build tasks array — email always runs
    const tasks = [
      fetch("/.netlify/functions/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject,message:html})})
        .then(r=>{ emailOk=r.ok; if(!r.ok) errors.push("Email failed"); })
        .catch(()=>errors.push("Email failed")),
    ];

    // If Encircle job linked: render HTML to PDF via jsPDF+html2canvas, then upload
    if(!encircleSkipped){
      tasks.push(
        fetch("/.netlify/functions/encircle-upload",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            claim_id: encircleLinked.id,
            title: `Demo Sheet — ${jobInfo.jobNumber||"No Job #"} | ${jobInfo.tech||"?"}`,
            text: buildNoteText(),
          })
        })
        .then(r=>{ encircleOk=r.ok; if(!r.ok) errors.push("Encircle note failed"); })
        .catch(()=>errors.push("Encircle note failed"))
      );
    }

    await Promise.all(tasks);
    setSending(false);
    setSubmitResult({ emailOk, encircleOk, encircleSkipped, errors });
    setShowReview(false);
    setShowResult(true);
  };

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,paddingBottom:130}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}input,select,textarea{-webkit-appearance:none;appearance:none;}input:focus,select:focus,textarea:focus{border-color:#e07b20!important;outline:none;}input[type=date]::-webkit-calendar-picker-indicator{filter:${theme==="dark"?"invert(1) sepia(1) saturate(3) hue-rotate(5deg)":"none"};opacity:0.6;cursor:pointer;}button:active{opacity:0.7;transform:scale(0.97);}select option{background:${C.card};}::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px;}`}</style>

      {/* Header */}
      <div style={{background:C.headerBg,borderBottom:`1px solid ${C.border}`,padding:"14px 16px 12px",position:"sticky",top:0,zIndex:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:9,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:1}}>Utah Pros Restoration</div>
            <div style={{fontSize:18,fontWeight:800,letterSpacing:"-0.02em",color:C.text}}>Demo Sheet</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {rooms.length>0&&(
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:10,color:C.muted}}>Rooms</div>
                <div style={{fontSize:20,fontWeight:800,color:allComplete?C.green:C.accent}}>
                  {rooms.filter(r=>r.notesDone).length}<span style={{fontSize:13,color:C.muted,fontWeight:400}}>/{rooms.length}</span>
                </div>
              </div>
            )}
            <button onClick={()=>setTheme(t=>t==="light"?"dark":"light")} style={{background:C.cardAlt,border:`1.5px solid ${C.border}`,borderRadius:8,color:C.muted,fontSize:16,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              {theme==="light"?"🌙":"☀️"}
            </button>
          </div>
        </div>
      </div>

      <div style={{padding:"14px 13px 0"}}>
        {/* Job Info */}
        <div style={sCard}>
          {/* Header row with Encircle link status */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{fontSize:9,color:C.accent,textTransform:"uppercase",letterSpacing:"0.14em",fontWeight:800}}>Job Info</div>
            {encircleLinked
              ? <button onClick={()=>{ setEncircleLinked(null); setEncircleRooms([]); }} style={{fontSize:11,color:C.green,background:C.greenDim,border:`1px solid ${C.green}44`,borderRadius:20,padding:"4px 10px",cursor:"pointer",fontWeight:700}}>⛓ Encircle linked ✕</button>
              : <button onClick={()=>setShowEncircle(true)} style={{fontSize:11,color:C.muted,background:C.cardAlt,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>🔗 Link Encircle job</button>
            }
          </div>

          {/* Encircle linked banner */}
          {encircleLinked&&(
            <div style={{background:C.greenDim,border:`1.5px solid ${C.green}44`,borderRadius:8,padding:"10px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:18}}>✅</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.green}}>Encircle job linked</div>
                <div style={{fontSize:11,color:C.muted}}>{encircleLinked.policyholder_name}</div>
              </div>
            </div>
          )}

          <label style={sLabel}>Date</label>
          <input type="date" value={jobInfo.date} onChange={e=>setJob("date",e.target.value)} style={{...sInput,marginBottom:12}} />
          <label style={sLabel}>Technician</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:12}}>
            {TECHS.map(name=>(
              <button key={name} onClick={()=>setJob("tech",jobInfo.tech===name?"":name)} style={{background:jobInfo.tech===name?C.accentDim:C.input,border:`1.5px solid ${jobInfo.tech===name?C.accent:C.border}`,borderRadius:8,color:jobInfo.tech===name?C.accent:C.muted,fontSize:13,fontWeight:jobInfo.tech===name?700:400,padding:"13px 4px",cursor:"pointer"}}>{name}</button>
            ))}
          </div>

          {/* Insured Name */}
          <label style={sLabel}>Insured Name</label>
          <input value={jobInfo.insuredName} onChange={e=>setJob("insuredName",e.target.value)} placeholder="e.g. Chris and Michael Smith" style={{...sInput,marginBottom:12}} />

          <label style={sLabel}>Job #</label>
          <div style={{display:"flex",gap:7,marginBottom:12}}>
            <input value={jobInfo.jobNumber} onChange={e=>setJob("jobNumber",e.target.value)} placeholder="e.g. UPR-0042" style={{...sInput,flex:1}} />
            <button onClick={()=>setShowEncircle(true)} title="Search Encircle jobs" style={{background:encircleLinked?C.greenDim:C.cardAlt,border:`1.5px solid ${encircleLinked?C.green:C.border}`,borderRadius:8,color:encircleLinked?C.green:C.muted,fontSize:20,width:50,height:50,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              🔗
            </button>
          </div>

          <label style={sLabel}>Job Address</label>
          <div style={{display:"flex",gap:7,marginBottom:16}}>
            <AddressAutocomplete value={jobInfo.address} onChange={v=>setJob("address",v)} />
            <button onClick={getGPS} disabled={gpsStatus==="loading"} style={{background:gpsStatus==="done"?"#0f2a0f":C.input,border:`1.5px solid ${gpsStatus==="done"?C.green:gpsStatus==="error"?C.red:C.border}`,borderRadius:8,color:gpsStatus==="done"?C.green:gpsStatus==="error"?C.red:C.muted,fontSize:21,width:50,height:50,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {gpsStatus==="loading"?"⏳":gpsStatus==="error"?"✗":"📍"}
            </button>
          </div>
          <div style={{background:C.cardAlt,border:`1.5px solid ${hasSketchDone===null?C.red+"55":hasSketchDone?C.green+"66":C.accent+"66"}`,borderRadius:10,padding:"14px"}}>
            <div style={{fontSize:12,color:C.text,fontWeight:700,marginBottom:10,lineHeight:1.4}}>Was an Encircle floor plan or DocuSketch sketch completed for this property?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={()=>setHasSketchDone(false)} style={{background:hasSketchDone===false?"#2a1200":C.input,border:`1.5px solid ${hasSketchDone===false?C.accent:C.border}`,borderRadius:8,color:hasSketchDone===false?C.accent:C.muted,fontSize:13,fontWeight:hasSketchDone===false?700:400,padding:"13px",cursor:"pointer"}}>✗ No — enter dimensions</button>
              <button onClick={()=>setHasSketchDone(true)} style={{background:hasSketchDone===true?C.greenDim:C.input,border:`1.5px solid ${hasSketchDone===true?C.green:C.border}`,borderRadius:8,color:hasSketchDone===true?C.green:C.muted,fontSize:13,fontWeight:hasSketchDone===true?700:400,padding:"13px",cursor:"pointer"}}>✓ Yes — skip dimensions</button>
            </div>
            {hasSketchDone===null&&<div style={{fontSize:10,color:C.red,marginTop:6,textAlign:"center"}}>Answer required to continue</div>}
          </div>
        </div>

        {hasSketchDone!==null&&(
          <>
            {rooms.map((room,i)=>(
              <RoomCard key={room.id} room={room} index={i} onChange={u=>updateRoom(room.id,u)} onRemove={()=>removeRoom(room.id)} onDuplicate={()=>duplicateRoom(room.id)} totalRooms={rooms.length} needsDimensions={needsDimensions} encircleRooms={encircleRooms} encircleRoomsLoading={encircleRoomsLoading} />
            ))}
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.headerBg,borderTop:`1px solid ${C.border}`,padding:"11px 13px 15px",zIndex:30}}>
        <div style={{display:"flex",gap:9}}>
          <button onClick={addRoom} disabled={hasSketchDone===null} style={{flex:1,background:C.card,border:`1.5px solid ${C.border}`,borderRadius:10,color:hasSketchDone===null?C.muted:C.text,fontSize:14,fontWeight:600,padding:"14px",cursor:hasSketchDone===null?"default":"pointer",opacity:hasSketchDone===null?0.4:1}}>+ Room</button>
          <button onClick={()=>setShowReview(true)} disabled={hasSketchDone===null}
            style={{flex:3,background:hasSketchDone===null?"#1a1a1a":allComplete?C.green:C.accent,border:"none",borderRadius:10,color:hasSketchDone===null?C.muted:"#000",fontSize:15,fontWeight:800,padding:"14px",cursor:hasSketchDone===null?"default":"pointer",transition:"background 0.2s"}}>
            {allComplete?"✓ Review & Submit":"📋 Review & Submit"}
          </button>
        </div>
      </div>

      {/* Review screen */}
      {showReview&&(
        <ReviewScreen rooms={rooms} jobInfo={jobInfo} hasSketchDone={hasSketchDone} onBack={()=>setShowReview(false)} onSubmit={doSubmit} sending={sending} encircleLinked={encircleLinked} C={C} theme={theme} />
      )}
      {showResult&&submitResult&&(
        <ResultScreen result={submitResult} encircleLinked={encircleLinked} onBack={()=>{setShowResult(false);setShowReview(true);}} onStartNew={()=>{setRooms([defaultRoom()]);setJobInfo({date:today(),tech:"",jobNumber:"",address:"",insuredName:""});setHasSketchDone(null);setEncircleLinked(null);setEncircleRooms([]);setSubmitResult(null);setShowResult(false);}} />
      )}

      {/* Encircle job search */}
      {showEncircle&&(
        <EncircleSearchModal onSelect={handleEncircleSelect} onClose={()=>setShowEncircle(false)} />
      )}
    </div>
  );
}
