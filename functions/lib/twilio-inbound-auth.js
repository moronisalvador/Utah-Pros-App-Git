/**
 * ════════════════════════════════════════════════
 * FILE: twilio-inbound-auth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads only the two account values needed to prove an incoming text really
 *   came from Twilio. It deliberately does not load outbound sender settings.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → integration_credentials, integration_config
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This runs before request authentication, so its two exact reads must not
 *     expand and it must never write telemetry or business data.
 *   - Database values win; only the matching legacy environment values are
 *     accepted as a fallback.
 * ════════════════════════════════════════════════
 */

function clean(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export async function resolveTwilioInboundAuth(env, db) {
  let dbAuthToken = null;
  let dbAccountSid = null;
  if (db?.select) {
    try {
      const [credentialRows, accountRows] = await Promise.all([
        db.select(
          'integration_credentials',
          'provider=eq.twilio&select=access_token&limit=1',
        ),
        db.select(
          'integration_config',
          'key=eq.twilio_account_sid&select=value&limit=1',
        ),
      ]);
      dbAuthToken = clean(credentialRows?.[0]?.access_token);
      dbAccountSid = clean(accountRows?.[0]?.value);
    } catch {
      // A credential lookup failure fails back only to the exact legacy env
      // values required for signature/account authentication.
    }
  }
  return {
    authToken: dbAuthToken || clean(env?.TWILIO_AUTH_TOKEN),
    accountSid: dbAccountSid || clean(env?.TWILIO_ACCOUNT_SID),
  };
}
