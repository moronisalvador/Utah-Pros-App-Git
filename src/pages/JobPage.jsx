import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import ScheduleWizard from '@/components/ScheduleWizard';
import AddRelatedJobModal from '@/components/AddRelatedJobModal';
import DatePicker from '@/components/DatePicker';
import SendEsignModal from '@/components/SendEsignModal';

const PRIORITY_OPTIONS=[{value:1,label:'Urgent',color:'#ef4444'},{value:2,label:'High',color:'#f59e0b'},{value:3,label:'Normal',color:'#2563eb'},{value:4,label:'Low',color:'#8b929e'}];
const DIVISION_OPTIONS=[{value:'water',label:'Water'},{value:'mold',label:'Mold'},{value:'reconstruction',label:'Reconstruction'},{value:'fire',label:'Fire'},{value:'contents',label:'Contents'}];
const FILE_CATEGORIES=[{key:'photo',label:'Photos'},{key:'estimate',label:'Estimates'},{key:'invoice',label:'Invoices'},{key:'moisture_log',label:'Moisture Logs'},{key:'receipt',label:'Receipts'},{key:'contract',label:'Contracts'},{key:'other',label:'Other'}];
const DIVISION_EMOJI={water:'\u{1F4A7}',mold:'\u{1F9A0}',reconstruction:'\u{1F3D7}\uFE0F',fire:'\u{1F525}',contents:'\u{1F4E6}'};
const DIVISION_COLORS={water:'#2563eb',mold:'#9d174d',reconstruction:'#d97706',fire:'#dc2626',contents:'#059669'};

function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}

/* ═══ TILE HEADER — pencil / Save / Cancel per section ═══ */
function TileHeader({title,editing,onEdit,onSave,onCancel,saving,children}){
  return(<div className="job-page-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
    <span>{title}</span>
    <div style={{display:'flex',gap:'var(--space-2)',alignItems:'center'}}>
      {children}
      {!editing?(<button className="btn btn-ghost btn-sm" onClick={onEdit} style={{width:26,height:26,padding:0,color:'var(--text-tertiary)'}} title="Edit"><IconEdit style={{width:13,height:13}}/></button>
      ):(<><button className="btn btn-ghost btn-sm" onClick={onCancel} style={{height:26,fontSize:11}}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving} style={{height:26,fontSize:11}}>{saving?'...':'Save'}</button></>)}
    </div>
  </div>);
}
function IR({label,value,href}){return(<div className="job-page-info-row"><span className="job-page-info-label">{label}</span>{!value?<span className="job-page-info-value" style={{color:'var(--text-tertiary)'}}>—</span>:href?<a href={href} className="job-page-info-value" style={{color:'var(--brand-primary)',textDecoration:'none'}} onClick={e=>e.stopPropagation()}>{value}</a>:<span className="job-page-info-value">{value}</span>}</div>);}
function EF({label,value,onChange,type='text',placeholder,style}){return(<div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0',...style}}><span className="job-page-info-label" style={{marginBottom:2}}>{label}</span><input className="input" type={type} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder||label} style={{height:34,fontSize:'var(--text-sm)'}}/></div>);}
function ES({label,value,onChange,options}){return(<div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0'}}><span className="job-page-info-label" style={{marginBottom:2}}>{label}</span><select className="input" value={value||''} onChange={e=>onChange(e.target.value)} style={{height:34,fontSize:'var(--text-sm)',cursor:'pointer'}}><option value="">—</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>);}
function FR({label,value,bold,color}){return(<div className="job-page-info-row"><span className="job-page-info-label" style={bold?{fontWeight:600}:undefined}>{label}</span><span className="job-page-info-value" style={{fontWeight:bold?700:400,color:color||'var(--text-primary)'}}>{value}</span></div>);}
function fmtPh(phone){if(!phone)return'';const d=phone.replace(/\D/g,'');const n=d.startsWith('1')?d.slice(1):d;if(n.length===10)return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;return phone;}

export default function JobPage(){
  const{jobId}=useParams();const navigate=useNavigate();const{db,employee:currentUser}=useAuth();
  const[job,setJob]=useState(null);const[phases,setPhases]=useState([]);const[employees,setEmployees]=useState([]);
  const[loading,setLoading]=useState(true);const[activeTab,setActiveTab]=useState('overview');
  const[documents,setDocuments]=useState([]);const[notes,setNotes]=useState([]);const[history,setHistory]=useState([]);
  const[saving,setSaving]=useState(false);const[showWizard,setShowWizard]=useState(false);const[taskSummary,setTaskSummary]=useState(null);
  const[showEsign,setShowEsign]=useState(false);
  const[claimData,setClaimData]=useState(null);const[siblingJobs,setSiblingJobs]=useState([]);const[showAddRelated,setShowAddRelated]=useState(false);

  useEffect(()=>{loadJob();},[jobId]);
  const loadJob=async()=>{
    setLoading(true);
    try{
      const[jobsData,phasesData,empsData,docsData,notesData,histData]=await Promise.all([
        db.select('jobs',`id=eq.${jobId}`),
        db.select('job_phases','is_active=eq.true&order=display_order.asc'),
        db.select('employees','is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
        db.select('job_documents',`job_id=eq.${jobId}&order=created_at.desc`).catch(()=>[]),
        db.select('job_notes',`job_id=eq.${jobId}&order=created_at.desc`).catch(()=>[]),
        db.select('job_phase_history',`job_id=eq.${jobId}&order=changed_at.desc&limit=50`).catch(()=>[]),
      ]);
      if(jobsData.length===0){navigate('/jobs',{replace:true});return;}
      setJob(jobsData[0]);setPhases(phasesData);setEmployees(empsData);
      setDocuments(docsData);setNotes(notesData);setHistory(histData);
      db.rpc('get_job_task_summary',{p_job_id:jobId}).then(d=>setTaskSummary(d)).catch(()=>setTaskSummary(null));
      if(jobsData[0]?.claim_id){
        db.rpc('get_claim_jobs',{p_claim_id:jobsData[0].claim_id}).then(d=>{
          setClaimData(d?.claim||null);setSiblingJobs((d?.jobs||[]).filter(j=>j.id!==jobsData[0].id));
        }).catch(()=>{});
      }
    }catch(err){console.error('Job load:',err);}finally{setLoading(false);}
  };

  const phaseMap=useMemo(()=>{const m={};for(const p of phases)m[p.key]=p;return m;},[phases]);

  const handlePhaseChange=async(newPhase)=>{
    if(newPhase===job.phase)return;setSaving(true);
    try{
      await db.update('jobs',`id=eq.${job.id}`,{phase:newPhase,phase_entered_at:new Date().toISOString(),updated_at:new Date().toISOString()});
      await db.insert('job_phase_history',{job_id:job.id,from_phase:job.phase,to_phase:newPhase,changed_by:currentUser?.id||null,changed_at:new Date().toISOString()});
      setJob(prev=>({...prev,phase:newPhase,phase_entered_at:new Date().toISOString()}));
      const h=await db.select('job_phase_history',`job_id=eq.${job.id}&order=changed_at.desc&limit=50`).catch(()=>[]);setHistory(h);
    }catch(err){alert('Failed: '+err.message);}finally{setSaving(false);}
  };

  // Batch save utility for tiles
  const saveBatch=async(fields)=>{
    const update={...fields,updated_at:new Date().toISOString()};
    await db.update('jobs',`id=eq.${job.id}`,update);
    setJob(prev=>({...prev,...update}));
  };

  const fmt=v=>{if(v==null)return'\u2014';return`$${Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;};
  const fmtDate=v=>{if(!v)return'\u2014';return new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});};
  const fmtDateTime=v=>{if(!v)return'\u2014';return new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};

  if(loading)return<div className="loading-page"><div className="spinner"/></div>;
  if(!job)return null;

  const phaseLabel=phaseMap[job.phase]?.label||job.phase;
  const divEmoji=DIVISION_EMOJI[job.division]||'\u{1F4C1}';
  const priorityObj=PRIORITY_OPTIONS.find(p=>p.value===job.priority)||PRIORITY_OPTIONS[2];
  const TABS=[{key:'overview',label:'Overview'},{key:'schedule',label:'Schedule',count:taskSummary?.total||0},{key:'files',label:'Files',count:documents.length},{key:'financial',label:'Financial'},{key:'activity',label:'Activity',count:notes.length+history.length}];

  return(
    <div className="job-page">
      <div className="job-page-topbar">
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate(-1)} style={{gap:4}}>{'\u2190'} Back</button>
        <div className="job-page-topbar-actions">
          <select className="input" value={job.phase} onChange={e=>handlePhaseChange(e.target.value)} disabled={saving} style={{width:'auto',minWidth:160,fontWeight:600,height:32}}>
            {phases.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="job-page-header">
        <div className="job-page-header-left">
          <div className="job-page-division-icon">{divEmoji}</div>
          <div>
            <div className="job-page-jobnumber">{job.job_number||'No Job #'}</div>
            <div className="job-page-client" style={{cursor:job.primary_contact_id?'pointer':undefined}} onClick={()=>{if(job.primary_contact_id)navigate(`/customers/${job.primary_contact_id}`);}}>{job.insured_name||'Unknown Client'}{job.primary_contact_id&&<span style={{fontSize:11,color:'var(--brand-primary)',marginLeft:6}}>{'\u2192'}</span>}</div>
            {job.address&&<div className="job-page-address">{job.address}{job.city?`, ${job.city}`:''}{job.state?` ${job.state}`:''}</div>}
          </div>
        </div>
        <div className="job-page-header-right">
          <span className={`status-badge status-${phaseClass(job.phase)}`}>{phaseLabel}</span>
          <span style={{fontSize:13,fontWeight:600,color:priorityObj.color}}>{priorityObj.label}</span>
          {(job.is_cat_loss||job.has_asbestos||job.has_lead)&&(
            <div style={{display:'flex',gap:4}}>
              {job.is_cat_loss&&<span className="job-flag flag-red">CAT</span>}
              {job.has_asbestos&&<span className="job-flag flag-red">ASB</span>}
              {job.has_lead&&<span className="job-flag flag-red">LEAD</span>}
            </div>
          )}
        </div>
      </div>

      <div className="job-page-tabs">{TABS.map(tab=>(
        <button key={tab.key} className={`job-page-tab${activeTab===tab.key?' active':''}`} onClick={()=>setActiveTab(tab.key)}>
          {tab.label}{tab.count>0&&<span className="job-page-tab-count">{tab.count}</span>}
        </button>
      ))}</div>

      <PullToRefresh onRefresh={loadJob} className="job-page-content">
        {activeTab==='overview'&&<OverviewTab job={job} employees={employees} saveBatch={saveBatch} fmtDate={fmtDate} claimData={claimData} siblingJobs={siblingJobs} onAddRelatedJob={()=>setShowAddRelated(true)} onNavigateJob={id=>navigate(`/jobs/${id}`)} onNavigateCustomer={id=>navigate(`/customers/${id}`)}/>}
        {activeTab==='schedule'&&<ScheduleTab jobId={job.id} taskSummary={taskSummary} onGenerateClick={()=>setShowWizard(true)} navigate={navigate}/>}
        {activeTab==='files'&&<FilesTab job={job} documents={documents} setDocuments={setDocuments} db={db} currentUser={currentUser} onSignRequest={()=>setShowEsign(true)}/>}
        {activeTab==='financial'&&<FinancialTab job={job} fmt={fmt}/>}
        {activeTab==='activity'&&<ActivityTab job={job} notes={notes} setNotes={setNotes} history={history} employees={employees} phaseMap={phaseMap} db={db} currentUser={currentUser} fmtDateTime={fmtDateTime}/>}
      </PullToRefresh>

      {showEsign&&<SendEsignModal job={job} currentUser={currentUser} onClose={()=>setShowEsign(false)} onSent={()=>{setShowEsign(false);db.select('job_documents',`job_id=eq.${job.id}&order=created_at.desc`).then(setDocuments).catch(()=>{});}} />}
      {showWizard&&<ScheduleWizard jobId={job.id} jobName={job.insured_name||job.job_number||'Job'} onClose={()=>setShowWizard(false)} onGenerated={()=>{setShowWizard(false);loadJob();}}/>}
      {showAddRelated&&<AddRelatedJobModal sourceJob={job} claimData={claimData} siblingJobs={siblingJobs} employees={employees} db={db} onClose={()=>setShowAddRelated(false)} onCreated={r=>{setShowAddRelated(false);if(r?.job?.id)navigate(`/jobs/${r.job.id}`);}}/>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   OVERVIEW TAB — per-tile editing
   ═══════════════════════════════════════════════════ */
function OverviewTab({job,employees,saveBatch,fmtDate,claimData,siblingJobs,onAddRelatedJob,onNavigateJob,onNavigateCustomer}){
  return(
    <div className="job-page-grid">
      <ClientTile job={job} saveBatch={saveBatch} onNavigateCustomer={onNavigateCustomer}/>
      <InsuranceTile job={job} saveBatch={saveBatch}/>
      <JobDetailsTile job={job} saveBatch={saveBatch} fmtDate={fmtDate}/>
      <TeamTile job={job} employees={employees} saveBatch={saveBatch}/>
      <NotesTile job={job} saveBatch={saveBatch}/>
      {job.encircle_summary&&(<div className="job-page-section job-page-section-full"><div className="job-page-section-title">Encircle Summary</div><div style={{fontSize:'var(--text-sm)',whiteSpace:'pre-wrap',color:'var(--text-secondary)'}}>{job.encircle_summary}</div></div>)}
      {claimData&&<RelatedJobsSection claimData={claimData} siblingJobs={siblingJobs} onAddRelatedJob={onAddRelatedJob} onNavigateJob={onNavigateJob}/>}
    </div>
  );
}

/* ═══ CLIENT INFO TILE ═══ */
function ClientTile({job,saveBatch,onNavigateCustomer}){
  const[ed,setEd]=useState(false);const[sv,setSv]=useState(false);
  const[f,sF]=useState({});
  const start=()=>{sF({insured_name:job.insured_name||'',client_phone:fmtPh(job.client_phone),client_email:job.client_email||'',address:job.address||'',city:job.city||'',state:job.state||'',zip:job.zip||''});setEd(true);};
  const save=async()=>{setSv(true);try{let ph=f.client_phone.replace(/\D/g,'');if(ph.length===10)ph='1'+ph;if(!ph.startsWith('+'))ph='+'+ph;
    await saveBatch({insured_name:f.insured_name?.trim()||null,client_phone:ph||null,client_email:f.client_email?.trim()||null,address:f.address?.trim()||null,city:f.city?.trim()||null,state:f.state?.trim()||null,zip:f.zip?.trim()||null});
    setEd(false);}catch(err){alert('Failed: '+err.message);}finally{setSv(false);}};
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));
  return(
    <div className="job-page-section">
      <TileHeader title="Client Information" editing={ed} onEdit={start} onCancel={()=>setEd(false)} onSave={save} saving={sv}>
        {!ed&&job.primary_contact_id&&<button className="btn btn-ghost btn-sm" onClick={()=>onNavigateCustomer(job.primary_contact_id)} style={{height:26,fontSize:11,gap:3,color:'var(--brand-primary)'}}>View Customer {'\u2192'}</button>}
      </TileHeader>
      {ed?(<>
        <EF label="Name" value={f.insured_name} onChange={v=>s('insured_name',v)}/>
        <EF label="Phone" value={f.client_phone} onChange={v=>s('client_phone',v)} type="tel"/>
        <EF label="Email" value={f.client_email} onChange={v=>s('client_email',v)} type="email"/>
        <div style={{marginTop:'var(--space-2)',paddingTop:'var(--space-2)',borderTop:'1px solid var(--border-light)'}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text-tertiary)',marginBottom:'var(--space-2)'}}>Loss / Service Address</div>
          <EF label="Street" value={f.address} onChange={v=>s('address',v)}/>
          <div style={{display:'flex',gap:'var(--space-2)'}}>
            <EF label="City" value={f.city} onChange={v=>s('city',v)}/>
            <EF label="State" value={f.state} onChange={v=>s('state',v)} style={{maxWidth:80}}/>
            <EF label="ZIP" value={f.zip} onChange={v=>s('zip',v)} style={{maxWidth:100}}/>
          </div>
        </div>
      </>):(<>
        <IR label="Name" value={job.insured_name}/>
        <IR label="Phone" value={fmtPh(job.client_phone)} href={job.client_phone?`tel:${job.client_phone}`:null}/>
        <IR label="Email" value={job.client_email} href={job.client_email?`mailto:${job.client_email}`:null}/>
        {job.address&&<><div style={{marginTop:'var(--space-2)',paddingTop:'var(--space-2)',borderTop:'1px solid var(--border-light)'}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text-tertiary)',marginBottom:4}}>Loss / Service Address</div>
          <div style={{fontSize:'var(--text-sm)',color:'var(--text-primary)',lineHeight:1.5}}>{job.address}{job.city?`, ${job.city}`:''}{job.state?` ${job.state}`:''} {job.zip||''}</div>
        </div></>}
      </>)}
    </div>);
}

/* ═══ INSURANCE TILE ═══ */
function InsuranceTile({job,saveBatch}){
  const[ed,setEd]=useState(false);const[sv,setSv]=useState(false);const[f,sF]=useState({});
  const start=()=>{sF({insurance_company:job.insurance_company||'',claim_number:job.claim_number||'',policy_number:job.policy_number||'',adjuster_name:job.adjuster_name||job.adjuster||'',adjuster_phone:fmtPh(job.adjuster_phone),adjuster_email:job.adjuster_email||'',cat_code:job.cat_code||''});setEd(true);};
  const save=async()=>{setSv(true);try{
    await saveBatch({insurance_company:f.insurance_company?.trim()||null,claim_number:f.claim_number?.trim()||null,policy_number:f.policy_number?.trim()||null,adjuster_name:f.adjuster_name?.trim()||null,adjuster_phone:f.adjuster_phone?.trim()||null,adjuster_email:f.adjuster_email?.trim()||null,cat_code:f.cat_code?.trim()||null});
    setEd(false);}catch(err){alert('Failed: '+err.message);}finally{setSv(false);}};
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));
  return(
    <div className="job-page-section">
      <TileHeader title="Insurance" editing={ed} onEdit={start} onCancel={()=>setEd(false)} onSave={save} saving={sv}/>
      {ed?(<>
        <EF label="Company" value={f.insurance_company} onChange={v=>s('insurance_company',v)}/>
        <div style={{display:'flex',gap:'var(--space-2)'}}><EF label="Claim #" value={f.claim_number} onChange={v=>s('claim_number',v)}/><EF label="Policy #" value={f.policy_number} onChange={v=>s('policy_number',v)}/></div>
        <EF label="Adjuster" value={f.adjuster_name} onChange={v=>s('adjuster_name',v)}/>
        <div style={{display:'flex',gap:'var(--space-2)'}}><EF label="Adj. Phone" value={f.adjuster_phone} onChange={v=>s('adjuster_phone',v)} type="tel"/><EF label="Adj. Email" value={f.adjuster_email} onChange={v=>s('adjuster_email',v)} type="email"/></div>
        <EF label="CAT Code" value={f.cat_code} onChange={v=>s('cat_code',v)}/>
      </>):(<>
        <IR label="Company" value={job.insurance_company}/><IR label="Claim #" value={job.claim_number}/><IR label="Policy #" value={job.policy_number}/>
        <IR label="Adjuster" value={job.adjuster_name||job.adjuster}/>
        <IR label="Adj. Phone" value={fmtPh(job.adjuster_phone)} href={job.adjuster_phone?`tel:${job.adjuster_phone}`:null}/>
        <IR label="Adj. Email" value={job.adjuster_email} href={job.adjuster_email?`mailto:${job.adjuster_email}`:null}/>
        <IR label="CAT Code" value={job.cat_code}/>
      </>)}
    </div>);
}

/* ═══ JOB DETAILS TILE ═══ */
function JobDetailsTile({job,saveBatch,fmtDate}){
  const[ed,setEd]=useState(false);const[sv,setSv]=useState(false);const[f,sF]=useState({});
  const start=()=>{sF({job_number:job.job_number||'',division:job.division||'water',priority:job.priority||3,source:job.source||'',type_of_loss:job.type_of_loss||'',date_of_loss:job.date_of_loss?job.date_of_loss.split('T')[0]:'',received_date:job.received_date?job.received_date.split('T')[0]:'',target_completion:job.target_completion?job.target_completion.split('T')[0]:'',encircle_claim_id:job.encircle_claim_id||''});setEd(true);};
  const save=async()=>{setSv(true);try{
    await saveBatch({job_number:f.job_number?.trim()||null,division:f.division,priority:parseInt(f.priority)||3,source:f.source?.trim()||null,type_of_loss:f.type_of_loss?.trim()||null,date_of_loss:f.date_of_loss||null,received_date:f.received_date||null,target_completion:f.target_completion||null,encircle_claim_id:f.encircle_claim_id?.trim()||null});
    setEd(false);}catch(err){alert('Failed: '+err.message);}finally{setSv(false);}};
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));
  const divLabel=DIVISION_OPTIONS.find(d=>d.value===job.division)?.label||job.division;
  const priLabel=PRIORITY_OPTIONS.find(p=>p.value===job.priority)?.label||'Normal';
  return(
    <div className="job-page-section">
      <TileHeader title="Job Details" editing={ed} onEdit={start} onCancel={()=>setEd(false)} onSave={save} saving={sv}/>
      {ed?(<>
        <EF label="Job #" value={f.job_number} onChange={v=>s('job_number',v)}/>
        <div style={{display:'flex',gap:'var(--space-2)'}}><ES label="Division" value={f.division} onChange={v=>s('division',v)} options={DIVISION_OPTIONS}/><ES label="Priority" value={f.priority} onChange={v=>s('priority',v)} options={PRIORITY_OPTIONS}/></div>
        <EF label="Source" value={f.source} onChange={v=>s('source',v)}/>
        <EF label="Type of Loss" value={f.type_of_loss} onChange={v=>s('type_of_loss',v)}/>
        <div style={{display:'flex',gap:'var(--space-2)'}}>
          <div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0',flex:1}}><span className="job-page-info-label" style={{marginBottom:2}}>Date of Loss</span><DatePicker value={f.date_of_loss} onChange={v=>s('date_of_loss',v)}/></div>
          <div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0',flex:1}}><span className="job-page-info-label" style={{marginBottom:2}}>Received</span><DatePicker value={f.received_date} onChange={v=>s('received_date',v)}/></div>
        </div>
        <div className="job-page-info-row" style={{flexDirection:'column',alignItems:'stretch',gap:2,padding:'var(--space-2) 0'}}><span className="job-page-info-label" style={{marginBottom:2}}>Target Completion</span><DatePicker value={f.target_completion} onChange={v=>s('target_completion',v)}/></div>
        <EF label="Encircle ID" value={f.encircle_claim_id} onChange={v=>s('encircle_claim_id',v)}/>
      </>):(<>
        <IR label="Job #" value={job.job_number}/><IR label="Division" value={divLabel}/><IR label="Priority" value={priLabel}/>
        <IR label="Source" value={job.source}/><IR label="Type of Loss" value={job.type_of_loss}/>
        <IR label="Date of Loss" value={fmtDate(job.date_of_loss)}/><IR label="Received" value={fmtDate(job.received_date)}/>
        <IR label="Target Complete" value={fmtDate(job.target_completion)}/>
        {job.encircle_claim_id&&<IR label="Encircle ID" value={job.encircle_claim_id}/>}
      </>)}
    </div>);
}

/* ═══ TEAM TILE ═══ */
function TeamTile({job,employees,saveBatch}){
  const[ed,setEd]=useState(false);const[sv,setSv]=useState(false);const[f,sF]=useState({});
  const start=()=>{sF({project_manager_id:job.project_manager_id||'',lead_tech_id:job.lead_tech_id||'',broker_agent:job.broker_agent||''});setEd(true);};
  const save=async()=>{setSv(true);try{
    await saveBatch({project_manager_id:f.project_manager_id||null,lead_tech_id:f.lead_tech_id||null,broker_agent:f.broker_agent?.trim()||null});
    setEd(false);}catch(err){alert('Failed: '+err.message);}finally{setSv(false);}};
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));
  const pmName=employees.find(e=>e.id===job.project_manager_id)?.full_name;
  const ltName=employees.find(e=>e.id===job.lead_tech_id)?.full_name;

  // Flags always save immediately (not part of tile edit mode)
  const toggleFlag=async(field,val)=>{try{await saveBatch({[field]:!val});}catch(err){alert('Failed: '+err.message);}};

  return(
    <div className="job-page-section">
      <TileHeader title="Team" editing={ed} onEdit={start} onCancel={()=>setEd(false)} onSave={save} saving={sv}/>
      {ed?(<>
        <ES label="Project Manager" value={f.project_manager_id} onChange={v=>s('project_manager_id',v)} options={employees.map(e=>({value:e.id,label:e.full_name}))}/>
        <ES label="Lead Tech" value={f.lead_tech_id} onChange={v=>s('lead_tech_id',v)} options={employees.filter(e=>e.role==='field_tech').map(e=>({value:e.id,label:e.full_name}))}/>
        <EF label="Broker/Agent" value={f.broker_agent} onChange={v=>s('broker_agent',v)}/>
      </>):(<>
        <IR label="Project Manager" value={pmName}/><IR label="Lead Tech" value={ltName}/><IR label="Broker/Agent" value={job.broker_agent}/>
      </>)}
      {/* Flags — always active, not part of edit mode */}
      <div style={{marginTop:12,display:'flex',flexWrap:'wrap',gap:8}}>
        <FlagToggle label="CAT Loss" value={job.is_cat_loss} onClick={()=>toggleFlag('is_cat_loss',job.is_cat_loss)}/>
        <FlagToggle label="Asbestos" value={job.has_asbestos} onClick={()=>toggleFlag('has_asbestos',job.has_asbestos)}/>
        <FlagToggle label="Lead" value={job.has_lead} onClick={()=>toggleFlag('has_lead',job.has_lead)}/>
        <FlagToggle label="Permit Req." value={job.requires_permit} onClick={()=>toggleFlag('requires_permit',job.requires_permit)}/>
      </div>
    </div>);
}

/* ═══ NOTES TILE ═══ */
function NotesTile({job,saveBatch}){
  const[ed,setEd]=useState(false);const[sv,setSv]=useState(false);const[val,setVal]=useState('');
  const start=()=>{setVal(job.internal_notes||'');setEd(true);};
  const save=async()=>{setSv(true);try{await saveBatch({internal_notes:val?.trim()||null});setEd(false);}catch(err){alert('Failed: '+err.message);}finally{setSv(false);}};
  return(
    <div className="job-page-section job-page-section-full">
      <TileHeader title="Internal Notes" editing={ed} onEdit={start} onCancel={()=>setEd(false)} onSave={save} saving={sv}/>
      {ed?(<textarea className="input textarea" value={val} onChange={e=>setVal(e.target.value)} rows={5} placeholder="Internal notes..." style={{width:'100%'}} autoFocus/>
      ):(<div style={{fontSize:'var(--text-sm)',color:job.internal_notes?'var(--text-secondary)':'var(--text-tertiary)',lineHeight:1.5,whiteSpace:'pre-wrap',fontStyle:job.internal_notes?'normal':'italic'}}>{job.internal_notes||'No notes'}</div>)}
    </div>);
}

/* ═══ RELATED JOBS SECTION ═══ */
function RelatedJobsSection({claimData,siblingJobs,onAddRelatedJob,onNavigateJob}){
  return(
    <div className="job-page-section job-page-section-full">
      <div className="job-page-section-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span>Related Jobs</span>
        <span style={{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',fontStyle:'normal',textTransform:'none',letterSpacing:0}}>{claimData.claim_number}</span>
      </div>
      {siblingJobs&&siblingJobs.length>0?(
        <div style={{display:'flex',flexDirection:'column',gap:'var(--space-2)'}}>
          {siblingJobs.map(sj=>{const dc=DIVISION_COLORS[sj.division]||'#6b7280';const de=DIVISION_EMOJI[sj.division]||'\u{1F4C1}';
            return(<div key={sj.id} onClick={()=>onNavigateJob?.(sj.id)} style={{display:'flex',alignItems:'center',gap:'var(--space-3)',padding:'var(--space-2) var(--space-3)',background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-light)',borderLeft:`3px solid ${dc}`,cursor:'pointer'}}>
              <span style={{fontSize:16}}>{de}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:'var(--text-primary)'}}>{sj.job_number||'New Job'} — {sj.division?.replace(/_/g,' ')}</div><div style={{fontSize:11,color:'var(--text-tertiary)',marginTop:1}}>{sj.phase?.replace(/_/g,' ')}</div></div>
              <span style={{fontSize:11,color:'var(--brand-primary)',fontWeight:600}}>{'\u2192'}</span>
            </div>);})}
        </div>
      ):(<div style={{fontSize:'var(--text-sm)',color:'var(--text-tertiary)',padding:'var(--space-2) 0'}}>No other jobs under this claim yet</div>)}
      <button className="btn btn-secondary btn-sm" onClick={onAddRelatedJob} style={{marginTop:'var(--space-3)',gap:4,width:'100%',justifyContent:'center'}}>+ Add Related Job</button>
    </div>);
}

function FlagToggle({label,value,onClick}){
  return(<button className={`job-page-flag-toggle${value?' active':''}`} onClick={onClick}>{value?'\u2713 ':''}{label}</button>);
}

/* ═══════════════════════════════════════════════════
   FINANCIAL TAB — per-tile editing
   ═══════════════════════════════════════════════════ */
function FinancialTab({job,fmt}){
  const estimated=Number(job.estimated_value||0);const approved=Number(job.approved_value||0);
  const invoiced=Number(job.invoiced_value||0);const collected=Number(job.collected_value||0);
  const deductible=Number(job.deductible||0);const deprecHeld=Number(job.depreciation_held||0);
  const deprecReleased=Number(job.depreciation_released||0);const supplement=Number(job.supplement_value||0);
  const laborCost=Number(job.total_labor_cost||0);const materialCost=Number(job.total_material_cost||0);
  const equipCost=Number(job.total_equipment_cost||0);const subCost=Number(job.total_sub_cost||0);
  const otherCost=Number(job.total_other_cost||0);const totalCost=laborCost+materialCost+equipCost+subCost+otherCost;
  const revenueBase=approved>0?approved:estimated;const grossProfit=revenueBase-totalCost;
  const margin=revenueBase>0?((grossProfit/revenueBase)*100).toFixed(1):'0.0';const outstanding=invoiced-collected;

  return(
    <div className="job-page-financial">
      <RevenueTile job={job} fmt={fmt}/>
      <InsFinTile job={job} fmt={fmt}/>
      <CostsTile job={job} fmt={fmt} totalCost={totalCost}/>
      {/* Profitability — always read-only */}
      <div className="job-page-section">
        <div className="job-page-section-title">Profitability</div>
        <FR label={approved>0?'Approved Rev.':'Estimated Rev.'} value={fmt(revenueBase)}/>
        <FR label="Total Cost" value={fmt(totalCost)}/>
        <div className="job-page-fin-divider"/>
        <FR label="Gross Profit" value={fmt(grossProfit)} bold color={grossProfit>=0?'var(--status-resolved)':'var(--status-needs-response)'}/>
        <FR label="Margin" value={`${margin}%`} bold color={grossProfit>=0?'var(--status-resolved)':'var(--status-needs-response)'}/>
        {outstanding>0&&<FR label="Outstanding" value={fmt(outstanding)} color="#d97706" bold/>}
      </div>
    </div>
  );
}

function RevenueTile({job,fmt}){
  return(<div className="job-page-section">
    <div className="job-page-section-title">Revenue</div>
    <FR label="Estimated" value={fmt(job.estimated_value)}/><FR label="Approved" value={fmt(job.approved_value)}/><FR label="Invoiced" value={fmt(job.invoiced_value)}/><FR label="Collected" value={fmt(job.collected_value)}/>
  </div>);
}

function InsFinTile({job,fmt}){
  return(<div className="job-page-section">
    <div className="job-page-section-title">Insurance Financials</div>
    <FR label="Deductible" value={fmt(job.deductible)}/><FR label="Depreciation Held" value={fmt(job.depreciation_held)}/><FR label="Depreciation Released" value={fmt(job.depreciation_released)}/><FR label="Supplement" value={fmt(job.supplement_value)}/>
  </div>);
}

function CostsTile({job,fmt,totalCost}){
  return(<div className="job-page-section">
    <div className="job-page-section-title">Cost Breakdown</div>
    <FR label="Labor" value={fmt(job.total_labor_cost)}/><FR label="Materials" value={fmt(job.total_material_cost)}/><FR label="Equipment" value={fmt(job.total_equipment_cost)}/><FR label="Subcontractors" value={fmt(job.total_sub_cost)}/><FR label="Other" value={fmt(job.total_other_cost)}/>
    <div className="job-page-fin-divider"/><FR label="Total Cost" value={fmt(totalCost)} bold/>
  </div>);
}

/* ═══ FILES TAB ═══ */
function FilesTab({job,documents,setDocuments,db,currentUser,onSignRequest}){
  const[uploading,setUploading]=useState(false);const[filterCat,setFilterCat]=useState('all');const[uploadCategory,setUploadCategory]=useState('photo');const fileInputRef=useRef(null);
  const filtered=filterCat==='all'?documents:documents.filter(d=>d.category===filterCat);
  const catCounts=useMemo(()=>{const c={all:documents.length};for(const d of documents)c[d.category]=(c[d.category]||0)+1;return c;},[documents]);
  const handleUpload=async(e)=>{const files=Array.from(e.target.files);if(!files.length)return;setUploading(true);
    try{for(const file of files){const sp=`${job.id}/${Date.now()}-${file.name}`;const fd=new FormData();fd.append('file',file);
      const r=await fetch(`${db.baseUrl}/storage/v1/object/job-files/${sp}`,{method:'POST',headers:{'Authorization':`Bearer ${db.apiKey}`,'apikey':db.apiKey},body:fd});
      if(!r.ok)throw new Error(`Upload failed: ${await r.text()}`);
      const doc={job_id:job.id,name:file.name,file_path:sp,file_size:file.size,mime_type:file.type,category:uploadCategory,uploaded_by:currentUser?.id||null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      const ins=await db.insert('job_documents',doc);if(ins?.length>0)setDocuments(prev=>[ins[0],...prev]);
      else{const d=await db.select('job_documents',`job_id=eq.${job.id}&order=created_at.desc`);setDocuments(d);}
    }}catch(err){alert('Upload failed: '+err.message);}finally{setUploading(false);if(fileInputRef.current)fileInputRef.current.value='';}};
  const handleDelete=async(doc)=>{if(!confirm(`Delete "${doc.name}"?`))return;try{await fetch(`${db.baseUrl}/storage/v1/object/job-files/${doc.file_path}`,{method:'DELETE',headers:{'Authorization':`Bearer ${db.apiKey}`,'apikey':db.apiKey}});await db.delete('job_documents',`id=eq.${doc.id}`);setDocuments(prev=>prev.filter(d=>d.id!==doc.id));}catch(err){alert('Delete failed: '+err.message);}};
  const getFileUrl=doc=>`${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}`;
  const fmtSize=b=>{if(!b)return'';if(b<1024)return`${b} B`;if(b<1048576)return`${(b/1024).toFixed(1)} KB`;return`${(b/1048576).toFixed(1)} MB`;};
  const isImage=doc=>doc.mime_type?.startsWith('image/');
  return(
    <div className="job-page-files">
      <div className="job-page-files-toolbar"><div style={{display:'flex',gap:8,alignItems:'center',flex:1,flexWrap:'wrap'}}>
        <select className="input" value={uploadCategory} onChange={e=>setUploadCategory(e.target.value)} style={{width:'auto',minWidth:130,height:32}}>{FILE_CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <button className="btn btn-primary btn-sm" onClick={()=>fileInputRef.current?.click()} disabled={uploading}>{uploading?'Uploading...':'Upload Files'}</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>onSignRequest()}>Sign Request</button>
        <input ref={fileInputRef} type="file" multiple onChange={handleUpload} style={{display:'none'}} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"/>
      </div></div>
      <div className="job-page-files-cats">
        <button className={`job-page-files-cat${filterCat==='all'?' active':''}`} onClick={()=>setFilterCat('all')}>All ({catCounts.all||0})</button>
        {FILE_CATEGORIES.map(c=>{const cnt=catCounts[c.key]||0;if(cnt===0&&filterCat!==c.key)return null;return<button key={c.key} className={`job-page-files-cat${filterCat===c.key?' active':''}`} onClick={()=>setFilterCat(c.key)}>{c.label} ({cnt})</button>;})}
      </div>
      {filtered.length===0?(<div className="empty-state"><div className="empty-state-icon">{'\u{1F4C1}'}</div><div className="empty-state-text">No files yet</div><div className="empty-state-sub">Upload photos, estimates, invoices, and more</div></div>
      ):(<div className="job-page-files-grid">{filtered.map(doc=>(
        <div key={doc.id} className="job-page-file-card">
          {isImage(doc)?<a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview"><img src={getFileUrl(doc)} alt={doc.name} loading="lazy"/></a>
            :<a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">{doc.mime_type?.includes('pdf')?'\u{1F4C4}':'\u{1F4CE}'}</a>}
          <div className="job-page-file-info"><a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{doc.name}</a>
            <div className="job-page-file-meta"><span className="job-page-file-cat-badge">{doc.category}</span>{doc.file_size&&<span>{fmtSize(doc.file_size)}</span>}</div></div>
          <button className="btn btn-ghost btn-sm" onClick={()=>handleDelete(doc)} title="Delete" style={{flexShrink:0,padding:'2px 6px',fontSize:14}}>{'\u2715'}</button>
        </div>))}</div>)}
    </div>);
}

/* ═══ ACTIVITY TAB (unchanged) ═══ */
function ActivityTab({job,notes,setNotes,history,employees,phaseMap,db,currentUser,fmtDateTime}){
  const[newNote,setNewNote]=useState('');const[savingNote,setSavingNote]=useState(false);
  const empMap=useMemo(()=>{const m={};for(const e of employees)m[e.id]=e;return m;},[employees]);
  const handleAddNote=async()=>{if(!newNote.trim())return;setSavingNote(true);
    try{const note={job_id:job.id,author_id:currentUser?.id||null,content:newNote.trim(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      const ins=await db.insert('job_notes',note);if(ins?.length>0)setNotes(prev=>[ins[0],...prev]);
      else{const d=await db.select('job_notes',`job_id=eq.${job.id}&order=created_at.desc`);setNotes(d);}setNewNote('');
    }catch(err){alert('Failed: '+err.message);}finally{setSavingNote(false);}};
  const handleDeleteNote=async(id)=>{if(!confirm('Delete this note?'))return;try{await db.delete('job_notes',`id=eq.${id}`);setNotes(prev=>prev.filter(n=>n.id!==id));}catch(err){alert('Failed: '+err.message);}};
  const timeline=useMemo(()=>{const items=[];
    for(const n of notes)items.push({type:'note',id:n.id,date:n.created_at,content:n.content,author:empMap[n.author_id]?.full_name||'Unknown',raw:n});
    for(const h of history){const fl=phaseMap[h.from_phase]?.label||h.from_phase;const tl=phaseMap[h.to_phase]?.label||h.to_phase;
      items.push({type:'phase_change',id:h.id,date:h.changed_at,content:`Phase changed: ${fl} \u2192 ${tl}`,author:empMap[h.changed_by]?.full_name||'System'});}
    items.sort((a,b)=>new Date(b.date)-new Date(a.date));return items;},[notes,history,empMap,phaseMap]);
  return(
    <div className="job-page-activity">
      <div className="job-page-note-compose">
        <textarea className="input textarea" placeholder="Add a note..." value={newNote} onChange={e=>setNewNote(e.target.value)} rows={3}/>
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}><button className="btn btn-primary btn-sm" onClick={handleAddNote} disabled={savingNote||!newNote.trim()}>{savingNote?'Saving...':'Add Note'}</button></div>
      </div>
      {timeline.length===0?(<div className="empty-state" style={{paddingTop:32}}><div className="empty-state-icon">{'\u{1F4DD}'}</div><div className="empty-state-text">No activity yet</div></div>
      ):(<div className="job-page-timeline">{timeline.map(item=>(
        <div key={`${item.type}-${item.id}`} className={`job-page-timeline-item timeline-${item.type}`}>
          <div className="job-page-timeline-dot"/><div className="job-page-timeline-content">
            <div className="job-page-timeline-header"><span className="job-page-timeline-author">{item.author}</span><span className="job-page-timeline-time">{fmtDateTime(item.date)}</span></div>
            <div className="job-page-timeline-text">{item.content}</div>
            {item.type==='note'&&<button className="btn btn-ghost btn-sm" onClick={()=>handleDeleteNote(item.id)} style={{padding:'0 4px',fontSize:11,marginTop:4,height:20}}>Delete</button>}
          </div></div>))}</div>)}
    </div>);
}

/* ═══ SCHEDULE TAB (unchanged) ═══ */
function ScheduleTab({jobId,taskSummary,onGenerateClick,navigate}){
  const hasSchedule=taskSummary&&taskSummary.total>0;
  if(!hasSchedule)return(<div style={{padding:'40px 20px',textAlign:'center'}}><div style={{fontSize:36,opacity:0.15,marginBottom:12}}>{'\u{1F4C5}'}</div><div style={{fontSize:15,fontWeight:600,color:'var(--text-secondary)',marginBottom:6}}>No schedule created yet</div><div style={{fontSize:13,color:'var(--text-tertiary)',marginBottom:20,maxWidth:320,margin:'0 auto 20px'}}>Apply a template to auto-generate appointments and tasks for this job.</div><button className="btn btn-primary" onClick={onGenerateClick} style={{padding:'10px 24px',fontSize:14}}>Generate schedule</button></div>);
  const byPhase=taskSummary.by_phase||[];const pct=taskSummary.total>0?Math.round((taskSummary.completed/taskSummary.total)*100):0;
  return(<div style={{padding:'16px 0'}}>
    <div style={{display:'flex',gap:10,marginBottom:8,padding:'0 16px'}}>
      <div style={ss.c}><div style={ss.v}>{pct}%</div><div style={ss.l}>Complete</div></div>
      <div style={ss.c}><div style={ss.v}>{taskSummary.completed}/{taskSummary.total}</div><div style={ss.l}>Tasks done</div></div>
      <div style={ss.c}><div style={ss.v}>{taskSummary.assigned}</div><div style={ss.l}>On calendar</div></div>
      <div style={ss.c}><div style={ss.v}>{taskSummary.unassigned}</div><div style={ss.l}>Need scheduling</div></div>
    </div>
    {taskSummary.unassigned===0&&taskSummary.completed===0&&<div style={{fontSize:11,color:'var(--text-tertiary)',padding:'0 16px 8px',lineHeight:1.4}}>All tasks are on the calendar. Open the dispatch board to see appointments.</div>}
    <div style={{padding:'0 16px',marginBottom:20}}><div style={{height:6,background:'var(--bg-tertiary)',borderRadius:3,overflow:'hidden'}}><div style={{width:`${pct}%`,height:'100%',background:pct===100?'#10b981':'var(--accent)',borderRadius:3,transition:'width 300ms ease'}}/></div></div>
    <div style={{padding:'0 16px'}}><div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-tertiary)',marginBottom:10}}>Phase progress</div>
      {byPhase.map(phase=>{const pp=phase.total>0?Math.round((phase.completed/phase.total)*100):0;const done=phase.completed===phase.total;
        return(<div key={phase.phase_name} style={{marginBottom:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:2,background:phase.phase_color||'#6b7280',flexShrink:0}}/><span style={{fontSize:13,fontWeight:600,color:done?'var(--text-tertiary)':'var(--text-primary)',textDecoration:done?'line-through':'none'}}>{phase.phase_name}</span></div>
            <span style={{fontSize:12,color:'var(--text-tertiary)'}}>{phase.completed}/{phase.total}{phase.assigned<phase.total&&!done?` (${phase.total-phase.assigned} unscheduled)`:''}</span>
          </div>
          <div style={{height:4,background:'var(--bg-tertiary)',borderRadius:2,overflow:'hidden'}}><div style={{width:`${pp}%`,height:'100%',background:done?'#10b981':(phase.phase_color||'var(--accent)'),borderRadius:2}}/></div>
        </div>);
      })}
    </div>
    <div style={{padding:'16px',borderTop:'1px solid var(--border-light)',marginTop:8,display:'flex',gap:8}}>
      <button className="btn btn-sm btn-secondary" onClick={()=>navigate('/schedule')}>Open dispatch board</button>
      {taskSummary.unassigned>0&&<span style={{fontSize:12,color:'var(--text-tertiary)',alignSelf:'center'}}>{taskSummary.unassigned} tasks still need to be scheduled</span>}
    </div>
  </div>);
}
const ss={c:{flex:1,padding:'10px 8px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)',textAlign:'center'},v:{fontSize:16,fontWeight:700,color:'var(--text-primary)'},l:{fontSize:10,fontWeight:600,color:'var(--text-tertiary)',marginTop:2,textTransform:'uppercase',letterSpacing:'0.03em'}};

function phaseClass(phase){
  if(!phase)return'active';
  if(['completed','closed','paid'].includes(phase))return'resolved';
  if(['on_hold','cancelled','waiting_on_approval','waiting_for_deductible','awaiting_payment'].includes(phase))return'waiting';
  if(['lead','emergency','job_received'].includes(phase))return'needs-response';
  return'active';
}
