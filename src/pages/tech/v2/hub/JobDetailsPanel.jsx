/**
 * ════════════════════════════════════════════════
 * FILE: JobDetailsPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A collapsible "Job details" panel showing the reference facts about a job —
 *   address, phase, division, date/type of loss, carrier, policy and claim
 *   numbers, the insured/homeowner's contact info, and the adjuster's info.
 *   It starts collapsed and opens when tapped. The deductible line only shows
 *   to admins/managers.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/tech/DetailRow
 *   Data:      none (job + contact arrive as props)
 *
 * NOTES / GOTCHAS:
 *   - Ported verbatim from the legacy TechJobDetail details panel so the fields
 *     and admin gating stay identical through the merge.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import DetailRow from '@/components/tech/DetailRow';

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function JobDetailsPanel({ job, contact, address, phaseLabel, isAdmin }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ padding: '16px var(--space-4) 0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', minHeight: 48, padding: '12px 16px',
          borderRadius: 12, background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', fontFamily: 'var(--font-sans)',
          fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span>Job details</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{ marginTop: 8, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
          <DetailRow label="Address" value={address || null} />
          <DetailRow label="Phase" value={phaseLabel} />
          <DetailRow label="Status" value={titleCase(job.status || 'active')} />
          <DetailRow label="Division" value={titleCase(job.division)} />
          <DetailRow label="Date of loss" value={formatLossDate(job.date_of_loss)} />
          <DetailRow label="Type of loss" value={job.type_of_loss ? titleCase(job.type_of_loss) : null} />
          <DetailRow label="Carrier" value={job.insurance_company || 'Out of pocket'} />
          <DetailRow label="Policy #" value={job.policy_number} mono />
          <DetailRow label="Claim #" value={job.claim_number} mono />
          {isAdmin && typeof job.deductible === 'number' && (
            <DetailRow label="Deductible" value={`$${Number(job.deductible).toFixed(2)}`} />
          )}
          {job.ar_notes && <DetailRow label="Notes" value={job.ar_notes} multiline />}

          {(contact || job.insured_name) && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 14, marginBottom: 6 }}>
                Insured / Homeowner
              </div>
              <DetailRow label="Name" value={contact?.name || job.insured_name} />
              <DetailRow label="Phone" value={contact?.phone || job.client_phone} href={(contact?.phone || job.client_phone) ? `tel:${contact?.phone || job.client_phone}` : null} />
              <DetailRow label="Email" value={contact?.email || job.client_email} href={(contact?.email || job.client_email) ? `mailto:${contact?.email || job.client_email}` : null} />
            </>
          )}

          {(job.adjuster_name || job.adjuster_phone || job.adjuster_email) && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 14, marginBottom: 6 }}>
                Adjuster
              </div>
              <DetailRow label="Name" value={job.adjuster_name} />
              <DetailRow label="Phone" value={job.adjuster_phone} href={job.adjuster_phone ? `tel:${job.adjuster_phone}` : null} />
              <DetailRow label="Email" value={job.adjuster_email} href={job.adjuster_email ? `mailto:${job.adjuster_email}` : null} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
