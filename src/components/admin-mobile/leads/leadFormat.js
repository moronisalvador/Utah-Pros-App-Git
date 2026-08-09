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

// ─── SECTION: Pipeline stage grouping (the phone tabs) ──────────────
// Lead Center reads the KANBAN STAGE, not inbound_leads.lead_status. That column
// is never advanced — measured 2026-08-08, 206 of 210 leads still read 'new',
// including 17 the board shows as Won and 28 it shows as Lost — so a screen built
// on it labels won jobs "new".
//
// The board has 9 stages. Nine tabs do not fit a phone, and the mobile-kanban
// guidance is explicit that hiding columns behind horizontal scrolling with no
// fallback is the wrong answer (uxpatterns.dev), and that a LIST with a filter
// beats a squeezed board on a small screen. So the stages collapse into four
// groups and every row still carries its exact stage as a chip — no detail lost.
export const STAGE_GROUPS = [
  { value: 'working', label: 'Working' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'all', label: 'All' },
];

// Classify a pipeline_stages row into one of the four groups, BY ITS FLAGS —
// never by name, which would break the moment a stage is renamed in settings.
//
//   is_won                        -> won
//   is_lost AND is_recoverable    -> working  (Missed Calls: a callback is work,
//                                              which is exactly what that flag is for)
//   is_lost                       -> lost
//   no stage row yet              -> working  (an unstaged lead reads as New; ~96
//                                              of 210 leads are in this state today)
//
// KNOWN DATA GAP, deliberately not papered over: "Not a Lead" carries neither
// is_won nor is_lost, so it lands in Working (24 leads). Setting is_lost on that
// stage in CRM settings fixes it for every surface at once; hardcoding the name
// here would fix it only here, and silently.
export function stageGroup(stage) {
  if (!stage) return 'working';
  if (stage.is_won) return 'won';
  if (stage.is_lost) return stage.is_recoverable ? 'working' : 'lost';
  return 'working';
}

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

// Filter the lead list by the active stage GROUP + a free-text search over the
// display name, caller number and source.
//
// Each lead is expected to carry a `stage` object (the pipeline_stages row the
// screen joined on); a lead with none is unstaged and reads as Working.
//
// Spam is excluded from the three working groups so it never clutters real work,
// and stays visible under 'All' so it remains reviewable — 59 leads carry
// spam_flag today. This replaces the old dedicated Spam tab; the four groups are
// about where a lead STANDS, and spam is a property, not a stage.
export function filterLeads(leads, { group = 'all', search = '' } = {}) {
  const q = (search || '').trim().toLowerCase();
  return (leads || []).filter((lead) => {
    const isSpam = lead.spam_flag === true || lead.lead_status === 'spam';
    if (group !== 'all') {
      if (isSpam) return false;
      if (stageGroup(lead.stage) !== group) return false;
    }
    if (!q) return true;
    const haystack = `${contactLabelFor(lead)} ${lead.caller_number || ''} ${lead.source || ''}`.toLowerCase();
    return haystack.includes(q);
  });
}
