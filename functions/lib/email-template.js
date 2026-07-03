/**
 * ════════════════════════════════════════════════
 * FILE: email-template.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Wraps a campaign's message body in the same branded email "shell" (dark
 *   header with the company name, white card, footer with the unsubscribe
 *   link) every real send uses — this is what actually goes out through
 *   Resend. The CRM Campaigns builder's live preview panel renders the
 *   client-side twin of this exact function (src/lib/emailTemplate.js) so
 *   what the sender sees while composing is what the recipient actually
 *   gets, not an approximation.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  imported by functions/lib/automated-send.js
 *   Data:      reads  → none · writes → none
 *
 * EXPORTS:
 *   wrapEmailBody({ bodyHtml, unsubscribeUrl }) → string (full HTML document)
 *
 * NOTES / GOTCHAS:
 *   - KEEP THIS BYTE-FOR-BYTE IN SYNC WITH src/lib/emailTemplate.js's
 *     `wrapEmailBody`. They can't share one file — this one runs in the
 *     Cloudflare Workers runtime, the other in the browser bundle — so if
 *     you change the visual shell here, change it there too or the builder's
 *     preview will drift from what actually sends.
 *   - Brand shell mirrors functions/api/send-esign.js's buildEmailHtml (same
 *     dark header color, card, footer) so every outbound email — transactional
 *     or marketing — looks like it came from the same company.
 *   - `bodyHtml` is trusted, already-composed HTML from the campaign builder
 *     (an internal employee tool, not user-submitted input) — not re-escaped
 *     here, same trust boundary as send-esign.js's own template strings.
 * ════════════════════════════════════════════════
 */

export function wrapEmailBody({ bodyHtml, unsubscribeUrl } = {}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#1e293b;padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Utah Pros Restoration</p>
          <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Licensed &amp; Insured &middot; Utah</p>
        </td></tr>
        <tr><td style="padding:32px;font-size:15px;color:#334155;line-height:1.6;">
          ${bodyHtml || ''}
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
            Questions? Reply to this email or call <strong>(801) 427-0582</strong>.${unsubscribeUrl ? `<br><a href="${unsubscribeUrl}" style="color:#94a3b8;">Unsubscribe</a> from marketing emails.` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
