/**
 * ════════════════════════════════════════════════
 * FILE: emailTemplate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everything the CRM Campaigns email builder needs to show a realistic
 *   live preview: the same branded email "shell" the real send uses, sample
 *   stand-in values for {{name}}-style variables so the preview reads like a
 *   real email instead of showing raw tokens, and the list of variables /
 *   emoji the composer's toolbar offers.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (plain helper module, not a page)
 *   Rendered by:  src/pages/crm/CrmCampaigns.jsx (preview panel),
 *                 src/components/RichEmailEditor.jsx (variable toolbar)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * EXPORTS:
 *   wrapEmailBody({ bodyHtml, unsubscribeUrl }) → string (full HTML document)
 *   renderVariables(html, vars) → string ({{token}} substitution)
 *   EMAIL_VARIABLES  — [{ key, label }] offered by the "Insert variable" menu
 *   SAMPLE_VARIABLES — stand-in values so the preview doesn't show raw tokens
 *
 * NOTES / GOTCHAS:
 *   - `wrapEmailBody` MUST stay byte-for-byte identical to
 *     functions/lib/email-template.js's version of the same function — that
 *     one runs server-side at actual send time, this one only renders the
 *     preview. They can't share a file (browser bundle vs. Cloudflare
 *     Workers runtime), so keep both in sync by hand if the shell changes.
 *   - `EMAIL_VARIABLES` must stay a subset of what the backend actually
 *     substitutes (functions/api/send-email-campaign.js's renderTemplate
 *     call) — offering a variable here that the backend never populates
 *     would silently render blank in the real send.
 * ════════════════════════════════════════════════
 */

export const EMAIL_VARIABLES = [
  { key: 'name', label: "Full name" },
  { key: 'first_name', label: 'First name' },
  { key: 'email', label: 'Email address' },
];

export const SAMPLE_VARIABLES = {
  name: 'Jane Smith',
  first_name: 'Jane',
  email: 'jane.smith@example.com',
};

export function renderVariables(html, vars = {}) {
  return String(html || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Kept identical to functions/lib/email-template.js's wrapEmailBody — see NOTES above.
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
