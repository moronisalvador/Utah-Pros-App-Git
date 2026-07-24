/**
 * Authoritative, fail-closed service-SMS consent state for one direct mobile thread.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthHeader } from '@/lib/realtime';

export function isServiceSmsBlocked({ status = {}, isMulti = false, dnd = false } = {}) {
  if (isMulti) return false;
  return dnd
    || status.loading === true
    || !!status.error
    || status.allowed !== true;
}

function initialState(contact) {
  return {
    contactId: contact?.id || null,
    phone: contact?.phone || null,
    allowed: false,
    loading: !!contact?.id,
    checked: false,
    error: null,
    code: null,
    source: null,
  };
}

export function useServiceSmsConsent(contact, { enabled = true } = {}) {
  const [status, setStatus] = useState(() => initialState(enabled ? contact : null));
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const contactId = enabled ? contact?.id : null;
    const phone = enabled ? (contact?.phone || null) : null;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;

    if (!contactId) {
      setStatus(initialState(null));
      return;
    }

    setStatus({
      contactId,
      phone,
      allowed: false,
      loading: true,
      checked: false,
      error: null,
      code: null,
      source: null,
    });

    try {
      const authHeader = await getAuthHeader();
      const response = await fetch(
        `/api/attest-sms-consent?contact_id=${encodeURIComponent(contactId)}`,
        { headers: authHeader },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not verify SMS permission');
      if (requestId.current !== currentRequest) return;
      setStatus({
        contactId,
        phone,
        allowed: data.status?.allowed === true,
        loading: false,
        checked: true,
        error: null,
        code: data.status?.code || null,
        source: data.status?.source || null,
      });
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      setStatus({
        contactId,
        phone,
        allowed: false,
        loading: false,
        checked: false,
        error: error.message || 'Could not verify SMS permission',
        code: 'CONSENT_STATUS_FAILED',
        source: null,
      });
    }
  }, [contact?.id, contact?.phone, enabled]);

  useEffect(() => {
    refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  const recordConsent = useCallback((record) => {
    setStatus({
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
