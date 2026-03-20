import { useState, useEffect, useMemo, useRef } from 'react';

/* ═══ ICONS ═══ */
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconBack(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}

/* ═══ CONSTANTS ═══ */
const ROLE_LABELS={homeowner:'Homeowner',adjuster:'Adjuster',subcontractor:'Subcontractor',property_manager:'Property Manager',agent:'Agent / Broker',mortgage_co:'Mortgage Co',tenant:'Tenant',other:'Other',vendor:'Vendor',referral_partner:'Referral Partner',insurance_rep:'Insurance Rep',broker:'Broker'};
const ROLE_CARDS=[
  {value:'homeowner',emoji:'\u{1F3E0}',label:'Homeowner',desc:'Property owner, policyholder, client'},
  {value:'adjuster',emoji:'\u{1F4CB}',label:'Adjuster',desc:'Insurance field or desk adjuster'},
  {value:'vendor',emoji:'\u{1F3E2}',label:'Vendor',desc:'Material supplier, equipment provider'},
  {value:'subcontractor',emoji:'\u{1F527}',label:'Subcontractor',desc:'Trade contractor, specialist'},
  {value:'agent',emoji:'\u{1F91D}',label:'Agent / Broker',desc:'Insurance or real estate agent'},
  {value:'property_manager',emoji:'\u{1F3E8}',label:'Property Manager',desc:'Manages rental or commercial property'},
  {value:'referral_partner',emoji:'\u{2B50}',label:'Referral Partner',desc:'Plumber, roofer, referral source'},
  {value:'tenant',emoji:'\u{1F6CF}\uFE0F',label:'Tenant',desc:'Occupant of affected property'},
  {value:'other',emoji:'\u{1F464}',label:'Other',desc:'Mortgage co, insurance rep, etc.'},
];
const CMO=[{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const PTO=[{value:'due_on_receipt',label:'Due on Receipt'},{value:'net_15',label:'Net 15'},{value:'net_30',label:'Net 30'},{value:'net_45',label:'Net 45'},{value:'net_60',label:'Net 60'}];
const LANG=[{value:'en',label:'English'},{value:'es',label:'Spanish'},{value:'pt',label:'Portuguese'}];

/* ═══════════════════════════════════════════════════════════════════
   LOOKUP SELECT — generic searchable dropdown for any lookup table
   Used for insurance carriers, referral sources, etc.
   ═══════════════════════════════════════════════════════════════════ */
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

// Backward compat exports
export const CarrierSelect = ({value,onChange,carriers,...rest}) => <LookupSelect label="Insurance Carrier" value={value} onChange={onChange} items={carriers} placeholder="Search carriers..." {...rest} />;

/* ═══ ADD CONTACT MODAL ═══ */
// defaultRole: if provided, skips role picker and goes straight to form
export default function AddContactModal({onClose,onSave,carriers,referralSources,defaultRole}){
  const hasDefault = !!defaultRole;
  const[step,setStep]=useState(hasDefault ? 'form' : 'pick');
  const[role,setRole]=useState(hasDefault ? defaultRole : null);
  const[form,setForm]=useState(hasDefault ? initFormStatic(defaultRole) : {});
  const[saving,setSaving]=useState(false);
  const nameRef=useRef(null);

  // Auto-focus name field when starting with defaultRole
  useEffect(() => { if (hasDefault) setTimeout(() => nameRef.current?.focus(), 50); }, []);

  const selectRole=(r)=>{setRole(r);setForm(initFormStatic(r));setStep('form');setTimeout(()=>nameRef.current?.focus(),50);};
  const set=(f,v)=>setForm(prev=>({...prev,[f]:v}));

  const handleBack = () => {
    if (hasDefault) { onClose(); return; }
    setStep('pick');
  };

  const handleSave=async()=>{
    if(!form.name?.trim()||!form.phone?.trim())return;
    setSaving(true);
    try{
      let phone=form.phone.replace(/\D/g,'');if(phone.length===10)phone='1'+phone;if(!phone.startsWith('+'))phone='+'+phone;
      let deskPh=(form.desk_phone||'').replace(/\D/g,'');if(deskPh&&deskPh.length===10)deskPh='1'+deskPh;if(deskPh&&!deskPh.startsWith('+'))deskPh='+'+deskPh;
      const tags=(form.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
      const data={name:form.name.trim(),phone,role:form.role,email:form.email?.trim()||null,company:form.company?.trim()||null,preferred_contact_method:form.preferred_contact_method,preferred_language:form.preferred_language||'en',referral_source:form.referral_source?.trim()||null,tags:JSON.stringify(tags),notes:form.notes?.trim()||null,opt_in_status:false};
      if(form.role==='homeowner'||form.role==='tenant')Object.assign(data,{billing_address:form.billing_address?.trim()||null,billing_city:form.billing_city?.trim()||null,billing_state:form.billing_state?.trim()||null,billing_zip:form.billing_zip?.trim()||null,insurance_carrier:form.insurance_carrier?.trim()||null,policy_number:form.policy_number?.trim()||null});
      if(form.role==='adjuster')Object.assign(data,{insurance_carrier:form.insurance_carrier?.trim()||null,desk_phone:deskPh||null,desk_extension:form.desk_extension?.trim()||null,territory:form.territory?.trim()||null,relationship_notes:form.relationship_notes?.trim()||null});
      if(form.role==='vendor'||form.role==='subcontractor'){Object.assign(data,{trade_specialty:form.trade_specialty?.trim()||null,payment_terms:form.payment_terms||'net_30',w9_on_file:form.w9_on_file||false});if(form.role==='subcontractor'&&form.coi_expiration)data.coi_expiration=form.coi_expiration;}
      await onSave(data);
    }catch(err){/* handled in parent */}finally{setSaving(false);}
  };

  const F=({label,field,type='text',placeholder,required})=>(<div className="form-group" style={{flex:1,marginBottom:0}}><label className="label">{label}{required&&' *'}</label>{type==='textarea'?<textarea className="input textarea" value={form[field]||''} onChange={e=>set(field,e.target.value)} rows={2} placeholder={placeholder}/>:type==='checkbox'?<label style={{display:'flex',alignItems:'center',gap:'var(--space-2)',cursor:'pointer',fontSize:'var(--text-sm)'}}><input type="checkbox" checked={form[field]||false} onChange={e=>set(field,e.target.checked)} style={{width:16,height:16}}/>{placeholder||label}</label>:<input ref={field==='name'?nameRef:undefined} className="input" type={type} value={form[field]||''} onChange={e=>set(field,e.target.value)} placeholder={placeholder}/> }</div>);
  const Sel=({label,field,options})=>(<div className="form-group" style={{flex:1,marginBottom:0}}><label className="label">{label}</label><select className="input" value={form[field]||''} onChange={e=>set(field,e.target.value)} style={{cursor:'pointer'}}>{options.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></div>);

  return(
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal add-contact-modal" onClick={e=>e.stopPropagation()}>
        <div className="conv-modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'var(--space-2)'}}>
            {step==='form'&&<button className="btn btn-ghost btn-sm" onClick={handleBack} style={{width:28,height:28,padding:0}}><IconBack style={{width:16,height:16}}/></button>}
            <span style={{fontSize:'var(--text-lg)',fontWeight:700}}>{step==='pick'?'New Contact':`New ${ROLE_LABELS[role]||'Contact'}`}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{width:32,height:32,padding:0}}><IconX style={{width:18,height:18}}/></button>
        </div>

        {step==='pick'?(
          <div className="add-contact-body">
            <div style={{fontSize:'var(--text-sm)',color:'var(--text-secondary)',marginBottom:'var(--space-3)'}}>What type of contact is this?</div>
            <div className="role-picker-grid">{ROLE_CARDS.map(rc=>(<button key={rc.value} className="role-picker-card" onClick={()=>selectRole(rc.value)}><span className="role-picker-emoji">{rc.emoji}</span><div className="role-picker-text"><div className="role-picker-label">{rc.label}</div><div className="role-picker-desc">{rc.desc}</div></div></button>))}</div>
          </div>
        ):(
          <>
            <div className="add-contact-body">
              <div className="cp-edit-section-label" style={{marginTop:0}}>Basic Info</div>
              <div className="add-contact-row"><F label="Name" field="name" placeholder="Full name" required/><F label="Phone" field="phone" type="tel" placeholder="(801) 555-1234" required/></div>
              <div className="add-contact-row"><F label="Email" field="email" type="email" placeholder="email@example.com"/><F label="Company" field="company" placeholder={role==='adjuster'?'Carrier name':role==='vendor'?'Company name':'Company (optional)'}/></div>
              <div className="add-contact-row"><Sel label="Preferred Contact" field="preferred_contact_method" options={CMO}/><Sel label="Language" field="preferred_language" options={LANG}/></div>

              {(role==='homeowner'||role==='tenant')&&(<><div className="cp-edit-section-label">Billing Address</div><div className="add-contact-row"><F label="Street" field="billing_address" placeholder="1422 E Maple Ridge Dr"/></div><div className="add-contact-row"><F label="City" field="billing_city" placeholder="Lehi"/><F label="State" field="billing_state" placeholder="UT"/><F label="ZIP" field="billing_zip" placeholder="84043"/></div><div className="cp-edit-section-label">Insurance</div><div className="add-contact-row"><LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v=>set('insurance_carrier',v)} items={carriers} placeholder="Search carriers..."/><F label="Policy #" field="policy_number" placeholder="SF-8820114"/></div></>)}

              {role==='adjuster'&&(<><div className="cp-edit-section-label">Adjuster Details</div><div className="add-contact-row"><LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v=>set('insurance_carrier',v)} items={carriers} placeholder="Search carriers..."/></div><div className="add-contact-row"><F label="Desk Phone" field="desk_phone" type="tel" placeholder="(800) 555-0100"/><F label="Extension" field="desk_extension" placeholder="4412"/></div><div className="add-contact-row"><F label="Territory / Region" field="territory" placeholder="Northern Utah - Salt Lake, Davis, Weber"/></div><F label="Relationship Notes" field="relationship_notes" type="textarea" placeholder="Response time, negotiation style, preferences..."/></>)}

              {role==='vendor'&&(<><div className="cp-edit-section-label">Vendor Details</div><div className="add-contact-row"><F label="Trade / Specialty" field="trade_specialty" placeholder="Flooring, plumbing, electrical..."/><Sel label="Payment Terms" field="payment_terms" options={PTO}/></div><div className="add-contact-row"><F label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received and on file"/></div></>)}

              {role==='subcontractor'&&(<><div className="cp-edit-section-label">Subcontractor Details</div><div className="add-contact-row"><F label="Trade / Specialty" field="trade_specialty" placeholder="Drywall, painting, tile..."/><Sel label="Payment Terms" field="payment_terms" options={PTO}/></div><div className="add-contact-row"><F label="COI Expiration" field="coi_expiration" type="date"/><F label="W-9 on File" field="w9_on_file" type="checkbox" placeholder="W-9 received and on file"/></div></>)}

              <div className="cp-edit-section-label">Other</div>
              <div className="add-contact-row">
                <LookupSelect label="Referral Source" value={form.referral_source} onChange={v=>set('referral_source',v)} items={referralSources} placeholder="Search sources..."/>
                <F label="Tags" field="tags" placeholder="VIP, repeat, priority"/>
              </div>
              <F label="Notes" field="notes" type="textarea" placeholder="Internal notes..."/>
            </div>
            <div className="add-contact-footer"><button className="btn btn-secondary" onClick={handleBack}>{hasDefault ? 'Cancel' : 'Back'}</button><button className="btn btn-primary" onClick={handleSave} disabled={saving||!form.name?.trim()||!form.phone?.trim()}>{saving?'Saving...':'Add Contact'}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══ Helper ═══ */
function initFormStatic(r){
  const base={name:'',phone:'',email:'',company:'',role:r,preferred_contact_method:'sms',preferred_language:'en',referral_source:'',tags:'',notes:''};
  if(r==='homeowner')return{...base,billing_address:'',billing_city:'',billing_state:'',billing_zip:'',insurance_carrier:'',policy_number:''};
  if(r==='adjuster')return{...base,company:'',desk_phone:'',desk_extension:'',territory:'',relationship_notes:'',insurance_carrier:''};
  if(r==='vendor')return{...base,trade_specialty:'',payment_terms:'net_30',w9_on_file:false};
  if(r==='subcontractor')return{...base,trade_specialty:'',payment_terms:'net_30',coi_expiration:'',w9_on_file:false};
  return base;
}
