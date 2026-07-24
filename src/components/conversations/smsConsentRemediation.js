/**
 * Purpose-scoped prior-consent helpers shared by the conversation UI and tests.
 * They never infer consent from contact existence and never treat STOP/DND as
 * remediable missing evidence.
 */

function normalizedPhoneIdentity(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function contactHasP2pSmsConsent(contact) {
  if (!contact || contact.opt_out_at || contact.dnd) return false;
  if (contact.opt_in_status === true) return true;
  return !!contact.p2p_sms_consent_at
    && normalizedPhoneIdentity(contact.p2p_sms_consent_phone)
      === normalizedPhoneIdentity(contact.phone);
}

export function buildConsentRemediationPrompt({
  code,
  contactId,
  canAttest,
  activeConversationId,
  conversationId,
  clientId,
}) {
  if (
    code !== 'NO_CONSENT'
    || !contactId
    || !canAttest
    || activeConversationId !== conversationId
  ) return null;

  return {
    contactId,
    convId: conversationId,
    clientId,
    retryAfterRecord: true,
  };
}

export function findConsentRetryMessage({ prompt, messages, activeConversationId }) {
  if (
    !prompt?.retryAfterRecord
    || !prompt.clientId
    || prompt.convId !== activeConversationId
  ) return null;

  return messages.find((message) => message._clientId === prompt.clientId) || null;
}

export async function recordPriorP2pConsent({
  fetcher = fetch,
  authHeader,
  contactId,
  method,
  consentObtainedOn,
  evidenceNote,
}) {
  const response = await fetcher('/api/attest-sms-consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      contact_id: contactId,
      consent_method: method,
      consent_obtained_on: consentObtainedOn,
      evidence_note: evidenceNote,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not record SMS permission');
  }
  return data.consent;
}
