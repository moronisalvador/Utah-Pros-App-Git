/**
 * ════════════════════════════════════════════════
 * FILE: leadFormat.js  (Admin Mobile — Lead Center formatters & filters)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure helper functions the Lead Center screen leans on: turning a
 *   call length into "3:07", a dollar value into "$1,500", deciding whether a
 *   lead should show a spam badge, grouping a transcript's back-and-forth by
 *   speaker, and filtering the list of leads by status word and search text.
 *   Keeping these here (with no screen or database code) makes them easy to test.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain helper module)
 *   Rendered by:  n/a — imported by the Lead Center page + row/transcript views
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Logic mirrors src/pages/crm/CrmCallLog.jsx (formatDuration / formatValue /
 *     isAwaitingRecording / groupTurns) — copied in, not imported, because that
 *     file is frozen for the admin-mobile wave. Keep the two in visual sync.
 *   - STATUS_OPTIONS matches CrmCallLog's lead-status vocabulary exactly (the
 *     values update_lead_status accepts). Do not diverge without the CRM.
 * ════════════════════════════════════════════════
 */

// The lead-status vocabulary update_lead_status accepts (mirrors CrmCallLog).
export const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'booked', 'not_interested', 'spam'];

// Filter tabs for the top of the Lead Center. 'all' hides spam (see filterLeads);
// 'spam' surfaces only spam so it stays reviewable without cluttering the default view.
export const STATUS_FILTER_TABS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'booked', label: 'Booked' },
  { value: 'spam', label: 'Spam' },
];

// A human status label ("not interested" from "not_interested").
export function statusLabel(status) {
  if (!status) return '';
  return status.replace(/_/g, ' ');
}

// Call length as "m:ss"; em-dash when unknown.
export function formatDuration(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A numeric lead value as "$1,500" (whole dollars); '' when unset/invalid.
export function formatValue(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '';
}

// Player clock as "m:ss"; tolerant of NaN/Infinity from a half-loaded <audio>.
export function fmtTime(sec) {
  if (!sec || Number.isNaN(sec) || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A call with no recording yet, seen in the last 10 minutes, is almost certainly
// still being processed by CallRail (recordings land ~1–3 min after hang-up). Show
// a "waiting" state so a fresh 0:00 row never looks broken. `now` is injectable so
// the behavior is testable without wall-clock coupling.
export function isAwaitingRecording(lead, now = Date.now()) {
  if (!lead || lead.source_type !== 'call' || lead.recording_url) return false;
  const t = new Date(lead.occurred_at || lead.created_at || 0).getTime();
  return t > 0 && (now - t) < 10 * 60 * 1000;
}

// The best display name for a lead: linked contact → detected caller name →
// raw number → a channel-appropriate fallback.
export function contactLabelFor(lead) {
  return (
    lead.contact?.name ||
    lead.caller_name ||
    lead.caller_number ||
    (lead.source_type === 'form' ? 'Web form' : 'Unknown')
  );
}

// Merge consecutive turns from the SAME speaker into one block, so a monologue
// isn't chopped into a dozen repeated-label rows. Returns [{speaker, role, texts[]}].
export function groupTurns(turns) {
  const blocks = [];
  for (const turn of turns || []) {
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === turn.speaker) {
      last.texts.push(turn.text);
    } else {
      blocks.push({ speaker: turn.speaker, role: turn.role || null, texts: [turn.text] });
    }
  }
  return blocks;
}

// Filter the lead list by the active status tab + a free-text search over the
// display name and caller number. 'all' excludes spam (spam has its own tab);
// 'spam' returns spam-flagged OR spam-status leads; any other value matches
// lead_status exactly.
export function filterLeads(leads, { status = 'all', search = '' } = {}) {
  const q = (search || '').trim().toLowerCase();
  return (leads || []).filter((lead) => {
    const isSpam = lead.lead_status === 'spam' || lead.spam_flag === true;
    if (status === 'spam') {
      if (!isSpam) return false;
    } else if (status === 'all') {
      if (isSpam) return false;
    } else if (lead.lead_status !== status) {
      return false;
    }
    if (!q) return true;
    const haystack = `${contactLabelFor(lead)} ${lead.caller_number || ''} ${lead.source || ''}`.toLowerCase();
    return haystack.includes(q);
  });
}
