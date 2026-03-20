import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { LookupSelect } from '@/components/AddContactModal';
import AddRelatedJobModal from '@/components/AddRelatedJobModal';

/* Icons */
function IconPhone(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>);}
function IconMail(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);}
function IconMsg(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}

const DIVISION_EMOJI = { water: '\u{1F4A7}', mold: '\u{1F9A0}', reconstruction: '\u{1F3D7}\uFE0F', fire: '\u{1F525}', contents: '\u{1F4E6}' };
const DIVISION_COLORS = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669' };
const ROLE_LABELS = { homeowner: 'Homeowner', tenant: 'Tenant', property_manager: 'Property Manager' };
const LANG_LABELS = { en: 'English', es: 'Spanish', pt: 'Portuguese' };
const CMO = [{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const LANG = [{value:'en',label:'English'},{value:'es',label:'Spanish'},{value:'pt',label:'Portuguese'}];

const PHASE_STYLES = {
  job_received:{label:'Received',bg:'#fff7ed',color:'#ea580c'},mitigation_in_progress:{label:'Mitigation',bg:'#eff6ff',color:'#2563eb'},
  drying:{label:'Drying',bg:'#eff6ff',color:'#2563eb'},monitoring:{label:'Monitoring',bg:'#eff6ff',color:'#2563eb'},
  reconstruction_in_progress:{label:'In Progress',bg:'#eff6ff',color:'#2563eb'},reconstruction_punch_list:{label:'Punch List',bg:'#fef9c3',color:'#a16207'},
  completed:{label:'Completed',bg:'#ecfdf5',color:'#10b981'},closed:{label:'Closed',bg:'#f1f3f5',color:'#6b7280'},
  invoiced:{label:'Invoiced',bg:'#f0f9ff',color:'#0369a1'},paid:{label:'Paid',bg:'#ecfdf5',color:'#059669'},
};
function getPhaseStyle(p){return PHASE_STYLES[p]||{label:p?.replace(/_/g,' ')||'\u2014',bg:'#f1f3f5',color:'#6b7280'};}

function fmtPhoneDisplay(phone){if(!phone)return'';const d=phone.replace(/\D/g,'');const n=d.startsWith('1')?d.slice(1):d;if(n.length===10)return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;return phone;}

export default function CustomerPage(){
  const{contactId}=useParams();
  const navigate=useNavigate();
  const{db}=useAuth();
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[activeTab,setActiveTab]=useState('overview');
  const[carriers,setCarriers]=useState([]);
  const[employees,setEmployees]=useState([]);
  const[editing,setEditing]=useState(false);
  const[editForm,setEditForm]=useState({});
  const[saving,setSaving]=useState(false);
  const[addRelatedSource,setAddRelatedSource]=useState(null);

  useEffect(()=>{loadData();},[contactId]);

  const loadData=async()=>{
    setLoading(true);
    try{
      const result=await db.rpc('get_customer_detail',{p_contact_id:contactId});
      if(!result?.contact){navigate('/customers',{replace:true});return;}
      setData(result);
      db.select('insurance_carriers','order=name.asc&select=id,name,short_name').then(setCarriers).catch(()=>{});
      db.select('employees','is_active=eq.true&order=full_name.asc&select=id,full_name,role').then(setEmployees).catch(()=>{});
    }catch(err){console.error('Customer load:',err);}
    finally{setLoading(false);}
  };

  const startEditing=()=>{
    const c=data.contact;
    setEditForm({name:c.name||'',phone:fmtPhoneDisplay(c.phone),email:c.email||'',company:c.company||'',
      preferred_contact_method:c.preferred_contact_method||'sms',preferred_language:c.preferred_language||'en',
      billing_address:c.billing_address||'',billing_city:c.billing_city||'',billing_state:c.billing_state||'',billing_zip:c.billing_zip||'',
      insurance_carrier:c.insurance_carrier||'',policy_number:c.policy_number||'',referral_source:c.referral_source||'',notes:c.notes||''});
    setEditing(true);
  };
  const cancelEditing=()=>{setEditing(false);setEditForm({});};
  const setField=(f,v)=>setEditForm(prev=>({...prev,[f]:v}));

  const handleSave=async()=>{
    if(!editForm.name?.trim())return;
    setSaving(true);
    try{
      let phone=editForm.phone.replace(/\D/g,'');
      if(phone.length===10)phone='1'+phone;
      if(!phone.startsWith('+'))phone='+'+phone;
      const update={name:editForm.name.trim(),phone,email:editForm.email?.trim()||null,company:editForm.company?.trim()||null,
        preferred_contact_method:editForm.preferred_contact_method,preferred_language:editForm.preferred_language||'en',
        billing_address:editForm.billing_address?.trim()||null,billing_city:editForm.billing_city?.trim()||null,
        billing_state:editForm.billing_state?.trim()||null,billing_zip:editForm.billing_zip?.trim()||null,
        insurance_carrier:editForm.insurance_carrier?.trim()||null,policy_number:editForm.policy_number?.trim()||null,
        referral_source:editForm.referral_source?.trim()||null,notes:editForm.notes?.trim()||null,
        updated_at:new Date().toISOString()};
      await db.update('contacts',`id=eq.${contactId}`,update);
      setEditing(false);loadData();
    }catch(err){alert('Failed: '+err.message);}
    finally{setSaving(false);}
  };

  const fmtDate=(val)=>{if(!val)return'\u2014';return new Date(val+(val.includes('T')?'':'T00:00:00')).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});};
  const fmtCurrency=(val)=>{if(val==null)return'$0';return`$${Number(val).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}`;};
  const fmtCurrency2=(val)=>{if(val==null)return'\u2014';return`$${Number(val).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;};

  if(loading)return<div className="loading-page"><div className="spinner"/></div>;
  if(!data)return null;

  const c=data.contact;const claims=data.claims||[];const fin=data.financials||{};const files=data.files||[];const activity=data.activity||[];
  const initials=c.name?c.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2):'?';
  const totalJobs=claims.reduce((s,cl)=>s+(cl.jobs?.length||0),0);
  const TABS=[{key:'overview',label:'Overview'},{key:'claims',label:'Claims & Jobs',count:totalJobs},{key:'financial',label:'Financial'},{key:'files',label:'Files',count:files.length},{key:'activity',label:'Activity',count:activity.length}];

  return(
    <div className="job-page">
      <div className="job-page-topbar">
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/customers')} style={{gap:4}}>{'\u2190'} Customers</button>
      </div>

      <div className="job-page-header">
        <div className="job-page-header-left">
          <div className="customer-card-avatar" style={{width:48,height:48,fontSize:16}}>{initials}</div>
          <div>
            <div className="job-page-client" style={{fontSize:'var(--text-xl)'}}>{c.name}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:2}}>
              <span className="customer-card-role-badge">{ROLE_LABELS[c.role]||c.role}</span>
              {c.dnd&&<span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,background:'#fef2f2',color:'#ef4444'}}>DND</span>}
              <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{totalJobs} job{totalJobs!==1?'s':''} {'\u00B7'} {claims.length} claim{claims.length!==1?'s':''}</span>
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:'var(--space-2)'}}>
          {c.phone&&<a href={`tel:${c.phone}`} className="customer-action-btn"><IconPhone style={{width:16,height:16}}/>Call</a>}
          {c.phone&&<button className="customer-action-btn" onClick={()=>navigate('/conversations')}><IconMsg style={{width:16,height:16}}/>Text</button>}
          {c.email&&<a href={`mailto:${c.email}`} className="customer-action-btn"><IconMail style={{width:16,height:16}}/>Email</a>}
          {!editing?(
            <button className="customer-action-btn" onClick={startEditing}><IconEdit style={{width:16,height:16}}/>Edit</button>
          ):(
            <>
              <button className="customer-action-btn" onClick={cancelEditing} style={{color:'var(--text-tertiary)'}}>Cancel</button>
              <button className="customer-action-btn" onClick={handleSave} disabled={saving}
                style={{background:'var(--brand-primary)',color:'#fff',borderColor:'var(--brand-primary)'}}>
                {saving?'...':'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="job-page-tabs">
        {TABS.map(tab=>(
          <button key={tab.key} className={`job-page-tab${activeTab===tab.key?' active':''}`} onClick={()=>setActiveTab(tab.key)}>
            {tab.label}{tab.count>0&&<span className="job-page-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      <PullToRefresh onRefresh={loadData} className="job-page-content">
        {activeTab==='overview'&&<OverviewTab contact={c} fmtDate={fmtDate} editing={editing} editForm={editForm} setField={setField} carriers={carriers}/>}
        {activeTab==='claims'&&<ClaimsTab claims={claims} fmtDate={fmtDate} fmtCurrency={fmtCurrency} onNavigateJob={id=>navigate(`/jobs/${id}`)} onAddRelatedJob={(j,cl,s)=>setAddRelatedSource({job:j,claimData:cl,siblings:s})}/>}
        {activeTab==='financial'&&<FinancialTab fin={fin} claims={claims} fmtCurrency2={fmtCurrency2} onNavigateJob={id=>navigate(`/jobs/${id}`)}/>}
        {activeTab==='files'&&<FilesTab files={files}/>}
        {activeTab==='activity'&&<ActivityTab activity={activity}/>}
      </PullToRefresh>

      {addRelatedSource&&(
        <AddRelatedJobModal sourceJob={addRelatedSource.job} claimData={addRelatedSource.claimData} siblingJobs={addRelatedSource.siblings}
          employees={employees} db={db} onClose={()=>setAddRelatedSource(null)}
          onCreated={r=>{setAddRelatedSource(null);if(r?.job?.id)navigate(`/jobs/${r.job.id}`);}}/>
      )}
    </div>
  );
}

/* ═══ OVERVIEW TAB — read mode + edit mode ═══ */
function OverviewTab({contact,fmtDate,editing,editForm,setField,carriers}){
  const c=contact;
  const hasAddress=c.billing_address||c.billing_city;

  if(editing){
    return(
      <div className="job-page-grid">
        <div className="job-page-section">
          <div className="job-page-section-title">Contact Information</div>
          <EditField label="Name" value={editForm.name} onChange={v=>setField('name',v)} required/>
          <EditField label="Phone" value={editForm.phone} onChange={v=>setField('phone',v)} type="tel"/>
          <EditField label="Email" value={editForm.email} onChange={v=>setField('email',v)} type="email"/>
          <EditField label="Company" value={editForm.company} onChange={v=>setField('company',v)}/>
          <EditSelect label="Preferred Contact" value={editForm.preferred_contact_method} onChange={v=>setField('preferred_contact_method',v)} options={CMO}/>
          <EditSelect label="Language" value={editForm.preferred_language} onChange={v=>setField('preferred_language',v)} options={LANG}/>
          <EditField label="Referral Source" value={editForm.referral_source} onChange={v=>setField('referral_source',v)}/>
        </div>
        <div className="job-page-section">
          <div className="job-page-section-title">Billing Address</div>
          <EditField label="Street" value={editForm.billing_address} onChange={v=>setField('billing_address',v)}/>
          <div style={{display:'flex',gap:'var(--space-2)'}}>
            <EditField label="City" value={editForm.billing_city} onChange={v=>setField('billing_city',v)}/>
            <EditField label="State" value={editForm.billing_state} onChange={v=>setField('billing_state',v)} style={{maxWidth:80}}/>
            <EditField label="ZIP" value={editForm.billing_zip} onChange={v=>setField('billing_zip',v)} style={{maxWidth:100}}/>
          </div>
        </div>
        <div className="job-page-section">
          <div className="job-page-section-title">Insurance</div>
          <div style={{marginBottom:'var(--space-3)'}}>
            <LookupSelect label="Insurance Carrier" value={editForm.insurance_carrier} onChange={v=>setField('insurance_carrier',v)} items={carriers||[]} placeholder="Search carriers..."/>
          </div>
          <EditField label="Policy #" value={editForm.policy_number} onChange={v=>setField('policy_number',v)}/>
        </div>
        <div className="job-page-section job-page-section-full">
          <div className="job-page-section-title">Notes</div>
          <textarea className="input textarea" value={editForm.notes} onChange={e=>setField('notes',e.target.value)} rows={4} placeholder="Internal notes..." style={{width:'100%'}}/>
        </div>
      </div>
    );
  }

  return(
    <div className="job-page-grid">
      <div className="job-page-section">
        <div className="job-page-section-title">Contact Information</div>
        <InfoRow label="Phone" value={fmtPhoneDisplay(c.phone)} href={`tel:${c.phone}`}/>
        {c.phone_secondary&&<InfoRow label="Secondary Phone" value={fmtPhoneDisplay(c.phone_secondary)} href={`tel:${c.phone_secondary}`}/>}
        <InfoRow label="Email" value={c.email} href={c.email?`mailto:${c.email}`:null}/>
        <InfoRow label="Company" value={c.company}/>
        <InfoRow label="Preferred Contact" value={c.preferred_contact_method?.toUpperCase()}/>
        {c.preferred_language&&c.preferred_language!=='en'&&<InfoRow label="Language" value={LANG_LABELS[c.preferred_language]||c.preferred_language}/>}
        <InfoRow label="Referral Source" value={c.referral_source}/>
      </div>
      <div className="job-page-section">
        <div className="job-page-section-title">Billing Address</div>
        {hasAddress?(
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-primary)',lineHeight:1.6}}>
            {c.billing_address&&<div>{c.billing_address}</div>}
            <div>{[c.billing_city,c.billing_state,c.billing_zip].filter(Boolean).join(', ')}</div>
          </div>
        ):(<div style={{fontSize:'var(--text-sm)',color:'var(--text-tertiary)',fontStyle:'italic'}}>No address on file</div>)}
      </div>
      <div className="job-page-section">
        <div className="job-page-section-title">Insurance</div>
        <InfoRow label="Carrier" value={c.insurance_carrier}/>
        <InfoRow label="Policy #" value={c.policy_number}/>
      </div>
      {c.tags&&Array.isArray(c.tags)&&c.tags.length>0&&(
        <div className="job-page-section">
          <div className="job-page-section-title">Tags</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'var(--space-1)'}}>
            {c.tags.map((t,i)=><span key={i} style={{fontSize:11,fontWeight:600,padding:'2px 10px',borderRadius:99,background:'var(--bg-tertiary)',color:'var(--text-secondary)'}}>{t}</span>)}
          </div>
        </div>
      )}
      <div className="job-page-section job-page-section-full">
        <div className="job-page-section-title">Notes</div>
        <div style={{fontSize:'var(--text-sm)',color:c.notes?'var(--text-secondary)':'var(--text-tertiary)',lineHeight:1.5,whiteSpace:'pre-wrap',fontStyle:c.notes?'normal':'italic'}}>
          {c.notes||'No notes'}
        </div>
      </div>
      <div className="job-page-section job-page-section-full" style={{opacity:0.5}}>
        <InfoRow label="Created" value={fmtDate(c.created_at)}/><InfoRow label="Updated" value={fmtDate(c.updated_at)}/>
      </div>
    </div>
  );
}

/* ═══ CLAIMS & JOBS TAB ═══ */
function ClaimsTab({claims,fmtDate,fmtCurrency,onNavigateJob,onAddRelatedJob}){
  if(claims.length===0)return(<div className="empty-state" style={{paddingTop:40}}><div className="empty-state-icon">{'\u{1F4CB}'}</div><div className="empty-state-text">No claims yet</div><div className="empty-state-sub">Create a job from the Jobs page to start</div></div>);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:'var(--space-5)'}}>
      {claims.map(claim=>{
        const jobs=claim.jobs||[];
        return(
          <div key={claim.id} className="job-page-section" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'var(--space-3) var(--space-4)',background:'var(--bg-secondary)',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:'var(--space-3)',flexWrap:'wrap'}}>
              <span style={{fontWeight:700,fontSize:13,color:'var(--text-primary)'}}>{claim.claim_number}</span>
              {claim.insurance_carrier&&<span style={{fontSize:12,color:'var(--text-secondary)'}}>{claim.insurance_carrier}</span>}
              {claim.date_of_loss&&<span style={{fontSize:11,color:'var(--text-tertiary)'}}>Loss: {fmtDate(claim.date_of_loss)}</span>}
              {claim.insurance_claim_number&&<span style={{fontSize:11,color:'var(--text-tertiary)'}}>Ins#: {claim.insurance_claim_number}</span>}
              <span style={{marginLeft:'auto',fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,background:claim.status==='open'?'#eff6ff':claim.status==='closed'?'#f1f3f5':'#fffbeb',color:claim.status==='open'?'#2563eb':claim.status==='closed'?'#6b7280':'#d97706'}}>{claim.status}</span>
            </div>
            {claim.loss_address&&<div style={{padding:'var(--space-2) var(--space-4)',fontSize:12,color:'var(--text-tertiary)',borderBottom:'1px solid var(--border-light)'}}>
              {'\u{1F4CD}'} {claim.loss_address}{claim.loss_city?`, ${claim.loss_city}`:''}{claim.loss_state?` ${claim.loss_state}`:''}
            </div>}
            <div style={{padding:'var(--space-3) var(--space-4)'}}>
              {jobs.map(j=>{const ps=getPhaseStyle(j.phase);const dc=DIVISION_COLORS[j.division]||'#6b7280';const em=DIVISION_EMOJI[j.division]||'\u{1F4C1}';const est=j.estimated_value||j.approved_value;
                return(<div key={j.id} onClick={()=>onNavigateJob(j.id)} style={{display:'flex',alignItems:'center',gap:'var(--space-3)',padding:'var(--space-3)',marginBottom:'var(--space-2)',background:'var(--bg-primary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-light)',borderLeft:`3px solid ${dc}`,cursor:'pointer',transition:'border-color 0.15s'}}>
                  <span style={{fontSize:18}}>{em}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:13,fontWeight:700,color:'var(--text-primary)'}}>{j.job_number||'New'}</span><span style={{fontSize:11,color:'var(--text-secondary)',textTransform:'capitalize'}}>{j.division?.replace(/_/g,' ')}</span></div>
                    {est>0&&<div style={{fontSize:11,color:'var(--text-tertiary)',marginTop:1}}>{fmtCurrency(est)}</div>}
                  </div>
                  <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,background:ps.bg,color:ps.color,whiteSpace:'nowrap'}}>{ps.label}</span>
                  <span style={{fontSize:11,color:'var(--brand-primary)',fontWeight:600}}>{'\u2192'}</span>
                </div>);
              })}
              <button className="btn btn-ghost btn-sm" onClick={()=>{if(jobs[0])onAddRelatedJob(jobs[0],claim,jobs);}} style={{width:'100%',justifyContent:'center',gap:4,marginTop:'var(--space-1)',color:'var(--brand-primary)',fontSize:12}}>
                <IconPlus style={{width:12,height:12}}/> Add Related Job
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══ FINANCIAL TAB ═══ */
function FinancialTab({fin,claims,fmtCurrency2,onNavigateJob}){
  const tc=Number(fin.total_labor_cost||0)+Number(fin.total_material_cost||0)+Number(fin.total_equipment_cost||0)+Number(fin.total_sub_cost||0)+Number(fin.total_other_cost||0);
  const rb=Number(fin.total_approved||0)>0?Number(fin.total_approved):Number(fin.total_estimated||0);
  const gp=rb-tc;const mg=rb>0?((gp/rb)*100).toFixed(1):'0.0';const os=Number(fin.total_invoiced||0)-Number(fin.total_collected||0);
  const allJobs=claims.flatMap(cl=>(cl.jobs||[]).map(j=>({...j,claim_number:cl.claim_number})));
  return(
    <div className="job-page-financial">
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))',gap:10,marginBottom:16}}>
        <SummaryCard label="Estimated" value={fmtCurrency2(fin.total_estimated)}/><SummaryCard label="Approved" value={fmtCurrency2(fin.total_approved)}/>
        <SummaryCard label="Invoiced" value={fmtCurrency2(fin.total_invoiced)}/><SummaryCard label="Collected" value={fmtCurrency2(fin.total_collected)} color="#059669"/>
        {os>0&&<SummaryCard label="Outstanding" value={fmtCurrency2(os)} color="#d97706"/>}
      </div>
      <div className="job-page-section"><div className="job-page-section-title">Revenue (All Jobs)</div>
        <FinRow label="Total Estimated" value={fmtCurrency2(fin.total_estimated)}/><FinRow label="Total Approved" value={fmtCurrency2(fin.total_approved)}/>
        <FinRow label="Total Invoiced" value={fmtCurrency2(fin.total_invoiced)}/><FinRow label="Total Collected" value={fmtCurrency2(fin.total_collected)}/>
      </div>
      <div className="job-page-section"><div className="job-page-section-title">Insurance (All Jobs)</div>
        <FinRow label="Total Deductible" value={fmtCurrency2(fin.total_deductible)}/><FinRow label="Depreciation Held" value={fmtCurrency2(fin.total_depreciation_held)}/>
        <FinRow label="Depreciation Released" value={fmtCurrency2(fin.total_depreciation_released)}/><FinRow label="Supplement" value={fmtCurrency2(fin.total_supplement)}/>
      </div>
      <div className="job-page-section"><div className="job-page-section-title">Cost Breakdown</div>
        <FinRow label="Labor" value={fmtCurrency2(fin.total_labor_cost)}/><FinRow label="Materials" value={fmtCurrency2(fin.total_material_cost)}/>
        <FinRow label="Equipment" value={fmtCurrency2(fin.total_equipment_cost)}/><FinRow label="Subcontractors" value={fmtCurrency2(fin.total_sub_cost)}/>
        <FinRow label="Other" value={fmtCurrency2(fin.total_other_cost)}/><div className="job-page-fin-divider"/><FinRow label="Total Cost" value={fmtCurrency2(tc)} bold/>
      </div>
      <div className="job-page-section"><div className="job-page-section-title">Profitability</div>
        <FinRow label={Number(fin.total_approved)>0?'Approved Revenue':'Estimated Revenue'} value={fmtCurrency2(rb)}/><FinRow label="Total Cost" value={fmtCurrency2(tc)}/>
        <div className="job-page-fin-divider"/><FinRow label="Gross Profit" value={fmtCurrency2(gp)} bold color={gp>=0?'#10b981':'#ef4444'}/>
        <FinRow label="Margin" value={`${mg}%`} bold color={gp>=0?'#10b981':'#ef4444'}/>{os>0&&<FinRow label="Outstanding" value={fmtCurrency2(os)} color="#d97706" bold/>}
      </div>
      {allJobs.length>1&&(
        <div className="job-page-section job-page-section-full"><div className="job-page-section-title">Per-Job Breakdown</div>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'2px solid var(--border-color)'}}>
              <th style={thStyle}>Job</th><th style={thStyle}>Division</th><th style={{...thStyle,textAlign:'right'}}>Estimated</th>
              <th style={{...thStyle,textAlign:'right'}}>Approved</th><th style={{...thStyle,textAlign:'right'}}>Invoiced</th><th style={{...thStyle,textAlign:'right'}}>Collected</th>
            </tr></thead>
            <tbody>{allJobs.map(j=>(
              <tr key={j.id} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer'}} onClick={()=>onNavigateJob(j.id)}>
                <td style={tdStyle}><span style={{fontWeight:600,color:'var(--brand-primary)'}}>{j.job_number||'\u2014'}</span></td>
                <td style={tdStyle}>{DIVISION_EMOJI[j.division]||''} {j.division}</td>
                <td style={{...tdStyle,textAlign:'right'}}>{fmtCurrency2(j.estimated_value)}</td><td style={{...tdStyle,textAlign:'right'}}>{fmtCurrency2(j.approved_value)}</td>
                <td style={{...tdStyle,textAlign:'right'}}>{fmtCurrency2(j.invoiced_value)}</td><td style={{...tdStyle,textAlign:'right'}}>{fmtCurrency2(j.collected_value)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

/* ═══ FILES TAB ═══ */
function FilesTab({files}){
  if(files.length===0)return(<div className="empty-state" style={{paddingTop:40}}><div className="empty-state-icon">{'\u{1F4C1}'}</div><div className="empty-state-text">No files yet</div><div className="empty-state-sub">Files uploaded to linked jobs will appear here</div></div>);
  const byJob={};for(const f of files){const k=f.job_number||f.job_id||'unknown';if(!byJob[k])byJob[k]={job_number:f.job_number,files:[]};byJob[k].files.push(f);}
  const isImg=f=>f.mime_type?.startsWith('image/');
  const url=f=>`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/job-files/${f.file_path}`;
  const sz=b=>{if(!b)return'';if(b<1024)return`${b} B`;if(b<1048576)return`${(b/1024).toFixed(1)} KB`;return`${(b/1048576).toFixed(1)} MB`;};
  return(<div>{Object.entries(byJob).map(([k,g])=>(
    <div key={k} style={{marginBottom:'var(--space-5)'}}>
      <div style={{fontSize:11,fontWeight:700,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'var(--space-2)'}}>Job: {g.job_number||'Unknown'}</div>
      <div className="job-page-files-grid">{g.files.map(d=>(
        <div key={d.id} className="job-page-file-card">
          {isImg(d)?<a href={url(d)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview"><img src={url(d)} alt={d.name} loading="lazy"/></a>
            :<a href={url(d)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">{d.mime_type?.includes('pdf')?'\u{1F4C4}':'\u{1F4CE}'}</a>}
          <div className="job-page-file-info"><a href={url(d)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{d.name}</a>
            <div className="job-page-file-meta"><span className="job-page-file-cat-badge">{d.category}</span>{d.file_size&&<span>{sz(d.file_size)}</span>}</div></div>
        </div>
      ))}</div>
    </div>
  ))}</div>);
}

/* ═══ ACTIVITY TAB ═══ */
function ActivityTab({activity}){
  if(activity.length===0)return(<div className="empty-state" style={{paddingTop:40}}><div className="empty-state-icon">{'\u{1F4DD}'}</div><div className="empty-state-text">No activity yet</div></div>);
  const fmtDT=v=>{if(!v)return'\u2014';return new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
  return(
    <div className="job-page-timeline">{activity.map(item=>(
      <div key={`${item.type}-${item.id}`} className={`job-page-timeline-item timeline-${item.type}`}>
        <div className="job-page-timeline-dot"/>
        <div className="job-page-timeline-content">
          <div className="job-page-timeline-header"><span className="job-page-timeline-author">{item.author}</span><span className="job-page-timeline-time">{fmtDT(item.date)}</span></div>
          <div className="job-page-timeline-text">{item.content}</div>
          {item.job_number&&<span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',marginTop:2,display:'inline-block'}}>Job: {item.job_number}</span>}
        </div>
      </div>
    ))}</div>
  );
}

/* ═══ Shared ═══ */
function InfoRow({label,value,href}){
  return(<div className="job-page-info-row"><span className="job-page-info-label">{label}</span>
    {!value?<span className="job-page-info-value" style={{color:'var(--text-tertiary)'}}>{'\u2014'}</span>
      :href?<a href={href} className="job-page-info-value" style={{color:'var(--brand-primary)',textDecoration:'none'}}>{value}</a>
      :<span className="job-page-info-value">{value}</span>}
  </div>);
}
function EditField({label,value,onChange,type='text',placeholder,required,style}){
  return(<div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0',...style}}>
    <span className="job-page-info-label" style={{marginBottom:2}}>{label}{required&&' *'}</span>
    <input className="input" type={type} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder||label} style={{height:34,fontSize:'var(--text-sm)'}}/>
  </div>);
}
function EditSelect({label,value,onChange,options}){
  return(<div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0'}}>
    <span className="job-page-info-label" style={{marginBottom:2}}>{label}</span>
    <select className="input" value={value||''} onChange={e=>onChange(e.target.value)} style={{height:34,fontSize:'var(--text-sm)',cursor:'pointer'}}>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>);
}
function FinRow({label,value,bold,color}){
  return(<div className="job-page-info-row"><span className="job-page-info-label" style={bold?{fontWeight:600}:undefined}>{label}</span>
    <span className="job-page-info-value" style={{fontWeight:bold?700:400,color:color||'var(--text-primary)'}}>{value}</span></div>);
}
function SummaryCard({label,value,color}){
  return(<div className="job-page-section" style={{padding:'12px 14px',textAlign:'center'}}>
    <div style={{fontSize:18,fontWeight:700,color:color||'var(--text-primary)'}}>{value}</div>
    <div style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',marginTop:2,textTransform:'uppercase',letterSpacing:'0.03em'}}>{label}</div>
  </div>);
}
const thStyle={padding:'8px 10px',textAlign:'left',fontWeight:600,color:'var(--text-tertiary)',fontSize:11,textTransform:'uppercase',letterSpacing:'0.03em'};
const tdStyle={padding:'8px 10px',color:'var(--text-secondary)'};
