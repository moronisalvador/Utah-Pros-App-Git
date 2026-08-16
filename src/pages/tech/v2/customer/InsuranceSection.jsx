/**
 * ════════════════════════════════════════════════
 * FILE: InsuranceSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The insurance details on the field customer screen — who the carrier is, the
 *   policy number and the claim number — with a tap to edit them in place. When
 *   the screen was opened from a job it shows and edits THAT job's insurance,
 *   which is what the office screens edit too. Opened without a job, it shows the
 *   customer's own carrier and policy on file, which is what a new job would
 *   start from.
 *
 *   A few things are shown but not editable here: date and type of loss, the
 *   deductible, and the adjuster. Those belong to the claim and the office, and a
 *   technician changing them from a phone would quietly rewrite paperwork.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a section of /tech/customer/:contactId)
 *   Rendered by:  src/pages/tech/v2/customer/TechCustomerPage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, ./customerHelpers
 *   Data:      reads  → insurance_carriers (get_insurance_carriers, for the
 *                        suggestion list — the same RPC every other carrier
 *                        field in the app uses)
 *              writes → jobs (insurance_company / policy_number / claim_number)
 *                        in job mode, contacts (insurance_carrier /
 *                        policy_number) in contact mode; the parent owns the call
 *
 * NOTES / GOTCHAS:
 *   - JOB MODE WRITES THE JOB, NOT THE CLAIM. The job carries a denormalized
 *     copy of carrier/policy/claim; an existing trigger one-way syncs carrier and
 *     date-of-loss up to the claim. Claim and policy numbers are deliberately NOT
 *     synced between jobs and claims — that drift is pre-existing and the office
 *     accepts it. Do not add a client-side double-write to "fix" it here.
 *   - The carrier field is a free-text input with suggestions, not a picker: a
 *     tech standing in a basement may be looking at a carrier nobody has entered
 *     yet, and a closed list would strand them.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { ReadRow, EditField } from './CustomerInfoSection.jsx';
import {
  buildContactPatch,
  buildJobInsurancePatch,
  EDITABLE_CONTACT_INSURANCE_FIELDS,
} from './customerHelpers.js';

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * @param {{ job: object|null, claim: object|null, contact: object,
 *           onSaveJob: (patch: object) => Promise<void>,
 *           onSaveContact: (patch: object) => Promise<void> }} props
 */
export default function InsuranceSection({ job, claim, contact, onSaveJob, onSaveContact }) {
  const { t } = useTranslation('customer');
  const navigate = useNavigate();
  const { db } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const jobMode = !!job;

  // Suggestions only — lazy, and only once someone actually taps Edit.
  const carriersQuery = useQuery({
    queryKey: ['tech', 'customer', 'carriers'],
    queryFn: () => db.rpc('get_insurance_carriers', {}),
    enabled: editing,
    staleTime: 10 * 60 * 1000,
  });
  const carriers = Array.isArray(carriersQuery.data) ? carriersQuery.data : [];

  const carrierValue = jobMode ? job.insurance_company : contact.insurance_carrier;
  const policyValue = jobMode ? job.policy_number : contact.policy_number;

  const startEdit = () => {
    setForm(jobMode
      ? {
        insurance_company: job.insurance_company || '',
        policy_number: job.policy_number || '',
        claim_number: job.claim_number || '',
      }
      : {
        insurance_carrier: contact.insurance_carrier || '',
        policy_number: contact.policy_number || '',
      });
    setEditing(true);
  };

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (jobMode) {
        await onSaveJob(buildJobInsurancePatch(form, job));
      } else {
        await onSaveContact(buildContactPatch(form, contact, EDITABLE_CONTACT_INSURANCE_FIELDS));
      }
      setEditing(false);
    } catch {
      // The saver already toasted. Keep the form open with the typed carrier /
      // policy / claim number rather than closing over a failed write.
    } finally {
      setSaving(false);
    }
  };

  const carrierKey = jobMode ? 'insurance_company' : 'insurance_carrier';
  const typed = (form[carrierKey] || '').trim().toLowerCase();
  const suggestions = typed
    ? carriers.filter((c) => (c.name || '').toLowerCase().includes(typed) && (c.name || '').toLowerCase() !== typed).slice(0, 6)
    : [];

  return (
    <section className="tv2-cust-section">
      <div className="tv2-cust-section__head">
        <span className="tv2-cust-section__title">
          {t('insurance.title')}
          {!jobMode && <span className="tv2-cust-section__count">{t('insurance.contactDefaults')}</span>}
        </span>
        {editing ? (
          <div className="tv2-cust-editactions">
            <button type="button" className="tv2-cust-editbtn" onClick={() => setEditing(false)} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="button" className="tv2-cust-editbtn tv2-cust-editbtn--primary" onClick={save} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        ) : (
          <button type="button" className="tv2-cust-editbtn" onClick={startEdit}>{t('common.edit')}</button>
        )}
      </div>

      {editing ? (
        <>
          <div className="tv2-cust-field">
            <label className="tv2-cust-field__label">{t('insurance.carrier')}</label>
            <input
              className="tv2-cust-field__input"
              type="text"
              value={form[carrierKey] ?? ''}
              onChange={(e) => set(carrierKey, e.target.value)}
              placeholder={t('insurance.carrierPlaceholder')}
              autoFocus
            />
            {suggestions.length > 0 && (
              <div className="tv2-cust-field__list">
                {suggestions.map((c) => (
                  <button key={c.id || c.name} type="button" className="tv2-cust-field__option" onClick={() => set(carrierKey, c.name)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <EditField label={t('insurance.policyNo')} value={form.policy_number} onChange={(v) => set('policy_number', v)} />
          {jobMode && (
            <EditField label={t('insurance.claimNo')} value={form.claim_number} onChange={(v) => set('claim_number', v)} />
          )}
        </>
      ) : (
        <>
          <ReadRow label={t('insurance.carrier')} value={carrierValue} emptyLabel={jobMode ? t('insurance.outOfPocket') : t('common.none')} />
          <ReadRow label={t('insurance.policyNo')} value={policyValue} mono emptyLabel={t('common.none')} />
          {jobMode && (
            <>
              <ReadRow label={t('insurance.claimNo')} value={job.claim_number} mono emptyLabel={t('common.none')} />
              {/* Read-only below: claim-owned or office-owned facts. */}
              <ReadRow label={t('insurance.dateOfLoss')} value={formatLossDate(job.date_of_loss)} emptyLabel={t('common.none')} />
              <ReadRow label={t('insurance.typeOfLoss')} value={job.type_of_loss ? titleCase(job.type_of_loss) : null} emptyLabel={t('common.none')} />
              <ReadRow label={t('insurance.adjuster')} value={job.adjuster_name} emptyLabel={t('common.none')} />
            </>
          )}
          {jobMode && claim?.id && (
            <button type="button" className="tv2-cust-claimcard" onClick={() => navigate(`/tech/claims/${claim.id}`)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="tv2-cust-claimcard__body">
                <span className="tv2-cust-claimcard__label">{t('insurance.partOfClaim')}</span>
                <span className="tv2-cust-claimcard__num">{claim.claim_number || t('insurance.aClaim')}</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
          {jobMode && !claim?.id && <div className="tv2-cust-empty">{t('insurance.noClaim')}</div>}
        </>
      )}
    </section>
  );
}
