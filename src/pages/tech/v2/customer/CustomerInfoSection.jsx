/**
 * ════════════════════════════════════════════════
 * FILE: CustomerInfoSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The customer's own details on the field customer screen: name, phone, email
 *   and company. Reading it, everything is one tap away — the phone dials, the
 *   email opens mail, and Message opens the customer's conversation inside UPR.
 *   Tapping Edit turns the same rows into boxes in place, right where they were;
 *   there is no popup to lose your place in.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a section of /tech/customer/:contactId)
 *   Rendered by:  src/pages/tech/v2/customer/TechCustomerPage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/lib/openInAppThread, @/lib/phone (formatPhone), ./customerHelpers
 *   Data:      writes → contacts (name / phone / email / company only, via the
 *              patch customerHelpers builds; the parent owns the db call)
 *
 * NOTES / GOTCHAS:
 *   - Message goes through openInAppThread, NEVER an OS text link. Handing the
 *     customer off to the phone's own messaging app sends from the technician's
 *     personal number: no UPR thread, nothing in the CRM, and it never touches
 *     the consent chokepoint (AGENTS.md §14). The field-surface invariant test
 *     bans that hand-off across this directory.
 *   - The save patch is built by customerHelpers.buildContactPatch, which cannot
 *     emit a consent column. Do not hand-roll a patch object here.
 *   - Editing a shared contact (an adjuster) changes them on every job. The hint
 *     says so rather than pretending otherwise — the office page has identical
 *     semantics and says nothing at all.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { openInAppThread } from '@/lib/openInAppThread';
import { formatPhone } from '@/lib/phone';
import { buildContactPatch, isLikelySharedContact, EDITABLE_CONTACT_FIELDS } from './customerHelpers.js';

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconMsg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

/** One read-mode row; a tappable link when href is given. */
export function ReadRow({ label, value, href, mono, emptyLabel }) {
  const cls = `tv2-cust-row__v${mono ? ' is-mono' : ''}${value ? '' : ' is-empty'}${href && value ? ' is-link' : ''}`;
  return (
    <div className="tv2-cust-row">
      <span className="tv2-cust-row__k">{label}</span>
      {href && value
        ? <a className={cls} href={href}>{value}</a>
        : <span className={cls}>{value || emptyLabel}</span>}
    </div>
  );
}

/** One edit-mode field. */
export function EditField({ label, value, onChange, type = 'text', placeholder, autoFocus }) {
  return (
    <div className="tv2-cust-field">
      <label className="tv2-cust-field__label">{label}</label>
      <input
        className="tv2-cust-field__input"
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/**
 * @param {{ contact: object, onSave: (patch: object) => Promise<void> }} props
 */
export default function CustomerInfoSection({ contact, onSave }) {
  const { t } = useTranslation('customer');
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const startEdit = () => {
    setForm({
      name: contact.name || '',
      phone: formatPhone(contact.phone) || contact.phone || '',
      email: contact.email || '',
      company: contact.company || '',
    });
    setEditing(true);
  };

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!form.name?.trim() || saving) return;
    setSaving(true);
    try {
      // The helper decides what may be written. A hand-built object here is
      // exactly how a consent column would eventually creep in.
      const patch = buildContactPatch(form, contact, EDITABLE_CONTACT_FIELDS);
      await onSave(patch);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const phone = contact.phone;
  const shared = isLikelySharedContact(contact);

  return (
    <section className="tv2-cust-section">
      <div className="tv2-cust-section__head">
        <span className="tv2-cust-section__title">{t('info.title')}</span>
        {editing ? (
          <div className="tv2-cust-editactions">
            <button type="button" className="tv2-cust-editbtn" onClick={() => setEditing(false)} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="button" className="tv2-cust-editbtn tv2-cust-editbtn--primary" onClick={save} disabled={saving || !form.name?.trim()}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        ) : (
          <button type="button" className="tv2-cust-editbtn" onClick={startEdit}>{t('common.edit')}</button>
        )}
      </div>

      {editing ? (
        <>
          <EditField label={t('info.name')} value={form.name} onChange={(v) => set('name', v)} autoFocus />
          <EditField label={t('info.phone')} value={form.phone} onChange={(v) => set('phone', v)} type="tel" />
          <EditField label={t('info.email')} value={form.email} onChange={(v) => set('email', v)} type="email" />
          <EditField label={t('info.company')} value={form.company} onChange={(v) => set('company', v)} />
          {shared && <div className="tv2-cust-hint">{t('info.sharedHint')}</div>}
        </>
      ) : (
        <>
          <div className="tv2-cust-actions" style={{ padding: '0 0 12px' }}>
            {phone && (
              <a className="tv2-cust-action" href={`tel:${phone}`}>
                <IconPhone />{t('info.call')}
              </a>
            )}
            {phone && (
              <button
                type="button"
                className="tv2-cust-action"
                onClick={() => openInAppThread(navigate, contact.id)}
              >
                <IconMsg />{t('info.message')}
              </button>
            )}
            {contact.email && (
              <a className="tv2-cust-action" href={`mailto:${contact.email}`}>
                <IconMail />{t('info.email')}
              </a>
            )}
          </div>
          <ReadRow label={t('info.phone')} value={formatPhone(phone) || phone} href={phone ? `tel:${phone}` : null} emptyLabel={t('common.none')} />
          <ReadRow label={t('info.email')} value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} emptyLabel={t('common.none')} />
          <ReadRow label={t('info.company')} value={contact.company} emptyLabel={t('common.none')} />
        </>
      )}
    </section>
  );
}
