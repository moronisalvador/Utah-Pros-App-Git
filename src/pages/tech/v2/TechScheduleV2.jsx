/**
 * ════════════════════════════════════════════════
 * FILE: TechScheduleV2.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The rebuilt field-tech schedule/calendar. Foundation ships this as a STUB
 *   behind the page:tech_sched_v2 flag so the plumbing (flag, persistent pane,
 *   query cache) can be verified before Session S builds the real agenda / day
 *   timeline / week-strip on the upgraded feed RPCs.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/schedule  (behind page:tech_sched_v2; legacy otherwise)
 *   Rendered by:  TechLayout pane host (persistent pane)
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  components/tech/v2 (TechV2Page), lib/techQuery (techKeys)
 *   Data:      reads → get_appointments_range (via Session S; stub does not fetch)
 *
 * NOTES / GOTCHAS:
 *   - `active` prop gates pollers/geo while the pane is hidden.
 *   - Owned by Session S per .claude/rules/tech-v2-wave-ownership.md. Foundation
 *     leaves only this stub.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import TechV2Page from '@/components/tech/v2/TechV2Page.jsx';

/**
 * @param {{ active?: boolean }} props - active = this pane is the visible tab.
 */
export default function TechScheduleV2({ active = true }) {
  return (
    <TechV2Page title="Schedule" subtitle="Tech v2 — Foundation stub">
      <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 'var(--tech-text-body)' }}>
        Schedule v2 is coming. This stub confirms the flag, the persistent pane,
        and the data layer are wired. {active ? '' : '(inactive)'}
      </div>
    </TechV2Page>
  );
}
