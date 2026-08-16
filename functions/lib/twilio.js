/**
 * ════════════════════════════════════════════════
 * FILE: twilio.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Verifies that incoming Twilio forms are authentic and sends approved
 *   outbound texts through Twilio. It also turns Twilio callback forms into a
 *   small, consistent object used by the status handler.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./credentials.js, ./http.js
 *   Data:      reads  → managed Twilio credentials through credentials.js
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Signature verification uses the exact public URL plus every form field,
 *     including future or repeated fields.
 *   - Outbound callers must complete consent and authorization before using the
 *     send helper; this file is only the provider adapter.
 * ════════════════════════════════════════════════
 */

import { resolveCredential } from './credentials.js';
import { fetchWithTimeout } from './http.js';
import { assertProviderCallAllowed, assertLocalSmsDestinationAllowed } from './environment.js';

/**
 * Validate Twilio webhook signature using HMAC-SHA1
 * CRITICAL: Reject any webhook that fails validation — prevents spoofed inbound messages
 */
export async function validateTwilioSignature(request, authToken, url) {
  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) return false;

  const clonedReq = request.clone();
  const formData = await clonedReq.formData();
  return validateTwilioFormSignature({
    signature,
    authToken,
    url,
    params: formData,
  });
}

function decodeBase64(value) {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Validate one application/x-www-form-urlencoded Twilio signature.
 *
 * Twilio may add webhook fields without notice, and a field may occur more than
 * once. Build the signature input from every received parameter, sorting keys
 * and each key's distinct values exactly as the maintained Twilio helper does.
 * The caller supplies the exact public request URL including its query string.
 */
export async function validateTwilioFormSignature({
  signature,
  authToken,
  url,
  params,
}) {
  if (!signature || !authToken || !url || !params?.entries) return false;

  const grouped = new Map();
  for (const [key, rawValue] of params.entries()) {
    const value = String(rawValue);
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }

  let dataString = url;
  for (const key of [...grouped.keys()].sort()) {
    const values = [...new Set(grouped.get(key))].sort();
    for (const value of values) dataString += key + value;
  }

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['verify'],
  );
  const signatureBytes = decodeBase64(signature);
  if (!signatureBytes) return false;
  return crypto.subtle.verify(
    'HMAC',
    cryptoKey,
    signatureBytes,
    encoder.encode(dataString),
  );
}

/**
 * Send an SMS/MMS via Twilio REST API.
 *
 * Do not add an RCS Sender to this Messaging Service while this legacy command
 * uses an ordinary phone-number destination: Twilio may then select RCS and
 * automatically fall back across channels. The future RCS adapter must use an
 * explicit `rcs:` destination so UPR's no-fallback policy stays enforceable.
 */
export async function sendMessage(env, {
  to,
  body,
  mediaUrls,
  statusCallback,
  failClosedOnCredentialError = false,
}) {
  // DB-first (integration_credentials/config), env fallback — see functions/lib/credentials.js
  const { accountSid, authToken, messagingServiceSid, phoneNumber } =
    await resolveCredential(env, null, 'twilio', {
      failClosedOnDbError: failClosedOnCredentialError,
    });

  const params = new URLSearchParams({
    To: to,
    Body: body,
  });

  // Use the existing Messaging Service sender pool. RCS activation is blocked
  // until the separate channel-locked adapter and rollout gates are complete.
  if (messagingServiceSid) {
    params.set('MessagingServiceSid', messagingServiceSid);
  } else {
    // Fallback to direct number
    params.set('From', phoneNumber);
  }

  // MMS media
  if (mediaUrls && mediaUrls.length > 0) {
    mediaUrls.forEach(url => params.append('MediaUrl', url));
  }

  // Status callback for delivery receipts
  if (statusCallback) {
    params.set('StatusCallback', statusCallback);
  }

  // Fail closed on a laptop. Twilio has no test credentials on this account
  // (verified 2026-08-15), so the only token that exists is the live one and this
  // call would text a real person from a dev machine. TCPA penalties are per
  // message (AGENTS.md §14). Both no-op on Cloudflare.
  //
  // With UPR_LOCAL_SMS_ALLOWLIST set, local sending is permitted — but ONLY to
  // the listed numbers, so a runaway loop stops at the owner's own handset
  // instead of reaching a customer.
  assertProviderCallAllowed(env, 'twilio');
  assertLocalSmsDestinationAllowed(env, to);

  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );
  } catch (error) {
    // Only a failure at the provider request boundary is ambiguous. Credential
    // resolution, media signing, and validation happen before this block.
    if (error && typeof error === 'object') error.ambiguous = true;
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (response.ok) {
      if (error && typeof error === 'object') error.ambiguous = true;
      throw error;
    }
    data = {};
  }

  if (!response.ok) {
    throw new Error(`Twilio send failed: ${data.message || data.code || response.status}`);
  }
  if (!data?.sid) {
    const error = new Error('Twilio accepted the request without a usable message identity');
    error.ambiguous = true;
    throw error;
  }

  return {
    sid: data.sid,
    status: data.status,
    to: data.to,
    from: data.from,
    dateCreated: data.date_created,
  };
}

/**
 * Parse Twilio webhook form data into a clean object
 */
export function parseTwilioWebhook(formData) {
  return {
    messageSid: formData.get('MessageSid'),
    from: formData.get('From'),
    to: formData.get('To'),
    body: formData.get('Body') || '',
    numMedia: parseInt(formData.get('NumMedia') || '0', 10),
    // Group MMS routing
    addressSid: formData.get('AddressSid') || null,
    // Status info
    messageStatus: formData.get('MessageStatus') || null,
    errorCode: formData.get('ErrorCode') || null,
    errorMessage: formData.get('ErrorMessage') || null,
    // Channel info
    channelPrefix: formData.get('ChannelPrefix') || null,
    // Media URLs (MMS)
    mediaUrls: Array.from({ length: parseInt(formData.get('NumMedia') || '0', 10) }, (_, i) =>
      formData.get(`MediaUrl${i}`)
    ).filter(Boolean),
  };
}

/**
 * Return empty TwiML response (no auto-reply)
 */
export function emptyTwimlResponse() {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      headers: { 'Content-Type': 'text/xml' },
    }
  );
}
