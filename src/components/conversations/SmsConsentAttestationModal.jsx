/**
 * ════════════════════════════════════════════════
 * FILE: SmsConsentAttestationModal.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives authorized office staff a careful way to record SMS permission that
 *   was verified before UPR tracked consent. Staff must identify how permission
 *   was obtained, describe the evidence, and explicitly confirm it before the
 *   app records anything.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/pages/Conversations.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/ui, @/lib/realtime, @/lib/toast, @/lib/nativeHaptics
 *   Data:      reads  → none
 *              writes → service_sms_consents, service_sms_consent_attestations,
 *                       and redacted sms_consent_log through POST /api/attest-sms-consent
 *
 * NOTES / GOTCHAS:
 *   - This form records verified prior permission; it does not infer consent from
 *     the contact existing and it cannot clear STOP or Do Not Disturb.
 *   - The server derives the staff actor from the authenticated session.
 * ════════════════════════════════════════════════
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui';
import { getAuthHeader } from '@/lib/realtime';
import { impact, notify } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';

const METHODS = [
  { value: 'verbal_permission', label: 'Verbal permission on a call' },
  { value: 'signed_work_authorization', label: 'Signed work authorization' },
  { value: 'other_written_permission', label: 'Other written permission' },
  { value: 'customer_requested_texts', label: 'Customer asked us to text' },
  { value: 'other_verified_permission', label: 'Other verified permission' },
];

function denverDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function SmsConsentAttestationModal({
  open,
  contactId,
  contactName,
  onClose,
  onRecorded,
}) {
  const [method, setMethod] = useState('');
  const [consentObtainedOn, setConsentObtainedOn] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMethod('');
      setConsentObtainedOn('');
      setEvidenceNote('');
      setConfirmed(false);
      setSubmitting(false);
    }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    const note = evidenceNote.trim();
    if (!method || !consentObtainedOn || note.length < 10 || !confirmed || !contactId) return;

    impact('light');
    setSubmitting(true);
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch('/api/attest-sms-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          contact_id: contactId,
          consent_method: method,
          consent_obtained_on: consentObtainedOn,
          evidence_note: note,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Could not record SMS permission');
      }

      ok('SMS permission recorded');
      notify('success');
      onRecorded?.(data.consent);
    } catch (error) {
      err(error.message || 'Could not record SMS permission');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!method
    && !!consentObtainedOn
    && evidenceNote.trim().length >= 10
    && confirmed
    && !submitting;

  return (
    <Modal
      open={open}
      onClose={submitting ? undefined : onClose}
      title="Record verified SMS permission"
      size="sm"
      className="sms-consent-attestation-modal"
      closeOnOverlay={!submitting}
      footer={(
        <>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="sms-consent-attestation" disabled={!canSubmit}>
            {submitting ? 'Recording…' : 'Record permission'}
          </button>
        </>
      )}
    >
      <form id="sms-consent-attestation" onSubmit={submit}>
        <p className="conv-consent-attest-copy">
          Record this only after verifying {contactName || 'this contact'} gave Utah Pros permission
          to send service-related texts. Contact existence alone is not permission.
        </p>

        <div className="form-group">
          <label className="label" htmlFor="sms-consent-method">How was permission provided?</label>
          <select
            id="sms-consent-method"
            className="input"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            disabled={submitting}
            required
          >
            <option value="">Select a source</option>
            {METHODS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="label" htmlFor="sms-consent-date">When was permission obtained?</label>
          <input
            id="sms-consent-date"
            className="input"
            type="date"
            value={consentObtainedOn}
            max={denverDateValue()}
            onChange={(event) => setConsentObtainedOn(event.target.value)}
            disabled={submitting}
            required
          />
        </div>

        <div className="form-group">
          <label className="label" htmlFor="sms-consent-evidence">Evidence note</label>
          <textarea
            id="sms-consent-evidence"
            className="input textarea"
            value={evidenceNote}
            onChange={(event) => setEvidenceNote(event.target.value)}
            maxLength={500}
            placeholder="Example: Recorded call at 2:14 PM, or authorization stored in Job Documents"
            disabled={submitting}
            required
          />
          <div className="conv-consent-attest-hint">
            The source, consent date, your staff identity, and the server timestamp will be kept in consent history.
          </div>
        </div>

        <label className="conv-consent-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={submitting}
          />
          <span>
            I verified this person gave Utah Pros Restoration permission to send service-related
            texts about their requested work, and has not revoked it. This does not clear STOP or
            Do Not Disturb.
          </span>
        </label>
      </form>
    </Modal>
  );
}
