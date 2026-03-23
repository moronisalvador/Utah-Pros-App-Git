import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { LookupSelect } from '@/components/AddContactModal';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

/* ═══ ICONS ═══ */
function IconBack(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}
function IconPhone(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);}
function IconMail(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);}
function IconBuilding(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconChevronDown(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 12 15 18 9"/></svg>);}
function IconMsg(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);}
function IconMapPin(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>);}
function IconShield(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);}
function IconFile(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>);}
function IconHome(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>);}
function IconSms(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="12" y2="13"/></svg>);}

/* ═══ CONSTANTS ═══ */
const RL={homeowner:'Homeowner',adjuster:'Adjuster',subcontractor:'Subcontractor',property_manager:'Property Mgr',agent:'Agent',mortgage_co:'Mortgage Co',tenant:'Tenant',other:'Other',vendor:'Vendor',referral_partner:'Referral',insurance_rep:'Insurance Rep',broker:'Broker'};
const RC={homeowner:{bg:'#dbeafe',text:'#1e40af'},adjuster:{bg:'#fce7f3',text:'#9d174d'},subcontractor:{bg:'#fef3c7',text:'#92400e'},vendor:{bg:'#d1fae5',text:'#065f46'},agent:{bg:'#ede9fe',text:'#6d28d9'},property_manager:{bg:'#e0e7ff',text:'#3730a3'},referral_partner:{bg:'#fef9c3',text:'#713f12'},insurance_rep:{bg:'#fce7f3',text:'#9d174d'},broker:{bg:'#f0fdf4',text:'#166534'},mortgage_co:{bg:'#f0f9ff',text:'#0c4a6e'},tenant:{bg:'#f5f5f4',text:'#44403c'},other:{bg:'var(--bg-tertiary)',text:'var(--text-secondary)'}};
const RO=[{value:'homeowner',label:'Homeowner'},{value:'adjuster',label:'Adjuster'},{value:'subcontractor',label:'Subcontractor'},{value:'vendor',label:'Vendor'},{value:'agent',label:'Agent'},{value:'property_manager',label:'Property Manager'},{value:'referral_partner',label:'Referral Partner'},{value:'insurance_rep',label:'Insurance Rep'},{value:'broker',label:'Broker'},{value:'mortgage_co',label:'Mortgage Co'},{value:'tenant',label:'Tenant'},{value:'other',label:'Other'}];
const CMO=[{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const PTO=[{value:'due_on_receipt',label:'Due on Receipt'},{value:'net_15',label:'Net 15'},{value:'net_30',label:'Net 30'},{value:'net_45',label:'Net 45'},{value:'net_60',label:'Net 60'}];
const DE={water:'\u{1F4A7}',mold:'\u{1F9A0}',reconstruction:'\u{1F3D7}\uFE0F',fire:'\u{1F525}',contents:'\u{1F4E6}'};
const CSC={needs_response:'needs-response',waiting_on_client:'waiting',resolved:'resolved',archived:'resolved'};
const ESC={draft:'waiting',submitted:'active',approved:'resolved',denied:'needs-response',revised:'waiting',supplement:'active'};
const CLSC={open:'active',in_progress:'active',supplementing:'waiting',closed:'resolved',settled:'resolved',denied:'needs-response'};

/* ═══ HELPERS ═══ */
const gi=(n)=>{if(!n)return'?';const p=n.trim().split(/\s+/);return p.length===1?(p[0][0]?.toUpperCase()||'?'):(p[0][0]+p[p.length-1][0]).toUpperCase();};
const fp=(ph)=>{if(!ph)return'\u2014';const d=ph.replace(/\D/g,'');if(d.length===11&&d[0]==='1')return`(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;if(d.length===10)return`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;return ph;};
const fd=(v)=>v?new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'\u2014';
const fdt=(v)=>v?new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'\u2014';
const fm=(v)=>v==null?'\u2014':`$${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const rt=(iso)=>{if(!iso)return'';const d=new Date(iso),dd=Math.floor((new Date()-d)/86400000);if(dd===0)return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});if(dd===1)return'Yesterday';if(dd<7)return d.toLocaleDateString('en-US',{weekday:'short'});return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});};
const fa=(s,c,st,z)=>{const p=[s,[c,st].filter(Boolean).join(', '),z].filter(Boolean);return p.join(', ')||null;};

/* ═══ MAIN ═══ */
export default function ContactProfile(){
  const{id}=useParams();const nav=useNavigate();const{db}=useAuth();
  const[c,setC]=useState(null);const[loading,setLoading]=useState(true);
  const[tab,setTab]=useState('conversations');const[editing,setEditing]=useState(false);const[saving,setSaving]=useState(false);
  const[convos,setConvos]=useState([]);const[jobs,setJobs]=useState([]);const[ests,setEsts]=useState([]);
  const[invs,setInvs]=useState([]);const[pays,setPays]=useState([]);const[clog,setClog]=useState([]);
  const[claims,setClaims]=useState([]);const[claimJobs,setClaimJobs]=useState({});
  const[carriers,setCarriers]=useState([]);const[refSources,setRefSources]=useState([]);
  const[ef,setEf]=useState({});

  const rEf=(x)=>setEf({name:x.name||'',phone:x.phone||'',phone_secondary:x.phone_secondary||'',email:x.email||'',company:x.company||'',role:x.role||'homeowner',preferred_contact_method:x.preferred_contact_method||'sms',preferred_language:x.preferred_language||'en',billing_address:x.billing_address||'',billing_city:x.billing_city||'',billing_state:x.billing_state||'',billing_zip:x.billing_zip||'',insurance_carrier:x.insurance_carrier||'',policy_number:x.policy_number||'',referral_source:x.referral_source||'',notes:x.notes||'',tags:(x.tags||[]).join(', '),desk_phone:x.desk_phone||'',desk_extension:x.desk_extension||'',territory:x.territory||'',relationship_notes:x.relationship_notes||'',trade_specialty:x.trade_specialty||'',payment_terms:x.payment_terms||'net_30',coi_expiration:x.coi_expiration||'',w9_on_file:x.w9_on_file||false});

  const load=useCallback(async()=>{
    try{
      const cd=await db.select('contacts',`id=eq.${id}`);if(cd.length===0){nav('/customers',{replace:true});return;}
      const x=cd[0];setC(x);rEf(x);
      const[cp,cj,inv,pay,con,carD,refD]=await Promise.all([
        db.select('conversation_participants',`contact_id=eq.${id}&is_active=eq.true&select=conversation_id`).catch(()=>[]),
        db.select('contact_jobs',`contact_id=eq.${id}&select=job_id,role,is_primary`).catch(()=>[]),
        db.select('invoices',`contact_id=eq.${id}&order=invoice_date.desc.nullslast&select=id,invoice_number,invoice_date,status,original_total,adjusted_total,balance_due,job_id`).catch(()=>[]),
        db.select('payments',`contact_id=eq.${id}&order=payment_date.desc.nullslast&select=id,amount,payment_date,payment_method,payer_type,payer_name,reference_number`).catch(()=>[]),
        db.select('sms_consent_log',`contact_id=eq.${id}&order=created_at.desc&limit=50`).catch(()=>[]),
        db.rpc('get_insurance_carriers').catch(()=>[]),
        db.rpc('get_referral_sources').catch(()=>[])]);
      // Conversations
      if(cp.length>0){const ids=cp.map(p=>p.conversation_id);setConvos(await db.select('conversations',`id=in.(${ids.join(',')})&order=last_message_at.desc.nullslast&select=id,title,status,last_message_at,last_message_preview,unread_count,job_id`).catch(()=>[]));} else setConvos([]);
      // Jobs + estimates
      if(cj.length>0){const jI=cj.map(y=>y.job_id);const[jD,eD]=await Promise.all([db.select('jobs',`id=in.(${jI.join(',')})&order=created_at.desc&select=id,job_number,insured_name,phase,division,address,city,state,zip,date_of_loss,created_at,claim_id`).catch(()=>[]),db.select('estimates',`job_id=in.(${jI.join(',')})&order=created_at.desc&select=id,job_id,estimate_number,estimate_type,status,amount,approved_amount,submitted_at,approved_at,denied_reason,pdf_url,notes`).catch(()=>[])]);const jm={};for(const y of cj)jm[y.job_id]=y;setJobs(jD.map(j=>({...j,_cRole:jm[j.id]?.role,_isPrimary:jm[j.id]?.is_primary})));setEsts(eD);} else{setJobs([]);setEsts([]);}
      // Claims — homeowner sees their claims, adjuster sees claims they're assigned to
      const clFilter=x.role==='adjuster'?`adjuster_contact_id=eq.${id}`:`contact_id=eq.${id}`;
      const clD=await db.select('claims',`${clFilter}&order=date_of_loss.desc.nullslast`).catch(()=>[]);
      setClaims(clD);
      // Load jobs per claim
      if(clD.length>0){const clIds=clD.map(cl=>cl.id);const cjD=await db.select('jobs',`claim_id=in.(${clIds.join(',')})&select=id,job_number,insured_name,division,phase,address,claim_id`).catch(()=>[]);const cjMap={};for(const j of cjD){if(!cjMap[j.claim_id])cjMap[j.claim_id]=[];cjMap[j.claim_id].push(j);}setClaimJobs(cjMap);} else setClaimJobs({});
      setInvs(inv);setPays(pay);setClog(con);setCarriers(carD);setRefSources(refD);
    }catch(err){console.error('CP load:',err);}finally{setLoading(false);}
  },[db,id,nav]);
  useEffect(()=>{load();},[load]);

  const save=async()=>{setSaving(true);try{
    let ph=ef.phone.replace(/\D/g,'');if(ph.length===10)ph='1'+ph;if(ph.length>0&&!ph.startsWith('+'))ph='+'+ph;
    let ps=(ef.phone_secondary||'').replace(/\D/g,'');if(ps&&ps.length===10)ps='1'+ps;if(ps&&ps.length>0&&!ps.startsWith('+'))ps='+'+ps;
    let dp=(ef.desk_phone||'').replace(/\D/g,'');if(dp&&dp.length===10)dp='1'+dp;if(dp&&dp.length>0&&!dp.startsWith('+'))dp='+'+dp;
    const tags=ef.tags.split(',').map(t=>t.trim()).filter(Boolean);
    const u={name:ef.name.trim()||null,phone:ph,phone_secondary:ps||null,email:ef.email.trim()||null,company:ef.company.trim()||null,role:ef.role,preferred_contact_method:ef.preferred_contact_method,preferred_language:ef.preferred_language||'en',billing_address:ef.billing_address.trim()||null,billing_city:ef.billing_city.trim()||null,billing_state:ef.billing_state.trim()||null,billing_zip:ef.billing_zip.trim()||null,insurance_carrier:ef.insurance_carrier.trim()||null,policy_number:ef.policy_number.trim()||null,referral_source:ef.referral_source.trim()||null,notes:ef.notes.trim()||null,tags:JSON.stringify(tags),desk_phone:dp||null,desk_extension:ef.desk_extension?.trim()||null,territory:ef.territory?.trim()||null,relationship_notes:ef.relationship_notes?.trim()||null,trade_specialty:ef.trade_specialty?.trim()||null,payment_terms:ef.payment_terms||'net_30',coi_expiration:ef.coi_expiration||null,w9_on_file:ef.w9_on_file||false,updated_at:new Date().toISOString()};
    const r=await db.update('contacts',`id=eq.${id}`,u);if(r?.length>0){setC(r[0]);rEf(r[0]);}setEditing(false);
  }catch(err){errToast('Save failed: '+err.message);}finally{setSaving(false);}};

  const tDnd=async()=>{const nd=!c.dnd;try{const u={dnd:nd,dnd_at:nd?new Date().toISOString():null,updated_at:new Date().toISOString()};await db.update('contacts',`id=eq.${id}`,u);setC(p=>({...p,...u}));}catch(err){errToast('DND failed: '+err.message);}};

  const ltv=useMemo(()=>pays.reduce((s,p)=>s+Number(p.amount||0),0),[pays]);
  const out=useMemo(()=>invs.reduce((s,i)=>s+Number(i.balance_due||0),0),[invs]);
  const svcAddrs=useMemo(()=>{const seen=new Set(),a=[];for(const j of jobs){if(j.address&&!seen.has(j.address)){seen.add(j.address);a.push({address:j.address,jobNumber:j.job_number,division:j.division});}}return a;},[jobs]);
  const billingAddr=c?fa(c.billing_address,c.billing_city,c.billing_state,c.billing_zip):null;
  const addrCount=(billingAddr?1:0)+svcAddrs.length;

  const tabDefs=useMemo(()=>{const t=[{k:'conversations',l:'Conversations',n:convos.length},{k:'jobs',l:'Jobs',n:jobs.length},{k:'claims',l:'Claims',n:claims.length},{k:'estimates',l:'Estimates',n:ests.length}];if(c?.role==='homeowner'||invs.length>0||pays.length>0)t.push({k:'financial',l:'Financial',n:invs.length+pays.length});t.push({k:'activity',l:'Activity',n:clog.length});return t;},[c,convos,jobs,claims,ests,invs,pays,clog]);

  if(loading)return<div className="loading-page"><div className="spinner"/></div>;if(!c)return null;
  const rc=RC[c.role]||RC.other;const rl=RL[c.role]||c.role;const tags=c.tags||[];
  const isAdj=c.role==='adjuster';const isVendor=c.role==='vendor'||c.role==='subcontractor';

  return(<PullToRefresh onRefresh={load}><div className="cp-page">
    <div className="cp-topbar">
      <button className="btn btn-ghost btn-sm" onClick={()=>nav('/customers')}><IconBack style={{width:18,height:18}}/> Customers</button>
      <button className="btn btn-secondary btn-sm" onClick={()=>{if(editing){setEditing(false);rEf(c);}else setEditing(true);}}><IconEdit style={{width:14,height:14}}/> {editing?'Cancel':'Edit'}</button>
    </div>
    <div className="cp-body">
      {/* ════ LEFT SIDEBAR ════ */}
      <div className="cp-sidebar">
        {editing?<EditForm form={ef} setForm={setEf} onSave={save} onCancel={()=>{setEditing(false);rEf(c);}} saving={saving} role={c.role} carriers={carriers} refSources={refSources}/>:(<>
          {/* Identity */}
          <div className="cp-sidebar-section"><div className="cp-identity">
            <div className="cp-avatar-lg">{gi(c.name)}</div>
            <div><div className="cp-name">{c.name||'Unknown'}</div>
              {c.company&&<div className="cp-company"><IconBuilding style={{width:13,height:13}}/> {c.company}</div>}
              <div className="cp-badges">
                <span className="customer-role-tag" style={{background:rc.bg,color:rc.text}}>{rl}</span>
                {c.preferred_contact_method&&c.preferred_contact_method!=='sms'&&<span className="cp-pref-badge">Prefers {c.preferred_contact_method}</span>}
                {c.preferred_language&&c.preferred_language!=='en'&&<span className="cp-pref-badge">{c.preferred_language==='es'?'Spanish':c.preferred_language==='pt'?'Portuguese':c.preferred_language}</span>}
              </div>
            </div>
          </div></div>
          {/* Summary */}
          <div className="cp-sidebar-section"><div className="cp-section-label">Summary</div><div className="cp-summary-grid">
            <div className="cp-summary-stat"><div className="cp-summary-stat-label">Created</div><div className="cp-summary-stat-value">{fd(c.created_at)}</div></div>
            <div className="cp-summary-stat"><div className="cp-summary-stat-label">Lifetime value</div><div className="cp-summary-stat-value" style={{color:ltv>0?'var(--status-resolved)':undefined}}>{fm(ltv)}</div></div>
            <div className="cp-summary-stat"><div className="cp-summary-stat-label">Outstanding</div><div className="cp-summary-stat-value" style={{color:out>0?'var(--status-needs-response)':undefined}}>{fm(out)}</div></div>
            <div className="cp-summary-stat"><div className="cp-summary-stat-label">Claims</div><div className="cp-summary-stat-value">{claims.length}</div></div>
          </div></div>
          {/* Contact info */}
          <div className="cp-sidebar-section"><div className="cp-section-label">Contact info</div><div className="cp-detail-rows">
            {c.phone&&<div className="cp-sidebar-row"><IconPhone className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Phone</div><div className="cp-sidebar-row-value">{fp(c.phone)}</div></div><div className="cp-sidebar-row-actions"><a href={`tel:${c.phone}`} className="cp-sidebar-action" title="Call"><IconPhone style={{width:14,height:14}}/></a><a href={`sms:${c.phone}`} className="cp-sidebar-action" title="Text"><IconSms style={{width:14,height:14}}/></a></div></div>}
            {c.phone_secondary&&<div className="cp-sidebar-row"><IconPhone className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Phone 2</div><div className="cp-sidebar-row-value">{fp(c.phone_secondary)}</div></div></div>}
            {c.email&&<div className="cp-sidebar-row"><IconMail className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Email</div><a href={`mailto:${c.email}`} style={{color:'var(--accent)',fontSize:'var(--text-sm)'}}>{c.email}</a></div></div>}
          </div></div>
          {/* Adjuster-specific */}
          {isAdj&&(c.desk_phone||c.territory||c.relationship_notes)&&<div className="cp-sidebar-section"><div className="cp-section-label">Adjuster Details</div><div className="cp-detail-rows">
            {c.desk_phone&&<div className="cp-sidebar-row"><IconPhone className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Desk Phone</div><div className="cp-sidebar-row-value">{fp(c.desk_phone)}{c.desk_extension&&<span style={{color:'var(--text-tertiary)',marginLeft:4}}>ext. {c.desk_extension}</span>}</div></div></div>}
            {c.territory&&<div className="cp-sidebar-row"><IconMapPin className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Territory</div><div className="cp-sidebar-row-value">{c.territory}</div></div></div>}
            {c.insurance_carrier&&<div className="cp-sidebar-row"><IconShield className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Carrier</div><div className="cp-sidebar-row-value">{c.insurance_carrier}</div></div></div>}
            {c.relationship_notes&&<div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',padding:'var(--space-2) var(--space-3)',background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',marginTop:'var(--space-2)',whiteSpace:'pre-wrap'}}>{c.relationship_notes}</div>}
          </div></div>}
          {/* Vendor/Sub-specific */}
          {isVendor&&<div className="cp-sidebar-section"><div className="cp-section-label">{c.role==='vendor'?'Vendor':'Subcontractor'} Details</div><div className="cp-detail-rows">
            {c.trade_specialty&&<div className="cp-sidebar-row"><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Trade / Specialty</div><div className="cp-sidebar-row-value">{c.trade_specialty}</div></div></div>}
            {c.payment_terms&&<div className="cp-sidebar-row"><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Payment Terms</div><div className="cp-sidebar-row-value">{c.payment_terms.replace(/_/g,' ')}</div></div></div>}
            <div className="cp-sidebar-row"><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">W-9 on File</div><div className="cp-sidebar-row-value" style={{color:c.w9_on_file?'var(--status-resolved)':'var(--status-needs-response)'}}>{c.w9_on_file?'Yes':'No'}</div></div></div>
            {c.role==='subcontractor'&&<div className="cp-sidebar-row"><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">COI Expiration</div><div className="cp-sidebar-row-value" style={{color:c.coi_expiration&&new Date(c.coi_expiration)<new Date()?'var(--status-needs-response)':undefined}}>{c.coi_expiration?fd(c.coi_expiration):'Not on file'}</div></div></div>}
          </div></div>}
          {/* Comms prefs */}
          <div className="cp-sidebar-section"><div className="cp-section-label">Communication preferences</div><div className="cp-detail-rows" style={{gap:'var(--space-3)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div className="cp-sidebar-row-label">Text message consent</div><span className={`cp-opt-badge ${c.opt_in_status?'opted-in':'opted-out'}`}>{c.opt_in_status?'Opted in':'Not opted in'}</span></div></div>
            <div className="cp-dnd-row"><div><div className="cp-dnd-label">Do Not Disturb</div><div className="cp-dnd-sub">Block all outbound messages</div></div><button className={`conv-dnd-toggle${c.dnd?' on':''}`} onClick={tDnd}><div className="conv-dnd-knob"/></button></div>
          </div></div>
          {/* Addresses */}
          {addrCount>0&&<div className="cp-sidebar-section"><div className="cp-section-label">{addrCount} address{addrCount!==1?'es':''}</div><div className="cp-detail-rows">
            {billingAddr&&<div className="cp-addr-row"><IconMapPin style={{width:14,height:14,flexShrink:0,color:'var(--text-tertiary)',marginTop:2}}/><div className="cp-addr-text">{billingAddr}</div><span className="cp-addr-tag billing">Billing</span></div>}
            {svcAddrs.map((sa,i)=><div key={i} className="cp-addr-row"><IconHome style={{width:14,height:14,flexShrink:0,color:'var(--text-tertiary)',marginTop:2}}/><div className="cp-addr-text">{sa.address}{sa.jobNumber&&<span className="cp-addr-job">{sa.jobNumber}</span>}</div><span className="cp-addr-tag service">Service</span></div>)}
          </div></div>}
          {/* Insurance (non-adjuster) */}
          {!isAdj&&(c.insurance_carrier||c.policy_number)&&<div className="cp-sidebar-section"><div className="cp-section-label">Insurance</div><div className="cp-detail-rows">
            {c.insurance_carrier&&<div className="cp-sidebar-row"><IconShield className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Carrier</div><div className="cp-sidebar-row-value">{c.insurance_carrier}</div></div></div>}
            {c.policy_number&&<div className="cp-sidebar-row"><IconFile className="cp-sidebar-row-icon"/><div className="cp-sidebar-row-content"><div className="cp-sidebar-row-label">Policy #</div><div className="cp-sidebar-row-value mono">{c.policy_number}</div></div></div>}
          </div></div>}
          {/* Tags */}
          {tags.length>0&&<div className="cp-sidebar-section"><div className="cp-section-label">Tags</div><div className="cp-tags-row">{tags.map((t,i)=><span key={i} className="cp-tag">{t}</span>)}</div></div>}
          {c.referral_source&&<div className="cp-sidebar-section"><div className="cp-section-label">Lead source</div><div className="cp-sidebar-meta">{c.referral_source}</div></div>}
          {c.notes&&!/^\[DEMO\]$/.test(c.notes)&&<div className="cp-sidebar-section"><div className="cp-section-label">Notes</div><div className="cp-notes-preview">{c.notes}</div></div>}
        </>)}
      </div>
      {/* ════ RIGHT MAIN ════ */}
      <div className="cp-main">
        <div className="cp-tabs">{tabDefs.map(t=><button key={t.k} className={`job-page-tab${tab===t.k?' active':''}`} onClick={()=>setTab(t.k)}>{t.l}{t.n>0&&<span className="job-page-tab-count">{t.n}</span>}</button>)}</div>
        <div className="cp-content">
          {tab==='conversations'&&<ConvTab convos={convos} nav={nav}/>}
          {tab==='jobs'&&<JobsTab jobs={jobs} nav={nav}/>}
          {tab==='claims'&&<ClaimsTab claims={claims} claimJobs={claimJobs} nav={nav} role={c.role}/>}
          {tab==='estimates'&&<EstTab ests={ests} jobs={jobs}/>}
          {tab==='financial'&&<FinTab invs={invs} pays={pays} ltv={ltv} out={out}/>}
          {tab==='activity'&&<ActTab contact={c} clog={clog}/>}
        </div>
      </div>
    </div>
  </div></PullToRefresh>);
}

/* ═══ EDIT FORM ═══ */
function EditForm({form,setForm,onSave,onCancel,saving,role,carriers,refSources}){
  const s=(f,v)=>setForm(p=>({...p,[f]:v}));const nr=useRef(null);useEffect(()=>{nr.current?.focus();},[]);
  const F=({label,field,type='text',placeholder})=>(<div className="form-group" style={{flex:1,marginBottom:0}}><label className="label">{label}</label>{type==='textarea'?<textarea className="input textarea" value={form[field]||''} onChange={e=>s(field,e.target.value)} rows={2} placeholder={placeholder}/>:type==='checkbox'?<label style={{display:'flex',alignItems:'center',gap:'var(--space-2)',cursor:'pointer',fontSize:'var(--text-sm)'}}><input type="checkbox" checked={form[field]||false} onChange={e=>s(field,e.target.checked)} style={{width:16,height:16}}/>{placeholder||label}</label>:<input ref={field==='name'?nr:undefined} className="input" type={type} value={form[field]||''} onChange={e=>s(field,e.target.value)} placeholder={placeholder}/> }</div>);
  const Sel=({label,field,options})=>(<div className="form-group" style={{flex:1,marginBottom:0}}><label className="label">{label}</label><select className="input" value={form[field]||''} onChange={e=>s(field,e.target.value)} style={{cursor:'pointer'}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>);
  const isAdj=role==='adjuster';const isVS=role==='vendor'||role==='subcontractor';
  return(<div className="cp-edit-form">
    <div className="cp-edit-section-label" style={{marginTop:0}}>Identity</div>
    <div className="cp-edit-row"><F label="Name" field="name"/></div>
    <div className="cp-edit-row"><F label="Company" field="company"/></div>
    <div className="cp-edit-row"><Sel label="Preferred Contact" field="preferred_contact_method" options={CMO}/></div>
    <div className="cp-edit-section-label">Phone & Email</div>
    <div className="cp-edit-row"><F label="Phone" field="phone" type="tel"/></div>
    <div className="cp-edit-row"><F label="Phone 2" field="phone_secondary" type="tel"/></div>
    <div className="cp-edit-row"><F label="Email" field="email" type="email"/></div>
    {isAdj&&<><div className="cp-edit-section-label">Adjuster Details</div>
    <div className="cp-edit-row"><LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v=>s('insurance_carrier',v)} items={carriers} placeholder="Search carriers..."/></div>
    <div className="cp-edit-row"><F label="Desk Phone" field="desk_phone" type="tel"/></div>
    <div className="cp-edit-row"><F label="Extension" field="desk_extension"/></div>
    <div className="cp-edit-row"><F label="Territory" field="territory"/></div>
    <F label="Relationship Notes" field="relationship_notes" type="textarea"/></>}
    {isVS&&<><div className="cp-edit-section-label">{role==='vendor'?'Vendor':'Sub'} Details</div>
    <div className="cp-edit-row"><F label="Trade" field="trade_specialty"/></div>
    <div className="cp-edit-row"><Sel label="Payment Terms" field="payment_terms" options={PTO}/></div>
    <div className="cp-edit-row"><F label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received"/></div>
    {role==='subcontractor'&&<div className="cp-edit-row"><F label="COI Expiration" field="coi_expiration" type="date"/></div>}</>}
    {!isAdj&&<><div className="cp-edit-section-label">Billing Address</div>
    <div className="cp-edit-row"><F label="Street" field="billing_address"/></div>
    <div className="cp-edit-row"><F label="City" field="billing_city"/><F label="State" field="billing_state"/></div>
    <div className="cp-edit-row"><F label="ZIP" field="billing_zip"/></div>
    <div className="cp-edit-section-label">Insurance</div>
    <div className="cp-edit-row"><LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v=>s('insurance_carrier',v)} items={carriers} placeholder="Search carriers..."/><F label="Policy #" field="policy_number"/></div></>}
    <div className="cp-edit-section-label">Other</div>
    <div className="cp-edit-row"><LookupSelect label="Referral Source" value={form.referral_source} onChange={v=>s('referral_source',v)} items={refSources} placeholder="Search sources..."/></div>
    <div className="cp-edit-row"><F label="Tags" field="tags" placeholder="VIP, repeat"/></div>
    <F label="Notes" field="notes" type="textarea"/>
    <div className="cp-edit-actions"><button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button><button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving?'Saving...':'Save'}</button></div>
  </div>);
}

/* ═══ CLAIMS TAB ═══ */
function ClaimsTab({claims,claimJobs,nav,role}){
  if(!claims.length)return<div className="empty-state"><div className="empty-state-icon">{'\u{1F4C4}'}</div><div className="empty-state-title">No claims</div><div className="empty-state-text">{role==='adjuster'?'Claims assigned to this adjuster will appear here.':'Insurance claims for this contact will appear here.'}</div></div>;
  return(<div className="cp-claims-list">{claims.map(cl=>{
    const sc=CLSC[cl.status]||'active';const cjobs=claimJobs[cl.id]||[];
    return(<div key={cl.id} className="cp-claim-card">
      <div className="cp-claim-header">
        <div className="cp-claim-header-left">
          <span className="cp-claim-number">{cl.claim_number}</span>
          <span className={`status-badge status-${sc}`}>{cl.status?.replace(/_/g,' ')}</span>
        </div>
        {cl.deductible>0&&<span className="cp-claim-deductible">Ded: {fm(cl.deductible)}</span>}
      </div>
      <div className="cp-claim-meta">
        {cl.insurance_carrier&&<span><IconShield style={{width:12,height:12}}/> {cl.insurance_carrier}</span>}
        {cl.date_of_loss&&<span>Loss: {fd(cl.date_of_loss)}</span>}
        {cl.loss_type&&<span>{cl.loss_type}</span>}
        {cl.policy_number&&<span>Policy: {cl.policy_number}</span>}
      </div>
      {cl.loss_address&&<div className="cp-claim-address"><IconMapPin style={{width:12,height:12}}/> {cl.loss_address}</div>}
      {cl.notes&&<div className="cp-claim-notes">{cl.notes}</div>}
      {/* Linked jobs */}
      {cjobs.length>0&&<div className="cp-claim-jobs">
        <div className="cp-claim-jobs-label">{cjobs.length} Job{cjobs.length!==1?'s':''}</div>
        {cjobs.map(j=>(<div key={j.id} className="cp-claim-job" onClick={()=>nav(`/jobs/${j.id}`)}>
          <span className="cp-claim-job-emoji">{DE[j.division]||'\u{1F4C1}'}</span>
          <span className="cp-claim-job-num">{j.job_number||'\u2014'}</span>
          {j.division&&<span className="division-badge" data-division={j.division}>{j.division}</span>}
          {j.phase&&<span style={{fontSize:'var(--text-xs)',color:'var(--text-tertiary)'}}>{j.phase.replace(/_/g,' ')}</span>}
          <span style={{marginLeft:'auto',color:'var(--text-tertiary)',fontSize:16}}>{'\u203A'}</span>
        </div>))}
      </div>}
    </div>);
  })}</div>);
}

/* ═══ CONVERSATIONS ═══ */
function ConvTab({convos,nav}){
  if(!convos.length)return<div className="empty-state"><div className="empty-state-icon">{'\u{1F4AC}'}</div><div className="empty-state-title">No conversations</div><div className="empty-state-text">Start a conversation from the Messages page.</div></div>;
  return(<div className="cp-conv-list">{convos.map(cv=>(<div key={cv.id} className="cp-conv-card" onClick={()=>nav('/conversations')}><div className="cp-conv-card-left"><div className="cp-conv-card-icon"><IconMsg style={{width:18,height:18}}/></div><div className="cp-conv-card-body"><div className="cp-conv-card-top"><span className="cp-conv-card-title">{cv.title||'Conversation'}</span><span className="cp-conv-card-time">{rt(cv.last_message_at)}</span></div><div className="cp-conv-card-preview">{cv.last_message_preview||'No messages yet'}</div></div></div><div className="cp-conv-card-right"><span className={`status-badge status-${CSC[cv.status]||'active'}`}>{cv.status?.replace(/_/g,' ')}</span>{cv.unread_count>0&&<span className="conv-unread-badge">{cv.unread_count}</span>}</div></div>))}</div>);
}

/* ═══ JOBS ═══ */
function JobsTab({jobs,nav}){
  if(!jobs.length)return<div className="empty-state"><div className="empty-state-icon">{'\u{1F527}'}</div><div className="empty-state-title">No linked jobs</div><div className="empty-state-text">Jobs are linked when you associate this contact with a job.</div></div>;
  return(<div className="cp-jobs-list">{jobs.map(j=>(<div key={j.id} className="job-list-card" onClick={()=>nav(`/jobs/${j.id}`)}><div className="job-list-card-icon">{DE[j.division]||'\u{1F4C1}'}</div><div className="job-list-card-body"><div className="job-list-card-top"><span className="job-list-card-name">{j.insured_name||'Unknown'}</span>{j._isPrimary&&<span className="cp-primary-badge">Primary</span>}</div><div className="job-list-card-row"><span className="job-list-card-jobnumber">{j.job_number||'\u2014'}</span>{j.division&&<span className="division-badge" data-division={j.division}>{j.division}</span>}</div>{j.address&&<div className="job-list-card-address">{j.address}</div>}<div className="job-list-card-meta">{j.phase&&<span>{j.phase.replace(/_/g,' ')}</span>}{j.date_of_loss&&<span>Loss {fd(j.date_of_loss)}</span>}</div></div><div className="job-list-card-chevron">{'\u203A'}</div></div>))}</div>);
}

/* ═══ ESTIMATES (grouped by job) ═══ */
function EstTab({ests,jobs}){
  const[exp,setExp]=useState({});const grp=useMemo(()=>{const g={};for(const e of ests){if(!g[e.job_id])g[e.job_id]=[];g[e.job_id].push(e);}return g;},[ests]);const jm=useMemo(()=>{const m={};for(const j of jobs)m[j.id]=j;return m;},[jobs]);
  useEffect(()=>{const e={};for(const k of Object.keys(grp))e[k]=true;setExp(e);},[grp]);
  if(!ests.length)return<div className="empty-state"><div className="empty-state-icon">{'\u{1F4DD}'}</div><div className="empty-state-title">No estimates</div><div className="empty-state-text">Estimates linked to this contact's jobs will appear here.</div></div>;
  const tE=ests.reduce((s,e)=>s+Number(e.amount||0),0);const tA=ests.filter(e=>e.approved_amount!=null).reduce((s,e)=>s+Number(e.approved_amount||0),0);
  return(<div className="cp-estimates"><div className="cp-fin-summary" style={{marginBottom:'var(--space-5)'}}><div className="cp-fin-stat"><div className="cp-fin-stat-label">Total Estimated</div><div className="cp-fin-stat-value">{fm(tE)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Total Approved</div><div className="cp-fin-stat-value" style={{color:tA>0?'var(--status-resolved)':'var(--text-tertiary)'}}>{tA>0?fm(tA):'\u2014'}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Count</div><div className="cp-fin-stat-value">{ests.length}</div></div></div>
    {Object.entries(grp).map(([jid,es])=>{const j=jm[jid];const o=exp[jid];return(<div key={jid} className="cp-est-group"><button className="cp-est-group-header" onClick={()=>setExp(p=>({...p,[jid]:!p[jid]}))}><div className="cp-est-group-left"><span className="cp-est-group-emoji">{DE[j?.division]||'\u{1F4C1}'}</span><div><div className="cp-est-group-title">{j?.job_number||'Unknown'}</div><div className="cp-est-group-sub">{j?.insured_name||''} \u2014 {es.length} est.</div></div></div><IconChevronDown style={{width:18,height:18,transition:'transform 200ms ease',transform:o?'rotate(180deg)':'rotate(0)'}}/></button>
      {o&&<div className="cp-est-group-body">{es.map(e=>{const sc=ESC[e.status]||'active';return(<div key={e.id} className="cp-est-card"><div className="cp-est-card-left"><div className="cp-est-card-top"><span style={{fontFamily:'var(--font-mono)',fontWeight:600,fontSize:'var(--text-sm)'}}>{e.estimate_number||'\u2014'}</span><span className={`status-badge status-${sc}`}>{e.status}</span></div><div className="cp-est-card-type">{e.estimate_type?.replace(/_/g,' ')}</div>{e.submitted_at&&<div className="cp-est-card-meta">Submitted {fd(e.submitted_at)}</div>}{e.approved_at&&<div className="cp-est-card-meta" style={{color:'var(--status-resolved)'}}>Approved {fd(e.approved_at)}</div>}{e.denied_reason&&<div className="cp-est-card-meta" style={{color:'var(--status-needs-response)'}}>Denied: {e.denied_reason}</div>}</div><div className="cp-est-card-right"><div className="cp-est-card-amount">{fm(e.amount)}</div>{e.approved_amount!=null&&e.approved_amount!==e.amount&&<div className="cp-est-card-approved">Approved: {fm(e.approved_amount)}</div>}</div></div>);})}</div>}</div>);})}
  </div>);
}

/* ═══ FINANCIAL ═══ */
function FinTab({invs,pays,ltv,out}){
  const tI=invs.reduce((s,i)=>s+Number(i.adjusted_total||i.original_total||0),0);
  return(<div className="cp-financial"><div className="cp-fin-summary"><div className="cp-fin-stat"><div className="cp-fin-stat-label">Invoiced</div><div className="cp-fin-stat-value">{fm(tI)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Lifetime Paid</div><div className="cp-fin-stat-value" style={{color:'var(--status-resolved)'}}>{fm(ltv)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Outstanding</div><div className="cp-fin-stat-value" style={{color:out>0?'var(--status-waiting)':'var(--text-primary)'}}>{fm(out)}</div></div></div>
    <div className="cp-fin-section"><div className="job-page-section-title">Invoices</div>{!invs.length?<div className="cp-fin-empty">No invoices</div>:invs.map(i=>(<div key={i.id} className="cp-fin-row"><div className="cp-fin-row-left"><span className="cp-fin-row-label" style={{fontFamily:'var(--font-mono)',fontWeight:600}}>#{i.invoice_number||'\u2014'}</span><span className="cp-fin-row-date">{fd(i.invoice_date)}</span></div><div className="cp-fin-row-right"><span className="cp-fin-row-amount">{fm(i.adjusted_total||i.original_total)}</span><span className={`status-badge status-${i.status==='paid'?'resolved':i.status==='overdue'?'needs-response':'waiting'}`}>{i.status||'draft'}</span></div></div>))}</div>
    <div className="cp-fin-section"><div className="job-page-section-title">Payments</div>{!pays.length?<div className="cp-fin-empty">No payments</div>:pays.map(p=>(<div key={p.id} className="cp-fin-row"><div className="cp-fin-row-left"><span className="cp-fin-row-label">{p.payer_name||p.payer_type||'Payment'}</span><span className="cp-fin-row-date">{fd(p.payment_date)}</span></div><div className="cp-fin-row-right"><span className="cp-fin-row-amount" style={{color:'var(--status-resolved)'}}>+{fm(p.amount)}</span>{p.payment_method&&<span style={{fontSize:'var(--text-xs)',color:'var(--text-tertiary)'}}>{p.payment_method}</span>}</div></div>))}</div>
  </div>);
}

/* ═══ ACTIVITY ═══ */
function ActTab({contact,clog}){
  const tl=useMemo(()=>{const i=[];for(const e of clog)i.push({id:e.id,type:'consent',date:e.created_at,event:e.event_type?.replace(/_/g,' ')||'Event',detail:e.details||'',source:e.source});i.push({id:'created',type:'system',date:contact.created_at,event:'Contact created',detail:contact.opt_in_source?`Source: ${contact.opt_in_source}`:''});if(contact.opt_in_at)i.push({id:'opt_in',type:'consent',date:contact.opt_in_at,event:'Opted in',detail:''});if(contact.opt_out_at)i.push({id:'opt_out',type:'consent',date:contact.opt_out_at,event:'Opted out',detail:contact.opt_out_reason||''});if(contact.dnd&&contact.dnd_at)i.push({id:'dnd',type:'dnd',date:contact.dnd_at,event:'DND enabled',detail:''});i.sort((a,b)=>new Date(b.date)-new Date(a.date));return i;},[contact,clog]);
  if(!tl.length)return<div className="empty-state"><div className="empty-state-icon">{'\u{1F4CB}'}</div><div className="empty-state-title">No activity</div><div className="empty-state-text">Consent changes and system events will appear here.</div></div>;
  return(<div className="cp-activity"><div className="job-page-timeline">{tl.map(i=>(<div key={i.id} className={`job-page-timeline-item timeline-${i.type}`}><div className="job-page-timeline-dot"/><div className="job-page-timeline-content"><div className="job-page-timeline-header"><span className="job-page-timeline-author" style={{textTransform:'capitalize'}}>{i.event}</span><span className="job-page-timeline-time">{fdt(i.date)}</span></div>{i.detail&&<div className="job-page-timeline-text">{i.detail}</div>}{i.source&&<div className="job-page-timeline-text" style={{fontStyle:'italic'}}>Source: {i.source}</div>}</div></div>))}</div></div>);
}
