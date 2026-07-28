/**
 * ════════════════════════════════════════════════
 * FILE: useServiceSmsConsent.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether the "type a text" box should be usable in a conversation.
 *   It used to ask the server "may we text this person?" every single time a
 *   thread was opened, which showed a "Checking SMS permission…" message and
 *   made the box wait. It no longer does that. It now answers instantly from
 *   information the screen already has: if the customer is on Do Not Disturb
 *   the box is locked, and otherwise it is ready to type in.
 *
 *   The server still has the final say. If that customer turned out to have
 *   opted out, or texted STOP a moment ago, the send is refused and the reason
 *   is shown then — nothing gets out the door without the server agreeing.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (hook, used by ThreadView in /tech/conversations)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  consumed by src/pages/tech/v2/messages/ThreadView.jsx
 *   Data:      reads  → none (derives from the contact row already loaded by
 *                       get_tech_conversations)
 *              writes → none
 *
 * EXPORTS:
 *   isServiceSmsBlocked({ status, isMulti, dnd }) → boolean
 *   useServiceSmsConsent(contact, { enabled }) → { status, refresh, recordConsent }
 *
 * NOTES / GOTCHAS:
 *   - CHANGED 2026-07-28 (owner-directed): the per-thread fetch to
 *     /api/attest-sms-consent is GONE. That endpoint still exists and is still
 *     used by the attestation flow; it is simply no longer called on every
 *     thread open. This is what removed the "checking for consent" delay.
 *   - `loading` is now permanently false and `error` permanently null. Both keys
 *     are kept so ThreadView/Conversations render paths did not have to be
 *     restructured, and so a future re-introduction of an async check does not
 *     need a new shape. Do not add code that waits on them.
 *   - `refresh` is deliberately a no-op returning nothing. useThread's
 *     onConsentRequired still calls it after a server refusal; there is nothing
 *     to re-fetch, and the server's own 403 message carries the reason.
 *   - get_tech_conversations projects `dnd` but NOT `opt_out_at`, so an opted-out
 *     contact is caught server-side at send, not here. That is intentional: the
 *     rare case pays the round trip instead of every thread open paying it.
 * ════════════════════════════════════════════════
 */
import { useCallback, useMemo, useState } from 'react';

export function isServiceSmsBlocked({ status = {}, isMulti = false, dnd = false } = {}) {
  if (isMulti) return false;
  return dnd || status.allowed !== true;
}

/**
 * Derive permission from the contact row we already hold. No I/O.
 * Fails closed only on the two things visible here: no contact, and DND.
 */
function deriveStatus(contact) {
  const base = {
    contactId: contact?.id || null,
    phone: contact?.phone || null,
    loading: false,
    checked: true,
    error: null,
  };
  if (!contact?.id) {
    return { ...base, allowed: false, code: 'CONTACT_NOT_FOUND', source: null };
  }
  if (contact.dnd) {
    return { ...base, allowed: false, code: 'DND_ACTIVE', source: 'contact_dnd' };
  }
  if (contact.opt_out_at) {
    return { ...base, allowed: false, code: 'NO_CONSENT', source: 'explicit_opt_out' };
  }
  return {
    ...base,
    allowed: true,
    code: 'IMPLIED_CONSENT',
    source: 'no_recorded_objection',
  };
}

export function useServiceSmsConsent(contact, { enabled = true } = {}) {
  const [override, setOverride] = useState(null);

  const contactId = contact?.id || null;
  const contactPhone = contact?.phone || null;
  const contactDnd = !!contact?.dnd;
  const contactOptOutAt = contact?.opt_out_at || null;
  const derived = useMemo(
    () => deriveStatus(
      enabled && contactId
        ? { id: contactId, phone: contactPhone, dnd: contactDnd, opt_out_at: contactOptOutAt }
        : null,
    ),
    [enabled, contactId, contactPhone, contactDnd, contactOptOutAt],
  );

  // An attestation recorded in this session wins until the contact row changes.
  const status = override && override.contactId === derived.contactId
    ? override
    : derived;

  // Kept for the useThread onConsentRequired callback. There is nothing to
  // re-fetch — the server refusal that triggered it already carried the reason.
  const refresh = useCallback(() => {}, []);

  const recordConsent = useCallback((record) => {
    setOverride({
      contactId: contact?.id || null,
      phone: contact?.phone || null,
      allowed: record?.service_sms_consent === true,
      loading: false,
      checked: true,
      error: null,
      code: record?.service_sms_consent === true ? 'SERVICE_CONSENT' : 'NO_CONSENT',
      source: 'service_consent',
    });
  }, [contact?.id, contact?.phone]);

  return { status, refresh, recordConsent };
}
