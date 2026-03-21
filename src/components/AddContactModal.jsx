import { useState, useEffect, useMemo, useRef } from 'react';

function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconBack(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}

const ROLE_LABELS={homeowner:'Homeowner',adjuster:'Adjuster',subcontractor:'Subcontractor',property_manager:'Property Manager',agent:'Agent / Broker',mortgage_co:'Mortgage Co',tenant:'Tenant',other:'Other',vendor:'Vendor',referral_partner:'Referral Partner',insurance_rep:'Insurance Rep',broker:'Broker'};
const ROLE_CARDS=[
  {value:'homeowner',emoji:'\u{1F3E0}',label:'Homeowner',desc:'Property owner, policyholder'},
  {value:'adjuster',emoji:'\u{1F4CB}',label:'Adjuster',desc:'Insurance field or desk adjuster'},
  {value:'vendor',emoji:'\u{1F3E2}',label:'Vendor',desc:'Material supplier, equipment'},
  {value:'subcontractor',emoji:'\u{1F527}',label:'Sub',desc:'Trade contractor, specialist'},
  {value:'agent',emoji:'\u{1F91D}',label:'Agent',desc:'Insurance or real estate agent'},
  {value:'property_manager',emoji:'\u{1F3E8}',label:'Prop. Mgr',desc:'Manages rental/commercial'},
  {value:'referral_partner',emoji:'\u{2B50}',label:'Referral',desc:'Plumber, roofer, source'},
  {value:'tenant',emoji:'\u{1F6CF}\uFE0F',label:'Tenant',desc:'Occupant of property'},
  {value:'other',emoji:'\u{1F464}',label:'Other',desc:'Mortgage co, insurance rep'},
];
const CMO=[{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const PTO=[{value:'due_on_receipt',label:'Due on Receipt'},{value:'net_15',label:'Net 15'},{value:'net_30',label:'Net 30'},{value:'net_45',label:'Net 45'},{value:'net_60',label:'Net 60'}];

/* ═══ LOOKUP SELECT ═══ */
export function LookupSelect({label,value,onChange,items,placeholder='Search...',nameKey='name'}){
  const[open,setOpen]=useState(false);const[search,setSearch]=useState('');const wr=useRef(null);
  useEffect(()=>{const h=(e)=>{if(wr.current&&!wr.current.contains(e.target))setOpen(false);};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h);},[]);
  const fil=useMemo(()=>{if(!search.trim())return items||[];const q=search.toLowerCase();return(items||[]).filter(c=>{const n=c[nameKey]||'';const s=c.short_name||'';return n.toLowerCase().includes(q)||s.toLowerCase().includes(q);});},[items,search,nameKey]);
  const sel=(n)=>{onChange(n);setSearch('');setOpen(false);};
  return(<div className="form-group" style={{flex:1,marginBottom:0}} ref={wr}><label className="label">{label}</label><div className="carrier-select-wrap">
    <input className="input" value={open?search:value||''} onChange={e=>{setSearch(e.target.value);if(!open)setOpen(true);}} onFocus={()=>{setOpen(true);setSearch('');}} placeholder={value||placeholder}/>
    {open&&<div className="carrier-dropdown">{fil.length===0?(search.trim()?<button className="carrier-dropdown-item" onClick={()=>sel(search.trim())}>Use "<strong>{search.trim()}</strong>"</button>:<div className="carrier-dropdown-empty">No options found</div>):(<>{fil.map(c=><button key={c.id||c[nameKey]} className={`carrier-dropdown-item${c[nameKey]===value?' active':''}`} onClick={()=>sel(c[nameKey])}><span className="carrier-dropdown-name">{c[nameKey]}</span>{c.short_name&&<span className="carrier-dropdown-short">{c.short_name}</span>}{c.category&&!c.short_name&&<span className="carrier-dropdown-short">{c.category}</span>}</button>)}{search.trim()&&!fil.find(c=>(c[nameKey]||'').toLowerCase()===search.toLowerCase())&&<button className="carrier-dropdown-item carrier-dropdown-custom" onClick={()=>sel(search.trim())}>Use "<strong>{search.trim()}</strong>"</button>}</>)}</div>}
  </div></div>);
}

export const CarrierSelect = ({value,onChange,carriers,...rest}) => <LookupSelect label="Insurance Carrier" value={value} onChange={onChange} items={carriers} placeholder="Search carriers..." {...rest} />;

/* ═══ PHONE FORMAT AS YOU TYPE ═══ */
function formatPhoneInput(raw){
  const digits=raw.replace(/\D/g,'');
  // Strip leading 1 for formatting
  const n=digits.startsWith('1')?digits.slice(1):digits;
  if(n.length===0)return'';
  if(n.length<=3)return`(${n}`;
  if(n.length<=6)return`(${n.slice(0,3)}) ${n.slice(3)}`;
  return`(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6,10)}`;
}

/**
 * AddContactModal
 * Props: onClose, onSave(data), carriers, referralSources,
 *        defaultRole (skips role picker), prefillName (pre-fills name field)
 */
export default function AddContactModal({onClose,onSave,carriers,referralSources,defaultRole,prefillName}){
  const[step,setStep]=useState(defaultRole?'form':'pick');
  const[role,setRole]=useState(defaultRole||null);
  const[form,setForm]=useState(()=>{
    if(defaultRole){const f=initForm(defaultRole);if(prefillName)f.name=prefillName;return f;}
    return {};
  });
  const[saving,setSaving]=useState(false);
  const nameRef=useRef(null);const phoneRef=useRef(null);

  useEffect(()=>{
    if(step==='form'){
      // If name is prefilled, focus phone instead
      setTimeout(()=>{
        if(prefillName&&form.name)phoneRef.current?.focus();
        else nameRef.current?.focus();
      },50);
    }
  },[step]);

  const selectRole=r=>{setRole(r);const f=initForm(r);if(prefillName)f.name=prefillName;setForm(f);setStep('form');};
  const set=(f,v)=>setForm(prev=>({...prev,[f]:v}));
  const handleBack=()=>{if(defaultRole){onClose();return;}setStep('pick');};

  const handlePhoneChange=(field,raw)=>{set(field,formatPhoneInput(raw));};

  const handleSave=async()=>{
    if(!form.name?.trim()||!form.phone?.trim())return;
    setSaving(true);
    try{
      let phone=form.phone.replace(/\D/g,'');if(phone.length===10)phone='1'+phone;if(!phone.startsWith('+'))phone='+'+phone;
      let deskPh=(form.desk_phone||'').replace(/\D/g,'');if(deskPh&&deskPh.length===10)deskPh='1'+deskPh;if(deskPh&&!deskPh.startsWith('+'))deskPh='+'+deskPh;
      const tags=(form.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
      const data={name:form.name.trim(),phone,role:form.role,email:form.email?.trim()||null,company:form.company?.trim()||null,
        preferred_contact_method:form.preferred_contact_method,referral_source:form.referral_source?.trim()||null,
        tags:JSON.stringify(tags),notes:form.notes?.trim()||null,opt_in_status:false};
      if(form.role==='homeowner'||form.role==='tenant')Object.assign(data,{billing_address:form.billing_address?.trim()||null,billing_city:form.billing_city?.trim()||null,billing_state:form.billing_state?.trim()||null,billing_zip:form.billing_zip?.trim()||null,insurance_carrier:form.insurance_carrier?.trim()||null,policy_number:form.policy_number?.trim()||null});
      if(form.role==='adjuster')Object.assign(data,{insurance_carrier:form.insurance_carrier?.trim()||null,desk_phone:deskPh||null,desk_extension:form.desk_extension?.trim()||null,territory:form.territory?.trim()||null,relationship_notes:form.relationship_notes?.trim()||null});
      if(form.role==='vendor'||form.role==='subcontractor'){Object.assign(data,{trade_specialty:form.trade_specialty?.trim()||null,payment_terms:form.payment_terms||'net_30',w9_on_file:form.w9_on_file||false});if(form.role==='subcontractor'&&form.coi_expiration)data.coi_expiration=form.coi_expiration;}
      await onSave(data);
    }catch(err){/* handled in parent */}finally{setSaving(false);}
  };

  // Compact field helpers
  const F=({label,field,type='text',placeholder,required,inputRef})=>(<div style={{flex:1,marginBottom:6}}>
    <label className="label" style={{fontSize:11,marginBottom:2}}>{label}{required&&' *'}</label>
    {type==='textarea'?<textarea className="input textarea" value={form[field]||''} onChange={e=>set(field,e.target.value)} rows={2} placeholder={placeholder} style={{fontSize:13}}/>
    :type==='checkbox'?<label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13,padding:'6px 0'}}><input type="checkbox" checked={form[field]||false} onChange={e=>set(field,e.target.checked)} style={{width:15,height:15}}/>{placeholder||label}</label>
    :<input ref={inputRef||(field==='name'?nameRef:undefined)} className="input" type={type} value={form[field]||''} onChange={e=>type==='tel'?handlePhoneChange(field,e.target.value):set(field,e.target.value)} placeholder={placeholder} style={{height:34,fontSize:13}}/>}
  </div>);

  const Sel=({label,field,options})=>(<div style={{flex:1,marginBottom:6}}>
    <label className="label" style={{fontSize:11,marginBottom:2}}>{label}</label>
    <select className="input" value={form[field]||''} onChange={e=>set(field,e.target.value)} style={{height:34,fontSize:13,cursor:'pointer'}}>{options.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>
  </div>);

  const SectionLabel=({children})=>(<div style={{fontSize:11,fontWeight:700,color:'var(--text-tertiary)',textTransform:'uppercase',letterSpacing:'0.04em',margin:'var(--space-2) 0 6px'}}>{children}</div>);

  return(
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560,height:step==='form'?'min(88vh, 720px)':'auto',display:'flex',flexDirection:'column'}}>
        {/* Header */}
        <div className="conv-modal-header" style={{flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:'var(--space-2)'}}>
            {step==='form'&&<button className="btn btn-ghost btn-sm" onClick={handleBack} style={{width:28,height:28,padding:0}}><IconBack style={{width:16,height:16}}/></button>}
            <span style={{fontSize:'var(--text-lg)',fontWeight:700}}>{step==='pick'?'New Contact':`New ${ROLE_LABELS[role]||'Contact'}`}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{width:32,height:32,padding:0}}><IconX style={{width:18,height:18}}/></button>
        </div>

        {step==='pick'?(
          /* ═══ ROLE PICKER — compact 3-column grid ═══ */
          <div style={{padding:'var(--space-3) var(--space-4)',overflowY:'auto'}}>
            <div style={{fontSize:12,color:'var(--text-secondary)',marginBottom:'var(--space-3)'}}>What type of contact?</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:8}}>
              {ROLE_CARDS.map(rc=>(
                <button key={rc.value} onClick={()=>selectRole(rc.value)}
                  style={{padding:'10px 6px',borderRadius:'var(--radius-md)',border:'2px solid var(--border-light)',background:'var(--bg-primary)',cursor:'pointer',textAlign:'center',fontFamily:'var(--font-sans)',transition:'all 0.15s'}}>
                  <div style={{fontSize:20}}>{rc.emoji}</div>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--text-primary)',marginTop:2}}>{rc.label}</div>
                  <div style={{fontSize:9,color:'var(--text-tertiary)',marginTop:1,lineHeight:1.2}}>{rc.desc}</div>
                </button>
              ))}
            </div>
          </div>
        ):(
          /* ═══ FORM — scrollable body, fixed footer ═══ */
          <>
            <div style={{flex:1,overflowY:'auto',padding:'var(--space-3) var(--space-4)'}}>
              <SectionLabel>Basic Info</SectionLabel>
              <div style={{display:'flex',gap:8}}><F label="Name" field="name" placeholder="Full name" required/><F label="Phone" field="phone" type="tel" placeholder="(801) 555-1234" required inputRef={phoneRef}/></div>
              <div style={{display:'flex',gap:8}}><F label="Email" field="email" type="email" placeholder="email@example.com"/><F label="Company" field="company" placeholder={role==='adjuster'?'Carrier name':role==='vendor'?'Company name':'Company (optional)'}/></div>
              <Sel label="Preferred Contact" field="preferred_contact_method" options={CMO}/>

              {(role==='homeowner'||role==='tenant')&&(<>
                <SectionLabel>Billing Address</SectionLabel>
                <F label="Street" field="billing_address" placeholder="1422 E Maple Ridge Dr"/>
                <div style={{display:'flex',gap:8}}><F label="City" field="billing_city" placeholder="Lehi"/><F label="State" field="billing_state" placeholder="UT" style={{maxWidth:70}}/><F label="ZIP" field="billing_zip" placeholder="84043" style={{maxWidth:90}}/></div>
                <SectionLabel>Insurance</SectionLabel>
                <div style={{display:'flex',gap:8,marginBottom:6}}><LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v=>set('insurance_carrier',v)} items={carriers} placeholder="Search carriers..."/><F label="Policy #" field="policy_number" placeholder="SF-8820114"/></div>
              </>)}

              {role==='adjuster'&&(<>
                <SectionLabel>Adjuster Details</SectionLabel>
                <div style={{marginBottom:6}}><LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v=>set('insurance_carrier',v)} items={carriers} placeholder="Search carriers..."/></div>
                <div style={{display:'flex',gap:8}}><F label="Desk Phone" field="desk_phone" type="tel" placeholder="(800) 555-0100"/><F label="Extension" field="desk_extension" placeholder="4412"/></div>
                <F label="Territory / Region" field="territory" placeholder="Northern Utah - Salt Lake, Davis, Weber"/>
                <F label="Relationship Notes" field="relationship_notes" type="textarea" placeholder="Response time, negotiation style..."/>
              </>)}

              {role==='vendor'&&(<>
                <SectionLabel>Vendor Details</SectionLabel>
                <div style={{display:'flex',gap:8}}><F label="Trade / Specialty" field="trade_specialty" placeholder="Flooring, plumbing, electrical..."/><Sel label="Payment Terms" field="payment_terms" options={PTO}/></div>
                <F label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received and on file"/>
              </>)}

              {role==='subcontractor'&&(<>
                <SectionLabel>Subcontractor Details</SectionLabel>
                <div style={{display:'flex',gap:8}}><F label="Trade / Specialty" field="trade_specialty" placeholder="Drywall, painting, tile..."/><Sel label="Payment Terms" field="payment_terms" options={PTO}/></div>
                <div style={{display:'flex',gap:8}}><F label="COI Expiration" field="coi_expiration" type="date"/><F label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received and on file"/></div>
              </>)}

              <SectionLabel>Other</SectionLabel>
              <div style={{display:'flex',gap:8,marginBottom:6}}>
                <LookupSelect label="Referral Source" value={form.referral_source} onChange={v=>set('referral_source',v)} items={referralSources||[]} placeholder="Search sources..."/>
                <F label="Tags" field="tags" placeholder="VIP, repeat, priority"/>
              </div>
              <F label="Notes" field="notes" type="textarea" placeholder="Internal notes..."/>
            </div>

            {/* Fixed footer */}
            <div className="add-contact-footer" style={{flexShrink:0}}>
              <button className="btn btn-secondary" onClick={handleBack}>{defaultRole?'Cancel':'Back'}</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving||!form.name?.trim()||!form.phone?.trim()}>{saving?'Saving...':'Add Contact'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function initForm(r){
  const base={name:'',phone:'',email:'',company:'',role:r,preferred_contact_method:'sms',referral_source:'',tags:'',notes:''};
  if(r==='homeowner')return{...base,billing_address:'',billing_city:'',billing_state:'',billing_zip:'',insurance_carrier:'',policy_number:''};
  if(r==='adjuster')return{...base,company:'',desk_phone:'',desk_extension:'',territory:'',relationship_notes:'',insurance_carrier:''};
  if(r==='vendor')return{...base,trade_specialty:'',payment_terms:'net_30',w9_on_file:false};
  if(r==='subcontractor')return{...base,trade_specialty:'',payment_terms:'net_30',coi_expiration:'',w9_on_file:false};
  return base;
}
