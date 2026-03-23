import { useState, useEffect } from 'react';
import { LookupSelect } from './AddContactModal';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}

const CMO = [{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const LANG = [{value:'en',label:'English'},{value:'es',label:'Spanish'},{value:'pt',label:'Portuguese'}];

/**
 * EditContactModal — edit existing contact fields.
 * Props: contact, onClose, onSave(updatedData), carriers
 */
export default function EditContactModal({ contact, onClose, onSave, carriers }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!contact) return;
    setForm({
      name: contact.name || '',
      phone: fmtPhoneForEdit(contact.phone),
      email: contact.email || '',
      company: contact.company || '',
      preferred_contact_method: contact.preferred_contact_method || 'sms',
      preferred_language: contact.preferred_language || 'en',
      billing_address: contact.billing_address || '',
      billing_city: contact.billing_city || '',
      billing_state: contact.billing_state || '',
      billing_zip: contact.billing_zip || '',
      insurance_carrier: contact.insurance_carrier || '',
      policy_number: contact.policy_number || '',
      notes: contact.notes || '',
      referral_source: contact.referral_source || '',
    });
  }, [contact]);

  const set = (f, v) => setForm(prev => ({ ...prev, [f]: v }));

  const handleSave = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      // Normalize phone — only prepend '+' if there are actual digits
      let phone = form.phone.replace(/\D/g, '');
      if (phone.length === 10) phone = '1' + phone;
      if (phone.length > 0 && !phone.startsWith('+')) phone = '+' + phone;

      const data = {
        name: form.name.trim(),
        phone,
        email: form.email?.trim() || null,
        company: form.company?.trim() || null,
        preferred_contact_method: form.preferred_contact_method,
        preferred_language: form.preferred_language || 'en',
        billing_address: form.billing_address?.trim() || null,
        billing_city: form.billing_city?.trim() || null,
        billing_state: form.billing_state?.trim() || null,
        billing_zip: form.billing_zip?.trim() || null,
        insurance_carrier: form.insurance_carrier?.trim() || null,
        policy_number: form.policy_number?.trim() || null,
        notes: form.notes?.trim() || null,
        referral_source: form.referral_source?.trim() || null,
        updated_at: new Date().toISOString(),
      };

      await onSave(data);
    } catch (err) {
      errToast('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const F = ({ label, field, type = 'text', placeholder }) => (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
      <label className="label">{label}</label>
      {type === 'textarea' ? (
        <textarea className="input textarea" value={form[field] || ''} onChange={e => set(field, e.target.value)} rows={3} placeholder={placeholder} />
      ) : (
        <input className="input" type={type} value={form[field] || ''} onChange={e => set(field, e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );

  const Sel = ({ label, field, options }) => (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
      <label className="label">{label}</label>
      <select className="input" value={form[field] || ''} onChange={e => set(field, e.target.value)} style={{ cursor: 'pointer' }}>
        {options.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </div>
  );

  return (
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="conv-modal-header">
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Edit Contact</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="add-contact-body">
          <div className="cp-edit-section-label" style={{ marginTop: 0 }}>Basic Info</div>
          <div className="add-contact-row"><F label="Name" field="name" placeholder="Full name" /><F label="Phone" field="phone" type="tel" placeholder="(801) 555-1234" /></div>
          <div className="add-contact-row"><F label="Email" field="email" type="email" placeholder="email@example.com" /><F label="Company" field="company" placeholder="Company (optional)" /></div>
          <div className="add-contact-row"><Sel label="Preferred Contact" field="preferred_contact_method" options={CMO} /><Sel label="Language" field="preferred_language" options={LANG} /></div>

          <div className="cp-edit-section-label">Billing Address</div>
          <div className="add-contact-row"><F label="Street" field="billing_address" placeholder="1422 E Maple Ridge Dr" /></div>
          <div className="add-contact-row"><F label="City" field="billing_city" placeholder="Lehi" /><F label="State" field="billing_state" placeholder="UT" /><F label="ZIP" field="billing_zip" placeholder="84043" /></div>

          <div className="cp-edit-section-label">Insurance</div>
          <div className="add-contact-row">
            <LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v => set('insurance_carrier', v)} items={carriers || []} placeholder="Search carriers..." />
            <F label="Policy #" field="policy_number" placeholder="SF-8820114" />
          </div>

          <div className="cp-edit-section-label">Other</div>
          <F label="Notes" field="notes" type="textarea" placeholder="Internal notes..." />
        </div>

        <div className="add-contact-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name?.trim()}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtPhoneForEdit(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const n = digits.startsWith('1') ? digits.slice(1) : digits;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return phone;
}
