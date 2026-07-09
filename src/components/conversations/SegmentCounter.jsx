/**
 * ════════════════════════════════════════════════
 * FILE: SegmentCounter.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows a tiny live counter under the message box while you type a text — how many
 *   characters you've written and how many separate texts ("segments") it will be
 *   sent as. Carriers bill per segment and split long texts, so this warns the team
 *   before a one-liner quietly becomes three billed messages. It also accounts for
 *   the sender-name prefix the server adds ("Jane: …"), which eats into the limit.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside the composer in Conversations.jsx)
 *
 * DEPENDS ON:
 *   Packages:  react (none directly)
 *   Internal:  ./messageUtils (computeSmsSegments)
 *   Data:      reads/writes → none
 *
 * NOTES / GOTCHAS:
 *   - prefixLen is added to the counted text so the segment math matches what the
 *     recipient's carrier actually sees. It renders nothing for an empty draft.
 * ════════════════════════════════════════════════
 */

import { computeSmsSegments } from './messageUtils';

export default function SegmentCounter({ text = '', prefixLen = 0 }) {
  if (!text) return null;
  // Count the typed characters for display, but compute segments on prefix+text so
  // the SMS-count math matches what the carrier sees once the server prepends "Name: ".
  const typed = [...text].length;
  const prefix = prefixLen > 0 ? 'x'.repeat(prefixLen) : '';
  const { segments, remaining, encoding } = computeSmsSegments(prefix + text);
  const chars = typed;
  const multi = segments > 1;
  return (
    <div className={`conv-seg-counter${multi ? ' warn' : ''}`} title={`${encoding} encoding · ${remaining} left in this segment`}>
      <span className="conv-seg-chars">{chars}</span>
      {segments > 0 && <span className="conv-seg-parts">{segments} SMS</span>}
    </div>
  );
}
