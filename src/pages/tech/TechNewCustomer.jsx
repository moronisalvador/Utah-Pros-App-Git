import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { normalizePhone } from '@/lib/phone';

const ROLES = [
  { value: 'homeowner', emoji: '\u{1F3E0}', label: 'Homeowner' },
  { value: 'tenant', emoji: '\u{1F6CF}\uFE0F', label: 'Tenant' },
  { value: 'adjuster', emoji: '\u{1F4CB}', label: 'Adjuster' },
  { value: 'other', emoji: '\u{1F464}', label: 'Other' },
];

const inputStyle = {
  width: '100%', height: 48, padding: '0 14px',
  fontSize: 16, borderRadius: 'var(--tech-radius-button)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};

const labelStyle = {
  fontSize: 'var(--tech-text-label)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6,
};

export default function TechNewCustomer() {
  const navigate = useNavigate();
  const { db } = useAuth();
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState('homeowner');
  const [form, setForm] = useState({
    name: '', phone: '', email: '', notes: '',
    billing_address: '', billing_city: '', billing_state: 'UT', billing_zip: '',
    company: '',
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const canSave = form.name.trim() && form.phone.trim();
  const isAddress = role === 'homeowner' || role === 'tenant';
  const isAdjuster = role === 'adjuster';

  const handleSave = async () => {
    if (!canSave || saving) return;
    const phone = normalizePhone(form.phone);
    if (!phone) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Enter a valid 10-digit phone number', type: 'error' } }));
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        phone,
        role,
        email: form.email?.trim() || null,
        notes: form.notes?.trim() || null,
        opt_in_status: false,
        tags: [],
      };
      if (isAddress) {
        Object.assign(data, {
          billing_address: form.billing_address?.trim() || null,
          billing_city: form.billing_city?.trim() || null,
          billing_state: form.billing_state?.trim() || null,
          billing_zip: form.billing_zip?.trim() || null,
        });
      }
      if (isAdjuster) {
        data.company = form.company?.trim() || null;
      }
      const result = await db.insert('contacts', data);
      if (result?.length > 0) {
        toast('Customer created');
        window.dispatchEvent(new CustomEvent('upr:contact-created'));
        navigate(-1);
      } else {
        toast('Failed to create customer', 'error');
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('contacts_phone_key') || msg.includes('23505')) {
        toast('A customer with this phone number already exists', 'error');
      } else {
        toast('Failed to save customer. Please try again.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 40, height: 40, borderRadius: 'var(--tech-radius-button)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
          New Customer
        </span>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 100 }}>

        {/* Role pills */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...labelStyle, display: 'block', marginBottom: 8 }}>
            Contact Type
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ROLES.map(r => (
              <button
                key={r.value}
                onClick={() => setRole(r.value)}
                style={{
                  flex: '1 1 0', minWidth: 0, padding: '10px 4px',
                  borderRadius: 'var(--tech-radius-button)',
                  border: role === r.value ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                  background: role === r.value ? 'var(--accent-light)' : 'var(--bg-primary)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 24 }}>{r.emoji}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: role === r.value ? 'var(--accent)' : 'var(--text-secondary)',
                }}>{r.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Full Name <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="John Smith"
            autoFocus
            style={inputStyle}
          />
        </div>

        {/* Phone */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Phone <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="(801) 555-1234"
            style={inputStyle}
          />
        </div>

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="john@email.com"
            style={inputStyle}
          />
        </div>

        {/* Adjuster: Company */}
        {isAdjuster && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Carrier / Company</label>
            <input
              type="text"
              value={form.company}
              onChange={e => set('company', e.target.value)}
              placeholder="State Farm, Allstate, etc."
              style={inputStyle}
            />
          </div>
        )}

        {/* Homeowner/Tenant: Address */}
        {isAddress && (
          <>
            <div style={{ ...labelStyle, marginBottom: 8, marginTop: 4 }}>
              Billing Address
            </div>
            <div style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={form.billing_address}
                onChange={e => set('billing_address', e.target.value)}
                placeholder="Street address"
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={form.billing_city}
                onChange={e => set('billing_city', e.target.value)}
                placeholder="City"
                style={{ ...inputStyle, flex: 2 }}
              />
              <input
                type="text"
                value={form.billing_state}
                onChange={e => set('billing_state', e.target.value)}
                placeholder="ST"
                style={{ ...inputStyle, flex: 0.6, padding: '0 10px', textAlign: 'center' }}
              />
              <input
                type="text"
                value={form.billing_zip}
                onChange={e => set('billing_zip', e.target.value)}
                placeholder="ZIP"
                style={{ ...inputStyle, flex: 1, padding: '0 10px' }}
              />
            </div>
          </>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Optional notes..."
            rows={3}
            style={{
              ...inputStyle, height: 'auto', padding: '12px 14px',
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* Sticky submit */}
      <div style={{
        position: 'fixed', bottom: 'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))',
        left: 0, right: 0, padding: '12px 16px',
        background: 'linear-gradient(transparent, var(--bg-primary) 8px)',
        zIndex: 10,
      }}>
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          style={{
            width: '100%', height: 52, borderRadius: 'var(--tech-radius-button)',
            background: canSave && !saving ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: canSave && !saving ? '#fff' : 'var(--text-tertiary)',
            border: 'none', fontSize: 16, fontWeight: 700, cursor: canSave ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {saving ? 'Saving...' : 'Save Customer'}
        </button>
      </div>
    </div>
  );
}
