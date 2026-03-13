import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';

/* ═══ INLINE ICONS ═══ */
function IconBack(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}
function IconPhone(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);}
function IconMail(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);}
function IconBuilding(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconChevronDown(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 12 15 18 9"/></svg>);}
function IconMessageCircle(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);}
function IconMapPin(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>);}
function IconShield(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);}
function IconFileText(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>);}
function IconHome(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>);}

/* ═══ CONSTANTS ═══ */
const RL={homeowner:'Homeowner',adjuster:'Adjuster',subcontractor:'Subcontractor',property_manager:'Property Mgr',agent:'Agent',mortgage_co:'Mortgage Co',tenant:'Tenant',other:'Other',vendor:'Vendor',referral_partner:'Referral',insurance_rep:'Insurance Rep',broker:'Broker'};
const RC={homeowner:{bg:'#dbeafe',text:'#1e40af'},adjuster:{bg:'#fce7f3',text:'#9d174d'},subcontractor:{bg:'#fef3c7',text:'#92400e'},vendor:{bg:'#d1fae5',text:'#065f46'},agent:{bg:'#ede9fe',text:'#6d28d9'},property_manager:{bg:'#e0e7ff',text:'#3730a3'},referral_partner:{bg:'#fef9c3',text:'#713f12'},insurance_rep:{bg:'#fce7f3',text:'#9d174d'},broker:{bg:'#f0fdf4',text:'#166534'},mortgage_co:{bg:'#f0f9ff',text:'#0c4a6e'},tenant:{bg:'#f5f5f4',text:'#44403c'},other:{bg:'var(--bg-tertiary)',text:'var(--text-secondary)'}};
const ROLE_OPTIONS=[{value:'homeowner',label:'Homeowner'},{value:'adjuster',label:'Adjuster'},{value:'subcontractor',label:'Subcontractor'},{value:'vendor',label:'Vendor'},{value:'agent',label:'Agent'},{value:'property_manager',label:'Property Manager'},{value:'referral_partner',label:'Referral Partner'},{value:'insurance_rep',label:'Insurance Rep'},{value:'broker',label:'Broker'},{value:'mortgage_co',label:'Mortgage Co'},{value:'tenant',label:'Tenant'},{value:'other',label:'Other'}];
const CM_OPTIONS=[{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const DIV_E={water:'\u{1F4A7}',mold:'\u{1F9A0}',reconstruction:'\u{1F3D7}\uFE0F'};
const CSC={needs_response:'needs-response',waiting_on_client:'waiting',resolved:'resolved',archived:'resolved'};
const ESC={draft:'waiting',submitted:'active',approved:'resolved',denied:'needs-response',revised:'waiting',supplement:'active'};

/* ═══ HELPERS ═══ */
function getInitials(n){if(!n)return'?';const p=n.trim().split(/\s+/);return p.length===1?(p[0][0]?.toUpperCase()||'?'):(p[0][0]+p[p.length-1][0]).toUpperCase();}
function fmtPhone(ph){if(!ph)return'\u2014';const d=ph.replace(/\D/g,'');if(d.length===11&&d[0]==='1')return`(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;if(d.length===10)return`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;return ph;}
function fmtDate(v){if(!v)return'\u2014';return new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function fmtDT(v){if(!v)return'\u2014';return new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function fmtMoney(v){if(v==null)return'\u2014';return`$${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function relTime(iso){if(!iso)return'';const d=new Date(iso),now=new Date(),dd=Math.floor((now-d)/86400000);if(dd===0)return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});if(dd===1)return'Yesterday';if(dd<7)return d.toLocaleDateString('en-US',{weekday:'short'});return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function fmtAddr(street,city,state,zip){const p=[street,[city,state].filter(Boolean).join(', '),zip].filter(Boolean);return p.join(', ')||null;}

/* ═══ MAIN ═══ */
export default function ContactProfile(){
  const{id}=useParams();const nav=useNavigate();const{db}=useAuth();
  const[contact,setContact]=useState(null);const[loading,setLoading]=useState(true);
  const[tab,setTab]=useState('conversations');const[editing,setEditing]=useState(false);const[saving,setSaving]=useState(false);
  const[convos,setConvos]=useState([]);const[jobs,setJobs]=useState([]);const[estimates,setEstimates]=useState([]);
  const[invoices,setInvoices]=useState([]);const[payments,setPayments]=useState([]);const[consent,setConsent]=useState([]);
  const[ef,setEf]=useState({});

  const resetEf=(c)=>setEf({name:c.name||'',phone:c.phone||'',phone_secondary:c.phone_secondary||'',email:c.email||'',company:c.company||'',role:c.role||'homeowner',preferred_contact_method:c.preferred_contact_method||'sms',billing_address:c.billing_address||'',billing_city:c.billing_city||'',billing_state:c.billing_state||'',billing_zip:c.billing_zip||'',insurance_carrier:c.insurance_carrier||'',policy_number:c.policy_number||'',claim_number:c.claim_number||'',referral_source:c.referral_source||'',notes:c.notes||'',tags:(c.tags||[]).join(', ')});

  const load=useCallback(async()=>{
    try{
      const cd=await db.select('contacts',`id=eq.${id}`);if(cd.length===0){nav('/customers',{replace:true});return;}
      const c=cd[0];setContact(c);resetEf(c);
      const[cp,cj,inv,pay,con]=await Promise.all([
        db.select('conversation_participants',`contact_id=eq.${id}&is_active=eq.true&select=conversation_id`).catch(()=>[]),
        db.select('contact_jobs',`contact_id=eq.${id}&select=job_id,role,is_primary`).catch(()=>[]),
        db.select('invoices',`contact_id=eq.${id}&order=invoice_date.desc.nullslast&select=id,invoice_number,invoice_date,status,original_total,adjusted_total,balance_due,job_id`).catch(()=>[]),
        db.select('payments',`contact_id=eq.${id}&order=payment_date.desc.nullslast&select=id,amount,payment_date,payment_method,payer_type,payer_name,reference_number`).catch(()=>[]),
        db.select('sms_consent_log',`contact_id=eq.${id}&order=created_at.desc&limit=50`).catch(()=>[]),]);
      if(cp.length>0){const ids=cp.map(p=>p.conversation_id);setConvos(await db.select('conversations',`id=in.(${ids.join(',')})&order=last_message_at.desc.nullslast&select=id,title,status,last_message_at,last_message_preview,unread_count,job_id`).catch(()=>[]));} else setConvos([]);
      if(cj.length>0){const jIds=cj.map(x=>x.job_id);const[jD,eD]=await Promise.all([db.select('jobs',`id=in.(${jIds.join(',')})&order=created_at.desc&select=id,job_number,insured_name,phase,division,address,city,state,zip,date_of_loss,created_at`).catch(()=>[]),db.select('estimates',`job_id=in.(${jIds.join(',')})&order=created_at.desc&select=id,job_id,estimate_number,estimate_type,status,amount,approved_amount,submitted_at,approved_at,denied_reason,pdf_url,notes`).catch(()=>[])]);const jm={};for(const x of cj)jm[x.job_id]=x;setJobs(jD.map(j=>({...j,_cRole:jm[j.id]?.role,_isPrimary:jm[j.id]?.is_primary})));setEstimates(eD);} else{setJobs([]);setEstimates([]);}
      setInvoices(inv);setPayments(pay);setConsent(con);
    }catch(err){console.error('CP load:',err);}finally{setLoading(false);}
  },[db,id,nav]);
  useEffect(()=>{load();},[load]);

  const save=async()=>{setSaving(true);try{
    let ph=ef.phone.replace(/\D/g,'');if(ph.length===10)ph='1'+ph;if(!ph.startsWith('+'))ph='+'+ph;
    let ps=ef.phone_secondary.replace(/\D/g,'');if(ps&&ps.length===10)ps='1'+ps;if(ps&&!ps.startsWith('+'))ps='+'+ps;
    const tags=ef.tags.split(',').map(t=>t.trim()).filter(Boolean);
    const u={name:ef.name.trim()||null,phone:ph,phone_secondary:ps||null,email:ef.email.trim()||null,company:ef.company.trim()||null,role:ef.role,preferred_contact_method:ef.preferred_contact_method,billing_address:ef.billing_address.trim()||null,billing_city:ef.billing_city.trim()||null,billing_state:ef.billing_state.trim()||null,billing_zip:ef.billing_zip.trim()||null,insurance_carrier:ef.insurance_carrier.trim()||null,policy_number:ef.policy_number.trim()||null,claim_number:ef.claim_number.trim()||null,referral_source:ef.referral_source.trim()||null,notes:ef.notes.trim()||null,tags:JSON.stringify(tags),updated_at:new Date().toISOString()};
    const r=await db.update('contacts',`id=eq.${id}`,u);if(r?.length>0){setContact(r[0]);resetEf(r[0]);}setEditing(false);
  }catch(err){alert('Save failed: '+err.message);}finally{setSaving(false);}};

  const toggleDnd=async()=>{const nd=!contact.dnd;try{const u={dnd:nd,dnd_at:nd?new Date().toISOString():null,updated_at:new Date().toISOString()};await db.update('contacts',`id=eq.${id}`,u);setContact(p=>({...p,...u}));}catch(err){alert('DND failed: '+err.message);}};

  const ltv=useMemo(()=>payments.reduce((s,p)=>s+Number(p.amount||0),0),[payments]);
  const outstanding=useMemo(()=>invoices.reduce((s,i)=>s+Number(i.balance_due||0),0),[invoices]);
  const tabs=useMemo(()=>{const t=[{k:'conversations',l:'Conversations',c:convos.length},{k:'jobs',l:'Jobs',c:jobs.length},{k:'estimates',l:'Estimates',c:estimates.length}];if(contact?.role==='homeowner'||invoices.length>0||payments.length>0)t.push({k:'financial',l:'Financial',c:invoices.length+payments.length});t.push({k:'activity',l:'Activity',c:consent.length});return t;},[contact,convos,jobs,estimates,invoices,payments,consent]);

  if(loading)return<div className="loading-page"><div className="spinner"/></div>;if(!contact)return null;
  const rc=RC[contact.role]||RC.other;const rl=RL[contact.role]||contact.role;

  return(<PullToRefresh onRefresh={load}><div className="cp-page">
    <div className="cp-topbar"><button className="btn btn-ghost btn-sm" onClick={()=>nav('/customers')}><IconBack style={{width:18,height:18}}/> Customers</button>{!editing&&<button className="btn btn-secondary btn-sm" onClick={()=>setEditing(true)}><IconEdit style={{width:14,height:14}}/> Edit</button>}</div>
    <div className="cp-header">{editing?<EditHeader form={ef} setForm={setEf} onSave={save} saving={saving} onCancel={()=>{setEditing(false);resetEf(contact);}}/>:<ViewHeader contact={contact} rc={rc} rl={rl} onDnd={toggleDnd} ltv={ltv} outstanding={outstanding} jobs={jobs}/>}</div>
    <div className="cp-tabs">{tabs.map(t=><button key={t.k} className={`job-page-tab${tab===t.k?' active':''}`} onClick={()=>setTab(t.k)}>{t.l}{t.c>0&&<span className="job-page-tab-count">{t.c}</span>}</button>)}</div>
    <div className="cp-content">
      {tab==='conversations'&&<ConvTab convos={convos} nav={nav}/>}
      {tab==='jobs'&&<JobsTab jobs={jobs} nav={nav}/>}
      {tab==='estimates'&&<EstTab estimates={estimates} jobs={jobs}/>}
      {tab==='financial'&&<FinTab invoices={invoices} payments={payments} ltv={ltv} outstanding={outstanding}/>}
      {tab==='activity'&&<ActTab contact={contact} consent={consent}/>}
    </div>
  </div></PullToRefresh>);
}

/* ═══ VIEW HEADER ═══ */
function ViewHeader({contact,rc,rl,onDnd,ltv,outstanding,jobs}){
  const billingAddr=fmtAddr(contact.billing_address,contact.billing_city,contact.billing_state,contact.billing_zip);
  // Service addresses from jobs (deduplicated)
  const serviceAddrs=useMemo(()=>{const seen=new Set();const addrs=[];for(const j of jobs){const a=j.address;if(a&&!seen.has(a)){seen.add(a);addrs.push({address:a,jobNumber:j.job_number,division:j.division,jobId:j.id});}}return addrs;},[jobs]);
  const tags=contact.tags||[];
  const addrCount=(billingAddr?1:0)+serviceAddrs.length;

  return(<div className="cp-header-view">
    <div className="cp-header-top">
      <div className="cp-avatar-lg">{getInitials(contact.name)}</div>
      <div className="cp-header-info">
        <h1 className="cp-name">{contact.name||'Unknown'}</h1>
        {contact.company&&<div className="cp-company"><IconBuilding style={{width:13,height:13}}/> {contact.company}</div>}
        <div style={{display:'flex',gap:'var(--space-2)',flexWrap:'wrap',marginTop:4,alignItems:'center'}}>
          <span className="customer-role-tag" style={{background:rc.bg,color:rc.text}}>{rl}</span>
          {contact.preferred_contact_method&&contact.preferred_contact_method!=='sms'&&<span className="cp-pref-badge">Prefers {contact.preferred_contact_method}</span>}
          <span className={`cp-opt-badge ${contact.opt_in_status?'opted-in':'opted-out'}`}>{contact.opt_in_status?'Opted In':'Not Opted In'}</span>
        </div>
        {tags.length>0&&<div className="cp-tags-row">{tags.map((t,i)=><span key={i} className="cp-tag">{t}</span>)}</div>}
      </div>
    </div>
    <div className="cp-header-grid">
      {/* Contact details */}
      <div className="cp-header-section">
        <div className="cp-section-label">Contact</div>
        <div className="cp-detail-rows">
          {contact.phone&&<InfoRow icon={<IconPhone/>} label="Phone" value={fmtPhone(contact.phone)} href={`tel:${contact.phone}`}/>}
          {contact.phone_secondary&&<InfoRow icon={<IconPhone/>} label="Phone 2" value={fmtPhone(contact.phone_secondary)} href={`tel:${contact.phone_secondary}`}/>}
          {contact.email&&<InfoRow icon={<IconMail/>} label="Email" value={contact.email} href={`mailto:${contact.email}`}/>}
        </div>
      </div>

      {/* Addresses — billing (from contact) + service (from jobs) */}
      {addrCount>0&&<div className="cp-header-section">
        <div className="cp-section-label">{addrCount} Address{addrCount!==1?'es':''}</div>
        <div className="cp-detail-rows">
          {billingAddr&&<div className="cp-addr-row">
            <IconMapPin style={{width:14,height:14,flexShrink:0,color:'var(--text-tertiary)'}}/>
            <div className="cp-addr-text">{billingAddr}</div>
            <span className="cp-addr-tag billing">Billing</span>
          </div>}
          {serviceAddrs.map((sa,i)=>(
            <div key={i} className="cp-addr-row">
              <IconHome style={{width:14,height:14,flexShrink:0,color:'var(--text-tertiary)'}}/>
              <div className="cp-addr-text">
                {sa.address}
                {sa.jobNumber&&<span className="cp-addr-job">{sa.jobNumber}</span>}
              </div>
              <span className="cp-addr-tag service">Service</span>
            </div>
          ))}
        </div>
      </div>}

      {/* Insurance */}
      {(contact.insurance_carrier||contact.policy_number||contact.claim_number)&&<div className="cp-header-section">
        <div className="cp-section-label">Insurance</div>
        <div className="cp-detail-rows">
          {contact.insurance_carrier&&<InfoRow icon={<IconShield/>} label="Carrier" value={contact.insurance_carrier}/>}
          {contact.policy_number&&<InfoRow icon={<IconFileText/>} label="Policy" value={contact.policy_number} mono/>}
          {contact.claim_number&&<InfoRow icon={<IconFileText/>} label="Claim" value={contact.claim_number} mono/>}
        </div>
      </div>}

      {/* Financials */}
      {(ltv>0||outstanding>0)&&<div className="cp-header-section">
        <div className="cp-section-label">Financials</div>
        <div className="cp-detail-rows">
          <InfoRow label="Lifetime Value" value={fmtMoney(ltv)} valueColor="var(--status-resolved)"/>
          {outstanding>0&&<InfoRow label="Outstanding" value={fmtMoney(outstanding)} valueColor="var(--status-waiting)"/>}
        </div>
      </div>}
    </div>
    <div className="cp-header-footer">
      <div className="conv-dnd-row" style={{flex:'none'}}><div className="conv-dnd-info"><div className="conv-dnd-title">Do Not Disturb</div></div><button className={`conv-dnd-toggle${contact.dnd?' on':''}`} onClick={onDnd}><div className="conv-dnd-knob"/></button></div>
      <div className="cp-timestamps"><span>Added {fmtDate(contact.created_at)}</span>{contact.referral_source&&<span>Referral: {contact.referral_source}</span>}</div>
      {contact.notes&&!/^\[DEMO\]$/.test(contact.notes)&&<div className="cp-notes-preview">{contact.notes}</div>}
    </div>
  </div>);
}

function InfoRow({icon,label,value,href,mono,valueColor}){
  const vs={color:valueColor||'var(--text-primary)',...(mono?{fontFamily:'var(--font-mono)'}:{})};
  const c=(<div className="cp-info-row">{icon&&<span className="cp-info-icon" style={{width:14,height:14,flexShrink:0}}>{icon}</span>}<span className="cp-info-label">{label}</span><span className="cp-info-value" style={vs}>{value}</span></div>);
  if(href)return<a href={href} className="cp-info-link">{c}</a>;return c;
}

/* ═══ EDIT HEADER ═══ */
function EditHeader({form,setForm,onSave,onCancel,saving}){
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));const nr=useRef(null);useEffect(()=>{nr.current?.focus();},[]);
  const F=({label,field,type='text',placeholder,span})=>(<div className="form-group" style={{flex:span||1,marginBottom:0}}><label className="label">{label}</label>{type==='textarea'?<textarea className="input textarea" value={form[field]} onChange={e=>set(field,e.target.value)} rows={2} placeholder={placeholder}/>:<input ref={field==='name'?nr:undefined} className="input" type={type} value={form[field]} onChange={e=>set(field,e.target.value)} placeholder={placeholder}/>}</div>);
  const S=({label,field,options})=>(<div className="form-group" style={{flex:1,marginBottom:0}}><label className="label">{label}</label><select className="input" value={form[field]} onChange={e=>set(field,e.target.value)} style={{cursor:'pointer'}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>);
  return(<div className="cp-edit-form">
    <div className="cp-edit-section-label">Identity</div>
    <div className="cp-edit-row"><F label="Name" field="name"/><F label="Company" field="company"/></div>
    <div className="cp-edit-row"><S label="Role" field="role" options={ROLE_OPTIONS}/><S label="Preferred Contact" field="preferred_contact_method" options={CM_OPTIONS}/></div>
    <div className="cp-edit-section-label">Phone & Email</div>
    <div className="cp-edit-row"><F label="Phone" field="phone" type="tel"/><F label="Secondary Phone" field="phone_secondary" type="tel"/></div>
    <div className="cp-edit-row"><F label="Email" field="email" type="email"/></div>
    <div className="cp-edit-section-label">Billing Address</div>
    <div className="cp-edit-row"><F label="Street" field="billing_address"/></div>
    <div className="cp-edit-row"><F label="City" field="billing_city"/><F label="State" field="billing_state"/><F label="ZIP" field="billing_zip"/></div>
    <div className="cp-edit-section-label">Insurance</div>
    <div className="cp-edit-row"><F label="Carrier" field="insurance_carrier" placeholder="State Farm, Allstate..."/><F label="Policy #" field="policy_number"/><F label="Claim #" field="claim_number"/></div>
    <div className="cp-edit-section-label">Other</div>
    <div className="cp-edit-row"><F label="Referral Source" field="referral_source" placeholder="Google, agent name..."/><F label="Tags (comma-separated)" field="tags" placeholder="VIP, repeat, priority"/></div>
    <F label="Notes" field="notes" type="textarea"/>
    <div className="cp-edit-actions"><button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button><button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving?'Saving...':'Save Changes'}</button></div>
  </div>);
}

/* ═══ CONVERSATIONS ═══ */
function ConvTab({convos,nav}){
  if(!convos.length)return<div className="empty-state"><div className="empty-state-icon">💬</div><div className="empty-state-title">No conversations</div><div className="empty-state-text">Start a conversation from the Messages page.</div></div>;
  return(<div className="cp-conv-list">{convos.map(c=>(<div key={c.id} className="cp-conv-card" onClick={()=>nav('/conversations')}><div className="cp-conv-card-left"><div className="cp-conv-card-icon"><IconMessageCircle style={{width:18,height:18}}/></div><div className="cp-conv-card-body"><div className="cp-conv-card-top"><span className="cp-conv-card-title">{c.title||'Conversation'}</span><span className="cp-conv-card-time">{relTime(c.last_message_at)}</span></div><div className="cp-conv-card-preview">{c.last_message_preview||'No messages yet'}</div></div></div><div className="cp-conv-card-right"><span className={`status-badge status-${CSC[c.status]||'active'}`}>{c.status?.replace(/_/g,' ')}</span>{c.unread_count>0&&<span className="conv-unread-badge">{c.unread_count}</span>}</div></div>))}</div>);
}

/* ═══ JOBS ═══ */
function JobsTab({jobs,nav}){
  if(!jobs.length)return<div className="empty-state"><div className="empty-state-icon">🔧</div><div className="empty-state-title">No linked jobs</div><div className="empty-state-text">Jobs are linked when you associate this contact with a job.</div></div>;
  return(<div className="cp-jobs-list">{jobs.map(j=>(<div key={j.id} className="job-list-card" onClick={()=>nav(`/jobs/${j.id}`)}><div className="job-list-card-icon">{DIV_E[j.division]||'\u{1F4C1}'}</div><div className="job-list-card-body"><div className="job-list-card-top"><span className="job-list-card-name">{j.insured_name||'Unknown'}</span>{j._isPrimary&&<span className="cp-primary-badge">Primary</span>}</div><div className="job-list-card-row"><span className="job-list-card-jobnumber">{j.job_number||'\u2014'}</span>{j.division&&<span className="division-badge" data-division={j.division}>{j.division}</span>}</div>{j.address&&<div className="job-list-card-address">{j.address}</div>}<div className="job-list-card-meta">{j.phase&&<span>{j.phase.replace(/_/g,' ')}</span>}{j.date_of_loss&&<span>Loss {fmtDate(j.date_of_loss)}</span>}</div></div><div className="job-list-card-chevron">{'\u203A'}</div></div>))}</div>);
}

/* ═══ ESTIMATES — grouped by job ═══ */
function EstTab({estimates,jobs}){
  const[exp,setExp]=useState({});
  const grp=useMemo(()=>{const g={};for(const e of estimates){if(!g[e.job_id])g[e.job_id]=[];g[e.job_id].push(e);}return g;},[estimates]);
  const jm=useMemo(()=>{const m={};for(const j of jobs)m[j.id]=j;return m;},[jobs]);
  useEffect(()=>{const e={};for(const k of Object.keys(grp))e[k]=true;setExp(e);},[grp]);
  if(!estimates.length)return<div className="empty-state"><div className="empty-state-icon">📝</div><div className="empty-state-title">No estimates</div><div className="empty-state-text">Estimates linked to this contact's jobs will appear here.</div></div>;
  const tE=estimates.reduce((s,e)=>s+Number(e.amount||0),0);
  const tA=estimates.filter(e=>e.approved_amount!=null).reduce((s,e)=>s+Number(e.approved_amount||0),0);
  return(<div className="cp-estimates">
    <div className="cp-fin-summary" style={{marginBottom:'var(--space-5)'}}><div className="cp-fin-stat"><div className="cp-fin-stat-label">Total Estimated</div><div className="cp-fin-stat-value">{fmtMoney(tE)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Total Approved</div><div className="cp-fin-stat-value" style={{color:tA>0?'var(--status-resolved)':'var(--text-tertiary)'}}>{tA>0?fmtMoney(tA):'\u2014'}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Estimates</div><div className="cp-fin-stat-value">{estimates.length}</div></div></div>
    {Object.entries(grp).map(([jid,ests])=>{const j=jm[jid];const o=exp[jid];return(<div key={jid} className="cp-est-group">
      <button className="cp-est-group-header" onClick={()=>setExp(p=>({...p,[jid]:!p[jid]}))}><div className="cp-est-group-left"><span className="cp-est-group-emoji">{DIV_E[j?.division]||'\u{1F4C1}'}</span><div><div className="cp-est-group-title">{j?.job_number||'Unknown Job'}</div><div className="cp-est-group-sub">{j?.insured_name||''} \u2014 {ests.length} estimate{ests.length!==1?'s':''}</div></div></div><IconChevronDown style={{width:18,height:18,transition:'transform 200ms ease',transform:o?'rotate(180deg)':'rotate(0)'}}/></button>
      {o&&<div className="cp-est-group-body">{ests.map(e=>{const sc=ESC[e.status]||'active';return(<div key={e.id} className="cp-est-card"><div className="cp-est-card-left"><div className="cp-est-card-top"><span style={{fontFamily:'var(--font-mono)',fontWeight:600,fontSize:'var(--text-sm)'}}>{e.estimate_number||'\u2014'}</span><span className={`status-badge status-${sc}`}>{e.status}</span></div><div className="cp-est-card-type">{e.estimate_type?.replace(/_/g,' ')}</div>{e.submitted_at&&<div className="cp-est-card-meta">Submitted {fmtDate(e.submitted_at)}</div>}{e.approved_at&&<div className="cp-est-card-meta" style={{color:'var(--status-resolved)'}}>Approved {fmtDate(e.approved_at)}</div>}{e.denied_reason&&<div className="cp-est-card-meta" style={{color:'var(--status-needs-response)'}}>Denied: {e.denied_reason}</div>}{e.notes&&<div className="cp-est-card-meta">{e.notes}</div>}</div><div className="cp-est-card-right"><div className="cp-est-card-amount">{fmtMoney(e.amount)}</div>{e.approved_amount!=null&&e.approved_amount!==e.amount&&<div className="cp-est-card-approved">Approved: {fmtMoney(e.approved_amount)}</div>}</div></div>);})}</div>}
    </div>);})}
  </div>);
}

/* ═══ FINANCIAL ═══ */
function FinTab({invoices,payments,ltv,outstanding}){
  const tI=invoices.reduce((s,i)=>s+Number(i.adjusted_total||i.original_total||0),0);
  return(<div className="cp-financial">
    <div className="cp-fin-summary"><div className="cp-fin-stat"><div className="cp-fin-stat-label">Invoiced</div><div className="cp-fin-stat-value">{fmtMoney(tI)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Lifetime Paid</div><div className="cp-fin-stat-value" style={{color:'var(--status-resolved)'}}>{fmtMoney(ltv)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Outstanding</div><div className="cp-fin-stat-value" style={{color:outstanding>0?'var(--status-waiting)':'var(--text-primary)'}}>{fmtMoney(outstanding)}</div></div></div>
    <div className="cp-fin-section"><div className="job-page-section-title">Invoices</div>{!invoices.length?<div className="cp-fin-empty">No invoices</div>:invoices.map(i=>(<div key={i.id} className="cp-fin-row"><div className="cp-fin-row-left"><span className="cp-fin-row-label" style={{fontFamily:'var(--font-mono)',fontWeight:600}}>#{i.invoice_number||'\u2014'}</span><span className="cp-fin-row-date">{fmtDate(i.invoice_date)}</span></div><div className="cp-fin-row-right"><span className="cp-fin-row-amount">{fmtMoney(i.adjusted_total||i.original_total)}</span><span className={`status-badge status-${i.status==='paid'?'resolved':i.status==='overdue'?'needs-response':'waiting'}`}>{i.status||'draft'}</span></div></div>))}</div>
    <div className="cp-fin-section"><div className="job-page-section-title">Payments</div>{!payments.length?<div className="cp-fin-empty">No payments</div>:payments.map(p=>(<div key={p.id} className="cp-fin-row"><div className="cp-fin-row-left"><span className="cp-fin-row-label">{p.payer_name||p.payer_type||'Payment'}</span><span className="cp-fin-row-date">{fmtDate(p.payment_date)}</span></div><div className="cp-fin-row-right"><span className="cp-fin-row-amount" style={{color:'var(--status-resolved)'}}>+{fmtMoney(p.amount)}</span>{p.payment_method&&<span style={{fontSize:'var(--text-xs)',color:'var(--text-tertiary)'}}>{p.payment_method}</span>}</div></div>))}</div>
  </div>);
}

/* ═══ ACTIVITY ═══ */
function ActTab({contact,consent}){
  const tl=useMemo(()=>{const i=[];for(const e of consent)i.push({id:e.id,type:'consent',date:e.created_at,event:e.event_type?.replace(/_/g,' ')||'Event',detail:e.details||'',source:e.source});i.push({id:'created',type:'system',date:contact.created_at,event:'Contact created',detail:contact.opt_in_source?`Source: ${contact.opt_in_source}`:''});if(contact.opt_in_at)i.push({id:'opt_in',type:'consent',date:contact.opt_in_at,event:'Opted in',detail:contact.opt_in_source?`via ${contact.opt_in_source}`:''});if(contact.opt_out_at)i.push({id:'opt_out',type:'consent',date:contact.opt_out_at,event:'Opted out',detail:contact.opt_out_reason||''});if(contact.dnd&&contact.dnd_at)i.push({id:'dnd',type:'dnd',date:contact.dnd_at,event:'DND enabled',detail:''});i.sort((a,b)=>new Date(b.date)-new Date(a.date));return i;},[contact,consent]);
  if(!tl.length)return<div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No activity</div><div className="empty-state-text">Consent changes and system events will appear here.</div></div>;
  return(<div className="cp-activity"><div className="job-page-timeline">{tl.map(i=>(<div key={i.id} className={`job-page-timeline-item timeline-${i.type}`}><div className="job-page-timeline-dot"/><div className="job-page-timeline-content"><div className="job-page-timeline-header"><span className="job-page-timeline-author" style={{textTransform:'capitalize'}}>{i.event}</span><span className="job-page-timeline-time">{fmtDT(i.date)}</span></div>{i.detail&&<div className="job-page-timeline-text">{i.detail}</div>}{i.source&&<div className="job-page-timeline-text" style={{fontStyle:'italic'}}>Source: {i.source}</div>}</div></div>))}</div></div>);
}
