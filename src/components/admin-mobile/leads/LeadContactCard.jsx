/**
 * ════════════════════════════════════════════════
 * FILE: LeadContactCard.jsx  (Admin Mobile — who this lead is)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The block at the top of a lead's screen: their name, a phone number you can
 *   tap to call or text, where the enquiry came from, and anything they typed
 *   into a web form. It is the answer to "who called and what did they want",
 *   which is the reason someone opens this screen standing in a driveway.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational card)
 *   Rendered by:  src/pages/tech/admin/AdminLeadDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./leadFormat (contactLabelFor, formatDuration, formatValue)
 *   Data:      reads → none (the page owns every fetch) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - tel: and sms: are the whole point of putting this on a phone. They are
 *     plain anchors, not JS — WKWebView hands both straight to the OS, and a
 *     click handler would only get in the way.
 *   - form_data is free-shaped JSON from whatever form fired. Keys are rendered
 *     as-is with underscores softened; the shape is never assumed, and an
 *     object/array value is stringified rather than dropped, so a field can
 *     never silently vanish from a customer's own words.
 *   - caller_name comes from CallRail's caller-ID lookup and is often junk
 *     ("WIRELESS CALLER"). contactLabelFor already prefers a real linked
 *     contact over it; this card shows the number underneath either way.
 * ════════════════════════════════════════════════
 */
import { Fragment } from 'react';
import { contactLabelFor, formatDuration, formatValue } from './leadFormat';

/** "first_name" → "First name". Never invents a label the form did not send. */
const prettyKey = (key) => {
  const spaced = String(key).replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const prettyValue = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export default function LeadContactCard({ lead }) {
  const name = contactLabelFor(lead);
  const phone = lead.contact?.phone || lead.caller_number || null;
  // A tel: href must not carry spaces or punctuation.
  const dialable = phone ? phone.replace(/[^\d+]/g, '') : null;
  const formEntries = lead.form_data && typeof lead.form_data === 'object' && !Array.isArray(lead.form_data)
    ? Object.entries(lead.form_data).filter(([, v]) => prettyValue(v) !== null)
    : [];

  // ─── SECTION: Render ──────────────
  return (
    <section className="am-lead-contact-card">
      <h2 className="am-lead-detail-name">{name}</h2>

      <div className="am-lead-detail-facts">
        <span className="am-lead-type" data-type={lead.source_type}>
          {lead.source_type === 'call' ? 'Call' : 'Form'}
        </span>
        {lead.source_type === 'call' && <span>{formatDuration(lead.duration_sec)}</span>}
        {lead.source_type === 'call' && lead.answered === false && (
          <span className="am-lead-badge am-lead-badge--missed">Missed</span>
        )}
        {formatValue(lead.value) && (
          <span className="am-lead-badge am-lead-badge--value">{formatValue(lead.value)}</span>
        )}
        {(lead.spam_flag || lead.lead_status === 'spam') && (
          <span className="am-lead-badge am-lead-badge--spam">Spam</span>
        )}
      </div>

      {dialable && (
        <div className="am-lead-actions-row">
          <a className="am-lead-action-btn am-lead-action-btn--primary" href={`tel:${dialable}`}>
            Call {phone}
          </a>
          <a className="am-lead-action-btn" href={`sms:${dialable}`} aria-label={`Text ${phone}`}>
            Text
          </a>
        </div>
      )}

      {(lead.source || lead.campaign || lead.medium) && (
        <dl className="am-lead-kv">
          {lead.source && (<><dt>Source</dt><dd>{lead.source}</dd></>)}
          {lead.medium && (<><dt>Medium</dt><dd>{lead.medium}</dd></>)}
          {lead.campaign && (<><dt>Campaign</dt><dd>{lead.campaign}</dd></>)}
        </dl>
      )}

      {formEntries.length > 0 && (
        <div className="am-lead-form-data">
          <div className="am-lead-section-label">What they submitted</div>
          <dl className="am-lead-kv">
            {formEntries.map(([key, value]) => (
              <Fragment key={key}>
                <dt>{prettyKey(key)}</dt>
                <dd>{prettyValue(value)}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
