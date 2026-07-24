/**
 * ════════════════════════════════════════════════
 * FILE: SmsConsentAttestationModal.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the prior-SMS-permission dialog visibly requires a real evidence source,
 *   consent date, evidence note, and staff confirmation before recording anything.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server
 *   Internal:  ./SmsConsentAttestationModal
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));
vi.mock('@/lib/toast', () => ({ ok: vi.fn(), err: vi.fn() }));

import SmsConsentAttestationModal from './SmsConsentAttestationModal';

describe('SmsConsentAttestationModal', () => {
  it('renders the supported verbal and signed-work-authorization evidence flow', () => {
    const output = renderToStaticMarkup(
      <SmsConsentAttestationModal
        open
        contactId="11111111-1111-4111-8111-111111111111"
        contactName="Jordan Customer"
        onClose={() => {}}
        onRecorded={() => {}}
      />,
    );

    expect(output).toContain('Record verified SMS permission');
    expect(output).toContain('Verbal permission on a call');
    expect(output).toContain('Signed work authorization');
    expect(output).toContain('type="date"');
    expect(output).toContain('Evidence note');
    expect(output).toContain('Contact existence alone is not permission');
    expect(output).toContain('service-related texts about their requested work');
    expect(output).toContain('This does not clear STOP or Do Not Disturb');
    expect(output).toContain('Record permission');
    expect(output).not.toContain('retry message');
    expect(output).toMatch(/form="sms-consent-attestation" disabled=""/);
  });

  it('renders nothing while closed', () => {
    expect(renderToStaticMarkup(
      <SmsConsentAttestationModal
        open={false}
        contactId={null}
        onClose={() => {}}
        onRecorded={() => {}}
      />,
    )).toBe('');
  });
});
