/**
 * ════════════════════════════════════════════════
 * FILE: AdditionalContactsSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everyone else attached to this job — the adjuster, a tenant, a property
 *   manager — as a list of cards a technician can call or text straight from.
 *   Tapping a card opens it in place to change that person's details or what
 *   they are to this job, and there is a way to add somebody who is already in
 *   the system or somebody brand new.
 *
 *   Removing takes two taps and only ever detaches the person FROM THIS JOB. It
 *   never deletes the person: an adjuster removed from one job is still the
 *   adjuster on the other nine.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a section of /tech/customer/:contactId, job mode only)
 *   Rendered by:  src/pages/tech/v2/customer/TechCustomerPage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/lib/toast, @/lib/openInAppThread,
 *              @/lib/phone, ./customerHelpers, ./CustomerInfoSection (row/field)
 *   Data:      reads  → contacts (search_contacts_for_job; duplicate-phone lookup)
 *              writes → contact_jobs (link_contact_to_job RPC; role update;
 *                        link DELETE), contacts (insert for a new person, and
 *                        the same consent-safe patch the info section uses)
 *
 * NOTES / GOTCHAS:
 *   - REMOVE DELETES THE LINK ROW, NOT THE PERSON. `contact_jobs` by link id —
 *     never `contacts`.
 *   - The primary link gets NO Remove control. The Hub hero reads it for the
 *     headline name and the conversation picker resolves a job's thread through
 *     it (primaryJobContactId), so detaching it from a phone would quietly break
 *     both. Not offered beats offered-and-refused.
 *   - Adding goes through `link_contact_to_job`, not a raw insert: that RPC
 *     already owns the (contact_id, job_id, role) conflict and the primary-swap,
 *     so a raw insert here would be a second, worse opinion about both.
 *   - A brand-new person whose phone already exists is auto-linked to the
 *     existing person rather than failing — same forgiving behaviour
 *     TechNewCustomer already has, because a duplicate phone in the field almost
 *     always means "this is the same person".
 *   - Message goes through openInAppThread, never a hand-off to the
 *     phone's own messaging app (AGENTS.md §14).
 * ════════════════════════════════════════════════
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { openInAppThread } from '@/lib/openInAppThread';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { EditField } from './CustomerInfoSection.jsx';
import {
  buildContactPatch,
  canRemoveLink,
  linkRoleOf,
  EDITABLE_CONTACT_FIELDS,
} from './customerHelpers.js';

/**
 * What a person can be to a job. Free text in the database (no CHECK
 * constraint), so this is a convenience list rather than a limit — but keeping
 * it fixed is what stops one job saying "adjuster" and the next "Adjuster".
 */
const LINK_ROLES = ['primary_client', 'adjuster', 'tenant', 'property_manager', 'agent', 'other'];

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

/**
 * @param {{ jobId: string, contacts: Array<object>, onChanged: () => Promise<void>|void }} props
 */
export default function AdditionalContactsSection({ jobId, contacts, onChanged }) {
  const { t } = useTranslation('customer');
  const navigate = useNavigate();
  const { db } = useAuth();

  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const confirmTimer = useRef(null);

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [newPerson, setNewPerson] = useState(null); // {name, phone, role}
  const searchTimer = useRef(null);

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const openCard = (link) => {
    if (openId === link.link_id) { setOpenId(null); return; }
    setOpenId(link.link_id);
    setForm({
      name: link.name || '',
      phone: formatPhone(link.phone) || link.phone || '',
      email: link.email || '',
      company: link.company || '',
      role: linkRoleOf(link) || 'other',
    });
  };

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const saveCard = async (link) => {
    if (saving) return;
    setSaving(true);
    try {
      const patch = buildContactPatch(form, link, EDITABLE_CONTACT_FIELDS);
      if (Object.keys(patch).length > 0) {
        await db.update('contacts', `id=eq.${link.id}`, { ...patch, updated_at: new Date().toISOString() });
      }
      const nextRole = form.role || 'other';
      if (nextRole !== (link.role || '')) {
        await db.update('contact_jobs', `id=eq.${link.link_id}`, { role: nextRole });
      }
      setOpenId(null);
      await onChanged?.();
      toast(t('contacts.saved'));
    } catch (error) {
      // A role change can collide with the (contact_id, job_id, role) unique
      // index when the same person is already attached under that role.
      const message = error?.message || '';
      toast(
        /duplicate key|23505/.test(message) ? t('contacts.roleTaken') : t('contacts.saveFailed'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const removeLink = async (link) => {
    if (confirmRemoveId !== link.link_id) {
      setConfirmRemoveId(link.link_id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmRemoveId(null), 3000);
      return;
    }
    setConfirmRemoveId(null);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    try {
      // The LINK, by its own id. Never the contact.
      await db.delete('contact_jobs', `id=eq.${link.link_id}`);
      setOpenId(null);
      await onChanged?.();
      toast(t('contacts.removed'));
    } catch {
      toast(t('contacts.removeFailed'), 'error');
    }
  };

  const runSearch = (value) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await db.rpc('search_contacts_for_job', { p_query: value.trim() });
        setResults(Array.isArray(rows) ? rows.slice(0, 8) : []);
      } catch { setResults([]); }
    }, 300);
  };

  const closeAdd = () => {
    setAdding(false); setSearch(''); setResults([]); setNewPerson(null);
  };

  const linkExisting = async (contactId, role = 'other') => {
    if (saving) return;
    setSaving(true);
    try {
      await db.rpc('link_contact_to_job', {
        p_contact_id: contactId, p_job_id: jobId, p_role: role,
        p_is_primary: false, p_notes: null,
      });
      closeAdd();
      await onChanged?.();
      toast(t('contacts.added'));
    } catch {
      toast(t('contacts.addFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const createAndLink = async () => {
    const name = (newPerson?.name || '').trim();
    const phone = normalizePhone(newPerson?.phone || '');
    if (!name || saving) return;
    if (newPerson?.phone && !phone) { toast(t('contacts.invalidPhone'), 'error'); return; }
    setSaving(true);
    try {
      let contactId = null;
      try {
        const inserted = await db.insert('contacts', {
          name,
          phone: phone || null,
          role: newPerson?.role === 'adjuster' ? 'adjuster' : 'other',
          // NO opt_in_status. `contacts.opt_in_status` is `DEFAULT false NOT
          // NULL`, so leaving it out produces the identical row — and it keeps
          // this whole surface unable to name a consent column at all, which a
          // contract test enforces. TechNewCustomer writes the value
          // explicitly; matching the column default is the safer half of that
          // precedent, not a behaviour change.
          tags: [],
        });
        contactId = inserted?.[0]?.id || null;
      } catch (error) {
        const message = error?.message || '';
        if (!/contacts_phone_key|23505/.test(message) || !phone) throw error;
        // Duplicate phone: this is the same person. Link the existing one
        // rather than failing in front of a customer.
        const existing = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}&select=id,name&limit=1`);
        contactId = existing?.[0]?.id || null;
        if (contactId) toast(t('contacts.matchedExisting', { name: existing[0].name }));
      }
      if (!contactId) { toast(t('contacts.addFailed'), 'error'); return; }
      await linkExisting(contactId, newPerson?.role || 'other');
    } catch {
      toast(t('contacts.addFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="tv2-cust-section">
      <div className="tv2-cust-section__head">
        <span className="tv2-cust-section__title">
          {t('contacts.title')}
          {contacts.length > 0 && <span className="tv2-cust-section__count">{contacts.length}</span>}
        </span>
      </div>

      {contacts.length === 0 && !adding && (
        <div className="tv2-cust-empty">{t('contacts.none')}</div>
      )}

      {contacts.map((link) => {
        const open = openId === link.link_id;
        const confirming = confirmRemoveId === link.link_id;
        const role = linkRoleOf(link);
        return (
          <div key={link.link_id || link.id} className="tv2-cust-card">
            <button type="button" className="tv2-cust-card__head" onClick={() => openCard(link)} aria-expanded={open}>
              <span className="tv2-cust-card__name">{link.name || t('contacts.unnamed')}</span>
              {role && <span className="tv2-cust-card__role">{titleCase(role)}</span>}
              <svg className={`tv2-cust-card__chev${open ? ' is-open' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {open && (
              <div className="tv2-cust-card__body">
                <EditField label={t('info.name')} value={form.name} onChange={(v) => set('name', v)} />
                <EditField label={t('info.phone')} value={form.phone} onChange={(v) => set('phone', v)} type="tel" />
                <EditField label={t('info.email')} value={form.email} onChange={(v) => set('email', v)} type="email" />
                <EditField label={t('info.company')} value={form.company} onChange={(v) => set('company', v)} />
                <div className="tv2-cust-field">
                  <label className="tv2-cust-field__label">{t('contacts.roleOnJob')}</label>
                  <div className="tv2-cust-field__list">
                    {LINK_ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className="tv2-cust-field__option"
                        onClick={() => set('role', r)}
                        aria-pressed={form.role === r}
                        style={form.role === r ? { fontWeight: 700, color: 'var(--accent)' } : undefined}
                      >
                        {t(`contacts.role.${r}`, titleCase(r))}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="tv2-cust-card__actions">
                  {link.phone && <a className="tv2-cust-action" href={`tel:${link.phone}`}>{t('info.call')}</a>}
                  {link.phone && (
                    <button type="button" className="tv2-cust-action" onClick={() => openInAppThread(navigate, link.id)}>
                      {t('info.message')}
                    </button>
                  )}
                </div>

                <div className="tv2-cust-card__actions">
                  <button type="button" className="tv2-cust-editbtn tv2-cust-editbtn--primary" onClick={() => saveCard(link)} disabled={saving}>
                    {saving ? t('common.saving') : t('common.save')}
                  </button>
                  {canRemoveLink(link) ? (
                    <button
                      type="button"
                      className={`tv2-cust-removebtn${confirming ? ' is-confirming' : ''}`}
                      onClick={() => removeLink(link)}
                      onBlur={() => setConfirmRemoveId(null)}
                    >
                      {confirming ? t('contacts.confirmRemove') : t('contacts.remove')}
                    </button>
                  ) : (
                    <span className="tv2-cust-hint">{t('contacts.primaryLocked')}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="tv2-cust-card">
          {newPerson ? (
            <>
              <EditField label={t('info.name')} value={newPerson.name} onChange={(v) => setNewPerson((p) => ({ ...p, name: v }))} autoFocus />
              <EditField label={t('info.phone')} value={newPerson.phone} onChange={(v) => setNewPerson((p) => ({ ...p, phone: v }))} type="tel" />
              <div className="tv2-cust-field">
                <label className="tv2-cust-field__label">{t('contacts.roleOnJob')}</label>
                <div className="tv2-cust-field__list">
                  {LINK_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="tv2-cust-field__option"
                      onClick={() => setNewPerson((p) => ({ ...p, role: r }))}
                      aria-pressed={newPerson.role === r}
                      style={newPerson.role === r ? { fontWeight: 700, color: 'var(--accent)' } : undefined}
                    >
                      {t(`contacts.role.${r}`, titleCase(r))}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tv2-cust-card__actions">
                <button type="button" className="tv2-cust-editbtn tv2-cust-editbtn--primary" onClick={createAndLink} disabled={saving || !newPerson.name?.trim()}>
                  {saving ? t('common.saving') : t('contacts.addPerson')}
                </button>
                <button type="button" className="tv2-cust-editbtn" onClick={() => setNewPerson(null)} disabled={saving}>
                  {t('common.back')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="tv2-cust-field">
                <label className="tv2-cust-field__label">{t('contacts.searchLabel')}</label>
                <input
                  className="tv2-cust-field__input"
                  type="text"
                  value={search}
                  onChange={(e) => runSearch(e.target.value)}
                  placeholder={t('contacts.searchPlaceholder')}
                  autoFocus
                />
                {results.length > 0 && (
                  <div className="tv2-cust-field__list">
                    {results.map((r) => (
                      <button key={r.id} type="button" className="tv2-cust-field__option" onClick={() => linkExisting(r.id)} disabled={saving}>
                        {r.name}{r.phone ? ` · ${formatPhone(r.phone) || r.phone}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="tv2-cust-card__actions">
                <button type="button" className="tv2-cust-editbtn" onClick={() => setNewPerson({ name: search, phone: '', role: 'other' })}>
                  {t('contacts.newPerson')}
                </button>
                <button type="button" className="tv2-cust-editbtn" onClick={closeAdd}>{t('common.cancel')}</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button type="button" className="tv2-cust-addbtn" onClick={() => setAdding(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('contacts.add')}
        </button>
      )}
    </section>
  );
}
