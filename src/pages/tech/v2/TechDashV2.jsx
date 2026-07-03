/**
 * ════════════════════════════════════════════════
 * FILE: TechDashV2.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The rebuilt field-tech dashboard ("mission control for today"). Foundation
 *   ships this as a STUB that renders behind the page:tech_dash_v2 flag so the
 *   plumbing (flag, pane host, data layer) can be verified before Session D
 *   builds the real hero / hours / today feed on top of get_tech_dashboard.
 *
 * WHERE IT LIVES:
 *   Route:        /tech  (behind page:tech_dash_v2; legacy TechDash otherwise)
 *   Rendered by:  TechLayout pane host (persistent pane)
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  components/tech/v2 (TechV2Page), lib/techQuery (techKeys)
 *   Data:      reads → get_tech_dashboard (via Session D; stub does not fetch yet)
 *
 * NOTES / GOTCHAS:
 *   - `active` prop (from the pane host) gates geolocation checks and pollers —
 *     Session D must respect it (visibilitychange does not fire on pane hide).
 *   - Owned by Session D per .claude/rules/tech-v2-wave-ownership.md. Foundation
 *     leaves only this stub.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import TechV2Page from '@/components/tech/v2/TechV2Page.jsx';

/**
 * @param {{ active?: boolean }} props - active = this pane is the visible tab.
 */
export default function TechDashV2({ active = true }) {
  return (
    <TechV2Page title="Dashboard" subtitle="Tech v2 — Foundation stub">
      <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 'var(--tech-text-body)' }}>
        Dashboard v2 is coming. This stub confirms the flag, the persistent pane,
        and the data layer are wired. {active ? '' : '(inactive)'}
      </div>
    </TechV2Page>
  );
}
