/**
 * ════════════════════════════════════════════════
 * FILE: JobClaimSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The collapsible "Job & Claim" card below the stage. Tap the header to open
 *   the reference facts a tech reaches for on site: everyone attached to the job
 *   (homeowner, adjuster, agent…) with one-tap call and email, the insurance
 *   carrier / policy / claim numbers, the adjuster's contact info, the
 *   deductible (admins only), and — when the job belongs to a claim — a card
 *   that jumps up to that claim. It sits ABOVE the photo gallery on purpose so
 *   the adjuster-call flow never scrolls past a wall of pictures.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z4 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/hub/HubBelowFold.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/pages/tech/techConstants (DIV_BORDER_COLORS)
 *   Data:      none (job + contacts[] + claim arrive as props from get_job_hub)
 *
 * NOTES / GOTCHAS:
 *   - The field list is the full legacy JobDetailsPanel set (address, division,
 *     loss, carrier/policy/claim, adjuster, deductible, notes) so nothing a tech
 *     relied on disappears in the v2 redesign.
 *   - Deductible is admin/manager-only (isAdmin), matching legacy gating.
 *   - Starts collapsed to keep the surface compact; one tap opens it.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DIV_BORDER_COLORS } from '@/pages/tech/techConstants';

// ─── SECTION: Helpers ──────────────
function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// A single labeled reference row (label left, value right; tappable when href).
function Row({ label, value, href, mono, multiline }) {
  if (!value) return null;
  const cls = `tv2-hub-detail__v${mono ? ' is-mono' : ''}${multiline ? ' is-multiline' : ''}`;
  return (
    <div className={`tv2-hub-detail${multiline ? ' is-multiline' : ''}`}>
      <span className="tv2-hub-detail__k">{label}</span>
      {href ? <a className={`${cls} is-link`} href={href}>{value}</a> : <span className={cls}>{value}</span>}
    </div>
  );
}

// One person attached to the job — name/role + one-tap call/email.
function ContactCard({ contact, t }) {
  const role = contact.role || contact.contact_role;
  const phone = contact.phone || contact.desk_phone;
  return (
    <div className="tv2-hub-contact">
      <div className="tv2-hub-contact__top">
        <span className="tv2-hub-contact__name">{contact.name || t('jobClaim.unnamedContact')}</span>
        {role && <span className="tv2-hub-contact__role">{titleCase(role)}</span>}
      </div>
      {contact.company && <div className="tv2-hub-contact__company">{contact.company}</div>}
      <div className="tv2-hub-contact__actions">
        {phone && (
          <a className="tv2-hub-contact__action" href={`tel:${phone}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            {phone}
          </a>
        )}
        {contact.email && (
          <a className="tv2-hub-contact__action" href={`mailto:${contact.email}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
            {contact.email}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * @param {{ job: object, contacts?: Array, claim?: {id:string, claim_number?:string}|null,
 *           isAdmin?: boolean }} props
 */
export default function JobClaimSection({ job, contacts = [], claim, isAdmin }) {
  const { t } = useTranslation('hub');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const address = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const hasAdjuster = job.adjuster_name || job.adjuster_phone || job.adjuster_email;
  const divBorder = DIV_BORDER_COLORS?.[job.division] || 'var(--tech-accent)';

  return (
    <section className="tv2-hub-section">
      <button
        type="button"
        className="tv2-hub-collapse__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="tv2-hub-section__title">
          {t('below.jobClaim')}
          {contacts.length > 0 && <span className="tv2-hub-section__count">{contacts.length}</span>}
        </span>
        <svg className={`tv2-hub-collapse__chev${open ? ' is-open' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="tv2-hub-collapse__body">
          {/* Claim breadcrumb — jump up to the parent claim. */}
          {claim && (
            <button
              type="button"
              className="tv2-hub-claimcard"
              style={{ borderLeftColor: divBorder }}
              onClick={() => navigate(`/tech/claims/${claim.id}`)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              <div className="tv2-hub-claimcard__body">
                <span className="tv2-hub-claimcard__label">{t('jobClaim.partOfClaim')}</span>
                <span className="tv2-hub-claimcard__num">{claim.claim_number || t('jobClaim.aClaim')}</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          )}

          {/* People on the job — one-tap call / email. */}
          {contacts.length > 0 && (
            <>
              <div className="tv2-hub-subhead">{t('jobClaim.contactsHead')}</div>
              {contacts.map((c) => <ContactCard key={c.link_id || c.id} contact={c} t={t} />)}
            </>
          )}

          {/* Job facts. */}
          <div className="tv2-hub-subhead">{t('jobClaim.detailsHead')}</div>
          <div className="tv2-hub-detaillist">
            <Row label={t('jobClaim.address')} value={address || null} />
            {job.division && (
              <div className="tv2-hub-detail">
                <span className="tv2-hub-detail__k">{t('jobClaim.division')}</span>
                <span className="tv2-hub-detail__v"><span className="tv2-hub-divpill" style={{ borderLeftColor: divBorder }}>{titleCase(job.division)}</span></span>
              </div>
            )}
            <Row label={t('jobClaim.status')} value={titleCase(job.status || 'active')} />
            <Row label={t('jobClaim.dateOfLoss')} value={formatLossDate(job.date_of_loss)} />
            <Row label={t('jobClaim.typeOfLoss')} value={job.type_of_loss ? titleCase(job.type_of_loss) : null} />
            <Row label={t('jobClaim.carrier')} value={job.insurance_company || t('jobClaim.outOfPocket')} />
            <Row label={t('jobClaim.policyNo')} value={job.policy_number} mono />
            <Row label={t('jobClaim.claimNo')} value={job.claim_number} mono />
            {isAdmin && typeof job.deductible === 'number' && (
              <Row label={t('jobClaim.deductible')} value={`$${Number(job.deductible).toFixed(2)}`} />
            )}
            <Row label={t('jobClaim.notes')} value={job.ar_notes} multiline />
          </div>

          {/* Adjuster (legacy denormalized fields). */}
          {hasAdjuster && (
            <>
              <div className="tv2-hub-subhead">{t('jobClaim.adjusterHead')}</div>
              <div className="tv2-hub-detaillist">
                <Row label={t('jobClaim.name')} value={job.adjuster_name} />
                <Row label={t('jobClaim.phone')} value={job.adjuster_phone} href={job.adjuster_phone ? `tel:${job.adjuster_phone}` : null} />
                <Row label={t('jobClaim.email')} value={job.adjuster_email} href={job.adjuster_email ? `mailto:${job.adjuster_email}` : null} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
