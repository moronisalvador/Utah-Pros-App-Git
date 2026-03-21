import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AddContactModal, { LookupSelect } from '@/components/AddContactModal';
import DatePicker from '@/components/DatePicker';

function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconUser(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}

const DIVISIONS=[
  {value:'water',emoji:'\u{1F4A7}',label:'Water',color:'#2563eb'},
  {value:'mold',emoji:'\u{1F9A0}',label:'Mold',color:'#9d174d'},
  {value:'reconstruction',emoji:'\u{1F3D7}\uFE0F',label:'Recon',color:'#d97706'},
  {value:'fire',emoji:'\u{1F525}',label:'Fire',color:'#dc2626'},
  {value:'contents',emoji:'\u{1F4E6}',label:'Contents',color:'#059669'},
];
const SOURCES=[{value:'insurance',label:'Insurance'},{value:'retail',label:'Retail / Cash'},{value:'hoa',label:'HOA'},{value:'commercial',label:'Commercial'},{value:'tpa',label:'TPA'}];
const PRIORITIES=[{value:1,label:'Urgent'},{value:2,label:'High'},{value:3,label:'Normal'},{value:4,label:'Low'}];

export default function CreateJob(){
  const navigate=useNavigate();const{db,employee:currentUser}=useAuth();
  const[contact,setContact]=useState(null);
  const[contactSearch,setContactSearch]=useState('');const[results,setResults]=useState([]);
  const[searching,setSearching]=useState(false);const[showDrop,setShowDrop]=useState(false);
  const[showAddContact,setShowAddContact]=useState(false);
  const searchRef=useRef(null);const timer=useRef(null);
  const[employees,setEmployees]=useState([]);const[carriers,setCarriers]=useState([]);
  const[saving,setSaving]=useState(false);const[error,setError]=useState(null);

  const[f,sF]=useState({
    division:'water',source:'insurance',priority:3,type_of_loss:'',
    address:'',city:'',state:'UT',zip:'',
    insurance_company:'',claim_number:'',policy_number:'',
    adjuster_name:'',adjuster_phone:'',adjuster_email:'',cat_code:'',
    date_of_loss:'',target_completion:'',
    project_manager_id:currentUser?.role==='project_manager'?currentUser?.id:'',
    lead_tech_id:'',internal_notes:'',
  });
  const s=(k,v)=>sF(prev=>({...prev,[k]:v}));

  useEffect(()=>{(async()=>{try{const[e,c]=await Promise.all([
    db.select('employees','is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
    db.select('insurance_carriers','order=name.asc&select=id,name,short_name').catch(()=>[])]);
    setEmployees(e);setCarriers(c);}catch(err){console.error(err);}})();},[]);

  // ── Contact search ──
  const doSearch=useCallback(async(q)=>{
    if(q.trim().length<2){setResults([]);setShowDrop(false);return;}
    setSearching(true);
    try{const r=await db.rpc('search_contacts_for_job',{p_query:q.trim()});setResults(Array.isArray(r)?r:[]);setShowDrop(true);}
    catch(err){console.error(err);setResults([]);}finally{setSearching(false);}
  },[db]);

  const onSearch=e=>{const v=e.target.value;setContactSearch(v);clearTimeout(timer.current);
    if(v.trim().length>=2)timer.current=setTimeout(()=>doSearch(v),300);
    else{setResults([]);setShowDrop(false);}};

  const selectContact=c=>{setContact(c);setContactSearch('');setShowDrop(false);
    // Auto-fill address from contact billing
    if(c.billing_address||c.billing_city)sF(prev=>({...prev,address:c.billing_address||'',city:c.billing_city||'',state:c.billing_state||'UT',zip:c.billing_zip||''}));
  };

  const handleNewContact=async(data)=>{
    try{const r=await db.insert('contacts',data);if(r?.length>0){const c=r[0];setContact(c);setShowAddContact(false);
      if(c.billing_address||c.billing_city)sF(prev=>({...prev,address:c.billing_address||'',city:c.billing_city||'',state:c.billing_state||'UT',zip:c.billing_zip||''}));
    }}catch(err){alert('Failed: '+err.message);throw err;}
  };

  const clearContact=()=>{setContact(null);sF(prev=>({...prev,address:'',city:'',state:'UT',zip:''}));};

  // Close dropdown on outside click
  useEffect(()=>{const h=e=>{if(searchRef.current&&!searchRef.current.contains(e.target))setShowDrop(false);};
    document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h);},[]);

  const fmtPh=phone=>{if(!phone)return'';const d=phone.replace(/\D/g,'');const n=d.startsWith('1')?d.slice(1):d;if(n.length===10)return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}`;return phone;};

  // ── Submit ──
  const handleSubmit=async()=>{
    if(!contact){setError('Select or create a client first.');return;}
    if(!f.address?.trim()&&!f.city?.trim()){setError('Enter a loss/service address.');return;}
    setSaving(true);setError(null);
    try{
      const result=await db.rpc('create_job_with_contact',{
        p_contact_id:contact.id,p_contact_name:contact.name,p_contact_phone:contact.phone,
        p_contact_email:contact.email||null,p_contact_role:contact.role||'homeowner',
        p_billing_address:contact.billing_address||f.address||null,p_billing_city:contact.billing_city||f.city||null,
        p_billing_state:contact.billing_state||f.state||null,p_billing_zip:contact.billing_zip||f.zip||null,
        p_division:f.division,p_source:f.source,p_priority:f.priority,
        p_type_of_loss:f.type_of_loss||null,p_date_of_loss:f.date_of_loss||null,p_target_completion:f.target_completion||null,
        p_address:f.address||null,p_city:f.city||null,p_state:f.state||null,p_zip:f.zip||null,
        p_insurance_company:f.insurance_company||null,p_claim_number:f.claim_number||null,
        p_job_policy_number:f.policy_number||null,p_adjuster_name:f.adjuster_name||null,
        p_adjuster_phone:f.adjuster_phone||null,p_adjuster_email:f.adjuster_email||null,
        p_cat_code:f.cat_code||null,p_project_manager_id:f.project_manager_id||null,
        p_lead_tech_id:f.lead_tech_id||null,p_internal_notes:f.internal_notes||null,
      });
      if(result?.job?.id)navigate(`/jobs/${result.job.id}`,{replace:true});
      else navigate('/jobs',{replace:true});
    }catch(err){console.error(err);setError('Failed: '+err.message);}finally{setSaving(false);}
  };

  return(
    <div className="create-job-page">
      {/* Header */}
      <div className="job-page-topbar">
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate(-1)} style={{gap:4}}>{'\u2190'} Back</button>
        <div style={{display:'flex',gap:'var(--space-2)'}}>
          <button className="btn btn-secondary btn-sm" onClick={()=>navigate(-1)} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving||!contact}>
            {saving?'Creating...':'Create Job'}
          </button>
        </div>
      </div>

      <div style={{padding:'var(--space-3) var(--space-4)'}}>
        <h1 className="page-title" style={{marginBottom:4}}>New Job</h1>
        {error&&<div style={{padding:'var(--space-2) var(--space-3)',background:'#fef2f2',color:'#dc2626',borderRadius:'var(--radius-md)',fontSize:13,marginBottom:'var(--space-3)',border:'1px solid #fecaca'}}>{error}</div>}
      </div>

      <div style={{padding:'0 var(--space-4)',paddingBottom:'var(--space-6)'}}>
        {/* ═══ CLIENT SEARCH ═══ */}
        <div className="job-page-section" style={{marginBottom:'var(--space-4)'}}>
          <div className="job-page-section-title">Client</div>
          {!contact?(
            <div ref={searchRef} style={{position:'relative'}}>
              <div style={{display:'flex',gap:'var(--space-2)'}}>
                <div style={{flex:1,position:'relative'}}>
                  <IconSearch style={{width:14,height:14,position:'absolute',left:10,top:10,color:'var(--text-tertiary)'}}/>
                  <input className="input" placeholder="Search by name, phone, or email..." value={contactSearch} onChange={onSearch} autoFocus style={{paddingLeft:32}}/>
                  {searching&&<div style={{position:'absolute',right:10,top:10}}><div className="spinner" style={{width:14,height:14}}/></div>}
                </div>
                <button className="btn btn-secondary" onClick={()=>setShowAddContact(true)} style={{flexShrink:0,gap:4}}>
                  <IconPlus style={{width:14,height:14}}/> New Client
                </button>
              </div>
              {showDrop&&<div style={{position:'absolute',left:0,right:0,top:'100%',zIndex:20,background:'var(--bg-primary)',border:'1px solid var(--border-color)',borderRadius:'var(--radius-md)',boxShadow:'var(--shadow-lg)',maxHeight:280,overflowY:'auto',marginTop:4}}>
                {results.length===0?(
                  <div style={{padding:'var(--space-3) var(--space-4)',fontSize:13,color:'var(--text-tertiary)'}}>
                    {contactSearch.trim().length>=2?<>No clients found. <button style={{color:'var(--brand-primary)',background:'none',border:'none',cursor:'pointer',textDecoration:'underline',fontFamily:'inherit',fontSize:13}} onClick={()=>setShowAddContact(true)}>Create new client</button></>:'Type at least 2 characters'}
                  </div>
                ):results.map(c=>(
                  <button key={c.id} onClick={()=>selectContact(c)} style={{display:'flex',alignItems:'center',gap:'var(--space-3)',width:'100%',padding:'var(--space-3) var(--space-4)',border:'none',background:'none',cursor:'pointer',textAlign:'left',fontFamily:'var(--font-sans)',borderBottom:'1px solid var(--border-light)'}}>
                    <IconUser style={{width:16,height:16,color:'var(--text-tertiary)',flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>{c.name}</div>
                      <div style={{fontSize:11,color:'var(--text-tertiary)'}}>{fmtPh(c.phone)}{c.email&&` · ${c.email}`}</div>
                      {c.billing_address&&<div style={{fontSize:11,color:'var(--text-tertiary)'}}>{c.billing_address}{c.billing_city?`, ${c.billing_city}`:''}</div>}
                    </div>
                    {c.job_count>0&&<span style={{fontSize:10,fontWeight:600,padding:'1px 6px',borderRadius:99,background:'var(--bg-tertiary)',color:'var(--text-tertiary)'}}>{c.job_count} job{c.job_count!==1?'s':''}</span>}
                  </button>
                ))}
              </div>}
            </div>
          ):(
            <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',padding:'var(--space-3)',background:'var(--bg-secondary)',borderRadius:'var(--radius-md)',border:'1px solid var(--border-light)'}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:'var(--brand-primary)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>
                {contact.name?.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)||'?'}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--text-primary)'}}>{contact.name}</div>
                <div style={{fontSize:12,color:'var(--text-tertiary)'}}>{fmtPh(contact.phone)}{contact.email&&` · ${contact.email}`}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={clearContact} style={{flexShrink:0,width:28,height:28,padding:0}}>
                <IconX style={{width:14,height:14}}/>
              </button>
            </div>
          )}
        </div>

        {/* ═══ EVERYTHING ELSE — only after client selected ═══ */}
        {contact&&(
          <div className="job-page-grid" style={{animation:'fadeIn 0.15s ease'}}>
            {/* Division cards */}
            <div className="job-page-section job-page-section-full">
              <div className="job-page-section-title">Division *</div>
              <div style={{display:'flex',gap:'var(--space-2)',flexWrap:'wrap'}}>
                {DIVISIONS.map(d=>(
                  <button key={d.value} onClick={()=>s('division',d.value)}
                    style={{flex:'1 1 0',minWidth:80,padding:'var(--space-3) var(--space-2)',borderRadius:'var(--radius-md)',
                      border:f.division===d.value?`2px solid ${d.color}`:'2px solid var(--border-light)',
                      background:f.division===d.value?`${d.color}10`:'var(--bg-primary)',
                      cursor:'pointer',textAlign:'center',transition:'all 0.15s',fontFamily:'var(--font-sans)'}}>
                    <div style={{fontSize:22}}>{d.emoji}</div>
                    <div style={{fontSize:11,fontWeight:f.division===d.value?700:500,color:f.division===d.value?d.color:'var(--text-secondary)',marginTop:2}}>{d.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Loss Address */}
            <div className="job-page-section">
              <div className="job-page-section-title">Loss / Service Address</div>
              <F label="Street" value={f.address} onChange={v=>s('address',v)} placeholder="1422 E Maple Ridge Dr"/>
              <div style={{display:'flex',gap:'var(--space-2)'}}>
                <F label="City" value={f.city} onChange={v=>s('city',v)} placeholder="Lehi"/>
                <F label="State" value={f.state} onChange={v=>s('state',v)} placeholder="UT" style={{maxWidth:70}}/>
                <F label="ZIP" value={f.zip} onChange={v=>s('zip',v)} placeholder="84043" style={{maxWidth:90}}/>
              </div>
            </div>

            {/* Job Info */}
            <div className="job-page-section">
              <div className="job-page-section-title">Job Info</div>
              <div style={{display:'flex',gap:'var(--space-2)'}}>
                <Sel label="Source" value={f.source} onChange={v=>s('source',v)} options={SOURCES}/>
                <Sel label="Priority" value={f.priority} onChange={v=>s('priority',parseInt(v))} options={PRIORITIES}/>
              </div>
              <F label="Type of Loss" value={f.type_of_loss} onChange={v=>s('type_of_loss',v)} placeholder="e.g. Pipe burst, Storm, Sewage"/>
              <div style={{display:'flex',gap:'var(--space-2)'}}>
                <div style={{flex:1}}><label className="label" style={{fontSize:11,marginBottom:2}}>Date of Loss</label><DatePicker value={f.date_of_loss} onChange={v=>s('date_of_loss',v)}/></div>
                <div style={{flex:1}}><label className="label" style={{fontSize:11,marginBottom:2}}>Target Completion</label><DatePicker value={f.target_completion} onChange={v=>s('target_completion',v)}/></div>
              </div>
            </div>

            {/* Insurance */}
            <div className="job-page-section">
              <div className="job-page-section-title">Insurance</div>
              <div style={{marginBottom:'var(--space-2)'}}><LookupSelect label="Insurance Company" value={f.insurance_company} onChange={v=>s('insurance_company',v)} items={carriers} placeholder="Search carriers..."/></div>
              <div style={{display:'flex',gap:'var(--space-2)'}}><F label="Claim #" value={f.claim_number} onChange={v=>s('claim_number',v)} placeholder="Claim number"/><F label="Policy #" value={f.policy_number} onChange={v=>s('policy_number',v)} placeholder="Policy number"/></div>
              <F label="Adjuster" value={f.adjuster_name} onChange={v=>s('adjuster_name',v)} placeholder="Adjuster name"/>
              <div style={{display:'flex',gap:'var(--space-2)'}}><F label="Adj. Phone" value={f.adjuster_phone} onChange={v=>s('adjuster_phone',v)} type="tel" placeholder="(801) 555-0000"/><F label="Adj. Email" value={f.adjuster_email} onChange={v=>s('adjuster_email',v)} type="email" placeholder="adj@email.com"/></div>
              <F label="CAT Code" value={f.cat_code} onChange={v=>s('cat_code',v)} placeholder="CAT code (if applicable)"/>
            </div>

            {/* Team */}
            <div className="job-page-section">
              <div className="job-page-section-title">Team</div>
              <Sel label="Project Manager" value={f.project_manager_id} onChange={v=>s('project_manager_id',v)}
                options={employees.map(e=>({value:e.id,label:e.full_name}))} emptyLabel="Unassigned"/>
              <Sel label="Lead Tech" value={f.lead_tech_id} onChange={v=>s('lead_tech_id',v)}
                options={employees.filter(e=>e.role==='field_tech').map(e=>({value:e.id,label:e.full_name}))} emptyLabel="Unassigned"/>
            </div>

            {/* Notes */}
            <div className="job-page-section job-page-section-full">
              <div className="job-page-section-title">Internal Notes</div>
              <textarea className="input textarea" value={f.internal_notes} onChange={e=>s('internal_notes',e.target.value)} rows={3} placeholder="Initial notes about the job..." style={{width:'100%'}}/>
            </div>

            {/* Bottom submit */}
            <div className="job-page-section-full" style={{display:'flex',justifyContent:'flex-end',gap:'var(--space-2)',paddingTop:'var(--space-3)',borderTop:'1px solid var(--border-light)'}}>
              <button className="btn btn-secondary" onClick={()=>navigate(-1)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={saving}>
                {saving?'Creating...':'Create Job'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showAddContact&&<AddContactModal onClose={()=>setShowAddContact(false)} onSave={handleNewContact} carriers={carriers} referralSources={[]} defaultRole="homeowner"/>}
    </div>
  );
}

/* ═══ Form helpers ═══ */
function F({label,value,onChange,type='text',placeholder,style}){
  return(<div style={{flex:1,marginBottom:'var(--space-2)',...style}}>
    <label className="label" style={{fontSize:11,marginBottom:2}}>{label}</label>
    <input className="input" type={type} value={value||''} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{height:34,fontSize:13}}/>
  </div>);
}
function Sel({label,value,onChange,options,emptyLabel}){
  return(<div style={{flex:1,marginBottom:'var(--space-2)'}}>
    <label className="label" style={{fontSize:11,marginBottom:2}}>{label}</label>
    <select className="input" value={value||''} onChange={e=>onChange(e.target.value)} style={{height:34,fontSize:13,cursor:'pointer'}}>
      {emptyLabel&&<option value="">{emptyLabel}</option>}
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>);
}
