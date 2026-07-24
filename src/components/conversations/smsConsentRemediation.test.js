import { describe, expect, it, vi } from 'vitest';
import {
  buildConsentRemediationPrompt,
  contactHasP2pSmsConsent,
  findConsentRetryMessage,
  recordPriorP2pConsent,
} from './smsConsentRemediation';

describe('person-to-person SMS consent remediation', () => {
  it('offers attestation only for missing consent, never STOP or DND', () => {
    const input = {
      contactId: 'contact-1',
      canAttest: true,
      activeConversationId: 'conversation-1',
      conversationId: 'conversation-1',
      clientId: 'request-1',
    };

    expect(buildConsentRemediationPrompt({ ...input, code: 'NO_CONSENT' })).toMatchObject({
      clientId: 'request-1',
      retryAfterRecord: true,
    });
    expect(buildConsentRemediationPrompt({ ...input, code: 'CONTACT_OPTED_OUT' })).toBeNull();
    expect(buildConsentRemediationPrompt({ ...input, code: 'DND_ACTIVE' })).toBeNull();
  });

  it('retries only the exact failed client request in the still-active thread', () => {
    const exact = { _clientId: 'request-1', status: 'failed' };
    const messages = [exact, { _clientId: 'request-2', status: 'failed' }];
    const prompt = {
      convId: 'conversation-1',
      clientId: 'request-1',
      retryAfterRecord: true,
    };

    expect(findConsentRetryMessage({
      prompt,
      messages,
      activeConversationId: 'conversation-1',
    })).toBe(exact);
    expect(findConsentRetryMessage({
      prompt,
      messages,
      activeConversationId: 'conversation-2',
    })).toBeNull();
  });

  it('binds scoped consent to the attested phone and never overrides suppression', () => {
    const contact = {
      phone: '+13855550100',
      opt_in_status: false,
      p2p_sms_consent_at: '2026-07-23T18:00:00Z',
      p2p_sms_consent_phone: '(385) 555-0100',
      dnd: false,
      opt_out_at: null,
    };

    expect(contactHasP2pSmsConsent(contact)).toBe(true);
    expect(contactHasP2pSmsConsent({ ...contact, phone: '+13855550199' })).toBe(false);
    expect(contactHasP2pSmsConsent({ ...contact, opt_out_at: '2026-07-23T19:00:00Z' })).toBe(false);
    expect(contactHasP2pSmsConsent({ ...contact, dnd: true })).toBe(false);
  });

  it('keeps a 409 failure unsuccessful so the caller cannot close or retry', async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Contact previously opted out' }),
    }));

    await expect(recordPriorP2pConsent({
      fetcher,
      authHeader: { Authorization: 'Bearer test' },
      contactId: 'contact-1',
      method: 'verbal_permission',
      consentObtainedOn: '2026-07-22',
      evidenceNote: 'Verified on the recorded intake call.',
    })).rejects.toThrow('Contact previously opted out');
  });
});
