/**
 * ════════════════════════════════════════════════
 * FILE: GenerateReportButton.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the water-loss report section shows up on the jobs that dry and
 *   disappears on the ones that do not — and, just as importantly, that the
 *   older screen which renders this without saying what kind of job it is keeps
 *   behaving exactly as it always has.
 *
 * NOTES / GOTCHAS:
 *   - Runs in the `node` environment against static markup: structure and
 *     gating, not interaction.
 *   - The prop-less case is the one that protects the legacy appointment page.
 *     If `division` were required, that page would silently lose its reports.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const authState = vi.hoisted(() => ({ reportFlag: true }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { select: vi.fn(async () => []), baseUrl: 'https://example.test' },
    employee: { id: 'employee-1', role: 'field_tech' },
    isFeatureEnabled: (key) => (key === 'page:water_loss_report' ? authState.reportFlag : true),
  }),
}));

const { default: GenerateReportButton } = await import('./GenerateReportButton.jsx');

const render = (props) => renderToStaticMarkup(
  <GenerateReportButton jobId="job-1" jobNumber="W-2606-025" {...props} />,
);

afterEach(() => { authState.reportFlag = true; });

describe('GenerateReportButton — division gating', () => {
  it('renders with no division prop at all (the legacy caller)', () => {
    // TechAppointment renders it prop-less. An absent division must never be
    // read as "not a drying job", or that page silently loses its reports.
    expect(render()).toContain('Report');
  });

  it('renders on a division that dries', () => {
    for (const division of ['water', 'mold', 'fire']) {
      expect(render({ division }), division).toContain('Report');
    }
  });

  it('renders nothing on a reconstruction job', () => {
    // A water-loss report on a reconstruction job is the mitigation-only UI
    // this wave set out to stop showing.
    expect(render({ division: 'reconstruction' })).toBe('');
  });

  it('still renders nothing when the feature flag is off, whatever the division', () => {
    authState.reportFlag = false;
    expect(render({ division: 'water' })).toBe('');
    expect(render()).toBe('');
  });
});
