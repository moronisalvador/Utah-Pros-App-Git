/**
 * ════════════════════════════════════════════════
 * FILE: publicSigningUrl.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the signing link a technician copies and sends to a customer, and
 *   makes sure it always points at the real website. Inside the iPhone app the
 *   page's own address is `capacitor://localhost`, so the copied link used to
 *   be one nobody outside the phone could open.
 *
 * Exports:
 *   PUBLIC_APP_FALLBACK   the production site, used when the page origin is not
 *                         a real UPR address
 *   publicOrigin()        the origin a customer can actually reach
 *   publicSigningUrl(t)   the full signing link for a token
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/short-link.js (buildSigningUrl — documented pure
 *              and browser-safe), ./nativeAppLinks.js (the frozen host allowlist)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - ALLOWLIST, not a native check. Gating on `isNativePlatform()` would still
 *     emit a wrong link from a preview deploy, a file:// build, or any future
 *     shell — the question is "can a customer open this?", not "am I native?".
 *   - Reuses NATIVE_APP_HTTPS_HOSTS rather than repeating the hosts. That list
 *     is already frozen and is what Universal Links are validated against, so a
 *     host good enough to open the app is good enough to send a customer.
 *   - https only. An http origin is rejected even on an allowed host.
 *   - Server-side email/SMS links are NOT affected: send-esign.js and
 *     resend-esign.js already prefer env.APP_URL. This closes the client gap.
 *   - Relative /sign/:token navigation for deliberate collect-on-site signing
 *     is unrelated and unchanged — that never leaves the device.
 * ════════════════════════════════════════════════
 */
import { buildSigningUrl } from '../../functions/lib/short-link.js';
import { NATIVE_APP_HTTPS_HOSTS } from './nativeAppLinks.js';

export const PUBLIC_APP_FALLBACK = 'https://utahpros.app';

/**
 * The origin a customer can actually reach.
 *
 * Returns the page's own origin only when it is a real https UPR host;
 * otherwise the production site. That covers capacitor://localhost, file://,
 * localhost dev servers and preview hosts in one rule.
 */
export function publicOrigin(href = typeof window !== 'undefined' ? window.location?.href : '') {
  try {
    const url = new URL(href);
    if (url.protocol === 'https:' && NATIVE_APP_HTTPS_HOSTS.includes(url.hostname)) {
      return url.origin;
    }
  } catch {
    // Unparseable — fall through to the safe default.
  }
  return PUBLIC_APP_FALLBACK;
}

/** The customer-facing signing link for a token. */
export function publicSigningUrl(token, href) {
  return buildSigningUrl(publicOrigin(href), token);
}
