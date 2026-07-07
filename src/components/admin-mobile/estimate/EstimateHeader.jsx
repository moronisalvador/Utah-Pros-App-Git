/**
 * ════════════════════════════════════════════════
 * FILE: EstimateHeader.jsx  (Admin Mobile — estimate detail header, P4a)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The top card of the mobile estimate screen. It shows the estimate's status
 *   (Draft / Saved / Sent / Converted) as a colored chip, the big estimate
 *   number, who it's prepared for (name + email), the key facts (type, carrier,
 *   claim, job, sent date), and the property address. It only displays — it does
 *   not fetch anything or change anything.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational card)
 *   Rendered by:  src/pages/tech/admin/AdminEstimateDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none (all data passed in as props)
 *
 * NOTES / GOTCHAS:
 *   - Styling is the .am-est-* view vocabulary in index.css §ESTIMATE.
 *   - The caller passes an already-derived view-model (deriveEstimateView) plus
 *     the loaded job/claim/contact rows; this file does no computation beyond
 *     formatting for display.
 * ════════════════════════════════════════════════
 */

const TYPE_LABEL = { initial: 'Initial', supplement: 'Supplement', change_order: 'Change order', final: 'Final' };

const fmtDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function Field({ label, value, mono }) {
  return (
    <div className="am-est-field">
      <div className="am-est-field-label">{label}</div>
      <div className={`am-est-field-value${mono ? ' am-est-field-value--mono' : ''}`}>{value || '—'}</div>
    </div>
  );
}

export default function EstimateHeader({ est, view, job, claim, contact, division }) {
  const addr = est.property_address
    ? `${est.property_address}${est.property_city ? `, ${est.property_city}` : ''}${est.property_state ? `, ${est.property_state}` : ''}${est.property_zip ? ` ${est.property_zip}` : ''}`
    : '';
  const sent = fmtDate(est.submitted_at);
  const dol = fmtDate(claim?.date_of_loss);

  return (
    <div className="am-est-card">
      {/* SECTION: Status + number */}
      <div className="am-est-head-top">
        <span className={`am-est-status am-est-status--${view.statusKind}`}>{view.statusLabel}</span>
      </div>
      <div className="am-est-docnum">{view.docNumber}</div>
      {est.qbo_doc_number && est.qbo_doc_number !== est.estimate_number && (
        <div className="am-est-ref">UPR ref {est.estimate_number}</div>
      )}

      {/* SECTION: Prepared for */}
      <div className="am-est-prepared">
        <div className="am-est-field-label">Prepared for</div>
        <div className="am-est-prepared-name">{contact?.name || '—'}</div>
        {contact?.email && <div className="am-est-prepared-email">{contact.email}</div>}
      </div>

      <div className="am-est-hr" />

      {/* SECTION: Key fields */}
      <div className="am-est-field-grid">
        <Field label="Type" value={TYPE_LABEL[est.estimate_type] || 'Estimate'} />
        <Field label="Carrier" value={claim?.insurance_carrier} />
        <Field label="Claim" value={claim?.claim_number} mono />
        <Field label="Job" value={job?.job_number ? `${job.job_number} · ${division}` : division} />
        {dol && <Field label="Date of loss" value={dol} />}
        <Field label="Sent" value={sent || 'Not sent'} />
      </div>

      {addr && <div className="am-est-addr">{addr}</div>}
    </div>
  );
}
