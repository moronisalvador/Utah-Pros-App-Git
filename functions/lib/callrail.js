/**
 * ════════════════════════════════════════════════
 * FILE: callrail.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small, pure helper functions shared by the CallRail webhook worker and its
 *   tests. They don't talk to the database or the network — they just answer
 *   yes/no questions about a call or form lead so the same logic can be
 *   trusted in both places.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none — pure functions only
 *
 * NOTES / GOTCHAS:
 *   - shouldCreateContact is the spam/robocall filter from
 *     docs/crm-roadmap.md Phase 1: only auto-link/create a contact for a real,
 *     answered call (or a form lead, which has no duration at all). The
 *     `upsert_lead_from_callrail` SQL RPC re-implements this same rule
 *     server-side (it can't import JS) — this file is the unit-testable
 *     mirror of that rule, and the two are covered by different test types
 *     (unit here, integration against the RPC in
 *     supabase/tests/crm_phase1_callrail.test.js).
 * ════════════════════════════════════════════════
 */

// A spam-flagged call/lead never creates a contact. A call under 15 seconds
// is treated as a wrong number/hangup and doesn't either. Forms have no
// duration_sec at all (null), so they pass this half of the check.
export function shouldCreateContact({ spam_flag, duration_sec }) {
  if (spam_flag) return false;
  if (duration_sec != null && duration_sec < 15) return false;
  return true;
}
