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
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui';
import { getAuthHeader } from '@/lib/realtime';
import { impact, notify } from '@/lib/nativeHaptics';
import { err, ok } from '@/lib/toast';

const METHODS = [
  { value: 'verbal_permission', key: 'verbalPermission' },
  { value: 'signed_work_authorization', key: 'signedWorkAuthorization' },
  { value: 'other_written_permission', key: 'otherWrittenPermission' },
  { value: 'customer_requested_texts', key: 'customerRequestedTexts' },
  { value: 'other_verified_permission', key: 'otherVerifiedPermission' },
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
  const { t } = useTranslation('msgs');
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
        throw new Error(data.error || t('consentAttestation.recordError'));
      }

      ok(t('consentAttestation.recorded'));
      notify('success');
      onRecorded?.(data.consent);
    } catch (error) {
      err(error.message || t('consentAttestation.recordError'));
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
      title={t('consentAttestation.title')}
      size="sm"
      className="sms-consent-attestation-modal"
      closeOnOverlay={!submitting}
      footer={(
        <>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={submitting}>
            {t('consentAttestation.cancel')}
          </button>
          <button className="btn btn-primary btn-lg" type="submit" form="sms-consent-attestation" disabled={!canSubmit}>
            {submitting
              ? t('consentAttestation.recording')
              : t('consentAttestation.record')}
          </button>
        </>
      )}
    >
      <form id="sms-consent-attestation" onSubmit={submit}>
        <p className="conv-consent-attest-copy">
          {t('consentAttestation.intro', {
            contact: contactName || t('consentAttestation.thisContact'),
          })}
        </p>

        <div className="form-group">
          <label className="label" htmlFor="sms-consent-method">
            {t('consentAttestation.methodLabel')}
          </label>
          <select
            id="sms-consent-method"
            className="input"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            disabled={submitting}
            required
          >
            <option value="">{t('consentAttestation.methodPlaceholder')}</option>
            {METHODS.map((item) => (
              <option key={item.value} value={item.value}>
                {t(`consentAttestation.methods.${item.key}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="label" htmlFor="sms-consent-date">
            {t('consentAttestation.dateLabel')}
          </label>
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
          <label className="label" htmlFor="sms-consent-evidence">
            {t('consentAttestation.evidenceLabel')}
          </label>
          <textarea
            id="sms-consent-evidence"
            className="input textarea"
            value={evidenceNote}
            onChange={(event) => setEvidenceNote(event.target.value)}
            maxLength={500}
            aria-describedby="sms-consent-evidence-hint"
            placeholder={t('consentAttestation.evidencePlaceholder')}
            disabled={submitting}
            required
          />
          <div className="conv-consent-attest-hint" id="sms-consent-evidence-hint">
            {t('consentAttestation.evidenceHint', {
              count: evidenceNote.trim().length,
            })}
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
            {t('consentAttestation.confirm')}
          </span>
        </label>
      </form>
    </Modal>
  );
}
