// Twilio REST helper for Cloudflare Workers
// No SDK — pure fetch() + Web Crypto API for signature validation

/**
 * Validate Twilio webhook signature using HMAC-SHA1
 * CRITICAL: Reject any webhook that fails validation — prevents spoofed inbound messages
 */
export async function validateTwilioSignature(request, authToken, url) {
  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) return false;

  // Get form data from the request
  const clonedReq = request.clone();
  const formData = await clonedReq.formData();

  // Sort parameters alphabetically and concatenate
  const params = {};
  for (const [key, value] of formData.entries()) {
    params[key] = value;
  }
  const sortedKeys = Object.keys(params).sort();
  let dataString = url;
  for (const key of sortedKeys) {
    dataString += key + params[key];
  }

  // HMAC-SHA1 using Web Crypto API (available in Workers)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(authToken);
  const msgData = encoder.encode(dataString);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);

  // Convert to base64
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  return computed === signature;
}

/**
 * Send an SMS/MMS via Twilio REST API
 * Twilio auto-upgrades to RCS when the recipient supports it (if RCS sender is registered)
 */
export async function sendMessage(env, { to, body, mediaUrls, statusCallback }) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;

  const params = new URLSearchParams({
    To: to,
    Body: body,
  });

  // Use Messaging Service SID (handles RCS upgrade + sender pool)
  if (messagingServiceSid) {
    params.set('MessagingServiceSid', messagingServiceSid);
  } else {
    // Fallback to direct number
    params.set('From', env.TWILIO_PHONE_NUMBER);
  }

  // MMS media
  if (mediaUrls && mediaUrls.length > 0) {
    mediaUrls.forEach(url => params.append('MediaUrl', url));
  }

  // Status callback for delivery receipts
  if (statusCallback) {
    params.set('StatusCallback', statusCallback);
  }

  const response = await fetch(
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Twilio send failed: ${data.message || data.code || response.status}`);
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
