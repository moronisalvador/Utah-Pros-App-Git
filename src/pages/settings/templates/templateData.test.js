/**
 * ════════════════════════════════════════════════
 * FILE: templateData.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Prevents the built-in Work Authorization fallback from silently losing or
 *   changing the approved project-service SMS disclosure.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  ./templateData.jsx
 *   Data:      reads → built-in template constants only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Saved database templates override this fallback; the signing worker pins
 *     the same normalized text and hash independently.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { DEFAULT_TEMPLATES } from './templateData.jsx';

const APPROVED_SMS_DISCLOSURE =
  'By signing this Agreement, I consent to receive text messages (SMS/MMS) from Utah Pros Restoration at the mobile number provided in connection with this Agreement. Messages may include appointment reminders, project status updates, scheduling notifications, and other communications related to my restoration project. Message and data rates may apply. Message frequency varies. Reply STOP to opt out at any time. Reply HELP for assistance. Carriers are not liable for delayed or undelivered messages.';
const APPROVED_SHA256 =
  '22b2a37dc4094f683da6c0fe1d4955da989733a3a799307129b9fa83cae1265e';

describe('built-in Work Authorization SMS disclosure', () => {
  it('matches the version-pinned service-message disclosure exactly', () => {
    const body = DEFAULT_TEMPLATES.work_auth[0].body;
    const match = body.match(
      /## SMS COMMUNICATIONS\s+([\s\S]*?)(?=\n\n## |\s*$)/,
    );
    const disclosure = String(match?.[1] || '').replace(/\s+/g, ' ').trim();

    expect(disclosure).toBe(APPROVED_SMS_DISCLOSURE);
    expect(createHash('sha256').update(disclosure).digest('hex'))
      .toBe(APPROVED_SHA256);
  });
});
