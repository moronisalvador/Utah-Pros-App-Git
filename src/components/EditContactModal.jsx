/**
 * ════════════════════════════════════════════════
 * FILE: EditContactModal.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pop-up for changing an existing customer's details — name, phone, email,
 *   billing address, insurance carrier and notes. It fills itself in from the
 *   contact you opened it on, lets you edit the fields, and hands the cleaned-up
 *   values back to whichever screen opened it so that screen can save them.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (dialog)
 *   Rendered by:  n/a — not wired to a screen yet. Contact editing is planned work
 *                 that needs polish before it ships in the mobile app (owner, 2026-08-14),
 *                 so this is kept and kept correct rather than deleted.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ui/Modal, AddContactModal (LookupSelect), AddressAutocomplete, lib/toast
 *   Data:      reads  → none directly (the contact arrives as a prop)
 *              writes → none directly (the caller's onSave owns the write)
 *
 * NOTES / GOTCHAS:
 *   - Built on the shared <Modal>, which owns role="dialog", aria-modal, the
 *     accessible name, the focus trap, Escape/overlay close and body scroll-lock.
 *   - `open` is LOCAL state, not a prop, because every caller mounts this dialog
 *     conditionally. Dismissing flips it false so Modal can play its exit
 *     animation, and Modal's onExited then calls the caller's onClose to unmount.
 *     Do not "simplify" this to open={true} — that reinstates the instant
 *     unmount-on-close the motion standard treats as a defect.
 *   - The form body keeps its own scroll (.add-contact-body); .ui-modal-body's
 *     scrolling is turned off for this dialog so there is only ONE scroller.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { LookupSelect } from './AddContactModal';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { Modal } from '@/components/ui';
import { err } from '@/lib/toast';

const CMO = [{value:'sms',label:'SMS'},{value:'call',label:'Phone Call'},{value:'email',label:'Email'}];
const LANG = [{value:'en',label:'English'},{value:'es',label:'Spanish'},{value:'pt',label:'Portuguese'}];

/* Stable field components — defined outside to prevent unmount/remount on keystroke */
function EditField({ label, field, type = 'text', placeholder, form, set }) {
  return (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
      <label className="label">{label}</label>
      {type === 'textarea' ? (
        <textarea className="input textarea" value={form[field] || ''} onChange={e => set(field, e.target.value)} rows={3} placeholder={placeholder} />
      ) : (
        <input className="input" type={type} value={form[field] || ''} onChange={e => set(field, e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}
function EditSelect({ label, field, options, form, set }) {
  return (
    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
      <label className="label">{label}</label>
      <select className="input" value={form[field] || ''} onChange={e => set(field, e.target.value)} style={{ cursor: 'pointer' }}>
        {options.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </div>
  );
}

/**
 * EditContactModal — edit existing contact fields.
 * Props: contact, onClose, onSave(updatedData), carriers
 */
export default function EditContactModal({ contact, onClose, onSave, carriers }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);

  // Dismiss = animate out first; Modal's onExited calls onClose to unmount us.
  const dismiss = useCallback(() => setOpen(false), []);

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
    } catch (e) {
      err('Failed to save: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={dismiss}
      onExited={onClose}
      title="Edit Contact"
      className="edit-contact-modal"
      closeDisabled={saving}
      footer={(
        <>
          <button className="btn btn-secondary" onClick={dismiss} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name?.trim()}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      )}
    >
        <div className="add-contact-body">
          <div className="cp-edit-section-label" style={{ marginTop: 0 }}>Basic Info</div>
          <div className="add-contact-row"><EditField label="Name" field="name" placeholder="Full name" form={form} set={set} /><EditField label="Phone" field="phone" type="tel" placeholder="(801) 555-1234" form={form} set={set} /></div>
          <div className="add-contact-row"><EditField label="Email" field="email" type="email" placeholder="email@example.com" form={form} set={set} /><EditField label="Company" field="company" placeholder="Company (optional)" form={form} set={set} /></div>
          <div className="add-contact-row"><EditSelect label="Preferred Contact" field="preferred_contact_method" options={CMO} form={form} set={set} /><EditSelect label="Language" field="preferred_language" options={LANG} form={form} set={set} /></div>

          <div className="cp-edit-section-label">Billing Address</div>
          <div className="add-contact-row">
            <div className="form-group" style={{flex:1,marginBottom:0}}>
              <label className="label">Street</label>
              <AddressAutocomplete
                value={form.billing_address}
                onChange={v => set('billing_address', v)}
                onSelect={p => setForm(prev => ({ ...prev, billing_address: p.address, billing_city: p.city, billing_state: p.state || prev.billing_state, billing_zip: p.zip }))}
                placeholder="1422 E Maple Ridge Dr"
              />
            </div>
          </div>
          <div className="add-contact-row"><EditField label="City" field="billing_city" placeholder="Lehi" form={form} set={set} /><EditField label="State" field="billing_state" placeholder="UT" form={form} set={set} /><EditField label="ZIP" field="billing_zip" placeholder="84043" form={form} set={set} /></div>

          <div className="cp-edit-section-label">Insurance</div>
          <div className="add-contact-row">
            <LookupSelect label="Insurance Carrier" value={form.insurance_carrier} onChange={v => set('insurance_carrier', v)} items={carriers || []} placeholder="Search carriers..." />
            <EditField label="Policy #" field="policy_number" placeholder="SF-8820114" form={form} set={set} />
          </div>

          <div className="cp-edit-section-label">Other</div>
          <EditField label="Notes" field="notes" type="textarea" placeholder="Internal notes..." form={form} set={set} />
        </div>
    </Modal>
  );
}

function fmtPhoneForEdit(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const n = digits.startsWith('1') ? digits.slice(1) : digits;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return phone;
}
