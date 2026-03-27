import { useState, useEffect } from 'react';
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { LookupSelect } from '@/components/AddContactModal';
import AddRelatedJobModal from '@/components/AddRelatedJobModal';
import CreateJobModal from '@/components/CreateJobModal';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

function IconPhone(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);}
function IconMail(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);}
function IconMsg(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconJob(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>);}function IconDots(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>);}

const DIVISION_EMOJI={water:'\u{1F4A7}',mold:'\u{1F9A0}',reconstruction:'\u{1F3D7}\uFE0F',fire:'\u{1F525}',contents:'\u{1F4E6}'};
// DIVISION_COLORS imported from DivisionIcons above
const ROLE_LABELS={homeowner:'Homeowner',tenant:'Tenant',property_manager:'Property Manager'};
const CMO=[{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const ADDR_LABELS=[{value:'billing',label:'Billing'},{value:'service',label:'Service'},{value:'loss',label:'Loss Location'},{value:'mailing',label:'Mailing'},{value:'other',label:'Other'}];
const PHASE_STYLES={
  job_received:{label:'Received',bg:'#fff7ed',color:'#ea580c'},mitigation_in_progress:{label:'Mitigation',bg:'#eff6ff',color:'#2563eb'},
  drying:{label:'Drying',bg:'#eff6ff',color:'#2563eb'},monitoring:{label:'Monitoring',bg:'#eff6ff',color:'#2563eb'},
  reconstruction_in_progress:{label:'In Progress',bg:'#eff6ff',color:'#2563eb'},reconstruction_punch_list:{label:'Punch List',bg:'#fef9c3',color:'#a16207'},
  completed:{label:'Completed',bg:'#ecfdf5',color:'#10b981'},closed:{label:'Closed',bg:'#f1f3f5',color:'#6b7280'},
  invoiced:{label:'Invoiced',bg:'#f0f9ff',color:'#0369a1'},paid:{label:'Paid',bg:'#ecfdf5',color:'#059669'},
};
function getPS(p){return PHASE_STYLES[p]||{label:p?.replace(/_/g,' ')||'\u2014',bg:'#f1f3f5',color:'#6b7280'};}
function fmtPh(phone){if(!phone)return'';const d=phone.replace(/\D/g,'');const n=d.startsWith('1')?d.slice(1):d;if(n.length===10)return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;return phone;}

/* ═══════════════════════════════════════════════════
   TILE EDIT BUTTON — pencil icon per section
   ═══════════════════════════════════════════════════ */
function TileHeader({title,editing,onEdit,onSave,onCancel,saving,children}){
  return(
    <div className="job-page-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <span>{title}</span>
      <div style={{display:'flex',gap:'var(--space-2)',alignItems:'center'}}>
        {children}
        {!editing?(
          <button className="btn btn-ghost btn-sm" onClick={onEdit} style={{width:26,height:26,padding:0,color:'var(--text-tertiary)'}} title="Edit">
            <IconEdit style={{width:13,height:13}}/>
          </button>
        ):(
          <>
            <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{height:26,fontSize:11}}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving} style={{height:26,fontSize:11}}>{saving?'...':'Save'}</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function CustomerPage(){
  const{contactId}=useParams();const navigate=useNavigate();const{db}=useAuth();
  const[data,setData]=useState(null);const[loading,setLoading]=useState(true);
  const[activeTab,setActiveTab]=useState('overview');const[carriers,setCarriers]=useState([]);const[employees,setEmployees]=useState([]);
  const[addRelatedSource,setAddRelatedSource]=useState(null);
  const[showCreateJob,setShowCreateJob]=useState(false);

  useEffect(()=>{loadData();},[contactId]);
  const loadData=async()=>{
    setLoading(true);
    try{
      const result=await db.rpc('get_customer_detail',{p_contact_id:contactId});
      if(!result?.contact){navigate('/customers',{replace:true});return;}
      setData(result);
      db.select('insurance_carriers','order=name.asc&select=id,name,short_name').then(setCarriers).catch(()=>{});
      db.select('employees','is_active=eq.true&order=full_name.asc&select=id,full_name,role').then(setEmployees).catch(()=>{});
    }catch(err){console.error('Customer load:',err);}finally{setLoading(false);}
  };

  const fmtDate=v=>{if(!v)return'\u2014';return new Date(v+(v.includes('T')?'':'T00:00:00')).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});};
  const fmtC=v=>{if(v==null)return'$0';return`$${Number(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}`;};
  const fmtC2=v=>{if(v==null)return'\u2014';return`$${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;};

  if(loading)return<div className="loading-page"><div className="spinner"/></div>;
  if(!data)return null;

  const c=data.contact;const claims=data.claims||[];const fin=data.financials||{};const files=data.files||[];
  const activity=data.activity||[];const addresses=data.addresses||[];
  const initials=c.name?c.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2):'?';
  const totalJobs=claims.reduce((s,cl)=>s+(cl.jobs?.length||0),0);
  const TABS=[{key:'overview',label:'Overview'},{key:'claims',label:'Claims & Jobs',count:totalJobs},{key:'financial',label:'Financial'},{key:'files',label:'Files',count:files.length},{key:'activity',label:'Activity',count:activity.length}];

  return(
    <div className="job-page">
      <div className="job-page-topbar"><button className="btn btn-ghost btn-sm" onClick={()=>navigate('/customers')} style={{gap:4}}>{'\u2190'} Customers</button></div>
      <div className="job-page-header">
        <div className="job-page-header-left">
          <div className="customer-card-avatar" style={{width:48,height:48,fontSize:16}}>{initials}</div>
          <div>
            <div className="job-page-client" style={{fontSize:'var(--text-xl)'}}>{c.name}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:2}}>
              <span className="customer-card-role-badge">{ROLE_LABELS[c.role]||c.role}</span>
              {c.dnd&&<span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,background:'#fef2f2',color:'#ef4444'}}>DND</span>}
              <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{totalJobs} job{totalJobs!==1?'s':''} · {claims.length} claim{claims.length!==1?'s':''}</span>
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:'var(--space-2)'}}>
          {c.phone&&<a href={`tel:${c.phone}`} className="customer-action-btn"><IconPhone style={{width:16,height:16}}/>Call</a>}
          {c.phone&&<button className="customer-action-btn" onClick={()=>navigate('/conversations')}><IconMsg style={{width:16,height:16}}/>Text</button>}
          {c.email&&<a href={`mailto:${c.email}`} className="customer-action-btn"><IconMail style={{width:16,height:16}}/>Email</a>}
          <button className="customer-action-btn" onClick={()=>setShowCreateJob(true)}><IconJob style={{width:16,height:16}}/>New Job</button>
        </div>
      </div>
      <div className="job-page-tabs">{TABS.map(tab=>(
        <button key={tab.key} className={`job-page-tab${activeTab===tab.key?' active':''}`} onClick={()=>setActiveTab(tab.key)}>
          {tab.label}{tab.count>0&&<span className="job-page-tab-count">{tab.count}</span>}
        </button>
      ))}</div>
      <PullToRefresh onRefresh={loadData} className="job-page-content">
        {activeTab==='overview'&&<OverviewTab contact={c} fmtDate={fmtDate} carriers={carriers} addresses={addresses} db={db} contactId={contactId} onReload={loadData}/>}
        {activeTab==='claims'&&<ClaimsTab claims={claims} fmtDate={fmtDate} fmtC={fmtC} onNav={id=>navigate(`/jobs/${id}`)} onAddRelated={(j,cl,s)=>setAddRelatedSource({job:j,claimData:cl,siblings:s})}/>}
        {activeTab==='financial'&&<FinancialTab fin={fin} claims={claims} fmtC2={fmtC2} onNav={id=>navigate(`/jobs/${id}`)}/>}
        {activeTab==='files'&&<FilesTab files={files}/>}
        {activeTab==='activity'&&<ActivityTab activity={activity}/>}
      </PullToRefresh>
      {addRelatedSource&&<AddRelatedJobModal sourceJob={addRelatedSource.job} claimData={addRelatedSource.claimData} siblingJobs={addRelatedSource.siblings} employees={employees} db={db} onClose={()=>setAddRelatedSource(null)} onCreated={r=>{setAddRelatedSource(null);if(r?.job?.id)navigate(`/jobs/${r.job.id}`);}}/>}
      {showCreateJob&&<CreateJobModal db={db} onClose={()=>setShowCreateJob(false)} prefillContact={c} onCreated={r=>{setShowCreateJob(false);if(r?.job?.id)navigate(`/jobs/${r.job.id}`);else loadData();}}/>}
    </div>
  );
}

/* ═══ OVERVIEW TAB — per-tile editing ═══ */
function OverviewTab({contact,fmtDate,carriers,addresses,db,contactId,onReload}){
  const c=contact;
  return(
    <div className="job-page-grid">
      <ContactInfoTile contact={c} db={db} contactId={contactId} onReload={onReload}/>
      <AddressSection addresses={addresses} db={db} contactId={contactId} onReload={onReload}/>
      <InsuranceTile contact={c} db={db} contactId={contactId} carriers={carriers} onReload={onReload}/>
      {c.tags&&Array.isArray(c.tags)&&c.tags.length>0&&(
        <div className="job-page-section"><div className="job-page-section-title">Tags</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'var(--space-1)'}}>{c.tags.map((t,i)=><span key={i} style={{fontSize:11,fontWeight:600,padding:'2px 10px',borderRadius:99,background:'var(--bg-tertiary)',color:'var(--text-secondary)'}}>{t}</span>)}</div>
        </div>
      )}
      <NotesTile contact={c} db={db} contactId={contactId} onReload={onReload}/>
      <div className="job-page-section job-page-section-full" style={{opacity:0.5}}><IR label="Created" value={fmtDate(c.created_at)}/><IR label="Updated" value={fmtDate(c.updated_at)}/></div>
    </div>
  );
}

/* ═══ CONTACT INFO TILE ═══ */
function ContactInfoTile({contact,db,contactId,onReload}){
  const c=contact;
  const[ed,setEd]=useState(false);const[saving,setSaving]=useState(false);
  const[f,sF]=useState({});
  const startEdit=()=>{sF({name:c.name||'',phone:fmtPh(c.phone),email:c.email||'',company:c.company||'',preferred_contact_method:c.preferred_contact_method||'sms',referral_source:c.referral_source||''});setEd(true);};
  const save=async()=>{
    if(!f.name?.trim())return;setSaving(true);
    try{
      let ph=f.phone.replace(/\D/g,'');
      if(ph.length===10)ph='1'+ph;
      if(ph.length>0&&!ph.startsWith('+'))ph='+'+ph;
      await db.update('contacts',`id=eq.${contactId}`,{name:f.name.trim(),phone:ph||null,email:f.email?.trim()||null,company:f.company?.trim()||null,preferred_contact_method:f.preferred_contact_method,referral_source:f.referral_source?.trim()||null,updated_at:new Date().toISOString()});
      setEd(false);onReload();
    }catch(err){errToast('Failed: '+err.message);}finally{setSaving(false);}
  };
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));

  return(
    <div className="job-page-section">
      <TileHeader title="Contact Information" editing={ed} onEdit={startEdit} onCancel={()=>setEd(false)} onSave={save} saving={saving}/>
      {ed?(
        <>
          <EF label="Name" value={f.name} onChange={v=>s('name',v)} required/>
          <EF label="Phone" value={f.phone} onChange={v=>s('phone',v)} type="tel"/>
          <EF label="Email" value={f.email} onChange={v=>s('email',v)} type="email"/>
          <EF label="Company" value={f.company} onChange={v=>s('company',v)}/>
          <ES label="Preferred Contact" value={f.preferred_contact_method} onChange={v=>s('preferred_contact_method',v)} options={CMO}/>
          <EF label="Referral Source" value={f.referral_source} onChange={v=>s('referral_source',v)}/>
        </>
      ):(
        <>
          <IR label="Phone" value={fmtPh(c.phone)} href={`tel:${c.phone}`}/>
          {c.phone_secondary&&<IR label="Secondary" value={fmtPh(c.phone_secondary)} href={`tel:${c.phone_secondary}`}/>}
          <IR label="Email" value={c.email} href={c.email?`mailto:${c.email}`:null}/>
          <IR label="Company" value={c.company}/><IR label="Preferred Contact" value={c.preferred_contact_method?.toUpperCase()}/>
          <IR label="Referral Source" value={c.referral_source}/>
        </>
      )}
    </div>
  );
}

/* ═══ INSURANCE TILE ═══ */
function InsuranceTile({contact,db,contactId,carriers,onReload}){
  const c=contact;
  const[ed,setEd]=useState(false);const[saving,setSaving]=useState(false);
  const[f,sF]=useState({});
  const startEdit=()=>{sF({insurance_carrier:c.insurance_carrier||'',policy_number:c.policy_number||''});setEd(true);};
  const save=async()=>{
    setSaving(true);
    try{await db.update('contacts',`id=eq.${contactId}`,{insurance_carrier:f.insurance_carrier?.trim()||null,policy_number:f.policy_number?.trim()||null,updated_at:new Date().toISOString()});
      setEd(false);onReload();
    }catch(err){errToast('Failed: '+err.message);}finally{setSaving(false);}
  };
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));
  return(
    <div className="job-page-section">
      <TileHeader title="Insurance" editing={ed} onEdit={startEdit} onCancel={()=>setEd(false)} onSave={save} saving={saving}/>
      {ed?(
        <>
          <div style={{marginBottom:'var(--space-3)'}}><LookupSelect label="Insurance Carrier" value={f.insurance_carrier} onChange={v=>s('insurance_carrier',v)} items={carriers||[]} placeholder="Search carriers..."/></div>
          <EF label="Policy #" value={f.policy_number} onChange={v=>s('policy_number',v)}/>
        </>
      ):(
        <><IR label="Carrier" value={c.insurance_carrier}/><IR label="Policy #" value={c.policy_number}/></>
      )}
    </div>
  );
}

/* ═══ NOTES TILE ═══ */
function NotesTile({contact,db,contactId,onReload}){
  const[ed,setEd]=useState(false);const[saving,setSaving]=useState(false);const[val,setVal]=useState('');
  const startEdit=()=>{setVal(contact.notes||'');setEd(true);};
  const save=async()=>{
    setSaving(true);
    try{await db.update('contacts',`id=eq.${contactId}`,{notes:val?.trim()||null,updated_at:new Date().toISOString()});setEd(false);onReload();}
    catch(err){errToast('Failed: '+err.message);}finally{setSaving(false);}
  };
  return(
    <div className="job-page-section job-page-section-full">
      <TileHeader title="Notes" editing={ed} onEdit={startEdit} onCancel={()=>setEd(false)} onSave={save} saving={saving}/>
      {ed?(
        <textarea className="input textarea" value={val} onChange={e=>setVal(e.target.value)} rows={4} placeholder="Internal notes..." style={{width:'100%'}} autoFocus/>
      ):(
        <div style={{fontSize:'var(--text-sm)',color:contact.notes?'var(--text-secondary)':'var(--text-tertiary)',lineHeight:1.5,whiteSpace:'pre-wrap',fontStyle:contact.notes?'normal':'italic'}}>{contact.notes||'No notes'}</div>
      )}
    </div>
  );
}

/* ═══ ADDRESS SECTION ═══ */
function AddressSection({addresses,db,contactId,onReload}){
  const[showAdd,setShowAdd]=useState(false);const[editingAddr,setEditingAddr]=useState(null);
  const[form,setForm]=useState({label:'service',address:'',city:'',state:'UT',zip:'',is_billing:false,notes:''});
  const[saving,setSaving]=useState(false);const[menuOpen,setMenuOpen]=useState(null);
  const[confirmDeleteAddr,setConfirmDeleteAddr]=useState(null);
  const resetForm=()=>{setForm({label:'service',address:'',city:'',state:'UT',zip:'',is_billing:false,notes:''});setShowAdd(false);setEditingAddr(null);};
  const startEdit=(addr)=>{setEditingAddr(addr.id);setShowAdd(false);setMenuOpen(null);setForm({label:addr.label||'service',address:addr.address||'',city:addr.city||'',state:addr.state||'',zip:addr.zip||'',is_billing:addr.is_billing||false,notes:addr.notes||''});};
  const handleSave=async()=>{
    if(!form.address?.trim())return;setSaving(true);
    try{await db.rpc('upsert_contact_address',{p_contact_id:contactId,p_address_id:editingAddr||null,p_label:form.label,p_address:form.address.trim(),p_city:form.city?.trim()||null,p_state:form.state?.trim()||null,p_zip:form.zip?.trim()||null,p_is_billing:form.is_billing,p_notes:form.notes?.trim()||null});
      resetForm();onReload();
    }catch(err){errToast('Failed: '+err.message);}finally{setSaving(false);}
  };
  const handleSetBilling=async(id)=>{setMenuOpen(null);try{const a=addresses.find(x=>x.id===id);if(!a)return;await db.rpc('upsert_contact_address',{p_contact_id:contactId,p_address_id:id,p_label:a.label,p_address:a.address,p_city:a.city,p_state:a.state,p_zip:a.zip,p_is_billing:true,p_notes:a.notes});onReload();}catch(err){errToast('Failed: '+err.message);}};
  const handleDelete=async(id)=>{setMenuOpen(null);try{await db.rpc('delete_contact_address',{p_address_id:id,p_contact_id:contactId});setConfirmDeleteAddr(null);onReload();}catch(err){errToast('Failed: '+err.message);setConfirmDeleteAddr(null);}};
  const isEditing=showAdd||editingAddr;
  return(
    <div className="job-page-section">
      <div className="job-page-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span>{addresses.length} Address{addresses.length!==1?'es':''}</span>
        {!isEditing&&<button className="btn btn-ghost btn-sm" onClick={()=>{setShowAdd(true);setEditingAddr(null);setForm({label:'service',address:'',city:'',state:'UT',zip:'',is_billing:addresses.length===0,notes:''});}} style={{padding:'0 6px',height:24}}><IconPlus style={{width:14,height:14}}/></button>}
      </div>
      {addresses.map(addr=>{
        if(editingAddr===addr.id)return(<div key={addr.id} style={{padding:'var(--space-3)',background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',border:'1px solid var(--brand-primary)',marginBottom:'var(--space-2)'}}><AddrForm form={form} setForm={setForm} saving={saving} onSave={handleSave} onCancel={resetForm}/></div>);
        return(
          <div key={addr.id} style={{display:'flex',alignItems:'flex-start',gap:'var(--space-3)',padding:'var(--space-3)',borderBottom:'1px solid var(--border-light)',position:'relative'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:'var(--space-2)',marginBottom:2}}>
                <span style={{fontSize:'var(--text-sm)',fontWeight:500,color:'var(--text-primary)'}}>{addr.address}</span>
                {addr.is_billing&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:4,background:'var(--brand-primary)',color:'#fff'}}>Billing</span>}
                <span style={{fontSize:9,fontWeight:600,padding:'1px 6px',borderRadius:4,background:'var(--bg-tertiary)',color:'var(--text-tertiary)',textTransform:'capitalize'}}>{addr.label||'service'}</span>
              </div>
              <div style={{fontSize:12,color:'var(--text-tertiary)'}}>{[addr.city,addr.state,addr.zip].filter(Boolean).join(', ')}</div>
            </div>
            <div style={{position:'relative',flexShrink:0}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setMenuOpen(menuOpen===addr.id?null:addr.id)} style={{width:28,height:28,padding:0}}><IconDots style={{width:14,height:14}}/></button>
              {menuOpen===addr.id&&<div style={{position:'absolute',right:0,top:'100%',zIndex:20,background:'var(--bg-primary)',border:'1px solid var(--border-color)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-lg)',minWidth:150,overflow:'hidden'}}>
                {!addr.is_billing&&<button onClick={()=>handleSetBilling(addr.id)} style={mi}>Set as Billing</button>}
                <button onClick={()=>startEdit(addr)} style={mi}>Edit</button>
                {confirmDeleteAddr===addr.id?(
                  <div style={{padding:'6px 14px',borderTop:'1px solid var(--border-light)',display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:12,color:'var(--text-secondary)',flex:1}}>Delete?</span>
                    <button onClick={()=>handleDelete(addr.id)} style={{fontSize:12,color:'#ef4444',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font-sans)',fontWeight:600}}>Yes</button>
                    <button onClick={()=>setConfirmDeleteAddr(null)} style={{fontSize:12,color:'var(--text-tertiary)',background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font-sans)'}}>No</button>
                  </div>
                ):(
                  <button onClick={()=>setConfirmDeleteAddr(addr.id)} style={{...mi,color:'#ef4444'}}>Delete</button>
                )}
              </div>}
            </div>
          </div>);
      })}
      {showAdd&&<div style={{padding:'var(--space-3)',background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',border:'1px dashed var(--border-color)',marginTop:'var(--space-2)'}}><AddrForm form={form} setForm={setForm} saving={saving} onSave={handleSave} onCancel={resetForm}/></div>}
      {addresses.length===0&&!showAdd&&<div style={{fontSize:'var(--text-sm)',color:'var(--text-tertiary)',fontStyle:'italic',padding:'var(--space-2) 0'}}>No addresses on file</div>}
    </div>
  );
}
const mi={display:'block',width:'100%',padding:'8px 14px',border:'none',background:'none',textAlign:'left',fontSize:13,cursor:'pointer',fontFamily:'var(--font-sans)',color:'var(--text-primary)'};

function AddrForm({form,setForm,saving,onSave,onCancel}){
  const s=(f,v)=>setForm(prev=>({...prev,[f]:v}));
  return(<>
    <div style={{display:'flex',gap:'var(--space-2)',marginBottom:'var(--space-2)'}}>
      <div style={{flex:1}}><label className="label" style={{fontSize:11}}>Street *</label><input className="input" value={form.address} onChange={e=>s('address',e.target.value)} placeholder="1422 E Maple Ridge Dr" style={{height:32,fontSize:13}} autoFocus/></div>
      <div style={{width:100}}><label className="label" style={{fontSize:11}}>Type</label><select className="input" value={form.label} onChange={e=>s('label',e.target.value)} style={{height:32,fontSize:13,cursor:'pointer'}}>{ADDR_LABELS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
    </div>
    <div style={{display:'flex',gap:'var(--space-2)',marginBottom:'var(--space-2)'}}>
      <div style={{flex:1}}><label className="label" style={{fontSize:11}}>City</label><input className="input" value={form.city} onChange={e=>s('city',e.target.value)} placeholder="Lehi" style={{height:32,fontSize:13}}/></div>
      <div style={{width:60}}><label className="label" style={{fontSize:11}}>State</label><input className="input" value={form.state} onChange={e=>s('state',e.target.value)} placeholder="UT" style={{height:32,fontSize:13}}/></div>
      <div style={{width:80}}><label className="label" style={{fontSize:11}}>ZIP</label><input className="input" value={form.zip} onChange={e=>s('zip',e.target.value)} placeholder="84043" style={{height:32,fontSize:13}}/></div>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',marginBottom:'var(--space-2)'}}>
      <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer',color:'var(--text-secondary)'}}><input type="checkbox" checked={form.is_billing} onChange={e=>s('is_billing',e.target.checked)} style={{width:14,height:14}}/> Set as billing address</label>
    </div>
    <div style={{display:'flex',justifyContent:'flex-end',gap:'var(--space-2)'}}>
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving||!form.address?.trim()}>{saving?'Saving...':'Save Address'}</button>
    </div>
  </>);
}

/* ═══ CLAIMS TAB ═══ */
function ClaimsTab({claims,fmtDate,fmtC,onNav,onAddRelated}){
  if(!claims.length)return(<div className="empty-state" style={{paddingTop:40}}><div className="empty-state-icon">📋</div><div className="empty-state-text">No claims yet</div></div>);
  return(<div style={{display:'flex',flexDirection:'column',gap:'var(--space-5)'}}>{claims.map(cl=>{const jobs=cl.jobs||[];return(
    <div key={cl.id} className="job-page-section" style={{padding:0,overflow:'hidden'}}>
      <div style={{padding:'var(--space-3) var(--space-4)',background:'var(--bg-secondary)',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:'var(--space-3)',flexWrap:'wrap'}}>
        <span style={{fontWeight:700,fontSize:13}}>{cl.claim_number}</span>
        {cl.insurance_carrier&&<span style={{fontSize:12,color:'var(--text-secondary)'}}>{cl.insurance_carrier}</span>}
        {cl.date_of_loss&&<span style={{fontSize:11,color:'var(--text-tertiary)'}}>Loss: {fmtDate(cl.date_of_loss)}</span>}
        {cl.insurance_claim_number&&<span style={{fontSize:11,color:'var(--text-tertiary)'}}>Ins#: {cl.insurance_claim_number}</span>}
        <span style={{marginLeft:'auto',fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,background:cl.status==='open'?'#eff6ff':'#f1f3f5',color:cl.status==='open'?'#2563eb':'#6b7280'}}>{cl.status}</span>
      </div>
      {cl.loss_address&&<div style={{padding:'var(--space-2) var(--space-4)',fontSize:12,color:'var(--text-tertiary)',borderBottom:'1px solid var(--border-light)'}}>📍 {cl.loss_address}{cl.loss_city?`, ${cl.loss_city}`:''}</div>}
      <div style={{padding:'var(--space-3) var(--space-4)'}}>
        {jobs.map(j=>{const ps=getPS(j.phase);const dc=DIVISION_COLORS[j.division]||'#6b7280';const em=DIVISION_EMOJI[j.division]||'📁';const est=j.estimated_value||j.approved_value;
          return(<div key={j.id} onClick={()=>onNav(j.id)} style={{display:'flex',alignItems:'center',gap:'var(--space-3)',padding:'var(--space-3)',marginBottom:'var(--space-2)',background:'var(--bg-primary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-light)',borderLeft:`3px solid ${dc}`,cursor:'pointer'}}>
            <span style={{fontSize:18}}>{em}</span><div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:13,fontWeight:700}}>{j.job_number||'New'}</span><span style={{fontSize:11,color:'var(--text-secondary)',textTransform:'capitalize'}}>{j.division?.replace(/_/g,' ')}</span></div>
              {est>0&&<div style={{fontSize:11,color:'var(--text-tertiary)',marginTop:1}}>{fmtC(est)}</div>}
            </div><span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,background:ps.bg,color:ps.color,whiteSpace:'nowrap'}}>{ps.label}</span>
            <span style={{fontSize:11,color:'var(--brand-primary)',fontWeight:600}}>→</span></div>);
        })}
        <button className="btn btn-ghost btn-sm" onClick={()=>{if(jobs[0])onAddRelated(jobs[0],cl,jobs);}} style={{width:'100%',justifyContent:'center',gap:4,marginTop:'var(--space-1)',color:'var(--brand-primary)',fontSize:12}}><IconPlus style={{width:12,height:12}}/> Add Related Job</button>
      </div></div>);})}</div>);
}

/* ═══ FINANCIAL TAB ═══ */
function FinancialTab({fin,claims,fmtC2,onNav}){
  const tc=Number(fin.total_labor_cost||0)+Number(fin.total_material_cost||0)+Number(fin.total_equipment_cost||0)+Number(fin.total_sub_cost||0)+Number(fin.total_other_cost||0);
  const rb=Number(fin.total_approved||0)>0?Number(fin.total_approved):Number(fin.total_estimated||0);const gp=rb-tc;const mg=rb>0?((gp/rb)*100).toFixed(1):'0.0';
  const os=Number(fin.total_invoiced||0)-Number(fin.total_collected||0);
  const allJ=claims.flatMap(cl=>(cl.jobs||[]).map(j=>({...j})));
  return(
    <div className="job-page-financial">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:10,marginBottom:16}}>
        <SC l="Estimated" v={fmtC2(fin.total_estimated)}/><SC l="Approved" v={fmtC2(fin.total_approved)}/>
        <SC l="Invoiced" v={fmtC2(fin.total_invoiced)}/><SC l="Collected" v={fmtC2(fin.total_collected)} c="#059669"/>
        {os>0&&<SC l="Outstanding" v={fmtC2(os)} c="#d97706"/>}
      </div>
      <div className="job-page-section"><div className="job-page-section-title">Revenue</div><FR l="Estimated" v={fmtC2(fin.total_estimated)}/><FR l="Approved" v={fmtC2(fin.total_approved)}/><FR l="Invoiced" v={fmtC2(fin.total_invoiced)}/><FR l="Collected" v={fmtC2(fin.total_collected)}/></div>
      <div className="job-page-section"><div className="job-page-section-title">Insurance</div><FR l="Deductible" v={fmtC2(fin.total_deductible)}/><FR l="Depreciation Held" v={fmtC2(fin.total_depreciation_held)}/><FR l="Depreciation Released" v={fmtC2(fin.total_depreciation_released)}/><FR l="Supplement" v={fmtC2(fin.total_supplement)}/></div>
      <div className="job-page-section"><div className="job-page-section-title">Costs</div><FR l="Labor" v={fmtC2(fin.total_labor_cost)}/><FR l="Materials" v={fmtC2(fin.total_material_cost)}/><FR l="Equipment" v={fmtC2(fin.total_equipment_cost)}/><FR l="Subs" v={fmtC2(fin.total_sub_cost)}/><FR l="Other" v={fmtC2(fin.total_other_cost)}/><div className="job-page-fin-divider"/><FR l="Total Cost" v={fmtC2(tc)} b/></div>
      <div className="job-page-section"><div className="job-page-section-title">Profitability</div><FR l={Number(fin.total_approved)>0?'Approved Rev.':'Estimated Rev.'} v={fmtC2(rb)}/><FR l="Total Cost" v={fmtC2(tc)}/><div className="job-page-fin-divider"/><FR l="Gross Profit" v={fmtC2(gp)} b c={gp>=0?'#10b981':'#ef4444'}/><FR l="Margin" v={`${mg}%`} b c={gp>=0?'#10b981':'#ef4444'}/>{os>0&&<FR l="Outstanding" v={fmtC2(os)} c="#d97706" b/>}</div>
      {allJ.length>1&&(<div className="job-page-section job-page-section-full"><div className="job-page-section-title">Per-Job Breakdown</div>
        <div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
          <thead><tr style={{borderBottom:'2px solid var(--border-color)'}}><th style={th}>Job</th><th style={th}>Div</th><th style={{...th,textAlign:'right'}}>Est</th><th style={{...th,textAlign:'right'}}>Appr</th><th style={{...th,textAlign:'right'}}>Inv</th><th style={{...th,textAlign:'right'}}>Coll</th></tr></thead>
          <tbody>{allJ.map(j=><tr key={j.id} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer'}} onClick={()=>onNav(j.id)}>
            <td style={td}><span style={{fontWeight:600,color:'var(--brand-primary)'}}>{j.job_number||'—'}</span></td><td style={td}>{DIVISION_EMOJI[j.division]||''} {j.division}</td>
            <td style={{...td,textAlign:'right'}}>{fmtC2(j.estimated_value)}</td><td style={{...td,textAlign:'right'}}>{fmtC2(j.approved_value)}</td>
            <td style={{...td,textAlign:'right'}}>{fmtC2(j.invoiced_value)}</td><td style={{...td,textAlign:'right'}}>{fmtC2(j.collected_value)}</td></tr>)}</tbody>
        </table></div></div>)}
    </div>);
}

/* ═══ FILES TAB ═══ */
function FilesTab({files}){
  if(!files.length)return(<div className="empty-state" style={{paddingTop:40}}><div className="empty-state-icon">📁</div><div className="empty-state-text">No files yet</div></div>);
  const byJ={};for(const f of files){const k=f.job_number||f.job_id||'?';if(!byJ[k])byJ[k]={jn:f.job_number,f:[]};byJ[k].f.push(f);}
  const url=f=>`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/job-files/${f.file_path}`;
  const sz=b=>{if(!b)return'';if(b<1024)return`${b} B`;if(b<1048576)return`${(b/1024).toFixed(1)} KB`;return`${(b/1048576).toFixed(1)} MB`;};
  return(<div>{Object.entries(byJ).map(([k,g])=><div key={k} style={{marginBottom:'var(--space-5)'}}>
    <div style={{fontSize:11,fontWeight:700,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'var(--space-2)'}}>Job: {g.jn||'Unknown'}</div>
    <div className="job-page-files-grid">{g.f.map(d=><div key={d.id} className="job-page-file-card">
      {d.mime_type?.startsWith('image/')?<a href={url(d)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview"><img src={url(d)} alt={d.name} loading="lazy"/></a>
        :<a href={url(d)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">{d.mime_type?.includes('pdf')?'📄':'📎'}</a>}
      <div className="job-page-file-info"><a href={url(d)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{d.name}</a>
        <div className="job-page-file-meta"><span className="job-page-file-cat-badge">{d.category}</span>{d.file_size&&<span>{sz(d.file_size)}</span>}</div></div>
    </div>)}</div></div>)}</div>);
}

/* ═══ ACTIVITY TAB ═══ */
function ActivityTab({activity}){
  if(!activity.length)return(<div className="empty-state" style={{paddingTop:40}}><div className="empty-state-icon">📝</div><div className="empty-state-text">No activity yet</div></div>);
  const fmt=v=>{if(!v)return'—';return new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
  return(<div className="job-page-timeline">{activity.map(item=><div key={`${item.type}-${item.id}`} className={`job-page-timeline-item timeline-${item.type}`}>
    <div className="job-page-timeline-dot"/><div className="job-page-timeline-content">
      <div className="job-page-timeline-header"><span className="job-page-timeline-author">{item.author}</span><span className="job-page-timeline-time">{fmt(item.date)}</span></div>
      <div className="job-page-timeline-text">{item.content}</div>
      {item.job_number&&<span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',marginTop:2,display:'inline-block'}}>Job: {item.job_number}</span>}
    </div></div>)}</div>);
}

/* ═══ Shared ═══ */
function IR({label,value,href}){return(<div className="job-page-info-row"><span className="job-page-info-label">{label}</span>{!value?<span className="job-page-info-value" style={{color:'var(--text-tertiary)'}}>—</span>:href?<a href={href} className="job-page-info-value" style={{color:'var(--brand-primary)',textDecoration:'none'}}>{value}</a>:<span className="job-page-info-value">{value}</span>}</div>);}
function EF({label,value,onChange,type='text',required,style}){return(<div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0',...style}}><span className="job-page-info-label" style={{marginBottom:2}}>{label}{required&&' *'}</span><input className="input" type={type} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={label} style={{height:34,fontSize:'var(--text-sm)'}}/></div>);}
function ES({label,value,onChange,options}){return(<div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0'}}><span className="job-page-info-label" style={{marginBottom:2}}>{label}</span><select className="input" value={value||''} onChange={e=>onChange(e.target.value)} style={{height:34,fontSize:'var(--text-sm)',cursor:'pointer'}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>);}
function FR({l,v,b,c}){return(<div className="job-page-info-row"><span className="job-page-info-label" style={b?{fontWeight:600}:undefined}>{l}</span><span className="job-page-info-value" style={{fontWeight:b?700:400,color:c||'var(--text-primary)'}}>{v}</span></div>);}
function SC({l,v,c}){return(<div className="job-page-section" style={{padding:'12px 14px',textAlign:'center'}}><div style={{fontSize:18,fontWeight:700,color:c||'var(--text-primary)'}}>{v}</div><div style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',marginTop:2,textTransform:'uppercase',letterSpacing:'0.03em'}}>{l}</div></div>);}
const th={padding:'8px 10px',textAlign:'left',fontWeight:600,color:'var(--text-tertiary)',fontSize:11,textTransform:'uppercase',letterSpacing:'0.03em'};
const td={padding:'8px 10px',color:'var(--text-secondary)'};
