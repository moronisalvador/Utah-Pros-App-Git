/**
 * ════════════════════════════════════════════════
 * FILE: TranscriptView.jsx  (Admin Mobile — Lead Center call transcript)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows a call's transcript. When we have the richer AI analysis (newer calls)
 *   it lays out a readable conversation — a short summary, a sentiment pill, topic
 *   chips, then who-said-what grouped by speaker. For older calls that only have
 *   plain text, it just shows that text with its line breaks kept.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational view)
 *   Rendered by:  src/components/admin-mobile/leads/LeadRow.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./leadFormat (groupTurns)
 *   Data:      reads → none (given the lead's transcript_analysis / transcription
 *                     as props) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Copied in from src/pages/crm/CrmCallLog.jsx (frozen for the wave — never
 *     edit it). Classes renamed to the .am-transcript-* vocabulary in index.css
 *     §LEADS; the CRM .crm-transcript styles/tokens are scoped to .crm-shell.
 *   - `analysis` is the stored transcript_analysis jsonb (summary / sentiment /
 *     topics / turns / entities). With no structured turns it falls back to the
 *     flat `text`, whose line breaks render via the .am-transcript-flat rule.
 * ════════════════════════════════════════════════
 */
import { groupTurns } from './leadFormat';

// Only show a handful of topic chips (the analyzer over-tags older rows).
const MAX_TOPIC_CHIPS = 6;

export default function TranscriptView({ analysis, text }) {
  if (!analysis || !Array.isArray(analysis.turns) || analysis.turns.length === 0) {
    return <p className="am-transcript-flat">{text}</p>;
  }
  const sentiment = analysis.sentiment?.label;
  const topics = (analysis.topics || []).slice(0, MAX_TOPIC_CHIPS);
  const blocks = groupTurns(analysis.turns);
  return (
    <div className="am-transcript">
      {analysis.summary && (
        <div className="am-transcript-summary">
          <div className="am-transcript-summary-label">Summary</div>
          <div className="am-transcript-summary-text">{analysis.summary}</div>
        </div>
      )}
      {(sentiment || topics.length > 0) && (
        <div className="am-transcript-tags">
          {sentiment && (
            <span className={`am-sentiment am-sentiment--${sentiment}`}>{sentiment}</span>
          )}
          {topics.map((t) => (
            <span key={t} className="am-topic-chip">{t}</span>
          ))}
        </div>
      )}
      <div className="am-transcript-turns">
        {blocks.map((b, i) => (
          <div className="am-transcript-block" data-role={b.role || 'unknown'} key={i}>
            <div className="am-transcript-speaker">{b.speaker}</div>
            {b.texts.map((t, j) => (
              <p className="am-transcript-text" key={j}>{t}</p>
            ))}
          </div>
        ))}
      </div>
      {analysis.entities && analysis.entities.length > 0 && (
        <div className="am-transcript-entities">
          Detected: {analysis.entities.map((e) => e.value).join(', ')}
        </div>
      )}
    </div>
  );
}
