/**
 * ════════════════════════════════════════════════
 * FILE: LeadRow.jsx  (Admin Mobile — Lead Center one lead)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One inbound lead in the list: who it was, when they called, how long the
 *   call ran, which stage of the sales board they are sitting in, and any spam
 *   or value flags. Tapping it opens that lead's own screen, where the
 *   recording, transcript, contact details and history live.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational card)
 *   Rendered by:  src/pages/tech/admin/AdminLeadCenter.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (Link)
 *   Internal:  ../href (adminLeadHref), ../icons (IconChevronRight),
 *              ./leadFormat
 *   Data:      reads → none (the page owns every fetch) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Deliberately a LINK, not an accordion. This row used to expand inline
 *     with a recording player, a transcript and a stage <select>; adding the
 *     activity timeline to that would have made every row a wall. The list's
 *     one job is answering "who called and where is it" at a glance while
 *     standing outside a customer's house, so everything else moved to
 *     AdminLeadDetail.
 *   - Presentational on purpose: no useAuth() here, so it renders without an
 *     AuthContext and stays unit-testable.
 *   - `lead.stage` is the pipeline_stages row the PAGE joined on; it is not part
 *     of get_inbound_leads, which returns lead_status and no stage at all. A lead
 *     with no stage row yet renders "Not staged" rather than pretending it is
 *     in the first stage.
 * ════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom';
import { adminLeadHref } from '../href';
import { IconChevronRight } from '../icons';
import {
  formatDuration, formatValue, isAwaitingRecording, contactLabelFor,
} from './leadFormat';

export default function LeadRow({ lead }) {
  const contactLabel = contactLabelFor(lead);
  const when = lead.occurred_at
    ? new Date(lead.occurred_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

  // ─── SECTION: Render ──────────────
  return (
    <Link to={adminLeadHref(lead.id)} className="am-lead-row" aria-label={`${contactLabel} — open lead`}>
      <div className="am-lead-main">
        <div className="am-lead-type" data-type={lead.source_type}>
          {lead.source_type === 'call' ? 'Call' : 'Form'}
        </div>
        <div className="am-lead-contact">
          <div className="am-lead-name">{contactLabel}</div>
          {lead.caller_number && lead.contact?.name && (
            <div className="am-lead-phone">{lead.caller_number}</div>
          )}
        </div>
        <div className="am-lead-when">{when}</div>
        <IconChevronRight width={18} height={18} className="am-lead-chevron" />
      </div>

      <div className="am-lead-meta">
        {/* The stage chip is the answer to "where is it", so it leads. */}
        <span
          className="am-lead-badge am-lead-badge--stage"
          data-unstaged={lead.stage ? undefined : 'true'}
          style={lead.stage?.color ? { '--am-stage-color': lead.stage.color } : undefined}
        >
          {lead.stage ? lead.stage.name : 'Not staged'}
        </span>
        {lead.source_type === 'call' && <span className="am-lead-dur">{formatDuration(lead.duration_sec)}</span>}
        {lead.source && <span className="am-lead-source">{lead.source}{lead.campaign ? ` · ${lead.campaign}` : ''}</span>}
        {formatValue(lead.value) && <span className="am-lead-badge am-lead-badge--value">{formatValue(lead.value)}</span>}
        {(lead.spam_flag || lead.lead_status === 'spam') && <span className="am-lead-badge am-lead-badge--spam">Spam</span>}
        {isAwaitingRecording(lead) && (
          <span className="am-lead-awaiting">
            <span className="am-awaiting-dot" aria-hidden="true" />
            Waiting for recording
          </span>
        )}
      </div>
    </Link>
  );
}
