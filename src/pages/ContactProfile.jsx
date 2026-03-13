import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';

/* ═══ INLINE ICONS ═══ */
function IconBack(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6" /></svg>); }
function IconPhone(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.88.36 1.72.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.09.34 1.93.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>); }
function IconMail(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>); }
function IconBuilding(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>); }
function IconEdit(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>); }
function IconChevronDown(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 12 15 18 9" /></svg>); }
function IconMessageCircle(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>); }
function IconMapPin(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>); }
function IconShield(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>); }
function IconFileText(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>); }

/* ═══ CONSTANTS ═══ */
const ROLE_LABELS={homeowner:'Homeowner',adjuster:'Adjuster',subcontractor:'Subcontractor',property_manager:'Property Mgr',agent:'Agent',mortgage_co:'Mortgage Co',tenant:'Tenant',other:'Other',vendor:'Vendor',referral_partner:'Referral',insurance_rep:'Insurance Rep',broker:'Broker'};
const ROLE_COLORS={homeowner:{bg:'#dbeafe',text:'#1e40af'},adjuster:{bg:'#fce7f3',text:'#9d174d'},subcontractor:{bg:'#fef3c7',text:'#92400e'},vendor:{bg:'#d1fae5',text:'#065f46'},agent:{bg:'#ede9fe',text:'#6d28d9'},property_manager:{bg:'#e0e7ff',text:'#3730a3'},referral_partner:{bg:'#fef9c3',text:'#713f12'},insurance_rep:{bg:'#fce7f3',text:'#9d174d'},broker:{bg:'#f0fdf4',text:'#166534'},mortgage_co:{bg:'#f0f9ff',text:'#0c4a6e'},tenant:{bg:'#f5f5f4',text:'#44403c'},other:{bg:'var(--bg-tertiary)',text:'var(--text-secondary)'}};
const ROLE_OPTIONS=[{value:'homeowner',label:'Homeowner'},{value:'adjuster',label:'Adjuster'},{value:'subcontractor',label:'Subcontractor'},{value:'vendor',label:'Vendor'},{value:'agent',label:'Agent'},{value:'property_manager',label:'Property Manager'},{value:'referral_partner',label:'Referral Partner'},{value:'insurance_rep',label:'Insurance Rep'},{value:'broker',label:'Broker'},{value:'mortgage_co',label:'Mortgage Co'},{value:'tenant',label:'Tenant'},{value:'other',label:'Other'}];
const CONTACT_METHOD_OPTIONS=[{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const DIVISION_EMOJI={water:'\u{1F4A7}',mold:'\u{1F9A0}',reconstruction:'\u{1F3D7}\uFE0F'};
const CONV_STATUS_CLASS={needs_response:'needs-response',waiting_on_client:'waiting',resolved:'resolved',archived:'resolved'};
const EST_STATUS_CLASS={draft:'waiting',submitted:'active',approved:'resolved',denied:'needs-response',revised:'waiting',supplement:'active'};

/* ═══ HELPERS ═══ */
function getInitials(name){if(!name)return'?';const p=name.trim().split(/\s+/);return p.length===1?(p[0][0]?.toUpperCase()||'?'):(p[0][0]+p[p.length-1][0]).toUpperCase();}
function formatPhone(phone){if(!phone)return'\u2014';const d=phone.replace(/\D/g,'');if(d.length===11&&d[0]==='1')return`(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;if(d.length===10)return`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;return phone;}
function fmtDate(v){if(!v)return'\u2014';return new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function fmtDateTime(v){if(!v)return'\u2014';return new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function fmtCurrency(v){if(v==null)return'\u2014';return`$${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function relativeTime(iso){if(!iso)return'';const d=new Date(iso),now=new Date(),dd=Math.floor((now-d)/86400000);if(dd===0)return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});if(dd===1)return'Yesterday';if(dd<7)return d.toLocaleDateString('en-US',{weekday:'short'});return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function formatAddress(street,city,state,zip){const parts=[street,[city,state].filter(Boolean).join(', '),zip].filter(Boolean);return parts.join(', ')||null;}

/* ═══ MAIN ═══ */
export default function ContactProfile(){
  const{id}=useParams();const navigate=useNavigate();const{db}=useAuth();
  const[contact,setContact]=useState(null);const[loading,setLoading]=useState(true);
  const[activeTab,setActiveTab]=useState('conversations');const[editing,setEditing]=useState(false);const[saving,setSaving]=useState(false);
  const[conversations,setConversations]=useState([]);const[jobs,setJobs]=useState([]);const[estimates,setEstimates]=useState([]);
  const[invoices,setInvoices]=useState([]);const[payments,setPayments]=useState([]);const[consentLog,setConsentLog]=useState([]);
  const[editForm,setEditForm]=useState({});

  const resetEditForm=(c)=>setEditForm({name:c.name||'',phone:c.phone||'',phone_secondary:c.phone_secondary||'',email:c.email||'',company:c.company||'',role:c.role||'homeowner',preferred_contact_method:c.preferred_contact_method||'sms',billing_address:c.billing_address||'',billing_city:c.billing_city||'',billing_state:c.billing_state||'',billing_zip:c.billing_zip||'',property_address:c.property_address||'',property_city:c.property_city||'',property_state:c.property_state||'',property_zip:c.property_zip||'',insurance_carrier:c.insurance_carrier||'',policy_number:c.policy_number||'',claim_number:c.claim_number||'',referral_source:c.referral_source||'',notes:c.notes||'',tags:(c.tags||[]).join(', ')});

  const loadData=useCallback(async()=>{
    try{
      const cd=await db.select('contacts',`id=eq.${id}`);if(cd.length===0){navigate('/customers',{replace:true});return;}
      const c=cd[0];setContact(c);resetEditForm(c);
      const[convParts,contactJobs,invD,payD,conD]=await Promise.all([
        db.select('conversation_participants',`contact_id=eq.${id}&is_active=eq.true&select=conversation_id`).catch(()=>[]),
        db.select('contact_jobs',`contact_id=eq.${id}&select=job_id,role,is_primary`).catch(()=>[]),
        db.select('invoices',`contact_id=eq.${id}&order=invoice_date.desc.nullslast&select=id,invoice_number,invoice_date,status,original_total,adjusted_total,balance_due,job_id`).catch(()=>[]),
        db.select('payments',`contact_id=eq.${id}&order=payment_date.desc.nullslast&select=id,amount,payment_date,payment_method,payer_type,payer_name,reference_number`).catch(()=>[]),
        db.select('sms_consent_log',`contact_id=eq.${id}&order=created_at.desc&limit=50`).catch(()=>[]),]);
      if(convParts.length>0){const ids=convParts.map(p=>p.conversation_id);const cvD=await db.select('conversations',`id=in.(${ids.join(',')})&order=last_message_at.desc.nullslast&select=id,title,status,last_message_at,last_message_preview,unread_count,job_id`).catch(()=>[]);setConversations(cvD);}else setConversations([]);
      if(contactJobs.length>0){const jIds=contactJobs.map(cj=>cj.job_id);const[jD,eD]=await Promise.all([db.select('jobs',`id=in.(${jIds.join(',')})&order=created_at.desc&select=id,job_number,insured_name,phase,division,address,date_of_loss,created_at`).catch(()=>[]),db.select('estimates',`job_id=in.(${jIds.join(',')})&order=created_at.desc&select=id,job_id,estimate_number,estimate_type,status,amount,approved_amount,submitted_at,approved_at,denied_reason,pdf_url,notes`).catch(()=>[])]);const jm={};for(const cj of contactJobs)jm[cj.job_id]=cj;setJobs(jD.map(j=>({...j,_contactRole:jm[j.id]?.role,_isPrimary:jm[j.id]?.is_primary})));setEstimates(eD);}else{setJobs([]);setEstimates([]);}
      setInvoices(invD);setPayments(payD);setConsentLog(conD);
    }catch(err){console.error('ContactProfile load error:',err);}finally{setLoading(false);}
  },[db,id,navigate]);
  useEffect(()=>{loadData();},[loadData]);

  const handleSave=async()=>{setSaving(true);try{let ph=editForm.phone.replace(/\D/g,'');if(ph.length===10)ph='1'+ph;if(!ph.startsWith('+'))ph='+'+ph;let ps=editForm.phone_secondary.replace(/\D/g,'');if(ps&&ps.length===10)ps='1'+ps;if(ps&&!ps.startsWith('+'))ps='+'+ps;const tags=editForm.tags.split(',').map(t=>t.trim()).filter(Boolean);const update={name:editForm.name.trim()||null,phone:ph,phone_secondary:ps||null,email:editForm.email.trim()||null,company:editForm.company.trim()||null,role:editForm.role,preferred_contact_method:editForm.preferred_contact_method,billing_address:editForm.billing_address.trim()||null,billing_city:editForm.billing_city.trim()||null,billing_state:editForm.billing_state.trim()||null,billing_zip:editForm.billing_zip.trim()||null,property_address:editForm.property_address.trim()||null,property_city:editForm.property_city.trim()||null,property_state:editForm.property_state.trim()||null,property_zip:editForm.property_zip.trim()||null,insurance_carrier:editForm.insurance_carrier.trim()||null,policy_number:editForm.policy_number.trim()||null,claim_number:editForm.claim_number.trim()||null,referral_source:editForm.referral_source.trim()||null,notes:editForm.notes.trim()||null,tags:JSON.stringify(tags),updated_at:new Date().toISOString()};const r=await db.update('contacts',`id=eq.${id}`,update);if(r?.length>0){setContact(r[0]);resetEditForm(r[0]);}setEditing(false);}catch(err){alert('Failed to save: '+err.message);}finally{setSaving(false);}};

  const handleToggleDnd=async()=>{const nd=!contact.dnd;try{const u={dnd:nd,dnd_at:nd?new Date().toISOString():null,updated_at:new Date().toISOString()};await db.update('contacts',`id=eq.${id}`,u);setContact(prev=>({...prev,...u}));}catch(err){alert('DND update failed: '+err.message);}};

  const lifetimeValue=useMemo(()=>payments.reduce((s,p)=>s+Number(p.amount||0),0),[payments]);
  const outstandingBalance=useMemo(()=>invoices.reduce((s,inv)=>s+Number(inv.balance_due||0),0),[invoices]);
  const tabDefs=useMemo(()=>{const t=[{key:'conversations',label:'Conversations',count:conversations.length},{key:'jobs',label:'Jobs',count:jobs.length},{key:'estimates',label:'Estimates',count:estimates.length}];if(contact?.role==='homeowner'||invoices.length>0||payments.length>0)t.push({key:'financial',label:'Financial',count:invoices.length+payments.length});t.push({key:'activity',label:'Activity',count:consentLog.length});return t;},[contact,conversations,jobs,estimates,invoices,payments,consentLog]);

  if(loading)return<div className="loading-page"><div className="spinner"/></div>;if(!contact)return null;
  const roleColor=ROLE_COLORS[contact.role]||ROLE_COLORS.other;const roleLabel=ROLE_LABELS[contact.role]||contact.role;

  return(<PullToRefresh onRefresh={loadData}><div className="cp-page">
    <div className="cp-topbar"><button className="btn btn-ghost btn-sm" onClick={()=>navigate('/customers')}><IconBack style={{width:18,height:18}}/> Customers</button>{!editing&&<button className="btn btn-secondary btn-sm" onClick={()=>setEditing(true)}><IconEdit style={{width:14,height:14}}/> Edit</button>}</div>
    <div className="cp-header">{editing?<EditHeader form={editForm} setForm={setEditForm} onSave={handleSave} saving={saving} onCancel={()=>{setEditing(false);resetEditForm(contact);}}/>:<ViewHeader contact={contact} roleColor={roleColor} roleLabel={roleLabel} onToggleDnd={handleToggleDnd} lifetimeValue={lifetimeValue} outstandingBalance={outstandingBalance}/>}</div>
    <div className="cp-tabs">{tabDefs.map(t=><button key={t.key} className={`job-page-tab${activeTab===t.key?' active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}{t.count>0&&<span className="job-page-tab-count">{t.count}</span>}</button>)}</div>
    <div className="cp-content">
      {activeTab==='conversations'&&<ConversationsTab conversations={conversations} navigate={navigate}/>}
      {activeTab==='jobs'&&<JobsTab jobs={jobs} navigate={navigate}/>}
      {activeTab==='estimates'&&<EstimatesTab estimates={estimates} jobs={jobs}/>}
      {activeTab==='financial'&&<FinancialTab invoices={invoices} payments={payments} lifetimeValue={lifetimeValue} outstandingBalance={outstandingBalance}/>}
      {activeTab==='activity'&&<ActivityTab contact={contact} consentLog={consentLog}/>}
    </div>
  </div></PullToRefresh>);
}

/* ═══ VIEW HEADER ═══ */
function ViewHeader({contact,roleColor,roleLabel,onToggleDnd,lifetimeValue,outstandingBalance}){
  const billingAddr=formatAddress(contact.billing_address,contact.billing_city,contact.billing_state,contact.billing_zip);
  const propertyAddr=formatAddress(contact.property_address,contact.property_city,contact.property_state,contact.property_zip);
  const tags=contact.tags||[];
  return(<div className="cp-header-view">
    <div className="cp-header-top">
      <div className="cp-avatar-lg">{getInitials(contact.name)}</div>
      <div className="cp-header-info">
        <h1 className="cp-name">{contact.name||'Unknown'}</h1>
        {contact.company&&<div className="cp-company"><IconBuilding style={{width:13,height:13}}/> {contact.company}</div>}
        <div style={{display:'flex',gap:'var(--space-2)',flexWrap:'wrap',marginTop:4,alignItems:'center'}}>
          <span className="customer-role-tag" style={{background:roleColor.bg,color:roleColor.text}}>{roleLabel}</span>
          {contact.preferred_contact_method&&contact.preferred_contact_method!=='sms'&&<span className="cp-pref-badge">Prefers {contact.preferred_contact_method}</span>}
          <span className={`cp-opt-badge ${contact.opt_in_status?'opted-in':'opted-out'}`}>{contact.opt_in_status?'Opted In':'Not Opted In'}</span>
        </div>
        {tags.length>0&&<div className="cp-tags-row">{tags.map((t,i)=><span key={i} className="cp-tag">{t}</span>)}</div>}
      </div>
    </div>
    <div className="cp-header-grid">
      <div className="cp-header-section"><div className="cp-section-label">Contact</div><div className="cp-detail-rows">
        {contact.phone&&<InfoRow icon={<IconPhone/>} label="Phone" value={formatPhone(contact.phone)} href={`tel:${contact.phone}`}/>}
        {contact.phone_secondary&&<InfoRow icon={<IconPhone/>} label="Phone 2" value={formatPhone(contact.phone_secondary)} href={`tel:${contact.phone_secondary}`}/>}
        {contact.email&&<InfoRow icon={<IconMail/>} label="Email" value={contact.email} href={`mailto:${contact.email}`}/>}
      </div></div>
      {(billingAddr||propertyAddr)&&<div className="cp-header-section"><div className="cp-section-label">Addresses</div><div className="cp-detail-rows">
        {billingAddr&&<InfoRow icon={<IconMapPin/>} label="Billing" value={billingAddr}/>}
        {propertyAddr&&billingAddr!==propertyAddr&&<InfoRow icon={<IconMapPin/>} label="Property" value={propertyAddr}/>}
      </div></div>}
      {(contact.insurance_carrier||contact.policy_number||contact.claim_number)&&<div className="cp-header-section"><div className="cp-section-label">Insurance</div><div className="cp-detail-rows">
        {contact.insurance_carrier&&<InfoRow icon={<IconShield/>} label="Carrier" value={contact.insurance_carrier}/>}
        {contact.policy_number&&<InfoRow icon={<IconFileText/>} label="Policy" value={contact.policy_number} mono/>}
        {contact.claim_number&&<InfoRow icon={<IconFileText/>} label="Claim" value={contact.claim_number} mono/>}
      </div></div>}
      {(lifetimeValue>0||outstandingBalance>0)&&<div className="cp-header-section"><div className="cp-section-label">Financials</div><div className="cp-detail-rows">
        <InfoRow label="Lifetime Value" value={fmtCurrency(lifetimeValue)} valueColor="var(--status-resolved)"/>
        {outstandingBalance>0&&<InfoRow label="Outstanding" value={fmtCurrency(outstandingBalance)} valueColor="var(--status-waiting)"/>}
      </div></div>}
    </div>
    <div className="cp-header-footer">
      <div className="conv-dnd-row" style={{flex:'none'}}><div className="conv-dnd-info"><div className="conv-dnd-title">Do Not Disturb</div></div><button className={`conv-dnd-toggle${contact.dnd?' on':''}`} onClick={onToggleDnd}><div className="conv-dnd-knob"/></button></div>
      <div className="cp-timestamps"><span>Added {fmtDate(contact.created_at)}</span>{contact.referral_source&&<span>Referral: {contact.referral_source}</span>}</div>
      {contact.notes&&!/^\[DEMO\]$/.test(contact.notes)&&<div className="cp-notes-preview">{contact.notes}</div>}
    </div>
  </div>);
}

function InfoRow({icon,label,value,href,mono,valueColor}){
  const vs={color:valueColor||'var(--text-primary)',...(mono?{fontFamily:'var(--font-mono)'}:{})};
  const content=(<div className="cp-info-row">{icon&&<span className="cp-info-icon" style={{width:14,height:14,flexShrink:0}}>{icon}</span>}<span className="cp-info-label">{label}</span><span className="cp-info-value" style={vs}>{value}</span></div>);
  if(href)return<a href={href} className="cp-info-link">{content}</a>;return content;
}

/* ═══ EDIT HEADER ═══ */
function EditHeader({form,setForm,onSave,onCancel,saving}){
  const set=(f,v)=>setForm(prev=>({...prev,[f]:v}));const nameRef=useRef(null);useEffect(()=>{nameRef.current?.focus();},[]);
  const Field=({label,field,type='text',placeholder,span})=>(<div className="form-group" style={{flex:span||1,marginBottom:0}}><label className="label">{label}</label>{type==='textarea'?<textarea className="input textarea" value={form[field]} onChange={e=>set(field,e.target.value)} rows={2} placeholder={placeholder}/>:<input ref={field==='name'?nameRef:undefined} className="input" type={type} value={form[field]} onChange={e=>set(field,e.target.value)} placeholder={placeholder}/>}</div>);
  const Select=({label,field,options})=>(<div className="form-group" style={{flex:1,marginBottom:0}}><label className="label">{label}</label><select className="input" value={form[field]} onChange={e=>set(field,e.target.value)} style={{cursor:'pointer'}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>);
  return(<div className="cp-edit-form">
    <div className="cp-edit-section-label">Identity</div>
    <div className="cp-edit-row"><Field label="Name" field="name"/><Field label="Company" field="company"/></div>
    <div className="cp-edit-row"><Select label="Role" field="role" options={ROLE_OPTIONS}/><Select label="Preferred Contact" field="preferred_contact_method" options={CONTACT_METHOD_OPTIONS}/></div>
    <div className="cp-edit-section-label">Phone & Email</div>
    <div className="cp-edit-row"><Field label="Phone" field="phone" type="tel"/><Field label="Secondary Phone" field="phone_secondary" type="tel"/></div>
    <div className="cp-edit-row"><Field label="Email" field="email" type="email"/></div>
    <div className="cp-edit-section-label">Billing Address</div>
    <div className="cp-edit-row"><Field label="Street" field="billing_address"/></div>
    <div className="cp-edit-row"><Field label="City" field="billing_city"/><Field label="State" field="billing_state"/><Field label="ZIP" field="billing_zip"/></div>
    <div className="cp-edit-section-label">Property Address</div>
    <div className="cp-edit-row"><Field label="Street" field="property_address"/></div>
    <div className="cp-edit-row"><Field label="City" field="property_city"/><Field label="State" field="property_state"/><Field label="ZIP" field="property_zip"/></div>
    <div className="cp-edit-section-label">Insurance</div>
    <div className="cp-edit-row"><Field label="Carrier" field="insurance_carrier" placeholder="State Farm, Allstate..."/><Field label="Policy #" field="policy_number"/><Field label="Claim #" field="claim_number"/></div>
    <div className="cp-edit-section-label">Other</div>
    <div className="cp-edit-row"><Field label="Referral Source" field="referral_source" placeholder="Google, agent name..."/><Field label="Tags (comma-separated)" field="tags" placeholder="VIP, repeat, priority"/></div>
    <Field label="Notes" field="notes" type="textarea"/>
    <div className="cp-edit-actions"><button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button><button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving?'Saving...':'Save Changes'}</button></div>
  </div>);
}

/* ═══ CONVERSATIONS TAB ═══ */
function ConversationsTab({conversations,navigate}){
  if(conversations.length===0)return<div className="empty-state"><div className="empty-state-icon">💬</div><div className="empty-state-title">No conversations</div><div className="empty-state-text">Start a conversation from the Messages page.</div></div>;
  return(<div className="cp-conv-list">{conversations.map(conv=>(<div key={conv.id} className="cp-conv-card" onClick={()=>navigate('/conversations')}><div className="cp-conv-card-left"><div className="cp-conv-card-icon"><IconMessageCircle style={{width:18,height:18}}/></div><div className="cp-conv-card-body"><div className="cp-conv-card-top"><span className="cp-conv-card-title">{conv.title||'Conversation'}</span><span className="cp-conv-card-time">{relativeTime(conv.last_message_at)}</span></div><div className="cp-conv-card-preview">{conv.last_message_preview||'No messages yet'}</div></div></div><div className="cp-conv-card-right"><span className={`status-badge status-${CONV_STATUS_CLASS[conv.status]||'active'}`}>{conv.status?.replace(/_/g,' ')}</span>{conv.unread_count>0&&<span className="conv-unread-badge">{conv.unread_count}</span>}</div></div>))}</div>);
}

/* ═══ JOBS TAB ═══ */
function JobsTab({jobs,navigate}){
  if(jobs.length===0)return<div className="empty-state"><div className="empty-state-icon">🔧</div><div className="empty-state-title">No linked jobs</div><div className="empty-state-text">Jobs are linked when you associate this contact with a job.</div></div>;
  return(<div className="cp-jobs-list">{jobs.map(job=>(<div key={job.id} className="job-list-card" onClick={()=>navigate(`/jobs/${job.id}`)}><div className="job-list-card-icon">{DIVISION_EMOJI[job.division]||'\u{1F4C1}'}</div><div className="job-list-card-body"><div className="job-list-card-top"><span className="job-list-card-name">{job.insured_name||'Unknown'}</span>{job._isPrimary&&<span className="cp-primary-badge">Primary</span>}</div><div className="job-list-card-row"><span className="job-list-card-jobnumber">{job.job_number||'\u2014'}</span>{job.division&&<span className="division-badge" data-division={job.division}>{job.division}</span>}</div>{job.address&&<div className="job-list-card-address">{job.address}</div>}<div className="job-list-card-meta">{job.phase&&<span>{job.phase.replace(/_/g,' ')}</span>}{job.date_of_loss&&<span>Loss {fmtDate(job.date_of_loss)}</span>}</div></div><div className="job-list-card-chevron">{'\u203A'}</div></div>))}</div>);
}

/* ═══ ESTIMATES TAB — grouped by job ═══ */
function EstimatesTab({estimates,jobs}){
  const[expanded,setExpanded]=useState({});
  const grouped=useMemo(()=>{const g={};for(const e of estimates){if(!g[e.job_id])g[e.job_id]=[];g[e.job_id].push(e);}return g;},[estimates]);
  const jobMap=useMemo(()=>{const m={};for(const j of jobs)m[j.id]=j;return m;},[jobs]);
  useEffect(()=>{const e={};for(const jid of Object.keys(grouped))e[jid]=true;setExpanded(e);},[grouped]);
  const toggle=(jid)=>setExpanded(prev=>({...prev,[jid]:!prev[jid]}));
  if(estimates.length===0)return<div className="empty-state"><div className="empty-state-icon">📝</div><div className="empty-state-title">No estimates</div><div className="empty-state-text">Estimates linked to this contact's jobs will appear here.</div></div>;
  const totalEst=estimates.reduce((s,e)=>s+Number(e.amount||0),0);
  const totalApp=estimates.filter(e=>e.approved_amount!=null).reduce((s,e)=>s+Number(e.approved_amount||0),0);
  return(<div className="cp-estimates">
    <div className="cp-fin-summary" style={{marginBottom:'var(--space-5)'}}><div className="cp-fin-stat"><div className="cp-fin-stat-label">Total Estimated</div><div className="cp-fin-stat-value">{fmtCurrency(totalEst)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Total Approved</div><div className="cp-fin-stat-value" style={{color:totalApp>0?'var(--status-resolved)':'var(--text-tertiary)'}}>{totalApp>0?fmtCurrency(totalApp):'\u2014'}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Estimates</div><div className="cp-fin-stat-value">{estimates.length}</div></div></div>
    {Object.entries(grouped).map(([jobId,ests])=>{const job=jobMap[jobId];const isOpen=expanded[jobId];return(<div key={jobId} className="cp-est-group">
      <button className="cp-est-group-header" onClick={()=>toggle(jobId)}><div className="cp-est-group-left"><span className="cp-est-group-emoji">{DIVISION_EMOJI[job?.division]||'\u{1F4C1}'}</span><div><div className="cp-est-group-title">{job?.job_number||'Unknown Job'}</div><div className="cp-est-group-sub">{job?.insured_name||''} \u2014 {ests.length} estimate{ests.length!==1?'s':''}</div></div></div><IconChevronDown style={{width:18,height:18,transition:'transform 200ms ease',transform:isOpen?'rotate(180deg)':'rotate(0)'}}/></button>
      {isOpen&&<div className="cp-est-group-body">{ests.map(est=>{const sc=EST_STATUS_CLASS[est.status]||'active';return(<div key={est.id} className="cp-est-card"><div className="cp-est-card-left"><div className="cp-est-card-top"><span style={{fontFamily:'var(--font-mono)',fontWeight:600,fontSize:'var(--text-sm)'}}>{est.estimate_number||'\u2014'}</span><span className={`status-badge status-${sc}`}>{est.status}</span></div><div className="cp-est-card-type">{est.estimate_type?.replace(/_/g,' ')}</div>{est.submitted_at&&<div className="cp-est-card-meta">Submitted {fmtDate(est.submitted_at)}</div>}{est.approved_at&&<div className="cp-est-card-meta" style={{color:'var(--status-resolved)'}}>Approved {fmtDate(est.approved_at)}</div>}{est.denied_reason&&<div className="cp-est-card-meta" style={{color:'var(--status-needs-response)'}}>Denied: {est.denied_reason}</div>}{est.notes&&<div className="cp-est-card-meta">{est.notes}</div>}</div><div className="cp-est-card-right"><div className="cp-est-card-amount">{fmtCurrency(est.amount)}</div>{est.approved_amount!=null&&est.approved_amount!==est.amount&&<div className="cp-est-card-approved">Approved: {fmtCurrency(est.approved_amount)}</div>}</div></div>);})}</div>}
    </div>);})}
  </div>);
}

/* ═══ FINANCIAL TAB ═══ */
function FinancialTab({invoices,payments,lifetimeValue,outstandingBalance}){
  const totalInv=invoices.reduce((s,inv)=>s+Number(inv.adjusted_total||inv.original_total||0),0);
  return(<div className="cp-financial">
    <div className="cp-fin-summary"><div className="cp-fin-stat"><div className="cp-fin-stat-label">Invoiced</div><div className="cp-fin-stat-value">{fmtCurrency(totalInv)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Lifetime Paid</div><div className="cp-fin-stat-value" style={{color:'var(--status-resolved)'}}>{fmtCurrency(lifetimeValue)}</div></div><div className="cp-fin-stat"><div className="cp-fin-stat-label">Outstanding</div><div className="cp-fin-stat-value" style={{color:outstandingBalance>0?'var(--status-waiting)':'var(--text-primary)'}}>{fmtCurrency(outstandingBalance)}</div></div></div>
    <div className="cp-fin-section"><div className="job-page-section-title">Invoices</div>{invoices.length===0?<div className="cp-fin-empty">No invoices</div>:invoices.map(inv=>(<div key={inv.id} className="cp-fin-row"><div className="cp-fin-row-left"><span className="cp-fin-row-label" style={{fontFamily:'var(--font-mono)',fontWeight:600}}>#{inv.invoice_number||'\u2014'}</span><span className="cp-fin-row-date">{fmtDate(inv.invoice_date)}</span></div><div className="cp-fin-row-right"><span className="cp-fin-row-amount">{fmtCurrency(inv.adjusted_total||inv.original_total)}</span><span className={`status-badge status-${inv.status==='paid'?'resolved':inv.status==='overdue'?'needs-response':'waiting'}`}>{inv.status||'draft'}</span></div></div>))}</div>
    <div className="cp-fin-section"><div className="job-page-section-title">Payments</div>{payments.length===0?<div className="cp-fin-empty">No payments</div>:payments.map(p=>(<div key={p.id} className="cp-fin-row"><div className="cp-fin-row-left"><span className="cp-fin-row-label">{p.payer_name||p.payer_type||'Payment'}</span><span className="cp-fin-row-date">{fmtDate(p.payment_date)}</span></div><div className="cp-fin-row-right"><span className="cp-fin-row-amount" style={{color:'var(--status-resolved)'}}>+{fmtCurrency(p.amount)}</span>{p.payment_method&&<span style={{fontSize:'var(--text-xs)',color:'var(--text-tertiary)'}}>{p.payment_method}</span>}</div></div>))}</div>
  </div>);
}

/* ═══ ACTIVITY TAB ═══ */
function ActivityTab({contact,consentLog}){
  const timeline=useMemo(()=>{const items=[];for(const e of consentLog)items.push({id:e.id,type:'consent',date:e.created_at,event:e.event_type?.replace(/_/g,' ')||'Event',detail:e.details||'',source:e.source});items.push({id:'created',type:'system',date:contact.created_at,event:'Contact created',detail:contact.opt_in_source?`Source: ${contact.opt_in_source}`:''});if(contact.opt_in_at)items.push({id:'opt_in',type:'consent',date:contact.opt_in_at,event:'Opted in',detail:contact.opt_in_source?`via ${contact.opt_in_source}`:''});if(contact.opt_out_at)items.push({id:'opt_out',type:'consent',date:contact.opt_out_at,event:'Opted out',detail:contact.opt_out_reason||''});if(contact.dnd&&contact.dnd_at)items.push({id:'dnd',type:'dnd',date:contact.dnd_at,event:'DND enabled',detail:''});items.sort((a,b)=>new Date(b.date)-new Date(a.date));return items;},[contact,consentLog]);
  if(timeline.length===0)return<div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No activity</div><div className="empty-state-text">Consent changes and system events will appear here.</div></div>;
  return(<div className="cp-activity"><div className="job-page-timeline">{timeline.map(item=>(<div key={item.id} className={`job-page-timeline-item timeline-${item.type}`}><div className="job-page-timeline-dot"/><div className="job-page-timeline-content"><div className="job-page-timeline-header"><span className="job-page-timeline-author" style={{textTransform:'capitalize'}}>{item.event}</span><span className="job-page-timeline-time">{fmtDateTime(item.date)}</span></div>{item.detail&&<div className="job-page-timeline-text">{item.detail}</div>}{item.source&&<div className="job-page-timeline-text" style={{fontStyle:'italic'}}>Source: {item.source}</div>}</div></div>))}</div></div>);
}
