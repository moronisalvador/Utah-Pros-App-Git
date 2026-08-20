/**
 * ════════════════════════════════════════════════
 * FILE: signerEmail.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one question: does this signing request have a real email address we
 *   could actually write to? Some older requests were sent by text message only,
 *   and to get past a rule that demanded *some* address the app invented a fake
 *   one ending in "@noemail.local". Those look like addresses but nothing can be
 *   delivered to them, so anywhere we offer to email someone we have to treat
 *   them as having no address at all.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → nothing (pure function over a string)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - 9 of 58 live sign_requests carried a `collect-<ts>@noemail.local`
 *     placeholder when this was written, so a plain `!signer_email` check is NOT
 *     enough — the placeholder is a non-null string and sails straight past it.
 *   - DUPLICATED DELIBERATELY in functions/api/resend-esign.js AND
 *     functions/api/send-signed-copy.js. `functions/` is a separate Cloudflare
 *     bundle and cannot import from `src/`, so the rule genuinely exists three
 *     times; tests/qa/unit/esign-resend-truthfulness.test.js pins all three.
 *     Change one, change all.
 *   - Emailing a synthetic TLD is not merely useless: bounces on a domain that
 *     cannot exist cost real sender reputation (EMAIL-DELIVERABILITY.md).
 * ════════════════════════════════════════════════
 */

/** The placeholder domain older clients invented for text-only sends. */
export const NO_EMAIL_PLACEHOLDER_DOMAIN = '@noemail.local';

/**
 * @param {string|null|undefined} address
 * @returns {boolean} true only when there is a real, writable address
 */
export function hasRealEmail(address) {
  const v = String(address || '').trim().toLowerCase();
  return Boolean(v) && !v.endsWith(NO_EMAIL_PLACEHOLDER_DOMAIN);
}
